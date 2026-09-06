// `npm run check`:三段离线检查(不需要 dsh 在线)。
//   1) node --check 所有 .mjs(toolkit/test/presets/shared)
//   2) lint 所有 presets/*/agent.cordis.yml(含 _template)
//   3) dsh-compat vendored 副本一致性(部署物里的 dsh-compat.mjs 与权威源逐字节一致)
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PRESETS_DIR, WORKSPACE_ROOT } from './paths.mjs';
import { lintComposition } from './lint-composition.mjs';

async function collectMjs(dir, acc = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await collectMjs(path, acc);
    else if (entry.name.endsWith('.mjs')) acc.push(path);
  }
  return acc;
}

let failed = 0;

const files = [
  ...await collectMjs(join(WORKSPACE_ROOT, 'toolkit')),
  ...await collectMjs(join(WORKSPACE_ROOT, 'test')),
  ...await collectMjs(join(WORKSPACE_ROOT, 'shared')),
  ...await collectMjs(PRESETS_DIR),
];
console.log(`[1/3] node --check ${files.length} 个 .mjs`);
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${file}\n${error.stderr}`);
  }
}
if (failed === 0) console.log('  ✓ 全部语法通过');

console.log('[2/3] lint 组合文件');
const presetDirs = (await readdir(PRESETS_DIR, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
for (const id of presetDirs) {
  const dir = join(PRESETS_DIR, id);
  let text;
  try {
    text = await readFile(join(dir, 'agent.cordis.yml'), 'utf8');
  } catch {
    console.error(`  ✗ ${id}: 缺 agent.cordis.yml`);
    failed += 1;
    continue;
  }
  const { errors, warnings, rows } = await lintComposition(text, dir);
  for (const warning of warnings) console.log(`  - ${id}: 警告: ${warning}`);
  if (errors.length > 0) {
    failed += 1;
    for (const error of errors) console.error(`  ✗ ${id}: ${error}`);
  } else {
    console.log(`  ✓ ${id}: ${rows.length} 行通过`);
  }
}

console.log('[3/3] dsh-compat vendored 副本一致性');
{
  const authoritativePath = join(WORKSPACE_ROOT, 'shared', 'dsh-compat', 'dsh-compat.mjs');
  const authoritative = await readFile(authoritativePath, 'utf8');
  const candidates = [];
  const presetDirs = await readdir(PRESETS_DIR, { withFileTypes: true }).catch(() => []);
  for (const entry of presetDirs.filter((e) => e.isDirectory())) {
    candidates.push(join(PRESETS_DIR, entry.name, 'dsh-compat.mjs'));
  }
  const hostDirs = await readdir(join(WORKSPACE_ROOT, 'host-plugins'), { withFileTypes: true }).catch(() => []);
  for (const entry of hostDirs.filter((e) => e.isDirectory())) {
    candidates.push(join(WORKSPACE_ROOT, 'host-plugins', entry.name, 'dsh-compat.mjs'));
  }
  candidates.push(join(WORKSPACE_ROOT, 'shared', 'dsh-compat', 'test', 'dsh-compat.mjs')); // 意外的第二权威源
  let checked = 0;
  for (const copy of candidates) {
    let text;
    try {
      text = await readFile(copy, 'utf8');
    } catch {
      continue; // 该位置无副本,正常
    }
    checked += 1;
    if (text !== authoritative) {
      failed += 1;
      console.error(`  ✗ ${copy}: 与权威源不一致 —— 改动只改权威源(shared/dsh-compat/dsh-compat.mjs),再同步本副本`);
    }
  }
  if (checked === 0) console.log('  (尚无 vendored 副本;插件迁移后放置)');
  else if (failed === 0) console.log(`  ✓ ${checked} 份副本与权威源逐字节一致`);
}

if (failed > 0) {
  console.error(`\ncheck 失败:${failed} 处`);
  process.exit(1);
}
console.log('\ncheck 全部通过');
