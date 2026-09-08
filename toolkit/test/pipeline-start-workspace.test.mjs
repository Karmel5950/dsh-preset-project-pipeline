// pipeline-start 工作区挂载改造单测(kr-session-workspace-attach,AC1/AC3 静态核对)。
// 覆盖:workspace.create 先于 session.create 调用 / session.create 改传 workspaceId(不再传 cwd)/
//       extractWorkspaceId 兼容官方 RPC 返回形状 { workspace: { workspaceId, ... }, created }。
// 运行:node --test test/pipeline-start-workspace.test.mjs(在 toolkit/ 下)。
// 说明:沙箱无 shell 执行能力,无法跑真实 dsh 运行环境;AC1/AC3 真机验证由用户侧 blocking 执行,
//       本文件仅做静态 happy-path 核对(与 single-env.test.mjs 对 pipeline-* 的静态检查同风格)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const TOOLKIT = resolve(HERE, '..');
const SRC = readFileSync(join(TOOLKIT, 'pipeline-start.mjs'), 'utf8');

test('pipeline-start:workspace.create 先于 session.create 调用(修复 Ungrouped 的 happy path)', () => {
  const wsCreateIdx = SRC.indexOf("'workspace.create'");
  const sessionCreateIdx = SRC.indexOf("'session.create'");
  assert.ok(wsCreateIdx >= 0, '应调用 workspace.create');
  assert.ok(sessionCreateIdx >= 0, '应调用 session.create');
  assert.ok(wsCreateIdx < sessionCreateIdx, 'workspace.create 应先于 session.create');
});

test('pipeline-start:workspace.create 以 PIPELINE_WS 为 path(幂等,同 canonical path 返回既有实体)', () => {
  assert.match(SRC, /workspace\.create/, '应调用 workspace.create');
  assert.match(SRC, /path:\s*PIPELINE_WS/, 'workspace.create 应以 PIPELINE_WS 为 path');
});

test('pipeline-start:session.create 改传 workspaceId,不再传 cwd(官方同款路径)', () => {
  assert.match(SRC, /workspaceId,\s*agentPreset:\s*'project-pipeline'/, 'session.create 应传 workspaceId');
  assert.doesNotMatch(SRC, /cwd:\s*PIPELINE_WS,\s*agentPreset/, 'session.create 不应再传 cwd: PIPELINE_WS');
});

test('pipeline-start:extractWorkspaceId 兼容官方 RPC 返回形状 { workspace: { workspaceId, ... }, created }', () => {
  // 静态核对:helper 存在且覆盖官方形状(workspace.workspace.workspaceId)。
  assert.match(SRC, /function extractWorkspaceId/, '应定义 extractWorkspaceId helper');
  assert.match(SRC, /workspace\?\.workspace\?\.workspaceId/, '应优先取 workspace.workspace.workspaceId(官方形状)');
});
