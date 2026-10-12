/* =====================================================================
 * 관심 종목 성과 계산 (track.mjs 성적표 · ai-insight.mjs 지난 기록 공용) — 외부 패키지 없음
 * ===================================================================== */
const UA = 'Mozilla/5.0 (macro-dashboard)';

/** Yahoo 수정종가 [날짜, 값] (오름차순) */
export async function closes(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=6mo&interval=1d&events=div%2Csplit`;
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const r = (await res.json()).chart.result[0];
  const off = (r.meta && r.meta.gmtoffset) || 0;
  const adj = r.indicators.adjclose && r.indicators.adjclose[0] && r.indicators.adjclose[0].adjclose;
  const c = adj || r.indicators.quote[0].close;
  return r.timestamp.map((t, i) => [new Date((t + off) * 1000).toISOString().slice(0, 10), c[i]]).filter(x => x[1] != null);
}

/** 고른 날(한국 날짜) 직전 미국 종가 위치, 그로부터 n 거래일 뒤 수익률(%) */
export function retAfter(series, kstDate, n) {
  const i0 = series.findLastIndex(x => x[0] < kstDate);
  if (i0 < 0 || i0 + n >= series.length) return null;
  return (series[i0 + n][1] / series[i0][1] - 1) * 100;
}

/** 고른 날 직전 종가 → 가장 최근 종가까지 수익률(%)과 경과 거래일 수 */
export function retSoFar(series, kstDate) {
  const i0 = series.findLastIndex(x => x[0] < kstDate);
  if (i0 < 0 || i0 >= series.length - 1) return null;
  return { r: (series.at(-1)[1] / series[i0][1] - 1) * 100, days: series.length - 1 - i0 };
}
