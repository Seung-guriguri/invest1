/* =====================================================================
 * 🛢 유조선 가이드 — 운임 탭 하단 블록 (배 크기 사다리 · 관련주 미니 시세 · 운임 동인)
 *
 * - 자료: 사용자 제공 '유조선 기초 자료' (2026-10 기준 일반 설명)
 * - 주가: data/latest.json 의 자동 수집 시계열 (FRO·STNG 는 기존 지표 tanker_fro·tanker_stng 재사용,
 *         나머지는 scripts/sources.mjs 의 tk_* — 지표 카드·AI 재료·알림에는 들어가지 않음)
 * - index.html 의 render() 가 운임 탭일 때 tankerGuideHTML() 결과를 카드 아래에 붙임
 * - 라이트·다크, 새 디자인(v2)·기존 디자인(v1) 모두에서 동작 (색은 이 파일의 토큰)
 * ===================================================================== */
(function () {
  'use strict';

  const VESSEL_CLASSES = [
    { id: 'vlcc', name_ko: 'VLCC', name_en: 'Very Large Crude Carrier', cargo: 'crude', dwt_range: '약 200,000~320,000', capacity_bbl: '약 200만 배럴',
      typical_routes: '중동 → 중국·한국 등 장거리 대량 운송', name_origin: '초대형 원유 운반선의 약자', size_rank: 1, related_tickers: ['DHT', 'FRO', 'ECO'] },
    { id: 'suezmax', name_ko: '수에즈막스', name_en: 'Suezmax', cargo: 'crude', dwt_range: '약 120,000~200,000', capacity_bbl: '약 100만 배럴',
      typical_routes: '서아프리카, 흑해 등 중·장거리', name_origin: '짐을 가득 실은 채 수에즈 운하를 통과할 수 있는 최대 크기', size_rank: 2,
      related_tickers: ['FRO', 'TNK', 'NAT', 'ECO', 'INSW'] },
    { id: 'aframax', name_ko: '아프라막스', name_en: 'Aframax', cargo: 'crude', dwt_range: '약 80,000~120,000', capacity_bbl: '약 70만 배럴',
      typical_routes: '북해, 지중해, 카리브해 등 항구가 작은 지역의 단거리', name_origin: '운임 산정 기준 AFRA(Average Freight Rate Assessment)',
      size_rank: 3, same_size_as: 'lr2', related_tickers: ['TNK', 'FRO', 'INSW'] },
    { id: 'lr2', name_ko: 'LR2', name_en: 'Long Range 2', cargo: 'product', dwt_range: '약 80,000~120,000 (아프라막스와 같은 크기)',
      typical_routes: '중동·아시아 → 유럽 등 장거리 정제유', name_origin: '장거리(Long Range) 제품선 2급', size_rank: 3, same_size_as: 'aframax',
      note: '탱크 내부가 코팅되어 있어 원유와 제품을 오가며 운용 가능 → 유연성 큼', related_tickers: ['HAFN', 'STNG', 'FRO', 'TRMD'] },
    { id: 'lr1', name_ko: 'LR1', name_en: 'Long Range 1', cargo: 'product', dwt_range: '약 55,000~80,000',
      name_origin: "장거리 제품선 1급, 옛 파나마 운하 기준 '파나막스'급 크기", size_rank: 4, related_tickers: ['HAFN', 'TRMD'] },
    { id: 'mr', name_ko: 'MR', name_en: 'Medium Range', cargo: 'product', dwt_range: '약 40,000~55,000', typical_routes: '대서양 연안, 아시아 역내 등 중거리',
      name_origin: '중거리(Medium Range) 제품선', size_rank: 5, note: '제품선 중 척수가 가장 많은 주력 선형', related_tickers: ['STNG', 'HAFN', 'TRMD', 'INSW'] },
    { id: 'handy', name_ko: '핸디급', name_en: 'Handysize', cargo: 'product', dwt_range: '약 10,000~40,000', typical_routes: '연안·근거리',
      name_origin: '다루기 쉬운(handy) 소형선', size_rank: 6, related_tickers: ['HAFN'] }
  ];

  // series: 주가 시계열 id (latest.json) · card: 같은 종목의 기존 지표 카드 id (있으면 연결)
  const TANKER_STOCKS = [
    { ticker: 'FRO', name: 'Frontline', segment: 'crude', main_classes: ['vlcc', 'suezmax', 'lr2'], sponsor: '존 프레드릭센 계열',
      traits: ['VLCC·수에즈막스·LR2/아프라막스를 함께 운용하는 대형 원유선사', '연비 좋은 신형 선박 비중이 높음', '스팟 운임 노출이 커서 운임 상승기 이익 레버리지가 큼'],
      dividend_policy: '이익 대부분을 분기 변동 배당으로 지급', profile: '고배당·고베타', series: 'tanker_fro', card: 'tanker_fro' },
    { ticker: 'DHT', name: 'DHT Holdings', segment: 'crude', main_classes: ['vlcc'],
      traits: ['VLCC만 운용하는 순수 VLCC 플레이', '일부 선박을 기간용선으로 운용', '부채를 보수적으로 관리'],
      dividend_policy: '순이익의 약 100%를 분기 배당하는 정책', profile: 'FRO 대비 변동성 다소 낮은 편', series: 'tk_dht' },
    { ticker: 'TNK', name: 'Teekay Tankers', segment: 'crude', main_classes: ['suezmax', 'aframax'],
      traits: ['수에즈막스·아프라막스 중형 원유선 위주', '사실상 무차입'], dividend_policy: '정규 배당 + 특별배당', profile: '재무 안정형 중형선', series: 'tk_tnk' },
    { ticker: 'NAT', name: 'Nordic American Tankers', segment: 'crude', main_classes: ['suezmax'],
      traits: ['수에즈막스 단일 선형', '선령이 높은 편'], dividend_policy: '오랜 기간 분기 배당 유지', profile: '개인투자자 선호 배당주', series: 'tk_nat' },
    { ticker: 'ECO', name: 'Okeanis Eco Tankers', segment: 'crude', main_classes: ['vlcc', 'suezmax'], sponsor: '그리스계',
      traits: ['스크러버를 단 신형 선박 위주'], dividend_policy: '높은 배당성향', profile: '신형 선대 고배당', series: 'tk_eco' },
    { ticker: 'HAFN', name: 'Hafnia', segment: 'product', main_classes: ['lr2', 'lr1', 'mr', 'handy'], sponsor: 'BW그룹 계열',
      traits: ['세계 최대급 제품선사, 전 선형 운용', '다른 선사의 배를 함께 굴리는 풀(pool) 운영 사업 보유'],
      dividend_policy: '부채비율(LTV)에 따라 순이익의 50~90% 배당', profile: '제품선 대표주', series: 'tk_hafn' },
    { ticker: 'STNG', name: 'Scorpio Tankers', segment: 'product', main_classes: ['mr', 'lr2'],
      traits: ['MR·LR2 중심 대형 제품선사'], dividend_policy: '배당보다 자사주 매입·부채 상환 비중이 큼', profile: '주주환원을 자사주로 하는 제품선주',
      series: 'tanker_stng', card: 'tanker_stng' },
    { ticker: 'TRMD', name: 'Torm', segment: 'product', main_classes: ['lr2', 'lr1', 'mr'], sponsor: '덴마크계',
      traits: ['제품선 전문'], dividend_policy: '높은 배당성향', profile: '고배당 제품선주', series: 'tk_trmd' },
    { ticker: 'INSW', name: 'International Seaways', segment: 'mixed', main_classes: ['suezmax', 'aframax', 'lr2', 'mr'],
      traits: ['미국 상장, 원유선·제품선 모두 운용'], dividend_policy: '정규 배당 + 보충 배당', profile: '분산형', series: 'tk_insw' }
  ];

  const DRIVERS = {
    freight_drivers: {
      crude: ['OPEC+ 증산 여부', '원유 수출 물량', "제재 관련 '그림자 선단' 이슈"],
      product: ['정제소 입지 변화', '수에즈·홍해 우회 등 항로 거리 변화']
    },
    notes: [
      '배가 클수록 대개 운임 변동 폭이 크고, 특히 VLCC는 호황기 운임이 폭발적으로 오름',
      '중형선(수에즈막스·아프라막스)은 항로 선택이 다양해 제재·항로 변화 이슈에 민감',
      '변동 배당이라 배당수익률이 운임에 따라 크게 출렁이므로 과거 수익률만으로 판단하면 위험'
    ],
    as_of: '2026-10'
  };

  const SUMMARY = [
    '크기 순서: VLCC > 수에즈막스 > 아프라막스(= LR2 크기) > LR1 > MR > 핸디',
    '원유선 이름은 운하·운임 기준에서, 제품선 이름은 운항 거리(Long/Medium Range)에서 유래',
    '제품선 = 휘발유·경유 같은 정제유가 오염되지 않도록 탱크 내부를 코팅한 배',
    'DWT(재화중량톤) = 배가 실을 수 있는 무게'
  ];

  window.TANKERS = { VESSEL_CLASSES, TANKER_STOCKS, DRIVERS };

  /* ---------- 스타일 (라이트·다크 · v1·v2 공통) ---------- */
  const css = `
  :root { --tk-crude: #b85a00; --tk-crude-bg: #fff1e3; --tk-prod: #1f63c9; --tk-prod-bg: #e5efff; --tk-mix: #6b4fd8; --tk-mix-bg: #efeafe; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
    --tk-crude: #ffaa5c; --tk-crude-bg: rgba(255, 170, 92, .14); --tk-prod: #8ab8ff; --tk-prod-bg: rgba(138, 184, 255, .14); --tk-mix: #b3a1ff; --tk-mix-bg: rgba(179, 161, 255, .14); } }
  :root[data-theme="dark"] { --tk-crude: #ffaa5c; --tk-crude-bg: rgba(255, 170, 92, .14); --tk-prod: #8ab8ff; --tk-prod-bg: rgba(138, 184, 255, .14); --tk-mix: #b3a1ff; --tk-mix-bg: rgba(179, 161, 255, .14); }
  .tk { margin: 14px 0 6px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius, 14px); padding: 4px 14px; box-shadow: var(--shadow, none); }
  [data-ui="v2"] .tk { border: 0; border-radius: 20px; padding: 6px 16px; }
  .tk > summary { cursor: pointer; font-weight: 700; font-size: 15.5px; padding: 10px 0; color: var(--text); list-style: none; display: flex; align-items: center; gap: 6px; }
  .tk > summary::-webkit-details-marker { display: none; }
  .tk > summary::after { content: '▾'; margin-left: auto; color: var(--text-2); transition: transform .15s; }
  .tk:not([open]) > summary::after { transform: rotate(-90deg); }
  .tk h4 { font-size: 14px; margin: 14px 0 8px; color: var(--text); }
  .tk .tk-sum { margin: 0 0 6px; padding-left: 18px; font-size: 13px; color: var(--text-2); line-height: 1.6; }
  .tk .tk-legend { display: flex; gap: 10px; font-size: 12.5px; color: var(--text-2); margin: 4px 0 8px; }
  .tk .tk-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 4px; vertical-align: -1px; }
  .tk .lad { display: grid; grid-template-columns: 1fr 22px 1fr; gap: 6px 0; align-items: start; }
  .tk .lad .eq { align-self: stretch; }
  .tk .lad .eq { display: flex; align-items: center; justify-content: center; font-weight: 700; color: var(--text-2); font-size: 14px; }
  .tk .vc { border-radius: 10px; padding: 7px 10px; font-size: 13px; line-height: 1.35; min-width: 0; }
  .tk .vc.crude { background: var(--tk-crude-bg); border-left: 3px solid var(--tk-crude); }
  .tk .vc.product { background: var(--tk-prod-bg); border-left: 3px solid var(--tk-prod); }
  .tk .vc.empty { background: none; border: 0; }
  .tk .vc > summary { cursor: pointer; list-style: none; }
  .tk .vc > summary::-webkit-details-marker { display: none; }
  .tk .vc b { display: block; font-size: 13.5px; color: var(--text); }
  .tk .vc small { color: var(--text-2); font-size: 11.5px; }
  .tk .vc dl { margin: 6px 0 2px; font-size: 12px; color: var(--text-2); }
  .tk .vc dt { font-weight: 600; color: var(--text); margin-top: 4px; }
  .tk .vc dd { margin: 0; }
  .tk .vc .tks { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .tk .flash { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 10px; }
  .tk .chip { border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 999px; font-size: 11.5px; padding: 2px 8px; cursor: pointer; font: inherit; font-size: 11.5px; }
  .tk .chip.crude { color: var(--tk-crude); border-color: var(--tk-crude); background: var(--tk-crude-bg); }
  .tk .chip.product { color: var(--tk-prod); border-color: var(--tk-prod); background: var(--tk-prod-bg); }
  .tk .flt { display: flex; gap: 6px; flex-wrap: wrap; margin: 4px 0 10px; }
  .tk .flt button { border: 1px solid var(--border); background: var(--surface-2); color: var(--text-2); border-radius: 999px; padding: 5px 12px; font: inherit; font-size: 13px; cursor: pointer; }
  .tk .flt button[aria-pressed="true"] { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
  .tk .st { border-top: 1px solid var(--border); padding: 10px 0; }
  .tk .st:first-of-type { border-top: 0; }
  .tk .st-head { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 10px; align-items: center; }
  .tk .st-name b { font-size: 14.5px; color: var(--text); }
  .tk .st-name .nm { display: block; font-size: 12px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tk .seg { font-size: 11px; font-weight: 700; border-radius: 6px; padding: 1px 6px; margin-left: 6px; vertical-align: 1px; }
  .tk .seg.crude { color: var(--tk-crude); background: var(--tk-crude-bg); }
  .tk .seg.product { color: var(--tk-prod); background: var(--tk-prod-bg); }
  .tk .seg.mixed { color: var(--tk-mix); background: var(--tk-mix-bg); }
  .tk .q { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .tk .q b { display: block; font-size: 14.5px; color: var(--text); }
  .tk .q span { font-size: 12px; color: var(--text-2); }
  .tk .q .up { color: var(--up, var(--red)); } .tk .q .down { color: var(--down, var(--accent)); }
  .tk .q.none span { font-size: 11.5px; }
  .tk .spark { width: 56px; height: 26px; flex: none; margin: 0; }
  .tk .spark circle { display: none; }
  .tk .sp .spark path { fill: none; stroke: var(--text-2); stroke-width: 1.8; opacity: 1; }
  .tk .sp.up .spark path { stroke: var(--up, var(--red)); } .tk .sp.down .spark path { stroke: var(--down, var(--accent)); }
  .tk .st ul { margin: 6px 0 4px; padding-left: 18px; font-size: 13px; color: var(--text); line-height: 1.55; }
  .tk .st .meta { font-size: 12.5px; color: var(--text-2); line-height: 1.55; }
  .tk .st .meta b { color: var(--text); font-weight: 600; }
  .tk .st .tks { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; align-items: center; }
  .tk .st .link { background: none; border: 0; color: var(--accent); font: inherit; font-size: 12.5px; padding: 0; cursor: pointer; margin-left: auto; }
  .tk .drv { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .tk .drv div { border-radius: 10px; padding: 8px 10px; font-size: 12.5px; line-height: 1.5; color: var(--text); }
  .tk .drv .crude { background: var(--tk-crude-bg); } .tk .drv .product { background: var(--tk-prod-bg); }
  .tk .drv b { display: block; margin-bottom: 2px; }
  .tk .drv ul, .tk .notes { margin: 0; padding-left: 16px; }
  .tk .notes { margin: 8px 0 6px; font-size: 12.5px; color: var(--text-2); line-height: 1.6; }
  .tk .asof { font-size: 11.5px; color: var(--text-2); margin: 4px 0 10px; }
  @media (max-width: 360px) { .tk .drv { grid-template-columns: 1fr; } }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------- 상태 (이 기기만) ---------- */
  const KEY = 'macroDash.tankers';
  let ui = { open: false, seg: 'all' };
  try { ui = Object.assign(ui, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* 기본값 */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(ui)); } catch (e) { /* 무시 */ } };

  const e = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const VC = Object.fromEntries(VESSEL_CLASSES.map(v => [v.id, v]));
  const SEG = { crude: '원유선', product: '제품선', mixed: '혼합형' };

  /* ---------- 미니 시세 (자동 수집 주가 · 최근 값 / 약 1개월 변화 / 3개월 그래프) ---------- */
  function quote(seriesId) {
    const ds = window.DataStore;
    const hist = ds && ds.getHistory ? ds.getHistory(seriesId).filter(x => x.source === 'auto') : [];
    if (!hist.length) return null;
    const cur = hist[0], t0 = Date.parse(cur.date);
    const base = hist.find(x => t0 - Date.parse(x.date) >= 28 * 86400000);
    const chg = base && base.value ? (cur.value / base.value - 1) * 100 : null;
    let spark = '';
    try { if (typeof window.sparkSVG === 'function') spark = window.sparkSVG({ history: hist, freq: 'D', isSample: false }); } catch (err) { spark = ''; }
    return { value: cur.value, date: cur.date, chg, spark };
  }
  function quoteHTML(s) {
    const q = quote(s.series);
    if (!q) return '<span></span><span class="q none"><span>시세 수집 전</span></span>';
    const dir = q.chg == null ? '' : q.chg > 0 ? 'up' : q.chg < 0 ? 'down' : '';
    const chg = q.chg == null ? '—' : `${q.chg > 0 ? '+' : q.chg < 0 ? '−' : ''}${Math.abs(q.chg).toFixed(1)}%`;
    return `<span class="sp ${dir}">${q.spark}</span>
      <span class="q"><b>$${q.value.toFixed(2)}</b><span class="${dir}">1개월 ${chg}</span></span>`;
  }

  // guides.js(벌크선·석유 밸류체인 가이드)도 같은 미니 시세를 씀
  window.tkQuoteHTML = quoteHTML;

  /* ---------- 화면 ---------- */
  function vcHTML(v) {
    if (!v) return '<div class="vc empty"></div>';
    const rows = [['재화중량톤(DWT)', v.dwt_range], ['적재량', v.capacity_bbl], ['주 항로', v.typical_routes], ['이름 유래', v.name_origin], ['특징', v.note]]
      .filter(r => r[1]).map(([k, val]) => `<dt>${e(k)}</dt><dd>${e(val)}</dd>`).join('');
    return `<details class="vc ${v.cargo}" id="tk-${v.id}"><summary><b>${e(v.name_ko)}</b><small>${e(v.name_en)} · ${v.cargo === 'crude' ? '원유선' : '제품선'}</small></summary>
      <dl>${rows}</dl>
      <div class="tks">${v.related_tickers.map(t => `<button type="button" class="chip" data-tk-stock="${e(t)}">${e(t)}</button>`).join('')}</div></details>`;
  }
  function ladderHTML() {
    const rows = [];
    for (let r = 1; r <= 6; r++) {
      const c = VESSEL_CLASSES.find(v => v.size_rank === r && v.cargo === 'crude');
      const p = VESSEL_CLASSES.find(v => v.size_rank === r && v.cargo === 'product');
      rows.push(vcHTML(c), `<div class="eq">${c && p && c.same_size_as === p.id ? '=' : ''}</div>`, vcHTML(p));
    }
    return `<div class="lad">${rows.join('')}</div>`;
  }
  function stockHTML(s) {
    const chips = s.main_classes.map(id => VC[id] ? `<button type="button" class="chip ${VC[id].cargo}" data-tk-class="${id}">${e(VC[id].name_ko)}</button>` : '').join('');
    return `<div class="st" id="tk-st-${e(s.ticker)}">
      <div class="st-head"><div class="st-name"><b>${e(s.ticker)}</b><span class="seg ${s.segment}">${SEG[s.segment]}</span><span class="nm">${e(s.name)}${s.sponsor ? ' · ' + e(s.sponsor) : ''}</span></div>${quoteHTML(s)}</div>
      <ul>${s.traits.map(t => `<li>${e(t)}</li>`).join('')}</ul>
      <div class="meta"><b>배당</b> ${e(s.dividend_policy)} · <b>성격</b> ${e(s.profile)}</div>
      <div class="tks">${chips}${s.card ? `<button type="button" class="link" data-edit="${s.card}">지표 카드 보기 ›</button>` : ''}</div>
    </div>`;
  }
  function stocksHTML() {
    const list = TANKER_STOCKS.filter(s => ui.seg === 'all' || s.segment === ui.seg);
    return list.map(stockHTML).join('');
  }

  window.tankerGuideHTML = function () {
    const flt = [['all', '전체'], ['crude', '원유선'], ['product', '제품선'], ['mixed', '혼합형']]
      .map(([k, t]) => `<button type="button" data-tk-seg="${k}" aria-pressed="${ui.seg === k}">${t}</button>`).join('');
    const d = DRIVERS.freight_drivers;
    return `<details class="tk" id="tkGuide" ${ui.open ? 'open' : ''}>
      <summary>🛢 유조선 가이드 — 배 크기·관련주</summary>
      <p class="asof">정보 기준일 ${e(DRIVERS.as_of)}</p>
      <h4>① 배 크기 사다리 (큰 배 → 작은 배)</h4>
      <ul class="tk-sum">${SUMMARY.map(x => `<li>${e(x)}</li>`).join('')}</ul>
      <div class="tk-legend"><span><i style="background:var(--tk-crude)"></i>원유선</span><span><i style="background:var(--tk-prod)"></i>제품선</span><span>= 같은 체급</span></div>
      ${ladderHTML()}
      <h4>② 관련주</h4>
      <div class="flt" role="group" aria-label="선종 필터">${flt}</div>
      <div id="tkStocks">${stocksHTML()}</div>
      <h4>③ 투자 포인트 — 운임 동인</h4>
      <div class="drv"><div class="crude"><b>원유선</b><ul>${d.crude.map(x => `<li>${e(x)}</li>`).join('')}</ul></div>
        <div class="product"><b>제품선</b><ul>${d.product.map(x => `<li>${e(x)}</li>`).join('')}</ul></div></div>
      <ul class="notes">${DRIVERS.notes.map(x => `<li>${e(x)}</li>`).join('')}</ul>
    </details>`;
  };

  /* ---------- 동작: 열림 기억 · 필터 · 선형 칸으로 이동 · 종목으로 이동 ---------- */
  document.addEventListener('toggle', ev => {
    if (ev.target && ev.target.id === 'tkGuide') { ui.open = ev.target.open; save(); }
  }, true);
  document.addEventListener('click', ev => {
    const seg = ev.target.closest('[data-tk-seg]');
    if (seg) {
      ui.seg = seg.dataset.tkSeg; save();
      const box = document.getElementById('tkStocks'); if (box) box.innerHTML = stocksHTML();
      document.querySelectorAll('.tk [data-tk-seg]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tkSeg === ui.seg)));
      return;
    }
    const cls = ev.target.closest('[data-tk-class]');
    if (cls) {
      const el = document.getElementById('tk-' + cls.dataset.tkClass); if (!el) return;
      el.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400);
      return;
    }
    const st = ev.target.closest('[data-tk-stock]');
    if (st) {
      const t = st.dataset.tkStock;
      if (ui.seg !== 'all' && !document.getElementById('tk-st-' + t)) {
        ui.seg = 'all'; save();
        const box = document.getElementById('tkStocks'); if (box) box.innerHTML = stocksHTML();
        document.querySelectorAll('.tk [data-tk-seg]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tkSeg === 'all')));
      }
      const el = document.getElementById('tk-st-' + t); if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400);
    }
  });
})();
