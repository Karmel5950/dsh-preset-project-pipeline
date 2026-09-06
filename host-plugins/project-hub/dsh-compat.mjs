// dsh-compat —— 本工作空间自有的 dsh 兼容层(vendored 单文件,零 npm 依赖)。
// 设计文档:plugindev\shared\dsh-compat\DESIGN.md(分层/演进纪律/升级 SOP)。
//
// 分层模型:插件只 import 本文件;官方 dsh 升级只改这里的实现,不改接口。
// 接口纪律:签名禁出现官方概念词(settings.register / webServer / apiproxy /
// waterfall 只许活在实现注释里)。
//
// 消费者约定(requires 声明,源码头注释,纯文档):
//   // requires: ['L1.hotConfig', 'L1.channel']   ← 只许 L1/L2;L0 隐含全量
// 运行时探测的调用时机:在对应服务的注入回调内调用 detectRuntime(见下)。
//
// 本文件是唯一权威源(plugindev\shared\dsh-compat\dsh-compat.mjs);
// presets/<id>/ 与 host-plugins 部署物里的副本是 vendored 拷贝,
// `npm run check` 校验逐字节一致 —— 改动只改这里,再同步副本。

export const COMPAT_VERSION = '0.2.0';

/** 能力目录(接口的一部分;条目语义见 DESIGN §5)。 */
export const CAPABILITIES = {
  'L0.ctx': { layer: 'L0', description: 'ctx 插件上下文面(事件订阅、日志、依赖注入与取用)' },
  'L0.dialect': { layer: 'L0', description: '组合方言(!!js、cordis:group、isolate、裸包名)' },
  'L1.hotConfig': { layer: 'L1', description: '热配置命名空间(持久化、热生效、schema 校验)' },
  'L1.channel': { layer: 'L1', description: '同源 HTTP 通道(GET/PUT)' },
  'L1.subagentOptions': { layer: 'L1', description: '子代理 AgentOptions 覆盖注入' },
  'L1.subagentToolFilter': { layer: 'L1', description: '子代理工具过滤(按角色 restrict 工具可见性)' },
  'L2.settingsCard': { layer: 'L2', description: '设置卡 UI 挂载(二期,未实现)' },
  'L2.toolRowSlot': { layer: 'L2', description: 'keyed 工具行视图槽(二期,未实现)' },
};

// ── detect:运行时能力满足报告(detectRuntime)──────────────────────────────
//
// 每能力一个探测函数,轻量、无副作用、不发起网络。status ∈ ok | degraded | broken。
// 调用时机约定:在能力对应服务的注入回调内调用(服务此时必然可达,探测 broken
// = 官方方法形状已变)。detectStatic(离线扫运行时树)见 toolkit/compat-scan.mjs,
// 白名单可见性等静态语义(degraded 判定)在那里,这里不重复。

function statusOf(ok, evidence, degradedNote) {
  if (!ok) return { status: 'broken', evidence };
  return degradedNote ? { status: 'degraded', evidence, note: degradedNote } : { status: 'ok', evidence };
}

function serviceShape(service, methods) {
  if (service === undefined || service === null) return `service unreachable`;
  const missing = methods.filter((m) => typeof service[m] !== 'function');
  return missing.length > 0 ? `missing methods: ${missing.join(', ')}` : null;
}

/** L0.ctx:ctx 事件面形状(装载成功本身即最强证明,这里是补充断言)。 */
export function probeCtx(ctx) {
  const problems = [];
  if (typeof ctx?.on !== 'function') problems.push('ctx.on missing');
  if (typeof ctx?.inject !== 'function') problems.push('ctx.inject missing');
  if (!ctx?.logger) problems.push('ctx.logger missing');
  return statusOf(problems.length === 0, problems.join('; ') || 'ctx.on/inject/logger present');
}

/** L1.hotConfig:热配置服务形状(在 settings 注入回调内调用)。 */
export function probeHotConfig(ctx) {
  let service;
  try {
    service = ctx?.get?.('settings');
  } catch (error) {
    return statusOf(false, `settings resolve threw: ${String(error?.message ?? error)}`);
  }
  const problem = serviceShape(service, ['register', 'get', 'replace']);
  return statusOf(problem === null, problem ?? 'settings.register/get/replace present');
}

/** L1.channel:同源通道路径的宿主服务形状(在 webServer 注入回调内调用)。 */
export function probeChannel(ctx) {
  let service;
  try {
    service = ctx?.get?.('webServer');
  } catch (error) {
    return statusOf(false, `webServer resolve threw: ${String(error?.message ?? error)}`);
  }
  const problem = serviceShape(service, ['register']);
  return statusOf(problem === null, problem ?? 'webServer.register present');
}

/** L1.subagentOptions:子代理会话标记与请求覆盖事件形状。 */
export function probeSubagentOptions(ctx) {
  const problems = [];
  if (typeof ctx?.on !== 'function') problems.push('ctx.on missing');
  else if (typeof ctx.on('agent/created', () => {}) !== 'function' && ctx.on('agent/created', () => {}) === undefined) {
    // cordis ctx.on 返回值形状不一;只要调用不抛即认为可挂。
  }
  return statusOf(problems.length === 0, problems.join('; ') || 'agent/created subscribable');
}

/** L1.subagentToolFilter:子代理会话标记与工具过滤事件形状。 */
export function probeSubagentToolFilter(ctx) {
  const problems = [];
  if (typeof ctx?.on !== 'function') problems.push('ctx.on missing');
  return statusOf(problems.length === 0, problems.join('; ') || 'agent/created subscribable');
}

export const RUNTIME_PROBES = {
  'L0.ctx': probeCtx,
  'L1.hotConfig': probeHotConfig,
  'L1.channel': probeChannel,
  'L1.subagentOptions': probeSubagentOptions,
  'L1.subagentToolFilter': probeSubagentToolFilter,
};

/**
 * 汇总探测(只探测给出的能力;requires 只许 L1/L2,L0 对一切插件隐含)。
 * 返回 { capabilities: { '<id>': {status, evidence, note?} }, compatVersion }。
 */
export function detectRuntime(ctx, requires = []) {
  const capabilities = {};
  for (const id of ['L0.ctx', ...requires]) {
    const probe = RUNTIME_PROBES[id];
    capabilities[id] = probe ? probe(ctx) : { status: 'ok', evidence: 'no runtime probe (static-only capability)' };
  }
  return { compatVersion: COMPAT_VERSION, capabilities };
}

/**
 * 断供断言。requires 两种形态:
 *   ['L1.hotConfig', …]                         —— 全部 required
 *   { required: […], optional: […] }            —— 分档声明
 * required 且 broken → throw(挂载失败,roster 可见);optional 的 broken 与
 * 全部 degraded → 记 warn 后继续。层级语义见 DESIGN §5(失效语义由层固化)。
 */
export function assertUsable(report, requires = [], logger) {
  const spec = Array.isArray(requires)
    ? { required: requires, optional: [] }
    : { required: [], optional: [], ...requires };
  for (const id of [...spec.required, ...spec.optional]) {
    const entry = report?.capabilities?.[id];
    if (!entry) continue;
    if (entry.status === 'broken') {
      if (spec.required.includes(id)) {
        throw new Error(`dsh-compat: capability "${id}" broken — ${entry.evidence}`);
      }
      logger?.warn?.(`dsh-compat: capability "${id}" broken (optional, degraded to no-op) — ${entry.evidence}`);
      continue;
    }
    if (entry.status === 'degraded') {
      logger?.warn?.(`dsh-compat: capability "${id}" degraded — ${entry.note ?? entry.evidence}`);
    }
  }
  return report;
}

// ── L1.hotConfig:热配置命名空间 ────────────────────────────────────────────

/**
 * 持有命名空间(幂等注册:他人已注册时共享既有注册,registered=false)并返回读写面:
 *   get()          → 已解析值(命名空间缺失 = fallback)
 *   replace(value) → 整段替换(校验失败 throw;comment-preserving 由官方文档层保证)
 * 调用时机:settings 注入回调内。schema 由调用方构造(buildNamespaceSchema)。
 */
export function hotConfig(ctx, { ns, schema, fallback = {}, logger, label = ns }) {
  const service = ctx.get('settings');
  let registered = false;
  try {
    service.register(ns, schema, { applies: 'live' });
    registered = true;
  } catch (error) {
    logger?.info?.(
      `dsh-compat: namespace "${ns}" already registered; sharing the existing registration (${String(error?.message ?? error)})`,
    );
    logger?.warn?.(`dsh-compat: ${label}: namespace owned by another registrant — verify its schema still accepts your fields`);
  }
  return {
    ns,
    registered,
    service,
    get: () => service.get(ns) ?? fallback,
    replace: async (value) => service.replace(ns, value),
  };
}

/**
 * 构造"schemastery 兼容"命名空间 schema:可调用(解析+校验原始 section)、
 * toJSON() 产出 {uid, refs} 信封、type/dict 供官方 redactSecrets 遍历。
 * shape 描述节点树:{ type, meta, value?, list?, dict? };解析器 clean(section, node)
 * 递归剥离未知键并校验;clean 抛错 = 校验失败(fail-fast)。
 */
export function buildNamespaceSchema(ns, shape, clean) {
  const refs = {};
  let nextRef = 0;
  const addRef = (node) => {
    const id = nextRef++;
    refs[String(id)] = node;
    return id;
  };
  const materialize = (spec) => {
    const node = { type: spec.type, meta: spec.meta ?? {} };
    if (spec.value !== undefined) node.value = spec.value;
    if (spec.list !== undefined) node.list = spec.list.map(materialize);
    if (spec.dict !== undefined) {
      node.dict = {};
      for (const [key, child] of Object.entries(spec.dict)) node.dict[key] = materialize(child);
    }
    return addRef(node);
  };
  const rootRef = materialize(shape);
  const json = { uid: rootRef, refs };
  const rootNode = refs[String(rootRef)];

  const schema = (section) => clean(section, shape);
  schema.type = 'object';
  schema.meta = {}; // 对齐官方 redactSecrets 遍历面;描述性 meta 走 toJSON 信封
  // 运行面 dict 顶层解引用为 node 对象(redactSecrets 遍历用);信封 json 里
  // 保持 ref id。内层 dict 与原版一致仍为 id。
  schema.dict = {};
  for (const [key, ref] of Object.entries(rootNode.dict ?? {})) schema.dict[key] = refs[String(ref)];
  schema.toJSON = () => structuredClone(json);
  void ns;
  return schema;
}

// ── L1.channel:同源 HTTP 通道 ──────────────────────────────────────────────

/** 通道处理器可用 {@link HttpError} 抛非 400 的状态码(409/503 等)。 */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** 读一个 node:http 请求的 body(上限 64 KiB,防滥用)。 */
export function readBody(req, limitBytes = 65536) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** 发 JSON 响应(node:http handler 风格)。 */
export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

/**
 * 通用通道 handler 骨架(GET/PUT/405):
 *   GET        → { ok: true, ...(await get()) }
 *   PUT {section} → await put(section)(普通 Error → 400;HttpError → 其 status)
 *                   成功后同样回 get() 的快照
 * get() 返回 spread 进响应的对象(如 { value, namespace, writable })。
 */
export function jsonChannelHandler({ get, put, logger, label = 'dsh-compat channel' }) {
  return async function handler(req, res) {
    try {
      if (req.method === 'GET') {
        sendJson(res, 200, { ok: true, ...(await get()) });
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
        const section = parsed.section ?? {};
        if (typeof section !== 'object' || section === null || Array.isArray(section)) {
          sendJson(res, 400, { ok: false, error: 'section must be an object' });
          return;
        }
        try {
          await put(section);
        } catch (error) {
          const status = error instanceof HttpError ? error.status : 400;
          sendJson(res, status, { ok: false, error: String(error?.message ?? error) });
          return;
        }
        sendJson(res, 200, { ok: true, ...(await get()) });
        return;
      }
      sendJson(res, 405, { ok: false, error: `${req.method} not allowed` });
    } catch (error) {
      logger?.warn?.(`${label}: handler error: ${String(error?.message ?? error)}`);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'internal error' });
      else res.destroy();
    }
  };
}

/**
 * 在宿主 web 服务上注册同源通道。注册时机由内部嵌套注入推迟到服务代际落定
 * 之后(实测先例:早期注册会落到中途代上,405 / 永不生效)。
 * required 语义说明:注册失败发生在异步注入回调里,无法同步 throw 中止挂载
 * —— 实现为 error 级日志;required 消费者的断供把关由单测与 conformance
 * (curl 矩阵)兜底,见 DESIGN §5 层规则 1 的例外注记。
 */
export function channel(ctx, { path, handler, required = false, logger, label = path }) {
  let settle;
  const done = new Promise((resolve) => {
    settle = resolve;
  });
  ctx.inject(['webServer'], (wctx) => {
    const log = logger ?? wctx.logger;
    const fail = (message) => {
      if (required) log?.error?.(message);
      else log?.warn?.(message);
      settle(false);
    };
    const probe = probeChannel(wctx);
    if (probe.status === 'broken') {
      fail(`dsh-compat: channel ${path} unavailable — ${probe.evidence}`);
      return;
    }
    try {
      wctx.get('webServer').register({ kind: 'exact', path, handler });
    } catch (error) {
      fail(`dsh-compat: could not register ${path} (${String(error?.message ?? error)})`);
      return;
    }
    log?.info?.(`dsh-compat: channel ready at ${path} (GET read / PUT write)`);
    settle(true);
  });
  return { path, done };
}

// ── L1.subagentOptions:子代理 AgentOptions 覆盖注入 ────────────────────────

/** 允许覆盖的 AgentOptions 字段(顺序即展示顺序;逐字段覆盖,缺失即回退)。 */
export const OVERRIDABLE_FIELDS = ['provider', 'model', 'reasoningEffort', 'maxTokens'];

/** 会话头是否为子代理会话(subagent 与 subagent_fork 共用 origin 标记)。 */
export function isSubagentSession(agent) {
  const header = agent?.session?.header;
  return header !== undefined && header !== null && typeof header === 'object' && header.origin === 'subagent';
}

/** 把覆盖层逐字段套到已解析的请求配置上(无变化时原样返回)。 */
export function applyOverridesToRequestConfig(resolvedConfig, overrides) {
  if (overrides === undefined || overrides === null) return resolvedConfig;
  let next;
  for (const key of OVERRIDABLE_FIELDS) {
    if (overrides[key] === undefined) continue;
    if (resolvedConfig?.[key] === overrides[key]) continue;
    next ??= { ...resolvedConfig };
    next[key] = overrides[key];
  }
  return next ?? resolvedConfig;
}

/**
 * 给后续创建的每个子代理会话挂请求级覆盖:
 *   resolve(agent) → 覆盖层对象 | undefined(每次请求热读)
 * 与官方 installModelSelection 同一手法(官方 AgentOptions 透传链不读取
 * reasoningEffort,必须经请求覆盖注入)。web 顶层会话不经 registry announce,
 * 本监听只覆盖子代理 —— 这正是需求语义。
 */
export function subagentOptions(ctx, { resolve, logger }) {
  ctx.on('agent/created', ({ agent } = {}) => {
    if (!isSubagentSession(agent)) return;
    agent.ctx.on('agent/request', async (_payload, next) => {
      const resolvedConfig = await next();
      let overrides;
      try {
        overrides = await resolve(agent);
      } catch (error) {
        logger?.warn?.(`dsh-compat: subagentOptions resolve failed: ${String(error?.message ?? error)}`);
        return resolvedConfig;
      }
      return applyOverridesToRequestConfig(resolvedConfig, overrides);
    });
  });
}

/**
 * 给后续创建的每个子代理会话按角色施加工具过滤:
 *   resolve(agent) → toolFilter({allow|deny}) | undefined
 * 识别不到角色 / 无 toolFilter → 返回 undefined(不 restrict,白名单兜底)。
 * 与 subagentOptions 同一 agent/created seam;restrict 是单调叠加,与既有
 * restrict 相交。restrict 抛错(如未知工具名)记 warn 后继续,不炸监听。
 */
export function subagentToolFilter(ctx, { resolve, logger }) {
  ctx.on('agent/created', async ({ agent } = {}) => {
    if (!isSubagentSession(agent)) return;
    let filter;
    try {
      filter = await resolve(agent);
    } catch (error) {
      logger?.warn?.(`dsh-compat: subagentToolFilter resolve failed: ${String(error?.message ?? error)}`);
      return;
    }
    if (filter === undefined || filter === null) return; // 识别不到 → 不 restrict
    try {
      agent.ctx.tools.restrict(filter);
    } catch (error) {
      logger?.warn?.(`dsh-compat: subagentToolFilter restrict failed: ${String(error?.message ?? error)}`);
    }
  });
}

export default {
  COMPAT_VERSION,
  CAPABILITIES,
  detectRuntime,
  assertUsable,
  hotConfig,
  buildNamespaceSchema,
  channel,
  jsonChannelHandler,
  HttpError,
  readBody,
  sendJson,
  subagentOptions,
  subagentToolFilter,
  isSubagentSession,
  applyOverridesToRequestConfig,
  OVERRIDABLE_FIELDS,
};
