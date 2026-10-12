#!/usr/bin/env node
/* =====================================================================
 * 관심 종목·브리핑 성적표 — 외부 패키지 없음
 *
 *   node scripts/track.mjs --dir private
 *
 * - ai-insight.mjs 가 새 관심 종목을 만들면 private/watch-today.json 을 남깁니다 (티커·관심/경계·점검 판정 개수만).
 * - 이 스크립트가 그것을 private/watch-log.json 에 쌓고, 매주 월요일(한국시간) 텔레그램으로 성적표를 보냅니다.
 *     · 관심(🟢): 고른 날 직전 미국 종가 → 5거래일·20거래일 뒤 수익률을 SPY 와 비교 (SPY 보다 나았으면 '적중')
 *     · 경계(🔴): SPY 보다 못했으면 '적중'
 *     · 지난 브리핑 점검 판정(적중·일부 적중·빗나감·판단 보류) 개수
 * - private/ 는 사이트로 배포하지 않고 GitHub Actions 캐시에만 보관합니다 (공개 사이트·로그에 티커를 남기지 않음).
 *
 * 환경 변수: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SCORE_FORCE('true' 면 요일과 관계없이 성적표 전송 — 시험용)
 * ===================================================================== */
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { closes, retAfter } from './watch-perf.mjs';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const DIR = arg('--dir', 'private');
const TG_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TG_CHAT = (process.env.TELEGRAM_CHAT_ID || '').trim();
const FORCE = String(process.env.SCORE_FORCE || '').toLowerCase() === 'true';
const kstNow = () => new Date(Date.now() + 9 * 3600000);
const readJSON = async (f, d) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return d; } };

async function sendTelegram(text) {
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text, disable_web_page_preview: true }), signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

const pct = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%';
const pp = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%p';

async function main() {
  await mkdir(DIR, { recursive: true });
  const logFile = join(DIR, 'watch-log.json');
  const log = await readJSON(logFile, { ideas: [], reviews: [] });
  const today = await readJSON(join(DIR, 'watch-today.json'), null);
  if (!today) { console.log('성적표: 새 관심 종목 없음 → 건너뜀'); return; }

  // 오늘 기록 추가 (같은 날 다시 만들었으면 그날 기록을 바꿈)
  log.ideas = log.ideas.filter(x => x.date !== today.date).concat(today.ideas.map(i => ({ date: today.date, ticker: i.ticker, stance: i.stance })));
  log.reviews = log.reviews.filter(x => x.date !== today.date).concat(today.reviews ? [{ date: today.date, ...today.reviews }] : []);
  // 최근 120일만 보관
  const cut = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
  log.ideas = log.ideas.filter(x => x.date >= cut); log.reviews = log.reviews.filter(x => x.date >= cut);
  await unlink(join(DIR, 'watch-today.json')).catch(() => {});   // 처리 완료 → 다음 실행에서 다시 쌓지 않도록
  await writeFile(logFile, JSON.stringify(log));
  await writeFile('.track-updated', new Date().toISOString());     // 워크플로가 이 표시가 있을 때만 캐시 저장
  console.log(`성적표: 기록 ${log.ideas.length}건 (최근 120일)`);   // 공개 로그 — 티커는 찍지 않음

  const now = kstNow();
  const todayKst = now.toISOString().slice(0, 10);
  if (!FORCE && now.getUTCDay() !== 1) { console.log('성적표: 월요일에만 전송'); return; }
  if (!FORCE && log.lastScore === todayKst) { console.log('성적표: 오늘 이미 전송'); return; }
  if (!TG_TOKEN || !TG_CHAT) { console.log('성적표: 텔레그램 미설정'); return; }

  // 최근 6주 기록 평가
  const from = new Date(Date.now() - 42 * 86400000).toISOString().slice(0, 10);
  const recent = log.ideas.filter(x => x.date >= from);
  const tickers = [...new Set(['SPY', ...recent.map(x => x.ticker)])];
  const px = {};
  for (const t of tickers) { try { px[t] = await closes(t); } catch (e) { px[t] = null; } }
  if (!px.SPY) { console.log('성적표: SPY 가격을 못 받아 건너뜀'); return; }

  const evalFor = n => recent.map(x => {
    if (!px[x.ticker]) return null;
    const r = retAfter(px[x.ticker], x.date, n), b = retAfter(px.SPY, x.date, n);
    if (r == null || b == null) return null;
    const ex = r - b;
    return { ...x, r, ex, hit: x.stance === '경계' ? ex < 0 : ex > 0 };
  }).filter(Boolean);

  const line = (rows, label) => {
    if (!rows.length) return `${label}: 아직 평가할 기간이 안 지남`;
    const avg = rows.reduce((s, x) => s + x.ex, 0) / rows.length, hit = rows.filter(x => x.hit).length;
    return `${label}: ${rows.length}건 · SPY 대비 평균 ${pp(avg)} · 적중 ${hit}/${rows.length} (${Math.round(hit / rows.length * 100)}%)`;
  };
  const w1 = evalFor(5), w4 = evalFor(20);
  const L = ['📏 관심 종목 성적표 (최근 6주 기록)', '기준: 고른 날 직전 미국 종가 → N거래일 뒤, SPY 와 비교', ''];
  for (const [rows, name] of [[w1, '1주(5거래일)'], [w4, '4주(20거래일)']]) {
    L.push(`[${name}]`, line(rows.filter(x => x.stance !== '경계'), '🟢 관심'), line(rows.filter(x => x.stance === '경계'), '🔴 경계'), '');
  }
  const best = [...w1].sort((a, b) => b.ex - a.ex);
  if (best.length >= 2) L.push(`1주 최고: ${best[0].ticker} ${pct(best[0].r)} (${best[0].date.slice(5)} ${best[0].stance}) · 최저: ${best.at(-1).ticker} ${pct(best.at(-1).r)} (${best.at(-1).date.slice(5)} ${best.at(-1).stance})`, '');

  // 지난 브리핑 점검 판정 (최근 4주)
  const rv = log.reviews.filter(x => x.date >= new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10));
  if (rv.length) {
    const sum = k => rv.reduce((s, x) => s + (x[k] || 0), 0);
    const judged = sum('hit') + sum('partial') + sum('miss');
    L.push(`🔁 지난 브리핑 점검 (최근 4주 ${rv.length}회)`,
      `적중 ${sum('hit')} · 일부 적중 ${sum('partial')} · 빗나감 ${sum('miss')} · 판단 보류 ${sum('hold')}` + (judged ? ` → 판정된 것 중 적중률 ${Math.round((sum('hit') + sum('partial') * 0.5) / judged * 100)}%` : ''), '');
  }
  L.push('※ 짧은 기간·적은 표본이라 우연의 영향이 큽니다. 매주 쌓이는 흐름으로 참고하세요.');
  try {
    await sendTelegram(L.join('\n')); console.log(`성적표: 텔레그램 전송 (1주 평가 ${w1.length}건 · 4주 평가 ${w4.length}건)`);
    log.lastScore = todayKst; await writeFile(logFile, JSON.stringify(log));
  }
  catch (e) { console.log(`성적표 전송 실패: ${e.message}`); }
}

main().catch(e => console.log(`성적표 오류: ${e.message}`)).then(() => process.exit(0));
