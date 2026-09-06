// 单元测试桩:构造最小 cordis 插件上下文。
// 用法:const ctx = makeStubCtx(); await apply(ctx, config);
// 然后 ctx.listeners.get('system-prompt/assemble') 拿到捕获的监听器去驱动。
// 注意:桩的 effect/dispose 只为单测服务;真实 preset 行上下文中普通函数 effect
// 回调会在挂载定型期提前触发,勿用做注册类清理(2026-08-29 实测教训)。
export function makeStubCtx({ services = {} } = {}) {
  const listeners = new Map();
  const disposers = [];
  const ctx = {
    listeners,
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(listener);
      const list = listeners.get(event);
      const dispose = () => {
        const at = list.indexOf(listener);
        if (at >= 0) list.splice(at, 1);
      };
      disposers.push(dispose);
      return dispose;
    },
    // 简化版 ctx.inject:依赖全部就绪时立刻回调(真实 cordis 还会在服务
    // 重建时重放;测试里服务常驻,不等价但覆盖主路径)。
    inject(names, callback) {
      const missing = names.filter((n) => services[n] === undefined);
      if (missing.length > 0) {
        ctx.logger.warn(`stub ctx.inject: 缺少服务 ${missing.join(', ')},回调未执行`);
        return;
      }
      callback(ctx);
    },
    effect(dispose) {
      disposers.push(dispose);
    },
    async dispose() {
      for (const dispose of disposers.splice(0)) await dispose();
    },
    get(name) {
      return services[name];
    },
    logger: makeStubLogger(),
    tools: makeStubRegistry('register'),
    systemPrompt: makeStubRegistry('section'),
  };
  // 镜像注入的服务为 ctx 属性(真实 cordis 的 inject 语义:注入即属性访问);
  // 不覆盖桩自带成员(tools/systemPrompt/logger 等以桩为准)。
  for (const [key, value] of Object.entries(services)) {
    if (ctx[key] === undefined) ctx[key] = value;
  }
  return ctx;
}

export function makeStubLogger() {
  const logger = {
    warns: [],
    errors: [],
    infos: [],
    warn(...args) { logger.warns.push(args); },
    error(...args) { logger.errors.push(args); },
    info(...args) { logger.infos.push(args); },
  };
  return logger;
}

// 通用注册表桩:按方法名(register / section)记录注册项,返回卸载函数。
function makeStubRegistry(methodName) {
  const items = [];
  const registry = {
    items,
    [methodName](definition) {
      items.push(definition);
      return () => {
        const at = items.indexOf(definition);
        if (at >= 0) items.splice(at, 1);
      };
    },
  };
  return registry;
}

// 便捷:取某事件捕获到的监听器(洋葱式插件通常只注册一个)。
export function capturedListener(ctx, event) {
  const list = ctx.listeners.get(event) ?? [];
  if (list.length === 0) throw new Error(`没有捕获到 ${event} 的监听器`);
  if (list.length > 1) throw new Error(`${event} 捕获到 ${list.length} 个监听器,请直接访问 ctx.listeners`);
  return list[0];
}
