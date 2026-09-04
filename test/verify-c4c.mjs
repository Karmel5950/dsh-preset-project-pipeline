// C4c 验收自测:六角色 role_show 全部编译通过,coordinator 实测字符数写 journal。
// 运行:cd deliverables/presets/project-pipeline && node test/verify-c4c.mjs
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { apply } from '../plugins/project-roles.mjs';
import { makeStubCtx } from '../../../toolkit/stub-ctx.mjs';

const workspace = await mkdtemp(path.join(tmpdir(), 'c4c-verify-'));
try {
  // 建项目登记簿(entitySlug=kr-p1-base),供 role_show 读 entitySlug。
  await mkdir(path.join(workspace, 'kr-p1-base', '.dsh-project'), { recursive: true });
  await writeFile(
    path.join(workspace, 'kr-p1-base', '.dsh-project', 'REGISTRY.json'),
    JSON.stringify({ schemaVersion: 2, id: 'kr-p1-base', entitySlug: 'kr-p1-base', title: '项目底座层', state: 'active', iteration: 1, stageIndex: 0 }, null, 2),
    'utf8',
  );
  const ctx = makeStubCtx();
  await apply(ctx);
  const roleShow = ctx.tools.items.find((t) => t.name === 'role_show');
  const exec = { agent: { session: { header: { cwd: workspace } } } };
  const roles = ['coordinator', 'product', 'architect', 'dev', 'tester', 'deliverer'];
  const results = [];
  let allPass = true;
  for (const role of roles) {
    const shown = await roleShow.execute({ role, projectId: 'kr-p1-base' }, exec);
    const compiledLen = shown.subagent.persona.length;
    const rawLen = shown.persona.length;
    const ok = compiledLen <= 1060;
    if (!ok) allPass = false;
    results.push({ role, rawLen, compiledLen, ok, readings: shown.readings });
    console.log(`role=${role} rawPersona=${rawLen} compiledPersona=${compiledLen} ok=${ok}`);
  }
  const coord = results.find((r) => r.role === 'coordinator');
  console.log(`\nCOORDINATOR_COMPILED_CHARS=${coord.compiledLen}`);
  console.log(`ALL_PASS=${allPass}`);
  // 输出 coordinator readings 展开清单(供 journal 留痕)。
  console.log('coordinator readings:', JSON.stringify(coord.readings, null, 2));
  process.exitCode = allPass ? 0 : 1;
} finally {
  await rm(workspace, { recursive: true, force: true });
}
