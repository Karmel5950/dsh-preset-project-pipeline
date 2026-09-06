// project-hub 部署/卸载脚本(默认 test 环境;prod 需 --env prod --confirm-prod)。
//   node deploy.mjs                 # 部署到 test
//   node deploy.mjs --uninstall     # 从 test 卸载(文件移入 .trash,补丁行移除)
//   node deploy.mjs --env prod --confirm-prod   # 显式发布到 prod(需用户确认)
// 部署动作:
//   1. project-hub.mjs → <home>/profiles/web/plugins/
//   2. dsh-compat.mjs(vendored 兼容层副本)→ <home>/profiles/web/plugins/
//   3. ui/ 子目录 → <home>/profiles/web/node_modules/dsh-project-hub-ui/
//      (浏览器半面包,经 client-module 引导图启动期合成;插件相对路径依赖)
//   4. cordis.patch.yml 增补 insert 行(带 begin/end 注释标记,幂等)
// 注意:宿主面改动需重启 web 实例(test:npm run env:down && npm run env:up)。
import { mkdir, readdir, readFile, rm, writeFile, copyFile, access, constants } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { envSpec, TRASH_DIR } from '../../toolkit/paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_PLUGIN = join(HERE, 'project-hub.mjs');
const SOURCE_COMPAT = join(HERE, 'dsh-compat.mjs'); // vendored 兼容层副本(npm run check 校验与权威源一致)
const SOURCE_UI = join(HERE, 'ui');
const UI_PKG_NAME = 'dsh-project-hub-ui';
const PATCH_BEGIN = '# plugindev host-plugins/project-hub begin';
const PATCH_END = '# plugindev host-plugins/project-hub end';
const PATCH_BLOCK = [
  PATCH_BEGIN,
  '- insert:',
  '    - id: project-hub',
  '      name: ./plugins/project-hub.mjs',
  '    - id: project-hub-ui',
  '      name: dsh-project-hub-ui',
  PATCH_END,
].join('\n');

const argv = process.argv.slice(2);
const uninstall = argv.includes('--uninstall');
const envName = argv.includes('--env') ? argv[argv.indexOf('--env') + 1] : 'test';
const confirmProd = argv.includes('--confirm-prod');
const env = envSpec(envName === undefined ? 'test' : envName);

if (env.name === 'prod' && !confirmProd) {
  console.error('拒绝:host-plugins 发布到 prod 需要用户显式确认。加 --confirm-prod 重试。');
  process.exit(2);
}

const profileDir = join(env.dshHome, 'profiles', 'web');
const deployedPlugin = join(profileDir, 'plugins', 'project-hub.mjs');
const deployedCompat = join(profileDir, 'plugins', 'dsh-compat.mjs');
const deployedUi = join(profileDir, 'node_modules', UI_PKG_NAME);
const patchFile = join(profileDir, 'cordis.patch.yml');

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** 移入 .trash(绝不物理删除;同名加时间戳)。 */
async function moveToTrash(path) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  await mkdir(TRASH_DIR, { recursive: true });
  const flat = path.replaceAll(/[\\/:*?"<>|]/g, '_').replaceAll('__', '_');
  const base = join(TRASH_DIR, `${flat}_${stamp}`);
  const { rename } = await import('node:fs/promises');
  try {
    await rename(path, base);
  } catch {
    // 跨盘或被占用:复制保全后清掉原位置(内容已在 .trash)
    await copyDir(path, base);
    await rm(path, { recursive: true, force: true });
  }
  console.log(`  已移入 .trash: ${base}`);
}

async function copyDir(from, to) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.isDirectory()) await copyDir(join(from, entry.name), join(to, entry.name));
    else await copyFile(join(from, entry.name), join(to, entry.name));
  }
}

async function upsertPatch() {
  const text = existsSync(patchFile) ? await readFile(patchFile, 'utf8') : '# cordis.patch.yml\n[]\n';
  if (text.includes(PATCH_BEGIN)) {
    console.log('  cordis.patch.yml 已含本插件补丁行(幂等跳过)');
    return;
  }
  let next = text.replace(/\r\n/g, '\n');
  if (/^\[\]\s*$/m.test(next)) next = next.replace(/^\[\]\s*$/m, '').trimEnd();
  next = `${next.trimEnd()}\n\n${PATCH_BLOCK}\n`;
  await writeFile(patchFile, next, 'utf8');
  console.log(`  cordis.patch.yml 已增补 insert 行(${PATCH_BEGIN} …)`);
}

async function removePatch() {
  if (!existsSync(patchFile)) {
    console.log('  cordis.patch.yml 不存在,无需清理');
    return;
  }
  const lines = (await readFile(patchFile, 'utf8')).split(/\r?\n/);
  const begin = lines.findIndex((line) => line.trim() === PATCH_BEGIN);
  if (begin < 0) {
    console.log('  cordis.patch.yml 没有本插件的补丁行');
    return;
  }
  const end = lines.findIndex((line) => line.trim() === PATCH_END);
  const kept = [...lines.slice(0, begin), ...lines.slice(end + 1)];
  let next = kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  if (next === '' || next === '#') next = `${next}\n[]\n`;
  else next += '\n';
  await writeFile(patchFile, next, 'utf8');
  console.log('  cordis.patch.yml 补丁行已移除');
}

if (uninstall) {
  console.log(`卸载 project-hub(${env.name}:${profileDir})`);
  for (const path of [deployedPlugin, deployedUi]) {
    if (await exists(path)) await moveToTrash(path);
    else console.log(`  不存在,跳过: ${path}`);
  }
  // dsh-compat.mjs 是共享兼容层副本,可能仍被其他宿主插件引用 —— 不随本插件卸载。
  if (await exists(deployedCompat)) console.log(`  保留共享兼容层: ${deployedCompat}(其他插件可能仍在引用)`);
  await removePatch();
  console.log('完成。记得重启 web 实例使 client-module 引导图更新。');
} else {
  console.log(`部署 project-hub(${env.name}:${profileDir})`);
  await mkdir(dirname(deployedPlugin), { recursive: true });
  await copyFile(SOURCE_PLUGIN, deployedPlugin);
  console.log(`  已部署插件: ${deployedPlugin}`);
  await copyFile(SOURCE_COMPAT, deployedCompat);
  console.log(`  已部署兼容层: ${deployedCompat}`);
  if (await exists(deployedUi)) await moveToTrash(deployedUi); // 旧拷贝入 .trash,再放新拷贝
  await copyDir(SOURCE_UI, deployedUi);
  console.log(`  已部署 UI 包: ${deployedUi}`);
  await upsertPatch();
  console.log('完成。需重启 web 实例(client-module 引导图启动期合成):');
  console.log('  test: npm run env:down && npm run env:up');
}
