#!/usr/bin/env node
/* Gemini API 에서 지금 쓸 수 있는 모델 목록 확인 (읽기 전용, 생성 호출 없음 — 무료 한도 소모 없음)
 *   GEMINI_API_KEY=... node scripts/probe-gemini.mjs */
const KEY = (process.env.GEMINI_API_KEY || '').trim();
if (!KEY) { console.log('GEMINI_API_KEY 없음'); process.exit(0); }
const API = 'https://generativelanguage.googleapis.com/v1beta';
const all = [];
let page = '';
for (let i = 0; i < 5; i++) {
  const res = await fetch(`${API}/models?pageSize=200${page ? '&pageToken=' + encodeURIComponent(page) : ''}`, { headers: { 'x-goog-api-key': KEY }, signal: AbortSignal.timeout(20000) });
  const j = await res.json();
  if (!res.ok) { console.log(`HTTP ${res.status} ${(j.error && j.error.message) || ''}`); process.exit(0); }
  all.push(...(j.models || []));
  if (!j.nextPageToken) break;
  page = j.nextPageToken;
}
const gen = all.filter(m => (m.supportedGenerationMethods || []).includes('generateContent'));
console.log(`generateContent 가능 모델 ${gen.length}개 (전체 ${all.length}개)`);
for (const m of gen.sort((a, b) => (a.name < b.name ? -1 : 1))) {
  console.log(`- ${m.name.replace(/^models\//, '').padEnd(40)} ${String(m.displayName || '').padEnd(32)} 입력 ${m.inputTokenLimit ?? '?'} · 출력 ${m.outputTokenLimit ?? '?'}${m.thinking ? ' · thinking' : ''}`);
}
// 대시보드 자동 선택 규칙으로 고르면 무엇이 되는지
const names = gen.map(m => m.name.replace(/^models\//, ''));
const ver = n => Number((n.match(/^gemini-(\d+(?:\.\d+)?)-/) || [])[1] || 0);
const flash = names.filter(n => /^gemini-\d+(\.\d+)?-flash$/.test(n)).sort((x, y) => ver(y) - ver(x));
const lite = names.filter(n => /^gemini-\d+(\.\d+)?-flash-lite$/.test(n)).sort((x, y) => ver(y) - ver(x));
console.log(`\n현재 자동 선택 순서: ${[...new Set([...flash.slice(0, 1), 'gemini-flash-latest', ...lite.slice(0, 1), 'gemini-flash-lite-latest'])].join(' → ')}`);
const other = names.filter(n => /flash/i.test(n) && !/^gemini-\d+(\.\d+)?-flash(-lite)?$/.test(n) && !/latest$/.test(n));
if (other.length) console.log(`자동 선택 규칙에 안 걸리는 flash 계열 이름: ${other.join(', ')}`);
