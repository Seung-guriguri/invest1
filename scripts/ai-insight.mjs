#!/usr/bin/env node
/* =====================================================================
 * AI 인사이트 생성 (Gemini, 하루 1회) — 외부 패키지 없음
 *
 *   node scripts/ai-insight.mjs --data _site/data/latest.json --out _site/data/ai.json [--previous ai-previous.json]
 *
 * 환경 변수
 *   GEMINI_API_KEY  — 없으면 건너뜀 (이전 해설 유지)
 *   GEMINI_MODEL    — 선택. 비우면 사용 가능한 Flash 계열을 자동 선택
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID — 있으면 새로 만든 브리핑을 텔레그램으로도 보냄
 *   SITE_URL        — 텔레그램 메시지에 붙일 사이트 주소
 *   AI_RUN          — 'true' 일 때만 호출 (평일 07:23 예약 실행 또는 수동 실행). 그 외에는 이전 해설을 그대로 복사
 *   AI_SCHEDULED    — 'true'(예약 실행)이면, 오늘(한국시간) 이미 만든 브리핑이 있을 때 다시 만들지 않음
 *                     (GitHub 예약 실행이 몇 시간 늦게 도는 경우 중복 발송 방지. 수동 실행은 항상 새로 생성)
 *
 * 프롬프트는 prompts/ai-system.md (역할·규칙), prompts/ai-user.md (데이터 틀),
 * 월요일(한국시간) 실행 또는 AI_WEEKLY=true 이면 '주간판' — 지난주(월~금) 정리 + 이번 주 볼 것 (브리핑·리포트·칼럼·관심 종목 모두)
 * prompts/ai-column.md (오늘의 칼럼 — 섹션별 헤드라인 + 3~5줄의 짧은 칼럼, 추가 호출 1회),
 * prompts/ai-watchlist.md (관심 종목·ETF — 텔레그램 전용, 앱·ai.json 에는 저장하지 않음, 추가 호출 1회) 에서 읽습니다.
 * 실패해도 작업 전체를 실패시키지 않고 이전 해설을 유지합니다.
 * ===================================================================== */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import '../season.js';   // globalThis.SEASON 등록
import { SOURCES } from './sources.mjs';
import { closes, retAfter, retSoFar } from './watch-perf.mjs';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const DATA = arg('--data', 'data/latest.json');
const OUT = arg('--out', 'data/ai.json');
const PREV = arg('--previous', null);
const KEY = (process.env.GEMINI_API_KEY || '').trim();
const MODEL = (process.env.GEMINI_MODEL || '').trim();
const RUN = String(process.env.AI_RUN || '').toLowerCase() === 'true';
const SCHEDULED = String(process.env.AI_SCHEDULED || '').toLowerCase() === 'true';
// 주간판: 월요일(한국시간) 아침 실행 또는 AI_WEEKLY=true — 지난주(월~금)를 정리하고 이번 주를 내다보는 브리핑
const WEEKLY = String(process.env.AI_WEEKLY || '').toLowerCase() === 'true' || new Date(Date.now() + 9 * 3600000).getUTCDay() === 1;
const ED = WEEKLY ? { brief: '주간 AI 브리핑 (지난주 정리)', top: '지난주 꼭 볼 3가지', col: '주간 칼럼', icon: '🗓' } : { brief: '오늘의 AI 브리핑', top: '오늘 꼭 볼 3가지', col: '오늘의 칼럼', icon: '🌅' };
const WATCH_DIR = (process.env.WATCH_DIR || '').trim();   // 성적표용 기록 폴더 (배포하지 않는 private/)
const TG_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TG_CHAT = (process.env.TELEGRAM_CHAT_ID || '').trim();
// (선택) 공유 채널·그룹 — 브리핑·리포트 요약·칼럼·관심 종목도 같이 보냄 (성적표는 track.mjs 에서, 실패 알림은 개인 채팅에만)
const TG_SHARE = (process.env.TELEGRAM_SHARE_CHAT_ID || '').trim();
const SITE_URL = (process.env.SITE_URL || '').trim();
const API = 'https://generativelanguage.googleapis.com/v1beta';
const DAY = 86400000;

/* ---------- 이전 해설 유지 ---------- */
async function keepPrevious(reason, { fail = false } = {}) {
  console.log(`AI 인사이트: ${reason} → 이전 해설 유지`);
  // 생성하려다 실패한 경우만 텔레그램으로 알림 (실행 대상 아님·이미 생성됨은 알리지 않음)
  if (fail && RUN && TG_TOKEN && TG_CHAT) {
    const note = SCHEDULED && new Date(Date.now() + 9 * 3600000).getUTCHours() < 9 ? '\n09:23 백업 실행에서 한 번 더 시도합니다.' : '\nActions → Run workflow(AI 체크)로 다시 만들 수 있어요.';
    try {
      await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: TG_CHAT, text: `⚠️ AI 브리핑 생성 실패\n이유: ${String(reason).slice(0, 200)}\n앱에는 이전 브리핑이 그대로 표시됩니다.${note}`, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(20000)
      });
      console.log('  텔레그램으로 실패 알림 전송');
    } catch (e) { console.log(`  실패 알림 전송 실패: ${e.message}`); }
  }
  if (!PREV) return;
  try {
    const prev = await readFile(PREV, 'utf8');
    JSON.parse(prev);
    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT, prev);
    console.log('  이전 ai.json 복사 완료');
  } catch (e) { console.log('  이전 ai.json 없음'); }
}

/* ---------- 이번 달 계절 요인 (season.js, 브라우저와 같은 문구) ---------- */
function seasonNotes() {
  try { return globalThis.SEASON ? globalThis.SEASON.monthNotes() : []; } catch { return []; }
}

/* ---------- 지표 정보: index.html CONFIG 에서 이름·단위·변화 방식 읽기 ---------- */
async function readIndicatorMeta() {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const re = /\{ id: '([^']+)', cat: '([^']+)', name: '([^']+)'(?:, sub: '([^']*)')?, unit: '([^']*)', dp: (\d+), changeMode: '([a-z]+)'/g;
  const meta = {};
  for (const m of html.matchAll(re)) meta[m[1]] = { cat: m[2], name: m[3], sub: m[4] || '', unit: m[5], dp: +m[6], mode: m[7] };
  return meta;
}

/* ---------- 지표별 통계 ---------- */
const round = (v, dp = 2) => (v == null || !isFinite(v) ? null : Number(v.toFixed(dp)));
function change(mode, from, to) {
  if (from == null || to == null) return null;
  return mode === 'pct' ? (from === 0 ? null : (to - from) / Math.abs(from) * 100) : to - from;
}
function valueBefore(obs, idx, days) {
  const t = Date.parse(obs[idx][0]) - days * DAY;
  for (let i = idx - 1; i >= 0; i--) if (Date.parse(obs[i][0]) <= t) return obs[i][1];
  return null;
}
function stats(id, s, m, prevAt = null) {
  const obs = s.obs; const n = obs.length; if (n < 2) return null;
  const last = obs[n - 1], prev = obs[n - 2];
  const monthly = s.freq === 'M' || s.freq === 'Q';
  const c1 = idx => monthly ? (idx > 0 ? change(m.mode, obs[idx - 1][1], obs[idx][1]) : null) : change(m.mode, valueBefore(obs, idx, 30), obs[idx][1]);
  const chg1m = c1(n - 1);
  // 3개월·1년 변화 (월간은 3·12번째 전 발표, 분기는 1·4번째 전 발표)
  const back = (k) => n - 1 - k >= 0 ? obs[n - 1 - k][1] : null;
  const chgOver = (days, mBack, qBack) => s.freq === 'M' ? change(m.mode, back(mBack), last[1])
    : s.freq === 'Q' ? change(m.mode, back(qBack), last[1]) : change(m.mode, valueBefore(obs, n - 1, days), last[1]);
  const chg3m = chgOver(91, 3, 1), chg1y = chgOver(365, 12, 4);
  // 1주 변화 (주간판용): 일간 = 7일 전 대비, 주간 = 직전 발표 대비, 월간·분기 = 없음(대신 최근 7일 발표 여부)
  const chg1w = s.freq === 'W' ? change(m.mode, prev[1], last[1]) : s.freq === 'M' || s.freq === 'Q' ? null : change(m.mode, valueBefore(obs, n - 1, 7), last[1]);
  const released7d = (Date.now() - Date.parse(last[0])) / DAY <= 8;
  // 평소 1개월 변화폭 (표준편차) 대비 배수
  const hist = []; for (let i = 1; i < n - 1; i++) { const c = c1(i); if (c != null && isFinite(c)) hist.push(c); }
  let z = null;
  if (hist.length >= 12 && chg1m != null) {
    const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
    const sd = Math.sqrt(hist.reduce((a, b) => a + (b - mean) ** 2, 0) / hist.length);
    if (sd > 0) z = chg1m / sd;
  }
  // 분포 위치
  const years = { D: 2, W: 3, M: 10, Q: 10 }[s.freq] || 2;
  const from = Date.parse(last[0]) - years * 365.25 * DAY;
  const win = obs.filter(o => Date.parse(o[0]) >= from).map(o => o[1]);
  const position = win.length >= 12 ? (win.filter(v => v < last[1]).length + win.filter(v => v === last[1]).length / 2) / win.length * 100 : null;
  // 평년 대비 (주간 재고·저장량)
  let season = null;
  if (s.freq === 'W' && m.cat === 'stocks') {
    const vals = [];
    for (let k = 1; k <= 5; k++) { const t = Date.parse(last[0]) - k * 364 * DAY; const e = obs.find(o => Math.abs(Date.parse(o[0]) - t) <= 4 * DAY); if (e) vals.push(e[1]); }
    if (vals.length >= 3) { const avg = vals.reduce((a, b) => a + b, 0) / vals.length; season = (last[1] - avg) / Math.abs(avg) * 100; }
  }
  return {
    id, name: m.name + (m.sub ? ` (${m.sub})` : ''), cat: m.cat, unit: m.unit,
    value: round(last[1], Math.max(m.dp, 2)), date: last[0], freq: s.freq,
    chg_prev: round(change(m.mode, prev[1], last[1]), 2), chg_1w: round(chg1w, 2), released_7d: released7d, chg_1m: round(chg1m, 2), chg_3m: round(chg3m, 2), chg_1y: round(chg1y, 2),
    chg_unit: m.mode === 'pct' ? '%' : m.mode === 'pp' ? '%p' : m.unit,
    z_1m: round(z, 1), position: round(position, 0), season_dev: round(season, 1),
    ...(prevAt ? { chg_since_brief: sinceBrief(obs, m.mode, prevAt.asOf && prevAt.asOf[id] ? prevAt.asOf[id] : prevAt.at.slice(0, 10)) } : {})
  };
}

/** 지난 브리핑 시점 이후 변화 (그 뒤 새 관측치가 없으면 null) */
/** d: 지난 브리핑 때 그 지표의 마지막 기준일 (없으면 작성일) */
function sinceBrief(obs, mode, d) {
  const last = obs[obs.length - 1];
  if (last[0] <= d) return null;
  let base = null; for (const o of obs) { if (o[0] <= d) base = o[1]; else break; }
  return base == null ? null : round(change(mode, base, last[1]), 2);
}

/** 지난 브리핑 요약 (프롬프트용). 없으면 null */
function previousBlock(prev, rows = []) {
  if (!prev || !prev.generatedAt || !prev.briefing) return null;
  const at = new Date(Date.parse(prev.generatedAt) + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
  const b = prev.briefing, lines = [`작성 시각: ${at} (한국시간)`];
  if (b.headline) lines.push(`제목: ${b.headline}`);
  if (b.watch && b.watch.length) lines.push(`확인할 것: ${b.watch.join(' / ')}`);
  if (b.counterpoint) lines.push(`반대 근거: ${b.counterpoint}`);
  if (prev.report && prev.report.regime && prev.report.regime.current) lines.push(`국면 판단: ${prev.report.regime.current}`);
  for (const c of CATS) { const x = prev.sections && prev.sections[c]; if (x) lines.push(`- ${c}: ${x.headline || ''} | ${x.body || ''}`); }
  const fresh = CATS.map(c => `${c} ${rows.filter(r => r.cat === c && r.chg_since_brief != null).length}개`);
  lines.push(`분류별 지난 브리핑 이후 새 데이터(chg_since_brief 가 null 이 아닌 지표 수): ${fresh.join(', ')}`);
  return lines.join('\n');
}

/* 해설 대상: 1개월 변화가 이례적이거나 분포 양 끝·평년 대비 크게 벗어난 지표 */
/** 주간판 지시: 한 주 동안 크게 움직인 지표 · 이번 주 발표된 월간·주간 지표 · 이번 주 매일 브리핑 제목 */
function weeklyBlock(prevAI, rows) {
  const movers = rows.filter(r => r.chg_1w != null).map(r => {
    // 1주 변화를 평소 1개월 변화폭으로 나눠 크기 비교 (z_1m 의 기준을 빌림: |chg_1m / z_1m| = 평소 1개월 변화폭)
    const sd = r.z_1m ? Math.abs(r.chg_1m / r.z_1m) : null;
    return { r, s: sd ? Math.abs(r.chg_1w) / sd : 0 };
  }).sort((a, b) => b.s - a.s).slice(0, 10)
    .map(({ r }) => `- ${r.name}: 1주 ${r.chg_1w > 0 ? '+' : ''}${r.chg_1w}${r.chg_unit} (현재 ${r.value}${r.unit}, ${r.date})`);
  const released = rows.filter(r => r.released_7d && (r.freq === 'M' || r.freq === 'Q' || r.freq === 'W'))
    .map(r => `- ${r.name}: ${r.value}${r.unit} (${r.date}, 직전 대비 ${r.chg_prev > 0 ? '+' : ''}${r.chg_prev}${r.chg_unit})`).slice(0, 25);
  const hist = ((prevAI && prevAI.briefHistory) || []).filter(x => !x.weekly);
  // 기록이 아직 없으면(처음) 지난 브리핑 한 개라도
  if (!hist.length && prevAI && prevAI.briefing && prevAI.briefing.headline) hist.push({ date: new Date(Date.parse(prevAI.generatedAt) + 9 * 3600000).toISOString().slice(0, 10), headline: prevAI.briefing.headline, top3: prevAI.briefing.top3 || [] });
  const days = hist.slice(-6).map(x => `- ${x.date}: ${x.headline}${x.top3 && x.top3.length ? ` / ${x.top3.join(' · ')}` : ''}`);
  return `
[이번은 월요일 주간판입니다 — 아래 지시가 다른 지시보다 우선]
- 하루(금요일) 움직임이 아니라 지난주(월~금) 전체의 흐름을 다룹니다. 숫자는 chg_1w(1주 변화)를 중심으로 쓰고, 필요하면 chg_1m 으로 맥락을 더합니다.
- headline: 지난주를 한 줄로. top3: 지난주 가장 중요한 변화 3가지. story: 한 주의 줄거리(주초 → 주말 무엇이 바뀌었는지).
- points: 주간 변화 수치. korea: 지난주 흐름이 한국 투자자에게 이어지는 경로. watch: 이번 주에 확인할 데이터·발표 일정.
- sections: 각 분류의 '지난주' 이야기. review 는 지난주 매일 브리핑의 판단이 한 주 동안 맞았는지 점검.
- report 도 한 주 단위로 국면·시나리오를 정리합니다.

[지난주 가장 크게 움직인 지표 (평소 변동폭 대비 1주 변화 순)]
${movers.join('\n') || '없음'}

[지난주 새로 발표된 주간·월간 지표]
${released.join('\n') || '없음'}

[지난주 매일 브리핑 제목 — 주장은 사실 근거가 아니며, 한 주 데이터로 점검할 대상]
${days.join('\n') || '없음'}
`;
}
/* ---------- 에너지 3축: 원유·가스·석탄 현황 + 인과 연결 신호 (코드가 판정, AI 는 이 안에서만 연결을 고름) ---------- */
/** 연결마다 [지지]·[반대]·[해당 없음] — 숫자는 모두 데이터에서. 주간판이면 '최근 변화'를 1주 기준으로 */
function energyLinks(rows) {
  const R = Object.fromEntries(rows.map(r => [r.id, r]));
  const chg = r => (r ? (WEEKLY && r.chg_1w != null ? r.chg_1w : r.chg_1m) : null);
  const span = WEEKLY ? '1주' : '1개월';
  const f = (v, u) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${Math.round(v * 10) / 10}${u || ''}`);
  const mv = id => { const r = R[id]; return r ? `${r.name.split(' (')[0]} ${r.value}${r.unit || ''} (${r.date}, ${span} ${f(chg(r), r.chg_unit)})` : null; };
  const snap = {
    oil: [mv('wti'), mv('brent'), R.us_crude && R.us_crude.season_dev != null ? `미국 원유 재고 평년 대비 ${f(R.us_crude.season_dev, '%')}` : null, mv('crack321')].filter(Boolean),
    gas: [mv('natgas'), mv('ttf'), mv('jkm'), R.ng_storage && R.ng_storage.season_dev != null ? `미국 가스 저장량 평년 대비 ${f(R.ng_storage.season_dev, '%')}` : null, mv('lng_spread')].filter(Boolean),
    coal: [mv('coal'), mv('coal_jkm'), mv('coking_amr'), mv('etf_coal')].filter(Boolean)
  };
  const links = [];
  const add = (no, name, state, why) => links.push(`${no} ${name} [${state}] ${why}`);
  // ① 유가 → 아시아 LNG 장기계약가 (유가연동, 3~6개월 후행)
  const b3 = R.brent && R.brent.chg_3m;
  if (b3 != null) add('①', '유가→LNG 계약가', Math.abs(b3) >= 10 ? '지지' : '해당 없음', `브렌트 3개월 ${f(b3, '%')} — 10% 넘게 움직이면 3~6개월 뒤 유가연동 LNG 계약가에 같은 방향 압력`);
  // ② 가스 → 석탄 전환 (석탄÷JKM 7 아래 석탄 유리 / 16 위 가스 유리)
  const cj = R.coal_jkm, jp = R.coal_pw_jpn, kr = R.coal_pw_kor;
  if (cj) {
    const zone = cj.value < 7 ? '석탄이 가스보다 쌈(7 아래)' : cj.value > 16 ? '가스가 상대적으로 쌈(16 위)' : '중립 구간(7~16)';
    const used = [jp, kr].filter(r => r && r.chg_1y != null).map(r => `${r.name.split(' (')[0]} 전년 대비 ${f(r.chg_1y, '%p')}`);
    const shift = [jp, kr].filter(r => r && r.chg_1y != null);
    const against = cj.value < 7 && shift.length && shift.every(r => r.chg_1y <= 0) ? ' · 반대: 실제 석탄 발전 비중은 늘지 않음(전환 미확인)' : '';
    add('②', '가스→석탄 전환', cj.value < 7 || cj.value > 16 ? (against ? '지지·반대 공존' : '지지') : '해당 없음',
      `석탄÷JKM ${cj.value} (${cj.date} 기준, ${zone})${used.length ? ' · ' + used.join(' · ') : ''}${against}`);
  }
  // ③ 유럽 vs 아시아 LNG 쟁탈 (JKM − TTF 달러 환산)
  if (R.jkm && R.ttf && R.eurusd) {
    const d = R.jkm.value - R.ttf.value * R.eurusd.value / 3.412;
    add('③', '유럽 vs 아시아 LNG', Math.abs(d) >= 1 ? '지지' : '해당 없음', `JKM−TTF ${f(d, '$/MMBtu')} — ${d > 0 ? '아시아가 비쌈 → LNG 화물이 아시아로' : '유럽이 비쌈 → 화물이 유럽으로'}`);
  }
  // ④ 미국 가스 → LNG 수출 유인
  if (R.lng_spread) add('④', '미국 가스→LNG 수출', R.lng_spread.value >= 5 ? '지지' : '해당 없음',
    `LNG 수출 마진(TTF−HH) ${R.lng_spread.value}$/MMBtu${R.ng_storage && R.ng_storage.season_dev != null ? ` · 미국 저장량 평년 대비 ${f(R.ng_storage.season_dev, '%')}` : ''}`);
  // ⑤ 미국 내 가스↔석탄 발전 전환
  if (R.power_gas && R.power_coal && R.natgas) {
    const g = chg(R.power_gas), c = chg(R.power_coal), hh = chg(R.natgas);
    const sw = g != null && c != null && Math.sign(g) !== Math.sign(c) && Math.abs(g) + Math.abs(c) >= 2;
    add('⑤', '미국 가스↔석탄 발전', sw ? '지지' : '해당 없음', `가스 발전 비중 ${span} ${f(g, '%p')} · 석탄 ${f(c, '%p')} · 헨리허브 ${f(hh, '%')}`);
  }
  // ⑥ 공통 요인 (셋이 같은 방향 → 개별 수급보다 달러·경기·지정학)
  const tri = [R.brent || R.wti, R.jkm || R.natgas, R.coking_amr || R.etf_coal].map(chg);
  if (tri.every(v => v != null)) {
    const same = tri.every(v => v > 2) || tri.every(v => v < -2);
    add('⑥', '공통 요인', same ? '지지' : '해당 없음', `원유 ${f(tri[0], '%')} · 가스 ${f(tri[1], '%')} · 석탄(대용) ${f(tri[2], '%')}${R.dxy ? ` · 달러인덱스 ${f(chg(R.dxy), '%')}` : ''} (${span})`);
  }
  // ⑦ 원전 공백 → 가스 발전 수요
  if (R.nuclear_util) add('⑦', '원전 공백→가스 수요', R.nuclear_util.value < 85 ? '지지' : '해당 없음', `미국 원전 가동률 ${R.nuclear_util.value}%${R.power_gas ? ` · 가스 발전 비중 ${R.power_gas.value}%` : ''}`);
  return { snap, links };
}
function energyBlock(rows) {
  const { snap, links } = energyLinks(rows);
  const sec = (t, xs) => `${t}\n${xs.length ? xs.map(x => '- ' + x).join('\n') : '- 데이터 없음'}`;
  return [sec('원유', snap.oil), sec('가스', snap.gas), sec('석탄', snap.coal), sec('연결 신호 ([지지]인 것만 연결로 쓸 수 있음)', links)].join('\n\n');
}
/* ---------- 연결 블록 3개: 식량 체인·중국 철강 체인·한국 수입 부담 (에너지 3축과 같은 방식 — 코드가 판정, AI 는 [지지]만 사용) ---------- */
function chainLinks(rows) {
  const R = Object.fromEntries(rows.map(r => [r.id, r]));
  const chg = r => (r ? (WEEKLY && r.chg_1w != null ? r.chg_1w : r.chg_1m) : null);
  const span = WEEKLY ? '1주' : '1개월';
  const f = (v, u) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${Math.round(v * 10) / 10}${u || ''}`);
  const nm = r => r.name.split(' (')[0];
  // 월간 지표는 3개월 변화·기준월, 나머지는 1개월(주간판 1주)
  const mv = id => { const r = R[id]; if (!r) return null; const mo = r.freq === 'M' || r.freq === 'Q';
    return `${nm(r)} ${r.value}${r.unit || ''} (${mo ? r.date.slice(0, 7) + ' 기준, 3개월' : r.date + ', ' + span} ${f(mo ? r.chg_3m : chg(r), r.chg_unit)})`; };
  const sign = v => (v == null ? 0 : v > 0 ? 1 : v < 0 ? -1 : 0);
  const out = {};

  // 🌾 식량 체인: 가스 → 질소 비료 → 비료 구매력 → 곡물
  {
    const snap = ['ttf', 'natgas', 'fert_urea', 'fert_dap', 'fert_afford_urea', 'fert_afford_dap', 'fert_cf', 'fert_mos', 'corn', 'wheat', 'soybean'].map(mv).filter(Boolean);
    const links = []; const add = (no, name, state, why) => links.push(`${no} ${name} [${state}] ${why}`);
    const t3 = R.ttf && R.ttf.chg_3m, u3 = R.fert_urea && R.fert_urea.chg_3m;
    if (t3 != null && u3 != null) add('①', '가스→질소 비료 원가', Math.abs(t3) >= 10 && sign(t3) === sign(u3) ? '지지' : '해당 없음',
      `유럽 가스 3개월 ${f(t3, '%')} · 요소 3개월 ${f(u3, '%')} — 같은 방향으로 크게 움직이면 가스 원가가 요소값에 전가되는 중`);
    const a = R.fert_afford_urea, d = R.fert_afford_dap;
    const hi = [a, d].filter(r => r && r.position != null && r.position >= 80), lo = [a, d].filter(r => r && r.position != null && r.position <= 20);
    if (a || d) add('②', '비료 구매력→다음 시즌 생산', hi.length ? '지지' : lo.length ? '지지' : '해당 없음',
      [a, d].filter(Boolean).map(r => `${nm(r)} ${r.value}배 (${r.date.slice(0, 7)}, 최근 10년 중 위치 ${r.position ?? '—'})`).join(' · ') +
      (hi.length ? ' — 비료가 곡물 대비 비싼 구간: 비료 사용 축소 → 수확량 부담 유인' : lo.length ? ' — 비료가 싼 구간: 생산 여건 양호' : ''));
    const c3 = R.corn && R.corn.chg_3m;
    if (c3 != null && a && a.chg_3m != null) add('③', '농가 이중 부담', c3 <= -5 && a.chg_3m >= 5 ? '지지' : '해당 없음',
      `옥수수 3개월 ${f(c3, '%')} · 요소÷옥수수 3개월 ${f(a.chg_3m, '%')} — 곡물값은 내리고 비료 부담은 오르면 농가 수익성 악화`);
    const cf = chg(R.fert_cf), mos = chg(R.fert_mos), uc = R.fert_urea && R.fert_urea.chg_1m;
    if (cf != null && uc != null) add('④', '비료 기업 주가 vs 비료값', Math.abs(cf) >= 5 && sign(cf) !== sign(uc) && uc !== 0 ? '지지·반대 공존' : '해당 없음',
      `CF ${span} ${f(cf, '%')} · MOS ${f(mos, '%')} · 요소 직전월 대비 ${f(uc, '%')} — 엇갈리면 주가가 비료값을 앞서 반영 중일 수 있음`);
    const dx = chg(R.dxy), cm = chg(R.corn);
    if (dx != null && cm != null) add('⑤', '달러→곡물', Math.abs(dx) >= 1.5 && sign(dx) !== sign(cm) ? '지지' : '해당 없음',
      `달러인덱스 ${span} ${f(dx, '%')} · 옥수수 ${f(cm, '%')} — 달러 강세는 미국산 곡물 수출 가격 부담`);
    out.food = { snap, links };
  }

  // 🏗 중국 철강 체인: 철광석·원료탄·호주달러·위안화·벌크선
  {
    const snap = ['iron_ore', 'coking_amr', 'audusd', 'usdcny', 'bdry', 'copper', 'etf_pick'].map(mv).filter(Boolean);
    const links = []; const add = (no, name, state, why) => links.push(`${no} ${name} [${state}] ${why}`);
    const io = chg(R.iron_ore), amr = chg(R.coking_amr), aud = chg(R.audusd), cny = chg(R.usdcny), bd = chg(R.bdry);
    if (io != null && amr != null) add('①', '철광석·원료탄 동행', Math.abs(io) >= 3 && Math.abs(amr) >= 3 && sign(io) === sign(amr) ? '지지' : '해당 없음',
      `철광석 ${span} ${f(io, '%')} · 원료탄(AMR) ${f(amr, '%')} — 둘 다 같은 방향이면 철강 생산(고로) 수요 공통 요인`);
    if (io != null && aud != null) add('②', '호주달러 확인', Math.abs(io) >= 3 && sign(io) === sign(aud) ? '지지' : Math.abs(io) >= 3 ? '지지·반대 공존' : '해당 없음',
      `철광석 ${f(io, '%')} · 호주달러 ${f(aud, '%')} — 철광석 수출국 통화가 같이 움직이면 원자재 수요 신호가 진짜일 가능성`);
    if (io != null && cny != null) add('③', '위안화→중국 경기', cny >= 0.5 && io < 0 ? '지지' : cny <= -0.5 && io > 0 ? '지지' : '해당 없음',
      `위안/달러 ${span} ${f(cny, '%')} (오르면 위안 약세) · 철광석 ${f(io, '%')} — 위안 약세+철광석 하락이면 중국 경기 부진, 반대면 회복 기대`);
    if (io != null && bd != null) add('④', '벌크선 운임', Math.abs(bd) >= 5 && sign(bd) === sign(io) ? '지지' : '해당 없음',
      `벌크선(BDRY) ${span} ${f(bd, '%')} — 철광석과 같은 방향이면 실제 물동량 변화가 동반`);
    if (R.iron_ore && R.iron_ore.position != null) add('⑤', '철광석 가격 구간', R.iron_ore.position <= 20 || R.iron_ore.position >= 80 ? '지지' : '해당 없음',
      `철광석 최근 2년 중 위치 ${R.iron_ore.position} — ${R.iron_ore.position <= 20 ? '저점권: 중국 부동산·철강 수요 부진 구간' : R.iron_ore.position >= 80 ? '고점권: 중국 부양·철강 수요 강세 구간' : '중간 구간'}`);
    out.steel = { snap, links };
  }

  // 🇰🇷 한국 수입 부담: 원화 기준 유가·LNG·환율
  {
    const snap = ['usdkrw', 'brent', 'brent_krw', 'jkm', 'coal', 'kr_cpi'].map(mv).filter(Boolean);
    const links = []; const add = (no, name, state, why) => links.push(`${no} ${name} [${state}] ${why}`);
    const fx = chg(R.usdkrw), br = chg(R.brent), bk = chg(R.brent_krw), jk = chg(R.jkm);
    if (R.jkm && R.usdkrw) {
      const lngKrw = Math.round(R.jkm.value * R.usdkrw.value);
      const lc = jk != null && fx != null ? ((1 + jk / 100) * (1 + fx / 100) - 1) * 100 : null;
      snap.push(`원화 환산 LNG(JKM×원/달러) ${lngKrw.toLocaleString('en-US')}원/MMBtu (${span} ${f(lc, '%')}, 계산값)`);
      if (lc != null) add('①', 'LNG 원화 부담', Math.abs(lc) >= 5 ? '지지' : '해당 없음', `원화 LNG ${span} ${f(lc, '%')} = JKM ${f(jk, '%')} + 환율 ${f(fx, '%')}`);
    }
    if (br != null && bk != null && fx != null) {
      const cushion = Math.abs(bk) < Math.abs(br) && sign(fx) !== sign(br);
      const amplify = Math.abs(bk) > Math.abs(br) && sign(fx) === sign(br);
      add('②', '환율의 완충·증폭', cushion || amplify ? '지지' : '해당 없음',
        `브렌트(달러) ${span} ${f(br, '%')} vs 원화 브렌트 ${f(bk, '%')} · 원/달러 ${f(fx, '%')} — ${cushion ? '원화 강세가 유가 충격을 덜어줌' : amplify ? '원화 약세가 유가 부담을 키움' : '환율 효과 작음'}`);
    }
    if (R.brent_krw && R.brent_krw.position != null) add('③', '원화 유가 구간', R.brent_krw.position >= 80 || R.brent_krw.position <= 20 ? '지지' : '해당 없음',
      `원화 환산 브렌트 ${Math.round(R.brent_krw.value).toLocaleString('en-US')}원/bbl, 최근 2년 중 위치 ${R.brent_krw.position}`);
    const bk3 = R.brent_krw && R.brent_krw.chg_3m;
    if (bk3 != null && R.kr_cpi) add('④', '한국 물가 전이', Math.abs(bk3) >= 10 ? '지지' : '해당 없음',
      `원화 브렌트 3개월 ${f(bk3, '%')} — 10% 넘게 움직이면 1~3개월 뒤 국내 석유류 물가에 같은 방향 압력 · 한국 CPI ${R.kr_cpi.value}% (${R.kr_cpi.date.slice(0, 7)})`);
    out.korea = { snap, links };
  }
  return out;
}
const CHAIN_LABEL = { food: '식량 체인 (가스→비료→곡물)', steel: '중국 철강 체인 (철광석·원료탄·호주달러·위안화)', korea: '한국 수입 부담 (원화 기준 에너지)' };
function chainBlock(rows) {
  const ch = chainLinks(rows);
  return Object.entries(ch).map(([k, { snap, links }]) =>
    `■ ${k} — ${CHAIN_LABEL[k]}\n현황\n${snap.length ? snap.map(x => '- ' + x).join('\n') : '- 데이터 없음'}\n연결 신호 ([지지]인 것만 사용)\n${links.length ? links.map(x => '- ' + x).join('\n') : '- 판정할 데이터 없음'}`).join('\n\n');
}
function pickTargets(rows, max = 15) {
  const score = r => Math.max(
    r.z_1m != null ? Math.abs(r.z_1m) : 0,
    r.position != null ? Math.abs(r.position - 50) / 25 : 0,   // 0 또는 100 이면 2
    r.season_dev != null ? Math.abs(r.season_dev) / 5 : 0       // 평년 대비 ±10% 이면 2
  );
  return rows.map(r => ({ id: r.id, s: score(r) })).filter(x => x.s >= 1.2)
    .sort((a, b) => b.s - a.s).slice(0, max).map(x => x.id);
}
/** 해설 대상 한 줄: 왜 골랐는지 쉬운 말로 */
function targetLine(r) {
  const why = [];
  if (r.z_1m != null && Math.abs(r.z_1m) >= 1.2) why.push(`${r.freq === 'M' || r.freq === 'Q' ? '직전 발표 대비' : '1개월'} ${r.chg_1m > 0 ? '+' : ''}${r.chg_1m}${r.chg_unit} (평소의 ${Math.abs(r.z_1m)}배)`);
  if (r.position != null && (r.position >= 80 || r.position <= 20)) why.push(`최근 ${({ D: 2, W: 3 })[r.freq] || 10}년 중 ${r.position >= 50 ? '상위' : '하위'} ${Math.max(1, Math.round(r.position >= 50 ? 100 - r.position : r.position))}%`);
  if (r.season_dev != null && Math.abs(r.season_dev) >= 6) why.push(`평년 대비 ${r.season_dev > 0 ? '+' : ''}${r.season_dev}%`);
  return `- ${r.id} (${r.name.split(' (')[0]}): ${why.join(', ')}`;
}

/* ---------- Gemini 호출 ---------- */
// 이번 실행에서 무료 한도(429)를 다 쓴 모델 — 칼럼·관심 종목 호출에서 건너뜀
const quotaDead = new Set();
async function post(model, body) {
  const res = await fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(150000)   // 응답이 2분 30초 넘게 없으면 다음 모델로
  });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch (e) { j = null; }
  if (!res.ok) { const e = new Error(`HTTP ${res.status} ${(j && j.error && j.error.message) || text.slice(0, 200)}`); e.status = res.status; throw e; }
  return j;
}

/** 사용 가능한 Flash 계열 모델 이름 고르기 */
async function autoModels() {
  // 우선순위: 번호가 가장 높은 Flash → gemini-flash-latest → 번호가 가장 높은 Flash-Lite → gemini-flash-lite-latest
  const ver = n => Number((n.match(/^gemini-(\d+(?:\.\d+)?)-/) || [])[1] || 0);
  let names = [];
  try {
    const res = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': KEY }, signal: AbortSignal.timeout(20000) });
    const j = await res.json();
    names = (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace(/^models\//, ''));
  } catch (e) { /* 목록을 못 받으면 별칭만 사용 */ }
  const flash = names.filter(n => /^gemini-\d+(\.\d+)?-flash$/.test(n)).sort((x, y) => ver(y) - ver(x));
  const lite = names.filter(n => /^gemini-\d+(\.\d+)?-flash-lite$/.test(n)).sort((x, y) => ver(y) - ver(x));
  return [...new Set([...flash.slice(0, 1), 'gemini-flash-latest', ...lite.slice(0, 1), 'gemini-flash-lite-latest'])];
}

const CAT_LABEL = { rates: '금리', inflation: '물가', growth: '경기', market: '시장·신용', fx: '환율', energy: '에너지', power: '전력', freight: '운임', stocks: '비축·재고', metals: '금속', grains: '곡물', fert: '비료', etf: 'ETF' };

/** 새 브리핑을 텔레그램으로 (4096자 제한 안에서) */
/** 공유 채널에 같은 내용을 한 번 더 보냄 (설정했고 개인 채팅과 다를 때만) */
async function shareCopy(text, label) {
  if (!TG_TOKEN || !TG_SHARE || TG_SHARE === TG_CHAT) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_SHARE, text: text.slice(0, 4090), disable_web_page_preview: true }), signal: AbortSignal.timeout(20000)
    });
    console.log(res.ok ? `  공유 채널로 ${label} 전송 완료` : `  공유 채널 ${label} 전송 실패: HTTP ${res.status}`);
  } catch (e) { console.log(`  공유 채널 ${label} 전송 실패: ${e.message}`); }
}

async function sendBriefingTelegram(b, sections, kst, energy = {}, chains = {}) {
  if (!TG_TOKEN || !TG_CHAT) { console.log('  (텔레그램 미설정 — 브리핑 전송 건너뜀)'); return; }
  const lines = [`${ED.icon} ${ED.brief} · ${kst}`, '', `📌 ${b.headline || ''}`];
  if (b.top3 && b.top3.length) lines.push('', `✅ ${ED.top}`, ...b.top3.map((x, i) => `${i + 1}. ${x}`));
  lines.push('', b.story || '');
  if (b.points && b.points.length) lines.push('', '핵심 수치', ...b.points.map(x => `• ${x}`));
  if (b.korea) lines.push('', `🇰🇷 ${b.korea}`);
  if (b.watch && b.watch.length) lines.push('', `👀 확인할 것: ${b.watch.join(' · ')}`);
  if (b.counterpoint) lines.push('', `↔ 반대로 보면: ${b.counterpoint}`);
  // 에너지 3축 블록 (있으면 분류별 한 줄의 에너지는 생략해 중복 방지)
  const hasEnergy = !!(energy && (energy.oil || energy.gas || energy.coal));
  if (hasEnergy) {
    lines.push('', `⚡ 에너지${energy.headline ? ' — ' + energy.headline : ''}`);
    if (energy.oil) lines.push(`🛢 원유: ${energy.oil}`);
    if (energy.gas) lines.push(`🔥 가스: ${energy.gas}`);
    if (energy.coal) lines.push(`⛏ 석탄: ${energy.coal}`);
    if (energy.link) lines.push(`🔗 연결: ${energy.link}`);
    if (energy.counter) lines.push(`   반대 신호: ${energy.counter}`);
  }
  const CHAIN_TG = { food: '🌾 식량', steel: '🏗 중국 철강', korea: '🇰🇷 한국 수입 부담' };
  const chainLines = [];
  for (const [k, t] of Object.entries(CHAIN_TG)) {
    const c = chains && chains[k];
    if (c && c.body) chainLines.push('', `${t}${c.headline ? ' — ' + c.headline : ''}`, c.body, ...(c.counter ? [`   반대 신호: ${c.counter}`] : []));
  }
  lines.push(...chainLines);
  const secs = CATS.filter(c => sections[c] && sections[c].headline && !(hasEnergy && c === 'energy')).map(c => `• ${CAT_LABEL[c]} — ${sections[c].headline}`);
  if (secs.length) lines.push('', '분류별 한 줄', ...secs);
  const revs = CATS.filter(c => sections[c] && sections[c].review).map(c => `• ${CAT_LABEL[c]} — ${sections[c].review}`);
  if (revs.length) lines.push('', '↩ 지난 브리핑 점검', ...revs);
  if (SITE_URL) lines.push('', `전체 보기: ${SITE_URL}`);
  lines.push('', '※ AI가 생성한 일반적 해석이며 틀릴 수 있습니다. 투자 권유나 매매 판단이 아닙니다.');
  let text = lines.join('\n');
  // 너무 길면 '지난 브리핑 점검'을 먼저 빼서 맨 아래 안내 문구가 잘리지 않게
  if (text.length > 4000 && revs.length) text = lines.filter(l => !revs.includes(l) && l !== '↩ 지난 브리핑 점검').join('\n').replace(/\n{3,}/g, '\n\n');
  // 그래도 길면 연결 블록(식량·철강·한국)을 빼고 앱 안내 한 줄로
  if (text.length > 4000 && chainLines.length) {
    const drop = new Set(chainLines.filter(Boolean));
    text = lines.filter(l => !drop.has(l) && !revs.includes(l) && l !== '↩ 지난 브리핑 점검').join('\n').replace(/\n{3,}/g, '\n\n')
      .replace('\n\n분류별 한 줄', '\n\n🔗 식량·중국 철강·한국 수입 부담 연결 블록은 앱 AI 화면에서\n\n분류별 한 줄');
  }
  if (text.length > 4000) text = text.slice(0, 3990) + '…';
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text, disable_web_page_preview: true }), signal: AbortSignal.timeout(20000)
    });
    console.log(res.ok ? '  텔레그램으로 브리핑 전송 완료' : `  텔레그램 브리핑 전송 실패: HTTP ${res.status}`);
  } catch (e) { console.log(`  텔레그램 브리핑 전송 실패: ${e.message}`); }
  await shareCopy(text, '브리핑');
}

/* ---------- 오늘의 칼럼: 섹션형 짧은 칼럼 (브리핑 성공 뒤 1회 추가 호출) ----------
 * AI 는 제목·한 줄 정리·섹션(헤드라인 + 3~5줄)·근거 지표 ID 만 씀.
 * 기준일과 참고 자료(출처·기준일·링크)는 지표 ID 로 이 코드가 붙임 → 출처·링크를 AI 가 지어낼 수 없음. */
const COLUMN_SCHEMA = { type: 'OBJECT', properties: {
  title: { type: 'STRING' }, oneline: { type: 'STRING' },
  sections: { type: 'ARRAY', items: { type: 'OBJECT', properties: { head: { type: 'STRING' }, lines: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['head', 'lines'] } },
  refs: { type: 'ARRAY', items: { type: 'STRING' } }
}, required: ['title', 'oneline', 'sections', 'refs'] };

/** 지표 ID → 참고 자료 한 줄 (출처명 | 자료 | 기준일 | URL) */
function sourceRef(id, row, meta) {
  const s = (SOURCES[id] || [])[0];
  const name = (meta[id] && meta[id].name) || id;
  let src = null, url = null;
  if (s && s.fred) { src = 'FRED(세인트루이스 연준)'; url = `https://fred.stlouisfed.org/series/${s.fred}`; }
  else if (s && s.ecos) { src = '한국은행 경제통계시스템(ECOS)'; url = 'https://ecos.bok.or.kr/'; }
  else if (s && s.eia) { src = '미국 에너지정보청(EIA)'; url = s.eia.startsWith('NG.') ? 'https://ir.eia.gov/ngs/ngs.html' : 'https://www.eia.gov/petroleum/supply/weekly/'; }
  else if (s && s.eurostat) { src = 'Eurostat'; url = 'https://ec.europa.eu/eurostat/databrowser/'; }
  else if (s && s.yahoo) { src = 'Yahoo Finance'; url = `https://finance.yahoo.com/quote/${encodeURIComponent(s.yahoo)}`; }
  else if (s && s.wb) { src = 'World Bank 원자재 월간 가격(Pink Sheet)'; url = 'https://www.worldbank.org/en/research/commodity-markets'; }
  else src = '이 앱 계산값(여러 지표 조합)';
  return { id, src, name, date: row.date, url };
}

async function generateColumn(models, first, material) {
  const system = await readFile(new URL('../prompts/ai-column.md', import.meta.url), 'utf8');
  const recent = (material.recentTitles || []).length ? material.recentTitles.map(x => `- ${x.date} ${x.title}`).join('\n') : '(없음)';
  const user = `기준 시각: ${material.kst}\n\n[최근 칼럼 제목] (같은 주제·각도 반복 피하기)\n${recent}\n\n[오늘의 브리핑]\n${JSON.stringify(material.briefing)}\n\n[분류별 요약]\n${JSON.stringify(material.sections)}\n\n[지표 해설]\n${JSON.stringify(material.indicators)}${material.report ? `\n\n[리서치 리포트 — 국면·인사이트·상충 신호·시나리오]\n${JSON.stringify({ regime: material.report.regime, insights: material.report.insights, conflicts: material.report.conflicts, scenarios: material.report.scenarios })}` : ''}\n\n[주요 지표 숫자] (id 는 refs 에 쓰는 지표 ID, date 는 그 값의 기준일, position 은 최근 기간 안의 위치 0~100)\n${material.rows.map(r => JSON.stringify(r)).join('\n')}\n\n${WEEKLY ? '오늘은 월요일 주간판입니다. 하루 움직임이 아니라 지난주 전체의 흐름(브리핑의 지난주 정리)을 주제로, 이번 주에 무엇을 보면 되는지까지 이어지는 주간 칼럼을 쓰세요.' : '위 재료로 오늘의 칼럼을 쓰세요.'}`;
  const body = schema => ({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature: 0.6, maxOutputTokens: 8192, responseMimeType: 'application/json', ...(schema ? { responseSchema: COLUMN_SCHEMA } : {}) }
  });
  const byId = new Map((material.allRows || material.rows).map(r => [r.id, r]));   // 근거 지표: 해설 대상 밖 지표도 허용
  const order = [first, ...models.filter(m => m !== first)];
  for (let round = 0; round < 2; round++) {
    for (const m of order) {
      if (quotaDead.has(m)) continue;   // 오늘 한도를 다 쓴 모델은 건너뜀
      for (const withSchema of [true, false]) {
        try {
          const resp = await post(m, body(withSchema));
          const cand = resp.candidates && resp.candidates[0];
          const text = cand && cand.content && (cand.content.parts || []).map(p => p.text || '').join('');
          const j = JSON.parse(String(text).replace(/^```(?:json)?\s*|\s*```$/g, ''));
          const title = clean(j.title, 60);
          // 섹션 다듬기: 헤드라인 + 본문 최대 5줄 (금지 표현·필드명 문장 제거), 최대 6섹션
          const sections = (Array.isArray(j.sections) ? j.sections : []).map(x => ({
            head: clean(String((x && x.head) || '').replace(/^■\s*/, '').replace(/^섹션\s*\d+\s*[.:]?\s*/, ''), 50),
            lines: (Array.isArray(x && x.lines) ? x.lines : []).map(l => clean(String(l).replace(/^[-•·]\s*/, ''), 160)).filter(Boolean).slice(0, 5)
          })).filter(x => x.head && x.lines.length).slice(0, 6);
          if (!title || sections.length < 3) throw new Error('칼럼 내용 부족');
          const oneline = clean(j.oneline, 160) || sections[0].lines[0];
          const refs = [...new Set((Array.isArray(j.refs) ? j.refs : []).map(String))].filter(id => byId.has(id)).slice(0, 8)
            .map(id => sourceRef(id, byId.get(id), material.meta));
          const dates = refs.map(r => r.date).filter(Boolean).sort();
          const basis = `작성 ${material.kst} · 데이터 기준 ${dates.length ? (dates[0] === dates.at(-1) ? dates[0] : `${dates[0]} ~ ${dates.at(-1)}`) : '지표별 최신값'}`;
          // 예전 앱 화면(본문 문자열)과도 호환되도록 body 도 함께 저장
          const bodyText = sections.flatMap(x => ['■ ' + x.head, x.lines.join(' ')]).concat(['오늘의 한 줄 정리: ' + oneline]).join('\n\n');
          const u = resp.usageMetadata || {};
          console.log(`✓ 오늘의 칼럼 생성 (${m}) — 입력 ${u.promptTokenCount ?? '?'} · 출력 ${u.candidatesTokenCount ?? '?'} 토큰, 섹션 ${sections.length}개 · ${sections.reduce((n, x) => n + x.lines.join('').length, 0)}자 · 참고 자료 ${refs.length}개`);
          return { title, summary: oneline, oneline, basis, sections, refs, body: bodyText, model: m };
        } catch (e) {
          console.log(`  칼럼 ${m}${withSchema ? '' : ' (형식 지정 없이)'} → ${e.message.split('\n')[0].slice(0, 160)}`);
          if (e.status === 429) { quotaDead.add(m); break; }   // 한도 초과 → 다음 모델
          if (e.status !== 400 && !/JSON|부족/.test(e.message)) break;   // 혼잡·없음 → 다음 모델
        }
      }
    }
    if (order.every(m => quotaDead.has(m))) break;
    if (round === 0) await new Promise(r => setTimeout(r, 30000));
  }
  return null;
}

async function sendColumnTelegram(col) {
  if (!TG_TOKEN || !TG_CHAT || !col) return;
  // 텔레그램에는 제목 + 오늘의 한 줄 정리만 (전문은 앱의 'AI 브리핑 → 오늘의 칼럼')
  let text = [`📰 ${ED.col} 《${col.title}》`, '', col.oneline || col.summary || '', '', SITE_URL ? `전문 보기: ${SITE_URL}` : '전문은 앱의 AI 브리핑에서 볼 수 있어요.'].join('\n');
  if (text.length > 4000) text = text.slice(0, 3990) + '…';
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text, disable_web_page_preview: true }), signal: AbortSignal.timeout(20000)
    });
    console.log(res.ok ? '  텔레그램으로 칼럼 전송 완료' : `  텔레그램 칼럼 전송 실패: HTTP ${res.status}`);
  } catch (e) { console.log(`  텔레그램 칼럼 전송 실패: ${e.message}`); }
  await shareCopy(text + '\n\n※ AI가 작성한 참고용 글이며 투자 권유가 아닙니다.', '칼럼');
}

/* ---------- 관심 종목·ETF: 텔레그램 전용 — 개인 채팅 + 공유 채널 (앱·ai.json·로그에 내용을 남기지 않음) ---------- */
// 후보는 이 목록 안에서만 고르게 함 (없는 티커를 지어내지 않도록). 앱이 추적 중인 ETF·해운주는 자동 포함.
const WATCH_EXTRA = {
  SPY: 'S&P 500', QQQ: '나스닥 100', IWM: '미국 소형주(러셀 2000)', XLF: '미국 금융주', XLK: '미국 기술주', XLU: '미국 유틸리티',
  XLV: '미국 헬스케어', XLP: '미국 필수소비재', XLY: '미국 경기소비재', XLB: '미국 소재', VNQ: '미국 리츠(부동산)', SMH: '반도체',
  IEF: '미국 국채 7~10년', SHY: '미국 국채 1~3년', BIL: '미국 초단기 국채', LQD: '미국 투자등급 회사채', EMB: '신흥국 달러채',
  SLV: '은', GDX: '금광주', SIL: '은광주', USO: 'WTI 원유 선물', XOP: '원유·가스 생산기업', OIH: '유전 서비스', CPER: '구리 선물',
  EWJ: '일본', FXI: '중국 대형주', INDA: '인도', EWT: '대만',
  XOM: '엑슨모빌(통합 석유)', CVX: '셰브론(통합 석유)', VLO: '발레로(정유)', MPC: '마라톤 페트롤리엄(정유)', LNG: '셰니어 에너지(LNG 수출)',
  DHT: 'DHT 홀딩스(VLCC 원유선)', TNK: '티케이 탱커스(수에즈막스·아프라막스 원유선)', NAT: '노르딕 아메리칸 탱커스(수에즈막스 원유선)',
  ECO: '오케아니스 에코 탱커스(VLCC·수에즈막스 원유선)', HAFN: '하프니아(석유제품선 전 선형)', TRMD: '토름(석유제품선)', INSW: '인터내셔널 시웨이즈(원유선·제품선)',
  SBLK: '스타 벌크(벌크선 전 선형)', GNK: '젠코 쉬핑(케이프·수프라 벌크선)', SB: '세이프 벌커스(파나막스·케이프 벌크선)', SHIP: '시너지 마리타임(케이프사이즈 벌크선)',
  DSX: '다이아나 쉬핑(기간용선 벌크선)', PANL: '판게아 로지스틱스(소형 벌크선·물류)',
  COP: '코노코필립스(원유 생산)', EOG: 'EOG 리소시스(원유 생산)', OXY: '옥시덴탈(원유 생산)',
  SLB: 'SLB(유전 서비스)', HAL: '핼리버튼(유전 서비스)', BKR: '베이커 휴즈(유전 서비스)',
  RIG: '트랜스오션(해양 시추)', VAL: '발라리스(해양 시추)', NE: '노블(해양 시추)', SDRL: '시드릴(심해 시추)', BORR: '보르 드릴링(천해 잭업 시추)', FTI: '테크닙FMC(해저 생산설비)', TDW: '타이드워터(해양 지원선)',
  AMLP: '미드스트림 MLP ETF', EPD: '엔터프라이즈 프로덕츠(파이프라인)', ET: '에너지 트랜스퍼(파이프라인)', KMI: '킨더 모건(파이프라인)', WMB: '윌리엄스(가스 파이프라인)',
  CRAK: '정유 기업 ETF', PSX: '필립스 66(정유)',
  FCX: '프리포트-맥모란(구리)', NEM: '뉴몬트(금광)', CCJ: '카메코(우라늄)', NTR: '뉴트리엔(비료)', ADM: 'ADM(곡물 유통)', DE: '디어(농기계)', CAT: '캐터필러(건설·광산 장비)'
};
function watchUniverse(meta, rows) {
  const list = new Map();
  for (const [id, srcs] of Object.entries(SOURCES)) {
    const y = srcs && srcs[0] && srcs[0].yahoo;
    if (!y || !srcs[0].adj || !meta[id]) continue;     // 수정종가로 받는 ETF·주식만
    const r = rows.find(x => x.id === id);
    const desc = (meta[id].sub || meta[id].name).split(' — ')[0];
    const move = r ? `추적 중: 1개월 ${r.chg_1m > 0 ? '+' : ''}${r.chg_1m}%${r.position != null ? `, 2년 중 위치 ${r.position}` : ''}` : '추적 중';
    list.set(y, `${y} · ${desc} (${move})`);
  }
  for (const [t, n] of Object.entries(WATCH_EXTRA)) if (!list.has(t)) list.set(t, `${t} · ${n}`);
  return list;
}
/** 최근 2주 관심 종목과 SPY 대비 성과 (private/watch-log.json — 공개 로그에는 개수만 남김) */
async function pastIdeasBlock() {
  if (!WATCH_DIR) return null;
  let log; try { log = JSON.parse(await readFile(`${WATCH_DIR}/watch-log.json`, 'utf8')); } catch { return null; }
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const from = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const ideas = (log.ideas || []).filter(x => x.date >= from && x.date < today);
  if (!ideas.length) return null;
  const px = {};
  for (const t of new Set(['SPY', ...ideas.map(x => x.ticker)])) { try { px[t] = await closes(t); } catch { px[t] = null; } }
  const pp = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%p';
  const lines = ideas.map(x => {
    const head = `- ${x.date.slice(5)} ${x.stance} ${x.ticker}`;
    if (!px[x.ticker] || !px.SPY) return `${head} → 가격 확인 불가`;
    const r5 = retAfter(px[x.ticker], x.date, 5), b5 = retAfter(px.SPY, x.date, 5);
    if (r5 != null && b5 != null) {
      const ex = r5 - b5, hit = x.stance === '경계' ? ex < 0 : ex > 0;
      return `${head} → 1주(5거래일) SPY 대비 ${pp(ex)} (${hit ? '적중' : '빗나감'})`;
    }
    const a = retSoFar(px[x.ticker], x.date), b = retSoFar(px.SPY, x.date);
    return a && b ? `${head} → 고른 뒤 ${a.days}거래일 SPY 대비 ${pp(a.r - b.r)} (평가 진행 중)` : `${head} → 아직 거래일 없음`;
  });
  console.log(`  관심 종목 지난 기록: ${ideas.length}건 (최근 2주, 내용은 로그에 남기지 않음)`);
  return lines.join('\n');
}
const watchSchema = () => obj({
  headline: { type: 'STRING' }, theme: { type: 'STRING' },
  ideas: { type: 'ARRAY', items: obj({ ticker: { type: 'STRING' }, stance: { type: 'STRING' }, point: { type: 'STRING' }, invalidation: { type: 'STRING' } }) }
});
const WATCH_BANNED = /목표\s*(가|주가)|수익\s*(보장|확정)|무조건|확실히\s*(오|상승)|반드시\s*(오|상승|사)|손절|몰빵|레버리지\s*(추천|활용)/;
function cleanWatch(x, max) {
  if (typeof x !== 'string' || !x.trim()) return null;
  const kept = soften(x.trim()).split(/(?<=[.!?。])\s+/).filter(t => !WATCH_BANNED.test(t) && !FIELD_LEAK.test(t)).join(' ').trim();
  return kept ? kept.slice(0, max) : null;
}
async function generateWatchlist(models, first, material, universe) {
  const system = await readFile(new URL('../prompts/ai-watchlist.md', import.meta.url), 'utf8');
  const user = `기준 시각: ${material.kst}${WEEKLY ? '\n\n(월요일 주간판 — 지난주 흐름을 바탕으로 이번 주에 살펴볼 후보로 고를 것)' : ''}\n\n[${WEEKLY ? '주간 브리핑 (지난주 정리)' : '오늘의 브리핑'}]\n${JSON.stringify(material.briefing)}\n\n[분류별 요약]\n${JSON.stringify(material.sections)}` +
    `${material.report ? `\n\n[리서치 리포트]\n${JSON.stringify({ regime: material.report.regime, insights: material.report.insights, scenarios: material.report.scenarios })}` : ''}` +
    `${material.column ? `\n\n[칼럼 제목] ${material.column.title}` : ''}` +
    `\n\n[주요 지표 숫자]\n${material.rows.map(r => JSON.stringify(r)).join('\n')}` +
    `\n\n[지난 2주 관심 종목과 성과 — 같은 종목 반복·성과 참고용]\n${material.past || '(기록 없음)'}` +
    `\n\n[후보 목록 — 이 안의 티커만 사용]\n${[...universe.values()].map(x => '- ' + x).join('\n')}\n\n위 재료로 관심 종목·ETF 를 작성하세요.`;
  const body = schema => ({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature: 0.5, maxOutputTokens: 4096, responseMimeType: 'application/json', ...(schema ? { responseSchema: watchSchema() } : {}) }
  });
  for (const m of [first, ...models.filter(x => x !== first)]) {
    if (quotaDead.has(m)) continue;
    for (const withSchema of [true, false]) {
      try {
        const resp = await post(m, body(withSchema));
        const cand = resp.candidates && resp.candidates[0];
        const text = cand && cand.content && (cand.content.parts || []).map(p => p.text || '').join('');
        const j = JSON.parse(String(text).replace(/^```(?:json)?\s*|\s*```$/g, ''));
        const ideas = (j.ideas || []).map(i => ({
          ticker: String(i.ticker || '').trim().toUpperCase(), stance: i.stance === '경계' ? '경계' : '관심',
          point: cleanWatch(i.point || [i.reason, i.risk].filter(Boolean).join(' '), 160),
          invalidation: cleanWatch(i.invalidation, 90)
        })).filter(i => universe.has(i.ticker) && i.point).slice(0, 5);
        const dropped = (j.ideas || []).length - ideas.length;
        if (ideas.length < 2) throw new Error('관심 종목 내용 부족');
        console.log(`✓ 관심 종목·ETF 생성 (${m}) — ${ideas.length}개${dropped > 0 ? ` (목록 밖·빈 항목 ${dropped}개 제외)` : ''} · 내용은 텔레그램 전용이라 로그에 남기지 않음`);
        return { headline: cleanWatch(j.headline, 60), theme: cleanWatch(j.theme, 160), ideas };
      } catch (e) {
        console.log(`  관심 종목 ${m}${withSchema ? '' : ' (형식 지정 없이)'} → ${e.message.split('\n')[0].slice(0, 160)}`);
        if (e.status === 429) { quotaDead.add(m); break; }
        if (e.status !== 400 && !/JSON|부족/.test(e.message)) break;
      }
    }
  }
  return null;
}
async function sendWatchlistTelegram(w, universe, kst) {
  if (!TG_TOKEN || !TG_CHAT || !w) return;
  // 헤드라인 + 핵심 한 줄, 종목마다 '티커 — 이름' 한 줄 + 핵심 1~2줄
  const lines = [`🎯 관심 종목·ETF${w.headline ? ` — ${w.headline}` : ''}`];
  if (w.theme) lines.push(w.theme);
  w.ideas.forEach(i => {
    const name = universe.get(i.ticker).split(' · ')[1].replace(/\s*\(.*\)$/, '');
    lines.push('', `${i.stance === '경계' ? '🔴' : '🟢'} ${i.ticker} · ${name}`, i.point);
    if (i.invalidation) lines.push(`↳ 철회 조건: ${i.invalidation}`);
  });
  const body = lines.join('\n');
  let text = body + '\n\n※ 텔레그램 전용 · AI가 고른 조사 후보이며 매수·매도 권유가 아닙니다.';
  if (text.length > 4000) text = text.slice(0, 3990) + '…';
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text, disable_web_page_preview: true }), signal: AbortSignal.timeout(20000)
    });
    console.log(res.ok ? '  텔레그램으로 관심 종목·ETF 전송 완료' : `  텔레그램 관심 종목 전송 실패: HTTP ${res.status}`);
  } catch (e) { console.log(`  텔레그램 관심 종목 전송 실패: ${e.message}`); }
  // 공유 채널에도 전송 — 여러 사람이 보므로 투자 권유가 아님을 더 분명하게
  const shareNote = [
    '⚠️ 투자 권유가 아닙니다',
    '· AI가 오늘의 매크로 지표만 보고 고른 "조사해 볼 후보"이며, 매수·매도·보유를 권하지 않습니다.',
    '· 기업 실적·뉴스는 반영하지 않았고, 틀릴 수 있습니다.',
    '· 투자 판단과 그 결과의 책임은 본인에게 있습니다.'
  ].join('\n');
  await shareCopy((body + '\n\n' + shareNote).slice(0, 4090), '관심 종목·ETF');
}

const CATS = ['rates', 'inflation', 'growth', 'market', 'fx', 'energy', 'power', 'freight', 'stocks', 'metals', 'grains', 'fert', 'etf'];

/* 리서치 리포트 (prompts/ai-system.md 5장 구조의 압축판) */
const STR = { type: 'STRING' }, STRS = { type: 'ARRAY', items: STR };
const obj = (props, req = Object.keys(props)) => ({ type: 'OBJECT', properties: props, required: req });
const REPORT_SCHEMA = obj({
  data_note: STR, summary: STRS,
  regime: obj({ label: STR, evidence: STRS, counter: STR, shift: STR }),
  insights: { type: 'ARRAY', items: obj({ title: STR, conclusion: STR, indicators: STRS, mechanism: STR, counter: STR, invalidation: STR, confidence: STR }) },
  conflicts: { type: 'ARRAY', items: obj({ signal: STR, explanations: STRS, verdict: STR }) },
  scenarios: { type: 'ARRAY', items: obj({ name: STR, premise: STR, outlook: STR, trigger: STR, invalidation: STR }) },
  monitoring: { type: 'ARRAY', items: obj({ indicator: STR, why: STR, threshold: STR }) },
  final: obj({ key_fact: STR, hidden_insight: STR, key_conflict: STR, change_trigger: STR, watch_most: STR })
});

/** 리포트 다듬기: 모든 문장에 금지 표현·필드명 제거, '사상 최고' 교정 적용 */
function cleanReport(r) {
  if (!r || typeof r !== 'object') return null;
  const c = (x, n) => clean(x, n), list = (a, n, m) => (Array.isArray(a) ? a : []).map(x => c(x, n)).filter(Boolean).slice(0, m);
  const reg = r.regime || {};
  const out = {
    data_note: c(r.data_note, 240),
    summary: list(r.summary, 160, 6),
    regime: { label: c(reg.label, 80), evidence: list(reg.evidence, 140, 4), counter: c(reg.counter, 200), shift: c(reg.shift, 200) },
    insights: (r.insights || []).slice(0, 5).map(x => x && ({
      title: c(x.title, 50), conclusion: c(x.conclusion, 240), indicators: list(x.indicators, 40, 5),
      mechanism: c(x.mechanism, 240), counter: c(x.counter, 200), invalidation: c(x.invalidation, 160),
      confidence: ['높음', '중간', '낮음'].includes(x.confidence) ? x.confidence : '중간'
    })).filter(x => x && x.title && x.conclusion),
    conflicts: (r.conflicts || []).slice(0, 3).map(x => x && ({ signal: c(x.signal, 120), explanations: list(x.explanations, 140, 3), verdict: c(x.verdict, 200) })).filter(x => x && x.signal),
    scenarios: (r.scenarios || []).slice(0, 3).map(x => x && ({ name: c(x.name, 10), premise: c(x.premise, 160), outlook: c(x.outlook, 260), trigger: c(x.trigger, 140), invalidation: c(x.invalidation, 120) })).filter(x => x && x.name && x.outlook),
    monitoring: (r.monitoring || []).slice(0, 5).map(x => x && ({ indicator: c(x.indicator, 40), why: c(x.why, 120), threshold: c(x.threshold, 100) })).filter(x => x && x.indicator),
    final: Object.fromEntries(['key_fact', 'hidden_insight', 'key_conflict', 'change_trigger', 'watch_most'].map(k => [k, c((r.final || {})[k], 200)]))
  };
  return out.summary.length || out.insights.length ? out : null;
}

/** 리포트 → 텔레그램 글 */
function reportText(r, kst) {
  const L = [`📊 매크로 리서치 리포트 · ${kst}`];
  if (r.regime && r.regime.label) {
    L.push('', `【현재 국면】 ${r.regime.label}`, ...r.regime.evidence.map(x => `• ${x}`));
    if (r.regime.counter) L.push(`↔ 반대 증거: ${r.regime.counter}`);
    if (r.regime.shift) L.push(`⚙ 판단을 바꿀 변수: ${r.regime.shift}`);
  }
  if (r.summary.length) L.push('', '【핵심 결론】', ...r.summary.map((x, i) => `${i + 1}. ${x}`));
  if (r.insights.length) {
    L.push('', '【통합 인사이트】');
    r.insights.forEach((x, i) => L.push('', `${'①②③④⑤'[i]} ${x.title} (신뢰도 ${x.confidence})`, x.conclusion,
      ...(x.indicators.length ? [`- 연결 지표: ${x.indicators.join(' · ')}`] : []),
      ...(x.mechanism ? [`- 메커니즘: ${x.mechanism}`] : []), ...(x.counter ? [`- 반대 해석: ${x.counter}`] : []),
      ...(x.invalidation ? [`- 무효화 조건: ${x.invalidation}`] : [])));
  }
  if (r.conflicts.length) {
    L.push('', '【상충 신호】');
    r.conflicts.forEach(x => L.push(`• ${x.signal}`, ...x.explanations.map((e, i) => `  ${i ? '②' : '①'} ${e}`), ...(x.verdict ? [`  → ${x.verdict}`] : [])));
  }
  if (r.scenarios.length) {
    L.push('', '【1~3개월 시나리오】 (확률 아닌 조건부 전망)');
    r.scenarios.forEach(x => L.push(`▸ ${x.name}: ${x.outlook}`, ...(x.premise ? [`  전제: ${x.premise}`] : []), ...(x.trigger ? [`  확인 신호: ${x.trigger}`] : []), ...(x.invalidation ? [`  무효화: ${x.invalidation}`] : [])));
  }
  if (r.monitoring.length) L.push('', '【모니터링 지표】', ...r.monitoring.map(x => `• ${x.indicator} — ${x.why}${x.threshold ? ` (기준: ${x.threshold})` : ''}`));
  const f = r.final || {};
  const fin = [['가장 중요한 사실', f.key_fact], ['숨은 인사이트', f.hidden_insight], ['주의할 상충 신호', f.key_conflict], ['판단을 바꿀 데이터', f.change_trigger], ['가장 중요한 관찰 지표', f.watch_most]].filter(x => x[1]);
  if (fin.length) L.push('', '【최종 판단】', ...fin.map(([k, v]) => `• ${k}: ${v}`));
  if (r.data_note) L.push('', `ℹ ${r.data_note}`);
  L.push('', '※ 대시보드 데이터만으로 AI가 작성한 분석이며 틀릴 수 있습니다. 투자 권유나 매매 판단이 아닙니다.');
  return L.join('\n');
}

/** 텔레그램용 리서치 리포트 요약: 국면 + 핵심 결론 3개 + 시나리오 한 줄씩 + 전문 링크 (전문은 앱) */
function reportShortText(r) {
  const L = [WEEKLY ? '📊 주간 리서치 리포트 요약' : '📊 리서치 리포트 요약'];
  if (r.regime && r.regime.label) L.push(`국면: ${r.regime.label}`);
  if (r.summary.length) L.push('', ...r.summary.slice(0, 3).map(x => `• ${x}`));
  if (r.scenarios.length) L.push('', '1~3개월 시나리오', ...r.scenarios.map(x => `▸ ${x.name}: ${x.outlook}`));
  const f = r.final || {};
  if (f.change_trigger) L.push('', `⚙ 판단을 바꿀 데이터: ${f.change_trigger}`);
  L.push('', SITE_URL ? `전문(인사이트·상충 신호·모니터링): ${SITE_URL}` : '전문은 앱의 📊 리서치 리포트에서 볼 수 있어요.');
  return L.join('\n');
}

/** 긴 글은 빈 줄 기준으로 나눠 여러 메시지로 (텔레그램 4096자 제한) */
async function sendTelegramLong(text, label, chat = TG_CHAT) {
  if (!TG_TOKEN || !chat) return;
  const parts = []; let cur = '';
  for (const block of text.split('\n\n')) {
    if ((cur + '\n\n' + block).length > 3800 && cur) { parts.push(cur); cur = block; } else cur = cur ? cur + '\n\n' + block : block;
  }
  if (cur) parts.push(cur);
  for (let i = 0; i < parts.length; i++) {
    const body = parts.length > 1 ? `${parts[i]}${i < parts.length - 1 ? `\n\n(${i + 1}/${parts.length} — 계속)` : ''}` : parts[i];
    try {
      const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text: body.slice(0, 4090), disable_web_page_preview: true }), signal: AbortSignal.timeout(20000)
      });
      if (!res.ok) { console.log(`  텔레그램 ${label} 전송 실패: HTTP ${res.status}`); return; }
    } catch (e) { console.log(`  텔레그램 ${label} 전송 실패: ${e.message}`); return; }
  }
  console.log(`  ${chat === TG_CHAT ? '텔레그램' : '공유 채널'}으로 ${label} 전송 완료 (${parts.length}개 메시지)`);
}

/* ---------- AI 근거 검증 (코드가 확인 — AI 가 쓴 지표 ID·숫자를 데이터와 대조) ---------- */
/** AI 가 낸 근거 지표 ID → 실제 데이터에 있는 것만 [{id, date}] (없으면 본문에 나온 지표 이름으로 찾음) */
function groundRefs(ids, rows, texts = [], max = 8) {
  const byId = new Map(rows.map(r => [r.id, r]));
  let out = [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter(id => byId.has(id));
  if (!out.length && texts.length) {
    const joined = texts.join(' ');
    out = rows.filter(r => { const n = String(r.name || '').split(' (')[0]; return n.length >= 2 && joined.includes(n); }).map(r => r.id);
  }
  return out.slice(0, max).map(id => ({ id, date: byId.get(id).date }));
}
/** 본문 숫자 중 데이터 값(현재값·변화율·분포 위치·평년 대비)과 맞는 비율 — 날짜·연도·개수 표현은 제외 */
function checkNumbers(texts, rows) {
  const known = [];
  for (const r of rows) for (const k of ['value', 'chg_prev', 'chg_1m', 'chg_3m', 'chg_1y', 'position', 'season_dev', 'chg_since_brief']) {
    const v = r[k]; if (v != null && Number.isFinite(v)) known.push(Math.abs(v));
  }
  for (const r of rows) if (r.position != null) known.push(100 - r.position);   // '상위 22%' 표현
  const nums = [];
  for (const t of texts) {
    const src = String(t || '').replace(/\d{4}[-./]\d{1,2}([-./]\d{1,2})?/g, ' ').replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/g, ' ');
    for (const m of src.matchAll(/([+−-]?)(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(%p|%|bp|달러|\$|원|배|개|가지|월|일|주|년|분기|차|위|번|명|곳)?/g)) {
      const unit = m[3] || '', x = Number(m[2].replace(/,/g, ''));
      if (/^(개|가지|월|일|주|년|분기|차|위|번|명|곳)$/.test(unit)) continue;
      if (!m[2].includes('.') && x < 10 && !unit) continue;           // 작은 정수(문장 속 개수 등)
      if (!m[2].includes('.') && x >= 1900 && x <= 2100 && !unit) continue;   // 연도
      nums.push({ raw: m[0].trim(), x });
    }
  }
  const ok = n => known.some(k => { const tol = Math.max(0.051, Math.abs(k) * 0.006); return Math.abs(k - n.x) <= tol || (k >= 1000 && Math.abs(k / 1000 - n.x) <= 0.051) || Math.abs(Math.round(k) - n.x) < 0.5 && !String(n.raw).includes('.'); });
  const unmatched = nums.filter(n => !ok(n)).map(n => n.raw);
  return { checked: nums.length, matched: nums.length - unmatched.length, unmatched: unmatched.slice(0, 6) };
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    briefing: {
      type: 'OBJECT',
      properties: {
        headline: { type: 'STRING' }, story: { type: 'STRING' },
        top3: { type: 'ARRAY', items: { type: 'STRING' } },
        points: { type: 'ARRAY', items: { type: 'STRING' } },
        korea: { type: 'STRING' },
        watch: { type: 'ARRAY', items: { type: 'STRING' } },
        counterpoint: { type: 'STRING' },
        refs: { type: 'ARRAY', items: { type: 'STRING' } }
      },
      required: ['headline', 'story', 'top3', 'points', 'korea', 'watch', 'counterpoint']
    },
    sections: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { cat: { type: 'STRING' }, headline: { type: 'STRING' }, body: { type: 'STRING' }, review: { type: 'STRING' }, refs: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['cat', 'headline', 'body', 'review'] }
    },
    indicators: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { id: { type: 'STRING' }, comment: { type: 'STRING' } }, required: ['id', 'comment'] }
    },
    report: REPORT_SCHEMA,
    energy: {
      type: 'OBJECT',
      properties: { headline: { type: 'STRING' }, oil: { type: 'STRING' }, gas: { type: 'STRING' }, coal: { type: 'STRING' }, link: { type: 'STRING' }, counter: { type: 'STRING' }, refs: { type: 'ARRAY', items: { type: 'STRING' } } },
      required: ['headline', 'oil', 'gas', 'coal', 'link']
    },
    chains: {
      type: 'OBJECT',
      properties: Object.fromEntries(['food', 'steel', 'korea'].map(k => [k, {
        type: 'OBJECT', properties: { headline: { type: 'STRING' }, body: { type: 'STRING' }, counter: { type: 'STRING' }, refs: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['headline', 'body']
      }])),
      required: ['food', 'steel', 'korea']
    }
  },
  required: ['briefing', 'sections', 'indicators', 'report']
};

/** 지난 브리핑 점검: 그 분류에 새 데이터가 없으면 '판단 보류'로 고정 (값이 그대로인 걸 '적중'으로 부풀리지 않게) */
const NO_NEW = '판단 보류 — 지난 브리핑 이후 이 분류에 새로 나온 데이터가 없음';
function checkReview(cat, review, rows) {
  const fresh = rows.filter(r => r.cat === cat && r.chg_since_brief != null).length;
  if (!fresh) { if (review && !review.startsWith('판단 보류')) fixes.push(`점검 보정(${cat}): 새 데이터 없음 → 판단 보류`); return NO_NEW; }
  return review;
}

/* ---------- 응답 검사: 투자 권유·매매 지시 표현 거르기 ---------- */
const BANNED = /(매수|매도)\s*(하세요|하라|할\s*때|타이밍|기회|추천|권)|사세요|파세요|사야\s*(한다|합니다|할|함|해|됨)|사\s*둬|매수\s*(각|타이밍)|줍줍|팔아야|담아|목표\s*가|추천\s*(종목|ETF)|수익\s*(보장|확정)|(저평가|고평가)[^.!?\n]{0,20}(기회|매수|매도|매력적|담|사\s|살\s|줍줍)|비중\s*(확대|축소)\s*(하|를|추천)/;
/** 금지 표현이 들어간 문장만 빼고 나머지는 살림 */
const FIELD_LEAK = /\b(z_1m|chg_(prev|1m|3m|1y|unit|since_brief)|season_dev|position)\b/i;
const fixes = [];
// 과장·확률 부풀림 표현 교정 (프롬프트로 금지해도 가끔 새어 나옴 → 코드로 한 번 더)
const SOFTEN = [
  [/(전례|유례)\s*(가\s*)?없는\s*/g, '이례적인 '],
  [/(전례|유례)\s*(가\s*)?없이\s*/g, '이례적으로 '],
  [/역사적(?:인|으로)?\s+(?!(최고|최저|최다|최대|최소|고점|저점|상위|하위|수준))/g, '최근 수년 중 '],
  [/극도로\s*/g, '매우 '],
  [/가능성이\s*(?:더\s*)?(?:우세합니다|큽니다|높습니다)/g, '가능성이 있습니다'],
  [/가능성이\s*(?:더\s*)?(?:우세하다|크다|높다)/g, '가능성이 있다'],
  [/가능성이\s*(?:더\s*)?(?:우세함|큼|높음)/g, '가능성이 있음'],
  [/가능성이\s*(?:더\s*)?(?:우세한|큰|높은)/g, '가능성이 있는'],
  [/가능성이\s*(?:더\s*)?(?:우세해|커|높아)/g, '가능성이 있어']
];
function soften(t) {
  for (const [re, to] of SOFTEN) t = t.replace(re, m0 => { fixes.push(m0.trim() + '→' + to.trim()); return to; });
  return t;
}
function clean(s, max) {
  if (typeof s !== 'string' || !s.trim()) return null;
  // position 은 최근 2~10년 안의 위치일 뿐 → '사상·역대 최고/최저'는 '최근 수년 중 최고/최저'로
  let t = s.trim().replace(/(사상|역대|역사적(?:인)?)\s*(?=(최고|최저|최다|최대|최소|고점|저점|상위|하위|수준))/g, m0 => { fixes.push(m0 + '→최근 수년 중'); return '최근 수년 중 '; });
  t = soften(t);
  const kept = t.split(/(?<=[.!?。])\s+/).filter(x => { const bad = BANNED.test(x) || FIELD_LEAK.test(x); if (bad) fixes.push('문장 제거: ' + x.slice(0, 40)); return !bad; }).join(' ').trim();
  return kept ? kept.slice(0, max) : null;
}

const kstDay0 = t => new Date(Date.parse(t) + 9 * 3600000).toISOString().slice(0, 10);

async function main() {
  if (!RUN) return keepPrevious('오늘 실행 대상 아님 (평일 07:23 예약 또는 수동 실행에서만 생성)');
  if (SCHEDULED && PREV) {
    // 예약 실행이 늦게 돌았는데 오늘(한국시간) 이미 브리핑이 있으면 건너뜀 (수동 실행 등으로 먼저 만든 경우)
    try {
      const prev = JSON.parse(await readFile(PREV, 'utf8'));
      const kstDay = t => new Date(Date.parse(t) + 9 * 3600000).toISOString().slice(0, 10);
      if (prev.generatedAt && kstDay(prev.generatedAt) === kstDay(new Date().toISOString())) {
        return keepPrevious(`오늘(${kstDay(prev.generatedAt)}) 이미 생성된 브리핑 있음 — 예약 실행 중복 방지`);
      }
    } catch { /* 이전 해설 없음 → 그대로 생성 */ }
  }
  if (!KEY) return keepPrevious('GEMINI_API_KEY 없음', { fail: true });

  const latest = JSON.parse(await readFile(DATA, 'utf8'));
  const meta = await readIndicatorMeta();
  // 지난 브리핑 (분류별 '지난 브리핑 점검'용)
  let prevAI = null;
  if (PREV) { try { prevAI = JSON.parse(await readFile(PREV, 'utf8')); } catch { prevAI = null; } }
  const prevAt = prevAI && prevAI.generatedAt && prevAI.briefing ? { at: prevAI.generatedAt, asOf: prevAI.asOf || null } : null;
  const rows = Object.entries(latest.series).filter(([id]) => meta[id]).map(([id, s]) => stats(id, s, meta[id], prevAt)).filter(Boolean);
  const prevBlock = prevAt ? previousBlock(prevAI, rows) : null;
  const targets = pickTargets(rows);
  const kstDate = new Date(Date.now() + 9 * 3600000);
  const kst = `${kstDate.toISOString().slice(0, 16).replace('T', ' ')} (${'일월화수목금토'[kstDate.getUTCDay()]})`;

  const system = await readFile(new URL('../prompts/ai-system.md', import.meta.url), 'utf8');
  const user = (await readFile(new URL('../prompts/ai-user.md', import.meta.url), 'utf8'))
    .replace('{{generatedAt}}', kst)
    .replace('{{targets}}', targets.map(id => targetLine(rows.find(r => r.id === id))).join('\n') || '없음')
    .replace('{{season}}', seasonNotes().join('\n') || '없음')
    .replace('{{edition}}', WEEKLY ? weeklyBlock(prevAI, rows) : '')
    .replace('{{energy}}', energyBlock(rows))
    .replace('{{chains}}', chainBlock(rows))
    .replace('{{previous}}', prevBlock || '없음 (지난 브리핑 없음 — sections 의 review 는 빈 문자열로)')
    .replace('{{data}}', rows.map(r => JSON.stringify(r)).join('\n'));
  if (WEEKLY) console.log('  월요일 주간판: 지난주 정리 + 이번 주 볼 것');
  console.log(`AI 인사이트: 지표 ${rows.length}개, 해설 대상 ${targets.length}개, 프롬프트 약 ${Math.round((system.length + user.length) / 1000)}천 자`);

  const body = schema => ({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 16384, responseMimeType: 'application/json', ...(schema ? { responseSchema: SCHEMA } : {}) }
  });

  const models = MODEL ? [MODEL] : await autoModels();
  let resp = null, used = null, lastErr = null;
  console.log(`  모델 후보: ${models.join(', ')}`);
  // 모델마다 한 번 (형식 오류 400 이면 형식 지정 없이 한 번 더). 혼잡(5xx·시간 초과)·없음(404)이면 바로 다음 모델.
  // 모두 혼잡이었으면 30초 쉬고 첫 모델을 한 번 더.
  const tryModel = async m => {
    for (const withSchema of [true, false]) {
      try { resp = await post(m, body(withSchema)); used = m; return 'ok'; }
      catch (e) {
        lastErr = e; console.log(`  ${m}${withSchema ? '' : ' (형식 지정 없이)'} → ${e.message}`);
        if (e.status === 429) return 'quota';
        if (e.status !== 400) return !e.status || e.status >= 500 ? 'busy' : 'skip';
      }
    }
    return 'skip';
  };
  // 품질 우선: Flash 계열이 모두 혼잡이면 40초 쉬고 첫 Flash를 한 번 더 → 그래도 안 되면 Flash-Lite
  const main = models.filter(m => !/lite/.test(m)), lite = models.filter(m => /lite/.test(m));
  // 한도 초과(429)는 모델마다 따로 계산 → 그 모델만 건너뛰고 다음 모델(Flash-Lite 등)로
  let anyBusy = false, quotaHit = 0;
  for (const m of main) {
    const r = await tryModel(m);
    if (r === 'ok') break;
    if (r === 'quota') { quotaDead.add(m); quotaHit++; }
    if (r === 'busy') anyBusy = true;
  }
  if (!resp && anyBusy && main.length && !quotaDead.has(main[0])) {
    console.log('  Flash 혼잡 → 40초 뒤 다시 시도');
    await new Promise(r => setTimeout(r, 40000));
    if (await tryModel(main[0]) === 'quota') { quotaDead.add(main[0]); quotaHit++; }
  }
  for (const m of lite) {
    if (resp) break;
    const r = await tryModel(m);
    if (r === 'quota') { quotaDead.add(m); quotaHit++; }
  }
  if (!resp) return keepPrevious(quotaHit && quotaHit === models.length ? '모든 모델 무료 한도 초과 (429)' : `호출 실패: ${lastErr && lastErr.message}`, { fail: true });
  if (quotaHit) console.log(`  한도 초과 모델 ${quotaHit}개 건너뛰고 ${used} 사용`);

  const cand = resp.candidates && resp.candidates[0];
  const text = cand && cand.content && (cand.content.parts || []).map(p => p.text || '').join('');
  let parsed;
  try { parsed = JSON.parse(String(text).replace(/^```(?:json)?\s*|\s*```$/g, '')); }
  catch (e) { return keepPrevious(`응답 JSON 해석 실패 (finishReason: ${cand && cand.finishReason})`, { fail: true }); }

  const b = parsed.briefing || {};
  const briefing = {
    headline: clean(b.headline, 80), story: clean(b.story, 700),
    top3: (b.top3 || []).map(p => clean(p, 70)).filter(Boolean).slice(0, 3),
    points: (b.points || []).map(p => clean(p, 140)).filter(Boolean).slice(0, 5),
    korea: clean(b.korea, 240), watch: (b.watch || []).map(p => clean(p, 100)).filter(Boolean).slice(0, 4),
    counterpoint: clean(b.counterpoint, 200)
  };
  // 근거 지표·기준일 (실제 데이터에 있는 ID 만) + 본문 숫자 대조
  const bTexts = [briefing.headline, briefing.story, ...briefing.top3, ...briefing.points, briefing.korea, briefing.counterpoint];
  briefing.refs = groundRefs(b.refs, rows, bTexts);
  briefing.grounding = checkNumbers(bTexts, rows);
  console.log(`  근거 지표 ${briefing.refs.length}개 · 본문 숫자 ${briefing.grounding.checked}개 중 데이터와 일치 ${briefing.grounding.matched}개`);
  const sections = {};
  for (const it of parsed.sections || []) {
    if (!it || !CATS.includes(it.cat) || sections[it.cat]) continue;
    const headline = clean(it.headline, 40), body = clean(it.body, 260), review = prevBlock ? checkReview(it.cat, clean(it.review, 160), rows) : null;
    const catRows = rows.filter(r => r.cat === it.cat);
    const refs = groundRefs(it.refs, catRows.length ? catRows : rows, [headline, body], 3);
    if (headline || body) sections[it.cat] = { headline, body, ...(review ? { review } : {}), ...(refs.length ? { refs } : {}) };
  }
  // 에너지 3축 (원유·가스·석탄 + 연결) — 없으면 생략
  const en = parsed.energy || {};
  const energy = { headline: clean(en.headline, 40), oil: clean(en.oil, 170), gas: clean(en.gas, 170), coal: clean(en.coal, 170), link: clean(en.link, 230), counter: clean(en.counter, 170) };
  if (energy.oil || energy.gas || energy.coal) {
    const eTexts = [energy.oil, energy.gas, energy.coal, energy.link, energy.counter];
    energy.refs = groundRefs(en.refs, rows, eTexts, 8);
    energy.grounding = checkNumbers(eTexts, rows);
    console.log(`  에너지 3축: 근거 ${energy.refs.length}개 · 숫자 ${energy.grounding.checked}개 중 일치 ${energy.grounding.matched}개`);
  } else { Object.keys(energy).forEach(k => delete energy[k]); console.log('  에너지 3축: 없음'); }
  const chains = {};
  for (const k of ['food', 'steel', 'korea']) {
    const c = (parsed.chains || {})[k] || {};
    const x = { headline: clean(c.headline, 40), body: clean(c.body, 260), counter: clean(c.counter, 170) };
    if (!x.body) continue;
    const texts = [x.body, x.counter];
    x.refs = groundRefs(c.refs, rows, texts, 8);
    x.grounding = checkNumbers(texts, rows);
    chains[k] = x;
    console.log(`  연결 블록 ${k}: 근거 ${x.refs.length}개 · 숫자 ${x.grounding.checked}개 중 일치 ${x.grounding.matched}개`);
  }
  const indicators = {};
  for (const it of parsed.indicators || []) {
    const c = it && meta[it.id] ? clean(it.comment, 320) : null;
    if (c) indicators[it.id] = c;
  }
  if (!briefing.headline && !briefing.story) return keepPrevious('브리핑 내용이 비어 있음', { fail: true });

  const ordered = {}; for (const id of targets) if (indicators[id]) ordered[id] = indicators[id];
  for (const [k, v] of Object.entries(indicators)) if (!ordered[k]) ordered[k] = v;
  // 브리핑을 먼저 보내고, 이어서 칼럼 생성 (칼럼이 실패해도 브리핑은 그대로)
  const report = cleanReport(parsed.report);
  console.log(report ? `  리서치 리포트: 핵심 결론 ${report.summary.length} · 인사이트 ${report.insights.length} · 상충 ${report.conflicts.length} · 시나리오 ${report.scenarios.length}` : '  리서치 리포트: 없음');
  await sendBriefingTelegram(briefing, sections, kst, energy, chains);
  if (report) {
    await sendTelegramLong(reportShortText(report), '리서치 리포트 요약');
    if (TG_SHARE && TG_SHARE !== TG_CHAT) await sendTelegramLong(reportShortText(report), '리서치 리포트 요약', TG_SHARE);
  }
  let column = null;
  // 최근 칼럼 제목 (최대 7개) — 같은 주제 반복을 피하도록 칼럼 재료로 넘기고 ai.json 에 이어서 보관
  const kstToday = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const columnHistory = ((prevAI && prevAI.columnHistory) || (prevAI && prevAI.column && prevAI.column.title ? [{ date: kstDay0(prevAI.generatedAt), title: prevAI.column.title }] : []))
    .filter(x => x && x.title && x.date !== kstToday).slice(-7);
  try {
    column = await generateColumn(models, used, { kst, briefing, sections, indicators: ordered, report, meta, recentTitles: columnHistory, allRows: rows,
      rows: rows.filter(r => targets.includes(r.id)).map(({ id, name, value, unit, date, chg_1m, chg_unit, position, season_dev }) => ({ id, name, value, unit, date, chg_1m, chg_unit, position, season_dev })) });
  } catch (e) { console.log(`  칼럼 생성 오류: ${e.message}`); }
  if (column) {
    await sendColumnTelegram(column); console.log(`  칼럼 제목: ${column.title}`);
    for (const x of column.sections) { console.log(`  ■ ${x.head}`); x.lines.forEach(l => console.log(`  | ${l}`)); }
    console.log(`  한 줄 정리: ${column.oneline}`); console.log(`  ${column.basis} · 참고: ${column.refs.map(r => r.id).join(', ')}`);
  } else if (prevAI && prevAI.column && prevAI.generatedAt && kstDay0(prevAI.generatedAt) === kstToday) {
    column = prevAI.column;
    console.log(`  오늘의 칼럼: 생성 실패 → 오늘 앞서 만든 칼럼 유지 (${column.title})`);
  } else console.log('  오늘의 칼럼: 생성 실패 → 브리핑만 전송');
  // 관심 종목·ETF — 텔레그램 전용 (텔레그램 미설정이면 호출하지 않음, ai.json 에 저장하지 않음)
  if (TG_TOKEN && TG_CHAT) {
    try {
      const universe = watchUniverse(meta, rows);
      const past = await pastIdeasBlock().catch(() => null);
      const watch = await generateWatchlist(models, used, { kst, briefing, sections, report, column, past,
        rows: rows.filter(r => targets.includes(r.id)).map(({ id, name, value, unit, chg_1m, chg_unit, position }) => ({ id, name, value, unit, chg_1m, chg_unit, position })) }, universe);
      if (watch) await sendWatchlistTelegram(watch, universe, kst);
      else console.log('  관심 종목·ETF: 생성 실패 → 건너뜀');
      // 성적표(scripts/track.mjs)용 기록: 티커·관심/경계와 지난 브리핑 점검 판정 개수만 (사이트로 배포하지 않는 폴더)
      if (WATCH_DIR) {
        const verdict = { hit: 0, partial: 0, miss: 0, hold: 0 };
        for (const c of CATS) { const r = sections[c] && sections[c].review; if (!r) continue;
          if (r.startsWith('일부 적중')) verdict.partial++; else if (r.startsWith('적중')) verdict.hit++; else if (r.startsWith('빗나감')) verdict.miss++; else verdict.hold++; }
        await mkdir(WATCH_DIR, { recursive: true });
        await writeFile(`${WATCH_DIR}/watch-today.json`, JSON.stringify({
          date: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10),
          ideas: watch ? watch.ideas.map(i => ({ ticker: i.ticker, stance: i.stance })) : [],
          reviews: Object.values(verdict).some(Boolean) ? verdict : null
        }));
      }
    } catch (e) { console.log(`  관심 종목·ETF 오류: ${e.message}`); }
  }

  // asOf: 이번 브리핑이 본 지표별 마지막 기준일 → 다음 브리핑의 '지난 브리핑 이후 새 데이터' 판단에 사용
  const asOf = Object.fromEntries(rows.map(r => [r.id, r.date]));
  const briefHistory = [...((prevAI && prevAI.briefHistory) || []).filter(x => x && x.date !== kstToday), { date: kstToday, headline: briefing.headline, top3: briefing.top3, ...(WEEKLY ? { weekly: true } : {}) }].slice(-8);
  const out = { generatedAt: new Date().toISOString(), model: used, ...(WEEKLY ? { edition: 'weekly' } : {}), briefing, sections, ...(energy.oil || energy.gas || energy.coal ? { energy } : {}), ...(Object.keys(chains).length ? { chains } : {}), indicators: ordered, targets, ...(report ? { report } : {}), ...(column ? { column } : {}), columnHistory: column ? [...columnHistory, { date: kstToday, title: column.title }].slice(-7) : columnHistory, briefHistory, asOf };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out));
  const u = resp.usageMetadata || {};
  console.log(`✓ AI 인사이트 생성 (${used}) — 입력 ${u.promptTokenCount ?? '?'} · 출력 ${u.candidatesTokenCount ?? '?'} · 합계 ${u.totalTokenCount ?? '?'} 토큰, 분류 브리핑 ${Object.keys(sections).length}개, 지표 해설 ${Object.keys(indicators).length}개`);
  // 검토용 로그 (Actions 로그에서 그대로 읽을 수 있게)
  const len = x => (x || '').length;
  const warn = [];
  if (len(briefing.headline) > 30) warn.push(`제목 ${len(briefing.headline)}자`);
  if (len(briefing.story) > 250) warn.push(`이야기 ${len(briefing.story)}자`);
  for (const [k, v] of Object.entries(sections)) { if (len(v.headline) > 20) warn.push(`${k} 제목 ${len(v.headline)}자`); if (len(v.body) > 130) warn.push(`${k} 본문 ${len(v.body)}자`); }
  const missing = CATS.filter(c => !sections[c]);
  if (missing.length) warn.push(`빠진 분류: ${missing.join(',')}`);
  console.log(`  제목: ${briefing.headline}`);
  console.log(`  이야기: ${briefing.story}`);
  (briefing.points || []).forEach(x => console.log(`  · ${x}`));
  console.log(`  한국: ${briefing.korea}`);
  (briefing.watch || []).forEach(x => console.log(`  확인: ${x}`));
  console.log(`  반론: ${briefing.counterpoint}`);
  for (const c of CATS) if (sections[c]) console.log(`  [${c}] ${sections[c].headline} | ${sections[c].body}${sections[c].review ? ` ↩ ${sections[c].review}` : ''}`);
  for (const [k, v] of Object.entries(indicators)) console.log(`  <${k}> ${v}`);
  if (report) console.log(reportText(report, kst).split('\n').map(x => '  » ' + x).join('\n'));
  if (fixes.length) console.log(`  후처리 ${fixes.length}건: ${fixes.join(' / ')}`);
  console.log(warn.length ? `  길이·형식 경고: ${warn.join(', ')}` : '  길이·형식 점검: 모두 기준 이내');
}

// 테스트에서 문장 다듬기 함수만 가져다 쓸 수 있게 내보냄. 직접 실행할 때만 생성 시작
export { clean, cleanWatch, soften, BANNED, groundRefs, checkNumbers, stats, weeklyBlock, energyLinks, chainLinks };
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => keepPrevious(`오류: ${e.message}`, { fail: true })).then(() => process.exit(0));
}
