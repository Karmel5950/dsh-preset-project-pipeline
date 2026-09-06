// 刷新兼容性锚 dsh-runtime.lock.json:记录当前固化运行时的 dsh 版本、
// 其 @deepseek-ai 直接依赖清单与 node 版本。升级运行时后先跑本脚本再回归。
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { RUNTIME_NODE_MODULES, WORKSPACE_ROOT, runtimeDshVersion } from './paths.mjs';

const dshPkg = JSON.parse(await readFile(join(RUNTIME_NODE_MODULES, '@deepseek-ai', 'dsh', 'package.json'), 'utf8'));
const scopes = await readdir(join(RUNTIME_NODE_MODULES, '@deepseek-ai'), { withFileTypes: true });

const wanted = new Set([
  ...Object.keys(dshPkg.dependencies ?? {}),
  ...Object.keys(dshPkg.peerDependencies ?? {}),
]);
const packages = {};
for (const entry of scopes) {
  if (!entry.isDirectory()) continue;
  const name = `@deepseek-ai/${entry.name}`;
  if (!wanted.has(name)) continue;
  try {
    packages[name] = JSON.parse(await readFile(join(RUNTIME_NODE_MODULES, '@deepseek-ai', entry.name, 'package.json'), 'utf8')).version;
  } catch {
    packages[name] = '(无 package.json)';
  }
}

const lock = {
  capturedAt: new Date().toISOString(),
  nodeVersion: process.version,
  dshVersion: runtimeDshVersion(),
  dshDirectDependencies: packages,
};

const target = join(WORKSPACE_ROOT, 'dsh-runtime.lock.json');
await writeFile(target, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
console.log(`✓ 已写入 ${target}`);
console.log(`  dsh ${lock.dshVersion} / node ${lock.nodeVersion} / ${Object.keys(packages).length} 个 @deepseek-ai 直接依赖`);
