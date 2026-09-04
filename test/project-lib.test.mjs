// project-lib 纯库单测(机制1 既定裁决库 + 机制2 失败模式聚合 + 0.8.0 真实 token 计量)。运行:
//   cd presets/project-pipeline && node test/project-lib.test.mjs
// 打法:os.tmpdir 下 mkdtemp 临时 workspace(自建自清),直接驱动纯函数。
// 覆盖:validateRulings(结构合法/非法)、readRulings(读/缺失/坏 JSON)、
// matchRuling(命中判据=前提一致才命中)、collectAllBlockers(扫 sibling REGISTRY
// 含 delivered)、aggregateByCategory(同 category ≥2 计数)、buildFailureReport(四要素)。
// 0.8.0 新增:readProjcache(守卫 unit.version)、sessionTokenUsage(有效计费口径)、
// aggregateByRole(按角色桶聚合)。
// 0.10.0 新增(P1 底座):entitySlugOf / baseDossierPaths / baseDossierExists /
// validateReadings / expandReadings / compileReadingsHeader / MAX_COMPILED_PERSONA。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BLOCKER_CATEGORIES,
  MAX_COMPILED_PERSONA,
  aggregateByCategory,
  aggregateByModel,
  aggregateByRole,
  baseDossierExists,
  baseDossierPaths,
  cacheRate,
  buildFailureReport,
  collectAllBlockers,
  compileReadingsHeader,
  entityConflictActive,
  entitySlugOf,
  entityTouchpoint,
  expandReadings,
  matchRuling,
  modelLabel,
  normalizeUsage,
  readProjcache,
  readRulings,
  sessionTokenUsage,
  totalToken,
  validateReadings,
  validateRulings,
  writeJson,
  DEFAULT_AUDIT_META,
  auditDedupe,
  auditRateLimit,
  auditRuleEngine,
  auditRulesPath,
  auditTerritoryWhitelist,
  auditTrailPath,
  buildF1Payload,
  buildF2Payload,
  buildF3Payload,
  evidenceChain,
  readAuditRules,
  readAuditTrail,
  readJsonRetry,
  territoryInWhitelist,
  validateAuditRules,
  whenMatches,
} from '../plugins/project-lib.mjs';

// ── 桩具 ────────────────────────────────────────────────────────────────────

/** 临时 workspace(os.tmpdir 下,测试结束自清)。 */
async function makeWorkspace(t) {
  const dir = await mkdtemp(join(tmpdir(), 'project-lib-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** 种子裁决库(与 .dsh-library/rulings.json 同构)。 */
const SEED_RULINGS = {
  schemaVersion: 1,
  rulings: [
    {
      id: 'r1',
      category: 'acceptance-capability',
      premise: '验收对象为视觉/真实观感类(有视觉产物且流水线角色无浏览器无视觉)',
      conclusion: '该验收必须由用户侧 blocking 执行,设为交付前必经停摆门禁,不得排为交付后事项',
      means: '截图 + 视觉模型/DOM 双核验;流水线角色只做代码层/解析器逻辑层验证',
    },
    {
      id: 'r2',
      category: 'deploy-permission',
      premise: '触点含 pipeline-ws 外路径(生产源码/部署副本)',
      conclusion: '交付落 deliverables/ + APPLY.md,由用户侧主线程原位应用并独立验证',
      means: 'sandbox-deliverables-handover:明确报告、不反复重试、不自我提权',
    },
    {
      id: 'r3',
      category: 'deploy-permission',
      premise: '改动涉及 preset/宿主插件(需部署到部署副本)',
      conclusion: '必须 deploy 至 IN SYNC + 重启;重启窗口并入攒批',
      means: '部署自检(读 .plugindev-deploy.json + 对照 git HEAD);重启决策规则',
    },
    {
      id: 'r4',
      category: 'test-env',
      premise: '验证依赖真实上游/凭据/夜间无人值守自动执行',
      conclusion: '该验证必须由用户侧 blocking 执行',
      means: '真实会话/真实实验由用户侧执行;流水线角色只做静态/单测核对',
    },
  ],
};

/** 往 workspace 写一份裁决库。 */
async function writeRulings(workspace, value) {
  await mkdir(join(workspace, '.dsh-library'), { recursive: true });
  await writeJson(join(workspace, '.dsh-library', 'rulings.json'), value);
}

/** 往 workspace 写一个 sibling 项目 REGISTRY(带 blockers)。 */
async function writeSiblingRegistry(workspace, projectId, blockers) {
  await mkdir(join(workspace, projectId, '.dsh-project'), { recursive: true });
  await writeJson(join(workspace, projectId, '.dsh-project', 'REGISTRY.json'), {
    schemaVersion: 1,
    id: projectId,
    title: projectId,
    state: 'active',
    iteration: 1,
    stageIndex: 0,
    gateStatus: null,
    blockers,
  });
}

// ── 机制1 既定裁决库 ───────────────────────────────────────────────────────

test('validateRulings:合法裁决库通过(AC-m1-t1)', () => {
  const checked = validateRulings(SEED_RULINGS);
  assert.equal(checked.ok, true);
  assert.equal(checked.value.rulings.length, 4);
});

test('validateRulings:结构非法拒绝(缺字段/坏 category/未知键/重复 id)', () => {
  assert.equal(validateRulings({ schemaVersion: 1, rulings: [] }).ok, false, '空 rulings');
  assert.equal(validateRulings({ schemaVersion: 2, rulings: SEED_RULINGS.rulings }).ok, false, 'schemaVersion≠1');
  assert.equal(validateRulings({ schemaVersion: 1, rulings: SEED_RULINGS.rulings, wat: 1 }).ok, false, '未知顶层键');
  assert.equal(validateRulings('x').ok, false, '非对象');
  // 缺 conclusion
  const noConclusion = {
    schemaVersion: 1,
    rulings: [{ id: 'x', category: 'other', premise: 'p', means: 'm' }],
  };
  assert.equal(validateRulings(noConclusion).ok, false, '缺 conclusion');
  // 坏 category
  const badCat = {
    schemaVersion: 1,
    rulings: [{ id: 'x', category: 'wat', premise: 'p', conclusion: 'c', means: 'm' }],
  };
  assert.equal(validateRulings(badCat).ok, false, 'category 不在白名单');
  // 未知键
  const unknownKey = {
    schemaVersion: 1,
    rulings: [{ id: 'x', category: 'other', premise: 'p', conclusion: 'c', means: 'm', extra: 1 }],
  };
  assert.equal(validateRulings(unknownKey).ok, false, '裁决条目未知键');
  // 重复 id
  const dup = {
    schemaVersion: 1,
    rulings: [
      { id: 'x', category: 'other', premise: 'p', conclusion: 'c', means: 'm' },
      { id: 'x', category: 'other', premise: 'p2', conclusion: 'c2', means: 'm2' },
    ],
  };
  assert.equal(validateRulings(dup).ok, false, '重复 id');
});

test('readRulings:读 workspace 裁决库返回 rulings(AC-m1-t1)', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeRulings(workspace, SEED_RULINGS);
  const result = await readRulings(workspace);
  assert.equal(result.error, undefined);
  assert.equal(result.rulings.length, 4);
  assert.equal(result.rulings[0].id, 'r1');
});

test('readRulings:缺失/坏 JSON/结构非法 → { rulings: [], error }(不炸调用方)', async (t) => {
  const workspace = await makeWorkspace(t);
  const missing = await readRulings(workspace);
  assert.deepEqual(missing.rulings, []);
  assert.ok(missing.error, '缺失应带 error');
  // 坏 JSON
  await mkdir(join(workspace, '.dsh-library'), { recursive: true });
  await writeFile(join(workspace, '.dsh-library', 'rulings.json'), '{oops', 'utf8');
  const bad = await readRulings(workspace);
  assert.deepEqual(bad.rulings, []);
  assert.ok(bad.error, '坏 JSON 应带 error');
  // 结构非法(空 rulings)
  await writeJson(join(workspace, '.dsh-library', 'rulings.json'), { schemaVersion: 1, rulings: [] });
  const invalid = await readRulings(workspace);
  assert.deepEqual(invalid.rulings, []);
  assert.ok(invalid.error, '结构非法应带 error');
});

test('matchRuling:同 category 且前提一致才命中;前提不一致/无匹配 → undefined(AC-m1-r3)', () => {
  const rulings = SEED_RULINGS.rulings;
  // 命中 r1:视觉类验收,前提一致
  const hit = matchRuling(rulings, {
    category: 'acceptance-capability',
    premise: '验收对象为视觉/真实观感类(有视觉产物且流水线角色无浏览器无视觉)',
  });
  assert.equal(hit?.id, 'r1');
  // 同 category 但前提不一致(无视觉产物)→ 不命中
  const miss = matchRuling(rulings, {
    category: 'acceptance-capability',
    premise: '验收对象为纯逻辑函数,无视觉产物',
  });
  assert.equal(miss, undefined, '前提不成立则命中失效');
  // 不同 category → 不命中
  const wrongCat = matchRuling(rulings, {
    category: 'test-env',
    premise: '验收对象为视觉/真实观感类(有视觉产物且流水线角色无浏览器无视觉)',
  });
  assert.equal(wrongCat, undefined, 'category 不同不命中');
  // 空数组 / 缺参 → undefined
  assert.equal(matchRuling([], { category: 'other', premise: 'x' }), undefined);
  assert.equal(matchRuling(rulings, { category: 'other' }), undefined);
});

// ── 机制2 失败模式聚合 ───────────────────────────────────────────────────────

test('collectAllBlockers:扫全部 sibling REGISTRY(含 delivered)收集 blockers(AC-m2-a1)', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeSiblingRegistry(workspace, 'proj-a', [
    { id: 'b1', category: 'acceptance-capability', reason: '视觉验收需浏览器', status: 'open' },
  ]);
  await writeSiblingRegistry(workspace, 'proj-b', [
    { id: 'b1', category: 'acceptance-capability', reason: '视觉验收需浏览器', status: 'resolved' },
    { id: 'b2', category: 'deploy-permission', reason: '沙箱写不进外部', status: 'open' },
  ]);
  // delivered 项目也参与
  await writeSiblingRegistry(workspace, 'proj-c', [
    { id: 'b1', category: 'test-env', reason: '无真实上游', status: 'resolved' },
  ]);
  // 非项目目录 / 坏登记簿跳过
  await mkdir(join(workspace, 'not-a-project'), { recursive: true });
  await mkdir(join(workspace, 'bad-proj', '.dsh-project'), { recursive: true });
  await writeFile(join(workspace, 'bad-proj', '.dsh-project', 'REGISTRY.json'), '{bad', 'utf8');

  const blockers = await collectAllBlockers(workspace);
  assert.equal(blockers.length, 4);
  const ids = blockers.map((b) => `${b.projectId}/${b.blocker.id}`).sort();
  assert.deepEqual(ids, ['proj-a/b1', 'proj-b/b1', 'proj-b/b2', 'proj-c/b1']);
});

test('aggregateByCategory:同 category ≥2 计数,取代表案例(AC-m2-a2)', () => {
  const blockers = [
    { projectId: 'a', blocker: { id: 'b1', category: 'acceptance-capability', reason: '视觉验收需浏览器' } },
    { projectId: 'b', blocker: { id: 'b1', category: 'acceptance-capability', reason: '视觉验收需浏览器' } },
    { projectId: 'c', blocker: { id: 'b1', category: 'deploy-permission', reason: '沙箱写不进外部' } },
    { projectId: 'd', blocker: { id: 'b1', category: 'test-env', reason: '无真实上游' } },
  ];
  const agg = aggregateByCategory(blockers);
  assert.equal(agg.length, 1, '仅 acceptance-capability 计数≥2');
  assert.equal(agg[0].category, 'acceptance-capability');
  assert.equal(agg[0].count, 2);
  assert.equal(agg[0].cases.length, 2);
  assert.equal(agg[0].cases[0].projectId, 'a');
  assert.equal(agg[0].cases[0].blockerId, 'b1');
  assert.ok(agg[0].cases[0].reason.length > 0);
});

test('buildFailureReport:四要素报告(类别/次数/代表案例/机制项建议)(AC-m2-a2)', () => {
  const agg = [
    {
      category: 'acceptance-capability',
      count: 2,
      cases: [{ projectId: 'a', blockerId: 'b1', reason: '视觉验收需浏览器' }],
    },
    {
      category: 'deploy-permission',
      count: 3,
      cases: [{ projectId: 'b', blockerId: 'b1', reason: '沙箱写不进外部' }],
    },
  ];
  const report = buildFailureReport(agg);
  assert.equal(report.length, 2);
  assert.equal(report[0].category, 'acceptance-capability');
  assert.equal(report[0].count, 2);
  assert.equal(report[0].cases[0].projectId, 'a');
  assert.ok(report[0].advice.includes('用户侧 blocking'), 'acceptance-capability 建议映射到用户侧 blocking');
  assert.equal(report[1].category, 'deploy-permission');
  assert.ok(report[1].advice.includes('deliverables'), 'deploy-permission 建议映射到 deliverables+APPLY');
});

test('BLOCKER_CATEGORIES 白名单与 project-registry 对齐', () => {
  assert.deepEqual(BLOCKER_CATEGORIES, [
    'design-info',
    'dev-complexity',
    'test-env',
    'deploy-permission',
    'acceptance-capability',
    'other',
  ]);
});

// ── 0.8.0 真实 token 计量:readProjcache / sessionTokenUsage / aggregateByRole ──

/** 构造一份合法 projcache(unit.version=3)。 */
function makeProjcache(sessions) {
  return {
    unit: { version: 3 },
    tables: {
      sessions: Object.fromEntries(
        Object.entries(sessions).map(([sid, totals]) => [
          sid,
          { rows: { tokenUsage: { val: { totals } } } },
        ]),
      ),
    },
  };
}

test('readProjcache:合法 version=3 返回 data + mtime(AC-M3)', async (t) => {
  const workspace = await makeWorkspace(t);
  const file = join(workspace, 'projcache.json');
  await writeJson(file, makeProjcache({ s1: { uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 } }));
  const result = await readProjcache(file);
  assert.equal(result.data.unit.version, 3);
  assert.equal(result.data.tables.sessions.s1.rows.tokenUsage.val.totals.uncachedInputTokens, 100);
  assert.ok(typeof result.mtime === 'string' && result.mtime.length > 0, 'mtime 应为 ISO 串');
});

test('readProjcache:unit.version 缺失或 ≠3 → 中文报错,不误解析(AC-M3)', async (t) => {
  const workspace = await makeWorkspace(t);
  // version=2
  const v2 = join(workspace, 'v2.json');
  await writeJson(v2, { unit: { version: 2 }, tables: {} });
  await assert.rejects(() => readProjcache(v2), /版本不支持.*仅支持 3/);
  // 缺 unit
  const noUnit = join(workspace, 'no-unit.json');
  await writeJson(noUnit, { tables: {} });
  await assert.rejects(() => readProjcache(noUnit), /版本不支持/);
  // 缺 version
  const noVer = join(workspace, 'no-ver.json');
  await writeJson(noVer, { unit: {}, tables: {} });
  await assert.rejects(() => readProjcache(noVer), /版本不支持/);
});

test('readProjcache:文件缺失/坏 JSON → 中文报错', async (t) => {
  const workspace = await makeWorkspace(t);
  await assert.rejects(() => readProjcache(join(workspace, 'missing.json')), /读取 projcache 失败/);
  const bad = join(workspace, 'bad.json');
  await writeFile(bad, '{oops', 'utf8');
  await assert.rejects(() => readProjcache(bad), /不是合法 JSON/);
});

test('sessionTokenUsage:会话在表内返回四桶;不在表内/结构缺失 → null', () => {
  const projcache = makeProjcache({
    s1: { uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
  });
  const usage = sessionTokenUsage(projcache, 's1');
  assert.deepEqual(usage, { uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 });
  assert.equal(sessionTokenUsage(projcache, 'ghost'), null, '会话不在表内 → null');
  assert.equal(sessionTokenUsage(null, 's1'), null);
  assert.equal(sessionTokenUsage({ tables: {} }, 's1'), null);
});

test('aggregateByRole:按角色桶聚合,会话不在 projcache 表内跳过;桶含 cacheRead/cacheWrite/model 溯源位', () => {
  const projcache = makeProjcache({
    s1: { uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 10 },
    s2: { uncachedInputTokens: 200, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 },
    s3: { uncachedInputTokens: 50, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
  });
  const sessions = {
    s1: { role: 'coordinator' },
    s2: { role: 'dev' },
    s3: { role: 'dev' },
    ghost: { role: 'dev' }, // 不在 projcache 表内 → 跳过
  };
  const buckets = aggregateByRole(sessions, projcache);
  assert.deepEqual(buckets, {
    coordinator: { tokens: 120, uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 10, sessionCount: 1, model: 'unknown', provider: null },
    dev: { tokens: 285, uncachedInputTokens: 250, outputTokens: 35, cacheReadTokens: 0, cacheWriteTokens: 0, sessionCount: 2, model: 'unknown', provider: null },
  });
  assert.equal(buckets.dev.sessionCount, 2, 'ghost 会话被跳过,不计数');
});

test('aggregateByRole:model 溯源 carry-forward——同 role 多 session 不同 model 连接为多标签,无溯源 → unknown', () => {
  const projcache = makeProjcache({
    s1: { uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
    s2: { uncachedInputTokens: 200, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 },
    s3: { uncachedInputTokens: 50, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
  });
  const sessions = { s1: { role: 'dev' }, s2: { role: 'dev' }, s3: { role: 'tester' } };
  // s1/s2 均为 dev 但 model 不同 → dev 桶多标签 'A/B';s3 tester 无溯源 → 'unknown'。
  const buckets = aggregateByRole(sessions, projcache, { bySession: {
    s1: { model: 'deepseek-r1', provider: 'ollama-cloud' },
    s2: { model: 'gpt-4o', provider: 'openai' },
  } });
  assert.equal(buckets.dev.model, 'deepseek-r1/gpt-4o', '多模型以 / 连接');
  assert.equal(buckets.dev.provider, 'ollama-cloud/openai');
  assert.equal(buckets.dev.cacheReadTokens, 0);
  assert.equal(buckets.tester.model, 'unknown', '无溯源 → unknown');
  assert.equal(buckets.tester.provider, null);
});

test('aggregateByRole:空/非法输入 → 空对象', () => {
  assert.deepEqual(aggregateByRole(null, {}), {});
  assert.deepEqual(aggregateByRole({}, {}), {});
  assert.deepEqual(aggregateByRole({ s1: { role: 'dev' } }, null), {});
});

// ── 0.10.0 实体仓底座 + role readings(P1)────────────────────────────────

test('MAX_COMPILED_PERSONA = 1000(C4a:头+正文合计)', () => {
  assert.equal(MAX_COMPILED_PERSONA, 1000);
});

test('entitySlugOf:缺省=项目自身;有 entitySlug 时返回之(legacy 兼容)', () => {
  assert.equal(entitySlugOf({ id: 'proj-a' }), 'proj-a', '无 entitySlug → 项目自身');
  assert.equal(entitySlugOf({ id: 'proj-a', entitySlug: 'shared-entity' }), 'shared-entity');
  assert.equal(entitySlugOf({ id: 'proj-a', entitySlug: '' }), 'proj-a', '空 entitySlug → 项目自身');
  assert.equal(entitySlugOf(null), undefined);
  assert.equal(entitySlugOf({}), undefined);
});

test('baseDossierPaths:布局与 entitySlug 卫兵(含分隔符/.. 拒绝)', () => {
  const root = join('ws-root');
  const paths = baseDossierPaths(root, 'my-entity');
  assert.equal(paths.baseDir, join(root, '.dsh-base', 'my-entity'));
  assert.equal(paths.mapFile, join(root, '.dsh-base', 'my-entity', 'MAP.md'));
  assert.equal(paths.decisionsFile, join(root, '.dsh-base', 'my-entity', 'DECISIONS.md'));
  assert.equal(paths.runbookFile, join(root, '.dsh-base', 'my-entity', 'RUNBOOK.md'));
  assert.equal(paths.stateFile, join(root, '.dsh-base', 'my-entity', 'STATE.md'));
  for (const bad of ['../evil', 'a/b', 'a\\b', '..', '.', 'x y', '-lead', '']) {
    assert.throws(() => baseDossierPaths(root, bad), /entitySlug/, `entitySlug ${JSON.stringify(bad)} 应被拒绝`);
  }
});

test('baseDossierExists:以 STATE.md 存在为准', async (t) => {
  const workspace = await makeWorkspace(t);
  assert.equal(await baseDossierExists(workspace, 'my-entity'), false, '无底座 → false');
  await mkdir(join(workspace, '.dsh-base', 'my-entity'), { recursive: true });
  await writeFile(join(workspace, '.dsh-base', 'my-entity', 'STATE.md'), '# 状态\n', 'utf8');
  assert.equal(await baseDossierExists(workspace, 'my-entity'), true, '有 STATE.md → true');
});

test('entityConflictActive:同 entity active 并行 → conflict=true(冲突信号,不静默)', () => {
  const candidate = 'shared-entity';
  const registries = [
    { id: 'a', state: 'active', entitySlug: 'shared-entity' },
    { id: 'b', state: 'active', entitySlug: 'other' },
  ];
  const out = entityConflictActive(candidate, registries);
  assert.equal(out.conflict, true);
  assert.equal(out.conflicts.length, 1);
  assert.equal(out.conflicts[0].projectId, 'a');
  assert.equal(out.conflicts[0].entitySlug, 'shared-entity');
});

test('entityConflictActive:不同 entity active → conflict=false(放行)', () => {
  const registries = [
    { id: 'a', state: 'active', entitySlug: 'ent-a' },
    { id: 'b', state: 'active', entitySlug: 'ent-b' },
  ];
  assert.equal(entityConflictActive('ent-c', registries).conflict, false, '候选 entity 无冲突');
  assert.deepEqual(entityConflictActive('ent-c', registries).conflicts, []);
});

test('entityConflictActive:parked→active 同 entity 冲突拒绝(parked 登记不构成冲突但激活会拦)', () => {
  // 已有一个 active entity=shared-entity;候选要激活的 entity 相同 → 冲突。
  const registries = [
    { id: 'live', state: 'active', entitySlug: 'shared-entity' },
    { id: 'queued', state: 'parked', entitySlug: 'shared-entity' },
  ];
  const out = entityConflictActive('shared-entity', registries);
  assert.equal(out.conflict, true, 'queued(parked)激活会因 active 冲突被拦');
  assert.equal(out.conflicts.length, 1);
  assert.equal(out.conflicts[0].projectId, 'live');
});

test('entityConflictActive:legacy(无 entitySlug 缺省=自身)天然互异、不冲突(R3 回归)', () => {
  const registries = [
    { id: 'legacy-a', state: 'active' },
    { id: 'legacy-b', state: 'active' },
  ];
  // 新登记候选 projectId 唯一(如 'legacy-c'),不会匹配任何 legacy 项目自身 id → 不冲突。
  assert.equal(entityConflictActive('legacy-c', registries).conflict, false, '新 id 候选不冲突');
  assert.deepEqual(entityConflictActive('legacy-c', registries).conflicts, []);
  // 纯函数为比较语义:候选若与某 active 项目自身 id 相同(注册流程 id 唯一不会触发)则判冲突。
  const self = entityConflictActive('legacy-a', registries);
  assert.equal(self.conflict, true);
  assert.equal(self.conflicts[0].projectId, 'legacy-a');
});

test('entityConflictActive:空/非法候选或注册表 → conflict=false(不炸)', () => {
  assert.deepEqual(entityConflictActive('', [{ id: 'a', state: 'active', entitySlug: 'x' }]), { conflict: false, conflicts: [] });
  assert.deepEqual(entityConflictActive(null, [{ id: 'a', state: 'active', entitySlug: 'x' }]), { conflict: false, conflicts: [] });
  assert.deepEqual(entityConflictActive('x', null), { conflict: false, conflicts: [] });
  assert.deepEqual(entityConflictActive('x', [null, 'str', { id: 'p', state: 'delivered', entitySlug: 'x' }]), { conflict: false, conflicts: [] }, '非 active 不冲突');
});

test('entityTouchpoint:隐式触点 == 底座路径(一等触点,与显式文件路径同级,R2)', () => {
  const root = 'C:/dummy/ws';
  const tp = entityTouchpoint(root, 'my-entity');
  const base = baseDossierPaths(root, 'my-entity');
  assert.equal(tp.baseDir, base.baseDir);
  assert.equal(tp.stateFile, base.stateFile);
  assert.ok(tp.baseDir.includes('.dsh-base'), '隐式触点在底座目录');
  // 卫兵同 baseDossierPaths:非法 entitySlug 拒绝
  assert.throws(() => entityTouchpoint(root, '../evil'), /entitySlug/);
});

test('validateReadings:只增校验(非空字符串数组;缺省通过)', () => {
  assert.equal(validateReadings(undefined).ok, true, '缺省通过');
  assert.equal(validateReadings(['{{base}}/STATE.md', '{{project}}/SPEC.md']).ok, true);
  assert.equal(validateReadings([]).ok, false, '空数组拒绝');
  assert.equal(validateReadings(['a', '']).ok, false, '含空项拒绝');
  assert.equal(validateReadings('x').ok, false, '非数组拒绝');
  assert.equal(validateReadings([1]).ok, false, '非字符串项拒绝');
});

test('expandReadings:替换 {{base}}/{{project}} 变量', () => {
  const readings = ['{{base}}/STATE.md', '{{project}}/SPEC.md', '{{base}}/MAP.md'];
  const expanded = expandReadings(readings, { base: '.dsh-base/ent', project: 'proj-a' });
  assert.deepEqual(expanded, ['.dsh-base/ent/STATE.md', 'proj-a/SPEC.md', '.dsh-base/ent/MAP.md']);
  // 未给变量 → 保留原模板
  assert.deepEqual(expandReadings(readings, {}), readings);
  // 非数组 → 空数组
  assert.deepEqual(expandReadings(undefined, {}), []);
});

test('compileReadingsHeader:展开 readings 拼"进场必读"头;无 readings → 空串', () => {
  const header = compileReadingsHeader(['{{base}}/STATE.md', '{{project}}/SPEC.md'], { base: '.dsh-base/ent', project: 'proj-a' });
  assert.equal(header, '进场必读:\n- .dsh-base/ent/STATE.md\n- proj-a/SPEC.md');
  assert.equal(compileReadingsHeader([], {}), '');
  assert.equal(compileReadingsHeader(undefined, {}), '');
});

// ── cost-v2 统一 token 口径与模型来源(0.12.0)────────────────────────────

test('totalToken:happy path = uncachedInput+cacheRead+output(权威单口径,不含 cacheWrite)', () => {
  assert.equal(totalToken({ uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 200 }), 170);
  assert.equal(totalToken({ uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 0 }), 120, 'cacheRead=0 不影响');
  // 缺桶(旧形状)→ 0 兼容;非数字 → 0 兜底;非对象 → 0。
  assert.equal(totalToken({}), 0);
  assert.equal(totalToken({ uncachedInputTokens: 'x', outputTokens: {}, cacheReadTokens: null }), 0);
  assert.equal(totalToken(null), 0);
  assert.equal(totalToken(undefined), 0);
});

test('cacheRate:有 cacheRead → 分母同源;cacheRead<=0/分母0/非对象 → 0(不炸)', () => {
  assert.equal(cacheRate({ cacheReadTokens: 50, uncachedInputTokens: 100 }), 50 / 150, '50/150');
  assert.equal(cacheRate({ cacheReadTokens: 0, uncachedInputTokens: 100 }), 0, 'cacheRead=0');
  assert.equal(cacheRate({ cacheReadTokens: -5, uncachedInputTokens: 100 }), 0, 'cacheRead<0');
  assert.equal(cacheRate({ cacheReadTokens: 50, uncachedInputTokens: 0 }), 50 / 50, '分母只有 cacheRead(>0)不炸');
  assert.equal(cacheRate(null), 0);
  assert.equal(cacheRate({}), 0);
});

test('normalizeUsage:旧形状无 cacheRead/cacheWrite/model→四桶0+unknown;新形状原样;缺字段兼容', () => {
  const oldShape = normalizeUsage({ tokens: 120, uncachedInputTokens: 100, outputTokens: 20 });
  assert.deepEqual(oldShape, {
    tokens: 120, uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, sessionCount: 0, model: 'unknown', provider: null,
  });
  const newShape = normalizeUsage({ tokens: 120, uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 10, sessionId: 's1', model: 'deepseek-r1', provider: 'ollama-cloud' });
  assert.equal(newShape.model, 'deepseek-r1');
  assert.equal(newShape.provider, 'ollama-cloud');
  assert.equal(newShape.cacheReadTokens, 50);
  assert.equal(newShape.sessionId, 's1');
  // 缺 model/provider → 'unknown'/null;sessionCount 缺省 0;tokens 缺省按 uncached+output。
  const noModel = normalizeUsage({ uncachedInputTokens: 7, outputTokens: 3 });
  assert.equal(noModel.model, 'unknown');
  assert.equal(noModel.provider, null);
  assert.equal(noModel.tokens, 10, 'tokens 缺省 = uncached+output');
  // 非对象 → 全 0 + unknown
  const none = normalizeUsage(null);
  assert.equal(none.model, 'unknown');
  assert.equal(none.uncachedInputTokens, 0);
});

test('modelLabel:undefined/null/空/非字符串 → unknown;有值 → 原样', () => {
  assert.equal(modelLabel(undefined), 'unknown');
  assert.equal(modelLabel(null), 'unknown');
  assert.equal(modelLabel(''), 'unknown');
  assert.equal(modelLabel('deepseek-v4-flash'), 'deepseek-v4-flash');
});

test('aggregateByModel:按 model 分组聚合;未知/缺省桶归 unknown', () => {
  const committed = [
    { role: 'dev', usage: { uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 30, model: 'a' } },
    { role: 'dev', usage: { uncachedInputTokens: 200, outputTokens: 40, cacheReadTokens: 0, model: 'a' } },
    { role: 'tester', usage: { uncachedInputTokens: 10, outputTokens: 5, model: 'b' } },
    { role: 'dev', usage: { uncachedInputTokens: 1, outputTokens: 1 } }, // 无 model → unknown
  ];
  const byModel = aggregateByModel(committed);
  assert.equal(byModel.a.totalToken, 390, 'a 桶 = (100+30+20)+(200+0+40)');
  assert.equal(byModel.a.entries, 2);
  assert.equal(byModel.b.totalToken, 15);
  assert.equal(byModel.unknown.totalToken, 2, '缺 model 归 unknown');
  assert.equal(byModel.unknown.entries, 1);
});

// ── 自省审计回路 · 纯函数(0.15.0,kr-self-audit)───────────────────────────

const AUDIT_RULE = (over = {}) => ({
  id: 'R-test',
  observe: 'O4',
  when: { categoryCountGte: 3 },
  act: 'F2',
  object: 'data-asset',
  dedupe: 'by-category',
  territory: 'pipeline-ws/.dsh-library/lessons',
  ...over,
});

const AUDIT_FINDING = (over = {}) => ({
  id: 'O4-cat-x',
  observe: 'O4',
  category: 'dev-complexity',
  title: '同类 lesson 堆积:dev-complexity',
  summary: 'dev-complexity category 有 4 篇',
  value: { categoryCount: 4, category: 'dev-complexity' },
  status: 'supported',
  evidence: [{ file: '.dsh-library/lessons-index.json', ref: 'entry=a' }],
  ...over,
});

test('validateAuditRules:合法规则表通过;act=F4/非法/缺字段拒绝(AC1)', () => {
  const okRules = { schemaVersion: 1, meta: DEFAULT_AUDIT_META, rules: [AUDIT_RULE()] };
  assert.equal(validateAuditRules(okRules).ok, true);
  // act:F4 永久禁区
  assert.equal(validateAuditRules({ schemaVersion: 1, rules: [AUDIT_RULE({ act: 'F4' })] }).ok, false, 'act:F4 拒绝');
  assert.equal(validateAuditRules({ schemaVersion: 1, rules: [AUDIT_RULE({ act: 'X' })] }).ok, false, 'actX 拒绝');
  // 缺 when
  const noWhen = AUDIT_RULE();
  delete noWhen.when;
  assert.equal(validateAuditRules({ schemaVersion: 1, rules: [noWhen] }).ok, false, '缺 when');
  // 重复 id
  assert.equal(validateAuditRules({ schemaVersion: 1, rules: [AUDIT_RULE(), AUDIT_RULE()] }).ok, false, '重复 id');
  // 未知键
  assert.equal(validateAuditRules({ schemaVersion: 1, rules: [AUDIT_RULE({ wat: 1 })] }).ok, false, '规则未知键');
});

test('auditTerritoryWhitelist/territoryInWhitelist:领地白名单硬边界', () => {
  const whitelist = auditTerritoryWhitelist();
  assert.ok(Array.isArray(whitelist) && whitelist.includes('pipeline-ws'));
  assert.equal(territoryInWhitelist('pipeline-ws/.dsh-library/lessons'), true);
  assert.equal(territoryInWhitelist('plugindev/toolkit'), true);
  assert.equal(territoryInWhitelist('pipeline-ws/.dsh-base/foo'), true);
  assert.equal(territoryInWhitelist('outside/secret'), false, '领地外 false');
  assert.equal(territoryInWhitelist(''), false);
});

test('whenMatches:谓词求值(Gte/Gt/Lt/Contains/未知键跳过)', () => {
  assert.equal(whenMatches({ categoryCountGte: 3 }, { categoryCount: 4 }), true);
  assert.equal(whenMatches({ categoryCountGte: 3 }, { categoryCount: 2 }), false);
  assert.equal(whenMatches({ pendingHoursGte: 4 }, { pendingHours: 6 }), true);
  assert.equal(whenMatches({ driftCountGt: 1 }, { driftCount: 1 }), false, 'Gt 不包含等号');
  assert.equal(whenMatches({ tagsContains: 'x' }, { tags: ['a', 'x'] }), true, 'Contains');
  assert.equal(whenMatches({ unknownKeyGte: 1 }, { categoryCount: 2 }), false, 'value 无该 key 不命中');
});

test('auditRuleEngine:规则 act:F4 或对 F1 客体升权 F2 → 拒绝报错(AC1)', () => {
  assert.throws(
    () => auditRuleEngine([AUDIT_FINDING()], [AUDIT_RULE({ act: 'F2', object: 'flow' })]),
    /升权 F2/,
    'flow 客体升权 F2 拒绝',
  );
  assert.throws(
    () => auditRuleEngine([AUDIT_FINDING()], [AUDIT_RULE({ act: 'F2', object: 'role-prompt' })]),
    /升权 F2/,
    'role-prompt 客体升权 F2 拒绝',
  );
  assert.throws(
    () => auditRuleEngine([AUDIT_FINDING()], [AUDIT_RULE({ act: 'F3', object: 'preset-source' })]),
    /永久禁区/,
    'preset-source 以 F3 触及永久禁区拒绝',
  );
});

test('auditRuleEngine:happy path 产分流动作;领地外 F2 降级 F1', () => {
  const { actions, downgrades } = auditRuleEngine([AUDIT_FINDING()], [AUDIT_RULE()]);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].act, 'F2');
  assert.equal(actions[0].territory, 'pipeline-ws/.dsh-library/lessons');
  assert.equal(downgrades.length, 0);
  // 领地外 territory → F2 降级 F1
  const { actions: outA, downgrades: outD } = auditRuleEngine([AUDIT_FINDING()], [AUDIT_RULE({ territory: 'outside/secret' })]);
  assert.equal(outA.length, 1);
  assert.equal(outA[0].act, 'F1', '领地外降级 F1');
  assert.equal(outA[0].downgraded, true);
  assert.equal(outD.length, 1);
  // 未命中 when → 无动作
  const { actions: none } = auditRuleEngine([AUDIT_FINDING({ value: { categoryCount: 1 } })], [AUDIT_RULE()]);
  assert.equal(none.length, 0);
});

test('auditDedupe:by-category/by-target 去重(在跑项目/未解决审计产出)', () => {
  const actByCat = { ...AUDIT_RULE(), ruleId: 'r1', act: 'F2', category: 'dev-complexity' };
  const actByTgt = { ...AUDIT_RULE(), ruleId: 'r2', act: 'F2', dedupe: 'by-target', object: 'toolkit-readme', territory: 'plugindev/toolkit' };
  // 无在跑项目 → 全保留
  const d1 = auditDedupe([actByCat, actByTgt], [], []);
  assert.equal(d1.kept.length, 2);
  // 在跑项目 title 含 category → by-category 去重
  const d2 = auditDedupe([actByCat], [{ id: 'p1', title: 'dev-complexity 优化' }], []);
  assert.equal(d2.kept.length, 0);
  assert.equal(d2.dropped.length, 1);
  // 未解决 audit-trail 同 target → by-target 去重
  const d3 = auditDedupe([actByTgt], [], [{ id: 't1', action: 'F2', object: 'toolkit-readme', status: 'registered' }]);
  assert.equal(d3.kept.length, 0);
  assert.equal(d3.dropped[0].reason.includes('by-target'), true);
});

test('auditRateLimit:F2 上限与 meta 冷却期(AC4)', () => {
  const mkF2 = (n) => ({ ruleId: `r${n}`, act: 'F2', meta: false });
  const mkMeta = (n) => ({ ruleId: `meta${n}`, act: 'F2', meta: true });
  // 4 个 F2 → 上限 2 截断
  const r = auditRateLimit([mkF2(1), mkF2(2), mkF2(3), mkF2(4)], DEFAULT_AUDIT_META);
  assert.equal(r.kept.length, 2);
  assert.equal(r.dropped.length, 2);
  assert.equal(r.dropped[0].reason.includes('上限'), true);
  // meta 冷却期激活:lastMetaActionAt 近值 → meta 类动作全部不执行(防自指风暴)。
  const metaCool = auditRateLimit([mkMeta(1), mkMeta(2)], { ...DEFAULT_AUDIT_META, lastMetaActionAt: new Date(Date.now() - 86400000).toISOString() });
  assert.equal(metaCool.kept.length, 0, '冷却期内 meta 不执行');
  assert.equal(metaCool.dropped.length, 2);
  // 无冷却(超期)→ meta 每次至多一条。
  const metaCap = auditRateLimit([mkMeta(1), mkMeta(2)], { ...DEFAULT_AUDIT_META, lastMetaActionAt: new Date(Date.now() - 40 * 86400000).toISOString() });
  assert.equal(metaCap.kept.length, 1, '每次审计至多一条 meta');
  assert.equal(metaCap.dropped.length, 1);
});

test('buildF2Payload:title 前缀「自省立项」+ reason 证据链 + auto:true(AC2)', () => {
  const p = buildF2Payload(AUDIT_FINDING(), AUDIT_RULE());
  assert.match(p.title, /^自省立项: /, 'title 前缀');
  assert.equal(p.auto, true);
  assert.match(p.reason, /证据链:/);
  assert.match(p.reason, /lessons-index\.json#entry=a/, 'evidence 链可回放');
  assert.equal(p.ruleId, 'R-test');
  assert.equal(p.findingId, 'O4-cat-x');
  assert.equal(evidenceChain(AUDIT_FINDING().evidence), '.dsh-library/lessons-index.json#entry=a');
});

test('buildF1Payload:F1 报告含发现+evidence+建议(AC3)', () => {
  const p = buildF1Payload(AUDIT_FINDING(), AUDIT_RULE({ recommendation: '核查门禁停摆' }));
  assert.equal(p.act, 'F1');
  assert.match(p.report, /同类 lesson 堆积/);
  assert.match(p.report, /lessons-index\.json#entry=a/, 'evidence 入报告');
  assert.match(p.report, /核查门禁停摆/, '建议入报告');
  assert.deepEqual(p.evidence, AUDIT_FINDING().evidence);
});

test('buildF3Payload:F3 直改动作 + trace(before/after/evidence)(AC3)', () => {
  const p = buildF3Payload(AUDIT_FINDING(), AUDIT_RULE(), { object: '.dsh-library/lessons-index.json', before: { count: 3 }, after: { count: 4 } });
  assert.equal(p.act, 'F3');
  assert.equal(p.object, '.dsh-library/lessons-index.json');
  assert.equal(p.before.count, 3);
  assert.equal(p.after.count, 4);
  assert.ok(p.trace.id && p.trace.ts, 'trace 有 id/ts');
  assert.equal(p.trace.action, 'F3');
  assert.equal(p.trace.after.count, 4);
  assert.equal(p.trace.result, null);
});

