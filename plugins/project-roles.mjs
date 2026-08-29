// preset-plugin: project-roles —— project-pipeline 的角色/流程库插件(P1,B 路)。
//
// 职责(SPEC-P1 §4 工具 6-9):
//   - role_list / role_show:角色库(preset 自带 roles/ + workspace
//     <workspace>/<libraryDir>/roles 覆盖,同 id workspace 胜)。role_show 把
//     角色清单编译成可直接拷进官方 subagent 工具调用的参数面
//     (persona / toolFilter / agentOptions)并附工作空间纪律说明。
//   - flow_list / flow_show:流程模板库(preset 自带 flows/ + workspace 覆盖)。
//
// 库解析统一走 ./project-lib.mjs 的 resolveLibrary(A 路实现的纯库模块,SPEC §5
// 签名:{ workspaceDir, presetDir } → { roles, flows, roleErrors, flowErrors });
// 坏 JSON / 校验失败 → 该条目跳过并在 role_list/flow_list 结果的 errors 里说明,
// 不炸工具。
//
// 会话工作区来源(SPEC §6):插件运行在宿主进程,process.cwd() 不是会话工作区。
// 这里按官方 fs 工具同款姿势取 exec.agent.session.header.cwd(dsh-tool-fs 已核实
// 该字段即会话工作区),另留 session.meta.cwd / exec.session.header.cwd 两个候选
// 兜底;集成期以 A 路 project-registry.mjs 头部注释的调研结论为准对齐。
//
// lib 装载:默认按契约动态 import('./project-lib.mjs')(未就绪时工具调用返回
// 明确中文错误,不炸插件);若 ctx 服务表挂了 'project-lib'(仅单测桩使用),
// 优先消费——单测可在 lib 完成前注入 stub,生产路径不受影响。

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'project-pipeline-roles';

/** 纯消费工具注册面;不 provide,组合行无需 isolate group。 */
export const inject = ['tools'];

// preset 自带库 = 本插件文件路径的 ../..(即 preset 根)下的 roles/ 与 flows/。
// 注意:这里从文件所在目录(plugins/)上跳一级,等价于相对插件文件本身的 ../..。
const PRESET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** config fail-fast 校验:仅接受 { libraryDir?: 非空相对路径 },非法即 throw。 */
export function validateConfig(config = {}) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`${name}: config 必须是对象`);
  }
  for (const key of Object.keys(config)) {
    if (key !== 'libraryDir') throw new Error(`${name}: 不支持的 config 键 "${key}"(仅接受 libraryDir)`);
  }
  let libraryDir = '.dsh-library';
  if (config.libraryDir !== undefined) {
    if (typeof config.libraryDir !== 'string' || config.libraryDir.trim().length === 0) {
      throw new Error(`${name}: config.libraryDir 必须是非空字符串`);
    }
    if (path.isAbsolute(config.libraryDir) || config.libraryDir.split(/[\\/]/).includes('..')) {
      throw new Error(`${name}: config.libraryDir 必须是相对路径且不得包含 ".."(防止越出会话工作区)`);
    }
    libraryDir = config.libraryDir;
  }
  return { libraryDir };
}

/** 从 execute 上下文解析会话工作区(SPEC §6);解析不到返回 undefined,由调用方报错。 */
export function sessionWorkspaceOf(exec) {
  const candidates = [
    exec?.agent?.session?.header?.cwd, // 官方 fs 工具同款姿势(主路径)
    exec?.agent?.session?.meta?.cwd, // 兜底候选 1
    exec?.session?.header?.cwd, // 兜底候选 2
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return undefined;
}

/** 错误对象统一转成可读文本(工具输出里不透 Error 实例)。 */
function errorText(value) {
  if (typeof value === 'string') return value;
  return String(value?.message ?? value);
}

/** 把角色清单编译为官方 subagent 工具的 spawn 参数面(DESIGN §5.2 P1 列)。 */
function compileSubagent(manifest) {
  const subagent = { persona: manifest.persona };
  // toolFilter 仅在清单声明 tools 时给出(allow/deny 二选一,清单校验已保证)。
  if (manifest.tools?.allow !== undefined) subagent.toolFilter = { allow: [...manifest.tools.allow] };
  else if (manifest.tools?.deny !== undefined) subagent.toolFilter = { deny: [...manifest.tools.deny] };
  // agentOptions 仅编译 provider/model/maxTokens;reasoningEffort 不在 spawn 透传
  // 链,留在 manifest,P2 会话级模型路由时生效。
  if (manifest.model && typeof manifest.model === 'object') {
    const agentOptions = {};
    for (const key of ['provider', 'model', 'maxTokens']) {
      if (manifest.model[key] !== undefined) agentOptions[key] = manifest.model[key];
    }
    if (Object.keys(agentOptions).length > 0) subagent.agentOptions = agentOptions;
  }
  return subagent;
}

/** workspace 声明 → 面向角色的工作空间纪律说明(P1 是路径纪律,不是隔离)。 */
function workspaceNoteFor(manifest, projectId) {
  const projectRoot = `<workspace>/${projectId ?? '<projectId>'}/`;
  const workspace = manifest.workspace ?? 'project-root';
  if (workspace === 'shared') {
    return `工作空间=共享区:可在整个会话工作区 <workspace>/ 内读写;项目产出仍应优先写入 ${projectRoot},不要触碰其他项目目录。`;
  }
  if (workspace === 'project-root') {
    return `只在 ${projectRoot} 内读写;登记簿路径前缀 ${projectRoot}.dsh-project/(REGISTRY、FLOW、journal、gates、SUMMARY 等都在其中),产出与 git 提交都留在项目目录内。`;
  }
  return `工作空间=项目根下子目录:只在 ${projectRoot}${workspace}/ 内读写,不要越出该子目录。`;
}

/** 按 id 排序(纯字典序,结果稳定)。 */
function byId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function apply(ctx, config = {}) {
  const cfg = validateConfig(config);

  // lib 惰性加载并缓存;真 lib 与单测桩都走这一条路。
  let libPromise;
  const loadLib = () => {
    libPromise ??= (async () => {
      const injected = ctx.get?.('project-lib');
      if (injected) return injected; // 单测注入桩优先(仅测试用)。
      try {
        return await import('./project-lib.mjs');
      } catch (error) {
        throw new Error(`${name}: 依赖库模块 ./project-lib.mjs 加载失败(该模块由登记簿侧并行提供,未就绪或已损坏):${errorText(error)}`);
      }
    })();
    return libPromise;
  };
  loadLib(); // 预热:lib 未就绪时首次工具调用即给明确错误,不静默。

  // 每次执行都现解析:工作区 + 库快照(workspace 库可在运行中被内化/修改)。
  const resolveLib = async (exec) => {
    const workspaceDir = sessionWorkspaceOf(exec);
    if (workspaceDir === undefined) {
      throw new Error(`${name}: 无法解析会话工作区(execute 上下文缺少 agent.session.header.cwd;请对齐 SPEC §6 的工作区调研结论)`);
    }
    const lib = await loadLib();
    const resolved = await lib.resolveLibrary({
      workspaceDir,
      presetDir: PRESET_DIR,
      // SPEC §5 钉死签名为 { workspaceDir, presetDir };libraryDir 仅在 config
      // 显式覆盖时附传(默认 '.dsh-library',lib 忽略该键时行为不变)。
      ...(cfg.libraryDir === '.dsh-library' ? {} : { libraryDir: cfg.libraryDir }),
    });
    return resolved;
  };

  ctx.tools.register({
      name: 'role_list',
      description:
        '列出项目流水线可用角色(preset 自带角色库 + workspace .dsh-library/roles 覆盖,同 id workspace 胜);坏清单条目自动跳过并在 errors 里说明。开工前先在此选角色。',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            roles: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string' },
                  summary: { type: 'string' },
                  source: { type: 'string', enum: ['workspace', 'preset'] },
                },
                required: ['id', 'summary', 'source'],
              },
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: { file: { type: 'string' }, error: { type: 'string' } },
                required: ['file', 'error'],
              },
            },
          },
          required: ['roles', 'errors'],
        },
        render: (_args, value) => {
          const lines = value.roles.length === 0 ? ['角色库为空。'] : [`可用角色 ${value.roles.length} 个:`];
          for (const role of value.roles) lines.push(`- ${role.id}[${role.source}] ${role.summary}`);
          for (const item of value.errors) lines.push(`(已跳过坏条目 ${item.file}:${item.error})`);
          return [{ type: 'text', text: lines.join('\n') }];
        },
      },
      async execute(_args, exec) {
        const resolved = await resolveLib(exec);
        const roles = [...resolved.roles.entries()]
          .map(([id, entry]) => ({ id, summary: entry.manifest.summary, source: entry.source }))
          .sort(byId);
        const errors = (resolved.roleErrors ?? []).map((item) => ({ file: item.file, error: errorText(item.error) }));
        return { roles, errors };
      },
  });

  ctx.tools.register({
      name: 'role_show',
      description:
        '展开一份角色清单:返回全文 persona 与可直接拷进 subagent 调用的参数(persona/toolFilter/agentOptions)及工作空间纪律;spawn 角色前必用。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          role: { type: 'string', description: '角色 id,如 coordinator / product。' },
          projectId: { type: 'string', description: '可选;提供后工作空间说明按真实项目 id 呈现。' },
        },
        required: ['role'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            source: { type: 'string', enum: ['workspace', 'preset'] },
            summary: { type: 'string' },
            persona: { type: 'string' },
            subagent: {
              type: 'object',
              additionalProperties: false,
              properties: {
                persona: { type: 'string' },
                toolFilter: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    allow: { type: 'array', items: { type: 'string' } },
                    deny: { type: 'array', items: { type: 'string' } },
                  },
                },
                agentOptions: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    provider: { type: 'string' },
                    model: { type: 'string' },
                    maxTokens: { type: 'number' },
                  },
                },
              },
              required: ['persona'],
            },
            workspaceNote: { type: 'string' },
          },
          required: ['id', 'source', 'summary', 'persona', 'subagent', 'workspaceNote'],
        },
        render: (_args, value) =>
          [{ type: 'text', text: [`【${value.id}·${value.source}】${value.summary}`, value.persona, `工作空间纪律:${value.workspaceNote}`].join('\n') }],
      },
      async execute(args, exec) {
        const resolved = await resolveLib(exec);
        const roleId = String(args.role ?? '');
        const entry = resolved.roles.get(roleId);
        if (!entry) {
          const known = [...resolved.roles.keys()].sort().join(', ') || '(空)';
          throw new Error(`角色 "${roleId}" 不在角色库中;可用角色:${known}`);
        }
        const manifest = entry.manifest;
        // 清单坏了不崩插件:缺 persona 时报错即返回(正常应被清单校验拦下,此处兜底)。
        if (typeof manifest.persona !== 'string' || manifest.persona.trim().length === 0) {
          throw new Error(`角色清单 "${entry.id}" 的 persona 缺失或为空,清单已损坏;请修复后再 spawn。`);
        }
        const projectId = typeof args.projectId === 'string' && args.projectId.length > 0 ? args.projectId : undefined;
        return {
          id: manifest.id ?? roleId,
          source: entry.source,
          summary: manifest.summary,
          persona: manifest.persona,
          subagent: compileSubagent(manifest),
          workspaceNote: workspaceNoteFor(manifest, projectId),
        };
      },
  });

  ctx.tools.register({
      name: 'flow_list',
      description:
        '列出项目流水线可用流程模板(preset 自带 flows/ + workspace .dsh-library/flows 覆盖,同 id workspace 胜);坏模板条目自动跳过并在 errors 里说明。登记项目前选模板用。',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            flows: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string' },
                  version: { type: 'number' },
                  source: { type: 'string', enum: ['workspace', 'preset'] },
                  stageCount: { type: 'number' },
                },
                required: ['id', 'version', 'source', 'stageCount'],
              },
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: { file: { type: 'string' }, error: { type: 'string' } },
                required: ['file', 'error'],
              },
            },
          },
          required: ['flows', 'errors'],
        },
        render: (_args, value) => {
          const lines = value.flows.length === 0 ? ['流程库为空。'] : [`可用流程模板 ${value.flows.length} 条:`];
          for (const flow of value.flows) lines.push(`- ${flow.id}@${flow.version}[${flow.source}] ${flow.stageCount} 个阶段`);
          for (const item of value.errors) lines.push(`(已跳过坏条目 ${item.file}:${item.error})`);
          return [{ type: 'text', text: lines.join('\n') }];
        },
      },
      async execute(_args, exec) {
        const resolved = await resolveLib(exec);
        const flows = [...resolved.flows.entries()]
          .map(([id, entry]) => ({
            id,
            version: entry.flow.version,
            source: entry.source,
            stageCount: Array.isArray(entry.flow.stages) ? entry.flow.stages.length : 0,
          }))
          .sort(byId);
        const errors = (resolved.flowErrors ?? []).map((item) => ({ file: item.file, error: errorText(item.error) }));
        return { flows, errors };
      },
  });

  ctx.tools.register({
      name: 'flow_show',
      description: '展开一份流程模板的阶段序列(逐阶段 id/类型/角色/门禁呈递物),用于编排推进或定制新模板时参考。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          flow: { type: 'string', description: '流程模板 id,如 standard-flow。' },
        },
        required: ['flow'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            version: { type: 'number' },
            source: { type: 'string', enum: ['workspace', 'preset'] },
            stages: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string' },
                  type: { type: 'string', enum: ['work', 'gate', 'summary', 'internalize'] },
                  role: { type: 'string' },
                  title: { type: 'string' },
                  produces: { type: 'array', items: { type: 'string' } },
                  present: { type: 'array', items: { type: 'string' } },
                  note: { type: 'string' },
                },
                required: ['id', 'type'],
              },
            },
          },
          required: ['id', 'version', 'source', 'stages'],
        },
        render: (_args, value) => {
          const lines = [`流程 ${value.id}@v${value.version}(${value.source}),共 ${value.stages.length} 个阶段:`];
          value.stages.forEach((stage, index) => {
            const bits = [`${String(index + 1).padStart(2, '0')}. [${stage.type}] ${stage.id}`];
            if (stage.role) bits.push(`role=${stage.role}`);
            if (stage.title) bits.push(`门禁:${stage.title}`);
            if (Array.isArray(stage.produces) && stage.produces.length > 0) bits.push(`产出:${stage.produces.join(', ')}`);
            if (Array.isArray(stage.present) && stage.present.length > 0) bits.push(`呈递:${stage.present.join(', ')}`);
            if (stage.note) bits.push(`备注:${stage.note}`);
            lines.push(bits.join(' | '));
          });
          return [{ type: 'text', text: lines.join('\n') }];
        },
      },
      async execute(args, exec) {
        const resolved = await resolveLib(exec);
        const flowId = String(args.flow ?? '');
        const entry = resolved.flows.get(flowId);
        if (!entry) {
          const known = [...resolved.flows.keys()].sort().join(', ') || '(空)';
          throw new Error(`流程模板 "${flowId}" 不在流程库中;可用模板:${known}`);
        }
        return { id: entry.flow.id ?? flowId, version: entry.flow.version, source: entry.source, stages: entry.flow.stages };
      },
  });

}
