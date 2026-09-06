// 单环境默认改造单测(kr-single-env,AC4 + C3)。
// 覆盖:默认单环境行为 / 双环境显式开启行为(DSH_ENV 与 .plugindev-env.json)/
//       .gitignore 含 .plugindev-env.json(C3 阻断项)。
// 运行:node --test test/single-env.test.mjs(在 toolkit/ 下)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const TOOLKIT = resolve(HERE, '..');
const REPO_ROOT = resolve(TOOLKIT, '..');
const ENV_CONFIG = join(REPO_ROOT, '.plugindev-env.json');

// 每次 import 用唯一 query 破缓存,使模块级常量按当前 env 重算。
let importSeq = 0;
async function freshPaths() {
  importSeq += 1;
  return import(`../paths.mjs?t=${importSeq}`);
}

function writeEnvConfig(obj) {
  writeFileSync(ENV_CONFIG, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}
function removeEnvConfig() {
  if (existsSync(ENV_CONFIG)) rmSync(ENV_CONFIG);
}

test('默认单环境:envSpec() 返回单环境 spec(3080 + ~/.dsh)', async () => {
  removeEnvConfig();
  delete process.env.DSH_ENV;
  delete process.env.DSH_API;
  delete process.env.DSH_HOME;
  const paths = await freshPaths();
  const spec = paths.envSpec();
  assert.equal(spec.name, 'default');
  assert.equal(spec.port, 3080);
  assert.equal(spec.apiBase, 'http://127.0.0.1:3080');
  assert.equal(spec.dshHome, join(homedir(), '.dsh'));
  assert.equal(spec.installRoot, join(homedir(), '.dsh', '.agent-presets'));
});

test('默认单环境:readEnvConfig() 无配置文件返回 null', async () => {
  removeEnvConfig();
  const paths = await freshPaths();
  assert.equal(paths.readEnvConfig(), null);
});

test('默认单环境:envSpec("test") 抛错并带双环境引导', async () => {
  removeEnvConfig();
  delete process.env.DSH_ENV;
  const paths = await freshPaths();
  assert.throws(() => paths.envSpec('test'), /单环境模式无 "test" 环境;如需双环境,请在仓库根放 \.plugindev-env\.json 或设 DSH_ENV/);
  assert.throws(() => paths.envSpec('prod'), /单环境模式无 "prod" 环境/);
});

test('双环境显式开启(DSH_ENV=test):envSpec() 返回 test spec(3081 + plugindev/.dsh-home)', async () => {
  removeEnvConfig();
  process.env.DSH_ENV = 'test';
  const paths = await freshPaths();
  const spec = paths.envSpec();
  assert.equal(spec.name, 'test');
  assert.equal(spec.port, 3081);
  assert.equal(spec.apiBase, 'http://127.0.0.1:3081');
  assert.equal(spec.dshHome, join(REPO_ROOT, '.dsh-home'));
  assert.equal(spec.installRoot, join(REPO_ROOT, '.dsh-home', '.agent-presets'));
  delete process.env.DSH_ENV;
});

test('双环境显式开启(DSH_ENV=test):envSpec("test") 返回 test spec,envSpec("prod") 返回 prod spec', async () => {
  removeEnvConfig();
  process.env.DSH_ENV = 'test';
  const paths = await freshPaths();
  const testSpec = paths.envSpec('test');
  assert.equal(testSpec.name, 'test');
  assert.equal(testSpec.port, 3081);
  const prodSpec = paths.envSpec('prod');
  assert.equal(prodSpec.name, 'prod');
  assert.equal(prodSpec.port, 3080);
  assert.equal(prodSpec.dshHome, join(homedir(), '.dsh'));
  delete process.env.DSH_ENV;
});

test('双环境显式开启(.plugindev-env.json env:test):envSpec() 返回 test spec', async () => {
  writeEnvConfig({ env: 'test' });
  delete process.env.DSH_ENV;
  const paths = await freshPaths();
  const spec = paths.envSpec();
  assert.equal(spec.name, 'test');
  assert.equal(spec.port, 3081);
  assert.equal(spec.dshHome, join(REPO_ROOT, '.dsh-home'));
  removeEnvConfig();
});

test('双环境显式开启:配置文件 test/prod 子对象覆盖端口与 dsh-home,DSH_HOME 被忽略', async () => {
  writeEnvConfig({
    env: 'test',
    test: { port: 4001, dshHome: 'custom/test-home' },
    prod: { port: 4002, dshHome: 'custom/prod-home' },
  });
  process.env.DSH_HOME = 'ignored-home';
  const paths = await freshPaths();
  const testSpec = paths.envSpec('test');
  assert.equal(testSpec.port, 4001);
  assert.equal(testSpec.dshHome, resolve('custom/test-home'));
  const prodSpec = paths.envSpec('prod');
  assert.equal(prodSpec.port, 4002);
  assert.equal(prodSpec.dshHome, resolve('custom/prod-home'));
  assert.notEqual(prodSpec.dshHome, resolve('ignored-home'));
  removeEnvConfig();
  delete process.env.DSH_HOME;
});

test('双环境显式开启:DSH_TEST_PORT 覆盖 test 端口(仅双环境下有意义)', async () => {
  removeEnvConfig();
  process.env.DSH_ENV = 'test';
  process.env.DSH_TEST_PORT = '5001';
  const paths = await freshPaths();
  const spec = paths.envSpec('test');
  assert.equal(spec.port, 5001);
  assert.equal(spec.apiBase, 'http://127.0.0.1:5001');
  delete process.env.DSH_ENV;
  delete process.env.DSH_TEST_PORT;
});

test('pipeline-* 默认基址 = paths.API_BASE(单环境 3080)(delivery-gate revise 追加)', async () => {
  const paths = await freshPaths();
  assert.equal(paths.API_BASE, 'http://127.0.0.1:3080');
  for (const name of ['pipeline-start.mjs', 'pipeline-drive.mjs', 'pipeline-watch.mjs']) {
    const src = readFileSync(join(TOOLKIT, name), 'utf8');
    assert.match(src, /import\s*\{[^}]*API_BASE[^}]*\}\s*from\s*'\.\/paths\.mjs'/, `${name} 应 import paths.API_BASE`);
    assert.match(src, /DEFAULT_(BASE_URL|API)\s*=\s*API_BASE/, `${name} 默认基址应取 paths.API_BASE`);
    assert.doesNotMatch(src, /DEFAULT_(BASE_URL|API)\s*=\s*'http:\/\/127\.0\.0\.1:3081'/, `${name} 不应残留 3081 硬编码默认`);
  }
});

test('C3 阻断项:.gitignore 含 .plugindev-env.json 忽略条目', () => {
  const gitignore = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.plugindev-env\.json$/m);
});
