#!/usr/bin/env node
/* =====================================================================
 * 지표 자동 수집 스크립트 (Node 18+, 외부 패키지 없음)
 *
 *   node scripts/fetch-data.mjs [--out data/latest.json] [--previous 이전파일.json]
 *
 * 환경 변수 (GitHub Actions에서는 저장소 Secrets로 전달)
 *   FRED_API_KEY  — FRED 지표 (없으면 FRED 소스는 건너뜀)
 *   ECOS_API_KEY  — 한국은행 ECOS 지표 (없으면 건너뜀)
 *   EIA_API_KEY   — 미국 에너지정보청 EIA 지표 (없으면 건너뜀)
 *   EMBER_API_KEY — Ember 국가별 발전원 비중 (없으면 건너뜀)
 *   Yahoo Finance 는 키 없이 호출 (비공식 API, 막히면 다음 소스로 대체)
 *
 * 출력 형식 (data/latest.json)
 *   { generatedAt, series: { [id]: { source, freq, fetchedAt, obs: [[YYYY-MM-DD, 값], ...오름차순] } },
 *     errors: [{ id, message }] }
 *
 * --previous 로 이전 배포본을 주면, 이번에 실패한 지표는 이전 값을 그대로 유지합니다
 * (그 지표의 fetchedAt 이 오래되면 화면에 "오래된 데이터" 경고가 뜸).
 * ===================================================================== */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SOURCES } from './sources.mjs';
import { readSheet } from './lib/xlsx.mjs';

const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const OUT = arg('--out', 'data/latest.json');
const PREVIOUS = arg('--previous', null);

const FRED_KEY = (process.env.FRED_API_KEY || '').trim();
const ECOS_KEY = (process.env.ECOS_API_KEY || '').trim();
const EIA_KEY = (process.env.EIA_API_KEY || '').trim();
const EMBER_KEY = (process.env.EMBER_API_KEY || '').trim();
const UA = 'Mozilla/5.0 (macro-dashboard data fetcher)';

/* ---------- 계산 지표 ----------
 * 3-2-1 크랙 스프레드: 원유 3배럴로 휘발유 2배럴 + 디젤 1배럴을 만들 때의 정제 마진 ($/배럴)
 *   = (휘발유 $/gal × 42 × 2 + 디젤 $/gal × 42 − WTI $/bbl × 3) ÷ 3   (1배럴 = 42갤런)
 *   같은 날짜에 세 값이 모두 있는 날만 계산 */
const COMPUTED = {
  crack321: { inputs: ['gasoline', 'diesel', 'wti'], label: 'Calc:2RB+HO−3CL',
              calc: (rb, ho, cl) => (rb * 42 * 2 + ho * 42 - cl * 3) / 3 },
  // TTF − Henry Hub 가격차 ($/MMBtu): TTF(€/MWh) × 유로/달러 ÷ 3.412(1MWh = 3.412MMBtu) − 헨리허브
  //   클수록 미국 LNG를 유럽에 팔 때 남는 몫이 커져 LNG 수출·LNG선 수요가 늘기 쉬움
  //   asof: 환율(24시간·런던 날짜)과 선물의 날짜 체계가 달라 '세 값이 같은 날짜'만 쓰면 최신 날이 빠짐 → TTF 날짜 기준으로 나머지는 그날 이전 최신값
  lng_spread: { inputs: ['ttf', 'eurusd', 'natgas'], label: 'Calc:TTF−HH', asof: true,
                calc: (ttf, fx, hh) => ttf * fx / 3.412 - hh },
  // asof: 첫 재료의 날짜마다 나머지 재료는 그날 이전 가장 최근 값 사용 (휴일·발표 주기가 달라도 계산)
  kr_us_base:     { inputs: ['kr_base', 'us_ffr'], label: 'Calc:한국−미국 기준금리', asof: true, calc: (kr, us) => kr - us },
  kr_us_10y:      { inputs: ['kr10y', 'us10y'], label: 'Calc:한국−미국 10년', asof: true, calc: (kr, us) => kr - us },
  us_real_policy: { inputs: ['us_ffr', 'us_core_pce'], label: 'Calc:FFR−근원PCE', asof: true, calc: (ffr, pce) => ffr - pce },
  brent_krw:      { inputs: ['brent', 'usdkrw'], label: 'Calc:브렌트×원/달러', asof: true, calc: (b, fx) => b * fx },
  brent_wti:      { inputs: ['brent', 'wti'], label: 'Calc:브렌트−WTI', calc: (b, w) => b - w },
  gold_silver:    { inputs: ['gold', 'silver'], label: 'Calc:금÷은', calc: (g, s) => g / s },
  hy_ig:          { inputs: ['hy_spread', 'ig_spread'], label: 'Calc:HY−IG', calc: (hy, ig) => hy - ig },
  us_crude_total: { inputs: ['us_crude', 'us_spr'], label: 'Calc:상업+SPR', calc: (c, spr) => c + spr },
  // 석탄÷가스 상대가격 = 뉴캐슬 석탄($/t, IMF 월평균) ÷ JKM($/MMBtu, 월말 선물) — 같은 달끼리 (byMonth)
  //   7 아래면 석탄이 가스보다 싸서 아시아 발전사가 석탄을 더 때기 쉬움, 16 위면 가스가 상대적으로 쌈
  coal_jkm:       { inputs: ['coal', 'aux_jkm_m'], label: 'Calc:뉴캐슬석탄÷JKM', byMonth: true, calc: (c, j) => c / j }
};

/** 날짜 오름차순 obs 에서 date 이전(같은 날 포함) 가장 최근 값 */
function valueAsOf(obs, date) {
  let lo = 0, hi = obs.length - 1, found = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (obs[mid][0] <= date) { found = obs[mid][1]; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/* ---------- 유틸 ---------- */
const iso = d => d.toISOString().slice(0, 10);
const yearsAgo = n => { const d = new Date(); d.setFullYear(d.getFullYear() - n); return d; };
const round = v => Number(Number(v).toPrecision(8));
const sleep = ms => new Promise(r => setTimeout(r, ms));

class SkipError extends Error {}

async function getJSON(url, headers = {}, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json', ...headers } });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.fatal = true; throw e; }
      return await res.json();
    } catch (e) {
      last = e;
      if (e.fatal) break;
      await sleep(1000 * 2 ** i);
    }
  }
  throw last;
}

/** 관측 간격 중앙값으로 주기 추정 */
function guessFreq(obs) {
  if (obs.length < 3) return 'D';
  const gaps = [];
  for (let i = 1; i < obs.length; i++) gaps.push((Date.parse(obs[i][0]) - Date.parse(obs[i - 1][0])) / 86400000);
  gaps.sort((a, b) => a - b);
  const g = gaps[Math.floor(gaps.length / 2)];
  return g <= 4 ? 'D' : g <= 10 ? 'W' : g <= 45 ? 'M' : 'Q';
}

/** 주기별 보관 기간: 일간 2년, 주간 6년(평년 5년 비교용), 월간·분기 10년 */
function trim(obs, freq) {
  const keepYears = freq === 'D' ? 2 : freq === 'W' ? 6 : 10;
  const from = iso(yearsAgo(keepYears));
  return obs.filter(o => o[0] >= from);
}

function clean(obs, scale = 1) {
  const map = new Map();
  obs.forEach(([d, v]) => { if (d && Number.isFinite(v)) map.set(d, round(v * scale)); });
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/* ---------- FRED ---------- */
async function fetchFred(src) {
  if (!FRED_KEY) throw new SkipError('FRED_API_KEY 없음');
  const p = new URLSearchParams({
    series_id: src.fred, api_key: FRED_KEY, file_type: 'json',
    observation_start: iso(yearsAgo(11)), sort_order: 'asc'
  });
  if (src.units) p.set('units', src.units);
  const j = await getJSON('https://api.stlouisfed.org/fred/series/observations?' + p);
  return (j.observations || [])
    .filter(o => o.value !== '.' && o.value !== '')
    .map(o => [o.date, Number(o.value)]);
}

/* ---------- Yahoo Finance (비공식) ---------- */
async function fetchYahoo(src) {
  // range·interval: 기본은 2년 일봉, 계산용 보조 시계열은 10년 월봉 등으로 따로 받을 수 있음
  const path = `/v8/finance/chart/${encodeURIComponent(src.yahoo)}?range=${src.range || '2y'}&interval=${src.interval || '1d'}&includePrePost=false&events=div%2Csplit`;
  let j;
  try { j = await getJSON('https://query1.finance.yahoo.com' + path); }
  catch (e) { j = await getJSON('https://query2.finance.yahoo.com' + path); }
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  if (!r || !r.timestamp) throw new Error((j && j.chart && j.chart.error && j.chart.error.description) || '응답 없음');
  const offset = (r.meta && r.meta.gmtoffset) || 0;   // 거래소 현지 날짜 기준
  // adj: 배당·분할을 반영한 수정종가 (없으면 일반 종가)
  const adj = src.adj && r.indicators.adjclose && r.indicators.adjclose[0] && r.indicators.adjclose[0].adjclose;
  const close = adj && adj.length === r.timestamp.length ? adj : r.indicators.quote[0].close;
  if (src.adj && close !== adj) console.log(`  · ${src.yahoo}: 수정종가 없음 → 일반 종가 사용`);
  let rows = r.timestamp.map((t, i) => [iso(new Date((t + offset) * 1000)), close[i] == null ? NaN : close[i]]);
  // 정규장이 진행 중이면 오늘 봉은 종가가 아닌 장중 가격 → 제외하고 직전 종가까지만 사용 (주식·ETF·지수)
  // 단, 선물(=F)·환율(=X)·달러인덱스처럼 거의 24시간 거래되는 시장은 '장중'이 끝나지 않아
  // 이 규칙을 쓰면 늘 하루 전 값에 멈춤 (예: 한국 아침에 미국 월요일 유가가 빠지고 금요일 값 표시) → 최신 봉 유지
  const h24 = /=F$|=X$/.test(src.yahoo) || src.yahoo === 'DX-Y.NYB' || ['FUTURE', 'CURRENCY'].includes(r.meta && r.meta.instrumentType);
  const reg = r.meta && r.meta.currentTradingPeriod && r.meta.currentTradingPeriod.regular;
  const now = Date.now() / 1000;
  if (!h24 && reg && now >= reg.start && now < reg.end && r.timestamp[r.timestamp.length - 1] >= reg.start) rows = rows.slice(0, -1);
  return rows;
}

/* ---------- 한국은행 ECOS ---------- */
async function fetchEcos(src) {
  if (!ECOS_KEY) throw new SkipError('ECOS_API_KEY 없음');
  const now = new Date();
  const start = yearsAgo(src.cycle === 'D' ? 2 : 11);
  const fmt = d => src.cycle === 'D' ? iso(d).replace(/-/g, '') : iso(d).slice(0, 7).replace('-', '');
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(ECOS_KEY)}/json/kr/1/10000/` +
    `${src.ecos}/${src.cycle}/${fmt(start)}/${fmt(now)}/${src.item}`;
  const j = await getJSON(url);
  if (j.RESULT) throw new Error(`ECOS ${j.RESULT.CODE} ${j.RESULT.MESSAGE}`);
  const rows = (j.StatisticSearch && j.StatisticSearch.row) || [];
  if (!rows.length) throw new Error('ECOS 데이터 없음');
  let obs = rows.map(r => {
    const t = String(r.TIME);
    const date = t.length === 8 ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : `${t.slice(0, 4)}-${t.slice(4, 6)}-01`;
    return [date, Number(String(r.DATA_VALUE).replace(/,/g, ''))];
  });
  if (src.transform === 'yoy') {
    const byDate = new Map(obs);
    obs = obs.map(([d, v]) => {
      const prevYear = `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`;
      const base = byDate.get(prevYear);
      return [d, base ? (v / base - 1) * 100 : NaN];
    });
  }
  return obs;
}

/* ---------- Eurostat (EU 통계청, 키 불필요, JSON-stat) ----------
 * { eurostat: '데이터셋 코드', filters: { geo: 'EU27_2020' }, prefer: { 차원: /라벨 정규식/ } }
 * 여러 값이 있는 차원은 prefer 정규식과 라벨이 맞는 값을 고르고, 맞는 값이 없으면
 * 가능한 값 목록을 오류로 남깁니다 (Actions 로그에서 확인 후 sources.mjs 수정).
 */
async function fetchEurostat(src) {
  const p = new URLSearchParams({ format: 'JSON', lang: 'EN', sinceTimePeriod: `${new Date().getFullYear() - 11}-01` });
  Object.entries(src.filters || {}).forEach(([k, v]) => p.append(k, v));
  const j = await getJSON(`https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${src.eurostat}?` + p);
  if (!j.id || !j.dimension) throw new Error('Eurostat 응답 형식 오류' + (j.error ? `: ${JSON.stringify(j.error).slice(0, 200)}` : ''));
  // JSON-stat 범주 index 는 객체·배열·생략(범주 1개) 모두 가능 → { code: 위치 } 로 통일
  const indexOf = dim => {
    const cat = j.dimension[dim].category || {};
    if (Array.isArray(cat.index)) return Object.fromEntries(cat.index.map((c, i) => [c, i]));
    if (cat.index && typeof cat.index === 'object') return cat.index;
    return Object.fromEntries(Object.keys(cat.label || {}).map((c, i) => [c, i]));
  };
  const IDX = Object.fromEntries(j.id.map(d => [d, indexOf(d)]));
  const timeDim = j.id.find(d => d === 'time' || /time/i.test(d));
  const times = Object.keys(IDX[timeDim]).sort((a, b) => IDX[timeDim][a] - IDX[timeDim][b]);
  const strides = j.size.map((_, i) => j.size.slice(i + 1).reduce((a, b) => a * b, 1));
  // 차원별 후보: prefer 가 있으면 그 값만, 없으면 모든 값
  const cand = {};
  for (const dim of j.id) {
    if (dim === timeDim) continue;
    const cat = j.dimension[dim].category || {};
    const codes = Object.keys(IDX[dim]).sort((a, b) => IDX[dim][a] - IDX[dim][b]);
    const label = c => (cat.label && cat.label[c]) || c;
    const re = src.prefer && src.prefer[dim];
    if (re) {
      const hit = codes.find(c => re.test(label(c)) || re.test(c));
      if (!hit) throw new Error(`${dim} 에서 ${re} 와 맞는 값 없음. 가능한 값: ${codes.map(c => `${c}(${label(c)})`).join(', ').slice(0, 600)}`);
      cand[dim] = [hit];
    } else cand[dim] = codes;
  }
  // 후보 조합 중 값이 가장 많은 조합 선택
  const dims = Object.keys(cand);
  let combos = [{}];
  dims.forEach(d => { combos = combos.flatMap(c => cand[d].map(code => ({ ...c, [d]: code }))); });
  const series = combo => times.map(t => {
    let flat = 0;
    j.id.forEach((dim, i) => { flat += (dim === timeDim ? IDX[timeDim][t] : IDX[dim][combo[dim]]) * strides[i]; });
    const v = j.value[flat];
    const date = /^\d{4}-\d{2}$/.test(t) ? `${t}-01` : /^\d{4}$/.test(t) ? `${t}-01-01` : t;
    return [date, v == null ? NaN : Number(v)];
  });
  if (!combos.length) {
    throw new Error(`후보 조합 없음 — 차원: ${j.id.map((d, i) => `${d}(${j.size[i]}개: ${Object.keys(IDX[d]).slice(0, 8).join('/')})`).join(', ')}`);
  }
  let best = null, bestN = -1;
  for (const c of combos.slice(0, 200)) {
    const s = series(c), n = s.filter(o => Number.isFinite(o[1])).length;
    if (n > bestN) { best = c; bestN = n; }
  }
  const desc = dims.filter(d => cand[d].length > 1 || (src.prefer && src.prefer[d]))
    .map(d => `${d}=${best[d]}(${((j.dimension[d].category || {}).label || {})[best[d]] || ''})`).join(', ');
  console.log(`  · Eurostat ${src.eurostat} 선택: ${desc} — 값 ${bestN}개 (후보 조합 ${combos.length}개)`);
  return series(best);
}

/* ---------- 미국 에너지정보청 EIA (API v2, 예전 시리즈 ID로 조회) ----------
 * { eia: 'PET.WCRFPUS2.W', scale: 0.001(선택), avg: 4(선택: 최근 N개 이동평균) }
 */
async function fetchEia(src) {
  if (!EIA_KEY) throw new SkipError('EIA_API_KEY 없음');
  const j = await getJSON(`https://api.eia.gov/v2/seriesid/${encodeURIComponent(src.eia)}?api_key=${encodeURIComponent(EIA_KEY)}`);
  const resp = j && j.response;
  if (!resp || !Array.isArray(resp.data)) throw new Error('EIA 응답 형식 오류' + (j && j.error ? `: ${String(j.error).slice(0, 200)}` : ''));
  let obs = resp.data
    .map(r => {
      const t = String(r.period);
      const date = /^\d{4}-\d{2}$/.test(t) ? `${t}-01` : /^\d{4}$/.test(t) ? `${t}-01-01` : t.slice(0, 10);
      return [date, r.value == null || r.value === '' ? NaN : Number(r.value)];
    })
    .filter(o => Number.isFinite(o[1]))
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (src.avg) {
    const n = src.avg;
    obs = obs.map((o, i) => i < n - 1 ? [o[0], NaN] : [o[0], obs.slice(i - n + 1, i + 1).reduce((s, x) => s + x[1], 0) / n]);
  }
  return obs;
}

/* ---------- EIA 전력망 (EIA-930, 미국 본토 48개 주 발전원별 일간 발전량) ----------
 * { eiaGrid: 'NG' | 'COL' | ..., avg: 7(선택: 이동평균) } → 그날 전체 발전량 중 그 발전원 비중(%)
 * 발전원 여러 개가 같은 응답을 쓰므로 한 번만 받아 공유. 집계가 덜 된 날(전체 발전량이 평소의 70% 미만)은 제외. */
let gridCache = null;
async function loadGrid() {
  const base = 'https://api.eia.gov/v2/electricity/rto/daily-fuel-type-data/data/';
  const page = async (tz, offset) => {
    const p = new URLSearchParams({ api_key: EIA_KEY, frequency: 'daily', 'data[0]': 'value', 'facets[respondent][]': 'US48',
      start: iso(yearsAgo(2)), 'sort[0][column]': 'period', 'sort[0][direction]': 'asc', length: '5000', offset: String(offset) });
    if (tz) p.set('facets[timezone][]', tz);
    const j = await getJSON(base + '?' + p);
    const resp = j && j.response;
    if (!resp || !Array.isArray(resp.data)) throw new Error('EIA 전력망 응답 형식 오류' + (j && j.error ? `: ${String(j.error).slice(0, 200)}` : ''));
    return resp;
  };
  const all = async tz => {
    let rows = [], offset = 0;
    for (let i = 0; i < 20; i++) {
      const r = await page(tz, offset);
      rows = rows.concat(r.data);
      offset += r.data.length;
      if (!r.data.length || offset >= Number(r.total || 0)) break;
    }
    return rows;
  };
  let rows = await all('Eastern');
  if (!rows.length) rows = await all(null);
  // 시간대가 섞여 오면 Eastern(없으면 처음 보이는 것) 하나만 사용
  const tzs = [...new Set(rows.map(r => r.timezone).filter(Boolean))];
  const tz = tzs.includes('Eastern') ? 'Eastern' : tzs[0];
  if (tz) rows = rows.filter(r => r.timezone === tz);
  const byDay = new Map();
  for (const r of rows) {
    const v = Number(r.value);
    if (!r.period || !r.fueltype || !Number.isFinite(v)) continue;
    const d = String(r.period).slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, {});
    byDay.get(d)[r.fueltype] = v;
  }
  const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([d, f]) => [d, f, Object.values(f).filter(v => v > 0).reduce((a, b) => a + b, 0)]);
  const totals = days.map(x => x[2]).sort((a, b) => a - b);
  const median = totals[Math.floor(totals.length / 2)] || 0;
  return days.filter(x => x[2] > 0 && x[2] >= median * 0.7);
}
async function fetchEiaGrid(src) {
  if (!EIA_KEY) throw new SkipError('EIA_API_KEY 없음');
  if (!gridCache) gridCache = loadGrid();
  let days;
  try { days = await gridCache; } catch (e) { gridCache = null; throw e; }
  let obs = days.map(([d, f, total]) => [d, f[src.eiaGrid] == null ? NaN : f[src.eiaGrid] / total * 100]).filter(o => Number.isFinite(o[1]));
  if (!obs.length) throw new Error(`발전원 ${src.eiaGrid} 없음 (있는 발전원: ${Object.keys((days[days.length - 1] || [])[1] || {}).join(',')})`);
  if (src.avg) {
    const n = src.avg;
    obs = obs.map((o, i) => i < n - 1 ? [o[0], NaN] : [o[0], obs.slice(i - n + 1, i + 1).reduce((s, x) => s + x[1], 0) / n]);
  }
  return obs;
}

/* ---------- 미국 원자력규제위원회 NRC 원자로 일간 출력 (키 불필요) ----------
 * { nrc: true } → 날짜별 전체 원자로 평균 출력률(%) = 원전 가동률 근사 (정비·고장으로 멈춘 원자로는 0%) */
async function fetchNrc() {
  const url = 'https://www.nrc.gov/reading-rm/doc-collections/event-status/reactor-status/powerreactorstatusforlast365days.txt';
  let text, last;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text(); break;
    } catch (e) { last = e; await sleep(1000 * 2 ** i); }
  }
  if (text == null) throw last;
  const byDay = new Map();
  for (const line of text.split(/\r?\n/)) {
    const [dt, unit, pw] = line.split('|').map(x => (x || '').trim());
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(dt || '');
    const v = Number(pw);
    if (!m || !unit || pw === '' || !Number.isFinite(v)) continue;   // 머리글·빈 줄 건너뜀
    const d = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(v);
  }
  const counts = [...byDay.values()].map(a => a.length).sort((a, b) => a - b);
  const typical = counts[Math.floor(counts.length / 2)] || 0;
  // 보고된 원자로 수가 평소의 90% 미만인 날은 덜 집계된 것으로 보고 제외
  return [...byDay.entries()].filter(([, a]) => a.length >= typical * 0.9)
    .map(([d, a]) => [d, a.reduce((s, x) => s + x, 0) / a.length]);
}

/* ---------- Ember (국가별 월간 발전원 구성) ----------
 * { ember: 'JPN', series: 'Coal' } → 그 나라 발전량 중 해당 발전원 비중(%, 월간)
 * 나라별로 한 번만 받아 여러 발전원이 공유. API 주소가 두 개(ember-energy / ember-climate)라 차례로 시도. */
const emberCache = new Map();
async function loadEmber(code) {
  const reasons = [];
  // 나라는 entity_code(ISO3), EU 같은 묶음 지역은 코드가 없을 수 있어 entity 이름으로도 시도
  for (const key of ['entity_code', 'entity']) {
    const p = new URLSearchParams({ [key]: code, start_date: `${new Date().getFullYear() - 11}-01`, is_aggregate_series: 'false', api_key: EMBER_KEY });
    for (const host of ['https://api.ember-energy.org', 'https://api.ember-climate.org']) {
      try {
        const j = await getJSON(`${host}/v1/electricity-generation/monthly?` + p);
        const rows = Array.isArray(j) ? j : j && Array.isArray(j.data) ? j.data : null;
        if (!rows) throw new Error('응답 형식 오류: ' + JSON.stringify(j).slice(0, 200));
        if (!rows.length) throw new Error('데이터 없음');
        return rows;
      } catch (e) { reasons.push(`${host.replace('https://', '')}(${key}) → ${e.message}`); }
    }
  }
  throw new Error(reasons.join(' / '));
}
async function fetchEmber(src) {
  if (!EMBER_KEY) throw new SkipError('EMBER_API_KEY 없음');
  if (!emberCache.has(src.ember)) emberCache.set(src.ember, loadEmber(src.ember));
  let rows;
  try { rows = await emberCache.get(src.ember); } catch (e) { emberCache.delete(src.ember); throw e; }
  const want = String(src.series).toLowerCase();
  const hit = rows.filter(r => String(r.series || '').toLowerCase() === want);
  if (!hit.length) throw new Error(`발전원 ${src.series} 없음 (있는 항목: ${[...new Set(rows.map(r => r.series))].join(',').slice(0, 200)}, 필드: ${Object.keys(rows[0]).join(',')})`);
  return hit.map(r => [String(r.date).slice(0, 7) + '-01', Number(r.share_of_generation_pct)]);
}

/* ---------- World Bank 원자재 월간 가격표 (Pink Sheet, xlsx) — 비료 등 ----------
 * 파일 주소가 해마다 바뀌어, 원자재 시장 페이지에서 'CMO-Historical-Data-Monthly.xlsx' 링크를 찾고 실패하면 알려진 주소를 시도.
 * 'Monthly Prices' 시트: 머리 행에 품목 이름, 첫 열에 '1960M01' 형식 날짜. 한 번 받아 모든 지표가 같이 씀 */
const WB_PAGE = 'https://www.worldbank.org/en/research/commodity-markets';
const WB_KNOWN = [
  'https://thedocs.worldbank.org/en/doc/18675f1d1639c7a34d463f59263ba0a2-0050012025/related/CMO-Historical-Data-Monthly.xlsx',
  'https://thedocs.worldbank.org/en/doc/5d903e848db1d1b83e0ec8f744e55570-0350012021/related/CMO-Historical-Data-Monthly.xlsx'
];
let wbSheet = null;
async function getBuffer(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
async function loadWorldBank() {
  const urls = [];
  try {
    const html = await (await fetch(WB_PAGE, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) })).text();
    for (const m of html.matchAll(/https?:\/\/thedocs\.worldbank\.org\/[^"'\s<>]*CMO-Historical-Data-Monthly\.xlsx/gi)) urls.push(m[0]);
  } catch (e) { console.log(`  · World Bank 페이지 읽기 실패 (${e.message}) → 알려진 주소 시도`); }
  const tried = [];
  for (const url of [...new Set([...urls, ...WB_KNOWN])]) {
    try {
      const rows = readSheet(await getBuffer(url), /^monthly prices$/i);
      console.log(`  · World Bank 월간 가격표: ${url.split('/').slice(-3, -1).join('/')} (${rows.length}행)`);
      return rows;
    } catch (e) { tried.push(`${url.slice(-60)} → ${e.message}`); }
  }
  throw new Error(`World Bank 가격표 받기 실패: ${tried.join(' / ')}`);
}
/** 가격표 행 배열에서 품목 열 하나 → [[YYYY-MM-01, 값]] */
function parseWorldBank(rows, item) {
  const re = new RegExp('^\\s*' + item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  let col = -1, head = -1;
  for (let r = 0; r < Math.min(rows.length, 20) && col < 0; r++) {
    const i = (rows[r] || []).findIndex(c => typeof c === 'string' && re.test(c));
    if (i > 0) { col = i; head = r; }
  }
  if (col < 0) throw new Error(`품목 '${item}' 없음`);
  const out = [];
  for (const row of rows.slice(head + 1)) {
    const m = /^(\d{4})M(\d{2})$/.exec(String((row || [])[0] || '').trim());
    const v = row && row[col];
    if (m && typeof v === 'number' && Number.isFinite(v)) out.push([`${m[1]}-${m[2]}-01`, v]);
  }
  if (!out.length) throw new Error(`품목 '${item}' 값 없음`);
  return out;
}
async function fetchWorldBank(src) {
  if (!wbSheet) wbSheet = loadWorldBank();
  let rows;
  try { rows = await wbSheet; } catch (e) { wbSheet = null; throw e; }
  return parseWorldBank(rows, src.wb);
}

const FETCHERS = { fred: fetchFred, yahoo: fetchYahoo, ecos: fetchEcos, eurostat: fetchEurostat, eia: fetchEia, eiaGrid: fetchEiaGrid, nrc: fetchNrc, ember: fetchEmber, wb: fetchWorldBank };
const sourceLabel = src => src.fred ? `FRED:${src.fred}` : src.yahoo ? `Yahoo:${src.yahoo}`
  : src.eurostat ? `Eurostat:${src.eurostat}` : src.eia ? `EIA:${src.eia}` : src.eiaGrid ? `EIA-930:US48/${src.eiaGrid}` : src.nrc ? 'NRC:원자로 출력' : src.ember ? `Ember:${src.ember}/${src.series}` : src.wb ? `WorldBank:${src.wb}` : `ECOS:${src.ecos}/${src.item}`;

/** 지표 하나: 소스를 순서대로 시도 */
async function collect(id, sources) {
  const reasons = [];
  for (const [idx, src] of sources.entries()) {
    const kind = Object.keys(FETCHERS).find(k => src[k]);
    try {
      const raw = await FETCHERS[kind](src);
      let obs = clean(raw, src.scale);
      if (obs.length < 2) throw new Error('관측치 부족');
      const freq = guessFreq(obs);
      obs = trim(obs, freq);
      return { source: sourceLabel(src), freq, fetchedAt: new Date().toISOString(), obs, ...(idx > 0 ? { fallbackReason: reasons.join(' / ') } : {}) };
    } catch (e) {
      reasons.push(`${sourceLabel(src)} → ${e.message}`);
    }
  }
  throw new Error(reasons.join(' / '));
}

/** 동시 실행 개수 제한 */
async function pool(items, limit, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

async function main() {
  let previous = null;
  if (PREVIOUS) {
    try { previous = JSON.parse(await readFile(PREVIOUS, 'utf8')); console.log(`이전 데이터: ${PREVIOUS}`); }
    catch (e) { console.log('이전 데이터 없음 (첫 실행이거나 다운로드 실패)'); }
  }
  if (!FRED_KEY) console.warn('⚠ FRED_API_KEY 가 없어 FRED 지표를 건너뜁니다.');
  if (!ECOS_KEY) console.warn('⚠ ECOS_API_KEY 가 없어 한국은행 지표를 건너뜁니다.');
  if (!EIA_KEY) console.warn('⚠ EIA_API_KEY 가 없어 EIA 지표를 건너뜁니다.');

  const series = {};
  const errors = [];
  const warnings = [];   // 급변 등 확인이 필요한 지표 (값은 유지)
  const entries = Object.entries(SOURCES);
  await pool(entries, 4, async ([id, sources]) => {
    try {
      const got = await collect(id, sources);
      // 1순위 소스 실패로 대체 소스를 썼는데, 그 값이 이전에 받아 둔 값보다 오래됐으면 이전 값 유지
      // (예: 한국은행 ECOS 장애 → FRED 대체 한국 CPI 가 2023년에 멈춰 있는 경우)
      const prev = previous && previous.series && previous.series[id];
      if (got.fallbackReason && prev && prev.obs && prev.obs.length && prev.obs[prev.obs.length - 1][0] > got.obs[got.obs.length - 1][0]) {
        series[id] = prev;
        errors.push({ id, message: `${got.fallbackReason} / 대체 소스(${got.source})가 이전 값보다 오래됨`, keptPrevious: true });
        console.log(`✗ ${id.padEnd(12)} 대체 소스 ${got.source} 가 더 오래됨 → 이전 값 유지`);
        return;
      }
      delete got.fallbackReason;
      // 같은 출처인데 이번 응답이 이전보다 최근 날짜가 빠져 있으면(Yahoo 등 일시적 누락) 이전의 더 새 관측치를 이어 붙임
      if (prev && prev.obs && prev.obs.length && prev.source === got.source) {
        const lastNew = got.obs[got.obs.length - 1][0];
        const extra = prev.obs.filter(o => o[0] > lastNew);
        if (extra.length) { got.obs = got.obs.concat(extra); console.log(`  · ${id}: 응답에 최근 ${extra.length}개 관측치 누락 → 이전 값 보존 (${extra[extra.length - 1][0]})`); }
      }
      series[id] = got;
      // 무결성 점검: 직전 관측치 대비 비정상 급변(시세 오류·선물 월물 교체 등) — 값은 그대로 두고 로그로 알림
      const o = got.obs, n = o.length;
      if (n >= 2 && got.freq === 'D' && o[n - 2][1] && Math.abs(o[n - 1][1] / o[n - 2][1] - 1) > 0.25 && Math.sign(o[n - 1][1]) === Math.sign(o[n - 2][1])) {
        warnings.push(id); console.log(`  ⚠ ${id}: 직전 대비 ${((o[n - 1][1] / o[n - 2][1] - 1) * 100).toFixed(1)}% 급변 (${o[n - 2][0]} ${o[n - 2][1]} → ${o[n - 1][0]} ${o[n - 1][1]}) — 시세 확인 필요`);
      }
      const last = series[id].obs[series[id].obs.length - 1];
      console.log(`✓ ${id.padEnd(12)} ${series[id].source.padEnd(26)} ${last[0]}  ${last[1]}`);
    } catch (e) {
      const prev = previous && previous.series && previous.series[id];
      if (prev) series[id] = prev;
      errors.push({ id, message: e.message, keptPrevious: !!prev });
      console.log(`✗ ${id.padEnd(12)} ${e.message}${prev ? '  (이전 값 유지)' : ''}`);
    }
  });

  // ── 계산 지표: 다른 지표들로 만드는 값 ──
  for (const [id, def] of Object.entries(COMPUTED)) {
    try {
      const parts = def.inputs.map(k => series[k]);
      if (parts.some(x => !x)) throw new Error(`재료 지표 없음 (${def.inputs.filter(k => !series[k]).join(', ')})`);
      let obs;
      if (def.byMonth) {
        // 월 단위로 짝짓기 (월간 지표의 날짜가 1일·말일 등으로 달라도)
        const months = parts.map(x => new Map(x.obs.map(([d, v]) => [d.slice(0, 7), v])));
        obs = parts[0].obs.filter(([d]) => months.every(m => m.has(d.slice(0, 7))))
          .map(([d]) => [d, round(def.calc(...months.map(m => m.get(d.slice(0, 7)))))]).filter(o => Number.isFinite(o[1]));
      } else if (def.asof) {
        obs = parts[0].obs.map(([d, v]) => {
          const rest = parts.slice(1).map(x => valueAsOf(x.obs, d));
          return rest.some(r => r == null) ? null : [d, round(def.calc(v, ...rest))];
        }).filter(o => o && Number.isFinite(o[1]));
      } else {
        const maps = parts.map(x => new Map(x.obs));
        obs = parts[0].obs.filter(([d]) => maps.every(m => m.has(d)))
          .map(([d]) => [d, round(def.calc(...maps.map(m => m.get(d))))]).filter(o => Number.isFinite(o[1]));
      }
      if (obs.length < 2) throw new Error('겹치는 날짜 부족');
      series[id] = { source: def.label, freq: parts[0].freq, fetchedAt: new Date().toISOString(), obs };
      console.log(`✓ ${id.padEnd(14)} ${def.label.padEnd(26)} ${obs[obs.length - 1][0]}  ${obs[obs.length - 1][1]}`);
    } catch (e) {
      const prev = previous && previous.series && previous.series[id];
      if (prev) series[id] = prev;
      errors.push({ id, message: e.message, keptPrevious: !!prev });
      console.log(`✗ ${id.padEnd(12)} ${e.message}${prev ? '  (이전 값 유지)' : ''}`);
    }
  }

  const ordered = Object.fromEntries([...entries.map(([id]) => id), ...Object.keys(COMPUTED)].filter(id => series[id]).map(id => [id, series[id]]));
  const out = { generatedAt: new Date().toISOString(), series: ordered, errors };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out));

  const total = entries.length + Object.keys(COMPUTED).length;
  const fresh = total - errors.length;
  console.log(`\n완료: 성공 ${fresh} / 실패 ${errors.length} / 전체 ${total} → ${OUT}${warnings.length ? ` · 급변 확인 ${warnings.length}개 (${warnings.join(', ')})` : ''}`);
  // 하나도 못 받았으면 실패 처리 → 배포를 건너뛰어 기존 사이트 유지
  if (fresh === 0) { console.error('수집된 지표가 없습니다. API 키와 네트워크를 확인하세요.'); process.exit(1); }
}

// 테스트(tests/)에서 계산·정리 함수만 가져다 쓸 수 있게 내보냄. 직접 실행할 때만 수집 시작
export { COMPUTED, clean, guessFreq, trim, valueAsOf, round, parseWorldBank };
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
