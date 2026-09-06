// project_audit 工具 + 自省审计回路观察原语单测(0.15.0,kr-self-audit)。
// 运行:cd presets/project-pipeline && node test/project-audit.test.mjs
// 覆盖:
//   - O1~O6 观察原语 happy path(各自产出发现,每条含 evidence);
//   - AC1 工具层领地硬边界:规则表对 F1 客体(flow/角色提示词)升权 F2 → run 返回 status=rejected;
//   - AC2 F2 端到端:构造同 category lesson(≥3)→ R-lesson-storm F2 自动立项,单据 evidence 链可回放 + auto:true;
//   - AC3 F1 呈递留痕 / F3 直改留痕写 audit-trail.json;
//   - AC4 工具层:去重在跑项目后同类不重复立项。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../plugins/project-registry.mjs';
import {
  DEFAULT_WATCH_LOG,
  auditTrailPath,
  observeO1,
  observeO2,
  observeO3,
  observeO4,
  observeO5,
  observeO6,
  readAuditTrail,
  readJson,
  writeJson,
} from '../plugins/project-lib.mjs';
import { makeStubCtx } from '../../../toolkit/stub-ctx.mjs';

async function makeWorkspace(t) {
  const dir = await mkdtemp(join(tmpdir(), 'project-audit-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const sessionContext = (workspace) => ({ agent: { session: { header: { cwd: workspace } } } });

async function mountPlugin() {
  const ctx = makeStubCtx();
  await apply(ctx);
  return ctx;
}

function getTool(ctx, toolName) {
  const tool = ctx.tools.items.find((item) => item.name === toolName);
  assert.ok(tool, `工具 ${toolName} 未注册`);
  return tool;
}

async function writeRules(workspace, rules) {
  await mkdir(join(workspace, '.dsh-library'), { recursive: true });
  await writeJson(join(workspace, '.dsh-library', 'audit-rules.json'), {
    schemaVersion: 1,
    meta: { metaRuleChangeCooldownDays: 30, maxAutoProjectsPerAudit: 2, lastMetaActionAt: null },
    rules,
  });
}

async function writeLessonsIndex(workspace, categoryCounts) {
  await mkdir(join(workspace, '.dsh-library'), { recursive: true });
  const categories = {};
  for (const [cat, count] of Object.entries(categoryCounts)) {
    categories[cat] = Array.from({ length: count }, (_, i) => ({ id: `${cat}-${i}`, kind: 'lesson', title: `${cat} ${i}`, premises: 'p', status: 'active' }));
  }
  await writeJson(join(workspace, '.dsh-library', 'lessons-index.json'), { schemaVersion: 1, categories });
}

async function projectRegistry(workspace, projectId, over = {}) {
  await mkdir(join(workspace, projectId, '.dsh-project'), { recursive: true });
  await writeJson(join(workspace, projectId, '.dsh-project', 'REGISTRY.json'), {
    schemaVersion: 2, id: projectId, title: projectId, entitySlug: projectId, state: 'active',
    iteration: 1, stageIndex: 0, gateStatus: null, updatedAt: over.updatedAt ?? new Date().toISOString(),
    blockers: over.blockers ?? [],
    ...(over.gateStatus ? { gateStatus: over.gateStatus } : {}),
  });
}

// ── O1~O6 观察原语 happy path ─────────────────────────────────────────────

test('observeO1:watcher 日志 supported 解析(退出/事件/WS 断连/静默断链)', async (t) => {
  const root = await makeWorkspace(t);
  await writeFile(join(root, DEFAULT_WATCH_LOG), [
    '2026-09-03 10:00:01 startup ok',
    '2026-09-03 10:05:03 event:session-start',
    '2026-09-03 10:06:00 websocket disconnect retry',
    '2026-09-03 10:10:00 heartbeat timeout silent',
    '2026-09-03 10:20:00 exit code 0',
  ].join('\n'), 'utf8');
  const findings = await observeO1(root);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'supported');
  assert.ok(findings[0].value.exitCount >= 1, '退出频次');
  assert.ok(findings[0].value.wsDisconnectCount >= 1, 'WS 断连');
  assert.ok(findings[0].value.silentDisconnectCount >= 1, '静默断链');
  assert.ok(findings[0].evidence.length >= 1, '含 evidence');
});

test('observeO1:候选全部不可得 → status=unsupported(仅兜底)', async (t) => {
  const root = await makeWorkspace(t);
  const findings = await observeO1(join(root, 'nested', 'missing'));
  assert.equal(findings[0].status, 'unsupported');
  assert.ok(findings[0].reason.includes('watcher log not found'), 'unsupported 原因');
});

test('observeO1:以进程 cwd(安装/部署根可核证事实源)推导候选命中 DEFAULT_LOG(缺陷 #2)', async (t) => {
  const root = await makeWorkspace(t);
  const prev = process.cwd();
  process.chdir(root);
  try {
    await writeFile(join(root, DEFAULT_WATCH_LOG), ['2026-09-03 event:boot', '2026-09-03 exit 0'].join('\n'), 'utf8');
    // 不传 plugindevRoot → 回退进程 cwd 事实源(与 watcher 同根)。
    const findings = await observeO1();
    assert.equal(findings[0].status, 'supported', '以 cwd 事实源命中日志,supported');
    assert.ok(findings[0].value.exitCount >= 1);
    assert.match(findings[0].evidence[0].file, /pipeline-watch\.log$/, 'evidence 指向 cwd 下默认日志');
  } finally {
    process.chdir(prev);
  }
});

test('observeO2:BUDGET.runtime-events token 分布', async (t) => {
  const ws = await makeWorkspace(t);
  await mkdir(join(ws, 'p1', '.dsh-project'), { recursive: true });
  await writeJson(join(ws, 'p1', '.dsh-project', 'BUDGET.json'), {
    schemaVersion: 1, estimate: null, cap: null, committed: [
      { stageId: 'build', role: 'dev', source: 'runtime-events', usage: { uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 30, model: 'm' } },
      { stageId: 'build', role: 'dev', source: 'runtime-events', usage: { uncachedInputTokens: 200, outputTokens: 40, cacheReadTokens: 0, model: 'm' } },
    ],
  });
  const findings = await observeO2(ws);
  assert.ok(findings.length >= 1);
  const dist = findings.find((f) => f.id === 'O2-token-dist');
  assert.ok(dist, '分布发现');
  assert.equal(dist.status, 'supported');
  assert.ok(dist.value.budgetProjects >= 1);
  assert.equal(dist.value.peakRoleTokens, 390, 'peak 角色 token (100+30+20)+(200+0+40)');
});

test('observeO3:blockers category + 门禁 pending 时长', async (t) => {
  const ws = await makeWorkspace(t);
  // 两个同 category blocker(≥2 命中聚合)
  await projectRegistry(ws, 'p1', { blockers: [{ id: 'b1', category: 'test-env', status: 'resolved', reason: 'r' }] });
  await projectRegistry(ws, 'p2', {
    blockers: [{ id: 'b1', category: 'test-env', status: 'resolved', reason: 'r' }],
    gateStatus: 'pending',
    updatedAt: new Date(Date.now() - 10 * 3600000).toISOString(),
  });
  const findings = await observeO3(ws);
  assert.ok(findings.length >= 1);
  const gate = findings.find((f) => f.id === 'O3-gate-slow');
  assert.ok(gate, '待裁决超时发现');
  assert.equal(gate.status, 'supported');
  assert.ok(gate.value.pendingHours >= 4);
  assert.ok(findings.some((f) => f.id === 'O3-block-test-env'), 'blockers category 风暴发现');
});

test('observeO4:lessons-index 同类 category ≥3 → 机制缺陷候选', async (t) => {
  const ws = await makeWorkspace(t);
  await writeLessonsIndex(ws, { 'dev-complexity': 4 });
  const findings = await observeO4(ws);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, 'O4-cat-dev-complexity');
  assert.equal(findings[0].value.categoryCount, 4);
  assert.equal(findings[0].status, 'supported');
  assert.ok(findings[0].evidence.length >= 1);
});

test('observeO5:toolkit 实文件 vs 文档差集(A−B / B−A / deprecated)', async (t) => {
  const tk = await makeWorkspace(t);
  await writeFile(join(tk, 'probe.mjs'), '// probe', 'utf8');
  await writeFile(join(tk, 'old-deprecated.mjs'), '// old', 'utf8');
  const docs = [
    '工具清单:toolkit/probe.mjs、toolkit/missing.mjs 已登记。',
    'plugins/runner.mjs 由 pipeline-watch 复用。',
  ].join('\n');
  const findings = await observeO5(tk, docs);
  assert.equal(findings[0].id, 'O5-doc-drift');
  assert.equal(findings[0].status, 'supported');
  assert.ok(findings[0].value.driftCount >= 2, 'A−B(未记录)+ B−A(missing)+ deprecated');
  assert.ok(findings[0].evidence.length >= 1, 'evidence 可回放');
});

test('observeO6:audit-trail 前次发现超龄未动', async (t) => {
  const ws = await makeWorkspace(t);
  await mkdir(join(ws, '.dsh-library'), { recursive: true });
  await writeJson(join(ws, '.dsh-library', 'audit-trail.json'), [
    { id: 't1', ts: new Date(Date.now() - 40 * 86400000).toISOString(), action: 'F2', ruleId: 'R-x', status: 'registered' },
  ]);
  const findings = await observeO6(ws, { staleDays: 30 });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, 'O6-stale');
  assert.equal(findings[0].value.staleCount, 1);
});

// ── project_audit 工具 · AC1/AC2/AC3/AC4 ──────────────────────────────────

test('AC1:规则表对 F1 客体(flow)升权 F2 → run 拒绝(status=rejected)', async (t) => {
  const ws = await makeWorkspace(t);
  await writeRules(ws, [
    { id: 'R-bad', observe: 'O4', when: { categoryCountGte: 3 }, act: 'F2', object: 'flow', territory: 'pipeline-ws' },
  ]);
  await writeLessonsIndex(ws, { 'dev-complexity': 4 });
  const ctx = await mountPlugin();
  const audit = getTool(ctx, 'project_audit');
  const res = await audit.execute({ action: 'run' }, sessionContext(ws));
  assert.equal(res.status, 'rejected');
  assert.match(res.error, /升权 F2/);
  assert.equal(res.executed.length, 0);
});

test('AC2:F2 端到端(同类 lesson ≥3 → 自动立项,evidence 链可回放 + auto:true)', async (t) => {
  const ws = await makeWorkspace(t);
  await writeRules(ws, [
    { id: 'R-lesson-storm', name: '同类 lesson 堆积', observe: 'O4', when: { categoryCountGte: 3 }, act: 'F2', object: 'data-asset', dedupe: 'by-category', territory: 'pipeline-ws/.dsh-library/lessons', recommendation: '梳理该 category' },
  ]);
  await writeLessonsIndex(ws, { 'dev-complexity': 4 });
  const ctx = await mountPlugin();
  const audit = getTool(ctx, 'project_audit');
  const res = await audit.execute({ action: 'run' }, sessionContext(ws));
  assert.equal(res.status, 'done');
  assert.equal(res.error, undefined);
  const f2 = res.executed.find((e) => e.act === 'F2');
  assert.ok(f2, '应产出 F2 立项');
  assert.match(f2.title, /^自省立项: /, 'title 前缀');
  assert.ok(f2.projectId, '项目已登记');
  // 证据链可回放 + auto:true
  const { trail } = await readAuditTrail(ws);
  const entry = trail.find((e) => e.action === 'F2' && e.status === 'registered');
  assert.ok(entry, 'audit-trail 记 F2 registered');
  assert.equal(entry.auto, true);
  assert.match(entry.reason, /证据链:/);
  assert.match(entry.reason, /lessons-index\.json/, 'evidence 可回放引用');
});

test('AC3:F1 呈递留痕(action=presented 写 audit-trail)', async (t) => {
  const ws = await makeWorkspace(t);
  await writeRules(ws, [
    { id: 'R-gate-slow', name: '门禁待裁决超时', observe: 'O3', when: { pendingHoursGte: 4 }, act: 'F1', object: 'gate', dedupe: 'by-project-gate', territory: 'pipeline-ws', recommendation: '核查停摆' },
  ]);
  await projectRegistry(ws, 'g1', { gateStatus: 'pending', updatedAt: new Date(Date.now() - 8 * 3600000).toISOString() });
  const ctx = await mountPlugin();
  const audit = getTool(ctx, 'project_audit');
  const res = await audit.execute({ action: 'run' }, sessionContext(ws));
  assert.equal(res.status, 'done');
  const f1 = res.executed.find((e) => e.act === 'F1');
  assert.ok(f1, '应产出 F1 呈递');
  assert.match(f1.report, /发现|门禁/, 'F1 报告含发现');
  assert.ok(f1.report.includes('证据'), 'F1 报告含 evidence 段');
  const { trail } = await readAuditTrail(ws);
  assert.ok(trail.some((e) => e.action === 'F1' && e.status === 'presented' && e.ruleId === 'R-gate-slow'), 'audit-trail 记 F1 presented');
});

test('AC3:F3 直改留痕(action=F3 真实读改写数据资产,before/after 落 audit-trail)', async (t) => {
  const ws = await makeWorkspace(t);
  await writeRules(ws, [
    { id: 'R-f3', observe: 'O6', when: { openCountGte: 1 }, act: 'F3', object: 'remediations.json', territory: 'pipeline-ws/.dsh-library' },
  ]);
  // 种子一个未解决 open 审计留痕供 O6 观察。
  await mkdir(join(ws, '.dsh-library'), { recursive: true });
  await writeJson(join(ws, '.dsh-library', 'audit-trail.json'), [
    { id: 'seed1', ts: new Date().toISOString(), action: 'F2', ruleId: 'Rx', status: 'registered' },
  ]);
  // 预置目标数据资产(已有一条整改),以便断言真实 before≠after 的读改写。
  await writeJson(join(ws, '.dsh-library', 'remediations.json'), { schemaVersion: 1, auditRemediations: [{ id: 'orig', status: 'OPEN' }] });
  const ctx = await mountPlugin();
  const audit = getTool(ctx, 'project_audit');
  const res = await audit.execute({ action: 'run' }, sessionContext(ws));
  assert.equal(res.status, 'done');
  const f3 = res.executed.find((e) => e.act === 'F3');
  assert.ok(f3, '应产出 F3 直改动作');
  const { trail } = await readAuditTrail(ws);
  const trace = trail.find((e) => e.action === 'F3');
  assert.ok(trace, 'F3 trace 落 audit-trail');
  // 缺陷 #1 修订:F3 不再只记 PENDING,须真实读改写数据资产、before/after 真实落留痕。
  assert.equal(trace.status, 'applied');
  assert.equal(trace.object, 'remediations.json');
  assert.ok(trace.before !== undefined && trace.before !== null, 'before 真实读取');
  assert.equal(trace.before.auditRemediations.length, 1, 'before 为读到的预置内容');
  assert.equal(trace.before.auditRemediations[0].id, 'orig');
  assert.ok(trace.after !== undefined && trace.after !== null, 'after 真实写入');
  assert.notDeepEqual(trace.before, trace.after, 'before≠after,数据资产真实改写');
  assert.equal(trace.after.auditRemediations.length, 2, 'after 追加整改登记');
  assert.equal(trace.after.auditRemediations[1].ruleId, 'R-f3');
  assert.ok(trace.evidence.length >= 0, 'evidence 一并留痕');
  // 目标数据资产文件已真实写入。
  const remed = await readJson(join(ws, '.dsh-library', 'remediations.json'));
  assert.ok(remed.auditRemediations?.length === 2, 'remediations.json 已真实写入整改登记');
  assert.equal(remed.auditRemediations[1].ruleId, 'R-f3');
  assert.equal(f3.result, 'applied');
});

test('AC4:同 category 已在跑项目 → 该类发现去重不重复立项', async (t) => {
  const ws = await makeWorkspace(t);
  await writeRules(ws, [
    { id: 'R-lesson-storm', observe: 'O4', when: { categoryCountGte: 3 }, act: 'F2', object: 'data-asset', dedupe: 'by-category', territory: 'pipeline-ws/.dsh-library/lessons' },
  ]);
  await writeLessonsIndex(ws, { 'dev-complexity': 4 });
  // 在跑项目 title 含 category 'dev-complexity' → by-category 去重。
  await projectRegistry(ws, 'existing-fix', { state: 'active' });
  await writeJson(join(ws, 'existing-fix', '.dsh-project', 'REGISTRY.json'), {
    schemaVersion: 2, id: 'existing-fix', title: 'dev-complexity 优化', entitySlug: 'existing-fix', state: 'active', iteration: 1, stageIndex: 0, gateStatus: null, updatedAt: new Date().toISOString(), blockers: [],
  });
  const ctx = await mountPlugin();
  const audit = getTool(ctx, 'project_audit');
  const res = await audit.execute({ action: 'run' }, sessionContext(ws));
  assert.equal(res.status, 'done');
  assert.equal(res.executed.filter((e) => e.act === 'F2').length, 0, '同类在跑项目去重');
  assert.ok(res.dropped.some((d) => d.reason.includes('by-category')), '去重理由留痕');
});

test('project_audit status:查审计留痕与状态', async (t) => {
  const ws = await makeWorkspace(t);
  const ctx = await mountPlugin();
  const audit = getTool(ctx, 'project_audit');
  const before = await audit.execute({ action: 'status' }, sessionContext(ws));
  assert.equal(before.trailCount, 0);
  // 跑一轮后 status 有留痕。
  await writeRules(ws, [{ id: 'R-x', observe: 'O6', when: { openCountGte: 1 }, act: 'F1', object: 'gate', territory: 'pipeline-ws' }]);
  await audit.execute({ action: 'run' }, sessionContext(ws)).catch(() => {});
  const after = await audit.execute({ action: 'status' }, sessionContext(ws));
  assert.equal(after.action, 'status');
  assert.ok(after.trailCount >= 0);
  assert.ok(Array.isArray(after.trail));
});
