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
// 贡献不接线 ctx.effect 手动清理(preset 行上下文中该回调在挂载定型期被触发,会把贡献
// 全部 dispose 掉 —— 实测教训 2026-08-29;官方 tool-fs/persona/custom-bash 均不接线,
// services 自管理生命周期);config 在 apply 内 fail-fast 校验。
//
// 0.5.0 新增(机制1~4,2026-08-30):
//   - 机制1 既定裁决库:MANUAL_TEXT 增「既定裁决库」小节(引用规则/命中判据/用户可自增);
//   - 机制2 失败模式聚合:MANUAL_TEXT 增「失败模式聚合」小节(harvest 步骤 + 边界);
//   - 机制3 部署自检:MANUAL_TEXT 增「部署自检」小节(适用判定/核对步骤/门禁包三要素);
//   - 机制4 暂存区 parking:register 增 parked 参数(state='parked');advance 增 parked
//     激活路径(activate:true → parked→active,stageIndex=0);ADVANCE/REGISTER 输出 schema
//     增 state/activated;MANUAL_TEXT 增「暂存区 parked 语义」小节。
// 0.5.1 新增(迭代7 中文命名,2026-08-30):
//   - register 解耦:新增可选 id 入参(显式英文 slug),title 自由中文;纯中文 title 无
//     显式 id 时拒收并提示提供 id(不引入拼音依赖);混合 title 维持现状 slugify(向后兼容)。
//   - 工具 schema 增 id 属性;MANUAL_TEXT 工具速查补 id 说明。
// 0.8.0 新增(预算账本改真实 token 计量,2026-08-31):
//   - 会话登记(主备两路):主=advance 传 sessions:[{sessionId,role}](spawn-pass);
//     备=角色首调 project 工具自动记(auto-record,按调用类型推断角色)。
//   - A:project_budget commit 允许 source='runtime-events' 且 usage 缺省 → 按调用者
//     会话 id 读 projcache 自动填四桶(真实 token)。
//   - B:advance 结算联动自动归集(幂等+非致命):重算本项目私有会话真实 tokenUsage
//     按角色分桶写 committed(source=runtime-events);R2 替换语义(移除全部 runtime-events
//     条目重写,同一 sessionId 不双重计数);intake 及共享会话只进工作区级 sharedOnce。
//   - config 增 projcachePath(显式优先)+ env DSH_HOME 回退;读时守卫 unit.version。
// 0.10.0 新增(项目底座层 Base Dossier P1,2026-09-01):
//   - assertRegistry 兼容 schemaVersion ∈ {1, 2}(C3:读旧登记簿不报错、写回不迁移);
//   - register 增 entity 入参(entity-slug,缺省=项目自身);写 schemaVersion=2 + entitySlug;
//     检测底座存在性,回执 baseDossier{entity,path,exists,draftNeeded};新 entity 时扩展
//     clarify 阶段 produces 产出底座初稿四件套(流程数据表达,不加新阶段类型);
//   - status 单项目详情增 entitySlug(经 entitySlugOf);
//   - MANUAL_TEXT 增「底座 Base Dossier」小节。
// 0.11.0 新增(P4 记忆治理·消费路由优先,2026-09-02):
//   - block() 运行时 category 校验改用 resolveBlockerCategories(核心集 + categories.json 扩展),
//     不再维护独立枚举(单一权威 = project-lib,消除双份漂移);
//   - project_block 工具 schema 的 category 由 enum 改 type:string + description(运行时兜底,
//     兼容任意扩展,疑问 4 定稿);
//   - 新增 project_harvest 工具(action=rebuild-index 扫 lessons/patterns 按元数据归类
//     建 lessons-index.json 保留 hits + bump-hits 递增);MANUAL_TEXT 工具速查补条目。
// 0.12.0 新增(成本计量 v2 kr-cost-v2,2026-09-02):
//   - A 路 commit(source=runtime-events,usage 缺省)自动填桶扩四桶:cacheReadTokens/cacheWriteTokens
//     + model/provider(经模型 seam:agent 路由 options/session.requestHeader().config,可选
//     ctx.get('llm').resolveModelInfo 规范名增强,取不到显式 'unknown').
//   - B 路 collect carry-forward 溯源:重写前从被移除 runtime-events 条目按 session 收集
//     model 溯源并入角色桶(无溯源 → 'unknown');禁止用协调者路由冒充角色桶.
//   - project_budget get 的 totals 增 totalToken(单一权威总 token 纯函数 sum)+ byModel + cacheRate;
//     project_status 详情 project.budget 增 totalToken + 按 role 的 totalToken 展开(byRoleTotal).
//   - budgetTotalsSchema/budgetSnapshotSchema 扩展;MANUAL_TEXT 补「统一总 token 口径与缓存率」
//     「model 来源说明」小节;makeApi 增 ctx(供 modelRoute 经 ctx.get('llm') 增强).
// 0.13.0 新增(entity 底座互斥显式化,kr-entity-mutex,2026-09-03):
//   - register 登记时 + advance(activate:true) 激活时做同 entity active 互斥检测
//     (project-lib.entityConflictActive 纯函数);命中且非 parked → 明确拒绝(不静默并行),
//     建议以 parked:true 排队;parked 登记回执/激活回执带 entityConflict 冲突信号.
//   - REGISTER_OUTPUT_SCHEMA/ADVANCE_OUTPUT_SCHEMA 增 entityConflict(可选);
//   - MANUAL_TEXT「资源触点互斥声明」「暂存区 parked 语义」补 entity 维度句.
// 0.15.0 新增(自省审计回路 kr-self-audit,2026-09-03):
//   - 新增独立 project_audit 工具(action=run/status):观察 → 规则表引擎 → 去重限频 → 三档分流
//     (F2 走 project_register auto:true / F1 呈递 payload / F3 直改留痕),写 .dsh-library/audit-trail.json
//     append-only;领地白名单硬校验(规则表 act:F4 / 对 F1 客体升权 F2 → 引擎拒绝报错=AC1)。
//   - MANUAL_TEXT 增「自省审计回路」小节 + 工具速查补 project_audit 条目。
// 0.16.0 新增(验收路由前置化 kr-accept-route,2026-09-04):
//   - delivery-gate present 机械核对:读 SPEC.md 解析 acceptance-routing 结构化字段,
//     调 project-lib.validateAcceptanceRouting 校验 AC 对照表路由声明;非法 → 拒绝呈递
//     (r4 语义:真机项由用户侧 blocking 执行,不得以静态放行替代)。
//   - MANUAL_TEXT 增「验收路由前置化」小节 + 工具速查补 delivery-gate 机械核对句。
//   - (delivery-gate 第 1 轮 revise 返工,存量项目零影响)块缺失(存量/未声明)→ 不拒绝,
//     跳过核对,呈递包加观察行「acceptance-routing 块缺失(存量/未声明),路由核对未执行」;
//     块存在 → 严格校验(非法仍 throw);SPEC.md 文件缺失仍 throw(契约违例)。

import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUDGET_SOURCES,
  STAGE_TYPES,
  aggregateByModel,
  aggregateByRole,
  baseDossierExists,
  baseDossierPaths,
  cacheRate,
  entityConflictActive,
  entitySlugOf,
  normalizeUsage,
  readJson,
  readProjcache,
  registryPaths,
  resolveBlockerCategories,
  resolveLibrary,
  sessionTokenUsage,
  slugify,
  slugifyStrict,
  totalToken,
  validateStageList,
  buildLessonsIndex,
  bumpLessonHits,
  validateLessonEntry,
  validateLessonsIndex,
  writeJson,
  auditDedupe,
  auditRateLimit,
  auditRuleEngine,
  auditTrailPath,
  applyF3DirectEdit,
  buildF1Payload,
  buildF2Payload,
  buildF3Payload,
  evidenceChain,
  readAuditRules,
  readAuditTrail,
  readJsonRetry,
  runObservations,
  validateAuditRules,
  ACCEPTANCE_ROUTES,
  ACCEPTANCE_TRIGGER_CLASSES,
  parseAcceptanceRouting,
  validateAcceptanceRouting,
} from './project-lib.mjs';

export const name = 'project-pipeline-registry';

/** 卡点分类(= 五维可行性维度 + other;project_block report 用)。 */
export const BLOCKER_CATEGORIES = [
  'design-info',            // 设计可行性:信息不完备(需求/参照/边界缺失)
  'dev-complexity',         // 开发可行性:复杂度/体量/依赖超出角色能力
  'test-env',               // 测试可行性:验证所需环境/数据/凭据不具备
  'deploy-permission',      // 部署可行性:目标路径权限/沙箱边界/凭据/重启窗口
  'acceptance-capability',  // 验收可行性:验收手段与验收者能力不匹配(如视觉验收无视觉)
  'other',
];

/** 卡点分类的中文一说(渲染与手册用)。 */
function blockerCategoryLabel(category) {
  return {
    'design-info': '设计可行性(信息不完备)',
    'dev-complexity': '开发可行性(复杂度超限)',
    'test-env': '测试可行性(环境/数据不具备)',
    'deploy-permission': '部署可行性(权限/沙箱限制)',
    'acceptance-capability': '验收可行性(验收手段缺失)',
    other: '其他',
  }[category] ?? category;
}

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

/** config fail-fast:registryDir / libraryDir 均为单级非空目录名,projcachePath 为路径,未知键报错。 */
function normalizeConfig(config = {}) {
  const cfg = { registryDir: '.dsh-project', libraryDir: '.dsh-library', projcachePath: undefined };
  for (const key of Object.keys(config ?? {})) {
    if (key !== 'registryDir' && key !== 'libraryDir' && key !== 'projcachePath') {
      throw new Error(`${name}: config 含未知键 "${key}"(仅支持 registryDir/libraryDir/projcachePath)`);
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
  if (config?.projcachePath !== undefined) {
    if (typeof config.projcachePath !== 'string' || config.projcachePath.trim().length === 0) {
      throw new Error(`${name}: config.projcachePath 必须是非空字符串(projcache 检查点文件绝对路径)`);
    }
    cfg.projcachePath = config.projcachePath;
  }
  return cfg;
}

/** projcache 路径:显式 config 优先,env DSH_HOME 回退;都没有 → null。 */
function projcachePath(cfg) {
  if (typeof cfg.projcachePath === 'string' && cfg.projcachePath.length > 0) return cfg.projcachePath;
  const home = process.env.DSH_HOME;
  if (typeof home === 'string' && home.length > 0) return join(home, 'storages', 'session_projcache.json');
  return null;
}

/** 会话工作区:见文件头调研结论;拿不到就报中文错,不做 process.cwd() 兜底。 */
function sessionWorkspace(context) {
  const cwd = context?.agent?.session?.header?.cwd;
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new Error(`${name}: 无法确定会话工作区(执行上下文缺少 agent.session.header.cwd;本工具须由会话内的模型调用)`);
  }
  return cwd;
}

/** 会话 id(硬归属):工具 execute 第二参 context.agent.session.header.id。 */
function sessionIdOf(context) {
  return context?.agent?.session?.header?.id;
}

/**
 * model 捕获 seam(D1 定案,2026-09-02):model 来源 = 上报会话的 agent 路由——
 *   优先 session.requestHeader()?.config.{provider,model},回退 agent.options.{provider,model}。
 *   可选经 ctx.get('llm').resolveModelInfo(provider, model) 解析规范 {id} 增强
 *   (try/catch 降级:异常/拒绝/服务缺失 → 用原始路由串,不伪造)。
 * 取不到 → { model:'unknown', provider:null }(显式标注,命中 unsupported-degradation)。
 * 严禁伪造/静默缺省;禁止用协调者/其他会话路由冒充本会话角色桶。
 */
async function modelRoute(ctx, context) {
  const agent = context?.agent;
  let routed;
  try {
    routed = agent?.session?.requestHeader?.()?.config ?? {};
  } catch {
    routed = {};
  }
  const opts = agent?.options ?? {};
  const provider = routed.provider ?? opts.provider;
  const model = routed.model ?? opts.model;
  if (typeof model !== 'string' || model.length === 0) {
    return { model: 'unknown', provider: null };
  }
  let label = model;
  const providerOut = typeof provider === 'string' && provider.length > 0 ? provider : null;
  try {
    const llm = ctx?.get?.('llm');
    if (llm && typeof llm.resolveModelInfo === 'function') {
      const info = await llm.resolveModelInfo(provider, model);
      if (info !== null && typeof info === 'object' && typeof info.id === 'string' && info.id.length > 0) {
        label = info.id; // 规范名增强;info.name 亦可备将来展示(此处 label 取 id)
      }
    }
  } catch {
    // 降级:保留原始路由串 model,不伪造、不抛。
  }
  return { model: label, provider: providerOut };
}

/**
 * 会话登记(REGISTRY.sessions)。主备两路共用:
 * - 主路 spawn-pass:协调者 advance 时显式传 spawn 返回的 subagentId;
 * - 兜底 auto-record:角色首调 project 工具自动记(按调用类型推断角色)。
 * 已登记会话保留首见 role(避免角色漂移),仅刷新 lastSeenAt。
 * 返回是否写入(会话 id 合法即 true)。
 */
function recordSession(registry, sessionId, role, capturePath, now) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return false;
  if (!isPlainObject(registry.sessions)) registry.sessions = {};
  const existing = registry.sessions[sessionId];
  if (existing && typeof existing === 'object') {
    existing.lastSeenAt = now;
    return true;
  }
  registry.sessions[sessionId] = { role, capturePath, firstSeenAt: now, lastSeenAt: now };
  return true;
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
  // C3 兼容:接受 schemaVersion ∈ {1, 2}(旧 1 与新 2 都能读;写回不迁移)。
  if (!isPlainObject(value) || (value.schemaVersion !== 1 && value.schemaVersion !== 2)) {
    throw new Error(`${name}: 登记簿不认识或已损坏(schemaVersion 必须=1 或 2):${file}`);
  }
}

function assertActive(registry, projectId) {
  if (registry.state !== 'active') {
    throw new Error(`${name}: 项目 ${projectId} 已终态(${registry.state}),拒绝继续变更`);
  }
}

/** 未解决卡点清单(老登记簿无 blockers 字段视作空)。 */
function openBlockerList(registry) {
  return Array.isArray(registry?.blockers) ? registry.blockers.filter((b) => b?.status === 'open') : [];
}

/** 卡点 journal 留痕(当前阶段 journal 文件追加;缺失则创建)。 */
async function appendBlockerJournal(paths, registry, text) {
  let stageId = null;
  try {
    const flow = await readJson(paths.flowFile);
    const stages = Array.isArray(flow.stages) ? flow.stages : [];
    stageId = stages[registry.stageIndex]?.id ?? null;
  } catch {
    stageId = null;
  }
  if (stageId === null) return;
  const journalPath = join(paths.journalDir, gateFileName(registry.stageIndex, stageId));
  if (existsSync(journalPath)) await appendFile(journalPath, `\n---\n\n${text}\n`, 'utf8');
  else {
    await mkdir(paths.journalDir, { recursive: true });
    await writeFile(journalPath, `${text}\n`, 'utf8');
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

/**
 * totals:committed 逐条计数聚合 + 统一总 token 口径(cost-v2)。
 * 返回 { entries, byRole(计数), bySource(计数),
 *        totalToken(权威总 token 纯函数 sum), byModel(按 model 分组聚合),
 *        cacheRate(聚合缓存率), byRoleTotal(按 role 的 totalToken 展开) }。
 * 所有数值展示统一走 project-lib 的 totalToken()/cacheRate() 纯函数,不硬编码第二套口径(AC-R1)。
 */
function budgetTotals(budget) {
  const committed = Array.isArray(budget?.committed) ? budget.committed : [];
  const byRole = {};
  const bySource = {};
  const byRoleTotal = {};
  let totalTokenSum = 0;
  let aggCacheRead = 0;
  let aggUncachedInput = 0;
  for (const entry of committed) {
    byRole[entry.role] = (byRole[entry.role] ?? 0) + 1;
    bySource[entry.source] = (bySource[entry.source] ?? 0) + 1;
    const tt = totalToken(entry.usage);
    totalTokenSum += tt;
    byRoleTotal[entry.role] = (byRoleTotal[entry.role] ?? 0) + tt;
    const n = normalizeUsage(entry.usage);
    aggCacheRead += n.cacheReadTokens;
    aggUncachedInput += n.uncachedInputTokens;
  }
  return {
    entries: committed.length,
    byRole,
    bySource,
    totalToken: totalTokenSum,
    byModel: aggregateByModel(committed),
    cacheRate: cacheRate({ cacheReadTokens: aggCacheRead, uncachedInputTokens: aggUncachedInput }),
    byRoleTotal,
  };
}

// ── 工具实现(经 makeApi 闭包持有 cfg/presetDir/logger/ctx)────────────────

function makeApi({ cfg, presetDir, logger, ctx }) {
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

  /**
   * 验收路由前置化机械核对(0.16.0,kr-accept-route,delivery-gate 第 1 轮 revise 返工):
   * 仅对 delivery-gate 阶段生效。读 <projectDir>/SPEC.md,解析 acceptance-routing 结构化
   * 字段,调 project-lib 的 validateAcceptanceRouting 校验 AC 对照表路由声明。
   * 行为(存量项目零影响):
   *   - SPEC.md 文件缺失 → throw(流水线契约违例,另一回事);
   *   - SPEC 存在但 acceptance-routing 块缺失(存量/未声明)→ 不拒绝,跳过核对,
   *     返回 { skipped:true, note }(delivery-gate 呈递包据此加观察行,缺口可见不阻断);
   *   - 块存在 → 严格校验(非法/错路由 → throw 拒绝呈递,r4 语义)。
   * 非 delivery-gate 阶段直接返回 undefined(不影响既有门禁)。
   */
  async function checkAcceptanceRouting(paths, stageId) {
    if (stageId !== 'delivery-gate') return undefined;
    const specFile = join(paths.projectDir, 'SPEC.md');
    let specText;
    try {
      specText = await readFile(specFile, 'utf8');
    } catch (error) {
      throw new Error(`${name}/project_gate: delivery-gate 机械核对需要 SPEC.md(读取失败:${error?.code ?? error?.message ?? error})`);
    }
    const parsed = parseAcceptanceRouting(specText);
    if (parsed.error) {
      // 块缺失(存量/未声明)→ 不拒绝,跳过核对,返回观察行。
      if (parsed.missing) {
        return { skipped: true, note: 'acceptance-routing 块缺失(存量/未声明),路由核对未执行' };
      }
      // 块存在但畸形(未闭合/行格式非法/空块)→ 严格校验,拒绝呈递。
      throw new Error(`${name}/project_gate: delivery-gate 机械核对失败(SPEC acceptance-routing 解析):${parsed.error}`);
    }
    const checked = validateAcceptanceRouting(parsed.entries);
    if (!checked.ok) {
      throw new Error(`${name}/project_gate: delivery-gate 机械核对失败(AC 对照表路由声明非法):${checked.errors.join('; ')}`);
    }
    return undefined;
  }

  /**
   * B:advance 结算联动自动归集(幂等 + 非致命,不新增 action)。
   * 重算本项目私有会话真实 tokenUsage 按角色分桶写 committed(source=runtime-events);
   * R2 替换语义:移除全部 runtime-events 条目(含 A 写入的)重写,同一 sessionId 不双重计数。
   * 共享会话(role='intake' 或 ≥2 项目登记)不进本项目账本(进工作区级 sharedOnce)。
   * sibling REGISTRY 读取失败按非致命处理(C2),跳过并在 note 说明,不阻断 advance。
   * 返回 { ok, buckets, note? }。
   */
  async function collectRuntimeEvents({ workspaceDir, projectId, paths, registry }) {
    const projcacheFile = projcachePath(cfg);
    if (projcacheFile === null) {
      return { ok: false, buckets: {}, note: '未配置 projcachePath 且无 DSH_HOME,跳过归集' };
    }
    // 1. 扫全部项目 REGISTRY.sessions(含当前),统计会话被登记的项目数。
    const sessionProjectCount = new Map();
    const sessionRoles = new Map();
    for (const [sid, meta] of Object.entries(registry.sessions ?? {})) {
      sessionProjectCount.set(sid, (sessionProjectCount.get(sid) ?? 0) + 1);
      sessionRoles.set(sid, meta?.role);
    }
    let entries;
    try {
      entries = await readdir(workspaceDir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    const notes = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sid = entry.name;
      if (sid === projectId) continue;
      const regFile = join(workspaceDir, sid, cfg.registryDir, 'REGISTRY.json');
      let sibling;
      try {
        sibling = JSON.parse(await readFile(regFile, 'utf8'));
      } catch (error) {
        notes.push(`跳过 sibling ${sid}(REGISTRY 读取失败:${error?.code ?? error?.message ?? error})`);
        continue;
      }
      if (sibling === null || typeof sibling !== 'object' || !sibling.sessions) continue;
      for (const s of Object.keys(sibling.sessions)) {
        sessionProjectCount.set(s, (sessionProjectCount.get(s) ?? 0) + 1);
      }
    }
    // 2. 判定共享会话:role='intake' 或 ≥2 项目登记。
    const shared = new Set();
    for (const [sid, count] of sessionProjectCount) {
      if (sessionRoles.get(sid) === 'intake' || count >= 2) shared.add(sid);
    }
    // 3. 私有会话 = 本项目 sessions 中非共享者。
    const privateSessions = {};
    for (const [sid, meta] of Object.entries(registry.sessions ?? {})) {
      if (shared.has(sid)) continue;
      privateSessions[sid] = meta;
    }
    // 4. 读 projcache(守卫 unit.version)。
    let projcache;
    try {
      projcache = await readProjcache(projcacheFile);
    } catch (error) {
      return { ok: false, buckets: {}, note: `projcache 读取失败,跳过归集:${error?.message ?? error}` };
    }
    // 5. 读 budgetBook,取将被移除的 runtime-events 条目 → carry-forward model 溯源。
    //    model 来源只能由上报会话(角色本会话)在 A 路 commit 时捕获,collect(协调者会话)
    //    无法从 projcache 重建;故从被移除的 A 路条目按 session 收集 {model,provider} 并入桶
    //    (D1-A/B 定案);禁止用协调者自身路由冒充角色桶模型。
    const budgetBook = await readJson(paths.budgetFile);
    if (!Array.isArray(budgetBook.committed)) budgetBook.committed = [];
    const provBySession = {};
    for (const e of budgetBook.committed) {
      if (e?.source !== 'runtime-events') continue;
      const sid = e?.usage?.sessionId;
      const model = e?.usage?.model;
      if (typeof sid === 'string' && typeof model === 'string' && model.length > 0 && provBySession[sid] === undefined) {
        provBySession[sid] = { model, provider: typeof e?.usage?.provider === 'string' ? e.usage.provider : null };
      }
    }
    // 6. 按角色聚合(带 cacheRead/cacheWrite + model 溯源透传位)。
    const buckets = aggregateByRole(privateSessions, projcache.data, { bySession: provBySession });
    // 7. R2 替换:移除全部 runtime-events 条目,重写每桶一条(含 asOf/projcacheMtime)。
    const kept = budgetBook.committed.filter((e) => e?.source !== 'runtime-events');
    const now = new Date().toISOString();
    for (const [role, bucket] of Object.entries(buckets)) {
      kept.push({
        at: now,
        iteration: registry.iteration,
        stageId: 'collect',
        role,
        usage: {
          tokens: bucket.tokens,
          uncachedInputTokens: bucket.uncachedInputTokens,
          outputTokens: bucket.outputTokens,
          cacheReadTokens: bucket.cacheReadTokens,
          cacheWriteTokens: bucket.cacheWriteTokens,
          sessionCount: bucket.sessionCount,
          model: bucket.model,
          provider: bucket.provider,
        },
        source: 'runtime-events',
        asOf: now,
        projcacheMtime: projcache.mtime,
      });
    }
    budgetBook.committed = kept;
    await writeJson(paths.budgetFile, budgetBook);
    return { ok: true, buckets, note: notes.length > 0 ? notes.join('; ') : undefined };
  }

  /**
   * 扫 workspace 全部项目 REGISTRY(含 non-active/parked),读坏跳过(不炸调用方)。
   * id 字段缺失时以目录名补齐(与 scanRegistries 消费方 entitySlugOf 的缺省=自身兼容)。
   */
  async function scanRegistries(workspaceDir) {
    const out = [];
    let entries;
    try {
      entries = await readdir(workspaceDir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      const file = join(workspaceDir, id, cfg.registryDir, 'REGISTRY.json');
      let reg;
      try {
        reg = JSON.parse(await readFile(file, 'utf8'));
      } catch {
        continue;
      }
      if (reg === null || typeof reg !== 'object') continue;
      if (typeof reg.id !== 'string' || reg.id.length === 0) reg.id = id;
      out.push(reg);
    }
    return out;
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
    // 机制4:parked 参数(默认 false)。parked:true → REGISTRY.state='parked'(入册不 spawn)。
    if (args.parked !== undefined && typeof args.parked !== 'boolean') {
      throw new Error(`${name}/project_register: parked 必须是布尔值(默认 false)`);
    }
    // P1:entity 入参(可选,entity-slug,过卫兵)。缺省=项目自身。
    if (args.entity !== undefined && (typeof args.entity !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(args.entity))) {
      throw new Error(`${name}/project_register: entity 非法(只允许字母/数字/连字符,且以字母或数字开头;含路径分隔符或 ".." 一律拒绝):${JSON.stringify(args.entity ?? null)}`);
    }
    let customStages;
    if (args.flowStages !== undefined) {
      const checked = validateStageList(args.flowStages);
      if (!checked.ok) throw new Error(`${name}/project_register: flowStages 校验失败:${checked.error}`);
      customStages = checked.value;
    }

    // 需求一 register 解耦(2026-08-30):可选显式 id 入参,title 自由中文。
    // - 提供 id:校验 /^[a-z0-9][a-z0-9-]*$/(小写、字母/数字开头、只含小写字母/数字/
    //   连字符;该正则天然拒绝路径分隔符与 '..'),projectId = uniqueProjectId(workspaceDir, args.id)。
    // - 未提供 id 且 title 纯中文(slugifyStrict 返回 null):拒收并提示提供 id(不引入拼音依赖)。
    // - 未提供 id 且 title 含 ASCII 片段:维持现状 slugify(向后兼容)。
    let projectId;
    if (args.id !== undefined) {
      if (typeof args.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(args.id)) {
        throw new Error(`${name}/project_register: id 非法(只允许小写字母/数字/连字符,且以字母或数字开头,格式 [a-z0-9-]+;含路径分隔符或 ".." 一律拒绝):${JSON.stringify(args.id ?? null)}`);
      }
      projectId = uniqueProjectId(workspaceDir, args.id);
    } else {
      const slug = slugifyStrict(args.title);
      if (slug === null) {
        throw new Error(`${name}/project_register: 纯中文标题无法自动生成英文 id,请提供 id 入参(格式 [a-z0-9-]+),如 project_register({ title: '中文标题', id: 'my-slug', requirement: ... })`);
      }
      projectId = uniqueProjectId(workspaceDir, slug);
    }
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
    // P1:entitySlug = args.entity ?? projectId(缺省=项目自身);底座存在性检测(以 STATE.md 为准)。
    const entitySlug = typeof args.entity === 'string' && args.entity.length > 0 ? args.entity : projectId;
    const basePaths = baseDossierPaths(workspaceDir, entitySlug);
    const baseExists = await baseDossierExists(workspaceDir, entitySlug);
    const draftNeeded = !baseExists;
    // entity 互斥显式化(0.13.0,kr-entity-mutex):登记时做同 entity active 冲突检测。
    // 命中且非 parked → 明确拒绝(不静默并行);parked:true = 用户显式排队 → 放行入册,
    // 回执携带冲突信号(entityConflict)。不同 entity / legacy(缺省=自身)互不影响(R3)。
    const existingRegistries = await scanRegistries(workspaceDir);
    const conflict = entityConflictActive(entitySlug, existingRegistries);
    const entityConflictSignal = {
      conflict: conflict.conflict,
      entity: entitySlug,
      conflicts: conflict.conflicts,
    };
    if (conflict.conflict && args.parked !== true) {
      const whom = conflict.conflicts.map((c) => `${c.projectId}(entity=${c.entitySlug})`).join('、');
      throw new Error(`${name}/project_register: 同 entity 互斥冲突——entity "${entitySlug}" 已有 active 项目 ${whom} 并行迭代,会竞争写同一底座 <workspace>/.dsh-base/${entitySlug}/;本登记按显式互斥拒绝(不静默并行)。可选:①等既有项目结束(或经用户裁决排序)后再登记;②以 parked:true 入暂存排队(待 entity 空出后 project_advance(projectId, activate:true) 激活);③确需并行时先 project_block(category=other) 上抛用户裁决排序。`);
    }
    const registry = {
      schemaVersion: 2,
      id: projectId,
      entitySlug,
      title: args.title,
      createdAt: now,
      updatedAt: now,
      flowRef: flowSource,
      iteration: 1,
      stageIndex: 0,
      gateStatus: null,
      blockers: [],
      state: args.parked === true ? 'parked' : 'active',
    };
    // 会话登记(兜底 auto-record):register 调用方 = intake。
    recordSession(registry, sessionIdOf(context), 'intake', 'auto-record', now);
    // 底座初稿生成路径(流程数据表达,不加新阶段类型):entity 无底座时扩展 clarify 阶段
    // produces(只改数据,不改阶段类型)。克隆 stages 避免污染模板对象。
    if (draftNeeded) {
      const idx = stages.findIndex((s) => s.id === 'clarify' && s.type === 'work');
      if (idx >= 0) {
        const baseProduces = ['base-dossier/MAP.md', 'base-dossier/DECISIONS.md', 'base-dossier/RUNBOOK.md', 'base-dossier/STATE.md'];
        stages = stages.map((s, i) => (i === idx ? { ...s, produces: [...(Array.isArray(s.produces) ? s.produces : []), ...baseProduces] } : s));
      }
    }
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
      state: registry.state,
      flowSummary: stages.map((stage, index) => stageBrief(stage, index)),
      nextStage: stageBrief(stages[0], 0),
      baseDossier: {
        entity: entitySlug,
        path: basePaths.baseDir,
        exists: baseExists,
        draftNeeded,
      },
      entityConflict: entityConflictSignal,
    };
  }

  /** 常规推进:+1;最后阶段 + appendStages → 追加;最后阶段无 appendStages → 结项(delivered)。 */
  function regularAdvance(stages, curIndex, appendList) {
    if (curIndex < stages.length - 1) return { nextIndex: curIndex + 1, appended: false };
    if (appendList === undefined) return { delivered: true };
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
    const flow = await readJson(paths.flowFile);
    const stages = Array.isArray(flow.stages) ? flow.stages : [];

    // 会话登记(兜底 auto-record):advance 调用方 = 协调者。
    const now0 = new Date().toISOString();
    recordSession(registry, sessionIdOf(context), 'coordinator', 'auto-record', now0);
    // 主路 spawn-pass:协调者显式传 spawn 返回的 subagentId 登记会话。
    if (args.sessions !== undefined) {
      if (!Array.isArray(args.sessions)) {
        throw new Error(`${name}/project_advance: sessions 必须是非空数组 [{ sessionId, role }]`);
      }
      for (const s of args.sessions) {
        if (!isPlainObject(s) || !nonEmptyString(s.sessionId) || !nonEmptyString(s.role)) {
          throw new Error(`${name}/project_advance: sessions 每项必须是 { sessionId, role }(非空字符串)`);
        }
        recordSession(registry, s.sessionId, s.role, 'spawn-pass', now0);
      }
    }

    // 机制4 扩展(kr-parked-exit):cancel 仅限 parked 项目。非 parked(active/delivered/
    // rejected)调用 cancel 一律拒绝——取消是 parked 专属终止通道。
    if (args.cancel === true && registry.state !== 'parked') {
      throw new Error(`${name}/project_advance: cancel 仅限 parked(暂存)项目;当前项目状态为 ${registry.state},不支持取消`);
    }

    // 机制4:parked 激活路径。parked 项目只能经 activate:true 激活(parked→active,
    // stageIndex=0/clarify),否则一律拒绝(不进入常规推进/结项)。
    if (registry.state === 'parked') {
      if (args.cancel === true) {
        // 机制4 扩展(kr-parked-exit):parked 直接终止通道。校验 reason 非空 →
        // state=rejected(终态语义与既有 rejected 一致)+ updatedAt → journal 记取消理由 →
        // 返回终态。登记簿保留(审计可查),id 不释放复用。
        if (!nonEmptyString(args.reason)) {
          throw new Error(`${name}/project_advance: 取消 parked 项目必须提供 reason(非空字符串),用于 journal 记录取消理由`);
        }
        const now = new Date().toISOString();
        registry.state = 'rejected';
        registry.updatedAt = now;
        await writeJson(paths.registryFile, registry);
        // journal 记取消理由(当前阶段 journal 文件;缺失则创建)。
        const stageId = stages[0]?.id ?? 'parked';
        const journalPath = join(paths.journalDir, gateFileName(0, stageId));
        const cancelNote = [
          `# 取消(parked → rejected)`,
          '',
          `- 项目:${projectId}`,
          `- 取消时间:${now}`,
          `- 取消理由:${args.reason}`,
          '',
        ].join('\n');
        if (existsSync(journalPath)) await appendFile(journalPath, `\n---\n\n${cancelNote}`, 'utf8');
        else {
          await mkdir(paths.journalDir, { recursive: true });
          await writeText(journalPath, cancelNote);
        }
        // 结算联动 collect(幂等+非致命;取消也是结算点,与结项一致尝试)。
        let collected;
        try {
          collected = await collectRuntimeEvents({ workspaceDir, projectId, paths, registry });
        } catch (error) {
          collected = { ok: false, buckets: {}, note: `归集异常:${error?.message ?? error}` };
        }
        return {
          stageIndex: 0,
          iteration: registry.iteration,
          stage: stages[0] ? stageBrief(stages[0], 0) : null,
          journalPath,
          delivered: false,
          state: 'rejected',
          cancelled: true,
          collected,
        };
      }
      if (args.activate === true) {
        // entity 互斥显式化(0.13.0,kr-entity-mutex):激活(parked→active)时对同 entity
        // active 项目做互斥检测(排除自身)。命中 → 明确拒绝激活(不静默并行),须待
        // entity 空出或经用户裁决后再激活。
        const candid = entitySlugOf(registry);
        const existingActive = (await scanRegistries(workspaceDir)).filter((r) => r.id !== projectId);
        const actConflict = entityConflictActive(candid, existingActive);
        const entityConflictSignal = {
          conflict: actConflict.conflict,
          entity: candid,
          conflicts: actConflict.conflicts,
        };
        if (actConflict.conflict) {
          const whom = actConflict.conflicts.map((c) => `${c.projectId}(entity=${c.entitySlug})`).join('、');
          throw new Error(`${name}/project_advance: 同 entity 互斥冲突——entity "${candid}" 已有 active 项目 ${whom} 并行迭代,会竞争写同一底座 <workspace>/.dsh-base/${candid}/;拒绝激活(不静默并行)。请等既有 entity 空出(结束/结项)或经用户裁决后再激活。`);
        }
        const now = new Date().toISOString();
        registry.state = 'active';
        registry.updatedAt = now;
        await writeJson(paths.registryFile, registry);
        const first = stages[0];
        return {
          activated: true,
          state: 'active',
          stageIndex: 0,
          iteration: registry.iteration,
          stage: first ? stageBrief(first, 0) : null,
          journalPath: null,
          delivered: false,
          entityConflict: entityConflictSignal,
        };
      }
      throw new Error(`${name}/project_advance: 项目 ${projectId} 处于 parked(暂存)状态,需先激活(parked→active)才能推进;请用 project_advance(projectId, activate:true)`);
    }

    assertActive(registry, projectId);
    // 卡点纪律(2026-08-30 流程补丁):有未解决卡点的项目不许推进——
    // 卡点必须先呈递用户裁决、project_block resolve 后流程才能继续。
    const openBlockers = openBlockerList(registry);
    if (openBlockers.length > 0) {
      throw new Error(`${name}/project_advance: 项目存在未解决卡点,先呈递用户裁决并 project_block resolve 后才能推进:${openBlockers.map((b) => `${b.id}(${blockerCategoryLabel(b.category)})`).join('、')}`);
    }
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
      if (registry.gateStatus === null || registry.gateStatus === undefined) {
        // 2026-08-29 实测收紧(P2 project-hub 运行中协调者未 present 直接 advance
        // 穿过门禁,intake 还幻觉转述"已呈递"):未呈递的门禁不许推进——停摆语义靠它保证。
        throw new Error(`${name}/project_advance: 门禁 ${cur.id} 尚未呈递,先 project_gate(action=present) 呈递门禁包并等用户裁决,不允许直接推进`);
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

    // 结项出口(2026-08-29 补 delivered 语义):最后阶段无 appendStages 的推进 =
    // 交付完成。state→delivered(终态,后续变更被 assertActive 拒绝);不写 journal
    // (没有目标阶段),返回携带终态供协调者汇报结项。
    if (nextIndex === undefined) {
      const now = new Date().toISOString();
      registry.state = 'delivered';
      registry.updatedAt = now;
      await writeJson(paths.registryFile, registry);
      // 结算联动 collect(幂等+非致命;结项也是结算点)。
      let collected;
      try {
        collected = await collectRuntimeEvents({ workspaceDir, projectId, paths, registry });
      } catch (error) {
        collected = { ok: false, buckets: {}, note: `归集异常:${error?.message ?? error}` };
      }
      return {
        stageIndex: curIndex,
        iteration: registry.iteration,
        stage: stageBrief(cur, curIndex),
        journalPath: null,
        delivered: true,
        state: 'delivered',
        collected,
      };
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

    // 结算联动 collect(幂等+非致命;advance 是唯一结算点)。
    let collected;
    try {
      collected = await collectRuntimeEvents({ workspaceDir, projectId, paths, registry });
    } catch (error) {
      collected = { ok: false, buckets: {}, note: `归集异常:${error?.message ?? error}` };
    }

    return {
      stageIndex: nextIndex,
      iteration: registry.iteration,
      stage: stageBrief(target, nextIndex),
      journalPath,
      delivered: false,
      state: 'active',
      collected,
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
    // 会话登记(兜底 auto-record):gate 调用方 = 协调者。
    recordSession(registry, sessionIdOf(context), 'coordinator', 'auto-record', new Date().toISOString());
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
      // 验收路由前置化(0.16.0,kr-accept-route):delivery-gate 机械核对 AC 对照表路由声明。
      // 读 SPEC.md 解析 acceptance-routing 结构化字段,调 project-lib.validateAcceptanceRouting
      // 校验;块存在 → 非法拒绝呈递(r4 语义);块缺失(存量/未声明)→ 不拒绝,呈递包加观察行。
      const routingCheck = await checkAcceptanceRouting(paths, cur.id);
      // 块缺失 → 观察行并入呈递包 materials(缺口可见但不阻断)。
      const presentPkg = routingCheck?.skipped
        ? { ...pkg, materials: [...(pkg.materials ?? []), routingCheck.note] }
        : pkg;
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
      const section = presentSection(cur, rounds, now, presentPkg);
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
        throw new Error(`${name}/project_gate: decision.verdict 必须是 approve/revise/reject,得到 ${JSON.stringify(decision.verdict ?? null)}`);
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
      const source = entry.source ?? 'self-report';
      if (!BUDGET_SOURCES.includes(source)) {
        throw new Error(`${name}/project_budget: entry.source 必须是 ${BUDGET_SOURCES.join('/')} 之一,得到 ${JSON.stringify(entry.source)}`);
      }
      // 会话登记(兜底 auto-record):commit 调用方 = entry.role。
      recordSession(registry, sessionIdOf(context), entry.role, 'auto-record', new Date().toISOString());
      // A:source='runtime-events' 且 usage 缺省 → 按调用者会话 id 读 projcache 自动填四桶。
      let usage = entry.usage;
      let asOf;
      let projcacheMtime;
      if (source === 'runtime-events' && usage === undefined) {
        const projcacheFile = projcachePath(cfg);
        if (projcacheFile === null) {
          throw new Error(`${name}/project_budget: source=runtime-events 且 usage 缺省需要 projcache(未配置 projcachePath 且无 DSH_HOME)`);
        }
        const callerSession = sessionIdOf(context);
        if (typeof callerSession !== 'string' || callerSession.length === 0) {
          throw new Error(`${name}/project_budget: source=runtime-events 自动填桶需要调用者会话 id(执行上下文缺少 agent.session.header.id)`);
        }
        let projcache;
        try {
          projcache = await readProjcache(projcacheFile);
        } catch (error) {
          throw new Error(`${name}/project_budget: 读 projcache 失败,无法自动填桶:${error?.message ?? error}`);
        }
        const tu = sessionTokenUsage(projcache.data, callerSession);
        if (tu === null) {
          throw new Error(`${name}/project_budget: 调用者会话 ${callerSession} 不在 projcache 表内,无法自动填桶`);
        }
        // cost-v2(D1/D4):A 路自动填桶扩四桶 + model/provider。model 来自本会话 agent 路由
        // (options / session.requestHeader().config),可选经 ctx.get('llm').resolveModelInfo
        // 规范名增强;取不到显式 'unknown'(严禁伪造/用协调者路由冒充)。
        const route = await modelRoute(ctx, context);
        usage = {
          tokens: tu.uncachedInputTokens + tu.outputTokens,
          uncachedInputTokens: tu.uncachedInputTokens,
          outputTokens: tu.outputTokens,
          cacheReadTokens: tu.cacheReadTokens,
          cacheWriteTokens: tu.cacheWriteTokens,
          sessionId: callerSession,
          model: route.model,
          provider: route.provider,
        };
        asOf = new Date().toISOString();
        projcacheMtime = projcache.mtime;
      } else if (!isPlainObject(usage)) {
        throw new Error(`${name}/project_budget: entry.usage 必须是对象(形状自由,工具不解释)`);
      }
      const committedEntry = {
        at: new Date().toISOString(),
        iteration: registry.iteration,
        stageId: entry.stageId,
        role: entry.role,
        usage,
        source,
      };
      if (asOf !== undefined) committedEntry.asOf = asOf;
      if (projcacheMtime !== undefined) committedEntry.projcacheMtime = projcacheMtime;
      budgetBook.committed.push(committedEntry);
      await writeJson(paths.registryFile, registry);
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
          entitySlug: entitySlugOf(registry) ?? registry.id,
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
          openBlockers: openBlockerList(registry).length,
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
          openBlockers: openBlockerList(registry).length,
        });
      } catch (error) {
        logger.warn?.(`${name}/project_status: 跳过损坏的登记簿 ${file}:${error?.message ?? error}`);
      }
    }
    return { projects };
  }

  // 6. project_block ────────────────────────────────────────────────────────
  // 卡点通道(2026-08-30 流程补丁):遇卡点优先上报,禁止降级处理。
  // report 登记卡点(status=open,卡住推进)+ journal 留痕;resolve 记录用户裁决
  // 结论并解卡;list 查看全部卡点。协调者收到 open 卡点必须立即呈递用户,
  // 不得代替裁决,也不得以缩范围/替代手段静默消化。
  async function block(args, context) {
    const workspaceDir = sessionWorkspace(context);
    const projectId = safeProjectId(args?.projectId);
    const paths = pathsFor(workspaceDir, projectId);
    const registry = await readJson(paths.registryFile);
    assertRegistry(registry, paths.registryFile);
    assertActive(registry, projectId);
    // 会话登记(兜底 auto-record):block 调用方 = 协调者。
    recordSession(registry, sessionIdOf(context), 'coordinator', 'auto-record', new Date().toISOString());
    if (!Array.isArray(registry.blockers)) registry.blockers = [];
    const action = args?.action;

    if (action === 'report') {
      for (const key of Object.keys(args)) {
        if (!['projectId', 'action', 'category', 'reason', 'raisedBy', 'options', 'recommendation'].includes(key)) {
          throw new Error(`${name}/project_block: report 含未知键 "${key}"(允许 projectId/action/category/reason/raisedBy/options/recommendation)`);
        }
      }
      if (!nonEmptyString(args.reason)) throw new Error(`${name}/project_block: report 需要 reason(非空字符串):卡点是什么、为什么无法在当前能力/环境下解决`);
      const category = args.category ?? 'other';
      // 0.11.0:运行时 category 校验改用合并集(核心集 + .dsh-library/categories.json 扩展),
      // 单一权威 = project-lib 的 resolveBlockerCategories,本插件不再维护独立枚举。
      let merged;
      try {
        const resolved = await resolveBlockerCategories(workspaceDir);
        merged = resolved.categories;
        if (resolved.error) logger.warn?.(`${name}/project_block: ${resolved.error}`);
      } catch (error) {
        merged = BLOCKER_CATEGORIES;
        logger.warn?.(`${name}/project_block: resolveBlockerCategories 异常,回退核心集:${error?.message ?? error}`);
      }
      if (!merged.includes(category)) {
        throw new Error(`${name}/project_block: category 必须是核心集或 categories.json 扩展之一(${merged.join('/')}),得到 ${JSON.stringify(category)}`);
      }
      const id = `b${registry.blockers.length + 1}`;
      const now = new Date().toISOString();
      const entry = {
        id,
        category,
        reason: args.reason,
        raisedAt: now,
        stageIndex: registry.stageIndex,
        status: 'open',
      };
      if (nonEmptyString(args.raisedBy)) entry.raisedBy = args.raisedBy;
      if (Array.isArray(args.options)) {
        if (args.options.some((x) => typeof x !== 'string' || x.length === 0)) {
          throw new Error(`${name}/project_block: options 必须是非空字符串数组(候选处理方案,供用户裁决)`);
        }
        entry.options = args.options;
      }
      if (nonEmptyString(args.recommendation)) entry.recommendation = args.recommendation;
      registry.blockers.push(entry);
      registry.updatedAt = now;
      await writeJson(paths.registryFile, registry);
      await appendBlockerJournal(paths, registry, [
        `## ⚠ 卡点上报:${id}(${blockerCategoryLabel(category)})`,
        '',
        `- 上报时间:${now}`,
        ...(entry.raisedBy ? [`- 上报方:${entry.raisedBy}`] : []),
        `- 原因:${entry.reason}`,
        ...(entry.options ? [`- 候选方案:${entry.options.join(' / ')}`] : []),
        ...(entry.recommendation ? [`- 建议:${entry.recommendation}`] : []),
        '',
        '> 卡点未解决前 project_advance 拒绝推进;协调者须立即呈递用户裁决。',
      ].join('\n'));
      return { blocker: entry, openBlockers: openBlockerList(registry).length };
    }

    if (action === 'resolve') {
      for (const key of Object.keys(args)) {
        if (!['projectId', 'action', 'blockerId', 'resolution', 'raisedBy'].includes(key)) {
          throw new Error(`${name}/project_block: resolve 含未知键 "${key}"(允许 projectId/action/blockerId/resolution/raisedBy)`);
        }
      }
      if (!nonEmptyString(args.blockerId)) throw new Error(`${name}/project_block: resolve 需要 blockerId`);
      if (!nonEmptyString(args.resolution)) throw new Error(`${name}/project_block: resolve 需要 resolution(非空字符串):用户裁决结论与后续安排)`);
      const target = registry.blockers.find((b) => b.id === args.blockerId);
      if (!target) {
        throw new Error(`${name}/project_block: 卡点 ${args.blockerId} 不存在(现有:${registry.blockers.map((b) => b.id).join(', ') || '无'})`);
      }
      if (target.status !== 'open') {
        throw new Error(`${name}/project_block: 卡点 ${args.blockerId} 已是 ${target.status},不能重复 resolve`);
      }
      const now = new Date().toISOString();
      target.status = 'resolved';
      target.resolution = args.resolution;
      target.resolvedAt = now;
      registry.updatedAt = now;
      await writeJson(paths.registryFile, registry);
      await appendBlockerJournal(paths, registry, [
        `## 卡点解决:${target.id}(${blockerCategoryLabel(target.category)})`,
        '',
        `- 解决时间:${now}`,
        `- 裁决结论:${args.resolution}`,
      ].join('\n'));
      return { blocker: target, openBlockers: openBlockerList(registry).length };
    }

    if (action === 'list') {
      return { blockers: registry.blockers, openBlockers: openBlockerList(registry).length };
    }

    throw new Error(`${name}/project_block: action 必须是 report/resolve/list,得到 ${JSON.stringify(args?.action ?? null)}`);
  }

  /** 读 lessons/ 或 patterns/ 目录下的 .md 篇目,解析头部元数据块,返回登记项数组。 */
  async function collectLessonEntries(workspaceDir, libraryName, kind) {
    const dir = join(workspaceDir, libraryName, kind === 'pattern' ? 'patterns' : 'lessons');
    let names;
    try {
      names = await readdir(dir);
    } catch {
      return []; // 目录缺失 = 该来源为空,不是错误
    }
    const entries = [];
    for (const name of names.sort()) {
      if (!name.endsWith('.md')) continue;
      const file = join(dir, name);
      let text;
      try {
        text = await readFile(file, 'utf8');
      } catch (error) {
        logger.warn?.(`${name}/project_harvest: 读篇目失败(跳过) ${file}:${error?.code ?? error?.message ?? error}`);
        continue;
      }
      const meta = parseLessonMeta(text, name, kind, file, workspaceDir);
      const checked = validateLessonEntry(meta);
      if (!checked.ok) {
        logger.warn?.(`${name}/project_harvest: 篇目元数据非法(跳过) ${file}:${checked.error}`);
        continue;
      }
      entries.push(checked.value);
    }
    return entries;
  }

  /** 解析 .md 头部 front-matter(--- 分隔的 key: value 行块)为 lesson 元数据登记项。 */
  function parseLessonMeta(text, fileName, kind, file, workspaceDir) {
    const id = fileName.replace(/\.md$/i, '');
    const meta = { id, kind, title: id, premises: '', status: 'active', ...(kind === 'pattern' ? { origin: 'patterns' } : { origin: 'lessons' }) };
    if (typeof text === 'string' && text.slice(0, 4) === '---\n') {
      const end = text.indexOf('\n---', 4);
      if (end > 4) {
        const block = text.slice(4, end);
        for (const line of block.split('\n')) {
          const m = /^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
          if (!m || m[2].length === 0) continue;
          const key = m[1];
          const value = m[2].trim();
          if (key === 'title' && value.length > 0) meta.title = value;
          else if (key === 'premises' && value.length > 0) meta.premises = value;
          else if (key === 'origin' && value.length > 0) meta.origin = value;
          else if (key === 'status' && value.length > 0) meta.status = value;
          else if (key === 'category' && value.length > 0) meta.category = value;
        }
        // 无显式 title/premises 时的兜底:取首行 # 标题与第一条非空正文。
        if (meta.title === id || meta.premises === '') {
          const heading = /^#\s+(.+)$/m.exec(text);
          if (meta.title === id && heading) meta.title = heading[1].trim();
          const bodyLines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('---'));
          if (meta.premises === '' && bodyLines.length > 0) meta.premises = bodyLines[0];
        }
      }
    }
    // sourceFile 供回溯(相对工作区,路径不因部署机器异而变)。
    const rel = String(file).split(String(workspaceDir)).pop()?.replace(/^[\\/]+/, '');
    meta.sourceFile = rel && rel.length > 0 ? rel : file;
    return meta;
  }

  // 7. project_harvest ─────────────────────────────────────────────────────
  // P4 记忆治理·消费路由优先:lessons-index.json(AC1)由 harvest 阶段维护。
  // action=rebuild-index:扫 lessons/ + patterns/ 读元数据归类,重建索引(保留既有 hits);
  // action=bump-hits:lessonRefs 递增命中篇目 hits。
  async function harvest(args, context) {
    const workspaceDir = sessionWorkspace(context);
    const action = args?.action;
    const libraryName = cfg.libraryDir;
    const indexFile = join(workspaceDir, libraryName, 'lessons-index.json');

    if (action === 'rebuild-index') {
      for (const key of Object.keys(args)) {
        if (!['action'].includes(key)) throw new Error(`${name}/project_harvest: rebuild-index 含未知键 "${key}"`);
      }
      const [lessons, patterns] = await Promise.all([
        collectLessonEntries(workspaceDir, libraryName, 'lesson'),
        collectLessonEntries(workspaceDir, libraryName, 'pattern'),
      ]);
      const all = [...lessons, ...patterns];
      // 读既有索引作 hits 保留基线(缺失/坏索引 → 空基线,不炸)。由 buildLessonsIndex 汇总 hits。
      let existing = null;
      try {
        existing = await readJson(indexFile);
      } catch {
        existing = null;
      }
      const index = buildLessonsIndex(all, existing);
      await mkdir(dirname(indexFile), { recursive: true });
      await writeJson(indexFile, index);
      const stats = Object.entries(index.categories)
        .map(([category, list]) => ({ category, count: list.length }))
        .sort((a, b) => b.count - a.count);
      return {
        action: 'rebuild-index',
        entriesTotal: all.length,
        categories: stats,
        categoriesCount: stats.length,
        indexFile,
      };
    }

    if (action === 'bump-hits') {
      if (!Array.isArray(args?.lessonRefs) || args.lessonRefs.length === 0) {
        throw new Error(`${name}/project_harvest: bump-hits 需要 lessonRefs(非空字符串数组)`);
      }
      if (args.lessonRefs.some((x) => typeof x !== 'string' || x.length === 0)) {
        throw new Error(`${name}/project_harvest: lessonRefs 每项必须是非空字符串`);
      }
      let index;
      try {
        index = await readJson(indexFile);
      } catch {
        throw new Error(`${name}/project_harvest: 尚未建立 lessons-index.json,先 rebuild-index:${indexFile}`);
      }
      const result = bumpLessonHits(index, args.lessonRefs);
      await writeJson(indexFile, result.index);
      return { action: 'bump-hits', bumped: result.bumped, misses: result.misses, indexFile };
    }

    throw new Error(`${name}/project_harvest: action 必须是 rebuild-index/bump-hits,得到 ${JSON.stringify(args?.action ?? null)}`);
  }

  // 8. project_audit ───────────────────────────────────────────────────────
  // 自省审计回路(kr-self-audit,0.15.0):观察 → 规则表判定 → 去重限频 → 三档分流(F2 register /
  // F1 呈递 / F3 直改留痕),写 .dsh-library/audit-trail.json append-only。领地白名单硬校验
  // (规则表 act:F4 / 对 F1 客体升权 F2 → 引擎拒绝报错=AC1)。观察读容错(registry-halfwrite-read-tolerance)。
  async function readToolkitDocs(toolkitDir) {
    let text = '';
    for (const name of ['README.md', 'PROTOCOL.md', 'SKILL.md']) {
      try {
        text += `\n${await readFile(join(toolkitDir, name), 'utf8')}`;
      } catch { /* 文档缺失跳过 */ }
    }
    return text;
  }

  async function audit(args, context) {
    const workspaceDir = sessionWorkspace(context);
    const action = args?.action;
    const libraryName = cfg.libraryDir;
    const trailFile = join(workspaceDir, libraryName, 'audit-trail.json');

    if (action === 'status') {
      const { trail } = await readAuditTrail(workspaceDir);
      const list = Array.isArray(trail) ? trail : [];
      const open = list.filter((e) => e?.status !== 'resolved');
      return {
        action: 'status',
        lastRunAt: list.length > 0 ? list[list.length - 1].ts ?? '' : '',
        openFindings: open.length,
        trailCount: list.length,
        trail: list.slice(-20),
      };
    }

    if (action !== 'run') {
      throw new Error(`${name}/project_audit: action 必须是 run/status,得到 ${JSON.stringify(args?.action ?? null)}`);
    }
    for (const key of Object.keys(args)) {
      if (key !== 'action') throw new Error(`${name}/project_audit: run 含未知键 "${key}"`);
    }

    // 规则表(workspace 级,规则归用户);缺失/坏表 → 空规则 + 提示,不炸整轮。
    const rulesRes = await readAuditRules(workspaceDir);
    const rules = rulesRes.rules;

    // plugindevRoot 推导(缺陷 #2 修订):以进程真实 cwd(DESIGN C1:watcher 以 process.cwd() 为根、
    // DEFAULT_LOG='pipeline-watch.log' 相对 cwd)为可核证单一事实源,不猜安装根。部署副本下
    // watcher 与 preset 同进程,cwd 仍是 plugindev/,故可命中真实 plugindev/pipeline-watch.log,
    // 不因 pathResolve(presetDir,'..','..') 落到 .dsh-home 误降级(违背 C2)。
    const plugindevRoot = typeof process?.cwd === 'function' ? process.cwd() : null;
    const toolkitDir = (typeof plugindevRoot === 'string' && plugindevRoot.length > 0) ? join(plugindevRoot, 'toolkit') : presetDir;

    // 观察 O1~O6(任一观察非致命失败不炸整轮)。
    const obs = await runObservations({ workspaceDir, plugindevRoot, toolkitDir, docsText: await readToolkitDocs(toolkitDir) });

    // 规则表引擎(领地白名单硬校验;act:F4 / 升权 F2 → 拒绝报错,AC1)。
    let engine;
    try {
      engine = auditRuleEngine(obs.findings, rules);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        action: 'run',
        status: 'rejected',
        findings: obs.findings,
        executed: [],
        actions: [],
        rulesUsed: rules.map((r) => r.id),
        error: msg,
      };
    }

    // 去重(by-category/by-target)+ 限频(F2 上限 / meta 冷却期)。
    const activeRegistries = await scanRegistries(workspaceDir);
    const activeProjects = activeRegistries.map((r) => ({ id: r.id, title: r.title ?? '', category: r.entitySlug ?? '' }));
    const { trail: priorTrail } = await readAuditTrail(workspaceDir);
    const deduped = auditDedupe(engine.actions, activeProjects, priorTrail);
    const limited = auditRateLimit(deduped.kept, rulesRes.meta);

    // 分流执行 + append-only 留痕。
    const executed = [];
    const notes = [];
    const newTrail = Array.isArray(priorTrail) ? priorTrail.slice() : [];
    let cursor = 0;
    const ts = new Date().toISOString();
    const stamp = ts.replace(/[:.]/g, '-');
    await mkdir(dirname(trailFile), { recursive: true });
    const appendTrail = async (entry) => {
      newTrail.push(entry);
      await writeJson(trailFile, newTrail);
    };

    for (const actItem of limited.kept) {
      cursor += 1;
      const id = `${actItem.ruleId}-${stamp}-${cursor}`;
      const finding = obs.findings.find((f) => f.id === actItem.findingId) ?? null;
      const evidenceRef = Array.isArray(finding?.evidence) ? finding.evidence : [];
      if (actItem.act === 'F2') {
        const payload = buildF2Payload(finding, actItem);
        const projId = `${actItem.ruleId}-${Date.now().toString(36)}`.replace(/[^a-z0-9-]/gi, '').toLowerCase();
        try {
          const reg = await register({ title: payload.title, requirement: payload.reason, id: projId }, context);
          await appendTrail({
            id, ts, action: 'F2', object: actItem.object, territory: actItem.territory,
            category: payload.category ?? 'other', target: reg.projectId, auto: true,
            reason: payload.reason, evidence: evidenceRef,
            ruleId: actItem.ruleId, findingId: actItem.findingId, status: 'registered', projectId: reg.projectId,
          });
          executed.push({ act: 'F2', projectId: reg.projectId, title: payload.title });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          notes.push(`F2 ${actItem.ruleId} 立项失败:${msg}`);
          await appendTrail({
            id, ts, action: 'F2', object: actItem.object, territory: actItem.territory,
            category: payload.category ?? 'other', target: projId, auto: true,
            reason: payload.reason, evidence: evidenceRef,
            ruleId: actItem.ruleId, findingId: actItem.findingId, status: 'error', error: msg,
          });
        }
      } else if (actItem.act === 'F1') {
        const payload = buildF1Payload(finding, actItem);
        await appendTrail({
          id, ts, action: 'F1', object: actItem.object, territory: actItem.territory,
          category: payload.category ?? 'other', target: actItem.object, auto: false,
          reason: payload.report, evidence: payload.evidence,
          ruleId: actItem.ruleId, findingId: actItem.findingId, status: 'presented',
        });
        executed.push({ act: 'F1', findingId: payload.findingId, report: payload.report });
      } else if (actItem.act === 'F3') {
        // 缺陷 #1 修订:F3 直改真实读改写目标数据资产(复用 harvest 既有通道),before/after 真实落留痕。
        const payload = buildF3Payload(finding, actItem, { object: actItem.object });
        let edit;
        try {
          edit = await applyF3DirectEdit(workspaceDir, {
            object: actItem.object,
            territory: actItem.territory,
            id,
            ts,
            ruleId: actItem.ruleId,
            findingId: actItem.findingId,
            evidence: payload.evidence,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          edit = { object: actItem.object, target: null, before: null, after: null, result: 'error', error: msg };
        }
        await appendTrail({
          id, ts, action: 'F3', object: edit.object, territory: actItem.territory,
          category: actItem.category ?? 'other', target: edit.target ?? edit.object, auto: false,
          before: edit.before, after: edit.after, evidence: payload.evidence,
          ruleId: actItem.ruleId, findingId: actItem.findingId,
          status: edit.result === 'error' ? 'error' : 'applied',
          result: edit.result, error: edit.error,
        });
        executed.push({ act: 'F3', object: edit.object, result: edit.result });
      }
    }

    return {
      action: 'run',
      status: 'done',
      findings: obs.findings,
      obsErrors: obs.errors,
      actions: limited.kept,
      dropped: [...deduped.dropped, ...limited.dropped],
      executed,
      notes,
      trailPath: trailFile,
      rulesUsed: rules.map((r) => r.id),
    };
  }

  return { register, advance, gate, budget, status, block, harvest, audit };
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
      asOf: { type: 'string' },
      projcacheMtime: { oneOf: [{ type: 'string' }, { type: 'null' }] },
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
      totalToken: { type: 'number', description: '统一总 token 口径(纯函数 sum = uncachedInput+cacheRead+output)。' },
      byModel: { type: 'object', description: '按 model 分组聚合(缺/未知 model 归 "unknown")。' },
      cacheRate: { type: 'number', description: '聚合缓存率 = cacheRead/(cacheRead+uncachedInput)。' },
      byRoleTotal: { type: 'object', description: '按 role 的 totalToken 展开。' },
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
      openBlockers: { type: 'integer' },
    },
    required: ['id', 'title', 'state', 'iteration', 'stageIndex', 'updatedAt', 'openBlockers'],
  };
}

function projectDetailSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      projectId: { type: 'string' },
      entitySlug: { type: 'string' },
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
      openBlockers: { type: 'integer' },
    },
    required: ['projectId', 'entitySlug', 'title', 'state', 'iteration', 'stageIndex', 'gateStatus', 'updatedAt', 'flowRef', 'currentStage', 'budget', 'summaryExists', 'openBlockers'],
  };
}

function baseDossierSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      entity: { type: 'string' },
      path: { type: 'string' },
      exists: { type: 'boolean' },
      draftNeeded: { type: 'boolean' },
    },
    required: ['entity', 'path', 'exists', 'draftNeeded'],
  };
}

function entityConflictSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      conflict: { type: 'boolean' },
      entity: { type: 'string' },
      conflicts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            projectId: { type: 'string' },
            entitySlug: { type: 'string' },
            state: { type: 'string' },
          },
          required: ['projectId', 'entitySlug', 'state'],
        },
      },
    },
    required: ['conflict', 'entity', 'conflicts'],
  };
}

const REGISTER_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    projectId: { type: 'string' },
    projectDir: { type: 'string' },
    state: { type: 'string', enum: ['active', 'parked'] },
    flowSummary: { type: 'array', items: stageBriefSchema() },
    nextStage: stageBriefSchema(),
    baseDossier: baseDossierSchema(),
    entityConflict: entityConflictSchema(),
  },
  required: ['projectId', 'projectDir', 'state', 'flowSummary', 'nextStage', 'baseDossier'],
};

function collectedSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean' },
      buckets: { type: 'object' },
      note: { type: 'string' },
    },
    required: ['ok', 'buckets'],
  };
}

const ADVANCE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    stageIndex: { type: 'integer' },
    iteration: { type: 'integer' },
    stage: stageBriefSchema(),
    journalPath: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    delivered: { type: 'boolean' },
    state: { type: 'string', enum: ['active', 'parked', 'delivered', 'rejected'] },
    activated: { type: 'boolean' },
    cancelled: { type: 'boolean' },
    collected: collectedSchema(),
    entityConflict: entityConflictSchema(),
  },
  required: ['stageIndex', 'iteration', 'stage', 'journalPath', 'delivered', 'state'],
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

function blockerSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      category: { type: 'string', description: '核心集(design-info/dev-complexity/test-env/deploy-permission/acceptance-capability/other)+ .dsh-library/categories.json 扩展(运行时按合并集校验)。' },
      reason: { type: 'string' },
      raisedAt: { type: 'string' },
      stageIndex: { type: 'integer' },
      status: { type: 'string', enum: ['open', 'resolved'] },
      raisedBy: { type: 'string' },
      options: { type: 'array', items: { type: 'string' } },
      recommendation: { type: 'string' },
      resolution: { type: 'string' },
      resolvedAt: { type: 'string' },
    },
    required: ['id', 'category', 'reason', 'raisedAt', 'stageIndex', 'status'],
  };
}

const BLOCK_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    blocker: blockerSchema(),
    blockers: { type: 'array', items: blockerSchema() },
    openBlockers: { type: 'integer' },
  },
};

const HARVEST_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['rebuild-index', 'bump-hits'] },
    entriesTotal: { type: 'integer' },
    categories: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: { category: { type: 'string' }, count: { type: 'integer' } }, required: ['category', 'count'] },
    },
    categoriesCount: { type: 'integer' },
    indexFile: { type: 'string' },
    bumped: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, hits: { type: 'integer' } }, required: ['id', 'hits'] } },
    misses: { type: 'array', items: { type: 'string' } },
  },
  required: ['action', 'indexFile'],
};

// project_audit 输出 schema(0.15.0,自省审计回路)。形状较松(additionalProperties true)
// 以免过度拒绝;必需字段仅 action(有 status 时额外呈现 status/lastRunAt/openFindings)。
const AUDIT_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    action: { type: 'string', enum: ['run', 'status'] },
    status: { type: 'string' },
    error: { type: 'string' },
    lastRunAt: { type: 'string', description: 'ISO 时间戳;从未运行时为空串' },
    openFindings: { type: 'integer' },
    trailCount: { type: 'integer' },
    trail: { type: 'array' },
    findings: { type: 'array' },
    obsErrors: { type: 'array' },
    actions: { type: 'array' },
    dropped: { type: 'array' },
    executed: { type: 'array' },
    notes: { type: 'array' },
    trailPath: { type: 'string' },
    rulesUsed: { type: 'array' },
  },
  required: ['action'],
};

// ── 共享手册提示段(SPEC §9;中文,提纲写全)────────────────────────────────

const MANUAL_TEXT = `## 项目制交付速查(project-pipeline)

### 登记簿布局
每个项目一个目录:<workspace>/<projectId>/.dsh-project/:
- REGISTRY.json:项目元数据(id/标题/流程指针 stageIndex/迭代 iteration/门禁态 gateStatus/状态 state/entitySlug)
- FLOW.json:流程实例(模板实例化产物,可带项目内修订,revision 递增)
- REQUIREMENT.md:需求原文(逐字);BUDGET.json:预算账本;SUMMARY.md:总结链
- journal/NN-<stageId>.md:逐阶段日志(推进时自动开条,角色补写产出与结论)
- gates/NN-<stageId>.md:门禁包与裁决记录;feedback/NN.md:验收反馈登记
角色库与流程库在 <workspace>/.dsh-library/(roles|flows),workspace 同名条目覆盖 preset 自带。

### 底座 Base Dossier(实体仓底座,P1)
- 位置:<workspace>/.dsh-base/<entitySlug>/(与 .dsh-library 平级,工作区级;entitySlug 过卫兵)。
- 四件套:MAP.md 模块地图 / DECISIONS.md 决策日志(append-only,带日期与迭代引用)/ RUNBOOK.md 运行手册(命令级)/ STATE.md 状态快照(最近交付/已知问题/债,带 last-verified 戳)。跨迭代存活、增量维护。
- REGISTRY.entitySlug(schemaVersion 1→2 只增):缺省=项目自身;25 存量项目无 entitySlug 视为 legacy,零影响。
- project_register 可传 entity(entity-slug,缺省=项目自身):entity 已有底座 → 回执 baseDossier.exists=true;没有 → draftNeeded=true,首轮 clarify 阶段 produces 扩展底座初稿四件套(流程数据表达,不加新阶段类型)。
- role manifest 的 readings 段(路径模板数组,支持 {base}/{project} 变量):compileSubagent 展开为"进场必读"头拼进 spawn persona;readings 是路径非内容,不挤 persona 长度纪律;编译后 persona(头+正文)超 MAX_COMPILED_PERSONA(1000)在 role_show 编译期报错。

### 工具速查(登记簿 7 + 库 4)
1. project_register:登记新项目。title+requirement 必填;flowTemplate 选模板(默认 standard-flow)或给 flowStages 现场定制;可带 budgetEstimate;可带 parked(默认 false,true → state='parked' 入册不 spawn);可带 entity(entity-slug,缺省=项目自身,已有底座 → 回执 baseDossier.exists=true,没有 → draftNeeded=true 且 clarify 扩展产出底座初稿)。**中文 title 建议配显式 id 入参(格式 [a-z0-9-]+)**:提供 id 时 projectId=uniqueProjectId(workspaceDir, id),title 自由中文;纯中文 title 未提供 id 会拒收并提示提供 id(不引入拼音依赖);混合 title(含 ASCII 片段)未提供 id 维持现状 slugify。返回项目 id、state、流程概要、底座信息。
2. project_advance:推进到下一阶段。**存在未解决卡点(project_block)会拒绝**;门禁 pending 会拒绝;**门禁未呈递(gateStatus=null)也会拒绝**——必须先 present 呈递并等用户裁决(2026-08-29 实测收紧:协调者曾未呈递直接穿过门禁);approve 裁决后推进并清门禁态;revise 裁决跳回 reviseTo 的 work 阶段;在最后阶段给 appendStages 开新迭代(iteration+1);在最后阶段不给 appendStages = 结项(state→delivered,此后不可再推进)。**parked 项目只能经 activate:true 激活(parked→active,stageIndex=0)或 cancel:true 取消(parked→rejected,终态,reason 必填),否则一律拒绝**。常规推进自动写 journal;结项不写 journal、返回 delivered:true。**可带 sessions:[{sessionId,role}] 登记 spawn 返回的 subagentId(主路会话捕获)**;推进时自动归集本项目私有会话真实 tokenUsage 写 committed(source=runtime-events),返回 collected 状态。
3. project_gate:门禁两步。present 把摘要/材料/建议写成门禁包并置 pending;decide 记录用户裁决(approve/revise/reject),revise 必给 reviseTo(流程中已有的 work 阶段 id),reject 使项目终态。
4. project_budget:get 查账(totals 含统一总 token totalToken / 按 model 分组 byModel / 缓存率 cacheRate / 按 role 展开 byRoleTotal);set-estimate / set-cap 设估算与上限;commit 逐阶段上报消耗(stageId/role/usage,source 默认 self-report)。**source='runtime-events' 且 usage 缺省时插件按调用者会话 id 读 projcache 自动填真实 token(四桶+model/provider,model 取本会话 agent 路由)**。
5. project_status:不带 projectId 列出工作区全部项目(含未解决卡点数);带 projectId 看单项目详情(当前阶段/门禁态/预算聚合(含统一总 token)/SUMMARY 是否存在/卡点数)。
6. project_block:卡点通道(优先上报,禁止降级)。report 登记(category=核心集(五维+other)+ .dsh-library/categories.json 扩展,运行时按合并集校验)并卡住推进;resolve 记录用户裁决结论后解卡;list 查看。
7. project_harvest:维护 lessons 消费路由索引(AC1,harvest 阶段调用)。rebuild-index 扫 lessons/ + patterns/ 读元数据按 category 归类重建 lessons-index.json(保留既有 hits);bump-hits(lessonRefs:[id])递增命中篇目 hits。
8. project_budget:get 查账(totals 含统一总 token totalToken / 按 model 分组 byModel / 缓存率 cacheRate / 按 role 展开 byRoleTotal);set-estimate / set-cap 设估算与上限;commit 逐阶段上报消耗(stageId/role/usage,source 默认 self-report)。**source='runtime-events' 且 usage 缺省时插件按调用者会话 id 读 projcache 自动填真实 token(四桶+model/provider,model 取本会话 agent 路由)**。
9. project_status:不带 projectId 列出工作区全部项目(含未解决卡点数);带 projectId 看单项目详情(当前阶段/门禁态/预算聚合(含统一总 token)/SUMMARY 是否存在/卡点数)。
10. role_list / role_show:查角色清单;role_show 返回可直接拷进 subagent 调用的参数(persona/toolFilter/agentOptions)与 workspaceNote。
11. flow_list / flow_show:查流程模板(含 stageCount/stages),workspace 库覆盖 preset 自带。
12. project_audit:自省审计回路。action=run 跑一轮审计(观察 O1~O6 → 规则表判定 → 去重限频 → 三档分流);action=status 查审计留痕与状态。rules 存 <workspace>/.dsh-library/audit-rules.json(规则归用户),留痕写 .dsh-library/audit-trail.json(append-only)。

### spawn 纪律
必须用 per-role 工具名(subagent_<role> / subagent_devhelper)spawn 角色;通用 subagent/subagent_fork 已不可见(机制保证)。

### 可行性分析(需求分析的并行必做,2026-08-30 流程补丁)
SPEC(clarify 阶段)必须含「可行性分析」章,五维逐条给结论(可行 / 有条件可行(条件+责任方) / 不可行):
- 设计可行性(信息完备):需求/参照物/交互样本/边界是否足够产出设计;不足处列为待补信息;
- 开发可行性(复杂度):体量/技术依赖/角色工时是否在能力内;超限给分期建议;
- 测试可行性(环境与数据):验证所需环境(浏览器/上游/数据/凭据)是否可得;**不可得 → 哪些验收标准无法真实验证,必须 project_block 上报,禁止以静态检查替代放行**;
- 部署可行性(权限):目标路径可写性/沙箱边界/凭据/重启窗口/需用户侧配合的事项(APPLY.md 交接);
- 验收可行性(验收者能力):最终"好不好"由谁判定、判定者是否具备手段(如视觉验收必须有眼睛——流水线角色无浏览器无视觉,视觉类验收必须由用户侧执行并设为 blocking 门禁,不得排为交付后事项)。
- 每一维先「查底座(.dsh-project 登记簿 / .dsh-base)+ .dsh-library/lessons-index.json 再下结论」(P4,2026-09-02):按该维对应 category 查 lessons-index 命中既有 lesson/裁决 → 直接引用不重复上报;未命中照常分析/上报。
任一维度"有条件/不可行"→ SPEC 显著标注 + 登记 project_block;spec-gate 呈递前自查本章完备。

### 卡点纪律(优先上报,禁止降级,2026-08-30 流程补丁)
- 任何角色/协调者遇卡点(无法胜任、验证手段缺失、环境不具备、依赖缺失、权限不足)**第一时间 project_block report**,并写明原因与候选方案;**禁止**:把"无法验证"写成范围说明放行、用替代手段静默降级、自行缩范围后宣布完成。
- 卡点 open 期间 project_advance 拒绝推进(机制强制停摆);协调者收到 open 卡点**必须立即呈递用户裁决**(结算通知/门禁/接待面),不得代替用户裁决,也不得自行消化。
- resolve 必须携带用户裁决结论(决议原文 + 后续安排);留痕进 journal。
- 背景:i3 美化迭代实测——设计与验收角色无浏览器无视觉,却以"静态层全过/无法验证项不阻塞"完成了视觉任务并推进到 delivered,真值缺陷(raw markdown 裸显)全链放行。本纪律即为封死该通路。

### 验收路由前置化(0.16.0,kr-accept-route)
- **目标**:验收路由声明前置到 clarify——凡 AC 依赖真机会话 / 视觉浏览器验收 / 部署重启 / 真实上游凭据的,clarify 阶段即声明「用户侧 blocking」,进 SPEC AC 对照表,delivery-gate 机械核对,不再依赖中途卡点上报与事后引用裁决。
- **四类真机触发类**:real-session(真机会话)/ visual-browser(视觉浏览器验收)/ deploy-restart(部署重启)/ real-upstream-credential(真实上游凭据)。AC 依赖任一 → 必须声明 route=user-blocking。
- **SPEC 承载(结构化字段)**:SPEC.md 头部 front-matter 含 acceptance-routing 块,每行 AC-id: route 或 AC-id: route|trigger(trigger 为四类触发类之一)。例:AC2: user-blocking|real-session。机械核对解析该结构化字段(不用 markdown 表 regex,更稳)。
- **delivery-gate 机械核对**:delivery-gate present 时读 SPEC.md 解析 acceptance-routing,调 project-lib.validateAcceptanceRouting 校验。**声明是纪律引导,核对只校验已声明项**:块存在 → 严格校验(非法/错路由 → 拒绝呈递,r4 语义);块缺失(存量/未声明)→ 不拒绝,跳过核对,呈递包加观察行「acceptance-routing 块缺失(存量/未声明),路由核对未执行」,让缺口可见但不阻断。SPEC.md 文件本身缺失仍拒绝(流水线契约违例)。
- **r4 语义保持**:前置化是路由提前,不是验收口径变更;真机项仍由用户侧 blocking 执行,不得以静态放行替代。
- **存量采用路径**:新项目 clarify 即声明 acceptance-routing 块;存量项目(legacy/in-flight)自然迭代时不强制回填——块缺失不阻断交付,仅呈递包留观察行。

### 资源触点互斥声明(机制1,2026-08-30 流程补丁)
- 每项目在 SPEC 声明「资源触点」(三要素:拟改文件路径[]/拟部署组件[]/需重启 bool;粒度到文件路径/组件名,允许目录级如「整个 ui/ 目录」);REQUIREMENT 尾部留指针行。
- 协调者派活前对 active 项目清单做触点比对:读自己 SPEC 触点 → project_status 列全部 active → 逐个读其 SPEC 触点 → 冲突判定(同文件路径/同部署组件/同需重启窗口即冲突,目录级按包含关系)。
- 冲突处理:project_block(category=other)上抛用户排序;open 期间不推进;intake 登记时发现触点重叠当场提示(不打断登记)。
- **parked 项目进触点比对但标注不冲突**(机制4):读全部项目(含 parked)SPEC 触点;parked 项目与当前项目触点重叠 → 标注为不构成 active 冲突,不 project_block;仅 active 项目冲突才上抛。
- **entity 互斥显式化·一等触点(0.13.0,kr-entity-mutex)**:entity 维度自动声明为「拟写 <workspace>/.dsh-base/<entity>/」,与显式文件路径同级参与比对(project-lib 的 entityTouchpoint 即底座路径)。register 登记时 / advance(activate:true) 激活时对同 entity active 项目做互斥检测(纯函数 entityConflictActive):命中且非 parked → 明确拒绝(不静默并行);parked 登记 = 显式排队(看板进暂存区),等待实体空出;不同 entity 与 legacy(entitySlug 缺省=项目自身)天然互异、互不影响。

### 重启决策规则(机制2,2026-08-30 流程补丁)
- (a)必须重启清单:agent.cordis.yml 变更、preset 插件文件变更、profile node_modules/bundles 变更、cordis.patch.yml 变更。
- (b)免重启清单:settings.yaml 常规键(除需初始化的段)、登记簿/文档/看板前端资源(前端资源经重新部署+浏览器刷新即可,实例无需重启)。
- (c)重启决策树:多项目活动时优先合并部署一次重启(攒批);重启前由协调者互认停摆点;重启后用户侧按登记表逐个唤醒;攒批窗口由用户侧在门禁停摆点裁决时定。
- (d)用户侧重启脚本已带 --no-open(重启不再弹浏览器)。

### 既定裁决库(机制1,2026-08-30 流程补丁)
- 落点:workspace 库 <workspace>/.dsh-library/rulings.json(用户可自增裁决免部署、免重启;角色 read 即读)。
- 种子四条:①视觉/真实观感类验收=用户侧 blocking 于 delivered,手段=截图+视觉模型/DOM 双核验;②pipeline-ws 外路径=deliverables/+APPLY.md 外交接,用户侧代应用;③preset/宿主插件改动=deploy 至 IN SYNC+重启,重启窗口并入攒批;④真实上游/凭据/夜间无人值守类验证=用户侧 blocking。
- 引用规则(product 五维可行性分析时):先读裁决库;命中既定裁决(同 category 且前提一致)→ 直接引用该裁决结论,不再对同情形重复 project_block report;情形与既定裁决前提不一致或信息不足 → 照常上报。
- 命中判据(m1-r3 + 0.11.0 negative-premises):不只看 category,还要看「情形是否与既定裁决前提一致」;前提不成立则命中失效、仍上报(如视觉类=用户侧 blocking 的前提是「有视觉产物且流水线角色无视觉」;若该前提不成立,则 r1 不命中,照常上报)。0.11.0 起每条裁决可带「negative-premises」(否定面,何种情形**不**命中)与「basis」(机制版本锚,preset 版本/日期,harvest 复查提示)——命中判据 = premise 命中 + negative-premises 不命中才引用。
- 用户可自增:追加 rulings 数组条目即可,免部署、免重启。

### 记忆治理·消费路由优先(P4,2026-09-02)
- 目的:先让既有记忆(lessons/rulings)被消费路由到,再谈治理。lessons-index.json(category → 篇目/前提/状态/hits)由 harvest 维护。
- 消费路由:product 五维分析的每一维先「查底座 + lessons-index 再下结论」(维度与 category 天然同构——design-info/dev-complexity/test-env/deploy-permission/acceptance-capability 即五维);coordinator 派活提示带相关 lessons 引用;命中既有 lesson/裁决 → 直接引用,不重复上报(AC6)。
- harvest 维护:internalize 阶段协调者调 project_harvest rebuild-index 重建索引(保留 hits);每笔真实消费后 bump-hits 记一次。
- BLOCKER_CATEGORIES 开放:核心集(五维 + other)∪ <workspace>/.dsh-library/categories.json 扩展(同名去重扩展胜,核心 6 类恒在;缺失/坏 JSON 回退核心集)。存量 other 历史 blocker 不动。
- lessons 元数据:每篇 lessons/*.md 与 patterns/*.md 头部 front-matter 登记 origin/category/premises/status;rebuild-index 逐篇解析归类,元数据缺失 → uncategorized 并告警不炸。
- 查重纪律:harvest 登记新 lesson 前先查 lessons-index,同 category 同 premise → 提示「追加到既有而非新建」。

### 失败模式聚合(机制2,2026-08-30 流程补丁)
- harvest(internalize)阶段聚合步骤:扫 pipeline-ws 全部项目 REGISTRY 的 blockers 历史(含 delivered/终态,不遗漏),按 category 计数;同 category ≥2 → 生成四要素报告(类别/次数/代表案例(项目 id+卡点 id+原因摘要)/机制项建议)。
- 报告写入 SUMMARY.md 留痕,并随结算上抛 intake 呈递用户,由用户裁决是否立项。
- 边界(硬约束):聚合结果是「呈递材料」不是「卡点」——不得用 project_block 承载(open 期间会卡死结项,project_advance 拒绝);写入 SUMMARY + intake 呈递即可。
- 规范参考实现:project-lib 的 collectAllBlockers/aggregateByCategory/buildFailureReport 纯函数(单测锁定形状);协调者手动步骤按同一四要素形状产出。

### 部署自检(机制3,2026-08-30 流程补丁)
- 适用判定:项目触点含 pipeline-ws 外路径(preset/宿主插件)的 accept/delivery-gate 呈递时,协调者执行部署自检。
- 核对步骤:①读部署戳 <installRoot>/<presetId>/.plugindev-deploy.json(本机 .dsh-home/.agent-presets/project-pipeline/.plugindev-deploy.json),取 sourceVersion、gitCommit;②读源码版本 plugindev/presets/project-pipeline/package.json 的 version;③读源码 HEAD(经 read 读 git 文件 plugindev/.git/HEAD → ref → commit hash;解析失败标注「无法核对」不臆造);④对照:IN SYNC = sourceVersion===package.json version 且 gitCommit===源码 HEAD。
- 门禁包三要素:accept/delivery-gate 呈递时,门禁包(project_gate present 的 summary/materials)必须含部署自检块:戳版本/commit、源码 HEAD、是否 IN SYNC。IN SYNC=false → 显著标注「部署副本与源码漂移,须先 deploy IN SYNC 再验收」,作为 approve 前置。
- 最省事核对:引用 npm run deploy -- --list 输出(与戳文件同源)。

### 暂存区 parked 语义(机制4,2026-08-30 流程补丁)
- register 增 parked 参数(默认 false):parked:true → REGISTRY.state='parked',登记入册(REGISTRY/FLOW/BUDGET/REQUIREMENT 照常创建,stageIndex=0)但不 spawn 协调者。
- 入册不 spawn:intake 登记后查 state,state==='parked' → 不 spawn 协调者;state==='active' → spawn 协调者从 clarify 开始。
- 激活路径:project_advance(projectId, activate:true) → parked→active,stageIndex=0(clarify);激活后 intake 按 state=active spawn 协调者从 clarify 开始。
- **取消通道(kr-parked-exit)**:parked 项目可直接终止——project_advance(projectId, cancel:true, reason) → parked→rejected(终态语义与既有 rejected 一致),journal 记取消理由,登记簿保留(审计可查),id 不释放复用;非 parked 项目调用 cancel 一律拒绝(仅限 parked)。
- 状态机校验:parked 项目不设 activate/cancel 时,advance 一律拒绝(不进入常规推进/结项);gate/block 对 parked 项目 assertActive 拒绝(无 active 流程,不呈递门禁/不登记卡点);budget/status 对任何 state 可用。
- 触点比对:parked 项目进触点比对但标注不冲突(仅 active 项目冲突才上抛 project_block)。
- **激活冲突检测(0.13.0,kr-entity-mutex)**:project_advance(activate:true) 激活时对同 entity active 项目做互斥检测(排除自身);命中 → 明确拒绝激活(不静默并行),须待 entity 空出或经用户裁决后再激活。
- 看板:state=parked 项目进入「暂存区」独立分组呈现,不混入 active 列表;state.parked 徽章(zh「暂存」/en「Parked」)。

### 自省审计回路(0.15.0,kr-self-audit)
- **链路前端**:观察 → 按规则表判定 → 三档分流,不造旁路。F2 立项的单与用户开的单同一条链(register → 角色 → 门禁 → 交付 → 真机验证 → harvest 内化);门禁停摆仍是用户否决点。
- **观察原语 O1~O6**:watcher 日志(退出频次/事件分布/WS 断连/静默断链)/ BUDGET token 分布 / REGISTRY 门禁时长与 blockers 频次 / lessons 同类 category 计数 / toolkit 文档漂移 / audit-trail 前次发现状态。数据源不可得 → 显式 unsupported 降级(unsupported-degradation),严禁伪造。
- **F2 领地白名单(硬边界)**:pipeline-ws/(含 .dsh-base/.dsh-library)+ plugindev/toolkit/ + 文档;领地外一律降级 F1 呈递。**规则表本身不能把 F4/F1 客体(flow 模板/角色提示词等)升权 F2**(引擎拒绝报错,AC1)。
- **三档分流**:F2 → project_register(title 前缀「自省立项」, reason 带证据链(evidence 链,可回放), auto:true);F1 → 审计报告呈递 intake(门禁包/结算同通道);F3 → 数据资产直改 + 写 audit-trail.json 留痕。
- **去重限频**:dedupe by-category/by-target(同类已有在跑项目/未解决审计产出 → 不重复);每次审计 F2 上限 2;meta 类动作冷却期 30 天 + 至多一条(防自指风暴)。
- **触发**:harvest 顺带(结项后跑一轮)+ 手动 project_audit(action=run/status)。规则表存 <workspace>/.dsh-library/audit-rules.json(规则归用户,meta 段含 lastMetaActionAt)。

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
每完成一个阶段,协调者(或角色)用 project_budget commit 上报该阶段消耗(stageId/role/usage);
source='runtime-events' 且 usage 缺省时插件按调用者会话 id 读 projcache 自动填真实 token 四桶。
advance 结算联动自动归集:重算本项目私有会话真实 tokenUsage 按角色分桶写 committed(source=runtime-events),
同一会话不双重计数;intake 及共享会话只进工作区级汇总(sharedOnce)。estimate/cap 形状自由,工具不解释其内容。

### 统一总 token 口径与缓存率(cost-v2)
- **权威总 token(totalToken)** = uncachedInputTokens + cacheReadTokens + outputTokens(纯函数,落 project-lib,单一权威)。
  所有外层/明细/查询的"总 token"一律经 project_lib.totalToken() 计算,严禁消费方硬编码第二套公式。
  legacy tokens 字段(= uncachedInput+output,0.8.0 计费口径)仅 read 兼容,不再作展示/查询总消耗口径。
- **cacheRate** = cacheRead / (cacheRead + uncachedInput),分子分母同源;cacheRead≤0 或分母 0 → 0。
- 工具输出承载:project_budget get 的 totals 增 totalToken / byModel(按 model 分组)/ cacheRate;
  project_status 单项目详情的 project.budget 增 totalToken 与按 role 的 byRoleTotal 展开。
- 看板渲染侧(hot-plugins/project-hub)**本轮不触**(D3),外层总 token 由工具输出承载。

### model 来源说明(cost-v2)
- 每笔 runtime-events/commit 条目带 model(+provider):来源 = 上报会话(本角色会话)的 agent 路由——
  session.requestHeader()?.config.{provider,model} 优先,回退 agent.options.{provider,model};可选经
  ctx.get('llm')?.resolveModelInfo(provider, model) 解析规范名增强(try/catch 降级原始路由串)。
- **取不到一律显式 model:'unknown'**,严禁伪造/静默缺省/用协调者路由冒充角色桶(命中 unsupported-degradation)。
- B 路 collect 重写时从被移除的 A 路 runtime-events 条目按 session carry-forward 溯源并入角色桶;
  无溯源的桶 → 'unknown'。若需 B 路满 model provenance,需另立项建 sessionId→model 溯源缓存(默认不做)。

### 路径纪律
- 一切项目文件都在 <workspace>/<projectId>/ 内;projectId 由标题清洗为 kebab slug,含路径分隔符或 ".." 的 id 一律拒绝。
- 角色 workspace=project-root:只在 <workspace>/<projectId>/ 内读写;journal 用 write 追加;登记簿 JSON 只经上述工具修改,不手改。
- 内化产出只写 <workspace>/.dsh-library/(workspace 级),不回写 preset 目录。
- 生产源码路径黑名单(角色自律声明):你的会话沙箱可写根是流水线工作区 pipeline-ws,生产路径(presets/、host-plugins/、dsh-runtime/)实际写不进;但仍须只写 <workspace>/<projectId>/ 内,绝不写 presets/、.dsh-home/profiles/、dsh-runtime/ 等生产路径。需改生产源码一律产出 deliverables/ + APPLY.md 由用户侧代应用。`;

// ── 插件主体 ────────────────────────────────────────────────────────────────

export function apply(ctx, config = {}) {
  const cfg = normalizeConfig(config);
  // preset 自带库 = 插件文件 ../..(即 preset 根)下的 roles|flows(SPEC §4 库解析)。
  const presetDir = fileURLToPath(new URL('..', import.meta.url));
  const api = makeApi({ cfg, presetDir, logger: ctx.logger, ctx });
  ctx.systemPrompt.section({
    name: 'project-pipeline/manual',
    order: 140,
    text: MANUAL_TEXT,
  });

  ctx.tools.register({
    name: 'project_register',
    description: '登记新项目:创建 <workspace>/<projectId>/.dsh-project 登记簿骨架(REGISTRY/FLOW/BUDGET/REQUIREMENT.md),按模板或定制阶段实例化流程,返回项目 id、state、流程概要与底座信息。projectId 由标题清洗为 kebab slug,冲突自动 -2 递增;可传显式 id(英文 slug)与中文 title 解耦。可传 entity(entity-slug,缺省=项目自身):entity 已有底座 → 回执 baseDossier.exists=true;没有 → draftNeeded=true 且 clarify 阶段 produces 扩展底座初稿四件套(流程数据表达,不加新阶段类型)。parked:true → state=parked(入册不 spawn,看板进暂存区)。**同 entity 互斥显式化(0.13.0)**:登记时对同 entity active 项目做互斥检测——命中且非 parked 明确拒绝(不静默并行),建议以 parked:true 排队;parked 登记回执带 entityConflict 冲突信号。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: '项目标题(必填非空),可自由中文;未传 id 时清洗为 ASCII kebab 目录名。' },
        id: { type: 'string', description: '可选显式英文 slug id(格式 [a-z0-9-]+,小写、字母/数字开头、只含小写字母/数字/连字符;含路径分隔符或 ".." 拒绝)。提供时 projectId=uniqueProjectId(workspaceDir, id),title 自由中文;纯中文 title 未提供 id 会拒收并提示提供 id。' },
        requirement: { type: 'string', description: '需求原文,逐字登记进 REQUIREMENT.md。' },
        entity: { type: 'string', description: '可选 entity-slug(字母/数字开头,只含字母/数字/连字符;含路径分隔符或 ".." 拒绝)。缺省=项目自身。entity 已有底座 → 回执 baseDossier.exists=true;没有 → draftNeeded=true,首轮 clarify 扩展产出底座初稿四件套到 <workspace>/.dsh-base/<entity>/。' },
        flowTemplate: { type: 'string', description: '流程模板 id,默认 standard-flow;模板来自 workspace/.dsh-library/flows 与 preset 自带 flows。' },
        flowStages: {
          type: 'array',
          description: '定制阶段序列:给出时整体替换模板 stages;只给本参数不给 flowTemplate 时免模板现场立项。',
          items: stageParamSchema(),
        },
        budgetEstimate: { type: 'object', description: '预算估算(形状自由),登记进 BUDGET.estimate。' },
        parked: { type: 'boolean', description: '默认 false。true → REGISTRY.state=parked(暂存):登记入册但不 spawn 协调者,看板进暂存区;激活走 project_advance(projectId, activate:true)。' },
      },
      required: ['title', 'requirement'],
    },
    output: {
      schema: REGISTER_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: [
        `已登记项目 ${value.projectId}(目录:${value.projectDir},state=${value.state})`,
        `流程共 ${value.flowSummary.length} 个阶段;下一阶段 #${value.nextStage.index + 1} ${value.nextStage.id}(${stageTypeLabel(value.nextStage.type)}${value.nextStage.role ? ` · ${value.nextStage.role}` : ''})。`,
        `底座(entity=${value.baseDossier.entity}):${value.baseDossier.exists ? `已存在(${value.baseDossier.path})` : `无底座,需首轮 clarify 产出初稿(${value.baseDossier.path})`}`,
        value.state === 'parked' ? '项目处于暂存(parked)状态:已入册,未激活,不 spawn 协调者;激活请用 project_advance(projectId, activate:true)。' : '',
        value.entityConflict?.conflict ? `entity 互斥信号:"${value.entityConflict.entity}" 已入暂存排队(现有 active 冲突:${value.entityConflict.conflicts.map((c) => c.projectId).join('、') || '无'}),待实体空出后再激活;不静默并行。` : '',
      ].filter(Boolean).join('\n') }],
    },
    async execute(args, context) {
      return api.register(args, context);
    },
  });

  ctx.tools.register({
    name: 'project_advance',
    description: '推进项目流程指针到下一阶段。门禁待裁决时拒绝;approve 裁决后推进并清门禁态;revise 裁决跳回 reviseTo 指定的 work 阶段;在最后阶段给 appendStages 可开启新迭代。parked 项目只能经 activate:true 激活(parked→active,stageIndex=0)或 cancel:true 取消(parked→rejected,终态),否则一律拒绝;激活时对同 entity active 项目做互斥检测,命中 → 明确拒绝(不静默并行)。每次推进自动写 journal 并刷新 REGISTRY.updatedAt;可带 sessions:[{sessionId,role}] 登记 spawn 返回的 subagentId(主路会话捕获);推进时自动归集本项目私有会话真实 tokenUsage 写 committed(source=runtime-events),返回 collected 状态。',
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
        activate: { type: 'boolean', description: 'parked 项目激活用:true → parked→active,stageIndex=0(clarify);仅对 state=parked 项目生效。' },
        cancel: { type: 'boolean', description: 'parked 项目取消用:true → parked→rejected(终态),journal 记取消理由;仅对 state=parked 项目生效,非 parked 调用一律拒绝。' },
        reason: { type: 'string', description: 'cancel:true 时必填:取消理由(非空字符串),写入 journal 留痕。' },
        sessions: {
          type: 'array',
          description: '主路会话捕获:协调者 spawn 角色后把返回的 subagentId 以 [{ sessionId, role }] 传入,插件写入 REGISTRY.sessions(capturePath=spawn-pass)。',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              sessionId: { type: 'string', description: 'spawn 返回的 subagentId。' },
              role: { type: 'string', description: '该会话归属角色 id。' },
            },
            required: ['sessionId', 'role'],
          },
        },
      },
      required: ['projectId'],
    },
    output: {
      schema: ADVANCE_OUTPUT_SCHEMA,
      render: (args, value) => [{ type: 'text', text: value.delivered
        ? `项目 ${args.projectId} 已交付结项(state=delivered,第 ${value.iteration} 次迭代;最后阶段 ${value.stage.id})。后续推进会被拒绝;开新迭代请登记反馈后用 appendStages。${value.collected ? `归集:${value.collected.ok ? 'ok' : '跳过'}${value.collected.note ? `(${value.collected.note})` : ''}` : ''}`
        : value.activated
          ? `项目 ${args.projectId} 已激活(parked→active,state=active),从阶段 #${value.stageIndex + 1} ${value.stage?.id ?? ''}(${value.stage ? stageTypeLabel(value.stage.type) : ''})开始推进;请按 state=active spawn 协调者从 clarify 开始。`
          : value.cancelled
            ? `项目 ${args.projectId} 已取消(parked→rejected,终态)。取消理由:${args.reason ?? '(未记录)'};登记簿保留(审计可查),id 不释放复用。${value.collected ? `归集:${value.collected.ok ? 'ok' : '跳过'}${value.collected.note ? `(${value.collected.note})` : ''}` : ''}`
            : `项目 ${args.projectId} 推进到阶段 #${value.stageIndex + 1} ${value.stage.id}(${stageTypeLabel(value.stage.type)}${value.stage.role ? ` · ${value.stage.role}` : ''},第 ${value.iteration} 次迭代);日志:${value.journalPath}${value.collected ? `;归集:${value.collected.ok ? 'ok' : '跳过'}${value.collected.note ? `(${value.collected.note})` : ''}` : ''}` }],
    },
    async execute(args, context) {
      return api.advance(args, context);
    },
  });

  ctx.tools.register({
    name: 'project_gate',
    description: '门禁两步制:present 把摘要/材料/建议写成门禁包(gates/NN-<stageId>.md)并置 pending;decide 记录用户裁决(approve/revise/reject)——revise 必给 reviseTo(work 阶段 id),reject 使项目终态。stageId 必须是当前阶段。**delivery-gate present 机械核对(0.16.0)**:读 SPEC.md 解析 acceptance-routing 结构化字段,校验 AC 对照表路由声明(四类真机触发类须声明 user-blocking);块存在 → 非法拒绝呈递;块缺失(存量/未声明)→ 不拒绝,呈递包加观察行。',
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
      render: (args, value) => [{ type: 'text', text: `项目 ${args.projectId} 门禁 ${args.stageId} → ${value.gateStatus};门禁包:${value.gatePath}` }],
    },
    async execute(args, context) {
      return api.gate(args, context);
    },
  });

  ctx.tools.register({
    name: 'project_budget',
    description: '项目预算账本(BUDGET.json):get 查账(totals 含统一总 token totalToken/按 model 分组 byModel/缓存率 cacheRate/按 role 展开 byRoleTotal);set-estimate / set-cap 设置估算与上限(形状自由,工具不解释);commit 逐阶段上报消耗(entry.stageId/role/usage,source 默认 self-report)。source=runtime-events 且 usage 缺省时插件按调用者会话 id 读 projcache 自动填真实 token(四桶+model/provider,model 取本会话 agent 路由)。每阶段结算后都应上报一次。',
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
          description: 'commit 必给:{ stageId, role, usage?, source?=self-report }。source=runtime-events 且 usage 缺省时自动填真实 token。',
          properties: {
            stageId: { type: 'string', description: '发生消耗的阶段 id。' },
            role: { type: 'string', description: '消耗归属角色 id。' },
            usage: { type: 'object', description: '用量(记 token/调用次数/金额字段均可,形状自由);source=runtime-events 时可缺省由插件自动填。' },
            source: { type: 'string', enum: [...BUDGET_SOURCES], description: '取数口径,默认 self-report。' },
          },
          required: ['stageId', 'role'],
        },
      },
      required: ['projectId', 'action'],
    },
    output: {
      schema: BUDGET_OUTPUT_SCHEMA,
      render: (args, value) => [{ type: 'text', text: [
        `项目 ${args.projectId} 预算(${args.action})`,
        `账面:estimate=${JSON.stringify(value.estimate)};cap=${JSON.stringify(value.cap)};committed ${value.totals.entries} 条;按角色 ${JSON.stringify(value.totals.byRole)};按来源 ${JSON.stringify(value.totals.bySource)}`,
        `统一总 token=${value.totals.totalToken};缓存率=${Number.isFinite(value.totals.cacheRate) ? value.totals.cacheRate.toFixed(4) : value.totals.cacheRate}`,
        `按 model:${JSON.stringify(value.totals.byModel)}`,
      ].join('\n') }],
    },
    async execute(args, context) {
      return api.budget(args, context);
    },
  });

  ctx.tools.register({
    name: 'project_status',
    description: '项目查询:不带 projectId 列出工作区全部项目(id/标题/状态/迭代/阶段);带 projectId 返回单项目详情(当前阶段、门禁态、预算 totals(含统一总 token)、SUMMARY 是否存在)。',
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
          if (value.projects.length === 0) return [{ type: 'text', text: '工作区还没有任何项目(用 project_register 登记)。' }];
          return [{ type: 'text', text: [
            `工作区共 ${value.projects.length} 个项目:`,
            ...value.projects.map((p) => `- ${p.id}「${p.title}」${p.state},第 ${p.iteration} 次迭代,阶段 #${p.stageIndex + 1}${p.openBlockers > 0 ? `,⚠ ${p.openBlockers} 个未解决卡点` : ''}(更新于 ${p.updatedAt})`),
          ].join('\n') }];
        }
        const p = value.project;
        return [{ type: 'text', text: [
          `项目 ${p.projectId}「${p.title}」:${p.state},第 ${p.iteration} 次迭代,当前阶段 #${p.stageIndex + 1} ${p.currentStage ? `${p.currentStage.id}(${stageTypeLabel(p.currentStage.type)})` : '(指针越界)'},gateStatus=${JSON.stringify(p.gateStatus)},流程 ${p.flowRef}${p.openBlockers > 0 ? `,⚠ 未解决卡点 ${p.openBlockers} 个(project_block list 查看)` : ''}`,
          `预算:committed ${p.budget.totals.entries} 条;统一总 token=${p.budget.totals.totalToken}(按 role:${JSON.stringify(p.budget.totals.byRoleTotal)});SUMMARY ${p.summaryExists ? '已存在' : '尚无'};更新于 ${p.updatedAt}`,
        ].join('\n') }];
      },
    },
    async execute(args, context) {
      return api.status(args, context);
    },
  });

  ctx.tools.register({
    name: 'project_block',
    description: '卡点通道:遇卡点(无法胜任/验证手段缺失/环境不具备/依赖缺失/权限不足)优先上报,禁止降级处理。report 登记卡点并卡住推进(open 期间 project_advance 拒绝);resolve 记录用户裁决结论后解卡;list 查看全部卡点。协调者收到 open 卡点必须立即呈递用户,不得代替裁决、不得以缩范围/替代手段静默消化。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string', description: '项目 id。' },
        action: { type: 'string', enum: ['report', 'resolve', 'list'], description: 'report=登记卡点;resolve=记录裁决并解卡;list=查看全部。' },
        category: {
          type: 'string',
          description: 'report 用,卡点分类=核心集(design-info=设计信息不完备;dev-complexity=开发复杂度超限;test-env=测试环境/数据不具备;deploy-permission=部署权限/沙箱限制;acceptance-capability=验收手段与验收者能力不匹配(如视觉验收无视觉);other=其他)+ .dsh-library/categories.json 扩展(运行时按合并集校验)。',
        },
        reason: { type: 'string', description: 'report 必填:卡点是什么、为什么在当前能力/环境下无法解决(非空)。' },
        raisedBy: { type: 'string', description: '上报方(角色 id 或 coordinator/intake)。' },
        options: { type: 'array', items: { type: 'string' }, description: '候选处理方案(供用户裁决,非空字符串数组)。' },
        recommendation: { type: 'string', description: '上报方建议。' },
        blockerId: { type: 'string', description: 'resolve 必填:要解决的卡点 id(如 b1)。' },
        resolution: { type: 'string', description: 'resolve 必填:用户裁决结论与后续安排(非空)。' },
      },
      required: ['projectId', 'action'],
    },
    output: {
      schema: BLOCK_OUTPUT_SCHEMA,
      render: (args, value) => {
        if (args.action === 'list') {
          if (!value.blockers || value.blockers.length === 0) return [{ type: 'text', text: `项目 ${args.projectId} 没有卡点记录。` }];
          return [{ type: 'text', text: [
            `项目 ${args.projectId} 卡点(未解决 ${value.openBlockers} 个):`,
            ...value.blockers.map((b) => `- ${b.id} [${b.status}] ${blockerCategoryLabel(b.category)}:${b.reason}${b.resolution ? `(裁决:${b.resolution})` : ''}`),
          ].join('\n') }];
        }
        const b = value.blocker;
        if (args.action === 'report') {
          return [{ type: 'text', text: [
            `项目 ${args.projectId} 已登记卡点 ${b.id}(${blockerCategoryLabel(b.category)}):${b.reason}`,
            `当前未解决卡点 ${value.openBlockers} 个;卡点解决前流程无法推进(project_advance 拒绝)。协调者应立即呈递用户裁决。`,
          ].join('\n') }];
        }
        return [{ type: 'text', text: `项目 ${args.projectId} 卡点 ${b.id} 已解决:${b.resolution}(剩余未解决 ${value.openBlockers} 个,归零后可恢复推进)。` }];
      },
    },
    async execute(args, context) {
      return api.block(args, context);
    },
  });

  ctx.tools.register({
    name: 'project_harvest',
    description: '维护 lessons 消费路由索引(AC1,harvest 阶段协调者调用)。action=rebuild-index:扫 .dsh-library/lessons/ + .dsh-library/patterns/ 读各篇目 front-matter 元数据(origin/category/premises/status),按 category 归类重建 lessons-index.json(保留既有 hits,缺失/坏索引当空基线),返回归类统计;action=bump-hits:入参 lessonRefs:[id],对索引中命中篇目 hits+1,返回递增明细与未命中 id。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['rebuild-index', 'bump-hits'], description: 'rebuild-index=重建消费路由索引;bump-hits=递增命中篇目 hits。' },
        lessonRefs: { type: 'array', items: { type: 'string' }, description: 'bump-hits 必给:被消费路由引用的 lesson id 数组(非空字符串)。' },
      },
      required: ['action'],
    },
    output: {
      schema: HARVEST_OUTPUT_SCHEMA,
      render: (args, value) => {
        if (value.action === 'rebuild-index') {
          return [{ type: 'text', text: [
            `已重建 lessons 消费路由索引(${value.indexFile})`,
            `共 ${value.entriesTotal} 篇目,归入 ${value.categoriesCount} 个 category:${value.categories.map((c) => `${c.category}=${c.count}`).join(', ')}`,
          ].join('\n') }];
        }
        return [{ type: 'text', text: `已递增 hits:${value.bumped.length > 0 ? value.bumped.map((b) => `${b.id}=${b.hits}`).join(', ') : '(无命中)'}${value.misses.length > 0 ? `;未命中(未收录):${value.misses.join(', ')}` : ''}` }];
      },
    },
    async execute(args, context) {
      return api.harvest(args, context);
    },
  });

  ctx.tools.register({
    name: 'project_audit',
    description: '自省审计回路(0.15.0):观察 O1~O6 → 规则表判定 → 去重限频 → 三档分流。action=run 跑一轮审计(F2 走 project_register auto:true / F1 呈递报告 / F3 直改留痕),写 .dsh-library/audit-trail.json append-only;action=status 查审计留痕与状态。规则表存 <workspace>/.dsh-library/audit-rules.json(规则归用户)。领地白名单硬校验:规则表含 act=F4 或对 F1 客体(flow 模板/角色提示词)升权 F2 → 引擎拒绝报错(AC1)。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['run', 'status'], description: 'run=跑一轮审计;status=查审计留痕与状态。' },
      },
      required: ['action'],
    },
    output: {
      schema: AUDIT_OUTPUT_SCHEMA,
      render: (args, value) => {
        if (value.action === 'status') {
          return [{ type: 'text', text: [
            `审计状态:共 ${value.trailCount} 条留痕,未解决 ${value.openFindings} 条,上次运行 ${value.lastRunAt ?? '(无)'}`,
            value.trail.length > 0 ? `最近 ${value.trail.length} 条:${value.trail.map((t) => `[${t.action}]${t.ruleId ?? ''}:${t.status ?? ''}`).join('; ')}` : '',
          ].filter(Boolean).join('\n') }];
        }
        const notes = value.notes ?? [];
        return [{ type: 'text', text: [
          value.status === 'rejected'
            ? `审计被拒(rules 领地硬校验):${value.error ?? ''}`
            : `一轮审计完成:${value.findings?.length ?? 0} 条发现,产出分流 ${value.executed?.length ?? 0} 件(actions ${value.actions?.length ?? 0} 个,去重/限频丢弃 ${value.dropped?.length ?? 0} 个)`,
          value.obsErrors?.length > 0 ? `观察非致命跳过:${value.obsErrors.join('; ')}` : '',
          ...(value.executed ?? []).map((e) => e.act === 'F2' ? `· [F2] 已立项 ${e.projectId}「${e.title}」` : e.act === 'F1' ? `· [F1] 呈递报告(findingId=${e.findingId ?? ''})` : `· [F3] 直改留痕 ${e.object ?? ''}`),
          notes.length > 0 ? `注:${notes.join('; ')}` : '',
          `留痕:${value.trailPath ?? ''}`,
        ].filter(Boolean).join('\n') }];
      },
    },
    async execute(args, context) {
      return api.audit(args, context);
    },
  });

}

export default { name, inject, apply };
