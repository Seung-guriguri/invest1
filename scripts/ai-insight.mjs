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
 *
 * 프롬프트는 prompts/ai-system.md (역할·규칙), prompts/ai-user.md (데이터 틀),
 * prompts/ai-column.md (오늘의 칼럼 — 브리핑을 종합한 스토리텔링 칼럼, 추가 호출 1회) 에서 읽습니다.
 * 실패해도 작업 전체를 실패시키지 않고 이전 해설을 유지합니다.
 * ===================================================================== */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const DATA = arg('--data', 'data/latest.json');
const OUT = arg('--out', 'data/ai.json');
const PREV = arg('--previous', null);
const KEY = (process.env.GEMINI_API_KEY || '').trim();
const MODEL = (process.env.GEMINI_MODEL || '').trim();
const RUN = String(process.env.AI_RUN || '').toLowerCase() === 'true';
const TG_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TG_CHAT = (process.env.TELEGRAM_CHAT_ID || '').trim();
const SITE_URL = (process.env.SITE_URL || '').trim();
const API = 'https://generativelanguage.googleapis.com/v1beta';
const DAY = 86400000;

/* ---------- 이전 해설 유지 ---------- */
async function keepPrevious(reason) {
  console.log(`AI 인사이트: ${reason} → 이전 해설 유지`);
  if (!PREV) return;
  try {
    const prev = await readFile(PREV, 'utf8');
    JSON.parse(prev);
    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT, prev);
    console.log('  이전 ai.json 복사 완료');
  } catch (e) { console.log('  이전 ai.json 없음'); }
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
function stats(id, s, m) {
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
    chg_prev: round(change(m.mode, prev[1], last[1]), 2), chg_1m: round(chg1m, 2), chg_3m: round(chg3m, 2), chg_1y: round(chg1y, 2),
    chg_unit: m.mode === 'pct' ? '%' : m.mode === 'pp' ? '%p' : m.unit,
    z_1m: round(z, 1), position: round(position, 0), season_dev: round(season, 1)
  };
}

/* 해설 대상: 1개월 변화가 이례적이거나 분포 양 끝·평년 대비 크게 벗어난 지표 */
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

const CAT_LABEL = { rates: '금리', inflation: '물가', growth: '경기', market: '시장·신용', fx: '환율', energy: '에너지', freight: '운임', stocks: '비축·재고', metals: '금속', grains: '곡물', etf: 'ETF' };

/** 새 브리핑을 텔레그램으로 (4096자 제한 안에서) */
async function sendBriefingTelegram(b, sections, kst) {
  if (!TG_TOKEN || !TG_CHAT) { console.log('  (텔레그램 미설정 — 브리핑 전송 건너뜀)'); return; }
  const lines = [`🌅 오늘의 AI 브리핑 · ${kst}`, '', `📌 ${b.headline || ''}`, '', b.story || ''];
  if (b.points && b.points.length) lines.push('', '핵심 수치', ...b.points.map(x => `• ${x}`));
  if (b.korea) lines.push('', `🇰🇷 ${b.korea}`);
  if (b.watch && b.watch.length) lines.push('', `👀 확인할 것: ${b.watch.join(' · ')}`);
  if (b.counterpoint) lines.push('', `↔ 반대로 보면: ${b.counterpoint}`);
  const secs = CATS.filter(c => sections[c] && sections[c].headline).map(c => `• ${CAT_LABEL[c]} — ${sections[c].headline}`);
  if (secs.length) lines.push('', '분류별 한 줄', ...secs);
  if (SITE_URL) lines.push('', `전체 보기: ${SITE_URL}`);
  lines.push('', '※ AI가 생성한 일반적 해석이며 틀릴 수 있습니다. 투자 권유나 매매 판단이 아닙니다.');
  let text = lines.join('\n'); if (text.length > 4000) text = text.slice(0, 3990) + '…';
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text, disable_web_page_preview: true }), signal: AbortSignal.timeout(20000)
    });
    console.log(res.ok ? '  텔레그램으로 브리핑 전송 완료' : `  텔레그램 브리핑 전송 실패: HTTP ${res.status}`);
  } catch (e) { console.log(`  텔레그램 브리핑 전송 실패: ${e.message}`); }
}

/* ---------- 오늘의 칼럼: 브리핑을 종합한 스토리텔링 칼럼 (브리핑 성공 뒤 1회 추가 호출) ---------- */
const COLUMN_SCHEMA = { type: 'OBJECT', properties: { title: { type: 'STRING' }, body: { type: 'STRING' } }, required: ['title', 'body'] };
async function generateColumn(models, first, material) {
  const system = await readFile(new URL('../prompts/ai-column.md', import.meta.url), 'utf8');
  const user = `기준 시각: ${material.kst}\n\n[오늘의 브리핑]\n${JSON.stringify(material.briefing)}\n\n[분류별 요약]\n${JSON.stringify(material.sections)}\n\n[지표 해설]\n${JSON.stringify(material.indicators)}\n\n[주요 지표 숫자] (position 은 최근 기간 안의 위치 0~100)\n${material.rows.map(r => JSON.stringify(r)).join('\n')}\n\n위 재료로 오늘의 칼럼을 쓰세요.`;
  const body = schema => ({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature: 0.75, maxOutputTokens: 8192, responseMimeType: 'application/json', ...(schema ? { responseSchema: COLUMN_SCHEMA } : {}) }
  });
  const order = [first, ...models.filter(m => m !== first)];
  for (let round = 0; round < 2; round++) {
    for (const m of order) {
      for (const withSchema of [true, false]) {
        try {
          const resp = await post(m, body(withSchema));
          const cand = resp.candidates && resp.candidates[0];
          const text = cand && cand.content && (cand.content.parts || []).map(p => p.text || '').join('');
          const j = JSON.parse(String(text).replace(/^```(?:json)?\s*|\s*```$/g, ''));
          const title = clean(j.title, 60);
          // 문단 단위로 다듬기 (금지 표현·필드명 문장 제거), 소제목 줄 유지
          const paras = String(j.body || '').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean)
            .flatMap(x => {
              if (!x.startsWith('■')) return [clean(x.replace(/\s*\n\s*/g, ' '), 900)];
              const [head, ...rest] = x.split('\n');   // '■ 소제목' 다음 줄에 본문이 붙어 온 경우 분리
              return ['■ ' + head.replace(/^■\s*/, '').slice(0, 40), rest.length ? clean(rest.join(' '), 900) : null];
            }).filter(Boolean);
          if (!title || paras.length < 3) throw new Error('칼럼 내용 부족');
          const u = resp.usageMetadata || {};
          console.log(`✓ 오늘의 칼럼 생성 (${m}) — 입력 ${u.promptTokenCount ?? '?'} · 출력 ${u.candidatesTokenCount ?? '?'} 토큰, ${paras.join('').length}자`);
          return { title, body: paras.join('\n\n'), model: m };
        } catch (e) {
          console.log(`  칼럼 ${m}${withSchema ? '' : ' (형식 지정 없이)'} → ${e.message}`);
          if (e.status === 429) return null;
          if (e.status !== 400 && !/JSON|부족/.test(e.message)) break;   // 혼잡·없음 → 다음 모델
        }
      }
    }
    if (round === 0) await new Promise(r => setTimeout(r, 30000));
  }
  return null;
}

async function sendColumnTelegram(col) {
  if (!TG_TOKEN || !TG_CHAT || !col) return;
  let text = [`📰 오늘의 칼럼`, '', `《${col.title}》`, '', col.body, '', '※ AI가 브리핑을 바탕으로 쓴 일반적 해석이며 틀릴 수 있습니다. 투자 권유나 매매 판단이 아닙니다.'].join('\n');
  if (text.length > 4000) text = text.slice(0, 3990) + '…';
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text, disable_web_page_preview: true }), signal: AbortSignal.timeout(20000)
    });
    console.log(res.ok ? '  텔레그램으로 칼럼 전송 완료' : `  텔레그램 칼럼 전송 실패: HTTP ${res.status}`);
  } catch (e) { console.log(`  텔레그램 칼럼 전송 실패: ${e.message}`); }
}

const CATS = ['rates', 'inflation', 'growth', 'market', 'fx', 'energy', 'freight', 'stocks', 'metals', 'grains', 'etf'];

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    briefing: {
      type: 'OBJECT',
      properties: {
        headline: { type: 'STRING' }, story: { type: 'STRING' },
        points: { type: 'ARRAY', items: { type: 'STRING' } },
        korea: { type: 'STRING' },
        watch: { type: 'ARRAY', items: { type: 'STRING' } },
        counterpoint: { type: 'STRING' }
      },
      required: ['headline', 'story', 'points', 'korea', 'watch', 'counterpoint']
    },
    sections: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { cat: { type: 'STRING' }, headline: { type: 'STRING' }, body: { type: 'STRING' } }, required: ['cat', 'headline', 'body'] }
    },
    indicators: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { id: { type: 'STRING' }, comment: { type: 'STRING' } }, required: ['id', 'comment'] }
    }
  },
  required: ['briefing', 'sections', 'indicators']
};

/* ---------- 응답 검사: 투자 권유·매매 지시 표현 거르기 ---------- */
const BANNED = /(매수|매도)\s*(하세요|하라|할\s*때|타이밍|기회|추천|권)|사세요|파세요|사야\s*(한다|합니다|할|함|해|됨)|사\s*둬|매수\s*(각|타이밍)|줍줍|팔아야|담아|목표\s*가|추천\s*(종목|ETF)|수익\s*(보장|확정)|저평가|고평가|비중\s*(확대|축소)\s*(하|를|추천)/;
/** 금지 표현이 들어간 문장만 빼고 나머지는 살림 */
const FIELD_LEAK = /\b(z_1m|chg_(prev|1m|3m|1y|unit)|season_dev|position)\b/i;
const fixes = [];
function clean(s, max) {
  if (typeof s !== 'string' || !s.trim()) return null;
  // position 은 최근 2~10년 안의 위치일 뿐 → '사상·역대 최고/최저'는 '최근 수년 중 최고/최저'로
  let t = s.trim().replace(/(사상|역대|역사적(?:인)?)\s*(?=(최고|최저|최다|최대|최소|고점|저점|상위|하위|수준))/g, m0 => { fixes.push(m0 + '→최근 수년 중'); return '최근 수년 중 '; });
  const kept = t.split(/(?<=[.!?。])\s+/).filter(x => { const bad = BANNED.test(x) || FIELD_LEAK.test(x); if (bad) fixes.push('문장 제거: ' + x.slice(0, 40)); return !bad; }).join(' ').trim();
  return kept ? kept.slice(0, max) : null;
}

async function main() {
  if (!RUN) return keepPrevious('오늘 실행 대상 아님 (평일 07:23 예약 또는 수동 실행에서만 생성)');
  if (!KEY) return keepPrevious('GEMINI_API_KEY 없음');

  const latest = JSON.parse(await readFile(DATA, 'utf8'));
  const meta = await readIndicatorMeta();
  const rows = Object.entries(latest.series).filter(([id]) => meta[id]).map(([id, s]) => stats(id, s, meta[id])).filter(Boolean);
  const targets = pickTargets(rows);
  const kstDate = new Date(Date.now() + 9 * 3600000);
  const kst = `${kstDate.toISOString().slice(0, 16).replace('T', ' ')} (${'일월화수목금토'[kstDate.getUTCDay()]})`;

  const system = await readFile(new URL('../prompts/ai-system.md', import.meta.url), 'utf8');
  const user = (await readFile(new URL('../prompts/ai-user.md', import.meta.url), 'utf8'))
    .replace('{{generatedAt}}', kst)
    .replace('{{targets}}', targets.map(id => targetLine(rows.find(r => r.id === id))).join('\n') || '없음')
    .replace('{{data}}', rows.map(r => JSON.stringify(r)).join('\n'));
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
  let anyBusy = false;
  for (const m of main) {
    const r = await tryModel(m);
    if (r === 'ok') break;
    if (r === 'quota') return keepPrevious('무료 한도 초과 (429)');
    if (r === 'busy') anyBusy = true;
  }
  if (!resp && anyBusy && main.length) {
    console.log('  Flash 혼잡 → 40초 뒤 다시 시도');
    await new Promise(r => setTimeout(r, 40000));
    if (await tryModel(main[0]) === 'quota') return keepPrevious('무료 한도 초과 (429)');
  }
  for (const m of lite) {
    if (resp) break;
    const r = await tryModel(m);
    if (r === 'quota') return keepPrevious('무료 한도 초과 (429)');
  }
  if (!resp) return keepPrevious(`호출 실패: ${lastErr && lastErr.message}`);

  const cand = resp.candidates && resp.candidates[0];
  const text = cand && cand.content && (cand.content.parts || []).map(p => p.text || '').join('');
  let parsed;
  try { parsed = JSON.parse(String(text).replace(/^```(?:json)?\s*|\s*```$/g, '')); }
  catch (e) { return keepPrevious(`응답 JSON 해석 실패 (finishReason: ${cand && cand.finishReason})`); }

  const b = parsed.briefing || {};
  const briefing = {
    headline: clean(b.headline, 80), story: clean(b.story, 700),
    points: (b.points || []).map(p => clean(p, 140)).filter(Boolean).slice(0, 5),
    korea: clean(b.korea, 240), watch: (b.watch || []).map(p => clean(p, 100)).filter(Boolean).slice(0, 4),
    counterpoint: clean(b.counterpoint, 200)
  };
  const sections = {};
  for (const it of parsed.sections || []) {
    if (!it || !CATS.includes(it.cat) || sections[it.cat]) continue;
    const headline = clean(it.headline, 40), body = clean(it.body, 260);
    if (headline || body) sections[it.cat] = { headline, body };
  }
  const indicators = {};
  for (const it of parsed.indicators || []) {
    const c = it && meta[it.id] ? clean(it.comment, 320) : null;
    if (c) indicators[it.id] = c;
  }
  if (!briefing.headline && !briefing.story) return keepPrevious('브리핑 내용이 비어 있음');

  const ordered = {}; for (const id of targets) if (indicators[id]) ordered[id] = indicators[id];
  for (const [k, v] of Object.entries(indicators)) if (!ordered[k]) ordered[k] = v;
  // 브리핑을 먼저 보내고, 이어서 칼럼 생성 (칼럼이 실패해도 브리핑은 그대로)
  await sendBriefingTelegram(briefing, sections, kst);
  let column = null;
  try {
    column = await generateColumn(models, used, { kst, briefing, sections, indicators: ordered,
      rows: rows.filter(r => targets.includes(r.id)).map(({ id, name, value, unit, date, chg_1m, chg_unit, position, season_dev }) => ({ id, name, value, unit, date, chg_1m, chg_unit, position, season_dev })) });
  } catch (e) { console.log(`  칼럼 생성 오류: ${e.message}`); }
  if (column) { await sendColumnTelegram(column); console.log(`  칼럼 제목: ${column.title}`); console.log(column.body.split('\n\n').map(x => '  | ' + x).join('\n')); }
  else console.log('  오늘의 칼럼: 생성 실패 → 브리핑만 전송');

  const out = { generatedAt: new Date().toISOString(), model: used, briefing, sections, indicators: ordered, targets, ...(column ? { column } : {}) };
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
  for (const c of CATS) if (sections[c]) console.log(`  [${c}] ${sections[c].headline} | ${sections[c].body}`);
  for (const [k, v] of Object.entries(indicators)) console.log(`  <${k}> ${v}`);
  if (fixes.length) console.log(`  후처리 ${fixes.length}건: ${fixes.join(' / ')}`);
  console.log(warn.length ? `  길이·형식 경고: ${warn.join(', ')}` : '  길이·형식 점검: 모두 기준 이내');
}

main().catch(e => keepPrevious(`오류: ${e.message}`)).then(() => process.exit(0));
