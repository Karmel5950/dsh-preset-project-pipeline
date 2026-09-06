// project-hub 插件单测:零 npm 依赖 + stub ctx(toolkit/stub-ctx.mjs)+ stub fs。
// 覆盖:扫描(AC-R1.1)、扫描根可配置(AC-R1.2)、单项目失败隔离(AC-R1.3)、
// 错误分类(missing/malformed-registry/flow/budget/unreadable)、预算聚合(AC-R4.2)、
// 只读不写账本(AC-R4.3)、通道注册路径(AC-R5.1)、405(AC-R5.2)、各 GET 视图结构
// (AC-R5.3)、无缓存(AC-R5.4)、坏项目不拖垮通道(AC-R5.5)、配置读写(PUT 校验)。
// 迭代8(project-hub-i8):board view config 读写(readBoardViewConfig/writeBoardViewConfig/
// applyBoardChange)+ PUT board 写端点安全护栏(AC-W1~W7)+ GET ?view=board。
// 0.8.0(预算账本改真实 token 计量):computeTotals/budgetSummary/aggregateBudget 对
// runtime-events 数值求和(byRole[role].tokens + totalTokens)+ sharedOnce;host 侧
// readProjcache/sessionTokenUsage 守卫单测。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  name, NAMESPACE, API_ROUTE, BOARD_VIEW_FILE,
  scanProjects, readProject, aggregateBudget, buildSchema, resolveScanRoot, resolveProjcachePath, resolvePresetRolesDir, makeApiHandler, apply,
  parseGateSummary, extractGateTitle, extractGateVerdict, parseGateFile, summaryTail,
  extractGatePresentedAt, extractGateDecidedAt, extractJournalStart, journalStageId,
  readBoardViewConfig, writeBoardViewConfig, applyBoardChange,
  readProjcache, sessionTokenUsage,
  readSettings, readAuditRules, readRulings, readCategories, readRoleModels, readAuditVouchers,
  writeAuditRules, writeRoleModel, resetRoleModel, validateAuditRulesPayload, reconcileSedimentation,
  readConfiguredModels, applySedimentationChange,
} from '../project-hub.mjs';
import { makeStubCtx } from '../../../toolkit/stub-ctx.mjs';

// ── 测试替身 ────────────────────────────────────────────────────────────────

/** 构造 stub 文件系统:tree 为嵌套对象(目录=对象,文件=字符串)。迭代8:支持写。 */
function makeStubFs(tree) {
  function resolve(path) {
    const parts = String(path).replace(/\\/g, '/').split('/').filter(Boolean);
    let node = tree;
    for (const part of parts) {
      if (node === null || typeof node !== 'object' || !(part in node)) {
        const err = new Error(`ENOENT: no such file or directory, open '${path}'`);
        err.code = 'ENOENT';
        throw err;
      }
      node = node[part];
    }
    return node;
  }
  function setNode(path, value) {
    const parts = String(path).replace(/\\/g, '/').split('/').filter(Boolean);
    let node = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (node[part] === undefined || typeof node[part] !== 'object') node[part] = {};
      node = node[part];
    }
    node[parts[parts.length - 1]] = value;
  }
  function deleteNode(path) {
    const parts = String(path).replace(/\\/g, '/').split('/').filter(Boolean);
    let node = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      node = node[parts[i]];
      if (node === undefined || typeof node !== 'object') return;
    }
    delete node[parts[parts.length - 1]];
  }
  return {
    async readFile(path, encoding) {
      const node = resolve(path);
      if (typeof node !== 'string') {
        const e = new Error(`EISDIR: illegal operation on a directory '${path}'`);
        e.code = 'EISDIR';
        throw e;
      }
      return node;
    },
    async readdir(path, opts) {
      const node = resolve(path);
      if (typeof node === 'string') {
        const e = new Error(`ENOTDIR: not a directory '${path}'`);
        e.code = 'ENOTDIR';
        throw e;
      }
      return Object.keys(node).map((name) => ({
        name,
        isDirectory: () => typeof node[name] === 'object',
        isFile: () => typeof node[name] === 'string',
      }));
    },
    async stat(path) {
      const node = resolve(path);
      return { isDirectory: () => typeof node === 'object' };
    },
    async writeFile(path, data, encoding) {
      setNode(path, String(data));
    },
    async rename(from, to) {
      const value = resolve(from);
      setNode(to, value);
      deleteNode(from);
    },
    // kr-control-plane:备份 .trash 用(mkdir 建目录节点,copyFile 复制文件节点)。
    async mkdir(path, opts) {
      const parts = String(path).replace(/\\/g, '/').split('/').filter(Boolean);
      let node = tree;
      for (const part of parts) {
        if (node[part] === undefined || typeof node[part] !== 'object') node[part] = {};
        node = node[part];
      }
    },
    async copyFile(from, to) {
      setNode(to, resolve(from));
    },
    // kr-control-plane-i2:恢复默认移除 workspace 覆盖用(unlink 删文件节点)。
    async unlink(path) {
      deleteNode(path);
    },
  };
}

/** 构造 stub deps(默认 cwd='ws')。 */
function makeStubDeps(tree, cwd = 'ws') {
  return { ...makeStubFs(tree), cwd: () => cwd };
}

/** 构造 stub settings 服务,记录 replace 调用。 */
function makeSettingsService(initial = {}) {
  let value = initial;
  const calls = [];
  return {
    calls,
    get(ns) { return value; },
    async replace(ns, section) { calls.push({ ns, section }); value = section; },
  };
}

/** 构造 stub node:http 响应,记录 writeHead/end 调用。 */
function stubRes() {
  const calls = [];
  return {
    calls,
    headersSent: false,
    writeHead(status, headers) { this.headersSent = true; calls.push({ kind: 'head', status, headers }); },
    end(body) { calls.push({ kind: 'end', body }); },
    destroy() { calls.push({ kind: 'destroy' }); },
  };
}

/** 构造 stub node:http 请求。 */
function stubReq(method, url = API_ROUTE) {
  return { method, url };
}

/** 构造带 JSON body 的 PUT 请求。 */
function putReq(body) {
  const req = stubReq('PUT', API_ROUTE);
  req.on = (ev, cb) => { if (ev === 'data') cb(Buffer.from(JSON.stringify(body))); if (ev === 'end') cb(); };
  return req;
}

/** 解析 stubRes 里最后一次 end 的 body(JSON)。 */
function lastJson(res) {
  const end = [...res.calls].reverse().find((c) => c.kind === 'end');
  return JSON.parse(end.body);
}

/** 取 stubRes 最后一次 writeHead 的状态码。 */
function lastStatus(res) {
  const head = [...res.calls].reverse().find((c) => c.kind === 'head');
  return head.status;
}

/** 取 stubRes 最后一次 end 的 body(原始值,text/plain 用)。 */
function lastBody(res) {
  const end = [...res.calls].reverse().find((c) => c.kind === 'end');
  return end.body;
}

// ── 样例登记簿 ──────────────────────────────────────────────────────────────

const SPEC_GATE_MD = [
  '# 门禁:需求规格确认(spec-gate)',
  '',
  '## 第 1 轮呈递(2026-08-29T12:00:00.000Z)',
  '',
  '### 摘要',
  '',
  '这是待裁决门禁的摘要文本。',
  '',
  '### 待审材料',
  '- SPEC.md',
  '',
  '### 建议',
  '建议批准。',
  '',
  '<!-- dsh-project:gate {"stageId":"spec-gate","round":1,"status":"pending"} -->',
  '',
  '### 裁决(2026-08-29T13:00:00.000Z)',
  '',
  '- 结论:approve',
  '- 意见:OK',
].join('\n');

const tree = {
  ws: {
    'proj-a': {
      '.dsh-project': {
        'REGISTRY.json': JSON.stringify({
          schemaVersion: 1, id: 'proj-a', title: 'Project A', state: 'active',
          iteration: 1, stageIndex: 1, gateStatus: 'pending', updatedAt: '2026-08-29T13:00:00.000Z',
          createdAt: '2026-08-29T10:00:00.000Z',
        }),
        'FLOW.json': JSON.stringify({
          schemaVersion: 1, id: 'standard-flow', version: 1, stages: [
            { id: 'clarify', type: 'work', role: 'product' },
            { id: 'spec-gate', type: 'gate', title: '需求规格确认' },
            { id: 'design', type: 'work', role: 'architect' },
          ],
        }),
        'BUDGET.json': JSON.stringify({
          schemaVersion: 1, estimate: { tokens: 1000 }, cap: { tokens: 5000 }, committed: [
            { stageId: 'clarify', role: 'product', usage: { tokens: 100 }, source: 'self-report' },
            { stageId: 'design', role: 'architect', usage: { tokens: 200 }, source: 'self-report' },
          ],
        }),
        'SUMMARY.md': '# proj-a 总结链\n\n## 迭代 1\n\n### 本轮进展\n- 做了 X\n\n### 下一步\n- 待裁决',
        'gates': { '02-spec-gate.md': SPEC_GATE_MD },
        'journal': {
          '01-clarify.md': '- 进入时间:2026-08-29T10:00:00.000Z',
          '02-spec-gate.md': '- 进入时间:2026-08-29T11:00:00.000Z',
        },
      },
    },
    'proj-b': {
      '.dsh-project': {
        'REGISTRY.json': JSON.stringify({
          schemaVersion: 1, id: 'proj-b', title: 'Project B', state: 'delivered',
          iteration: 2, stageIndex: 0, gateStatus: null, updatedAt: '2026-08-29T12:00:00.000Z',
        }),
        'FLOW.json': JSON.stringify({ schemaVersion: 1, stages: [{ id: 'clarify', type: 'work', role: 'product' }] }),
        'BUDGET.json': JSON.stringify({ schemaVersion: 1, estimate: null, cap: null, committed: [] }),
      },
    },
    'not-a-project': { 'file.txt': 'x' },
  },
};

// ── 扫描:AC-R1.1 ────────────────────────────────────────────────────────────

test('scanProjects 返回全部项目,跳过非项目目录(AC-R1.1)', async () => {
  const projects = await scanProjects('ws', makeStubDeps(tree));
  const ids = projects.map((p) => p.id).sort();
  assert.deepEqual(ids, ['proj-a', 'proj-b']);
  // 非项目目录 not-a-project 被跳过
  assert.ok(!projects.some((p) => p.id === 'not-a-project'));
});

test('scanProjects 列表项含状态/迭代/当前阶段/待裁决门禁/预算摘要(AC-R1.1)', async () => {
  const projects = await scanProjects('ws', makeStubDeps(tree));
  const a = projects.find((p) => p.id === 'proj-a');
  assert.equal(a.state, 'active');
  assert.equal(a.iteration, 1);
  assert.equal(a.stageIndex, 1);
  assert.deepEqual(a.currentStage, { id: 'spec-gate', type: 'gate', role: null });
  assert.equal(a.gateStatus, 'pending');
  assert.equal(a.pendingGate.stageId, 'spec-gate');
  assert.equal(a.pendingGate.title, '需求规格确认');
  assert.equal(a.pendingGate.summary, '这是待裁决门禁的摘要文本。');
  assert.equal(a.hasSummary, true);
  assert.equal(a.budget.estimate.tokens, 1000);
  assert.equal(a.budget.cap.tokens, 5000);
  assert.equal(a.budget.totals.committedEntryCount, 2);
  // kr-board-time-token(R3):列表项透传 createdAt(项目开始时间)。
  assert.equal(a.createdAt, '2026-08-29T10:00:00.000Z');
  // 0.8.0:byRole[role] 为 { count, tokens }(self-report 无数值 → tokens=0)。
  assert.deepEqual(a.budget.totals.byRole, { product: { count: 1, tokens: 0 }, architect: { count: 1, tokens: 0 } });
  assert.deepEqual(a.budget.totals.bySource, { 'self-report': 2 });
  assert.equal(a.budget.totals.totalTokens, 0, 'self-report 无数值求和');
});

test('scanProjects:无 pending 门禁的项目 pendingGate=null(AC-R1.1)', async () => {
  const projects = await scanProjects('ws', makeStubDeps(tree));
  const b = projects.find((p) => p.id === 'proj-b');
  assert.equal(b.pendingGate, null);
  assert.equal(b.hasSummary, false);
  assert.deepEqual(b.currentStage, { id: 'clarify', type: 'work', role: 'product' });
});

test('scanProjects:scanRoot 不可读 → 返回 [](通道仍 200)', async () => {
  const projects = await scanProjects('missing-root', makeStubDeps(tree));
  assert.deepEqual(projects, []);
});

// ── 机制4 暂存区 parking 透传回归(2026-08-30)──────────────────────────────

test('scanProjects:state=parked 透传(机制4,AC-m4-p5 数据层)', async () => {
  const parkedTree = {
    ws: {
      'parked-a': {
        '.dsh-project': {
          'REGISTRY.json': JSON.stringify({
            schemaVersion: 1, id: 'parked-a', title: 'Parked A', state: 'parked',
            iteration: 1, stageIndex: 0, gateStatus: null, updatedAt: '2026-08-30T10:00:00.000Z',
          }),
          'FLOW.json': JSON.stringify({ schemaVersion: 1, stages: [{ id: 'clarify', type: 'work', role: 'product' }] }),
        },
      },
      'active-a': {
        '.dsh-project': {
          'REGISTRY.json': JSON.stringify({
            schemaVersion: 1, id: 'active-a', title: 'Active A', state: 'active',
            iteration: 1, stageIndex: 0, gateStatus: null, updatedAt: '2026-08-30T09:00:00.000Z',
          }),
          'FLOW.json': JSON.stringify({ schemaVersion: 1, stages: [{ id: 'clarify', type: 'work', role: 'product' }] }),
        },
      },
    },
  };
  const projects = await scanProjects('ws', makeStubDeps(parkedTree));
  const parked = projects.find((p) => p.id === 'parked-a');
  const active = projects.find((p) => p.id === 'active-a');
  assert.equal(parked.state, 'parked', 'state=parked 应透传');
  assert.equal(parked.stageIndex, 0);
  assert.equal(parked.gateStatus, null);
  assert.equal(active.state, 'active');
  // 通道 GET 默认列表也透传 state=parked
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(parkedTree), logger: { warn() {} } });
  const res = stubRes();
  await handler(stubReq('GET'), res);
  const body = lastJson(res);
  const viaApi = body.projects.find((p) => p.id === 'parked-a');
  assert.equal(viaApi.state, 'parked', '通道列表应透传 state=parked');
});

// ── 扫描根可配置:AC-R1.2 ───────────────────────────────────────────────────

test('resolveScanRoot:命名空间有 scanRoot 用之,否则回退默认 cwd(AC-R1.2)', () => {
  const deps = makeStubDeps(tree, 'default-ws');
  assert.equal(resolveScanRoot(makeSettingsService({}), deps), 'default-ws');
  assert.equal(resolveScanRoot(makeSettingsService({ scanRoot: '/custom/root' }), deps), '/custom/root');
  assert.equal(resolveScanRoot(makeSettingsService({ scanRoot: '' }), deps), 'default-ws');
});

test('改配置后扫描范围变化(AC-R1.2)', async () => {
  const tree2 = {
    ws: { 'proj-a': { '.dsh-project': { 'REGISTRY.json': JSON.stringify({ id: 'proj-a', title: 'A', state: 'active' }) } } },
    other: { 'proj-c': { '.dsh-project': { 'REGISTRY.json': JSON.stringify({ id: 'proj-c', title: 'C', state: 'active' }) } } },
  };
  const deps = makeStubDeps(tree2, 'ws');
  const settings = makeSettingsService({});
  const handler = makeApiHandler({ settingsService: settings, deps, logger: { warn() {} } });

  // 默认 cwd=ws → 只扫到 proj-a
  let res = stubRes();
  await handler(stubReq('GET'), res);
  assert.deepEqual(lastJson(res).projects.map((p) => p.id), ['proj-a']);

  // 改 scanRoot=other → 只扫到 proj-c
  res = stubRes();
  await handler(stubReq('PUT', API_ROUTE), res);
  // 先写配置
  const putRes = stubRes();
  const putReq = stubReq('PUT', API_ROUTE);
  putReq.on = (ev, cb) => { if (ev === 'data') cb(Buffer.from(JSON.stringify({ section: { scanRoot: 'other' } }))); if (ev === 'end') cb(); };
  await handler(putReq, putRes);
  assert.equal(lastStatus(putRes), 200);

  res = stubRes();
  await handler(stubReq('GET'), res);
  assert.deepEqual(lastJson(res).projects.map((p) => p.id), ['proj-c']);
});

// ── 单项目失败隔离:AC-R1.3 / AC-R5.5 ───────────────────────────────────────

test('单项目坏 JSON 不拖垮整体:坏者带错误分类,正常者照常(AC-R1.3)', async () => {
  const badTree = {
    ws: {
      'good': {
        '.dsh-project': {
          'REGISTRY.json': JSON.stringify({ id: 'good', title: 'Good', state: 'active' }),
          'FLOW.json': JSON.stringify({ stages: [{ id: 'clarify', type: 'work', role: 'product' }] }),
          'BUDGET.json': JSON.stringify({ estimate: null, cap: null, committed: [] }),
        },
      },
      'bad': {
        '.dsh-project': {
          'REGISTRY.json': '{ not json',
        },
      },
    },
  };
  const projects = await scanProjects('ws', makeStubDeps(badTree));
  assert.equal(projects.length, 2);
  const good = projects.find((p) => p.id === 'good');
  const bad = projects.find((p) => p.id === 'bad');
  assert.equal(good.error, undefined);
  assert.equal(good.title, 'Good');
  assert.equal(bad.error.category, 'malformed-registry');
  assert.ok(bad.error.message.length > 0);
});

// ── 错误分类 ────────────────────────────────────────────────────────────────

test('错误分类:missing-registry(REGISTRY 缺失)', async () => {
  const t = { ws: { 'p': { '.dsh-project': { 'FLOW.json': '{}' } } } };
  const projects = await scanProjects('ws', makeStubDeps(t));
  assert.equal(projects[0].error.category, 'missing-registry');
});

test('错误分类:malformed-registry(REGISTRY 缺关键字段)', async () => {
  const t = { ws: { 'p': { '.dsh-project': { 'REGISTRY.json': JSON.stringify({ id: 'p' }) } } } };
  const projects = await scanProjects('ws', makeStubDeps(t));
  assert.equal(projects[0].error.category, 'malformed-registry');
});

test('错误分类:malformed-flow(FLOW 坏 JSON,项目仍返回核心字段)', async () => {
  const t = {
    ws: { 'p': {
      '.dsh-project': {
        'REGISTRY.json': JSON.stringify({ id: 'p', title: 'P', state: 'active', stageIndex: 0 }),
        'FLOW.json': '{ bad',
      },
    } },
  };
  const projects = await scanProjects('ws', makeStubDeps(t));
  const p = projects[0];
  assert.equal(p.id, 'p');
  assert.equal(p.title, 'P');
  assert.equal(p.currentStage, null);
  assert.equal(p.error.category, 'malformed-flow');
});

test('错误分类:malformed-budget(BUDGET 坏 JSON,budget=null + 错误分类)', async () => {
  const t = {
    ws: { 'p': {
      '.dsh-project': {
        'REGISTRY.json': JSON.stringify({ id: 'p', title: 'P', state: 'active', stageIndex: 0 }),
        'FLOW.json': JSON.stringify({ stages: [{ id: 'clarify', type: 'work', role: 'product' }] }),
        'BUDGET.json': '{ bad',
      },
    } },
  };
  const projects = await scanProjects('ws', makeStubDeps(t));
  const p = projects[0];
  assert.equal(p.budget, null);
  assert.equal(p.error.category, 'malformed-budget');
});

test('错误分类:unreadable(读 REGISTRY 抛非 ENOENT 错误)', async () => {
  const deps = makeStubDeps(tree);
  const orig = deps.readFile;
  deps.readFile = async (path, enc) => {
    if (String(path).includes('REGISTRY.json')) {
      const e = new Error('EACCES: permission denied');
      e.code = 'EACCES';
      throw e;
    }
    return orig(path, enc);
  };
  const projects = await scanProjects('ws', deps);
  const a = projects.find((p) => p.id === 'proj-a');
  assert.equal(a.error.category, 'unreadable');
});

// ── 预算聚合:AC-R4.2 ───────────────────────────────────────────────────────

test('aggregateBudget:工作区级汇总(项目数/条目数/按 role/source 计数)(AC-R4.2)', async () => {
  const projects = await scanProjects('ws', makeStubDeps(tree));
  const agg = await aggregateBudget(projects);
  assert.equal(agg.workspace.projectCount, 2);
  assert.equal(agg.workspace.committedEntryCount, 2);
  // 0.8.0:byRole[role] 为 { count, tokens }。
  assert.deepEqual(agg.workspace.byRole, { product: { count: 1, tokens: 0 }, architect: { count: 1, tokens: 0 } });
  assert.deepEqual(agg.workspace.bySource, { 'self-report': 2 });
  assert.equal(agg.workspace.totalTokens, 0, 'self-report 无数值求和');
  // 每项目原样透传
  const a = agg.projects.find((p) => p.id === 'proj-a');
  assert.equal(a.estimate.tokens, 1000);
  assert.equal(a.cap.tokens, 5000);
  assert.equal(a.committed.length, 2);
  assert.equal(a.totals.committedEntryCount, 2);
});

test('aggregateBudget:无预算的项目被跳过(projectCount 只计有预算者)', async () => {
  const t = {
    ws: {
      'p1': { '.dsh-project': { 'REGISTRY.json': JSON.stringify({ id: 'p1', title: 'P1', state: 'active' }), 'BUDGET.json': JSON.stringify({ committed: [{ role: 'dev', source: 'self-report' }] }) } },
      'p2': { '.dsh-project': { 'REGISTRY.json': JSON.stringify({ id: 'p2', title: 'P2', state: 'active' }) } },
    },
  };
  const projects = await scanProjects('ws', makeStubDeps(t));
  const agg = await aggregateBudget(projects);
  assert.equal(agg.workspace.projectCount, 1);
  assert.equal(agg.workspace.committedEntryCount, 1);
  assert.deepEqual(agg.workspace.byRole, { dev: { count: 1, tokens: 0 } });
});

// ── 0.8.0 真实 token 计量:数值求和 + sharedOnce ───────────────────────────

test('computeTotals:对 runtime-events 数值求和,self-report 维持计数', async () => {
  const projects = await scanProjects('ws', makeStubDeps({
    ws: { 'p': { '.dsh-project': {
      'REGISTRY.json': JSON.stringify({ id: 'p', title: 'P', state: 'active' }),
      'BUDGET.json': JSON.stringify({ committed: [
        { role: 'dev', usage: { tokens: 120 }, source: 'runtime-events' },
        { role: 'dev', usage: { tokens: 80 }, source: 'runtime-events' },
        { role: 'product', usage: { tokens: 50 }, source: 'self-report' },
      ] }),
    } } },
  }));
  const a = projects.find((p) => p.id === 'p');
  assert.equal(a.budget.totals.committedEntryCount, 3);
  assert.deepEqual(a.budget.totals.byRole, {
    dev: { count: 2, tokens: 200 },
    product: { count: 1, tokens: 0 },
  });
  assert.equal(a.budget.totals.totalTokens, 200, 'runtime-events 数值求和');
});

test('aggregateBudget:工作区 totalTokens = 各项目 runtime-events 求和', async () => {
  const projects = await scanProjects('ws', makeStubDeps({
    ws: {
      'p1': { '.dsh-project': {
        'REGISTRY.json': JSON.stringify({ id: 'p1', title: 'P1', state: 'active' }),
        'BUDGET.json': JSON.stringify({ committed: [{ role: 'dev', usage: { tokens: 120 }, source: 'runtime-events' }] }),
      } },
      'p2': { '.dsh-project': {
        'REGISTRY.json': JSON.stringify({ id: 'p2', title: 'P2', state: 'active' }),
        'BUDGET.json': JSON.stringify({ committed: [{ role: 'tester', usage: { tokens: 30 }, source: 'runtime-events' }] }),
      } },
    },
  }));
  const agg = await aggregateBudget(projects);
  assert.equal(agg.workspace.totalTokens, 150, '工作区 totalTokens = 120+30');
  assert.deepEqual(agg.workspace.byRole, {
    dev: { count: 1, tokens: 120 },
    tester: { count: 1, tokens: 30 },
  });
});

test('aggregateBudget:sharedOnce 扫共享会话读 projcache 计一次,加入工作区总计', async () => {
  const projcache = JSON.stringify({
    unit: { version: 3 },
    tables: { sessions: {
      'intake-sess': { rows: { tokenUsage: { val: { totals: { uncachedInputTokens: 800, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 } } } } },
      'dev-sess': { rows: { tokenUsage: { val: { totals: { uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 } } } } },
    } },
  });
  const t = {
    ws: {
      'projcache.json': projcache,
      'proj-a': { '.dsh-project': {
        'REGISTRY.json': JSON.stringify({ id: 'proj-a', title: 'A', state: 'active', sessions: { 'intake-sess': { role: 'intake' }, 'dev-sess': { role: 'dev' } } }),
        'BUDGET.json': JSON.stringify({ committed: [{ role: 'dev', usage: { tokens: 120 }, source: 'runtime-events' }] }),
      } },
      'proj-b': { '.dsh-project': {
        'REGISTRY.json': JSON.stringify({ id: 'proj-b', title: 'B', state: 'active', sessions: { 'intake-sess': { role: 'intake' } } }),
        'BUDGET.json': JSON.stringify({ committed: [] }),
      } },
    },
  };
  const deps = makeStubDeps(t);
  const projects = await scanProjects('ws', deps);
  const agg = await aggregateBudget(projects, { projcachePath: 'ws/projcache.json', deps });
  // intake-sess(role=intake)共享 → sharedOnce=1000;dev-sess 仅 proj-a 登记 → 私有。
  assert.equal(agg.workspace.sharedOnce, 1000, 'intake 共享会话计一次');
  assert.equal(agg.workspace.totalTokens, 120 + 1000, '项目私有 120 + sharedOnce 1000');
});

test('aggregateBudget:projcache 缺失/读失败 → sharedOnce 非致命跳过', async () => {
  const t = {
    ws: {
      'proj-a': { '.dsh-project': {
        'REGISTRY.json': JSON.stringify({ id: 'proj-a', title: 'A', state: 'active', sessions: { 'intake-sess': { role: 'intake' } } }),
        'BUDGET.json': JSON.stringify({ committed: [] }),
      } },
    },
  };
  const deps = makeStubDeps(t);
  const projects = await scanProjects('ws', deps);
  const agg = await aggregateBudget(projects, { projcachePath: 'ws/missing.json', deps });
  assert.equal(agg.workspace.sharedOnce, 0, 'projcache 缺失 → sharedOnce=0,不炸');
  assert.equal(agg.workspace.totalTokens, 0);
});

// ── 0.8.0 host 侧 projcache 守卫 ──────────────────────────────────────────

test('readProjcache:host 侧守卫 unit.version(≠3 中文报错不误解析)', async () => {
  const deps = makeStubDeps({ ws: { 'pc.json': JSON.stringify({ unit: { version: 3 }, tables: {} }) } });
  const ok = await readProjcache('ws/pc.json', deps);
  assert.equal(ok.unit.version, 3);
  // version=2
  const v2 = makeStubDeps({ ws: { 'pc.json': JSON.stringify({ unit: { version: 2 }, tables: {} }) } });
  await assert.rejects(() => readProjcache('ws/pc.json', v2), /版本不支持.*仅支持 3/);
  // 缺 unit
  const noUnit = makeStubDeps({ ws: { 'pc.json': JSON.stringify({ tables: {} }) } });
  await assert.rejects(() => readProjcache('ws/pc.json', noUnit), /版本不支持/);
  // 缺失文件
  await assert.rejects(() => readProjcache('ws/missing.json', deps), /读取 projcache 失败/);
});

test('sessionTokenUsage:host 侧取单会话 tokenUsage(有效计费口径)', () => {
  const projcache = {
    unit: { version: 3 },
    tables: { sessions: {
      's1': { rows: { tokenUsage: { val: { totals: { uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 } } } } },
    } },
  };
  assert.deepEqual(sessionTokenUsage(projcache, 's1'), { uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 });
  assert.equal(sessionTokenUsage(projcache, 'ghost'), null);
  assert.equal(sessionTokenUsage(null, 's1'), null);
});

test('resolveProjcachePath:config projcachePath 优先,env DSH_HOME 回退', () => {
  assert.equal(resolveProjcachePath(makeSettingsService({ projcachePath: '/custom/pc.json' })), '/custom/pc.json');
  // 无 config → env DSH_HOME 回退(测试环境可能无 DSH_HOME,只断言形状)。
  const v = resolveProjcachePath(makeSettingsService({}));
  if (process.env.DSH_HOME) assert.ok(v && v.includes('session_projcache.json'));
  else assert.equal(v, null);
});

// ── 只读不写账本:AC-R4.3 ──────────────────────────────────────────────────

test('读视图不修改 BUDGET.json(AC-R4.3)', async () => {
  const snapshot = JSON.stringify(tree.ws['proj-a']);
  const deps = makeStubDeps(tree);
  await scanProjects('ws', deps);
  await readProject('ws', 'proj-a', deps);
  // 读操作后树结构不变(无写方法;stub fs 无 writeFile)
  assert.equal(JSON.stringify(tree.ws['proj-a']), snapshot);
});

// ── 单项目详情:readProject ─────────────────────────────────────────────────

test('readProject:详情含 registry/flow/budget/summary/summaryFile/gates/pendingGate/journals', async () => {
  const detail = await readProject('ws', 'proj-a', makeStubDeps(tree));
  assert.equal(detail.id, 'proj-a');
  assert.equal(detail.title, 'Project A');
  assert.equal(detail.registry.id, 'proj-a');
  assert.equal(detail.flow.stages.length, 3);
  assert.equal(detail.budget.committed.length, 2);
  assert.equal(detail.summaryFile, 'SUMMARY.md');
  assert.ok(detail.summary.length > 0);
  assert.equal(detail.gates.length, 1);
  assert.equal(detail.gates[0].stageId, 'spec-gate');
  assert.equal(detail.gates[0].verdict, 'approve');
  assert.equal(detail.gates[0].file, 'gates/02-spec-gate.md');
  // kr-board-time-token(R5):门禁条目补呈递/裁决时间。
  assert.equal(detail.gates[0].presentedAt, '2026-08-29T12:00:00.000Z');
  assert.equal(detail.gates[0].decidedAt, '2026-08-29T13:00:00.000Z');
  assert.equal(detail.pendingGate.stageId, 'spec-gate');
  // kr-board-time-token(R5):journals 从 string 数组改为对象数组 { file, stageId, start }。
  assert.deepEqual(detail.journals, [
    { file: '01-clarify.md', stageId: 'clarify', start: '2026-08-29T10:00:00.000Z' },
    { file: '02-spec-gate.md', stageId: 'spec-gate', start: '2026-08-29T11:00:00.000Z' },
  ]);
  // kr-board-time-token(R4):stageTimes = 各 journal 的 { stageId, start }。
  assert.deepEqual(detail.stageTimes, [
    { stageId: 'clarify', start: '2026-08-29T10:00:00.000Z' },
    { stageId: 'spec-gate', start: '2026-08-29T11:00:00.000Z' },
  ]);
});

test('readProject:id 不存在 → null', async () => {
  const detail = await readProject('ws', 'nope', makeStubDeps(tree));
  assert.equal(detail, null);
});

test('readProject:REGISTRY 无法识别 → null', async () => {
  const t = { ws: { 'p': { '.dsh-project': { 'REGISTRY.json': '{ bad' } } } };
  const detail = await readProject('ws', 'p', makeStubDeps(t));
  assert.equal(detail, null);
});

// ── SUMMARY 末段截断 ───────────────────────────────────────────────────────

test('summaryTail:取末段并截断到 maxLen', () => {
  const text = '# 头\n\n## 迭代 1\n\n### 本轮进展\n- 做了 X\n\n### 下一步\n- 待裁决';
  const tail = summaryTail(text, 500);
  assert.ok(tail.includes('迭代 1'));
  assert.ok(!tail.includes('# 头'));
  const short = summaryTail('abc', 500);
  assert.equal(short, 'abc');
  const truncated = summaryTail('x'.repeat(600), 500);
  assert.equal(truncated.length, 501); // 500 + 省略号
  assert.ok(truncated.endsWith('…'));
  assert.equal(summaryTail(''), null);
});

// ── 门禁解析 ────────────────────────────────────────────────────────────────

test('parseGateSummary:取首个 ### 摘要 后的段落', () => {
  assert.equal(parseGateSummary(SPEC_GATE_MD), '这是待裁决门禁的摘要文本。');
  assert.equal(parseGateSummary('no summary here'), undefined);
});

test('extractGateTitle / extractGateVerdict', () => {
  assert.equal(extractGateTitle(SPEC_GATE_MD), '需求规格确认');
  assert.equal(extractGateVerdict(SPEC_GATE_MD), 'approve');
  assert.equal(extractGateVerdict('# 门禁:x(y)\n\n### 摘要\n\n无裁决'), undefined);
});

test('parseGateFile:从文件名与内容解析 stageId/title/verdict/file', () => {
  const entry = parseGateFile('02-spec-gate.md', SPEC_GATE_MD);
  assert.equal(entry.stageId, 'spec-gate');
  assert.equal(entry.title, '需求规格确认');
  assert.equal(entry.verdict, 'approve');
  assert.equal(entry.file, 'gates/02-spec-gate.md');
  // kr-board-time-token(R5):补呈递/裁决时间(首个呈递/裁决行 ISO)。
  assert.equal(entry.presentedAt, '2026-08-29T12:00:00.000Z');
  assert.equal(entry.decidedAt, '2026-08-29T13:00:00.000Z');
});

test('parseGateFile:无呈递/裁决行 → presentedAt/decidedAt 不设(undefined)', () => {
  const entry = parseGateFile('02-spec-gate.md', '# 门禁:x(spec-gate)\n\n### 摘要\n\n无裁决');
  assert.equal(entry.presentedAt, undefined);
  assert.equal(entry.decidedAt, undefined);
});

test('extractJournalStart:取 journal 首个进入时间;无 → null', () => {
  assert.equal(extractJournalStart('- 进入时间:2026-09-06T04:43:16.446Z'), '2026-09-06T04:43:16.446Z');
  assert.equal(extractJournalStart('- 进入时间：2026-09-06T04:43:16.446Z'), '2026-09-06T04:43:16.446Z');
  assert.equal(extractJournalStart('# 无进入时间'), null);
  assert.equal(extractJournalStart(null), null);
});

test('journalStageId:从 journal 文件名取 stageId', () => {
  assert.equal(journalStageId('01-clarify.md'), 'clarify');
  assert.equal(journalStageId('07-build.md'), 'build');
  assert.equal(journalStageId('no-prefix.md'), 'no-prefix');
});

// ── 配置 schema ────────────────────────────────────────────────────────────

test('buildSchema:clean 剥离未知键,scanRoot/projcachePath 须为非空字符串', () => {
  const schema = buildSchema();
  assert.deepEqual(schema({}), {});
  assert.deepEqual(schema(undefined), {});
  assert.deepEqual(schema({ scanRoot: '/a/b', extra: 1 }), { scanRoot: '/a/b' });
  assert.deepEqual(schema({ scanRoot: '/a/b', projcachePath: '/pc.json' }), { scanRoot: '/a/b', projcachePath: '/pc.json' });
  assert.throws(() => schema({ scanRoot: '' }), TypeError);
  assert.throws(() => schema({ scanRoot: 123 }), TypeError);
  assert.throws(() => schema({ projcachePath: '' }), TypeError);
  assert.throws(() => schema({ projcachePath: 123 }), TypeError);
  assert.throws(() => schema('nope'), TypeError);
});

// ── 通道:AC-R5.1 / 5.2 / 5.3 / 5.4 / 5.5 ───────────────────────────────────

test('apply 注册通道路径 /plugins/project-hub/api(AC-R5.1)', async () => {
  const registrations = [];
  const webServer = { register(def) { registrations.push(def); } };
  const settings = { register() {}, get() { return {}; }, replace() {} };
  const ctx = makeStubCtx({ services: { settings, webServer } });
  await apply(ctx, {});
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].path, API_ROUTE);
  assert.equal(registrations[0].kind, 'exact');
  assert.equal(typeof registrations[0].handler, 'function');
});

test('通道非 GET/PUT 返回 405(AC-R5.2)', async () => {
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(tree), logger: { warn() {} } });
  for (const method of ['POST', 'DELETE', 'PATCH']) {
    const res = stubRes();
    await handler(stubReq(method), res);
    assert.equal(lastStatus(res), 405, `${method} 应返回 405`);
  }
});

test('通道 GET 默认返回 { ok, projects }(AC-R5.3)', async () => {
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(tree), logger: { warn() {} } });
  const res = stubRes();
  await handler(stubReq('GET'), res);
  const body = lastJson(res);
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.projects));
  assert.equal(body.projects.length, 2);
});

test('通道 GET ?project=<id> 返回详情;id 不存在 → 404(AC-R5.3)', async () => {
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(tree), logger: { warn() {} } });
  let res = stubRes();
  await handler(stubReq('GET', `${API_ROUTE}?project=proj-a`), res);
  const body = lastJson(res);
  assert.equal(body.ok, true);
  assert.equal(body.project.id, 'proj-a');
  assert.equal(body.project.flow.stages.length, 3);

  res = stubRes();
  await handler(stubReq('GET', `${API_ROUTE}?project=nope`), res);
  assert.equal(lastStatus(res), 404);
  assert.equal(lastJson(res).ok, false);
});

test('通道 GET ?view=budget 返回预算聚合(AC-R5.3)', async () => {
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(tree), logger: { warn() {} } });
  const res = stubRes();
  await handler(stubReq('GET', `${API_ROUTE}?view=budget`), res);
  const body = lastJson(res);
  assert.equal(body.ok, true);
  assert.equal(body.budget.workspace.projectCount, 2);
  assert.equal(body.budget.workspace.committedEntryCount, 2);
  assert.deepEqual(body.budget.workspace.bySource, { 'self-report': 2 });
  assert.equal(body.budget.workspace.totalTokens, 0);
});

test('通道 GET ?view=config 返回当前配置(AC-R5.3)', async () => {
  const settings = makeSettingsService({ scanRoot: '/custom' });
  const handler = makeApiHandler({ settingsService: settings, deps: makeStubDeps(tree), logger: { warn() {} } });
  const res = stubRes();
  await handler(stubReq('GET', `${API_ROUTE}?view=config`), res);
  const body = lastJson(res);
  assert.equal(body.ok, true);
  assert.equal(body.config.scanRoot, '/custom');
});

test('通道每次命中实时扫描,无缓存(AC-R5.4)', async () => {
  const deps = makeStubDeps(tree);
  let scanCount = 0;
  const orig = deps.readdir;
  deps.readdir = async (path, opts) => {
    if (String(path).replace(/\\/g, '/') === 'ws') scanCount += 1;
    return orig(path, opts);
  };
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps, logger: { warn() {} } });
  await handler(stubReq('GET'), stubRes());
  await handler(stubReq('GET'), stubRes());
  assert.equal(scanCount, 2, '连续两次 GET 应各触发一次扫描');
});

test('坏项目不拖垮通道:仍 200 + 结构化体,坏者带错误分类(AC-R5.5)', async () => {
  const badTree = {
    ws: {
      'good': {
        '.dsh-project': {
          'REGISTRY.json': JSON.stringify({ id: 'good', title: 'Good', state: 'active' }),
        },
      },
      'bad': {
        '.dsh-project': {
          'REGISTRY.json': '{ bad',
        },
      },
    },
  };
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(badTree), logger: { warn() {} } });
  const res = stubRes();
  await handler(stubReq('GET'), res);
  assert.equal(lastStatus(res), 200);
  const body = lastJson(res);
  assert.equal(body.ok, true);
  const bad = body.projects.find((p) => p.id === 'bad');
  assert.equal(bad.error.category, 'malformed-registry');
  const good = body.projects.find((p) => p.id === 'good');
  assert.equal(good.title, 'Good');
});

// ── 配置写:PUT ─────────────────────────────────────────────────────────────

test('PUT 校验:scanRoot 非目录 → 400(AC-R3.3)', async () => {
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(tree), logger: { warn() {} } });
  const req = stubReq('PUT', API_ROUTE);
  req.on = (ev, cb) => { if (ev === 'data') cb(Buffer.from(JSON.stringify({ section: { scanRoot: 'not-a-dir' } }))); if (ev === 'end') cb(); };
  const res = stubRes();
  await handler(req, res);
  assert.equal(lastStatus(res), 400);
  assert.equal(lastJson(res).ok, false);
});

test('PUT 成功:settings.replace 被调用,返回新配置(AC-R3.3)', async () => {
  const settings = makeSettingsService({});
  const handler = makeApiHandler({ settingsService: settings, deps: makeStubDeps(tree), logger: { warn() {} } });
  const req = stubReq('PUT', API_ROUTE);
  req.on = (ev, cb) => { if (ev === 'data') cb(Buffer.from(JSON.stringify({ section: { scanRoot: 'ws' } }))); if (ev === 'end') cb(); };
  const res = stubRes();
  await handler(req, res);
  assert.equal(lastStatus(res), 200);
  assert.equal(settings.calls.length, 1);
  assert.equal(settings.calls[0].ns, NAMESPACE);
  assert.deepEqual(settings.calls[0].section, { scanRoot: 'ws' });
  assert.equal(lastJson(res).config.scanRoot, 'ws');
});

test('PUT 空 section 清空覆盖(回退默认扫描根)', async () => {
  const settings = makeSettingsService({ scanRoot: 'ws' });
  const handler = makeApiHandler({ settingsService: settings, deps: makeStubDeps(tree, 'default-ws'), logger: { warn() {} } });
  const req = stubReq('PUT', API_ROUTE);
  req.on = (ev, cb) => { if (ev === 'data') cb(Buffer.from(JSON.stringify({ section: {} }))); if (ev === 'end') cb(); };
  const res = stubRes();
  await handler(req, res);
  assert.equal(lastStatus(res), 200);
  assert.deepEqual(settings.calls[0].section, {});
  assert.equal(lastJson(res).config.scanRoot, 'default-ws');
});

test('PUT body 非 JSON → 400', async () => {
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(tree), logger: { warn() {} } });
  const req = stubReq('PUT', API_ROUTE);
  req.on = (ev, cb) => { if (ev === 'data') cb(Buffer.from('not-json')); if (ev === 'end') cb(); };
  const res = stubRes();
  await handler(req, res);
  assert.equal(lastStatus(res), 400);
});

// ── stageCount:AC-R3.2 ─────────────────────────────────────────────────────

test('scanProjects 列表项新增 stageCount = FLOW.stages.length(AC-R3.2)', async () => {
  const projects = await scanProjects('ws', makeStubDeps(tree));
  const a = projects.find((p) => p.id === 'proj-a');
  const b = projects.find((p) => p.id === 'proj-b');
  assert.equal(a.stageCount, 3);
  assert.equal(b.stageCount, 1);
});

test('scanProjects:坏 FLOW → stageCount=null(优雅处理)(AC-R3.2)', async () => {
  const t = {
    ws: { 'p': {
      '.dsh-project': {
        'REGISTRY.json': JSON.stringify({ id: 'p', title: 'P', state: 'active', stageIndex: 0 }),
        'FLOW.json': '{ bad',
      },
    } },
  };
  const projects = await scanProjects('ws', makeStubDeps(t));
  assert.equal(projects[0].stageCount, null);
});

test('readProject 详情项新增 stageCount = flow.stages.length(AC-R3.2)', async () => {
  const detail = await readProject('ws', 'proj-a', makeStubDeps(tree));
  assert.equal(detail.stageCount, 3);
});

// ── view=file 端点:AC-R6.1 / 6.2 ───────────────────────────────────────────

test('view=file 返回 SUMMARY.md 的 text/plain 正文(AC-R6.1)', async () => {
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(tree), logger: { warn() {} } });
  const res = stubRes();
  await handler(stubReq('GET', `${API_ROUTE}?view=file&project=proj-a&name=SUMMARY.md`), res);
  assert.equal(lastStatus(res), 200);
  const head = [...res.calls].reverse().find((c) => c.kind === 'head');
  assert.equal(head.headers['content-type'], 'text/plain; charset=utf-8');
  assert.ok(lastBody(res).includes('proj-a 总结链'));
});

test('view=file:name 非 SUMMARY.md → 400(AC-R6.2)', async () => {
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(tree), logger: { warn() {} } });
  const res = stubRes();
  await handler(stubReq('GET', `${API_ROUTE}?view=file&project=proj-a&name=README.md`), res);
  assert.equal(lastStatus(res), 400);
  assert.equal(lastJson(res).ok, false);
});

test('view=file:project id 非法(空/含 / \ .. . 大写 下划线)→ 400(AC-R6.2)', async () => {
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(tree), logger: { warn() {} } });
  for (const bad of ['', 'a/b', 'a\\b', '..', '.', 'A', 'a_b']) {
    const res = stubRes();
    await handler(stubReq('GET', `${API_ROUTE}?view=file&project=${bad}&name=SUMMARY.md`), res);
    assert.equal(lastStatus(res), 400, `project id '${bad}' 应返回 400`);
  }
});

test('view=file:项目/文件不存在 → 404(AC-R6.2)', async () => {
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(tree), logger: { warn() {} } });
  // 项目不存在
  let res = stubRes();
  await handler(stubReq('GET', `${API_ROUTE}?view=file&project=nope&name=SUMMARY.md`), res);
  assert.equal(lastStatus(res), 404);
  // 项目存在但文件不存在(proj-b 无 SUMMARY.md)
  res = stubRes();
  await handler(stubReq('GET', `${API_ROUTE}?view=file&project=proj-b&name=SUMMARY.md`), res);
  assert.equal(lastStatus(res), 404);
});

// ═══════════════════════════════════════════════════════════════════════════
// 迭代8(project-hub-i8):board view config 读写 + PUT board 写端点安全护栏
// ═══════════════════════════════════════════════════════════════════════════

// ── readBoardViewConfig:AC-W7(读容错)────────────────────────────────────

test('readBoardViewConfig:文件缺失 → 空配置 { items: {} }(AC-W7)', async () => {
  const board = await readBoardViewConfig('ws', makeStubDeps(tree));
  assert.deepEqual(board, { items: {} });
});

test('readBoardViewConfig:坏 JSON → 空配置 { items: {} }(AC-W7)', async () => {
  const t = { ws: { [BOARD_VIEW_FILE]: '{ not json' } };
  const board = await readBoardViewConfig('ws', makeStubDeps(t));
  assert.deepEqual(board, { items: {} });
});

test('readBoardViewConfig:items 非对象 → 空配置(AC-W7)', async () => {
  const t = { ws: { [BOARD_VIEW_FILE]: JSON.stringify({ items: 'nope' }) } };
  const board = await readBoardViewConfig('ws', makeStubDeps(t));
  assert.deepEqual(board, { items: {} });
});

test('readBoardViewConfig:正常配置原样返回', async () => {
  const t = { ws: { [BOARD_VIEW_FILE]: JSON.stringify({ items: { 'proj-a': { pinned: true, archived: false } } }) } };
  const board = await readBoardViewConfig('ws', makeStubDeps(t));
  assert.deepEqual(board, { items: { 'proj-a': { pinned: true, archived: false } } });
});

// ── applyBoardChange:AC-W5(幂等 set/clear)────────────────────────────────

test('applyBoardChange:set pinned/archived(幂等,不修改入参)', () => {
  const board = { items: {} };
  const next = applyBoardChange(board, { id: 'proj-a', pinned: true, archived: true });
  assert.deepEqual(next, { items: { 'proj-a': { pinned: true, archived: true } } });
  // 入参不被修改
  assert.deepEqual(board, { items: {} });
});

test('applyBoardChange:重复 set 幂等(AC-W5)', () => {
  let board = { items: {} };
  board = applyBoardChange(board, { id: 'proj-a', pinned: true });
  board = applyBoardChange(board, { id: 'proj-a', pinned: true });
  assert.deepEqual(board, { items: { 'proj-a': { pinned: true } } });
});

test('applyBoardChange:clear(置 false)幂等', () => {
  let board = { items: { 'proj-a': { pinned: true, archived: true } } };
  board = applyBoardChange(board, { id: 'proj-a', pinned: false });
  assert.deepEqual(board, { items: { 'proj-a': { pinned: false, archived: true } } });
  board = applyBoardChange(board, { id: 'proj-a', pinned: false });
  assert.deepEqual(board, { items: { 'proj-a': { pinned: false, archived: true } } });
});

test('applyBoardChange:单字段变更保留另一字段', () => {
  let board = { items: { 'proj-a': { pinned: true } } };
  board = applyBoardChange(board, { id: 'proj-a', archived: true });
  assert.deepEqual(board, { items: { 'proj-a': { pinned: true, archived: true } } });
});

// ── writeBoardViewConfig:AC-W7(原子写)────────────────────────────────────

test('writeBoardViewConfig:临时文件 + rename 原子写(AC-W7)', async () => {
  const t = { ws: {} };
  const deps = makeStubDeps(t);
  const calls = [];
  const origWrite = deps.writeFile;
  const origRename = deps.rename;
  deps.writeFile = async (path, data, enc) => { calls.push({ kind: 'write', path }); return origWrite(path, data, enc); };
  deps.rename = async (from, to) => { calls.push({ kind: 'rename', from, to }); return origRename(from, to); };
  await writeBoardViewConfig('ws', { items: { 'proj-a': { pinned: true } } }, deps);
  // 先写临时文件,再 rename 到目标
  assert.equal(calls.length, 2);
  assert.equal(calls[0].kind, 'write');
  assert.ok(String(calls[0].path).includes(BOARD_VIEW_FILE), '临时文件应含目标文件名');
  assert.ok(String(calls[0].path).includes('.tmp-'), '临时文件应有 .tmp- 后缀');
  assert.equal(calls[1].kind, 'rename');
  assert.equal(String(calls[1].to).endsWith(BOARD_VIEW_FILE), true, 'rename 目标应为 board-view.json');
  // 落盘内容可读回
  const board = await readBoardViewConfig('ws', deps);
  assert.deepEqual(board, { items: { 'proj-a': { pinned: true } } });
});

// ── GET ?view=board ───────────────────────────────────────────────────────

test('通道 GET ?view=board 返回当前 board config(缺失 → 空配置)', async () => {
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(tree), logger: { warn() {} } });
  const res = stubRes();
  await handler(stubReq('GET', `${API_ROUTE}?view=board`), res);
  assert.equal(lastStatus(res), 200);
  const body = lastJson(res);
  assert.equal(body.ok, true);
  assert.deepEqual(body.board, { items: {} });
});

// ── PUT board 写端点:AC-W1~W6 ─────────────────────────────────────────────

test('PUT board:成功写归档/置顶,返回新 board(AC-W5/W6)', async () => {
  const t = { ws: { 'proj-a': { '.dsh-project': { 'REGISTRY.json': JSON.stringify({ id: 'proj-a', title: 'A', state: 'active' }) } } } };
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(t), logger: { warn() {} } });
  const res = stubRes();
  await handler(putReq({ board: { id: 'proj-a', pinned: true, archived: true } }), res);
  assert.equal(lastStatus(res), 200);
  const body = lastJson(res);
  assert.equal(body.ok, true);
  assert.deepEqual(body.board, { items: { 'proj-a': { pinned: true, archived: true } } });
  // 落盘可读回
  const board = await readBoardViewConfig('ws', makeStubDeps(t));
  assert.deepEqual(board, { items: { 'proj-a': { pinned: true, archived: true } } });
});

test('PUT board:AC-W1 拒绝未知字段', async () => {
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(tree), logger: { warn() {} } });
  const res = stubRes();
  await handler(putReq({ board: { id: 'proj-a', evil: true } }), res);
  assert.equal(lastStatus(res), 400);
  assert.equal(lastJson(res).ok, false);
});

test('PUT board:AC-W1 拒绝 board 非对象', async () => {
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(tree), logger: { warn() {} } });
  const res = stubRes();
  await handler(putReq({ board: 'nope' }), res);
  assert.equal(lastStatus(res), 400);
});

test('PUT board:AC-W4 拒绝非法 id(空/含 / \ .. . 大写 下划线)', async () => {
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(tree), logger: { warn() {} } });
  for (const bad of ['', 'a/b', 'a\\b', '..', '.', 'A', 'a_b']) {
    const res = stubRes();
    await handler(putReq({ board: { id: bad, pinned: true } }), res);
    assert.equal(lastStatus(res), 400, `id '${bad}' 应返回 400`);
  }
});

test('PUT board:AC-W4 拒绝不存在的项目 id', async () => {
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(tree), logger: { warn() {} } });
  const res = stubRes();
  await handler(putReq({ board: { id: 'nope', pinned: true } }), res);
  assert.equal(lastStatus(res), 400);
  assert.equal(lastJson(res).ok, false);
});

test('PUT board:archived/pinned 非 boolean → 400', async () => {
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(tree), logger: { warn() {} } });
  for (const bad of ['yes', 1, null, 'true']) {
    const res = stubRes();
    await handler(putReq({ board: { id: 'proj-a', pinned: bad } }), res);
    assert.equal(lastStatus(res), 400, `pinned=${bad} 应返回 400`);
  }
});

test('PUT board:archived 与 pinned 均缺 → 400', async () => {
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(tree), logger: { warn() {} } });
  const res = stubRes();
  await handler(putReq({ board: { id: 'proj-a' } }), res);
  assert.equal(lastStatus(res), 400);
});

test('PUT board:AC-W5 幂等(重复置顶安全)', async () => {
  const t = { ws: { 'proj-a': { '.dsh-project': { 'REGISTRY.json': JSON.stringify({ id: 'proj-a', title: 'A', state: 'active' }) } } } };
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(t), logger: { warn() {} } });
  await handler(putReq({ board: { id: 'proj-a', pinned: true } }), stubRes());
  const res = stubRes();
  await handler(putReq({ board: { id: 'proj-a', pinned: true } }), res);
  assert.equal(lastStatus(res), 200);
  assert.deepEqual(lastJson(res).board, { items: { 'proj-a': { pinned: true } } });
});

test('PUT board:AC-W3 只写 board-view.json,不写 REGISTRY/项目文件', async () => {
  const t = { ws: { 'proj-a': { '.dsh-project': { 'REGISTRY.json': JSON.stringify({ id: 'proj-a', title: 'A', state: 'active' }) } } } };
  const registrySnapshot = JSON.stringify(t.ws['proj-a']['.dsh-project']['REGISTRY.json']);
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(t), logger: { warn() {} } });
  await handler(putReq({ board: { id: 'proj-a', pinned: true } }), stubRes());
  // REGISTRY 未被改动
  assert.equal(JSON.stringify(t.ws['proj-a']['.dsh-project']['REGISTRY.json']), registrySnapshot);
  // 仅新增 board-view.json
  assert.ok(t.ws[BOARD_VIEW_FILE] !== undefined, '应写入 board-view.json');
  assert.equal(Object.keys(t.ws).length, 2, 'ws 下应只有 proj-a 目录 + board-view.json');
});

test('PUT board:AC-W6 并发安全(last-write-wins,无数据损坏)', async () => {
  const t = { ws: { 'proj-a': { '.dsh-project': { 'REGISTRY.json': JSON.stringify({ id: 'proj-a', title: 'A', state: 'active' }) } } } };
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(t), logger: { warn() {} } });
  // 并发两个写(置顶 + 归档)。last-write-wins:可能丢一字段,但文件绝不损坏
  // (始终为合法 JSON + 结构完整)。AC-W6 要求「不炸/无数据损坏」,非「两字段都保留」。
  await Promise.all([
    handler(putReq({ board: { id: 'proj-a', pinned: true } }), stubRes()),
    handler(putReq({ board: { id: 'proj-a', archived: true } }), stubRes()),
  ]);
  const board = await readBoardViewConfig('ws', makeStubDeps(t));
  // 文件仍为合法 JSON + 结构完整(无数据损坏)
  assert.ok(board && typeof board === 'object' && board.items && typeof board.items === 'object', 'board 应为合法结构');
  assert.ok(board.items['proj-a'] !== undefined, 'proj-a 条目应存在');
  // 至少一个字段被写入(last-write-wins 可能丢一字段,但不会两者皆空)
  assert.ok(board.items['proj-a'].pinned === true || board.items['proj-a'].archived === true, '至少一个字段应落盘');
});

test('PUT board:坏 JSON body → 400', async () => {
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(tree), logger: { warn() {} } });
  const req = stubReq('PUT', API_ROUTE);
  req.on = (ev, cb) => { if (ev === 'data') cb(Buffer.from('not-json')); if (ev === 'end') cb(); };
  const res = stubRes();
  await handler(req, res);
  assert.equal(lastStatus(res), 400);
});

// ── 流水线设置服务(kr-control-plane:设置 UI 与每角色模型分层)──────────────

// 样例策略文件树(scanRoot='ws' 下 .dsh-library)。
const settingsTree = {
  ws: {
    '.dsh-library': {
      'audit-rules.json': JSON.stringify({
        schemaVersion: 1,
        meta: { sedimentation: { enabled: true, everyNDelivered: 10 } },
        rules: [
          { id: 'R-a', name: 'A', observe: 'O1', when: { categoryCountGte: 3 }, act: 'F2', object: 'data-asset', dedupe: 'by-category', territory: 'pipeline-ws', meta: false, recommendation: 'x' },
          { id: 'R-b', name: 'B', observe: 'O3', when: { pendingHoursGte: 4 }, act: 'F1', object: 'gate', dedupe: 'by-project-gate', territory: 'pipeline-ws', meta: false, recommendation: 'y' },
        ],
      }),
      'rulings.json': JSON.stringify({ rulings: [{ id: 'r1', premise: '视觉类' }] }),
      'categories.json': JSON.stringify({ categories: [{ id: 'design-info' }] }),
      'audit-trail.json': JSON.stringify([
        { id: 'v1', type: 'audit-run-voucher', ts: '2026-09-05T08:00:00.000Z', returnHash: 'hash1' },
        { id: 'v2', type: 'audit-run-voucher', ts: '2026-09-05T09:00:00.000Z', returnHash: 'hash2' },
        { id: 'v3', type: 'other', ts: '2026-09-05T10:00:00.000Z' },
      ]),
      'roles': {
        // 机制测试样例数据(裁决②豁免):此 model 字段仅用于验证 writeRoleModel 机制
        // 可写任意模型(用户可写任意模型),属「机制测试」,不是生产配置。
        // 生产配置(deliverables/presets/project-pipeline/roles/*.json)必须零 model 字段
        // (五角色继承全局默认 deepseek-v4-flash:0731)。两者区分:测试样例数据豁免,
        // 生产配置零 model 字段。
        'dev.json': JSON.stringify({ id: 'dev', summary: 'dev', persona: 'p', model: { provider: 'ollama-cloud', model: 'deepseek-v4-flash:0731' } }),
      },
    },
  },
};
// 红线改道 R1:preset 角色清单不写 model 字段(五角色继承全局默认 deepseek-v4-flash:0731)。
// coordinator 保留一个 model 声明(默认模型)用于覆盖「preset 声明 → source=preset」分支。
// 该 coordinator model 声明同为机制测试样例数据(裁决②豁免):仅用于覆盖 preset 声明分支,
// 非生产配置;生产 roles/*.json 六角色全部零 model 字段。
const presetRolesTree = {
  preset: {
    'architect.json': JSON.stringify({ id: 'architect', summary: 'a', persona: 'p' }),
    'product.json': JSON.stringify({ id: 'product', summary: 'p', persona: 'p' }),
    'dev.json': JSON.stringify({ id: 'dev', summary: 'd', persona: 'p' }),
    'tester.json': JSON.stringify({ id: 'tester', summary: 't', persona: 'p' }),
    'deliverer.json': JSON.stringify({ id: 'deliverer', summary: 'd', persona: 'p' }),
    'coordinator.json': JSON.stringify({ id: 'coordinator', summary: 'c', persona: 'p', model: { provider: 'ollama-cloud', model: 'deepseek-v4-flash:0731' } }),
  },
};
// 合并树:ws(策略文件)+ preset(角色 manifest),供 readRoleModels/writeRoleModel 用。
const settingsTreeFull = {
  ws: settingsTree.ws,
  preset: presetRolesTree.preset,
};

test('readAuditRules:正常读回 audit-rules.json(AC-A1/A5)', async () => {
  const rules = await readAuditRules('ws', makeStubDeps(settingsTree));
  assert.equal(rules.schemaVersion, 1);
  assert.equal(rules.meta.sedimentation.everyNDelivered, 10);
  assert.equal(rules.rules.length, 2);
});

test('readAuditRules:缺失/坏 JSON → 空结构,不炸(AC-A5)', async () => {
  const empty = await readAuditRules('ws', makeStubDeps({ ws: {} }));
  assert.deepEqual(empty, { schemaVersion: 1, meta: {}, rules: [] });
  const bad = await readAuditRules('ws', makeStubDeps({ ws: { '.dsh-library': { 'audit-rules.json': 'not-json' } } }));
  assert.deepEqual(bad, { schemaVersion: 1, meta: {}, rules: [] });
});

test('readRulings / readCategories:只读展示(AC-A3)', async () => {
  const deps = makeStubDeps(settingsTree);
  const rulings = await readRulings('ws', deps);
  assert.equal(rulings.rulings.length, 1);
  const categories = await readCategories('ws', deps);
  assert.equal(categories.categories.length, 1);
});

test('readRoleModels:来源判定 workspace > preset > default(AC-B2/B4,扁平 provider/model)', async () => {
  const deps = makeStubDeps(settingsTreeFull);
  const roles = await readRoleModels('ws', 'preset', deps);
  const byRole = Object.fromEntries(roles.map((r) => [r.role, r]));
  // dev 有 workspace 覆盖 → source=workspace;manifest.model 对象形态展平为 provider+model 字符串
  assert.equal(byRole.dev.source, 'workspace');
  assert.equal(byRole.dev.provider, 'ollama-cloud');
  assert.equal(byRole.dev.model, 'deepseek-v4-flash:0731');
  // architect/product 无 workspace 覆盖,preset 无 model(红线 R1)且未传 settingsService → source=default,model=null
  assert.equal(byRole.architect.source, 'default');
  assert.equal(byRole.architect.model, null);
  assert.equal(byRole.product.source, 'default');
  assert.equal(byRole.product.model, null);
  // coordinator 无 workspace 覆盖,preset 声明 model(默认)→ source=preset
  assert.equal(byRole.coordinator.source, 'preset');
  assert.equal(byRole.coordinator.provider, 'ollama-cloud');
  assert.equal(byRole.coordinator.model, 'deepseek-v4-flash:0731');
  // tester 无 workspace 覆盖,preset 无 model → source=default
  assert.equal(byRole.tester.source, 'default');
  assert.equal(byRole.tester.model, null);
});

test('readRoleModels:传 settingsService → default 角色解析 subagent-defaults 为有效模型(用户默认档)', async () => {
  const deps = makeStubDeps(settingsTreeFull);
  const svc = {
    get(ns) {
      if (ns !== 'subagent-defaults') throw new Error('unexpected ns');
      return { agentOptions: { provider: 'ollama-cloud', model: 'deepseek-v4-flash:0731' } };
    },
  };
  const roles = await readRoleModels('ws', 'preset', deps, svc);
  const byRole = Object.fromEntries(roles.map((r) => [r.role, r]));
  // default 角色回填默认档 provider/model,source 仍为 default(徽章诚实)
  assert.equal(byRole.architect.source, 'default');
  assert.equal(byRole.architect.provider, 'ollama-cloud');
  assert.equal(byRole.architect.model, 'deepseek-v4-flash:0731');
  // 显式声明的角色不受默认档影响
  assert.equal(byRole.dev.source, 'workspace');
  assert.equal(byRole.dev.model, 'deepseek-v4-flash:0731');
  // settingsService 不可达 → 保持 null(不臆造)
  const rolesNoSvc = await readRoleModels('ws', 'preset', deps, { get() { throw new Error('boom'); } });
  assert.equal(rolesNoSvc.find((r) => r.role === 'architect').model, null);
});

test('readRoleModels:preset 目录不可读 → 无覆盖角色 source=default(unsupported-degradation)', async () => {
  const deps = makeStubDeps(settingsTree);
  const roles = await readRoleModels('ws', null, deps);
  const byRole = Object.fromEntries(roles.map((r) => [r.role, r]));
  assert.equal(byRole.dev.source, 'workspace');
  assert.equal(byRole.architect.source, 'default');
});

test('readAuditVouchers:最近 N 条 audit-run-voucher(id/returnHash/ts)(AC-A4)', async () => {
  const vouchers = await readAuditVouchers('ws', makeStubDeps(settingsTree), 5);
  assert.equal(vouchers.length, 2);
  assert.equal(vouchers[0].id, 'v2'); // ts 降序
  assert.equal(vouchers[0].returnHash, 'hash2');
  assert.equal(vouchers[1].id, 'v1');
});

test('readAuditVouchers:缺失/坏 audit-trail → 空列表(AC-A4)', async () => {
  const empty = await readAuditVouchers('ws', makeStubDeps({ ws: {} }), 5);
  assert.deepEqual(empty, []);
});

test('readSettings:聚合全部载荷(块 A + 块 B + 凭证)', async () => {
  const settings = await readSettings('ws', { presetRolesDir: 'preset' }, makeStubDeps(settingsTree));
  assert.ok(settings.auditRules && settings.auditRules.rules.length === 2);
  assert.ok(settings.rulings && settings.rulings.rulings.length === 1);
  assert.ok(settings.categories && settings.categories.categories.length === 1);
  assert.ok(Array.isArray(settings.roles) && settings.roles.length === 6);
  assert.ok(Array.isArray(settings.auditVouchers) && settings.auditVouchers.length === 2);
});

test('validateAuditRulesPayload:未知字段 400(AC-A2)', () => {
  assert.equal(validateAuditRulesPayload({ foo: 1 }).ok, false);
  assert.equal(validateAuditRulesPayload({ schemaVersion: 1, meta: {}, rules: [] }).ok, true);
  assert.equal(validateAuditRulesPayload({ rules: 'x' }).ok, false);
  assert.equal(validateAuditRulesPayload({ rules: [{ id: '' }] }).ok, false);
});

test('validateAuditRulesPayload:规则表内重复 rule.id → 400(AC-A2,新增重复 id 护栏)', () => {
  const dup = validateAuditRulesPayload({ schemaVersion: 1, meta: {}, rules: [{ id: 'R-a' }, { id: 'R-a' }] });
  assert.equal(dup.ok, false);
  assert.match(dup.error, /duplicate rule id: R-a/);
  // 不同 id 合法
  assert.equal(validateAuditRulesPayload({ schemaVersion: 1, meta: {}, rules: [{ id: 'R-a' }, { id: 'R-b' }] }).ok, true);
});

test('writeAuditRules:校验 → 备份 .trash → 原子写(AC-A1/A2/A5)', async () => {
  const tree = JSON.parse(JSON.stringify(settingsTree));
  const deps = makeStubDeps(tree);
  const next = JSON.parse(JSON.stringify(await readAuditRules('ws', deps)));
  next.meta.sedimentation.everyNDelivered = 5;
  const written = await writeAuditRules('ws', next, deps);
  assert.equal(written.meta.sedimentation.everyNDelivered, 5);
  // 原子写:目标文件已更新
  const reread = await readAuditRules('ws', deps);
  assert.equal(reread.meta.sedimentation.everyNDelivered, 5);
  // 备份:旧文件已复制到 .trash
  const trashFiles = Object.keys(tree.ws['.trash'] || {});
  assert.ok(trashFiles.some((f) => f.startsWith('audit-rules.json.') && f.endsWith('.bak')), '应有 .trash 备份');
});

test('writeAuditRules:新增规则 happy path——新 id 允许保存(AC-A1「增」可达,D1 修复)', async () => {
  const tree = JSON.parse(JSON.stringify(settingsTree));
  const deps = makeStubDeps(tree);
  const next = JSON.parse(JSON.stringify(await readAuditRules('ws', deps)));
  next.rules.push({ id: 'R-new', name: 'New', observe: 'O1', when: {}, act: 'F1', object: 'gate', dedupe: 'by-category', territory: 'pipeline-ws', meta: false, recommendation: 'z' });
  const written = await writeAuditRules('ws', next, deps);
  assert.equal(written.rules.length, 3);
  assert.ok(written.rules.some((r) => r.id === 'R-new'), '新增规则应写入');
  const reread = await readAuditRules('ws', deps);
  assert.equal(reread.rules.length, 3);
  assert.ok(reread.rules.some((r) => r.id === 'R-new'));
});

test('writeAuditRules:修改/删除不存在 id 视为新增(允许),不再 400 rule not found(AC-A1/A2,D1 修复)', async () => {
  const tree = JSON.parse(JSON.stringify(settingsTree));
  const deps = makeStubDeps(tree);
  const next = JSON.parse(JSON.stringify(await readAuditRules('ws', deps)));
  // 一个「修改」既有 R-a + 一个「新增」R-ghost(不存在于现有 rules[]):全量状态替换,均允许。
  next.rules[0].name = 'A2';
  next.rules.push({ id: 'R-ghost', name: 'x' });
  const written = await writeAuditRules('ws', next, deps);
  assert.equal(written.rules.length, 3);
  assert.equal(written.rules[0].name, 'A2');
  assert.ok(written.rules.some((r) => r.id === 'R-ghost'));
});

test('writeAuditRules:规则表内重复 rule.id → 400(AC-A2,新增重复 id 护栏)', async () => {
  const tree = JSON.parse(JSON.stringify(settingsTree));
  const deps = makeStubDeps(tree);
  const next = JSON.parse(JSON.stringify(await readAuditRules('ws', deps)));
  next.rules.push({ id: 'R-a', name: 'dup' }); // 与既有 R-a 重复
  await assert.rejects(() => writeAuditRules('ws', next, deps), /duplicate rule id: R-a/);
});

test('writeAuditRules:未知字段 → 400(AC-A2)', async () => {
  const deps = makeStubDeps(settingsTree);
  await assert.rejects(() => writeAuditRules('ws', { schemaVersion: 1, bogus: 1 }, deps), /unknown field: bogus/);
});

test('writeRoleModel:读 preset 角色 → 复制 + 设 model + 打用户批准标记 → 备份 → 原子写(AC-B2 + 防伪造 AC)', async () => {
  const tree = JSON.parse(JSON.stringify(settingsTreeFull));
  const deps = makeStubDeps(tree);
  const manifest = await writeRoleModel('ws', 'preset', { role: 'architect', provider: 'ollama-cloud', model: 'deepseek-v4-flash:0731' }, deps);
  assert.equal(manifest.model.provider, 'ollama-cloud');
  assert.equal(manifest.model.model, 'deepseek-v4-flash:0731');
  // 防伪造硬约束 AC:写面打用户批准标记 modelApproval(设置 UI 操作记录)
  assert.equal(manifest.modelApproval.by, 'user');
  assert.ok(typeof manifest.modelApproval.ts === 'string' && manifest.modelApproval.ts.length > 0);
  // workspace 覆盖已写入
  const wsRole = await readRoleModels('ws', 'preset', deps);
  const arch = wsRole.find((r) => r.role === 'architect');
  assert.equal(arch.source, 'workspace');
  assert.equal(arch.model, 'deepseek-v4-flash:0731');
});

test('writeRoleModel:role 非已知角色 → 400(AC-A2)', async () => {
  const deps = makeStubDeps(settingsTree);
  await assert.rejects(() => writeRoleModel('ws', 'preset', { role: 'ghost', provider: 'x', model: 'y' }, deps), /unknown role: ghost/);
});

test('writeRoleModel:provider/model 非非空字符串 → 400(AC-A2)', async () => {
  const deps = makeStubDeps(settingsTree);
  await assert.rejects(() => writeRoleModel('ws', 'preset', { role: 'dev', provider: '', model: 'y' }, deps), /provider must be a non-empty string/);
  await assert.rejects(() => writeRoleModel('ws', 'preset', { role: 'dev', provider: 'x', model: '' }, deps), /model must be a non-empty string/);
});

test('通道 GET ?view=settings 返回设置载荷(AC-A1~A5/B4)', async () => {
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(settingsTree), logger: { warn() {} } });
  const res = stubRes();
  await handler(stubReq('GET', `${API_ROUTE}?view=settings`), res);
  assert.equal(lastStatus(res), 200);
  const body = lastJson(res);
  assert.equal(body.ok, true);
  assert.ok(body.settings.auditRules && body.settings.auditRules.rules.length === 2);
  assert.ok(Array.isArray(body.settings.roles));
  assert.ok(Array.isArray(body.settings.auditVouchers));
});

test('通道 PUT settings.auditRules:成功写 + 返回新 auditRules(AC-A1)', async () => {
  const tree = JSON.parse(JSON.stringify(settingsTreeFull));
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(tree), logger: { warn() {} } });
  const current = await readAuditRules('ws', makeStubDeps(tree));
  const next = JSON.parse(JSON.stringify(current));
  next.meta.sedimentation.everyNDelivered = 3;
  const res = stubRes();
  await handler(putReq({ settings: { auditRules: next } }), res);
  assert.equal(lastStatus(res), 200);
  const body = lastJson(res);
  assert.equal(body.ok, true);
  assert.equal(body.settings.auditRules.meta.sedimentation.everyNDelivered, 3);
});

test('通道 PUT settings.roleModel:成功写 workspace 覆盖(AC-B2)', async () => {
  const tree = JSON.parse(JSON.stringify(settingsTreeFull));
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(tree), logger: { warn() {} } });
  const res = stubRes();
  await handler(putReq({ settings: { roleModel: { role: 'dev', provider: 'ollama-cloud', model: 'deepseek-v4-flash:0731' } } }), res);
  assert.equal(lastStatus(res), 200);
  const body = lastJson(res);
  assert.equal(body.ok, true);
  assert.equal(body.settings.roleModel.model.model, 'deepseek-v4-flash:0731');
});

test('通道 PUT settings:未知字段 → 400(AC-A2)', async () => {
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(settingsTree), logger: { warn() {} } });
  const res = stubRes();
  await handler(putReq({ settings: { auditRules: { bogus: 1 } } }), res);
  assert.equal(lastStatus(res), 400);
  assert.match(lastJson(res).error, /unknown field: bogus/);
});

test('通道 PUT settings.auditRules:新增规则(新 id)保存成功(AC-A1「增」可达,D1 修复)', async () => {
  const tree = JSON.parse(JSON.stringify(settingsTree));
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(tree), logger: { warn() {} } });
  const current = await readAuditRules('ws', makeStubDeps(tree));
  const next = JSON.parse(JSON.stringify(current));
  next.rules.push({ id: 'R-new', name: 'New', observe: 'O1', when: {}, act: 'F1', object: 'gate', dedupe: 'by-category', territory: 'pipeline-ws', meta: false, recommendation: 'z' });
  const res = stubRes();
  await handler(putReq({ settings: { auditRules: next } }), res);
  assert.equal(lastStatus(res), 200);
  const body = lastJson(res);
  assert.equal(body.ok, true);
  assert.equal(body.settings.auditRules.rules.length, 3);
  assert.ok(body.settings.auditRules.rules.some((r) => r.id === 'R-new'));
});

test('通道 PUT settings.auditRules:重复 rule.id → 400(AC-A2,新增重复 id 护栏)', async () => {
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(settingsTree), logger: { warn() {} } });
  const current = await readAuditRules('ws', makeStubDeps(settingsTree));
  const next = JSON.parse(JSON.stringify(current));
  next.rules.push({ id: 'R-a', name: 'dup' });
  const res = stubRes();
  await handler(putReq({ settings: { auditRules: next } }), res);
  assert.equal(lastStatus(res), 400);
  assert.match(lastJson(res).error, /duplicate rule id: R-a/);
});

test('通道 PUT settings:roleModel.role 非已知角色 → 400(AC-A2)', async () => {
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(settingsTree), logger: { warn() {} } });
  const res = stubRes();
  await handler(putReq({ settings: { roleModel: { role: 'ghost', provider: 'x', model: 'y' } } }), res);
  assert.equal(lastStatus(res), 400);
  assert.match(lastJson(res).error, /unknown role: ghost/);
});

test('通道 PUT settings:settings 非对象 → 400(AC-A2)', async () => {
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(settingsTree), logger: { warn() {} } });
  const res = stubRes();
  await handler(putReq({ settings: 'x' }), res);
  assert.equal(lastStatus(res), 400);
});

test('通道 PUT settings:备份/原子写失败 → 500(AC-A2)', async () => {
  // copyFile 抛错 → 备份失败 → 500
  const deps = makeStubDeps(settingsTree);
  deps.copyFile = async () => { throw new Error('disk full'); };
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps, logger: { warn() {} } });
  const current = await readAuditRules('ws', makeStubDeps(settingsTree));
  const next = JSON.parse(JSON.stringify(current));
  const res = stubRes();
  await handler(putReq({ settings: { auditRules: next } }), res);
  assert.equal(lastStatus(res), 500);
});

test('buildSchema:presetRolesDir 须为非空字符串,未知键剥离', () => {
  const schema = buildSchema();
  assert.deepEqual(schema({ scanRoot: 'ws', presetRolesDir: 'preset', bogus: 1 }), { scanRoot: 'ws', presetRolesDir: 'preset' });
  assert.throws(() => schema({ presetRolesDir: '' }), /presetRolesDir must be a non-empty string/);
  assert.throws(() => schema({ presetRolesDir: 123 }), /presetRolesDir must be a non-empty string/);
});

test('resolvePresetRolesDir:config 优先,env DSH_HOME 回退', () => {
  const svc = makeSettingsService({ presetRolesDir: '/custom/roles' });
  assert.equal(resolvePresetRolesDir(svc), '/custom/roles');
  const svc2 = makeSettingsService({});
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = '/home';
  try {
    const got = resolvePresetRolesDir(svc2);
    assert.ok(got.endsWith('.agent-presets/project-pipeline/roles') || got.endsWith('.agent-presets\\project-pipeline\\roles'), `应回退到 preset roles 目录,实际:${got}`);
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev;
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-R2 修复(delivery-gate 第 2 轮真机故障):结构化沉降控件值 reconcile 进 PUT 载荷
// ═══════════════════════════════════════════════════════════════════════════

// 结构化 spinbutton 显示 everyNDelivered=12,dirtyKeys=['everyNDelivered'](本次会话改过),
// JSON 文本面还是旧值 10 → reconcile 后输出 12,且该值进 PUT body。
test('reconcileSedimentation:spinbutton 显示值(结构化)进载荷,覆盖 JSON 文本旧值(AC-R2)', () => {
  const textMeta = { sedimentation: { enabled: true, everyNDelivered: 10 } };
  const structuredSed = { enabled: true, everyNDelivered: 12 };
  const out = reconcileSedimentation(textMeta, structuredSed, ['everyNDelivered']);
  assert.equal(out.sedimentation.everyNDelivered, 12, '结构化显示值应进最终载荷');
  assert.equal(out.sedimentation.enabled, true, '未命中的 enabled 保留 JSON 文本面');
  // 进 PUT body:writeAuditRules 直接落盘该载荷
  return writeAuditRules('ws', { schemaVersion: 1, meta: out, rules: [] }, makeStubDeps(settingsTree))
    .then((written) => { assert.equal(written.meta.sedimentation.everyNDelivered, 12); });
});

// 结构化 checkbox enabled=false(开→关),dirtyKeys=['enabled'],JSON 文本面旧 true
// → reconcile 后输出 enabled=false;写入文件后断言文件 enabled=false。
test('reconcileSedimentation:checkbox 开→关→保存→文件 enabled=false(AC-R2)', async () => {
  const textMeta = { sedimentation: { enabled: true, everyNDelivered: 10 } };
  const structuredSed = { enabled: false, everyNDelivered: 10 };
  const out = reconcileSedimentation(textMeta, structuredSed, ['enabled']);
  assert.equal(out.sedimentation.enabled, false, '结构化 checkbox 状态应进最终载荷');
  assert.equal(out.sedimentation.everyNDelivered, 10, '未命中的 everyNDelivered 保留 JSON 文本面');
  // 落盘:写 audit-rules.json 后读回,断言文件 enabled==false
  const tree = JSON.parse(JSON.stringify(settingsTree));
  const deps = makeStubDeps(tree);
  const next = JSON.parse(JSON.stringify(await readAuditRules('ws', deps)));
  next.meta = out;
  await writeAuditRules('ws', next, deps);
  const reread = await readAuditRules('ws', deps);
  assert.equal(reread.meta.sedimentation.enabled, false, '文件 enabled 应为 false');
});

// meta JSON 文本框直编路径不回归:dirtyKeys=[](无结构化改动),JSON 文本 everyNDelivered=12
// → reconcile 后输出仍 12。
test('reconcileSedimentation:meta JSON 文本框直编(无结构化改动)不回退(AC-R2)', () => {
  const textMeta = { sedimentation: { enabled: true, everyNDelivered: 12 } };
  const structuredSed = { enabled: true, everyNDelivered: 10 }; // 加载值,但本次会话未改控件
  const out = reconcileSedimentation(textMeta, structuredSed, []);
  assert.equal(out.sedimentation.everyNDelivered, 12, '文本框直编值应保留');
  assert.equal(out.sedimentation.enabled, true);
});

// reconcile 不改入参,缺 structured/缺 dirtyKeys/null 均安全。
test('reconcileSedimentation:不改入参;缺 structured/空 dirty 安全', () => {
  const textMeta = { sedimentation: { enabled: true, everyNDelivered: 10 } };
  const structuredSed = { enabled: false, everyNDelivered: 12 };
  const out = reconcileSedimentation(textMeta, structuredSed, ['enabled', 'everyNDelivered']);
  assert.equal(JSON.stringify(textMeta.sedimentation), JSON.stringify({ enabled: true, everyNDelivered: 10 }), '入参不被修改');
  // 无 structured → 输出等于文本面(深拷贝)
  const out2 = reconcileSedimentation(textMeta, null, ['enabled']);
  assert.deepEqual(out2, textMeta);
  // 无 dirty(空数组)→ 直接透传文本面
  const out3 = reconcileSedimentation(textMeta, structuredSed, []);
  assert.deepEqual(out3, textMeta);
});

// ═══════════════════════════════════════════════════════════════════════════
// kr-control-plane-i2(C-A):view=models 只读模型清单 + C-D 护栏(AC-B3)
// ═══════════════════════════════════════════════════════════════════════════

// 构造按命名空间返回不同值的 settings 服务(供 view=models 测试)。
function makeNsSettingsService(nsValues) {
  return {
    get(ns) { return nsValues[ns]; },
    async replace() {},
  };
}

test('readConfiguredModels:多 provider 映射正确(models 数组真实形状 + 旧单模型形状兼容,不暴露敏感字段)(C-A happy path)', () => {
  // 模型红线(AC-C1):测试夹具只用默认模型 deepseek-v4-flash:0731(多 provider 同型号),
  // 交付物零非默认模型引用;映射结构仍被验证。
  // 真实形状(settings.yaml llm-pi-ai):providers.<名>.models = [{ id, name?, contextWindow?, maxTokens? }]。
  const svc = makeNsSettingsService({
    'llm-pi-ai': {
      providers: {
        'ollama-cloud': {
          models: [{ id: 'deepseek-v4-flash:0731', name: 'DeepSeek V4 Flash', contextWindow: 1000000, maxTokens: 65565 }],
          apiKey: 'secret', baseURL: 'https://ollama.com/v1',
        },
        'provider-b': { models: [{ id: 'deepseek-v4-flash:0731', contextWindow: 1000000 }] },
        'provider-c': { models: [{ id: 'deepseek-v4-flash:0731' }] },
        'provider-legacy': { model: 'deepseek-v4-flash:0731' },
      },
    },
  });
  const out = readConfiguredModels(svc);
  assert.equal(out.ok, true);
  assert.deepEqual(out.models, [
    { provider: 'ollama-cloud', model: 'deepseek-v4-flash:0731', name: 'DeepSeek V4 Flash', contextWindow: 1000000 },
    { provider: 'provider-b', model: 'deepseek-v4-flash:0731', contextWindow: 1000000 },
    { provider: 'provider-c', model: 'deepseek-v4-flash:0731' },
    { provider: 'provider-legacy', model: 'deepseek-v4-flash:0731' },
  ]);
  // 不暴露 apiKey/baseURL/maxTokens 等敏感或非必要字段
  assert.ok(!JSON.stringify(out.models).includes('secret'));
  assert.ok(!JSON.stringify(out.models).includes('baseURL'));
  assert.ok(!JSON.stringify(out.models).includes('maxTokens'));
});

test('readConfiguredModels:providers 缺失/为空 → models:[](C-A 兜底)', () => {
  // providers 缺失
  assert.deepEqual(readConfiguredModels(makeNsSettingsService({ 'llm-pi-ai': {} })), { ok: true, models: [] });
  // providers 为空对象
  assert.deepEqual(readConfiguredModels(makeNsSettingsService({ 'llm-pi-ai': { providers: {} } })), { ok: true, models: [] });
  // llm-pi-ai 命名空间缺失
  assert.deepEqual(readConfiguredModels(makeNsSettingsService({})), { ok: true, models: [] });
  // providers 非对象
  assert.deepEqual(readConfiguredModels(makeNsSettingsService({ 'llm-pi-ai': { providers: 'nope' } })), { ok: true, models: [] });
});

test('readConfiguredModels:settingsService 不可达 → 显式 { ok:false, error:"模型清单不可用" }(C-B)', () => {
  // settingsService 为 null
  assert.deepEqual(readConfiguredModels(null), { ok: false, error: '模型清单不可用' });
  // settingsService 无 get 方法
  assert.deepEqual(readConfiguredModels({}), { ok: false, error: '模型清单不可用' });
  // get 抛错
  const throwing = { get() { throw new Error('boom'); } };
  assert.deepEqual(readConfiguredModels(throwing), { ok: false, error: '模型清单不可用' });
});

test('通道 GET ?view=models 返回模型清单(多 provider)(C-A happy path)', async () => {
  const svc = makeNsSettingsService({
    'llm-pi-ai': { providers: { 'ollama-cloud': { model: 'deepseek-v4-flash:0731' }, 'provider-b': { model: 'deepseek-v4-flash:0731' } } },
  });
  const handler = makeApiHandler({ settingsService: svc, deps: makeStubDeps(tree), logger: { warn() {} } });
  const res = stubRes();
  await handler(stubReq('GET', `${API_ROUTE}?view=models`), res);
  assert.equal(lastStatus(res), 200);
  const body = lastJson(res);
  assert.equal(body.ok, true);
  assert.deepEqual(body.models, [
    { provider: 'ollama-cloud', model: 'deepseek-v4-flash:0731' },
    { provider: 'provider-b', model: 'deepseek-v4-flash:0731' },
  ]);
});

test('通道 GET ?view=models:providers 为空 → { ok:true, models:[] }(C-A 兜底)', async () => {
  const svc = makeNsSettingsService({ 'llm-pi-ai': { providers: {} } });
  const handler = makeApiHandler({ settingsService: svc, deps: makeStubDeps(tree), logger: { warn() {} } });
  const res = stubRes();
  await handler(stubReq('GET', `${API_ROUTE}?view=models`), res);
  assert.equal(lastStatus(res), 200);
  const body = lastJson(res);
  assert.equal(body.ok, true);
  assert.deepEqual(body.models, []);
});

test('通道 GET ?view=models:settingsService 不可达 → { ok:false, error:"模型清单不可用" }(C-B)', async () => {
  const handler = makeApiHandler({ settingsService: null, deps: makeStubDeps(tree), logger: { warn() {} } });
  const res = stubRes();
  await handler(stubReq('GET', `${API_ROUTE}?view=models`), res);
  assert.equal(lastStatus(res), 200);
  const body = lastJson(res);
  assert.equal(body.ok, false);
  assert.equal(body.error, '模型清单不可用');
});

// ── C-D 护栏(AC-B3):UI 保存 audit-rules.json 后 rules[] 不变 ──────────────

test('applySedimentationChange:只动 meta.sedimentation,rules[] 原样透传(AC-B3)', () => {
  const current = {
    schemaVersion: 1,
    meta: { sedimentation: { enabled: true, everyNDelivered: 10 }, other: 'keep' },
    rules: [
      { id: 'R-a', name: 'A', observe: 'O1', when: { categoryCountGte: 3 }, act: 'F2', object: 'data-asset', dedupe: 'by-category', territory: 'pipeline-ws', meta: false, recommendation: 'x' },
      { id: 'R-b', name: 'B', observe: 'O3', when: { pendingHoursGte: 4 }, act: 'F1', object: 'gate', dedupe: 'by-project-gate', territory: 'pipeline-ws', meta: false, recommendation: 'y' },
    ],
  };
  const next = applySedimentationChange(current, { enabled: false, everyNDelivered: 5 });
  // rules[] 原样透传(深拷贝,内容不变)
  assert.deepEqual(next.rules, current.rules, 'rules[] 应原样透传');
  assert.equal(next.rules.length, 2);
  assert.equal(next.rules[0].id, 'R-a');
  assert.equal(next.rules[1].id, 'R-b');
  // 只动 meta.sedimentation
  assert.deepEqual(next.meta.sedimentation, { enabled: false, everyNDelivered: 5 });
  assert.equal(next.meta.other, 'keep', 'meta 其余字段保留');
  // 入参不被修改
  assert.equal(current.meta.sedimentation.enabled, true, '入参不被修改');
  assert.equal(current.meta.sedimentation.everyNDelivered, 10);
});

test('AC-B3:UI 保存(只改 meta.sedimentation)后 audit-rules.json 的 rules[] 不变', async () => {
  // 自建独立树(不依赖共享 settingsTree——既有 AC-R2 测试会直写 settingsTree 清空 rules,
  // 本测试须对测试顺序鲁棒)。
  const ownTree = {
    ws: {
      '.dsh-library': {
        'audit-rules.json': JSON.stringify({
          schemaVersion: 1,
          meta: { sedimentation: { enabled: true, everyNDelivered: 10 } },
          rules: [
            { id: 'R-a', name: 'A', observe: 'O1', when: { categoryCountGte: 3 }, act: 'F2', object: 'data-asset', dedupe: 'by-category', territory: 'pipeline-ws', meta: false, recommendation: 'x' },
            { id: 'R-b', name: 'B', observe: 'O3', when: { pendingHoursGte: 4 }, act: 'F1', object: 'gate', dedupe: 'by-project-gate', territory: 'pipeline-ws', meta: false, recommendation: 'y' },
          ],
        }),
      },
    },
  };
  const deps = makeStubDeps(ownTree);
  const current = await readAuditRules('ws', deps);
  const rulesSnapshot = JSON.stringify(current.rules);
  // UI 保存路径:applySedimentationChange 只动 meta.sedimentation → writeAuditRules 落盘。
  const next = applySedimentationChange(current, { enabled: false, everyNDelivered: 3 });
  await writeAuditRules('ws', next, deps);
  const reread = await readAuditRules('ws', deps);
  // rules[] 不变(AC-B3 断言)
  assert.equal(JSON.stringify(reread.rules), rulesSnapshot, 'UI 保存后 rules[] 应不变');
  assert.equal(reread.rules.length, 2);
  assert.equal(reread.meta.sedimentation.enabled, false);
  assert.equal(reread.meta.sedimentation.everyNDelivered, 3);
});

// ═══════════════════════════════════════════════════════════════════════════
// kr-control-plane-i2(C3 恢复默认,卡点 b1 裁决方案 A):resetRoleModel 移除 workspace 覆盖
// ═══════════════════════════════════════════════════════════════════════════

test('resetRoleModel:移除 workspace 覆盖 → source 变 preset/default(恢复默认→覆盖移除→source=默认继承)', async () => {
  const tree = JSON.parse(JSON.stringify(settingsTreeFull));
  const deps = makeStubDeps(tree);
  // 前置:dev 有 workspace 覆盖(source=workspace)。
  const before = await readRoleModels('ws', 'preset', deps);
  assert.equal(before.find((r) => r.role === 'dev').source, 'workspace');
  // 恢复默认:移除 dev workspace 覆盖。
  const reset = await resetRoleModel('ws', 'dev', deps);
  assert.deepEqual(reset, { role: 'dev', reset: true });
  // 覆盖文件已移除。
  assert.equal(tree.ws['.dsh-library'].roles['dev.json'], undefined, 'dev.json 覆盖应被移除');
  // source 回退:preset dev 无 model → default。
  const after = await readRoleModels('ws', 'preset', deps);
  assert.equal(after.find((r) => r.role === 'dev').source, 'default');
  assert.equal(after.find((r) => r.role === 'dev').model, null);
});

test('resetRoleModel:preset 声明 model 的角色 reset 后 source=preset', async () => {
  const tree = JSON.parse(JSON.stringify(settingsTreeFull));
  const deps = makeStubDeps(tree);
  // 先给 coordinator 写 workspace 覆盖(source=workspace)。
  await writeRoleModel('ws', 'preset', { role: 'coordinator', provider: 'ollama-cloud', model: 'deepseek-v4-flash:0731' }, deps);
  const before = await readRoleModels('ws', 'preset', deps);
  assert.equal(before.find((r) => r.role === 'coordinator').source, 'workspace');
  // 恢复默认:移除 coordinator workspace 覆盖 → preset 声明 model → source=preset。
  await resetRoleModel('ws', 'coordinator', deps);
  const after = await readRoleModels('ws', 'preset', deps);
  assert.equal(after.find((r) => r.role === 'coordinator').source, 'preset');
  assert.equal(after.find((r) => r.role === 'coordinator').provider, 'ollama-cloud');
  assert.equal(after.find((r) => r.role === 'coordinator').model, 'deepseek-v4-flash:0731');
});

test('resetRoleModel:role 非已知角色 → 400(AC-A2)', async () => {
  const deps = makeStubDeps(settingsTree);
  await assert.rejects(() => resetRoleModel('ws', 'ghost', deps), /unknown role: ghost/);
});

test('resetRoleModel:无既有覆盖(已默认态)→ 幂等成功(ENOENT 不炸)', async () => {
  const tree = JSON.parse(JSON.stringify(settingsTreeFull));
  const deps = makeStubDeps(tree);
  // architect 无 workspace 覆盖,reset 幂等成功。
  const reset = await resetRoleModel('ws', 'architect', deps);
  assert.deepEqual(reset, { role: 'architect', reset: true });
  const after = await readRoleModels('ws', 'preset', deps);
  assert.equal(after.find((r) => r.role === 'architect').source, 'default');
});

test('通道 PUT settings.roleModel reset:true → 移除覆盖 + 返回 source(恢复默认 happy path)', async () => {
  const tree = JSON.parse(JSON.stringify(settingsTreeFull));
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(tree), logger: { warn() {} } });
  const res = stubRes();
  await handler(putReq({ settings: { roleModel: { role: 'dev', reset: true } } }), res);
  assert.equal(lastStatus(res), 200);
  const body = lastJson(res);
  assert.equal(body.ok, true);
  assert.equal(body.settings.roleModel.role, 'dev');
  assert.equal(body.settings.roleModel.reset, true);
  assert.equal(body.settings.roleModel.source, 'default', 'preset dev 无 model → reset 后 source=default');
  // 覆盖文件已移除。
  assert.equal(tree.ws['.dsh-library'].roles['dev.json'], undefined, 'dev.json 覆盖应被移除');
});

test('通道 PUT settings.roleModel reset:true:role 非已知角色 → 400(AC-A2)', async () => {
  const handler = makeApiHandler({ settingsService: makeSettingsService(), deps: makeStubDeps(settingsTree), logger: { warn() {} } });
  const res = stubRes();
  await handler(putReq({ settings: { roleModel: { role: 'ghost', reset: true } } }), res);
  assert.equal(lastStatus(res), 400);
  assert.match(lastJson(res).error, /unknown role: ghost/);
});
