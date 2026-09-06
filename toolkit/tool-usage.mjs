#!/usr/bin/env node
// tool-usage.mjs — 工具使用审计:从两个运行历史数据源统计各工具真实使用情况。
//
// 数据源(只读,零新增采集):
//   1. dsh 会话存储 <DSH_HOME>/sessions/**/session.jsonl.zstd
//      —— 多帧 zstd 拼接的 jsonl(流式解压只取首帧,须按帧魔数 28 B5 2F FD 切帧逐帧解)。
//      覆盖:preset 注册工具(tool-call 块 name 字段,精确)+ 角色侧 CLI( pwsh 命令文本匹配)。
//   2. zcode rollout <~/.zcode/cli/rollout>/model-io-*.jsonl
//      —— 每行一次模型请求转储;同一 assistant 消息会在后续请求中重复,按 tool_call id 去重。
//      覆盖:主线程 Bash 执行的 toolkit CLI。注意 rollout 仅保留近期会话,视野=近期。
//
// 用法:
//   node tool-usage.mjs [--dsh-home <dir>] [--rollout <dir>] [--out <报告.md>]
//
// 输出:各工具 {调用次数, 最近使用时刻, 最近使用会话};零使用清单(观察窗口内)。
// 用途:README status 标注的依据(最小机制支柱 1/2)、kr-self-audit 观察原语 O5 的前身。
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_DSH_HOME = path.join(process.cwd(), '.dsh-home');
const DEFAULT_ROLLOUT = path.join(os.homedir(), '.zcode', 'cli', 'rollout');

// toolkit CLI 工具清单(与 README 登记表一致;新增工具时同步)
const TOOLKIT_TOOLS = [
  'pipeline-start', 'pipeline-drive', 'pipeline-watch', 'intake-collect', 'tool-usage',
  'deploy', 'check', 'validate', 'lint-composition', 'compat-scan', 'new-preset',
  'refresh-lock', 'upgrade-runtime', 'stub-ctx', 'dialect',
];
// package.json scripts 入口映射:npm run <script> 也是这些工具的真实调用形态
const SCRIPT_MAP = {
  check: 'check', validate: 'validate', deploy: 'deploy', new: 'new-preset',
  'lock:refresh': 'refresh-lock', 'compat:scan': 'compat-scan', 'upgrade:runtime': 'upgrade-runtime',
  'env:up': 'env', 'env:down': 'env', 'env:status': 'env', test: 'node-test',
};
function recordCliForm(text, at, sess, prefix = 'cli:') {
  for (const t of TOOLKIT_TOOLS) {
    if (new RegExp('toolkit[/\\\\]' + t + '\\.mjs').test(text)) record(prefix + t, at, sess);
  }
  for (const m of text.matchAll(/npm run ([\w.:-]+)/g)) {
    const tool = SCRIPT_MAP[m[1]];
    if (tool) record(prefix + tool, at, sess);
  }
}

function parseArgs(argv) {
  const args = { dshHome: DEFAULT_DSH_HOME, rollout: DEFAULT_ROLLOUT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dsh-home') args.dshHome = argv[++i];
    else if (argv[i] === '--rollout') args.rollout = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
  }
  return args;
}

const usage = new Map(); // key -> { calls, lastAt, lastSession }
function record(key, at, sess) {
  const u = usage.get(key) ?? { calls: 0, lastAt: 0, lastSession: '' };
  u.calls++;
  if (at > u.lastAt) { u.lastAt = at; u.lastSession = sess; }
  usage.set(key, u);
}

// ── 数据源 1:dsh 会话存储(多帧 zstd)──
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
function decompressMultiFrame(buf) {
  const parts = [];
  let start = 0;
  while (start < buf.length) {
    let next = buf.indexOf(ZSTD_MAGIC, start + 1);
    if (next < 0) next = buf.length;
    try { parts.push(zlib.zstdDecompressSync(buf.subarray(start, next))); } catch { /* 坏帧跳过 */ }
    start = next;
  }
  return Buffer.concat(parts);
}
function walkSessionFiles(dir, out = []) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkSessionFiles(p, out);
    else if (e.name === 'session.jsonl.zstd') out.push(p);
  }
  return out;
}
// tool-call 块:name 与 arguments 相邻出现(arguments 内为转义 JSON 文本)
const TC_RE = /"type":"tool-call","id":"[^"]*","name":"([^"]+)","arguments":"((?:[^"\\]|\\.)*)"/g;
function scanDshSessions(dshHome) {
  const files = walkSessionFiles(path.join(dshHome, 'sessions'));
  let ok = 0;
  for (const f of files) {
    const sess = path.basename(path.dirname(f));
    let buf; try { buf = fs.readFileSync(f); } catch { continue; }
    const out = decompressMultiFrame(buf).toString('utf8');
    if (out.length < 200) continue;
    ok++;
    for (const ln of out.split('\n')) {
      if (!ln.includes('"tool-call"')) continue;
      const time = Number(ln.match(/"time":(\d+)/)?.[1] ?? 0);
      let m;
      TC_RE.lastIndex = 0;
      while ((m = TC_RE.exec(ln))) {
        const name = m[1];
        const args = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        record('dsh:' + name, time, sess);
        if (name === 'pwsh' || name === 'bash') recordCliForm(args, time, sess);
      }
    }
  }
  return { files: files.length, ok };
}

// ── 数据源 2:zcode rollout(主线程 Bash 命令,按 call id 去重)──
function scanRollout(rolloutDir) {
  let files = []; try { files = fs.readdirSync(rolloutDir).filter((f) => f.endsWith('.jsonl')); } catch { }
  const seen = new Set();
  let filesScanned = 0;
  for (const f of files) {
    let text; try { text = fs.readFileSync(path.join(rolloutDir, f), 'utf8'); } catch { continue; }
    if (!text.includes('toolkit/')) continue;
    filesScanned++;
    for (const ln of text.split('\n')) {
      if (!ln.includes('"name":"Bash"') || !ln.includes('toolkit/')) continue;
      let j; try { j = JSON.parse(ln); } catch { continue; }
      const at = Date.parse(j.completedAt ?? '') || 0;
      const msgs = j?.request?.messages ?? j?.request?.body?.messages ?? [];
      for (const msg of msgs) {
        if (msg.role !== 'assistant') continue;
        for (const tc of msg.toolCalls ?? []) {
          if (!tc.id || seen.has(tc.id)) continue;
          const command = typeof tc.input?.command === 'string' ? tc.input.command
            : (() => { try { return JSON.parse(tc.function?.arguments ?? '{}').command ?? ''; } catch { return ''; } })();
          // 收紧为执行形态(node/npm run 跑工具),排除 grep/head 等调查类命令的文本提及
          if (!/\b(node|npm run)\b/.test(command)) continue;
          seen.add(tc.id);
          recordCliForm(command, at, f.replace('model-io-', '').replace('.jsonl', ''), 'zc:');
        }
      }
    }
  }
  return { files: files.length, scanned: filesScanned };
}

// ── 报告 ──
function report(args, dshInfo, rollInfo) {
  const now = new Date().toISOString();
  const lines = [];
  lines.push(`# 工具使用审计报告`);
  lines.push('');
  lines.push(`- 生成:${now}`);
  lines.push(`- 数据源 1:dsh 会话存储(${dshInfo.ok}/${dshInfo.files} 文件可解析)——覆盖 preset 注册工具+角色侧 CLI`);
  lines.push(`- 数据源 2:zcode rollout(${rollInfo.scanned}/${rollInfo.files} 文件含 toolkit 引用,仅近期会话)——覆盖主线程 CLI`);
  lines.push(`- 视野说明:cli: 合并两源;rollout 只留近期会话,「最近使用」可能早于实际`);
  lines.push('');
  lines.push(`| 工具 | 次数 | 最近使用 | 最近会话 |`);
  lines.push(`|---|---:|---|---|`);
  const rows = [...usage.entries()].sort((a, b) => b[1].calls - a[1].calls);
  for (const [k, u] of rows) {
    lines.push(`| ${k} | ${u.calls} | ${u.lastAt ? new Date(u.lastAt).toISOString() : '?'} | ${u.lastSession.slice(0, 16)} |`);
  }
  lines.push('');
  lines.push(`## 观察窗口内零使用`);
  lines.push('');
  for (const t of TOOLKIT_TOOLS) {
    const n = (rows.filter(([k]) => k.endsWith(':' + t)).reduce((s, [, u]) => s + u.calls, 0));
    if (!n) lines.push(`- cli:${t}`);
  }
  const text = lines.join('\n');
  if (args.out) fs.writeFileSync(args.out, text + '\n');
  return text;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.error('用法: node tool-usage.mjs [--dsh-home <dir>] [--rollout <dir>] [--out <报告.md>]');
  process.exit(0);
}
const dshInfo = scanDshSessions(args.dshHome);
const rollInfo = scanRollout(args.rollout);
const text = report(args, dshInfo, rollInfo);
console.log(text);
