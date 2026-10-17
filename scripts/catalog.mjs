#!/usr/bin/env node
/* =====================================================================
 * 지표 카탈로그 문서 생성 — docs/indicator-catalog.md
 *   node scripts/catalog.mjs          → 문서 다시 쓰기
 *   node scripts/catalog.mjs --check  → 문서가 최신이 아니면 실패 (테스트에서 사용)
 * 원본: index.html CONFIG(이름·분류·단위·판단 방식) + scripts/sources.mjs(출처) + fetch-data 계산 지표
 * ===================================================================== */
import { readFile, writeFile } from 'node:fs/promises';
import { loadConfig } from './lib/config.mjs';
import { SOURCES } from './sources.mjs';
import { COMPUTED } from './fetch-data.mjs';

const OUT = new URL('../docs/indicator-catalog.md', import.meta.url);

function srcLabel(s) {
  if (s.fred) return `FRED ${s.fred}`;
  if (s.yahoo) return `Yahoo ${s.yahoo}`;
  if (s.ecos) return `한국은행 ${s.ecos}${s.item ? '/' + s.item : ''}`;
  if (s.eia) return `EIA ${s.eia}`;
  if (s.eiaGrid) return `EIA-930 ${s.eiaGrid}`;
  if (s.nrc) return 'NRC 원자로 출력';
  if (s.ember) return `Ember ${s.ember}/${s.series}`;
  if (s.eurostat) return `Eurostat ${s.eurostat}`;
  return '?';
}

/** 지표 성격: 실측 · 계산 · 대용 · 직접 입력 */
export function kindOf(ind) {
  if (COMPUTED[ind.id]) return '계산';
  if (ind.proxy) return '대용';
  if (SOURCES[ind.id]) return '실측';
  if (ind.derived) return '계산';
  return '직접 입력';
}

export async function buildCatalog() {
  const cfg = await loadConfig();
  const cat = Object.fromEntries(cfg.categories.map(c => [c.id, c.label]));
  const esc = s => String(s || '').replace(/\|/g, '\\|');
  const lines = [
    '# 지표 카탈로그',
    '',
    '> 자동 생성 문서입니다. 직접 고치지 말고 `node scripts/catalog.mjs` 로 다시 만드세요.',
    '> 원본: `index.html` CONFIG · `scripts/sources.mjs` · `scripts/fetch-data.mjs`(계산 지표)',
    '',
    '성격: **실측**(기관·시장이 직접 발표한 값) · **계산**(다른 지표로 계산) · **대용**(직접 지표가 없어 주가·ETF 등으로 대신 봄) · **직접 입력**(자동 소스 없음)',
    ''
  ];
  for (const c of cfg.categories) {
    const list = cfg.indicators.filter(i => i.cat === c.id);
    if (!list.length) continue;
    lines.push(`## ${c.label} (${list.length})`, '', '| ID | 이름 | 단위 | 성격 | 출처 (1순위 → 대체) | 변화 판단 |', '|---|---|---|---|---|---|');
    for (const i of list) {
      const src = COMPUTED[i.id] ? `계산: ${COMPUTED[i.id].label.replace(/^Calc:/, '')}`
        : SOURCES[i.id] ? SOURCES[i.id].map(srcLabel).join(' → ') + (i.derived ? ` (없으면 계산: ${i.derived.a} − ${i.derived.b})` : '')
        : i.derived ? `계산: ${i.derived.a} − ${i.derived.b}` : '—';
      const chg = `${i.changeMode}${i.change && i.change.yoy ? ' · 전년 동월 대비' : ''}`;
      lines.push(`| \`${i.id}\` | ${esc(i.name)} | ${esc(i.unit)} | ${kindOf(i)} | ${esc(src)} | ${chg} |`);
    }
    lines.push('');
  }
  const guideOnly = Object.keys(SOURCES).filter(id => !cfg.indicators.some(i => i.id === id));
  lines.push(`## 가이드 전용 시세 (${guideOnly.length})`, '', '카드로 보이지 않고 가이드(유조선·벌크선·석유 밸류체인)의 미니 시세와 관심 종목 후보에만 쓰는 주가입니다.', '',
    guideOnly.map(id => `\`${id}\` (${SOURCES[id].map(srcLabel).join(', ')})`).join(' · '), '');
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const doc = await buildCatalog();
  if (process.argv.includes('--check')) {
    const cur = await readFile(OUT, 'utf8').catch(() => '');
    if (cur !== doc) { console.error('docs/indicator-catalog.md 가 최신이 아닙니다 → node scripts/catalog.mjs'); process.exit(1); }
    console.log('지표 카탈로그 최신');
  } else { await writeFile(OUT, doc); console.log('docs/indicator-catalog.md 생성'); }
}
