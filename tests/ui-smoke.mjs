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
  sections: { rates: { headline: '금리 제목', body: '금리 본문', review: '' } }, indicators: { wti: '테스트 해설' } };

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
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag}: 360px 가로 넘침 없음`);
    if (ui === 'v1' && scheme === 'light') {
      const bad = await page.evaluate(ids => { const out = []; for (const id of ids) { try { openEdit(id); document.querySelector('#editSheet').close(); } catch (e) { out.push(id + ': ' + e.message); } } return out; }, cfg.indicators.map(i => i.id));
      check(!bad.length, `모든 지표 상세 열기 (${cfg.indicators.length}개)${bad.length ? ' — ' + bad.slice(0, 3).join(' / ') : ''}`);
      const co = await page.evaluate(() => {
        openEdit('wti'); const sec = document.querySelector('#editSheet .ind-corr'); const sel = document.querySelector('#corrPick');
        sel.value = 'brent'; sel.dispatchEvent(new Event('change'));
        const r = { sec: !!sec, chips: sec.querySelectorAll('[data-edit]').length, win: document.querySelectorAll('#corrOut .corr-win div').length, svg: !!document.querySelector('#corrOut svg'), saved: (DataStore.getSettings().corrPick || {}).wti };
        return r;
      });
      if (process.env.SHOT_DIR) { await page.evaluate(() => document.querySelector('#editSheet .ind-corr').scrollIntoView()); await page.screenshot({ path: `${process.env.SHOT_DIR}/corr-${ui}-${scheme}.png` }); }
      await page.evaluate(() => document.querySelector('#editSheet').close());
      check(co.sec && co.win === 3 && co.svg && co.saved === 'brent', `상관관계: 순위·직접 비교·차트·선택 기억 ${JSON.stringify(co)}`);
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
    check(!errs.length, `${tag}: 스크립트 오류 없음${errs.length ? ' — ' + errs.slice(0, 3).join(' / ') : ''}`);
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log(fails.length ? `\n실패 ${fails.length}개` : '\n화면 스모크 테스트 통과');
  process.exit(fails.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
