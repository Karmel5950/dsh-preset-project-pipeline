// 路径常量与运行时导入助手。
// 一切对运行时树的 import 都必须经 runtimeImport() 用绝对 file:// URL ——
// 本工作空间没有 node_modules,裸包名解析不到任何东西。
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';

export const WORKSPACE_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const REPO_ROOT = resolve(WORKSPACE_ROOT, '..');
export const RUNTIME_ROOT = resolve(REPO_ROOT, 'dsh-runtime');
export const RUNTIME_NODE_MODULES = join(RUNTIME_ROOT, 'node_modules');
export const SHIPPED_PRESETS = join(RUNTIME_NODE_MODULES, '@deepseek-ai', 'dsh', 'config', 'agent-presets');
export const PRESETS_DIR = join(WORKSPACE_ROOT, 'presets');
export const TRASH_DIR = join(REPO_ROOT, '.trash');

export const DSH_HOME = process.env.DSH_HOME
  ? resolve(process.env.DSH_HOME)
  : join(homedir(), '.dsh');
export const INSTALL_ROOT = join(DSH_HOME, '.agent-presets');

export const API_BASE = process.env.DSH_API ?? 'http://127.0.0.1:3080';

// ── 环境隔离 ────────────────────────────────────────────────────────────────
// test: 独立 DSH_HOME(plugindev/.dsh-home)+ 独立端口(默认 3081)的 dsh web
//       实例,由 env.mjs 拉起/停止。所有常规操作默认落在 test。
// prod: 用户日常实例(~/.dsh,端口 3080)。只有显式 --env prod 才触碰。
export const DSH_BIN = join(RUNTIME_NODE_MODULES, '@deepseek-ai', 'dsh', 'lib', 'bin.js');
export const TEST_DSH_HOME = join(WORKSPACE_ROOT, '.dsh-home');
export const TEST_PORT = Number(process.env.DSH_PLUGINDEV_PORT ?? 3081);

export function envSpec(name = 'test') {
  if (name === 'test') {
    return {
      name: 'test',
      dshHome: TEST_DSH_HOME,
      installRoot: join(TEST_DSH_HOME, '.agent-presets'),
      apiBase: `http://127.0.0.1:${TEST_PORT}`,
      port: TEST_PORT,
    };
  }
  if (name === 'prod') {
    const port = Number(new URL(API_BASE).port || 80);
    return {
      name: 'prod',
      dshHome: DSH_HOME,
      installRoot: INSTALL_ROOT,
      apiBase: API_BASE,
      port,
    };
  }
  throw new Error(`未知环境 "${name}":只支持 test | prod`);
}

export function envFromArgs(argv) {
  const at = argv.indexOf('--env');
  return envSpec(at >= 0 ? argv[at + 1] : 'test');
}

export function runtimeImport(specifier) {
  return import(pathToFileURL(join(RUNTIME_NODE_MODULES, ...specifier.split('/'))).href);
}

export function runtimeDshVersion() {
  const pkg = JSON.parse(readFileSync(join(RUNTIME_NODE_MODULES, '@deepseek-ai', 'dsh', 'package.json'), 'utf8'));
  return pkg.version;
}

export function runtimeReachable() {
  return existsSync(join(RUNTIME_NODE_MODULES, '@deepseek-ai', 'dsh', 'package.json'));
}
