// dsh web 的 JSON-RPC 客户端。协议:POST /api/<method>,
// 信封 {"type":"client-request","rpcId","method","payload"} →
// {"type":"server-response","rpcId","result":{"ok":true,"value"}} 或 {"ok":false,"error":{code,message}}。
// 信任围栏:Host 须为 loopback(本机 curl/fetch 天然满足)。
import { API_BASE } from './paths.mjs';

let rpcCounter = 0;

export class ApiError extends Error {
  constructor(message, { code, status } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export async function call(method, payload = {}, { baseUrl = API_BASE, timeoutMs = 15000 } = {}) {
  const rpcId = `plugindev-${++rpcCounter}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${baseUrl}/api/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new ApiError(`无法连接 dsh web (${baseUrl}): ${error.message}`, { code: 'unreachable' });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new ApiError(`HTTP ${response.status} ${response.statusText} (${method})`, { status: response.status });
  }
  let envelope;
  try {
    envelope = await response.json();
  } catch (error) {
    throw new ApiError(`响应不是 JSON (${method}): ${error.message}`);
  }
  if (envelope.type !== 'server-response' || envelope.rpcId !== rpcId) {
    throw new ApiError(`响应信封异常 (${method}): ${JSON.stringify(envelope).slice(0, 200)}`);
  }
  const result = envelope.result;
  if (!result?.ok) {
    const error = result?.error ?? {};
    throw new ApiError(error.message ?? JSON.stringify(result), { code: error.code });
  }
  return result.value;
}

export async function reachable({ baseUrl = API_BASE } = {}) {
  try {
    await call('host.describe', {}, { baseUrl, timeoutMs: 3000 });
    return true;
  } catch {
    return false;
  }
}
