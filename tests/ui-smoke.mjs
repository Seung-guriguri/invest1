#!/usr/bin/env node
/* =====================================================================
 * 화면 스모크 테스트 (Playwright) — 실제 브라우저로 앱을 열어 주요 기능이 깨지지 않았는지 확인
 *   node tests/ui-smoke.mjs
 * 가짜(합성) 데이터를 임시 폴더에 만들어 앱 파일과 함께 띄움 → 실제 API·네트워크 불필요
 * 확인: v1·v2 × 라이트·다크 로드 오류 없음 · 화면 전환(AI·오늘·지표) · 모든 분류 탭 · 모든 지표 상세 열기 ·
 *       공유 이미지 그리기 · 공유 링크(#ind=) · 경고 모아보기 · 직접 입력 백업→복원 왕복 · 가로 넘침 없음(360px)
 * 실패하면 exit 1
 * ===================================================================== */
import { mkdtemp, cp, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { SOURCES } from '../scripts/sources.mjs';
import { COMPUTED } from '../scripts/fetch-data.mjs';
import { loadConfig } from '../scripts/lib/config.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const FILES = ['index.html', 'data.js', 'notes.js', 'season.js', 'tankers.js', 'guides.js', 'corr.js', 'share.js', 'ui-v2.css', 'ui-v2.js', 'manifest.json', 'sw.js', 'icons'];

/** 합성 데이터: 지표마다 주기에 맞는 결정적(같은 입력 → 같은 값) 시계열 */
function fixture(cfg) {
  const today = new Date(); const iso = d => d.toISOString().slice(0, 10);
  const monthly = new Set(cfg.indicators.filter(i => i.change && i.change.yoy).map(i => i.id));
  const series = {};
  const ids = [...Object.keys(SOURCES), ...Object.keys(COMPUTED)];
  ids.forEach((id, k) => {
    const freq = monthly.has(id) || /cpi|ppi|pce|unemp|payems|indpro|retail|m2|coal$|nickel|umcsent|cfnai|pmi_|sahm|us_coal_cons/.test(id) ? 'M' : /^(us_crude|us_gasoline|us_distill|us_spr|ng_storage|cushing|refinery_util|us_crude_prod|gasoline_demand|distill_demand|crude_net_imports|claims|nfci|stlfsi|fed_bs)$/.test(id) ? 'W' : 'D';
    const n = freq === 'M' ? 72 : freq === 'W' ? 300 : 500, step = freq === 'M' ? 30.4 : freq === 'W' ? 7 : 1;
    const base = 10 + (k % 17) * 7;
    const obs = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - (i * step + 1) * 86400000);
      const v = base * (1 + 0.1 * Math.sin((i + k) / 9) + (k % 5 === 0 && i === 0 ? 0.12 : 0));
      obs.push([iso(d), Math.round(v * 1000) / 1000]);
    }
    series[id] = { source: SOURCES[id] ? 'Yahoo:TEST' : 'Calc:TEST', freq, fetchedAt: today.toISOString(), obs };
  });
  // 품질 상태 확인용: WTI 마지막 값 급변(+40%) → 검증 필요, 천연가스는 이번 수집 실패(이전 값 유지) → 지연
  const w = series.wti.obs; w[w.length - 1][1] = Math.round(w[w.length - 2][1] * 1.4 * 1000) / 1000;
  return { generatedAt: today.toISOString(), series, errors: [{ id: 'natgas', message: '테스트 실패', keptPrevious: true }] };
}
const AI = { generatedAt: new Date().toISOString(), model: 'test',
  briefing: { headline: '테스트 브리핑', story: '합성 데이터로 만든 테스트 문장입니다.', top3: ['하나', '둘', '셋'], points: ['수치'], korea: '한국', watch: ['확인'], counterpoint: '반대', refs: [{ id: 'wti', date: '2020-01-01' }, { id: 'us10y', date: '2020-01-01' }, { id: 'nope', date: '2020-01-01' }], grounding: { checked: 5, matched: 4, unmatched: ['9.9%'] } },
  energy: { headline: '가스發 석탄 전환', oil: '원유 한 줄', gas: '가스 한 줄', coal: '석탄 한 줄', link: '연결 한 줄', counter: '반대 한 줄' },
  chains: { food: { headline: '비료 부담', body: '식량 체인 본문', counter: '식량 반대' }, steel: { headline: '철강 부진', body: '철강 체인 본문', counter: '' }, korea: { headline: '원화 완충', body: '한국 수입 본문', counter: '' } },
  sections: { rates: { headline: '금리 제목', body: '금리 본문', review: '' }, fx: { headline: '환율 제목', body: '환율 본문', review: '' } }, indicators: { wti: '테스트 해설' } };

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

async function main() {
  // require 는 NODE_PATH(전역 설치)도 찾음 — 로컬은 전역 playwright, CI 는 npm i 로 설치
  const { chromium } = createRequire(import.meta.url)('playwright');
  const cfg = await loadConfig();
  const dir = await mkdtemp(join(tmpdir(), 'invest1-ui-'));
  for (const f of FILES) await cp(join(ROOT, f), join(dir, f), { recursive: true });
  await mkdir(join(dir, 'data'), { recursive: true });
  await writeFile(join(dir, 'data/latest.json'), JSON.stringify(fixture(cfg)));
  await writeFile(join(dir, 'data/ai.json'), JSON.stringify(AI));
  await writeFile(join(dir, 'data/alerts.json'), JSON.stringify({ active: [] }));
  const server = createServer(async (req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    try { const body = await readFile(join(dir, p === '/' ? 'index.html' : p)); res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(body); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, r));
  const URL0 = `http://localhost:${server.address().port}/index.html`;
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const fails = [];
  const check = (ok, msg) => { if (!ok) fails.push(msg); console.log(`${ok ? '✓' : '✗'} ${msg}`); };

  for (const [ui, scheme] of [['v1', 'light'], ['v1', 'dark'], ['v2', 'light'], ['v2', 'dark']]) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, colorScheme: scheme });
    await ctx.addInitScript(u => { try { localStorage.setItem('macroDash.ui', u); } catch (e) {} }, ui);
    await ctx.route(/^https?:\/\/(?!localhost)/, r => r.abort());   // 외부 요청 차단 (CDN 등)
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto(URL0); await page.waitForTimeout(1200);
    const tag = `${ui}/${scheme}`;
    check(await page.evaluate(() => document.body.dataset.view) === 'ai', `${tag}: 첫 화면 AI`);
    for (const v of ['today', 'list', 'ai']) {
      await page.evaluate(v => { setView(v); render(); }, v);
      check(await page.evaluate(v => document.body.dataset.view === v, v), `${tag}: ${v} 화면 전환`);
    }
    await page.evaluate(() => { setView('list'); });
    for (const c of cfg.categories) {
      await page.evaluate(id => { listFilter = null; activeTab = id; render(); }, c.id);
      const n = await page.evaluate(() => document.querySelectorAll('#cards [data-edit]').length);
      if (!n) check(false, `${tag}: ${c.label} 탭 카드 없음`);
    }
    if (process.env.SHOT_DIR) { await page.evaluate(() => { listFilter = null; activeTab = 'fert'; render(); scrollTo(0, 0); }); await page.screenshot({ path: `${process.env.SHOT_DIR}/fert-${ui}-${scheme}.png`, fullPage: true }); }
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag}: 360px 가로 넘침 없음`);
    if (ui === 'v1' && scheme === 'light') {
      const bad = await page.evaluate(ids => { const out = []; for (const id of ids) { try { openEdit(id); document.querySelector('#editSheet').close(); } catch (e) { out.push(id + ': ' + e.message); } } return out; }, cfg.indicators.map(i => i.id));
      check(!bad.length, `모든 지표 상세 열기 (${cfg.indicators.length}개)${bad.length ? ' — ' + bad.slice(0, 3).join(' / ') : ''}`);
      const co = await page.evaluate(() => {
        openEdit('wti'); const sec = document.querySelector('#editSheet .ind-corr'); const sel = document.querySelector('#corrPick');
        sel.value = 'brent'; sel.dispatchEvent(new Event('change'));
        DataStore.setSettings({ corrTab: 'sum' }); sel.dispatchEvent(new Event('change'));
        const r = { sec: !!sec, chips: sec.querySelectorAll('[data-edit]').length, win: document.querySelectorAll('#corrOut .corr-win div').length, svg: !!document.querySelector('#corrOut svg'), saved: (DataStore.getSettings().corrPick || {}).wti };
        return r;
      });
      const tabsOk = [];
      for (const tb of ['sum', 'roll', 'evt', 'ratio']) {
        await page.click(`#corrOut [data-corrtab="${tb}"]`);
        const st = await page.evaluate(tb => ({ tb, on: document.querySelector(`#corrOut [data-corrtab="${tb}"]`).getAttribute('aria-pressed') === 'true', txt: document.querySelector('#corrOut').innerText.length, help: !!document.querySelector('#corrOut .corr-help') === (tb !== 'sum'), saved: DataStore.getSettings().corrTab, wide: document.querySelector('#editSheet').scrollWidth > document.querySelector('#editSheet').clientWidth + 1 }), tb);
        tabsOk.push(st.on && st.txt > 40 && st.saved === tb && !st.wide && st.help ? tb : JSON.stringify(st));
        if (process.env.SHOT_DIR) { await page.evaluate(() => { const h = document.querySelector('#corrOut .corr-help'); if (h) h.open = true; document.querySelector('#corrPick').scrollIntoView(); }); await page.screenshot({ path: `${process.env.SHOT_DIR}/corr-${tb}-${ui}-${scheme}.png` }); }
      }
      check(tabsOk.join() === 'sum,roll,evt,ratio', `관계 분석 탭 (요약·추이·사건 반응·비율) ${tabsOk.join(' | ')}`);
      await page.click('#corrOut [data-corrtab="sum"]');
      await page.evaluate(() => document.querySelector('#editSheet').close());
      check(co.sec && co.win === 3 && co.svg && co.saved === 'brent', `상관관계: 순위·직접 비교·차트·선택 기억 ${JSON.stringify(co)}`);
      // 엇갈림 감지: 계산 함수를 잠시 바꿔 첫 감시 짝이 엇갈린 상황을 만들고 화면 연결 확인
      await page.evaluate(() => { window.__div = CORR.divergence; CORR.divergence = (A, B) => ({ on: A.id === 'wti' && B.id === 'etf_xle', r1: 0.8, rr: -0.3, n: 8, unit: '주', ca: 0.05, cb: -0.04, basis: 'W' }); setView('today'); render(); });
      const dvl = await page.evaluate(() => ({ rows: document.querySelectorAll('#divList .div-row').length, pairs: WATCH_PAIRS.length, count: document.querySelector('#divCount').textContent }));
      check(dvl.rows === dvl.pairs && dvl.count === `${dvl.pairs}쌍 · 엇갈림 1`, `엇갈림 감시 현황 목록 ${JSON.stringify(dvl)}`);
      const dv1 = await page.evaluate(() => ({ items: [...document.querySelectorAll('#checklist .chk-link')].length, txt: /엇갈림/.test(document.querySelector('#checklist').innerText) }));
      await page.click('#checklist .chk-link');
      const dv2 = await page.evaluate(() => ({ open: document.querySelector('#editSheet').open, pick: document.querySelector('#corrPick').value, tab: document.querySelector('#corrOut [aria-pressed="true"]').dataset.corrtab, warn: [...document.querySelectorAll('#editSheet .ind-corr [data-edit]')].some(b => b.textContent.startsWith('⚠')) }));
      await page.evaluate(() => { document.querySelector('#editSheet').close(); CORR.divergence = window.__div; render(); });
      if (process.env.SHOT_DIR) { await page.evaluate(() => { CORR.divergence = () => ({ on: true, r1: 0.8, rr: -0.3, n: 8, unit: '주', ca: 0.05, cb: -0.04, basis: 'W' }); render(); document.querySelector('#divWrap').open = true; document.querySelector('#divWrap').scrollIntoView(); }); await page.screenshot({ path: `${process.env.SHOT_DIR}/diverge-${ui}-${scheme}.png` }); await page.evaluate(() => { CORR.divergence = window.__div; render(); }); }
      check(dv1.items === 1 && dv1.txt && dv2.open && dv2.pick === 'etf_xle' && dv2.tab === 'roll', `엇갈림 감지 → 오늘 볼 것 → 비교 열기 ${JSON.stringify({ ...dv1, ...dv2 })}`);
      if (process.env.SHOT_DIR) { await page.evaluate(() => { openEdit('coal_jkm'); }); await page.waitForTimeout(200); await page.screenshot({ path: `${process.env.SHOT_DIR}/coaljkm-${ui}-${scheme}.png` }); await page.evaluate(() => document.querySelector('#editSheet').close()); }
      check(await page.evaluate(() => { openEdit('coal_jkm'); const ok = [...document.querySelectorAll('#chartHost .th-label.ref')].length === 2; document.querySelector('#editSheet').close(); return ok; }), '석탄÷가스 상대가격: 7·16 기준선 표시');
      const shared = await page.evaluate(() => ['wti', 'us_cpi', 'coal_pw_jpn', 'scfi'].map(id => { try { return Share.render(id).canvas.width; } catch (e) { return id + ':' + e.message; } }));
      check(shared.every(w => w === 1080), `공유 이미지 그리기 ${JSON.stringify(shared)}`);
      const rt = await page.evaluate(() => {
        DataStore.upsert('scfi', { value: '1234.5', date: '2026-01-02', source: 'manual' });
        DataStore.upsert('lithium', { value: '9.9', date: '2026-01-03', source: 'manual' });
        const json = DataStore.exportJSON(); DataStore.clearAll();
        const empty = DataStore.getManual('scfi').length; DataStore.importJSON(json);
        return { empty, scfi: DataStore.getManual('scfi').map(e => e.value), li: DataStore.getManual('lithium').map(e => e.value) };
      });
      check(rt.empty === 0 && rt.scfi.includes(1234.5) && rt.li.includes(9.9), `직접 입력 백업→복원 왕복 ${JSON.stringify(rt)}`);
      await page.evaluate(() => { location.hash = 'settings'; }); await page.waitForTimeout(300);
      await page.evaluate(() => { history.replaceState(null, '', location.pathname); route(); });
      await page.evaluate(() => { setView('today'); render(); });
      const hasFilter = await page.$('[data-filter="2"]');
      if (hasFilter) { await hasFilter.click(); check(await page.evaluate(() => document.body.dataset.view === 'list' && !!document.querySelector('.filter-head')), '경고 모아보기'); }
      await page.goto(URL0 + '#ind=wti'); await page.waitForTimeout(1000);
      check(await page.evaluate(() => document.querySelector('#editSheet').open && activeTab === 'energy'), '공유 링크(#ind=wti)로 상세 열림');
    }
    // 화면 안의 버튼·글자를 눌러도 스크롤 위치가 맨 위로 튀지 않아야 함 (화면 전환 버튼 제외)
    {
      const jumps = [];
      const probe = async (label, setup, sel) => {
        await page.evaluate(() => { const d = document.querySelector('#editSheet'); if (d.open) d.close(); if (location.hash) history.replaceState(null, '', location.pathname); });
        await page.evaluate(setup);
        const el = await page.$(sel); if (!el) { jumps.push(label + ': 없음'); return; }
        // 위아래 여백을 넣고 요소를 화면 가운데에 두어 (스크롤 위치는 충분히 아래, 요소는 보이는 상태) 클릭 전후를 비교
        await page.evaluate(() => { document.body.style.paddingTop = '600px'; document.body.style.paddingBottom = '2000px'; });
        await el.evaluate(e => e.scrollIntoView({ block: 'center' })); await page.waitForTimeout(80);
        const y1 = await page.evaluate(() => scrollY);
        await el.click(); await page.waitForTimeout(250);
        const y2 = await page.evaluate(() => scrollY);
        if (await page.evaluate(() => document.querySelector('#editSheet').open)) { await page.keyboard.press('Escape'); await page.waitForTimeout(250); }
        const y3 = await page.evaluate(() => scrollY);
        await page.evaluate(() => { document.body.style.paddingTop = ''; document.body.style.paddingBottom = ''; });
        if (y1 < 100 || Math.abs(y2 - y1) > 60 || Math.abs(y3 - y1) > 60) jumps.push(`${label} ${y1}→${y2}→${y3}`);
      };
      await probe('세부 탭', () => { setView('list'); listFilter = null; activeTab = 'rates'; render(); }, '#tabs [data-tab="inflation"]');
      await probe('분류 묶음', () => { setView('list'); listFilter = null; render(); }, '#tabGroups [data-group="res"]');
      await probe('지표 카드 열고 닫기', () => { setView('list'); listFilter = null; activeTab = 'energy'; render(); }, '#cards [data-edit]:nth-of-type(3)');
      await probe('체크리스트', () => { setView('today'); render(); }, '#checklist li:last-child label');
      await probe('인사이트 펼치기', () => { setView('today'); render(); }, '#insWrap summary');
      await probe('제목 글자', () => { setView('today'); render(); }, '#watchTitle');
      check(!jumps.length, `${tag}: 눌러도 맨 위로 튀지 않음${jumps.length ? ' — ' + jumps.join(' / ') : ''}`);
    }
    if (process.env.SHOT_DIR) { await page.evaluate(() => { setView('list'); listFilter = null; activeTab = 'energy'; render(); }); await page.screenshot({ path: `${process.env.SHOT_DIR}/energy3-${ui}-${scheme}.png` }); }
    const en = await page.evaluate(() => { setView('ai'); render(); const a = !!document.querySelector('#aiBrief .ai-energy') && document.querySelectorAll('#aiBrief .ai-energy .en-row').length === 5;
      setView('list'); listFilter = null; activeTab = 'energy'; render(); const b = !!document.querySelector('#cards .tab-ai .ai-energy'); return { a, b }; });
    check(en.a && en.b, `${tag}: 에너지 3축 표시 (AI 화면·에너지 탭) ${JSON.stringify(en)}`);
    const rg = await page.evaluate(() => { setView('today'); render(); const w = document.querySelector('#regimeWrap'); w.open = true;
      return { svg: !!w.querySelector('svg.rg-map'), now: !!w.querySelector('.rg-now'), pts: w.querySelectorAll('.rg-pt, .rg-now').length, chips: w.querySelectorAll('.rg-chip').length, label: document.querySelector('#regimeCount').textContent }; });
    check(rg.svg && rg.now && rg.pts >= 2 && rg.chips >= 6 && /과열|스태그|회복|침체/.test(rg.label), `${tag}: 경기 국면 지도 ${JSON.stringify(rg)}`);
    if (process.env.SHOT_DIR) { await page.evaluate(() => { setView('today'); render(); const w = document.querySelector('#regimeWrap'); w.open = true; w.scrollIntoView(); }); await page.screenshot({ path: `${process.env.SHOT_DIR}/regime-${ui}-${scheme}.png` }); }
    const chn = await page.evaluate(() => { setView('ai'); render(); const a = document.querySelectorAll('#aiBrief .ai-chain').length;
      const tab = id => { setView('list'); listFilter = null; activeTab = id; render(); return document.querySelectorAll('#cards .tab-ai .ai-chain').length; };
      return { a, fert: tab('fert'), grains: tab('grains'), metals: tab('metals'), fx: tab('fx'), rates: tab('rates') }; });
    check(chn.a === 4 && chn.fert === 1 && chn.grains === 1 && chn.metals === 1 && chn.fx === 1 && chn.rates === 0, `${tag}: 연결 블록 표시 (AI 화면 4곳·비료·곡물·금속·환율 탭) ${JSON.stringify(chn)}`);
    check(!errs.length, `${tag}: 스크립트 오류 없음${errs.length ? ' — ' + errs.slice(0, 3).join(' / ') : ''}`);
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log(fails.length ? `\n실패 ${fails.length}개` : '\n화면 스모크 테스트 통과');
  process.exit(fails.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
