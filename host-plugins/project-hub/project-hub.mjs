// 宿主面插件:project-hub —— 项目中心(project-pipeline 二期 P2 宿主面插件)。
//
// 职责:把 project-pipeline 一期的文件制登记簿变成 web 界面可见的项目中心。
// 读视图:扫描工作区全部项目的 .dsh-project/,归一化为结构化 JSON,经自有 HTTP
// 通道暴露给浏览器半面(看板 + 设置卡)。不驱动会话、不写账本、不做实时推送。
// 写面(迭代8,project-hub-i8):新增唯一写面 = workspace 级 board view config
//   (<scanRoot>/board-view.json),仅经写端点读写,承载归档/置顶展示层标记。
//   REGISTRY.json 保持严格只读(看板永不写 REGISTRY),登记簿状态机语义不变。
//
// requires: ['L1.hotConfig', 'L1.channel']   ← 复用 dsh-compat 能力层
// 部署位置:<profile>/plugins/project-hub.mjs;同目录携带 vendored 兼容层副本
//          dsh-compat.mjs 与 ui/ 浏览器半面包。
//
// 架构(SPEC §3 / DESIGN §3):
//   - 核心只依赖 dsh-compat(唯一外部依赖);文件系统经 node:fs/promises 读取,
//     经 deps 注入可替换(单测用 stub fs 断言扫描/解析/错误分类)。
//   - 读视图服务 scanProjects / readProject:扫描 scanRoot 下全部 .dsh-project/,
//     逐项目归一化;单项目解析失败带错误分类,不拖垮整体(AC-R1.3)。
//   - 预算聚合 aggregateBudget:每项目原样透传 + 工作区级尽力而为汇总(按
//     role/source 计数,usage 形状自由,数值求和不可靠)。
//   - 配置命名空间 project-hub(scanRoot):复用 dsh-compat L1.hotConfig,默认
//     = 会话工作区(process.cwd()),热生效。
//   - 通道 GET/PUT /plugins/project-hub/api:复用 dsh-compat L1.channel 嵌套
//     inject 注册;每次命中实时扫描,无缓存;loopback 不加鉴权。
// 迭代7(2026-08-30,中文命名与需求背景可见):view=file 白名单加 REQUIREMENT.md
// (L507 由 name !== 'SUMMARY.md' 改为 name !== 'SUMMARY.md' && name !== 'REQUIREMENT.md',
// 一行小改;REQUIREMENT.md 与 SUMMARY.md 同属 .dsh-project/ 只读白名单文件,同走
// view=file 通道,不改通道契约/数据模型)。
// 迭代8(2026-08-31,project-hub-i8 搜索/筛选 + 归档/置顶写路径):
//   - 新增唯一写面:workspace 级 board view config(<scanRoot>/board-view.json),
//     形状 { items: { "<id>": { pinned: bool, archived: bool } } }。
//   - 纯函数 readBoardViewConfig / writeBoardViewConfig / applyBoardChange(可注入
//     deps,Node 可测);writeBoardViewConfig 原子写(临时文件 + rename)避免半写。
//   - 通道扩展:GET ?view=board 返回当前 board config;PUT { board: { id, archived?,
//     pinned? } } 校验后 applyBoardChange → 原子写 → 返回新 board。
//   - 安全护栏 AC-W1~W7:白名单字段 / 固定路径 / 无越权写 / id 存在校验 / 幂等 /
//     并发(last-write-wins) / 读容错(缺失/坏 JSON → 空配置,原子写)。
// 0.8.0 新增(预算账本改真实 token 计量,2026-08-31):
//   - computeTotals/budgetSummary/aggregateBudget 对 source=runtime-events 条目按桶
//     数值求和(byRole[role].tokens + 项目/工作区 totalTokens);self-report 维持计数。
//   - aggregateBudget 增 sharedOnce:扫全部项目 REGISTRY.sessions 判定共享会话
//     (role='intake' 或 ≥2 项目登记),读 projcache 取 tokenUsage 全工作区计一次。
//   - host 侧 projcache 定位与守卫与 preset 同规则:显式 config projcachePath 优先、
//     env DSH_HOME 回退、unit.version=3 守卫(≠3 中文报错不误解析)。
// 0.4.1 修复(本机复刻「设置卡保存角色模型必 400」后交付):
//   - 复现:单环境默认部署(settings.yaml 无 project-hub 节、web 进程未设 DSH_HOME)下,
//     PUT {settings:{roleModel}} → 400 "role manifest not found: dev";沉淀策略保存同理。
//     根因:resolvePresetRolesDir/resolveProjcachePath 只有 config → env DSH_HOME 两级,
//     作者环境显式设了 DSH_HOME 才可用,单环境默认部署两级皆空 → presetRolesDir=null。
//   - 修复:两 resolver 增第三级回退 homedir()/.dsh(与 dsh 单环境默认 dsh-home 一致,
//     同 toolkit paths.mjs 的 DSH_HOME 默认),无 env 时按标准安装位置解析 preset 角色与 projcache。
//   - 前端:看板零项目空态显示当前 scanRoot + 修改指引(扫错根不再静默空白);设置卡
//     每角色模型块显示保存落点与「须与流水线工作区一致」提示;角色卡编辑态增未保存徽章
//     (下拉改动不点保存=丢弃,不再无提示)。
import { readFile, readdir, stat, writeFile, rename, mkdir, copyFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  channel,
  hotConfig,
  buildNamespaceSchema,
  detectRuntime,
  assertUsable,
  readBody,
  sendJson,
} from './dsh-compat.mjs';

export const name = 'project-hub';

/** 配置命名空间(kebab-case,与 dsh-settings NAMESPACE_PATTERN 匹配)。 */
export const NAMESPACE = 'project-hub';

/** 自有 HTTP 通道路径(浏览器同源 fetch)。 */
export const API_ROUTE = '/plugins/project-hub/api';

/** SUMMARY 末段截断默认长度(字符)。 */
export const SUMMARY_TAIL_MAX = 500;

/** board view config 文件名(workspace 根 = scanRoot 下;唯一写面,非生产源码)。 */
export const BOARD_VIEW_FILE = 'board-view.json';

// ── 流水线设置服务常量(kr-control-plane:设置 UI 与每角色模型分层)────────────
export const LIBRARY_DIR = '.dsh-library';
export const TRASH_DIR_NAME = '.trash';
export const AUDIT_RULES_FILE = 'audit-rules.json';
export const RULINGS_FILE = 'rulings.json';
export const CATEGORIES_FILE = 'categories.json';
export const AUDIT_TRAIL_FILE = 'audit-trail.json';
export const ROLES_DIR = 'roles';
export const VOUCHER_N = 5;
export const KNOWN_ROLES = ['architect', 'product', 'dev', 'tester', 'deliverer', 'coordinator'];

// ── deps 注入(测试性实现细节)──────────────────────────────────────────────
// 生产默认取真实实现(node:fs/promises + process.cwd());单测注入 stub fs。
// 迭代8:扩展 writeFile / rename(原子写用;单测 stub 注入)。
// kr-control-plane:扩展 mkdir / copyFile(备份 .trash 用;单测 stub 注入)。
// kr-control-plane-i2:扩展 unlink(恢复默认移除 workspace 覆盖用;单测 stub 注入)。
function makeDeps(config = {}) {
  return {
    readFile: config.readFile ?? readFile,
    readdir: config.readdir ?? readdir,
    stat: config.stat ?? stat,
    writeFile: config.writeFile ?? writeFile,
    rename: config.rename ?? rename,
    mkdir: config.mkdir ?? mkdir,
    copyFile: config.copyFile ?? copyFile,
    unlink: config.unlink ?? unlink,
    cwd: config.cwd ?? (() => process.cwd()),
  };
}

// ── 错误分类(登记簿解析,SPEC §9 / DESIGN §9)───────────────────────────────
// 与 consumption-query 的"上游七类"不同,本插件读本地文件,分类针对登记簿解析。

/** 读错误分类:ENOENT → 归 malformed(缺失算解析失败);其他 code → unreadable;JSON 解析错 → malformed。 */
function classifyReadError(error, malformedCategory) {
  if (error?.code === 'ENOENT') {
    return { category: malformedCategory, message: String(error?.message ?? error) };
  }
  if (error?.code) {
    return { category: 'unreadable', message: String(error?.message ?? error) };
  }
  return { category: malformedCategory, message: String(error?.message ?? error) };
}

/** REGISTRY 形状校验:缺 id/title/state 任一 → 无法识别项目。 */
function isRegistryShape(registry) {
  return (
    registry !== null &&
    typeof registry === 'object' &&
    typeof registry.id === 'string' &&
    typeof registry.title === 'string' &&
    typeof registry.state === 'string'
  );
}

// ── 0.8.0 host 侧 projcache 读取与守卫(与 preset 同规则,内联同款实现)──────

/**
 * 读 projcache 文件并守卫 unit.version(AC-M3,host 侧)。
 * version===3 → 按已知结构解析;缺失或 ≠3 → 明确中文报错,不误解析。
 * 经 deps.readFile 注入(单测 stub fs)。
 */
export async function readProjcache(file, deps) {
  let text;
  try {
    text = await deps.readFile(file, 'utf8');
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
  return parsed;
}

/**
 * 取单会话 tokenUsage(有效计费口径 = uncachedInputTokens + outputTokens)。
 * 会话不在表内 / 结构缺失 → null。与 preset lib 同款形状。
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

// ── 预算聚合(SPEC §6 / DESIGN §6)───────────────────────────────────────────

/**
 * 按 committed 逐条聚合。对 source='runtime-events' 且 usage 含数值 token 的条目
 * 按桶数值求和(byRole[role].tokens + totalTokens);self-report 条目维持计数
 * (usage 形状自由,数值求和不可靠)。返回 { committedEntryCount, byRole, bySource, totalTokens }。
 */
function computeTotals(committed) {
  const byRole = {};
  const bySource = {};
  let totalTokens = 0;
  for (const entry of committed) {
    if (entry !== null && typeof entry === 'object') {
      if (typeof entry.role === 'string') {
        const role = entry.role;
        const cur = byRole[role] ?? (byRole[role] = { count: 0, tokens: 0 });
        cur.count += 1;
        if (entry.source === 'runtime-events' && typeof entry.usage?.tokens === 'number' && Number.isFinite(entry.usage.tokens)) {
          cur.tokens += entry.usage.tokens;
          totalTokens += entry.usage.tokens;
        }
      }
      if (typeof entry.source === 'string') bySource[entry.source] = (bySource[entry.source] ?? 0) + 1;
    }
  }
  return { committedEntryCount: committed.length, byRole, bySource, totalTokens };
}

/** 列表项 budget 摘要:estimate/cap 原样 + committed + totals(BUDGET.json 无 totals 时计算)。 */
function budgetSummary(budget) {
  const committed = Array.isArray(budget.committed) ? budget.committed : [];
  return {
    estimate: budget.estimate ?? null,
    cap: budget.cap ?? null,
    committed,
    totals: budget.totals ?? computeTotals(committed),
  };
}

/**
 * 工作区级预算聚合(SPEC §6.2 + 0.8.0 真实 token)。输入 = scanProjects 的列表项数组。
 * 每项目预算原样透传(estimate/cap/committed/totals);工作区级汇总:
 *   - projectCount = 有预算的项目数;committedEntryCount / byRole / bySource 计数;
 *   - totalTokens = 各项目 runtime-events 数值求和(项目账本只含私有会话);
 *   - sharedOnce = 扫全部项目 REGISTRY.sessions 判定共享会话(role='intake' 或 ≥2
 *     项目登记),读 projcache 取 tokenUsage 全工作区计一次,加入 totalTokens。
 * opts = { projcachePath, deps }。projcache 读失败 → sharedOnce 非致命跳过。
 */
export async function aggregateBudget(projects, opts = {}) {
  const { projcachePath, deps } = opts;
  const out = {
    projects: [],
    workspace: { projectCount: 0, committedEntryCount: 0, byRole: {}, bySource: {}, totalTokens: 0, sharedOnce: 0 },
  };
  const sessionProjectCount = new Map();
  const sessionRoles = new Map();
  for (const p of projects) {
    const b = p?.budget;
    if (b === null || b === undefined || typeof b !== 'object') continue;
    out.workspace.projectCount += 1;
    const committed = Array.isArray(b.committed) ? b.committed : [];
    out.workspace.committedEntryCount += committed.length;
    for (const entry of committed) {
      if (entry !== null && typeof entry === 'object') {
        if (typeof entry.role === 'string') {
          const role = entry.role;
          const cur = out.workspace.byRole[role] ?? (out.workspace.byRole[role] = { count: 0, tokens: 0 });
          cur.count += 1;
          if (entry.source === 'runtime-events' && typeof entry.usage?.tokens === 'number' && Number.isFinite(entry.usage.tokens)) {
            cur.tokens += entry.usage.tokens;
            out.workspace.totalTokens += entry.usage.tokens;
          }
        }
        if (typeof entry.source === 'string') out.workspace.bySource[entry.source] = (out.workspace.bySource[entry.source] ?? 0) + 1;
      }
    }
    const sessions = p?.sessions;
    if (sessions && typeof sessions === 'object') {
      for (const [sid, meta] of Object.entries(sessions)) {
        sessionProjectCount.set(sid, (sessionProjectCount.get(sid) ?? 0) + 1);
        if (sessionRoles.get(sid) === undefined) sessionRoles.set(sid, meta?.role);
      }
    }
    out.projects.push({
      id: p.id,
      estimate: b.estimate ?? null,
      cap: b.cap ?? null,
      committed,
      totals: b.totals ?? computeTotals(committed),
    });
  }
  // sharedOnce:扫全部项目 REGISTRY.sessions 判定共享会话,读 projcache 计一次。
  if (projcachePath && deps) {
    try {
      const projcache = await readProjcache(projcachePath, deps);
      let sharedOnce = 0;
      for (const [sid, count] of sessionProjectCount) {
        const isShared = sessionRoles.get(sid) === 'intake' || count >= 2;
        if (!isShared) continue;
        const usage = sessionTokenUsage(projcache, sid);
        if (usage) sharedOnce += usage.uncachedInputTokens + usage.outputTokens;
      }
      out.workspace.sharedOnce = sharedOnce;
      out.workspace.totalTokens += sharedOnce;
    } catch {
      // 非致命:sharedOnce 读失败不炸聚合
    }
  }
  return out;
}

// ── 门禁包解析(SPEC §5.3 / DESIGN §5.3)─────────────────────────────────────

/** 从门禁文件取"摘要"节文本(首个 ### 摘要 后的段落);解析失败 → undefined。 */
export function parseGateSummary(text) {
  if (typeof text !== 'string') return undefined;
  const idx = text.indexOf('### 摘要');
  if (idx < 0) return undefined;
  const rest = text.slice(idx + '### 摘要'.length);
  const lines = rest.split(/\r?\n/);
  const para = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      if (para.length > 0) break;
      continue;
    }
    if (/^#{1,3}\s/.test(trimmed)) break;
    para.push(trimmed);
  }
  return para.length > 0 ? para.join(' ') : undefined;
}

/** 从门禁文件取标题(第 1 行 `# 门禁:<title>(<stageId>)`);失败 → undefined。 */
export function extractGateTitle(text) {
  if (typeof text !== 'string') return undefined;
  const m = text.match(/^#\s*门禁[:：]\s*(.+?)\s*\(/);
  return m ? m[1].trim() : undefined;
}

/** 从门禁文件取裁决结论(`- 结论:<verdict>`);无裁决 → undefined。 */
export function extractGateVerdict(text) {
  if (typeof text !== 'string') return undefined;
  const m = text.match(/^-\s*结论[:：]\s*(\S+)/m);
  return m ? m[1].trim() : undefined;
}

/** 从门禁文件取首个呈递时间(`## 第 N 轮呈递(<ISO>)`);无 → undefined。 */
export function extractGatePresentedAt(text) {
  if (typeof text !== 'string') return undefined;
  const m = text.match(/^##\s*第\s*\d+\s*轮呈递\s*\(([^)]+)\)/m);
  return m ? m[1].trim() : undefined;
}

/** 从门禁文件取首个裁决时间(`### 裁决(<ISO>)`);无 → undefined。 */
export function extractGateDecidedAt(text) {
  if (typeof text !== 'string') return undefined;
  const m = text.match(/^###\s*裁决\s*\(([^)]+)\)/m);
  return m ? m[1].trim() : undefined;
}

/** 从 journal 文件取首个进入时间(`- 进入时间:<ISO>`);无 → null。 */
export function extractJournalStart(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(/^-\s*进入时间[:：]\s*(\S+)/m);
  return m ? m[1].trim() : null;
}

/** 从 journal 文件名取 stageId(`NN-<stageId>.md`);无前缀 → 去 .md 后缀。 */
export function journalStageId(filename) {
  const m = filename.match(/^[0-9]+-(.+)\.md$/);
  return m ? m[1] : filename.replace(/\.md$/, '');
}

/** 解析 gates/ 下单个门禁文件为 §5.1 gates[] 条目。 */
export function parseGateFile(filename, text) {
  const m = filename.match(/^[0-9]+-(.+)\.md$/);
  const stageId = m ? m[1] : filename.replace(/\.md$/, '');
  const entry = {
    stageId,
    title: extractGateTitle(text) ?? stageId,
    file: `gates/${filename}`,
  };
  const verdict = extractGateVerdict(text);
  if (verdict) entry.verdict = verdict;
  // kr-board-time-token(R5):补呈递/裁决时间(首个呈递/裁决行 ISO;无 → undefined)。
  const presentedAt = extractGatePresentedAt(text);
  if (presentedAt) entry.presentedAt = presentedAt;
  const decidedAt = extractGateDecidedAt(text);
  if (decidedAt) entry.decidedAt = decidedAt;
  return entry;
}

/** 找 gates/ 下匹配 `NN-<stageId>.md` 的门禁文件并解析 pendingGate(§4.4)。 */
async function readPendingGate(dshDir, stageId, deps) {
  const gate = { stageId, title: stageId };
  let files;
  try {
    files = await deps.readdir(join(dshDir, 'gates'), { withFileTypes: true });
  } catch {
    return gate;
  }
  const escaped = stageId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const target = files.find((f) => f.isFile() && new RegExp(`^[0-9]+-${escaped}\\.md$`).test(f.name));
  if (!target) return gate;
  let text;
  try {
    text = await deps.readFile(join(dshDir, 'gates', target.name), 'utf8');
  } catch {
    return gate;
  }
  const title = extractGateTitle(text);
  if (title) gate.title = title;
  const summary = parseGateSummary(text);
  if (summary) gate.summary = summary;
  return gate;
}

// ── SUMMARY 末段截断(SPEC §5.2 / DESIGN §5.2)──────────────────────────────

/** SUMMARY.md 末段截断:按 `## ` / `---` 切块取末块,截断到 maxLen;切分失败取全文截断。 */
export function summaryTail(text, maxLen = SUMMARY_TAIL_MAX) {
  if (typeof text !== 'string' || text.length === 0) return null;
  const blocks = text.split(/\n(?=## |---)/);
  const last = (blocks[blocks.length - 1] ?? text).trim();
  if (last.length <= maxLen) return last;
  return `${last.slice(0, maxLen)}…`;
}

// ── 登记簿读视图服务(SPEC §4 / DESIGN §4)─────────────────────────────────

/**
 * 扫描 scanRoot 下全部 .dsh-project/,归一化为 §4.1 列表项数组(含错误分类)。
 * 单项目解析失败不拖垮整体:坏项目带 { id, error },其余项目照常返回。
 * scanRoot 不可读 → 返回 []。
 */
export async function scanProjects(scanRoot, deps) {
  let entries;
  try {
    entries = await deps.readdir(scanRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    const projectDir = join(scanRoot, id);
    const dshDir = join(projectDir, '.dsh-project');
    let isDsh;
    try {
      isDsh = (await deps.stat(dshDir)).isDirectory();
    } catch {
      isDsh = false;
    }
    if (!isDsh) continue;
    projects.push(await parseProject(id, projectDir, dshDir, deps));
  }
  return projects;
}

/** 解析单个项目为 §4.1 列表项(含错误分类)。 */
async function parseProject(id, projectDir, dshDir, deps) {
  // 1. REGISTRY(最高优先级:项目无法识别 → 整项错误分类)
  let registry;
  try {
    registry = JSON.parse(await deps.readFile(join(dshDir, 'REGISTRY.json'), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { id, error: { category: 'missing-registry', message: String(error?.message ?? error) } };
    }
    return { id, error: classifyReadError(error, 'malformed-registry') };
  }
  if (!isRegistryShape(registry)) {
    return { id, error: { category: 'malformed-registry', message: 'REGISTRY.json missing required fields (id/title/state)' } };
  }

  const item = {
    id: registry.id ?? id,
    title: registry.title ?? registry.id ?? id,
    state: registry.state ?? 'active',
    iteration: registry.iteration ?? 1,
    stageIndex: registry.stageIndex ?? 0,
    currentStage: null,
    stageCount: null,
    gateStatus: registry.gateStatus ?? null,
    pendingGate: null,
    budget: null,
    hasSummary: false,
    updatedAt: registry.updatedAt ?? null,
    // kr-board-time-token(R3):透传 REGISTRY.createdAt(项目开始时间;无 → null)。
    createdAt: registry.createdAt ?? null,
    // 0.8.0:透传 REGISTRY.sessions(供 aggregateBudget 判定共享会话 sharedOnce)。
    sessions: registry.sessions ?? null,
  };

  // 2. FLOW(REGISTRY 正常后,坏 FLOW → 项目仍返回,currentStage=null + 错误分类)
  let flowError = null;
  let flow = null;
  try {
    flow = JSON.parse(await deps.readFile(join(dshDir, 'FLOW.json'), 'utf8'));
  } catch (error) {
    flowError = classifyReadError(error, 'malformed-flow');
  }
  if (flow !== null && typeof flow === 'object' && Array.isArray(flow.stages)) {
    item.stageCount = flow.stages.length;
    const stage = flow.stages[item.stageIndex];
    if (stage && typeof stage === 'object') {
      item.currentStage = {
        id: stage.id,
        type: stage.type,
        role: stage.type === 'work' ? (stage.role ?? null) : null,
      };
    } else {
      flowError = { category: 'malformed-flow', message: `stageIndex ${item.stageIndex} out of range` };
    }
  } else if (flow !== null && typeof flow === 'object') {
    flowError = { category: 'malformed-flow', message: 'FLOW.json missing stages array' };
  }

  // 3. BUDGET(坏 BUDGET → budget=null + 错误分类,不拖垮项目)
  let budgetError = null;
  let budget = null;
  try {
    budget = JSON.parse(await deps.readFile(join(dshDir, 'BUDGET.json'), 'utf8'));
  } catch (error) {
    budgetError = classifyReadError(error, 'malformed-budget');
  }
  if (budget !== null && typeof budget === 'object') {
    item.budget = budgetSummary(budget);
  }

  // 4. SUMMARY(缺失 → hasSummary=false,非致命)
  try {
    await deps.readFile(join(dshDir, 'SUMMARY.md'), 'utf8');
    item.hasSummary = true;
  } catch {
    item.hasSummary = false;
  }

  // 5. pendingGate(§4.4:gateStatus==="pending" 且当前阶段为 gate)
  if (item.gateStatus === 'pending' && item.currentStage && item.currentStage.type === 'gate') {
    item.pendingGate = await readPendingGate(dshDir, item.currentStage.id, deps);
  }

  // 错误分类(非致命):FLOW 优先于 BUDGET(§9 优先级 2)
  if (flowError) item.error = flowError;
  else if (budgetError) item.error = budgetError;

  return item;
}

/**
 * 读单项目详情(§4.2);id 不存在或无法识别 → null。
 */
export async function readProject(scanRoot, id, deps) {
  const projectDir = join(scanRoot, id);
  const dshDir = join(projectDir, '.dsh-project');
  let isDsh;
  try {
    isDsh = (await deps.stat(dshDir)).isDirectory();
  } catch {
    return null;
  }
  if (!isDsh) return null;

  let registry;
  try {
    registry = JSON.parse(await deps.readFile(join(dshDir, 'REGISTRY.json'), 'utf8'));
  } catch {
    return null;
  }
  if (!isRegistryShape(registry)) return null;

  let flow = null;
  try {
    flow = JSON.parse(await deps.readFile(join(dshDir, 'FLOW.json'), 'utf8'));
  } catch {
    flow = null;
  }

  let budget = null;
  try {
    budget = JSON.parse(await deps.readFile(join(dshDir, 'BUDGET.json'), 'utf8'));
  } catch {
    budget = null;
  }

  let summary = null;
  try {
    summary = summaryTail(await deps.readFile(join(dshDir, 'SUMMARY.md'), 'utf8'));
  } catch {
    summary = null;
  }

  let gates = [];
  try {
    const files = await deps.readdir(join(dshDir, 'gates'), { withFileTypes: true });
    for (const f of files) {
      if (!f.isFile() || !/^[0-9]+-.+\.md$/.test(f.name)) continue;
      let text;
      try {
        text = await deps.readFile(join(dshDir, 'gates', f.name), 'utf8');
      } catch {
        continue;
      }
      gates.push(parseGateFile(f.name, text));
    }
    gates.sort((a, b) => a.file.localeCompare(b.file));
  } catch {
    gates = [];
  }

  // kr-board-time-token(R5/R4):journals 从 string 数组改为对象数组
  // { file, stageId, start }(start=journal 首个进入时间,无 → null)。这是本单
  // 唯一破坏性 API 变更,须同步改 client.js 记录 tab 渲染与 host 测试。
  let journals = [];
  try {
    const files = await deps.readdir(join(dshDir, 'journal'), { withFileTypes: true });
    const names = files.filter((f) => f.isFile()).map((f) => f.name).sort();
    for (const name of names) {
      let start = null;
      try {
        start = extractJournalStart(await deps.readFile(join(dshDir, 'journal', name), 'utf8'));
      } catch {
        start = null;
      }
      journals.push({ file: name, stageId: journalStageId(name), start });
    }
  } catch {
    journals = [];
  }
  // kr-board-time-token(R4):阶段开始时间 = journal 首个进入时间(无 journal → null)。
  const stageTimes = journals.map((j) => ({ stageId: j.stageId, start: j.start }));

  let pendingGate = null;
  const currentStage = flow !== null && typeof flow === 'object' && Array.isArray(flow.stages)
    ? flow.stages[registry.stageIndex]
    : null;
  if (registry.gateStatus === 'pending' && currentStage && typeof currentStage === 'object' && currentStage.type === 'gate') {
    pendingGate = await readPendingGate(dshDir, currentStage.id, deps);
  }

  return {
    id: registry.id ?? id,
    title: registry.title ?? registry.id ?? id,
    registry,
    flow,
    budget,
    summary,
    summaryFile: 'SUMMARY.md',
    gates,
    stageTimes,
    pendingGate,
    journals,
    stageCount: flow !== null && typeof flow === 'object' && Array.isArray(flow.stages) ? flow.stages.length : null,
  };
}

// ── board view config 读写(迭代8,唯一写面)────────────────────────────────

/**
 * 读 board view config(<scanRoot>/board-view.json)。
 * 读容错(AC-W7):文件缺失 / 坏 JSON → 回退空配置 { items: {} },不炸。
 * 形状:{ items: { "<id>": { pinned: bool, archived: bool } } }。
 */
export async function readBoardViewConfig(scanRoot, deps) {
  let text;
  try {
    text = await deps.readFile(join(scanRoot, BOARD_VIEW_FILE), 'utf8');
  } catch {
    return { items: {} };
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const items = parsed.items !== null && typeof parsed.items === 'object' && !Array.isArray(parsed.items)
        ? parsed.items
        : {};
      return { items };
    }
    return { items: {} };
  } catch {
    return { items: {} };
  }
}

/**
 * 应用单项目单字段变更(幂等 set/clear,AC-W5)。纯函数,不依赖 deps。
 * change = { id, archived?, pinned? };返回新 board config(不修改入参)。
 */
export function applyBoardChange(board, change) {
  const items = board !== null && typeof board === 'object' && board.items !== null && typeof board.items === 'object' && !Array.isArray(board.items)
    ? { ...board.items }
    : {};
  const id = change.id;
  const cur = items[id] !== null && typeof items[id] === 'object' && !Array.isArray(items[id])
    ? { ...items[id] }
    : {};
  if (change.archived !== undefined) cur.archived = change.archived;
  if (change.pinned !== undefined) cur.pinned = change.pinned;
  items[id] = cur;
  return { items };
}

/**
 * 原子写 board view config(AC-W7):临时文件 + rename,避免半写。
 * 路径固定 = join(scanRoot, BOARD_VIEW_FILE)(AC-W2),不接受任意路径。
 */
export async function writeBoardViewConfig(scanRoot, board, deps) {
  const target = join(scanRoot, BOARD_VIEW_FILE);
  const tmp = `${target}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const payload = JSON.stringify(board, null, 2);
  await deps.writeFile(tmp, payload, 'utf8');
  await deps.rename(tmp, target);
  return board;
}

/** 校验项目存在(id 引用已存在项目,AC-W4):<scanRoot>/<id>/.dsh-project 为目录。 */
async function projectExists(scanRoot, id, deps) {
  try {
    return (await deps.stat(join(scanRoot, id, '.dsh-project'))).isDirectory();
  } catch {
    return false;
  }
}

// ── 流水线设置服务(kr-control-plane:设置 UI 与每角色模型分层)──────────────
// 唯一写面 = audit-rules.json + workspace 角色覆盖文件(<scanRoot>/.dsh-library/roles/<role>.json);
// 均经 API 层,护栏单列 AC-A2;写前备份 .trash + 原子写(temp+rename)。
// rulings.json / categories.json 只读展示(无写端点,AC-A3)。
// 来源判定:workspace 覆盖 > preset 声明 > 默认继承;source ∈ {workspace, preset, default}。

/** 校验错误(护栏 400 用);备份/原子写失败走 500,不归此类。 */
class SettingsValidationError extends Error {}

/** 读 JSON 文件,缺失/坏 JSON → fallback(不炸)。 */
async function readJsonSafe(deps, file, fallback) {
  let text;
  try {
    text = await deps.readFile(file, 'utf8');
  } catch {
    return fallback;
  }
  try {
    const parsed = JSON.parse(text);
    return parsed === null || typeof parsed !== 'object' ? fallback : parsed;
  } catch {
    return fallback;
  }
}

/** 读 audit-rules.json(读容错:缺失/坏 JSON → 空结构,不炸)。 */
export async function readAuditRules(scanRoot, deps) {
  return readJsonSafe(deps, join(scanRoot, LIBRARY_DIR, AUDIT_RULES_FILE), { schemaVersion: 1, meta: {}, rules: [] });
}

/** 读 rulings.json(只读展示,AC-A3)。 */
export async function readRulings(scanRoot, deps) {
  return readJsonSafe(deps, join(scanRoot, LIBRARY_DIR, RULINGS_FILE), { rulings: [] });
}

/** 读 categories.json(只读展示,AC-A3)。 */
export async function readCategories(scanRoot, deps) {
  return readJsonSafe(deps, join(scanRoot, LIBRARY_DIR, CATEGORIES_FILE), { categories: [] });
}

/** 读单角色 manifest(workspace 覆盖优先,preset 兜底);都无 → null。 */
async function readRoleManifest(scanRoot, presetRolesDir, roleId, deps) {
  const ws = await readJsonSafe(deps, join(scanRoot, LIBRARY_DIR, ROLES_DIR, `${roleId}.json`), null);
  if (ws !== null && typeof ws === 'object' && typeof ws.id === 'string') return { manifest: ws, source: 'workspace' };
  if (presetRolesDir) {
    const preset = await readJsonSafe(deps, join(presetRolesDir, `${roleId}.json`), null);
    if (preset !== null && typeof preset === 'object' && typeof preset.id === 'string') return { manifest: preset, source: 'preset' };
  }
  return null;
}

/**
 * 每角色 effectiveModel + source(workspace > preset > default)。
 * 输出扁平字符串:{ role, provider, model, source } —— manifest.model 兼容对象
 * ({provider,model})与字符串两种形态;无声明时解析 subagent-defaults
 * (settings.yaml,用户默认档)回填 provider/model,source 仍为 'default'。
 * settingsService 可选:不传或取数失败 → 默认档不解析(provider/model 保持 null)。
 */
export async function readRoleModels(scanRoot, presetRolesDir, deps, settingsService) {
  let defaults = null;
  try {
    const raw = settingsService && typeof settingsService.get === 'function' ? settingsService.get('subagent-defaults') : null;
    defaults = raw !== null && typeof raw === 'object' && raw.agentOptions !== null && typeof raw.agentOptions === 'object' ? raw.agentOptions : null;
  } catch {
    defaults = null;
  }
  const roles = [];
  for (const roleId of KNOWN_ROLES) {
    const entry = await readRoleManifest(scanRoot, presetRolesDir, roleId, deps);
    const declared = entry?.manifest?.model ?? null;
    let provider = null;
    let model = null;
    if (typeof declared === 'string' && declared.length > 0) {
      model = declared;
    } else if (declared !== null && typeof declared === 'object' && !Array.isArray(declared)) {
      if (typeof declared.model === 'string' && declared.model.length > 0) model = declared.model;
      if (typeof declared.provider === 'string' && declared.provider.length > 0) provider = declared.provider;
    }
    const source = entry ? (model ? entry.source : 'default') : 'default';
    if (provider === null && defaults && typeof defaults.provider === 'string' && defaults.provider.length > 0) provider = defaults.provider;
    if (model === null && defaults && typeof defaults.model === 'string' && defaults.model.length > 0) model = defaults.model;
    roles.push({ role: roleId, provider, model, source });
  }
  return roles;
}

/** 最近 N 条 audit-run-voucher 凭证(id/returnHash/ts)。 */
export async function readAuditVouchers(scanRoot, deps, n = VOUCHER_N) {
  const trail = await readJsonSafe(deps, join(scanRoot, LIBRARY_DIR, AUDIT_TRAIL_FILE), []);
  if (!Array.isArray(trail)) return [];
  return trail
    .filter((e) => e !== null && typeof e === 'object' && e.type === 'audit-run-voucher')
    .sort((a, b) => String(b.ts ?? '').localeCompare(String(a.ts ?? '')))
    .slice(0, n)
    .map((e) => ({ id: e.id ?? null, returnHash: e.returnHash ?? null, ts: e.ts ?? null }));
}

/** 读全部设置载荷(块 A 策略 + 块 B 模型 + 凭证)。 */
export async function readSettings(scanRoot, opts = {}, deps) {
  const presetRolesDir = opts.presetRolesDir ?? null;
  const [auditRules, rulings, categories, roles, auditVouchers] = await Promise.all([
    readAuditRules(scanRoot, deps),
    readRulings(scanRoot, deps),
    readCategories(scanRoot, deps),
    readRoleModels(scanRoot, presetRolesDir, deps, opts.settingsService),
    readAuditVouchers(scanRoot, deps),
  ]);
  return { auditRules, rulings, categories, roles, auditVouchers };
}

/**
 * C-A 只读模型清单(design-gate round 3 硬约束):选模型=选 dsh 已配置模型清单。
 * 数据源 = settingsService.get('llm-pi-ai')?.providers(settings.yaml 各 provider 下
 * 实际配置的 provider+model 组合),只读暴露,不写。
 * 映射:对 providers 字典逐 provider,取 { provider: <id>, model: <providers[id].model> };
 * 仅暴露 provider+model,不暴露 apiKey/baseURL 等敏感字段。
 * 兜底:providers 缺失/为空 → { ok:true, models:[] };settingsService 不可达/取数抛错
 * → 显式 { ok:false, error:'模型清单不可用' }(C-B,不得臆造条目)。
 * 纯函数,不依赖 deps,Node 可测。
 */
export function readConfiguredModels(settingsService) {
  if (settingsService === null || settingsService === undefined || typeof settingsService.get !== 'function') {
    return { ok: false, error: '模型清单不可用' };
  }
  let llm;
  try {
    llm = settingsService.get('llm-pi-ai');
  } catch {
    return { ok: false, error: '模型清单不可用' };
  }
  const providers = llm !== null && typeof llm === 'object' && !Array.isArray(llm) ? llm.providers : null;
  if (providers === null || providers === undefined || typeof providers !== 'object' || Array.isArray(providers)) {
    return { ok: true, models: [] };
  }
  const models = [];
  for (const [provider, cfg] of Object.entries(providers)) {
    if (cfg === null || typeof cfg !== 'object') continue;
    // 真实形状(settings.yaml llm-pi-ai):providers.<名>.models = [{ id, name?, contextWindow?, maxTokens? }]
    if (Array.isArray(cfg.models)) {
      for (const m of cfg.models) {
        if (m === null || typeof m !== 'object' || typeof m.id !== 'string' || m.id.length === 0) continue;
        const entry = { provider, model: m.id };
        if (typeof m.name === 'string' && m.name.length > 0) entry.name = m.name;
        if (Number.isFinite(m.contextWindow)) entry.contextWindow = m.contextWindow;
        models.push(entry);
      }
      continue;
    }
    // 兼容形状:单模型字符串 cfg.model
    if (typeof cfg.model === 'string' && cfg.model.length > 0) {
      models.push({ provider, model: cfg.model });
    }
  }
  return { ok: true, models };
}

/**
 * C-D 护栏(design-gate round 3 硬约束):UI 写 audit-rules.json 必须读-改-写——
 * 只动 meta.sedimentation,rules[] 原样透传,不得整体覆盖清掉 rules[]。
 * 纯函数:输入当前 auditRules + 新的 sedimentation 对象,返回新 auditRules
 * (深拷贝,不改入参),仅替换 meta.sedimentation,rules[] 及其余字段原样透传。
 * 浏览器半面 client.js 内置等价实现,本函数为可单测的权威副本(AC-B3 断言)。
 */
export function applySedimentationChange(current, nextSedimentation) {
  const next = JSON.parse(JSON.stringify(
    current !== null && typeof current === 'object' && !Array.isArray(current)
      ? current
      : { schemaVersion: 1, meta: {}, rules: [] },
  ));
  if (next.meta === null || typeof next.meta !== 'object' || Array.isArray(next.meta)) next.meta = {};
  next.meta.sedimentation = JSON.parse(JSON.stringify(
    nextSedimentation !== null && typeof nextSedimentation === 'object' && !Array.isArray(nextSedimentation)
      ? nextSedimentation
      : {},
  ));
  return next;
}

/** 护栏纯函数(AC-A2):校验 audit-rules 载荷形状。返回 { ok, error? }。 */
export function validateAuditRulesPayload(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'auditRules must be an object' };
  }
  const allowed = new Set(['schemaVersion', 'meta', 'rules']);
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) return { ok: false, error: `unknown field: ${key}` };
  }
  if (payload.meta !== undefined && (payload.meta === null || typeof payload.meta !== 'object' || Array.isArray(payload.meta))) {
    return { ok: false, error: 'meta must be an object' };
  }
  if (payload.rules !== undefined && !Array.isArray(payload.rules)) {
    return { ok: false, error: 'rules must be an array' };
  }
  if (Array.isArray(payload.rules)) {
    const seen = new Set();
    for (const rule of payload.rules) {
      if (rule === null || typeof rule !== 'object' || typeof rule.id !== 'string' || rule.id.length === 0) {
        return { ok: false, error: 'each rule must have a non-empty string id' };
      }
      // 新增重复 id 护栏:规则表内 id 须唯一(AC-A2)。
      if (seen.has(rule.id)) return { ok: false, error: `duplicate rule id: ${rule.id}` };
      seen.add(rule.id);
    }
  }
  return { ok: true };
}

/**
 * reconcile 纯函数(AC-R2 修复):结构化沉降控件(spinbutton everyNDelivered / checkbox
 * enabled)显示的是「最近一次用户操作的真值」,写入 auditDraft.meta.sedimentation;JSON
 * 文本框(metaText)是另一编辑面。保存时二者必须合并且互不吞并:
 *   - dirtyKeys = 本次会话中被用户真实改过的沉降键(结构化控件发生过 onChange,浏览器
 *     侧 client.js 用独立 dirtySed 状态跟踪);
 *   - 命中的键以结构化真值覆盖 JSON 文本面 —— 保证「改 spinbutton 显示值进 PUT body」;
 *   - 未命中的键原样保留 JSON 文本面 —— 保证 meta JSON 文本框直编路径不回归。
 * 返回新 meta 对象(深拷贝,不改入参)。浏览器半面 client.js 内置等价实现,
 * 本函数为可单测的权威副本(project-hub.test.mjs 断言)。
 */
export function reconcileSedimentation(parsedMeta, structuredSedimentation, dirtyKeys) {
  const meta = JSON.parse(JSON.stringify(parsedMeta && typeof parsedMeta === 'object' ? parsedMeta : {}));
  if (!structuredSedimentation || typeof structuredSedimentation !== 'object') return meta;
  const keys = Array.isArray(dirtyKeys) ? dirtyKeys : [];
  for (const key of keys) {
    if (key in structuredSedimentation) {
      if (!meta.sedimentation || typeof meta.sedimentation !== 'object') meta.sedimentation = {};
      meta.sedimentation[key] = structuredSedimentation[key];
    }
  }
  return meta;
}

/** 备份旧文件到 <scanRoot>/.trash/<flat>.<ts>.bak(relPath 相对 .dsh-library)。 */
async function backupToTrash(scanRoot, relPath, deps) {
  const src = join(scanRoot, LIBRARY_DIR, relPath);
  const trashDir = join(scanRoot, TRASH_DIR_NAME);
  await deps.mkdir(trashDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const flat = relPath.replaceAll(/[\\/:*?"<>|]/g, '_');
  const dest = join(trashDir, `${flat}.${ts}.bak`);
  await deps.copyFile(src, dest);
  return dest;
}

/** 原子写 JSON 到 <scanRoot>/.dsh-library/<relPath>(temp + rename)。 */
async function atomicWriteJson(scanRoot, relPath, value, deps) {
  const target = join(scanRoot, LIBRARY_DIR, relPath);
  const tmp = `${target}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await deps.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await deps.rename(tmp, target);
  return value;
}

/** 写 audit-rules.json:校验 → 备份 .trash → 原子写。校验错抛 SettingsValidationError(400)。 */
export async function writeAuditRules(scanRoot, next, deps) {
  const checked = validateAuditRulesPayload(next);
  if (!checked.ok) throw new SettingsValidationError(checked.error);
  // 全量状态替换语义(AC-A1「规则表增删改」):新 id=新增(允许,不要求存在于现有
  // rules[]),既有 id=修改(允许),从数组移除=删除(允许)。护栏(AC-A2)只校验
  // 形状/未知字段/重复 id(由 validateAuditRulesPayload 承担),不再以「id 不存在
  // 于现有 rules[]」拒绝新增——那会封死「增」,与需求 A-1 及 UI 新增按钮矛盾(D1)。
  await backupToTrash(scanRoot, AUDIT_RULES_FILE, deps);
  return atomicWriteJson(scanRoot, AUDIT_RULES_FILE, next, deps);
}

/** 写 workspace 角色覆盖:读 preset 角色 → 复制 + 设 model → 打用户批准标记 → 备份 → 原子写。 */
export async function writeRoleModel(scanRoot, presetRolesDir, change, deps) {
  const role = change.role;
  if (!KNOWN_ROLES.includes(role)) throw new SettingsValidationError(`unknown role: ${role}`);
  if (typeof change.provider !== 'string' || change.provider.length === 0) throw new SettingsValidationError('provider must be a non-empty string');
  if (typeof change.model !== 'string' || change.model.length === 0) throw new SettingsValidationError('model must be a non-empty string');
  const preset = await readRoleManifest(scanRoot, presetRolesDir, role, deps);
  if (!preset) throw new SettingsValidationError(`role manifest not found: ${role}`);
  // 防伪造硬约束 AC:模型变更仅经设置 UI(用户亲自操作即用户同意),写面打用户批准标记
  // modelApproval(设置 UI 操作记录)。流水线角色不得自行变更模型;任何非默认模型声明
  // 须携带该标记,否则 checkModelApproval 判为伪造漂移。
  const manifest = {
    ...preset.manifest,
    model: { provider: change.provider, model: change.model },
    modelApproval: { by: 'user', ts: new Date().toISOString() },
  };
  const relPath = join(ROLES_DIR, `${role}.json`);
  // 备份既有 workspace 覆盖(若存在)。
  try {
    await deps.readFile(join(scanRoot, LIBRARY_DIR, relPath), 'utf8');
    await backupToTrash(scanRoot, relPath, deps);
  } catch {
    // 无既有覆盖,跳过备份
  }
  await deps.mkdir(join(scanRoot, LIBRARY_DIR, ROLES_DIR), { recursive: true });
  return atomicWriteJson(scanRoot, relPath, manifest, deps);
}

/**
 * C3 恢复默认(design-gate round 3 硬约束,卡点 b1 裁决方案 A):移除 workspace 角色覆盖,
 * 使该角色回退到 preset 声明 / 默认继承(source 判定 workspace>preset>default,覆盖移除后
 * 无 workspace 覆盖 → source 变 preset 或 default)。
 * 校验:role 须为已知角色(否则 400)。备份既有覆盖到 .trash(若存在)后 unlink 移除。
 * 返回 { role, reset:true }。无既有覆盖(ENOENT)视为幂等成功(已处于默认态)。
 */
export async function resetRoleModel(scanRoot, role, deps) {
  if (!KNOWN_ROLES.includes(role)) throw new SettingsValidationError(`unknown role: ${role}`);
  const relPath = join(ROLES_DIR, `${role}.json`);
  const target = join(scanRoot, LIBRARY_DIR, relPath);
  // 备份既有 workspace 覆盖(若存在)到 .trash,然后移除。
  try {
    await deps.readFile(target, 'utf8');
    await backupToTrash(scanRoot, relPath, deps);
  } catch {
    // 无既有覆盖,跳过备份
  }
  try {
    await deps.unlink(target);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return { role, reset: true };
}

// ── 配置命名空间(SPEC §8 / DESIGN §8)──────────────────────────────────────

/**
 * 构造命名空间 schema(dsh-compat 的 schemastery 兼容信封)。
 * 解析语义:未知键剥离;scanRoot 须为非空字符串;section 缺失/空 → {}(回退默认扫描根)。
 * 0.8.0:增 projcachePath(projcache 检查点文件绝对路径;默认回退 env DSH_HOME)。
 */
export function buildSchema() {
  const shape = {
    type: 'object',
    meta: { description: 'project-hub 项目中心配置。' },
    dict: {
      scanRoot: { type: 'string', meta: { description: '扫描根目录(绝对路径);默认=会话工作区(process.cwd())。' } },
      projcachePath: { type: 'string', meta: { description: 'projcache 检查点文件绝对路径;默认回退 env DSH_HOME/storages/session_projcache.json。' } },
      presetRolesDir: { type: 'string', meta: { description: 'preset 角色目录绝对路径;默认 $DSH_HOME/.agent-presets/project-pipeline/roles/。' } },
    },
  };
  return buildNamespaceSchema(NAMESPACE, shape, (section) => {
    if (section === undefined || section === null) return {};
    if (typeof section !== 'object' || Array.isArray(section)) {
      throw new TypeError('project-hub section must be an object of keys');
    }
    const cleaned = {};
    if (section.scanRoot !== undefined) {
      if (typeof section.scanRoot !== 'string' || section.scanRoot.length === 0) {
        throw new TypeError('project-hub.scanRoot must be a non-empty string');
      }
      cleaned.scanRoot = section.scanRoot;
    }
    if (section.projcachePath !== undefined) {
      if (typeof section.projcachePath !== 'string' || section.projcachePath.length === 0) {
        throw new TypeError('project-hub.projcachePath must be a non-empty string');
      }
      cleaned.projcachePath = section.projcachePath;
    }
    if (section.presetRolesDir !== undefined) {
      if (typeof section.presetRolesDir !== 'string' || section.presetRolesDir.length === 0) {
        throw new TypeError('project-hub.presetRolesDir must be a non-empty string');
      }
      cleaned.presetRolesDir = section.presetRolesDir;
    }
    return cleaned;
  });
}

/** 解析当前扫描根:命名空间有 scanRoot 用之,否则回退默认(会话工作区)。 */
export function resolveScanRoot(settingsService, deps) {
  const value = settingsService?.get?.(NAMESPACE);
  if (value !== null && value !== undefined && typeof value === 'object' && typeof value.scanRoot === 'string' && value.scanRoot.length > 0) {
    return value.scanRoot;
  }
  return deps.cwd();
}

/**
 * 解析 projcache 路径(0.8.0):显式 config projcachePath 优先,env DSH_HOME 回退,
 * 0.4.1 再回退 homedir()/.dsh(单环境默认 dsh-home,进程未设 DSH_HOME 的标准部署)。
 * 都没有(理论不可达)→ null(聚合时 sharedOnce 非致命跳过)。
 */
export function resolveProjcachePath(settingsService) {
  const value = settingsService?.get?.(NAMESPACE);
  if (value !== null && value !== undefined && typeof value === 'object' && typeof value.projcachePath === 'string' && value.projcachePath.length > 0) {
    return value.projcachePath;
  }
  const home = process.env.DSH_HOME;
  if (typeof home === 'string' && home.length > 0) return join(home, 'storages', 'session_projcache.json');
  return join(homedir(), '.dsh', 'storages', 'session_projcache.json');
}

/**
 * 解析 preset 角色目录(kr-control-plane):显式 config presetRolesDir 优先,
 * env DSH_HOME 回退到 .agent-presets/project-pipeline/roles/;0.4.1 增第三级回退
 * homedir()/.dsh/.agent-presets/project-pipeline/roles(单环境默认 dsh-home,进程未设
 * DSH_HOME 的标准部署——此前该形态下 presetRolesDir=null,设置卡保存角色模型必 400
 * "role manifest not found: <role>",本机复刻后修复)。返回值所指目录不存在时,
 * 读侧 readJsonSafe 回退空 manifest(source=default,不伪造),写侧维持既有 400 语义。
 */
export function resolvePresetRolesDir(settingsService) {
  const value = settingsService?.get?.(NAMESPACE);
  if (value !== null && value !== undefined && typeof value === 'object' && typeof value.presetRolesDir === 'string' && value.presetRolesDir.length > 0) {
    return value.presetRolesDir;
  }
  const home = process.env.DSH_HOME;
  if (typeof home === 'string' && home.length > 0) return join(home, '.agent-presets', 'project-pipeline', 'roles');
  return join(homedir(), '.dsh', '.agent-presets', 'project-pipeline', 'roles');
}

/** 校验路径存在且为目录。 */
async function isDirectory(path, deps) {
  try {
    return (await deps.stat(path)).isDirectory();
  } catch {
    return false;
  }
}

// ── HTTP 通道(SPEC §5 / DESIGN §7)────────────────────────────────────────

/**
 * 构造通道 handler(GET 读视图 / PUT 配置写 / 其他 405)。
 * GET 视图:?project=<id> 详情(404 若不存在);?view=budget 预算聚合;
 *          ?view=config 当前配置;?view=board 当前 board view config;默认项目列表。
 * PUT { section:{ scanRoot } }:校验路径存在且为目录 → 400;成功 → settings.replace → 返回新配置。
 * PUT { board:{ id, archived?, pinned? } }(迭代8):校验(白名单字段/固定路径/id 存在/
 *   布尔类型)→ applyBoardChange → 原子写 → 返回新 board。
 * 每次命中实时扫描,无缓存;通道本身始终 200 + 结构化体(单项目失败带错误分类)。
 */
export function makeApiHandler({ settingsService, deps, logger }) {
  return async function handler(req, res) {
    try {
      if (req.method === 'GET') {
        const url = new URL(req.url, 'http://localhost');
        const project = url.searchParams.get('project');
        const view = url.searchParams.get('view');
        const scanRoot = resolveScanRoot(settingsService, deps);
        // view=file:返回项目 .dsh-project/ 下白名单文件的 text/plain 正文(只读)。
        // 须在通用 ?project= 详情分支之前,因为 view=file 也带 project 参数。
        // 迭代7:白名单加 REQUIREMENT.md(与 SUMMARY.md 同属 .dsh-project/ 只读白名单文件)。
        if (view === 'file') {
          const name = url.searchParams.get('name');
          if (name !== 'SUMMARY.md' && name !== 'REQUIREMENT.md') {
            sendJson(res, 400, { ok: false, error: `name not allowed: ${name}` });
            return;
          }
          if (typeof project !== 'string' || !/^[a-z0-9-]+$/.test(project)) {
            sendJson(res, 400, { ok: false, error: `invalid project id: ${project}` });
            return;
          }
          let text;
          try {
            text = await deps.readFile(join(scanRoot, project, '.dsh-project', name), 'utf8');
          } catch (error) {
            if (error?.code === 'ENOENT') {
              sendJson(res, 404, { ok: false, error: `file not found: ${project}/${name}` });
              return;
            }
            throw error;
          }
          res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(text) });
          res.end(text);
          return;
        }
        if (project) {
          const detail = await readProject(scanRoot, project, deps);
          if (detail === null) {
            sendJson(res, 404, { ok: false, error: `project not found: ${project}` });
            return;
          }
          sendJson(res, 200, { ok: true, project: detail });
          return;
        }
        if (view === 'budget') {
          const projects = await scanProjects(scanRoot, deps);
          const projcachePath = resolveProjcachePath(settingsService);
          const budget = await aggregateBudget(projects, { projcachePath, deps });
          sendJson(res, 200, { ok: true, budget });
          return;
        }
        if (view === 'config') {
          sendJson(res, 200, { ok: true, config: { scanRoot } });
          return;
        }
        // 迭代8:view=board 返回当前 board view config(读容错,缺失/坏 JSON → 空配置)。
        if (view === 'board') {
          const board = await readBoardViewConfig(scanRoot, deps);
          sendJson(res, 200, { ok: true, board });
          return;
        }
        // kr-control-plane:view=settings 返回流水线设置载荷(块 A 策略 + 块 B 模型 + 凭证)。
        if (view === 'settings') {
          const presetRolesDir = resolvePresetRolesDir(settingsService);
          const settings = await readSettings(scanRoot, { presetRolesDir, settingsService }, deps);
          sendJson(res, 200, { ok: true, settings });
          return;
        }
        // kr-control-plane-i2(C-A):view=models 只读暴露 dsh 已配置模型清单。
        // 数据源 = settingsService.get('llm-pi-ai')?.providers;providers 缺失/为空 →
        // { ok:true, models:[] };settingsService 不可达 → 显式 { ok:false, error:'模型清单不可用' }。
        if (view === 'models') {
          const models = readConfiguredModels(settingsService);
          if (!models.ok) {
            sendJson(res, 200, { ok: false, error: models.error });
            return;
          }
          sendJson(res, 200, { ok: true, models: models.models });
          return;
        }
        const projects = await scanProjects(scanRoot, deps);
        sendJson(res, 200, { ok: true, projects });
        return;
      }
      if (req.method === 'PUT') {
        let parsed;
        try {
          parsed = JSON.parse(await readBody(req));
        } catch {
          sendJson(res, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          sendJson(res, 400, { ok: false, error: 'body must be a JSON object' });
          return;
        }
        // 迭代8:board 写分支(与既有 section 分支并列)。唯一写面 = board view config。
        if (parsed.board !== undefined) {
          const scanRoot = resolveScanRoot(settingsService, deps);
          const board = parsed.board;
          if (board === null || typeof board !== 'object' || Array.isArray(board)) {
            sendJson(res, 400, { ok: false, error: 'board must be an object' });
            return;
          }
          // AC-W1:白名单字段(仅 id/archived/pinned),拒绝未知字段。
          const allowed = ['id', 'archived', 'pinned'];
          for (const key of Object.keys(board)) {
            if (!allowed.includes(key)) {
              sendJson(res, 400, { ok: false, error: `unknown field: ${key}` });
              return;
            }
          }
          // AC-W4:id 须为合法 slug 且引用已存在项目。
          const id = board.id;
          if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) {
            sendJson(res, 400, { ok: false, error: `invalid project id: ${id}` });
            return;
          }
          if (!(await projectExists(scanRoot, id, deps))) {
            sendJson(res, 400, { ok: false, error: `project not found: ${id}` });
            return;
          }
          // archived/pinned 若出现须为 boolean。
          if (board.archived !== undefined && typeof board.archived !== 'boolean') {
            sendJson(res, 400, { ok: false, error: 'archived must be a boolean' });
            return;
          }
          if (board.pinned !== undefined && typeof board.pinned !== 'boolean') {
            sendJson(res, 400, { ok: false, error: 'pinned must be a boolean' });
            return;
          }
          if (board.archived === undefined && board.pinned === undefined) {
            sendJson(res, 400, { ok: false, error: 'board must set archived or pinned' });
            return;
          }
          // 读当前(读容错)→ 幂等 set/clear → 原子写(AC-W2/W3/W5/W6/W7)。
          const current = await readBoardViewConfig(scanRoot, deps);
          const next = applyBoardChange(current, { id, archived: board.archived, pinned: board.pinned });
          await writeBoardViewConfig(scanRoot, next, deps);
          sendJson(res, 200, { ok: true, board: next });
          return;
        }
        // kr-control-plane:settings 写分支(唯一写面 = audit-rules.json + workspace 角色覆盖)。
        // 护栏 AC-A2:body 非 JSON 400 / settings 非对象 400 / 未知字段 400 / 重复 rule.id 400 /
        // roleModel.role 非已知角色 400 / provider/model 非非空字符串 400;备份/原子写失败 500。
        if (parsed.settings !== undefined) {
          const scanRoot = resolveScanRoot(settingsService, deps);
          const settings = parsed.settings;
          if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
            sendJson(res, 400, { ok: false, error: 'settings must be an object' });
            return;
          }
          const presetRolesDir = resolvePresetRolesDir(settingsService);
          const result = {};
          try {
            if (settings.auditRules !== undefined) {
              const next = await writeAuditRules(scanRoot, settings.auditRules, deps);
              result.auditRules = next;
            }
            if (settings.roleModel !== undefined) {
              const change = settings.roleModel;
              if (change === null || typeof change !== 'object' || Array.isArray(change)) {
                sendJson(res, 400, { ok: false, error: 'roleModel must be an object' });
                return;
              }
              if (change.reset === true) {
                // C3 恢复默认(卡点 b1 裁决方案 A):移除 workspace 覆盖,回退默认档。
                await resetRoleModel(scanRoot, change.role, deps);
                // 计算 reset 后的来源与 effectiveModel(workspace 覆盖已移除 → preset 声明或默认继承)。
                const roles = await readRoleModels(scanRoot, presetRolesDir, deps, settingsService);
                const updated = roles.find((r) => r.role === change.role);
                result.roleModel = {
                  role: change.role,
                  reset: true,
                  source: updated ? updated.source : 'default',
                  model: updated && updated.model ? updated.model : null,
                };
              } else {
                const manifest = await writeRoleModel(scanRoot, presetRolesDir, change, deps);
                result.roleModel = { role: change.role, model: manifest.model };
              }
            }
            if (Object.keys(result).length === 0) {
              sendJson(res, 400, { ok: false, error: 'settings must set auditRules or roleModel' });
              return;
            }
          } catch (error) {
            if (error instanceof SettingsValidationError) {
              sendJson(res, 400, { ok: false, error: error.message });
            } else {
              logger?.warn?.(`project-hub: settings write error: ${String(error?.message ?? error)}`);
              sendJson(res, 500, { ok: false, error: 'settings write failed' });
            }
            return;
          }
          sendJson(res, 200, { ok: true, settings: result });
          return;
        }
        const section = parsed.section ?? {};
        if (typeof section !== 'object' || section === null || Array.isArray(section)) {
          sendJson(res, 400, { ok: false, error: 'section must be an object' });
          return;
        }
        if (section.scanRoot !== undefined) {
          if (typeof section.scanRoot !== 'string' || section.scanRoot.length === 0) {
            sendJson(res, 400, { ok: false, error: 'scanRoot must be a non-empty string' });
            return;
          }
          if (!(await isDirectory(section.scanRoot, deps))) {
            sendJson(res, 400, { ok: false, error: `scanRoot is not an existing directory: ${section.scanRoot}` });
            return;
          }
        }
        try {
          await settingsService.replace(NAMESPACE, section);
        } catch (error) {
          sendJson(res, 400, { ok: false, error: String(error?.message ?? error) });
          return;
        }
        const scanRoot = resolveScanRoot(settingsService, deps);
        sendJson(res, 200, { ok: true, config: { scanRoot } });
        return;
      }
      sendJson(res, 405, { ok: false, error: `${req.method} not allowed` });
    } catch (error) {
      logger?.warn?.(`project-hub: handler error: ${String(error?.message ?? error)}`);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'internal error' });
      else res.destroy();
    }
  };
}

// ── 插件装载(SPEC §3 / DESIGN §3)─────────────────────────────────────────

export function apply(ctx, config = {}) {
  const deps = makeDeps(config);
  ctx.inject(['settings'], (sctx) => {
    // requires 全部 required:L1.hotConfig 断供 → 挂载失败(roster 可见)。
    assertUsable(detectRuntime(sctx, ['L1.hotConfig']), ['L1.hotConfig'], sctx.logger);

    const settingsService = sctx.get('settings');
    hotConfig(sctx, {
      ns: NAMESPACE,
      schema: buildSchema(),
      logger: sctx.logger,
      label: 'project-hub',
    });

    // 自有 HTTP 通道(required:断供记 error;断供把关由单测与 curl 矩阵兜底)。
    channel(sctx, {
      path: API_ROUTE,
      handler: makeApiHandler({ settingsService, deps, logger: sctx.logger }),
      required: true,
      logger: sctx.logger,
    });
  });
}

export default {
  name, NAMESPACE, API_ROUTE, SUMMARY_TAIL_MAX, BOARD_VIEW_FILE,
  scanProjects, readProject, aggregateBudget, buildSchema, resolveScanRoot, resolveProjcachePath, resolvePresetRolesDir, makeApiHandler, apply,
  parseGateSummary, extractGateTitle, extractGateVerdict, parseGateFile, summaryTail,
  extractGatePresentedAt, extractGateDecidedAt, extractJournalStart, journalStageId,
  readBoardViewConfig, writeBoardViewConfig, applyBoardChange,
  readProjcache, sessionTokenUsage,
  LIBRARY_DIR, TRASH_DIR_NAME, AUDIT_RULES_FILE, RULINGS_FILE, CATEGORIES_FILE, AUDIT_TRAIL_FILE, ROLES_DIR, VOUCHER_N, KNOWN_ROLES,
  readSettings, readAuditRules, readRulings, readCategories, readRoleModels, readAuditVouchers,
  writeAuditRules, writeRoleModel, resetRoleModel, validateAuditRulesPayload, reconcileSedimentation,
  readConfiguredModels, applySedimentationChange,
};
