// 四级验证流水线(默认打测试环境,--env prod 才验证生产):
//   L1 离线 lint(组合文件,loader 方言 + 行形状 + 解析存在性)
//   L2 运行时兼容性锚比对(dsh 版本 vs dsh-runtime.lock.json)
//   L3 roster 在线检查(agentPreset.list:被看到、trust=user、无 broken)
//   L4 真实挂载(空白会话 agentPreset.select,等价官方 standingKeyFor 检查,零 token)
// 用法: node toolkit/validate.mjs --preset <id> [--env test|prod] [--offline] [--require-api]
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { lintComposition } from './lint-composition.mjs';
import { call, reachable } from './dsh-api.mjs';
import { PRESETS_DIR, WORKSPACE_ROOT, runtimeDshVersion, envFromArgs } from './paths.mjs';

function parseArgs(argv) {
  const args = { envName: 'test' };
  const envAt = argv.indexOf('--env');
  if (envAt >= 0) args.envName = argv[envAt + 1];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--preset') args.preset = argv[++i];
    else if (argv[i] === '--offline') args.offline = true;
    else if (argv[i] === '--require-api') args.requireApi = true;
  }
  return args;
}

const fail = (message) => {
  console.error(`  ✗ ${message}`);
  process.exitCode = 1;
};
const pass = (message) => console.log(`  ✓ ${message}`);
const skip = (message) => console.log(`  - ${message}`);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.preset) {
    console.error('用法: node toolkit/validate.mjs --preset <id> [--env test|prod] [--offline] [--require-api]');
    process.exit(2);
  }
  let env;
  try {
    env = envFromArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(2);
  }
  const sourceDir = join(PRESETS_DIR, args.preset);
  const installDir = join(env.installRoot, args.preset);

  console.log(`validate preset "${args.preset}" [env: ${env.name} → ${env.apiBase}]`);

  // L1 离线 lint
  console.log('[L1] 离线 lint(源组合文件)');
  let sourceText;
  try {
    sourceText = await readFile(join(sourceDir, 'agent.cordis.yml'), 'utf8');
  } catch {
    fail(`源目录不存在或缺 agent.cordis.yml: ${sourceDir}`);
    return;
  }
  const lint = await lintComposition(sourceText, sourceDir);
  for (const error of lint.errors) fail(error);
  for (const warning of lint.warnings) skip(`警告: ${warning}`);
  if (lint.errors.length === 0) pass(`组合文件解析通过,${lint.rows.length} 行(含 group 子行)`);

  // 已安装副本也 lint 一遍,防"源修复了但没部署"
  try {
    const installedText = await readFile(join(installDir, 'agent.cordis.yml'), 'utf8');
    if (installedText === sourceText) {
      pass('安装副本与源一致');
    } else {
      const installedLint = await lintComposition(installedText, installDir);
      if (installedLint.errors.length > 0) {
        for (const error of installedLint.errors) fail(`安装副本: ${error}`);
      } else {
        skip('安装副本与源不一致(内容有差异,建议重新 deploy)');
      }
    }
  } catch {
    skip(`[${env.name}] 尚未安装;API 级检查将失败,先跑 npm run deploy -- --preset ${args.preset}`);
  }

  // L2 兼容性锚
  console.log('[L2] 运行时兼容性锚');
  try {
    const lock = JSON.parse(await readFile(join(WORKSPACE_ROOT, 'dsh-runtime.lock.json'), 'utf8'));
    const current = runtimeDshVersion();
    if (lock.dshVersion === current) {
      pass(`dsh ${current} 与锚一致(锚定于 ${lock.capturedAt})`);
    } else {
      skip(`运行时 dsh ${current} ≠ 锁 ${lock.dshVersion} —— 先回归全部 preset,再 npm run lock:refresh`);
    }
  } catch {
    skip('无 dsh-runtime.lock.json,跑 npm run lock:refresh 生成');
  }

  if (args.offline) {
    skip('--offline:跳过在线检查');
    return;
  }

  // L3/L4 在线
  console.log('[L3] roster 在线检查');
  if (!(await reachable({ baseUrl: env.apiBase }))) {
    const hint = env.name === 'test'
      ? `test 实例不可达 —— 先 npm run env:up`
      : `prod 实例(dsh web)不可达 —— 先运行 start-dsh-web.bat`;
    if (args.requireApi) fail(hint);
    else skip(hint);
    return;
  }
  let entry;
  try {
    const value = await call('agentPreset.list', {}, { baseUrl: env.apiBase });
    entry = value.presets.find((preset) => preset.id === args.preset);
  } catch (error) {
    fail(`agentPreset.list 失败: ${error.message}`);
    return;
  }
  if (!entry) {
    fail(`roster 未发现 "${args.preset}" —— 先 npm run deploy -- --preset ${args.preset}${env.name === 'prod' ? ' --env prod' : ''}`);
    return;
  }
  if (entry.broken) {
    fail(`roster 标记 broken: ${entry.broken}`);
    return;
  }
  pass(`roster 可见,trust=${entry.trust}${entry.isDefault ? ',当前默认' : ''}`);

  console.log('[L4] 真实挂载(空白会话 select,零 token)');
  let sessionId;
  try {
    const created = await call('session.create', { cwd: WORKSPACE_ROOT }, { baseUrl: env.apiBase });
    sessionId = created.sessionId;
    const selected = await call('agentPreset.select', { sessionId, agentPreset: args.preset }, { baseUrl: env.apiBase });
    if (selected.agentPreset !== args.preset) {
      fail(`select 返回了意外的 preset: ${selected.agentPreset}`);
    } else {
      pass(`挂载成功,会话已切换到 "${selected.agentPreset}"(session ${sessionId})`);
    }
    try {
      await call('session.rename', { sessionId, title: 'plugindev mount-check (可关闭)' }, { baseUrl: env.apiBase });
    } catch {
      skip('会话改名失败(不影响验证结果)');
    }
    skip(`验证用的空白会话 ${sessionId} 留在 [${env.name}] 会话列表${env.name === 'test' ? '(不影响生产)' : ''}`);
  } catch (error) {
    fail(`挂载被拒绝: [${error.code ?? '?'}] ${error.message}`);
    if (sessionId) skip(`失败会话 ${sessionId} 留在 [${env.name}] 列表,可关闭`);
  }
}

await main();
