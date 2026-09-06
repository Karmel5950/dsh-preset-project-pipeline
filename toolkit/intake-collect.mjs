// 从 test 实例 intake 会话拉取最近一轮 assistant 正文(纯问答场景专用;登记类项目请用 pipeline-watch)。
// 原理:session.history 翻页取 chunk 事件,text-delta 按 seq 拼接到本轮 user 帧/turn 边界;turn/end 即答完。
// 注意:baseUrl 必须显式 3081 —— toolkit/dsh-api.mjs 默认 API_BASE 指向 3080(prod)。
// 用法:cd plugindev && node toolkit/intake-collect.mjs [sessionId]
// 输出:plugindev/tmp-intake-answer.md
import fs from 'node:fs';
const { call } = await import('./dsh-api.mjs');
const BASE = { baseUrl: 'http://127.0.0.1:3081' };
const SID = process.argv[2] ?? 'session-beb58cc1-f436-4d71-85b7-310513ebf311';

let all = [], beforeSeq = undefined, hasMore = true, guard = 0;
while (hasMore && guard++ < 40) {
  const v = await call('session.history', { sessionId: SID, ...(beforeSeq !== undefined ? { beforeSeq } : {}), maxMessages: 500 }, BASE);
  all.push(...(v.events ?? []));
  hasMore = !!v.hasMore;
  const seqs = (v.events ?? []).map(e => e.event?.seq).filter(s => typeof s === 'number');
  if (!seqs.length) break;
  beforeSeq = Math.min(...seqs);
  if ((v.events ?? []).some(e => String(e.event?.type ?? '').startsWith('user/'))) break;
}
const evs = all.map(e => e.event).filter(Boolean).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
const turns = [...new Set(evs.map(e => e.data?.turn).filter(t => t !== undefined))];
if (!turns.length) { console.error('no events for', SID); process.exit(1); }
const lastTurn = Math.max(...turns);

let text = '', tools = [];
for (const e of evs) {
  if (e.type !== 'assistant/chunk' || e.data?.turn !== lastTurn) continue;
  const c = e.data?.chunk ?? {};
  if (c.type === 'text-delta') text += c.text ?? '';
  if (c.type === 'tool-call-delta') tools.push(c.name);
}
const finished = evs.some(e => e.type === 'turn/end' && e.data?.turn === lastTurn);
fs.writeFileSync('tmp-intake-answer.md', `<!-- turn ${lastTurn} finished=${finished}, collected ${new Date().toISOString()} -->\n\n${text}\n`);
console.log(`turn=${lastTurn} finished=${finished} textChars=${text.length} tools=[${[...new Set(tools)].join(',')}] -> tmp-intake-answer.md`);
if (!finished) console.log('NOTE: turn not ended yet —— answer may be incomplete, rerun later.');
