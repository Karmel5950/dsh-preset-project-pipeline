// preset-plugin: project-registry —— 项目制交付的登记簿插件(A 路)。
//
// 【会话 workspace(cwd)调研结论 —— SPEC §6,本插件的实现根基】
// 工具 execute(args, context) 的第二参 context 上,`context.agent?.session?.header?.cwd`
// 就是调用方会话的工作区绝对路径,登记簿一律以它为 <workspace> 根,无需 workspace 参数:
//   - dsh-runtime\node_modules\@deepseek-ai\dsh-tool-fs\lib\index.js:241-245:
//     官方 fs 工具的 sessionCwd(exec) 即以 exec.agent?.session.header.cwd 作为相对
//     路径解析基准(同文件 223-232 行模块注释:per-session workspace,而非 process.cwd);
//   - dsh-runtime\node_modules\@deepseek-ai\dsh-session\lib\index.js:1120-1122:
//     session header cwd 被强制校验为绝对路径;:1662:sessions.create 的 meta.cwd 写入 header;
//   - dsh-runtime\node_modules\@deepseek-ai\dsh-subagent\lib\index.js:534:
//     子代理会话 header 继承 parentHeader.cwd —— 协调者/角色子代理里调用本插件工具,
//     拿到的仍是用户会话的同一工作区。
// 上下文缺失(非会话内直接调用)→ 中文报错;SPEC 预留的 workspace 参数退路无需启用。
// 单测经 context 注入(stub:{ agent: { session: { header: { cwd: <临时目录> } } } })覆盖该来源。
//
// 硬约束:零 npm import(仅 node: 内置 + ./project-lib.mjs);写文件一律 node:fs/promises;
// 一切贡献经 ctx.effect() 挂清理;config 在 apply 内 fail-fast 校验。

import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUDGET_SOURCES,
  STAGE_TYPES,
  readJson,
  registryPaths,
  resolveLibrary,
  slugify,
  validateStageList,
  writeJson,
} from './project-lib.mjs';

export const name = 'project-pipeline-registry';

/** 纯消费宿主服务;不 provide,组合行无需 isolate group。 */
export const inject = ['tools', 'systemPrompt'];

// ── 通用小件 ────────────────────────────────────────────────────────────────

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 阶段类型的中文一说(手册与渲染用)。 */
function stageTypeLabel(type) {
  return { work: '工活', gate: '门禁', summary: '总结', internalize: '内化' }[type] ?? type;
}

/** 阶段概要(flowSummary / nextStage / 当前阶段共用形状)。 */
function stageBrief(stage, index) {
  return {
    index,
    id: stage.id,
    type: stage.type,
    ...(stage.role !== undefined ? { role: stage.role } : {}),
    ...(stage.title !== undefined ? { title: stage.title } : {}),
  };
}

/** config fail-fast:registryDir / libraryDir 均为单级非空目录名,未知键报错。 */
function normalizeConfig(config = {}) {
  const cfg = { registryDir: '.dsh-project', libraryDir: '.dsh-library' };
  for (const key of Object.keys(config ?? {})) {
    if (key !== 'registryDir' && key !== 'libraryDir') {
      throw new Error(`${name}: config 含未知键 "${key}"(仅支持 registryDir/libraryDir)`);
    }
  }
  for (const key of ['registryDir', 'libraryDir']) {
    const value = config?.[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) {
      throw new Error(`${name}: config.${key} 必须是非空字符串(组合行里配置)`);
    }
    if (value.includes('/') || value.includes('\\') || value === '.' || value === '..') {
      throw new Error(`${name}: config.${key} 必须是单级目录名,不允许路径分隔符或 "..":${value}`);
    }
    cfg[key] = value;
  }
  return cfg;
}

/** 会话工作区:见文件头调研结论;拿不到就报中文错,不做 process.cwd() 兜底。 */
function sessionWorkspace(context) {
  const cwd = context?.agent?.session?.header?.cwd;
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new Error(`${name}: 无法确定会话工作区(执行上下文缺少 agent.session.header.cwd;本工具须由会话内的模型调用)`);
  }
  return cwd;
}

/** projectId 路径安全:任何工具入口先过 slug 卫兵,拒绝分隔符与 ".."。 */
function safeProjectId(projectId) {
  if (typeof projectId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(projectId)) {
    throw new Error(`${name}: projectId 非法(只允许字母/数字/连字符,且以字母或数字开头):${JSON.stringify(projectId ?? null)}`);
  }
  return projectId;
}

// ── 登记簿 JSON 读取卫兵 ────────────────────────────────────────────────────

function assertRegistry(value, file) {
  if (!isPlainObject(value) || value.schemaVersion !== 1) {
    throw new Error(`${name}: 登记簿不认识或已损坏(schemaVersion 必须=1):${file}`);
  }
}

function assertActive(registry, projectId) {
  if (registry.state !== 'active') {
    throw new Error(`${name}: 项目 ${projectId} 已终态(${registry.state}),拒绝继续变更`);
  }
}

// ── 门禁包 markdown(唯一机器可读位:HTML 注释标记;正文给人看)────────────

const GATE_PENDING_MARKER_RE = /<!--\s*dsh-project:gate\s+/g;
const GATE_DECISION_MARKER_RE = /<!--\s*dsh-project:gate-decision\s+([\s\S]*?)-->/g;

function gateFileName(stageIndex, stageId) {
  return `${pad2(stageIndex + 1)}-${stageId}.md`;
}

function gateMarkdownHeader(stage, stageIndex, registry) {
  return [
    `# 门禁:${stage.title}(${stage.id})`,
    '',
    `- 项目:${registry.id}(第 ${registry.iteration} 次迭代)`,
    `- 阶段序号:${stageIndex + 1}`,
    '- 状态:待裁决',
    '',
  ].join('\n');
}

function presentSection(stage, round, now, pkg) {
  const lines = [
    `## 第 ${round} 轮呈递(${now})`,
    '',
    '### 摘要',
    '',
    pkg.summary,
    '',
    '### 待审材料',
    '',
  ];
  if (Array.isArray(pkg.materials) && pkg.materials.length > 0) {
    for (const material of pkg.materials) lines.push(`- ${material}`);
  } else {
    lines.push('- (无)');
  }
  lines.push('', '### 建议', '', pkg.recommendation ?? '(无)');
  lines.push('', `<!-- dsh-project:gate ${JSON.stringify({ stageId: stage.id, round, status: 'pending' })} -->`, '');
  return lines.join('\n');
}

function decisionSection(verdict, decision, now) {
  const lines = [
    `### 裁决(${now})`,
    '',
    `- 结论:${verdict}`,
    `- 意见:${decision.comment ?? '(无)'}`,
  ];
  if (verdict === 'revise') lines.push(`- 返工目标:${decision.reviseTo}`);
  const marker = { verdict, ...(verdict === 'revise' ? { reviseTo: decision.reviseTo } : {}) };
  lines.push('', `<!-- dsh-project:gate-decision ${JSON.stringify(marker)} -->`, '');
  return lines.join('\n');
}

/** 门禁包里最后一枚裁决标记(advance 消费 reviseTo 的唯一权威)。 */
function lastGateDecision(gatePath) {
  const text = readFileSync(gatePath, 'utf8');
  const matches = [...text.matchAll(GATE_DECISION_MARKER_RE)];
  const last = matches[matches.length - 1];
  if (!last) return undefined;
  try {
    return JSON.parse(last[1].trim());
  } catch {
    throw new Error(`${name}: 门禁包裁决标记损坏(JSON 解析失败):${gatePath}`);
  }
}

// ── markdown 文本(需求/日志)───────────────────────────────────────────────

function requirementMarkdown(registry, requirement) {
  return [
    `# 需求:${registry.title}`,
    '',
    `- 项目 id:${registry.id}`,
    `- 登记时间:${registry.createdAt}`,
    `- 流程:${registry.flowRef}`,
    '- 迭代:第 1 次',
    '',
    '## 需求原文(逐字)',
    '',
    requirement,
    '',
  ].join('\n');
}

function journalHead(registry, stage, stageIndex, total, now, note) {
  return [
    `# ${stage.id}(${stageTypeLabel(stage.type)}${stage.role ? ` · ${stage.role}` : ''})`,
    '',
    `- 迭代:第 ${registry.iteration} 次`,
    `- 阶段:${stageIndex + 1}/${total}`,
    `- 进入时间:${now}`,
    `- 推进说明:${note ?? '(无)'}`,
    '',
    '(本条由 project_advance 自动开条;本阶段的产出与结论请由角色以 write 追加在本文件之后。)',
    '',
  ].join('\n');
}

// ── 预算聚合 ────────────────────────────────────────────────────────────────

/** totals:committed 逐条计数聚合(usage 形状自由,工具不解释,不做数值聚合)。 */
function budgetTotals(budget) {
  const committed = Array.isArray(budget?.committed) ? budget.committed : [];
  const byRole = {};
  const bySource = {};
  for (const entry of committed) {
    byRole[entry.role] = (byRole[entry.role] ?? 0) + 1;
    bySource[entry.source] = (bySource[entry.source] ?? 0) + 1;
  }
  return { entries: committed.length, byRole, bySource };
}

// ── 工具实现(经 makeApi 闭包持有 cfg/presetDir/logger)────────────────────

function makeApi({ cfg, presetDir, logger }) {
  /** 登记簿路径(尊重 config.registryDir 覆盖;默认与 lib 布局一致)。 */
  function pathsFor(workspaceDir, projectId) {
    const base = registryPaths(workspaceDir, projectId);
    if (cfg.registryDir === '.dsh-project') return base;
    const registryDir = join(base.projectDir, cfg.registryDir);
    return {
      ...base,
      registryDir,
      registryFile: join(registryDir, 'REGISTRY.json'),
      flowFile: join(registryDir, 'FLOW.json'),
      budgetFile: join(registryDir, 'BUDGET.json'),
      requirementFile: join(registryDir, 'REQUIREMENT.md'),
      summaryFile: join(registryDir, 'SUMMARY.md'),
      journalDir: join(registryDir, 'journal'),
      gatesDir: join(registryDir, 'gates'),
      feedbackDir: join(registryDir, 'feedback'),
    };
  }

  /** 流程模板全集:preset 自带 + workspace 库(resolveLibrary 原生支持 libraryDir 覆盖)。 */
  function flowTemplates(workspaceDir) {
    const lib = resolveLibrary({ workspaceDir, presetDir, libraryDir: cfg.libraryDir });
    return lib.flows;
  }

  function findFlowTemplate(workspaceDir, templateId) {
    const flows = flowTemplates(workspaceDir);
    const hit = flows.get(templateId);
    if (!hit) {
      const known = [...flows.keys()].sort();
      throw new Error(`${name}: 找不到流程模板 "${templateId}"(可用:${known.length > 0 ? known.join(', ') : '无'})`);
    }
    return hit.flow;
  }

  /** projectId 冲突 → '-2' 递增(含 slugify 日期回退前缀的计数,由调用方负责)。 */
  function uniqueProjectId(workspaceDir, base) {
    let id = base;
    for (let n = 2; existsSync(join(workspaceDir, id)); n++) id = `${base}-${n}`;
    return id;
  }

  async function writeText(file, text) {
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, text, 'utf8');
  }

  // 1. project_register ──────────────────────────────────────────────────────
  async function register(args, context) {
    const workspaceDir = sessionWorkspace(context);
    if (!nonEmptyString(args?.title)) throw new Error(`${name}/project_register: title 必填(非空字符串)`);
    if (!nonEmptyString(args.requirement)) throw new Error(`${name}/project_register: requirement 必填(非空字符串)`);
    if (args.flowTemplate !== undefined && !nonEmptyString(args.flowTemplate)) {
      throw new Error(`${name}/project_register: flowTemplate 必须是非空字符串`);
    }
    if (args.budgetEstimate !== undefined && !isPlainObject(args.budgetEstimate)) {
      throw new Error(`${name}/project_register: budgetEstimate 必须是对象`);
    }
    let customStages;
    if (args.flowStages !== undefined) {
      const checked = validateStageList(args.flowStages);
      if (!checked.ok) throw new Error(`${name}/project_register: flowStages 校验失败:${checked.error}`);
      customStages = checked.value;
    }

    const projectId = uniqueProjectId(workspaceDir, slugify(args.title));
    const paths = pathsFor(workspaceDir, projectId);

    // 流程实例化:flowStages(整体替换)> 显式模板 > 默认 standard-flow。
    // DESIGN §5.4:登记时"选模板(或现场定制)实例化"——只给 flowStages 不给模板
    // 即现场定制,免模板立项(FLOW 记 adhoc@1),不要求库里存在 standard-flow。
    let stages;
    let flowId;
    let flowVersion;
    let flowSource;
    if (customStages !== undefined && args.flowTemplate === undefined) {
      stages = customStages;
      flowId = projectId;
      flowVersion = 1;
      flowSource = 'adhoc@1';
    } else {
      const template = findFlowTemplate(workspaceDir, args.flowTemplate ?? 'standard-flow');
      stages = customStages ?? template.stages;
      flowId = template.id;
      flowVersion = template.version;
      flowSource = `${template.id}@${template.version}`;
    }

    const now = new Date().toISOString();
    const registry = {
      schemaVersion: 1,
      id: projectId,
      title: args.title,
      createdAt: now,
      updatedAt: now,
      flowRef: flowSource,
      iteration: 1,
      stageIndex: 0,
      gateStatus: null,
      state: 'active',
    };
    const flow = { schemaVersion: 1, id: flowId, version: flowVersion, stages, source: flowSource, revision: 1 };
    const budget = { schemaVersion: 1, estimate: args.budgetEstimate ?? null, cap: null, committed: [] };

    await mkdir(paths.projectDir, { recursive: true });
    await Promise.all([
      mkdir(paths.journalDir, { recursive: true }),
      mkdir(paths.gatesDir, { recursive: true }),
      mkdir(paths.feedbackDir, { recursive: true }),
    ]);
    await writeJson(paths.registryFile, registry);
    await writeJson(paths.flowFile, flow);
    await writeJson(paths.budgetFile, budget);
    await writeText(paths.requirementFile, requirementMarkdown(registry, args.requirement));

    return {
      projectId,
      projectDir: paths.projectDir,
      flowSummary: stages.map((stage, index) => stageBrief(stage, index)),
      nextStage: stageBrief(stages[0], 0),
    };
  }

  /** 常规推进:+1;已在最后阶段则必须有 appendStages(返回追加后的第一个新阶段)。 */
  function regularAdvance(stages, curIndex, appendList) {
    if (curIndex < stages.length - 1) return { nextIndex: curIndex + 1, appended: false };
    if (appendList === undefined) {
      throw new Error(`${name}/project_advance: 已是流程最后一个阶段;开启新迭代请给 appendStages(要追加的阶段序列)`);
    }
    return { nextIndex: stages.length, appended: true };
  }

  /** 消费 revise 裁决:从当前门禁包取最后一枚裁决标记,解析 reviseTo → 阶段下标。 */
  function consumeReviseTarget(paths, stages, gateStage, gateIndex) {
    const gatePath = join(paths.gatesDir, gateFileName(gateIndex, gateStage.id));
    if (!existsSync(gatePath)) {
      throw new Error(`${name}/project_advance: 门禁 ${gateStage.id} 的门禁包缺失,无法读取 revise 裁决:${gatePath}`);
    }
    const decision = lastGateDecision(gatePath);
    if (!decision || decision.verdict !== 'revise' || typeof decision.reviseTo !== 'string') {
      throw new Error(`${name}/project_advance: 门禁 ${gateStage.id} 缺少有效的 revise 裁决记录:${gatePath}`);
    }
    const target = stages.find((stage) => stage.id === decision.reviseTo);
    if (!target || target.type !== 'work') {
      throw new Error(`${name}/project_advance: 裁决 reviseTo 指向的阶段不可用:${decision.reviseTo}`);
    }
    return stages.indexOf(target);
  }

  // 2. project_advance ───────────────────────────────────────────────────────
  async function advance(args, context) {
    const workspaceDir = sessionWorkspace(context);
    const projectId = safeProjectId(args?.projectId);
    const paths = pathsFor(workspaceDir, projectId);
    const registry = await readJson(paths.registryFile);
    assertRegistry(registry, paths.registryFile);
    assertActive(registry, projectId);
    const flow = await readJson(paths.flowFile);
    const stages = Array.isArray(flow.stages) ? flow.stages : [];
    const curIndex = registry.stageIndex;
    const cur = stages[curIndex];
    if (!cur) {
      throw new Error(`${name}/project_advance: 流程指针越界(stageIndex=${curIndex},共 ${stages.length} 阶段),登记簿可能被手改`);
    }

    // appendStages 预检:先验形状(fail-fast,不动盘),且只能在最后一个阶段上消费。
    let appendList;
    if (args.appendStages !== undefined) {
      const checked = validateStageList(args.appendStages);
      if (!checked.ok) throw new Error(`${name}/project_advance: appendStages 校验失败:${checked.error}`);
      if (curIndex !== stages.length - 1) {
        throw new Error(`${name}/project_advance: appendStages 只能在最后一个阶段上使用(当前 stageIndex=${curIndex},最后为 ${stages.length - 1})`);
      }
      appendList = checked.value;
    }

    // SPEC 钉死的推进规则:gate+pending 拒;approve 清空推进;revise 跳回;
    // reject 拒(项目已终态);其余常规 +1(最后阶段 + appendStages → iteration+1 新迭代)。
    let nextIndex;
    let flowChanged = false;
    const applyStep = (stepped) => {
      nextIndex = stepped.nextIndex;
      if (stepped.appended) {
        registry.iteration += 1;
        flow.stages.push(...appendList);
        flow.revision = (flow.revision ?? 1) + 1;
        flowChanged = true;
      }
    };
    if (cur.type === 'gate') {
      if (registry.gateStatus === 'pending') {
        throw new Error(`${name}/project_advance: 门禁 ${cur.id} 待裁决,先用 project_gate decide 裁决后再推进`);
      }
      if (registry.gateStatus === 'reject') {
        throw new Error(`${name}/project_advance: 门禁 ${cur.id} 已被否决(项目终态),不能推进`);
      }
      if (registry.gateStatus === 'revise') {
        nextIndex = consumeReviseTarget(paths, stages, cur, curIndex);
        registry.gateStatus = null;
      } else {
        if (registry.gateStatus === 'approve') registry.gateStatus = null;
        applyStep(regularAdvance(stages, curIndex, appendList));
      }
    } else {
      applyStep(regularAdvance(stages, curIndex, appendList));
    }

    const target = flow.stages[nextIndex];
    const now = new Date().toISOString();
    const journalPath = join(paths.journalDir, gateFileName(nextIndex, target.id));
    const head = journalHead(registry, target, nextIndex, flow.stages.length, now, typeof args.note === 'string' ? args.note : undefined);
    if (existsSync(journalPath)) await appendFile(journalPath, `\n---\n\n${head}`, 'utf8');
    else await writeText(journalPath, head);

    registry.stageIndex = nextIndex;
    registry.updatedAt = now;
    await writeJson(paths.registryFile, registry);
    if (flowChanged) await writeJson(paths.flowFile, flow);

    return {
      stageIndex: nextIndex,
      iteration: registry.iteration,
      stage: stageBrief(target, nextIndex),
      journalPath,
    };
  }

  // 3. project_gate ──────────────────────────────────────────────────────────
  async function gate(args, context) {
    const workspaceDir = sessionWorkspace(context);
    const projectId = safeProjectId(args?.projectId);
    const paths = pathsFor(workspaceDir, projectId);
    const registry = await readJson(paths.registryFile);
    assertRegistry(registry, paths.registryFile);
    assertActive(registry, projectId);
    const flow = await readJson(paths.flowFile);
    const stages = Array.isArray(flow.stages) ? flow.stages : [];
    if (!nonEmptyString(args?.stageId)) throw new Error(`${name}/project_gate: stageId 必填`);
    const stageIndex = registry.stageIndex;
    const cur = stages[stageIndex];
    if (!cur || cur.id !== args.stageId) {
      throw new Error(`${name}/project_gate: stageId 必须是当前阶段(当前为 ${cur?.id ?? '未知'}),得到 ${args.stageId}`);
    }
    if (cur.type !== 'gate') {
      throw new Error(`${name}/project_gate: 当前阶段 ${cur.id} 不是门禁(gate)类型`);
    }
    const gatePath = join(paths.gatesDir, gateFileName(stageIndex, cur.id));

    if (args.action === 'present') {
      if (registry.gateStatus === 'pending') {
        throw new Error(`${name}/project_gate: 门禁 ${cur.id} 已呈递且待裁决,不能重复 present`);
      }
      const pkg = args.package;
      if (!isPlainObject(pkg)) throw new Error(`${name}/project_gate: present 需要 package 对象`);
      for (const key of Object.keys(pkg)) {
        if (!['summary', 'materials', 'recommendation'].includes(key)) {
          throw new Error(`${name}/project_gate: package 含未知键 "${key}"`);
        }
      }
      if (typeof pkg.summary !== 'string' || pkg.summary.trim().length === 0) {
        throw new Error(`${name}/project_gate: package.summary 必填(非空字符串)`);
      }
      if (pkg.materials !== undefined && (!Array.isArray(pkg.materials) || pkg.materials.some((x) => typeof x !== 'string' || x.length === 0))) {
        throw new Error(`${name}/project_gate: package.materials 必须是非空字符串数组`);
      }
      if (pkg.recommendation !== undefined && typeof pkg.recommendation !== 'string') {
        throw new Error(`${name}/project_gate: package.recommendation 必须是字符串`);
      }
      // revise 回环:文件已存在但带裁决 = 上一轮已结束,允许开新一轮(第 N 轮呈递);
      // 文件存在但没有裁决 = 有呈递无裁决,登记簿可能被手改,拒绝覆盖。
      if (existsSync(gatePath)) {
        const text = readFileSync(gatePath, 'utf8');
        const hasDecision = [...text.matchAll(GATE_DECISION_MARKER_RE)].length > 0;
        if (!hasDecision) {
          throw new Error(`${name}/project_gate: 门禁包已存在但缺少裁决记录,登记簿可能被手改:${gatePath}`);
        }
      }
      const rounds = existsSync(gatePath)
        ? [...readFileSync(gatePath, 'utf8').matchAll(GATE_PENDING_MARKER_RE)].length + 1
        : 1;
      const now = new Date().toISOString();
      const section = presentSection(cur, rounds, now, pkg);
      if (existsSync(gatePath)) await appendFile(gatePath, `\n---\n\n${section}`, 'utf8');
      else await writeText(gatePath, `${gateMarkdownHeader(cur, stageIndex, registry)}\n${section}`);
      registry.gateStatus = 'pending';
      registry.updatedAt = now;
      await writeJson(paths.registryFile, registry);
      return { gateStatus: 'pending', gatePath };
    }

    if (args.action === 'decide') {
      if (registry.gateStatus !== 'pending') {
        throw new Error(`${name}/project_gate: 门禁 ${cur.id} 未处于待裁决状态(须先 present)`);
      }
      const decision = args.decision;
      if (!isPlainObject(decision)) throw new Error(`${name}/project_gate: decide 需要 decision 对象`);
      for (const key of Object.keys(decision)) {
        if (!['verdict', 'comment', 'reviseTo'].includes(key)) {
          throw new Error(`${name}/project_gate: decision 含未知键 "${key}"`);
        }
      }
      const verdict = decision.verdict;
      if (!['approve', 'revise', 'reject'].includes(verdict)) {
        throw new Error(`${name}/project_gate: decision.verdict 必须是 approve/revise/reject,得到 ${JSON.stringify(verdict ?? null)}`);
      }
      if (decision.comment !== undefined && typeof decision.comment !== 'string') {
        throw new Error(`${name}/project_gate: decision.comment 必须是字符串`);
      }
      if (verdict === 'revise') {
        if (typeof decision.reviseTo !== 'string' || decision.reviseTo.length === 0) {
          throw new Error(`${name}/project_gate: revise 裁决必须给 decision.reviseTo(要退回的 work 阶段 id)`);
        }
        const target = stages.find((stage) => stage.id === decision.reviseTo);
        if (!target) throw new Error(`${name}/project_gate: decision.reviseTo 在流程中不存在:${decision.reviseTo}`);
        if (target.type !== 'work') {
          throw new Error(`${name}/project_gate: decision.reviseTo 必须指向 work 阶段,得到 ${target.type}(${decision.reviseTo})`);
        }
      }
      const now = new Date().toISOString();
      const block = decisionSection(verdict, decision, now);
      if (existsSync(gatePath)) await appendFile(gatePath, `\n${block}`, 'utf8');
      else await writeText(gatePath, `${gateMarkdownHeader(cur, stageIndex, registry)}\n${block}`); // 兜底:文件缺失也落裁决
      registry.gateStatus = verdict;
      if (verdict === 'reject') registry.state = 'rejected';
      registry.updatedAt = now;
      await writeJson(paths.registryFile, registry);
      return { gateStatus: verdict, gatePath };
    }

    throw new Error(`${name}/project_gate: action 必须是 present/decide,得到 ${JSON.stringify(args?.action ?? null)}`);
  }

  // 4. project_budget ────────────────────────────────────────────────────────
  async function budget(args, context) {
    const workspaceDir = sessionWorkspace(context);
    const projectId = safeProjectId(args?.projectId);
    const paths = pathsFor(workspaceDir, projectId);
    const registry = await readJson(paths.registryFile);
    assertRegistry(registry, paths.registryFile);
    const budgetBook = await readJson(paths.budgetFile);
    if (!Array.isArray(budgetBook.committed)) budgetBook.committed = [];
    const action = args?.action;
    if (!['get', 'set-estimate', 'set-cap', 'commit'].includes(action)) {
      throw new Error(`${name}/project_budget: action 必须是 get/set-estimate/set-cap/commit,得到 ${JSON.stringify(action ?? null)}`);
    }
    if (action === 'set-estimate') {
      if (!isPlainObject(args.estimate)) throw new Error(`${name}/project_budget: set-estimate 需要 estimate 对象`);
      budgetBook.estimate = args.estimate;
    }
    if (action === 'set-cap') {
      if (!isPlainObject(args.cap)) throw new Error(`${name}/project_budget: set-cap 需要 cap 对象`);
      budgetBook.cap = args.cap;
    }
    if (action === 'commit') {
      const entry = args.entry;
      if (!isPlainObject(entry)) throw new Error(`${name}/project_budget: commit 需要 entry 对象`);
      for (const key of Object.keys(entry)) {
        if (!['stageId', 'role', 'usage', 'source'].includes(key)) {
          throw new Error(`${name}/project_budget: entry 含未知键 "${key}"`);
        }
      }
      if (!nonEmptyString(entry.stageId)) throw new Error(`${name}/project_budget: entry.stageId 必填`);
      if (!nonEmptyString(entry.role)) throw new Error(`${name}/project_budget: entry.role 必填`);
      if (!isPlainObject(entry.usage)) throw new Error(`${name}/project_budget: entry.usage 必须是对象(形状自由,工具不解释)`);
      const source = entry.source ?? 'self-report';
      if (!BUDGET_SOURCES.includes(source)) {
        throw new Error(`${name}/project_budget: entry.source 必须是 ${BUDGET_SOURCES.join('/')} 之一,得到 ${JSON.stringify(entry.source)}`);
      }
      budgetBook.committed.push({
        at: new Date().toISOString(),
        iteration: registry.iteration,
        stageId: entry.stageId,
        role: entry.role,
        usage: entry.usage,
        source,
      });
    }
    await writeJson(paths.budgetFile, budgetBook);
    return {
      estimate: budgetBook.estimate ?? null,
      cap: budgetBook.cap ?? null,
      committed: budgetBook.committed,
      totals: budgetTotals(budgetBook),
    };
  }

  // 5. project_status ────────────────────────────────────────────────────────
  async function status(args, context) {
    const workspaceDir = sessionWorkspace(context);
    if (args?.projectId !== undefined && args.projectId !== null) {
      const projectId = safeProjectId(args.projectId);
      const paths = pathsFor(workspaceDir, projectId);
      const registry = await readJson(paths.registryFile); // 不存在/损坏 → 带路径的中文报错
      assertRegistry(registry, paths.registryFile);
      let flow = null;
      try {
        flow = await readJson(paths.flowFile);
      } catch {
        flow = null;
      }
      let budgetBook = { estimate: null, cap: null, committed: [] };
      try {
        budgetBook = await readJson(paths.budgetFile);
      } catch {
        budgetBook = { estimate: null, cap: null, committed: [] }; // 老项目缺账本时给空账
      }
      const stages = Array.isArray(flow?.stages) ? flow.stages : [];
      const cur = stages[registry.stageIndex];
      return {
        project: {
          projectId: registry.id,
          title: registry.title ?? '',
          state: registry.state,
          iteration: registry.iteration,
          stageIndex: registry.stageIndex,
          gateStatus: registry.gateStatus ?? null,
          updatedAt: registry.updatedAt ?? '',
          flowRef: registry.flowRef ?? '',
          currentStage: cur ? stageBrief(cur, registry.stageIndex) : null,
          budget: {
            estimate: budgetBook.estimate ?? null,
            cap: budgetBook.cap ?? null,
            totals: budgetTotals(budgetBook),
          },
          summaryExists: existsSync(paths.summaryFile),
        },
      };
    }
    let entries;
    try {
      entries = await readdir(workspaceDir, { withFileTypes: true });
    } catch (error) {
      throw new Error(`${name}/project_status: 读取工作区失败:${error?.message ?? error}`);
    }
    const projects = [];
    const dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    for (const dirName of dirNames) {
      const file = join(workspaceDir, dirName, cfg.registryDir, 'REGISTRY.json');
      if (!existsSync(file)) continue;
      try {
        const registry = await readJson(file);
        projects.push({
          id: registry.id ?? dirName,
          title: registry.title ?? '',
          state: registry.state ?? 'active',
          iteration: registry.iteration ?? 1,
          stageIndex: registry.stageIndex ?? 0,
          updatedAt: registry.updatedAt ?? '',
        });
      } catch (error) {
        logger.warn?.(`${name}/project_status: 跳过损坏的登记簿 ${file}:${error?.message ?? error}`);
      }
    }
    return { projects };
  }

  return { register, advance, gate, budget, status };
}

// ── 工具 schema(纯 JSON Schema;输出值会被运行时按 schema 严格校验)─────────

function stageParamSchema() {
  return {
    type: 'object',
    description: '阶段声明:id 唯一 slug;type ∈ work|gate|summary|internalize;work 必有 role,gate 必有 title。',
    properties: {
      id: { type: 'string', description: '阶段 id(字母/数字/连字符,唯一)。' },
      type: { type: 'string', enum: [...STAGE_TYPES] },
      role: { type: 'string', description: 'work 阶段必填:执行角色 id。' },
      title: { type: 'string', description: 'gate 阶段必填:门禁标题。' },
      produces: { type: 'array', items: { type: 'string' }, description: 'work 阶段声明的产物文件。' },
      present: { type: 'array', items: { type: 'string' }, description: 'gate 阶段呈递材料。' },
      note: { type: 'string' },
    },
    required: ['id', 'type'],
  };
}

function stageBriefSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      index: { type: 'integer' },
      id: { type: 'string' },
      type: { type: 'string' },
      role: { type: 'string' },
      title: { type: 'string' },
    },
    required: ['index', 'id', 'type'],
  };
}

function budgetEntrySchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      at: { type: 'string' },
      iteration: { type: 'integer' },
      stageId: { type: 'string' },
      role: { type: 'string' },
      usage: { type: 'object' },
      source: { type: 'string' },
    },
    required: ['at', 'iteration', 'stageId', 'role', 'usage', 'source'],
  };
}

function budgetTotalsSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      entries: { type: 'integer' },
      byRole: { type: 'object' },
      bySource: { type: 'object' },
    },
    required: ['entries', 'byRole', 'bySource'],
  };
}

function budgetSnapshotSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      estimate: { oneOf: [{ type: 'object' }, { type: 'null' }] },
      cap: { oneOf: [{ type: 'object' }, { type: 'null' }] },
      totals: budgetTotalsSchema(),
    },
    required: ['estimate', 'cap', 'totals'],
  };
}

function projectSummarySchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      state: { type: 'string' },
      iteration: { type: 'integer' },
      stageIndex: { type: 'integer' },
      updatedAt: { type: 'string' },
    },
    required: ['id', 'title', 'state', 'iteration', 'stageIndex', 'updatedAt'],
  };
}

function projectDetailSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      projectId: { type: 'string' },
      title: { type: 'string' },
      state: { type: 'string' },
      iteration: { type: 'integer' },
      stageIndex: { type: 'integer' },
      gateStatus: { oneOf: [{ type: 'null' }, { type: 'string', enum: ['pending', 'approve', 'revise', 'reject'] }] },
      updatedAt: { type: 'string' },
      flowRef: { type: 'string' },
      currentStage: { oneOf: [stageBriefSchema(), { type: 'null' }] },
      budget: budgetSnapshotSchema(),
      summaryExists: { type: 'boolean' },
    },
    required: ['projectId', 'title', 'state', 'iteration', 'stageIndex', 'gateStatus', 'updatedAt', 'flowRef', 'currentStage', 'budget', 'summaryExists'],
  };
}

const REGISTER_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    projectId: { type: 'string' },
    projectDir: { type: 'string' },
    flowSummary: { type: 'array', items: stageBriefSchema() },
    nextStage: stageBriefSchema(),
  },
  required: ['projectId', 'projectDir', 'flowSummary', 'nextStage'],
};

const ADVANCE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    stageIndex: { type: 'integer' },
    iteration: { type: 'integer' },
    stage: stageBriefSchema(),
    journalPath: { type: 'string' },
  },
  required: ['stageIndex', 'iteration', 'stage', 'journalPath'],
};

const GATE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    gateStatus: { oneOf: [{ type: 'null' }, { type: 'string', enum: ['pending', 'approve', 'revise', 'reject'] }] },
    gatePath: { type: 'string' },
  },
  required: ['gateStatus', 'gatePath'],
};

const BUDGET_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    estimate: { oneOf: [{ type: 'object' }, { type: 'null' }] },
    cap: { oneOf: [{ type: 'object' }, { type: 'null' }] },
    committed: { type: 'array', items: budgetEntrySchema() },
    totals: budgetTotalsSchema(),
  },
  required: ['estimate', 'cap', 'committed', 'totals'],
};

const STATUS_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    projects: { type: 'array', items: projectSummarySchema() },
    project: projectDetailSchema(),
  },
};

// ── 共享手册提示段(SPEC §9;中文,提纲写全)────────────────────────────────

const MANUAL_TEXT = `## 项目制交付速查(project-pipeline)

### 登记簿布局
每个项目一个目录:<workspace>/<projectId>/.dsh-project/:
- REGISTRY.json:项目元数据(id/标题/流程指针 stageIndex/迭代 iteration/门禁态 gateStatus/状态 state)
- FLOW.json:流程实例(模板实例化产物,可带项目内修订,revision 递增)
- REQUIREMENT.md:需求原文(逐字);BUDGET.json:预算账本;SUMMARY.md:总结链
- journal/NN-<stageId>.md:逐阶段日志(推进时自动开条,角色补写产出与结论)
- gates/NN-<stageId>.md:门禁包与裁决记录;feedback/NN.md:验收反馈登记
角色库与流程库在 <workspace>/.dsh-library/(roles|flows),workspace 同名条目覆盖 preset 自带。

### 工具速查(登记簿 5 + 库 4)
1. project_register:登记新项目。title+requirement 必填;flowTemplate 选模板(默认 standard-flow)或给 flowStages 现场定制;可带 budgetEstimate。返回项目 id 与流程概要。
2. project_advance:推进到下一阶段。门禁 pending 会拒绝;approve 裁决后推进并清门禁态;revise 裁决跳回 reviseTo 的 work 阶段;在最后阶段给 appendStages 开新迭代(iteration+1)。每次推进自动写 journal。
3. project_gate:门禁两步。present 把摘要/材料/建议写成门禁包并置 pending;decide 记录用户裁决(approve/revise/reject),revise 必给 reviseTo(流程中已有的 work 阶段 id),reject 使项目终态。
4. project_budget:get 查账(含 totals);set-estimate / set-cap 设估算与上限;commit 逐阶段上报消耗(stageId/role/usage,source 默认 self-report)。
5. project_status:不带 projectId 列出工作区全部项目;带 projectId 看单项目详情(当前阶段/门禁态/预算聚合/SUMMARY 是否存在)。
6. role_list / role_show:查角色清单;role_show 返回可直接拷进 subagent 调用的参数(persona/toolFilter/agentOptions)与 workspaceNote。
7. flow_list / flow_show:查流程模板(含 stageCount/stages),workspace 库覆盖 preset 自带。

### 阶段类型四词表
- work:派一个角色干一件活(必有 role),角色结算后由协调者校验并推进。
- gate:门禁停摆点。必须 present 呈递门禁包并等用户 decide 裁决,未裁决不能推进。
- summary:协调者汇总本轮产出/决策/教训,追加 SUMMARY.md,自动推进。
- internalize:内化。收割可复用资产(角色清单变体/流程变体/教训)写 <workspace>/.dsh-library/,下个项目登记即可用。

### settlement 流转
角色子代理运行结束 → settlement 通知协调者,协调者核对产出后 project_advance 推进(流水线不需要用户消息);
协调者一段运行结束 → 通知用户会话:带门禁包则原样呈现摘要与建议等裁决,例行进度一行带过即可。
跨压缩/跨重启恢复以 REGISTRY.json + FLOW.json + SUMMARY.md 为权威上下文,不依赖对话历史。

### 预算上报纪律
每完成一个阶段,协调者(或角色)用 project_budget commit 上报该阶段消耗(stageId/role/usage),
source 用默认 self-report;estimate/cap 形状自由,工具不解释其内容。usage 尽力而为,趋势参考即可。

### 路径纪律
- 一切项目文件都在 <workspace>/<projectId>/ 内;projectId 由标题清洗为 kebab slug,含路径分隔符或 ".." 的 id 一律拒绝。
- 角色 workspace=project-root:只在 <workspace>/<projectId>/ 内读写;journal 用 write 追加;登记簿 JSON 只经上述工具修改,不手改。
- 内化产出只写 <workspace>/.dsh-library/(workspace 级),不回写 preset 目录。`;

// ── 插件主体 ────────────────────────────────────────────────────────────────

export function apply(ctx, config = {}) {
  const cfg = normalizeConfig(config);
  // preset 自带库 = 插件文件 ../..(即 preset 根)下的 roles|flows(SPEC §4 库解析)。
  const presetDir = fileURLToPath(new URL('..', import.meta.url));
  const api = makeApi({ cfg, presetDir, logger: ctx.logger });
  const disposers = [];

  disposers.push(ctx.systemPrompt.section({
    name: 'project-pipeline/manual',
    order: 140,
    text: MANUAL_TEXT,
  }));

  disposers.push(ctx.tools.register({
    name: 'project_register',
    description: '登记新项目:创建 <workspace>/<projectId>/.dsh-project 登记簿骨架(REGISTRY/FLOW/BUDGET/REQUIREMENT.md),按模板或定制阶段实例化流程,返回项目 id 与流程概要。projectId 由标题清洗为 kebab slug,冲突自动 -2 递增。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: '项目标题(必填非空),将清洗为 ASCII kebab 目录名。' },
        requirement: { type: 'string', description: '需求原文,逐字登记进 REQUIREMENT.md。' },
        flowTemplate: { type: 'string', description: '流程模板 id,默认 standard-flow;模板来自 workspace/.dsh-library/flows 与 preset 自带 flows。' },
        flowStages: {
          type: 'array',
          description: '定制阶段序列:给出时整体替换模板 stages;只给本参数不给 flowTemplate 时免模板现场立项。',
          items: stageParamSchema(),
        },
        budgetEstimate: { type: 'object', description: '预算估算(形状自由),登记进 BUDGET.estimate。' },
      },
      required: ['title', 'requirement'],
    },
    output: {
      schema: REGISTER_OUTPUT_SCHEMA,
      render: (_args, value) => [
        `已登记项目 ${value.projectId}(目录:${value.projectDir})`,
        `流程共 ${value.flowSummary.length} 个阶段;下一阶段 #${value.nextStage.index + 1} ${value.nextStage.id}(${stageTypeLabel(value.nextStage.type)}${value.nextStage.role ? ` · ${value.nextStage.role}` : ''})。`,
      ].join('\n'),
    },
    async execute(args, context) {
      return api.register(args, context);
    },
  }));

  disposers.push(ctx.tools.register({
    name: 'project_advance',
    description: '推进项目流程指针到下一阶段。门禁待裁决时拒绝;approve 裁决后推进并清门禁态;revise 裁决跳回 reviseTo 指定的 work 阶段;在最后阶段给 appendStages 可开启新迭代。每次推进自动写 journal 并刷新 REGISTRY.updatedAt。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string', description: '项目 id(project_register 返回的 kebab slug)。' },
        note: { type: 'string', description: '推进备注,写进目标阶段 journal 头条。' },
        appendStages: {
          type: 'array',
          description: '在最后一个阶段追加的阶段序列(iteration+1,开启新迭代);仅限最后一个阶段使用。',
          items: stageParamSchema(),
        },
      },
      required: ['projectId'],
    },
    output: {
      schema: ADVANCE_OUTPUT_SCHEMA,
      render: (args, value) => `项目 ${args.projectId} 推进到阶段 #${value.stageIndex + 1} ${value.stage.id}(${stageTypeLabel(value.stage.type)}${value.stage.role ? ` · ${value.stage.role}` : ''},第 ${value.iteration} 次迭代);日志:${value.journalPath}`,
    },
    async execute(args, context) {
      return api.advance(args, context);
    },
  }));

  disposers.push(ctx.tools.register({
    name: 'project_gate',
    description: '门禁两步制:present 把摘要/材料/建议写成门禁包(gates/NN-<stageId>.md)并置 pending;decide 记录用户裁决(approve/revise/reject)——revise 必给 reviseTo(work 阶段 id),reject 使项目终态。stageId 必须是当前阶段。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string', description: '项目 id。' },
        stageId: { type: 'string', description: '门禁阶段 id(必须是当前阶段)。' },
        action: { type: 'string', enum: ['present', 'decide'], description: 'present=呈递门禁包;decide=记录裁决。' },
        package: {
          type: 'object',
          description: 'present 必给:{ summary 必填, materials?, recommendation? }。',
          properties: {
            summary: { type: 'string', description: '给用户看的门禁摘要(必填)。' },
            materials: { type: 'array', items: { type: 'string' }, description: '待审材料清单(文件名/路径)。' },
            recommendation: { type: 'string', description: '建议(例如:建议批准,因为…)。' },
          },
          required: ['summary'],
        },
        decision: {
          type: 'object',
          description: 'decide 必给:{ verdict: approve|revise|reject, comment?, reviseTo?(revise 必给) }。',
          properties: {
            verdict: { type: 'string', enum: ['approve', 'revise', 'reject'], description: '用户裁决结论。' },
            comment: { type: 'string', description: '用户意见原文。' },
            reviseTo: { type: 'string', description: 'revise 时必给:要退回的 work 阶段 id。' },
          },
          required: ['verdict'],
        },
      },
      required: ['projectId', 'stageId', 'action'],
    },
    output: {
      schema: GATE_OUTPUT_SCHEMA,
      render: (args, value) => `项目 ${args.projectId} 门禁 ${args.stageId} → ${value.gateStatus};门禁包:${value.gatePath}`,
    },
    async execute(args, context) {
      return api.gate(args, context);
    },
  }));

  disposers.push(ctx.tools.register({
    name: 'project_budget',
    description: '项目预算账本(BUDGET.json):get 查账(含 totals 聚合);set-estimate / set-cap 设置估算与上限(形状自由,工具不解释);commit 逐阶段上报消耗(entry.stageId/role/usage,source 默认 self-report)。每阶段结算后都应上报一次。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string', description: '项目 id。' },
        action: { type: 'string', enum: ['get', 'set-estimate', 'set-cap', 'commit'], description: '账本操作。' },
        estimate: { type: 'object', description: 'set-estimate 必给:估算(形状自由)。' },
        cap: { type: 'object', description: 'set-cap 必给:上限(形状自由)。' },
        entry: {
          type: 'object',
          description: 'commit 必给:{ stageId, role, usage, source?=self-report }。',
          properties: {
            stageId: { type: 'string', description: '发生消耗的阶段 id。' },
            role: { type: 'string', description: '消耗归属角色 id。' },
            usage: { type: 'object', description: '用量(记 token/调用次数/金额字段均可,形状自由)。' },
            source: { type: 'string', enum: [...BUDGET_SOURCES], description: '取数口径,默认 self-report。' },
          },
          required: ['stageId', 'role', 'usage'],
        },
      },
      required: ['projectId', 'action'],
    },
    output: {
      schema: BUDGET_OUTPUT_SCHEMA,
      render: (args, value) => [
        `项目 ${args.projectId} 预算(${args.action})`,
        `账面:estimate=${JSON.stringify(value.estimate)};cap=${JSON.stringify(value.cap)};committed ${value.totals.entries} 条;按角色 ${JSON.stringify(value.totals.byRole)};按来源 ${JSON.stringify(value.totals.bySource)}`,
      ].join('\n'),
    },
    async execute(args, context) {
      return api.budget(args, context);
    },
  }));

  disposers.push(ctx.tools.register({
    name: 'project_status',
    description: '项目查询:不带 projectId 列出工作区全部项目(id/标题/状态/迭代/阶段);带 projectId 返回单项目详情(当前阶段、门禁态、预算 totals、SUMMARY 是否存在)。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string', description: '省略 = 列出工作区全部项目;给出 = 单项目详情。' },
      },
    },
    output: {
      schema: STATUS_OUTPUT_SCHEMA,
      render: (_args, value) => {
        if (value.projects) {
          if (value.projects.length === 0) return '工作区还没有任何项目(用 project_register 登记)。';
          return [
            `工作区共 ${value.projects.length} 个项目:`,
            ...value.projects.map((p) => `- ${p.id}「${p.title}」${p.state},第 ${p.iteration} 次迭代,阶段 #${p.stageIndex + 1}(更新于 ${p.updatedAt})`),
          ].join('\n');
        }
        const p = value.project;
        return [
          `项目 ${p.projectId}「${p.title}」:${p.state},第 ${p.iteration} 次迭代,当前阶段 #${p.stageIndex + 1} ${p.currentStage ? `${p.currentStage.id}(${stageTypeLabel(p.currentStage.type)})` : '(指针越界)'},gateStatus=${JSON.stringify(p.gateStatus)},流程 ${p.flowRef}`,
          `预算:committed ${p.budget.totals.entries} 条;SUMMARY ${p.summaryExists ? '已存在' : '尚无'};更新于 ${p.updatedAt}`,
        ].join('\n');
      },
    },
    async execute(args, context) {
      return api.status(args, context);
    },
  }));

  // 官方约定:每个贡献都要能在插件停止时撤除 —— 经 ctx.effect 挂清理。
  ctx.effect(() => {
    for (const dispose of disposers.splice(0)) dispose?.();
  });
}

export default { name, inject, apply };
