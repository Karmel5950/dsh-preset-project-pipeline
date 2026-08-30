// project-lib 纯库单测(机制1 既定裁决库 + 机制2 失败模式聚合)。运行:
//   cd presets/project-pipeline && node test/project-lib.test.mjs
// 打法:os.tmpdir 下 mkdtemp 临时 workspace(自建自清),直接驱动纯函数。
// 覆盖:validateRulings(结构合法/非法)、readRulings(读/缺失/坏 JSON)、
// matchRuling(命中判据=前提一致才命中)、collectAllBlockers(扫 sibling REGISTRY
// 含 delivered)、aggregateByCategory(同 category ≥2 计数)、buildFailureReport(四要素)。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BLOCKER_CATEGORIES,
  aggregateByCategory,
  buildFailureReport,
  collectAllBlockers,
  matchRuling,
  readRulings,
  validateRulings,
  writeJson,
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
