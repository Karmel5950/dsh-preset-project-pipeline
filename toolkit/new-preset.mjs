// 从 _template 脚手架新 preset:复制目录并替换占位符。
//   node toolkit/new-preset.mjs --id my-preset
// id 规则同 dsh preset id:/^[a-z0-9][a-z0-9-]*$/(它会成为安装根下的目录名)。
import { cp, readFile, readdir, writeFile, access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { PRESETS_DIR } from './paths.mjs';

const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/;
const TEXT_SUFFIXES = new Set(['.yml', '.yaml', '.mjs', '.json', '.md', '.txt']);

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

const id = process.argv.includes('--id') ? process.argv[process.argv.indexOf('--id') + 1] : undefined;
if (!id) {
  console.error('用法: node toolkit/new-preset.mjs --id <kebab-case-id>');
  process.exit(2);
}
if (!PRESET_ID.test(id)) {
  console.error(`✗ id "${id}" 不匹配 ${PRESET_ID}(dsh 的 containment 边界,同时是目录名)`);
  process.exit(2);
}
const templateDir = join(PRESETS_DIR, '_template');
const targetDir = join(PRESETS_DIR, id);
if (await exists(targetDir)) {
  console.error(`✗ 目标已存在: ${targetDir}`);
  process.exit(2);
}

await cp(templateDir, targetDir, { recursive: true });

const replacements = [
  [/__PRESET_ID__/g, id],
  [/__PRESET_NAME__/g, id],
];
async function rewrite(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await rewrite(path);
      continue;
    }
    const suffix = entry.name.slice(entry.name.lastIndexOf('.'));
    if (!TEXT_SUFFIXES.has(suffix)) continue;
    let text = await readFile(path, 'utf8');
    const before = text;
    for (const [pattern, value] of replacements) text = text.replace(pattern, value);
    if (text !== before) await writeFile(path, text, 'utf8');
  }
}
await rewrite(targetDir);

console.log(`✓ 已创建 presets/${id}/(基于 _template,占位符已替换)`);
console.log('下一步:');
console.log(`  1. 编辑 presets/${id}/agent.cordis.yml 与 plugins/*.mjs`);
console.log(`  2. npm run check && npm test`);
console.log(`  3. npm run deploy -- --preset ${id}`);
console.log(`  4. npm run validate -- --preset ${id}`);
