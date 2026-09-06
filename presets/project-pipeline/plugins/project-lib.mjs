// project-pipeline 纯库模块(A 路:登记簿)—— 只放数据校验与文件读写原语。
// 这不是 cordis 插件:没有 name/inject/apply,不进组合行;登记簿插件
// (project-registry.mjs)与角色库插件(project-roles.mjs,B 路)都按本文件
// 的导出签名 import 复用(SPEC-P1 §5 钉死,不得私自改约)。
//
// 硬约束:零 npm import(仅 node: 内置);登记簿/库文件一律 JSON;
// 写文件一律 node:fs/promises,JSON 落盘 2 空格缩进 + 末尾换行。
//
// 0.5.0 新增(机制1/机制2,2026-08-30):
//   - 机制1 既定裁决库:BLOCKER_CATEGORIES / validateRulings / readRulings / matchRuling;
//   - 机制2 失败模式聚合:collectAllBlockers / aggregateByCategory / buildFailureReport
//     (纯函数,作为协调者 harvest 手动步骤的规范参考实现,单测锁定形状)。
// 0.5.1 新增(迭代7 中文命名,2026-08-30):
//   - slugifyStrict(title):复用 slugify 内部清洗逻辑,当 slugify 会回退到
//     'project-<YYYYMMDD>' 前缀时返回 null(register 层据此拒收纯中文标题并提示提供 id)。
//     slugify 本身不改(保持返回日期前缀,向后兼容其他调用方与既有测试)。
// 0.8.0 新增(预算账本改真实 token 计量,2026-08-31):
//   - readProjcache(file):读 projcache 检查点文件 + 守卫 unit.version(≠3 中文报错不误解析);
//   - sessionTokenUsage(projcache, sessionId):取单会话 tokenUsage(有效计费口径);
//   - aggregateByRole(sessions, projcache):按 REGISTRY.sessions 角色桶聚合 tokenUsage。
//     零 npm import;可单测(注入临时 projcache 文件)。
// 0.10.0 新增(项目底座层 Base Dossier P1,2026-09-01):
//   - MAX_COMPILED_PERSONA=1060(C4a:编译后 persona 头+正文合计上限;2026-09-04 由 1000 抬至 1060:长 entity slug(如 r-lesson-storm-mtmc1gb4,24 字符)的 readings 头实测 1009,超限阻断 spawn;300→450→700→1000→1060 渐进史);
//   - entitySlugOf / baseDossierPaths / baseDossierExists(实体仓底座四件套路径);
//   - validateReadings / expandReadings / compileReadingsHeader(role manifest readings 段);
//   - validateRole 增 readings 只增校验。
// 0.11.0 新增(P4 记忆治理·消费路由优先,2026-09-02):
//   - validateRulings 扩展:negative-premises(否定面,string[])/ basis(机制版本锚,string),
//     只增不改(既有 r1~r4 字段不动);matchRuling 命中判据扩展为「premise 命中 + negative-premises 不命中」。
//   - BLOCKER_CATEGORIES 开放为核心集(6 类恒在);resolveBlockerCategories(workspaceDir)
//     = 核心集 ∪ <workspaceDir>/.dsh-library/categories.json 扩展(同名去重扩展条目胜;
//     缺失/坏 JSON → 回退核心集并告警,不炸调用方)。validateCategories 校验扩展形状。
//   - lessons-index 消费路由索引:buildLessonsIndex / bumpLessonHits / validateLessonsIndex(均纯函数)。
//     结构 schemaVersion=1,{ categories: { <category>: [{ id, kind, title, premises, status, origin, hits }] } }。
//     hits 初始 0;rebuild 保留既有 hits、新增篇目 hits=0;kind=lesson/pattern 统一归类不按 kind 分叉。
// 0.12.0 新增(成本计量 v2 kr-cost-v2,2026-09-02):
//   - totalToken(usage)=uncachedInput+cacheRead+output(权威总 token,单一口径);
//   - cacheRate(usage)=cacheRead/(cacheRead+uncachedInput),cacheRead<=0/分母0→0;
//   - normalizeUsage(任意旧/新形状→六桶+model+provider,兼容读)/ modelLabel(model,'unknown' 哨兵);
//   - aggregateByModel(按 model 分组聚合,未知归 'unknown');
//   - aggregateByRole 扩展:桶增 cacheRead/cacheWrite 与 model 溯源透传位(可选 modelProvenance carry-forward)。
// 0.13.0 新增(entity 底座互斥显式化,隐式触点显式化,kr-entity-mutex,2026-09-03):
//   - entityTouchpoint(workspaceDir, entitySlug):entity 隐式触点路径(= baseDossierPaths,
//     与「资源触点互斥声明(机制1)」的显式文件路径同级),单测断言 隐式触点 == 底座路径;
//   - entityConflictActive(candidateEntity, registries):同 entity active 互斥检测纯函数,
//     entitySlugOf 缺省=registry.id(legacy 天然互异、不冲突,25 存量项目零影响);
//     只增不改、零 npm import。
// 0.15.0 新增(自省审计回路 kr-self-audit,2026-09-03):
//   - 观察原语 observeO1~O6(纯函数,扫 FORM §4 数据源,产出发现清单,每条含 evidence);
//   - 规则表引擎:validateAuditRules / auditTerritoryWhitelist / auditRuleEngine / auditDedupe /
//     auditRateLimit(领地白名单硬边界:规则表含 act:F4 或对 F1 客体(flow/角色提示词)升权 F2 → 引擎拒绝报错=AC1);
//   - 分流 payload:buildF2Payload(title 前缀「自省立项」+ reason evidence 链 + auto:true)/
//     buildF1Payload(发现+evidence+建议)/ buildF3Payload(直改动作+before+after+evidence);
//   - 观察读容错:readJsonRetry(瞬时半写读容错 registry-halfwrite-read-tolerance);
//   - audit-rules 默认 meta(metaRuleChangeCooldownDays=30 / maxAutoProjectsPerAudit=2);
//     只增不改、零 npm import。
// 0.16.0 新增(验收路由前置化 kr-accept-route,2026-09-04):
//   - ACCEPTANCE_TRIGGER_CLASSES(四类真机触发类:real-session/visual-browser/deploy-restart/
//     real-upstream-credential)与 ACCEPTANCE_ROUTES(model-verifiable/user-blocking);
//   - parseAcceptanceRouting(specText):解析 SPEC 头部 front-matter 的 acceptance-routing 块
//     (结构化字段,机械核对更稳,不用 markdown 表 regex);缺 front-matter/缺块 → 带
//     missing:true(块缺失,存量/未声明,delivery-gate 据此跳过核对不阻断);
//   - validateAcceptanceRouting(entries):校验 AC 对照表路由声明——trigger ∈ 四类触发类时
//     route 必须 user-blocking(r4 语义:真机项由用户侧 blocking 执行,不得以静态放行替代);
//     只增不改、零 npm import。

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

/** 阶段类型词汇表(框架的强约束;扩类型 = 模板 semver minor,改语义 = major)。 */
export const STAGE_TYPES = ['work', 'gate', 'summary', 'internalize'];

/** 预算 source 口径枚举(钉死;自报/事件实收/消费插件三层共用一本账)。 */
export const BUDGET_SOURCES = ['self-report', 'runtime-events', 'billing-plugin'];

/**
 * 编译后 persona 长度上限(C4a 修正:抬至 1000,头+正文合计)。
 * 背景:readings 头是路径清单不是 persona 正文,历史 300→450→700 本就是渐进放宽的
 * 纪律参数;1000 字符仍远小于任何会话上下文预算,不改"控制 spawn 上下文成本"的本意。
 * compileSubagent 把 readings 展开的"进场必读"头前置到 persona 后,若头+正文合计
 * 超本上限,在 role_show 编译期抛错(不静默截断)。
 */
export const MAX_COMPILED_PERSONA = 1060;

/** 卡点分类白名单(= 五维可行性维度 + other;与 project-registry 的 BLOCKER_CATEGORIES 对齐)。 */
export const BLOCKER_CATEGORIES = [
  'design-info',            // 设计可行性:信息不完备(需求/参照/边界缺失)
  'dev-complexity',         // 开发可行性:复杂度/体量/依赖超出角色能力
  'test-env',               // 测试可行性:验证所需环境/数据/凭据不具备
  'deploy-permission',      // 部署可行性:目标路径权限/沙箱边界/凭据/重启窗口
  'acceptance-capability',  // 验收可行性:验收手段与验收者能力不匹配(如视觉验收无视觉)
  'other',
];

/** workspace 级库目录名(workspace 库覆盖 preset 自带库,同 id workspace 胜)。 */
const LIBRARY_DIRNAME = '.dsh-library';

/** projectId / stage id 的 slug 形状:字母或数字开头,只含字母/数字/连字符。 */
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/** workspace 的两个保留值(其余视为项目根下的相对路径)。 */
const WORKSPACE_PRESETS = new Set(['project-root', 'shared']);

/** reasoningEffort 的合法值(P1 仅在清单里留字段,编译时不透传)。 */
const REASONING_EFFORTS = ['off', 'high', 'max'];

// ── 时间与 slug ─────────────────────────────────────────────────────────────

/** 'YYYYMMDD-HHmmss'(本地时间),用于日志/门禁包等人类可读戳。 */
export function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 'YYYYMMDD'(本地时间),slug 回退前缀用。 */
function dateStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/**
 * 标题 → ASCII kebab slug(目录名安全)。
 * 非 ASCII / 清洗后为空 → 返回日期前缀 'project-<YYYYMMDD>',
 * 冲突计数('-2' 递增)由调用方负责。混合标题取其中 ASCII 片段(如 '重构 auth' → 'auth')。
 * 路径安全兜底:清洗结果若仍含路径分隔符或为 '.'/'..'(理论上不可能),同样回退。
 */
export function slugify(title) {
  const fallback = `project-${dateStamp()}`;
  if (typeof title !== 'string') return fallback;
  let cleaned = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (cleaned.length > 64) cleaned = cleaned.slice(0, 64).replace(/-+$/g, '');
  if (cleaned.length === 0 || /[\\/]/.test(cleaned) || cleaned === '.' || cleaned === '..') return fallback;
  return cleaned;
}

/**
 * 标题 → ASCII kebab slug;当 slugify 会回退到 'project-<YYYYMMDD>' 前缀时返回 null。
 * 复用 slugify 内部清洗逻辑(零重复),仅把「回退分支」改为返回 null。
 * 用途:register 层判断「纯中文/无 ASCII 片段标题」→ 拒收并提示提供 id(不引入拼音依赖)。
 * slugify 本身不改(保持返回日期前缀,向后兼容其他调用方与既有测试)。
 * 注意:用 /^project-\d{8}$/ 正则匹配 slugify 结果会误伤真实标题「project 20260830」
 * (slug 'project-20260830'),故用本显式辅助函数信号更干净(DESIGN §1.2)。
 */
export function slugifyStrict(title) {
  if (typeof title !== 'string') return null;
  let cleaned = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (cleaned.length > 64) cleaned = cleaned.slice(0, 64).replace(/-+$/g, '');
  if (cleaned.length === 0 || /[\\/]/.test(cleaned) || cleaned === '.' || cleaned === '..') return null;
  return cleaned;
}

// ── 校验原语(validateRole / validateFlow / validateStageList)──────────────

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** 校验失败的统一返回形状。 */
function bad(error) {
  return { ok: false, error };
}

/** 校验通过的统一返回形状。 */
function good(value) {
  return { ok: true, value };
}

/** 各阶段类型允许的键(common:id/type;其余按类型收紧,未知键一律校验失败)。 */
const STAGE_ALLOWED_KEYS = {
  work: new Set(['id', 'type', 'role', 'produces', 'note']),
  gate: new Set(['id', 'type', 'title', 'present', 'note']),
  summary: new Set(['id', 'type', 'note']),
  internalize: new Set(['id', 'type', 'note']),
};

/**
 * 校验阶段序列:数组逐个校验 + id 唯一。
 * work 必有 role;gate 必有 title;id 唯一且 slug;type ∈ STAGE_TYPES;未知键 → 失败。
 */
export function validateStageList(stages) {
  if (!Array.isArray(stages) || stages.length === 0) return bad('stages 必须是非空数组');
  const seen = new Set();
  for (let index = 0; index < stages.length; index++) {
    const stage = stages[index];
    const at = `stages[${index}]`;
    if (!isPlainObject(stage)) return bad(`${at} 必须是对象`);
    if (typeof stage.id !== 'string' || !SLUG_RE.test(stage.id)) {
      return bad(`${at}.id 必须是 slug(字母/数字开头,只含字母/数字/连字符),得到 ${JSON.stringify(stage.id ?? null)}`);
    }
    if (seen.has(stage.id)) return bad(`${at}.id 重复:${stage.id}`);
    seen.add(stage.id);
    if (!STAGE_TYPES.includes(stage.type)) {
      return bad(`${at}.type 必须是 ${STAGE_TYPES.join('/')} 之一,得到 ${JSON.stringify(stage.type ?? null)}`);
    }
    for (const key of Object.keys(stage)) {
      if (!STAGE_ALLOWED_KEYS[stage.type].has(key)) return bad(`${at} 含未知键 "${key}"(type=${stage.type})`);
    }
    if (stage.type === 'work' && !nonEmptyString(stage.role)) return bad(`${at}.role 必填(work 阶段要指派角色)`);
    if (stage.type === 'gate' && !nonEmptyString(stage.title)) return bad(`${at}.title 必填(gate 阶段要有门禁标题)`);
    for (const key of ['produces', 'present']) {
      if (stage[key] !== undefined && (!Array.isArray(stage[key]) || stage[key].some((x) => !nonEmptyString(x)))) {
        return bad(`${at}.${key} 必须是非空字符串数组`);
      }
    }
    if (stage.note !== undefined && typeof stage.note !== 'string') return bad(`${at}.note 必须是字符串`);
  }
  return good(stages);
}

/**
 * 校验整份流程(模板文件与 FLOW.json 实例同形;实例多 source/revision 字段)。
 * 允许键:schemaVersion/id/version/stages/source/revision;未知键 → 失败。
 */
export function validateFlow(flow) {
  if (!isPlainObject(flow)) return bad('流程必须是 JSON 对象');
  const allowed = new Set(['schemaVersion', 'id', 'version', 'stages', 'source', 'revision']);
  for (const key of Object.keys(flow)) {
    if (!allowed.has(key)) return bad(`流程含未知键 "${key}"`);
  }
  if (flow.schemaVersion !== undefined && flow.schemaVersion !== 1) {
    return bad(`不支持的 schemaVersion(仅支持 1),得到 ${JSON.stringify(flow.schemaVersion)}`);
  }
  if (!nonEmptyString(flow.id)) return bad('流程 id 必须是非空字符串');
  if (!Number.isSafeInteger(flow.version) || flow.version < 1) return bad('流程 version 必须是正整数');
  if (flow.revision !== undefined && (!Number.isSafeInteger(flow.revision) || flow.revision < 1)) {
    return bad('流程 revision 必须是正整数');
  }
  if (flow.source !== undefined && !nonEmptyString(flow.source)) return bad('流程 source 必须是非空字符串');
  const stages = validateStageList(flow.stages);
  if (!stages.ok) return bad(`流程 ${flow.id}:${stages.error}`);
  return good(flow);
}

/**
 * 校验角色清单(SPEC §3.4):id/summary/persona 必填;model/tools/workspace/permissions
 * 整段可选但出现即校验;tools.allow/deny 二选一;permissions.approval P1 固定 'inherit';
 * 未知顶层键 → 失败。value 为归一化副本(workspace 缺省补 'project-root')。
 */
export function validateRole(role) {
  if (!isPlainObject(role)) return bad('角色清单必须是 JSON 对象');
  const allowed = new Set(['id', 'summary', 'persona', 'model', 'tools', 'workspace', 'permissions', 'readings']);
  for (const key of Object.keys(role)) {
    if (!allowed.has(key)) return bad(`角色清单含未知顶层键 "${key}"`);
  }
  if (!nonEmptyString(role.id)) return bad('角色 id 必填(非空字符串)');
  if (!nonEmptyString(role.summary)) return bad(`角色 ${role.id} 的 summary 必填(一句话)`);
  if (!nonEmptyString(role.persona)) return bad(`角色 ${role.id} 的 persona 必填(非空全文)`);
  // P1 只增校验:readings 若出现必须是非空字符串数组(路径模板,支持 {{base}}/{{project}})。
  const readings = validateReadings(role.readings);
  if (!readings.ok) return bad(`角色 ${role.id} 的 ${readings.error}`);
  if (role.model !== undefined) {
    const model = role.model;
    if (!isPlainObject(model)) return bad(`角色 ${role.id} 的 model 必须是对象`);
    for (const key of Object.keys(model)) {
      if (!['provider', 'model', 'maxTokens', 'reasoningEffort'].includes(key)) {
        return bad(`角色 ${role.id} 的 model 含未知键 "${key}"`);
      }
    }
    if (model.provider !== undefined && !nonEmptyString(model.provider)) {
      return bad(`角色 ${role.id} 的 model.provider 必须是非空字符串`);
    }
    if (model.model !== undefined && !nonEmptyString(model.model)) {
      return bad(`角色 ${role.id} 的 model.model 必须是非空字符串`);
    }
    if (model.maxTokens !== undefined && (!Number.isSafeInteger(model.maxTokens) || model.maxTokens < 1)) {
      return bad(`角色 ${role.id} 的 model.maxTokens 必须是正整数`);
    }
    if (model.reasoningEffort !== undefined && !REASONING_EFFORTS.includes(model.reasoningEffort)) {
      return bad(`角色 ${role.id} 的 model.reasoningEffort 必须是 ${REASONING_EFFORTS.join('/')} 之一`);
    }
  }
  if (role.tools !== undefined) {
    const tools = role.tools;
    if (!isPlainObject(tools)) return bad(`角色 ${role.id} 的 tools 必须是对象`);
    for (const key of Object.keys(tools)) {
      if (key !== 'allow' && key !== 'deny') return bad(`角色 ${role.id} 的 tools 含未知键 "${key}"`);
    }
    if (tools.allow !== undefined && tools.deny !== undefined) {
      return bad(`角色 ${role.id} 的 tools.allow 与 tools.deny 二选一,不可同时声明`);
    }
    for (const key of ['allow', 'deny']) {
      if (tools[key] !== undefined && (!Array.isArray(tools[key]) || tools[key].some((x) => !nonEmptyString(x)))) {
        return bad(`角色 ${role.id} 的 tools.${key} 必须是非空字符串数组`);
      }
    }
    // 死锁禁令(2026-08-29 流水线实测):流水线角色一律以后台 continuable spawn,
    // ask_user_question 的提问挂在自己会话上无人应答 → 角色永久挂起。澄清与疑问
    // 只能走 SPEC 遗留疑问 / 门禁包 / journal,由用户在门禁点看到。
    if (Array.isArray(tools.allow) && tools.allow.includes('ask_user_question')) {
      return bad(`角色 ${role.id} 的 tools.allow 含 ask_user_question:后台 continuable 角色的提问无人应答会永久挂起(实测死锁);疑问请写 SPEC 遗留疑问或门禁包`);
    }
  }
  let workspace = 'project-root';
  if (role.workspace !== undefined) {
    const w = role.workspace;
    if (!nonEmptyString(w)) return bad(`角色 ${role.id} 的 workspace 必须是非空字符串`);
    if (!WORKSPACE_PRESETS.has(w)) {
      if (isAbsolute(w) || /^[a-zA-Z]:[\\/]/.test(w)) {
        return bad(`角色 ${role.id} 的 workspace 只允许 project-root/shared/相对路径,得到绝对路径:${w}`);
      }
      if (w.split(/[\\/]/).includes('..')) {
        return bad(`角色 ${role.id} 的 workspace 相对路径不允许 ".." 段:${w}`);
      }
    }
    workspace = w;
  }
  if (role.permissions !== undefined) {
    const permissions = role.permissions;
    if (!isPlainObject(permissions)) return bad(`角色 ${role.id} 的 permissions 必须是对象`);
    for (const key of Object.keys(permissions)) {
      if (key !== 'approval' && key !== 'scope') return bad(`角色 ${role.id} 的 permissions 含未知键 "${key}"`);
    }
    if (permissions.approval !== undefined && permissions.approval !== 'inherit') {
      return bad(`角色 ${role.id} 的 permissions.approval 在 P1 固定为 "inherit",得到 ${JSON.stringify(permissions.approval)}`);
    }
    if (permissions.scope !== undefined && !nonEmptyString(permissions.scope)) {
      return bad(`角色 ${role.id} 的 permissions.scope 必须是非空字符串`);
    }
  }
  return good({ ...role, workspace });
}

// ── 库解析(preset 自带库 + workspace 库合并)────────────────────────────────

/**
 * 解析角色库与流程库:`<workspaceDir>/.dsh-library/roles|flows/*.json` 覆盖
 * `<presetDir>/roles|flows/*.json`(同 id workspace 胜)。坏 JSON / 校验失败的
 * 条目跳过并记入 *Errors(带 file 与中文原因);被 workspace 覆盖的 preset 坏
 * 条目直接跳过、不报错(已无关紧要)。同层内同名 id 后读到的覆盖先读到的。
 * 目录缺失视为该层为空。返回:
 *   { roles: Map<id,{manifest,source}>, flows: Map<id,{flow,source}>,
 *     roleErrors: [{file,error}], flowErrors: [{file,error}] }
 */
export function resolveLibrary({ workspaceDir, presetDir, libraryDir } = {}) {
  const roles = new Map();
  const flows = new Map();
  const roleErrors = [];
  const flowErrors = [];
  const layers = [];
  // libraryDir 仅允许覆盖 workspace 库目录名(消费方 config 显式给出时才传,
  // 默认 .dsh-library);preset 自带库永远在 presetDir/roles|flows。
  const libraryRootName = nonEmptyString(libraryDir) ? libraryDir : LIBRARY_DIRNAME;
  if (nonEmptyString(workspaceDir)) layers.push({ root: join(workspaceDir, libraryRootName), layer: 'workspace' });
  if (nonEmptyString(presetDir)) layers.push({ root: presetDir, layer: 'preset' });
  for (const { root, layer } of layers) {
    collectLayer(join(root, 'roles'), layer, roles, roleErrors, validateRole, 'manifest');
    collectLayer(join(root, 'flows'), layer, flows, flowErrors, validateFlow, 'flow');
  }
  return { roles, flows, roleErrors, flowErrors };
}

/** 扫一层目录并把通过校验的条目放进 map;坏条目记入 errors。 */
function collectLayer(dir, layer, map, errors, validate, valueKey) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return; // 目录不存在 = 该层为空,不是错误
  }
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue;
    const file = join(dir, name);
    let raw;
    try {
      raw = readFileSync(file, 'utf8');
    } catch (error) {
      errors.push({ file, error: `读取失败:${error?.message ?? error}` });
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      errors.push({ file, error: `JSON 解析失败:${error?.message ?? error}` });
      continue;
    }
    const id = isPlainObject(parsed) && nonEmptyString(parsed.id) ? parsed.id : undefined;
    // preset 层:同 id 已被 workspace 覆盖 → 不再校验、不报错、直接跳过。
    if (layer === 'preset' && id !== undefined && map.has(id)) continue;
    const checked = validate(parsed);
    if (!checked.ok) {
      errors.push({ file, error: checked.error });
      continue;
    }
    map.set(checked.value.id, { [valueKey]: checked.value, source: layer });
  }
}

// ── 登记簿路径与 JSON 读写 ──────────────────────────────────────────────────

/**
 * 登记簿全路径布局(SPEC §2)。projectId 必须是 slug:含路径分隔符或 '..' 一律
 * throw(路径逃逸兜底;正常路径下 projectId 都经 slugify 清洗,不会走到这)。
 */
export function registryPaths(workspaceDir, projectId) {
  if (typeof projectId !== 'string' || !SLUG_RE.test(projectId)) {
    throw new Error(`projectId 非法(只允许字母/数字/连字符且以字母或数字开头):${JSON.stringify(projectId ?? null)}`);
  }
  const projectDir = join(workspaceDir, projectId);
  const registryDir = join(projectDir, '.dsh-project');
  return {
    projectDir,
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

/** 读 JSON 文件;缺失/不可读/坏 JSON 都抛中文错误(带路径)。 */
export async function readJson(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    throw new Error(`读取 ${file} 失败:${error?.code ?? error?.message ?? error}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`文件不是合法 JSON:${file}`);
  }
}

/** 写 JSON 文件(自动建父目录);2 空格缩进 + 末尾换行。 */
export async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

// ── 实体仓底座 Base Dossier + role readings(P1,2026-09-01)───────────────
// 底座目录 = 工作区级 <workspace>/.dsh-base/<entitySlug>/(与 .dsh-library 平级),
// 四件套 MAP/DECISIONS/RUNBOOK/STATE 跨迭代存活、增量维护。entitySlug 过卫兵。
// role manifest 的 readings 段是路径模板数组(支持 {{base}}/{{project}} 变量),
// 展开为"进场必读"头拼进 spawn persona(路径非内容,不挤 persona 长度纪律)。

/** entitySlug 卫兵(与 projectId 同款:字母/数字开头,只含字母/数字/连字符)。 */
const ENTITY_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/**
 * REGISTRY 的 entitySlug:缺省=项目自身(legacy 兼容,25 存量项目零影响)。
 * 无 entitySlug 字段或非字符串 → 返回 registry.id。
 */
export function entitySlugOf(registry) {
  if (registry === null || typeof registry !== 'object') return undefined;
  return typeof registry.entitySlug === 'string' && registry.entitySlug.length > 0
    ? registry.entitySlug
    : registry.id;
}

/**
 * 底座目录全路径布局(工作区级 .dsh-base/<entitySlug>/)。entitySlug 必须是 slug:
 * 含路径分隔符或 '..' 一律 throw(路径逃逸兜底,与 registryPaths 同款姿势)。
 */
export function baseDossierPaths(workspaceDir, entitySlug) {
  if (typeof entitySlug !== 'string' || !ENTITY_SLUG_RE.test(entitySlug)) {
    throw new Error(`entitySlug 非法(只允许字母/数字/连字符且以字母或数字开头):${JSON.stringify(entitySlug ?? null)}`);
  }
  const baseDir = join(workspaceDir, '.dsh-base', entitySlug);
  return {
    baseDir,
    mapFile: join(baseDir, 'MAP.md'),
    decisionsFile: join(baseDir, 'DECISIONS.md'),
    runbookFile: join(baseDir, 'RUNBOOK.md'),
    stateFile: join(baseDir, 'STATE.md'),
  };
}

/** 底座是否存在(以 STATE.md 存在为准)。 */
export async function baseDossierExists(workspaceDir, entitySlug) {
  const paths = baseDossierPaths(workspaceDir, entitySlug);
  try {
    await stat(paths.stateFile);
    return true;
  } catch {
    return false;
  }
}

// ── entity 底座互斥显式化·隐式触点(0.13.0,kr-entity-mutex,2026-09-03)─────
// 背景:.dsh-base/<entity>/ 是跨项目隐式共享写;同 entity 两个 active 项目并行迭代
// 会竞争写同一底座。本需求把 entity 维度提升为一等资源触点(等价于自动声明「拟写
// <workspace>/.dsh-base/<entity>/」),并提供同 entity active 互斥检测纯函数。只增不改。

/**
 * entity 隐式触点路径(只读,复用 baseDossierPaths 单一来源)。
 * 返回 baseDossierPaths 的对象(baseDir 即「拟写 <workspace>/.dsh-base/<entitySlug>/」
 * 的目录);用于把 entity 维度并入「资源触点互斥声明(机制1)」比对——单测断言
 * 隐式触点 == 底座路径(R2)。
 */
export function entityTouchpoint(workspaceDir, entitySlug) {
  return baseDossierPaths(workspaceDir, entitySlug);
}

/**
 * 同 entity active 互斥检测(纯函数,零 npm import,只增不改)。
 * 输入:candidateEntity(候选 entity slug,非空字符串);registries(项目 REGISTRY 数组,
 * 每项须含 id/state/entitySlug;entitySlug 经 entitySlugOf 提取,缺省=registry.id)。
 * 返回:{ conflict: boolean, conflicts: [{ projectId, entitySlug, state }] }。
 * 规则:
 *   - 仅对 state==='active' 的既有项目做互异冲突判定(同 entity 并行 active 才竞争写底座);
 *   - legacy(无 entitySlug,缺省=项目自身 id)之间天然互异、永不冲突(R3 回归);
 *   - parked/delivered/rejected 等非 active 不构成冲突(机制4:parked 进比对但标注不冲突);
 *   - 候选 id 与自身相同但自身非 active 时(如 parked)同样不视为冲突。
 * 只增不改:不改任何既有导出。
 */
export function entityConflictActive(candidateEntity, registries) {
  if (typeof candidateEntity !== 'string' || candidateEntity.length === 0) {
    return { conflict: false, conflicts: [] };
  }
  const list = Array.isArray(registries) ? registries : [];
  const conflicts = [];
  for (const r of list) {
    if (r === null || typeof r !== 'object') continue;
    if (r.state !== 'active') continue; // 仅 active 并行才竞争写底座
    const slug = entitySlugOf(r);
    if (!(typeof slug === 'string' && slug.length > 0)) continue;
    if (slug === candidateEntity) {
      conflicts.push({ projectId: r.id, entitySlug: slug, state: r.state });
    }
  }
  return { conflict: conflicts.length > 0, conflicts };
}

/** readings 校验(只增):若出现必须是非空字符串数组,每项非空;缺省通过。 */
export function validateReadings(readings) {
  if (readings === undefined) return good(undefined);
  if (!Array.isArray(readings) || readings.length === 0) return bad('readings 必须是非空字符串数组');
  if (readings.some((x) => !nonEmptyString(x))) return bad('readings 每项必须是非空字符串');
  return good(readings);
}

/**
 * 展开 readings:把 {{base}}/{{project}} 变量替换为具体路径前缀。
 * base/project 为路径前缀(相对工作区,如 '.dsh-base/<entity>/' 与 '<projectId>/'),
 * 未给时保留原模板。返回展开后的路径数组。
 */
export function expandReadings(readings, { base, project } = {}) {
  if (!Array.isArray(readings)) return [];
  return readings.map((tpl) => {
    let out = tpl;
    if (typeof base === 'string' && base.length > 0) out = out.split('{{base}}').join(base);
    if (typeof project === 'string' && project.length > 0) out = out.split('{{project}}').join(project);
    return out;
  });
}

/** 编译"进场必读"头(供 compileSubagent 用);无 readings → 空串。 */
export function compileReadingsHeader(readings, { base, project } = {}) {
  const expanded = expandReadings(readings, { base, project });
  if (expanded.length === 0) return '';
  return ['进场必读:', ...expanded.map((p) => `- ${p}`)].join('\n');
}

// ── 机制1 既定裁决库(2026-08-30 流程补丁)──────────────────────────────────

/** 裁决条目允许的键(未知键 → 校验失败)。negative-premises/basis 为 0.11.0 只增扩展。 */
const RULING_ALLOWED_KEYS = new Set(['id', 'category', 'premise', 'conclusion', 'means', 'negative-premises', 'basis']);

/**
 * 校验裁决库结构(机制1)。value 为解析后的对象。
 * 要求:schemaVersion=1;rulings 为非空数组;每条含 id/category/premise/conclusion/means;
 * category ∈ BLOCKER_CATEGORIES;negative-premises(可选)= 非空字符串数组(否定面,何种情形不命中);
 * basis(可选)= 非空字符串(机制版本锚,harvest 复查提示);未知键 → 失败。返回 { ok, value } 或 { ok:false, error }。
 * 供单测(AC-m1-t1)与 product 引用前自查。既有 r1~r4 字段不动,新字段只增。
 */
export function validateRulings(value) {
  if (!isPlainObject(value)) return bad('裁决库必须是 JSON 对象');
  const allowed = new Set(['schemaVersion', 'rulings']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return bad(`裁决库含未知键 "${key}"`);
  }
  if (value.schemaVersion !== 1) return bad(`不支持的 schemaVersion(仅支持 1),得到 ${JSON.stringify(value.schemaVersion)}`);
  if (!Array.isArray(value.rulings) || value.rulings.length === 0) return bad('rulings 必须是非空数组');
  const seen = new Set();
  for (let i = 0; i < value.rulings.length; i++) {
    const r = value.rulings[i];
    const at = `rulings[${i}]`;
    if (!isPlainObject(r)) return bad(`${at} 必须是对象`);
    for (const key of Object.keys(r)) {
      if (!RULING_ALLOWED_KEYS.has(key)) return bad(`${at} 含未知键 "${key}"`);
    }
    if (!nonEmptyString(r.id)) return bad(`${at}.id 必填(非空字符串)`);
    if (seen.has(r.id)) return bad(`${at}.id 重复:${r.id}`);
    seen.add(r.id);
    if (!BLOCKER_CATEGORIES.includes(r.category)) {
      return bad(`${at}.category 必须是 ${BLOCKER_CATEGORIES.join('/')} 之一,得到 ${JSON.stringify(r.category)}`);
    }
    for (const key of ['premise', 'conclusion', 'means']) {
      if (!nonEmptyString(r[key])) return bad(`${at}.${key} 必填(非空字符串)`);
    }
    if (r['negative-premises'] !== undefined) {
      if (!Array.isArray(r['negative-premises']) || r['negative-premises'].length === 0) {
        return bad(`${at}.negative-premises 必须是非空字符串数组`);
      }
      if (r['negative-premises'].some((x) => !nonEmptyString(x))) {
        return bad(`${at}.negative-premises 每项必须是非空字符串`);
      }
    }
    if (r.basis !== undefined && !nonEmptyString(r.basis)) {
      return bad(`${at}.basis 必须是非空字符串`);
    }
  }
  return good(value);
}

/**
 * 读既定裁决库(机制1)。读 <workspaceDir>/.dsh-library/rulings.json。
 * 缺失/坏 JSON/结构非法 → 返回 { rulings: [], error }(不炸调用方,product 可据此照常上报)。
 */
export async function readRulings(workspaceDir) {
  const file = join(workspaceDir, LIBRARY_DIRNAME, 'rulings.json');
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    return { rulings: [], error: `读取裁决库失败:${error?.code ?? error?.message ?? error}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { rulings: [], error: `裁决库不是合法 JSON:${file}` };
  }
  const checked = validateRulings(parsed);
  if (!checked.ok) return { rulings: [], error: `裁决库结构非法:${checked.error}` };
  return { rulings: checked.value.rulings };
}

/**
 * 命中判据(机制1 m1-r3;0.11.0 扩展 negative-premises):返回首个 category 相同、
 * premise 前提一致 且 negative-premises 全部不命中的裁决;否则 undefined。
 * 前提一致判定为宽松包含:把裁决前提按标点/空白切分为关键词(长度 ≥2),当前情形
 * 文本包含全部关键词即视为一致。negative-premises(否定面)同理:把每条否定前提按
 * 标点/空白切词,当前情形包含其全部关键词即视为「该否定前提成立」;任一否定前提成立
 * → 该裁决不命中(保守,宁多报不误吞)。返回的裁决对象经 `matchOf` 剥除辅助字段。
 */
function premiseKeywords(premise) {
  if (typeof premise !== 'string' || premise.length === 0) return [];
  return premise.split(/[/()，。；、\s]+/).filter((w) => w.length >= 2);
}

function premiseContains(premise, premiseText) {
  if (typeof premiseText !== 'string' || premiseText.length === 0) return false;
  const keywords = premiseKeywords(premiseText);
  if (keywords.length === 0) return premise.includes(premiseText);
  return keywords.every((k) => premise.includes(k));
}

export function matchRuling(rulings, { category, premise }) {
  if (!Array.isArray(rulings)) return undefined;
  if (typeof category !== 'string' || typeof premise !== 'string') return undefined;
  for (const ruling of rulings) {
    if (ruling?.category !== category) continue;
    if (typeof ruling?.premise !== 'string' || ruling.premise.length === 0) continue;
    // 前提一致才命中(否定面:任一否定前提成立即不命中)。
    if (!premiseContains(premise, ruling.premise)) continue;
    const negatives = Array.isArray(ruling['negative-premises']) ? ruling['negative-premises'] : [];
    if (negatives.some((np) => premiseContains(premise, np))) continue;
    return ruling;
  }
  return undefined;
}

// ── P4 记忆治理·消费路由优先(0.11.0,2026-09-02)─────────────────────────
// 四件事:①BLOCKER_CATEGORIES 开放(核心集 + .dsh-library/categories.json 扩展);
// ②lessons-index.json 消费路由索引(buildLessonsIndex / bumpLessonHits);
// ③validateCategories / validateLessonsIndex 校验扩展与索引形状。
// 数据文件均为 workspace 级(.dsh-library/),与 rulings.json 同层;纯函数、零 npm import。

/** workspace 级库目录名(LIBRARY_DIRNAME 已在上方声明 `.dsh-library`)。 */

/** 卡点分类扩展文件路径(<workspaceDir>/.dsh-library/categories.json)。 */
export function categoriesFilePath(workspaceDir) {
  return join(workspaceDir, LIBRARY_DIRNAME, 'categories.json');
}

/**
 * 校验卡点分类扩展(categories.json)。扩展允许两种形状:
 *   A. 顶层即数组(纯字符串数组,与核心集并列);
 *   B. 对象 { schemaVersion: 1, categories: [...] }(带版本锚,推荐)。
 * 要求:每项非空字符串;重复项告警(去重后合并)。返回 { ok, value: string[] } 或 { ok:false, error }。
 */
export function validateCategories(value) {
  let list;
  if (typeof value === 'string' && value.trim().length === 0) return bad('categories.json 不能是空字符串');
  if (Array.isArray(value)) {
    list = value;
  } else if (isPlainObject(value)) {
    if (value.schemaVersion !== undefined && value.schemaVersion !== 1) {
      return bad(`categories.json schemaVersion 仅支持 1,得到 ${JSON.stringify(value.schemaVersion)}`);
    }
    if (!Array.isArray(value.categories)) return bad('categories.json 对象形状须含 categories 数组');
    list = value.categories;
  } else {
    return bad('categories.json 须是字符串数组或 { schemaVersion, categories } 对象');
  }
  if (list.length === 0) return good([]);
  for (let i = 0; i < list.length; i++) {
    if (!nonEmptyString(list[i])) return bad(`categories.json 第 ${i} 项必须是非空字符串`);
  }
  const seen = new Set();
  const deduped = [];
  for (const item of list) {
    if (seen.has(item)) continue;
    seen.add(item);
    deduped.push(item);
  }
  return good(deduped);
}

/**
 * 解析卡点分类合并集 = 核心集(BLOCKER_CATEGORIES,6 类恒在) ∪ categories.json 扩展。
 * categories.json 缺失/坏 JSON/结构非法 → 回退核心集并给出 error(不炸调用方,与 readRulings 同款容错)。
 * 同名去重时扩展条目胜(核心 6 类恒在,不可被扩展移除)。返回 { categories, error? }。
 */
export async function resolveBlockerCategories(workspaceDir) {
  const core = [...BLOCKER_CATEGORIES];
  const file = categoriesFilePath(workspaceDir);
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    return { categories: core, error: `categories.json 读取失败(回退核心集):${error?.code ?? error?.message ?? error}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { categories: core, error: `categories.json 不是合法 JSON(回退核心集):${file}` };
  }
  const checked = validateCategories(parsed);
  if (!checked.ok) {
    return { categories: core, error: `categories.json 结构非法(回退核心集):${checked.error}` };
  }
  const merged = [...core];
  for (const ext of checked.value) {
    if (!merged.includes(ext)) merged.push(ext);
  }
  return { categories: merged };
}

/** 一篇 lesson 的元数据登记形状(lessons/ 与 patterns/ 通用)。 */
function validLessonKind(kind) {
  return kind === 'lesson' || kind === 'pattern';
}

/**
 * 校验一篇 lesson 元数据登记项。要求:id(kebab)/kind(lesson|pattern)/title/premises/
 * status 均非空字符串;origin 可选。返回 { ok, value } 或 { ok:false, error }。
 */
export function validateLessonEntry(entry) {
  if (!isPlainObject(entry)) return bad('lesson 条目必须是对象');
  for (const key of Object.keys(entry)) {
    if (!['id', 'kind', 'category', 'title', 'premises', 'status', 'origin', 'sourceFile', 'hits'].includes(key)) {
      return bad(`lesson 条目含未知键 "${key}"`);
    }
  }
  if (!nonEmptyString(entry.id) || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(entry.id)) {
    return bad(`lesson 条目 id 必须是 slug(字母/数字开头,只含字母/数字/连字符),得到 ${JSON.stringify(entry.id ?? null)}`);
  }
  if (!validLessonKind(entry.kind)) return bad(`lesson 条目 kind 必须是 lesson/pattern,得到 ${JSON.stringify(entry.kind ?? null)}`);
  if (entry.category !== undefined && !nonEmptyString(entry.category)) return bad('lesson 条目 category 若非空必为非空字符串');
  for (const key of ['title', 'premises', 'status']) {
    if (!nonEmptyString(entry[key])) return bad(`lesson 条目 ${key} 必填(非空字符串)`);
  }
  if (entry.origin !== undefined && !nonEmptyString(entry.origin)) return bad('lesson 条目 origin 若非空必为非空字符串');
  if (entry.sourceFile !== undefined && !nonEmptyString(entry.sourceFile)) return bad('lesson 条目 sourceFile 若非空必为非空字符串');
  return good(entry);
}

/**
 * 构建 lessons-index(纯函数)。输入为 lesson 元数据登记项数组(经 validateLessonEntry 校验者,
 * 未校验由调用方保证形状),输出:
 *   { schemaVersion: 1, categories: { <category>: [{ id, kind, title, premises, status, origin? , hits }] } }
 * 归 class 按 entry.category:每篇按 category 归类(缺省 'uncategorized');kind 不造成分叉
 * (lesson/pattern 统一归入 category 桶,与 DESIGN 疑问 1 定稿一致)。保留既有 hits:
 * existingIndex 里已有 id 的条目沿用其 hits;新增条目 hits=0。category 冲突时
 * (design 疑问 3 只适用于 categories.json,这里 category 即索引键)后写覆盖先写的去重。
 */
export function buildLessonsIndex(entries, existingIndex = null) {
  const categories = {};
  const existingHits = new Map();
  if (existingIndex !== null && typeof existingIndex === 'object') {
    const existingCats = existingIndex.categories;
    if (existingCats !== null && typeof existingCats === 'object') {
      for (const [_cat, list] of Object.entries(existingCats)) {
        if (!Array.isArray(list)) continue;
        for (const item of list) {
          if (item !== null && typeof item === 'object' && typeof item.id === 'string' && typeof item.hits === 'number') {
            existingHits.set(item.id, item.hits);
          }
        }
      }
    }
  }
  for (const entry of entries) {
    const item = {
      id: entry.id,
      kind: entry.kind,
      title: entry.title,
      premises: entry.premises,
      status: entry.status,
      ...(entry.origin !== undefined ? { origin: entry.origin } : {}),
      ...(entry.sourceFile !== undefined ? { sourceFile: entry.sourceFile } : {}),
      hits: existingHits.has(entry.id) ? existingHits.get(entry.id) : 0,
    };
    const category = typeof entry.category === 'string' && entry.category.trim().length > 0 ? entry.category : 'uncategorized';
    if (!Array.isArray(categories[category])) categories[category] = [];
    categories[category].push(item);
  }
  return { schemaVersion: 1, categories };
}

/**
 * 递增 lessons-index 命中篇目 hits(纯函数)。lessonRefs 为 id 数组,在索引中逐桶查找,
 * 命中则 hits+1;未命中篇目记入 misses。返回 { index, bumped, misses }:
 *   index:新增 hits 后的索引(对象引用不原地改,返回新扁平 categories);
 *   bumped: [{ id, hits }] 递增明细;
 *   misses: 未找到的 id 数组。
 */
export function bumpLessonHits(index, lessonRefs) {
  const refs = new Set(Array.isArray(lessonRefs) ? lessonRefs.filter((x) => typeof x === 'string' && x.length > 0) : []);
  const categories = {};
  const bumped = [];
  const misses = [];
  const cats = (index !== null && typeof index === 'object' && index.categories !== null && typeof index.categories === 'object') ? index.categories : {};
  for (const [category, list] of Object.entries(cats)) {
    if (!Array.isArray(list)) continue;
    categories[category] = list.map((item) => {
      if (!refs.has(item?.id)) return item;
      return { ...item, hits: (item?.hits ?? 0) + 1 };
    });
  }
  // 收集 bumped。
  for (const ref of refs) {
    let found = false;
    for (const list of Object.values(categories)) {
      const hit = list.find((item) => item?.id === ref);
      if (hit) { bumped.push({ id: ref, hits: hit.hits }); found = true; break; }
    }
    if (!found) misses.push(ref);
  }
  return { index: { schemaVersion: 1, categories }, bumped, misses };
}

/**
 * 校验 lessons-index 结构。要求:schemaVersion=1;categories 为对象;键为 category;
 * 每桶为非空对象数组,每项经 validateLessonEntry + hits 为非负整数。
 * 返回 { ok, value } 或 { ok:false, error }。
 */
export function validateLessonsIndex(value) {
  if (!isPlainObject(value)) return bad('lessons-index 必须是 JSON 对象');
  const allowed = new Set(['schemaVersion', 'categories']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return bad(`lessons-index 含未知键 "${key}"`);
  }
  if (value.schemaVersion !== 1) return bad(`lessons-index schemaVersion 仅支持 1,得到 ${JSON.stringify(value.schemaVersion)}`);
  if (!isPlainObject(value.categories)) return bad('lessons-index 缺 categories 对象');
  for (const [category, list] of Object.entries(value.categories)) {
    if (typeof category !== 'string' || category.length === 0) return bad('lessons-index category 键必须是非空字符串');
    if (!Array.isArray(list)) return bad(`category "${category}" 的篇目必须是非空数组`);
    if (list.length === 0) return bad(`category "${category}" 的篇目不能为空`);
    for (let i = 0; i < list.length; i++) {
      const checked = validateLessonEntry(list[i]);
      if (!checked.ok) return bad(`category "${category}" 第 ${i} 项:${checked.error}`);
      const hits = list[i].hits;
      if (typeof hits !== 'number' || !Number.isInteger(hits) || hits < 0) {
        return bad(`category "${category}" 第 ${i} 项 hits 必须是非负整数,得到 ${JSON.stringify(hits)}`);
      }
    }
  }
  return good(value);
}

// ── 机制2 失败模式聚合(2026-08-30 流程补丁)────────────────────────────────

/**
 * 扫 workspaceDir 下全部项目 REGISTRY(含 delivered/终态,不遗漏),收集其
 * blockers 历史(全部 status,含 resolved)。返回 [{ projectId, blocker }]。
 * 坏登记簿 / 缺 blockers 字段 / 非目录项跳过(不炸调用方)。
 * 聚合按默认登记簿布局(.dsh-project);自定义 registryDir 的项目不参与聚合。
 */
export async function collectAllBlockers(workspaceDir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(workspaceDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectId = entry.name;
    const file = join(workspaceDir, projectId, '.dsh-project', 'REGISTRY.json');
    let registry;
    try {
      registry = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      continue;
    }
    if (!Array.isArray(registry?.blockers)) continue;
    for (const blocker of registry.blockers) {
      if (blocker !== null && typeof blocker === 'object' && typeof blocker.id === 'string') {
        out.push({ projectId, blocker });
      }
    }
  }
  return out;
}

/**
 * 按 category 计数,过滤 count ≥ 2,每类取代表案例(前 1~2 个,含 projectId + blockerId
 * + reason 摘要)。返回 [{ category, count, cases }],按 count 降序。
 */
export function aggregateByCategory(blockers) {
  const byCategory = new Map();
  for (const { projectId, blocker } of blockers) {
    const category = typeof blocker.category === 'string' ? blocker.category : 'other';
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push({ projectId, blocker });
  }
  const out = [];
  for (const [category, items] of byCategory) {
    if (items.length < 2) continue;
    const cases = items.slice(0, 2).map(({ projectId, blocker }) => ({
      projectId,
      blockerId: blocker.id,
      reason: typeof blocker.reason === 'string' ? blocker.reason.slice(0, 80) : '',
    }));
    out.push({ category, count: items.length, cases });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

/** 机制项建议的启发式映射(category → 建议;未命中 → 人工研判)。 */
const FAILURE_MECHANISM_ADVICE = {
  'acceptance-capability': '视觉/真实观感类验收设为用户侧 blocking 门禁(既定裁决 r1)',
  'deploy-permission': '外部路径交付落 deliverables/ + APPLY.md,部署自检 IN SYNC(r2/r3)',
  'test-env': '真实上游/凭据类验证由用户侧 blocking 执行(既定裁决 r4)',
  'design-info': '需求澄清补信息',
  'dev-complexity': '分期/拆子任务',
  other: '人工研判',
};

/**
 * 生成四要素报告(类别 / 次数 / 代表案例 / 机制项建议)。
 * 输入 = aggregateByCategory 的输出。返回 [{ category, count, cases, advice }]。
 */
export function buildFailureReport(aggregation) {
  return aggregation.map((item) => ({
    category: item.category,
    count: item.count,
    cases: item.cases,
    advice: FAILURE_MECHANISM_ADVICE[item.category] ?? '人工研判',
  }));
}

// ── 真实 token 计量(预算账本改真实 token,2026-08-31)──────────────────────
// 数据源 = projcache 检查点文件($DSH_HOME/storages/session_projcache.json,
// unit.version=3)。有效计费口径 = uncachedInputTokens + outputTokens
// (cacheRead/cacheWrite 在 DeepSeek 路由下恒 0,主线程实测)。
// 零 npm import;读文件走 node:fs/promises;可单测(注入临时 projcache 文件)。

/**
 * 读 projcache 文件并守卫 unit.version(AC-M3)。
 * version===3 → 按已知结构解析;缺失或 ≠3 → 明确中文报错,不误解析。
 * 返回 { data, mtime }(mtime 为文件修改时间 ISO 串,供复核;读不到 → null)。
 */
export async function readProjcache(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    throw new Error(`读取 projcache 失败:${error?.code ?? error?.message ?? error}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`projcache 不是合法 JSON:${file}`);
  }
  if (parsed === null || typeof parsed !== 'object' || parsed.unit?.version !== 3) {
    throw new Error(`projcache 版本不支持(unit.version=${JSON.stringify(parsed?.unit?.version)},仅支持 3),不误解析:${file}`);
  }
  let mtime = null;
  try {
    const st = await stat(file);
    mtime = st.mtime.toISOString();
  } catch {
    mtime = null;
  }
  return { data: parsed, mtime };
}

/**
 * 取单会话 tokenUsage(有效计费口径 = uncachedInputTokens + outputTokens)。
 * 会话不在表内 / 结构缺失 → null。返回 { uncachedInputTokens, outputTokens,
 * cacheReadTokens, cacheWriteTokens }。
 */
export function sessionTokenUsage(projcache, sessionId) {
  if (projcache === null || typeof projcache !== 'object') return null;
  const totals = projcache?.tables?.sessions?.[sessionId]?.rows?.tokenUsage?.val?.totals;
  if (totals === null || typeof totals !== 'object') return null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    uncachedInputTokens: num(totals.uncachedInputTokens),
    outputTokens: num(totals.outputTokens),
    cacheReadTokens: num(totals.cacheReadTokens),
    cacheWriteTokens: num(totals.cacheWriteTokens),
  };
}

/**
 * 按 REGISTRY.sessions 的角色桶聚合 tokenUsage。
 * sessions = { [sessionId]: { role } };projcache = readProjcache 的 data。
 * 返回 { [role]: { tokens, uncachedInputTokens, outputTokens, cacheReadTokens,
 *   cacheWriteTokens, sessionCount, model, provider } }(cost-v2 扩展:桶含 cacheRead/
 *   cacheWrite 与 model 溯源透传位)。
 * 会话不在 projcache 表内 → 跳过(不计数)。
 * model 溯源(modelProvenance):{ [sessionId]: { model, provider } },来自被移除的
 *   A 路 runtime-events 条目 carry-forward。桶内 model 去重(保序)后:无溯源 → 'unknown';
 *   单标 → 原样;多标 → 'A/B' 连接。provider 随 model(多标时以 '/' 连无值则 null)。
 */
export function aggregateByRole(sessions, projcache, modelProvenance = null) {
  const out = {};
  if (sessions === null || typeof sessions !== 'object') return out;
  // 归一化 modelProvenance(容忍两种形状:直接 { sid -> {model,provider} } 或包 bySession)。
  const prov = {};
  if (modelProvenance !== null && typeof modelProvenance === 'object') {
    const src = modelProvenance.bySession ?? modelProvenance;
    for (const [sid, p] of Object.entries(src)) {
      if (typeof p?.model === 'string' && p.model.length > 0) prov[sid] = { model: p.model, provider: typeof p.provider === 'string' ? p.provider : null };
    }
  }
  for (const [sessionId, meta] of Object.entries(sessions)) {
    const role = meta?.role;
    if (typeof role !== 'string' || role.length === 0) continue;
    const usage = sessionTokenUsage(projcache, sessionId);
    if (usage === null) continue;
    const bucket = out[role] ?? (out[role] = {
      tokens: 0, uncachedInputTokens: 0, outputTokens: 0,
      cacheReadTokens: 0, cacheWriteTokens: 0, sessionCount: 0,
      _models: [],
    });
    bucket.tokens += usage.uncachedInputTokens + usage.outputTokens;
    bucket.uncachedInputTokens += usage.uncachedInputTokens;
    bucket.outputTokens += usage.outputTokens;
    bucket.cacheReadTokens += usage.cacheReadTokens;
    bucket.cacheWriteTokens += usage.cacheWriteTokens;
    bucket.sessionCount += 1;
    const p = prov[sessionId];
    if (p) bucket._models.push(p);
  }
  for (const bucket of Object.values(out)) {
    const seen = new Map();
    for (const p of bucket._models) if (!seen.has(p.model)) seen.set(p.model, p.provider);
    if (seen.size === 0) {
      bucket.model = 'unknown';
      bucket.provider = null;
    } else if (seen.size === 1) {
      const [[m, pr]] = [...seen.entries()];
      bucket.model = m;
      bucket.provider = pr ?? null;
    } else {
      bucket.model = [...seen.keys()].join('/');
      bucket.provider = [...seen.values()].filter(Boolean).join('/') || null;
    }
    delete bucket._models;
  }
  return out;
}

// ── 统一 token 口径与模型来源(cost-v2,2026-09-02)─────────────────────────
// D2:totalToken = uncachedInputTokens + cacheReadTokens + outputTokens(纯函数,单一权威);
//     cacheRate = cacheRead/(cacheRead+uncachedInput),cacheRead<=0/分母0 → 0。
// D4:normalizeUsage 读任意旧/新形状 committed usage → 规范化六桶(legacy tokens+
//     四桶+sessionCount)+ model(+provider);model 缺省显式 'unknown'(非静默、非报错)。
// 全部只增不改、零 npm import;消费方统一走这些纯函数,不硬编码第二套口径(AC-R1)。

/** non-number 且非有限数 → 0(兼容读,不炸)。 */
function finiteNum(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * 权威总 token(totalToken):uncachedInputTokens + cacheReadTokens + outputTokens。
 * non-number → 0;不含 cacheWriteTokens(写缓存不构成当前会话消耗)。所有消费方只用本函数。
 */
export function totalToken(usage) {
  if (usage === null || typeof usage !== 'object') return 0;
  return finiteNum(usage.uncachedInputTokens) + finiteNum(usage.cacheReadTokens) + finiteNum(usage.outputTokens);
}

/**
 * 缓存率:cacheRead / (cacheRead + uncachedInput),分子分母同源(与 totalToken 自洽)。
 * cacheRead <= 0 或分母为 0 → 返回 0(当前实例 cacheRead=0,故恒 0,语义正确而非低估)。
 */
export function cacheRate(usage) {
  if (usage === null || typeof usage !== 'object') return 0;
  const cacheRead = finiteNum(usage.cacheReadTokens);
  if (cacheRead <= 0) return 0;
  const uncachedInput = finiteNum(usage.uncachedInputTokens);
  if (cacheRead + uncachedInput === 0) return 0;
  return cacheRead / (cacheRead + uncachedInput);
}

/**
 * model 哨兵(标签):undefined/null/'' → 'unknown';有值 → 原样。provider 暂作签名预留
 * (随 model 一起标注,供将来 provider/model 复合标签扩展,不改变本函数返回值)。
 */
export function modelLabel(model, provider) {
  return typeof model === 'string' && model.length > 0 ? model : 'unknown';
}

/**
 * 归一化任意旧/新形状 committed usage(D4 兼容读,只增不改不迁移):
 * 新形状(四桶+model/provider)原样;旧形状(tokens/uncachedInput/output,无 cacheRead/
 * cacheWrite/model)按 0/null/'unknown' 兼容;非对象按全 0 + 'unknown' 兜底。
 * 返回 { tokens, uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
 *        sessionCount, sessionId?, model, provider }。
 * legacy tokens 仅 read 兼容:存量有则原样(0.8.0 计费口径),无则按 uncachedInput+output。
 */
export function normalizeUsage(usage) {
  if (usage === null || typeof usage !== 'object') {
    return {
      tokens: 0, uncachedInputTokens: 0, outputTokens: 0,
      cacheReadTokens: 0, cacheWriteTokens: 0, sessionCount: 0,
      model: 'unknown', provider: null,
    };
  }
  const uncachedInput = finiteNum(usage.uncachedInputTokens);
  const output = finiteNum(usage.outputTokens);
  const legacyTokens = finiteNum(usage.tokens);
  const tokens = typeof usage.tokens === 'number' && Number.isFinite(usage.tokens)
    ? usage.tokens
    : uncachedInput + output;
  const out = {
    tokens,
    uncachedInputTokens: uncachedInput,
    outputTokens: output,
    cacheReadTokens: finiteNum(usage.cacheReadTokens),
    cacheWriteTokens: finiteNum(usage.cacheWriteTokens),
    sessionCount: finiteNum(usage.sessionCount),
    model: modelLabel(usage.model, usage.provider),
    provider: typeof usage.provider === 'string' && usage.provider.length > 0 ? usage.provider : null,
  };
  if (typeof usage.sessionId === 'string' && usage.sessionId.length > 0) out.sessionId = usage.sessionId;
  return out;
}

/**
 * 按 model 分组聚合(byModel)。committed 为 committed 条目数组;逐条 normalizeUsage(entry.usage)
 * 取 model 归类;缺/未知 model → 'unknown' 桶。返回 { <model>: { totalToken, tokens,
 * uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, entries } }。
 */
export function aggregateByModel(committed) {
  const out = {};
  const list = Array.isArray(committed) ? committed : [];
  for (const entry of list) {
    const usage = normalizeUsage(entry?.usage);
    const bucket = out[usage.model] ?? (out[usage.model] = {
      totalToken: 0, tokens: 0, uncachedInputTokens: 0, outputTokens: 0,
      cacheReadTokens: 0, cacheWriteTokens: 0, entries: 0,
    });
    bucket.totalToken += totalToken(usage);
    bucket.tokens += usage.tokens;
    bucket.uncachedInputTokens += usage.uncachedInputTokens;
    bucket.outputTokens += usage.outputTokens;
    bucket.cacheReadTokens += usage.cacheReadTokens;
    bucket.cacheWriteTokens += usage.cacheWriteTokens;
    bucket.entries += 1;
  }
  return out;
}

// ── 自省审计回路(kr-self-audit,2026-09-03)──────────────────────────────────
// 观察 → 规则表判定 → 三档分流(F2 register / F1 呈递 / F3 直改),全部纯函数,
// 只增不改、零 npm import。语义权威:plugindev/project-pipeline/SELF-OPTIMIZATION-FORM.md。
// 领地白名单是硬边界,引擎侧校验;规则表本身不能把 F4/F1 客体(flow/角色提示词)升权(AC1 锁定)。

/** 分流动作档位(规则表合法 act;F4 永久禁区,不属于任何级别)。 */
export const AUDIT_ACTIONS = ['F1', 'F2', 'F3'];

/** F1 客体(永不 F2 升权):flow 模板 / 角色提示词 / preset 源码 / host-plugin / 生产配置。AC1 锁定。 */
export const F1_OBJECTS = new Set(['flow', 'role-prompt', 'preset-source', 'host-plugin', 'prod-config']);

/** F4 永久禁区客体(任何规则都不可指向):preset 源码 / host-plugin / 生产配置不经人即改。 */
export const F4_OBJECTS = new Set(['preset-source', 'host-plugin', 'prod-config']);

/** watcher 日志文件名(DEFAULT_LOG 单一事实源,观察 O1 经 plugindevRoot 推导候选)。 */
export const DEFAULT_WATCH_LOG = 'pipeline-watch.log';

/** audit-rules 默认 meta(规则表缺 meta 段时回退)。0.18.0 增 sedimentation(批量沉淀开关+阈值)。 */
export const DEFAULT_AUDIT_META = {
  metaRuleChangeCooldownDays: 30,
  maxAutoProjectsPerAudit: 2,
  lastMetaActionAt: null,
  sedimentation: { enabled: true, everyNDelivered: 10 },
};

/** 观察原语集合(规则表 observe 合法取值)。 */
export const AUDIT_OBSERVES = ['O1', 'O2', 'O3', 'O4', 'O5', 'O6'];

/** 领地从路径前缀标记派生;真实判断经 auditTerritoryWhitelist + territoryInWhitelist。 */
const TERRITORY_WHITELIST_BASE = ['pipeline-ws', '.dsh-base', '.dsh-library', 'toolkit', 'docs'];

/** 瞬时半写读容错默认参数(tries / delayMs)。 */
const RETRY_DEFAULTS = { tries: 3, delayMs: 5 };

/** 延迟小件(容错重试用)。 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 瞬时半写读容错(registry-halfwrite-read-tolerance):读 JSON 失败(半写/并发写)重试。
 * 重试仍失败才 throw(调用方 catch 后按非致命跳过)。只读文件,不写。
 */
export async function readJsonRetry(file, options = {}) {
  const tries = Number.isInteger(options.tries) && options.tries > 0 ? options.tries : RETRY_DEFAULTS.tries;
  const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : RETRY_DEFAULTS.delayMs;
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await readJson(file);
    } catch (error) {
      lastErr = error;
      if (attempt < tries) await sleep(delayMs);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`读取 ${file} 失败(重试 ${tries} 次)`);
}

/** audit-trail 路径(<workspace>/.dsh-library/audit-trail.json,append-only)。 */
export function auditTrailPath(workspaceDir) {
  return join(workspaceDir, LIBRARY_DIRNAME, 'audit-trail.json');
}

/** 读 audit-trail(append-only 数组);缺失/坏 JSON → [] + error(不炸调用方)。 */
export async function readAuditTrail(workspaceDir) {
  let text;
  try {
    text = await readFile(auditTrailPath(workspaceDir), 'utf8');
  } catch {
    return { trail: [], error: 'audit-trail.json 不存在(尚无审计留痕)' };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { trail: [], error: `audit-trail.json 不是合法 JSON:${auditTrailPath(workspaceDir)}` };
  }
  if (!Array.isArray(parsed)) return { trail: [], error: 'audit-trail.json 须是数组' };
  return { trail: parsed };
}

// ── 审计执行凭证(kr-audit-voucher,0.18.1,2026-09-05)────────────────────────
// project_audit(action=run) 执行后自动写一条 audit-run-voucher 凭证到 audit-trail
// (append-only,不替换既有动作条目语义)。0 actions 也写凭证——「跑了但无事发生」与
// 「没跑」可区分。returnHash 用 node 内置 crypto(SHA-256)对工具返回体做摘要,零新依赖;
// 序列化口径=canonicalStringify(递归排序对象键),保证同返回体重放哈希一致(AC2)。

/** 稳定序列化(AC2):递归排序对象键,保证同值同串。undefined → 'null'(与 JSON 数组/对象一致)。 */
export function canonicalStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 十六进制摘要(node 内置 crypto,零新依赖)。 */
export function sha256Hex(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

/** 工具返回体 SHA-256 摘要(AC2):序列化口径=canonicalStringify,同返回体重放哈希一致。 */
export function returnHashOf(returnBody) {
  return sha256Hex(canonicalStringify(returnBody));
}

/** audit-rules 路径(<workspace>/.dsh-library/audit-rules.json)。 */
export function auditRulesPath(workspaceDir) {
  return join(workspaceDir, LIBRARY_DIRNAME, 'audit-rules.json');
}

/** 读 audit-rules;缺失/坏 JSON → { rules: [], meta: DEFAULT_AUDIT_META, error }(不炸调用方)。 */
export async function readAuditRules(workspaceDir) {
  let text;
  try {
    text = await readFile(auditRulesPath(workspaceDir), 'utf8');
  } catch (error) {
    return { rules: [], meta: { ...DEFAULT_AUDIT_META }, error: `audit-rules.json 读取失败:${error?.code ?? error?.message ?? error}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { rules: [], meta: { ...DEFAULT_AUDIT_META }, error: `audit-rules.json 不是合法 JSON:${auditRulesPath(workspaceDir)}` };
  }
  const checked = validateAuditRules(parsed);
  if (!checked.ok) return { rules: [], meta: { ...DEFAULT_AUDIT_META }, error: `audit-rules.json 结构非法:${checked.error}` };
  return { rules: checked.value.rules, meta: checked.value.meta };
}

/** 规则条目允许键;未知键 → 校验失败。 */
const AUDIT_RULE_ALLOWED_KEYS = new Set(['id', 'name', 'observe', 'when', 'act', 'object', 'dedupe', 'territory', 'meta', 'recommendation']);

/** `when` 谓词允许的操作符后缀(见 whenMatches)。 */
const WHEN_SUFFIX_RE = /^(.*)(Gte|Gt|Lte|Lt|Eq|Ne|Contains)$/;

/**
 * 校验分流规则表(纯函数)。value 形状:
 *   { schemaVersion:1, meta?:{ metaRuleChangeCooldownDays, maxAutoProjectsPerAudit, lastMetaActionAt },
 *     rules:[ { id, name?, observe, when, act, object, dedupe?, territory?, meta? } ] }
 * 要求:meta 可选(缺省回退 DEFAULT_AUDIT_META);rules 为非空数组;每条 id 唯一且 slug、
 * observe∈O1~O6、when 非空对象、act∈F1/F2/F3(F4 拒绝)、object 非空、dedupe∈by-category/by-target
 * (缺省 by-target)、territory 非空(领地白名单硬校验在引擎侧,此处只校验存在;F4 客体/升权 F2
 * 由 auditRuleEngine 拒绝)。返回 { ok, value } 或 { ok:false, error }。
 */
export function validateAuditRules(value) {
  if (!isPlainObject(value)) return bad('audit-rules 必须是 JSON 对象');
  const allowed = new Set(['schemaVersion', 'meta', 'rules']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return bad(`audit-rules 含未知键 "${key}"`);
  }
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) {
    return bad(`不支持的 schemaVersion(仅支持 1),得到 ${JSON.stringify(value.schemaVersion)}`);
  }
  const meta = value.meta ?? { ...DEFAULT_AUDIT_META };
  if (!isPlainObject(meta)) return bad('audit-rules.meta 必须是对象');
  if (meta.metaRuleChangeCooldownDays !== undefined && (!Number.isSafeInteger(meta.metaRuleChangeCooldownDays) || meta.metaRuleChangeCooldownDays < 0)) {
    return bad('meta.metaRuleChangeCooldownDays 必须是非负整数');
  }
  if (meta.maxAutoProjectsPerAudit !== undefined && (!Number.isSafeInteger(meta.maxAutoProjectsPerAudit) || meta.maxAutoProjectsPerAudit < 0)) {
    return bad('meta.maxAutoProjectsPerAudit 必须是非负整数');
  }
  if (meta.lastMetaActionAt !== undefined && meta.lastMetaActionAt !== null && !nonEmptyString(meta.lastMetaActionAt)) {
    return bad('meta.lastMetaActionAt 必须是 ISO 时间戳字符串或 null');
  }
  if (meta.sedimentation !== undefined) {
    const s = meta.sedimentation;
    if (!isPlainObject(s)) return bad('meta.sedimentation 必须是对象');
    if (s.enabled !== undefined && typeof s.enabled !== 'boolean') return bad('meta.sedimentation.enabled 必须是布尔值');
    if (s.everyNDelivered !== undefined && (!Number.isSafeInteger(s.everyNDelivered) || s.everyNDelivered < 1)) {
      return bad('meta.sedimentation.everyNDelivered 必须是正整数(批量沉淀阈值 N)');
    }
  }
  if (!Array.isArray(value.rules) || value.rules.length === 0) return bad('audit-rules.rules 必须是非空数组');
  const seen = new Set();
  for (let i = 0; i < value.rules.length; i++) {
    const r = value.rules[i];
    const at = `rules[${i}]`;
    if (!isPlainObject(r)) return bad(`${at} 必须是对象`);
    for (const key of Object.keys(r)) {
      if (!AUDIT_RULE_ALLOWED_KEYS.has(key)) return bad(`${at} 含未知键 "${key}"`);
    }
    if (!nonEmptyString(r.id) || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(r.id)) {
      return bad(`${at}.id 必须是 slug(字母/数字开头,只含字母/数字/连字符),得到 ${JSON.stringify(r.id ?? null)}`);
    }
    if (seen.has(r.id)) return bad(`${at}.id 重复:${r.id}`);
    seen.add(r.id);
    if (r.name !== undefined && !nonEmptyString(r.name)) return bad(`${at}.name 若非空必为非空字符串`);
    if (!AUDIT_OBSERVES.includes(r.observe)) {
      return bad(`${at}.observe 必须是 ${AUDIT_OBSERVES.join('/')} 之一,得到 ${JSON.stringify(r.observe ?? null)}`);
    }
    if (!isPlainObject(r.when) || Object.keys(r.when).length === 0) return bad(`${at}.when 必须是非空对象(判定谓词)`);
    if (!AUDIT_ACTIONS.includes(r.act)) {
      // 领地硬校验第一道:act 非法(含 F4)即拒绝(AC1)。
      return bad(`${at}.act 必须是 ${AUDIT_ACTIONS.join('/')} 之一(F4/升权 F4 永久禁区),得到 ${JSON.stringify(r.act ?? null)}`);
    }
    if (!nonEmptyString(r.object)) return bad(`${at}.object 必须是非空字符串(动作客体)`);
    if (r.dedupe !== undefined && !nonEmptyString(r.dedupe)) {
      return bad(`${at}.dedupe 若非空必为非空字符串(引擎实现 by-category/by-target,其余为自定义策略 no-op)`);
    }
    if (r.territory !== undefined && !nonEmptyString(r.territory)) return bad(`${at}.territory 若非空必为非空字符串`);
    if (r.meta !== undefined && typeof r.meta !== 'boolean') return bad(`${at}.meta 必须是布尔值`);
    if (r.recommendation !== undefined && !nonEmptyString(r.recommendation)) return bad(`${at}.recommendation 若非空必为非空字符串`);
  }
  return good({ schemaVersion: 1, meta, rules: value.rules });
}

/** 规则 when 谓词对 finding.value 求值(纯函数;支持 Gte/Gt/Lte/Lt/Eq/Ne/Contains)。 */
export function whenMatches(when, value) {
  if (!isPlainObject(when) || value === null || typeof value !== 'object') return false;
  for (const [cond, threshold] of Object.entries(when)) {
    const m = WHEN_SUFFIX_RE.exec(cond);
    if (!m) continue; // 未知谓词键跳过(不炸)
    const key = m[1];
    const op = m[2];
    const found = value[key];
    if (op === 'Contains') {
      if (!Array.isArray(found) || !found.includes(threshold)) return false;
      continue;
    }
    if (typeof found !== 'number' || typeof threshold !== 'number') return false;
    switch (op) {
      case 'Gte': if (found < threshold) return false; break;
      case 'Gt': if (found <= threshold) return false; break;
      case 'Lte': if (found > threshold) return false; break;
      case 'Lt': if (found >= threshold) return false; break;
      case 'Eq': if (found !== threshold) return false; break;
      case 'Ne': if (found === threshold) return false; break;
      default: return false;
    }
  }
  return true;
}

/**
 * 领地白名单常量(硬边界)。返回允许的领土前缀标记数组:
 *   pipeline-ws/(含 .dsh-base/.dsh-library)+ plugindev/toolkit/ + 文档。
 * 仅作规则表 territory 前缀的显式锚;引擎侧配合 territoryInWhitelist 做路径级校验。
 */
export function auditTerritoryWhitelist() {
  return [...TERRITORY_WHITELIST_BASE];
}

/**
 * territory 是否在领地白名单内(前缀匹配,大小写不敏感;分隔符 / 与 \ 归一)。
 * 命中白名单任一前缀 → true。用于 F2 动作的领土硬校验;领地外一律降级 F1。
 */
export function territoryInWhitelist(territory) {
  if (typeof territory !== 'string' || territory.length === 0) return false;
  const norm = territory.replace(/\\/g, '/').toLowerCase().replace(/^\.\//, '');
  const parts = norm.split('/');
  // 领地命中 = 路径组件含任一白名单目录(pipeline-ws/.dsh-base/.dsh-library/toolkit/docs)。
  return auditTerritoryWhitelist().some(
    (item) => parts.includes(item) || norm === item || norm.startsWith(`${item}/`) || norm.endsWith(`/${item}`),
  );
}

/**
 * 规则表分流引擎(纯函数)。领地白名单硬校验(AC1):
 *   - 规则表含 act:'F4' → validateAuditRules 已拒绝;此处兜底再查 object ∈ F4_OBJECTS 且 act!=F1 → throw;
 *   - 对 F1 客体(flow/角色提示词)升权 F2 → throw(AC1 锁定);
 *   - F2 动作 territory 不在领地白名单 → 降级为 F1(标注 downgraded:true),不抛。
 * 输入:findings(发现清单,每项含 id/observe/value/category/title/summary/evidence)、
 * rules(经 validateAuditRules 校验的 rules 数组)。
 * 返回 { actions, downgrades }(actions = 匹配到的分流动作,已按当值谓词过滤)。
 */
export function auditRuleEngine(findings, rules) {
  if (!Array.isArray(findings)) throw new Error('auditRuleEngine: findings 必须是数组');
  if (!Array.isArray(rules)) throw new Error('auditRuleEngine: rules 必须是数组');
  const actions = [];
  const downgrades = [];
  for (const rule of rules) {
    const checked = validateAuditRules({ schemaVersion: 1, rules: [rule] });
    if (!checked.ok) throw new Error(`auditRuleEngine: 规则 ${rule?.id} 校验失败:${checked.error}`);
    // AC1:对 F1 客体(flow/角色提示词)升权 F2 → 拒绝报错(硬边界,不由降级绕过)。
    if (rule.act === 'F2' && F1_OBJECTS.has(rule.object)) {
      throw new Error(`auditRuleEngine: 规则 ${rule.id} 尝试把 F1 客体 "${rule.object}"(flow/角色提示词等)升权 F2 —— 领地硬边界,拒绝(AC1)`);
    }
    // AC1:F4 客体(F4_OBJECTS)经非 F1 通道改生产源码 → 拒绝报错(永久禁区)。
    if (rule.act !== 'F1' && F4_OBJECTS.has(rule.object)) {
      throw new Error(`auditRuleEngine: 规则 ${rule.id} 试图以 act=${rule.act} 触及永久禁区客体 "${rule.object}"(F4 改生产源码不经人)——拒绝(AC1)`);
    }
    for (const finding of findings) {
      if (finding?.observe !== rule.observe) continue;
      if (!whenMatches(rule.when, finding?.value)) continue;
      const base = {
        ruleId: rule.id,
        ruleName: rule.name ?? rule.id,
        observe: rule.observe,
        act: rule.act,
        object: rule.object,
        dedupe: rule.dedupe ?? 'by-target',
        territory: rule.territory ?? '',
        meta: rule.meta === true,
        recommendation: rule.recommendation ?? '',
        findingId: finding.id,
        category: finding.category ?? 'other',
        dedupeKeys: [finding.category, finding?.value?.category].filter((x) => typeof x === 'string' && x.length > 0),
        title: finding.title ?? rule.name ?? rule.id,
        summary: finding.summary ?? '',
        evidence: Array.isArray(finding.evidence) ? finding.evidence : [],
      };
      // 领地白名单:仅对 F2(直改/立项落盘)做领土校验;领地外降级 F1(不抛)。
      if (rule.act === 'F2' && base.territory !== '' && !territoryInWhitelist(base.territory)) {
        base.act = 'F1';
        base.downgraded = true;
        base.downgradeReason = `territory "${base.territory}" 不在领地白名单,降级 F1 呈递(领地外一律不自主立项)`;
        downgrades.push({ ruleId: rule.id, findingId: finding.id, territory: base.territory });
      }
      actions.push(base);
    }
  }
  return { actions, downgrades };
}

/**
 * 去重(auditDedupe):by-category 同 category 已有在跑项目/未解决审计产出 → 不重复;
 * by-target 同 target 不重复。输入:
 *   actions(引擎分流动作)、activeProjects([{ id, title, category? }] 在跑项目清单)、
 *   trail(既有 audit-trail 条目数组,未解决即 status!=='resolved')。
 * 返回 { kept, dropped:[{action,reason}] }。
 */
export function auditDedupe(actions, activeProjects, trail) {
  const kept = [];
  const dropped = [];
  const activeList = Array.isArray(activeProjects) ? activeProjects : [];
  const trailList = Array.isArray(trail) ? trail : [];
  const unresolved = trailList.filter((e) => e?.status !== 'resolved');
  const activeText = activeList
    .filter((p) => p !== null && typeof p === 'object')
    .map((p) => `${p.title ?? ''} ${p.id ?? ''} ${p.category ?? ''}`.toLowerCase());
  for (const action of actions) {
    let reason = null;
    if (action.dedupe === 'by-category') {
      // 语义 category 取 dedupeKeys(含 finding.category 与 value.category,如 O4 的 lesson 分类)。
      const keys = Array.isArray(action.dedupeKeys) && action.dedupeKeys.length > 0
        ? action.dedupeKeys
        : [action.category];
      const lowerKeys = keys.map((k) => String(k).toLowerCase());
      const catHit = activeText.some((t) => lowerKeys.some((k) => k.length > 0 && t.includes(k)));
      const trailHit = unresolved.some((e) => lowerKeys.includes(String(e.category ?? '').toLowerCase()));
      if (catHit || trailHit) {
        reason = `by-category: category "${action.category}" 已有在跑项目或未解决审计产出`;
      }
    } else if (action.dedupe === 'by-target') {
      const tgt = String(action.target ?? action.object ?? action.territory ?? '').toLowerCase();
      if (tgt.length > 0
        && (activeText.some((t) => t.includes(tgt))
          || unresolved.some((e) => [String(e.target ?? ''), String(e.object ?? ''), String(e.territory ?? '')]
            .map((x) => x.toLowerCase()).includes(tgt)))) {
        reason = `by-target: target "${tgt}" 已有在跑项目或未解决审计产出`;
      }
    }
    if (reason) dropped.push({ action, reason });
    else kept.push(action);
  }
  return { kept, dropped };
}

/**
 * 限频(auditRateLimit):单次审计 F2 上限(maxAutoProjectsPerAudit,默认 2,超额截断);
 * 每次审计至多一条 meta 类动作;meta 冷却期(metaRuleChangeCooldownDays)内 meta 类动作不执行。
 * 输入 actions + meta(经 validateAuditRules 的 meta)。返回 { kept, dropped:[{action,reason}] }。
 */
export function auditRateLimit(actions, meta) {
  const m = { ...DEFAULT_AUDIT_META, ...(meta ?? {}) };
  const maxF2 = Number.isSafeInteger(m.maxAutoProjectsPerAudit) ? m.maxAutoProjectsPerAudit : 2;
  const cooldownDays = Number.isSafeInteger(m.metaRuleChangeCooldownDays) ? m.metaRuleChangeCooldownDays : 30;
  const kept = [];
  const dropped = [];
  let f2Count = 0;
  let metaSeen = 0;
  const now = Date.now();
  for (const action of actions) {
    if (action.meta === true) {
      // meta 冷却期:自 lastMetaActionAt 起 cooldownDays 内,不再执行 meta 类动作(防自指风暴)。
      if (metaSeen >= 1 || (m.lastMetaActionAt ? (now - new Date(m.lastMetaActionAt).getTime()) < cooldownDays * 86400000 : false)) {
        dropped.push({ action, reason: `meta 冷却期(≥${cooldownDays} 天)内不执行 meta 类动作,且每次审计至多一条` });
        continue;
      }
      metaSeen += 1;
    }
    if (action.act === 'F2') {
      if (f2Count >= maxF2) {
        dropped.push({ action, reason: `单次审计 F2 上限 ${maxF2} 个,超额截断` });
        continue;
      }
      f2Count += 1;
    }
    kept.push(action);
  }
  return { kept, dropped };
}

/** 证据链可回放格式(供 F2 reason 嵌入):把 evidence 列表压成一行 `file#ref; file#ref; ...`。 */
export function evidenceChain(evidence) {
  if (!Array.isArray(evidence)) return '';
  return evidence
    .map((e) => `${e?.file ?? ''}${e?.ref ? `#${e.ref}` : ''}`)
    .filter((x) => x.length > 0)
    .join('; ');
}

/**
 * F2 立项 payload(纯函数):register 单据形状。title 前缀「自省立项」、reason 带 evidence 链、
 * auto:true。供 project_audit 分流执行调 project_register(不走人,表单据本身可审计)。
 */
export function buildF2Payload(finding, rule, extra = {}) {
  const f = finding ?? {};
  const r = rule ?? {};
  return {
    title: `自省立项: ${f.title ?? r.name ?? r.id ?? '自省优化'}`,
    reason: `[自省审计回路] ${f.summary ?? ''} 证据链:${evidenceChain(f.evidence)} (ruleId=${r.id ?? ''}, findingId=${f.id ?? ''})`,
    auto: true,
    ruleId: r.id ?? null,
    findingId: f.id ?? null,
    category: f.category ?? 'other',
    territory: r.territory ?? '',
    ...extra,
  };
}

/**
 * F1 呈递 payload(纯函数):审计报告(发现 + evidence + 建议),供 intake 门禁包/结算同通道。
 */
export function buildF1Payload(finding, rule) {
  const f = finding ?? {};
  const r = rule ?? {};
  return {
    act: 'F1',
    ruleId: r.id ?? null,
    findingId: f.id ?? null,
    category: f.category ?? 'other',
    title: f.title ?? r.name ?? r.id ?? '',
    summary: f.summary ?? '',
    evidence: Array.isArray(f.evidence) ? f.evidence : [],
    recommendation: r.recommendation ?? '',
    report: [
      `【自省审计 · 呈递】${f.title ?? ''}`,
      `依据规则 ${r.id ?? ''}(observe=${r.observe ?? ''}, act 建议=F1)`,
      `发现:${f.summary ?? ''}`,
      `证据:${evidenceChain(f.evidence) || '(无具体证据)'}`,
      r.recommendation ? `建议:${r.recommendation}` : '',
    ].filter(Boolean).join('\n'),
  };
}

/**
 * F3 直改 payload(纯函数):数据资产直改动作 + trace 留痕(before/after/evidence)。
 * 只产形状;真实直改由 project_audit 执行并写 audit-trail.json。
 */
export function buildF3Payload(finding, rule, { object, before, after, result } = {}) {
  const f = finding ?? {};
  const r = rule ?? {};
  return {
    act: 'F3',
    ruleId: r.id ?? null,
    findingId: f.id ?? null,
    category: f.category ?? 'other',
    object: object ?? r.object ?? '',
    before: before ?? null,
    after: after ?? null,
    result: result ?? null,
    evidence: Array.isArray(f.evidence) ? f.evidence : [],
    trace: {
      id: `${r.id ?? 'F3'}-${f.id ?? 'finding'}-${nowStamp()}`,
      ts: new Date().toISOString(),
      action: 'F3',
      object: object ?? r.object ?? '',
      before,
      after,
      evidence: Array.isArray(f.evidence) ? f.evidence : [],
      ruleId: r.id ?? null,
      result: result ?? null,
    },
  };
}

/** F3 直改目标路径解析(纯函数):默认 .dsh-library/<object>;含分隔 → 相对 workspace;拒绝 .. 与越界。 */
export function resolveF3Target(workspaceDir, object, territory) {
  if (!nonEmptyString(object)) return resolve(workspaceDir, '.dsh-library', 'remediations.json');
  let rel = object.trim().replace(/\\/g, '/');
  if (rel.startsWith('pipeline-ws/')) rel = rel.slice('pipeline-ws/'.length);
  if (rel.startsWith('./')) rel = rel.slice(2);
  if (rel.split('/').includes('..') || rel.includes('..')) {
    throw new Error(`F3 直改目标含 ".." 路径段,拒绝:${object}`);
  }
  const base = resolve(workspaceDir);
  if (rel.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(rel)) {
    const target = resolve(rel);
    if (!String(target).startsWith(base)) throw new Error(`F3 直改目标超出 workspace 根:${object}`);
    return target;
  }
  if (rel.includes('/')) {
    const target = resolve(workspaceDir, rel);
    if (!String(target).startsWith(base)) throw new Error(`F3 直改目标超出 workspace 根:${object}`);
    return target;
  }
  return resolve(workspaceDir, '.dsh-library', rel);
}

/**
 * F3 直改执行(缺陷 #1 修订):复用 harvest 既有通道真实读改写工作区级数据资产
 * (默认 .dsh-library/<object>,默认 remediations.json 独立整改登记;或 .md 底座文本追加)。
 * 受控写面(controlled-write-surface-boundary):执行前读 before、执行后写 after,
 * 失败抛错由调用方记 error;留痕含 before/after(JSON 完整、文本摘要),可回滚。
 * 领地硬边界:目标必须落在 .dsh-library / .dsh-base / toolkit / docs 白名单目录内。
 * 返回 { object, target, isMd, before, after, result:'applied' };失败 throw(不落半态)。
 */
export async function applyF3DirectEdit(workspaceDir, spec = {}) {
  const object = (typeof spec.object === 'string' && spec.object.trim().length > 0) ? spec.object.trim() : 'remediations.json';
  const target = resolveF3Target(workspaceDir, object, spec.territory);
  const base = resolve(workspaceDir);
  const relForCheck = String(target).startsWith(base) ? relative(workspaceDir, target).replace(/\\/g, '/') : '';
  if (!territoryInWhitelist(relForCheck)) throw new Error(`F3 直改目标超出领地白名单:${relForCheck || object}`);
  const id = spec.id ?? `F3-${nowStamp()}`;
  const ts = spec.ts ?? new Date().toISOString();
  const evidence = Array.isArray(spec.evidence) ? spec.evidence : [];
  const isMd = /\.md$/i.test(target);
  await mkdir(dirname(target), { recursive: true });
  if (isMd) {
    let text = '';
    try { text = await readFile(target, 'utf8'); } catch { text = ''; }
    const before = text;
    const append = `\n\n### [自省整改] ${spec.ruleId ?? 'F3'} ${ts}\n- findingId: ${spec.findingId ?? ''}\n- 证据: ${evidenceChain(evidence) || '(无)'}\n`;
    const after = text + append;
    await writeFile(target, after, 'utf8');
    return { object, target, isMd: true, before, after, result: 'applied' };
  }
  // JSON 数据资产:读 before → after = before 追加 auditRemediations 登记(受控可回滚)。
  let parsed = null;
  try { parsed = await readJsonRetry(target); } catch { parsed = null; }
  if (parsed !== null && (Array.isArray(parsed) || typeof parsed !== 'object')) {
    throw new Error(`F3 直改目标 ${relForCheck || object} 顶层非对象(不支持数组/标量),拒绝改写`);
  }
  const before = parsed === null || parsed === undefined ? null : structuredClone(parsed);
  const baseObj = (before === null) ? {} : { ...before };
  const entries = Array.isArray(baseObj.auditRemediations) ? [...baseObj.auditRemediations] : [];
  entries.push({
    id, ts, ruleId: spec.ruleId ?? null, findingId: spec.findingId ?? null,
    status: 'OPEN', evidence,
  });
  const after = { ...baseObj, auditRemediations: entries };
  await writeJson(target, after);
  return { object, target, isMd: false, before, after, result: 'applied' };
}

// ── 观察原语 O1~O6(纯函数,data source 全部已存在,零新增采集)───────────────
// 每条发现 shape:
//   { id, observe, category, title, summary, value, status:'supported'|'unsupported',
//     reason?(unsupported), evidence:[{ file, ref?, line?, ts? }] }
// 数据源不可得 → status:'unsupported' 显式降级(unsupported-degradation),严禁伪造。

/** 归一 evidence 引用(路径为相对或绝对均可;ref 为行号/条目/时间戳)。 */
function ev(file, ref, ts) {
  const e = { file };
  if (ref !== undefined && ref !== null && ref !== '') e.ref = String(ref);
  if (ts !== undefined && ts !== null && ts !== '') e.ts = String(ts);
  return e;
}

/** 扫目录下的 .mjs 文件相对路径(供 O5 用);目录缺失 → null。 */
async function listFilesRel(dir) {
  let out = [];
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await listFilesRel(p);
      if (sub !== null) out = out.concat(sub.map((s) => `${entry.name}/${s}`));
    } else {
      out.push(entry.name);
    }
  }
  return out;
}

/**
 * O1 watcher 日志观察(纯函数,读文件)。plugindevRoot 缺省 = process.cwd():
 * 以进程真实 cwd(DESIGN C1:watcher 以 process.cwd() 为根,DEFAULT_LOG 相对 cwd)为单一事实源,
 * 候选第一 = resolve(process.cwd(), DEFAULT_LOG);plugindevRoot 仅作显式覆盖/测试注入。
 * 部署副本下进程 cwd 仍为 plugindev/(watcher 与 preset 同进程),故可命中真实
 * plugindev/pipeline-watch.log,不因预设部署路径(pathResolve(presetDir,'..','..'))误降级 ——
 * 不用猜测安装根推导真实落点(缺陷 #2 修订,违背 C2 修复)。
 * 解析(启发式):退出频次 / 事件分布 / WS 断连 / 静默断链;全不可得 → status:'unsupported'(仅兜底)。
 */
export async function observeO1(plugindevRoot, options = {}) {
  const candidates = [];
  // 事实源 = 进程 cwd(可核证,不猜测);plugindevRoot 显式给出时优先,否则回退 cwd。
  const root = (typeof plugindevRoot === 'string' && plugindevRoot.length > 0) ? plugindevRoot : process.cwd();
  candidates.push(resolve(root, DEFAULT_WATCH_LOG));
  if (typeof process?.cwd === 'function') {
    candidates.push(resolve(process.cwd(), DEFAULT_WATCH_LOG));
    candidates.push(resolve(process.cwd(), 'pipeline-ws', DEFAULT_WATCH_LOG));
    candidates.push(resolve(process.cwd(), '.dsh-home', DEFAULT_WATCH_LOG));
  }
  if (Array.isArray(options.candidates)) candidates.push(...options.candidates.map((c) => resolve(c)));
  const seen = new Set();
  const uniqueCandidates = candidates.filter((c) => (seen.has(c) ? false : (seen.add(c), true)));
  let logFile = null;
  let text = null;
  for (const cand of uniqueCandidates) {
    try {
      text = await readFile(cand, 'utf8');
      logFile = cand;
      break;
    } catch { /* 候选不可得,继续 */ }
  }
  if (logFile === null || text === null) {
    return [{
      id: 'O1-unsupported',
      observe: 'O1',
      category: 'test-env',
      title: 'watcher 日志不可得',
      summary: 'O1 数据源(watcher 日志)候选路径全部不可得,显式 unsupported 降级',
      value: { logFile: false },
      status: 'unsupported',
      reason: 'watcher log not found',
      evidence: uniqueCandidates.map((c) => ev(c, 'missing')),
    }];
  }
  const lines = text.split('\n');
  const total = lines.length;
  // 退出频次:行内含退出关键词。
  const exitLines = lines
    .map((l, i) => ({ l, i: i + 1 }))
    .filter(({ l }) => /exit|退出|EXIT|shutdown|结束/i.test(l));
  // 事件分布:按 event:/事件: 标记聚合。
  const eventCounts = {};
  for (const { l } of lines.map((l, i) => ({ l, i }))) {
    const m = /(?:event|事件)[:：]\s*([A-Za-z0-9_-]+)/i.exec(l);
    if (m) {
      const name = m[1].toLowerCase();
      eventCounts[name] = (eventCounts[name] ?? 0) + 1;
    }
  }
  const eventList = Object.entries(eventCounts).map(([name, count]) => ({ name, count }));
  // WS 断连:websocket 断连关键词。
  const wsLines = lines
    .map((l, i) => ({ l, i: i + 1 }))
    .filter(({ l }) => /websocket|ws[:/]|断连|断开|disconnect/i.test(l));
  // 静默断链:心跳超时 / silent / 无数据。
  const silentLines = lines
    .map((l, i) => ({ l, i: i + 1 }))
    .filter(({ l }) => /silent|静默|心跳|heartbeat|no data|timeout|超时/i.test(l));
  const finding = {
    id: 'O1-watch',
    observe: 'O1',
    category: 'test-env',
    title: 'watcher 活动观察',
    summary: `watcher 日志 ${total} 行:退出频次 ${exitLines.length}、事件 ${Object.keys(eventCounts).length} 类、WS 断连 ${wsLines.length}、静默/心跳超时 ${silentLines.length}`,
    value: {
      totalLines: total,
      exitCount: exitLines.length,
      wsDisconnectCount: wsLines.length,
      silentDisconnectCount: silentLines.length,
      eventCount: Object.keys(eventCounts).length,
    },
    status: 'supported',
    evidence: [
      ev(logFile, undefined, undefined),
      ...exitLines.slice(0, 3).map(({ l, i }) => ev(logFile, i, l.slice(0, 60))),
      ...wsLines.slice(0, 3).map(({ l, i }) => ev(logFile, i, l.slice(0, 60))),
      ...silentLines.slice(0, 3).map(({ l, i }) => ev(logFile, i, l.slice(0, 60))),
    ].slice(0, 8),
  };
  return [finding];
}

/** 项目目录清单(workspace 下含 .dsh-project 的子目录);缺失 → []。 */
export async function projectDirs(workspaceDir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(workspaceDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if ((entry.name.startsWith('.') && entry.name !== '.') || entry.name === '_selftest') continue;
    try {
      await stat(join(workspaceDir, entry.name, '.dsh-project'));
      out.push(entry.name);
    } catch { /* 不是项目目录,跳过 */ }
  }
  return out;
}

/**
 * O2 BUDGET token 分布观察。各项目 BUDGET.committed(runtime-events)按角色/阶段聚合,
 * 报告分布与异常值(峰值角色/阶段)。读容错(registry-halfwrite-read-tolerance):失败重试,仍失败按项目跳过。
 */
export async function observeO2(workspaceDir) {
  const findings = [];
  let dirs = [];
  try {
    dirs = await projectDirs(workspaceDir);
  } catch {
    return findings;
  }
  const byRole = {};
  const byStage = {};
  let budgetProjects = 0;
  for (const pid of dirs) {
    const budgetFile = join(workspaceDir, pid, '.dsh-project', 'BUDGET.json');
    let budget;
    try {
      budget = await readJsonRetry(budgetFile);
    } catch {
      continue; // 半写/坏预算,跳过(registry-halfwrite-read-tolerance)
    }
    const committed = Array.isArray(budget?.committed) ? budget.committed : [];
    if (committed.length === 0) continue;
    budgetProjects += 1;
    for (const entry of committed) {
      if (!(entry?.source === 'runtime-events' && entry?.usage && typeof entry.usage === 'object')) continue;
      const role = typeof entry.role === 'string' && entry.role.length > 0 ? entry.role : 'unknown';
      const stage = typeof entry.stageId === 'string' && entry.stageId.length > 0 ? entry.stageId : 'unknown';
      const tok = totalToken(entry.usage);
      const rb = (byRole[role] ??= { tokens: 0, count: 0 });
      rb.tokens += tok; rb.count += 1;
      const sb = (byStage[stage] ??= { tokens: 0, count: 0 });
      sb.tokens += tok; sb.count += 1;
    }
  }
  if (budgetProjects === 0) {
    return [{
      id: 'O2-no-budget',
      observe: 'O2',
      category: 'dev-complexity',
      title: '无 runtime-events 预算记录',
      summary: 'O2:未发现任何项目 BUDGET.runtime-events committed 条目,无法观测 token 分布',
      value: { budgetProjects: 0 },
      status: 'supported',
      evidence: [],
    }];
  }
  const roleAgg = Object.entries(byRole)
    .map(([role, v]) => ({ role, tokens: v.tokens, count: v.count }))
    .sort((a, b) => b.tokens - a.tokens);
  const stageAgg = Object.entries(byStage)
    .map(([stage, v]) => ({ stage, tokens: v.tokens, count: v.count }))
    .sort((a, b) => b.tokens - a.tokens);
  const peakRole = roleAgg[0];
  const peakStage = stageAgg[0];
  const findingsArr = [{
    id: 'O2-token-dist',
    observe: 'O2',
    category: 'dev-complexity',
    title: '预算 token 分布',
    summary: `O2:${budgetProjects} 个项目有 runtime-events 预算;峰值角色 ${peakRole?.role ?? '-'}:${peakRole?.tokens ?? 0} token,峰值阶段 ${peakStage?.stage ?? '-'}:${peakStage?.tokens ?? 0} token`,
    value: {
      budgetProjects,
      roleCount: roleAgg.length,
      peakRoleTokens: peakRole?.tokens ?? 0,
      peakStageTokens: peakStage?.tokens ?? 0,
    },
    status: 'supported',
    evidence: [
      ev(join('budget', 'runtime-events'), `peakRole=${peakRole?.role ?? '-'}`),
      ev(join('budget', 'runtime-events'), `peakStage=${peakStage?.stage ?? '-'}`),
    ],
  }];
  // 异常值:role/stage 中明显偏离(占比 >80% 总且只有单一角色)时单列一条。
  const totalTokens = roleAgg.reduce((a, x) => a + x.tokens, 0);
  if (roleAgg.length > 0 && totalTokens > 0 && peakRole && peakRole.tokens / totalTokens > 0.8) {
    findingsArr.push({
      id: 'O2-peak-concentration',
      observe: 'O2',
      category: 'dev-complexity',
      title: 'token 分布高度集中',
      summary: `O2:角色 ${peakRole.role} 占 runtime-events 总 token ${Math.round((peakRole.tokens / totalTokens) * 100)}%,分布异常集中`,
      value: { concentration: peakRole.tokens / totalTokens, peakRoleTokens: peakRole.tokens },
      status: 'supported',
      evidence: [ev(join('budget', 'runtime-events'), `role=${peakRole.role} tokens=${peakRole.tokens}`)],
    });
  }
  return findingsArr;
}

/**
 * O3 门禁时长 + blockers category 频次观察。扫各项目 REGISTRY blockers(复用 collectAllBlockers/
 * aggregateByCategory)+ 门禁 pending 状态(updatedAt 为进入该阶段的近似时间戳)。
 */
export async function observeO3(workspaceDir) {
  const findings = [];
  const blockers = await collectAllBlockers(workspaceDir);
  const agg = aggregateByCategory(blockers);
  const dirs = await projectDirs(workspaceDir);
  const pendingGates = [];
  const now = Date.now();
  for (const pid of dirs) {
    const regFile = join(workspaceDir, pid, '.dsh-project', 'REGISTRY.json');
    let reg;
    try {
      reg = await readJsonRetry(regFile);
    } catch {
      continue;
    }
    if (reg?.gateStatus === 'pending') {
      const updatedAt = reg.updatedAt;
      const hours = typeof updatedAt === 'string' && updatedAt.length > 0
        ? (now - new Date(updatedAt).getTime()) / 3600000
        : null;
      pendingGates.push({ projectId: pid, pendingHours: hours !== null && Number.isFinite(hours) ? hours : 0 });
    }
  }
  if (agg.length > 0) {
    for (const item of agg) {
      findings.push({
        id: `O3-block-${item.category}`,
        observe: 'O3',
        category: 'other',
        title: `卡点类别风暴:${item.category}`,
        summary: `O3:${item.category} 类卡点 ${item.count} 次(≥2,机制缺陷未修候选)`,
        value: { categoryCount: item.count, category: item.category },
        status: 'supported',
        evidence: item.cases.map((c) => ev(join(pidDir(c.projectId), 'REGISTRY.json'), `blocker=${c.blockerId}`)),
      });
    }
  }
  if (pendingGates.length > 0) {
    const slowest = pendingGates.find((p) => p.pendingHours >= 4) ?? pendingGates[0];
    findings.push({
      id: 'O3-gate-slow',
      observe: 'O3',
      category: 'other',
      title: '门禁待裁决超时',
      summary: `O3:${pendingGates.length} 个门禁 pending;最久 ${slowest.projectId} 已待 ${Math.round(slowest.pendingHours)} 小时`,
      value: { pendingGates: pendingGates.length, pendingHours: Math.round(slowest.pendingHours) },
      status: 'supported',
      evidence: pendingGates.slice(0, 3).map((p) => ev(join(p.projectId, '.dsh-project', 'REGISTRY.json'), `pendingHours=${Math.round(p.pendingHours)}`)),
    });
  }
  return findings;
}

/** 项目相对 registry 目录小件(O3 evidence 引用用)。 */
function pidDir(pid) {
  return pid;
}

/**
 * O4 lessons/patterns 同类 category 计数观察。读 lessons-index.json(由 harvest 维护),
 * category 计数 ≥3 = 机制缺陷未修候选。缺索引 → unsupported(需先 harvest rebuild-index)。
 */
export async function observeO4(workspaceDir) {
  const indexFile = join(workspaceDir, LIBRARY_DIRNAME, 'lessons-index.json');
  let index;
  try {
    index = await readJsonRetry(indexFile);
  } catch {
    return [{
      id: 'O4-no-index',
      observe: 'O4',
      category: 'design-info',
      title: 'lessons-index 缺失',
      summary: 'O4:lessons-index.json 缺失(尚未重建),同类 category 计数不可观测;先 harvest rebuild-index',
      value: { index: false },
      status: 'unsupported',
      reason: 'lessons-index.json not found',
      evidence: [ev(indexFile, 'missing')],
    }];
  }
  const findings = [];
  const cats = index?.categories ?? {};
  for (const [category, list] of Object.entries(cats)) {
    if (!Array.isArray(list)) continue;
    if (list.length >= 3) {
      findings.push({
        id: `O4-cat-${category}`,
        observe: 'O4',
        category: 'design-info',
        title: `同类 lesson 堆积:${category}`,
        summary: `O4:category "${category}" 有 ${list.length} 篇(≥3 = 机制缺陷未修候选)`,
        value: { categoryCount: list.length, category },
        status: 'supported',
        evidence: list.slice(0, 5).map((x) => ev(indexFile, `entry=${x?.id}`)),
      });
    }
  }
  return findings.length > 0 ? findings : [];
}

/**
 * O5 toolkit 实文件 vs 文档差集观察(纯函数)。toolkitDir 为 toolkit 实际目录;
 * docsText 为 README/PROTOCOL 文本。差集 A−B(未记录文件)+ B−A(记录但缺失)+ deprecated 未清理。
 * 返回 [ finding ](含 driftCount)。toolkit 目录缺失 → unsupported。
 */
export async function observeO5(toolkitDir, docsText) {
  const actual = await listFilesRel(toolkitDir);
  if (actual === null) {
    return [{
      id: 'O5-no-toolkit',
      observe: 'O5',
      category: 'deploy-permission',
      title: 'toolkit 目录不可得',
      summary: 'O5:toolkit 目录缺失,实文件 vs 文档差集不可观测',
      value: { driftCount: 0 },
      status: 'unsupported',
      reason: 'toolkitDir not found',
      evidence: [],
    }];
  }
  const docs = typeof docsText === 'string' ? docsText : '';
  const refSet = new Set();
  // 约定模式:toolkit/<name>、plugins/<name>.mjs、PROTOCOL 里引用的 .mjs/.md 路径。
  const docRefs = [...docs.matchAll(/(?:toolkit|plugins)\/([A-Za-z0-9_.\-\/]+\.(?:mjs|md|json|yml|yaml))/gi)].map((m) => m[1]);
  for (const ref of docRefs) refSet.add(ref.replace(/^\.\//, ''));
  const B = [...refSet].sort();
  const AminusB = actual.filter((a) => !refSet.has(a));
  const BminusA = B.filter((b) => !actual.includes(b));
  const deprecated = actual.filter((a) => /deprecated|obsolete/i.test(a));
  const driftCount = AminusB.length + BminusA.length + deprecated.length;
  const pieces = [];
  if (AminusB.length > 0) pieces.push(ev(toolkitDir, `unrecorded=${AminusB.slice(0, 3).join(',')}`));
  if (BminusA.length > 0) pieces.push(ev(docsText !== '' ? 'docs' : 'docs', `missing=${BminusA.slice(0, 3).join(',')}`));
  if (deprecated.length > 0) pieces.push(ev(toolkitDir, `deprecated=${deprecated.slice(0, 3).join(',')}`));
  return [{
    id: 'O5-doc-drift',
    observe: 'O5',
    category: 'deploy-permission',
    title: '工具/文档漂移',
    summary: `O5:toolkit 实文件 ${actual.length} 个 vs 文档记录 ${B.length} 个;差集 drift=${driftCount}(A−B ${AminusB.length},B−A ${BminusA.length},deprecated ${deprecated.length})`,
    value: { driftCount, actualCount: actual.length, docCount: B.length, unrecorded: AminusB.length, missing: BminusA.length, deprecated: deprecated.length },
    status: 'supported',
    evidence: pieces.slice(0, 6),
  }];
}

/**
 * O6 前次审计发现状态观察。读 audit-trail.json,报告未解决(open/超龄未动)条目。
 * 超龄阈值默认 30 天(超龄未动 = 已立项/已呈递却长期无进展)。
 */
export async function observeO6(workspaceDir, options = {}) {
  const { trail, error } = await readAuditTrail(workspaceDir);
  if (!Array.isArray(trail) || trail.length === 0) {
    return [{
      id: 'O6-no-trail',
      observe: 'O6',
      category: 'other',
      title: '尚无审计留痕',
      summary: `O6:audit-trail.json 为空/缺失,前次审计发现状态不可观测${error ? `(${error})` : ''}`,
      value: { openCount: 0 },
      status: 'supported',
      evidence: trail.length > 0 ? [ev(auditTrailPath(workspaceDir), undefined)] : [],
    }];
  }
  const staleDays = Number.isFinite(options.staleDays) ? options.staleDays : 30;
  const now = Date.now();
  const openItems = trail.filter((e) => e?.status !== 'resolved');
  const staleItems = openItems.filter((e) => {
    const ts = e?.ts ?? e?.createdAt;
    return typeof ts === 'string' && ts.length > 0 && (now - new Date(ts).getTime()) > staleDays * 86400000;
  });
  const findings = [];
  if (staleItems.length > 0) {
    findings.push({
      id: 'O6-stale',
      observe: 'O6',
      category: 'other',
      title: '前次审计发现超龄未动',
      summary: `O6:${staleItems.length} 条审计留痕未解决且超龄 ${staleDays} 天未动(已立项/已呈递却无进展)`,
      value: { openCount: openItems.length, staleCount: staleItems.length, staleDays },
      status: 'supported',
      evidence: staleItems.slice(0, 5).map((e) => ev(auditTrailPath(workspaceDir), e?.ts ?? '')).filter((x) => x !== null),
    });
  } else if (openItems.length > 0) {
    findings.push({
      id: 'O6-open',
      observe: 'O6',
      category: 'other',
      title: '前次审计发现待解决',
      summary: `O6:${openItems.length} 条审计留痕未解决(未超龄)`,
      value: { openCount: openItems.length, staleCount: 0, staleDays },
      status: 'supported',
      evidence: openItems.slice(0, 5).map((e) => ev(auditTrailPath(workspaceDir), e?.ts ?? '')).filter((x) => x !== null),
    });
  }
  return findings;
}

/** 汇聚一轮审计的全部发现(O1~O6),任一观察非致命失败不炸整轮。 */
export async function runObservations(ctx) {
  const findings = [];
  const errors = [];
  const steps = [
    async () => (await observeO1(ctx.plugindevRoot)).forEach((f) => findings.push(f)),
    async () => (await observeO2(ctx.workspaceDir)).forEach((f) => findings.push(f)),
    async () => (await observeO3(ctx.workspaceDir)).forEach((f) => findings.push(f)),
    async () => (await observeO4(ctx.workspaceDir)).forEach((f) => findings.push(f)),
    async () => (await observeO5(ctx.toolkitDir, ctx.docsText)).forEach((f) => findings.push(f)),
    async () => (await observeO6(ctx.workspaceDir)).forEach((f) => findings.push(f)),
  ];
  for (const step of steps) {
    try {
      await step();
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { findings, errors };
}

// ── 验收路由前置化(kr-accept-route,0.16.0,2026-09-04)──────────────────────
// 验收路由声明前置到 clarify:凡 AC 依赖真机会话/视觉浏览器验收/部署重启/真实上游凭据的,
// clarify 阶段即声明「用户侧 blocking」,进 SPEC AC 对照表,delivery-gate 机械核对。
// 机制承载:SPEC 头部 front-matter 的 acceptance-routing 结构化字段(主承载)+ flow 模板
// note 增补 + MANUAL_TEXT 提示层 + delivery-gate present 机械核对(project-registry 调用本
// 纯函数)。只增不改、零 npm import;纯函数便于单测(AC1/AC2 单测部分)。

/** 四类真机触发类(AC 依赖这些 → 必须声明用户侧 blocking)。 */
export const ACCEPTANCE_TRIGGER_CLASSES = ['real-session', 'visual-browser', 'deploy-restart', 'real-upstream-credential'];

/** 合法验收路由(模型可验证 / 用户侧 blocking)。 */
export const ACCEPTANCE_ROUTES = ['model-verifiable', 'user-blocking'];

/**
 * 解析 SPEC 头部 front-matter 的 acceptance-routing 块(结构化字段,机械核对更稳)。
 * SPEC.md 顶部 `---` 分隔块内,格式:
 *   ---
 *   acceptance-routing:
 *     AC1: model-verifiable
 *     AC2: user-blocking|real-session
 *   ---
 * 每行 `AC-id: route` 或 `AC-id: route|trigger`(trigger 为四类触发类之一,可选)。
 * 返回 { entries: [{ ac, route, trigger? }], error?, missing? }。缺 front-matter /
 * 缺块 → 带 error + missing:true(块缺失,存量/未声明,delivery-gate 据此跳过核对);
 * 未闭合 / 行格式非法 / 空块 → 带 error(块存在但畸形,delivery-gate 据此拒绝)。
 * 不炸调用方。
 */
export function parseAcceptanceRouting(specText) {
  if (typeof specText !== 'string' || specText.length === 0) {
    return { entries: [], error: 'SPEC 文本为空' };
  }
  if (!specText.startsWith('---\n')) {
    return { entries: [], error: 'SPEC 缺 front-matter(须以 --- 开头)', missing: true };
  }
  const end = specText.indexOf('\n---', 4);
  if (end < 0) {
    return { entries: [], error: 'SPEC front-matter 未闭合(缺 --- 结束)' };
  }
  const block = specText.slice(4, end);
  const lines = block.split('\n');
  const routingIdx = lines.findIndex((l) => /^\s*acceptance-routing\s*:\s*$/.test(l));
  if (routingIdx < 0) {
    return { entries: [], error: 'SPEC front-matter 缺 acceptance-routing 块', missing: true };
  }
  const entries = [];
  for (let i = routingIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*$/.test(line)) continue;
    if (!/^\s+/.test(line)) break; // 缩进结束(下一顶层键)
    const m = /^\s*([A-Za-z0-9_-]+)\s*:\s*([A-Za-z0-9_-]+)(?:\s*\|\s*([A-Za-z0-9_-]+))?\s*$/.exec(line);
    if (!m) {
      return { entries: [], error: `acceptance-routing 行格式非法:${line.trim()}` };
    }
    const entry = { ac: m[1], route: m[2] };
    if (m[3]) entry.trigger = m[3];
    entries.push(entry);
  }
  if (entries.length === 0) {
    return { entries: [], error: 'acceptance-routing 块为空(无 AC 条目)' };
  }
  return { entries };
}

/**
 * 校验 AC 对照表路由声明(纯函数,AC1/AC2 单测锁定)。
 * entries: [{ ac, route, trigger? }](经 parseAcceptanceRouting 或手工构造)。
 * 规则:
 *   - 每项 ac 非空、route ∈ ACCEPTANCE_ROUTES;
 *   - trigger ∈ 四类触发类时 route 必须 'user-blocking'(r4 语义:真机项由用户侧
 *     blocking 执行,不得以静态放行替代);
 *   - 无 trigger(模型可验证)route 可为 model-verifiable 或 user-blocking。
 * 返回 { ok: true, errors: [] } 或 { ok: false, errors: string[] }。
 */
export function validateAcceptanceRouting(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { ok: false, errors: ['acceptance-routing 必须是非空数组'] };
  }
  const errors = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const at = `acceptance-routing[${i}]`;
    if (e === null || typeof e !== 'object') {
      errors.push(`${at} 必须是对象`);
      continue;
    }
    if (typeof e.ac !== 'string' || e.ac.length === 0) {
      errors.push(`${at}.ac 必填(非空字符串)`);
      continue;
    }
    if (!ACCEPTANCE_ROUTES.includes(e.route)) {
      errors.push(`${at}(${e.ac}) route 必须是 ${ACCEPTANCE_ROUTES.join('/')} 之一,得到 ${JSON.stringify(e.route)}`);
      continue;
    }
    if (e.trigger !== undefined) {
      if (!ACCEPTANCE_TRIGGER_CLASSES.includes(e.trigger)) {
        errors.push(`${at}(${e.ac}) trigger 必须是 ${ACCEPTANCE_TRIGGER_CLASSES.join('/')} 之一,得到 ${JSON.stringify(e.trigger)}`);
        continue;
      }
      if (e.route !== 'user-blocking') {
        errors.push(`${at}(${e.ac}) 依赖真机触发类 "${e.trigger}",route 必须声明 user-blocking(r4:真机项由用户侧 blocking 执行,不得以静态放行替代)`);
      }
    }
  }
  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

// ── 门禁授权源校验(kr-gate-auth,0.20.0,2026-09-05)────────────────────────
// project_gate approve 强制携带主线程裁决指针(rulingRef)。三形态(主线程定稿,
// 方案 1 + 书面补充裁决,三选一允许组合):
//   帧通道(intake 帧 should 答复)= 帧 rpcId(天然指针,零约定,直接取用);
//   文本通道(drive 文本投递)= 裁决文件路径(可追溯、可回放);
//   兜底(文本通道无落盘文件)= 裁决书整段原文摘录(整段、非摘要句)。
// 校验口径=机械可判定:rulingRef 非空字符串 + 前缀/路径形态匹配即可,不做内容
// 真实性追溯(不验证 rpcId 存在/路径存在/原文真实)。纯函数、零 npm import、只增不改。

/**
 * 校验门禁 approve 的授权源指针(rulingRef,纯函数,AC1 单测锁定)。
 * 合法形态(主线程定稿,三选一允许组合):
 *   - 帧通道 = 帧 rpcId(天然指针,零约定,直接取用);
 *   - 文本通道 = 裁决文件路径(可追溯、可回放);
 *   - 兜底 = 裁决书整段原文摘录(文本通道无落盘文件时,整段、非摘要句)。
 * 三形态均为非空字符串 → 机器可核对字段 = rulingRef 非空字符串(前缀/路径形态
 * 匹配即可,不做内容真实性追溯)。
 * 返回 { ok: true } 或 { ok: false, error }。
 */
export function validateRulingRef(rulingRef) {
  if (typeof rulingRef !== 'string' || rulingRef.trim().length === 0) {
    return { ok: false, error: '门禁 approve 须引用主线程裁决指针(kr-gate-auth):rulingRef 必填(非空字符串,帧通道=帧 rpcId / 文本通道=裁决文件路径 / 兜底=裁决书整段原文摘录)' };
  }
  return { ok: true };
}

// ── 批量沉淀机制(kr-sediment-batch,0.18.0,2026-09-04)──────────────────────
// 计数触发:每 N 个项目交付(N 默认 10,workspace 级可调,并入 audit-rules.json meta 段
// sedimentation:{enabled,everyNDelivered},免部署生效)自动登记一个专门沉淀项目。
// 触发信号代码层浮现(advance-to-delivered 返回值携带「已达沉淀阈值 N,须登记沉淀项目」
// 指令,非 MANUAL_TEXT)。防重复触发(active/parked 已有沉淀项目不重登、并发只触发一次);
// 计数口径=自最近一次沉淀登记以来 state=delivered 项目数,从 REGISTRY 派生不新增状态文件。
// 开关:enabled=false 时触发检测代码层短路(不产生登记指令);计数在关闭期间继续累计
// (从 REGISTRY 派生,不新增状态文件),重新开启后若 count>=N 下一次交付即触发。
// 识别口径:沉淀项目按 flowRef 识别(flowRef 以 sediment-flow 开头,自动沉淀项目经
// register 指定 flowTemplate=sediment-flow 即携带);title 前缀「沉淀」仅保留为登记惯例,
// 不作为判定依据(真机探针教训:title 带「沉淀」的用户项目不得误判为沉淀项目)。
// 全部纯函数、零 npm import、只增不改。

/**
 * 沉淀项目 title 前缀(登记惯例,非判定依据)。
 * 自动沉淀项目登记时 title 带「沉淀」前缀(惯例);但识别沉淀项目一律按 flowRef
 * (flowRef 以 sediment-flow 开头),title 前缀不参与判定——任何用户项目标题以
 * 「沉淀」开头都不会被误判为沉淀项目(真机探针教训:title「沉淀机制探针 1/2」曾
 * 被误判为沉淀项目成为锚点导致计数归零永不触发)。
 */
export const SEDIMENT_TITLE_PREFIX = '沉淀';

/** 默认沉淀阈值 N(纯函数回退;workspace 级可调,并入 audit-rules.json meta 段 sedimentation.everyNDelivered)。 */
export const DEFAULT_SEDIMENT_THRESHOLD = 10;

/** 默认沉淀开关配置(meta 段 sedimentation 缺省回退)。 */
export const DEFAULT_SEDIMENTATION = { enabled: true, everyNDelivered: 10 };

/**
 * 归一化沉淀开关配置(纯函数):缺省/非法字段回退默认。
 * 输入 value(meta.sedimentation 或任意形状)→ { enabled, everyNDelivered }。
 */
export function normalizeSedimentation(value) {
  if (value === null || typeof value !== 'object') return { ...DEFAULT_SEDIMENTATION };
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_SEDIMENTATION.enabled,
    everyNDelivered: Number.isSafeInteger(value.everyNDelivered) && value.everyNDelivered > 0
      ? value.everyNDelivered
      : DEFAULT_SEDIMENTATION.everyNDelivered,
  };
}

/** 沉淀项目流程模板 id(复用 lite-flow 结构 + 沉淀职责 note,避免 flow schema 变更)。 */
export const SEDIMENT_FLOW_TEMPLATE = 'sediment-flow';

/** 沉淀触发指令文本(advance-to-delivered 返回值携带,代码层浮现)。 */
export const SEDIMENT_TRIGGER_MESSAGE = '已达沉淀阈值 N,须登记沉淀项目';

/**
 * 判断某项目是否为沉淀项目(按 flowRef 识别:flowRef 以 sediment-flow 开头)。
 * 自动沉淀项目经 register 指定 flowTemplate=sediment-flow 即携带 flowRef=sediment-flow@N,
 * 故 flowRef 前缀即识别依据。title 前缀「沉淀」仅保留为登记惯例(SEDIMENT_TITLE_PREFIX),
 * 不作为判定依据——用户手建「沉淀探针」类项目(title 带「沉淀」但 flowRef 非 sediment-flow)
 * 计入普通交付,不被误判为沉淀项目(真机探针教训)。
 */
export function isSedimentProject(registry) {
  return registry !== null && typeof registry === 'object'
    && typeof registry.flowRef === 'string'
    && registry.flowRef.startsWith(SEDIMENT_FLOW_TEMPLATE);
}

/**
 * 从 REGISTRY 派生「最近一次沉淀项目登记」的锚点时间(createdAt,ISO 串)。
 * 无沉淀项目 → null(计数从最早 delivered 起计,即全部 delivered 数)。
 */
export function lastSedimentRegistrationAt(registries) {
  const list = Array.isArray(registries) ? registries : [];
  let latest = null;
  for (const r of list) {
    if (!isSedimentProject(r)) continue;
    const at = r?.createdAt;
    if (typeof at !== 'string' || at.length === 0) continue;
    if (latest === null || at > latest) latest = at;
  }
  return latest;
}

/**
 * 计数口径:自最近一次沉淀项目登记以来 state=delivered 的项目数(从 REGISTRY 派生)。
 * 以 delivered 项目的 updatedAt(交付时间)与锚点比较;沉淀项目自身不计入普通交付;
 * 无锚点 → 全部 delivered 数。registry-halfwrite-read-tolerance:坏条目跳过(不炸)。
 */
export function countDeliveredSinceSediment(registries) {
  const list = Array.isArray(registries) ? registries : [];
  const anchor = lastSedimentRegistrationAt(list);
  let count = 0;
  for (const r of list) {
    if (r === null || typeof r !== 'object') continue;
    if (isSedimentProject(r)) continue; // 沉淀项目自身不计入普通交付
    if (r.state !== 'delivered') continue;
    const at = r?.updatedAt ?? r?.createdAt;
    if (typeof at !== 'string' || at.length === 0) continue;
    if (anchor === null || at > anchor) count += 1;
  }
  return count;
}

/**
 * 是否存在 active/parked 的沉淀项目(防重复触发 + 并发只触发一次)。
 */
export function hasActiveOrParkedSediment(registries) {
  const list = Array.isArray(registries) ? registries : [];
  return list.some((r) => isSedimentProject(r) && (r.state === 'active' || r.state === 'parked'));
}

/**
 * 阈值检测纯函数(AC1):满 N 触发 / 未满不触发 / 防重复触发 / 并发边界。
 * 输入:registries(全部项目 REGISTRY 数组)、threshold(N,默认 DEFAULT_SEDIMENT_THRESHOLD)。
 * 返回 { triggered, count, threshold, reason? }:
 *   triggered=true 当且仅当 count >= threshold 且无 active/parked 沉淀项目。
 * 并发边界:本函数是纯函数;「并发只触发一次」由调用方(advance-to-delivered)在登记
 * 沉淀项目后,后续 advance 因 hasActiveOrParkedSediment=true 而不再触发(单进程内
 * advance 串行执行,天然串行化)。
 */
export function sedimentThresholdMet(registries, threshold) {
  const N = Number.isSafeInteger(threshold) && threshold > 0 ? threshold : DEFAULT_SEDIMENT_THRESHOLD;
  const count = countDeliveredSinceSediment(registries);
  if (hasActiveOrParkedSediment(registries)) {
    return { triggered: false, count, threshold: N, reason: '已有 active/parked 沉淀项目,防重复触发' };
  }
  if (count >= N) {
    return { triggered: true, count, threshold: N };
  }
  return { triggered: false, count, threshold: N };
}

// ── PM 评审轮次决策(kr-pm-review,0.21.0,2026-09-06)────────────────────────
// PM 评审回路轮次规则的可测参考实现(纯函数,单测锁定语义)。协调者按阶段 note 文本 +
// 流程数据(.dsh-project/pm-review.json)维护轮次,不直接调用本函数(协调者无 direct lib
// 调用通道);规则语义由单测保证,行为由 note 文本引导。只增不改、零 npm import。

/**
 * PM 评审轮次决策(纯函数,AC3 单测锁定)。
 * 输入:{ round(当前轮次,≥1), verdict('pass'|'revise'), maxRounds(默认 3) }。
 * 返回:{ action: 'pass'|'revise'|'escalate', nextRound? }。
 * 规则:
 *   - verdict='pass' → { action:'pass' }(通过,推进);
 *   - verdict='revise' 且 round >= maxRounds → { action:'escalate' }(超限升级呈用户);
 *   - verdict='revise' 且 round < maxRounds → { action:'revise', nextRound: round+1 }(回 architect 返工重评)。
 * maxRounds 非法(非正整数)→ 回退默认 3。
 */
export function pmRoundDecision({ round, verdict, maxRounds = 3 } = {}) {
  const max = Number.isSafeInteger(maxRounds) && maxRounds > 0 ? maxRounds : 3;
  if (verdict === 'pass') return { action: 'pass' };
  if (round >= max) return { action: 'escalate' };
  return { action: 'revise', nextRound: round + 1 };
}
