/* 조합 지표 계산 (수집·AI 공용) — 재료마다 발표 주기·시차가 달라 '같은 기준일'을 맞추는 것이 핵심
 *   obs 는 [날짜(YYYY-MM-DD), 값] 오름차순 배열 */
const DAY = 86400000;
const r4 = v => Math.round(v * 1e4) / 1e4;

/** 그날 이전(포함) 가장 최근 관측치 [날짜, 값]. maxLagDays 보다 오래된 값이면 null (묵은 값을 최신처럼 쓰지 않게) */
function obsAsOf(obs, date, maxLagDays = Infinity) {
  let lo = 0, hi = obs.length - 1, found = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (obs[mid][0] <= date) { found = obs[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  if (!found) return null;
  return (Date.parse(date) - Date.parse(found[0])) / DAY <= maxLagDays ? found : null;
}

/** 금리 변동 분해: 미국 10년물 = 실질금리 + 기대인플레 (FRED 정의상 기대인플레 = 10년물 − 실질금리)
 *  두 금리가 모두 발표된 날짜만 쓰고(한쪽만 먼저 나온 날은 제외), 약 1개월 전 값도 같은 공통 날짜에서 가져옴.
 *  반환: [{ date, base, d10, dReal, dBei, driver }] — driver = dReal − dBei (+면 실질금리, −면 기대인플레가 더 움직임) */
function rateDecomp(us10y, real10y, days = 30) {
  const rm = new Map(real10y);
  const both = us10y.filter(([d]) => rm.has(d)).map(([d, v]) => [d, v, rm.get(d)]);
  const out = [];
  for (let i = 0, j = 0; i < both.length; i++) {
    const t = Date.parse(both[i][0]) - days * DAY;
    while (j + 1 < i && Date.parse(both[j + 1][0]) <= t) j++;
    const b = both[j];
    const gap = (Date.parse(both[i][0]) - Date.parse(b[0])) / DAY;
    if (j >= i || gap < days || gap > days + 7) continue;   // 기준 시점이 없거나 너무 멀면(자료 공백) 계산 안 함
    const d10 = both[i][1] - b[1], dReal = both[i][2] - b[2], dBei = d10 - dReal;
    out.push({ date: both[i][0], base: b[0], d10: r4(d10), dReal: r4(dReal), dBei: r4(dBei), driver: r4(dReal - dBei) });
  }
  return out;
}

/** 평년 대비 %: 같은 주 과거 5년 평균 대비 (화면·AI 의 평년 계산과 같은 규칙: 364일 간격, ±4일, 3년 이상) */
function seasonDevAt(obs, date, value) {
  const t = Date.parse(date), vals = [];
  for (let k = 1; k <= 5; k++) {
    const target = t - k * 364 * DAY;
    const e = obs.find(o => Math.abs(Date.parse(o[0]) - target) <= 4 * DAY);
    if (e) vals.push(e[1]);
  }
  if (vals.length < 3) return null;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return avg ? (value - avg) / Math.abs(avg) * 100 : null;
}

/** 석유 수급 빡빡함: 재고 지표들의 평년 대비 % 를 평균해 부호를 뒤집은 값 (+면 평년보다 부족)
 *  모든 재료가 같은 주(같은 날짜)에 값이 있을 때만 계산 — 하나라도 그 주 발표가 없으면 그 주는 건너뜀.
 *  반환: [{ date, score, devs: [재료별 평년 대비 %] }] */
function oilTightness(parts) {
  const maps = parts.map(p => new Map(p));
  const out = [];
  for (const [d] of parts[0]) {
    if (!maps.every(m => m.has(d))) continue;
    const devs = parts.map((p, i) => seasonDevAt(p, d, maps[i].get(d)));
    if (devs.some(x => x == null || !Number.isFinite(x))) continue;
    out.push({ date: d, score: r4(-devs.reduce((a, b) => a + b, 0) / devs.length), devs: devs.map(r4) });
  }
  return out;
}

/** 동일 비중 바스켓 지수 (시작 = 100): 모든 종목이 거래된 날짜만 써서 그날 수익률의 평균을 이어 붙임
 *  한 종목이라도 그날 값이 없으면(휴장·누락) 그날은 건너뛰고, 다음 공통 날짜에 그 사이 수익률을 한 번에 반영 */
function basketIndex(parts) {
  const maps = parts.map(p => new Map(p));
  const dates = parts[0].map(o => o[0]).filter(d => maps.every(m => m.has(d)));
  const out = []; let level = 100;
  for (let i = 0; i < dates.length; i++) {
    if (i > 0) {
      const rets = maps.map(m => { const a = m.get(dates[i - 1]), b = m.get(dates[i]); return a > 0 ? b / a - 1 : NaN; });
      if (rets.some(r => !Number.isFinite(r))) continue;
      level *= 1 + rets.reduce((a, b) => a + b, 0) / rets.length;
    }
    out.push([dates[i], r4(level)]);
  }
  return out;
}

/** 금의 실질금리 괴리 (%): 최근 span 거래일 금 수익률 중 실질금리 변화로 설명되지 않는 부분
 *  = 금 수익률 − β × 실질금리 변화. β 는 두 지표가 모두 있는 날짜의 일간 변화로 추정 (보통 음수: 실질금리↑ → 금↓)
 *  금(선물, 당일)과 실질금리(1~2일 늦게 발표)가 모두 있는 날짜만 사용 */
function goldRealGap(gold, real, span = 63, minPoints = 200) {
  const rm = new Map(real);
  const both = gold.filter(([d]) => rm.has(d)).map(([d, g]) => [d, g, rm.get(d)]);
  if (both.length < minPoints) return { beta: null, rows: [] };
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (let i = 1; i < both.length; i++) {
    if (!(both[i - 1][1] > 0)) continue;
    const y = (both[i][1] / both[i - 1][1] - 1) * 100, x = both[i][2] - both[i - 1][2];
    sx += x; sy += y; sxx += x * x; sxy += x * y; n++;
  }
  const varx = sxx - sx * sx / n;
  if (!(varx > 0)) return { beta: null, rows: [] };
  const beta = (sxy - sx * sy / n) / varx;
  const rows = [];
  for (let i = span; i < both.length; i++) {
    const b = both[i - span];
    if (!(b[1] > 0)) continue;
    const ret = (both[i][1] / b[1] - 1) * 100, dReal = both[i][2] - b[2];
    rows.push({ date: both[i][0], base: b[0], ret: r4(ret), dReal: r4(dReal), explained: r4(beta * dReal), gap: r4(ret - beta * dReal) });
  }
  return { beta: r4(beta), rows };
}

/** 전년 같은 시기 대비 %: 364일 전(±tol 일, 요일을 맞추려고 52주) 값과 비교. 그 시점 값이 없으면 계산 안 함 */
function yoySameWeek(obs, tol = 3) {
  const out = [];
  let j = 0;
  for (let i = 0; i < obs.length; i++) {
    const target = Date.parse(obs[i][0]) - 364 * DAY;
    while (j < i && Date.parse(obs[j][0]) < target - tol * DAY) j++;
    let best = null;
    for (let k = j; k < i && Date.parse(obs[k][0]) <= target + tol * DAY; k++) {
      const gap = Math.abs(Date.parse(obs[k][0]) - target);
      if (!best || gap < best[0]) best = [gap, obs[k][1]];
    }
    if (best && best[1]) out.push([obs[i][0], r4((obs[i][1] / best[1] - 1) * 100)]);
  }
  return out;
}

export { obsAsOf, rateDecomp, seasonDevAt, oilTightness, basketIndex, goldRealGap, yoySameWeek };
