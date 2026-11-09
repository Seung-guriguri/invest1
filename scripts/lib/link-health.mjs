/* 연결 고리 건강 점검 — 경제적 이유가 있는 감시 짝(index.html WATCH_PAIRS)이 지금도 성립하는지 채점
 *   무차별 비교가 아니라 '이미 이유를 아는 관계'만 본다. 깨진 고리 = 평소 잘 맞던 관계가 최근 반대로 움직임.
 *   판정 기준은 화면의 '엇갈림 감시'와 같은 corr.js divergence (평소 = 최근 8주 직전 1년, 최근 = 8주)
 *   추가로: 몇 주째 깨져 있는지, 이번 주 새로 깨졌는지/회복됐는지, 한쪽이 먼저 움직이는지(선행)
 *
 *   고리 성격에 따라 판정 방식이 두 가지:
 *   - price(가격끼리 매일 같이 움직이는 고리): 주간 변화율 상관. 평소 상관 0.35 이상이면 관계 있음 (화면 예전 기준 0.5 는 너무 엄격)
 *   - trend(수준·몇 달 추세로 연결된 고리 — 재고·유가, 유동성·주가, 금·실질금리 등): 13주 변화의 방향.
 *     평소 = 최근 13주 직전 3년의 13주 변화끼리 상관, 깨짐 = 최근 13주에 기대와 반대 방향으로 둘 다 의미 있게(평소 13주 변화폭의 0.75배 이상) 움직임.
 *     재고(원유·가스)는 계절 패턴을 빼려고 '평년 대비 %' 로 바꿔 비교 */
import { readFile } from 'node:fs/promises';
import '../../corr.js';   // globalThis.CORR 등록
import { seasonDevAt } from './combo.mjs';

const DAY = 86400000;
const CORR = globalThis.CORR;

/** 고리마다 '왜 같이(반대로) 움직이는가' — 한 줄 */
const WHY = {
  'wti|etf_xle': '유가가 에너지 기업 이익을 좌우', 'natgas|etf_ung': 'UNG 는 천연가스 선물을 담은 ETF', 'copper|us10y': '구리와 금리 모두 경기 기대를 반영',
  'gold|real10y': '실질금리가 오르면 이자 없는 금의 매력 감소', 'dxy|usdkrw': '달러 강세는 원화 약세', 'sp500|kospi': '글로벌 위험 선호를 함께 반영',
  'usdkrw|kospi': '원화 약세 때 외국인 자금 이탈', 'hy_spread|sp500': '신용 불안이 커지면 주가 하락', 'us10y|mortgage': '모기지 금리는 10년물을 따라감',
  'bdry|iron_ore': '철광석 물동량이 벌크선 운임을 좌우', 'tanker_fro|etf_bwet': '둘 다 유조선 운임을 반영', 'brent|bei10y': '유가가 물가 기대를 움직임',
  'dxy|gold': '달러 강세는 금 가격에 부담', 'copper|sp500': '둘 다 경기 기대를 반영', 'coking_amr|iron_ore': '원료탄·철광석은 함께 철강 생산에 쓰임',
  'fert_cf|ttf': '유럽 가스가 비싸면 미국 질소비료 기업이 유리', 'fert_mos|corn': '곡물값이 오르면 비료 수요 증가', 'audusd|iron_ore': '호주는 철광석 수출국',
  'audusd|copper': '호주달러는 원자재 통화', 'ng_storage|natgas': '저장량이 많으면 가스 가격 하락', 'us_crude|wti': '재고가 쌓이면 유가 하락',
  'crack321|refinery_util': '마진이 좋으면 정유소가 더 가동', 'usdkrw|etf_ewy': 'EWY 는 달러로 본 한국 주식', 'gold_etf_gld|gold': 'ETF 자금 유입이 금값을 밀어 올림',
  'net_liq|sp500': '시장에 풀린 돈이 주가를 받침', 'copper_gold|us10y': '구리÷금과 금리 모두 경기 기대를 반영', 'crack321|refiner_idx': '정유 마진이 정유사 이익을 좌우',
  'tanker_idx|etf_bwet': '둘 다 유조선 운임을 반영', 'sox|kospi': '코스피는 반도체 비중이 큼'
};

/** 판정 방식: 목록에 없으면 price. season: A 를 평년 대비 % 로 바꿈 (재고·저장량) */
const KIND = {
  'gold|real10y': 'trend', 'dxy|gold': 'trend', 'gold_etf_gld|gold': 'trend', 'net_liq|sp500': 'trend',
  'copper|us10y': 'trend', 'copper_gold|us10y': 'trend', 'us10y|mortgage': 'trend',
  'us_crude|wti': 'trend', 'ng_storage|natgas': 'trend',
  'crack321|refinery_util': 'trend', 'crack321|refiner_idx': 'trend',
  'bdry|iron_ore': 'trend', 'coking_amr|iron_ore': 'trend', 'audusd|iron_ore': 'trend', 'fert_cf|ttf': 'trend', 'fert_mos|corn': 'trend'
};
const SEASON_A = new Set(['us_crude|wti', 'ng_storage|natgas']);
const PRICE_MIN_R = 0.35, TREND_MIN_R = 0.3, H = 13, TREND_YEARS = 3, MOVE_SD = 0.75;

/** index.html 의 WATCH_PAIRS 읽기 → [[a, b, expect], …] (화면과 같은 목록을 쓰려고 파일에서 직접 읽음) */
async function readPairs() {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const m = html.match(/const WATCH_PAIRS = \[([\s\S]*?)\n\];/);
  if (!m) return [];
  return [...m[1].matchAll(/\['([a-z0-9_]+)', '([a-z0-9_]+)', (-?1)\]/g)].map(x => [x[1], x[2], Number(x[3])]);
}

const toSeries = (id, s, m, until = null) => ({
  id, mode: m.mode === 'pct' ? 'pct' : 'diff', freq: s.freq,
  hist: (until ? s.obs.filter(o => o[0] <= until) : s.obs).map(([date, value]) => ({ date, value }))
});
/** 화면과 같은 분류 */
function classify(d, expect, minR = PRICE_MIN_R) {
  if (!d) return '데이터 부족';
  if (d.on) return '깨짐';
  if (expect * d.r1 < minR) return '평소 관계 약함';
  if (d.rr != null && expect * d.rr < 0) return '경계';
  return '정상';
}
const iso = t => new Date(t).toISOString().slice(0, 10);

/* ---------- trend 방식 ---------- */
/** 주간으로 맞춤: 그 주 월요일 날짜를 키로, 그 주 마지막 값 */
function weekly(obs) {
  const m = new Map();
  for (const [d, v] of obs) {
    if (!Number.isFinite(v)) continue;
    const t = Date.parse(d + 'T00:00:00Z'), dow = (new Date(t).getUTCDay() + 6) % 7;
    m.set(iso(t - dow * DAY), v);
  }
  return [...m.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1));
}
function pearson(xs, ys) {
  const n = xs.length; if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}
const sd = xs => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };
/** 두 주간 시계열의 13주 변화 (공통 주만, 13주 간격이 정확히 맞는 것만). mode: 'pct' 는 %, 그 밖은 차이 */
function trendChanges(wa, wb, modeA, modeB) {
  const mb = new Map(wb), common = wa.filter(([k]) => mb.has(k)).map(([k, v]) => [k, v, mb.get(k)]);
  const idx = new Map(common.map((c, i) => [c[0], i]));
  const out = [];
  for (const [k, va, vb] of common) {
    const k0 = iso(Date.parse(k + 'T00:00:00Z') - H * 7 * DAY), j = idx.get(k0);
    if (j == null) continue;
    const [, a0, b0] = common[j];
    const ca = modeA === 'pct' ? (a0 ? (va / a0 - 1) * 100 : NaN) : va - a0, cb = modeB === 'pct' ? (b0 ? (vb / b0 - 1) * 100 : NaN) : vb - b0;
    if (Number.isFinite(ca) && Number.isFinite(cb)) out.push([k, ca, cb]);
  }
  return out;
}
/** 지금(마지막 공통 주) 기준 trend 판정. 반환 형식은 corr.js divergence 와 비슷하게 */
function trendJudge(ch, expect) {
  if (!ch.length) return null;
  const last = ch[ch.length - 1], lastT = Date.parse(last[0]);
  // 평소: 최근 13주와 겹치지 않는(13주 이상 이전에 끝난) 3년치 13주 변화
  const usual = ch.filter(([k]) => { const t = Date.parse(k); return t <= lastT - H * 7 * DAY && t > lastT - (H * 7 + TREND_YEARS * 364) * DAY; });
  if (usual.length < 52) return null;
  const r1 = pearson(usual.map(x => x[1]), usual.map(x => x[2]));
  if (r1 == null) return null;
  const [, ca, cb] = last;
  const mismatch = expect > 0 ? Math.sign(ca) !== Math.sign(cb) : Math.sign(ca) === Math.sign(cb);
  const big = Math.abs(ca) >= MOVE_SD * sd(usual.map(x => x[1])) && Math.abs(cb) >= MOVE_SD * sd(usual.map(x => x[2]));
  return { on: expect * r1 >= TREND_MIN_R && mismatch && big, r1, rr: null, mismatch, n: H, unit: '주', ca, cb, basis: 'W', end: last[0] };
}
function classifyTrend(d, expect) {
  if (!d) return '데이터 부족';
  if (d.on) return '깨짐';
  if (expect * d.r1 < TREND_MIN_R) return '평소 관계 약함';
  if (d.mismatch) return '경계';
  return '정상';
}
/** 재고·저장량 → 평년 대비 % (주간) */
const seasonSeries = w => w.map(([k, v]) => [k, seasonDevAt(w, k, v)]).filter(o => o[1] != null && Number.isFinite(o[1]));

/** series = latest.series, meta = { id: { name, mode } }, pairs = [[a, b, expect]] */
function linkHealth(series, meta, pairs, { history = 12 } = {}) {
  const out = [];
  for (const [a, b, expect] of pairs) {
    const sa = series[a], sb = series[b], ma = meta[a], mb = meta[b];
    if (!sa || !sb || !ma || !mb) continue;
    const base = { a, b, expect, nameA: ma.name, nameB: mb.name, unitA: ma.unit || '', unitB: mb.unit || '', why: WHY[`${a}|${b}`] || '', dateA: sa.obs[sa.obs.length - 1][0], dateB: sb.obs[sb.obs.length - 1][0] };
    // 재료가 오래됐으면 판정하지 않음 (멈춘 지표로 '깨짐'을 만들지 않게): 일간·주간 21일, 월간·분기 100일
    const now = Math.max(Date.parse(base.dateA), Date.parse(base.dateB));
    const limit = s => (/^[MQ]$/.test(s.freq || '') ? 100 : 21) * DAY;
    if (now - Date.parse(base.dateA) > limit(sa) || now - Date.parse(base.dateB) > limit(sb)) { out.push({ ...base, state: '데이터 부족', stale: true }); continue; }
    const key = `${a}|${b}`, kind = KIND[key] || 'price', season = SEASON_A.has(key);
    const modeA = season ? 'season' : ma.mode, modeB = mb.mode;
    let at, judge;
    if (kind === 'trend') {
      const wa = season ? seasonSeries(weekly(sa.obs)) : weekly(sa.obs);
      const ch = trendChanges(wa, weekly(sb.obs), season ? 'diff' : ma.mode, mb.mode);
      at = until => trendJudge(until ? ch.filter(([k]) => k <= until) : ch, expect);
      judge = classifyTrend;
    } else {
      at = until => CORR.divergence(toSeries(a, sa, ma, until), toSeries(b, sb, mb, until), expect, PRICE_MIN_R);
      judge = classify;
    }
    const d = at(null), state = judge(d, expect);
    // 과거 시점(1주 전, 2주 전 …)에서 다시 판정 → 지속 기간과 이번 주 변화
    const step = d && d.basis === 'M' ? 30 : 7;
    const past = [];
    for (let k = 1; k <= history; k++) past.push(judge(at(iso(now - k * step * DAY)), expect));
    let streak = 0;
    if (state === '깨짐') { streak = 1; for (const p of past) { if (p === '깨짐') streak++; else break; } }
    const change = state === '깨짐' && past[0] !== '깨짐' ? '새로 깨짐' : state !== '깨짐' && past[0] === '깨짐' ? '회복' : null;
    // 선행·후행: 한쪽이 먼저 움직이는 관계인지 (동시 상관보다 뚜렷하게 높을 때만 corr.js 가 알려 줌)
    const p = CORR.pair(toSeries(a, sa, ma), toSeries(b, sb, mb));
    const lead = p && p.lead ? { first: p.lead.lag > 0 ? a : b, lag: Math.abs(p.lead.lag), unit: p.unit, r: Math.round(p.lead.r * 100) / 100 } : null;
    const r2 = v => (v == null ? null : Math.round(v * 100) / 100);
    // price: corr.js 의 변화율은 소수(0.02 = 2%) → % 로. trend: 이미 % (평년 대비는 %p)
    const toPct = (v, mode) => (kind === 'price' && mode === 'pct' ? v * 100 : v);
    out.push({ ...base, kind, state, r1: d ? r2(d.r1) : null, rr: d ? r2(d.rr) : null, n: d ? d.n : null, unit: d ? d.unit : null,
      moveA: d ? r2(toPct(d.ca, ma.mode)) : null, moveB: d ? r2(toPct(d.cb, mb.mode)) : null, modeA, modeB, streak, streakUnit: step === 30 ? '개월' : '주', change, lead });
  }
  return out;
}

const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
const mv = (v, mode, unit = '') => mode === 'season' ? `평년 대비 ${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%p`
  : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(mode === 'pct' ? 1 : 2)}${mode === 'pct' ? '%' : mode === 'pp' ? '%p' : unit ? ' ' + unit : ''}`;
/** 평소 관계 설명: price = 주간 변화 상관, trend = 13주 변화 상관 */
const usualText = x => x.kind === 'trend' ? `평소 13주 변화 상관 ${sgn(x.r1)}` : `평소 상관 ${sgn(x.r1)} → 최근 ${x.n}${x.unit} ${sgn(x.rr)}`;
const title = x => `${x.nameA} · ${x.nameB}`;
function summary(health) {
  const c = s => health.filter(x => x.state === s).length;
  return { total: health.length, ok: c('정상'), warn: c('경계'), broken: c('깨짐'), weak: c('평소 관계 약함'), nodata: c('데이터 부족') };
}
/** 깨진 고리 한 줄 (AI 재료·텔레그램 공용) */
function brokenLine(x) {
  return `${title(x)} (평소 ${x.expect > 0 ? '같은' : '반대'} 방향 — ${x.why || '경제적 연결'}): ${usualText(x)}, ` +
    `최근 ${x.n}${x.unit} ${x.nameA} ${mv(x.moveA, x.modeA, x.unitA)} · ${x.nameB} ${mv(x.moveB, x.modeB, x.unitB)} · ${x.streak}${x.streakUnit}째${x.change ? ' (' + x.change + ')' : ''} · 기준일 ${x.dateA}/${x.dateB}`;
}
/** AI 프롬프트 블록 */
function linkBlock(health) {
  if (!health.length) return '- 데이터 없음';
  const s = summary(health);
  const broken = health.filter(x => x.state === '깨짐').sort((p, q) => q.streak - p.streak);
  const recovered = health.filter(x => x.change === '회복');
  const leads = health.filter(x => x.lead && x.state === '정상').slice(0, 5);
  const L = [`점검 ${s.total}개: 정상 ${s.ok} · 경계 ${s.warn} · 깨짐 ${s.broken} · 평소 관계 약함 ${s.weak} · 데이터 부족 ${s.nodata}`];
  L.push(broken.length ? '[깨진 고리]' : '[깨진 고리] 없음');
  broken.forEach(x => L.push('- ' + brokenLine(x)));
  if (recovered.length) { L.push('[이번에 회복된 고리]'); recovered.forEach(x => L.push(`- ${title(x)}: 평소 관계로 돌아옴 (최근 ${x.n}${x.unit} ${x.nameA} ${mv(x.moveA, x.modeA, x.unitA)} · ${x.nameB} ${mv(x.moveB, x.modeB, x.unitB)})`)); }
  if (leads.length) { L.push('[한쪽이 먼저 움직이는 고리 (정상 작동 중)]'); leads.forEach(x => L.push(`- ${title(x)}: ${x.lead.first === x.a ? x.nameA : x.nameB} 이(가) 약 ${x.lead.lag}${x.lead.unit} 먼저 (시차 상관 ${sgn(x.lead.r)})`)); }
  return L.join('\n');
}
/** 텔레그램 블록 (코드가 만든 문장 — AI 가 쓰지 않음). 깨진 고리·회복이 없으면 빈 배열 */
function linkTelegram(health, { max = 4 } = {}) {
  const broken = health.filter(x => x.state === '깨짐').sort((p, q) => (q.change ? 1 : 0) - (p.change ? 1 : 0) || q.streak - p.streak);
  const recovered = health.filter(x => x.change === '회복');
  if (!broken.length && !recovered.length) return [];
  const s = summary(health);
  const L = [`🔗 연결 고리 점검 — ${s.total}개 중 깨짐 ${s.broken} · 경계 ${s.warn}`];
  broken.slice(0, max).forEach(x => L.push(`• ${title(x)}: 평소 ${x.expect > 0 ? '같이' : '반대로'} 움직이는데 최근 ${x.n}${x.unit} 동안 ${x.nameA} ${mv(x.moveA, x.modeA, x.unitA)}, ${x.nameB} ${mv(x.moveB, x.modeB, x.unitB)} (${x.streak}${x.streakUnit}째${x.change ? ', ' + x.change : ''})`));
  if (broken.length > max) L.push(`  외 ${broken.length - max}개는 앱 '엇갈림 감시'에서`);
  recovered.slice(0, 2).forEach(x => L.push(`• 회복: ${title(x)}`));
  return L;
}

/** 화면용 links.json (지표 이름은 화면이 IND 로 붙임) */
function linkJson(health) {
  return { generatedAt: new Date().toISOString(), summary: summary(health),
    items: health.map(({ a, b, expect, kind, state, r1, rr, n, unit, moveA, moveB, modeA, modeB, streak, streakUnit, change, lead, why, dateA, dateB, stale }) =>
      ({ a, b, expect, kind, state, r1, rr, n, unit, moveA, moveB, modeA, modeB, streak, streakUnit, change, lead, why, dateA, dateB, ...(stale ? { stale } : {}) })) };
}

export { WHY, KIND, readPairs, linkHealth, linkBlock, linkTelegram, linkJson, summary, classify, weekly, trendChanges, trendJudge };
