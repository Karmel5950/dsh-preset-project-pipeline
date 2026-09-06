// test/project-p4.test.mjs —— P4 记忆治理·消费路由优先新增纯函数单测。
// 覆盖:categories 合并(resolveBlockerCategories/validateCategories)、lessons-index
// schema(buildLessonsIndex/validateLessonsIndex)、rulings 扩展(validateRulings
// negative-premises/basis)、hits 递增(bumpLessonHits)、matchRuling negative-premises。
// 纯函数;os.tmpdir 下 mkdtemp 临时 workspace(自建自清)。运行:
//   cd presets/project-pipeline && node test/project-p4.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BLOCKER_CATEGORIES,
  buildLessonsIndex,
  bumpLessonHits,
  matchRuling,
  readRulings,
  resolveBlockerCategories,
  validateCategories,
  validateLessonEntry,
  validateLessonsIndex,
  validateRulings,
  writeJson,
} from '../plugins/project-lib.mjs';

async function makeWorkspace(t) {
  const dir = await mkdtemp(join(tmpdir(), 'project-p4-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

// ── validateCategories / resolveBlockerCategories ──────────────────────────

test('validateCategories:数组形状合法(含去重);对象形状(带 schemaVersion)合法', () => {
  assert.deepEqual(validateCategories(['process', 'process', 'tooling']).value, ['process', 'tooling'], '数组去重');
  assert.deepEqual(validateCategories({ schemaVersion: 1, categories: ['coordination'] }).value, ['coordination']);
  assert.equal(validateCategories([]).ok, true, '空数组允许(纯核心集)');
});

test('validateCategories:非法形状拒绝(非字符串/非数组/坏 schemaVersion)', () => {
  assert.equal(validateCategories('x').ok, false);
  assert.equal(validateCategories([1]).ok, false, '非字符串项');
  assert.equal(validateCategories(['', 'a']).ok, false, '空串项');
  assert.equal(validateCategories({ schemaVersion: 2, categories: [] }).ok, false, 'schemaVersion≠1');
  assert.equal(validateCategories({ categories: 'x' }).ok, false, 'categories 非数组');
});

test('resolveBlockerCategories:核心集 + 扩展合并;同名核心扩展不重复;缺失/坏 JSON 回退核心集并告警', async (t) => {
  const ws = await makeWorkspace(t);
  // 无 categories.json → 回退核心集 + error。
  const noFile = await resolveBlockerCategories(ws);
  assert.deepEqual(noFile.categories, BLOCKER_CATEGORIES, '缺文件回退核心集');
  assert.ok(noFile.error, '缺文件应带 error');
  // 有扩展 → 合并。
  await mkdir(join(ws, '.dsh-library'), { recursive: true });
  await writeJson(join(ws, '.dsh-library', 'categories.json'), ['process', 'tooling', 'test-env']);
  const merged = await resolveBlockerCategories(ws);
  assert.equal(merged.error, undefined);
  assert.deepEqual(merged.categories, [...BLOCKER_CATEGORIES, 'process', 'tooling'], '核心恒在 + 去重 + 扩展追加');
  // 坏 JSON → 回退核心集 + error。
  await writeFile(join(ws, '.dsh-library', 'categories.json'), '{oops', 'utf8');
  const bad = await resolveBlockerCategories(ws);
  assert.deepEqual(bad.categories, BLOCKER_CATEGORIES, '坏 JSON 回退核心集');
  assert.ok(bad.error, '坏 JSON 应带 error');
});

// ── lessons-index schema(buildLessonsIndex / validateLessonsIndex)─────────

const LESSON_ENTRIES = [
  { id: 'gate-discipline', kind: 'lesson', category: 'process', title: '门禁纪律', premises: 'gate 必须先 present 再 advance', status: 'active', origin: 'project-hub' },
  { id: 'deploy-discipline', kind: 'pattern', category: 'deploy-permission', title: 'deploy 纪律', premises: '默认打 test 环境', status: 'active', origin: 'consumption-query' },
  { id: 'visual-acceptance', kind: 'lesson', category: 'acceptance-capability', title: '视觉验收', premises: '视觉类验收需用户侧', status: 'active', origin: 'i3' },
];

test('validateLessonEntry:合法/非法(缺 title/坏 kind/坏 id)', () => {
  assert.equal(validateLessonEntry(LESSON_ENTRIES[0]).ok, true);
  assert.equal(validateLessonEntry({ id: 'x y', kind: 'lesson', title: 't', premises: 'p', status: 'a' }).ok, false, 'id 须 slug');
  assert.equal(validateLessonEntry({ id: 'x', kind: 'weird', title: 't', premises: 'p', status: 'a' }).ok, false, 'kind 须 lesson/pattern');
  assert.equal(validateLessonEntry({ id: 'x', kind: 'lesson', title: 't', status: 'a' }).ok, false, '缺 premises');
});

test('buildLessonsIndex:按 category 归类(lesson/pattern 不分叉),新增 hits=0', () => {
  const index = buildLessonsIndex(LESSON_ENTRIES);
  assert.equal(index.schemaVersion, 1);
  assert.equal(Object.keys(index.categories).length, 3);
  assert.equal(index.categories['process'].length, 1);
  assert.equal(index.categories['deploy-permission'].length, 1);
  assert.equal(index.categories['acceptance-capability'].length, 1);
  assert.equal(index.categories['process'][0].id, 'gate-discipline');
  assert.equal(index.categories['process'][0].kind, 'lesson');
  assert.equal(index.categories['deploy-permission'][0].kind, 'pattern', 'pattern 与 lesson 统一归类');
  assert.equal(index.categories['process'][0].hits, 0, '新增 hits=0');
  assert.equal(index.categories['process'][0].origin, 'project-hub');
});

test('buildLessonsIndex:保留既有 hits;缺省 category → uncategorized', () => {
  const existing = buildLessonsIndex(LESSON_ENTRIES);
  existing.categories['process'][0].hits = 5;
  // 新条目沿用既有 hits,新增 hits=0。
  const rebuilt = buildLessonsIndex([...LESSON_ENTRIES, { id: 'new-lesson', kind: 'lesson', category: 'process', title: '新', premises: 'p', status: 'active' }], existing);
  const gate = rebuilt.categories['process'].find((x) => x.id === 'gate-discipline');
  assert.equal(gate.hits, 5, '既有 hits 保留');
  const fresh = rebuilt.categories['process'].find((x) => x.id === 'new-lesson');
  assert.equal(fresh.hits, 0, '新增篇目 hits=0');
  // 无 category → uncategorized。
  const noCat = buildLessonsIndex([{ id: 'orphan', kind: 'lesson', title: '无类', premises: 'p', status: 'active' }]);
  assert.ok(Array.isArray(noCat.categories['uncategorized']), '无 category 归入 uncategorized');
});

test('buildLessonsIndex:元数据缺失条目(无 category 无 title)不炸', () => {
  const index = buildLessonsIndex([{ id: 'bare', kind: 'lesson', status: 'active' }]);
  assert.ok(Array.isArray(index.categories['uncategorized']));
});

test('validateLessonsIndex:合法索引通过;坏 schema/hits/category 拒绝', () => {
  const index = buildLessonsIndex(LESSON_ENTRIES);
  assert.equal(validateLessonsIndex(index).ok, true);
  assert.equal(validateLessonsIndex({ schemaVersion: 1, categories: {} }).ok, true, '空 categories 合法(无 lesson 的初始态)');
  assert.equal(validateLessonsIndex({ schemaVersion: 2, categories: index.categories }).ok, false, 'schemaVersion≠1');
  assert.equal(validateLessonsIndex({ schemaVersion: 1, categories: { a: [] } }).ok, false, '空桶');
  const badHits = JSON.parse(JSON.stringify(index));
  badHits.categories['process'][0].hits = -1;
  assert.equal(validateLessonsIndex(badHits).ok, false, 'hits 负整数');
});

// ── bumpLessonHits(hits 递增)──────────────────────────────────────────────

test('bumpLessonHits:命中 id hits+1,返回明细;未命中入 misses;不原地改输入', () => {
  const index = buildLessonsIndex(LESSON_ENTRIES);
  const { index: out, bumped, misses } = bumpLessonHits(index, ['gate-discipline', 'deploy-discipline', 'ghost']);
  assert.deepEqual(bumped, [
    { id: 'gate-discipline', hits: 1 },
    { id: 'deploy-discipline', hits: 1 },
  ], 'bumped 明细');
  assert.deepEqual(misses, ['ghost'], '未命中的 id');
  assert.equal(out.categories['process'][0].hits, 1);
  assert.equal(out.categories['deploy-permission'][0].hits, 1);
  assert.equal(index.categories['process'][0].hits, 0, '输入索引未被原地改');
  // 再 bump 一次 → hits=2(累计)。
  const second = bumpLessonHits(out, ['gate-discipline']);
  assert.deepEqual(second.bumped, [{ id: 'gate-discipline', hits: 2 }]);
});

// ── rulings 扩展(negative-premises / basis)────────────────────────────────

test('validateRulings:negative-premises/basis 合法(只增,不改既有键)', () => {
  const withExt = {
    schemaVersion: 1,
    rulings: [{
      id: 'r1', category: 'acceptance-capability',
      premise: '视觉类验收', conclusion: '用户侧 blocking', means: '截图核验',
      'negative-premises': ['无视觉产物'], basis: 'preset v0.10.0,2026-08-30',
    }],
  };
  const checked = validateRulings(withExt);
  assert.equal(checked.ok, true);
  assert.equal(checked.value.rulings[0]['negative-premises'][0], '无视觉产物');
  assert.equal(checked.value.rulings[0].basis, 'preset v0.10.0,2026-08-30');
  // 只增不改兼容:既有 r1~r4 无新字段仍合法。
  const legacyRuling = { id: 'x', category: 'other', premise: 'p', conclusion: 'c', means: 'm' };
  assert.equal(validateRulings({ schemaVersion: 1, rulings: [legacyRuling] }).ok, true);
});

test('validateRulings:negative-premises/basis 非法形状拒绝;bad category 拒绝', () => {
  const badNeg = { schemaVersion: 1, rulings: [{ id: 'x', category: 'other', premise: 'p', conclusion: 'c', means: 'm', 'negative-premises': ['', 'a'] }] };
  assert.equal(validateRulings(badNeg).ok, false, 'negative-premises 含空串');
  const badNegType = { schemaVersion: 1, rulings: [{ id: 'x', category: 'other', premise: 'p', conclusion: 'c', means: 'm', 'negative-premises': 'a' }] };
  assert.equal(validateRulings(badNegType).ok, false, 'negative-premises 非数组');
  const badBasis = { schemaVersion: 1, rulings: [{ id: 'x', category: 'other', premise: 'p', conclusion: 'c', means: 'm', basis: '' }] };
  assert.equal(validateRulings(badBasis).ok, false, 'basis 空串');
  // 扩展 category 不进裁决库(category 白名单只含核心集,维持既有契约)。
  const extCat = { schemaVersion: 1, rulings: [{ id: 'x', category: 'process', premise: 'p', conclusion: 'c', means: 'm' }] };
  assert.equal(validateRulings(extCat).ok, false, '裁决库 category 仍为核心集白名单');
});

test('matchRuling:premise 命中 + negative-premises 不命中才引用(AC6 单测锁定)', () => {
  const rulings = [
    {
      id: 'r1', category: 'acceptance-capability',
      premise: '验收对象为视觉/真实观感类(有视觉产物且流水线角色无浏览器无视觉)',
      conclusion: '用户侧 blocking',
      'negative-premises': ['验收对象为纯逻辑函数且无视觉产物'],
    },
  ];
  // premisa 命中 + 无否定面命中 → 命中(候选情形须包含裁决前提的切片关键词)。
  const hit = matchRuling(rulings, { category: 'acceptance-capability', premise: '本轮验收对象为视觉真实观感类,有视觉产物且流水线角色无浏览器无视觉' });
  assert.equal(hit?.id, 'r1');
  // premise 命中但否定面命中(纯逻辑无视觉)→ 不命中。
  const negated = matchRuling(rulings, { category: 'acceptance-capability', premise: '验收对象为纯逻辑函数且无视觉产物' });
  assert.equal(negated, undefined, 'negative-premises 命中则命中失效');
});

test('readRulings:读带新字段的裁决库返回(结构经 validateRulings)', async (t) => {
  const ws = await makeWorkspace(t);
  await mkdir(join(ws, '.dsh-library'), { recursive: true });
  await writeJson(join(ws, '.dsh-library', 'rulings.json'), {
    schemaVersion: 1,
    rulings: [{ id: 'r1', category: 'other', premise: 'p', conclusion: 'c', means: 'm', 'negative-premises': ['a'], basis: 'v0.10' }],
  });
  const result = await readRulings(ws);
  assert.equal(result.error, undefined);
  assert.equal(result.rulings[0].basis, 'v0.10');
});
