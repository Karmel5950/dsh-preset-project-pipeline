// project-roles 插件单测(零依赖,node:test + stub ctx)。
//
// lib 容错说明(集成期处理):本插件依赖 A 路并行实现的 ../plugins/project-lib.mjs。
// 测试文件顶部做容错——真模块已存在则直接真 import(A 完成后自动切换,stub 不再
// 被使用);未就绪则使用下方 makeLibStub() 构造的最小 stub(仅测试用,简化实现),
// 覆盖行为:目录扫描与 workspace 覆盖(workspace 胜)、坏条目跳过并带 errors、
// 角色清单 §3.4 校验、流程模板 §3.2 校验(未知 type / 重复 id / gate 缺 title)。
// 集成期主线程可删除 makeLibStub 并固定为真 import。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, name, inject, validateConfig, sessionWorkspaceOf } from '../plugins/project-roles.mjs';
import { makeStubCtx } from '../../../toolkit/stub-ctx.mjs';

// ---------------------------------------------------------------------------
// lib 装载:优先真 lib(A 路完成即自动切换);未就绪时用最小 stub。
// ---------------------------------------------------------------------------
let realLib = null;
try {
  realLib = await import('../plugins/project-lib.mjs');
} catch {
  realLib = null; // A 路尚未完成,走 stub。
}
const lib = realLib ?? makeLibStub();
const usingRealLib = realLib !== null;

// —— 最小 stub lib(仅测试用;集成期切换真 project-lib.mjs)——
function makeLibStub() {
  const STAGE_TYPES = ['work', 'gate', 'summary', 'internalize'];
  const ROLE_KEYS = ['id', 'summary', 'persona', 'model', 'tools', 'workspace', 'permissions'];
  const STAGE_KEYS = ['id', 'type', 'role', 'produces', 'note', 'title', 'present'];
  const bad = (error) => ({ ok: false, error });

  function validateRole(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return bad('角色清单必须是 JSON 对象');
    for (const key of Object.keys(obj)) {
      if (!ROLE_KEYS.includes(key)) return bad(`未知顶层键 "${key}"`);
    }
    if (typeof obj.id !== 'string' || obj.id.length === 0) return bad('id 必须是非空字符串');
    if (typeof obj.summary !== 'string' || obj.summary.length === 0) return bad('summary 必须是非空字符串');
    if (typeof obj.persona !== 'string' || obj.persona.trim().length === 0) return bad('persona 必须是非空字符串');
    if (obj.model !== undefined) {
      if (!obj.model || typeof obj.model !== 'object' || Array.isArray(obj.model)) return bad('model 必须是对象');
      for (const [key, type] of Object.entries({ provider: 'string', model: 'string', maxTokens: 'number', reasoningEffort: 'string' })) {
        if (obj.model[key] !== undefined && typeof obj.model[key] !== type) return bad(`model.${key} 必须是 ${type}`);
      }
      if (obj.model.reasoningEffort !== undefined && !['off', 'high', 'max'].includes(obj.model.reasoningEffort)) {
        return bad('model.reasoningEffort 必须是 off|high|max');
      }
    }
    if (obj.tools !== undefined) {
      if (!obj.tools || typeof obj.tools !== 'object' || Array.isArray(obj.tools)) return bad('tools 必须是对象');
      const { allow, deny } = obj.tools;
      if (allow !== undefined && deny !== undefined) return bad('tools.allow 与 tools.deny 只能二选一');
      if (allow === undefined && deny === undefined) return bad('tools 必须声明 allow 或 deny');
      for (const list of [allow, deny]) {
        if (list !== undefined && (!Array.isArray(list) || list.some((t) => typeof t !== 'string'))) {
          return bad('tools.allow/deny 必须是字符串数组');
        }
      }
    }
    if (obj.workspace !== undefined && (typeof obj.workspace !== 'string' || obj.workspace.length === 0)) {
      return bad('workspace 必须是非空字符串');
    }
    if (obj.permissions !== undefined) {
      if (!obj.permissions || typeof obj.permissions !== 'object' || Array.isArray(obj.permissions)) return bad('permissions 必须是对象');
      if (obj.permissions.approval !== undefined && obj.permissions.approval !== 'inherit') {
        return bad("permissions.approval 在 P1 固定为 'inherit'");
      }
    }
    return { ok: true, value: obj };
  }

  function validateStageList(stages) {
    if (!Array.isArray(stages) || stages.length === 0) return bad('stages 必须是非空数组');
    const seen = new Set();
    for (const stage of stages) {
      if (!stage || typeof stage !== 'object' || Array.isArray(stage)) return bad('每个阶段必须是对象');
      for (const key of Object.keys(stage)) {
        if (!STAGE_KEYS.includes(key)) return bad(`阶段 "${stage.id ?? '?'}" 有未知键 "${key}"`);
      }
      if (typeof stage.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(stage.id)) return bad('阶段 id 必须是非空 slug');
      if (seen.has(stage.id)) return bad(`阶段 id 重复:"${stage.id}"`);
      seen.add(stage.id);
      if (!STAGE_TYPES.includes(stage.type)) return bad(`阶段 "${stage.id}" 使用了未知阶段类型 "${stage.type}"`);
      if (stage.type === 'work' && (typeof stage.role !== 'string' || stage.role.length === 0)) return bad(`work 阶段 "${stage.id}" 缺少 role`);
      if (stage.type === 'gate' && (typeof stage.title !== 'string' || stage.title.length === 0)) return bad(`gate 阶段 "${stage.id}" 缺少 title`);
      for (const key of ['produces', 'present']) {
        if (stage[key] !== undefined && (!Array.isArray(stage[key]) || stage[key].some((v) => typeof v !== 'string'))) {
          return bad(`阶段 "${stage.id}" 的 ${key} 必须是字符串数组`);
        }
      }
      if (stage.note !== undefined && typeof stage.note !== 'string') return bad(`阶段 "${stage.id}" 的 note 必须是字符串`);
    }
    return { ok: true, value: stages };
  }

  function validateFlow(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return bad('流程模板必须是 JSON 对象');
    for (const key of Object.keys(obj)) {
      if (!['schemaVersion', 'id', 'version', 'stages'].includes(key)) return bad(`未知顶层键 "${key}"`);
    }
    if (obj.schemaVersion !== 1) return bad('schemaVersion 必须为 1');
    if (typeof obj.id !== 'string' || obj.id.length === 0) return bad('id 必须是非空字符串');
    if (typeof obj.version !== 'number') return bad('version 必须是数字');
    const stages = validateStageList(obj.stages);
    if (!stages.ok) return stages;
    return { ok: true, value: obj };
  }

  async function scanDir(dir, source, map, errors, validate, entryKey) {
    let fileNames;
    try {
      fileNames = await readdirSafe(dir);
    } catch {
      return; // 目录不存在 → 视为空库。
    }
    for (const fileName of fileNames.sort()) {
      const file = path.join(dir, fileName);
      let raw;
      try {
        raw = JSON.parse(await readFile(file, 'utf8'));
      } catch (error) {
        errors.push({ file, error: `JSON 解析失败:${error.message}` });
        continue;
      }
      const checked = validate(raw);
      if (!checked.ok) {
        errors.push({ file, error: checked.error });
        continue;
      }
      map.set(checked.value.id, { [entryKey]: checked.value, source });
    }
  }

  async function readdirSafe(dir) {
    const { readdir } = await import('node:fs/promises');
    return (await readdir(dir)).filter((n) => n.endsWith('.json'));
  }

  return {
    STAGE_TYPES,
    validateRole,
    validateFlow,
    validateStageList,
    // 与 SPEC §5 同形:roles/flows 为 Map,workspace 覆盖 preset(同 id workspace 胜)。
    async resolveLibrary({ workspaceDir, presetDir, libraryDir = '.dsh-library' }) {
      const roles = new Map();
      const flows = new Map();
      const roleErrors = [];
      const flowErrors = [];
      await scanDir(path.join(presetDir, 'roles'), 'preset', roles, roleErrors, validateRole, 'manifest');
      await scanDir(path.join(workspaceDir, libraryDir, 'roles'), 'workspace', roles, roleErrors, validateRole, 'manifest');
      await scanDir(path.join(presetDir, 'flows'), 'preset', flows, flowErrors, validateFlow, 'flow');
      await scanDir(path.join(workspaceDir, libraryDir, 'flows'), 'workspace', flows, flowErrors, validateFlow, 'flow');
      return { roles, flows, roleErrors, flowErrors };
    },
  };
}

// ---------------------------------------------------------------------------
// 测试脚手架。
// ---------------------------------------------------------------------------
const TOOL_NAMES = ['role_list', 'role_show', 'flow_list', 'flow_show'];

/** 挂载插件并返回按名索引的工具表。 */
async function mountTools(libModule, config = {}) {
  const ctx = makeStubCtx({ services: { 'project-lib': libModule } });
  await apply(ctx, config);
  assert.equal(ctx.tools.items.length, TOOL_NAMES.length, '应注册 4 个工具');
  const byName = Object.fromEntries(ctx.tools.items.map((tool) => [tool.name, tool]));
  return { ctx, byName };
}

/** execute 上下文桩:官方 fs 工具同款姿势(agent.session.header.cwd)。 */
function execFor(cwd) {
  return { agent: { session: { header: { cwd } } } };
}

/** 建临时 workspace(自建自清)。 */
async function withWorkspace(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pp-roles-test-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeJsonFile(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeRawFile(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, 'utf8');
}

// ---------------------------------------------------------------------------
// 用例。
// ---------------------------------------------------------------------------
test('插件元数据:name/inject 符合 SPEC §4', () => {
  assert.equal(name, 'project-pipeline-roles');
  assert.deepEqual(inject, ['tools']);
});

test('validateConfig:非法配置 fail-fast,合法配置回落默认', () => {
  assert.deepEqual(validateConfig({}), { libraryDir: '.dsh-library' });
  assert.deepEqual(validateConfig({ libraryDir: 'my-lib' }), { libraryDir: 'my-lib' });
  assert.throws(() => validateConfig({ libraryDir: '' }), /libraryDir/);
  assert.throws(() => validateConfig({ libraryDir: 42 }), /libraryDir/);
  assert.throws(() => validateConfig({ libraryDir: '/abs/path' }), /libraryDir/);
  assert.throws(() => validateConfig({ libraryDir: 'a/../b' }), /libraryDir/);
  assert.throws(() => validateConfig({ unknown: 1 }), /不支持的 config 键/);
});

test('apply 注册 4 个工具(注册常驻,不接线 ctx.effect)', async () => {
  const { ctx } = await mountTools(lib);
  assert.deepEqual(
    ctx.tools.items.map((tool) => tool.name).sort(),
    [...TOOL_NAMES].sort(),
  );
});

test('每个工具都有纯 JSON Schema 参数与 output.schema/render', async () => {
  const { byName } = await mountTools(lib);
  for (const toolName of TOOL_NAMES) {
    const tool = byName[toolName];
    assert.equal(tool.parameters.type, 'object', `${toolName} parameters 应为 JSON Schema`);
    assert.equal(tool.output.schema.type, 'object', `${toolName} output.schema 应为 JSON Schema`);
    assert.equal(typeof tool.output.render, 'function', `${toolName} 应有 render`);
    assert.equal(typeof tool.execute, 'function', `${toolName} 应有 execute`);
  }
});

test('preset 自带库可读:6 角色 + standard-flow(11 阶段)+ iteration-flow(7 阶段)', async () =>
  withWorkspace(async (workspace) => {
    const { byName } = await mountTools(lib);
    const exec = execFor(workspace);

    const roles = await byName.role_list.execute({}, exec);
    assert.deepEqual(
      roles.roles.map((role) => role.id),
      ['architect', 'coordinator', 'deliverer', 'dev', 'product', 'tester'],
    );
    assert.ok(roles.roles.every((role) => role.source === 'preset'));
    assert.deepEqual(roles.errors, []);

    for (const role of roles.roles) {
      const shown = await byName.role_show.execute({ role: role.id }, exec);
      assert.equal(shown.id, role.id);
      assert.ok(shown.persona.trim().length > 0, `${role.id} persona 非空`);
      assert.ok(shown.persona.length <= 700, `${role.id} persona 不超过 700 字(0.3.1 触点比对语义再放开)`);
      assert.ok(shown.subagent.toolFilter.allow.includes('project_budget'), `${role.id} allow 含 project_budget`);
      assert.equal(shown.subagent.agentOptions, undefined, '清单未声明 model 时不应有 agentOptions');
      assert.match(shown.workspaceNote, /\.dsh-project\//);
      // P1:六角色均带 readings;未给 projectId 时返回原始模板(含 {{base}}/{{project}})。
      assert.ok(Array.isArray(shown.readings) && shown.readings.length > 0, `${role.id} readings 非空`);
      assert.ok(shown.readings.every((r) => r.includes('{{base}}') || r.includes('{{project}}')), `${role.id} readings 为原始模板`);
      // 编译后 persona(进场必读头+正文)不超 MAX_COMPILED_PERSONA(1000)。
      assert.ok(shown.subagent.persona.length <= 1000, `${role.id} 编译后 persona ≤1000`);
      assert.ok(shown.subagent.persona.includes('进场必读:'), `${role.id} 编译后 persona 含进场必读头`);
    }

    const flows = await byName.flow_list.execute({}, exec);
    assert.equal(flows.flows.length, 2, 'standard-flow + iteration-flow');
    const std = flows.flows.find((f) => f.id === 'standard-flow');
    assert.equal(std.version, 1);
    assert.equal(std.source, 'preset');
    assert.equal(std.stageCount, 11);
    const iter = flows.flows.find((f) => f.id === 'iteration-flow');
    assert.equal(iter.version, 1);
    assert.equal(iter.source, 'preset');
    assert.equal(iter.stageCount, 7);

    const flow = await byName.flow_show.execute({ flow: 'standard-flow' }, exec);
    assert.deepEqual(
      flow.stages.map((stage) => stage.id),
      ['clarify', 'spec-gate', 'design', 'mid-summary', 'design-gate', 'build', 'test', 'accept', 'delivery-gate', 'wrap', 'harvest'],
    );
    const accept = flow.stages.find((stage) => stage.id === 'accept');
    assert.equal(accept.role, 'product');
    assert.match(accept.note, /代用户首轮验收/);
    assert.equal(flow.stages.find((stage) => stage.id === 'harvest').type, 'internalize');

    const iterFlow = await byName.flow_show.execute({ flow: 'iteration-flow' }, exec);
    assert.deepEqual(
      iterFlow.stages.map((stage) => stage.id),
      ['prelude', 'clarify', 'build', 'test', 'delivery-gate', 'wrap', 'harvest'],
    );
    assert.equal(iterFlow.stages[0].type, 'work', 'prelude 是 work(不加新阶段类型)');
    assert.equal(iterFlow.stages[0].role, 'coordinator');
    assert.equal(iterFlow.stages[6].type, 'work', 'harvest 是 work(更新底座)');
    assert.equal(iterFlow.stages[6].role, 'coordinator');
  }));

test('库合并:workspace 覆盖 preset(同 id workspace 胜),workspace 新增条目可见', async () =>
  withWorkspace(async (workspace) => {
    await writeJsonFile(path.join(workspace, '.dsh-library', 'roles', 'product.json'), {
      id: 'product',
      summary: 'workspace 覆盖版产品 AI',
      persona: '你是 workspace 覆盖版的产品 AI。',
      tools: { allow: ['read', 'project_budget'] },
      workspace: 'project-root',
    });
    await writeJsonFile(path.join(workspace, '.dsh-library', 'roles', 'qa.json'), {
      id: 'qa',
      summary: 'workspace 新增的质检角色',
      persona: '你是质检角色。',
      tools: { deny: ['bash'] },
    });
    await writeJsonFile(path.join(workspace, '.dsh-library', 'flows', 'standard-flow.json'), {
      schemaVersion: 1,
      id: 'standard-flow',
      version: 2,
      stages: [
        { id: 'do', type: 'work', role: 'dev' },
        { id: 'ok', type: 'gate', title: '完工确认' },
      ],
    });

    const { byName } = await mountTools(lib);
    const exec = execFor(workspace);

    const roles = await byName.role_list.execute({}, exec);
    const product = roles.roles.find((role) => role.id === 'product');
    assert.equal(product.source, 'workspace');
    assert.equal(product.summary, 'workspace 覆盖版产品 AI');
    assert.ok(roles.roles.some((role) => role.id === 'qa' && role.source === 'workspace'), 'workspace 新增角色可见');
    assert.ok(roles.roles.some((role) => role.id === 'dev' && role.source === 'preset'), 'preset 独有角色保留');
    assert.equal(roles.errors.length, 0);

    const shown = await byName.role_show.execute({ role: 'qa', projectId: 'demo-proj' }, exec);
    assert.deepEqual(shown.subagent.toolFilter, { deny: ['bash'] }, 'deny 声明原样编译为 toolFilter');
    assert.ok(shown.workspaceNote.includes('demo-proj'), '提供 projectId 时说明含真实项目 id');

    const flows = await byName.flow_list.execute({}, exec);
    assert.equal(flows.flows.length, 2, 'standard-flow(workspace 覆盖)+ iteration-flow(preset)');
    const std = flows.flows.find((f) => f.id === 'standard-flow');
    assert.equal(std.source, 'workspace');
    assert.equal(std.stageCount, 2, 'workspace 同 id 模板覆盖 preset');
    const iter = flows.flows.find((f) => f.id === 'iteration-flow');
    assert.equal(iter.source, 'preset', 'iteration-flow 保留 preset 源');
  }));

test('坏清单条目跳过且 errors 上报,不炸工具(角色 + 流程)', async () =>
  withWorkspace(async (workspace) => {
    const libDir = path.join(workspace, '.dsh-library');
    await writeRawFile(path.join(libDir, 'roles', 'broken.json'), '{ 这不是 JSON');
    await writeJsonFile(path.join(libDir, 'roles', 'no-persona.json'), { id: 'no-persona', summary: '缺 persona' });
    await writeJsonFile(path.join(libDir, 'roles', 'both-lists.json'), {
      id: 'both-lists',
      summary: 'allow 与 deny 并存',
      persona: '清单损坏样例。',
      tools: { allow: ['read'], deny: ['bash'] },
    });
    await writeJsonFile(path.join(libDir, 'flows', 'bad-type.json'), {
      schemaVersion: 1,
      id: 'bad-type',
      version: 1,
      stages: [{ id: 'a', type: 'audit' }],
    });
    await writeJsonFile(path.join(libDir, 'flows', 'dup-id.json'), {
      schemaVersion: 1,
      id: 'dup-id',
      version: 1,
      stages: [
        { id: 'x', type: 'summary' },
        { id: 'x', type: 'summary' },
      ],
    });
    await writeJsonFile(path.join(libDir, 'flows', 'gate-no-title.json'), {
      schemaVersion: 1,
      id: 'gate-no-title',
      version: 1,
      stages: [{ id: 'g', type: 'gate' }],
    });

    const { byName } = await mountTools(lib);
    const exec = execFor(workspace);

    const roles = await byName.role_list.execute({}, exec);
    const roleIds = roles.roles.map((role) => role.id);
    assert.ok(!roleIds.includes('no-persona') && !roleIds.includes('both-lists'), '坏角色条目被跳过');
    assert.ok(roleIds.includes('coordinator'), '坏条目不影响其余条目');
    assert.equal(roles.errors.length, 3, '3 个坏角色条目各报一条 error');
    assert.ok(roles.errors.every((item) => typeof item.file === 'string' && typeof item.error === 'string'));

    const flows = await byName.flow_list.execute({}, exec);
    const flowIds = flows.flows.map((flow) => flow.id);
    assert.ok(!flowIds.includes('bad-type') && !flowIds.includes('dup-id') && !flowIds.includes('gate-no-title'), '坏流程条目被跳过');
    assert.ok(flowIds.includes('standard-flow'), '坏条目不影响 preset 模板');
    assert.equal(flows.errors.length, 3, '3 个坏流程条目各报一条 error');
  }));

test('role_show 编译:agentOptions 仅含 provider/model/maxTokens,reasoningEffort 不编译', async () =>
  withWorkspace(async (workspace) => {
    await writeJsonFile(path.join(workspace, '.dsh-library', 'roles', 'modeled.json'), {
      id: 'modeled',
      summary: '带模型声明的角色',
      persona: '你是带模型声明的角色。',
      model: { provider: 'deepseek-official', model: 'deepseek-v4-flash', maxTokens: 8192, reasoningEffort: 'max' },
      workspace: 'shared',
    });
    const { byName } = await mountTools(lib);
    const shown = await byName.role_show.execute({ role: 'modeled' }, execFor(workspace));
    assert.deepEqual(shown.subagent.agentOptions, {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      maxTokens: 8192,
    });
    assert.equal(shown.subagent.toolFilter, undefined, '未声明 tools 时不应有 toolFilter');
    assert.match(shown.workspaceNote, /共享区/, 'shared 工作空间有对应纪律说明');
  }));

test('role_show:缺 persona 的清单报错不炸插件;未知角色报错并列出可用', async () => {
  // 手工 resolveLibrary:绕过清单校验,专测插件侧 persona 兜底分支。
  const brokenLib = {
    resolveLibrary: async () => ({
      roles: new Map([['broken', { manifest: { id: 'broken', summary: '缺 persona 的坏清单' }, source: 'workspace' }]]),
      flows: new Map(),
      roleErrors: [],
      flowErrors: [],
    }),
  };
  const { byName } = await mountTools(brokenLib);
  const exec = execFor('/tmp/whatever');
  await assert.rejects(() => byName.role_show.execute({ role: 'broken' }, exec), /persona/);

  const normal = await mountTools(lib);
  await assert.rejects(() => normal.byName.role_show.execute({ role: 'nope' }, execFor('/tmp/whatever')), /可用角色/);
  await assert.rejects(() => normal.byName.flow_show.execute({ flow: 'nope' }, execFor('/tmp/whatever')), /可用模板/);
});

test('flow_show 返回完整阶段序列供编排参考', async () =>
  withWorkspace(async (workspace) => {
    const { byName } = await mountTools(lib);
    const flow = await byName.flow_show.execute({ flow: 'standard-flow' }, execFor(workspace));
    assert.equal(flow.source, 'preset');
    assert.equal(flow.stages[0].id, 'clarify');
    assert.equal(flow.stages[0].role, 'product');
    assert.equal(flow.stages[1].type, 'gate');
    assert.equal(flow.stages[1].present[0], 'SPEC.md');
  }));

test('会话工作区解析:header.cwd 生效,缺失时报中文错误', async () => {
  const { byName } = await mountTools(lib);
  await withWorkspace(async (workspace) => {
    const roles = await byName.role_list.execute({}, execFor(workspace));
    assert.ok(roles.roles.length > 0);
  });
  await assert.rejects(() => byName.role_list.execute({}, undefined), /会话工作区/);
  await assert.rejects(() => byName.role_list.execute({}, { agent: { session: {} } }), /会话工作区/);
  assert.equal(sessionWorkspaceOf(undefined), undefined);
  assert.equal(sessionWorkspaceOf({ agent: { session: { header: { cwd: 'C:\\ws' } } } }), 'C:\\ws');
  assert.equal(sessionWorkspaceOf({ agent: { session: { meta: { cwd: '/fallback' } } } }), '/fallback', 'meta.cwd 兜底候选');
});

test('config.libraryDir 覆盖 workspace 库目录', async () =>
  withWorkspace(async (workspace) => {
    await writeJsonFile(path.join(workspace, 'custom-lib', 'roles', 'extra.json'), {
      id: 'extra',
      summary: '自定义库目录里的角色',
      persona: '你是自定义库目录里的角色。',
      tools: { allow: ['read'] },
    });
    const { byName } = await mountTools(lib, { libraryDir: 'custom-lib' });
    const roles = await byName.role_list.execute({}, execFor(workspace));
    assert.ok(roles.roles.some((role) => role.id === 'extra' && role.source === 'workspace'));
  }));

test('output.render 冒烟:四工具渲染含关键字段', async () =>
  withWorkspace(async (workspace) => {
    const { byName } = await mountTools(lib);
    const exec = execFor(workspace);

    const rolesValue = await byName.role_list.execute({}, exec);
    const rolesText = byName.role_list.output.render({}, rolesValue).map((b) => b.text).join('\n');
    assert.match(rolesText, /coordinator\[preset\]/);
    assert.match(rolesText, /可用角色 6 个/);

    const showValue = await byName.role_show.execute({ role: 'coordinator', projectId: 'p1' }, exec);
    const showText = byName.role_show.output.render({ role: 'coordinator' }, showValue).map((b) => b.text).join('\n');
    assert.match(showText, /【coordinator·preset】/);
    assert.match(showText, /项目协调者/);

    const flowsValue = await byName.flow_list.execute({}, exec);
    assert.match(byName.flow_list.output.render({}, flowsValue).map((b) => b.text).join('\n'), /standard-flow@1\[preset\] 11 个阶段/);

    const flowValue = await byName.flow_show.execute({ flow: 'standard-flow' }, exec);
    const flowText = byName.flow_show.output.render({}, flowValue).map((b) => b.text).join('\n');
    assert.match(flowText, /02\. \[gate\] spec-gate/);
    assert.match(flowText, /09\. \[gate\] delivery-gate \| 门禁:交付验收/);
  }));

test(`lib 装载来源标注(当前:${usingRealLib ? '真 project-lib.mjs' : '内置 stub,集成期切换真 lib'})`, () => {
  // 非断言用例:留一条痕迹说明本次测试跑的是哪个 lib 实现。
  assert.ok(usingRealLib === true || usingRealLib === false);
});
// ---------------------------------------------------------------------------
// R4 一致性断言(perm-boundary-p2):白名单配置与真实工具面一致性。
// 基准 = 用户裁决修正后的实测工具面(R2-AC5 探针 56 工具清单为源)。
// 零依赖:node:test + 正则,不引入 YAML 解析器。
// ---------------------------------------------------------------------------
const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url));

// 真实工具面基准(用户裁决修正,2026-08-30):以 R2-AC5 探针子代理回报的 56 工具清单为源。
// 维护注意:若部署工具面变化(新增工具/启用 bash)需同步更新;断言失败即提示人工核对。
const REAL_TOOL_SURFACE = new Set([
  // fs
  'read', 'write', 'edit', 'glob', 'grep',
  // shell(win32)
  'pwsh',
  // web
  'web_search',
  // todo/jobs/goal/plan
  'todo_write', 'job_list', 'job_output', 'job_kill', 'create_goal', 'get_goal', 'update_goal', 'exit_plan_mode',
  // ask
  'ask_user_question',
  // delegation
  'subagent_architect', 'subagent_deliverer', 'subagent_dev', 'subagent_product', 'subagent_tester', 'subagent_coordinator', 'subagent_devhelper',
  'send_message', 'interrupt_agent', 'subagent_control', 'subagent_list_agents',
  // project-registry
  'project_register', 'project_advance', 'project_gate', 'project_budget', 'project_status', 'project_block',
  // project-roles
  'role_list', 'role_show', 'flow_list', 'flow_show',
]);
const FORBIDDEN = ['bash', 'web_fetch', 'subagent', 'subagent_fork'];

async function readPresetRoles() {
  const dir = path.join(PRESET_ROOT, 'roles');
  const files = (await readdir(dir)).filter((n) => n.endsWith('.json'));
  const roles = [];
  for (const f of files) {
    roles.push({ file: f, json: JSON.parse(await readFile(path.join(dir, f), 'utf8')) });
  }
  return roles;
}

async function readAgentCordis() {
  return await readFile(path.join(PRESET_ROOT, 'agent.cordis.yml'), 'utf8');
}

// 提取每个 toolName: subagent_<role> 行的 allow 列表(零依赖正则)。
function extractPerRoleAllow(text) {
  const out = new Map();
  const rowRe = /toolName:\s*(subagent_\w+)[\s\S]*?allow:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = rowRe.exec(text)) !== null) {
    const names = m[2].split(',').map((s) => s.trim()).filter(Boolean);
    out.set(m[1], names);
  }
  return out;
}

test('R4-AC1 角色 allow 一致性:每个名字 ∈ 真实工具面 且 ∉ FORBIDDEN', async () => {
  const roles = await readPresetRoles();
  assert.ok(roles.length > 0, 'preset roles 目录应有角色清单');
  for (const { file, json } of roles) {
    const { allow = [], deny = [] } = json.tools ?? {};
    for (const name of [...allow, ...deny]) {
      assert.ok(REAL_TOOL_SURFACE.has(name), `${file} 引用未知工具 "${name}"(不在真实工具面)`);
      assert.ok(!FORBIDDEN.includes(name), `${file} 引用禁用工具 "${name}"`);
    }
  }
});

test('R4-AC2 coordinator/dev 不再引用通用 spawn;dev 含 subagent_devhelper 与 send_message', async () => {
  const roles = await readPresetRoles();
  const coord = roles.find((r) => r.json.id === 'coordinator');
  const dev = roles.find((r) => r.json.id === 'dev');
  assert.ok(coord && dev, 'preset 应含 coordinator 与 dev 角色');
  const coordAllow = coord.json.tools.allow;
  const devAllow = dev.json.tools.allow;
  assert.ok(!coordAllow.includes('subagent'), 'coordinator allow 不应含通用 subagent');
  assert.ok(!coordAllow.includes('subagent_fork'), 'coordinator allow 不应含 subagent_fork');
  assert.ok(!devAllow.includes('subagent'), 'dev allow 不应含通用 subagent');
  assert.ok(devAllow.includes('subagent_devhelper'), 'dev allow 应含 subagent_devhelper');
  assert.ok(devAllow.includes('send_message'), 'dev allow 应保留 send_message');
  // R2-AC4:dev persona 应指定 subagent_devhelper 工具名(不再用通用 subagent 派助手)。
  assert.ok(dev.json.persona.includes('subagent_devhelper'), 'dev persona 应指定 subagent_devhelper 工具名(R2-AC4)');
});

test('R4-AC3 per-role 行 toolFilter 一致性:名字 ∈ 真实工具面;coordinator 行无通用 spawn;dev 行含 devhelper', async () => {
  const text = await readAgentCordis();
  const rows = extractPerRoleAllow(text);
  assert.ok(rows.has('subagent_coordinator'), '应存在 subagent_coordinator 行');
  assert.ok(rows.has('subagent_dev'), '应存在 subagent_dev 行');
  for (const [toolName, names] of rows) {
    for (const name of names) {
      assert.ok(REAL_TOOL_SURFACE.has(name), `${toolName} 行引用未知工具 "${name}"`);
      assert.ok(!FORBIDDEN.includes(name), `${toolName} 行引用禁用工具 "${name}"`);
    }
  }
  const coordAllow = rows.get('subagent_coordinator');
  assert.ok(!coordAllow.includes('subagent'), 'subagent_coordinator 行不应含通用 subagent');
  assert.ok(!coordAllow.includes('subagent_fork'), 'subagent_coordinator 行不应含 subagent_fork');
  const devAllow = rows.get('subagent_dev');
  assert.ok(!devAllow.includes('subagent'), 'subagent_dev 行不应含通用 subagent');
  assert.ok(devAllow.includes('subagent_devhelper'), 'subagent_dev 行应含 subagent_devhelper');
});

test('R4-AC4 devhelper 行存在且无 spawn 权(无 subagent、无 send_message)', async () => {
  const text = await readAgentCordis();
  const rows = extractPerRoleAllow(text);
  assert.ok(rows.has('subagent_devhelper'), '应存在 subagent_devhelper 行');
  const allow = rows.get('subagent_devhelper');
  assert.ok(!allow.includes('subagent'), 'devhelper 行不应含 subagent');
  assert.ok(!allow.includes('send_message'), 'devhelper 行不应含 send_message');
});

test('R4-AC5 通用两行已物理移除(无 toolName: subagent / subagent_fork)', async () => {
  const text = await readAgentCordis();
  assert.ok(!/toolName:\s*subagent_fork/.test(text), '不应存在 toolName: subagent_fork');
  assert.ok(!/toolName:\s*subagent\b/.test(text), '不应存在 toolName: subagent(词边界,避免误匹配 subagent_*)');
  assert.ok(!text.includes('subagent_fork'), '全文件不应出现 subagent_fork');
});

// ---------------------------------------------------------------------------
// P1 readings 编译(项目底座层 Base Dossier,2026-09-01)。
// ---------------------------------------------------------------------------

test('role_show 给 projectId:readings 展开为具体路径清单,编译后 persona 含进场必读头', async () =>
  withWorkspace(async (workspace) => {
    // 建一个项目登记簿(entitySlug=shared-entity),供 role_show 读 entitySlug。
    await writeJsonFile(path.join(workspace, 'proj-a', '.dsh-project', 'REGISTRY.json'), {
      schemaVersion: 2,
      id: 'proj-a',
      entitySlug: 'shared-entity',
      title: 'Proj A',
      state: 'active',
      iteration: 1,
      stageIndex: 0,
    });
    const { byName } = await mountTools(lib);
    const shown = await byName.role_show.execute({ role: 'dev', projectId: 'proj-a' }, execFor(workspace));
    // readings 展开:{{base}} → .dsh-base/shared-entity/,{{project}} → proj-a/
    assert.ok(Array.isArray(shown.readings), 'readings 应为数组');
    assert.ok(shown.readings.includes('.dsh-base/shared-entity/MAP.md'), '{{base}} 展开为 .dsh-base/<entity>/');
    assert.ok(shown.readings.includes('proj-a/SPEC.md'), '{{project}} 展开为 <projectId>/');
    assert.ok(shown.readings.every((r) => !r.includes('{{')), '展开后不含未替换变量');
    // 编译后 persona 含进场必读头 + 具体路径。
    assert.ok(shown.subagent.persona.includes('进场必读:'), '编译后 persona 含进场必读头');
    assert.ok(shown.subagent.persona.includes('.dsh-base/shared-entity/MAP.md'), '编译后 persona 含展开路径');
    assert.ok(shown.subagent.persona.length <= 1000, '编译后 persona ≤1000');
  }));

test('role_show 给 projectId:登记簿读不到 entitySlug → 缺省=项目自身', async () =>
  withWorkspace(async (workspace) => {
    // 无登记簿(或读不到)→ entitySlug 缺省=项目自身。
    const { byName } = await mountTools(lib);
    const shown = await byName.role_show.execute({ role: 'dev', projectId: 'ghost-proj' }, execFor(workspace));
    assert.ok(shown.readings.includes('.dsh-base/ghost-proj/MAP.md'), '读不到登记簿 → entitySlug=项目自身');
  }));

test('compileSubagent:readings 编译超限(>MAX_COMPILED_PERSONA)在 role_show 编译期抛错', async () =>
  withWorkspace(async (workspace) => {
    // 造一个 readings 极长的角色(路径模板超长 → 编译后 persona 超 1000)。
    const longPath = '{{base}}/' + 'x'.repeat(1200) + '.md';
    await writeJsonFile(path.join(workspace, '.dsh-library', 'roles', 'long-readings.json'), {
      id: 'long-readings',
      summary: 'readings 超长的角色',
      persona: '你是测试角色。',
      readings: [longPath],
      tools: { allow: ['read'] },
    });
    const { byName } = await mountTools(lib);
    await assert.rejects(
      () => byName.role_show.execute({ role: 'long-readings', projectId: 'proj-a' }, execFor(workspace)),
      /超限/,
      '编译后 persona 超限应抛错(不静默截断)',
    );
  }));

test('role_show:无 readings 的角色(如 modeled)编译后 persona 无进场必读头,行为不变', async () =>
  withWorkspace(async (workspace) => {
    await writeJsonFile(path.join(workspace, '.dsh-library', 'roles', 'no-readings.json'), {
      id: 'no-readings',
      summary: '无 readings 的角色',
      persona: '你是无 readings 的角色。',
      tools: { allow: ['read'] },
    });
    const { byName } = await mountTools(lib);
    const shown = await byName.role_show.execute({ role: 'no-readings', projectId: 'proj-a' }, execFor(workspace));
    assert.equal(shown.readings, undefined, '无 readings → readings 字段缺省');
    assert.equal(shown.subagent.persona, '你是无 readings 的角色。', '无 readings → persona 原样,不加头');
  }));
