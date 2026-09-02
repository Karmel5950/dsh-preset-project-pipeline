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
//   - MAX_COMPILED_PERSONA=1000(C4a:编译后 persona 头+正文合计上限);
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

import { readFileSync, readdirSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

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
export const MAX_COMPILED_PERSONA = 1000;

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
