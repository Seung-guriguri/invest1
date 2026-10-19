/* =====================================================================
 * probe-url.mjs — 웹페이지·파일·EIA API 경로가 받아지는지 시험 (수집·배포와 무관, 로그만)
 *   node scripts/probe-url.mjs --url <주소> [--url ...] [--eia coal]
 *   - 페이지: 상태·형식·크기·제목, 엑셀·CSV 링크와 '날짜·가격' 같은 단서
 *   - xlsx: 시트 이름과 첫 행들 / xls·csv: 앞부분
 *   - --eia 경로: EIA API v2 하위 경로 목록(경로 이름·설명·주기) — EIA_API_KEY 필요
 * ===================================================================== */
import { unzip, readSheet } from './lib/xlsx.mjs';
const UA = 'Mozilla/5.0 (macro-dashboard probe)';
const args = process.argv.slice(2);
const many = name => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
const KEY = (process.env.EIA_API_KEY || '').trim();

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(40000) });
  return { res, buf: Buffer.from(await res.arrayBuffer()) };
}
function abs(base, href) { try { return new URL(href, base).href; } catch { return href; } }

for (const url of many('--url')) {
  console.log(`\n[주소] ${url}`);
  try {
    const { res, buf } = await get(url);
    const type = res.headers.get('content-type') || '';
    console.log(`  상태 ${res.status} · ${type} · ${buf.length.toLocaleString()} 바이트 · 최종 주소 ${res.url}${res.headers.get('last-modified') ? ` · 수정 ${res.headers.get('last-modified')}` : ''}`);
    if (/html/.test(type)) {
      const html = buf.toString('utf8');
      console.log(`  제목: ${((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '').trim().slice(0, 120)}`);
      const links = [...new Set([...html.matchAll(/href="([^"]+\.(?:xlsx?|csv|zip)(?:\?[^"]*)?)"/gi)].map(m => abs(res.url, m[1])))];
      console.log(`  파일 링크 ${links.length}개`); links.slice(0, 40).forEach(l => console.log(`   - ${l}`));
      const dates = [...html.matchAll(/(?:week|weekly|ending|updated|release)[^<]{0,80}/gi)].map(m => m[0].replace(/\s+/g, ' ').trim()).slice(0, 12);
      if (dates.length) { console.log('  날짜·갱신 단서:'); dates.forEach(d => console.log(`   · ${d}`)); }
      const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const i = text.search(/Central Appalachia|Powder River|Illinois Basin/i);
      if (i >= 0) console.log(`  본문 발췌: …${text.slice(Math.max(0, i - 300), i + 500)}…`);
    } else if (buf[0] === 0x50 && buf[1] === 0x4b) {
      const files = unzip(buf);
      const wb = files.get('xl/workbook.xml');
      const names = wb ? [...wb().toString('utf8').matchAll(/<sheet\b[^>]*name="([^"]*)"/g)].map(m => m[1]) : [];
      console.log(`  xlsx 시트: ${names.join(' | ')}`);
      for (const n of names.slice(0, 4)) {
        const rows = readSheet(buf, new RegExp('^' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
        console.log(`  ── ${n}: ${rows.length}행`);
        rows.slice(0, 8).concat(rows.length > 8 ? [['…']] : [], rows.slice(-3)).forEach(r => console.log(`     ${r.slice(0, 10).map(c => (c == null ? '' : String(c).slice(0, 18))).join(' | ')}`));
      }
    } else if (buf[0] === 0xd0 && buf[1] === 0xcf) {
      console.log('  옛 엑셀(.xls, BIFF) 형식 — 읽으려면 별도 해석기 필요');
      const s = buf.toString('latin1').replace(/[^\x20-\x7e]+/g, ' ').replace(/\s+/g, ' ');
      console.log(`  들어 있는 글자 일부: ${s.slice(0, 800)}`);
    } else {
      console.log(`  앞부분: ${buf.toString('utf8', 0, 1200)}`);
    }
  } catch (e) { console.log(`  실패: ${e.message}`); }
}

for (const route of many('--eia')) {
  console.log(`\n[EIA API] ${route}`);
  if (!KEY) { console.log('  EIA_API_KEY 없음'); continue; }
  const walk = async (path, depth) => {
    try {
      const j = await (await fetch(`https://api.eia.gov/v2/${path}/?api_key=${KEY}`, { signal: AbortSignal.timeout(30000) })).json();
      const r = j.response || {};
      const pad = '  '.repeat(depth + 1);
      if (r.routes && r.routes.length) {
        for (const x of r.routes) { console.log(`${pad}- ${path}/${x.id} : ${x.name || ''}`); if (depth < 2) await walk(`${path}/${x.id}`, depth + 1); }
      } else {
        const freq = (r.frequency || []).map(f => f.id).join(',');
        const facets = (r.facets || []).map(f => f.id).join(',');
        const data = Object.keys(r.data || {}).join(',');
        console.log(`${pad}  (데이터) 주기: ${freq} · 항목: ${data} · 구분: ${facets} · 기간 ${r.startPeriod || '?'}~${r.endPeriod || '?'}`);
      }
    } catch (e) { console.log(`  실패 ${path}: ${e.message}`); }
  };
  await walk(route, 0);
}
