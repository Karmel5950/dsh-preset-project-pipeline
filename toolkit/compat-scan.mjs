// `npm run compat:scan` —— dsh-compat 的 detectStatic:离线扫 dsh-runtime 树,
// 逐能力产出满足报告(ok | degraded | broken),升级 SOP 的第 4 步。
//   node toolkit/compat-scan.mjs           # 扫描并写 dsh-compat.report.json
//   node toolkit/compat-scan.mjs --diff    # 与上次报告对比,输出逐能力变更
// 退出码:存在 broken → 1(修 dsh-compat 实现至全绿再继续升级 SOP)。
// 锚 = 官方代码形状断言(收编 lan-access deploy 的金丝雀并扩展);锚漂移 =
// 能力断供信号,报告指向锚文件。锚串随实现修复更新,git 可追溯。
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { RUNTIME_NODE_MODULES, WORKSPACE_ROOT, PRESETS_DIR, runtimeDshVersion } from './paths.mjs';
import { lintComposition } from './lint-composition.mjs';
import { COMPAT_VERSION } from '../shared/dsh-compat/dsh-compat.mjs';

const REPORT_PATH = join(WORKSPACE_ROOT, 'dsh-compat.report.json');

// ── 锚清单(能力 → 官方代码特征串)──────────────────────────────────────────
// pack = @deepseek-ai/<pack>,file = 包内路径,test = 特征串(含即中)。
const ANCHORS = [
  // M.canary(收编 lan-access deploy 金丝雀,2026-08-29)
  { id: 'web-startup-row', capability: 'M.canary', pack: 'dsh-web-app', file: 'cordis.patch.yml', test: '- id: web-startup', note: '组合 patch 的 web 启动行(!js 端口表达式挂载点)' },
  { id: 'loopback-hostname', capability: 'M.canary', pack: 'dsh-client-connection', file: 'lib/index.js', test: 'isLoopbackHostname', note: '官方回环判定(lan-access 网关镜像语义的上游)' },
  { id: 'privileged-methods', capability: 'M.canary', pack: 'dsh-client-connection', file: 'lib/index.js', test: 'PRIVILEGED_METHODS', note: '特权方法钉死清单(lan-access 网关转发语义的上游)' },

  // L0.ctx:受保护事件名的官方消费证据
  { id: 'agent-created-consumer', capability: 'L0.ctx', pack: 'dsh-agent', file: 'lib/index.js', test: 'agent/created', note: '代理创建事件(子代理选项注入的挂载点)' },
  { id: 'agent-request-consumer', capability: 'L0.ctx', pack: 'dsh-agent', file: 'lib/index.js', test: 'installModelSelection', note: '官方请求覆盖先例(与 subagentOptions 同手法)' },
  { id: 'system-prompt-assemble', capability: 'L0.ctx', pack: 'dsh-agent-presets', file: 'lib/invariant.js', test: 'system-prompt/assemble', note: '提示组装事件(preset 面插件消费)' },
  { id: 'session-event', capability: 'L0.ctx', pack: 'dsh-agent-loop', file: 'lib/index.js', test: 'session/event', note: '会话事件(相位推导消费)' },
  { id: 'agent-pre-step', capability: 'L0.ctx', pack: 'dsh-agent-loop', file: 'lib/index.js', test: 'agent/pre-step', note: '请求前注入事件(上下文过滤消费)' },

  // L1.hotConfig
  { id: 'settings-register', capability: 'L1.hotConfig', pack: 'dsh-settings', file: 'lib/index.js', test: 'register(ns, schema, options)', note: '命名空间注册方法' },
  { id: 'settings-replace', capability: 'L1.hotConfig', pack: 'dsh-settings', file: 'lib/index.js', test: 'async replace(ns, section, expectedRevision)', note: '整段替换方法(持久化落 settings.yaml)' },
  // 官方直写开放证据(0.1.1-rc.2 起):apiproxy settingsWrite 无白名单,自定义命名空间
  // 可经官方 settings.update/replace 读写。锚不中 = 官方直写不可用(0.1.0-rc.6 白名单时代)
  // → degraded:读写经 L1.channel 通道兜底。
  { id: 'apiproxy-settings-write', capability: 'L1.hotConfig', pack: 'dsh-host-apiproxy', file: 'lib/index.js', test: 'async function settingsWrite', note: '官方 settings 写入口(准入=命名空间校验+schema,无白名单)' },

  // L1.channel
  { id: 'webserver-inject', capability: 'L1.channel', pack: 'dsh-web-app', file: 'lib/index.js', test: 'const inject = ["webServer"]', note: 'web 侧 webServer 服务消费' },
  { id: 'exact-route', capability: 'L1.channel', pack: 'dsh-web-app', file: 'lib/index.js', test: 'exact', note: '精确路由 kind(通道注册形状)' },

  // L1.subagentOptions
  { id: 'subagent-origin', capability: 'L1.subagentOptions', pack: 'dsh-subagent', file: 'lib/index.js', test: 'origin: "subagent"', note: '子代理会话标记(isSubagentSession 的上游)' },
  { id: 'request-config-fields', capability: 'L1.subagentOptions', pack: 'dsh-agent-loop', file: 'lib/index.js', test: 'maxTokens', note: '请求配置读取 provider/model/maxTokens(官方透传链现状:不含 reasoningEffort)' },

  // L2 静态半边(运行态靠浏览器实测)
  // 0.1.1-rc.2 起 settings.plugin.item 是 keyed 槽:tab 按命名空间 dispatch,
  // 注册必须带 key(=命名空间)。锚断 = 注册姿势漂移 → 卡不渲染(客户端装载失败)。
  { id: 'settings-plugin-slot', capability: 'L2.settingsCard', pack: 'dsh-client-ui-settings-plugins', file: 'lib/client.js', test: 'renderSlot("settings.plugin.item", {}, { entryKey', note: '「插件配置」tab keyed 槽按命名空间 dispatch(注册侧须 key=ns)' },
  { id: 'toolview-slot', capability: 'L2.toolRowSlot', pack: 'dsh-client-ui-tool', file: 'lib/client.js', test: 'tool.call.toolview', note: 'keyed 工具行视图槽(subagent/subagent_fork key 官方未占)' },
];

async function readPackFile(anchor) {
  const path = join(RUNTIME_NODE_MODULES, '@deepseek-ai', anchor.pack, anchor.file);
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function checkAnchor(anchor) {
  const text = await readPackFile(anchor);
  if (text === null) return { ...anchor, hit: false, evidence: `文件不存在: @deepseek-ai/${anchor.pack}/${anchor.file}` };
  const hit = text.includes(anchor.test);
  return { ...anchor, hit, evidence: hit ? `@deepseek-ai/${anchor.pack}/${anchor.file} 含 "${anchor.test}"` : `@deepseek-ai/${anchor.pack}/${anchor.file} 不再含 "${anchor.test}"` };
}

/** L0.dialect:对所有 preset 组合跑离线 lint(loader 同款方言)。 */
async function checkDialect() {
  const problems = [];
  let rows = 0;
  const entries = await readdir(PRESETS_DIR, { withFileTypes: true }).catch(() => []);
  for (const entry of entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    const text = await readFile(join(PRESETS_DIR, entry, 'agent.cordis.yml'), 'utf8').catch(() => null);
    if (text === null) continue; // 缺组合文件的 preset 由 npm run check 负责
    const { errors } = await lintComposition(text, join(PRESETS_DIR, entry));
    rows += 1;
    for (const error of errors) problems.push(`${entry}: ${error}`);
  }
  return { status: problems.length === 0 ? 'ok' : 'broken', evidence: problems.length === 0 ? `${rows} 个组合文件方言 lint 全过` : problems.join('; '), anchors: [] };
}

async function scan() {
  const anchorResults = [];
  for (const anchor of ANCHORS) anchorResults.push(await checkAnchor(anchor));

  const byCapability = new Map();
  for (const result of anchorResults) {
    if (!byCapability.has(result.capability)) byCapability.set(result.capability, []);
    byCapability.get(result.capability).push(result);
  }

  const capabilities = {};
  for (const [capability, results] of byCapability) {
    const missed = results.filter((r) => !r.hit);
    // L1.hotConfig 分档:核心锚(register/replace)断 → broken;官方直写锚
    // (apiproxy settingsWrite,0.1.1-rc.2 起开放)不中 → degraded(读写经
    // L1.channel 通道兜底,0.1.0-rc.6 白名单时代的常态)。
    if (capability === 'L1.hotConfig') {
      const coreMissed = missed.filter((r) => r.id !== 'apiproxy-settings-write');
      const directWriteMissed = missed.find((r) => r.id === 'apiproxy-settings-write');
      if (coreMissed.length > 0) {
        capabilities[capability] = { status: 'broken', evidence: coreMissed.map((r) => r.evidence).join(' | ') };
      } else if (directWriteMissed) {
        capabilities[capability] = {
          status: 'degraded',
          evidence: results.map((r) => r.evidence).join(' | '),
          note: '官方 settings 直写不可用(白名单时代):读写经 L1.channel 通道兜底',
        };
      } else {
        capabilities[capability] = {
          status: 'ok',
          evidence: results.map((r) => r.evidence).join(' | '),
          note: '官方直写已开放(apiproxy settingsWrite 无白名单):自有通道可评估退役',
        };
      }
      continue;
    }
    capabilities[capability] = {
      status: missed.length === 0 ? 'ok' : 'broken',
      evidence: (missed.length > 0 ? missed : results).map((r) => r.evidence).join(' | '),
    };
  }
  capabilities['L0.dialect'] = await checkDialect();

  const order = ['L0.ctx', 'L0.dialect', 'L1.hotConfig', 'L1.channel', 'L1.subagentOptions', 'L2.settingsCard', 'L2.toolRowSlot', 'M.canary'];
  const ordered = {};
  for (const id of order) if (capabilities[id]) ordered[id] = capabilities[id];

  return {
    capturedAt: new Date().toISOString(),
    dshVersion: runtimeDshVersion(),
    compatVersion: COMPAT_VERSION,
    capabilities: ordered,
  };
}

function printReport(report) {
  console.log(`dsh-compat 满足报告(dsh ${report.dshVersion} / compat ${report.compatVersion} / ${report.capturedAt})`);
  for (const [id, entry] of Object.entries(report.capabilities)) {
    const icon = entry.status === 'ok' ? '✓' : entry.status === 'degraded' ? '〜' : '✗';
    console.log(`  ${icon} ${id}: ${entry.status}`);
    if (entry.status !== 'ok') console.log(`      ${entry.evidence}${entry.note ? `\n      备注: ${entry.note}` : ''}`);
  }
}

function diffReports(previous, current) {
  const ids = new Set([...Object.keys(previous.capabilities), ...Object.keys(current.capabilities)]);
  const changes = [];
  for (const id of ids) {
    const before = previous.capabilities[id]?.status;
    const after = current.capabilities[id]?.status;
    if (before === after) continue;
    if (before === undefined) changes.push(`  + ${id}: (新增) → ${after}`);
    else if (after === undefined) changes.push(`  - ${id}: ${before} → (移除)`);
    else changes.push(`  ~ ${id}: ${before} → ${after}`);
  }
  console.log('\n与上次报告(' + previous.capturedAt + ',dsh ' + previous.dshVersion + ')对比:');
  if (changes.length === 0) console.log('  无能力状态变更');
  for (const line of changes) console.log(line);
}

const diff = process.argv.includes('--diff');
const report = await scan();
printReport(report);

if (diff) {
  const previous = await readFile(REPORT_PATH, 'utf8').then((t) => JSON.parse(t)).catch(() => null);
  if (previous) diffReports(previous, report);
  else console.log('\n(无上次报告,本次为首跑基线)');
}

await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`\n✓ 已写入 ${REPORT_PATH}`);

const broken = Object.entries(report.capabilities).filter(([, e]) => e.status === 'broken');
if (broken.length > 0) {
  console.error(`\ncompat:scan 失败:${broken.length} 个能力 broken —— 修 dsh-compat 实现(必要时更新锚串)后再继续升级 SOP`);
  process.exit(1);
}
