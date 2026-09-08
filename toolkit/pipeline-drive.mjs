#!/usr/bin/env node
// pipeline-drive.mjs — 向指定 dsh 会话投递一条 prompt。
// 固化自 tmp-drive.mjs:参数化(sessionId、prompt 文件或 stdin、API 基址、超时),去 tmp- 前缀硬编码。
// 零依赖纯 node(仅 node 内置模块 + 全局 fetch)。
//
// 用法:
//   node pipeline-drive.mjs --session <sessionId> --prompt <file>
//   node pipeline-drive.mjs --session <sessionId> --stdin
//   cat msg.txt | node pipeline-drive.mjs --session <sessionId> --stdin
//
// 选项:
//   --session <id>      必填。目标会话 id。
//   --prompt <file>     从文件读取 prompt 文本(与 --stdin 二选一)。
//   --stdin             从标准输入读取 prompt 文本(与 --prompt 二选一)。
//   --api <baseUrl>     dsh web API 基址,默认 http://127.0.0.1:3081。
//   --timeout-ms <ms>   请求超时(毫秒),默认 15000。
//
// 退出码:
//   0  成功(HTTP 2xx 且信封 ok)。
//   1  失败(参数错误 / 连接失败 / HTTP 非 2xx / 信封非 ok)。
import fs from 'node:fs';
import { API_BASE } from './paths.mjs';

const DEFAULT_API = API_BASE;
const DEFAULT_TIMEOUT_MS = 15000;

function usage() {
  console.error(
    '用法: node pipeline-drive.mjs --session <sessionId> (--prompt <file> | --stdin) [--api <baseUrl>] [--timeout-ms <ms>]'
  );
}

function parseArgs(argv) {
  const args = { api: DEFAULT_API, timeoutMs: DEFAULT_TIMEOUT_MS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--session': args.session = next(); break;
      case '--prompt': args.promptFile = next(); break;
      case '--stdin': args.stdin = true; break;
      case '--api': args.api = next(); break;
      case '--timeout-ms': args.timeoutMs = Number(next()); break;
      case '--help':
      case '-h': args.help = true; break;
      default:
        console.error(`未知参数: ${a}`);
        usage();
        process.exit(1);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); process.exit(0); }

  if (!args.session) {
    console.error('缺少必填参数 --session <sessionId>');
    usage();
    process.exit(1);
  }
  if (!!args.promptFile === !!args.stdin) {
    console.error('必须且只能提供 --prompt <file> 或 --stdin 之一');
    usage();
    process.exit(1);
  }

  let text;
  if (args.promptFile) {
    try {
      text = fs.readFileSync(args.promptFile, 'utf8');
    } catch (e) {
      console.error(`无法读取 prompt 文件 ${args.promptFile}: ${e.message}`);
      process.exit(1);
    }
  } else {
    text = fs.readFileSync(0, 'utf8'); // stdin
  }
  if (!text.trim()) {
    console.error('prompt 文本为空');
    process.exit(1);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  let response;
  try {
    response = await fetch(`${args.api}/api/session.prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: `pipeline-drive-${Date.now()}`,
        method: 'session.prompt',
        payload: { sessionId: args.session, mode: 'queue', content: [{ type: 'text', text }] },
      }),
      signal: controller.signal,
    });
  } catch (e) {
    console.error(`无法连接 dsh web (${args.api}): ${e.message}`);
    process.exit(1);
  } finally {
    clearTimeout(timer);
  }

  const body = await response.text();
  console.log(`HTTP ${response.status} ${response.statusText}`);
  console.log(body);

  if (!response.ok) process.exit(1);

  // 信封级校验:非 ok 视为失败。
  try {
    const j = JSON.parse(body);
    if (j?.result && j.result.ok === false) {
      console.error(`信封错误: ${JSON.stringify(j.result.error ?? j.result)}`);
      process.exit(1);
    }
  } catch { /* 非 JSON 响应:HTTP 2xx 即视为成功 */ }

  process.exit(0);
}

main();
