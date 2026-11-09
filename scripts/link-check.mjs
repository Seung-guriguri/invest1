#!/usr/bin/env node
/* 연결 고리 건강 점검 → 로그 + 화면용 data/links.json (실패해도 수집·배포는 계속)
 *   node scripts/link-check.mjs --data _site/data/latest.json [--out _site/data/links.json] */
import { readFile, writeFile } from 'node:fs/promises';
import { readIndicatorMeta } from './ai-insight.mjs';
import { readPairs, linkHealth, linkBlock, linkJson } from './lib/link-health.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const file = arg('--data', '_site/data/latest.json'), out = arg('--out', null);
try {
  const latest = JSON.parse(await readFile(file, 'utf8'));
  const health = linkHealth(latest.series, await readIndicatorMeta(), await readPairs());
  console.log(linkBlock(health));
  const num = v => (v == null ? '—' : (v > 0 ? '+' : '') + v);
  console.log('[전체 — 판정 방식 · 상태 · 평소 상관 · 최근]');
  for (const x of health) console.log(`- ${x.nameA} · ${x.nameB} [${x.kind === 'trend' ? '13주 추세' : '주간 가격'}] ${x.state}${x.stale ? ' (재료가 오래됨)' : ''} · 평소 ${num(x.r1)}` +
    (x.kind === 'trend' ? ` · 최근 13주 ${num(x.moveA)} / ${num(x.moveB)}` : ` → 최근 ${num(x.rr)}`));
  if (out) { await writeFile(out, JSON.stringify(linkJson(health))); console.log(`→ ${out}`); }
} catch (e) {
  console.log(`연결 고리 점검 건너뜀: ${e.message}`);
}
