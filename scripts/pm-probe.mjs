// scripts/pm-probe.mjs —— pm 角色静态探针(AC1,model-verifiable)。
// 断言 pm 角色入册的静态要素:
//   1. roles/pm.json 存在且含必查清单段(§1.3);
//   2. agent.cordis.yml 含 toolName: subagent_pm 行;
//   3. roles/coordinator.json 的 tools.allow 含 subagent_pm;
//   4. flows/standard-flow.json 含 pm-review 阶段(role=pm)且 design-gate note 含「附 PM 意见单」;
//   5. roles/pm.json 的 model 声明 = deepseek-v4-flash:0731。
// 运行:node scripts/pm-probe.mjs [presetDir](缺省=本文件所在 preset 根)。
// 退出码:0=全部通过;1=任一断言失败(打印失败项)。
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const presetRoot = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));

const failures = [];
function check(name, ok, detail = '') {
  if (ok) console.log(`PASS ${name}`);
  else { failures.push(name); console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

// 1. roles/pm.json 存在且含必查清单段 + model 声明。
const pmFile = join(presetRoot, 'roles', 'pm.json');
check('roles/pm.json 存在', existsSync(pmFile));
if (existsSync(pmFile)) {
  let pm;
  try {
    pm = JSON.parse(readFileSync(pmFile, 'utf8'));
  } catch (e) {
    check('roles/pm.json 可解析', false, e.message);
    pm = null;
  }
  if (pm) {
    check('pm persona 含必查清单段', typeof pm.persona === 'string' && pm.persona.includes('必查清单'));
    check('pm persona 含 8 条必查清单', (pm.persona.match(/\n\d+\./g) ?? []).length >= 8);
    check('pm model=deepseek-v4-flash:0731', pm.model?.model === 'deepseek-v4-flash:0731');
    check('pm tools.allow 不含 web_search', Array.isArray(pm.tools?.allow) && !pm.tools.allow.includes('web_search'));
    check('pm tools.allow 不含 subagent/spawn 权', Array.isArray(pm.tools?.allow) && !pm.tools.allow.some((t) => t.startsWith('subagent')));
  }
}

// 2. agent.cordis.yml 含 subagent_pm 行。
const cordisFile = join(presetRoot, 'agent.cordis.yml');
if (existsSync(cordisFile)) {
  const cordis = readFileSync(cordisFile, 'utf8');
  check('agent.cordis.yml 含 toolName: subagent_pm', /toolName:\s*subagent_pm/.test(cordis));
} else {
  check('agent.cordis.yml 存在', false);
}

// 3. coordinator allow 含 subagent_pm。
const coordFile = join(presetRoot, 'roles', 'coordinator.json');
if (existsSync(coordFile)) {
  const coord = JSON.parse(readFileSync(coordFile, 'utf8'));
  check('coordinator allow 含 subagent_pm', Array.isArray(coord.tools?.allow) && coord.tools.allow.includes('subagent_pm'));
} else {
  check('roles/coordinator.json 存在', false);
}

// 4. standard-flow 含 pm-review 阶段 + design-gate note 含「附 PM 意见单」。
const stdFile = join(presetRoot, 'flows', 'standard-flow.json');
if (existsSync(stdFile)) {
  const std = JSON.parse(readFileSync(stdFile, 'utf8'));
  const pmReview = std.stages.find((s) => s.id === 'pm-review');
  check('standard-flow 含 pm-review 阶段(role=pm)', pmReview?.type === 'work' && pmReview.role === 'pm');
  const designGate = std.stages.find((s) => s.id === 'design-gate');
  check('design-gate note 含「附 PM 意见单」', typeof designGate?.note === 'string' && designGate.note.includes('附 PM 意见单'));
} else {
  check('flows/standard-flow.json 存在', false);
}

if (failures.length > 0) {
  console.error(`\npm-probe 失败 ${failures.length} 项:${failures.join(', ')}`);
  process.exit(1);
}
console.log('\npm-probe 全部通过(AC1 静态要素就绪)');
