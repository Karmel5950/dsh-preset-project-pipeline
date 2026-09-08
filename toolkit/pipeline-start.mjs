#!/usr/bin/env node
// pipeline-start.mjs — 启动一个 project-pipeline preset 新会话并投递登记 prompt。
// 固化 P0「intake 会话一次性化」(REFACTOR-PLAN §3 P0;kr-p0-intake):
//   每个新登记项目都经本脚本创建其**专属** intake 会话,再由该新会话自行 project_register 入册。
//
// 职责(收窄,勿扩张):
//   ① workspace.create({ path: pipeline-ws })(幂等:同 canonical path 返回既有实体,不重复建)
//      → 得 workspaceId;
//   ② session.create(workspaceId, agentPreset:'project-pipeline') → 自动 attach 到
//      pipeline-ws 工作区组(官方同款路径,修复 intake 会话显示 Ungrouped),得新会话 id;
//   ③ 把登记投递文件 session.prompt 进该新会话(该会话的 intake 将读到登记请求并 register);
//   ④ 打印 { sessionId, prompt, tip }。**不**负责 register、**不**写 REGISTRY(schema 权威在登记簿)。
//   intake 归属**永远以 REGISTRY.sessions[role==='intake'] 为权威**,打印值仅供 drive/watch 备忘。
//
// C2 红线(环境隔离,勿删):本脚本**每一个** dsh-api 调用都必须显式传 `baseUrl`——
//   默认 `http://127.0.0.1:3081`(test 实例),由 `--base-url` 覆盖;**绝不落到** dsh-api.mjs
//   的默认 API_BASE(3080,生产端口)。命中 plugindev 环境隔离红线,prod(3080)禁止不受控直写。
//
// 用法:
//   node toolkit/pipeline-start.mjs --prompt <登记投递文件.md> [--base-url http://127.0.0.1:3081]
//
// 退出码:0 成功(建会+投递 ok 信封);1 失败(参数/读文件/连接/HTTP/信封非 ok)。
// 零 npm 依赖:node 内置(fs/path/url)+ 全局 fetch;复用 dsh-api.mjs 的 call() RPC 信封。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { call } from './dsh-api.mjs'; // 复用 RPC 信封;但 baseUrl 一律显式传(C2)
import { API_BASE } from './paths.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// pipeline-ws 工作区:toolkit 位于 plugindev/toolkit/,其上一级 plugindev 再下一级 pipeline-ws。
const PIPELINE_WS = resolve(__dirname, '..', 'pipeline-ws');

// C2:默认指向 test 实例 3081,绝不落到 dsh-api 默认 3080。
const DEFAULT_BASE_URL = API_BASE;

function usage() {
  console.error(
    '用法: node pipeline-start.mjs --prompt <登记投递文件.md> [--base-url http://127.0.0.1:3081]'
  );
}

function parseArgs(argv) {
  const args = { baseUrl: DEFAULT_BASE_URL };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--prompt': args.promptFile = next(); break;
      case '--base-url': args.baseUrl = next(); break;
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

// session.create 返回值里取会话 id,兼容 {sessionId} / {id} / {session:{id}} 三种形状。
function extractSessionId(session) {
  if (session?.sessionId) return String(session.sessionId);
  if (session?.id) return String(session.id);
  if (session?.session && session.session.id) return String(session.session.id);
  return null;
}

// workspace.create 返回值里取 workspaceId,兼容 {workspace:{workspaceId}} / {workspace:{id}}
// / {workspaceId} / {id} 四种形状(官方 RPC 返回 { workspace: { workspaceId, ... }, created })。
function extractWorkspaceId(workspace) {
  if (workspace?.workspace?.workspaceId) return String(workspace.workspace.workspaceId);
  if (workspace?.workspace?.id) return String(workspace.workspace.id);
  if (workspace?.workspaceId) return String(workspace.workspaceId);
  if (workspace?.id) return String(workspace.id);
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); process.exit(0); }

  if (!args.promptFile) {
    console.error('缺少必填参数 --prompt <登记投递文件.md>');
    usage();
    process.exit(1);
  }

  let registration;
  try {
    registration = readFileSync(args.promptFile, 'utf8');
  } catch (e) {
    console.error(`无法读取登记投递文件 ${args.promptFile}: ${e.message}`);
    process.exit(1);
  }
  if (!registration.trim()) {
    console.error('登记投递文件内容为空');
    process.exit(1);
  }

  try {
    // C2:先确保 pipeline-ws 工作区存在(幂等:同 canonical path 返回既有实体,不重复建),
    //     取得 workspaceId 后创建会话并自动 attach(官方同款路径,修复 Ungrouped)。
    const workspace = await call(
      'workspace.create',
      { path: PIPELINE_WS },
      { baseUrl: args.baseUrl }
    );
    const workspaceId = extractWorkspaceId(workspace);
    if (!workspaceId) {
      console.error('workspace.create 未返回可识别的 workspaceId:', JSON.stringify(workspace));
      process.exit(1);
    }

    // C2:创建会话(带 workspaceId → 自动 attach 到 pipeline-ws 组;cwd 由 workspace.path 派生),
    //     显式传 baseUrl。
    const session = await call(
      'session.create',
      { workspaceId, agentPreset: 'project-pipeline' },
      { baseUrl: args.baseUrl }
    );
    const sessionId = extractSessionId(session);
    if (!sessionId) {
      console.error('session.create 未返回可识别的会话 id:', JSON.stringify(session));
      process.exit(1);
    }

    // C2:投递登记 prompt 到新会话,同样显式传 baseUrl。
    await call(
      'session.prompt',
      { sessionId, mode: 'queue', content: [{ type: 'text', text: registration }] },
      { baseUrl: args.baseUrl }
    );

    console.log(
      JSON.stringify(
        { sessionId, prompt: args.promptFile, tip: '权威来源=REGISTRY.sessions[role===\'intake\']' },
        null,
        2
      )
    );
    process.exit(0);
  } catch (e) {
    console.error(`pipeline-start 失败: ${e.message}`);
    process.exit(1);
  }
}

main();
