// test/project-harvest.test.mjs —— P4 project_harvest 工具 + block() 合并集校验。
// 覆盖:①block() 接受 categories.json 扩展 category、拒绝非法;存量 other 兼容;
// ②project_harvest rebuild-index 扫 lessons/patterns 归类建索引(保留 hits);
// ③bump-hits 递增 + 未命中 misses。
// 复用 makeStubCtx。os.tmpdir 下 mkdtemp 临时 workspace。运行:
//   cd presets/project-pipeline && node test/project-harvest.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../plugins/project-registry.mjs';
import { readJson, validateLessonsIndex, writeJson } from '../plugins/project-lib.mjs';
import { makeStubCtx } from '../../../toolkit/stub-ctx.mjs';

async function makeWorkspace(t) {
  const dir = await mkdtemp(join(tmpdir(), 'project-harvest-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const sessionContext = (workspace, sessionId) => ({
  agent: { session: { header: { cwd: workspace, ...(sessionId ? { id: sessionId } : {}) } } },
});

async function mountPlugin(config = {}) {
  const ctx = makeStubCtx();
  await apply(ctx, config);
  return ctx;
}

function getTool(ctx, name2) {
  const tool = ctx.tools.items.find((x) => x.name === name2);
  assert.ok(tool, `工具 ${name2} 未注册`);
  return tool;
}

/** 建一个 project(走 register)以便 block() 断言 active。 */
async function registerForBlock(t, workspace, ctx, id) {
  await mkdir(join(workspace, '.dsh-library', 'flows'), { recursive: true });
  await writeJson(join(workspace, '.dsh-library', 'flows', 'mini.json'), {
    schemaVersion: 1, id: 'mini', version: 1, stages: [{ id: 'do', type: 'work', role: 'dev' }],
  });
  await getTool(ctx, 'project_register').execute(
    { title: 'Harness', id, requirement: 'r', flowTemplate: 'mini' },
    sessionContext(workspace),
  );
}

/** 写 lessons/patterns 篇目(头部 front-matter 元数据)。 */
async function writeLesson(workspace, kind, id, meta, body = '# 标题\n正文\n') {
  const dir = join(workspace, '.dsh-library', kind === 'pattern' ? 'patterns' : 'lessons');
  await mkdir(dir, { recursive: true });
  const front = ['---', `id: ${id}`, ...Object.entries(meta).map(([k, v]) => `${k}: ${v}`), '---'].join('\n');
  await writeFile(join(dir, `${id}.md`), `${front}\n${body}`, 'utf8');
}

async function writeCategories(workspace, categories) {
  await mkdir(join(workspace, '.dsh-library'), { recursive: true });
  await writeJson(join(workspace, '.dsh-library', 'categories.json'), categories);
}

// ── block() 合并集校验 ────────────────────────────────────────────────────

test('block report:categories.json 扩展 category 被接受;非法 category 拒绝;存量 other 兼容', async (t) => {
  const ws = await makeWorkspace(t);
  const ctx = await mountPlugin();
  await registerForBlock(t, ws, ctx, 'p1');
  const blockTool = getTool(ctx, 'project_block');
  const context = sessionContext(ws);
  // 无扩展时:核心集 accepted,process 拒绝。
  await blockTool.execute({ projectId: 'p1', action: 'report', category: 'test-env', reason: '环境缺失' }, context);
  await assert.rejects(
    () => blockTool.execute({ projectId: 'p1', action: 'report', category: 'process', reason: 'x' }, context),
    /category 必须|核心集|扩展/,
    '无扩展时不接受 process',
  );
  // 配 categories.json(process)后:process 接受,unknown 拒绝。
  await writeCategories(ws, { schemaVersion: 1, categories: ['process'] });
  await ctx.dispose();
  const ctx2 = await mountPlugin();
  await registerForBlock(t, ws, ctx2, 'p1'); // 重新挂载(同一 workspace 已有注册)
  const blockTool2 = getTool(ctx2, 'project_block');
  const accepted = await blockTool2.execute({ projectId: 'p1', action: 'report', category: 'process', reason: '流程纪律问题' }, sessionContext(ws));
  assert.equal(accepted.blocker.category, 'process');
  await assert.rejects(
    () => blockTool2.execute({ projectId: 'p1', action: 'report', category: 'nonsense', reason: 'x' }, sessionContext(ws)),
    /category 必须|核心集|扩展/,
  );
  // 工具 schema category 是 type:string(非 static enum)。
  const schema = blockTool2.parameters;
  assert.equal(schema.properties.category.type, 'string', 'category schema 应为 type:string(疑问4 定稿)');
});

// ── project_harvest rebuild-index ─────────────────────────────────────────

test('project_harvest:rebuild-index 扫 lessons/patterns 归类建索引 + bump-hits', async (t) => {
  const ws = await makeWorkspace(t);
  const ctx = await mountPlugin();
  await writeLesson(ws, 'lesson', 'gate-discipline', { category: 'process', title: '门禁纪律', premises: 'gate 先 present', status: 'active', origin: 'project-hub' });
  await writeLesson(ws, 'pattern', 'deploy-discipline', { category: 'deploy-permission', title: 'deploy 纪律', premises: '默认打 test', status: 'active', origin: 'consumption-query' });
  await writeLesson(ws, 'lesson', 'uncategorized-one', { title: '无类', premises: 'p', status: 'active' }); // 无 category → uncategorized
  const harvestTool = getTool(ctx, 'project_harvest');
  const context = sessionContext(ws);

  const rebuild = await harvestTool.execute({ action: 'rebuild-index' }, context);
  assert.equal(rebuild.action, 'rebuild-index');
  assert.equal(rebuild.entriesTotal, 3);
  assert.equal(rebuild.categoriesCount, 3);
  assert.ok(rebuild.categories.some((c) => c.category === 'process' && c.count === 1));
  assert.ok(rebuild.categories.some((c) => c.category === 'deploy-permission' && c.count === 1));
  assert.ok(rebuild.categories.some((c) => c.category === 'uncategorized' && c.count === 1));

  const indexPath = join(ws, '.dsh-library', 'lessons-index.json');
  assert.ok(existsSync(indexPath), 'lessons-index.json 已写入');
  const index = await readJson(indexPath);
  assert.equal(validateLessonsIndex(index).ok, true, '索引 schema 合法');
  const gate = index.categories['process'].find((x) => x.id === 'gate-discipline');
  assert.equal(gate.hits, 0);
  assert.equal(gate.kind, 'lesson');
  assert.equal(gate.origin, 'project-hub');

  // bump-hits:gate-discipline + ghost。
  const bump = await harvestTool.execute({ action: 'bump-hits', lessonRefs: ['gate-discipline', 'ghost'] }, context);
  assert.deepEqual(bump.bumped, [{ id: 'gate-discipline', hits: 1 }]);
  assert.deepEqual(bump.misses, ['ghost']);
  const after = await readJson(indexPath);
  assert.equal(after.categories['process'].find((x) => x.id === 'gate-discipline').hits, 1);

  // rebuild 保留 hits(加一篇门禁 lesson,gate-discipline hits 仍 1,新篇目 0)。
  await writeLesson(ws, 'lesson', 'gate-discipline-2', { category: 'process', title: '门禁二', premises: 'p2', status: 'active' });
  const rebuild2 = await harvestTool.execute({ action: 'rebuild-index' }, context);
  assert.equal(rebuild2.entriesTotal, 4);
  const after2 = await readJson(indexPath);
  assert.equal(after2.categories['process'].find((x) => x.id === 'gate-discipline').hits, 1, 'rebuild 保留既有 hits');
  assert.equal(after2.categories['process'].find((x) => x.id === 'gate-discipline-2').hits, 0, '新增篇目 hits=0');
});

test('project_harvest:非法 action/bump 缺 lessonRefs 拒绝;无索引 bump 报错', async (t) => {
  const ws = await makeWorkspace(t);
  const ctx = await mountPlugin();
  const harvestTool = getTool(ctx, 'project_harvest');
  const context = sessionContext(ws);
  await assert.rejects(() => harvestTool.execute({ action: 'wat' }, context), /action/);
  await assert.rejects(() => harvestTool.execute({ action: 'bump-hits' }, context), /lessonRefs/);
  await assert.rejects(() => harvestTool.execute({ action: 'bump-hits', lessonRefs: [1] }, context), /lessonRefs/);
  await assert.rejects(() => harvestTool.execute({ action: 'bump-hits', lessonRefs: ['x'] }, context), /rebuild-index/);
});

test('project_harvest:plugin 注册 8 工具,含 project_harvest', async (t) => {
  const ctx = await mountPlugin();
  const names = ctx.tools.items.map((x) => x.name).sort();
  assert.deepEqual(names, ['project_advance', 'project_audit', 'project_block', 'project_budget', 'project_gate', 'project_harvest', 'project_register', 'project_status']);
});
