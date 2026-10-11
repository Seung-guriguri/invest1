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
import { SOURCES } from './sources.mjs';

const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const OUT = arg('--out', 'data/latest.json');
const PREVIOUS = arg('--previous', null);

const FRED_KEY = (process.env.FRED_API_KEY || '').trim();
const ECOS_KEY = (process.env.ECOS_API_KEY || '').trim();
const EIA_KEY = (process.env.EIA_API_KEY || '').trim();
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
  lng_spread: { inputs: ['ttf', 'eurusd', 'natgas'], label: 'Calc:TTF−HH',
                calc: (ttf, fx, hh) => ttf * fx / 3.412 - hh },
  // asof: 첫 재료의 날짜마다 나머지 재료는 그날 이전 가장 최근 값 사용 (휴일·발표 주기가 달라도 계산)
  kr_us_base:     { inputs: ['kr_base', 'us_ffr'], label: 'Calc:한국−미국 기준금리', asof: true, calc: (kr, us) => kr - us },
  kr_us_10y:      { inputs: ['kr10y', 'us10y'], label: 'Calc:한국−미국 10년', asof: true, calc: (kr, us) => kr - us },
  us_real_policy: { inputs: ['us_ffr', 'us_core_pce'], label: 'Calc:FFR−근원PCE', asof: true, calc: (ffr, pce) => ffr - pce },
  brent_krw:      { inputs: ['brent', 'usdkrw'], label: 'Calc:브렌트×원/달러', asof: true, calc: (b, fx) => b * fx },
  brent_wti:      { inputs: ['brent', 'wti'], label: 'Calc:브렌트−WTI', calc: (b, w) => b - w },
  gold_silver:    { inputs: ['gold', 'silver'], label: 'Calc:금÷은', calc: (g, s) => g / s },
  hy_ig:          { inputs: ['hy_spread', 'ig_spread'], label: 'Calc:HY−IG', calc: (hy, ig) => hy - ig },
  us_crude_total: { inputs: ['us_crude', 'us_spr'], label: 'Calc:상업+SPR', calc: (c, spr) => c + spr }
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
  const path = `/v8/finance/chart/${encodeURIComponent(src.yahoo)}?range=2y&interval=1d&includePrePost=false&events=div%2Csplit`;
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
  // 정규장이 진행 중이면 오늘 봉은 종가가 아닌 장중 가격 → 제외하고 직전 종가까지만 사용
  const reg = r.meta && r.meta.currentTradingPeriod && r.meta.currentTradingPeriod.regular;
  const now = Date.now() / 1000;
  if (reg && now >= reg.start && now < reg.end && r.timestamp[r.timestamp.length - 1] >= reg.start) rows = rows.slice(0, -1);
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

const FETCHERS = { fred: fetchFred, yahoo: fetchYahoo, ecos: fetchEcos, eurostat: fetchEurostat, eia: fetchEia };
const sourceLabel = src => src.fred ? `FRED:${src.fred}` : src.yahoo ? `Yahoo:${src.yahoo}`
  : src.eurostat ? `Eurostat:${src.eurostat}` : src.eia ? `EIA:${src.eia}` : `ECOS:${src.ecos}/${src.item}`;

/** 지표 하나: 소스를 순서대로 시도 */
async function collect(id, sources) {
  const reasons = [];
  for (const src of sources) {
    const kind = Object.keys(FETCHERS).find(k => src[k]);
    try {
      const raw = await FETCHERS[kind](src);
      let obs = clean(raw, src.scale);
      if (obs.length < 2) throw new Error('관측치 부족');
      const freq = guessFreq(obs);
      obs = trim(obs, freq);
      return { source: sourceLabel(src), freq, fetchedAt: new Date().toISOString(), obs };
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
  const entries = Object.entries(SOURCES);
  await pool(entries, 4, async ([id, sources]) => {
    try {
      series[id] = await collect(id, sources);
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
      if (def.asof) {
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
  console.log(`\n완료: 성공 ${fresh} / 실패 ${errors.length} / 전체 ${total} → ${OUT}`);
  // 하나도 못 받았으면 실패 처리 → 배포를 건너뛰어 기존 사이트 유지
  if (fresh === 0) { console.error('수집된 지표가 없습니다. API 키와 네트워크를 확인하세요.'); process.exit(1); }
}

main().catch(e => { console.error(e); process.exit(1); });
