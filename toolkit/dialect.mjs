// 用运行时同款 loader 方言离线解析组合文件。
// `!!js <expr>` 不求值,解析成 { __jsExpr: "<源文本>" } 标记 —— 与 cordis-plugin-include
// 自身解析 `dsh --dump-config` 时的行为一致,保证 lint 与装载语义不漂移。
import { runtimeImport } from './paths.mjs';

let cached;

async function loadDialect() {
  if (!cached) {
    const [include, jsYaml] = await Promise.all([
      runtimeImport('@deepseek-ai/cordis-plugin-include/lib/index.js'),
      runtimeImport('js-yaml/index.js'),
    ]);
    cached = { entryListSchema: include.entryListSchema, load: jsYaml.load };
  }
  return cached;
}

export async function loadComposition(text) {
  const { entryListSchema, load } = await loadDialect();
  return load(text, { schema: entryListSchema });
}

export function isJsExpr(value) {
  return typeof value === 'object' && value !== null && typeof value.__jsExpr === 'string';
}

export function describeValue(value) {
  return isJsExpr(value) ? `!!js ${value.__jsExpr}` : JSON.stringify(value);
}
