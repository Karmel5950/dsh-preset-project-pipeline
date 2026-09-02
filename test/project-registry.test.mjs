// project-registry 插件单测(A 路)。运行:
//   cd presets/project-pipeline && node --test test/project-registry.test.mjs
// 打法:os.tmpdir 下 mkdtemp 临时 workspace(自建自清),stub ctx 挂插件后
// 直接驱动 tool.execute(args, context);会话 cwd 按调研结论注入
// context.agent.session.header.cwd(SPEC §6)。不 import B 路的 project-roles.mjs。
// 0.5.0 新增:机制4 暂存区 parking 状态机/register 单测(见「parked 暂存区」节)。
// 0.5.1 新增(迭代7 中文命名):register 解耦单测——纯中文无 id 拒收、显式 id 合法/
// 非法、混合 title 向后兼容、分隔符与 ".." 拒绝;slugifyStrict 纯函数单测。
// 0.8.0 新增(预算账本改真实 token 计量):会话登记(主路 spawn-pass + 兜底 auto-record)、
// commit 自动填(usage 缺省 + source=runtime-events)、advance 联动 collect、projcache
// 守卫报错、R2 替换后同一 sessionId 不重复计数。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, inject, name } from '../plugins/project-registry.mjs';
import {
  BUDGET_SOURCES,
  STAGE_TYPES,
  nowStamp,
  readJson,
  registryPaths,
  resolveLibrary,
  slugify,
  slugifyStrict,
  validateFlow,
  validateRole,
  validateStageList,
  writeJson,
} from '../plugins/project-lib.mjs';
import { makeStubCtx } from '../../../toolkit/stub-ctx.mjs';

// ── 桩具 ────────────────────────────────────────────────────────────────────

/** 临时 workspace(os.tmpdir 下,测试结束自清)。 */
async function makeWorkspace(t) {
  const dir = await mkdtemp(join(tmpdir(), 'project-registry-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** 会话 cwd 注入:按调研结论,execute 第二参携带 agent.session.header.cwd;0.8.0 增 id。 */
const sessionContext = (workspace, sessionId) => ({
  agent: { session: { header: { cwd: workspace, ...(sessionId ? { id: sessionId } : {}) } } },
});

async function mountPlugin(config = {}) {
  const ctx = makeStubCtx();
  await apply(ctx, config);
  return ctx;
}

function getTool(ctx, toolName) {
  const tool = ctx.tools.items.find((item) => item.name === toolName);
  assert.ok(tool, `工具 ${toolName} 未注册`);
  return tool;
}

/** 迷你流程:work → gate → summary(测 advance/gate 全规则够用)。 */
const MINI_STAGES = [
  { id: 'do', type: 'work', role: 'dev' },
  { id: 'review', type: 'gate', title: '评审' },
  { id: 'wrap', type: 'summary' },
];

/** 往 workspace 库写一份流程模板(不依赖 B 路的 preset 自带库)。 */
async function writeTemplate(workspace, id, stages = MINI_STAGES) {
  await mkdir(join(workspace, '.dsh-library', 'flows'), { recursive: true });
  await writeJson(join(workspace, '.dsh-library', 'flows', `${id}.json`), {
    schemaVersion: 1,
    id,
    version: 1,
    stages,
  });
}

/** 快捷:登记一个用 mini-flow 模板的项目(显式指名模板,不依赖 preset 自带库)。 */
async function registerMini(t, title = 'Flow Demo') {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const ctx = await mountPlugin();
  const result = await getTool(ctx, 'project_register').execute(
    { title, requirement: '做一个最小可用版本', flowTemplate: 'mini-flow' },
    sessionContext(workspace),
  );
  return { workspace, ctx, projectId: result.projectId };
}

/** 推进到指定下标(逐段常规推进;遇门禁自动 present(如未呈递)+approve)。 */
async function advanceTo(t, ctx, workspace, projectId, targetIndex) {
  const advance = getTool(ctx, 'project_advance');
  const gateTool = getTool(ctx, 'project_gate');
  const context = sessionContext(workspace);
  for (let index = 0; index < targetIndex; index++) {
    const state = await getTool(ctx, 'project_status').execute({ projectId }, context);
    if (state.project.currentStage?.type === 'gate') {
      if (state.project.gateStatus == null) {
        await gateTool.execute({
          projectId,
          stageId: state.project.currentStage.id,
          action: 'present',
          package: { summary: '测试自动呈递' },
        }, context);
      }
      const fresh = await getTool(ctx, 'project_status').execute({ projectId }, context);
      if (fresh.project.gateStatus === 'pending') {
        await gateTool.execute({
          projectId,
          stageId: fresh.project.currentStage.id,
          action: 'decide',
          decision: { verdict: 'approve' },
        }, context);
      }
    }
    await advance.execute({ projectId }, context);
  }
}

/** 写一份合法 projcache(unit.version=3)。 */
async function writeProjcache(workspace, sessions) {
  const file = join(workspace, 'projcache.json');
  await writeJson(file, {
    unit: { version: 3 },
    tables: {
      sessions: Object.fromEntries(
        Object.entries(sessions).map(([sid, totals]) => [sid, { rows: { tokenUsage: { val: { totals } } } }]),
      ),
    },
  });
  return file;
}

// ── 插件元数据与挂载 ────────────────────────────────────────────────────────

test('插件元数据:7 个工具 + 1 条手册提示段(注册常驻,不接线 ctx.effect)', async () => {
  const ctx = await mountPlugin();
  assert.equal(name, 'project-pipeline-registry');
  assert.deepEqual(inject, ['tools', 'systemPrompt']);
  assert.deepEqual(ctx.tools.items.map((item) => item.name).sort(), [
    'project_advance',
    'project_block',
    'project_budget',
    'project_gate',
    'project_harvest',
    'project_register',
    'project_status',
  ]);
  assert.equal(ctx.systemPrompt.items.length, 1);
  const section = ctx.systemPrompt.items[0];
  assert.equal(section.name, 'project-pipeline/manual');
  assert.equal(section.order, 140);
  for (const word of [...STAGE_TYPES, 'project_register', 'project_advance', 'project_gate', 'project_budget commit', 'project_status', 'project_block', 'project_harvest', 'role_show', 'flow_show', 'self-report', '.dsh-project', 'settlement', '可行性分析', '卡点纪律', '既定裁决库', '失败模式聚合', '部署自检', 'parked', 'id 入参', 'runtime-events', 'projcache', 'sessions', '底座', 'entitySlug', 'readings', 'MAX_COMPILED_PERSONA', '消费路由', 'negative-premises', 'lessons-index']) {
    assert.ok(section.text.includes(word), `手册段应包含 ${word}`);
  }
});

test('config 校验:registryDir/libraryDir 非法时挂载即失败(fail-fast);projcachePath 合法', async () => {
  await assert.rejects(() => mountPlugin({ registryDir: '' }), /registryDir/);
  await assert.rejects(() => mountPlugin({ registryDir: 'a/b' }), /registryDir/);
  await assert.rejects(() => mountPlugin({ registryDir: '..' }), /registryDir/);
  await assert.rejects(() => mountPlugin({ libraryDir: 42 }), /libraryDir/);
  await assert.rejects(() => mountPlugin({ wat: 1 }), /未知键/);
  await assert.rejects(() => mountPlugin({ projcachePath: '' }), /projcachePath/);
  await assert.rejects(() => mountPlugin({ projcachePath: 42 }), /projcachePath/);
  // 合法 projcachePath(路径,可含分隔符)
  await mountPlugin({ projcachePath: 'C:\\data\\session_projcache.json' });
});

test('每个工具都有对象根 output.schema、render 与非空中文 description', async () => {
  const ctx = await mountPlugin();
  for (const tool of ctx.tools.items) {
    assert.equal(tool.output.schema.type, 'object', tool.name);
    assert.equal(typeof tool.output.render, 'function', tool.name);
    assert.ok(typeof tool.description === 'string' && tool.description.length > 0, tool.name);
    assert.ok(tool.description.length > 0);
  }
});

test('无会话上下文时 execute 报中文错(调研结论:cwd 只来自 agent.session.header)', async () => {
  const ctx = await mountPlugin();
  await assert.rejects(() => getTool(ctx, 'project_status').execute({}, {}), /会话工作区/);
  await assert.rejects(() => getTool(ctx, 'project_status').execute({}, { agent: {} }), /会话工作区/);
  await assert.rejects(() => getTool(ctx, 'project_status').execute({}, { agent: { session: { header: {} } } }), /会话工作区/);
});

// ── project_register ────────────────────────────────────────────────────────

test('project_register:建全骨架,REGISTRY/FLOW/BUDGET/REQUIREMENT 落盘', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const ctx = await mountPlugin();
  const result = await getTool(ctx, 'project_register').execute(
    { title: 'Demo App', requirement: '做一个 demo,要求中文注释', flowTemplate: 'mini-flow' },
    sessionContext(workspace),
  );
  assert.equal(result.projectId, 'demo-app');
  assert.equal(result.state, 'active');
  assert.equal(result.nextStage.id, 'do');
  assert.equal(result.nextStage.type, 'work');
  assert.equal(result.flowSummary.length, 3);
  assert.deepEqual(result.flowSummary[1], { index: 1, id: 'review', type: 'gate', title: '评审' });

  const paths = registryPaths(workspace, 'demo-app');
  for (const key of ['projectDir', 'registryDir', 'registryFile', 'flowFile', 'budgetFile', 'requirementFile', 'summaryFile', 'journalDir', 'gatesDir', 'feedbackDir']) {
    assert.ok(typeof paths[key] === 'string' && paths[key].length > 0, `paths.${key}`);
  }
  assert.ok(existsSync(paths.journalDir) && existsSync(paths.gatesDir) && existsSync(paths.feedbackDir));

  const registry = await readJson(paths.registryFile);
  assert.equal(registry.schemaVersion, 2, 'P1:新登记簿 schemaVersion=2');
  assert.equal(registry.entitySlug, 'demo-app', 'P1:entitySlug 缺省=项目自身');
  assert.equal(registry.id, 'demo-app');
  assert.equal(registry.title, 'Demo App');
  assert.equal(registry.flowRef, 'mini-flow@1');
  assert.equal(registry.iteration, 1);
  assert.equal(registry.stageIndex, 0);
  assert.equal(registry.gateStatus, null);
  assert.equal(registry.state, 'active');
  assert.match(registry.createdAt, /^\d{4}-\d{2}-\d{2}T/);

  const flow = await readJson(paths.flowFile);
  assert.equal(flow.source, 'mini-flow@1');
  assert.equal(flow.revision, 1);
  assert.equal(flow.stages.length, 3);

  const budget = await readJson(paths.budgetFile);
  assert.deepEqual(budget, { schemaVersion: 1, estimate: null, cap: null, committed: [] });

  const requirement = await readFile(paths.requirementFile, 'utf8');
  assert.ok(requirement.includes('做一个 demo,要求中文注释'), '需求原文逐字入档');
  assert.ok(requirement.includes('demo-app'));
});

// ── P1 实体仓底座:entity 入参 / entitySlug / 底座初稿 / C3 兼容 ──────────

test('project_register:entity 入参 → entitySlug=entity,回执 baseDossier(无底座 draftNeeded)', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const ctx = await mountPlugin();
  const context = sessionContext(workspace);
  const result = await getTool(ctx, 'project_register').execute({
    title: 'Entity Demo', id: 'entity-demo', requirement: 'r', flowTemplate: 'mini-flow', entity: 'shared-entity',
  }, context);
  assert.equal(result.projectId, 'entity-demo');
  assert.equal(result.baseDossier.entity, 'shared-entity');
  assert.equal(result.baseDossier.exists, false, '无底座 → exists=false');
  assert.equal(result.baseDossier.draftNeeded, true, '无底座 → draftNeeded=true');
  assert.ok(result.baseDossier.path.includes('.dsh-base'), '底座路径在工作区级 .dsh-base/');
  const registry = await readJson(registryPaths(workspace, 'entity-demo').registryFile);
  assert.equal(registry.schemaVersion, 2);
  assert.equal(registry.entitySlug, 'shared-entity');
});

test('project_register:entity 已有底座 → baseDossier.exists=true,draftNeeded=false', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  // 预建底座(STATE.md 存在即视为有底座)。
  await mkdir(join(workspace, '.dsh-base', 'shared-entity'), { recursive: true });
  await writeFile(join(workspace, '.dsh-base', 'shared-entity', 'STATE.md'), '# 状态\n', 'utf8');
  const ctx = await mountPlugin();
  const result = await getTool(ctx, 'project_register').execute({
    title: 'Entity Has', id: 'entity-has', requirement: 'r', flowTemplate: 'mini-flow', entity: 'shared-entity',
  }, sessionContext(workspace));
  assert.equal(result.baseDossier.exists, true);
  assert.equal(result.baseDossier.draftNeeded, false);
  const registry = await readJson(registryPaths(workspace, 'entity-has').registryFile);
  assert.equal(registry.entitySlug, 'shared-entity');
});

test('project_register:entity 非法(含分隔符/..)拒收', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const ctx = await mountPlugin();
  const context = sessionContext(workspace);
  for (const bad of ['../evil', 'a/b', 'a\\b', '..', '.', 'x y', '-lead', '']) {
    await assert.rejects(
      () => getTool(ctx, 'project_register').execute({ title: 'x', id: 'x', requirement: 'r', entity: bad }, context),
      /entity 非法/,
      `entity ${JSON.stringify(bad)} 应被拒收`,
    );
  }
});

test('project_register:entity 无底座时 clarify 阶段 produces 扩展底座初稿四件套(流程数据表达)', async (t) => {
  const workspace = await makeWorkspace(t);
  // 用带 clarify 的模板(standard-flow 形状,含 clarify work 阶段)。
  await writeTemplate(workspace, 'std', [
    { id: 'clarify', type: 'work', role: 'product', produces: ['SPEC.md'] },
    { id: 'build', type: 'work', role: 'dev' },
  ]);
  const ctx = await mountPlugin();
  const result = await getTool(ctx, 'project_register').execute({
    title: 'Draft', id: 'draft', requirement: 'r', flowTemplate: 'std', entity: 'new-entity',
  }, sessionContext(workspace));
  assert.equal(result.baseDossier.draftNeeded, true);
  const flow = await readJson(registryPaths(workspace, 'draft').flowFile);
  const clarify = flow.stages.find((s) => s.id === 'clarify');
  assert.equal(clarify.type, 'work', 'clarify 仍是 work(不加新阶段类型)');
  assert.ok(clarify.produces.includes('SPEC.md'), '原 produces 保留');
  for (const p of ['base-dossier/MAP.md', 'base-dossier/DECISIONS.md', 'base-dossier/RUNBOOK.md', 'base-dossier/STATE.md']) {
    assert.ok(clarify.produces.includes(p), `clarify produces 应含 ${p}`);
  }
  // 模板未被污染:再登记一个同 entity 无底座的项目,clarify produces 仍只含 SPEC.md(克隆语义)。
  const second = await getTool(ctx, 'project_register').execute({
    title: 'Draft2', id: 'draft2', requirement: 'r', flowTemplate: 'std', entity: 'new-entity',
  }, sessionContext(workspace));
  assert.equal(second.baseDossier.draftNeeded, true);
  const flow2 = await readJson(registryPaths(workspace, 'draft2').flowFile);
  assert.deepEqual(flow2.stages.find((s) => s.id === 'clarify').produces, ['SPEC.md', 'base-dossier/MAP.md', 'base-dossier/DECISIONS.md', 'base-dossier/RUNBOOK.md', 'base-dossier/STATE.md']);
});

test('project_status:单项目详情含 entitySlug(经 entitySlugOf)', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const ctx = await mountPlugin();
  const context = sessionContext(workspace);
  await getTool(ctx, 'project_register').execute({ title: 'Status Ent', id: 'status-ent', requirement: 'r', flowTemplate: 'mini-flow', entity: 'ent-x' }, context);
  const detail = await getTool(ctx, 'project_status').execute({ projectId: 'status-ent' }, context);
  assert.equal(detail.project.entitySlug, 'ent-x');
});

// ── C3 schema 兼容:读旧 schemaVersion=1 登记簿不报错、写回不破坏 ──────────

test('C3:读旧 REGISTRY(schemaVersion=1,无 entitySlug)不报错,advance 正常', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const ctx = await mountPlugin();
  const context = sessionContext(workspace);
  await getTool(ctx, 'project_register').execute({ title: 'Legacy', id: 'legacy', requirement: 'r', flowTemplate: 'mini-flow' }, context);
  // 手工降级为旧登记簿形状(schemaVersion=1,删 entitySlug)。
  const regFile = registryPaths(workspace, 'legacy').registryFile;
  const old = await readJson(regFile);
  delete old.entitySlug;
  old.schemaVersion = 1;
  await writeJson(regFile, old);
  // 读不报错:status 正常。
  const detail = await getTool(ctx, 'project_status').execute({ projectId: 'legacy' }, context);
  assert.equal(detail.project.entitySlug, 'legacy', '旧登记簿 entitySlug 缺省=项目自身');
  // advance 正常。
  const out = await getTool(ctx, 'project_advance').execute({ projectId: 'legacy' }, context);
  assert.equal(out.stageIndex, 1);
});

test('C3:写回不破坏未修改字段,不升 schemaVersion、不新增 entitySlug', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const ctx = await mountPlugin();
  const context = sessionContext(workspace);
  await getTool(ctx, 'project_register').execute({ title: 'Legacy2', id: 'legacy2', requirement: 'r', flowTemplate: 'mini-flow' }, context);
  const regFile = registryPaths(workspace, 'legacy2').registryFile;
  const old = await readJson(regFile);
  delete old.entitySlug;
  old.schemaVersion = 1;
  old.title = 'Legacy2 原样';
  await writeJson(regFile, old);
  // 执行写回操作(advance 会写 REGISTRY)。
  await getTool(ctx, 'project_advance').execute({ projectId: 'legacy2' }, context);
  const after = await readJson(regFile);
  assert.equal(after.schemaVersion, 1, '不升 schemaVersion');
  assert.equal(after.entitySlug, undefined, '不新增 entitySlug');
  assert.equal(after.title, 'Legacy2 原样', 'title 原样保留');
  assert.equal(after.id, 'legacy2');
  assert.equal(after.flowRef, 'mini-flow@1');
  assert.equal(after.iteration, 1);
  assert.equal(after.stageIndex, 1, 'advance 正常推进');
});

test('C3:25 存量项目零影响实证(真实存量形状 schemaVersion=1 无 entitySlug 读+写回)', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const ctx = await mountPlugin();
  const context = sessionContext(workspace);
  // 用真实存量形状(project-hub/consumption-query 同款:schemaVersion=1 无 entitySlug)。
  await getTool(ctx, 'project_register').execute({ title: 'Hub', id: 'project-hub', requirement: 'r', flowTemplate: 'mini-flow' }, context);
  const regFile = registryPaths(workspace, 'project-hub').registryFile;
  const old = await readJson(regFile);
  delete old.entitySlug;
  old.schemaVersion = 1;
  await writeJson(regFile, old);
  // 读(assertRegistry/entitySlugOf)+ 写回(advance)。
  const detail = await getTool(ctx, 'project_status').execute({ projectId: 'project-hub' }, context);
  assert.equal(detail.project.entitySlug, 'project-hub', '缺省=项目自身');
  await getTool(ctx, 'project_advance').execute({ projectId: 'project-hub' }, context);
  const after = await readJson(regFile);
  assert.equal(after.schemaVersion, 1, '存量登记簿不升 schemaVersion');
  assert.equal(after.entitySlug, undefined, '存量登记簿不新增 entitySlug');
  assert.equal(after.id, 'project-hub');
  assert.equal(after.iteration, 1);
});

test('project_register:同名冲突 -2 递增;纯中文标题无 id 拒收并提示提供 id', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const ctx = await mountPlugin();
  const context = sessionContext(workspace);
  const first = await getTool(ctx, 'project_register').execute({ title: 'Demo App', requirement: 'r1' }, context);
  const second = await getTool(ctx, 'project_register').execute({ title: 'Demo App', requirement: 'r2' }, context);
  assert.equal(first.projectId, 'demo-app');
  assert.equal(second.projectId, 'demo-app-2');
  // 迭代7:纯中文标题未提供 id → 拒收并提示提供 id(不再退化为 project-<日期> 兜底 id)。
  await assert.rejects(
    () => getTool(ctx, 'project_register').execute({ title: '中文项目', requirement: 'r3' }, context),
    /请提供 id 入参/,
  );
  // 拒收不落盘:workspace 下没有 project-<日期> 目录。
  const entries = await readdir(workspace, { withFileTypes: true });
  assert.ok(!entries.some((e) => e.isDirectory() && /^project-\d{8}$/.test(e.name)), '纯中文拒收不产出日期前缀兜底 id');
});

// ── 迭代7 register 解耦单测(AC1-1~AC1-4)───────────────────────────────────

test('project_register:显式 id 合法 → projectId=id,title 自由中文(AC1-1)', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const ctx = await mountPlugin();
  const context = sessionContext(workspace);
  const result = await getTool(ctx, 'project_register').execute({
    title: '看板可用性:中文命名与需求背景可见',
    id: 'kanban-cn',
    requirement: '中文 title + 英文 slug id 解耦',
    flowTemplate: 'mini-flow',
  }, context);
  assert.equal(result.projectId, 'kanban-cn', 'projectId 由显式 id 决定');
  const registry = await readJson(registryPaths(workspace, 'kanban-cn').registryFile);
  assert.equal(registry.id, 'kanban-cn');
  assert.equal(registry.title, '看板可用性:中文命名与需求背景可见', 'title 自由中文,与 id 解耦');
  // REQUIREMENT.md 首行标题 = 中文 title(非英文 id)。
  const requirement = await readFile(registryPaths(workspace, 'kanban-cn').requirementFile, 'utf8');
  assert.ok(requirement.includes('# 需求:看板可用性:中文命名与需求背景可见'));
});

test('project_register:显式 id 非法(非 [a-z0-9-]、含分隔符或 ..)拒收(AC1-4)', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const ctx = await mountPlugin();
  const context = sessionContext(workspace);
  for (const bad of ['-lead', 'Uppercase', 'a/b', 'a\\b', '..', '.', 'x y', '', 'a..b', 'a b']) {
    await assert.rejects(
      () => getTool(ctx, 'project_register').execute({ title: '中文标题', id: bad, requirement: 'r' }, context),
      /id 非法/,
      `显式 id ${JSON.stringify(bad)} 应被拒收`,
    );
  }
  // 拒收不落盘:workspace 下除 .dsh-library(模板库)外无任何项目目录。
  const entries = await readdir(workspace, { withFileTypes: true });
  assert.ok(!entries.some((e) => e.isDirectory() && e.name !== '.dsh-library'), '非法 id 拒收不落盘');
});

test('project_register:混合 title(含 ASCII 片段)未传 id 维持现状 slugify(AC1-3)', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const ctx = await mountPlugin();
  const context = sessionContext(workspace);
  const result = await getTool(ctx, 'project_register').execute({ title: '重构 auth 模块', requirement: 'r' }, context);
  assert.equal(result.projectId, 'auth', '混合 title 取 ASCII 片段,向后兼容');
  const registry = await readJson(registryPaths(workspace, 'auth').registryFile);
  assert.equal(registry.title, '重构 auth 模块', 'title 保留原文');
});

test('project_register:显式 id 冲突 -2 递增(与 title 解耦)', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const ctx = await mountPlugin();
  const context = sessionContext(workspace);
  const first = await getTool(ctx, 'project_register').execute({ title: '中文甲', id: 'dup', requirement: 'r1' }, context);
  const second = await getTool(ctx, 'project_register').execute({ title: '中文乙', id: 'dup', requirement: 'r2' }, context);
  assert.equal(first.projectId, 'dup');
  assert.equal(second.projectId, 'dup-2');
  assert.equal((await readJson(registryPaths(workspace, 'dup').registryFile)).title, '中文甲');
  assert.equal((await readJson(registryPaths(workspace, 'dup-2').registryFile)).title, '中文乙');
});

test('project_register:flowStages 现场定制(免模板)+ budgetEstimate', async (t) => {
  const workspace = await makeWorkspace(t); // 空库:没有任何模板
  const ctx = await mountPlugin();
  const result = await getTool(ctx, 'project_register').execute({
    title: 'ad-hoc',
    requirement: 'r',
    flowStages: [
      { id: 'build', type: 'work', role: 'dev' },
      { id: 'ok', type: 'gate', title: '验收' },
    ],
    budgetEstimate: { tokens: 1000 },
  }, sessionContext(workspace));
  assert.equal(result.flowSummary.length, 2);
  const flow = await readJson(registryPaths(workspace, 'ad-hoc').flowFile);
  assert.equal(flow.id, 'ad-hoc');
  assert.equal(flow.source, 'adhoc@1');
  assert.equal(flow.revision, 1);
  const budget = await readJson(registryPaths(workspace, 'ad-hoc').budgetFile);
  assert.deepEqual(budget.estimate, { tokens: 1000 });
});

test('project_register:flowStages 整体替换显式模板的 stages', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const ctx = await mountPlugin();
  const result = await getTool(ctx, 'project_register').execute({
    title: 'Override',
    requirement: 'r',
    flowTemplate: 'mini-flow',
    flowStages: [{ id: 'only', type: 'work', role: 'dev' }],
  }, sessionContext(workspace));
  assert.equal(result.flowSummary.length, 1);
  const flow = await readJson(registryPaths(workspace, 'override').flowFile);
  assert.equal(flow.id, 'mini-flow');
  assert.equal(flow.source, 'mini-flow@1');
  assert.equal(flow.stages[0].id, 'only');
});

test('project_register:找不到模板时报中文错并列出可用模板', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const ctx = await mountPlugin();
  const context = sessionContext(workspace);
  // 显式给一个不存在的模板 id(不依赖 standard-flow 是否已由 preset 自带)。
  await assert.rejects(
    () => getTool(ctx, 'project_register').execute({ title: 'x', requirement: 'y', flowTemplate: 'ghost-flow' }, context),
    /找不到流程模板 "ghost-flow"/,
  );
  await assert.rejects(
    () => getTool(ctx, 'project_register').execute({ title: 'x', requirement: 'y', flowTemplate: 'ghost-flow' }, context),
    /mini-flow/,
  );
});

test('project_register:workspace 库里的 standard-flow 覆盖默认查找', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'standard-flow', [
    { id: 'single', type: 'work', role: 'dev' },
  ]);
  const ctx = await mountPlugin();
  const result = await getTool(ctx, 'project_register').execute({ title: 'Default Flow', requirement: 'r' }, sessionContext(workspace));
  assert.equal(result.flowSummary.length, 1);
  assert.equal(result.flowSummary[0].id, 'single');
});

test('project_register:title/requirement 必填;flowStages 非法阶段拒绝', async (t) => {
  const workspace = await makeWorkspace(t);
  const ctx = await mountPlugin();
  const context = sessionContext(workspace);
  await assert.rejects(() => getTool(ctx, 'project_register').execute({ requirement: 'r' }, context), /title/);
  await assert.rejects(() => getTool(ctx, 'project_register').execute({ title: 'x' }, context), /requirement/);
  await assert.rejects(
    () => getTool(ctx, 'project_register').execute({ title: 'x', requirement: 'r', flowStages: [{ id: 'a', type: 'nope' }] }, context),
    /flowStages/,
  );
  await assert.rejects(
    () => getTool(ctx, 'project_register').execute({ title: 'x', requirement: 'r', budgetEstimate: 'tokens' }, context),
    /budgetEstimate/,
  );
});

// ── project_advance ─────────────────────────────────────────────────────────

test('project_advance:常规推进写 journal 头条并刷新 updatedAt', async (t) => {
  const { workspace, ctx, projectId } = await registerMini(t);
  const paths = registryPaths(workspace, projectId);
  const before = (await readJson(paths.registryFile)).updatedAt;
  const result = await getTool(ctx, 'project_advance').execute(
    { projectId, note: '开工' },
    sessionContext(workspace),
  );
  assert.equal(result.stageIndex, 1);
  assert.equal(result.iteration, 1);
  assert.equal(result.stage.id, 'review');
  assert.equal(result.delivered, false);
  assert.equal(result.state, 'active');
  assert.ok(result.journalPath.includes('02-review.md'));
  assert.ok(existsSync(result.journalPath));
  const journal = await readFile(result.journalPath, 'utf8');
  assert.ok(journal.includes('review'));
  assert.ok(journal.includes('开工'), 'note 进 journal 头条');
  const registry = await readJson(paths.registryFile);
  assert.equal(registry.stageIndex, 1);
  assert.notEqual(registry.updatedAt, before);
});

test('project_advance:gate pending 拒绝;approve 清空后推进', async (t) => {
  const { workspace, ctx, projectId } = await registerMini(t);
  const context = sessionContext(workspace);
  const paths = registryPaths(workspace, projectId);
  await getTool(ctx, 'project_advance').execute({ projectId }, context); // → review(pending 未置)
  await getTool(ctx, 'project_gate').execute({
    projectId, stageId: 'review', action: 'present',
    package: { summary: '规格已就绪' },
  }, context);
  assert.equal((await readJson(paths.registryFile)).gateStatus, 'pending');
  await assert.rejects(
    () => getTool(ctx, 'project_advance').execute({ projectId }, context),
    /待裁决/,
  );
  await getTool(ctx, 'project_gate').execute({
    projectId, stageId: 'review', action: 'decide', decision: { verdict: 'approve' },
  }, context);
  assert.equal((await readJson(paths.registryFile)).gateStatus, 'approve');
  const result = await getTool(ctx, 'project_advance').execute({ projectId }, context);
  assert.equal(result.stageIndex, 2); // → wrap
  assert.equal((await readJson(paths.registryFile)).gateStatus, null, 'approve 推进时清空门禁态');
});

test('project_advance:revise 跳回 reviseTo 的 work 阶段并清门禁态', async (t) => {
  const { workspace, ctx, projectId } = await registerMini(t);
  const context = sessionContext(workspace);
  const gateTool = getTool(ctx, 'project_gate');
  await getTool(ctx, 'project_advance').execute({ projectId }, context); // → review
  await gateTool.execute({
    projectId, stageId: 'review', action: 'present',
    package: { summary: 's', materials: ['SPEC.md'], recommendation: '建议批准' },
  }, context);
  await assert.rejects(
    () => gateTool.execute({ projectId, stageId: 'review', action: 'decide', decision: { verdict: 'revise' } }, context),
    /reviseTo/,
  );
  await assert.rejects(
    () => gateTool.execute({ projectId, stageId: 'review', action: 'decide', decision: { verdict: 'revise', reviseTo: 'review' } }, context),
    /work 阶段/,
  );
  await assert.rejects(
    () => gateTool.execute({ projectId, stageId: 'review', action: 'decide', decision: { verdict: 'revise', reviseTo: 'ghost' } }, context),
    /不存在/,
  );
  const decided = await gateTool.execute({
    projectId, stageId: 'review', action: 'decide',
    decision: { verdict: 'revise', reviseTo: 'do', comment: '方向不对' },
  }, context);
  assert.equal(decided.gateStatus, 'revise');
  const result = await getTool(ctx, 'project_advance').execute({ projectId }, context);
  assert.equal(result.stageIndex, 0, '指针跳回 do');
  assert.equal(result.iteration, 1);
  assert.equal(result.stage.id, 'do');
  const registry = await readJson(registryPaths(workspace, projectId).registryFile);
  assert.equal(registry.gateStatus, null);
  // revise 回环:重走 work 后再次 present 开第 2 轮(同一门禁文件追加轮次)。
  await getTool(ctx, 'project_advance').execute({ projectId }, context); // do → review
  const present = await gateTool.execute({
    projectId, stageId: 'review', action: 'present', package: { summary: '第二轮摘要' },
  }, context);
  assert.equal(present.gateStatus, 'pending');
  const gateFile = await readFile(present.gatePath, 'utf8');
  assert.ok(gateFile.includes('第 2 轮呈递'));
  assert.ok(gateFile.includes('第二轮摘要'));
  assert.ok(gateFile.includes('方向不对'), '上一轮裁决意见保留');
});

test('project_gate:reject 置终态,此后 advance/decide 一律拒绝', async (t) => {
  const { workspace, ctx, projectId } = await registerMini(t);
  const context = sessionContext(workspace);
  const paths = registryPaths(workspace, projectId);
  await getTool(ctx, 'project_advance').execute({ projectId }, context);
  await getTool(ctx, 'project_gate').execute({
    projectId, stageId: 'review', action: 'present', package: { summary: 's' },
  }, context);
  const decided = await getTool(ctx, 'project_gate').execute({
    projectId, stageId: 'review', action: 'decide', decision: { verdict: 'reject', comment: '不做了' },
  }, context);
  assert.equal(decided.gateStatus, 'reject');
  const registry = await readJson(paths.registryFile);
  assert.equal(registry.state, 'rejected');
  await assert.rejects(() => getTool(ctx, 'project_advance').execute({ projectId }, context), /终态|否决/);
  await assert.rejects(
    () => getTool(ctx, 'project_gate').execute({ projectId, stageId: 'review', action: 'decide', decision: { verdict: 'approve' } }, context),
    /终态/,
  );
});

test('project_gate:重复 present 拒绝;未 present 就 decide 拒绝;stageId/类型校验', async (t) => {
  const { workspace, ctx, projectId } = await registerMini(t);
  const context = sessionContext(workspace);
  const gateTool = getTool(ctx, 'project_gate');
  // 尚未推进:当前阶段是 do(work)—— 非 gate 阶段不能 present,未到达的 review 不能操作。
  await assert.rejects(
    () => gateTool.execute({ projectId, stageId: 'do', action: 'present', package: { summary: 's' } }, context),
    /不是门禁/,
  );
  await assert.rejects(
    () => gateTool.execute({ projectId, stageId: 'review', action: 'present', package: { summary: 's' } }, context),
    /当前阶段/,
  );
  // 推进到 review(门禁态为 null):decide 的前置校验(须 pending)生效。
  await getTool(ctx, 'project_advance').execute({ projectId }, context);
  await assert.rejects(
    () => gateTool.execute({ projectId, stageId: 'review', action: 'decide', decision: { verdict: 'approve' } }, context),
    /待裁决/,
  );
  // package 缺失 / summary 空白。
  await assert.rejects(
    () => gateTool.execute({ projectId, stageId: 'review', action: 'present' }, context),
    /package/,
  );
  await assert.rejects(
    () => gateTool.execute({ projectId, stageId: 'review', action: 'present', package: { summary: '  ' } }, context),
    /summary/,
  );
  await gateTool.execute({ projectId, stageId: 'review', action: 'present', package: { summary: 's' } }, context);
  await assert.rejects(
    () => gateTool.execute({ projectId, stageId: 'review', action: 'present', package: { summary: 'again' } }, context),
    /重复 present/,
  );
});

test('project_advance:最后阶段无 appendStages = 结项(delivered);appendStages 开新迭代;终态拒绝', async (t) => {
  const { workspace, ctx, projectId } = await registerMini(t);
  const context = sessionContext(workspace);
  const paths = registryPaths(workspace, projectId);
  await advanceTo(t, ctx, workspace, projectId, 2); // → wrap(最后阶段)
  await assert.rejects(
    () => getTool(ctx, 'project_advance').execute({ projectId, appendStages: [{ id: 'a', type: 'work', role: 'dev' }, { id: 'a', type: 'work', role: 'dev' }] }, context),
    /appendStages/,
  );
  const result = await getTool(ctx, 'project_advance').execute({
    projectId,
    appendStages: [
      { id: 'fix', type: 'work', role: 'dev' },
      { id: 'final-gate', type: 'gate', title: '终审' },
    ],
  }, context);
  assert.equal(result.stageIndex, 3, '推进到追加的第一个阶段');
  assert.equal(result.stage.id, 'fix');
  assert.equal(result.iteration, 2, 'appendStages 开新迭代 iteration+1');
  const flow = await readJson(paths.flowFile);
  assert.equal(flow.stages.length, 5);
  assert.equal(flow.revision, 2);
  const registry = await readJson(paths.registryFile);
  assert.equal(registry.iteration, 2);
  assert.ok(existsSync(result.journalPath));

  // 走到追加流程的尽头:fix → final-gate(末阶段);门禁未呈递不可推进(2026-08-29 收紧),
  // 必须 present → decide approve → advance 才结项
  await getTool(ctx, 'project_advance').execute({ projectId }, context);
  await assert.rejects(
    () => getTool(ctx, 'project_advance').execute({ projectId }, context),
    /尚未呈递/,
    'gate 阶段未呈递(gateStatus=null)拒绝推进',
  );
  await getTool(ctx, 'project_gate').execute({ projectId, stageId: 'final-gate', action: 'present', package: { summary: '终审呈递' } }, context);
  await getTool(ctx, 'project_gate').execute({ projectId, stageId: 'final-gate', action: 'decide', decision: { verdict: 'approve' } }, context);
  const done = await getTool(ctx, 'project_advance').execute({ projectId }, context);
  assert.equal(done.delivered, true, '最后阶段无 appendStages 的推进 = 结项');
  assert.equal(done.state, 'delivered');
  assert.equal(done.journalPath, null, '结项不写 journal');
  const closed = await readJson(paths.registryFile);
  assert.equal(closed.state, 'delivered');
  await assert.rejects(
    () => getTool(ctx, 'project_advance').execute({ projectId }, context),
    /终态/,
    'delivered 后拒绝继续推进',
  );
});

test('project_advance:appendStages 在非最后阶段拒绝且不落盘', async (t) => {
  const { workspace, ctx, projectId } = await registerMini(t);
  const context = sessionContext(workspace);
  const paths = registryPaths(workspace, projectId);
  const before = (await readJson(paths.registryFile)).updatedAt;
  await assert.rejects(
    () => getTool(ctx, 'project_advance').execute({ projectId, appendStages: [{ id: 'x', type: 'work', role: 'dev' }] }, context),
    /最后一个阶段/,
  );
  const registry = await readJson(paths.registryFile);
  assert.equal(registry.updatedAt, before, '失败的推进不写盘');
});

// ── project_budget ──────────────────────────────────────────────────────────

test('project_budget:set-estimate/set-cap/commit/get 与 totals 聚合', async (t) => {
  const { workspace, ctx, projectId } = await registerMini(t);
  const context = sessionContext(workspace);
  const budgetTool = getTool(ctx, 'project_budget');
  const empty = await budgetTool.execute({ projectId, action: 'get' }, context);
  assert.deepEqual(empty.totals, { entries: 0, byRole: {}, bySource: {} });
  await budgetTool.execute({ projectId, action: 'set-estimate', estimate: { tokens: 5000 } }, context);
  await budgetTool.execute({ projectId, action: 'set-cap', cap: { tokens: 50000 } }, context);
  await budgetTool.execute({
    projectId, action: 'commit',
    entry: { stageId: 'do', role: 'dev', usage: { calls: 3 } },
  }, context);
  await budgetTool.execute({
    projectId, action: 'commit',
    entry: { stageId: 'do', role: 'tester', usage: { calls: 1 }, source: 'runtime-events' },
  }, context);
  const book = await budgetTool.execute({ projectId, action: 'get' }, context);
  assert.deepEqual(book.estimate, { tokens: 5000 });
  assert.deepEqual(book.cap, { tokens: 50000 });
  assert.equal(book.committed.length, 2);
  assert.equal(book.committed[0].source, 'self-report', 'source 默认 self-report');
  assert.equal(book.committed[0].iteration, 1);
  assert.deepEqual(book.totals, {
    entries: 2,
    byRole: { dev: 1, tester: 1 },
    bySource: { 'self-report': 1, 'runtime-events': 1 },
  });
  const saved = await readJson(registryPaths(workspace, projectId).budgetFile);
  assert.equal(saved.committed.length, 2);
});

test('project_budget:非法 source/usage/estimate 拒绝', async (t) => {
  const { workspace, ctx, projectId } = await registerMini(t);
  const context = sessionContext(workspace);
  const budgetTool = getTool(ctx, 'project_budget');
  await assert.rejects(
    () => budgetTool.execute({ projectId, action: 'commit', entry: { stageId: 'do', role: 'dev', usage: {}, source: 'guess' } }, context),
    /source/,
  );
  await assert.rejects(
    () => budgetTool.execute({ projectId, action: 'commit', entry: { stageId: 'do', role: 'dev', usage: '3' } }, context),
    /usage/,
  );
  await assert.rejects(
    () => budgetTool.execute({ projectId, action: 'commit', entry: { role: 'dev', usage: {} } }, context),
    /stageId/,
  );
  await assert.rejects(
    () => budgetTool.execute({ projectId, action: 'set-estimate', estimate: 5 }, context),
    /estimate/,
  );
  await assert.rejects(
    () => budgetTool.execute({ projectId, action: 'nope' }, context),
    /action/,
  );
});

// ── project_status ──────────────────────────────────────────────────────────

test('project_status:无参列全工作区项目;带 id 出详情', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const ctx = await mountPlugin();
  const context = sessionContext(workspace);
  await getTool(ctx, 'project_register').execute({ title: 'Alpha One', requirement: 'r', flowTemplate: 'mini-flow' }, context);
  await getTool(ctx, 'project_register').execute({ title: 'Beta Two', requirement: 'r', flowTemplate: 'mini-flow' }, context);
  const list = await getTool(ctx, 'project_status').execute({}, context);
  assert.deepEqual(list.projects.map((p) => p.id), ['alpha-one', 'beta-two']);
  assert.equal(list.projects[0].title, 'Alpha One');
  assert.equal(list.projects[0].state, 'active');
  const detail = await getTool(ctx, 'project_status').execute({ projectId: 'alpha-one' }, context);
  const p = detail.project;
  assert.equal(p.projectId, 'alpha-one');
  assert.equal(p.currentStage.id, 'do');
  assert.equal(p.gateStatus, null);
  assert.equal(p.budget.totals.entries, 0);
  assert.equal(p.summaryExists, false);
  assert.equal(p.flowRef, 'mini-flow@1');
  await assert.rejects(
    () => getTool(ctx, 'project_status').execute({ projectId: 'ghost' }, context),
    /读取|失败/,
  );
});

test('config.registryDir 自定义目录名:登记簿落在自定义目录且 status 可扫到', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const ctx = await mountPlugin({ registryDir: 'my-registry' });
  const context = sessionContext(workspace);
  await getTool(ctx, 'project_register').execute({ title: 'Custom Dir', requirement: 'r' }, context);
  assert.ok(existsSync(join(workspace, 'custom-dir', 'my-registry', 'REGISTRY.json')));
  assert.ok(!existsSync(join(workspace, 'custom-dir', '.dsh-project')));
  const list = await getTool(ctx, 'project_status').execute({}, context);
  assert.deepEqual(list.projects.map((p) => p.id), ['custom-dir']);
});

test('config.libraryDir 自定义库目录的模板可被选用', async (t) => {
  const workspace = await makeWorkspace(t);
  await mkdir(join(workspace, 'my-lib', 'flows'), { recursive: true });
  await writeJson(join(workspace, 'my-lib', 'flows', 'tiny.json'), {
    id: 'tiny',
    version: 1,
    stages: [{ id: 'only', type: 'work', role: 'dev' }],
  });
  const ctx = await mountPlugin({ libraryDir: 'my-lib' });
  const result = await getTool(ctx, 'project_register').execute(
    { title: 'Tiny', requirement: 'r', flowTemplate: 'tiny' },
    sessionContext(workspace),
  );
  assert.equal(result.flowSummary.length, 1);
  assert.equal(result.nextStage.id, 'only');
});

// ── 路径安全 ────────────────────────────────────────────────────────────────

test('projectId 路径逃逸:含分隔符、.. 或非 slug 一律拒绝', async (t) => {
  const workspace = await makeWorkspace(t);
  const ctx = await mountPlugin();
  const context = sessionContext(workspace);
  for (const bad of ['../evil', 'a/b', 'a\\b', '..', '.', 'x y', '-lead', '']) {
    await assert.rejects(
      () => getTool(ctx, 'project_status').execute({ projectId: bad }, context),
      /projectId 非法/,
      `projectId ${JSON.stringify(bad)} 应被拒绝`,
    );
    await assert.rejects(
      () => getTool(ctx, 'project_advance').execute({ projectId: bad }, context),
      /projectId 非法/,
    );
  }
  assert.ok(!existsSync(join(workspace, 'evil')));
});

// ── 渲染冒烟 ────────────────────────────────────────────────────────────────

test('output.render:各工具渲染出含关键信息的字符串', async (t) => {
  const { workspace, ctx, projectId } = await registerMini(t);
  const context = sessionContext(workspace);
  const registerText = getTool(ctx, 'project_register').output.render(
    {},
    { projectId: 'p1', projectDir: '/d/p1', state: 'active', flowSummary: [{ index: 0, id: 'a', type: 'work' }], nextStage: { index: 0, id: 'a', type: 'work', role: 'dev' }, baseDossier: { entity: 'p1', path: '/d/.dsh-base/p1', exists: false, draftNeeded: true } },
  ).map((b) => b.text).join('\n');
  assert.match(registerText, /p1/);
  assert.match(registerText, /下一阶段/);
  assert.match(registerText, /底座/);
  const advanceText = getTool(ctx, 'project_advance').output.render(
    { projectId },
    { stageIndex: 1, iteration: 1, stage: { index: 1, id: 'review', type: 'gate' }, journalPath: 'j.md', delivered: false, state: 'active' },
  ).map((b) => b.text).join('\n');
  assert.match(advanceText, /review/);
  assert.match(advanceText, /j\.md/);
  const gateText = getTool(ctx, 'project_gate').output.render(
    { projectId, stageId: 'review' },
    { gateStatus: 'pending', gatePath: 'g.md' },
  ).map((b) => b.text).join('\n');
  assert.match(gateText, /pending/);
  const budgetText = getTool(ctx, 'project_budget').output.render(
    { projectId, action: 'get' },
    { estimate: null, cap: null, committed: [], totals: { entries: 0, byRole: {}, bySource: {} } },
  ).map((b) => b.text).join('\n');
  assert.match(budgetText, /committed 0 条/);
  const listText = getTool(ctx, 'project_status').output.render({}, { projects: [] }).map((b) => b.text).join('\n');
  assert.match(listText, /还没有任何项目/);
  await getTool(ctx, 'project_register').execute({ title: 'Render One', requirement: 'r' }, context);
  const detailText = getTool(ctx, 'project_status').output.render(
    {},
    {
      project: {
        projectId: 'render-one', title: 'Render One', state: 'active', iteration: 1, stageIndex: 0,
        gateStatus: null, updatedAt: '2026-08-29T00:00:00.000Z', flowRef: 'mini-flow@1',
        currentStage: { index: 0, id: 'do', type: 'work', role: 'dev' },
        budget: { estimate: null, cap: null, totals: { entries: 0, byRole: {}, bySource: {} } },
        summaryExists: false,
      },
    },
  ).map((b) => b.text).join('\n');
  assert.match(detailText, /render-one/);
});

// ── project-lib.mjs 纯库(经本文件顺带覆盖,不单独建测试文件)──────────────

test('lib:slugify 清洗/回退/路径安全;nowStamp 格式', () => {
  assert.equal(slugify('Hello World!'), 'hello-world');
  assert.equal(slugify('  --A_B 2--'), 'a-b-2');
  assert.match(slugify('中文标题'), /^project-\d{8}$/);
  assert.match(slugify(''), /^project-\d{8}$/);
  assert.match(slugify(42), /^project-\d{8}$/);
  assert.equal(slugify('x'.repeat(100)).length, 64, '超长标题截断');
  // 无论输入什么,产出永远不含路径分隔符(硬约束)。
  for (const title of ['a/b\\c', '..', '.', '/', '\\', '###']) {
    assert.doesNotMatch(slugify(title), /[\\/]/);
  }
  assert.match(nowStamp(), /^\d{8}-\d{6}$/);
});

test('lib:slugifyStrict 复用清洗逻辑,回退分支返回 null(迭代7)', () => {
  // 与 slugify 一致:混合/ASCII 标题返回清洗后的 slug。
  assert.equal(slugifyStrict('Hello World!'), 'hello-world');
  assert.equal(slugifyStrict('  --A_B 2--'), 'a-b-2');
  assert.equal(slugifyStrict('重构 auth 模块'), 'auth');
  assert.equal(slugifyStrict('x'.repeat(100)).length, 64, '超长标题截断');
  // 纯中文/空/非字符串/路径逃逸 → null(slugify 会回退日期前缀的情形)。
  assert.equal(slugifyStrict('中文标题'), null);
  assert.equal(slugifyStrict(''), null);
  assert.equal(slugifyStrict(42), null);
  assert.equal(slugifyStrict('###'), null);
  assert.equal(slugifyStrict('a/b\\c'), 'a-b-c', '清洗已把分隔符替换为连字符,不触发路径回退');
  assert.equal(slugifyStrict('..'), null);
  assert.equal(slugifyStrict('.'), null);
  // 关键:真实标题「project 20260830」→ slug 'project-20260830'(非 null),
  // 证明用 /^project-\d{8}$/ 正则匹配 slugify 结果会误伤,须用本显式辅助函数。
  assert.equal(slugifyStrict('project 20260830'), 'project-20260830');
});

test('lib:validateStageList 校验(类型/必填/重复 id/未知键)', () => {
  assert.equal(validateStageList(MINI_STAGES).ok, true);
  assert.equal(validateStageList([]).ok, false);
  assert.equal(validateStageList('x').ok, false);
  assert.equal(validateStageList([{ id: 'a', type: 'nope' }]).ok, false);
  assert.equal(validateStageList([{ id: 'a', type: 'work' }]).ok, false, 'work 缺 role');
  assert.equal(validateStageList([{ id: 'a', type: 'gate' }]).ok, false, 'gate 缺 title');
  assert.equal(validateStageList([
    { id: 'a', type: 'work', role: 'dev' },
    { id: 'a', type: 'work', role: 'dev' },
  ]).ok, false, '重复 id');
  assert.equal(validateStageList([{ id: 'a', type: 'work', role: 'dev', wat: 1 }]).ok, false, '未知键');
  assert.equal(validateStageList([{ id: 'a b', type: 'work', role: 'dev' }]).ok, false, 'id 须 slug');
});

test('lib:validateFlow 校验(实例/模板同形,未知键与坏 version 拒绝)', () => {
  assert.equal(validateFlow({ schemaVersion: 1, id: 'f', version: 1, stages: MINI_STAGES, source: 'f@1', revision: 1 }).ok, true);
  assert.equal(validateFlow({ id: 'f', version: 1, stages: MINI_STAGES }).ok, true, '模板可无 source/revision');
  assert.equal(validateFlow({ id: 'f', version: 0, stages: MINI_STAGES }).ok, false);
  assert.equal(validateFlow({ id: 'f', version: 1, stages: MINI_STAGES, wat: 1 }).ok, false);
  assert.equal(validateFlow({ id: 'f', version: 1, stages: [] }).ok, false);
  assert.equal(validateFlow({ id: 'f', version: 1, stages: MINI_STAGES, schemaVersion: 2 }).ok, false);
  assert.equal(validateFlow('x').ok, false);
});

test('lib:validateRole 校验与归一化(workspace 缺省/危险相对路径)', () => {
  const ok = validateRole({ id: 'dev', summary: '开发', persona: '你是开发。' });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.workspace, 'project-root', 'workspace 缺省归一化');
  assert.equal(validateRole({ id: 'dev', summary: 's' }).ok, false, 'persona 缺失');
  assert.equal(validateRole({ id: 'dev', persona: 'p', summary: 's', wat: 1 }).ok, false, '未知顶层键');
  assert.equal(validateRole({ id: 'dev', persona: 'p', summary: 's', tools: { allow: ['read'], deny: ['bash'] } }).ok, false, 'allow/deny 二选一');
  assert.equal(validateRole({ id: 'dev', persona: 'p', summary: 's', model: { reasoningEffort: 'ultra' } }).ok, false);
  assert.equal(validateRole({ id: 'dev', persona: 'p', summary: 's', model: { maxTokens: 0 } }).ok, false);
  assert.equal(validateRole({ id: 'dev', persona: 'p', summary: 's', permissions: { approval: 'ask' } }).ok, false, 'P1 approval 固定 inherit');
  assert.equal(validateRole({ id: 'dev', persona: 'p', summary: 's', workspace: '../outside' }).ok, false, '拒绝 .. 段');
  assert.equal(validateRole({ id: 'dev', persona: 'p', summary: 's', workspace: 'C:\\out' }).ok, false, '拒绝绝对路径');
  assert.equal(
    validateRole({ id: 'dev', persona: 'p', summary: 's', tools: { allow: ['read', 'ask_user_question'] } }).ok,
    false,
    'allow 含 ask_user_question 拒绝(后台 continuable 角色提问无人应答会死锁,2026-08-29 实测)',
  );
  const custom = validateRole({
    id: 'dev', summary: 's', persona: 'p', workspace: 'sub/dir',
    tools: { deny: ['bash'] }, model: { maxTokens: 8, reasoningEffort: 'high' },
    permissions: { approval: 'inherit', scope: 'spec-only' },
  });
  assert.equal(custom.ok, true);
  assert.equal(custom.value.workspace, 'sub/dir');
});

test('lib:resolveLibrary workspace 覆盖 preset;坏条目跳过并带 errors;被覆盖的坏条目不报错', async (t) => {
  const workspace = await makeWorkspace(t);
  const presetDir = await mkdtemp(join(tmpdir(), 'project-registry-preset-'));
  t.after(() => rm(presetDir, { recursive: true, force: true }));
  await mkdir(join(presetDir, 'roles'), { recursive: true });
  await mkdir(join(presetDir, 'flows'), { recursive: true });
  await writeJson(join(presetDir, 'roles', 'good-p.json'), { id: 'good-p', summary: 's', persona: 'p' });
  await writeFile(join(presetDir, 'roles', 'bad-p.json'), '{oops', 'utf8');
  // shadow:JSON 合法但清单非法(id 可知),且同 id 会被 workspace 覆盖 → 应静默跳过不报错。
  await writeFile(join(presetDir, 'roles', 'shadow.json'), JSON.stringify({ id: 'shadow', summary: '缺 persona' }), 'utf8');
  await writeJson(join(presetDir, 'flows', 'fp.json'), { id: 'fp', version: 1, stages: MINI_STAGES });
  await mkdir(join(workspace, '.dsh-library', 'roles'), { recursive: true });
  await mkdir(join(workspace, '.dsh-library', 'flows'), { recursive: true });
  await writeJson(join(workspace, '.dsh-library', 'roles', 'good-w.json'), { id: 'good-w', summary: 's', persona: 'p' });
  await writeJson(join(workspace, '.dsh-library', 'roles', 'shadow.json'), { id: 'shadow', summary: 'w 胜', persona: 'p' });
  await writeJson(join(workspace, '.dsh-library', 'roles', 'bad-w.json'), { id: 'bad-w', summary: 's' });
  const lib = resolveLibrary({ workspaceDir: workspace, presetDir });
  assert.deepEqual([...lib.roles.keys()].sort(), ['good-p', 'good-w', 'shadow']);
  assert.equal(lib.roles.get('shadow').source, 'workspace', '同 id workspace 胜');
  assert.equal(lib.roles.get('good-p').source, 'preset');
  assert.ok(!lib.roleErrors.some((e) => e.file.includes('shadow')), '被 workspace 覆盖的 preset 坏条目(id 可知)不报错');
  assert.ok(lib.roleErrors.some((e) => e.file.includes('bad-p')));
  assert.ok(lib.roleErrors.some((e) => e.file.includes('bad-w')));
  assert.ok(lib.flows.get('fp').flow);
  assert.equal(lib.flowErrors.length, 0);
  // 缺目录 = 空层,不报错。
  const empty = resolveLibrary({ workspaceDir: undefined, presetDir: join(workspace, 'no-such-dir') });
  assert.equal(empty.roles.size, 0);
  assert.equal(empty.flows.size, 0);
  assert.deepEqual(empty.roleErrors, []);
});

test('lib:writeJson 2 空格缩进 + 末尾换行;readJson 往返与中文报错', async (t) => {
  const workspace = await makeWorkspace(t);
  const file = join(workspace, 'a', 'b.json');
  await writeJson(file, { b: 1, a: 'x' });
  const text = await readFile(file, 'utf8');
  assert.equal(text, '{\n  "b": 1,\n  "a": "x"\n}\n');
  assert.deepEqual(await readJson(file), { b: 1, a: 'x' });
  await assert.rejects(() => readJson(join(workspace, 'missing.json')), /读取 .* 失败/);
  const badFile = join(workspace, 'bad.json');
  await writeFile(badFile, 'not-json', 'utf8');
  await assert.rejects(() => readJson(badFile), /不是合法 JSON/);
});

test('lib:registryPaths 布局与 projectId 卫兵;BUDGET_SOURCES/STAGE_TYPES 钉死', () => {
  const root = join('ws-root');
  const paths = registryPaths(root, 'demo');
  assert.equal(paths.projectDir, join(root, 'demo'));
  assert.equal(paths.registryDir, join(root, 'demo', '.dsh-project'));
  assert.equal(paths.registryFile, join(root, 'demo', '.dsh-project', 'REGISTRY.json'));
  assert.equal(paths.flowFile, join(root, 'demo', '.dsh-project', 'FLOW.json'));
  assert.equal(paths.budgetFile, join(root, 'demo', '.dsh-project', 'BUDGET.json'));
  assert.equal(paths.requirementFile, join(root, 'demo', '.dsh-project', 'REQUIREMENT.md'));
  assert.equal(paths.summaryFile, join(root, 'demo', '.dsh-project', 'SUMMARY.md'));
  assert.equal(paths.journalDir, join(root, 'demo', '.dsh-project', 'journal'));
  assert.equal(paths.gatesDir, join(root, 'demo', '.dsh-project', 'gates'));
  assert.equal(paths.feedbackDir, join(root, 'demo', '.dsh-project', 'feedback'));
  assert.throws(() => registryPaths(root, '../x'), /projectId/);
  assert.throws(() => registryPaths(root, 'a/b'), /projectId/);
  assert.deepEqual(STAGE_TYPES, ['work', 'gate', 'summary', 'internalize']);
  assert.deepEqual(BUDGET_SOURCES, ['self-report', 'runtime-events', 'billing-plugin']);
});

// ── project_block(卡点通道,2026-08-30 流程补丁)──────────────────────────

test('project_block:report 登记卡点 + REGISTRY.blockers + journal 留痕', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'standard-flow', MINI_STAGES);
  const ctx = await mountPlugin();
  const context = sessionContext(workspace);
  const reg = await getTool(ctx, 'project_register').execute({ title: 'block demo', requirement: 'r' }, context);
  const projectId = reg.projectId;

  const out = await getTool(ctx, 'project_block').execute({
    projectId,
    action: 'report',
    category: 'acceptance-capability',
    reason: '视觉验收需要浏览器与视觉,角色沙箱均不具备',
    raisedBy: 'tester',
    options: ['用户侧浏览器验收(需设为 blocking)', '接入视觉模型管道'],
    recommendation: '用户侧验收',
  }, context);
  assert.equal(out.blocker.id, 'b1');
  assert.equal(out.blocker.status, 'open');
  assert.equal(out.blocker.stageIndex, 0);
  assert.equal(out.openBlockers, 1);

  const registry = await readJson(join(workspace, projectId, '.dsh-project', 'REGISTRY.json'));
  assert.equal(registry.blockers.length, 1);
  assert.equal(registry.blockers[0].category, 'acceptance-capability');
  assert.deepEqual(registry.blockers[0].options, ['用户侧浏览器验收(需设为 blocking)', '接入视觉模型管道']);

  const journal = await readFile(join(workspace, projectId, '.dsh-project', 'journal', '01-do.md'), 'utf8');
  assert.ok(journal.includes('卡点上报:b1'), 'journal 应含卡点上报留痕');
  assert.ok(journal.includes('acceptance-capability') || journal.includes('验收可行性'), '留痕应含分类');

  // status 两级都暴露 openBlockers
  const detail = await getTool(ctx, 'project_status').execute({ projectId }, context);
  assert.equal(detail.project.openBlockers, 1);
  const list = await getTool(ctx, 'project_status').execute({}, context);
  assert.equal(list.projects.find((p) => p.id === projectId).openBlockers, 1);
});

test('project_block:open 卡点期间 advance 拒绝;resolve 后恢复推进', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'standard-flow', MINI_STAGES);
  const ctx = await mountPlugin();
  const context = sessionContext(workspace);
  const reg = await getTool(ctx, 'project_register').execute({ title: 'block gate', requirement: 'r' }, context);
  const projectId = reg.projectId;
  const block = getTool(ctx, 'project_block');
  const advance = getTool(ctx, 'project_advance');

  await block.execute({ projectId, action: 'report', category: 'test-env', reason: '无真实上游可验证' }, context);
  await assert.rejects(() => advance.execute({ projectId }, context), /未解决卡点.*测试可行性/);

  await assert.rejects(
    () => block.execute({ projectId, action: 'resolve', blockerId: 'b1' }, context),
    /resolution/,
  );
  await assert.rejects(
    () => block.execute({ projectId, action: 'resolve', blockerId: 'b9', resolution: 'x' }, context),
    /不存在/,
  );
  const resolved = await block.execute({
    projectId,
    action: 'resolve',
    blockerId: 'b1',
    resolution: '用户裁决:改用 stub 上游单测,真实上游验证留给部署后',
  }, context);
  assert.equal(resolved.blocker.status, 'resolved');
  assert.equal(resolved.openBlockers, 0);
  await assert.rejects(
    () => block.execute({ projectId, action: 'resolve', blockerId: 'b1', resolution: '重复' }, context),
    /不能重复 resolve/,
  );

  const out = await advance.execute({ projectId }, context);
  assert.equal(out.stageIndex, 1);
  const list = await getTool(ctx, 'project_status').execute({}, context);
  assert.equal(list.projects.find((p) => p.id === projectId).openBlockers, 0);
});

test('project_block:report 校验(category 白名单/未知键/必填)+ list + 老登记簿兼容', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'standard-flow', MINI_STAGES);
  const ctx = await mountPlugin();
  const context = sessionContext(workspace);
  const reg = await getTool(ctx, 'project_register').execute({ title: 'block validate', requirement: 'r' }, context);
  const projectId = reg.projectId;
  const block = getTool(ctx, 'project_block');

  await assert.rejects(() => block.execute({ projectId, action: 'report', category: 'wat', reason: 'x' }, context), /category/);
  await assert.rejects(() => block.execute({ projectId, action: 'report' }, context), /reason/);
  await assert.rejects(() => block.execute({ projectId, action: 'report', reason: 'x', wat: 1 }, context), /未知键/);
  await assert.rejects(() => block.execute({ projectId, action: 'wat' }, context), /report\/resolve\/list/);

  const empty = await block.execute({ projectId, action: 'list' }, context);
  assert.deepEqual(empty.blockers, []);
  assert.equal(empty.openBlockers, 0);

  // 老登记簿(无 blockers 字段)兼容:advance 正常、report 后卡住
  const registryFile = join(workspace, projectId, '.dsh-project', 'REGISTRY.json');
  const old = await readJson(registryFile);
  delete old.blockers;
  await writeJson(registryFile, old);
  const out = await getTool(ctx, 'project_advance').execute({ projectId }, context);
  assert.equal(out.stageIndex, 1);
  await block.execute({ projectId, action: 'report', category: 'deploy-permission', reason: '沙箱写不进目标路径' }, context);
  await assert.rejects(() => getTool(ctx, 'project_advance').execute({ projectId }, context), /未解决卡点.*部署可行性/);

  // render 返回块数组(契约:contentHasImage 防线)
  const tool = getTool(ctx, 'project_block');
  const rendered = tool.output.render({ projectId, action: 'list' }, { blockers: [], openBlockers: 0 });
  assert.ok(Array.isArray(rendered) && rendered[0].type === 'text');
});

// ── 机制4 暂存区 parking(2026-08-30 流程补丁)────────────────────────────

test('parked:register parked:true → state=parked,入册成功(AC-m4-t1)', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const ctx = await mountPlugin();
  const context = sessionContext(workspace);
  const result = await getTool(ctx, 'project_register').execute({
    title: 'Parked Idea', requirement: '暂存的需求', flowTemplate: 'mini-flow', parked: true,
  }, context);
  assert.equal(result.projectId, 'parked-idea');
  assert.equal(result.state, 'parked');
  assert.equal(result.nextStage.id, 'do');
  // 入册照常:REGISTRY/FLOW/BUDGET/REQUIREMENT 落盘,stageIndex=0
  const paths = registryPaths(workspace, 'parked-idea');
  assert.ok(existsSync(paths.registryFile) && existsSync(paths.flowFile) && existsSync(paths.budgetFile) && existsSync(paths.requirementFile));
  const registry = await readJson(paths.registryFile);
  assert.equal(registry.state, 'parked');
  assert.equal(registry.stageIndex, 0);
  // status 可见 state=parked
  const detail = await getTool(ctx, 'project_status').execute({ projectId: 'parked-idea' }, context);
  assert.equal(detail.project.state, 'parked');
});

test('parked:register parked 参数校验(非布尔拒绝)', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const ctx = await mountPlugin();
  const context = sessionContext(workspace);
  await assert.rejects(
    () => getTool(ctx, 'project_register').execute({ title: 'x', requirement: 'r', parked: 'yes' }, context),
    /parked/,
  );
});

test('parked:advance activate:true → parked→active,stageIndex=0(AC-m4-t2/p4)', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const ctx = await mountPlugin();
  const context = sessionContext(workspace);
  await getTool(ctx, 'project_register').execute({ title: 'Parked Act', requirement: 'r', flowTemplate: 'mini-flow', parked: true }, context);
  const result = await getTool(ctx, 'project_advance').execute({ projectId: 'parked-act', activate: true }, context);
  assert.equal(result.activated, true);
  assert.equal(result.state, 'active');
  assert.equal(result.stageIndex, 0);
  assert.equal(result.stage.id, 'do');
  assert.equal(result.delivered, false);
  const registry = await readJson(registryPaths(workspace, 'parked-act').registryFile);
  assert.equal(registry.state, 'active');
  assert.equal(registry.stageIndex, 0);
  // 激活后可正常推进
  const next = await getTool(ctx, 'project_advance').execute({ projectId: 'parked-act' }, context);
  assert.equal(next.stageIndex, 1);
  assert.equal(next.stage.id, 'review');
});

test('parked:advance 不设 activate 一律拒绝(AC-m4-t2)', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const ctx = await mountPlugin();
  const context = sessionContext(workspace);
  await getTool(ctx, 'project_register').execute({ title: 'Parked Reject', requirement: 'r', flowTemplate: 'mini-flow', parked: true }, context);
  await assert.rejects(
    () => getTool(ctx, 'project_advance').execute({ projectId: 'parked-reject' }, context),
    /parked.*激活|激活.*parked/,
  );
  // 不落盘:state 仍 parked
  const registry = await readJson(registryPaths(workspace, 'parked-reject').registryFile);
  assert.equal(registry.state, 'parked');
});

test('parked:gate/block 对 parked 项目 assertActive 拒绝(AC-m4-t2)', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const ctx = await mountPlugin();
  const context = sessionContext(workspace);
  await getTool(ctx, 'project_register').execute({ title: 'Parked Gate', requirement: 'r', flowTemplate: 'mini-flow', parked: true }, context);
  await assert.rejects(
    () => getTool(ctx, 'project_gate').execute({ projectId: 'parked-gate', stageId: 'do', action: 'present', package: { summary: 's' } }, context),
    /终态|parked/,
  );
  await assert.rejects(
    () => getTool(ctx, 'project_block').execute({ projectId: 'parked-gate', action: 'report', category: 'other', reason: 'x' }, context),
    /终态|parked/,
  );
  // budget/status 对 parked 可用
  const budget = await getTool(ctx, 'project_budget').execute({ projectId: 'parked-gate', action: 'get' }, context);
  assert.equal(budget.totals.entries, 0);
  const detail = await getTool(ctx, 'project_status').execute({ projectId: 'parked-gate' }, context);
  assert.equal(detail.project.state, 'parked');
});

// ── 0.8.0 真实 token 计量:会话登记 / commit 自动填 / advance 联动 collect ──

test('会话登记:register 记 intake(auto-record);advance 记 coordinator(auto-record)', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const ctx = await mountPlugin();
  const context = sessionContext(workspace, 'intake-sess');
  await getTool(ctx, 'project_register').execute({ title: 'Sess Demo', requirement: 'r', flowTemplate: 'mini-flow' }, context);
  const paths = registryPaths(workspace, 'sess-demo');
  let registry = await readJson(paths.registryFile);
  assert.equal(registry.sessions['intake-sess'].role, 'intake', 'register 记 intake');
  assert.equal(registry.sessions['intake-sess'].capturePath, 'auto-record', '兜底路径 auto-record');
  // advance 记 coordinator(auto-record)
  await getTool(ctx, 'project_advance').execute({ projectId: 'sess-demo' }, sessionContext(workspace, 'coord-sess'));
  registry = await readJson(paths.registryFile);
  assert.equal(registry.sessions['coord-sess'].role, 'coordinator', 'advance 记 coordinator');
  assert.equal(registry.sessions['coord-sess'].capturePath, 'auto-record');
});

test('会话登记:advance 传 sessions 记 spawn-pass(主路捕获)', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const ctx = await mountPlugin();
  const context = sessionContext(workspace, 'coord-sess');
  await getTool(ctx, 'project_register').execute({ title: 'Spawn Pass', requirement: 'r', flowTemplate: 'mini-flow' }, context);
  await getTool(ctx, 'project_advance').execute({
    projectId: 'spawn-pass',
    sessions: [{ sessionId: 'dev-sess', role: 'dev' }, { sessionId: 'tester-sess', role: 'tester' }],
  }, context);
  const registry = await readJson(registryPaths(workspace, 'spawn-pass').registryFile);
  assert.equal(registry.sessions['dev-sess'].role, 'dev');
  assert.equal(registry.sessions['dev-sess'].capturePath, 'spawn-pass', '主路 spawn-pass');
  assert.equal(registry.sessions['tester-sess'].role, 'tester');
  assert.equal(registry.sessions['tester-sess'].capturePath, 'spawn-pass');
  // sessions 参数校验:非法项拒绝
  await assert.rejects(
    () => getTool(ctx, 'project_advance').execute({ projectId: 'spawn-pass', sessions: [{ sessionId: 'x' }] }, context),
    /sessions/,
  );
});

test('commit 自动填:source=runtime-events 且 usage 缺省 → 按调用者会话 id 读 projcache 填四桶', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const projcacheFile = await writeProjcache(workspace, {
    'dev-sess': { uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
  });
  const ctx = await mountPlugin({ projcachePath: projcacheFile });
  const context = sessionContext(workspace, 'dev-sess');
  await getTool(ctx, 'project_register').execute({ title: 'Auto Fill', requirement: 'r', flowTemplate: 'mini-flow' }, sessionContext(workspace, 'intake-sess'));
  const book = await getTool(ctx, 'project_budget').execute({
    projectId: 'auto-fill',
    action: 'commit',
    entry: { stageId: 'do', role: 'dev', source: 'runtime-events' },
  }, context);
  assert.equal(book.committed.length, 1);
  const entry = book.committed[0];
  assert.equal(entry.source, 'runtime-events');
  assert.deepEqual(entry.usage, {
    tokens: 120,
    uncachedInputTokens: 100,
    outputTokens: 20,
    sessionId: 'dev-sess',
  });
  assert.ok(entry.asOf, 'runtime-events 条目应带 asOf');
  assert.ok(entry.projcacheMtime, 'runtime-events 条目应带 projcacheMtime');
  // 会话登记:commit 记 entry.role(auto-record)
  const registry = await readJson(registryPaths(workspace, 'auto-fill').registryFile);
  assert.equal(registry.sessions['dev-sess'].role, 'dev');
  assert.equal(registry.sessions['dev-sess'].capturePath, 'auto-record');
});

test('commit 自动填:projcache 版本守卫(≠3 中文报错不误解析)', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const badFile = join(workspace, 'bad-projcache.json');
  await writeJson(badFile, { unit: { version: 2 }, tables: {} });
  const ctx = await mountPlugin({ projcachePath: badFile });
  const context = sessionContext(workspace, 'dev-sess');
  await getTool(ctx, 'project_register').execute({ title: 'Guard', requirement: 'r', flowTemplate: 'mini-flow' }, context);
  await assert.rejects(
    () => getTool(ctx, 'project_budget').execute({
      projectId: 'guard',
      action: 'commit',
      entry: { stageId: 'do', role: 'dev', source: 'runtime-events' },
    }, context),
    /版本不支持.*仅支持 3/,
  );
});

test('commit 自动填:调用者会话不在 projcache 表内 → 中文报错', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const projcacheFile = await writeProjcache(workspace, {
    'other-sess': { uncachedInputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  });
  const ctx = await mountPlugin({ projcachePath: projcacheFile });
  const context = sessionContext(workspace, 'dev-sess');
  await getTool(ctx, 'project_register').execute({ title: 'No Sess', requirement: 'r', flowTemplate: 'mini-flow' }, context);
  await assert.rejects(
    () => getTool(ctx, 'project_budget').execute({
      projectId: 'no-sess',
      action: 'commit',
      entry: { stageId: 'do', role: 'dev', source: 'runtime-events' },
    }, context),
    /不在 projcache 表内/,
  );
});

test('advance 联动 collect:重算私有会话真实 tokenUsage 按角色分桶写 committed(runtime-events)', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const projcacheFile = await writeProjcache(workspace, {
    'dev-sess': { uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
    'coord-sess': { uncachedInputTokens: 300, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 },
  });
  const ctx = await mountPlugin({ projcachePath: projcacheFile });
  const context = sessionContext(workspace, 'coord-sess');
  await getTool(ctx, 'project_register').execute({ title: 'Collect', requirement: 'r', flowTemplate: 'mini-flow' }, sessionContext(workspace, 'intake-sess'));
  // advance 传 dev 会话(spawn-pass);coordinator 会话经 auto-record 已登记。
  const result = await getTool(ctx, 'project_advance').execute({
    projectId: 'collect',
    sessions: [{ sessionId: 'dev-sess', role: 'dev' }],
  }, context);
  assert.equal(result.collected.ok, true, 'collect 应成功');
  const book = await readJson(registryPaths(workspace, 'collect').budgetFile);
  const runtime = book.committed.filter((e) => e.source === 'runtime-events');
  // intake 会话(共享)不进账本;dev + coordinator 私有会话按角色分桶。
  assert.equal(runtime.length, 2, 'dev + coordinator 两桶');
  const dev = runtime.find((e) => e.role === 'dev');
  const coord = runtime.find((e) => e.role === 'coordinator');
  assert.equal(dev.usage.tokens, 120, 'dev 桶 = 100+20');
  assert.equal(coord.usage.tokens, 340, 'coordinator 桶 = 300+40');
  assert.ok(dev.asOf && dev.projcacheMtime, 'collect 条目应带 asOf/projcacheMtime');
});

test('advance 联动 collect:R2 替换语义——移除全部 runtime-events 条目重写,同一 sessionId 不重复计数', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const projcacheFile = await writeProjcache(workspace, {
    'dev-sess': { uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
  });
  const ctx = await mountPlugin({ projcachePath: projcacheFile });
  const context = sessionContext(workspace, 'dev-sess');
  await getTool(ctx, 'project_register').execute({ title: 'R2', requirement: 'r', flowTemplate: 'mini-flow' }, sessionContext(workspace, 'intake-sess'));
  // A:commit 自动填一条 runtime-events(dev-sess, tokens=120)
  await getTool(ctx, 'project_budget').execute({
    projectId: 'r2',
    action: 'commit',
    entry: { stageId: 'do', role: 'dev', source: 'runtime-events' },
  }, context);
  let book = await readJson(registryPaths(workspace, 'r2').budgetFile);
  assert.equal(book.committed.filter((e) => e.source === 'runtime-events').length, 1, 'A 写入一条');
  // advance 触发 collect:R2 替换,移除 A 条目重写为 dev 桶一条。
  await getTool(ctx, 'project_advance').execute({
    projectId: 'r2',
    sessions: [{ sessionId: 'dev-sess', role: 'dev' }],
  }, context);
  book = await readJson(registryPaths(workspace, 'r2').budgetFile);
  const runtime = book.committed.filter((e) => e.source === 'runtime-events');
  assert.equal(runtime.length, 1, 'R2 替换后仅一条 runtime-events(dev 桶)');
  assert.equal(runtime[0].role, 'dev');
  assert.equal(runtime[0].usage.tokens, 120, '同一 sessionId 只计一次,不双重计数(120 而非 240)');
});

test('advance 联动 collect:projcache 缺失/读失败 → 非致命,advance 照常推进,note 说明', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  // 显式给一个不存在的 projcachePath → collect 非致命跳过(不依赖 DSH_HOME 是否设置)。
  const ctx = await mountPlugin({ projcachePath: join(workspace, 'missing-projcache.json') });
  const context = sessionContext(workspace, 'coord-sess');
  await getTool(ctx, 'project_register').execute({ title: 'No Cache', requirement: 'r', flowTemplate: 'mini-flow' }, context);
  const result = await getTool(ctx, 'project_advance').execute({ projectId: 'no-cache' }, context);
  assert.equal(result.stageIndex, 1, 'advance 照常推进');
  assert.equal(result.collected.ok, false, 'collect 非致命失败');
  assert.ok(result.collected.note, 'note 说明原因');
});

test('advance 联动 collect:sibling REGISTRY 读取失败按非致命处理(C2),不阻断 advance', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const projcacheFile = await writeProjcache(workspace, {
    'dev-sess': { uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
  });
  const ctx = await mountPlugin({ projcachePath: projcacheFile });
  const context = sessionContext(workspace, 'coord-sess');
  await getTool(ctx, 'project_register').execute({ title: 'Main', requirement: 'r', flowTemplate: 'mini-flow' }, context);
  // 造一个坏 sibling REGISTRY(坏 JSON)
  await mkdir(join(workspace, 'bad-sibling', '.dsh-project'), { recursive: true });
  await writeFile(join(workspace, 'bad-sibling', '.dsh-project', 'REGISTRY.json'), '{bad', 'utf8');
  const result = await getTool(ctx, 'project_advance').execute({
    projectId: 'main',
    sessions: [{ sessionId: 'dev-sess', role: 'dev' }],
  }, context);
  assert.equal(result.stageIndex, 1, 'advance 照常推进,不被坏 sibling 阻断');
  assert.equal(result.collected.ok, true, 'collect 仍成功');
  assert.ok(result.collected.note && result.collected.note.includes('bad-sibling'), 'note 说明跳过的 sibling');
});
