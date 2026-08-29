// project-pipeline 纯库模块(A 路:登记簿)—— 只放数据校验与文件读写原语。
// 这不是 cordis 插件:没有 name/inject/apply,不进组合行;登记簿插件
// (project-registry.mjs)与角色库插件(project-roles.mjs,B 路)都按本文件
// 的导出签名 import 复用(SPEC-P1 §5 钉死,不得私自改约)。
//
// 硬约束:零 npm import(仅 node: 内置);登记簿/库文件一律 JSON;
// 写文件一律 node:fs/promises,JSON 落盘 2 空格缩进 + 末尾换行。

import { readFileSync, readdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

/** 阶段类型词汇表(框架的强约束;扩类型 = 模板 semver minor,改语义 = major)。 */
export const STAGE_TYPES = ['work', 'gate', 'summary', 'internalize'];

/** 预算 source 口径枚举(钉死;自报/事件实收/消费插件三层共用一本账)。 */
export const BUDGET_SOURCES = ['self-report', 'runtime-events', 'billing-plugin'];

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
  const allowed = new Set(['id', 'summary', 'persona', 'model', 'tools', 'workspace', 'permissions']);
  for (const key of Object.keys(role)) {
    if (!allowed.has(key)) return bad(`角色清单含未知顶层键 "${key}"`);
  }
  if (!nonEmptyString(role.id)) return bad('角色 id 必填(非空字符串)');
  if (!nonEmptyString(role.summary)) return bad(`角色 ${role.id} 的 summary 必填(一句话)`);
  if (!nonEmptyString(role.persona)) return bad(`角色 ${role.id} 的 persona 必填(非空全文)`);
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
