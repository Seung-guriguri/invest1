#!/usr/bin/env node
/* 연결 고리 건강 점검 결과를 로그로 출력 (배포·텔레그램과 무관, 실패해도 수집은 계속)
 *   node scripts/link-check.mjs --data _site/data/latest.json */
import { readFile } from 'node:fs/promises';
import { readIndicatorMeta } from './ai-insight.mjs';
import { readPairs, linkHealth, linkBlock } from './lib/link-health.mjs';

const i = process.argv.indexOf('--data');
const file = i > 0 ? process.argv[i + 1] : '_site/data/latest.json';
try {
  const latest = JSON.parse(await readFile(file, 'utf8'));
  const health = linkHealth(latest.series, await readIndicatorMeta(), await readPairs());
  console.log(linkBlock(health));
  const other = health.filter(x => x.state !== '정상' && x.state !== '깨짐');
  if (other.length) console.log('[그 밖]\n' + other.map(x => `- ${x.nameA} · ${x.nameB}: ${x.state}${x.stale ? ' (재료가 오래됨)' : ''}${x.r1 != null ? ` (평소 ${x.r1}, 최근 ${x.rr})` : ''}`).join('\n'));
} catch (e) {
  console.log(`연결 고리 점검 건너뜀: ${e.message}`);
}
