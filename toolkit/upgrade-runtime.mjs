// `npm run upgrade:runtime -- <version> [--apply]` —— dsh 内核(固化运行时树)半自动升级。
// 只封装 SOP 中的机械段(备份 → 新树安装 → 版本锚刷新 → 能力满足报告);
// 实例的停/启(持久化 CMD 窗口 bat)与浏览器实测仍按 SOP 人工执行 ——
// 脚本会在开头检查 test 实例已离线,在线则拒绝执行。
//
//   node toolkit/upgrade-runtime.mjs 0.1.1-rc.3            # dry-run:打印计划与警示
//   node toolkit/upgrade-runtime.mjs 0.1.1-rc.3 --apply    # 执行
//
// 完整 SOP(含回归与 prod 规程)见 docs/dsh-runtime.md「升级」章节。
import { spawnSync } from 'node:child_process';
import { rename, mkdir, copyFile, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect } from 'node:net';
import { WORKSPACE_ROOT, RUNTIME_ROOT, TEST_PORT } from './paths.mjs';

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** 仓库根下已有的运行时树备份目录名(dsh-runtime.bak_*)。 */
export async function existingBackups(rootAbove = join(RUNTIME_ROOT, '..')) {
  try {
    const entries = await readdir(rootAbove, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && e.name.startsWith('dsh-runtime.bak_')).map((e) => e.name);
  } catch {
    return [];
  }
}

/** 端口是否有人在监听(轻量 TCP 试连)。 */
export function probePort(port, host = '127.0.0.1', timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    const done = (result) => { socket.destroy(); resolve(result); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.on('connect', () => done(true));
    socket.on('error', () => done(false));
  });
}

/** 备份目录名:dsh-runtime.bak_<YYYYMMDD>_<HHMMSS>(沿用项目 .trash 命名习惯)。 */
export function backupName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `dsh-runtime.bak_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * 升级计划(纯函数,单测覆盖):校验目标版本、生成备份名与警示清单。
 * steps 是给人看的描述;warnings 里任何一条 block: true 都必须先解决。
 */
export function planUpgrade({ targetVersion, currentVersion, testPortListening, prodPortListening, backupDirExists, now = new Date() }) {
  const warnings = [];
  if (!/^\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$/.test(String(targetVersion ?? ''))) {
    return { ok: false, warnings: [{ block: true, message: `目标版本格式非法: ${targetVersion}(期望如 0.1.1-rc.3)` }] };
  }
  if (targetVersion === currentVersion) {
    return { ok: false, warnings: [{ block: true, message: `运行时树已是 ${currentVersion},无需升级` }] };
  }
  if (testPortListening) {
    warnings.push({ block: true, message: `test 实例仍在线(端口 ${TEST_PORT}):先停实例再升级 —— 持久化窗口脚本对应的 restart-dsh-web-test.bat 硬停,或正常关闭该 CMD 窗口` });
  }
  if (!prodPortListening) {
    warnings.push({ block: false, message: 'prod 当前离线:升级共享树后,prod 下次启动将直接进入新版本(注意 rc.8+ 存储格式与旧会话不兼容)' });
  } else {
    warnings.push({ block: false, message: `prod 在线(内存态不受影响),但**重启即升级**;rc.8+ 存储格式不兼容,prod 旧会话将仅回滚可读 —— 升级后到明示决策前,不要重启 prod` });
  }
  if (backupDirExists) {
    warnings.push({ block: false, message: '已存在其他 dsh-runtime.bak_* 备份目录:确认旧的备份不再需要回滚时,先把它移入 .trash(勿物理删除),避免备份堆积' });
  }
  const stamp = backupName(now);
  return {
    ok: warnings.every((w) => !w.block),
    targetVersion,
    currentVersion,
    backupFrom: RUNTIME_ROOT,
    backupTo: join(join(RUNTIME_ROOT, '..'), stamp),
    warnings,
    steps: [
      `备份:rename dsh-runtime → ${stamp}(同盘瞬时)`,
      `新树:重建 dsh-runtime 并从备份拷回 package.json / package-lock.json`,
      `安装:npm install @deepseek-ai/dsh@${targetVersion} --strict-ssl=false(本机网络有 SSL 拦截;完整性由 sha512 校验兜底,约 5-15 分钟)`,
      '版本锚:npm run lock:refresh',
      '能力满足报告:npm run compat:scan -- --diff(存在 broken 时修 dsh-compat 实现与锚,插件不动)',
    ],
  };
}

export function currentRuntimeVersion() {
  const pkg = join(RUNTIME_ROOT, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
  if (!existsSync(pkg)) return undefined;
  try {
    return JSON.parse(readFileSync(pkg, 'utf8')).version;
  } catch {
    return undefined;
  }
}

function printPlan(plan) {
  console.log(`升级计划:${plan.currentVersion ?? '(未知)'} → ${plan.targetVersion}`);
  for (const [i, step] of plan.steps.entries()) console.log(`  ${i + 1}. ${step}`);
  console.log('\n警示:');
  for (const w of plan.warnings) console.log(`  ${w.block ? '✗[阻断] ' : '⚠ '}${w.message}`);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const targetVersion = args.find((a) => !a.startsWith('--'));
  const testOnline = await probePort(TEST_PORT);
  const prodOnline = await probePort(Number(process.env.DSH_PLUGINDEV_PROD_PORT ?? 3080));
  const plan = planUpgrade({
    targetVersion,
    currentVersion: currentRuntimeVersion(),
    testPortListening: testOnline,
    prodPortListening: prodOnline,
    backupDirExists: (await existingBackups()).length > 0,
  });

  printPlan(plan);
  if (!plan.ok) {
    console.error('\n存在阻断项,未执行任何操作。');
    process.exit(1);
  }
  if (!apply) {
    console.log('\n(dry-run:加 --apply 执行;实例停/启与回归步骤见 docs/dsh-runtime.md「升级」)');
    return;
  }

  // 1) 备份(rename 同盘瞬时;目标已存在时 rename 会失败 → 中止,不覆盖任何备份)
  await rename(plan.backupFrom, plan.backupTo);
  console.log(`✓ 已备份 → ${plan.backupTo}`);
  // 2) 新树 + 拷回 lock 描述文件
  await mkdir(join(RUNTIME_ROOT, 'node_modules'), { recursive: true });
  for (const f of ['package.json', 'package-lock.json']) {
    await copyFile(join(plan.backupTo, f), join(RUNTIME_ROOT, f));
  }
  console.log('✓ 新树就位(package.json/package-lock.json 已拷回)');
  // 3) 安装(strict-ssl=false:本机网络 SSL 拦截;内容完整性由 lock 的 sha512 校验兜底)
  console.log(`→ npm install @deepseek-ai/dsh@${plan.targetVersion}(可能 5-15 分钟,请勿中断)…`);
  const install = spawnSync(NPM, ['install', `@deepseek-ai/dsh@${plan.targetVersion}`, '--strict-ssl=false', '--no-audit', '--no-fund'], {
    cwd: RUNTIME_ROOT, stdio: 'inherit',
  });
  if (install.status !== 0) {
    console.error(`\n✗ npm install 失败(exit ${install.status})。运行时树已是空壳 —— 回滚:把 ${plan.backupTo} 改回 dsh-runtime 即可,或修复网络后在新树重跑本命令(无需再次备份)。`);
    process.exit(1);
  }
  console.log(`✓ 安装完成,当前版本 ${currentRuntimeVersion()}`);
  // 4) 版本锚 + 5) 能力满足报告
  for (const [label, cmd, cmdArgs] of [
    ['lock:refresh', 'run', ['lock:refresh']],
    ['compat:scan --diff', 'run', ['compat:scan', '--', '--diff']],
  ]) {
    const run = spawnSync(NPM, [cmd, ...cmdArgs], { cwd: WORKSPACE_ROOT, stdio: 'inherit' });
    if (run.status !== 0) {
      console.error(`\n✗ ${label} 失败。机械段已全部完成,按 SOP 继续:修 dsh-compat 实现与锚串(compat:scan 报出的 broken 项)后再回归。`);
      process.exit(1);
    }
  }
  console.log(`
机械段完成。按 docs/dsh-runtime.md「升级」继续:
  1. npm run check && npm test
  2. 起实例:cmd /c start-dsh-web-test.bat(持久化窗口)
  3. 部署全部插件(各 deploy.mjs)+ curl 矩阵 + npm run validate -- --preset <id>
  4. 浏览器实测设置卡(截图 + 视觉判定)——宿主面 curl 全绿不代表浏览器面没断
  5. prod:征得用户确认后走环境根仓库 git 三步规程(基线 → 部署验证 → 提交)
回滚 = 停实例 + 把 ${plan.backupTo} 改回 dsh-runtime + 重启。`);
}

// 仅在直接执行时跑主流程(import 单测时不跑)。
if (process.argv[1] && process.argv[1].endsWith('upgrade-runtime.mjs')) {
  await main();
}
