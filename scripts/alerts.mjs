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
 *   TELEGRAM_CHAT_ID   — 받을 채팅 ID
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
const TG_CHAT = (process.env.TELEGRAM_CHAT_ID || '').trim();
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
  }
];

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

  const active = [];
  for (const rule of RULES) {
    try { const a = rule(latest.series || {}); if (a) active.push(a); }
    catch (e) { console.log(`  규칙 ${rule.name} 오류: ${e.message}`); }
  }

  // 텔레그램: 새로 생긴 critical 경고만 한 번
  const sent = new Set(prev.sent || []);
  for (const a of active.filter(x => x.level === 'critical')) {
    const key = `${a.id}:${a.date}`;
    if (sent.has(key)) continue;
    if (!TG_TOKEN || !TG_CHAT) { console.log(`  (텔레그램 미설정 — 앱 배너로만 표시) ${a.title}`); continue; }
    const text = [`🚨 [매크로 대시보드] ${a.title} (${a.date})`, a.summary, ...a.points.map(p => `• ${p}`), `확인: ${a.check}`,
      '※ 정보 정리용이며 투자 권유나 매매 판단이 아닙니다.'].join('\n');
    try { await sendTelegram(text); sent.add(key); console.log(`  텔레그램 전송: ${a.title}`); }
    catch (e) { console.log(`  텔레그램 전송 실패: ${e.message}`); }
  }

  const out = { generatedAt: new Date().toISOString(), active, sent: [...sent].slice(-50) };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out));
  console.log(active.length ? `긴급 경고 ${active.length}건: ${active.map(a => `${a.level} ${a.title} — ${a.points[0]}`).join(' / ')}` : '긴급 경고 없음');
}

main().catch(e => console.log(`경고 판단 오류: ${e.message}`)).then(() => process.exit(0));
