// toolface-lib.test.mjs —— 角色工具面一致性核对纯函数单测(零依赖,node:test)。
// 覆盖:parseRolesAllow / parseCordisPerRoleAllow happy path;checkL1vsL2(kr-p4-route
// 事故根因:roles 有而 per-role 行无 / 反向 per-role 行有而 roles 无);checkL2vsL3
// (白名单引用真实面不存在工具);checkL1vsL3(roles 引用真实面不存在工具);checkForbidden;
// auditToolface 统一入口(干净样本 happy path / 漂移样本逐类命中);L4 冻结语义文档化。
// 运行:node test/toolface-lib.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REAL_TOOL_SURFACE,
  FORBIDDEN,
  TOOLFACE_FREEZE_SEMANTICS,
  roleToolName,
  toolNameToRole,
  parseRolesAllow,
  parseCordisPerRoleAllow,
  checkL1vsL2,
  checkL2vsL3,
  checkL1vsL3,
  checkForbidden,
  auditToolface,
} from '../scripts/toolface-lib.mjs';

// ── 干净样本(镜像生产 preset 当前态:kr-p4-route 已补 project_harvest;kr-pm-review 已补 pm)──
const CLEAN_ROLES = [
  { id: 'coordinator', tools: { allow: ['project_advance', 'project_gate', 'project_budget', 'project_status', 'role_list', 'role_show', 'flow_list', 'flow_show', 'send_message', 'interrupt_agent', 'read', 'write', 'edit', 'glob', 'grep', 'todo_write', 'project_block', 'project_harvest', 'project_audit', 'subagent_architect', 'subagent_deliverer', 'subagent_dev', 'subagent_product', 'subagent_pm', 'subagent_tester'] } },
  { id: 'dev', tools: { allow: ['read', 'write', 'edit', 'glob', 'grep', 'pwsh', 'todo_write', 'send_message', 'project_budget', 'project_block', 'subagent_devhelper'] } },
  { id: 'pm', tools: { allow: ['read', 'glob', 'grep', 'write', 'todo_write', 'project_budget', 'project_block'] } },
];

const CLEAN_CORDIS = `
- id: tool-subagent-coordinator
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: spawn
    toolName: subagent_coordinator
    toolFilter:
      allow: [project_advance, project_gate, project_budget, project_status, project_harvest, project_audit, role_list, role_show, flow_list, flow_show, subagent_architect, subagent_deliverer, subagent_dev, subagent_product, subagent_pm, subagent_tester, send_message, interrupt_agent, read, write, edit, glob, grep, todo_write, project_block]
- id: tool-subagent-dev
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: spawn
    toolName: subagent_dev
    toolFilter:
      allow: [read, write, edit, glob, grep, pwsh, todo_write, subagent_devhelper, send_message, project_budget, project_block]
- id: tool-subagent-pm
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: spawn
    toolName: subagent_pm
    toolFilter:
      allow: [read, glob, grep, write, todo_write, project_budget, project_block]
`;

// ── 解析 happy path ──────────────────────────────────────────────────────────
test('parseRolesAllow:合法 roles 清单 → Map<roleId, Set<tool>>;坏条目跳过', () => {
  const map = parseRolesAllow(CLEAN_ROLES);
  assert.equal(map.size, 3);
  assert.ok(map.get('coordinator').has('project_harvest'));
  assert.ok(map.get('dev').has('subagent_devhelper'));
  assert.ok(map.get('pm').has('project_budget'));
  // 坏条目(缺 id / 缺 tools.allow)跳过不炸。
  const withBad = parseRolesAllow([...CLEAN_ROLES, { tools: { allow: ['read'] } }, { id: 'x' }, null, 'str']);
  assert.equal(withBad.size, 3, '坏条目跳过');
});

test('parseCordisPerRoleAllow:合法 agent.cordis.yml 文本 → Map<toolName, Set<tool>>', () => {
  const map = parseCordisPerRoleAllow(CLEAN_CORDIS);
  assert.equal(map.size, 3);
  assert.ok(map.has('subagent_coordinator'));
  assert.ok(map.get('subagent_coordinator').has('project_harvest'));
  assert.ok(map.get('subagent_dev').has('subagent_devhelper'));
  assert.ok(map.get('subagent_pm').has('project_budget'));
  // 非字符串输入 → 空 Map(不炸)。
  assert.equal(parseCordisPerRoleAllow(undefined).size, 0);
  assert.equal(parseCordisPerRoleAllow(42).size, 0);
});

test('roleToolName / toolNameToRole 互逆', () => {
  assert.equal(roleToolName('coordinator'), 'subagent_coordinator');
  assert.equal(toolNameToRole('subagent_coordinator'), 'coordinator');
  assert.equal(toolNameToRole('subagent_dev'), 'dev');
});

// ── L1 vs L2 交叉核对(核心缺口)───────────────────────────────────────────────
test('checkL1vsL2:干净样本无漂移(happy path)', () => {
  const drifts = checkL1vsL2(parseRolesAllow(CLEAN_ROLES), parseCordisPerRoleAllow(CLEAN_CORDIS));
  assert.deepEqual(drifts, [], 'roles 与 per-role 行逐字一致 → 无漂移');
});

test('pm 角色纳入 toolface 审计网:roles allow 与 per-role 行一致(AC1,toolface-cross-layer-consistency)', () => {
  const rolesAllow = parseRolesAllow(CLEAN_ROLES);
  const cordisAllow = parseCordisPerRoleAllow(CLEAN_CORDIS);
  assert.ok(rolesAllow.has('pm'), 'roles 含 pm');
  assert.ok(cordisAllow.has('subagent_pm'), 'cordis 含 subagent_pm 行');
  const drifts = checkL1vsL2(rolesAllow, cordisAllow);
  assert.deepEqual(drifts, [], 'pm roles allow 与 per-role 行一致');
  // pm 白名单 ⊆ 真实工具面(L2vsL3 + L1vsL3)。
  assert.deepEqual(checkL2vsL3(cordisAllow, REAL_TOOL_SURFACE), [], 'pm 行工具 ∈ 真实面');
  assert.deepEqual(checkL1vsL3(rolesAllow, REAL_TOOL_SURFACE), [], 'pm roles 工具 ∈ 真实面');
});

test('checkL1vsL2:kr-p4-route 事故根因——roles allow 有 project_harvest 而 per-role 行没有', () => {
  // 从干净样本去掉 coordinator 行的 project_harvest(模拟事故前态)。
  const cordis = CLEAN_CORDIS.replace(
    'allow: [project_advance, project_gate, project_budget, project_status, project_harvest, project_audit,',
    'allow: [project_advance, project_gate, project_budget, project_status, project_audit,',
  );
  const drifts = checkL1vsL2(parseRolesAllow(CLEAN_ROLES), parseCordisPerRoleAllow(cordis));
  assert.equal(drifts.length, 1, '恰命中 1 处');
  const d = drifts[0];
  assert.equal(d.layerA, 'L1');
  assert.equal(d.layerB, 'L2');
  assert.equal(d.role, 'coordinator');
  assert.equal(d.tool, 'project_harvest');
  assert.equal(d.direction, 'real-missing');
  assert.match(d.detail, /kr-p4-route/);
});

test('checkL1vsL2:反向漂移——per-role 行有而 roles 没有(白名单授予未声明工具)', () => {
  // 给 dev 行加一个 roles 未声明的工具。
  const cordis = CLEAN_CORDIS.replace(
    'allow: [read, write, edit, glob, grep, pwsh, todo_write, subagent_devhelper, send_message, project_budget, project_block]',
    'allow: [read, write, edit, glob, grep, pwsh, todo_write, subagent_devhelper, send_message, project_budget, project_block, web_search]',
  );
  const drifts = checkL1vsL2(parseRolesAllow(CLEAN_ROLES), parseCordisPerRoleAllow(cordis));
  assert.equal(drifts.length, 1);
  assert.equal(drifts[0].role, 'dev');
  assert.equal(drifts[0].tool, 'web_search');
  assert.equal(drifts[0].direction, 'real-extra');
});

test('checkL1vsL2:角色无对应 per-role 行 → 整面漂移(real-missing)', () => {
  // 只保留 coordinator 行,dev 行缺失。
  const cordis = `
- id: tool-subagent-coordinator
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: spawn
    toolName: subagent_coordinator
    toolFilter:
      allow: [project_advance, project_gate, project_budget, project_status, project_harvest, project_audit, role_list, role_show, flow_list, flow_show, subagent_architect, subagent_deliverer, subagent_dev, subagent_product, subagent_tester, send_message, interrupt_agent, read, write, edit, glob, grep, todo_write, project_block]
`;
  const drifts = checkL1vsL2(parseRolesAllow(CLEAN_ROLES), parseCordisPerRoleAllow(cordis));
  // dev 行缺失 → dev 的每个 allow 工具都报 real-missing。
  const devDrifts = drifts.filter((d) => d.role === 'dev');
  assert.ok(devDrifts.length > 0, 'dev 行缺失 → dev 工具整面漂移');
  assert.ok(devDrifts.every((d) => d.direction === 'real-missing'));
  assert.ok(devDrifts.some((d) => d.tool === 'read'), 'dev 每个 allow 工具都报');
});

// ── L2 vs L3 / L1 vs L3 ─────────────────────────────────────────────────────
test('checkL2vsL3:白名单引用真实面不存在的工具 → declared-extra', () => {
  const cordis = CLEAN_CORDIS.replace(
    'allow: [read, write, edit, glob, grep, pwsh, todo_write, subagent_devhelper, send_message, project_budget, project_block]',
    'allow: [read, write, edit, glob, grep, pwsh, todo_write, subagent_devhelper, send_message, project_budget, project_block, web_fetch]',
  );
  const drifts = checkL2vsL3(parseCordisPerRoleAllow(cordis), REAL_TOOL_SURFACE);
  assert.equal(drifts.length, 1);
  assert.equal(drifts[0].role, 'dev');
  assert.equal(drifts[0].tool, 'web_fetch');
  assert.equal(drifts[0].direction, 'declared-extra');
});

test('checkL1vsL3:roles 引用真实面不存在的工具 → declared-extra', () => {
  const roles = [{ id: 'dev', tools: { allow: ['read', 'bash'] } }];
  const drifts = checkL1vsL3(parseRolesAllow(roles), REAL_TOOL_SURFACE);
  assert.equal(drifts.length, 1);
  assert.equal(drifts[0].tool, 'bash');
  assert.equal(drifts[0].direction, 'declared-extra');
});

test('checkForbidden:任何层引用禁用工具 → forbidden', () => {
  const roles = [{ id: 'dev', tools: { allow: ['read', 'subagent'] } }];
  const cordis = CLEAN_CORDIS.replace(
    'allow: [read, write, edit, glob, grep, pwsh, todo_write, subagent_devhelper, send_message, project_budget, project_block]',
    'allow: [read, write, edit, glob, grep, pwsh, todo_write, subagent_devhelper, send_message, project_budget, project_block, subagent_fork]',
  );
  const drifts = checkForbidden(parseRolesAllow(roles), parseCordisPerRoleAllow(cordis));
  assert.equal(drifts.length, 2, 'roles 层 subagent + cordis 层 subagent_fork 各一处');
  assert.ok(drifts.every((d) => d.direction === 'forbidden'));
});

// ── 统一入口 auditToolface ───────────────────────────────────────────────────
test('auditToolface:干净样本 ok:true 无漂移(happy path)', () => {
  const result = auditToolface({ roles: CLEAN_ROLES, cordisText: CLEAN_CORDIS });
  assert.equal(result.ok, true);
  assert.deepEqual(result.drifts, []);
  assert.equal(result.summary.total, 0);
  assert.deepEqual(result.summary.byPair, {});
  assert.ok(Array.isArray(result.freeze) && result.freeze.length > 0, '报告含 L4 冻结语义');
});

test('auditToolface:漂移样本逐类命中并聚合 byPair', () => {
  // 注入两类漂移:
  // ① kr-p4-route 类:roles 有 project_harvest 而 coordinator 行没有(L1vsL2 real-missing);
  // ② 白名单引用真实面不存在的工具:dev 行加 ghost_tool(roles 也声明,避免 real-extra 交叉;
  //    ghost_tool 不在 FORBIDDEN,避免 forbidden 交叉)→ L2vsL3 + L1vsL3 declared-extra。
  const roles = CLEAN_ROLES.map((r) =>
    r.id === 'dev' ? { ...r, tools: { allow: [...r.tools.allow, 'ghost_tool'] } } : r,
  );
  const cordis = CLEAN_CORDIS
    .replace('allow: [project_advance, project_gate, project_budget, project_status, project_harvest, project_audit,', 'allow: [project_advance, project_gate, project_budget, project_status, project_audit,')
    .replace('allow: [read, write, edit, glob, grep, pwsh, todo_write, subagent_devhelper, send_message, project_budget, project_block]', 'allow: [read, write, edit, glob, grep, pwsh, todo_write, subagent_devhelper, send_message, project_budget, project_block, ghost_tool]');
  const result = auditToolface({ roles, cordisText: cordis });
  assert.equal(result.ok, false);
  assert.equal(result.summary.total, 3, 'L1vsL2(project_harvest)+ L2vsL3(ghost_tool)+ L1vsL3(ghost_tool)');
  assert.equal(result.summary.byPair['L1vsL2'], 1, 'kr-p4-route 类漂移');
  assert.equal(result.summary.byPair['L2vsL3'], 1, '白名单引用不存在工具');
  assert.equal(result.summary.byPair['L1vsL3'], 1, 'roles 引用不存在工具');
  const l1l2 = result.drifts.find((d) => d.layerA === 'L1' && d.layerB === 'L2');
  assert.equal(l1l2.tool, 'project_harvest');
  const l2l3 = result.drifts.find((d) => d.layerA === 'L2' && d.layerB === 'L3');
  assert.equal(l2l3.tool, 'ghost_tool');
});

test('auditToolface:自定义 realSurface 生效(可注入运行时真实工具面)', () => {
  const custom = new Set(['read', 'write', 'project_budget']);
  const result = auditToolface({ roles: CLEAN_ROLES, cordisText: CLEAN_CORDIS, realSurface: custom });
  assert.equal(result.ok, false, '自定义真实面更小 → 大量漂移');
  assert.ok(result.drifts.some((d) => d.layerA === 'L2' && d.layerB === 'L3'), 'L2vsL3 漂移命中');
});

// ── L4 冻结语义文档化 ────────────────────────────────────────────────────────
test('TOOLFACE_FREEZE_SEMANTICS:文档化关键语义(AC1 冻结语义文档化)', () => {
  assert.ok(Array.isArray(TOOLFACE_FREEZE_SEMANTICS) && TOOLFACE_FREEZE_SEMANTICS.length >= 4);
  const joined = TOOLFACE_FREEZE_SEMANTICS.join('\n');
  assert.match(joined, /重 spawn/, '改白名单须重 spawn');
  assert.match(joined, /resume/, 'resume 不生效');
  assert.match(joined, /fork/, 'fork 携带 fork 行 toolFilter');
  assert.match(joined, /唯一承重路径/, '白名单唯一承重路径');
});

// ── 常量完整性 ──────────────────────────────────────────────────────────────
test('REAL_TOOL_SURFACE / FORBIDDEN 非空且互斥', () => {
  assert.ok(REAL_TOOL_SURFACE.size > 0);
  assert.ok(FORBIDDEN.length > 0);
  for (const f of FORBIDDEN) {
    assert.ok(!REAL_TOOL_SURFACE.has(f), `禁用工具 ${f} 不应在真实工具面`);
  }
});
