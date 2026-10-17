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

  /** 공유 버튼 */
  async function shareIndicator(id) {
    if (!id || !IND[id]) return;
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const { canvas, a } = render(id);
      const text = shareText(id, a);
      const blob = await toBlob(canvas);
      const name = `${id}-${a.cur ? a.cur.date : DataStore.isoDate(new Date())}.png`;
      const file = new File([blob], name, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], text, title: a.ind.name }); return; }
        catch (e) { if (e && e.name === 'AbortError') return; /* 공유 실패 → 아래 대체 경로 */ }
      }
      download(blob, name);
      const copied = await copyText(text);
      toast(copied ? '이미지를 저장하고 설명·링크를 복사했습니다' : '이미지를 저장했습니다');
    } catch (e) {
      toast('공유 이미지를 만들지 못했습니다: ' + e.message);
    }
  }

  /** 링크만 복사 (길게 누를 때 등 보조용) */
  async function copyLink(id) {
    const ok = await copyText(linkFor(id));
    toast(ok ? '바로가기 링크를 복사했습니다' : linkFor(id));
  }

  global.Share = { shareIndicator, copyLink, render, shareText, linkFor };
})(window);
