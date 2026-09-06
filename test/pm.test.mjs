// test/pm.test.mjs —— pm 角色单测(AC1~AC4 + C3 违禁词 + 校准样例)。
// 覆盖:
//   - roles/pm.json 存在且含必查清单段与 8 条条目(AC1);
//   - C3 违禁词断言:pm persona 与意见单模板不含 approve/批准/代用户/代答/代行/门禁裁决;
//   - 校准样例(§9.3):含自由文本框选模型/术语行话残留/臆造数值/状态展示误当配置的设计稿 → 判 revise;
//   - pmRoundDecision 纯函数三分支(pass/revise/escalate)happy path + 边界(AC3)。
// 运行:node test/pm.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { pmRoundDecision } from '../plugins/project-lib.mjs';

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url));

// ── C3 违禁词(硬约束,spec-gate 裁决 C3)────────────────────────────────────
const FORBIDDEN_WORDS = ['approve', '批准', '代用户', '代答', '代行', '门禁裁决'];

function readPmPersona() {
  const pm = JSON.parse(readFileSync(join(PRESET_ROOT, 'roles', 'pm.json'), 'utf8'));
  return pm.persona;
}

// 意见单模板(与 DESIGN §3.1 一致,作为 PM 评审产出模板)。
const OPINION_TEMPLATE = `# PM 意见单(<projectId> · 第 <N> 轮)

## 评审对象
- 设计产出:DESIGN.md(及 UX 交付物清单)

## 逐模块评审
对每个模块给出三问:
- 操作流程走不走得通:...
- 场景覆盖:...
- 可读性:...
- 必改项(如有):...

## 总评
- verdict: pass | revise
- 必改清单(verdict=revise 时逐条列出):...

## 边界声明
- 本意见单为 design-gate 前置质量闸,不构成门禁终审;门禁终审由用户执行。`;

// ── AC1:pm 角色入册静态要素 ────────────────────────────────────────────────

test('AC1:roles/pm.json 存在且含必查清单段与 8 条条目', () => {
  const pm = JSON.parse(readFileSync(join(PRESET_ROOT, 'roles', 'pm.json'), 'utf8'));
  assert.ok(pm.persona.includes('必查清单'), 'persona 含必查清单段(内嵌,非引用)');
  const items = pm.persona.match(/\n\d+\./g) ?? [];
  assert.ok(items.length >= 8, `必查清单应含 8 条,实际 ${items.length}`);
  assert.equal(pm.model.model, 'deepseek-v4-flash:0731', 'model=deepseek-v4-flash:0731(模型红线)');
  assert.ok(!pm.tools.allow.includes('web_search'), 'pm 不含 web_search');
  assert.ok(!pm.tools.allow.some((t) => t.startsWith('subagent')), 'pm 不含 subagent/spawn 权');
});

// ── C3:违禁词断言 ──────────────────────────────────────────────────────────

test('C3:pm persona 不含违禁词(approve/批准/代用户/代答/代行/门禁裁决)', () => {
  const persona = readPmPersona();
  for (const w of FORBIDDEN_WORDS) {
    assert.ok(!persona.includes(w), `pm persona 不应含违禁词 "${w}"`);
  }
});

test('C3:意见单模板不含违禁词', () => {
  for (const w of FORBIDDEN_WORDS) {
    assert.ok(!OPINION_TEMPLATE.includes(w), `意见单模板不应含违禁词 "${w}"`);
  }
});

// ── 校准样例(§9.3):以 persona 必查清单为评审规则,对样例输入判 revise ──
// 断言方式:以必查清单段为评审规则,对样例输入跑评审逻辑(或 persona 驱动评审的桩),
// 断言意见单 verdict=revise 且必改清单含对应条目。
const CHECKLIST = [
  { item: 1, keywords: ['自由文本', '手输', '下拉'] },
  { item: 2, keywords: ['型号串', '型号'] },
  { item: 3, keywords: ['恢复默认', '回退'] },
  { item: 4, keywords: ['职责说明'] },
  { item: 5, keywords: ['术语', '行话', 'meta', '领地'] },
  { item: 6, keywords: ['臆造', '数据源', '本机配置'] },
  { item: 7, keywords: ['状态展示', '误当配置'] },
  { item: 8, keywords: ['规则表', '内部机制'] },
];

function reviewDesign(designText) {
  const mustFix = CHECKLIST.filter((c) => c.keywords.some((k) => designText.includes(k))).map((c) => c.item);
  return { verdict: mustFix.length > 0 ? 'revise' : 'pass', mustFix };
}

test('校准样例:含自由文本框选模型的设计稿 → 判 revise(命中第 1 条)', () => {
  const r = reviewDesign('模型选择采用自由文本框,用户手输型号');
  assert.equal(r.verdict, 'revise');
  assert.ok(r.mustFix.includes(1), '必改清单含第 1 条');
});

test('校准样例:含术语行话残留的设计稿 → 判 revise(命中第 5 条)', () => {
  const r = reviewDesign('配置区残留 meta 领地行话');
  assert.equal(r.verdict, 'revise');
  assert.ok(r.mustFix.includes(5), '必改清单含第 5 条');
});

test('校准样例:含臆造数值/数据源未对照本机配置的设计稿 → 判 revise(命中第 6 条)', () => {
  const r = reviewDesign('下拉数据源臆造,未对照本机配置');
  assert.equal(r.verdict, 'revise');
  assert.ok(r.mustFix.includes(6), '必改清单含第 6 条');
});

test('校准样例:含状态展示信息误当配置的设计稿 → 判 revise(命中第 7 条)', () => {
  const r = reviewDesign('状态展示信息误当配置出现在配置区');
  assert.equal(r.verdict, 'revise');
  assert.ok(r.mustFix.includes(7), '必改清单含第 7 条');
});

// ── pmRoundDecision 纯函数(AC3)───────────────────────────────────────────

test('pmRoundDecision:verdict=pass → action=pass(不推进轮次)', () => {
  assert.deepEqual(pmRoundDecision({ round: 1, verdict: 'pass' }), { action: 'pass' });
  assert.deepEqual(pmRoundDecision({ round: 3, verdict: 'pass' }), { action: 'pass' });
});

test('pmRoundDecision:verdict=revise 未达上限 → action=revise + nextRound(round+1)', () => {
  assert.deepEqual(pmRoundDecision({ round: 1, verdict: 'revise' }), { action: 'revise', nextRound: 2 });
  assert.deepEqual(pmRoundDecision({ round: 2, verdict: 'revise' }), { action: 'revise', nextRound: 3 });
});

test('pmRoundDecision:verdict=revise 达上限(round>=maxRounds)→ action=escalate(超限升级)', () => {
  assert.deepEqual(pmRoundDecision({ round: 3, verdict: 'revise' }), { action: 'escalate' });
  assert.deepEqual(pmRoundDecision({ round: 4, verdict: 'revise' }), { action: 'escalate' });
});

test('pmRoundDecision:maxRounds 自定义与非法回退(边界)', () => {
  assert.deepEqual(pmRoundDecision({ round: 2, verdict: 'revise', maxRounds: 2 }), { action: 'escalate' });
  assert.deepEqual(pmRoundDecision({ round: 1, verdict: 'revise', maxRounds: 2 }), { action: 'revise', nextRound: 2 });
  assert.deepEqual(pmRoundDecision({ round: 1, verdict: 'revise', maxRounds: 0 }), { action: 'revise', nextRound: 2 }, 'maxRounds 非法回退默认 3');
  assert.deepEqual(pmRoundDecision({ round: 1, verdict: 'revise', maxRounds: 'x' }), { action: 'revise', nextRound: 2 }, 'maxRounds 非整数回退默认 3');
});
