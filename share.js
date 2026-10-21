/* =====================================================================
 * share.js — 지표 카드 공유 (공유 이미지 + 바로가기 링크)
 *
 * - 상세 시트의 공유 버튼 → 공유 전용 이미지(1080×1350 PNG)를 캔버스로 직접 그림
 *   (화면 캡처가 아니라 테마·디자인(v1/v2)과 상관없이 늘 같은 모양)
 * - 휴대폰 공유창(카톡·텔레그램 등)으로 이미지 + 한 줄 설명 + 바로가기 링크 전송
 *   공유창이 없는 환경(PC 일부)은 이미지 저장 + 링크 복사로 대신
 * - 바로가기 링크: …/invest1/#ind=지표ID → 앱이 열리면 그 지표 상세가 바로 뜸 (index.html 의 openFromHash)
 * 외부 라이브러리 없음. index.html 의 전역 함수(analyze, fmt, fmtSigned, fmtObsDate, periodChange …)를 씀.
 * ===================================================================== */
(function (global) {
  'use strict';

  const W = 1080, H = 1350, P = 72;
  const FONT = '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif';
  // 공유 이미지는 테마와 무관하게 고정 색 (밝은 배경 — 메신저 미리보기에서 가장 잘 보임)
  const C = {
    bg: '#ffffff', panel: '#f3f5f8', text: '#16191f', text2: '#4e5561', text3: '#8a919c', line: '#e3e7ed',
    up: '#e5383b', down: '#2f6fe4', flat: '#6b7280', accent: '#3b5bdb',
    sig: [['#e7f6ec', '#1f8a4c'], ['#fff4d6', '#a86b00'], ['#fde8e8', '#c62828']], none: ['#eef0f3', '#6b7280']
  };

  const linkFor = id => `${location.origin}${location.pathname}#ind=${encodeURIComponent(id)}`;
  const font = (px, weight = 400) => `${weight} ${px}px ${FONT}`;

  /** 변화 문구: 카드와 같은 기준 (직전 대비 / 전년 동월 대비) */
  function changeInfo(a) {
    const ind = a.ind;
    if (a.diff == null) return null;
    const dir = a.diff > 0 ? 'up' : a.diff < 0 ? 'down' : 'flat';
    const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '–';
    const body = ind.changeMode === 'pct'
      ? (a.pct == null ? '-' : fmt(Math.abs(a.pct), 2) + '%')
      : fmt(Math.abs(a.diff), Math.max(ind.dp, ind.changeMode === 'pp' ? 2 : 0)) + (ind.changeMode === 'pp' ? '%p' : (ind.unit ? ' ' + ind.unit : ''));
    const basis = a.yoy ? '전년 동월 대비' : '직전 대비';
    return { dir, text: `${arrow} ${body}`, basis, plain: `${basis} ${dir === 'down' ? '−' : dir === 'up' ? '+' : ''}${body}` };
  }

  /** 글자 줄바꿈 (한글은 글자 단위로 끊김) */
  function wrap(ctx, text, maxW, maxLines) {
    const out = []; let line = '';
    for (const ch of String(text || '')) {
      if (ctx.measureText(line + ch).width > maxW && line) {
        out.push(line); line = ch.trim() ? ch : '';
        if (out.length === maxLines) break;
      } else line += ch;
    }
    if (out.length < maxLines && line) out.push(line);
    const used = out.join('').length;
    if (used < String(text || '').replace(/\s+$/, '').length && out.length) {
      let last = out[out.length - 1];
      while (last && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
      out[out.length - 1] = last + '…';
    }
    return out;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  /** 차트 기간: 일간·주간 1년, 월간·분기 5년 */
  function chartPoints(a) {
    const asc = a.history.slice().reverse();
    if (asc.length < 2) return { pts: [], label: '' };
    const monthly = a.freq === 'M' || a.freq === 'Q';
    const days = monthly ? 1827 : 366;
    const from = Date.parse(asc[asc.length - 1].date) - days * DAY;
    const pts = asc.filter(p => Date.parse(p.date) >= from);
    return { pts: pts.length >= 2 ? pts : asc.slice(-2), label: monthly ? '최근 5년' : '최근 1년' };
  }

  function drawChart(ctx, a, x, y, w, h) {
    const { pts, label } = chartPoints(a);
    ctx.fillStyle = C.panel; roundRect(ctx, x, y, w, h, 28); ctx.fill();
    if (pts.length < 2) {
      ctx.fillStyle = C.text3; ctx.font = font(30); ctx.textAlign = 'center';
      ctx.fillText('차트 데이터 없음', x + w / 2, y + h / 2); ctx.textAlign = 'left';
      return;
    }
    const pad = { l: 32, r: 150, t: 64, b: 64 };
    const cx = x + pad.l, cy = y + pad.t, cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
    const lines = (a.levelLines || []).filter(l => isFinite(l.v));
    const ys = pts.map(p => p.value);
    let lo = Math.min(...ys), hi = Math.max(...ys);
    // 주의·경고선이 차트 범위 근처일 때만 함께 표시
    const span0 = hi - lo || Math.abs(hi) || 1;
    const shown = lines.filter(l => l.v >= lo - span0 * 0.6 && l.v <= hi + span0 * 0.6);
    shown.forEach(l => { lo = Math.min(lo, l.v); hi = Math.max(hi, l.v); });
    const span = hi - lo || 1; lo -= span * 0.08; hi += span * 0.08;
    const t0 = Date.parse(pts[0].date), t1 = Date.parse(pts[pts.length - 1].date) || t0 + 1;
    const X = d => cx + (Date.parse(d) - t0) / Math.max(1, t1 - t0) * cw;
    const Y = v => cy + (1 - (v - lo) / (hi - lo)) * ch;

    ctx.font = font(26, 600); ctx.fillStyle = C.text2;
    ctx.fillText(label, x + 32, y + 44);

    // 눈금 3개
    ctx.font = font(24); ctx.fillStyle = C.text3; ctx.strokeStyle = C.line; ctx.lineWidth = 2;
    [hi - (hi - lo) * 0.08, (hi + lo) / 2, lo + (hi - lo) * 0.08].forEach(v => {
      const yy = Y(v);
      ctx.beginPath(); ctx.moveTo(cx, yy); ctx.lineTo(cx + cw, yy); ctx.stroke();
      ctx.fillText(fmt(v, Math.min(a.ind.dp, 2)), cx + cw + 16, yy + 8);
    });
    // 주의·경고선 (두 선이 가까우면 글자를 선 위·아래로 나눠 겹치지 않게)
    let lastLabelY = null;
    shown.slice().sort((p, q) => Y(p.v) - Y(q.v)).forEach(l => {
      const col = l.k === 'danger' ? C.sig[2][1] : C.sig[1][1], yy = Y(l.v);
      ctx.save(); ctx.setLineDash([12, 10]); ctx.strokeStyle = col; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx, yy); ctx.lineTo(cx + cw, yy); ctx.stroke(); ctx.restore();
      let ly = yy - 10;
      if (lastLabelY != null && ly - lastLabelY < 28) ly = yy + 30;
      lastLabelY = ly;
      ctx.fillStyle = col; ctx.font = font(22, 600);
      ctx.fillText(`${l.k === 'danger' ? '경고' : '주의'} ${fmt(l.v, Math.min(a.ind.dp, 2))}`, cx + 8, ly);
    });
    // 면적 + 선
    const grad = ctx.createLinearGradient(0, cy, 0, cy + ch);
    grad.addColorStop(0, 'rgba(59,91,219,0.22)'); grad.addColorStop(1, 'rgba(59,91,219,0)');
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(X(p.date), Y(p.value)) : ctx.moveTo(X(p.date), Y(p.value))));
    ctx.lineTo(X(pts[pts.length - 1].date), cy + ch); ctx.lineTo(X(pts[0].date), cy + ch); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(X(p.date), Y(p.value)) : ctx.moveTo(X(p.date), Y(p.value))));
    ctx.strokeStyle = C.accent; ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.stroke();
    const lp = pts[pts.length - 1];
    ctx.beginPath(); ctx.arc(X(lp.date), Y(lp.value), 10, 0, Math.PI * 2); ctx.fillStyle = C.accent; ctx.fill();
    // 시작·끝 날짜
    ctx.font = font(24); ctx.fillStyle = C.text3;
    ctx.fillText(fmtObsDate(pts[0].date, a.freq), cx, y + h - 22);
    ctx.textAlign = 'right'; ctx.fillText(fmtObsDate(lp.date, a.freq), cx + cw, y + h - 22); ctx.textAlign = 'left';
  }

  /** 공유 이미지 그리기 → canvas */
  function render(id) {
    const ind = IND[id], a = analyze(ind);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'alphabetic';
    const cat = (CONFIG.categories.find(c => c.id === ind.cat) || {}).label || '';
    let y = P + 8;

    // 머리: 분류 · 앱 이름
    ctx.font = font(28, 600); ctx.fillStyle = C.accent;
    ctx.fillText(cat ? `${cat} 지표` : '지표', P, y + 20);
    ctx.textAlign = 'right'; ctx.fillStyle = C.text3; ctx.font = font(28);
    ctx.fillText('매크로 대시보드', W - P, y + 20); ctx.textAlign = 'left';
    y += 92;

    // 지표 이름 + 설명
    ctx.font = font(60, 800); ctx.fillStyle = C.text;
    wrap(ctx, ind.name, W - P * 2, 2).forEach(l => { ctx.fillText(l, P, y); y += 74; });
    if (ind.sub) {
      ctx.font = font(30); ctx.fillStyle = C.text2;
      wrap(ctx, ind.sub, W - P * 2, 2).forEach(l => { ctx.fillText(l, P, y - 14); y += 42; });
    }
    y += 40;

    // 값 + 단위 + 신호등
    if (a.cur) {
      ctx.font = font(132, 800); ctx.fillStyle = C.text;
      const vTxt = fmt(a.value, ind.dp); ctx.fillText(vTxt, P - 4, y + 96);
      const vw = ctx.measureText(vTxt).width;
      ctx.font = font(42, 600); ctx.fillStyle = C.text2;
      ctx.fillText(ind.unit || '', P + vw + 14, y + 96);
      const sig = a.signal == null ? null : a.signal;
      const lab = sig == null ? '데이터 없음' : (a.moveLabel || SIGNAL_LABEL[sig]);
      const [bgc, fgc] = sig == null ? C.none : C.sig[sig];
      ctx.font = font(34, 700);
      const pw = ctx.measureText(lab).width + 76, px = W - P - pw, py = y + 30;
      ctx.fillStyle = bgc; roundRect(ctx, px, py, pw, 76, 38); ctx.fill();
      ctx.beginPath(); ctx.arc(px + 34, py + 38, 10, 0, Math.PI * 2); ctx.fillStyle = fgc; ctx.fill();
      ctx.fillText(lab, px + 54, py + 51);
      y += 150;

      const chg = changeInfo(a);
      if (chg) {
        ctx.font = font(44, 700); ctx.fillStyle = C[chg.dir];
        ctx.fillText(chg.text, P, y + 20);
        const cw = ctx.measureText(chg.text).width;
        ctx.font = font(30); ctx.fillStyle = C.text3;
        ctx.fillText(chg.basis, P + cw + 18, y + 18);
      }
      y += 60;
      ctx.font = font(28); ctx.fillStyle = C.text3;
      const raw = a.cur.source === 'auto' && a.meta ? (a.meta.source.split(':')[0] || '') : sourceName(a);
      const src = raw === 'Calc' ? '자동 계산' : raw;
      ctx.fillText(`기준일 ${fmtObsDate(a.cur.date, a.freq)}${src ? ' · 출처 ' + src : ''}`, P, y + 16);
      y += 44;

      // 1주·1개월·1년 변화
      const asc = a.history.slice().reverse();
      const periods = [['1주', 7], ['1개월', 30], ['1년', 365]].map(([l, d]) => [l, periodChange(asc, ind, d)]).filter(x => x[1]);
      if (periods.length) {
        let px2 = P; y += 18;
        periods.forEach(([l, v]) => {
          ctx.font = font(28); const lw = ctx.measureText(l + ' ').width;
          ctx.font = font(28, 700); const vw2 = ctx.measureText(v).width;
          const bw = lw + vw2 + 40;
          ctx.fillStyle = C.panel; roundRect(ctx, px2, y, bw, 56, 16); ctx.fill();
          ctx.font = font(28); ctx.fillStyle = C.text2; ctx.fillText(l + ' ', px2 + 20, y + 38);
          ctx.font = font(28, 700); ctx.fillStyle = C.text; ctx.fillText(v, px2 + 20 + lw, y + 38);
          px2 += bw + 14;
        });
        y += 56;
      }
    } else {
      ctx.font = font(36); ctx.fillStyle = C.text3; ctx.fillText('아직 값이 없습니다', P, y + 60); y += 120;
    }
    y += 32;

    // 차트 (남은 공간 중 해석·바닥글 자리를 빼고)
    ctx.font = font(32, 500);
    const commentLines = a.comment ? wrap(ctx, a.comment, W - P * 2, 3) : [];
    const footerH = 112, commentH = commentLines.length ? commentLines.length * 46 + 40 : 0;
    const chartH = Math.max(300, H - y - commentH - footerH - 40);
    if (a.cur) drawChart(ctx, a, P, y, W - P * 2, chartH);
    y += chartH + 40;

    // 한 줄 해석
    ctx.font = font(32, 500); ctx.fillStyle = C.text;
    commentLines.forEach(l => { ctx.fillText(l, P, y + 8); y += 46; });

    // 바닥글
    ctx.strokeStyle = C.line; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(P, H - footerH); ctx.lineTo(W - P, H - footerH); ctx.stroke();
    ctx.font = font(26); ctx.fillStyle = C.text3;
    ctx.fillText('정보 정리용 · 투자 권유나 매매 판단이 아닙니다', P, H - footerH + 50);
    ctx.textAlign = 'right';
    ctx.fillText(location.host + location.pathname.replace(/\/index\.html$/, '/').replace(/\/$/, ''), W - P, H - footerH + 50);
    ctx.textAlign = 'left';
    return { canvas: cv, a };
  }

  function shareText(id, a) {
    const ind = a.ind, chg = a.cur ? changeInfo(a) : null;
    const sig = a.signal == null ? '' : ` · ${a.moveLabel || SIGNAL_LABEL[a.signal]}`;
    const val = a.cur ? ` ${fmt(a.value, ind.dp)}${ind.unit ? ' ' + ind.unit : ''}` : '';
    const date = a.cur ? ` (${fmtObsDate(a.cur.date, a.freq)} 기준)` : '';
    return `${ind.name}${val}${chg ? ' ' + chg.plain : ''}${sig}${date}\n${linkFor(id)}`;
  }

  const toBlob = cv => new Promise((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('이미지를 만들지 못했습니다'))), 'image/png'));

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; }
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob), el = document.createElement('a');
    el.href = url; el.download = name; document.body.appendChild(el); el.click(); el.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  /** 🖼 이미지로 공유
   * 카톡 등은 이미지와 글을 함께 받으면 글을 버리므로, 설명·링크를 먼저 클립보드에 복사해 두고
   * 이미지를 보낸 뒤 대화창에 붙여넣게 함 (텔레그램처럼 글을 함께 받는 앱은 캡션으로도 붙음) */
  async function shareIndicator(id) {
    if (!id || !IND[id]) return;
    try {
      const a0 = analyze(IND[id]);
      const copied = await copyText(shareText(id, a0));
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const { canvas, a } = render(id);
      const text = shareText(id, a);
      const blob = await toBlob(canvas);
      const name = `${id}-${a.cur ? a.cur.date : DataStore.isoDate(new Date())}.png`;
      const file = new File([blob], name, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        if (copied) toast('설명·링크를 복사했어요 — 이미지를 보낸 뒤 붙여넣기 하세요');
        try { await navigator.share({ files: [file], text, title: a.ind.name }); return; }
        catch (e) { if (e && e.name === 'AbortError') return; /* 공유 실패 → 아래 대체 경로 */ }
      }
      download(blob, name);
      toast(copied ? '이미지를 저장하고 설명·링크를 복사했습니다' : '이미지를 저장했습니다');
    } catch (e) {
      toast('공유 이미지를 만들지 못했습니다: ' + e.message);
    }
  }

  /** 🔗 링크로 공유 — 요약 한 줄 + 링크 (카톡에선 링크 미리보기 카드로 보임) */
  async function shareLink(id) {
    if (!id || !IND[id]) return;
    const a = analyze(IND[id]);
    const full = shareText(id, a), line = full.split('\n')[0], url = linkFor(id);
    if (navigator.share) {
      try { await navigator.share({ title: a.ind.name, text: line, url }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const ok = await copyText(full);
    toast(ok ? '요약과 링크를 복사했습니다' : url);
  }

  /* ---------- 관계 분석(직접 비교) 공유: 두 지표 · 보기(요약·추이·사건 반응·비율) ---------- */
  const PAIR_TABS = { sum: '요약 · 겹친 차트', roll: '상관 추이', evt: '사건 반응', ratio: '비율' };
  const pairLink = (id, other, tab) => `${location.origin}${location.pathname}#ind=${encodeURIComponent(id)}&with=${encodeURIComponent(other)}&tab=${encodeURIComponent(tab)}`;
  const COL_A = C.accent, COL_B = '#e8890c';

  /** 선 차트 (여러 선 · 각자 축 또는 같은 축) */
  function drawLines(ctx, lines, keys, x, y, w, h, o = {}) {
    ctx.fillStyle = C.panel; roundRect(ctx, x, y, w, h, 28); ctx.fill();
    const pad = { l: 32, r: o.dual ? 32 : 150, t: o.title ? 84 : 64, b: 64 };
    const cx = x + pad.l, cy = y + pad.t, cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
    const range = v => { let lo = Math.min(...v), hi = Math.max(...v); if (o.lo != null) lo = o.lo; if (o.hi != null) hi = o.hi; const sp = hi - lo || 1; return o.lo != null ? [lo, hi] : [lo - sp * 0.06, hi + sp * 0.06]; };
    const all = lines.flatMap(l => l.v), common = range(all);
    if (o.title) { ctx.font = font(26, 600); ctx.fillStyle = C.text2; ctx.fillText(o.title, x + 32, y + 44); }
    const Yf = ([lo, hi]) => v => cy + (1 - (v - lo) / (hi - lo || 1)) * ch;
    if (!o.dual) {
      const Y = Yf(common), [lo, hi] = common;
      ctx.font = font(24); ctx.fillStyle = C.text3; ctx.strokeStyle = C.line; ctx.lineWidth = 2;
      [hi - (hi - lo) * 0.06, (hi + lo) / 2, lo + (hi - lo) * 0.06].forEach(v => {
        const yy = Y(v); ctx.beginPath(); ctx.moveTo(cx, yy); ctx.lineTo(cx + cw, yy); ctx.stroke();
        ctx.fillText(o.fmt ? o.fmt(v) : fmt(v, Math.abs(v) >= 100 ? 0 : 2), cx + cw + 16, yy + 8);
      });
      if (o.zero && lo < 0 && hi > 0) { ctx.save(); ctx.setLineDash([10, 8]); ctx.strokeStyle = C.text3; ctx.beginPath(); ctx.moveTo(cx, Y(0)); ctx.lineTo(cx + cw, Y(0)); ctx.stroke(); ctx.restore(); }
    }
    lines.forEach(l => {
      const Y = Yf(o.dual ? range(l.v) : common), n = l.v.length;
      const X = i => cx + i / Math.max(1, n - 1) * cw;
      ctx.beginPath(); l.v.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
      ctx.strokeStyle = l.c; ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.beginPath(); ctx.arc(X(n - 1), Y(l.v[n - 1]), 9, 0, Math.PI * 2); ctx.fillStyle = l.c; ctx.fill();
    });
    ctx.font = font(24); ctx.fillStyle = C.text3;
    if (keys && keys.length) { ctx.fillText(keys[0], cx, y + h - 22); ctx.textAlign = 'right'; ctx.fillText(keys[keys.length - 1], cx + cw, y + h - 22); ctx.textAlign = 'left'; }
  }

  /** 화면의 문장들 (그 보기에서 실제로 보이는 해석 그대로) */
  const screenSays = () => [...document.querySelectorAll('#corrOut .corr-say')].map(e => e.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean);

  function renderPair(id, other, tab) {
    const A = corrSeries(id), B = corrSeries(other);
    if (!A || !B) throw new Error('비교할 이력이 부족합니다');
    const na = IND[id].name, nb = IND[other].name;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    let y = P + 8;
    ctx.font = font(28, 600); ctx.fillStyle = C.accent; ctx.fillText(`관계 분석 · ${PAIR_TABS[tab] || ''}`, P, y + 20);
    ctx.textAlign = 'right'; ctx.fillStyle = C.text3; ctx.font = font(28); ctx.fillText('매크로 대시보드', W - P, y + 20); ctx.textAlign = 'left';
    y += 92;
    // 제목: 색 점 + 두 지표 이름
    ctx.font = font(50, 800);
    [[na, COL_A], [nb, COL_B]].forEach(([n, c], i) => {
      ctx.beginPath(); ctx.arc(P + 14, y - 16, 14, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill();
      ctx.fillStyle = C.text; const l = wrap(ctx, n, W - P * 2 - 44, 1)[0]; ctx.fillText(l, P + 44, y); y += 66;
    });
    y += 10;
    // 요약: 기간별 상관 상자
    if (tab === 'sum') {
      const p = CORR.pair(A, B), bw = (W - P * 2 - 28) / 3;
      p.windows.forEach((wd, i) => {
        const bx = P + i * (bw + 14);
        ctx.fillStyle = C.panel; roundRect(ctx, bx, y, bw, 120, 20); ctx.fill();
        ctx.font = font(26); ctx.fillStyle = C.text2; ctx.fillText(wd.label, bx + 24, y + 40);
        ctx.font = font(44, 800); ctx.fillStyle = wd.r == null ? C.text3 : wd.r >= 0 ? C.up : C.down;
        ctx.fillText(wd.r == null ? '—' : (wd.r > 0 ? '+' : '') + wd.r.toFixed(2), bx + 24, y + 96);
      });
      y += 144;
    }
    // 해석 문장 (최대 4개 · 각 3줄)
    ctx.font = font(30, 500);
    for (const t of screenSays().slice(0, tab === 'sum' ? 3 : 2)) {
      const ls = wrap(ctx, t, W - P * 2, 3); ctx.fillStyle = C.text;
      ls.forEach(l => { ctx.fillText(l, P, y + 30); y += 42; }); y += 12;
    }
    y += 12;
    const footerH = 112, chartH = Math.max(320, H - y - footerH - 120);
    if (tab === 'evt') {
      // 사건 반응 표
      const rows = [...document.querySelectorAll('#corrOut .corr-tbl tr')].map(tr => [...tr.children].map(td => td.innerText.trim()));
      const colX = [P, P + 230, P + 380, P + 580, P + 780];
      rows.forEach((r, i) => {
        if (i) { ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(P, y - 4); ctx.lineTo(W - P, y - 4); ctx.stroke(); }
        ctx.font = font(i ? 32 : 26, i ? 600 : 500); ctx.fillStyle = i ? C.text : C.text3;
        // 칸이 합쳐진 행(사례 부족)은 마지막 칸을 끝까지 펼침
        r.forEach((c, j) => ctx.fillText(wrap(ctx, c, (j === r.length - 1 ? W - P : (colX[j + 1] || W - P)) - colX[j] - 16, 1)[0] || '', colX[j], y + 40));
        y += 66;
      });
      y += 20;
      ctx.font = font(26); ctx.fillStyle = C.text3;
      const recent = [...document.querySelectorAll('#corrOut .corr-note')].map(e => e.innerText.trim()).find(t => t.startsWith('최근 사례'));
      if (recent) { ctx.font = font(28); ctx.fillStyle = C.text2; wrap(ctx, recent, W - P * 2, 2).forEach(l => { ctx.fillText(l, P, y + 20); y += 40; }); y += 8; ctx.font = font(26); ctx.fillStyle = C.text3; }
      wrap(ctx, '과거 평균일 뿐 예측이 아님 · 사례가 적으면 우연일 수 있음', W - P * 2, 2).forEach(l => { ctx.fillText(l, P, y + 20); y += 36; });
    } else {
      let lines, keys, opt, legend;
      if (tab === 'roll') {
        const ro = CORR.rolling(A, B);
        lines = [{ v: ro.pts.map(x => x.r), c: COL_A }]; keys = [ro.pts[0].key, ro.pts[ro.pts.length - 1].key];
        opt = { lo: -1, hi: 1, zero: true, title: `${ro.basis === 'M' ? '3년(월간)' : '1년(주간)'} 이동 상관 · 위 = 같은 방향, 아래 = 반대`, fmt: v => (v > 0 ? '+' : '') + v.toFixed(1) };
        legend = [];
      } else if (tab === 'ratio') {
        const ra = CORR.ratio(A, B);
        lines = [{ v: ra.vals, c: COL_A }]; keys = [ra.keys[0], ra.keys[ra.keys.length - 1]];
        opt = { zero: ra.kind === 'diff', title: ra.kind === 'ratio' ? `${na} ÷ ${nb}` : `${na} − ${nb}`, fmt: v => fmtSig(v) };
        legend = [];
      } else {
        const ov = CORR.overlay(A, B, A.freq === 'M' || B.freq === 'M' ? 60 : 104);
        const dual = (DataStore.getSettings().corrDual ?? true) !== false;
        lines = [{ v: dual ? ov.ra : ov.a, c: COL_A }, { v: dual ? ov.rb : ov.b, c: COL_B }]; keys = [ov.keys[0], ov.keys[ov.keys.length - 1]];
        opt = { dual, title: dual ? '겹친 차트 · 각자 축 (모양 비교)' : '겹친 차트 · 시작=100' };
        const rng = (v, k) => `${fmtSig(Math.min(...v))}~${fmtSig(Math.max(...v))}${IND[k].unit ? ' ' + IND[k].unit : ''}`;
        legend = [[na, COL_A, dual ? rng(ov.ra, id) : ''], [nb, COL_B, dual ? rng(ov.rb, other) : '']];
      }
      drawLines(ctx, lines, keys, P, y, W - P * 2, chartH, opt);
      y += chartH + 24;
      ctx.font = font(26);
      legend.forEach(([n, c, r]) => {
        ctx.fillStyle = c; roundRect(ctx, P, y + 8, 28, 8, 4); ctx.fill();
        ctx.fillStyle = C.text2; ctx.fillText(wrap(ctx, `${n}${r ? '  ' + r : ''}`, W - P * 2 - 44, 1)[0], P + 40, y + 20); y += 40;
      });
    }
    ctx.strokeStyle = C.line; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(P, H - footerH); ctx.lineTo(W - P, H - footerH); ctx.stroke();
    ctx.font = font(26); ctx.fillStyle = C.text3;
    ctx.fillText('같이 움직였다고 원인·결과는 아님 · 투자 권유 아님', P, H - footerH + 50);
    ctx.textAlign = 'right';
    ctx.fillText(location.host + location.pathname.replace(/\/index\.html$/, '/').replace(/\/$/, ''), W - P, H - footerH + 50);
    ctx.textAlign = 'left';
    return { canvas: cv };
  }
  function pairText(id, other, tab) {
    const say = screenSays()[0] || '';
    return `${IND[id].name} ↔ ${IND[other].name} — ${PAIR_TABS[tab] || ''}${say ? '\n' + say : ''}\n${pairLink(id, other, tab)}`;
  }
  /** 🖼 비교 화면 이미지 공유 */
  async function sharePair(id, other, tab) {
    if (!IND[id] || !IND[other]) return;
    try {
      const text = pairText(id, other, tab);
      const copied = await copyText(text);
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const blob = await toBlob(renderPair(id, other, tab).canvas);
      const name = `${id}-vs-${other}-${tab}.png`;
      const file = new File([blob], name, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        if (copied) toast('설명·링크를 복사했어요 — 이미지를 보낸 뒤 붙여넣기 하세요');
        try { await navigator.share({ files: [file], text, title: `${IND[id].name} ↔ ${IND[other].name}` }); return; }
        catch (e) { if (e && e.name === 'AbortError') return; }
      }
      download(blob, name);
      toast(copied ? '이미지를 저장하고 설명·링크를 복사했습니다' : '이미지를 저장했습니다');
    } catch (e) { toast('공유 이미지를 만들지 못했습니다: ' + e.message); }
  }
  /** 🔗 비교 화면 링크 공유 — 열면 같은 두 지표·같은 보기로 바로 열림 */
  async function sharePairLink(id, other, tab) {
    if (!IND[id] || !IND[other]) return;
    const full = pairText(id, other, tab), lines = full.split('\n'), url = pairLink(id, other, tab);
    if (navigator.share) {
      try { await navigator.share({ title: `${IND[id].name} ↔ ${IND[other].name}`, text: lines.slice(0, -1).join('\n'), url }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const ok = await copyText(full);
    toast(ok ? '요약과 링크를 복사했습니다' : url);
  }

  global.Share = { shareIndicator, shareLink, render, shareText, linkFor, renderPair, sharePair, sharePairLink, pairLink };
})(window);
