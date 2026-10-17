/* =====================================================================
 * [UI v2 패치] 큰 숫자 · 흰 카드 · 목록형 디자인 — 화면 구성 바꾸기
 *
 * ui-v2.css 와 한 묶음입니다. index.html 의 기존 코드(v1)는 고치지 않고,
 * 이 파일이 지표 카드 그리기(cardHTML)·변화 표시(changeHTML)만 바꿔 끼우고 하단 탭을 붙입니다.
 *
 * 되돌리기(롤백)
 *   1) 앱 안에서: 입력·설정 → 화면 → 화면 디자인 → "기존 디자인" (이 기기만, 즉시)
 *   2) 코드에서: index.html 의 "[UI v2 패치]" 표시가 붙은 4줄을 지우면 완전히 기존 화면으로
 *      (또는 GitHub 에서 이 패치 PR 을 Revert)
 * ===================================================================== */
(function () {
  'use strict';
  const KEY = 'macroDash.ui';
  const mode = (() => { try { return localStorage.getItem(KEY) || 'v2'; } catch (e) { return 'v2'; } })();

  /* 설정 화면: 디자인 선택 (v1·v2 어느 쪽에서도 보여야 다시 바꿀 수 있음) */
  const theme = document.getElementById('themeSelect');
  if (theme && !document.getElementById('uiSelect')) {
    const label = document.createElement('label');
    label.className = 'field';
    label.innerHTML = '<span>화면 디자인</span><select id="uiSelect">' +
      '<option value="v2">새 디자인 (v2 · 목록형)</option><option value="v1">기존 디자인 (v1 · 카드형)</option></select>';
    theme.closest('label').after(label);
    const sel = label.querySelector('select');
    sel.value = mode;
    sel.onchange = () => { try { localStorage.setItem(KEY, sel.value); } catch (e) {} location.reload(); };
  }

  if (mode !== 'v2') { document.documentElement.removeAttribute('data-ui'); return; }
  document.documentElement.setAttribute('data-ui', 'v2');

  const CAT_ICON = { rates: '🏦', inflation: '🛒', growth: '🏭', market: '📈', fx: '💱', energy: '🛢️', power: '⚡', freight: '🚢', stocks: '📦', metals: '⛏️', grains: '🌾', etf: '🧺' };
  const dirOf = a => a.diff > 0 ? 'up' : a.diff < 0 ? 'down' : 'flat';
  const trendDir = a => a.trend === 'rise' || a.trend === 'surge' ? 'up' : a.trend === 'fall' || a.trend === 'plunge' ? 'down' : 'flat';

  /** 직전 대비 변화 한 줄 (부호 포함, 색은 상승 빨강·하락 파랑) */
  function chgText(a) {
    const ind = a.ind;
    if (a.diff == null) return '—';
    if (ind.changeMode === 'pct') return a.pct == null ? '—' : fmtSigned(a.pct, 2) + '%' + (a.yoy ? ' (전년比)' : '');
    if (ind.changeMode === 'pp') return fmtSigned(a.diff, 2) + '%p' + (a.yoy ? ' (전년比)' : '');
    return fmtSigned(a.diff, ind.dp);
  }

  /** 지표 한 줄 (기존 cardHTML 대신) */
  function rowHTML(a) {
    const ind = a.ind;
    const icon = `<span class="ic" aria-hidden="true">${CAT_ICON[ind.cat] || '•'}</span>`;
    if (!a.cur) {
      return `<button class="row2" data-edit="${ind.id}" type="button">${icon}
        <span class="mid"><span class="nm">${esc(ind.name)}</span><span class="ds">자동 데이터 없음 — 눌러서 직접 입력</span></span><span></span><span></span></button>`;
    }
    const tag = a.signal === 2 ? `<span class="tg r">${esc(a.moveLabel || '경고')}</span>`
      : a.signal === 1 ? '<span class="tg y">주의</span>' : '';
    const stale = (a.stale ? '<span class="tg g">오래됨</span>' : '') + qualityBadges(a, 'tg');
    const unit = ind.unit && ind.unit.length <= 4 ? `<small>${esc(ind.unit)}</small>` : '';
    const sub = ind.sub || '';
    const label = `${ind.name}, ${fmt(a.value, ind.dp)}${ind.unit || ''}, ${a.yoy ? '전년 동월 대비' : '직전 대비'} ${chgText(a)}${a.signal === 2 ? ', ' + (a.moveLabel || '경고') : a.signal === 1 ? ', 주의' : ''}`;
    return `<button class="row2${a.isSample ? ' sample' : ''}" data-edit="${ind.id}" type="button" aria-label="${esc(label)}">
      ${icon}
      <span class="mid"><span class="nm">${esc(ind.name)}${tag}</span>${stale ? `<span class="tgs">${stale}</span>` : ''}<span class="ds">${esc(sub)}</span></span>
      <span class="sp ${trendDir(a)}">${sparkSVG(a)}</span>
      <span class="rt"><span class="vl num">${fmt(a.value, ind.dp)}${unit}</span><span class="ch num ${dirOf(a)}" style="display:block">${chgText(a)}</span></span>
      ${showComment(a) ? `<span class="cm">${esc(a.comment)}</span>` : ''}
    </button>`;
  }

  // 기존 함수 바꿔 끼우기 (전역 함수라 render()·openEdit() 가 새 함수를 씀)
  window.cardHTML = rowHTML;
  const origChange = window.changeHTML;
  window.changeHTML = a => origChange(a).replace('class="change', `class="change ${dirOf(a)}`);

  /* 하단 탭: 홈 · 지표 · AI · 설정 (한 화면 스크롤 구조는 그대로, 해당 위치로 이동) */
  const ICON = {
    home: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3 3 10v10a1 1 0 0 0 1 1h5v-6h6v6h5a1 1 0 0 0 1-1V10Z"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></svg>',
    ai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l2.4 5.6L20 11l-5.6 2.4L12 19l-2.4-5.6L4 11l5.6-2.4Z"/></svg>',
    set: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>'
  };
  const nav = document.createElement('nav');
  nav.className = 'nav2';
  nav.setAttribute('aria-label', '화면 이동');
  nav.innerHTML = [['ai', 'AI'], ['home', '오늘'], ['list', '지표'], ['set', '설정']]
    .map(([k, t]) => `<button type="button" data-nav="${k}">${ICON[k]}<span>${t}</span></button>`).join('');
  document.body.appendChild(nav);

  // 아래 메뉴 = 화면 전환 (index.html 의 setView: 오늘 · 지표 · AI)
  const goMain = () => { if (location.hash === '#settings') { history.pushState('', '', location.pathname + location.search); route(); } };
  const NAV_VIEW = { home: 'today', list: 'list', ai: 'ai' };
  const VIEW_NAV = { today: 'home', list: 'list', ai: 'ai' };
  function setOn(k) { nav.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.nav === k)); }
  nav.addEventListener('click', e => {
    const b = e.target.closest('[data-nav]'); if (!b) return;
    const k = b.dataset.nav;
    if (k === 'set') { location.hash = '#settings'; setOn(k); return; }
    goMain();
    viewTouched = true;
    if (k !== 'list') listFilter = null;
    setView(NAV_VIEW[k]); render();
    setOn(k);
  });
  const syncNav = () => setOn(location.hash === '#settings' ? 'set' : (VIEW_NAV[view] || 'home'));
  window.addEventListener('hashchange', syncNav);
  document.addEventListener('viewchange', syncNav);
  syncNav();

  // 이미 그려진 첫 화면을 새 디자인으로 다시 그림
  if (location.hash !== '#settings') render();
})();
