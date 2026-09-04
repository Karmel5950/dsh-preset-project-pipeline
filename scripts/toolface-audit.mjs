#!/usr/bin/env node
// toolface-audit.mjs —— 角色工具面一致性核对入口脚本(手动可调,可被 harvest/审计回路调用)。
//
// 用法:
//   node toolface-audit.mjs --preset <presetDir> [--real-surface <jsonFile>] [--json]
//   --preset        必填:preset 源包目录(含 roles/ 与 agent.cordis.yml)。
//   --real-surface  可选:真实工具面 JSON 数组文件(默认内置 REAL_TOOL_SURFACE)。
//   --json          可选:输出结构化 JSON(供 harvest/审计回路程序化消费)。
//   --help / -h     打印帮助。
//
// 退出码:0 = 无漂移;1 = 有漂移(供 CI/脚本判断)。
// 真实文件读取由本脚本(用户侧)做;核对逻辑为纯函数(toolface-lib.mjs),可单测。
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditToolface, REAL_TOOL_SURFACE } from './toolface-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function printHelp() {
  console.log(`toolface-audit —— 角色工具面一致性核对(四层 L1/L2/L3/L4)。
用法:
  node toolface-audit.mjs --preset <presetDir> [--real-surface <jsonFile>] [--json]
  --preset        必填:preset 源包目录(含 roles/ 与 agent.cordis.yml)。
  --real-surface  可选:真实工具面 JSON 数组文件(默认内置 REAL_TOOL_SURFACE)。
  --json          可选:输出结构化 JSON(供 harvest/审计回路程序化消费)。
退出码:0 = 无漂移;1 = 有漂移。`);
}

function parseArgs(argv) {
  const args = { preset: null, realSurface: null, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--preset') args.preset = argv[++i];
    else if (a === '--real-surface') args.realSurface = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

async function readRoles(presetDir) {
  const dir = path.join(presetDir, 'roles');
  const files = (await readdir(dir)).filter((n) => n.endsWith('.json'));
  const roles = [];
  for (const f of files) {
    roles.push(JSON.parse(await readFile(path.join(dir, f), 'utf8')));
  }
  return roles;
}

function printReport(result) {
  console.log(`# 角色工具面一致性核对报告`);
  console.log(`结果:${result.ok ? '无漂移 ✓' : `发现 ${result.summary.total} 处漂移 ✗`}`);
  console.log(`按层对:${JSON.stringify(result.summary.byPair)}`);
  if (result.drifts.length > 0) {
    console.log('\n## 漂移明细');
    for (const d of result.drifts) {
      console.log(`- [${d.layerA} vs ${d.layerB}] ${d.role} / ${d.tool} / ${d.direction}`);
      console.log(`    ${d.detail}`);
    }
  }
  console.log('\n## L4 spawn 冻结语义(文档化)');
  for (const line of result.freeze) {
    console.log(`- ${line}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); process.exit(0); }
  if (!args.preset) {
    console.error('错误:--preset 必填(preset 源包目录,含 roles/ 与 agent.cordis.yml)。用 --help 查看用法。');
    process.exit(2);
  }
  const roles = await readRoles(args.preset);
  const cordisText = await readFile(path.join(args.preset, 'agent.cordis.yml'), 'utf8');
  let realSurface = REAL_TOOL_SURFACE;
  if (args.realSurface) {
    const arr = JSON.parse(await readFile(args.realSurface, 'utf8'));
    if (!Array.isArray(arr)) throw new Error('--real-surface 文件必须是 JSON 数组');
    realSurface = new Set(arr);
  }
  const result = auditToolface({ roles, cordisText, realSurface });
  if (args.json) {
    console.log(JSON.stringify({ ...result, realSurface: [...realSurface] }, null, 2));
  } else {
    printReport(result);
  }
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`toolface-audit 失败:${err.message}`);
  process.exit(2);
});
