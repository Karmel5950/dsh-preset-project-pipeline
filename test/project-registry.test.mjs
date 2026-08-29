// project-registry 插件单测(A 路)。运行:
//   cd presets/project-pipeline && node --test test/project-registry.test.mjs
// 打法:os.tmpdir 下 mkdtemp 临时 workspace(自建自清),stub ctx 挂插件后
// 直接驱动 tool.execute(args, context);会话 cwd 按调研结论注入
// context.agent.session.header.cwd(SPEC §6)。不 import B 路的 project-roles.mjs。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

/** 会话 cwd 注入:按调研结论,execute 第二参携带 agent.session.header.cwd。 */
const sessionContext = (workspace) => ({ agent: { session: { header: { cwd: workspace } } } });

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

/** 推进到指定下标(逐段常规推进;遇门禁自动 present+approve)。 */
async function advanceTo(t, ctx, workspace, projectId, targetIndex) {
  const advance = getTool(ctx, 'project_advance');
  const gateTool = getTool(ctx, 'project_gate');
  const context = sessionContext(workspace);
  for (let index = 0; index < targetIndex; index++) {
    const state = await getTool(ctx, 'project_status').execute({ projectId }, context);
    if (state.project.gateStatus === 'pending') {
      await gateTool.execute({
        projectId,
        stageId: state.project.currentStage.id,
        action: 'decide',
        decision: { verdict: 'approve' },
      }, context);
    }
    await advance.execute({ projectId }, context);
  }
}

// ── 插件元数据与挂载 ────────────────────────────────────────────────────────

test('插件元数据:5 个工具 + 1 条手册提示段(注册常驻,不接线 ctx.effect)', async () => {
  const ctx = await mountPlugin();
  assert.equal(name, 'project-pipeline-registry');
  assert.deepEqual(inject, ['tools', 'systemPrompt']);
  assert.deepEqual(ctx.tools.items.map((item) => item.name).sort(), [
    'project_advance',
    'project_budget',
    'project_gate',
    'project_register',
    'project_status',
  ]);
  assert.equal(ctx.systemPrompt.items.length, 1);
  const section = ctx.systemPrompt.items[0];
  assert.equal(section.name, 'project-pipeline/manual');
  assert.equal(section.order, 140);
  for (const word of [...STAGE_TYPES, 'project_register', 'project_advance', 'project_gate', 'project_budget commit', 'project_status', 'role_show', 'flow_show', 'self-report', '.dsh-project', 'settlement']) {
    assert.ok(section.text.includes(word), `手册段应包含 ${word}`);
  }
});

test('config 校验:registryDir/libraryDir 非法时挂载即失败(fail-fast)', async () => {
  await assert.rejects(() => mountPlugin({ registryDir: '' }), /registryDir/);
  await assert.rejects(() => mountPlugin({ registryDir: 'a/b' }), /registryDir/);
  await assert.rejects(() => mountPlugin({ registryDir: '..' }), /registryDir/);
  await assert.rejects(() => mountPlugin({ libraryDir: 42 }), /libraryDir/);
  await assert.rejects(() => mountPlugin({ wat: 1 }), /未知键/);
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
  assert.equal(registry.schemaVersion, 1);
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

test('project_register:同名冲突 -2 递增;纯中文标题退化为日期前缀', async (t) => {
  const workspace = await makeWorkspace(t);
  await writeTemplate(workspace, 'mini-flow');
  const ctx = await mountPlugin();
  const context = sessionContext(workspace);
  const first = await getTool(ctx, 'project_register').execute({ title: 'Demo App', requirement: 'r1' }, context);
  const second = await getTool(ctx, 'project_register').execute({ title: 'Demo App', requirement: 'r2' }, context);
  assert.equal(first.projectId, 'demo-app');
  assert.equal(second.projectId, 'demo-app-2');
  const cn = await getTool(ctx, 'project_register').execute({ title: '中文项目', requirement: 'r3' }, context);
  assert.match(cn.projectId, /^project-\d{8}$/);
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

test('project_advance:最后阶段无 appendStages 拒绝;合法 appendStages 开新迭代', async (t) => {
  const { workspace, ctx, projectId } = await registerMini(t);
  const context = sessionContext(workspace);
  const paths = registryPaths(workspace, projectId);
  await advanceTo(t, ctx, workspace, projectId, 2); // → wrap(最后阶段)
  await assert.rejects(
    () => getTool(ctx, 'project_advance').execute({ projectId }, context),
    /最后一个阶段/,
  );
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
    { projectId: 'p1', projectDir: '/d/p1', flowSummary: [{ index: 0, id: 'a', type: 'work' }], nextStage: { index: 0, id: 'a', type: 'work', role: 'dev' } },
  ).map((b) => b.text).join('\n');
  assert.match(registerText, /p1/);
  assert.match(registerText, /下一阶段/);
  const advanceText = getTool(ctx, 'project_advance').output.render(
    { projectId },
    { stageIndex: 1, iteration: 1, stage: { index: 1, id: 'review', type: 'gate' }, journalPath: 'j.md' },
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
