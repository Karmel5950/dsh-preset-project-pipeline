// 测试环境管理:拉起/停止一个与生产完全隔离的 dsh web 实例。
//   node toolkit/env.mjs up       确保测试 home 就绪并启动(幂等)
//   node toolkit/env.mjs down     停止测试实例
//   node toolkit/env.mjs status   查看状态
// 隔离手段:DSH_HOME 指向 plugindev/.dsh-home(独立 settings/安装根/会话库),
// 端口默认 3081(可用 DSH_PLUGINDEV_PORT 覆盖)。首次 up 会把生产的
// settings.yaml 复制过来(该文件不含密钥明文;凭据不复制 —— 零 token 的
// 挂载验证用不到,真实 e2e 需要时再人工配置)。
import { spawn, execSync } from 'node:child_process';
import { access, constants, copyFile, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { envSpec, DSH_BIN, DSH_HOME } from './paths.mjs';
import { reachable } from './dsh-api.mjs';

const env = envSpec('test');
const PID_FILE = join(env.dshHome, '.web.pid');
const LOG_FILE = join(env.dshHome, 'web.log');
const SETTINGS = join(env.dshHome, 'settings.yaml');

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function pidAlive(pid) {
  if (!pid || !Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readPid() {
  try {
    return Number((await readFile(PID_FILE, 'utf8')).trim()) || null;
  } catch {
    return null;
  }
}

function portInUse(port) {
  try {
    execSync(`netstat -ano | findstr /C:":${port} " | findstr /C:"LISTENING"`, { stdio: 'pipe', shell: 'cmd.exe' });
    return true;
  } catch {
    return false;
  }
}

async function bootstrapHome() {
  await mkdir(env.dshHome, { recursive: true });
  if (!(await exists(SETTINGS))) {
    const source = join(DSH_HOME, 'settings.yaml');
    if (existsSync(source)) {
      await copyFile(source, SETTINGS);
      console.log(`  已复制 settings.yaml(不含密钥明文)from ${source}`);
    } else {
      await writeFile(SETTINGS, 'agent-presets:\n  default: standard\n', 'utf8');
      console.log('  生产 settings.yaml 不存在,已写最小 settings(默认 standard)');
    }
    console.log('  注意:凭据未复制 —— 挂载验证不需要;要跑真实 e2e 再人工配置');
  }
}

async function up() {
  if (await reachable({ baseUrl: env.apiBase })) {
    console.log(`✓ test 实例已在线 ${env.apiBase}(无需重复启动)`);
    return;
  }
  const pid = await readPid();
  if (pidAlive(pid)) {
    console.error(`✗ pid ${pid} 还活着但端口 ${env.port} 不通,可能是启动中或端口被占`);
    process.exit(1);
  }
  if (portInUse(env.port)) {
    console.error(`✗ 端口 ${env.port} 已被其他进程占用(改用 DSH_PLUGINDEV_PORT 换端口)`);
    process.exit(1);
  }
  await bootstrapHome();
  const logFd = await open(LOG_FILE, 'a');
  const child = spawn(process.execPath, [DSH_BIN, 'web', '--host', '127.0.0.1', '--port', String(env.port)], {
    env: { ...process.env, DSH_HOME: env.dshHome },
    detached: true,
    stdio: ['ignore', logFd.fd, logFd.fd],
    windowsHide: true,
  });
  child.unref();
  await writeFile(PID_FILE, `${child.pid}\n`, 'utf8');
  console.log(`已启动 pid ${child.pid},等待 ${env.apiBase} 就绪 ...`);
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await reachable({ baseUrl: env.apiBase })) {
      console.log(`✓ test 实例就绪: ${env.apiBase}(日志: ${LOG_FILE})`);
      console.log(`  隔离:DSH_HOME=${env.dshHome},preset 安装根=${env.installRoot}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.error(`✗ 30 秒未就绪,查日志 ${LOG_FILE};停止残留进程: node toolkit/env.mjs down`);
  process.exit(1);
}

async function down() {
  const pid = await readPid();
  if (!pidAlive(pid)) {
    console.log('- 没有在跑的 test 实例');
    await writeFile(PID_FILE, '', 'utf8');
    return;
  }
  execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'pipe', shell: 'cmd.exe' });
  await writeFile(PID_FILE, '', 'utf8');
  console.log(`✓ 已停止 test 实例(pid ${pid} 含子进程)`);
}

async function status() {
  const pid = await readPid();
  const online = await reachable({ baseUrl: env.apiBase });
  console.log(`test 实例: ${online ? '在线' : '离线'}  ${env.apiBase}  pid=${pidAlive(pid) ? pid : '-'}  home=${env.dshHome}`);
  process.exitCode = online ? 0 : 1;
}

const command = process.argv[2];
if (command === 'up') await up();
else if (command === 'down') await down();
else if (command === 'status') await status();
else {
  console.error('用法: node toolkit/env.mjs up | down | status');
  process.exit(2);
}
