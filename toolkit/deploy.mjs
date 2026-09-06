// 部署:把 presets/<id>/ 复制到目标环境的安装根(dsh 用户 preset 目录)。
//   node toolkit/deploy.mjs --preset <id> [--env test|prod]   安装/覆盖(不删除已有文件)
//   node toolkit/deploy.mjs --list                            test/prod 两环境对账
//   node toolkit/deploy.mjs --uninstall <id> [--env ...]      把安装目录移入 .trash(不物理删除)
// 环境隔离:test = plugindev/.dsh-home(默认,env.mjs 拉起的独立实例);
//          prod = ~/.dsh(用户日常实例,显式 --env prod 才触碰)。
// 部署排除:package.json(dev 元数据)与 test/。部署戳写 .plugindev-deploy.json。
import { cp, mkdir, readFile, readdir, rename, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, basename } from 'node:path';
import { PRESETS_DIR, TRASH_DIR, REPO_ROOT, runtimeDshVersion, envSpec, envFromArgs } from './paths.mjs';

const STAMP_FILE = '.plugindev-deploy.json';

function parseArgs(argv) {
  const args = { envName: 'test' };
  const envAt = argv.indexOf('--env');
  if (envAt >= 0) args.envName = argv[envAt + 1];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--preset') args.preset = argv[++i];
    else if (argv[i] === '--uninstall') args.uninstall = argv[++i];
    else if (argv[i] === '--list') args.list = true;
  }
  return args;
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function gitCommit() {
  try {
    return execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function sourceMeta(id) {
  const dir = join(PRESETS_DIR, id);
  let version = null;
  try {
    version = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).version ?? null;
  } catch { /* 无 package.json 时 version=null */ }
  return { dir, version };
}

async function readStamp(installRoot, id) {
  try {
    return JSON.parse(await readFile(join(installRoot, id, STAMP_FILE), 'utf8'));
  } catch {
    return null;
  }
}

async function statusFor(installRoot, id, sourceVersion) {
  const stamp = await readStamp(installRoot, id);
  if (!stamp) {
    const installed = await exists(join(installRoot, id, 'agent.cordis.yml'));
    return installed ? 'UNKNOWN(非本工具部署)' : 'NOT DEPLOYED';
  }
  const commit = gitCommit();
  if (stamp.sourceVersion === sourceVersion && (!stamp.gitCommit || !commit || stamp.gitCommit === commit)) {
    return 'IN SYNC';
  }
  return 'STALE';
}

async function listMode() {
  const test = envSpec('test');
  const prod = envSpec('prod');
  const entries = (await readdir(PRESETS_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  console.log(`${'PRESET'.padEnd(24)} ${'SOURCE'.padEnd(10)} ${'TEST'.padEnd(26)} ${'PROD'}`);
  for (const id of entries) {
    const { version } = await sourceMeta(id);
    const testStatus = await statusFor(test.installRoot, id, version);
    const prodStatus = await statusFor(prod.installRoot, id, version);
    console.log(`${id.padEnd(24)} ${(version ?? '?').padEnd(10)} ${testStatus.padEnd(26)} ${prodStatus}`);
  }
  console.log(`\ntest 安装根: ${test.installRoot}\nprod 安装根: ${prod.installRoot}`);
}

async function deploy(id, env) {
  const sourceDir = join(PRESETS_DIR, id);
  if (!(await exists(join(sourceDir, 'agent.cordis.yml')))) {
    console.error(`✗ 源目录缺 agent.cordis.yml: ${sourceDir}`);
    process.exitCode = 1;
    return;
  }
  const { version } = await sourceMeta(id);
  const targetDir = join(env.installRoot, id);
  await mkdir(targetDir, { recursive: true });

  // 整目录复制(排除 dev 元数据),覆盖同名文件,不删除目标中多出的文件
  for (const item of await readdir(sourceDir, { withFileTypes: true })) {
    if (item.name === 'package.json' || item.name === 'test' || item.name === STAMP_FILE) continue;
    await cp(join(sourceDir, item.name), join(targetDir, item.name), { recursive: true, force: true });
  }
  const stamp = {
    source: 'plugindev',
    presetId: id,
    sourceVersion: version,
    gitCommit: gitCommit(),
    dshVersion: runtimeDshVersion(),
    deployedAt: new Date().toISOString(),
  };
  await writeFile(join(targetDir, STAMP_FILE), `${JSON.stringify(stamp, null, 2)}\n`, 'utf8');
  console.log(`✓ 已部署 [${env.name}] ${sourceDir} -> ${targetDir}`);
  console.log(`  戳: v${version ?? '?'} @ git ${stamp.gitCommit ?? 'n/a'} / dsh ${stamp.dshVersion}`);
  if (env.name === 'prod') {
    console.log('  ⚠ 这是生产环境:新 preset 会出现在你日常使用的模式选择器里。');
  } else {
    console.log(`  test 实例(${env.apiBase})新建会话即生效;生产环境不受影响。`);
  }
}

async function countFiles(dir) {
  let count = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) count += await countFiles(join(dir, entry.name));
    else count += 1;
  }
  return count;
}

async function uninstall(id, env) {
  const targetDir = join(env.installRoot, id);
  if (!(await exists(targetDir))) {
    console.error(`✗ [${env.name}] 未安装: ${targetDir}`);
    process.exitCode = 1;
    return;
  }
  await mkdir(TRASH_DIR, { recursive: true });
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const trashed = join(TRASH_DIR, `${basename(targetDir)}_${stamp}`);
  try {
    await rename(targetDir, trashed);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    // 跨盘移动:先完整复制进 .trash,校验后清掉原件(内容已在 .trash 保全)
    await cp(targetDir, trashed, { recursive: true, force: false, errorOnExist: true });
    const before = await countFiles(targetDir);
    const after = await countFiles(trashed);
    if (before !== after) {
      throw new Error(`跨盘复制校验失败(${before} vs ${after} 个文件),原件保留在 ${targetDir},副本在 ${trashed}`);
    }
    const { rm } = await import('node:fs/promises');
    await rm(targetDir, { recursive: true, force: true });
  }
  console.log(`✓ 已把 [${env.name}] ${targetDir} 移入回收站: ${trashed}(未物理删除)`);
}

const args = parseArgs(process.argv.slice(2));
let env;
try {
  env = envFromArgs(process.argv.slice(2));
} catch (error) {
  console.error(`✗ ${error.message}`);
  process.exit(2);
}
if (args.list) {
  await listMode();
} else if (args.uninstall) {
  await uninstall(args.uninstall, env);
} else if (args.preset) {
  await deploy(args.preset, env);
} else {
  console.error('用法: node toolkit/deploy.mjs --preset <id> [--env test|prod] | --list | --uninstall <id> [--env ...]');
  process.exit(2);
}
