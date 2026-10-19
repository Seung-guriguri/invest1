/* =====================================================================
 * probe-yahoo.mjs — Yahoo Finance 에 어떤 종목(티커)이 있는지 시험 (수집·배포와 무관, 로그만)
 *   node scripts/probe-yahoo.mjs --query "newcastle coal" --query "coal futures" --symbols "NCF=F,MTF=F"
 *   1) 검색어로 Yahoo 검색 → 나온 종목 목록
 *   2) 검색 결과 중 선물·지수 + 직접 준 티커 → 2년 일봉을 받아 관측치 수·첫/마지막 날짜·값을 출력
 * ===================================================================== */
const UA = 'Mozilla/5.0 (macro-dashboard probe)';
const args = process.argv.slice(2);
const many = name => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
const queries = many('--query');
const symbols = many('--symbols').flatMap(s => s.split(',')).map(s => s.trim()).filter(Boolean);

async function getJSON(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
async function search(q) {
  for (const host of ['query1', 'query2']) {
    try {
      const j = await getJSON(`https://${host}.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=20&newsCount=0`);
      return j.quotes || [];
    } catch (e) { if (host === 'query2') throw e; }
  }
}
async function chart(sym) {
  for (const host of ['query1', 'query2']) {
    try {
      const j = await getJSON(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2y&interval=1d`);
      const r = j.chart && j.chart.result && j.chart.result[0];
      if (!r || !r.timestamp) throw new Error((j.chart && j.chart.error && j.chart.error.description) || '데이터 없음');
      const c = r.indicators.quote[0].close, rows = r.timestamp.map((t, i) => [new Date(t * 1000).toISOString().slice(0, 10), c[i]]).filter(x => x[1] != null);
      if (!rows.length) throw new Error('종가 없음');
      return { n: rows.length, first: rows[0], last: rows[rows.length - 1], name: r.meta.shortName || r.meta.longName || '', type: r.meta.instrumentType, ex: r.meta.exchangeName, cur: r.meta.currency };
    } catch (e) { if (host === 'query2') throw e; }
  }
}

const cands = new Set(symbols);
for (const q of queries) {
  try {
    const qs = await search(q);
    console.log(`\n[검색] "${q}" → ${qs.length}개`);
    for (const x of qs) {
      console.log(`  ${String(x.symbol).padEnd(14)} ${String(x.quoteType || '').padEnd(10)} ${String(x.exchDisp || x.exchange || '').padEnd(10)} ${x.shortname || x.longname || ''}`);
      if (['FUTURE', 'INDEX', 'ETF'].includes(x.quoteType)) cands.add(x.symbol);
    }
  } catch (e) { console.log(`\n[검색] "${q}" 실패: ${e.message}`); }
}
console.log(`\n[시세 받기] 후보 ${cands.size}개`);
for (const s of cands) {
  try {
    const r = await chart(s);
    console.log(`  ✓ ${s.padEnd(14)} ${r.n}개 ${r.first[0]}~${r.last[0]} 마지막 ${r.last[1]} ${r.cur || ''} · ${r.type || ''} · ${r.ex || ''} · ${r.name}`);
  } catch (e) { console.log(`  ✗ ${s.padEnd(14)} ${e.message}`); }
}
