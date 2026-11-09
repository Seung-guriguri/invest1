/* 연결 고리 건강 점검 — 경제적 이유가 있는 감시 짝(index.html WATCH_PAIRS)이 지금도 성립하는지 채점
 *   무차별 비교가 아니라 '이미 이유를 아는 관계'만 본다. 깨진 고리 = 평소 잘 맞던 관계가 최근 반대로 움직임.
 *   판정 기준은 화면의 '엇갈림 감시'와 같은 corr.js divergence (평소 = 최근 8주 직전 1년, 최근 = 8주)
 *   추가로: 몇 주째 깨져 있는지, 이번 주 새로 깨졌는지/회복됐는지, 한쪽이 먼저 움직이는지(선행) */
import { readFile } from 'node:fs/promises';
import '../../corr.js';   // globalThis.CORR 등록

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
function classify(d, expect) {
  if (!d) return '데이터 부족';
  if (d.on) return '깨짐';
  if (expect * d.r1 < 0.5) return '평소 관계 약함';
  if (d.rr != null && expect * d.rr < 0) return '경계';
  return '정상';
}
const iso = t => new Date(t).toISOString().slice(0, 10);

/** series = latest.series, meta = { id: { name, mode } }, pairs = [[a, b, expect]] */
function linkHealth(series, meta, pairs, { history = 12 } = {}) {
  const out = [];
  for (const [a, b, expect] of pairs) {
    const sa = series[a], sb = series[b], ma = meta[a], mb = meta[b];
    if (!sa || !sb || !ma || !mb) continue;
    const base = { a, b, expect, nameA: ma.name, nameB: mb.name, why: WHY[`${a}|${b}`] || '', dateA: sa.obs[sa.obs.length - 1][0], dateB: sb.obs[sb.obs.length - 1][0] };
    // 재료가 오래됐으면 판정하지 않음 (멈춘 지표로 '깨짐'을 만들지 않게): 일간·주간 21일, 월간·분기 100일
    const now = Math.max(Date.parse(base.dateA), Date.parse(base.dateB));
    const limit = s => (/^[MQ]$/.test(s.freq || '') ? 100 : 21) * DAY;
    if (now - Date.parse(base.dateA) > limit(sa) || now - Date.parse(base.dateB) > limit(sb)) { out.push({ ...base, state: '데이터 부족', stale: true }); continue; }
    const at = until => CORR.divergence(toSeries(a, sa, ma, until), toSeries(b, sb, mb, until), expect);
    const d = at(null), state = classify(d, expect);
    // 과거 시점(1주 전, 2주 전 …)에서 다시 판정 → 지속 기간과 이번 주 변화
    const step = d && d.basis === 'M' ? 30 : 7;
    const past = [];
    for (let k = 1; k <= history; k++) past.push(classify(at(iso(now - k * step * DAY)), expect));
    let streak = 0;
    if (state === '깨짐') { streak = 1; for (const p of past) { if (p === '깨짐') streak++; else break; } }
    const change = state === '깨짐' && past[0] !== '깨짐' ? '새로 깨짐' : state !== '깨짐' && past[0] === '깨짐' ? '회복' : null;
    // 선행·후행: 한쪽이 먼저 움직이는 관계인지 (동시 상관보다 뚜렷하게 높을 때만 corr.js 가 알려 줌)
    const p = CORR.pair(toSeries(a, sa, ma), toSeries(b, sb, mb));
    const lead = p && p.lead ? { first: p.lead.lag > 0 ? a : b, lag: Math.abs(p.lead.lag), unit: p.unit, r: Math.round(p.lead.r * 100) / 100 } : null;
    const r2 = v => (v == null ? null : Math.round(v * 100) / 100);
    out.push({ ...base, state, r1: d ? r2(d.r1) : null, rr: d ? r2(d.rr) : null, n: d ? d.n : null, unit: d ? d.unit : null,
      // corr.js 의 변화율은 소수(0.02 = 2%) → % 로 바꿔 표시
      moveA: d ? r2(ma.mode === 'pct' ? d.ca * 100 : d.ca) : null, moveB: d ? r2(mb.mode === 'pct' ? d.cb * 100 : d.cb) : null, modeA: ma.mode, modeB: mb.mode, streak, streakUnit: step === 30 ? '개월' : '주', change, lead });
  }
  return out;
}

const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
const mv = (v, mode) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(mode === 'pct' ? 1 : 2)}${mode === 'pct' ? '%' : mode === 'pp' ? '%p' : ''}`;
const title = x => `${x.nameA} · ${x.nameB}`;
function summary(health) {
  const c = s => health.filter(x => x.state === s).length;
  return { total: health.length, ok: c('정상'), warn: c('경계'), broken: c('깨짐'), weak: c('평소 관계 약함'), nodata: c('데이터 부족') };
}
/** 깨진 고리 한 줄 (AI 재료·텔레그램 공용) */
function brokenLine(x) {
  return `${title(x)} (평소 ${x.expect > 0 ? '같은' : '반대'} 방향 — ${x.why || '경제적 연결'}): 평소 상관 ${sgn(x.r1)} → 최근 ${x.n}${x.unit} ${sgn(x.rr)}, ` +
    `최근 ${x.n}${x.unit} ${x.nameA} ${mv(x.moveA, x.modeA)} · ${x.nameB} ${mv(x.moveB, x.modeB)} · ${x.streak}${x.streakUnit}째${x.change ? ' (' + x.change + ')' : ''} · 기준일 ${x.dateA}/${x.dateB}`;
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
  if (recovered.length) { L.push('[이번에 회복된 고리]'); recovered.forEach(x => L.push(`- ${title(x)}: 평소 관계로 돌아옴 (최근 ${x.n}${x.unit} 상관 ${sgn(x.rr)})`)); }
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
  broken.slice(0, max).forEach(x => L.push(`• ${title(x)}: 평소 ${x.expect > 0 ? '같이' : '반대로'} 움직이는데 최근 ${x.n}${x.unit} 동안 ${x.nameA} ${mv(x.moveA, x.modeA)}, ${x.nameB} ${mv(x.moveB, x.modeB)} (${x.streak}${x.streakUnit}째${x.change ? ', ' + x.change : ''})`));
  if (broken.length > max) L.push(`  외 ${broken.length - max}개는 앱 '엇갈림 감시'에서`);
  recovered.slice(0, 2).forEach(x => L.push(`• 회복: ${title(x)}`));
  return L;
}

export { WHY, readPairs, linkHealth, linkBlock, linkTelegram, summary, classify };
