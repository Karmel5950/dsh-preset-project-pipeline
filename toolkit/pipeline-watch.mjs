#!/usr/bin/env node
// pipeline-watch.mjs — 后台常驻 watcher:捕获会话 question/approval 帧 + 轮询项目 REGISTRY 变化。
// 固化自 tmp-watch.mjs:参数化(sessionId、超时分钟、日志路径、API 基址、轮询根目录),去 tmp- 前缀硬编码。
// 零依赖纯 node(仅 node 内置模块 + 全局 WebSocket,Node ≥22)。
//
// 自愈循环模式(2026-09-03,治"退出后忘重挂"断链,三次踩坑后定案):
//   watcher 不再"任一事件即退出"。事件分两类:
//   - 常规事件(阶段推进 gate=-、NEW-PROJECT、纯 mtime 变化、gate approve/clear):
//     写日志后【继续盯】,进程不退——"处理完自动重挂"由"根本不退"实现。
//   - 需人裁决事件(门禁 gate=pending、卡点 openBlockers>0、终态 STATE-FINAL、
//     WS question/approval 帧、启动基线挂起 BASELINE-PENDING):
//     打印 CONFIRMED 快照后【退出通知】(退出码 0/3),人来处理。
//   自愈:WS 断线 5 秒自动重连;轮询超时窗(默认 40 分钟)无任何变化不再退出,
//   改打 HEARTBEAT 并重扫基线(发现挂起照样按需人路径退出)。
//   旧一次性用法保留:--once 任一事件即退(退出码 0/2/3,原语义)。
//
// 单例锁(2026-09-03,治"残留进程堆积":历次布防的旧实例并存重复轮询/刷日志):
//   循环模式启动时在日志同目录写 `.pipeline-watch.lock`(内容 {pid,startedAt,wsRoot}):
//   - 锁指向的旧进程探活存活 → 自动【接管替换】:kill 旧进程,等其退出后写自己的锁;
//   - 锁指向的进程已死(陈旧锁,如强杀/断电残留)→ 直接清掉写自己的锁;
//   - 锁写入后回读校验归属(防双开竞态覆盖),不是自己的 → 打印谁在守然后退出;
//   - 退出路径(需人裁决 finish / 信号 / process.exit)统一经 exit hook 删锁,
//     删前校验锁归属(防误删接管者的锁);taskkill /F 类强杀删不了锁也无妨——
//     陈旧锁由下一次启动探活回收。--once 不参与锁(只读旁观,无重复轮询危害)。
// 通知适配层(2026-09-03,治"通知出口绑死 zcode harness"):
//   默认出口=进程退出+退出码(zcode harness 的 task-notification 通道)。
//   任意 agent 工具(Claude Code/Codex/OpenCode/dsh headless…)接上流水线值守只需二选一:
//   - --notify-cmd <命令>:需人裁决事件时 spawn 回调命令(fire-and-forget,unref 不阻塞退出),
//     事件详情经环境变量传递(不拼 shell,防注入):DSH_WATCH_EVENT(kind)/DSH_WATCH_PROJECT/
//     DSH_WATCH_DETAIL/DSH_WATCH_LOG(日志路径)/DSH_WATCH_EXIT(退出码)/DSH_WATCH_WS_ROOT。
//   - --notify-file <path>:同一事件追加一行 NDJSON({ts,kind,project,detail,exit,wsRoot,log}),
//     供轮询型 agent/cron 消费。
//   - --stay:通知后【不退出】继续盯(全自动 agent 模式:回调拉起的 agent 处理事件,
//     处理结果体现为后续 REGISTRY 常规变化,watcher 不退不断链);默认通知后退出(人/zcode 模式)。
//   注意:--stay 时 Baseline-pending/frame 等一次性事件不会自动重发,回调的 agent 侧自行去重。
//
// 修复史:
//   2026-09-01 基线竞态:a) 启动即扫 BASELINE-PENDING(退出码 3);
//     b) 终态显式事件 STATE-FINAL 不混入普通 REGISTRY-CHANGE。
//   2026-09-03 自愈循环:见上;--once 复现旧语义。单例锁自动接管/陈锁回收。通知适配层。
//
// 用法:
//   node pipeline-watch.mjs [--session <sessionId>] [--timeout-min <min>] [--log <path>] [--api <baseUrl>] [--ws-root <dir>] [--once]
//
// 选项:
//   --session <id>      可选。要订阅的会话 id(捕获其 question/approval 帧);缺省只轮询 REGISTRY 不订帧。
//                       注意:项目结项后其 intake 会话退役,订阅已被服务端断连——循环监控请省略本参数。
//   --timeout-min <min> 心跳窗,默认 40。窗内无任何变化 → 打 HEARTBEAT + 重扫基线(循环模式);
//                       --once 模式下超时退出码 2。
//   --log <path>        日志文件路径,默认 ./pipeline-watch.log。
//   --api <baseUrl>     dsh web API 基址,默认 http://127.0.0.1:3081(WS 用 ws:// 同源)。
//   --ws-root <dir>     轮询根目录(其下各项目 .dsh-project/REGISTRY.json),默认当前目录。
//   --once              旧一次性模式:任一事件(含常规)即退出,退出码 0;超时 2;基线挂起 3。
//
// 退出码(循环模式只在需人裁决时退出):
//   0  需人裁决事件(门禁/卡点/终态/提问帧)。
//   3  启动即扫或心跳重扫发现基线挂起项目(BASELINE-PENDING)。
//   1  参数错误。2 仅 --once 模式超时。
import fs from 'node:fs';
import path from 'node:path';
import { spawn as cpSpawn } from 'node:child_process';

const DEFAULT_API = 'http://127.0.0.1:3081';
const DEFAULT_TIMEOUT_MIN = 40;
const DEFAULT_LOG = 'pipeline-watch.log';
const WS_RECONNECT_MS = 5000;

function usage() {
  console.error(
    '用法: node pipeline-watch.mjs --session <sessionId> [--timeout-min <min>] [--log <path>] [--api <baseUrl>] [--ws-root <dir>] [--once]'
  );
}

function parseArgs(argv) {
  const args = { api: DEFAULT_API, timeoutMin: DEFAULT_TIMEOUT_MIN, log: DEFAULT_LOG, wsRoot: process.cwd(), once: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--session': args.session = next(); break;
      case '--timeout-min': args.timeoutMin = Number(next()); break;
      case '--log': args.log = next(); break;
      case '--api': args.api = next(); break;
      case '--ws-root': args.wsRoot = next(); break;
      case '--once': args.once = true; break;
      case '--notify-cmd': args.notifyCmd = next(); break;
      case '--notify-file': args.notifyFile = next(); break;
      case '--stay': args.stay = true; break;
      case '--help':
      case '-h': args.help = true; break;
      default:
        console.error(`未知参数: ${a}`);
        usage();
        process.exit(1);
    }
  }
  return args;
}

function log(args, s) {
  fs.appendFileSync(args.log, `[${new Date().toISOString()}] ${s}\n`);
  console.log(s);
}

// 读取轮询根目录下各项目 REGISTRY.json 的摘要;半写瞬时态(JSON 解析失败)跳过本轮不崩。
// 返回富对象 { state, gateStatus, openBlockers, summary },summary 保持原串格式(日志兼容)。
function readRegistries(args) {
  const out = {};
  let names = [];
  try { names = fs.readdirSync(args.wsRoot); } catch { return out; }
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const p = path.join(args.wsRoot, name, '.dsh-project', 'REGISTRY.json');
    try {
      const st = fs.statSync(p);
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const openB = (j.blockers ?? []).filter((b) => b.status === 'open').length;
      const state = j.state ?? '?';
      const gateStatus = j.gateStatus ?? '-';
      out[name] = {
        state,
        gateStatus,
        openBlockers: openB,
        summary: `state=${state} stage=${j.currentStage ?? '?'}#${j.stageIndex ?? '?'} gate=${gateStatus} blockers-open=${openB} mtime=${Math.round(st.mtimeMs)}`,
      };
    } catch { /* 半写瞬时态:跳过本轮 */ }
  }
  return out;
}

// 把富对象映射序列化为原摘要串映射(用于日志,保持格式兼容)。
function summaryMap(regs) {
  return Object.fromEntries(Object.entries(regs).map(([k, v]) => [k, v.summary]));
}

// ── 单例锁:循环模式同一 ws-root 只允许一个常驻实例,新启自动接管替换 ──
// 锁放 <ws-root>/.pipeline-watch.lock(隐藏文件,readRegistries 跳过 . 开头)——
// 守同一 root 才互斥,跨 root 并存天然合法(各自一把锁)。
function lockPathOf(args) {
  return path.join(args.wsRoot, '.pipeline-watch.lock');
}
function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e?.code === 'EPERM'; }
}
function readLock(args) {
  try { return JSON.parse(fs.readFileSync(lockPathOf(args), 'utf8')); } catch { return null; }
}
function writeLock(args, extra = {}) {
  const body = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), wsRoot: args.wsRoot, ...extra });
  fs.writeFileSync(lockPathOf(args), body);
}
function releaseLockIfMine(args) {
  const cur = readLock(args);
  if (cur?.pid === process.pid) { try { fs.unlinkSync(lockPathOf(args)); } catch { } }
}
// 返回 true=继续启动;false=另一实例先一步接管(打印后退出)。--once 恒不参与锁。
function acquireLock(args) {
  if (args.once) return true;
  const old = readLock(args);
  if (old?.pid && old.pid !== process.pid && processAlive(old.pid)) {
    console.error(`接管:替换旧 watcher pid=${old.pid}(startedAt=${old.startedAt ?? '?'})`);
    try { process.kill(old.pid); } catch { /* 已死,下面轮询兜底 */ }
    const t0 = Date.now();
    while (processAlive(old.pid) && Date.now() - t0 < 3000) {
      const stop = Date.now() + 100; while (Date.now() < stop) { /* 100ms 忙等 */ }
    }
    if (processAlive(old.pid)) console.error(`警告:旧 watcher pid=${old.pid} 3 秒未退,继续接管(锁以本实例为准)`);
  } else if (old?.pid) {
    console.error(`回收陈旧锁(pid=${old.pid} 已不存在)`);
  }
  writeLock(args, old?.pid ? { replacedPid: old.pid } : {});
  // 双开竞态回读:若锁已被另一实例覆盖,让位。
  const now = readLock(args);
  if (now?.pid !== process.pid) {
    console.error(`另一 watcher pid=${now?.pid} 先一步接管,本实例退出`);
    return false;
  }
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); process.exit(0); }
  if (!Number.isFinite(args.timeoutMin) || args.timeoutMin <= 0) {
    console.error('--timeout-min 必须为正数');
    process.exit(1);
  }

  const TIMEOUT_MS = args.timeoutMin * 60000;
  const wsUrl = args.api.replace(/^http/, 'ws') + '/api/events.mux';

  if (!acquireLock(args)) process.exit(0);
  // 退出清锁:所有 process.exit 路径统一经此;删前校验归属,防误删接管者的锁。
  process.on('exit', () => releaseLockIfMine(args));
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    try {
      process.on(sig, () => { log(args, `watcher exit (${sig})`); process.exit(0); });
    } catch { /* 平台不支持该信号则跳过 */ }
  }

  let snapshot = readRegistries(args);
  log(args, `watcher start${args.once ? ' (--once)' : ' (loop)'}; session=${args.session ?? '(none, registry-only)'} ws=${wsUrl} root=${args.wsRoot} ${JSON.stringify(summaryMap(snapshot))}`);

  let settled = false;
  // 通知适配层:需人裁决事件的对外出口(回调命令 + NDJSON 事件文件)。
  function notifyAdapters(kind, project, detail, exitCode) {
    const payload = { ts: new Date().toISOString(), kind, project, detail: String(detail).slice(0, 2000), exit: exitCode, wsRoot: args.wsRoot, log: path.resolve(args.log) };
    if (args.notifyFile) {
      try { fs.appendFileSync(args.notifyFile, JSON.stringify(payload) + '\n'); } catch (e) { log(args, `notify-file error ${e?.message ?? e}`); }
    }
    if (args.notifyCmd) {
      try {
        // 命令由布防者提供;事件详情走环境变量不拼进命令串,防注入。fire-and-forget,不阻塞退出。
        const child = cpSpawn(args.notifyCmd, {
          env: { ...process.env, DSH_WATCH_EVENT: kind, DSH_WATCH_PROJECT: String(project ?? ''), DSH_WATCH_DETAIL: String(detail).slice(0, 2000), DSH_WATCH_LOG: path.resolve(args.log), DSH_WATCH_EXIT: String(exitCode), DSH_WATCH_WS_ROOT: args.wsRoot },
          stdio: 'ignore', shell: true, detached: true,
        });
        child.on('error', (e) => log(args, `notify-cmd error ${e?.message ?? e}`));
        child.unref();
        log(args, `NOTIFY cmd dispatched (pid=${child.pid ?? '?'})`);
      } catch (e) { log(args, `notify-cmd error ${e?.message ?? e}`); }
    }
    return payload;
  }
  function finish(kind, detail, code = 0, confirmSnapshot, project) {
    if (settled) return;
    settled = true;
    log(args, `EVENT ${kind}: ${detail}`);
    notifyAdapters(kind, project ?? detail.split(' ')[0], detail, code);
    if (args.stay && !args.once) {
      // 全自动 agent 模式:通知出口已触发,watcher 继续盯;事件消化体现为后续常规变化。
      settled = false;
      log(args, `STAY: notified, keep watching (--stay)`);
      return;
    }
    setTimeout(() => {
      const confirm = readRegistries(args);
      log(args, `CONFIRMED ${JSON.stringify(summaryMap(confirm))}`);
      process.exit(code);
    }, 3000);
    if (confirmSnapshot) snapshot = confirmSnapshot;
  }

  // 基线挂起即扫:active 且(gate=pending 或 open-blockers>0)→ 需人裁决,退出码 3。
  function baselineScan(regs) {
    const pending = Object.entries(regs)
      .filter(([, v]) => v.state === 'active' && (v.gateStatus === 'pending' || v.openBlockers > 0))
      .map(([k]) => k);
    if (pending.length) finish('BASELINE-PENDING', pending.join(' '), 3, undefined, pending[0]);
    return pending.length > 0;
  }

  // REGISTRY 变化分类:返回 'human'(需人裁决,已触发 finish)或 'routine'(常规,记录后继续)。
  function classifyChange(k, old, v) {
    const oldState = old?.state;
    if (oldState !== v.state && (v.state === 'delivered' || v.state === 'rejected')) {
      finish('STATE-FINAL', `${k} ${v.state}`, 0, undefined, k);
      return 'human';
    }
    const human = v.state === 'active' && (v.gateStatus === 'pending' || v.openBlockers > 0);
    const kind = old === undefined ? 'NEW-PROJECT' : 'REGISTRY-CHANGE';
    if (human && !args.once) {
      // 循环模式:变化本身可能是挂起态首次出现 → 需人,退出。
      finish(kind, `${k}: ${old?.summary ?? '(new)'} -> ${v.summary}`, 0, undefined, k);
      return 'human';
    }
    log(args, `EVENT ${kind}: ${k}: ${old?.summary ?? '(new)'} -> ${v.summary}`);
    if (args.once) { finish(kind, `${k}: ${old?.summary ?? '(new)'} -> ${v.summary}`, 0, undefined, k); return 'human'; }
    return 'routine';
  }

  if (baselineScan(snapshot)) return;

  let lastActivity = Date.now();

  const poll = setInterval(() => {
    try {
      const next = readRegistries(args);
      for (const [k, v] of Object.entries(next)) {
        if (snapshot[k]?.summary !== v.summary) {
          lastActivity = Date.now();
          const verdict = classifyChange(k, snapshot[k], v);
          if (verdict === 'human') return;
          snapshot = readRegistries(args); // 常规事件:刷新快照继续盯
          return;
        }
      }
      snapshot = next;
    } catch (e) { log(args, `poll error ${e?.message ?? e}`); }

    // 心跳窗:循环模式下不退出,打 HEARTBEAT 并重扫基线;--once 模式维持原超时退出。
    if (Date.now() - lastActivity > TIMEOUT_MS) {
      lastActivity = Date.now();
      if (args.once) { log(args, 'TIMEOUT: no event within window'); process.exit(2); }
      const cur = readRegistries(args);
      log(args, `HEARTBEAT ${JSON.stringify(summaryMap(cur))}`);
      baselineScan(cur);
    }
  }, 3000);

  // 帧(question/approval)通道:--session 给出时才消费。/api/events.mux 是 **纯下行 WS 通道**
  // (服务端规则:客户端发送任何消息 → close(1008) "downlink only"——2026-09-05 修复:旧实现
  //  连接后即发订阅消息,每次被踢,帧通道长期只有"接入瞬间的重放"可看;实际无需订阅,服务端
  //  向所有连接广播全部事件,接入时自动重放挂起帧)。
  // 正确姿势 = 连接后零发送,客户端侧按 sessionId 过滤。seenRpc 跨重连持久 → 重放去重,
  // 新帧(含接入时已挂起的)触发 finish;断流指数退避重连(5s→60s)。
  const seenRpc = new Set();
  const connectWs = async () => {
    if (!args.session || settled) return;
    let backoff = WS_RECONNECT_MS;
    for (;;) {
      if (settled) return;
      try {
        await new Promise((open, fail) => {
          const ws = new WebSocket(wsUrl);
          let done = false;
          const onMsg = (ev) => {
            try {
              const j = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
              if (j.type === 'server-request' || j.type === 'server-response') return;
              const t = j.payload?.type ?? '';
              const rid = String(j.rpcId ?? '?');
              if (args.session && j.payload?.sessionId && j.payload.sessionId !== args.session) return;
              if (/question|approval/i.test(t)) {
                if (seenRpc.has(rid)) return;
                seenRpc.add(rid);
                if (!done) { done = true; ws.close(); }
                finish('FRAME', `rpcId=${rid} type=${t} ${JSON.stringify(j.payload).slice(0, 2000)}`);
              }
            } catch { }
          };
          ws.onopen = () => {
            backoff = WS_RECONNECT_MS;
            log(args, 'ws connected (downlink-only: 发送即被踢,保持零发送)');
          };
          ws.onmessage = onMsg;
          ws.onclose = () => { if (!done) fail(new Error('ws closed')); };
          ws.onerror = () => { };
        });
        log(args, 'ws closed; reconnect in ' + backoff + 'ms');
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 60000);
      } catch (error) {
        if (settled) return;
        log(args, `ws retry in ${backoff}ms (${error?.message ?? error})`);
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 60000);
      }
    }
  };
  connectWs();
}

main();
