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

// ── 环境配置(单环境默认)────────────────────────────────────────────────────
// 单环境默认:一套 dsh 实例(默认端口 3080,dsh-home ~/.dsh),所有工具默认落在这套。
// 双环境显式开启:仓库根放 .plugindev-env.json(必须 git-ignore,不入库)或设 DSH_ENV=test|prod,
//   此时 envSpec() 返回 test/prod 环境的目录与端口配置(test=plugindev/.dsh-home+3081,prod=~/.dsh+3080)。
// 单环境可覆盖项:DSH_API(API 基址)/ DSH_HOME(单环境 dsh-home)。
// 双环境显式开启项:DSH_ENV(显式开启并选当前环境)/ DSH_TEST_PORT(覆盖 test 端口,仅双环境下有意义)。
export const DSH_BIN = join(RUNTIME_NODE_MODULES, '@deepseek-ai', 'dsh', 'lib', 'bin.js');

// 双环境显式开启下的 test 布局字段(单环境默认不适用)。
export const TEST_DSH_HOME = join(WORKSPACE_ROOT, '.dsh-home');
export const TEST_PORT = Number(process.env.DSH_PLUGINDEV_PORT ?? 3081);

const ENV_CONFIG_FILE = '.plugindev-env.json';

/** 读仓库根 .plugindev-env.json(缺省/坏 JSON 返回 null)。configPath 可注入便于单测。 */
export function readEnvConfig(configPath = join(WORKSPACE_ROOT, ENV_CONFIG_FILE)) {
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

/** 双环境是否显式开启:DSH_ENV=test|prod 或 .plugindev-env.json 存在且 env 字段为 test|prod。 */
export function dualEnvEnabled() {
  if (process.env.DSH_ENV === 'test' || process.env.DSH_ENV === 'prod') return true;
  const cfg = readEnvConfig();
  return !!cfg && (cfg.env === 'test' || cfg.env === 'prod');
}

/** 双环境显式开启下的当前环境名(test|prod);未开启返回 null。DSH_ENV 优先于配置文件 env 字段。 */
export function dualEnvName() {
  if (process.env.DSH_ENV === 'test' || process.env.DSH_ENV === 'prod') return process.env.DSH_ENV;
  const cfg = readEnvConfig();
  if (cfg && (cfg.env === 'test' || cfg.env === 'prod')) return cfg.env;
  return null;
}

/** 双环境显式开启下的 test/prod 环境 spec。dsh-home 以配置文件 test/prod 子对象为准,DSH_HOME 被忽略。 */
function dualEnvSpec(name) {
  const cfg = readEnvConfig() ?? {};
  const test = cfg.test ?? {};
  const prod = cfg.prod ?? {};
  if (name === 'test') {
    const port = Number(process.env.DSH_TEST_PORT ?? test.port ?? TEST_PORT);
    const dshHome = resolve(test.dshHome ?? TEST_DSH_HOME);
    return {
      name: 'test',
      dshHome,
      installRoot: join(dshHome, '.agent-presets'),
      apiBase: `http://127.0.0.1:${port}`,
      port,
    };
  }
  if (name === 'prod') {
    const port = Number(prod.port ?? (new URL(API_BASE).port || 80));
    const dshHome = resolve(prod.dshHome ?? join(homedir(), '.dsh'));
    return {
      name: 'prod',
      dshHome,
      installRoot: join(dshHome, '.agent-presets'),
      apiBase: `http://127.0.0.1:${port}`,
      port,
    };
  }
  throw new Error(`未知环境 "${name}":只支持 test | prod`);
}

/**
 * 环境决策唯一入口。
 * - 缺省(无参):单环境默认返回 {name:'default', port:3080, dshHome:~/.dsh, ...};
 *   双环境显式开启时返回当前环境(test|prod)的 spec。
 * - 显式传 name(test|prod):仅双环境显式开启下有效;单环境默认下抛错并带引导。
 */
export function envSpec(name) {
  if (name === 'test' || name === 'prod') {
    if (!dualEnvEnabled()) {
      throw new Error(`单环境模式无 "${name}" 环境;如需双环境,请在仓库根放 .plugindev-env.json 或设 DSH_ENV`);
    }
    return dualEnvSpec(name);
  }
  if (dualEnvEnabled()) {
    return dualEnvSpec(dualEnvName() ?? 'test');
  }
  return {
    name: 'default',
    dshHome: DSH_HOME,
    installRoot: INSTALL_ROOT,
    apiBase: API_BASE,
    port: Number(new URL(API_BASE).port || 80),
  };
}

export function envFromArgs(argv) {
  const at = argv.indexOf('--env');
  return envSpec(at >= 0 ? argv[at + 1] : undefined);
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
