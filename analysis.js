/* =====================================================================
 * analysis.js — 산업별 분석 모듈 · 관계 카탈로그 · 산업별 경고 규칙
 *
 *   ANALYSIS.modules  : 원유·정제제품 / 천연가스·LNG / 해운 — 수급 표(가격·공급·수요·재고), 지역 가격차,
 *                       핵심 관측(근거 지표 포함), 데이터 한계·확보 필요 목록
 *   ANALYSIS.relations: 지표 사이 관계와 그 근거 유형
 *                       calc 계산된 파생 지표 · direct 직접 측정 · stat 통계적 관계(상관 — 인과 아님)
 *                       hypothesis 경제적 가설 · proxy 검증되지 않은 대용 관계
 *   ANALYSIS.rules    : 산업별 경고 규칙 — 발생 조건 · 해제 조건 · 근거 지표 · 반대 증거 · 데이터 품질 조건
 *                       mode 'shadow' = 시험 운영 (화면에만 표시, 텔레그램 경고로 보내지 않음)
 *
 * 입력은 index.html 의 analyze() 결과 묶음 R (지표 id → 분석 결과). 계산은 모두 이 파일의 코드가 하고,
 * 데이터가 없으면 수치를 만들지 않고 '데이터 없음'으로 둔다. Node 테스트에서도 그대로 불러 씀.
 * ===================================================================== */
(function (global) {
  'use strict';
  const DAY = 86400000;

  /* ---------- R 위 계산 도우미 ---------- */
  function makeCtx(R) {
    const A = id => (R && R[id]) || null;
    const has = id => { const a = A(id); return !!(a && a.cur && a.value != null && Number.isFinite(a.value)); };
    const v = id => (has(id) ? A(id).value : null);
    const hist = id => (A(id) && A(id).history) || [];           // 최신이 앞 (내림차순)
    /** days 일 전 관측치 (tol 일 이내에 없으면 null) */
    const at = (id, days, tol) => {
      const h = hist(id); if (!h.length) return null;
      const t = Date.parse(h[0].date) - days * DAY;
      let best = null, gap = Infinity;
      for (let i = 1; i < h.length; i++) {
        const g = Math.abs(Date.parse(h[i].date) - t) / DAY;
        if (g < gap) { gap = g; best = h[i]; }
        if (Date.parse(h[i].date) < t - (tol + 1) * DAY) break;
      }
      return best && gap <= tol ? best : null;
    };
    const diff = (id, base) => {
      if (!has(id) || !base) return null;
      const now = v(id), b = base.value;
      return { abs: now - b, pct: b ? (now - b) / Math.abs(b) * 100 : null, from: base.date };
    };
    const freq = id => (A(id) && A(id).freq) || null;
    /** 직전 비교: 주간·월간 지표는 직전 관측치, 일간은 7일 전 */
    const wk = id => { const f = freq(id); if (f === 'W' || f === 'M' || f === 'Q') return diff(id, hist(id)[1] || null); return diff(id, at(id, 7, 3)); };
    const yoy = id => diff(id, at(id, 365, freq(id) === 'M' ? 20 : 10));
    const m1 = id => diff(id, at(id, 30, 6));
    const season = id => { const a = A(id); return a && a.season ? a.season.dev : null; };
    const pos = id => { const a = A(id); return a && a.pctl ? a.pctl.rank : null; };
    const quality = id => { const a = A(id); return a && a.quality ? a.quality.code : 'missing'; };
    const date = id => (has(id) ? A(id).cur.date : null);
    const ind = id => (A(id) && A(id).ind) || { id, name: id, unit: '', dp: 2 };
    const month = () => new Date().getMonth() + 1;
    /** 아시아−유럽 LNG 가격차 ($/MMBtu) = JKM − TTF(€/MWh)×유로/달러÷3.412 — 같은 날 기준이 없으면 계산하지 않음 */
    const jkmTtf = (days = 0) => {
      const pick = (id) => (days ? at(id, days, 4) : (has(id) ? { date: date(id), value: v(id) } : null));
      const j = pick('jkm'), t = pick('ttf'), fx = pick('eurusd');
      if (!j || !t || !fx) return null;
      return { value: j.value - t.value * fx.value / 3.412, date: j.date < t.date ? j.date : t.date };
    };
    return { A, has, v, hist, at, wk, yoy, m1, season, pos, quality, date, ind, month, jkmTtf };
  }

  /* ---------- 분석 모듈 ----------
   * rows: [그룹명, [지표 id ...]]  (카드와 같은 지표 id → 누르면 상세)
   * observe(c): 핵심 관측 [{ text, ids, tone: 'tight'|'loose'|'neutral' }] — 데이터가 있을 때만 문장 생성
   * gaps: 지금 무료 데이터로 볼 수 없는 것 (수치를 만들지 않고 '데이터 확보 필요'로 명시) */
  const fmt1 = x => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(1);

  const MODULES = [
    {
      id: 'crude', title: '원유·정제제품', icon: '🛢',
      rows: [
        ['가격·지역 가격차', ['wti', 'brent', 'brent_wti', 'gasoline', 'diesel']],
        ['정제 마진', ['crack321', 'refinery_util']],
        ['공급', ['us_crude_prod', 'crude_net_imports']],
        ['수요 (미국 제품 공급량, 4주 평균)', ['gasoline_demand', 'distill_demand']],
        ['재고', ['us_crude', 'cushing', 'us_gasoline', 'us_distill', 'us_spr', 'us_crude_total', 'eu_oil_stock']]
      ],
      observe(c) {
        const out = [];
        const inv = [['us_crude', '원유'], ['us_gasoline', '휘발유'], ['us_distill', '디젤·난방유']]
          .filter(([id]) => c.season(id) != null).map(([id, n]) => ({ id, n, d: c.season(id) }));
        if (inv.length) {
          const low = inv.filter(x => x.d <= -3), high = inv.filter(x => x.d >= 3);
          out.push({ ids: inv.map(x => x.id), tone: low.length > high.length ? 'tight' : high.length > low.length ? 'loose' : 'neutral',
            text: `미국 재고 (같은 주 5년 평균 대비): ${inv.map(x => `${x.n} ${fmt1(x.d)}%`).join(' · ')}` });
        }
        if (c.has('crack321')) {
          const p = c.pos('crack321');
          out.push({ ids: ['crack321'], tone: p != null && p >= 80 ? 'tight' : p != null && p <= 20 ? 'loose' : 'neutral',
            text: `정제 마진(3-2-1) ${c.v('crack321').toFixed(1)}$/배럴${p != null ? ` — 최근 분포 상위 ${Math.round(100 - p)}%` : ''}` });
        }
        if (c.has('refinery_util')) {
          const w = c.wk('refinery_util');
          out.push({ ids: ['refinery_util'], tone: c.v('refinery_util') < 85 ? 'tight' : 'neutral',
            text: `정제 가동률 ${c.v('refinery_util').toFixed(1)}%${w ? ` (전주 ${fmt1(w.abs)}%p)` : ''}${[2, 3, 4, 9, 10].includes(c.month()) ? ' — 정기 정비 시즌' : ''}` });
        }
        const d = c.yoy('distill_demand'), g = c.yoy('gasoline_demand');
        if (d || g) out.push({ ids: ['gasoline_demand', 'distill_demand'], tone: 'neutral',
          text: `수요(전년 대비): ${g ? `휘발유 ${fmt1(g.pct)}%` : '휘발유 데이터 없음'} · ${d ? `디젤 ${fmt1(d.pct)}%` : '디젤 데이터 없음'}` });
        if (c.has('brent_wti')) out.push({ ids: ['brent_wti', 'crude_net_imports'], tone: 'neutral',
          text: `브렌트−WTI ${c.v('brent_wti').toFixed(2)}$ — 벌어질수록 미국산 원유 수출 유인↑ (가설)` });
        return out;
      },
      gaps: ['전 세계·OPEC 국가별 생산량 (무료 일간·주간 API 없음)', '중국·인도 원유 수입량 (월간 통관 통계, 자동 수집 안 됨)',
        'OECD·전 세계 상업 재고 (IEA 월간, 유료·지연)', '제품별 수출입 상세 (EIA 주간 세부 항목 — 추가 가능)']
    },
    {
      id: 'gas', title: '천연가스·LNG', icon: '🔥',
      rows: [
        ['가격', ['natgas', 'ttf', 'jkm']],
        ['지역 가격차', ['lng_spread', '$jkm_ttf']],
        ['재고', ['ng_storage']],
        ['발전 수요 (미국)', ['power_gas', 'power_coal', 'nuclear_util']],
        ['발전 수요 (수입국, 월간)', ['gas_pw_eu', 'gas_pw_jpn', 'gas_pw_kor', 'gas_pw_chn']]
      ],
      observe(c) {
        const out = [];
        if (c.season('ng_storage') != null) {
          const d = c.season('ng_storage');
          out.push({ ids: ['ng_storage'], tone: d <= -5 ? 'tight' : d >= 5 ? 'loose' : 'neutral', text: `미국 가스 저장량 같은 주 5년 평균 대비 ${fmt1(d)}%${[10, 11].includes(c.month()) ? ' — 겨울 인출 시즌 직전' : ''}` });
        }
        const s = c.jkmTtf();
        if (s) out.push({ ids: ['jkm', 'ttf', 'eurusd'], tone: s.value >= 1.5 ? 'tight' : 'neutral',
          text: `아시아(JKM)−유럽(TTF) 가격차 ${s.value.toFixed(2)}$/MMBtu — 플러스면 LNG 화물이 아시아로 향할 유인 (계산)` });
        if (c.has('lng_spread')) out.push({ ids: ['lng_spread'], tone: 'neutral', text: `미국 LNG 수출 마진(TTF−헨리허브) ${c.v('lng_spread').toFixed(2)}$/MMBtu` });
        if (c.has('power_gas')) {
          const w = c.wk('power_gas');
          out.push({ ids: ['power_gas', 'nuclear_util'], tone: 'neutral',
            text: `미국 가스 발전 비중 ${c.v('power_gas').toFixed(1)}%${w ? ` (1주 ${fmt1(w.abs)}%p)` : ''}${c.has('nuclear_util') ? ` · 원전 가동률 ${c.v('nuclear_util').toFixed(1)}%` : ''}` });
        }
        const eu = c.yoy('gas_pw_eu');
        if (eu) out.push({ ids: ['gas_pw_eu'], tone: eu.abs > 2 ? 'tight' : eu.abs < -2 ? 'loose' : 'neutral', text: `EU 가스 발전 비중 전년 같은 달 대비 ${fmt1(eu.abs)}%p` });
        return out;
      },
      gaps: ['미국 LNG 수출량 (EIA 월간 — 추가 가능, 주간은 유료)', '유럽 가스 저장률 (AGSI 무료 API — 추가 가능)',
        'LNG 스팟 운임 (Spark 등 유료)', '중국·일본·한국 LNG 수입량 (월간 통관 통계)']
    },
    {
      id: 'ship', title: '해운', icon: '🚢',
      rows: [
        ['유조선 (대용)', ['tanker_fro', 'tanker_stng', 'etf_bwet']],
        ['유조선 수요 동인', ['brent_wti', 'crude_net_imports', 'us_crude_prod']],
        ['벌크 (대용)', ['bdry']],
        ['벌크 수요 동인', ['iron_ore', 'coal', 'coal_pw_chn', 'coal_pw_ind', 'soybean']],
        ['LNG선 (대용)', ['lng_flng']],
        ['LNG선 수요 동인', ['lng_spread', '$jkm_ttf']],
        ['컨테이너·운임 물가', ['scfi', 'freight_ppi']]
      ],
      observe(c) {
        const out = [];
        const tk = ['tanker_fro', 'tanker_stng', 'etf_bwet'].filter(id => c.m1(id));
        if (tk.length) out.push({ ids: tk, tone: 'neutral', text: `유조선 대용 1개월: ${tk.map(id => `${c.ind(id).name.split(' (')[0]} ${fmt1(c.m1(id).pct)}%`).join(' · ')} — 실제 운임 지수 아님` });
        if (c.m1('bdry')) out.push({ ids: ['bdry', 'iron_ore'], tone: c.m1('bdry').pct >= 10 ? 'tight' : c.m1('bdry').pct <= -10 ? 'loose' : 'neutral',
          text: `벌크 대용(BDRY) 1개월 ${fmt1(c.m1('bdry').pct)}%${c.m1('iron_ore') ? ` · 철광석 ${fmt1(c.m1('iron_ore').pct)}%` : ''}` });
        if (c.m1('lng_flng')) out.push({ ids: ['lng_flng', 'lng_spread'], tone: 'neutral', text: `LNG선 대용(FLNG) 1개월 ${fmt1(c.m1('lng_flng').pct)}%` });
        if (!c.has('scfi')) out.push({ ids: ['scfi'], tone: 'neutral', text: '컨테이너 운임(SCFI): 자동 데이터 없음 — 직접 입력해야 분석에 포함' });
        return out;
      },
      gaps: ['발틱 운임지수 원지수 (BDI·BDTI·BCTI, 유료)', 'VLCC TD3C·LNG 스팟 운임 원지수 (유료)', '선복량·선대 가동률·신조 발주 (유료)',
        '항만 물동량·중국 수입 통계 (월간, 자동 수집 안 됨)', '컨테이너 운임 SCFI·WCI (무료 API 없음 → 직접 입력)']
    }
  ];

  /* ---------- 관계 카탈로그 ---------- */
  const REL_TYPES = {
    calc: { label: '계산된 파생 지표', note: '공식으로 정의 — 재료 값이 맞으면 항상 성립' },
    direct: { label: '직접 측정', note: '같은 기관이 직접 측정해 발표하는 관계' },
    stat: { label: '통계적 관계', note: '과거 같이 움직인 정도(상관) — 인과관계가 아님' },
    hypothesis: { label: '경제적 가설', note: '경제 논리상 예상되는 연결 — 항상 맞지 않음' },
    proxy: { label: '검증되지 않은 대용', note: '직접 데이터가 없어 대신 보는 값 — 실제 지표와 다를 수 있음' }
  };
  const RELATIONS = [
    // 계산
    { id: 'r-crack', sector: 'crude', type: 'calc', from: ['gasoline', 'diesel', 'wti'], to: ['crack321'], text: '3-2-1 크랙 스프레드 = (휘발유×42×2 + 디젤×42 − WTI×3) ÷ 3', limit: '미국 걸프·뉴욕 선물 기준, 실제 정유사 마진과 다름' },
    { id: 'r-bw', sector: 'crude', type: 'calc', from: ['brent', 'wti'], to: ['brent_wti'], text: '브렌트−WTI = 국제 유가 − 미국 유가', limit: '선물 근월물 만기 차이 반영 안 함' },
    { id: 'r-total', sector: 'crude', type: 'calc', from: ['us_crude', 'us_spr'], to: ['us_crude_total'], text: '미국 원유 총재고 = 상업 재고 + 전략비축유' },
    { id: 'r-lng', sector: 'gas', type: 'calc', from: ['ttf', 'eurusd', 'natgas'], to: ['lng_spread'], text: 'LNG 수출 마진 = TTF(€/MWh)×유로/달러÷3.412 − 헨리허브', limit: '액화·운송비(대략 3~5$/MMBtu) 미반영' },
    { id: 'r-jt', sector: 'gas', type: 'calc', from: ['jkm', 'ttf', 'eurusd'], to: ['$jkm_ttf'], text: '아시아−유럽 가격차 = JKM − TTF($ 환산)', limit: '분석 화면에서만 계산, 운송 거리 차이 미반영' },
    // 직접 측정
    { id: 'r-util', sector: 'crude', type: 'direct', from: ['refinery_util'], to: ['distill_demand', 'gasoline_demand'], text: '정제 가동률·제품 공급량은 같은 EIA 주간 석유 보고서의 실측치', limit: '제품 공급량은 실제 소비가 아닌 출하 기준' },
    { id: 'r-grid', sector: 'gas', type: 'direct', from: ['power_gas', 'power_coal'], to: ['natgas'], text: '발전원별 발전량은 EIA-930 전력망 실측 — 가스 발전 비중은 발전용 가스 수요의 직접 척도', limit: '발전 효율·총 발전량 변화는 따로 봐야 함' },
    // 통계적 관계 (상관 — 화면에서 최근 1년 주간 변화율로 계산)
    { id: 's-fro-bwet', sector: 'ship', type: 'stat', pair: ['tanker_fro', 'etf_bwet'], text: '유조선사 주가(FRO) ↔ 유조선 운임 선물 ETF(BWET)', limit: '상관 — 인과 아님, 주가는 시장 전체 영향도 받음' },
    { id: 's-bdry-ore', sector: 'ship', type: 'stat', pair: ['bdry', 'iron_ore'], text: '벌크 운임 ETF(BDRY) ↔ 철광석 가격', limit: '상관 — 인과 아님' },
    { id: 's-hh-ung', sector: 'gas', type: 'stat', pair: ['natgas', 'etf_ung'], text: '헨리허브 선물 ↔ 천연가스 ETF(UNG)', limit: 'ETF 는 선물 교체 비용으로 장기 괴리' },
    { id: 's-wti-xle', sector: 'crude', type: 'stat', pair: ['wti', 'etf_xle'], text: 'WTI ↔ 에너지 업종 ETF(XLE)', limit: '상관 — 인과 아님' },
    // 경제적 가설
    { id: 'h-util-crack', sector: 'crude', type: 'hypothesis', from: ['refinery_util'], to: ['crack321'], text: '정제 가동률 하락 → 제품 공급 감소 → 정제 마진 확대' },
    { id: 'h-distill', sector: 'crude', type: 'hypothesis', from: ['us_distill'], to: ['diesel', 'crack321'], text: '디젤 재고가 평년보다 적음 → 디젤값·정제 마진 상승 압력' },
    { id: 'h-bw-exp', sector: 'crude', type: 'hypothesis', from: ['brent_wti'], to: ['crude_net_imports', 'tanker_fro'], text: '브렌트−WTI 확대 → 미국 원유 수출 증가(순수입 감소) → 장거리 유조선 수요' },
    { id: 'h-storage', sector: 'gas', type: 'hypothesis', from: ['ng_storage'], to: ['natgas'], text: '가스 저장량이 평년보다 적음 → 겨울철 가격 상승 위험' },
    { id: 'h-nuke', sector: 'gas', type: 'hypothesis', from: ['nuclear_util'], to: ['power_gas', 'natgas'], text: '원전 가동률 하락 → 가스 발전이 메움 → 발전용 가스 수요 증가' },
    { id: 'h-jt', sector: 'gas', type: 'hypothesis', from: ['$jkm_ttf'], to: ['lng_flng'], text: '아시아 가격 우위 → 미국 LNG 아시아행 → 운항 거리↑, LNG선 수요↑' },
    { id: 'h-asia-coal', sector: 'ship', type: 'hypothesis', from: ['coal_pw_chn', 'coal_pw_ind'], to: ['coal', 'bdry'], text: '중국·인도 석탄 발전 확대 → 열탄 수입 → 석탄값·벌크 운임' },
    { id: 'h-ore', sector: 'ship', type: 'hypothesis', from: ['iron_ore'], to: ['bdry'], text: '철광석 수요(중국 철강) → 케이프사이즈 물동량 → 벌크 운임' },
    // 대용
    { id: 'p-bdry', sector: 'ship', type: 'proxy', from: ['bdry'], to: [], text: 'BDRY ETF(운임 선물) → 발틱건화물지수(BDI) 대용', limit: '선물 만기 구조 때문에 지수와 다르게 움직일 수 있음' },
    { id: 'p-fro', sector: 'ship', type: 'proxy', from: ['tanker_fro'], to: [], text: 'Frontline 주가 → VLCC 운임 대용', limit: '주가는 배당·금리·시장 전체 영향' },
    { id: 'p-stng', sector: 'ship', type: 'proxy', from: ['tanker_stng'], to: [], text: 'Scorpio Tankers 주가 → 석유제품선(MR·LR2) 운임 대용', limit: '〃' },
    { id: 'p-flng', sector: 'ship', type: 'proxy', from: ['lng_flng'], to: [], text: 'Flex LNG 주가 → LNG선 업황 대용', limit: '장기 용선 비중이 높아 스팟 운임과 괴리 큼' },
    { id: 'p-bwet', sector: 'ship', type: 'proxy', from: ['etf_bwet'], to: [], text: 'BWET(운임 선물 ETF) → VLCC TD3C·수에즈막스 운임 대용', limit: '선물 기준, 현물 운임과 다름' }
  ];

  /** 주간 변화율 상관계수 (최근 52주, 같은 주끼리) — 8주 미만이면 계산 안 함 */
  function weeklyCorr(c, a, b) {
    const wk = id => {
      const h = c.hist(id).slice().reverse(); if (h.length < 10) return new Map();
      const m = new Map(); let last = null;
      for (const e of h) { const d = new Date(e.date); const key = `${d.getUTCFullYear()}-${Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / (7 * DAY))}`; m.set(key, e.value); last = key; }
      const keys = [...m.keys()].slice(-53), r = new Map();
      for (let i = 1; i < keys.length; i++) { const p = m.get(keys[i - 1]), n = m.get(keys[i]); if (p) r.set(keys[i], n / p - 1); }
      return r;
    };
    const x = wk(a), y = wk(b), ks = [...x.keys()].filter(k => y.has(k));
    if (ks.length < 8) return null;
    const xs = ks.map(k => x.get(k)), ys = ks.map(k => y.get(k));
    const mean = arr => arr.reduce((s, t) => s + t, 0) / arr.length, mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < ks.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    if (!sxx || !syy) return null;
    return { r: sxy / Math.sqrt(sxx * syy), n: ks.length };
  }

  /* ---------- 산업별 경고 규칙 ----------
   * trigger: 발생 조건 / clear: 해제 조건 (발생과 해제 사이 = '경계' — 들락날락 방지)
   * evidence: 근거 지표 (하나라도 품질이 정상이 아니면 '판단 보류')
   * counter(c): 지금 보이는 반대 증거 문장들
   * mode: 'shadow' 시험 운영 — 과거 데이터 검증 전이라 화면에만 표시, 텔레그램으로 보내지 않음 */
  const RULES = [
    { id: 'crude-distill-tight', sector: 'crude', mode: 'shadow', title: '디젤·난방유 재고 부족',
      evidence: ['us_distill'], triggerText: '디젤 재고가 같은 주 5년 평균보다 10% 이상 적음', clearText: '평균 대비 −6% 이상으로 회복',
      trigger: c => c.season('us_distill') != null && c.season('us_distill') <= -10,
      clear: c => c.season('us_distill') != null && c.season('us_distill') >= -6,
      counter: c => [
        c.yoy('distill_demand') && c.yoy('distill_demand').pct < 0 ? `디젤 수요(4주 평균)가 전년보다 ${fmt1(c.yoy('distill_demand').pct)}% — 수요 약함` : null,
        c.has('refinery_util') && c.v('refinery_util') >= 92 ? `정제 가동률 ${c.v('refinery_util').toFixed(1)}% — 공급 회복 중` : null] },
    { id: 'crude-stock-draw', sector: 'crude', mode: 'shadow', title: '미국 원유 재고 빠듯',
      evidence: ['us_crude'], triggerText: '상업 원유 재고가 5년 평균보다 5% 이상 적고 이번 주도 감소', clearText: '평균 대비 −2% 이상',
      trigger: c => c.season('us_crude') != null && c.season('us_crude') <= -5 && c.wk('us_crude') && c.wk('us_crude').abs < 0,
      clear: c => c.season('us_crude') != null && c.season('us_crude') >= -2,
      counter: c => [
        c.yoy('us_crude_prod') && c.yoy('us_crude_prod').pct > 0 ? `미국 원유 생산 전년 대비 ${fmt1(c.yoy('us_crude_prod').pct)}%` : null,
        c.wk('crude_net_imports') && c.wk('crude_net_imports').abs > 0 ? '원유 순수입 증가' : null] },
    { id: 'crude-crack-high', sector: 'crude', mode: 'shadow', title: '정제 마진 고점권',
      evidence: ['crack321'], triggerText: '3-2-1 크랙 스프레드가 최근 분포 상위 10%', clearText: '상위 25% 밖으로',
      trigger: c => c.pos('crack321') != null && c.pos('crack321') >= 90,
      clear: c => c.pos('crack321') != null && c.pos('crack321') <= 75,
      counter: c => [
        c.has('refinery_util') && c.v('refinery_util') >= 92 ? '정제 가동률이 높아 공급이 늘고 있음' : null,
        c.yoy('gasoline_demand') && c.yoy('gasoline_demand').pct < 0 ? '휘발유 수요가 전년보다 약함' : null] },
    { id: 'crude-refinery-outage', sector: 'crude', mode: 'shadow', title: '정제 설비 차질',
      evidence: ['refinery_util'], triggerText: '정제 가동률 85% 미만', clearText: '88% 이상 회복',
      trigger: c => c.has('refinery_util') && c.v('refinery_util') < 85,
      clear: c => c.has('refinery_util') && c.v('refinery_util') >= 88,
      counter: c => [[2, 3, 4, 9, 10].includes(c.month()) ? '정기 정비 시즌 — 계획된 하락일 수 있음' : null] },
    { id: 'gas-storage-low', sector: 'gas', mode: 'shadow', title: '가스 저장량 부족',
      evidence: ['ng_storage'], triggerText: '저장량이 같은 주 5년 평균보다 7% 이상 적음', clearText: '평균 대비 −3% 이상',
      trigger: c => c.season('ng_storage') != null && c.season('ng_storage') <= -7,
      clear: c => c.season('ng_storage') != null && c.season('ng_storage') >= -3,
      counter: c => [
        c.m1('natgas') && c.m1('natgas').pct < 0 ? `헨리허브가 한 달 새 ${fmt1(c.m1('natgas').pct)}% — 시장이 부족을 크게 보지 않음` : null,
        c.wk('power_gas') && c.wk('power_gas').abs < 0 ? '가스 발전 비중 감소 중' : null] },
    { id: 'gas-asia-premium', sector: 'gas', mode: 'shadow', title: '아시아 LNG 프리미엄',
      evidence: ['jkm', 'ttf', 'eurusd'], triggerText: 'JKM−TTF 가격차 2$/MMBtu 이상', clearText: '0.5$ 이하',
      trigger: c => { const s = c.jkmTtf(); return !!s && s.value >= 2; },
      clear: c => { const s = c.jkmTtf(); return !!s && s.value <= 0.5; },
      counter: c => [
        c.yoy('gas_pw_jpn') && c.yoy('gas_pw_jpn').abs < 0 ? '일본 가스 발전 비중이 전년보다 낮음' : null,
        c.yoy('gas_pw_kor') && c.yoy('gas_pw_kor').abs < 0 ? '한국 가스 발전 비중이 전년보다 낮음' : null] },
    { id: 'gas-us-export-pull', sector: 'gas', mode: 'shadow', title: '미국 LNG 수출 유인 확대',
      evidence: ['lng_spread'], triggerText: 'LNG 수출 마진이 최근 분포 상위 15%', clearText: '상위 40% 밖으로',
      trigger: c => c.pos('lng_spread') != null && c.pos('lng_spread') >= 85,
      clear: c => c.pos('lng_spread') != null && c.pos('lng_spread') <= 60,
      counter: c => [c.m1('natgas') && c.m1('natgas').pct > 10 ? '헨리허브 급등 — 마진을 깎는 중' : null] },
    { id: 'gas-nuclear-gap', sector: 'gas', mode: 'shadow', title: '원전 공백 → 가스 발전 수요',
      evidence: ['nuclear_util', 'power_gas'], triggerText: '원전 가동률 85% 미만이고 가스 발전 비중 증가', clearText: '원전 가동률 90% 이상',
      trigger: c => c.has('nuclear_util') && c.v('nuclear_util') < 85 && c.wk('power_gas') && c.wk('power_gas').abs > 0,
      clear: c => c.has('nuclear_util') && c.v('nuclear_util') >= 90,
      counter: c => [[3, 4, 5, 9, 10, 11].includes(c.month()) ? '원전 정비 시즌 — 냉난방 수요가 적은 시기라 영향 제한적' : null] },
    { id: 'ship-tanker-surge', sector: 'ship', mode: 'shadow', title: '유조선 운임 대용 급등',
      evidence: ['etf_bwet'], triggerText: 'BWET 한 달 +15% 이상', clearText: '한 달 +5% 이하',
      trigger: c => !!c.m1('etf_bwet') && c.m1('etf_bwet').pct >= 15,
      clear: c => !!c.m1('etf_bwet') && c.m1('etf_bwet').pct <= 5,
      counter: c => [
        c.has('brent_wti') && c.v('brent_wti') < 3 ? '브렌트−WTI가 좁아 장거리 차익 거래 유인 작음' : null,
        c.m1('tanker_fro') && c.m1('tanker_fro').pct < 0 ? '유조선사 주가는 하락 — 시장이 지속성을 의심' : null] },
    { id: 'ship-bulk-weak', sector: 'ship', mode: 'shadow', title: '벌크 수요 약화',
      evidence: ['bdry', 'iron_ore'], triggerText: 'BDRY 한 달 −15% 이하이고 철광석도 하락', clearText: 'BDRY 한 달 −5% 이상',
      trigger: c => !!c.m1('bdry') && c.m1('bdry').pct <= -15 && !!c.m1('iron_ore') && c.m1('iron_ore').pct < 0,
      clear: c => !!c.m1('bdry') && c.m1('bdry').pct >= -5,
      counter: c => [c.yoy('coal_pw_chn') && c.yoy('coal_pw_chn').abs > 0 ? '중국 석탄 발전 비중은 전년보다 높음 — 석탄 물동량 지지' : null] },
    { id: 'ship-lng-pull', sector: 'ship', mode: 'shadow', title: 'LNG선 수요 우호',
      evidence: ['lng_spread'], triggerText: 'LNG 수출 마진 10$/MMBtu 이상', clearText: '6$ 이하',
      trigger: c => c.has('lng_spread') && c.v('lng_spread') >= 10,
      clear: c => c.has('lng_spread') && c.v('lng_spread') <= 6,
      counter: c => [c.m1('lng_flng') && c.m1('lng_flng').pct < 0 ? 'LNG 선사 주가는 하락 — 장기 용선 위주라 즉시 반영 안 됨' : null] }
  ];
  const RULE_STATE = {
    on: { label: '발생', cls: 's2' }, watch: { label: '경계', cls: 's1' }, off: { label: '정상', cls: 's0' },
    hold: { label: '판단 보류', cls: 'sn' }
  };
  /** 규칙 평가 — 근거 지표 품질이 정상이 아니면 판단 보류 */
  function evalRule(rule, c) {
    const bad = rule.evidence.filter(id => c.quality(id) !== 'ok');
    let state, note = '';
    if (bad.length) { state = 'hold'; note = `데이터 품질: ${bad.map(id => `${c.ind(id).name}(${({ missing: '누락', stale: '오래됨', late: '지연', check: '검증 필요' })[c.quality(id)] || c.quality(id)})`).join(', ')}`; }
    else {
      let t = false, cl = false;
      try { t = !!rule.trigger(c); cl = !!rule.clear(c); } catch (e) { t = false; cl = true; }
      state = t ? 'on' : cl ? 'off' : 'watch';
    }
    let counter = [];
    try { counter = (rule.counter(c) || []).filter(Boolean); } catch (e) {}
    return { rule, state, note, counter };
  }

  /** 분석 모듈 실행 결과 (화면·테스트 공용) */
  function runModule(mod, R) {
    const c = makeCtx(R);
    let observations = [];
    try { observations = mod.observe(c); } catch (e) { observations = [{ text: '관측 계산 오류: ' + e.message, ids: [], tone: 'neutral' }]; }
    const rules = RULES.filter(r => r.sector === mod.id).map(r => evalRule(r, c));
    const relations = RELATIONS.filter(r => r.sector === mod.id).map(r => r.type === 'stat' ? { ...r, corr: weeklyCorr(c, r.pair[0], r.pair[1]) } : r);
    return { mod, c, observations, rules, relations };
  }

  global.ANALYSIS = { modules: MODULES, relations: RELATIONS, relTypes: REL_TYPES, rules: RULES, ruleState: RULE_STATE, makeCtx, runModule, evalRule, weeklyCorr };
})(typeof window !== 'undefined' ? window : globalThis);
