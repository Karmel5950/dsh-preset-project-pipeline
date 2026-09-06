// test/prompt-render.test.mjs —— AC7(P4,2026-09-02 增补)。
// 防 MANUAL_TEXT 模板变量误解析事故复发:把插件注册的 section 文本经真实
// dsh-system-prompt 的 renderPrompt + 生产同款变量表渲染,验证渲染安全。
// 四断言:
//   ① mock ctx(记录 systemPrompt.section / tools.register)调 apply() 捕获
//      project-pipeline/manual 的 section def 与工具注册清单,断言 section 名正确;
//   ② 从 dsh-agent-loop 源码正则扫 systemPrompt.variable("name" 提取生产注册变量集,
//      断言至少含 provider/model/cwd;
//   ③ import dsh-system-prompt 的 renderPrompt,用提取变量表渲染捕获的 MANUAL_TEXT,
//      断言不抛错;
//   ④ 含 {{base}} 字面量的事故样本喂同一 renderPrompt,断言必须抛 unknown prompt variable
//      (防 dsh 改插值语义使测试静默失效)。
// 参考 tmp-poc-render.mjs 搬用。运行:cd presets/project-pipeline && node --test test/prompt-render.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { apply } from '../plugins/project-registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// 生产路径:dsh-runtime 与 plugindev 平级(dsh/ 仓库根)。test → project-pipeline → presets → plugindev → dsh。
// 自测 harness 路径:test → project-pipeline → presets → _selftest → kr-sediment-batch → pipeline-ws → plugindev → dsh。
// 不硬编码层级:从本目录向上探测含 dsh-runtime 的祖先,生产与自测两种布局通用(交付已三次带回硬编码版)。
let runtimeProbe = HERE;
for (let i = 0; i < 12 && !existsSync(join(runtimeProbe, 'dsh-runtime', 'node_modules', '@deepseek-ai', 'dsh-system-prompt')); i++) runtimeProbe = dirname(runtimeProbe);
const RUNTIME_ROOT = join(runtimeProbe, 'dsh-runtime');

/** 事故样本:{{base}} 字面量(0.10.0 那次事故的形态)。 */
const INCIDENT_SAMPLE = '- 每维先「查底座 + lessons-index 再下结论」:读 {{base}}/.dsh-library/lessons-index.json 与 {{base}}/.dsh-library/rulings.json。';

// ── ① mock ctx:apply() 需 logger / systemPrompt.section / tools.register ──
const sections = [];
const tools = [];
const mockCtx = {
  logger: { info() {}, warn() {}, error() {} },
  systemPrompt: { section: (def) => sections.push(def) },
  tools: { register: (def) => tools.push(def) },
};

test('AC7-① mock ctx 捕获 project-pipeline/manual section 与工具注册清单', () => {
  sections.length = 0;
  tools.length = 0;
  apply(mockCtx, {});
  assert.ok(sections.length >= 1, '至少注册一条 section');
  const manual = sections.find((s) => s.name === 'project-pipeline/manual');
  assert.ok(manual, '应注册 project-pipeline/manual section');
  assert.equal(typeof manual.text, 'string');
  assert.ok(manual.text.length > 0, 'MANUAL_TEXT 非空');
  // AC4(0.16.0):MANUAL_TEXT 含「验收路由前置化」小节,且不含 {{template}} 变量(prompt-render-template-var-guard)。
  assert.ok(manual.text.includes('验收路由前置化'), 'MANUAL_TEXT 应含「验收路由前置化」小节');
  assert.ok(manual.text.includes('acceptance-routing'), 'MANUAL_TEXT 应含 acceptance-routing 结构化字段说明');
  // 0.18.0(kr-sediment-batch):MANUAL_TEXT 含「批量沉淀机制」小节,且不含 {{template}} 变量。
  assert.ok(manual.text.includes('批量沉淀机制'), 'MANUAL_TEXT 应含「批量沉淀机制」小节');
  assert.ok(manual.text.includes('sedimentation'), 'MANUAL_TEXT 应含 sedimentation');
  assert.ok(!/{{[a-zA-Z0-9_-]+}}/.test(manual.text), 'MANUAL_TEXT 不应含 {{template}} 变量(防误解析)');
  const toolNames = tools.map((t) => t.name).sort();
  // 登记簿 7 工具(register/advance/gate/budget/status/block/harvest)。
  for (const expected of ['project_register', 'project_advance', 'project_gate', 'project_budget', 'project_status', 'project_block', 'project_harvest']) {
    assert.ok(toolNames.includes(expected), `应注册 ${expected}`);
  }
});

// ── ② 提取生产注册变量表(硬编码路径,与 PoC 同款调研结论)─────────────────
const AGENT_LOOP_SOURCE = join(RUNTIME_ROOT, 'node_modules', '@deepseek-ai', 'dsh-agent-loop', 'lib', 'index.js');
let VARIABLES = null;

function extractProductionVariables() {
  const source = readFileSync(AGENT_LOOP_SOURCE, 'utf8');
  const names = [];
  const re = /systemPrompt\.variable\(\s*["']([a-zA-Z0-9_]+)["']/g;
  let m;
  while ((m = re.exec(source)) !== null) names.push(m[1]);
  return [...new Set(names)];
}

test('AC7-② 生产注册变量表含 provider/model/cwd', () => {
  const names = extractProductionVariables();
  for (const expected of ['provider', 'model', 'cwd']) {
    assert.ok(names.includes(expected), `生产变量表应含 ${expected}(实际 [${names.join(', ')}])`);
  }
  // 用真实渲染值构造变量表(provider/model/cwd 字符串)。
  VARIABLES = {
    provider: 'ollama-cloud',
    model: 'deepseek-v4-flash',
    cwd: RUNTIME_ROOT,
  };
});

function fileUrl(p) {
  return new URL(`file:///${p.replace(/\\/g, '/')}`).href;
}

// ── ③ import renderPrompt + 真实渲染 MANUAL_TEXT ──────────────────────────
test('AC7-③ renderPrompt 渲染捕获的 MANUAL_TEXT 不抛错', async () => {
  // 延迟 import:保证 ② 先执行确定 VARLABLES。
  const { renderPrompt } = await import(fileUrl(join(RUNTIME_ROOT, 'node_modules', '@deepseek-ai', 'dsh-system-prompt', 'lib', 'index.js')));
  if (!VARIABLES) VARIABLES = extractProductionVariables();
  const manual = sections.find((s) => s.name === 'project-pipeline/manual');
  assert.ok(manual, 'MANUAL_TEXT section 应先捕获');
  let out;
  try {
    out = renderPrompt({ sections: [{ name: 'project-pipeline/manual', text: manual.text }], variables: VARIABLES });
  } catch (error) {
    assert.fail(`渲染 MANUAL_TEXT 抛出:${error.message}`);
  }
  assert.ok(typeof out === 'string' && out.length > 0, '渲染输出应为非空字符串');
});

// ── ④ 事故样本反向断言:{{base}} 必抛 unknown prompt variable ─────────────
test('AC7-④ 事故样本 {{base}} 字面量经 renderPrompt 必抛 unknown prompt variable(防 dsh 改插值语义使测试静默失效)', async () => {
  const { renderPrompt } = await import(fileUrl(join(RUNTIME_ROOT, 'node_modules', '@deepseek-ai', 'dsh-system-prompt', 'lib', 'index.js')));
  if (!VARIABLES) VARIABLES = extractProductionVariables();
  let threw = false;
  let message = '';
  try {
    renderPrompt({ sections: [{ name: 'project-pipeline/manual', text: INCIDENT_SAMPLE }], variables: VARIABLES });
  } catch (error) {
    threw = true;
    message = error.message;
  }
  assert.ok(threw, '事故样本 {{base}} 应抛错(证明该测试能抓 0.10.0 那次事故)');
  assert.match(message, /unknown prompt variable/i, '错误应标记 unknown prompt variable');
});
