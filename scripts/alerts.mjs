#!/usr/bin/env node
/* =====================================================================
 * 긴급 경고 판단 + (선택) 텔레그램 알림 — 외부 패키지 없음
 *
 *   node scripts/alerts.mjs --data _site/data/latest.json --out _site/data/alerts.json [--previous alerts-previous.json]
 *
 * 수집이 끝날 때마다(하루 3번) 실행됩니다.
 *   - data/alerts.json 에 지금 유효한 경고를 씁니다 → 앱 맨 위에 빨간 배너로 표시
 *   - 'critical' 경고가 새로 생기면 텔레그램으로 한 번 보냅니다 (같은 경고는 다시 보내지 않음)
 *
 * 환경 변수 (선택. 없으면 앱 배너만 표시)
 *   TELEGRAM_BOT_TOKEN — 텔레그램 봇 토큰 (@BotFather 에서 발급)
 *   TELEGRAM_CHAT_ID   — 받을 채팅 ID (없으면 봇에게 최근 24시간 안에 보낸 메시지에서 자동으로 찾음)
 *   TELEGRAM_TEST      — 'true' 면 연결 확인용 테스트 메시지를 보냄 (수동 실행의 telegram_test 체크)
 *
 * 경고 규칙은 아래 RULES 에 추가합니다. 실패해도 작업 전체를 실패시키지 않습니다.
 * ===================================================================== */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const DATA = arg('--data', 'data/latest.json');
const OUT = arg('--out', 'data/alerts.json');
const PREV = arg('--previous', null);
const TG_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
let TG_CHAT = (process.env.TELEGRAM_CHAT_ID || '').trim();
const TG_TEST = String(process.env.TELEGRAM_TEST || '').toLowerCase() === 'true';
const DAY = 86400000;

const r1 = v => Math.round(v * 10) / 10;
const sign = (v, dp = 1) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(dp);
function valueBefore(obs, days) {
  const t = Date.parse(obs[obs.length - 1][0]) - days * DAY;
  for (let i = obs.length - 2; i >= 0; i--) if (Date.parse(obs[i][0]) <= t) return obs[i][1];
  return null;
}
/** 같은 주(±4일) 과거 5년 평균 대비 % */
function seasonDev(obs) {
  const last = obs[obs.length - 1], vals = [];
  for (let k = 1; k <= 5; k++) {
    const t = Date.parse(last[0]) - k * 364 * DAY;
    const e = obs.find(o => Math.abs(Date.parse(o[0]) - t) <= 4 * DAY);
    if (e) vals.push(e[1]);
  }
  if (vals.length < 3) return null;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return (last[1] - avg) / Math.abs(avg) * 100;
}

/* ---------- 경고 규칙 ----------
 * 각 규칙: (series) => null 또는 { id, level: 'critical'|'warn', date, title, summary, points[], check }
 * 일반적인 해석만 쓰고, 매수·매도 같은 표현은 쓰지 않습니다. */
const RULES = [
  /** 정제 가동률 급락 ('지금 꺾이는 중'일 때만)
   *  - 한 주 −3%p 이상 → 긴급, 한 주 −2%p 이상 → 주의
   *  - 3주 누적 하락은 이번 주도 하락 중일 때만: 평소 −5%p 긴급 / −3.5%p 주의,
   *    정기 정비 시즌(2~4월, 9~10월)엔 계획된 하락이 흔해 −7%p 긴급 / −5%p 주의 */
  function refineryDrop(S) {
    const s = S.refinery_util; if (!s || s.obs.length < 5) return null;
    const o = s.obs, n = o.length, last = o[n - 1];
    const d1 = last[1] - o[n - 2][1], d3 = last[1] - o[n - 4][1];
    const m = new Date(last[0]).getUTCMonth() + 1, maint = [2, 3, 4, 9, 10].includes(m);
    const [c3, w3] = maint ? [-7, -5] : [-5, -3.5];
    const falling = d1 < 0;
    const level = d1 <= -3 || (falling && d3 <= c3) ? 'critical' : d1 <= -2 || (falling && d3 <= w3) ? 'warn' : null;
    if (!level) return null;
    const points = [`정제 가동률 ${last[1].toFixed(1)}% — 한 주 ${sign(d1)}%p, 3주 ${sign(d3)}%p`];
    const c = S.crack321;
    if (c && c.obs.length > 5) {
      const cv = c.obs[c.obs.length - 1][1], c7 = valueBefore(c.obs, 7);
      points.push(`3-2-1 크랙 스프레드 $${cv.toFixed(1)}/bbl${c7 != null ? ` (1주 ${sign(cv - c7)}달러)` : ''} — 오르면 제품 공급 부족이 가격에 반영 중`);
    }
    for (const [id, name] of [['us_distill', '디젤·난방유 재고'], ['us_gasoline', '휘발유 재고']]) {
      const x = S[id]; if (!x) continue;
      const dev = seasonDev(x.obs);
      if (dev != null) points.push(`${name} 평년 대비 ${sign(dev)}%${dev <= -5 ? ' — 완충 여력 부족' : ''}`);
    }
    if (maint) points.push('봄·가을 정기 정비 시즌 — 계획된 하락일 수 있지만, 한 주 3%p 이상은 이례적');
    return {
      id: 'refinery_drop', level, date: last[0],
      title: level === 'critical' ? '정제 가동률 급락' : '정제 가동률 빠른 하락',
      summary: level === 'critical'
        ? '정유 설비 차질(허리케인·사고·정전 등) 신호일 수 있습니다 → 휘발유·디젤 공급 부족, 제품 가격·정유 마진 급등 위험'
        : '정유 설비 가동이 빠르게 줄고 있습니다 → 제품 재고와 가격 흐름 확인',
      points,
      check: '다음 주 수요일 EIA 가동률 회복 여부 · 미국 걸프만 기상·정유소 사고 뉴스 · 디젤·휘발유 가격'
    };
  },

  /** 하이일드 스프레드 급확대 (일간, %p)
   *  최근 5거래일 저점 대비 +0.75%p 또는 1개월(약 22거래일) 저점 대비 +1.5%p → 긴급
   *  +0.4%p / +0.8%p → 주의. 이미 내려가는 중(직전 대비 −0.1%p 이하)이면 제외 */
  function hySpike(S) {
    const s = S.hy_spread; if (!s || s.obs.length < 25) return null;
    const o = s.obs, n = o.length, v = o[n - 1][1], d1 = v - o[n - 2][1];
    const lo5 = Math.min(...o.slice(n - 6, n).map(x => x[1])), lo22 = Math.min(...o.slice(n - 23, n).map(x => x[1]));
    const up5 = v - lo5, up22 = v - lo22;
    if (d1 <= -0.1) return null;
    const level = up5 >= 0.75 || up22 >= 1.5 ? 'critical' : up5 >= 0.4 || up22 >= 0.8 ? 'warn' : null;
    if (!level) return null;
    const points = [`하이일드 스프레드 ${v.toFixed(2)}%p — 1주 저점 대비 +${up5.toFixed(2)}%p, 1개월 저점 대비 +${up22.toFixed(2)}%p`];
    const ig = S.ig_spread; if (ig && ig.obs.length > 6) { const io = ig.obs, iv = io[io.length - 1][1]; points.push(`투자등급 스프레드 ${iv.toFixed(2)}%p (1주 ${sign(iv - io[io.length - 6][1], 2)}%p) — 같이 벌어지면 신용 불안이 넓게 번지는 중`); }
    const vx = S.vix; if (vx) points.push(`VIX ${vx.obs[vx.obs.length - 1][1].toFixed(1)}`);
    const kre = S.etf_kre; if (kre && kre.obs.length > 6) { const ko = kre.obs; points.push(`지역은행 ETF(KRE) 1주 ${sign((ko[ko.length - 1][1] / ko[ko.length - 6][1] - 1) * 100)}%`); }
    return {
      id: 'hy_spike', level, date: o[n - 1][0],
      title: level === 'critical' ? '하이일드 스프레드 급확대' : '하이일드 스프레드 빠른 확대',
      summary: level === 'critical'
        ? '신용 낮은 기업의 자금 조달 비용이 빠르게 오르고 있습니다 → 신용시장 경색·위험자산 급변동 위험'
        : '신용 가산금리가 빠르게 벌어지고 있습니다 → 신용시장 흐름 주시',
      points,
      check: '투자등급 스프레드 동반 확대 여부 · 은행·사모신용 관련 뉴스 · 주가지수·VIX'
    };
  },

  /** VIX 급등 (일간)
   *  긴급: 30 이상이면서 5거래일 저점 대비 +50% 이상, 또는 40 이상, 또는 하루 +50% 이상(25 이상일 때)
   *  주의: 22 이상이면서 5거래일 저점 대비 +30% 이상, 또는 하루 +25% 이상(18 이상일 때) */
  function vixSpike(S) {
    const s = S.vix; if (!s || s.obs.length < 7) return null;
    const o = s.obs, n = o.length, v = o[n - 1][1], d1p = (v / o[n - 2][1] - 1) * 100;
    const lo5 = Math.min(...o.slice(n - 6, n).map(x => x[1])), upLo = (v / lo5 - 1) * 100;
    const level = (v >= 30 && upLo >= 50) || v >= 40 || (d1p >= 50 && v >= 25) ? 'critical'
      : (v >= 22 && upLo >= 30) || (d1p >= 25 && v >= 18) ? 'warn' : null;
    if (!level) return null;
    const points = [`VIX ${v.toFixed(1)} — 하루 ${sign(d1p)}%, 5거래일 저점 대비 +${upLo.toFixed(0)}%`];
    for (const [id, name] of [['sp500', 'S&P 500'], ['nasdaq', '나스닥'], ['kospi', '코스피']]) {
      const x = S[id]; if (!x || x.obs.length < 2) continue;
      const xo = x.obs; points.push(`${name} 직전 대비 ${sign((xo[xo.length - 1][1] / xo[xo.length - 2][1] - 1) * 100)}%`);
    }
    const hy = S.hy_spread; if (hy) points.push(`하이일드 스프레드 ${hy.obs[hy.obs.length - 1][1].toFixed(2)}%p — 함께 벌어지면 단순 출렁임이 아닌 신용 불안`);
    return {
      id: 'vix_spike', level, date: o[n - 1][0],
      title: level === 'critical' ? 'VIX 급등 (공포 확대)' : 'VIX 빠른 상승',
      summary: level === 'critical'
        ? '시장의 공포 지수가 급등했습니다 → 주가 급변동, 빚을 낸 투자(레버리지)·신용 투자에 큰 부담'
        : '변동성이 빠르게 커지고 있습니다 → 시장 불안 확대 여부 주시',
      points,
      check: '하이일드 스프레드 동반 확대 여부 · 엔화 급강세(엔캐리 청산) · 다음 날 VIX 진정 여부'
    };
  }
];

/** 채팅 ID 자동 찾기: 사용자가 봇에게 보낸 최근 메시지(24시간 이내)에서 */
async function findChatId() {
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getUpdates`, { signal: AbortSignal.timeout(20000) });
  const j = await res.json();
  if (!j.ok) throw new Error(j.description || `HTTP ${res.status}`);
  const ups = (j.result || []).map(u => u.message || u.edited_message || u.channel_post || u.my_chat_member).filter(Boolean);
  const last = ups[ups.length - 1];
  return last && last.chat ? String(last.chat.id) : '';
}

async function sendTelegram(text) {
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}

async function main() {
  const latest = JSON.parse(await readFile(DATA, 'utf8'));
  let prev = { sent: [] };
  if (PREV) { try { prev = JSON.parse(await readFile(PREV, 'utf8')); } catch (e) { /* 첫 실행 */ } }

  // 채팅 ID 가 없으면 봇의 최근 메시지에서 찾기 (공개 로그에는 ID 를 찍지 않음)
  let autoChat = false;
  if (TG_TOKEN && !TG_CHAT) {
    try { TG_CHAT = await findChatId(); autoChat = !!TG_CHAT; console.log(TG_CHAT ? '  텔레그램 채팅 ID 자동 확인됨 (Secret 미등록)' : '  텔레그램: 채팅 ID 없음 — 봇에게 /start 를 보낸 뒤 24시간 안에 다시 실행하세요'); }
    catch (e) { console.log(`  텔레그램 채팅 ID 확인 실패: ${e.message}`); }
  }
  if (TG_TEST) {
    if (!TG_TOKEN) console.log('  텔레그램 테스트: TELEGRAM_BOT_TOKEN Secret 이 없습니다');
    else if (!TG_CHAT) console.log('  텔레그램 테스트: 보낼 채팅을 못 찾음 — 봇에게 /start 를 보낸 뒤 다시 실행하세요');
    else {
      const msg = ['✅ 매크로 대시보드 알림 연결 성공', '긴급 경고(정제 가동률 급락·하이일드 스프레드 급확대·VIX 급등)와 아침 AI 브리핑을 여기로 보냅니다.',
        ...(autoChat ? ['', `이 채팅 ID: ${TG_CHAT}`, '→ 저장소 Secret TELEGRAM_CHAT_ID 에 이 숫자를 등록하면 계속 받을 수 있습니다.'] : [])].join('\n');
      try { await sendTelegram(msg); console.log('  텔레그램 테스트 메시지 전송 완료'); }
      catch (e) { console.log(`  텔레그램 테스트 전송 실패: ${e.message}`); }
    }
  }

  const active = [];
  for (const rule of RULES) {
    try { const a = rule(latest.series || {}); if (a) active.push(a); }
    catch (e) { console.log(`  규칙 ${rule.name} 오류: ${e.message}`); }
  }

  active.sort((x, y) => (y.level === 'critical') - (x.level === 'critical'));   // 긴급 먼저

  // 텔레그램: critical 경고가 '새로' 생겼을 때만 (직전 실행에도 critical 이었으면 안 보냄) + 같은 경고는 72시간 안에 다시 안 보냄
  const prevCrit = new Set((prev.active || []).filter(x => x.level === 'critical').map(x => x.id));
  const lastSent = Object.assign({}, prev.lastSent || {});
  for (const k of prev.sent || []) { const [id] = k.split(':'); if (!lastSent[id]) lastSent[id] = prev.generatedAt; }   // 예전 형식 호환
  for (const a of active.filter(x => x.level === 'critical')) {
    const recent = lastSent[a.id] && Date.now() - Date.parse(lastSent[a.id]) < 72 * 3600000;
    if (prevCrit.has(a.id) || recent) continue;
    if (!TG_TOKEN || !TG_CHAT) { console.log(`  (텔레그램 미설정 — 앱 배너로만 표시) ${a.title}`); continue; }
    const text = [`🚨 [매크로 대시보드] ${a.title} (${a.date})`, a.summary, ...a.points.map(p => `• ${p}`), `확인: ${a.check}`,
      '※ 정보 정리용이며 투자 권유나 매매 판단이 아닙니다.'].join('\n');
    try { await sendTelegram(text); lastSent[a.id] = new Date().toISOString(); console.log(`  텔레그램 전송: ${a.title}`); }
    catch (e) { console.log(`  텔레그램 전송 실패: ${e.message}`); }
  }

  const out = { generatedAt: new Date().toISOString(), active, lastSent };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out));
  console.log(active.length ? `긴급 경고 ${active.length}건: ${active.map(a => `${a.level} ${a.title} — ${a.points[0]}`).join(' / ')}` : '긴급 경고 없음');
}

main().catch(e => console.log(`경고 판단 오류: ${e.message}`)).then(() => process.exit(0));
