// project-hub 浏览器半面纯函数单测(project-hub-i8)。
// client.js 是经 window.__ModuleLoader__ 装载的浏览器 bundle,无法在 Node 直接
// import。其纯函数(filterProjects/applyBoardView/applyBoardChange/sortProjects)
// 不依赖 React/window/t,可从源码提取 eval 单测(沿用 client.js 注释「可被 Node
// 测试从 client.js 提取 eval 单测」的既定做法)。
// 覆盖:搜索(中英文)、筛选逐态、搜索+筛选叠加、空态、归档/置顶、排序优先级。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = await readFile(join(HERE, '..', 'ui', 'lib', 'client.js'), 'utf8');

// ── 从 client.js 提取命名纯函数(括号匹配)──────────────────────────────────
function extractFunction(source, name) {
  const re = new RegExp(`function\\s+${name}\\s*\\(`);
  const start = source.search(re);
  if (start < 0) throw new Error(`function ${name} not found in client.js`);
  const openIdx = source.indexOf('{', start);
  let depth = 0;
  let i = openIdx;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) break; }
  }
  const body = source.slice(start, i + 1);
  // eslint-disable-next-line no-new-func
  return new Function(`return (${body})`)();
}

const filterProjects = extractFunction(CLIENT_SRC, 'filterProjects');
const applyBoardView = extractFunction(CLIENT_SRC, 'applyBoardView');
const applyBoardChange = extractFunction(CLIENT_SRC, 'applyBoardChange');
const sortProjects = extractFunction(CLIENT_SRC, 'sortProjects');
// kr-board-time-token(C3):格式化纯函数(不依赖 React/window/t,Node 可测)。
const formatToken = extractFunction(CLIENT_SRC, 'formatToken');
const formatDuration = extractFunction(CLIENT_SRC, 'formatDuration');
const stageTokenTotals = extractFunction(CLIENT_SRC, 'stageTokenTotals');

// ── 样例项目 ────────────────────────────────────────────────────────────────
const projects = [
  { id: 'proj-alpha', title: '中文项目甲', state: 'active', updatedAt: '2026-08-30T10:00:00.000Z' },
  { id: 'proj-beta', title: 'Project Beta', state: 'delivered', updatedAt: '2026-08-30T09:00:00.000Z' },
  { id: 'proj-gamma', title: 'Gamma 项目', state: 'rejected', updatedAt: '2026-08-30T08:00:00.000Z' },
  { id: 'proj-delta', title: 'Delta Parked', state: 'parked', updatedAt: '2026-08-30T07:00:00.000Z' },
];

// ── applyBoardView:合并 pinned/archived 标记 ───────────────────────────────

test('applyBoardView:合并 boardView 的 pinned/archived 标记', () => {
  const boardView = { items: { 'proj-alpha': { pinned: true, archived: false }, 'proj-beta': { archived: true } } };
  const merged = applyBoardView(projects, boardView);
  const alpha = merged.find((p) => p.id === 'proj-alpha');
  const beta = merged.find((p) => p.id === 'proj-beta');
  const gamma = merged.find((p) => p.id === 'proj-gamma');
  assert.equal(alpha.pinned, true);
  assert.equal(alpha.archived, false);
  assert.equal(beta.archived, true);
  assert.equal(beta.pinned, false);
  // 无标记项目默认 false
  assert.equal(gamma.pinned, false);
  assert.equal(gamma.archived, false);
  // 不修改入参
  assert.equal(projects[0].pinned, undefined);
});

test('applyBoardView:boardView 缺失/空 → 全部默认 false', () => {
  const merged = applyBoardView(projects, null);
  assert.ok(merged.every((p) => p.pinned === false && p.archived === false));
});

// ── filterProjects:搜索(AC-S1/S2)──────────────────────────────────────────

test('filterProjects:中文 title 搜索(AC-S1)', () => {
  const merged = applyBoardView(projects, { items: {} });
  const out = filterProjects(merged, { query: '中文', states: new Set(), showArchived: false });
  assert.deepEqual(out.map((p) => p.id), ['proj-alpha']);
});

test('filterProjects:中文 title 搜索命中多个(AC-S1)', () => {
  const merged = applyBoardView(projects, { items: {} });
  // 「项目」命中 alpha(中文项目甲)与 gamma(Gamma 项目)
  const out = filterProjects(merged, { query: '项目', states: new Set(), showArchived: false });
  assert.deepEqual(out.map((p) => p.id).sort(), ['proj-alpha', 'proj-gamma']);
});

test('filterProjects:英文 id 搜索,大小写不敏感(AC-S1)', () => {
  const merged = applyBoardView(projects, { items: {} });
  const out = filterProjects(merged, { query: 'PROJ-BETA', states: new Set(), showArchived: false });
  assert.deepEqual(out.map((p) => p.id), ['proj-beta']);
});

test('filterProjects:空 query → 全量(AC-S2)', () => {
  const merged = applyBoardView(projects, { items: {} });
  const out = filterProjects(merged, { query: '', states: new Set(), showArchived: false });
  assert.equal(out.length, 4);
});

test('filterProjects:无匹配 → 空数组(空态数据源)', () => {
  const merged = applyBoardView(projects, { items: {} });
  const out = filterProjects(merged, { query: 'zzz-no-match', states: new Set(), showArchived: false });
  assert.deepEqual(out, []);
});

// ── filterProjects:筛选逐态(AC-F1)────────────────────────────────────────

test('filterProjects:筛选 active 态', () => {
  const merged = applyBoardView(projects, { items: {} });
  const out = filterProjects(merged, { query: '', states: new Set(['active']), showArchived: false });
  assert.deepEqual(out.map((p) => p.id), ['proj-alpha']);
});

test('filterProjects:筛选 delivered 态', () => {
  const merged = applyBoardView(projects, { items: {} });
  const out = filterProjects(merged, { query: '', states: new Set(['delivered']), showArchived: false });
  assert.deepEqual(out.map((p) => p.id), ['proj-beta']);
});

test('filterProjects:筛选 parked 态', () => {
  const merged = applyBoardView(projects, { items: {} });
  const out = filterProjects(merged, { query: '', states: new Set(['parked']), showArchived: false });
  assert.deepEqual(out.map((p) => p.id), ['proj-delta']);
});

test('filterProjects:多选 active+delivered(AC-F1 多选)', () => {
  const merged = applyBoardView(projects, { items: {} });
  const out = filterProjects(merged, { query: '', states: new Set(['active', 'delivered']), showArchived: false });
  assert.deepEqual(out.map((p) => p.id).sort(), ['proj-alpha', 'proj-beta']);
});

test('filterProjects:空 states(Set 空)→ 全量(AC-F4)', () => {
  const merged = applyBoardView(projects, { items: {} });
  const out = filterProjects(merged, { query: '', states: new Set(), showArchived: false });
  assert.equal(out.length, 4);
});

// ── filterProjects:搜索+筛选叠加 AND(AC-F2)───────────────────────────────

test('filterProjects:搜索+筛选叠加为 AND(AC-F2)', () => {
  const merged = applyBoardView(projects, { items: {} });
  // 搜索「项目」命中 alpha/gamma;再筛 active → 仅 alpha
  const out = filterProjects(merged, { query: '项目', states: new Set(['active']), showArchived: false });
  assert.deepEqual(out.map((p) => p.id), ['proj-alpha']);
});

// ── filterProjects:归档可见性(AC-F5/A1/A2)────────────────────────────────

test('filterProjects:归档项目默认隐藏(AC-A1/F5)', () => {
  const boardView = { items: { 'proj-beta': { archived: true } } };
  const merged = applyBoardView(projects, boardView);
  const out = filterProjects(merged, { query: '', states: new Set(), showArchived: false });
  assert.ok(!out.some((p) => p.id === 'proj-beta'), '归档项目默认应隐藏');
  assert.equal(out.length, 3);
});

test('filterProjects:revealArchived=true 时归档项目并入可见;archivedOnly=true 时排他只显归档(迭代9 AC-A2/F5)', () => {
  const boardView = { items: { 'proj-beta': { archived: true } } };
  const merged = applyBoardView(projects, boardView);
  const out = filterProjects(merged, { query: '', states: new Set(), revealArchived: true });
  assert.ok(out.some((p) => p.id === 'proj-beta'), 'revealArchived 时归档项目应可见');
  assert.equal(out.length, 4);
  const only = filterProjects(merged, { query: '', states: new Set(), archivedOnly: true });
  assert.deepEqual(only.map((p) => p.id), ['proj-beta'], 'archivedOnly 时只显示归档项目');
});

test('filterProjects:archivedOnly + 搜索叠加;归档项不参与状态筛选(迭代9 AC-A2/B)', () => {
  const boardView = { items: { 'proj-beta': { archived: true } } };
  const merged = applyBoardView(projects, boardView);
  const out = filterProjects(merged, { query: 'beta', states: new Set(), archivedOnly: true });
  assert.deepEqual(out.map((p) => p.id), ['proj-beta']);
});

// ── applyBoardChange:乐观更新幂等(AC-A5/P5)───────────────────────────────

test('applyBoardChange:set pinned/archived 幂等,不修改入参', () => {
  const board = { items: {} };
  const next = applyBoardChange(board, { id: 'proj-alpha', pinned: true, archived: true });
  assert.deepEqual(next, { items: { 'proj-alpha': { pinned: true, archived: true } } });
  assert.deepEqual(board, { items: {} });
});

test('applyBoardChange:clear 幂等', () => {
  let board = { items: { 'proj-alpha': { pinned: true, archived: true } } };
  board = applyBoardChange(board, { id: 'proj-alpha', pinned: false });
  assert.deepEqual(board, { items: { 'proj-alpha': { pinned: false, archived: true } } });
});

// ── sortProjects:排序优先级(AC-P1/R1)─────────────────────────────────────

test('sortProjects:用户置顶 > active 置顶 > 其余按 updatedAt 倒序(AC-P1/R1)', () => {
  const merged = applyBoardView(projects, { items: { 'proj-gamma': { pinned: true } } });
  const { active } = sortProjects(merged);
  // gamma(rejected,用户置顶)排最前;alpha(active)次之;beta(delivered)最后
  assert.deepEqual(active.map((p) => p.id), ['proj-gamma', 'proj-alpha', 'proj-beta']);
});

test('sortProjects:置顶间按 updatedAt 倒序(AC-P1)', () => {
  const merged = applyBoardView(projects, { items: { 'proj-beta': { pinned: true }, 'proj-gamma': { pinned: true } } });
  const { active } = sortProjects(merged);
  // beta(09:00)与 gamma(08:00)都置顶,按 updatedAt 倒序 → beta 在前
  assert.deepEqual(active.map((p) => p.id), ['proj-beta', 'proj-gamma', 'proj-alpha']);
});

test('sortProjects:parked 独立分组,组内 pinned 优先(AC-R2)', () => {
  const parkedProjects = [
    { id: 'p1', title: 'P1', state: 'parked', updatedAt: '2026-08-30T05:00:00.000Z' },
    { id: 'p2', title: 'P2', state: 'parked', updatedAt: '2026-08-30T06:00:00.000Z' },
  ];
  const merged = applyBoardView(parkedProjects, { items: { 'p1': { pinned: true } } });
  const { parked } = sortProjects(merged);
  assert.deepEqual(parked.map((p) => p.id), ['p1', 'p2']);
});

test('sortProjects:非数组 → 空分组', () => {
  assert.deepEqual(sortProjects(null), { active: [], parked: [] });
});

// ── 静态断言:i18n 键与写端点契约存在(AC-C1/C2)───────────────────────────

test('client.js:新增 i18n 键同时存在于 zh 与 en 字典', () => {
  for (const key of ['search.placeholder', 'search.clear', 'filter.state', 'filter.archived',
    'action.pin', 'action.unpin', 'action.archive', 'action.unarchive',
    'noMatch', 'noMatchHint', 'pinned', 'archived', 'writeFailed']) {
    assert.ok(CLIENT_SRC.split(`"${key}"`).length >= 3, `${key} 应同时出现在 zh 与 en 词条`);
  }
});

test('client.js:写端点契约(PUT board 载荷)存在', () => {
  assert.ok(CLIENT_SRC.includes('method: "PUT"'), '写操作应走 PUT');
  assert.ok(CLIENT_SRC.includes('board: Object.assign({ id }, change)'), '应发送 board 载荷');
  assert.ok(CLIENT_SRC.includes('?view=board'), '应读取 board view config');
});

test('client.js:搜索/筛选为受控状态,不触发 refetch(AC-C1/C2,迭代9 语义)', () => {
  assert.ok(CLIENT_SRC.includes('const [query, setQuery] = React.useState("")'), 'query 应为 useState 受控');
  assert.ok(CLIENT_SRC.includes('const [selectedStates, setSelectedStates] = React.useState(new Set())'), '筛选应为 useState 受控');
  assert.ok(CLIENT_SRC.includes('const [archivedOnly, setArchivedOnly] = React.useState(false)'), 'archivedOnly 应为 useState 受控');
  assert.ok(CLIENT_SRC.includes('const [revealArchived, setRevealArchived] = React.useState(false)'), 'revealArchived 应为 useState 受控');
  assert.ok(/filterProjects\(merged,\s*\w+\)/.test(CLIENT_SRC), '渲染管线应经 filterProjects');
});

// ── 0.8.0 真实 token 计量:看板预算呈现 ────────────────────────────────────

test('client.js:新增 i18n 键 totalTokens/sharedOnce 同时存在于 zh 与 en 字典', () => {
  for (const key of ['totalTokens', 'sharedOnce']) {
    assert.ok(CLIENT_SRC.split(`"${key}"`).length >= 3, `${key} 应同时出现在 zh 与 en 词条`);
  }
});

test('client.js:预算列呈现真实 token 总量(totalTokens 渲染逻辑存在)', () => {
  // 列表预算列(budgetTotalsText)应渲染 totalTokens。
  assert.ok(CLIENT_SRC.includes('t("totalTokens")'), '预算列应引用 totalTokens 键');
  assert.ok(CLIENT_SRC.includes('totals.totalTokens'), '预算列应读取 totals.totalTokens');
  // 预算详情 tab 应渲染 totalTokens 大数字行。
  assert.ok(CLIENT_SRC.includes('key: "totalTokens"'), '预算详情应渲染 totalTokens 行');
  // 工作区汇总应渲染 totalTokens 与 sharedOnce。
  assert.ok(CLIENT_SRC.includes('ws.totalTokens'), '工作区汇总应读取 ws.totalTokens');
  assert.ok(CLIENT_SRC.includes('ws.sharedOnce'), '工作区汇总应读取 ws.sharedOnce');
});

test('client.js:byRole[role] 新形状 { count, tokens } 被 roleCountsText 兼容', () => {
  assert.ok(CLIENT_SRC.includes('typeof v.count === "number"'), 'roleCountsText 应兼容 { count, tokens } 形状');
  assert.ok(CLIENT_SRC.includes('v.tokens'), 'roleCountsText 应展示 tokens');
});

// ═══════════════════════════════════════════════════════════════════════════
// kr-board-time-token(C3):formatToken / formatDuration / stageTokenTotals 纯函数
// ═══════════════════════════════════════════════════════════════════════════

// ── formatToken(R1):逗号分组 + M/B 缩写阈值切换 ────────────────────────────

test('formatToken:0 → "0"', () => {
  assert.equal(formatToken(0), '0');
});

test('formatToken:千级逗号分组', () => {
  assert.equal(formatToken(1234), '1,234');
  assert.equal(formatToken(999999), '999,999');
});

test('formatToken:百万级 M 缩写(阈值 ≥1e6,1 位小数去尾零)', () => {
  assert.equal(formatToken(1234567), '1.2M');
  assert.equal(formatToken(1000000), '1M');
  assert.equal(formatToken(1500000), '1.5M');
  assert.equal(formatToken(3000000), '3M');
});

test('formatToken:十亿级 B 缩写(阈值 ≥1e9)', () => {
  assert.equal(formatToken(1500000000), '1.5B');
  assert.equal(formatToken(1000000000), '1B');
});

test('formatToken:阈值切换点', () => {
  assert.equal(formatToken(999999), '999,999', '未达 M 阈值');
  assert.equal(formatToken(1000000), '1M', '达 M 阈值');
  assert.equal(formatToken(999999999), '999.9M', '未达 B 阈值');
  assert.equal(formatToken(1000000000), '1B', '达 B 阈值');
});

test('formatToken:去尾零(1.0M → 1M)', () => {
  assert.equal(formatToken(1000000), '1M');
  assert.equal(formatToken(1000000000), '1B');
});

test('formatToken:非数字/NaN/负值 → "—" 兜底', () => {
  assert.equal(formatToken(NaN), '—');
  assert.equal(formatToken(Infinity), '—');
  assert.equal(formatToken(-Infinity), '—');
  assert.equal(formatToken(-5), '—');
  assert.equal(formatToken('123'), '—');
  assert.equal(formatToken(null), '—');
  assert.equal(formatToken(undefined), '—');
});

// ── formatDuration(R3/R4/R5):ms → 人话 ────────────────────────────────────

test('formatDuration:0/非数字/≤0 → "—"', () => {
  assert.equal(formatDuration(0), '—');
  assert.equal(formatDuration(-1000), '—');
  assert.equal(formatDuration(NaN), '—');
  assert.equal(formatDuration(Infinity), '—');
  assert.equal(formatDuration('x'), '—');
  assert.equal(formatDuration(null), '—');
});

test('formatDuration:<1分 → "不足1分"', () => {
  assert.equal(formatDuration(30000), '不足1分');
  assert.equal(formatDuration(59999), '不足1分');
});

test('formatDuration:1分~59分 → "X分"', () => {
  assert.equal(formatDuration(60000), '1分');
  assert.equal(formatDuration(3000000), '50分');
  assert.equal(formatDuration(3599999), '59分');
});

test('formatDuration:1小时~23小时59分 → "X小时Y分"(整小时省略「0分」)', () => {
  assert.equal(formatDuration(3600000), '1小时');
  assert.equal(formatDuration(5000000), '1小时23分');
  assert.equal(formatDuration(23 * 3600000 + 59 * 60000), '23小时59分');
});

test('formatDuration:≥1天 → "X天Y小时"(整天省略「0小时」)', () => {
  assert.equal(formatDuration(90000000), '1天1小时');
  assert.equal(formatDuration(29 * 86400000 + 23 * 3600000), '29天23小时');
  assert.equal(formatDuration(2700000000), '31天6小时');
  assert.equal(formatDuration(30 * 86400000), '30天');
});

// ── stageTokenTotals(R4):按 stageId 聚合 runtime-events 数值 token ────────

test('stageTokenTotals:空数组 → {}', () => {
  assert.deepEqual(stageTokenTotals([]), {});
  assert.deepEqual(stageTokenTotals(null), {});
  assert.deepEqual(stageTokenTotals(undefined), {});
});

test('stageTokenTotals:多 stage 混合 source,仅 runtime-events 数值求和', () => {
  const committed = [
    { stageId: 'clarify', role: 'product', usage: { tokens: 100 }, source: 'runtime-events' },
    { stageId: 'clarify', role: 'product', usage: { tokens: 50 }, source: 'runtime-events' },
    { stageId: 'design', role: 'architect', usage: { tokens: 200 }, source: 'runtime-events' },
    { stageId: 'design', role: 'architect', usage: { tokens: 30 }, source: 'self-report' },
    { stageId: 'build', role: 'dev', usage: { tokens: 80 }, source: 'self-report' },
  ];
  assert.deepEqual(stageTokenTotals(committed), { clarify: 150, design: 200 });
});

test('stageTokenTotals:self-report 无数值求和 → 0(该 stage 无 runtime-events 条目)', () => {
  const committed = [
    { stageId: 'build', role: 'dev', usage: { tokens: 80 }, source: 'self-report' },
  ];
  assert.deepEqual(stageTokenTotals(committed), {});
});

test('stageTokenTotals:usage 无数值 token / 非对象条目跳过', () => {
  const committed = [
    { stageId: 'clarify', role: 'product', usage: { note: 'x' }, source: 'runtime-events' },
    { stageId: 'design', role: 'architect', usage: { tokens: 'nope' }, source: 'runtime-events' },
    null,
    'junk',
  ];
  assert.deepEqual(stageTokenTotals(committed), {});
});

// ── R2 静态核对:committedEntryCount 三处渲染已移除 ────────────────────────

test('client.js(R2):committedEntryCount 三处渲染已移除(仅 i18n 键保留)', () => {
  // i18n 键保留(host 载荷仍含,向后兼容),但不再被渲染引用。
  assert.ok(CLIENT_SRC.includes('"committedEntryCount"'), 'i18n 键应保留');
  // 列表预算列(budgetTotalsText)不再渲染 committedEntryCount。
  assert.ok(!/committedEntryCount\s*\)\s*parts\.push/.test(CLIENT_SRC), 'budgetTotalsText 不应再渲染 committedEntryCount');
  // 工作区汇总不再渲染 committedEntryCount 统计块。
  assert.ok(!/t\("committedEntryCount"\)\s*,\s*React\.createElement\("b"/.test(CLIENT_SRC), '工作区汇总不应再渲染 committedEntryCount');
  // 预算 tab 不再渲染「已上报:N 条」计数行。
  assert.ok(!/key: "committed",\s*className: "dshph_kvRow"/.test(CLIENT_SRC), 'BudgetDetail 不应再渲染 committed 计数行');
});

// ── R3/R4/R5 渲染静态核对 ────────────────────────────────────────────────

test('client.js(R3):项目卡片时间行渲染(开始/结束/耗时)', () => {
  assert.ok(CLIENT_SRC.includes('t("startTime")'), '应渲染开始时间');
  assert.ok(CLIENT_SRC.includes('t("endTime")'), '应渲染结束时间');
  assert.ok(CLIENT_SRC.includes('t("duration")'), '应渲染耗时');
  assert.ok(CLIENT_SRC.includes('project.createdAt'), '应读取 createdAt');
  assert.ok(CLIENT_SRC.includes('projectDurationText'), '应经 projectDurationText 计算耗时');
});

test('client.js(R4):阶段行渲染时间 + token', () => {
  assert.ok(CLIENT_SRC.includes('t("token")'), '应渲染阶段 token');
  assert.ok(CLIENT_SRC.includes('stageTokenTotals'), '应经 stageTokenTotals 聚合');
  assert.ok(CLIENT_SRC.includes('project.stageTimes'), '应读取 stageTimes');
  assert.ok(CLIENT_SRC.includes('dshph_stageMeta'), '应有阶段副行样式类');
});

test('client.js(R5):记录页门禁/日志补时间', () => {
  assert.ok(CLIENT_SRC.includes('t("presentedAt")'), '应渲染门禁呈递时间');
  assert.ok(CLIENT_SRC.includes('t("decidedAt")'), '应渲染门禁裁决时间');
  assert.ok(CLIENT_SRC.includes('j.file'), 'journals 元素应为对象(取 j.file)');
  assert.ok(CLIENT_SRC.includes('j.start'), 'journals 元素应取 j.start');
});
