/* 단위 테스트 — 외부 패키지 없이 node:test 사용
 *   node --test tests/unit.test.mjs
 * 수집 스크립트의 계산·정리 함수, AI 문장 다듬기, 지표 정의 일관성, 데이터 구조 검증을 확인 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { COMPUTED, clean, guessFreq, trim, valueAsOf, round } from '../scripts/fetch-data.mjs';
import { clean as aiClean, soften, cleanWatch, groundRefs, checkNumbers } from '../scripts/ai-insight.mjs';
import { SOURCES } from '../scripts/sources.mjs';
import { loadConfig } from '../scripts/lib/config.mjs';
import { validateData } from '../scripts/validate-data.mjs';
import { buildCatalog } from '../scripts/catalog.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

/* ---------- 계산 지표 공식 ---------- */
test('3-2-1 크랙 스프레드 = (휘발유×42×2 + 디젤×42 − WTI×3) ÷ 3', () => {
  near(COMPUTED.crack321.calc(2.5, 3.0, 80), (2.5 * 84 + 3.0 * 42 - 240) / 3);   // 32.0
  near(COMPUTED.crack321.calc(2.5, 3.0, 80), 32);
});
test('LNG 수출 마진 = TTF(€/MWh)×유로/달러÷3.412 − 헨리허브', () => {
  near(COMPUTED.lng_spread.calc(34.12, 1.0, 3), 7);
});
test('단순 계산 지표', () => {
  near(COMPUTED.brent_wti.calc(85, 80), 5);
  near(COMPUTED.gold_silver.calc(4000, 50), 80);
  near(COMPUTED.hy_ig.calc(3.2, 0.8), 2.4);
  near(COMPUTED.us_crude_total.calc(420, 280), 700);
  near(COMPUTED.kr_us_base.calc(2.5, 4.0), -1.5);
});

/* ---------- 관측치 정리 ---------- */
test('clean: 중복 날짜는 마지막 값, 오름차순, 비유한값 제거, 배율 적용', () => {
  const out = clean([['2026-01-03', 3], ['2026-01-01', 1], ['2026-01-02', NaN], ['2026-01-03', 4], ['', 9]], 0.5);
  assert.deepEqual(out, [['2026-01-01', 0.5], ['2026-01-03', 2]]);
});
test('guessFreq: 관측 간격으로 주기 추정', () => {
  const mk = (step, n = 10) => Array.from({ length: n }, (_, i) => [new Date(Date.UTC(2025, 0, 1 + i * step)).toISOString().slice(0, 10), i]);
  assert.equal(guessFreq(mk(1)), 'D');
  assert.equal(guessFreq(mk(7)), 'W');
  assert.equal(guessFreq(mk(30)), 'M');
  assert.equal(guessFreq(mk(91)), 'Q');
});
test('trim: 일간은 2년만 보관', () => {
  const old = [new Date(Date.now() - 3 * 365 * 86400000).toISOString().slice(0, 10), 1];
  const now = [new Date().toISOString().slice(0, 10), 2];
  assert.deepEqual(trim([old, now], 'D'), [now]);
  assert.deepEqual(trim([old, now], 'M'), [old, now]);
});
test('valueAsOf: 그날 이전 가장 최근 값', () => {
  const obs = [['2026-01-01', 1], ['2026-01-05', 5], ['2026-01-09', 9]];
  assert.equal(valueAsOf(obs, '2026-01-06'), 5);
  assert.equal(valueAsOf(obs, '2026-01-09'), 9);
  assert.equal(valueAsOf(obs, '2025-12-31'), null);
});
test('round: 유효숫자 8자리', () => { assert.equal(round(1 / 3), 0.33333333); });

/* ---------- AI 문장 다듬기 ---------- */
test('soften: 과장 표현 완화', () => {
  assert.equal(soften('전례 없는 상승'), '이례적인 상승');
  assert.equal(soften('가능성이 큽니다'), '가능성이 있습니다');
});
test('AI clean: 매수·매도 권유 문장 제거, 사상 최고 교정, 내부 필드명 제거', () => {
  assert.equal(aiClean('유가가 올랐다. 지금 매수하세요.', 200), '유가가 올랐다.');
  assert.match(aiClean('금값이 사상 최고다.', 200), /최근 수년 중 최고/);
  assert.equal(aiClean('chg_1m 이 컸다.', 200), null);
  assert.equal(aiClean('   ', 200), null);
});
test('관심 종목 문장: 목표가·수익 보장 제거', () => {
  assert.equal(cleanWatch('업황 개선 기대. 목표가 50달러.', 200), '업황 개선 기대.');
});

/* ---------- 지표 정의 일관성 ---------- */
test('지표 정의: id 중복 없음, 분류·단위·소수자리·판단 방식 유효', async () => {
  const cfg = await loadConfig();
  const cats = new Set(cfg.categories.map(c => c.id));
  const seen = new Set();
  for (const i of cfg.indicators) {
    assert.ok(!seen.has(i.id), `id 중복: ${i.id}`); seen.add(i.id);
    assert.ok(cats.has(i.cat), `${i.id}: 분류 ${i.cat} 없음`);
    assert.ok(['pp', 'abs', 'pct'].includes(i.changeMode), `${i.id}: changeMode ${i.changeMode}`);
    assert.ok(Number.isInteger(i.dp), `${i.id}: dp`);
    if (i.derived) assert.ok(seen.has(i.derived.a) || cfg.indicators.some(x => x.id === i.derived.a), `${i.id}: derived 재료 없음`);
  }
});
test('수집 소스: 카드 지표가 아닌 소스는 가이드용(gd_·tk_ 등)만', async () => {
  const cfg = await loadConfig();
  const ids = new Set(cfg.indicators.map(i => i.id));
  const orphan = Object.keys(SOURCES).filter(id => !ids.has(id) && !/^(gd_|tk_)/.test(id));
  assert.deepEqual(orphan, []);
  for (const id of Object.keys(COMPUTED)) assert.ok(ids.has(id), `계산 지표 ${id} 가 CONFIG 에 없음`);
});
test('지표 해설(notes.js)·계절 메모(season.js)는 있는 지표만 가리킴', async () => {
  const cfg = await loadConfig();
  const ids = new Set(cfg.indicators.map(i => i.id));
  const ctx = { window: {} }; ctx.window.window = ctx.window;
  vm.runInNewContext(await readFile(new URL('../notes.js', import.meta.url), 'utf8'), ctx);
  const bad = Object.keys(ctx.window.NOTES).filter(id => !ids.has(id));
  assert.deepEqual(bad, [], `notes.js 에만 있는 id: ${bad.join(', ')}`);
});
test('지표 카탈로그 문서가 최신', async () => {
  const cur = await readFile(new URL('../docs/indicator-catalog.md', import.meta.url), 'utf8');
  assert.equal(cur, await buildCatalog(), 'node scripts/catalog.mjs 로 다시 만드세요');
});

/* ---------- 데이터 구조 검증 ---------- */
test('validateData: 정상 구조 통과', () => {
  const d = { generatedAt: new Date().toISOString(), series: { a: { source: 'FRED:X', freq: 'D', obs: [['2026-01-01', 1], ['2026-01-02', 1.1]] } }, errors: [] };
  assert.deepEqual(validateData(d).errors, []);
});
test('validateData: 날짜 역순·중복·숫자 아님·관측치 부족은 오류', () => {
  const mk = obs => ({ generatedAt: new Date().toISOString(), series: { a: { source: 'X', freq: 'D', obs } } });
  assert.ok(validateData(mk([['2026-01-02', 1], ['2026-01-01', 2]])).errors.length);
  assert.ok(validateData(mk([['2026-01-01', 1], ['2026-01-01', 2]])).errors.length);
  assert.ok(validateData(mk([['2026-01-01', 1], ['2026-01-02', '2']])).errors.length);
  assert.ok(validateData(mk([['2026-01-01', 1]])).errors.length);
  assert.ok(validateData({ series: {} }).errors.length);
});
test('validateData: 급변은 오류가 아니라 검증 필요 메모 (값 유지)', () => {
  const d = { generatedAt: new Date().toISOString(), series: { a: { source: 'X', freq: 'D', obs: [['2026-01-01', 100], ['2026-01-02', 200]] } } };
  const r = validateData(d);
  assert.deepEqual(r.errors, []);
  assert.equal(r.stats.spikes, 1);
});

/* ---------- 분석 모듈·관계 카탈로그·산업별 경고 규칙 (analysis.js) ---------- */
const loadAnalysis = async () => {
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(await readFile(new URL('../analysis.js', import.meta.url), 'utf8'), ctx);
  return ctx.ANALYSIS;
};
/** 합성 분석 결과: hist 는 [날짜, 값] 오래된 순 */
const fakeA = (id, rows, extra = {}) => {
  const history = rows.map(([date, value]) => ({ date, value })).reverse();
  return { ind: { id, name: id }, history, cur: history[0], value: history[0].value, freq: 'D', quality: { code: 'ok' }, ...extra };
};
test('분석: 모듈·관계·규칙의 지표 id 가 CONFIG 에 있음 (계산 행 $jkm_ttf 제외)', async () => {
  const A = await loadAnalysis(), cfg = await loadConfig();
  const ids = new Set(cfg.indicators.map(i => i.id)), bad = [];
  const ok = id => ids.has(id) || id === '$jkm_ttf';
  for (const m of A.modules) { assert.ok(m.gaps.length && typeof m.observe === 'function', m.id); for (const [, r] of m.rows) r.forEach(id => ok(id) || bad.push(m.id + ':' + id)); }
  for (const r of A.relations) {
    assert.ok(A.relTypes[r.type], `${r.id} 유형`);
    if (r.type === 'stat') assert.equal(r.pair.length, 2, r.id);
    [...(r.from || []), ...(r.to || []), ...(r.pair || [])].forEach(id => ok(id) || bad.push(r.id + ':' + id));
  }
  for (const r of A.rules) {
    for (const k of ['title', 'triggerText', 'clearText']) assert.ok(r[k], `${r.id}.${k}`);
    assert.ok(r.evidence.length && ['trigger', 'clear', 'counter'].every(k => typeof r[k] === 'function'), r.id);
    assert.equal(r.mode, 'shadow', `${r.id}: 검증 전 규칙은 시험 운영`);
    assert.ok(A.modules.some(m => m.id === r.sector), r.id);
    r.evidence.forEach(id => ok(id) || bad.push(r.id + ':' + id));
  }
  assert.deepEqual(bad, []);
  assert.equal(new Set(A.rules.map(r => r.id)).size, A.rules.length, '규칙 id 중복');
});
test('분석: 경고 규칙 상태 — 발생 / 경계 / 정상 / 판단 보류', async () => {
  const A = await loadAnalysis(), rule = A.rules.find(r => r.id === 'crude-refinery-outage');
  const st = (v, q = 'ok') => A.evalRule(rule, A.makeCtx({ refinery_util: fakeA('refinery_util', [['2026-10-01', v]], { quality: { code: q } }) })).state;
  assert.equal(st(80), 'on'); assert.equal(st(86), 'watch'); assert.equal(st(90), 'off'); assert.equal(st(80, 'stale'), 'hold');
  assert.equal(A.evalRule(rule, A.makeCtx({})).state, 'hold', '데이터 없음 → 판단 보류');
});
test('분석: JKM−TTF 가격차 계산과 데이터 없을 때 null', async () => {
  const A = await loadAnalysis();
  const R = { jkm: fakeA('jkm', [['2026-10-01', 12]]), ttf: fakeA('ttf', [['2026-10-01', 34.12]]), eurusd: fakeA('eurusd', [['2026-10-01', 1]]) };
  near(A.makeCtx(R).jkmTtf().value, 2);
  assert.equal(A.makeCtx({ jkm: R.jkm }).jkmTtf(), null);
});
test('분석: 비교 기준 — 직전·전년, 주간 변화율 상관', async () => {
  const A = await loadAnalysis();
  const rows = [], rows2 = [], rows3 = [];
  for (let i = 0; i < 400; i += 7) {
    const d = new Date(Date.UTC(2025, 8, 1) + i * 86400000).toISOString().slice(0, 10), x = 100 + i + (i % 21 ? 5 : -5);
    rows.push([d, x]); rows2.push([d, x * 2]); rows3.push([d, 1000 - x]);
  }
  const c = A.makeCtx({ a: fakeA('a', rows, { freq: 'W' }), b: fakeA('b', rows2, { freq: 'W' }), n: fakeA('n', rows3, { freq: 'W' }) });
  near(c.wk('a').abs, rows.at(-1)[1] - rows.at(-2)[1]);
  assert.ok(c.yoy('a') && Math.abs(Date.parse(c.yoy('a').from) - (Date.parse(rows.at(-1)[0]) - 365 * 86400000)) <= 10 * 86400000);
  near(A.weeklyCorr(c, 'a', 'b').r, 1, 1e-9);
  assert.ok(A.weeklyCorr(c, 'a', 'n').r < -0.5, String(A.weeklyCorr(c, 'a', 'n').r));
  assert.equal(A.weeklyCorr(A.makeCtx({}), 'a', 'b'), null);
});
test('분석: 모든 모듈이 빈 데이터·합성 데이터에서 오류 없이 실행', async () => {
  const A = await loadAnalysis();
  for (const m of A.modules) {
    const res = A.runModule(m, {});
    assert.ok(Array.isArray(res.observations) && !res.observations.some(o => /오류/.test(o.text)), m.id);
    assert.ok(res.rules.every(r => r.state === 'hold'));
  }
});

/* ---------- AI 근거 검증 ---------- */
const gRows = [
  { id: 'us10y', name: '미국 10년물 금리', cat: 'rates', value: 4.12, date: '2026-10-16', chg_prev: -0.03, chg_1m: 0.21, position: 78 },
  { id: 'wti', name: 'WTI 원유 (미국)', cat: 'energy', value: 71.35, date: '2026-10-16', chg_1m: -5.4, chg_1y: -12.33 }
];
test('AI 근거 지표: 데이터에 없는 ID 제거, 기준일은 데이터에서 붙임, ID 가 없으면 본문 이름으로 찾음', () => {
  assert.deepEqual(groundRefs(['us10y', 'made_up', 'us10y'], gRows), [{ id: 'us10y', date: '2026-10-16' }]);
  assert.deepEqual(groundRefs([], gRows, ['WTI 원유가 하락']), [{ id: 'wti', date: '2026-10-16' }]);
  assert.deepEqual(groundRefs(undefined, gRows), []);
});
test('AI 숫자 대조: 값·변화율·분포 위치와 맞는지, 날짜·연도·개수는 제외', () => {
  const g = checkNumbers(['미국 10년물 4.12%, 한 달 +0.21%p, 상위 22%. WTI 71.4달러(1개월 −5.4%)', '3가지 확인, 2026년 10월 16일, 2026-10-16 기준', '엉뚱한 9.99%'], gRows);
  assert.equal(g.checked, 6);
  assert.equal(g.matched, 5);
  assert.deepEqual(g.unmatched, ['9.99%']);
});
