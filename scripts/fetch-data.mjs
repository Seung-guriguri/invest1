#!/usr/bin/env node
/* =====================================================================
 * 지표 자동 수집 스크립트 (Node 18+, 외부 패키지 없음)
 *
 *   node scripts/fetch-data.mjs [--out data/latest.json] [--previous 이전파일.json]
 *
 * 환경 변수 (GitHub Actions에서는 저장소 Secrets로 전달)
 *   FRED_API_KEY  — FRED 지표 (없으면 FRED 소스는 건너뜀)
 *   ECOS_API_KEY  — 한국은행 ECOS 지표 (없으면 건너뜀)
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
const UA = 'Mozilla/5.0 (macro-dashboard data fetcher)';

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

/** 주기별 보관 기간: 일간 2년, 주간 5년, 월간·분기 10년 */
function trim(obs, freq) {
  const keepYears = freq === 'D' ? 2 : freq === 'W' ? 5 : 10;
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
  const path = `/v8/finance/chart/${encodeURIComponent(src.yahoo)}?range=2y&interval=1d&includePrePost=false`;
  let j;
  try { j = await getJSON('https://query1.finance.yahoo.com' + path); }
  catch (e) { j = await getJSON('https://query2.finance.yahoo.com' + path); }
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  if (!r || !r.timestamp) throw new Error((j && j.chart && j.chart.error && j.chart.error.description) || '응답 없음');
  const offset = (r.meta && r.meta.gmtoffset) || 0;   // 거래소 현지 날짜 기준
  const close = r.indicators.quote[0].close;
  return r.timestamp.map((t, i) => [iso(new Date((t + offset) * 1000)), close[i] == null ? NaN : close[i]]);
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

const FETCHERS = { fred: fetchFred, yahoo: fetchYahoo, ecos: fetchEcos };
const sourceLabel = src => src.fred ? `FRED:${src.fred}` : src.yahoo ? `Yahoo:${src.yahoo}` : `ECOS:${src.ecos}/${src.item}`;

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

  const ordered = Object.fromEntries(entries.filter(([id]) => series[id]).map(([id]) => [id, series[id]]));
  const out = { generatedAt: new Date().toISOString(), series: ordered, errors };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out));

  const fresh = entries.length - errors.length;
  console.log(`\n완료: 성공 ${fresh} / 실패 ${errors.length} / 전체 ${entries.length} → ${OUT}`);
  // 하나도 못 받았으면 실패 처리 → 배포를 건너뛰어 기존 사이트 유지
  if (fresh === 0) { console.error('수집된 지표가 없습니다. API 키와 네트워크를 확인하세요.'); process.exit(1); }
}

main().catch(e => { console.error(e); process.exit(1); });
