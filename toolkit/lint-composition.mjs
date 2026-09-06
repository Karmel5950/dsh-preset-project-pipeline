// 组合文件离线静态检查。只做能离线判定的规则;realm 泄漏、服务等待等
// 语义问题由 validate 的挂载级检查(在线)兜底。
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import { loadComposition, isJsExpr } from './dialect.mjs';
import { RUNTIME_NODE_MODULES } from './paths.mjs';

const CORDIS_BUILTINS = new Set(['cordis:group', 'cordis:include']);
const ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export async function lintComposition(text, presetDir, { runtimeNodeModules = RUNTIME_NODE_MODULES } = {}) {
  const errors = [];
  const warnings = [];
  let doc;
  try {
    doc = await loadComposition(text);
  } catch (error) {
    errors.push(`YAML 解析失败(loader 方言): ${error.message}`);
    return { errors, warnings, rows: [] };
  }
  if (!Array.isArray(doc)) {
    errors.push(`顶层必须是插件行列表,实际是 ${Array.isArray(doc) ? '数组' : typeof doc}`);
    return { errors, warnings, rows: [] };
  }

  const seenIds = new Map();

  const checkRow = (row, path, { inGroup }) => {
    const label = path || '(无 id 行)';
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      errors.push(`${label}: 行必须是对象,实际 ${typeof row}`);
      return;
    }
    if (typeof row.name !== 'string' || row.name.length === 0) {
      errors.push(`${label}: 缺少非空字符串 name`);
      return;
    }
    if (row.id !== undefined) {
      if (typeof row.id !== 'string' || !ID_SHAPE.test(row.id)) {
        errors.push(`${label}: id "${row.id}" 不合法(会被 discovery 拒绝/难以定位)`);
      } else if (seenIds.has(row.id)) {
        errors.push(`重复 id "${row.id}"(首见于 ${seenIds.get(row.id)})`);
      } else {
        seenIds.set(row.id, label);
      }
    } else {
      warnings.push(`${label}: 无 id,loader 诊断时难以定位,建议补上`);
    }

    // name 可解析性:cordis 内建 / 裸包名(运行时树)/ 相对路径(preset 目录)/ 绝对路径
    const name = row.name;
    if (name.startsWith('cordis:')) {
      if (!CORDIS_BUILTINS.has(name)) {
        warnings.push(`${label}: "${name}" 不在已知 cordis 内建白名单(可能不存在)`);
      }
      if (row.group) {
        const config = row.config;
        if (!Array.isArray(config)) {
          errors.push(`${label}: group 行的 config 必须是子行列表,实际 ${typeof config}`);
        } else {
          for (const [index, child] of config.entries()) {
            checkRow(child, `${label}:config[${index}]`, { inGroup: true });
          }
        }
      }
    } else if (name.startsWith('./') || name.startsWith('../')) {
      const target = resolve(presetDir, name);
      if (!existsSync(target)) {
        errors.push(`${label}: 相对路径 "${name}" 在 preset 目录中不存在 (${target})`);
      }
    } else if (isAbsolute(name)) {
      if (!existsSync(name)) {
        errors.push(`${label}: 绝对路径 "${name}" 不存在`);
      }
    } else {
      // 裸包名(含 pkg/subpath 子路径):按宿主同款 exports 规则从运行时树解析
      const runtimeRequire = createRequire(join(runtimeNodeModules, 'lint-probe.js'));
      try {
        runtimeRequire.resolve(name);
      } catch {
        errors.push(`${label}: 裸包名 "${name}" 不在运行时树 ${runtimeNodeModules} 中(挂载会报 Cannot find package)`);
      }
    }

    // isolate 值域:true 或非空字符串
    if (row.isolate !== undefined) {
      if (typeof row.isolate !== 'object' || row.isolate === null || Array.isArray(row.isolate)) {
        errors.push(`${label}: isolate 必须是对象(服务名 → true | 标签)`);
      } else {
        for (const [service, value] of Object.entries(row.isolate)) {
          if (value !== true && !(typeof value === 'string' && value.length > 0)) {
            errors.push(`${label}: isolate.${service} 的值必须是 true 或非空标签字符串,实际 ${JSON.stringify(value)}`);
          }
          if (value !== true && typeof value === 'string') {
            warnings.push(`${label}: isolate.${service} 用了共享标签 "${value}" —— 标签只联结 realm、不池化实例,preset 通常要 true`);
          }
        }
      }
      if (!inGroup && !row.group) {
        errors.push(`${label}: isolate 出现在非 group 行上,不会生效`);
      }
    }

    if (row.disabled !== undefined && typeof row.disabled !== 'boolean' && !isJsExpr(row.disabled)) {
      errors.push(`${label}: disabled 必须是布尔或 !!js 表达式`);
    }
  };

  for (const [index, row] of doc.entries()) {
    checkRow(row, `row[${index}]${row && typeof row === 'object' && row.id ? ` (${row.id})` : ''}`, { inGroup: false });
  }

  return { errors, warnings, rows: doc };
}
