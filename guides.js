/* =====================================================================
 * 탭별 탑다운 가이드 — 🚢 벌크선 가이드(운임 탭) · 🛢 석유 밸류체인(에너지 탭)
 *
 * - 자료: Claude 초안 (2026-10 기준 일반 설명, 사용자 확인)
 * - 주가: data/latest.json 자동 수집 시계열 (scripts/sources.mjs 의 gd_* · 기존 지표 재사용)
 *         지표 카드·AI 재료·알림에는 들어가지 않음
 * - 스타일·미니 시세는 tankers.js 의 .tk 스타일과 tkQuoteHTML() 을 함께 씀 (tankers.js 다음에 불러올 것)
 * - index.html render() 가 guideHTML(activeTab) 결과를 카드 아래에 붙임
 * - 라이트·다크, 새 디자인(v2)·기존 디자인(v1) 모두에서 동작
 * ===================================================================== */
(function () {
  'use strict';

  /* ---------- 🚢 벌크선 가이드 ---------- */
  const BULK = {
    id: 'bulk', tab: 'freight', title: '🚢 벌크선 가이드 — 배 크기·관련주', as_of: '2026-10',
    summary: [
      '크기 순서: 케이프사이즈 > 파나막스 > 수프라막스 > 핸디사이즈',
      '큰 배일수록 철광석·석탄 같은 대량 화물 위주, 작은 배일수록 화물 종류가 다양함',
      '발틱 건화물 지수(BDI)는 케이프사이즈·파나막스·수프라막스 운임으로 계산하고, 앱의 BDRY는 이 운임 선물에 투자하는 ETF',
      'DWT(재화중량톤) = 배가 실을 수 있는 무게'
    ],
    classes: [
      { id: 'cape', name_ko: '케이프사이즈', name_en: 'Capesize', dwt_range: '약 100,000~210,000 이상', cargo: '철광석, 석탄',
        typical_routes: '호주·브라질 → 중국', name_origin: '수에즈·파나마 운하를 못 지나 희망봉·혼곶을 돌아가야 하는 크기',
        note: '대형 항만 전용, 운임 변동이 가장 큼', related: ['SBLK', 'GNK', 'SB', 'SHIP', 'DSX'] },
      { id: 'panamax', name_ko: '파나막스·캄사르막스', name_en: 'Panamax · Kamsarmax', dwt_range: '약 65,000~100,000', cargo: '석탄, 곡물',
        typical_routes: '미주·남미 곡물 → 아시아, 석탄', name_origin: '옛 파나마 운하를 지날 수 있는 최대 크기 (캄사르막스는 기니 캄사르항 기준의 조금 더 큰 형)',
        related: ['SBLK', 'SB', 'DSX'] },
      { id: 'supra', name_ko: '수프라막스·울트라막스', name_en: 'Supramax · Ultramax', dwt_range: '약 50,000~65,000', cargo: '곡물, 비료, 철강재, 시멘트',
        typical_routes: '다양한 중·단거리', name_origin: '핸디맥스보다 큰(supra) 형',
        note: '배에 크레인이 달려 있어(기어드) 하역 장비가 없는 작은 항구에도 들어갈 수 있음', related: ['SBLK', 'GNK', 'DSX', 'PANL'] },
      { id: 'handy', name_ko: '핸디사이즈', name_en: 'Handysize', dwt_range: '약 15,000~40,000', cargo: '소량 화물 전반',
        typical_routes: '연안·근거리', name_origin: '다루기 쉬운(handy) 소형선', note: '크레인 장착, 항구 제약이 가장 적음', related: ['PANL'] }
    ],
    stocks: [
      { ticker: 'SBLK', name: 'Star Bulk Carriers', sponsor: '그리스계', classes: ['cape', 'panamax', 'supra'],
        traits: ['미국 상장 최대급 벌크선사, 케이프~수프라 전 선형', '2024년 Eagle Bulk 합병'], dividend: '이익 연동 분기 변동 배당', profile: '대표주', series: 'gd_sblk' },
      { ticker: 'GNK', name: 'Genco Shipping & Trading', classes: ['cape', 'supra'],
        traits: ['미국 기반, 케이프 + 울트라·수프라', '부채를 낮게 유지'], dividend: '현금흐름 연동 분기 배당', profile: '재무 안정형', series: 'gd_gnk' },
      { ticker: 'SB', name: 'Safe Bulkers', sponsor: '그리스계', classes: ['panamax', 'cape'],
        traits: ['캄사르막스·파나막스 중심 + 케이프', '친환경 신조선 교체 진행'], dividend: '정규 분기 배당', profile: '중형선', series: 'gd_sb' },
      { ticker: 'SHIP', name: 'Seanergy Maritime', sponsor: '그리스계', classes: ['cape'],
        traits: ['거의 케이프사이즈만 운용'], dividend: '변동 배당', profile: '고베타 — 운임 민감도 가장 높음', series: 'gd_ship' },
      { ticker: 'DSX', name: 'Diana Shipping', sponsor: '그리스계', classes: ['cape', 'panamax', 'supra'],
        traits: ['기간 용선 위주라 운임 변동을 덜 받음'], dividend: '—', profile: '변동성 낮은 편', series: 'gd_dsx' },
      { ticker: 'PANL', name: 'Pangaea Logistics', classes: ['supra', 'handy'],
        traits: ['핸디·수프라·특수선(내빙선)', '해운에 물류 서비스를 붙인 운영형'], dividend: '—', profile: '소형선·틈새', series: 'gd_panl' }
    ],
    drivers: [
      ['케이프사이즈', ['중국 철강 생산·철광석 수입', '브라질·호주 광산 수출량']],
      ['파나막스·수프라막스', ['남미·미국 곡물 수확기 수출(계절성)', '석탄 발전 수요']]
    ],
    notes: [
      '신조선 발주가 적고 노후선 해체가 늘면 선대 공급이 빠듯해짐',
      '파나마 운하 가뭄·홍해 우회처럼 항로가 길어지면 운임 상승 효과',
      '벌크선 운임은 하루 변동이 커서 BDRY·종목 주가가 며칠 새 10% 넘게 움직이는 일이 흔함'
    ],
    indicators: [['bdry', '벌크선 운임(BDRY)'], ['iron_ore', '철광석'], ['coal', '석탄'], ['wheat', '밀'], ['corn', '옥수수'], ['soybean', '대두']]
  };

  /* ---------- 🛢 석유 밸류체인 ---------- */
  const OIL = {
    id: 'oil', tab: 'energy', title: '🛢 석유 밸류체인 — 단계별 관련주', as_of: '2026-10',
    stages: [
      { id: 'up', no: '①', name: '업스트림 (탐사·생산)', job: '원유·가스를 뽑아 팖. 유가가 곧 판매가라 이익이 유가에 가장 직접 연동', sens: '높음', lvl: 3,
        ind: ['wti', 'brent', 'us_crude_prod'],
        stocks: [['XOP', '석유·가스 생산기업 ETF', 'gd_xop'], ['COP', 'ConocoPhillips', 'gd_cop'], ['EOG', 'EOG Resources', 'gd_eog'], ['OXY', 'Occidental Petroleum', 'gd_oxy']] },
      { id: 'svc', no: '②', name: '유전 서비스 (육상)', job: '시추·완결 장비와 인력을 빌려줌. 생산기업 투자가 늘어야 일감이 늘어 유가보다 한 박자 늦게 움직임', sens: '높음 (시차)', lvl: 3,
        ind: ['wti', 'us_crude_prod'],
        stocks: [['OIH', '유전 서비스 ETF', 'gd_oih'], ['SLB', 'SLB (슐럼버거)', 'gd_slb'], ['HAL', 'Halliburton', 'gd_hal'], ['BKR', 'Baker Hughes', 'gd_bkr']] },
      { id: 'off', no: '③', name: '해양 시추·서브시', job: '바다 밑 유전을 뚫는 시추선을 일당(데이레이트)으로 빌려주고 해저 생산설비를 깖. 계약이 1~3년 단위라 유가보다 6~12개월 늦게 움직이고, 브렌트가 오래 높게 유지돼야 심해 발주가 늘어남. 부채가 커서 주가 변동이 가장 큼', sens: '매우 높음 (늦은 시차)', lvl: 3,
        ind: ['brent', 'brent_wti'],
        stocks: [['RIG', 'Transocean — 심해 시추선 최대, 부채 부담 큼', 'gd_rig'], ['VAL', 'Valaris — 심해·천해 시추', 'gd_val'], ['NE', 'Noble — 2024년 Diamond Offshore 합병', 'gd_ne'], ['SDRL', 'Seadrill — 브라질 등 심해 위주', 'gd_sdrl'], ['BORR', 'Borr Drilling — 천해 잭업 시추선 전문, 중동·멕시코 비중 큼', 'gd_borr'], ['FTI', 'TechnipFMC — 해저 생산설비(서브시)', 'gd_fti'], ['TDW', 'Tidewater — 해양 지원선(OSV)', 'gd_tdw']] },
      { id: 'mid', no: '④', name: '미드스트림 (수송·저장)', job: '파이프라인·저장 탱크·수출 터미널. 물량에 따른 통행료(수수료)로 벌어 유가 영향이 작고 배당 성격이 강함', sens: '낮음', lvl: 1,
        ind: ['cushing', 'crude_net_imports', 'natgas'],
        stocks: [['AMLP', '미드스트림 MLP ETF', 'gd_amlp'], ['EPD', 'Enterprise Products', 'gd_epd'], ['ET', 'Energy Transfer', 'gd_et'], ['KMI', 'Kinder Morgan', 'gd_kmi'], ['WMB', 'Williams', 'gd_wmb']] },
      { id: 'down', no: '⑤', name: '다운스트림 (정유)', job: '원유를 사서 휘발유·디젤·항공유를 만들어 팖. 유가 수준보다 크랙 스프레드(제품값 − 원유값 마진)가 이익을 좌우', sens: '중간 (마진)', lvl: 2,
        ind: ['crack321', 'refinery_util', 'us_distill', 'distill_demand', 'diesel', 'gasoline_demand'],
        stocks: [['CRAK', '정유 기업 ETF', 'gd_crak'], ['VLO', 'Valero', 'gd_vlo'], ['MPC', 'Marathon Petroleum', 'gd_mpc'], ['PSX', 'Phillips 66', 'gd_psx']] },
      { id: 'ship', no: '⑥', name: '해상 운송', job: '원유와 제품을 바다로 나름. 운임에 민감', sens: '중간 (운임)', lvl: 2,
        ind: ['brent_wti', 'etf_bwet'], link: { tab: 'freight', guide: 'tkGuide', label: '운임 탭 유조선 가이드로 ›' }, stocks: [] },
      { id: 'major', no: '⑦', name: '통합 메이저', job: '생산부터 정유까지 한 회사가 모두 함. 유가가 오르면 생산이 벌고 내리면 정유가 버텨 줘 변동성이 낮음', sens: '중간', lvl: 2, sep: true,
        ind: ['wti', 'crack321', 'etf_xle'],
        stocks: [['XLE', '미국 에너지 업종 ETF', 'etf_xle', 'etf_xle'], ['XOM', 'ExxonMobil', 'gd_xom'], ['CVX', 'Chevron', 'gd_cvx']] }
    ],
    reading: [
      '유가 상승기: 업스트림 > 서비스 > 통합 순으로 수혜가 큼. 정유는 원가가 올라 마진이 눌릴 수 있음',
      '해양 시추는 가장 늦게, 가장 크게 반응: 브렌트가 수개월 이상 높게 유지되고 메이저들의 심해 투자 발표가 이어질 때 계약 단가(데이레이트)가 오름. 유가가 꺾이면 반대로 크게 빠짐',
      '크랙 스프레드 확대: 정유주에 유리. 디젤 재고가 평년보다 적을 때 자주 나타남',
      '유가 하락·변동성 확대: 미드스트림·통합 메이저가 상대적으로 방어적',
      '같은 에너지 업종이라도 단계마다 유가에 반응하는 방향·강도가 달라 XLE 하나로 판단하면 놓치는 부분이 있음'
    ]
  };

  window.GUIDES = { BULK, OIL };

  /* ---------- 추가 스타일 (기본은 tankers.js 의 .tk) ---------- */
  const css = `
  .tk .lad1 { display: grid; gap: 6px; }
  .tk .vc.bulk { background: var(--surface-2); border-left: 3px solid var(--text-2); }
  .tk .vc .w { display: inline-block; height: 4px; border-radius: 2px; background: var(--text-2); opacity: .5; margin-top: 4px; }
  .tk .ind { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0 8px; align-items: center; font-size: 12px; color: var(--text-2); }
  .tk .chip.ind { color: var(--accent); border-color: var(--accent); background: transparent; }
  .tk .flow { display: grid; gap: 4px; }
  .tk .stg { border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; background: var(--surface); }
  [data-ui="v2"] .tk .stg { border: 0; background: var(--surface-2); }
  .tk .stg-h { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .tk .stg-h b { font-size: 14.5px; color: var(--text); }
  .tk .sens { font-size: 11.5px; font-weight: 700; border-radius: 6px; padding: 1px 7px; margin-left: auto; }
  .tk .sens.l3 { color: var(--red); background: var(--red-bg); }
  .tk .sens.l2 { color: var(--yellow); background: var(--yellow-bg); }
  .tk .sens.l1 { color: var(--green); background: var(--green-bg); }
  .tk .stg p { margin: 6px 0 4px; font-size: 13px; line-height: 1.55; color: var(--text); }
  .tk .arrow { text-align: center; color: var(--text-2); font-size: 14px; line-height: 1; }
  .tk .sepl { border-top: 1px dashed var(--border); margin: 8px 0 6px; }
  .tk .mini { border-top: 1px solid var(--border); padding: 7px 0; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 10px; align-items: center; }
  .tk .mini .nm2 b { font-size: 13.5px; color: var(--text); margin-right: 6px; }
  .tk .mini .nm2 span { font-size: 12px; color: var(--text-2); }
  .tk .stg .link { background: none; border: 0; color: var(--accent); font: inherit; font-size: 12.5px; padding: 0; cursor: pointer; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------- 상태 (이 기기만) ---------- */
  const KEY = 'macroDash.guides';
  let ui = { open: {} };
  try { ui = Object.assign(ui, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* 기본값 */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(ui)); } catch (e) { /* 무시 */ } };

  const e = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const quote = series => (typeof window.tkQuoteHTML === 'function' ? window.tkQuoteHTML({ series }) : '<span></span><span></span>');
  const indName = id => { try { return (typeof IND !== 'undefined' && IND[id]) ? IND[id].name : id; } catch (err) { return id; } };   // IND: index.html 전역
  const indChips = ids => ids.map(id => `<button type="button" class="chip ind" data-edit="${e(id)}">${e(indName(id))}</button>`).join('');

  /* ---------- 벌크선 화면 ---------- */
  function bulkHTML() {
    const g = BULK, max = 4;
    const lad = g.classes.map((v, i) => {
      const rows = [['재화중량톤(DWT)', v.dwt_range], ['주요 화물', v.cargo], ['주 항로', v.typical_routes], ['이름 유래', v.name_origin], ['특징', v.note]]
        .filter(r => r[1]).map(([k, val]) => `<dt>${e(k)}</dt><dd>${e(val)}</dd>`).join('');
      return `<details class="vc bulk" id="gd-${v.id}"><summary><b>${e(v.name_ko)}</b><small>${e(v.name_en)} · ${e(v.cargo)}</small>
        <span class="w" style="width:${Math.round((max - i) / max * 100)}%" aria-hidden="true"></span></summary>
        <dl>${rows}</dl><div class="tks">${v.related.map(t => `<button type="button" class="chip" data-gd-stock="${e(t)}">${e(t)}</button>`).join('')}</div></details>`;
    }).join('');
    const VC = Object.fromEntries(g.classes.map(v => [v.id, v]));
    const stocks = g.stocks.map(s => `<div class="st" id="gd-st-${e(s.ticker)}">
      <div class="st-head"><div class="st-name"><b>${e(s.ticker)}</b><span class="nm">${e(s.name)}${s.sponsor ? ' · ' + e(s.sponsor) : ''}</span></div>${quote(s.series)}</div>
      <ul>${s.traits.map(t => `<li>${e(t)}</li>`).join('')}</ul>
      <div class="meta">${s.dividend && s.dividend !== '—' ? `<b>배당</b> ${e(s.dividend)} · ` : ''}<b>성격</b> ${e(s.profile)}</div>
      <div class="tks">${s.classes.map(id => `<button type="button" class="chip" data-gd-class="${id}">${e(VC[id].name_ko)}</button>`).join('')}</div></div>`).join('');
    return `<details class="tk" id="gd-bulk" ${ui.open.bulk ? 'open' : ''}>
      <summary>${e(g.title)}</summary>
      <p class="asof">정보 기준일 ${e(g.as_of)}</p>
      <h4>① 배 크기 사다리 (큰 배 → 작은 배)</h4>
      <ul class="tk-sum">${g.summary.map(x => `<li>${e(x)}</li>`).join('')}</ul>
      <div class="lad1">${lad}</div>
      <h4>② 관련주 (미국 상장)</h4>
      <div>${stocks}</div>
      <h4>③ 운임 동인</h4>
      <div class="drv">${g.drivers.map(([k, arr]) => `<div style="background:var(--surface-2)"><b>${e(k)}</b><ul>${arr.map(x => `<li>${e(x)}</li>`).join('')}</ul></div>`).join('')}</div>
      <ul class="notes">${g.notes.map(x => `<li>${e(x)}</li>`).join('')}</ul>
      <div class="ind">함께 볼 지표 ${indChips(g.indicators.map(x => x[0]))}</div>
    </details>`;
  }

  /* ---------- 석유 밸류체인 화면 ---------- */
  function oilHTML() {
    const g = OIL;
    const stage = s => `${s.sep ? '<div class="sepl"></div>' : ''}<div class="stg" id="gd-stg-${s.id}">
      <div class="stg-h"><b>${e(s.no)} ${e(s.name)}</b><span class="sens l${s.lvl}">유가 민감도 ${e(s.sens)}</span></div>
      <p>${e(s.job)}</p>
      <div class="ind">관련 지표 ${indChips(s.ind)}</div>
      ${s.stocks.map(([t, n, series, card]) => `<div class="mini"><div class="nm2"><b>${e(t)}</b><span>${e(n)}</span></div>${quote(series)}</div>`).join('')}
      ${s.link ? `<button type="button" class="link" data-gd-goto="${e(s.link.tab)}" data-gd-open="${e(s.link.guide)}">${e(s.link.label)}</button>` : ''}
    </div>`;
    const main = g.stages.filter(s => !s.sep).map(stage).join('<div class="arrow" aria-hidden="true">↓</div>');
    const side = g.stages.filter(s => s.sep).map(stage).join('');
    return `<details class="tk" id="gd-oil" ${ui.open.oil ? 'open' : ''}>
      <summary>${e(g.title)}</summary>
      <p class="asof">정보 기준일 ${e(g.as_of)} · 위에서 아래로 원유가 흘러가는 순서</p>
      <div class="flow">${main}${side}</div>
      <h4>이렇게 읽어요</h4>
      <ul class="notes">${g.reading.map(x => `<li>${e(x)}</li>`).join('')}</ul>
    </details>`;
  }

  /** 탭별 가이드 HTML (index.html render() 에서 호출) */
  window.guideHTML = function (tab) {
    if (tab === 'freight') return bulkHTML();
    if (tab === 'energy') return oilHTML();
    return '';
  };

  /* ---------- 동작 ---------- */
  document.addEventListener('toggle', ev => {
    const id = ev.target && ev.target.id;
    if (id === 'gd-bulk' || id === 'gd-oil') { ui.open[id.slice(3)] = ev.target.open; save(); }
  }, true);
  const flash = el => { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400); };
  document.addEventListener('click', ev => {
    const c = ev.target.closest('[data-gd-class]');
    if (c) { const el = document.getElementById('gd-' + c.dataset.gdClass); if (el) { el.open = true; flash(el); } return; }
    const s = ev.target.closest('[data-gd-stock]');
    if (s) { const el = document.getElementById('gd-st-' + s.dataset.gdStock); if (el) flash(el); return; }
    const go = ev.target.closest('[data-gd-goto]');
    if (go) {
      // 다른 탭의 가이드로 이동: 탭 버튼을 눌러 화면을 바꾼 뒤 그 가이드를 펼침
      const tabBtn = document.querySelector(`[data-tab="${go.dataset.gdGoto}"]`);
      if (tabBtn) tabBtn.click();
      requestAnimationFrame(() => { const el = document.getElementById(go.dataset.gdOpen); if (el) { el.open = true; flash(el); } });
    }
  });
})();
