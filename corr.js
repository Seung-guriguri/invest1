/* =====================================================================
 * corr.js — 지표 간 상관관계 (화면 계산 전용, 데이터 수집과 무관)
 *
 *   수준값이 아니라 '변화율'로 계산 — 둘 다 추세적으로 오르기만 해도 상관이 높게 나오는 착시를 피함
 *   주기 맞춤: 둘 다 일간·주간이면 주간(주 마지막 값), 하나라도 월간·분기면 월간(월 마지막 값)
 *   변화 방식: changeMode 'pct' 는 변화율(%), 나머지(금리·%p 지표)는 차이
 *   표본이 적으면 계산하지 않음 (null)
 *
 *   CORR.pair(A, B)       : 기간별 상관 + 선행·후행
 *   CORR.top(id, list)    : 이 지표와 같이(반대로) 움직이는 지표 순위
 *   CORR.overlay(A, B, n) : 겹친 차트용 — 같은 출발점(=100)으로 맞춘 두 선
 *   입력 A/B = { id, mode: 'pct'|'diff', freq: 'D'|'W'|'M'|'Q'|null, hist: [{date, value}] (어느 순서든) }
 * ===================================================================== */
(function (global) {
  'use strict';
  const DAY = 86400000;
  const MIN = { W: 20, M: 12 };                       // 기간별 최소 표본
  const WINDOWS = { W: [['3개월', 13], ['1년', 52], ['전체', Infinity]], M: [['1년', 12], ['3년', 36], ['전체', Infinity]] };
  const MAIN = { W: 52, M: 36 };                      // 순위에 쓰는 기간 (주간 1년 · 월간 3년)
  const LAGS = { W: 6, M: 3 };                     // 너무 긴 시차는 계절 주기와 겹쳐 착시가 생김

  const basisOf = (a, b) => (/^[MQ]$/.test(a.freq || '') || /^[MQ]$/.test(b.freq || '') ? 'M' : 'W');

  /** 기간 키: 주간 = 그 주 월요일 날짜, 월간 = YYYY-MM */
  function keyOf(date, basis) {
    if (basis === 'M') return date.slice(0, 7);
    const t = Date.parse(date.slice(0, 10) + 'T00:00:00Z'); if (!Number.isFinite(t)) return null;
    const dow = (new Date(t).getUTCDay() + 6) % 7;
    return new Date(t - dow * DAY).toISOString().slice(0, 10);
  }
  /** 기간별 마지막 값 → 오래된 순 [[key, value]] */
  function bucket(hist, basis) {
    const m = new Map();
    const asc = (hist || []).filter(e => e && Number.isFinite(e.value) && e.date).slice().sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    for (const e of asc) { const k = keyOf(e.date, basis); if (k) m.set(k, e.value); }
    return [...m.entries()];
  }
  /** 연속된 기간끼리의 변화 → Map(key → 변화). 기간이 비면(빠진 주·월) 그 변화는 건너뜀 */
  function changes(series, mode, basis) {
    const out = new Map();
    const next = k => {
      if (basis === 'M') { const [y, mo] = k.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; }
      return new Date(Date.parse(k + 'T00:00:00Z') + 7 * DAY).toISOString().slice(0, 10);
    };
    for (let i = 1; i < series.length; i++) {
      const [pk, pv] = series[i - 1], [k, v] = series[i];
      if (next(pk) !== k) continue;
      const c = mode === 'pct' ? (pv ? v / Math.abs(pv) - 1 : null) : v - pv;
      if (c != null && Number.isFinite(c)) out.set(k, c);
    }
    return out;
  }
  function pearson(xs, ys) {
    const n = xs.length; if (n < 3) return null;
    let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; } mx /= n; my /= n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
  }

  const cache = new Map();   // 같은 화면 그리기 안에서 반복 계산 방지 (id·기준·최신일로 구분)
  function prep(s, basis) {
    const last = (s.hist || []).reduce((m, e) => (e.date > m ? e.date : m), '');
    const ck = `${s.id}|${basis}|${s.mode}|${last}|${(s.hist || []).length}`;
    if (!cache.has(ck)) { if (cache.size > 600) cache.clear(); const ser = bucket(s.hist, basis); cache.set(ck, { ser, chg: changes(ser, s.mode, basis) }); }
    return cache.get(ck);
  }

  /** 공통 기간의 변화 짝 (최근 count 개, lag: B 를 lag 기간 뒤로 — lag>0 이면 A 가 먼저) */
  function aligned(ca, cb, count, lag = 0) {
    const keys = [...ca.keys()];
    const kb = [...cb.keys()], idxB = new Map(kb.map((k, i) => [k, i]));
    // B 의 키 순서로 lag 만큼 이동: A 의 k 시점 ↔ B 의 (k 다음 lag 번째 기간)
    const shift = (k) => {
      if (!lag) return cb.has(k) ? k : null;
      const i = idxB.get(k); if (i == null) return null;
      const j = kb[i + lag]; return j || null;
    };
    const xs = [], ys = [];
    for (const k of keys) { const kk = shift(k); if (kk != null && cb.has(kk)) { xs.push(ca.get(k)); ys.push(cb.get(kk)); } }
    const from = Number.isFinite(count) ? Math.max(0, xs.length - count) : 0;
    return { xs: xs.slice(from), ys: ys.slice(from) };
  }

  /** 두 지표 비교 */
  function pair(A, B) {
    const basis = basisOf(A, B), pa = prep(A, basis), pb = prep(B, basis);
    const windows = WINDOWS[basis].map(([label, count]) => {
      const { xs, ys } = aligned(pa.chg, pb.chg, count);
      const enough = xs.length >= Math.min(MIN[basis], Number.isFinite(count) ? count - 1 : MIN[basis]);
      return { label, n: xs.length, r: enough ? pearson(xs, ys) : null };
    });
    // 선행·후행: 순위 기간 안에서 시차별 상관, 동시 상관보다 뚜렷하게 높을 때만
    let lead = null;
    const r0 = (() => { const { xs, ys } = aligned(pa.chg, pb.chg, MAIN[basis]); return xs.length >= MIN[basis] ? pearson(xs, ys) : null; })();
    if (r0 != null) {
      let best = null;
      for (let k = -LAGS[basis]; k <= LAGS[basis]; k++) {
        if (!k) continue;
        const { xs, ys } = k > 0 ? aligned(pa.chg, pb.chg, MAIN[basis], k) : (() => { const t = aligned(pb.chg, pa.chg, MAIN[basis], -k); return { xs: t.ys, ys: t.xs }; })();
        if (xs.length < MIN[basis]) continue;
        const r = pearson(xs, ys);
        if (r != null && (!best || Math.abs(r) > Math.abs(best.r))) best = { lag: k, r, n: xs.length };
      }
      if (best && Math.abs(best.r) >= 0.3 && Math.abs(best.r) >= Math.abs(r0) + 0.1) lead = best;
    }
    return { basis, unit: basis === 'M' ? '개월' : '주', windows, r: r0, lead };
  }

  /** 순위: list = [{id, mode, freq, hist}] (자기 자신 포함 가능) */
  function top(id, list, nPos = 5, nNeg = 3) {
    const me = list.find(s => s.id === id); if (!me) return { pos: [], neg: [], checked: 0 };
    const res = [];
    for (const s of list) {
      if (s.id === id || !s.hist || s.hist.length < 10) continue;
      const basis = basisOf(me, s), pa = prep(me, basis), pb = prep(s, basis);
      const { xs, ys } = aligned(pa.chg, pb.chg, MAIN[basis]);
      if (xs.length < MIN[basis]) continue;
      const r = pearson(xs, ys);
      if (r != null) res.push({ id: s.id, r, n: xs.length, basis });
    }
    const pos = res.filter(x => x.r >= 0.3).sort((a, b) => b.r - a.r).slice(0, nPos);
    const neg = res.filter(x => x.r <= -0.2).sort((a, b) => a.r - b.r).slice(0, nNeg);
    return { pos, neg, checked: res.length };
  }

  /** 겹친 차트: 공통 기간 최근 count 개, 첫 값 = 100 (수준이 0 근처·음수인 지표는 차이를 누적) */
  function overlay(A, B, count) {
    const basis = basisOf(A, B), pa = prep(A, basis), pb = prep(B, basis);
    const mb = new Map(pb.ser);
    let rows = pa.ser.filter(([k]) => mb.has(k)).map(([k, v]) => [k, v, mb.get(k)]);
    if (Number.isFinite(count)) rows = rows.slice(-count);
    if (rows.length < 2) return null;
    const norm = (vals, mode) => {
      const b = vals[0];
      if (mode === 'pct' && b > 0 && vals.every(v => v > 0)) return vals.map(v => v / b * 100);
      const sd = Math.sqrt(vals.reduce((s, v) => s + (v - b) ** 2, 0) / vals.length) || 1;   // 차이 지표: 표준편차 단위로 100 주변
      return vals.map(v => 100 + (v - b) / sd * 10);
    };
    return { basis, keys: rows.map(r => r[0]), a: norm(rows.map(r => r[1]), A.mode), b: norm(rows.map(r => r[2]), B.mode) };
  }

  /** 상관 강도 말 */
  function strength(r) {
    const x = Math.abs(r);
    const w = x >= 0.7 ? '강하게' : x >= 0.4 ? '어느 정도' : x >= 0.2 ? '약하게' : '거의 무관하게';
    return x < 0.2 ? w + ' 움직임' : `${w} ${r > 0 ? '같은 방향' : '반대 방향'}`;
  }

  global.CORR = { pair, top, overlay, strength, bucket, changes, pearson, keyOf, MIN };
})(typeof window !== 'undefined' ? window : globalThis);
