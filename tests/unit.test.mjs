/* 단위 테스트 — 외부 패키지 없이 node:test 사용
 *   node --test tests/unit.test.mjs
 * 수집 스크립트의 계산·정리 함수, AI 문장 다듬기, 지표 정의 일관성, 데이터 구조 검증을 확인 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { COMPUTED, clean, guessFreq, trim, valueAsOf, round, parseWorldBank } from '../scripts/fetch-data.mjs';
import { readSheet } from '../scripts/lib/xlsx.mjs';
import { deflateRawSync } from 'node:zlib';
import { clean as aiClean, soften, cleanWatch, groundRefs, checkNumbers, stats as aiStats, weeklyBlock, energyLinks, chainLinks } from '../scripts/ai-insight.mjs';
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
test('석탄÷가스 상대가격 = 뉴캐슬 석탄($/t) ÷ JKM($/MMBtu), 같은 달끼리', () => {
  near(COMPUTED.coal_jkm.calc(140, 28), 5);
  assert.equal(COMPUTED.coal_jkm.byMonth, true);
  assert.deepEqual(COMPUTED.coal_jkm.inputs, ['coal', 'aux_jkm_m']);
});
test('단순 계산 지표', () => {
  near(COMPUTED.brent_wti.calc(85, 80), 5);
  near(COMPUTED.gold_silver.calc(4000, 50), 80);
  near(COMPUTED.hy_ig.calc(3.2, 0.8), 2.4);
  near(COMPUTED.us_crude_total.calc(420, 280), 700);
  near(COMPUTED.kr_us_base.calc(2.5, 4.0), -1.5);
});
test('디젤 크랙·재고 일수·비료 구매력', () => {
  near(COMPUTED.diesel_crack.calc(3.0, 100), 26);              // 3$/gal × 42 − 100
  near(COMPUTED.distill_days.calc(102.6, 3.9), 102.6 / 3.9);   // 백만 bbl ÷ 백만 b/d = 일
  near(COMPUTED.gasoline_days.calc(208, 8.32), 25);
  near(COMPUTED.fert_afford_urea.calc(400, 200), 2);
  near(COMPUTED.fert_afford_dap.calc(800, 200), 4);
  for (const k of ['fert_afford_urea', 'fert_afford_dap']) { assert.equal(COMPUTED[k].byMonth, true); assert.equal(COMPUTED[k].inputs[1], 'aux_maize_m'); }
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
test('수집 소스: 카드 지표가 아닌 소스는 가이드용(gd_·tk_)·계산용 보조(aux_)만', async () => {
  const cfg = await loadConfig();
  const ids = new Set(cfg.indicators.map(i => i.id));
  const orphan = Object.keys(SOURCES).filter(id => !ids.has(id) && !/^(gd_|tk_|aux_)/.test(id));
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

/* ---------- 상관관계 (corr.js) ---------- */
const loadCorr = async () => {
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(await readFile(new URL('../corr.js', import.meta.url), 'utf8'), ctx);
  return ctx.CORR;
};
/** 주간 합성 시계열: 수익률 배열 → 수준 (월요일 날짜) */
const wkSeries = (id, rets, mode = 'pct', freq = 'W') => {
  let v = 100; const t0 = Date.UTC(2024, 0, 1);   // 월요일
  const hist = rets.map((r, i) => { v = mode === 'pct' ? v * (1 + r) : v + r; return { date: new Date(t0 + i * 7 * 86400000).toISOString().slice(0, 10), value: v }; });
  return { id, mode, freq, hist };
};
const noise = n => { let s = 7; return Array.from({ length: n }, () => { s = (s * 16807) % 2147483647; return (s / 2147483647 - 0.5) * 0.04; }); };
test('상관: 같은 변화 = +1, 반대 변화 = −1, 추세만 같은 무관한 두 지표는 낮음', async () => {
  const C = await loadCorr(), r = noise(80);
  const a = wkSeries('a', r), b = wkSeries('b', r.map(x => x * 2)), c = wkSeries('c', r.map(x => -x));
  near(C.pair(a, b).windows[1].r, 1, 1e-9);
  near(C.pair(a, c).windows[1].r, -1, 1e-9);
  // 둘 다 꾸준히 오르지만 흔들림은 무관 → 수준 상관은 높아도 변화율 상관은 낮아야 함
  const r2 = noise(160).slice(80);
  const up1 = wkSeries('u1', r.map(x => x + 0.01)), up2 = wkSeries('u2', r2.map(x => x + 0.01));
  assert.ok(Math.abs(C.pair(up1, up2).windows[1].r) < 0.4);
});
test('상관: 표본 부족이면 계산 안 함, 월간이 끼면 월간 기준', async () => {
  const C = await loadCorr(), r = noise(80);
  const p = C.pair(wkSeries('a', r.slice(0, 10)), wkSeries('b', r.slice(0, 10)));
  assert.ok(p.windows.every(w => w.r == null));
  assert.equal(C.pair(wkSeries('a', r), { ...wkSeries('m', r), freq: 'M' }).basis, 'M');
  assert.equal(C.keyOf('2026-10-17', 'W'), '2026-10-12');
  assert.equal(C.keyOf('2026-10-17', 'M'), '2026-10');
});
test('상관: 선행·후행 — A 가 3주 먼저 움직이면 lag +3', async () => {
  const C = await loadCorr(), r = noise(90);
  const a = wkSeries('a', r.slice(3));
  // b 의 t 주 변화 = a 의 (t−3) 주 변화
  const b2 = wkSeries('b', [0, 0, 0, ...r.slice(3, -3)]);
  const p = C.pair(a, b2);
  assert.ok(p.lead && p.lead.lag === 3 && p.lead.r > 0.9, JSON.stringify(p.lead));
  const q = C.pair(b2, a);
  assert.ok(q.lead && q.lead.lag === -3, JSON.stringify(q.lead));
});
test('상관: 순위와 겹친 차트', async () => {
  const C = await loadCorr(), r = noise(80), r2 = noise(160).slice(80);
  const list = [wkSeries('a', r), wkSeries('same', r), wkSeries('inv', r.map(x => -x)), wkSeries('other', r2), wkSeries('short', r.slice(0, 5))];
  const t = C.top('a', list);
  assert.equal(t.pos[0].id, 'same'); assert.equal(t.neg[0].id, 'inv');
  assert.ok(!t.pos.concat(t.neg).some(x => x.id === 'short'));
  const ov = C.overlay(list[0], list[1], 52);
  assert.equal(ov.a.length, 52); near(ov.a[0], 100); near(ov.b[0], 100);
});
test('관계 분석: 민감도(기울기)·이동 상관·반전', async () => {
  const C = await loadCorr(), r = noise(120);
  const a = wkSeries('a', r), b = wkSeries('b', r.map(x => x * 0.5));
  near(C.beta(a, b).beta, 0.5, 1e-9);
  // 앞 60주는 같은 방향, 뒤 60주는 반대 방향 → 현재 음수, 반전 시점 존재
  const flipB = wkSeries('f', r.map((x, i) => (i < 60 ? x : -x)));
  const ro = C.rolling(a, flipB);
  assert.ok(ro.pts.length > 10 && ro.pts.at(-1).r < -0.9 && ro.pts[0].r > 0.9);
  assert.ok(ro.flip && ro.flip.from > 0);
});
test('관계 분석: 사건 반응 — A 급등 다음 주 B 가 오르면 평균 플러스, 연속 사건은 한 번', async () => {
  const C = await loadCorr(), r = noise(150);
  const ra = r.slice(), rb = r.map(x => x * 0.1);
  for (const i of [20, 50, 80, 110, 140]) { ra[i] = 0.2; rb[i + 1] = 0.05; }
  ra[21] = 0.2;   // 연속 급등 → 한 번으로
  const ev = C.events(wkSeries('a', ra), wkSeries('b', rb));
  assert.equal(ev.up.n, 5);
  assert.ok(ev.up.res[0].avg > 0.03 && ev.up.res[0].up >= 4, JSON.stringify(ev.up));
  assert.ok(Math.abs(ev.base.res[0].avg) < 0.01);
});
test('관계 분석: 비율·차이와 기간 내 위치', async () => {
  const C = await loadCorr(), r = noise(60);
  const ra = C.ratio(wkSeries('a', r.map(x => x + 0.01)), wkSeries('b', r));
  assert.equal(ra.kind, 'ratio'); assert.ok(ra.pctl > 90);   // A 가 꾸준히 더 오름 → 비율 최고권
  const d = C.ratio(wkSeries('a', r, 'diff'), wkSeries('b', r.map(x => x - 200), 'diff'));
  assert.equal(d.kind, 'diff');
});
test('관계 분석: 엇갈림 — 평소 같은 방향인데 최근 8주 반대로 크게 움직이면 감지', async () => {
  const C = await loadCorr(), r = noise(80);
  const rb = r.map((x, i) => (i >= 72 ? -x : x));
  const ra = r.map((x, i) => (i >= 72 ? Math.abs(x) + 0.01 : x));   // 최근 A 는 계속 오르고 B 는 반대
  const rb2 = ra.map((x, i) => (i >= 72 ? -x : x));
  const d = C.divergence(wkSeries('a', ra), wkSeries('b', rb2), 1);
  assert.ok(d && d.on && d.r1 > 0.5 && d.rr < 0, JSON.stringify(d));
  assert.equal(C.divergence(wkSeries('a', ra), wkSeries('b', ra), 1).on, false);
  assert.equal(C.divergence(wkSeries('a', ra), wkSeries('b', rb2), -1).on, false);   // 반대 짝 기대면 감지 안 함
  void rb;
});

/* ---------- 월요일 주간판 ---------- */
test('주간판: 1주 변화(일간 7일 전·주간 직전 발표·월간 없음)와 이번 주 발표 여부', () => {
  const day = 86400000, now = Date.now(), iso = t => new Date(t).toISOString().slice(0, 10);
  const dObs = Array.from({ length: 40 }, (_, i) => [iso(now - (39 - i) * day), 100 + i]);
  const d = aiStats('wti', { freq: 'D', obs: dObs }, { name: 'WTI', cat: 'energy', unit: '$', dp: 2, mode: 'pct' });
  near(d.chg_1w, (139 - 132) / 132 * 100, 0.01);
  assert.equal(d.released_7d, true);
  const mObs = Array.from({ length: 24 }, (_, i) => [iso(now - (23 - i) * 30 * day - 20 * day), 3 + i / 100]);
  const m = aiStats('cpi', { freq: 'M', obs: mObs }, { name: 'CPI', cat: 'inflation', unit: '%', dp: 1, mode: 'pp' });
  assert.equal(m.chg_1w, null); assert.equal(m.released_7d, false);
});
test('주간판 지시: 한 주 크게 움직인 지표 · 이번 주 발표 · 매일 브리핑 제목', () => {
  const rows = [
    { id: 'wti', name: 'WTI', value: 70, unit: '$', date: '2026-10-16', freq: 'D', chg_1w: -6, chg_1m: -3, z_1m: -1, chg_unit: '%', released_7d: true },
    { id: 'us10y', name: '미국 10년물', value: 4.1, unit: '%', date: '2026-10-16', freq: 'D', chg_1w: 0.01, chg_1m: 0.2, z_1m: 1, chg_unit: '%p', released_7d: true },
    { id: 'cpi', name: 'CPI', value: 3, unit: '%', date: '2026-10-15', freq: 'M', chg_1w: null, chg_prev: 0.1, chg_unit: '%p', released_7d: true }
  ];
  const prev = { generatedAt: '2026-10-16T22:30:00Z', briefing: { headline: '어제' }, briefHistory: [{ date: '2026-10-12', headline: '주초 제목', top3: ['a'] }, { date: '2026-10-11', headline: '지난 주간', weekly: true }] };
  const t = weeklyBlock(prev, rows);
  assert.ok(/월요일 주간판/.test(t));
  assert.ok(t.indexOf('WTI: 1주 -6%') < t.indexOf('미국 10년물: 1주'), '평소 변동 대비 큰 순서');
  assert.ok(/CPI: 3% \(2026-10-15/.test(t));
  assert.ok(/주초 제목/.test(t) && !/지난 주간/.test(t), '지난 주간판 제목은 제외');
  assert.ok(/어제/.test(weeklyBlock({ generatedAt: '2026-10-16T22:30:00Z', briefing: { headline: '어제' } }, rows)), '기록이 없으면 지난 브리핑 하나라도');
});

/* ---------- World Bank 월간 가격표 (xlsx) ---------- */
/** 테스트용 최소 zip(xlsx) 만들기: { 이름: 내용 } — 저장·deflate 섞어서 */
function makeZip(files) {
  const locals = [], centrals = []; let off = 0;
  Object.entries(files).forEach(([name, text], i) => {
    const data = Buffer.from(text, 'utf8'), method = i % 2 ? 8 : 0, body = method ? deflateRawSync(data) : data, nm = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nm, body); centrals.push(ch, nm); off += 30 + nm.length + body.length;
  });
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
const pinkSheet = () => makeZip({
  'xl/workbook.xml': '<workbook><sheets><sheet name="AFOSHEET" sheetId="1" r:id="rId1"/><sheet name="Monthly Prices" sheetId="2" r:id="rId2"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>World Bank Commodity Price Data</t></si><si><t xml:space="preserve">Urea </t></si><si><t>DAP</t></si><si><r><t>Potassium </t></r><r><t>chloride **</t></r></si><si><t>1960M01</t></si><si><t>2026M08</t></si><si><t>2026M09</t></si><si><t>&#8230;</t></si></sst>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1"><v>9</v></c></row></sheetData></worksheet>',
  'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
    '<row r="5"><c r="B5" t="s"><v>1</v></c><c r="C5" t="s"><v>2</v></c><c r="E5" t="s"><v>3</v></c></row>' +
    '<row r="6"><c r="B6" t="inlineStr"><is><t>($/mt)</t></is></c></row>' +
    '<row r="7"><c r="A7" t="s"><v>4</v></c><c r="B7" t="s"><v>7</v></c><c r="C7"><v>40.5</v></c></row>' +
    '<row r="8"><c r="A8" t="s"><v>5</v></c><c r="B8"><v>410.25</v></c><c r="C8"><v>640</v></c><c r="E8"><v>355.5</v></c></row>' +
    '<row r="9"><c r="A9" t="s"><v>6</v></c><c r="B9"><v>420</v></c><c r="C9"/><c r="E9"><v>360</v></c></row></sheetData></worksheet>'
});
test('xlsx 읽기: 시트 이름으로 찾기, 공유 문자열·서식 문자열·빈 칸·열 위치', () => {
  const rows = readSheet(pinkSheet(), /^monthly prices$/i);
  assert.equal(rows[1][1], 'Urea '); assert.equal(rows[1][4], 'Potassium chloride **');
  assert.equal(rows[4][2], 640); assert.equal(rows[4][3], null);
  assert.throws(() => readSheet(pinkSheet(), /^없는 시트$/), /시트 없음/);
  assert.throws(() => readSheet(Buffer.from('not a zip'), /x/), /zip/);
});
test('World Bank 가격표 → 월간 관측치 (품목 머리글 앞부분 일치, 숫자 아닌 값·빈 칸 제외)', () => {
  const rows = readSheet(pinkSheet(), /^monthly prices$/i);
  assert.deepEqual(parseWorldBank(rows, 'Urea'), [['2026-08-01', 410.25], ['2026-09-01', 420]]);
  assert.deepEqual(parseWorldBank(rows, 'DAP'), [['1960-01-01', 40.5], ['2026-08-01', 640]]);
  assert.deepEqual(parseWorldBank(rows, 'Potassium chloride'), [['2026-08-01', 355.5], ['2026-09-01', 360]]);
  assert.throws(() => parseWorldBank(rows, 'Phosphate rock'), /없음/);
});

/* ---------- 에너지 3축: 연결 신호 판정 ---------- */
test('에너지 연결 신호: 데이터로 [지지]·[해당 없음]·[지지·반대 공존] 판정', () => {
  const r = (id, name, value, extra = {}) => ({ id, name, value, unit: '', date: '2026-10-16', chg_unit: '%', ...extra });
  const mv = v => ({ chg_1m: v, chg_1w: v });   // 월요일(주간판)에 돌아도 같은 결과
  const rows = [
    r('brent', '브렌트유', 100, { chg_3m: 15, ...mv(5) }), r('wti', 'WTI', 95, mv(5)),
    r('jkm', 'JKM', 14, mv(8)), r('ttf', 'TTF', 40, mv(4)), r('eurusd', '유로/달러', 1.1, mv(0)), r('natgas', '헨리허브', 3, mv(-3)),
    r('coal_jkm', '석탄÷가스 상대가격', 6.5, { date: '2026-07-01' }),
    r('coal_pw_jpn', '일본 석탄 발전 비중', 29, { chg_1y: -0.4, chg_unit: '%p' }), r('coal_pw_kor', '한국 석탄 발전 비중', 37, { chg_1y: -1, chg_unit: '%p' }),
    r('lng_spread', 'LNG 수출 마진', 9), r('ng_storage', '미국 가스 저장량', 3500, { season_dev: 2 }),
    r('power_gas', '미국 가스 발전 비중', 39, { ...mv(-2), chg_unit: '%p' }), r('power_coal', '미국 석탄 발전 비중', 16, { ...mv(1.5), chg_unit: '%p' }),
    r('coking_amr', '원료탄 (AMR)', 160, mv(6)), r('nuclear_util', '미국 원전 가동률', 92)
  ];
  const { snap, links } = energyLinks(rows);
  const get = n => links.find(l => l.startsWith(n));
  assert.ok(snap.oil.length && snap.gas.length && snap.coal.length);
  assert.match(get('①'), /\[지지\]/);                       // 브렌트 3개월 +15%
  assert.match(get('②'), /지지·반대 공존/);                    // 6.5 < 7 이지만 일본·한국 석탄 비중 감소
  assert.match(get('②'), /2026-07-01 기준/);
  assert.match(get('③'), /\[지지\].*아시아가 비쌈/);           // 14 − 40×1.1/3.412 ≈ 1.1
  assert.match(get('④'), /\[지지\]/);                       // 마진 9
  assert.match(get('⑤'), /\[지지\]/);                       // 가스 −2 · 석탄 +1.5
  assert.match(get('⑥'), /\[지지\]/);                       // 원유·가스·석탄 모두 +2% 넘게
  assert.match(get('⑦'), /\[해당 없음\]/);                   // 원전 92%
  assert.deepEqual(energyLinks([]).links, []);
});

/* ---------- 연결 블록: 식량·중국 철강·한국 수입 부담 ---------- */
test('연결 블록 신호: 식량·철강·한국 판정', () => {
  const r = (id, name, value, extra = {}) => ({ id, name, value, unit: '', date: '2026-10-16', chg_unit: '%', freq: 'D', ...extra });
  const mv = v => ({ chg_1m: v, chg_1w: v });
  const M = { freq: 'M', date: '2026-09-01' };
  const rows = [
    r('ttf', 'TTF', 88, { chg_3m: 20, ...mv(4) }), r('fert_urea', '요소', 410, { ...M, chg_3m: 12, chg_1m: 3 }),
    r('fert_afford_urea', '비료 구매력 (요소÷옥수수)', 2.3, { ...M, chg_3m: 9, position: 90 }), r('fert_afford_dap', '비료 구매력 (DAP÷옥수수)', 4.1, { ...M, position: 85 }),
    r('corn', '옥수수', 183, { chg_3m: -11, ...mv(-4) }), r('dxy', '달러인덱스', 102, mv(0.5)), r('fert_cf', '질소 비료 (CF)', 118, mv(-8)), r('fert_mos', 'MOS', 18, mv(-20)),
    r('iron_ore', '철광석', 90, { ...mv(-6), position: 5 }), r('coking_amr', '원료탄 (AMR)', 160, mv(-5)), r('audusd', '호주달러', 0.69, mv(-2)),
    r('usdcny', '위안/달러', 6.7, mv(0.8)), r('bdry', '벌크선', 13, mv(2)),
    r('usdkrw', '원/달러', 1330, mv(-3.5)), r('brent', '브렌트유', 110, mv(8)), r('brent_krw', '원화 환산 브렌트', 146000, { ...mv(4), chg_3m: 12, position: 90 }),
    r('jkm', 'JKM', 30, mv(10)), r('kr_cpi', '한국 CPI', 2.9, M)
  ];
  const ch = chainLinks(rows);
  const get = (k, n) => ch[k].links.find(l => l.startsWith(n));
  assert.match(get('food', '①'), /\[지지\]/);           // 가스 3개월 +20%, 요소 +12%
  assert.match(get('food', '②'), /\[지지\].*비싼 구간/);
  assert.match(get('food', '③'), /\[지지\]/);           // 옥수수 −11%, 구매력 +9%
  assert.match(get('food', '④'), /지지·반대 공존/);       // CF −8% vs 요소 +3%
  assert.match(get('food', '⑤'), /\[해당 없음\]/);
  assert.match(get('steel', '①'), /\[지지\]/);
  assert.match(get('steel', '②'), /\[지지\]/);
  assert.match(get('steel', '③'), /\[지지\]/);          // 위안 약세 + 철광석 하락
  assert.match(get('steel', '④'), /\[해당 없음\]/);
  assert.match(get('steel', '⑤'), /저점권/);
  assert.match(get('korea', '①'), /\[지지\]/);          // (1.10×0.965−1) ≈ +6.2%
  assert.match(get('korea', '②'), /\[지지\].*덜어줌/);     // 원화 강세가 유가 충격 덜어줌
  assert.match(get('korea', '④'), /\[지지\].*2026-09/);
  assert.ok(ch.korea.snap.some(x => /원화 환산 LNG.*39,900원/.test(x)));
  assert.ok(ch.food.snap.some(x => /2026-09 기준, 3개월/.test(x)));
  const empty = chainLinks([]);
  assert.deepEqual([empty.food.links, empty.steel.links, empty.korea.links], [[], [], []]);
});
