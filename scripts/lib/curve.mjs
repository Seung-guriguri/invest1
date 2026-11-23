/* 원유 선물 기간 구조 (콘탱고·백워데이션) — 근월물 − N개월 뒤 월물
 *   Yahoo 는 거래 중인 개별 월물(CLF27.NYM 등)만 2년 이력을 주고, 만기가 지난 월물은 404.
 *   EIA 선물 시계열은 2024-04 에 끊겨 과거 이력으로 쓸 수 없음 → 최근 구간을 매일 계산해 이전 이력 뒤에 이어 붙임.
 *   날짜마다 '그날의 근월물'을 만기 규칙으로 정함 (연속 선물처럼 월물 교체일에 값이 튀지 않게, 같은 날 두 월물 가격만 비교) */
const DAY = 86400000;
const MONTH_CODE = 'FGHJKMNQUVXZ';
// 주말 + 날짜가 고정된 거래소 휴장일(1/1·7/4·12/25)만 반영 — 그 밖의 공휴일로 만기가 하루 당겨지는 경우는 드묾
const FIXED_HOLIDAYS = new Set(['01-01', '07-04', '12-25']);
const isWeekend = t => { const d = new Date(t), w = d.getUTCDay(); return w === 0 || w === 6 || FIXED_HOLIDAYS.has(d.toISOString().slice(5, 10)); };
const prevBiz = t => { do { t -= DAY; } while (isWeekend(t)); return t; };
const iso = t => new Date(t).toISOString().slice(0, 10);

/** 만기(마지막 거래일) — 영업일은 주말·고정 휴장일만 제외
 *  cl:    NYMEX WTI — 인도월 전달 25일(영업일이 아니면 그 전 영업일)에서 3영업일 전
 *  brent: NYMEX 브렌트(Last Day Financial) — 인도월 2개월 전 달의 마지막 영업일 */
function lastTrade(rule, y, m) {   // m: 0~11 (인도월)
  if (rule === 'cl') {
    let t = Date.UTC(y, m - 1, 25);
    if (isWeekend(t)) t = prevBiz(t);
    for (let k = 0; k < 3; k++) t = prevBiz(t);
    return iso(t);
  }
  if (rule === 'brent') {
    let t = Date.UTC(y, m - 1, 1);   // 인도월 2개월 전 달의 다음 달 1일
    t = prevBiz(t);
    return iso(t);
  }
  throw new Error(`알 수 없는 만기 규칙: ${rule}`);
}

const addMonths = ({ y, m }, k) => { const t = new Date(Date.UTC(y, m + k, 1)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() }; };

/** 그날의 근월물 (만기일 당일까지는 그 월물) */
function frontAt(rule, date) {
  const d = new Date(date + 'T00:00:00Z');
  let c = { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  while (lastTrade(rule, c.y, c.m) < date) c = addMonths(c, 1);
  return c;
}

const ticker = (root, suffix, { y, m }) => `${root}${MONTH_CODE[m]}${String(y).slice(2)}${suffix}`;

/** 받아야 할 월물 목록: 시작일의 근월물 ~ 오늘 근월물 + gap */
function contractsFor(rule, from, to, gap) {
  const out = []; let c = frontAt(rule, from); const end = addMonths(frontAt(rule, to), gap);
  while (c.y * 12 + c.m <= end.y * 12 + end.m) { out.push(c); c = addMonths(c, 1); }
  return out;
}

/** 월물별 종가 Map(ticker → Map(date → close)) 로 날짜별 스프레드 [date, 근월물 − gap개월 뒤 월물]
 *  두 월물 모두 그날 종가가 있을 때만 (만기 지난 월물이 404 여서 근월물 값이 없으면 그날은 비움) */
function curveSpread(rule, root, suffix, gap, closes, from) {
  const dates = [...new Set([...closes.values()].flatMap(m => [...m.keys()]))].filter(d => d >= from).sort();
  const out = [];
  for (const d of dates) {
    const f = frontAt(rule, d);
    const a = closes.get(ticker(root, suffix, f)), b = closes.get(ticker(root, suffix, addMonths(f, gap)));
    const va = a && a.get(d), vb = b && b.get(d);
    if (Number.isFinite(va) && Number.isFinite(vb)) out.push([d, Math.round((va - vb) * 1e4) / 1e4]);
  }
  return out;
}

/** 기간 구조 판정: +면 백워데이션(근월물이 비쌈), −면 콘탱고, ±flat 안이면 평탄 */
function curveState(v, flat = 0.5) {
  if (!Number.isFinite(v)) return null;
  return v > flat ? 'backwardation' : v < -flat ? 'contango' : 'flat';
}
const CURVE_LABEL = { backwardation: '백워데이션', contango: '콘탱고', flat: '평탄' };

export { lastTrade, frontAt, ticker, contractsFor, curveSpread, curveState, CURVE_LABEL, addMonths };
