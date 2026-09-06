// project-delete-guard 插件单测(零依赖,node:test + stub ctx)。
// 运行:cd perm-boundary-p1/deliverables && node --test test/project-delete-guard.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  name,
  inject,
  DEFAULT_EXEMPT_PATHS,
  REJECT_TEXT,
  normalizeConfig,
  commandSegments,
  detectDeleteCommand,
  apply,
} from '../plugins/project-delete-guard.mjs';
import { makeStubCtx } from '../../../toolkit/stub-ctx.mjs';

// ── 元数据与 config ──────────────────────────────────────────────────────────
test('插件元数据:name/inject 符合契约', () => {
  assert.equal(name, 'project-pipeline-delete-guard');
  assert.deepEqual(inject, ['tools']);
});

test('normalizeConfig:默认豁免路径与 enabled;非法配置 fail-fast', () => {
  assert.deepEqual(normalizeConfig({}), { exemptPaths: DEFAULT_EXEMPT_PATHS, enabled: true });
  assert.deepEqual(normalizeConfig({ exemptPaths: ['a', 'b'] }), { exemptPaths: ['a', 'b'], enabled: true });
  assert.deepEqual(normalizeConfig({ enabled: false }), { exemptPaths: DEFAULT_EXEMPT_PATHS, enabled: false });
  assert.throws(() => normalizeConfig({ exemptPaths: '' }), /exemptPaths/);
  assert.throws(() => normalizeConfig({ exemptPaths: [''] }), /exemptPaths/);
  assert.throws(() => normalizeConfig({ exemptPaths: [1] }), /exemptPaths/);
  assert.throws(() => normalizeConfig({ wat: 1 }), /不支持的 config 键/);
  assert.throws(() => normalizeConfig('nope'), /config 必须是对象/);
});

// ── commandSegments ──────────────────────────────────────────────────────────
test('commandSegments:按 & ; | 切段并取首命令词(小写)', () => {
  assert.deepEqual(commandSegments('Remove-Item file.txt'), ['remove-item']);
  assert.deepEqual(commandSegments('  & Remove-Item file.txt'), ['remove-item']);
  assert.deepEqual(commandSegments('Get-ChildItem | Remove-Item -Recurse'), ['get-childitem', 'remove-item']);
  assert.deepEqual(commandSegments('Write-Output hi; Remove-Item x'), ['write-output', 'remove-item']);
  assert.deepEqual(commandSegments('   '), []);
  assert.deepEqual(commandSegments(''), []);
});

// ── detectDeleteCommand:豁免路径 ─────────────────────────────────────────────
test('豁免路径:命令串含豁免片段 → 放行(内部临时目录合理删除)', () => {
  assert.deepEqual(detectDeleteCommand({ toolName: 'pwsh', command: 'Remove-Item $WS/.tmp/foo.txt' }), {
    blocked: false,
    exempt: true,
  });
  assert.deepEqual(detectDeleteCommand({ toolName: 'pwsh', command: 'Remove-Item experiment/tmp.log' }), {
    blocked: false,
    exempt: true,
  });
  assert.deepEqual(detectDeleteCommand({ toolName: 'bash', command: 'rm -rf $WS/.trash/old' }), {
    blocked: false,
    exempt: true,
  });
  // 自定义豁免路径
  assert.deepEqual(detectDeleteCommand({ toolName: 'pwsh', command: 'Remove-Item build-cache/x', exemptPaths: ['build-cache'] }), {
    blocked: false,
    exempt: true,
  });
});

// ── detectDeleteCommand:pwsh 删除命令形态 ────────────────────────────────────
test('pwsh:Remove-Item 及别名 ri/del/erase/rd/rmdir 均拦截', () => {
  for (const cmd of ['Remove-Item file.txt', 'ri file.txt', 'del file.txt', 'erase file.txt', 'rd dir', 'rmdir dir']) {
    const result = detectDeleteCommand({ toolName: 'pwsh', command: cmd });
    assert.equal(result.blocked, true, `应拦截: ${cmd}`);
    assert.ok(result.matched, `应给出匹配词: ${cmd}`);
  }
});

test('pwsh:大小写不敏感(remove-item / REMOVE-ITEM)', () => {
  assert.equal(detectDeleteCommand({ toolName: 'pwsh', command: 'REMOVE-ITEM file.txt' }).blocked, true);
  assert.equal(detectDeleteCommand({ toolName: 'pwsh', command: 'Remove-Item -Recurse -Force dir' }).blocked, true);
});

test('pwsh:.Delete() 与 ::Delete() 形态拦截', () => {
  assert.equal(detectDeleteCommand({ toolName: 'pwsh', command: '[IO.File]::Delete("C:\\x\\y.txt")' }).blocked, true);
  assert.equal(detectDeleteCommand({ toolName: 'pwsh', command: '[IO.Directory]::Delete($dir, $true)' }).blocked, true);
  assert.equal(detectDeleteCommand({ toolName: 'pwsh', command: '$obj.Delete()' }).blocked, true);
});

test('pwsh:管道中段删除命令拦截', () => {
  assert.equal(detectDeleteCommand({ toolName: 'pwsh', command: 'Get-ChildItem | Remove-Item -Recurse' }).blocked, true);
});

// ── detectDeleteCommand:bash 删除命令形态 ─────────────────────────────────────
test('bash:rm / rm -rf / rmdir / del 拦截', () => {
  for (const cmd of ['rm file.txt', 'rm -rf dir', 'rmdir dir', 'del file.txt']) {
    assert.equal(detectDeleteCommand({ toolName: 'bash', command: cmd }).blocked, true, `应拦截: ${cmd}`);
  }
});

// ── detectDeleteCommand:非删除命令不拦截 ─────────────────────────────────────
test('非删除命令不拦截(读/写/移动/列出/echo 等)', () => {
  const safe = [
    'Get-Content file.txt',
    'Write-Output hello',
    'Move-Item a.txt b.txt',
    'Get-ChildItem',
    'New-Item -ItemType Directory dir',
    'Set-Content file.txt "new"',
    'git status',
    'cat file.txt',
    'ls -la',
  ];
  for (const cmd of safe) {
    assert.equal(detectDeleteCommand({ toolName: 'pwsh', command: cmd }).blocked, false, `不应拦截: ${cmd}`);
    assert.equal(detectDeleteCommand({ toolName: 'bash', command: cmd }).blocked, false, `不应拦截: ${cmd}`);
  }
});

test('非 shell 工具不拦截;空命令不拦截', () => {
  assert.equal(detectDeleteCommand({ toolName: 'read', command: 'Remove-Item x' }).blocked, false);
  assert.equal(detectDeleteCommand({ toolName: 'pwsh', command: '' }).blocked, false);
  assert.equal(detectDeleteCommand({ toolName: 'pwsh', command: undefined }).blocked, false);
});

// ── apply:注册 guard 并驱动 ──────────────────────────────────────────────────
/** 构造带 guard 注册面的 stub ctx。 */
function makeGuardCtx() {
  const ctx = makeStubCtx();
  const guards = [];
  ctx.tools.guard = (fn) => {
    guards.push(fn);
    return () => {
      const at = guards.indexOf(fn);
      if (at >= 0) guards.splice(at, 1);
    };
  };
  return { ctx, guards };
}

test('apply:注册一个 guard;删除命令返回拒绝文案,非删除放行,豁免放行', async () => {
  const { ctx, guards } = makeGuardCtx();
  await apply(ctx);
  assert.equal(guards.length, 1, '应注册一个 guard');

  const guard = guards[0];
  // 删除命令 → 拒绝文案
  const denied = guard({ name: 'pwsh', arguments: { command: 'Remove-Item file.txt' } });
  assert.equal(denied, REJECT_TEXT);
  // 豁免路径 → 放行
  assert.equal(guard({ name: 'pwsh', arguments: { command: 'Remove-Item $WS/.tmp/foo.txt' } }), undefined);
  // 非删除 → 放行
  assert.equal(guard({ name: 'pwsh', arguments: { command: 'Write-Output hi' } }), undefined);
  // 非 shell 工具 → 放行
  assert.equal(guard({ name: 'read', arguments: {} }), undefined);
  // 缺 command → 放行
  assert.equal(guard({ name: 'pwsh', arguments: {} }), undefined);
});

test('apply:enabled=false 时不注册 guard', async () => {
  const { ctx, guards } = makeGuardCtx();
  await apply(ctx, { enabled: false });
  assert.equal(guards.length, 0);
});

test('apply:自定义豁免路径生效', async () => {
  const { ctx, guards } = makeGuardCtx();
  await apply(ctx, { exemptPaths: ['build-cache'] });
  const guard = guards[0];
  assert.equal(guard({ name: 'pwsh', arguments: { command: 'Remove-Item build-cache/x' } }), undefined);
  assert.equal(guard({ name: 'pwsh', arguments: { command: 'Remove-Item src/x' } }), REJECT_TEXT);
});
