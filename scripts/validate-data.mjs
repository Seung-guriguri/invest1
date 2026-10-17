#!/usr/bin/env node
/* =====================================================================
 * 수집 결과(data/latest.json) 구조 검증 — 배포 전에 실행
 *   node scripts/validate-data.mjs _site/data/latest.json
 *
 * 구조가 깨진 경우(배포하면 화면이 망가지는 경우)만 실패(exit 1) → 배포 중단, 기존 사이트 유지
 *   · JSON 형식 · series 객체 · 관측치 [YYYY-MM-DD, 유한한 숫자] · 날짜 오름차순·중복 없음 · freq 값
 * 값 자체가 이상한 경우(급변·오래됨)는 실패로 보지 않고 요약만 출력 (원본 값을 지우지 않음)
 * ===================================================================== */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FREQS = new Set(['D', 'W', 'M', 'Q']);
const DAY = 86400000;

/** 반환: { errors: [문장], notes: [문장], stats } */
export function validateData(data, now = Date.now()) {
  const errors = [], notes = [];
  if (!data || typeof data !== 'object') return { errors: ['JSON 최상위가 객체가 아님'], notes, stats: {} };
  if (!data.generatedAt || isNaN(Date.parse(data.generatedAt))) errors.push('generatedAt 없음/형식 오류');
  if (!data.series || typeof data.series !== 'object') return { errors: [...errors, 'series 없음'], notes, stats: {} };
  const ids = Object.keys(data.series);
  if (!ids.length) errors.push('series 가 비어 있음');
  let stale = 0, spikes = 0;
  for (const id of ids) {
    const s = data.series[id];
    if (!s || !Array.isArray(s.obs)) { errors.push(`${id}: obs 배열 없음`); continue; }
    if (!s.source) errors.push(`${id}: source 없음`);
    if (!FREQS.has(s.freq)) errors.push(`${id}: freq '${s.freq}' 알 수 없음`);
    if (s.obs.length < 2) errors.push(`${id}: 관측치 ${s.obs.length}개 (2개 이상 필요)`);
    let prev = '';
    for (const o of s.obs) {
      if (!Array.isArray(o) || o.length !== 2 || !DATE.test(o[0]) || typeof o[1] !== 'number' || !Number.isFinite(o[1])) {
        errors.push(`${id}: 잘못된 관측치 ${JSON.stringify(o).slice(0, 60)}`); break;
      }
      if (o[0] <= prev) { errors.push(`${id}: 날짜 순서·중복 오류 (${prev} → ${o[0]})`); break; }
      prev = o[0];
    }
    const n = s.obs.length;
    if (n >= 2) {
      const lim = { D: 10, W: 21, M: 140, Q: 260 }[s.freq] || 30;
      if ((now - Date.parse(s.obs[n - 1][0])) / DAY > lim) stale++;
      const a = s.obs[n - 2][1], b = s.obs[n - 1][1];
      if (s.freq === 'D' && a && Math.sign(a) === Math.sign(b) && Math.abs(b / a - 1) > 0.25) { spikes++; notes.push(`${id}: 직전 대비 ${((b / a - 1) * 100).toFixed(1)}% 급변 — 검증 필요 (값은 유지)`); }
    }
  }
  if (Array.isArray(data.errors) && data.errors.length) notes.push(`수집 실패 ${data.errors.length}개: ${data.errors.map(e => e.id).join(', ')}`);
  return { errors, notes, stats: { series: ids.length, stale, spikes, failed: (data.errors || []).length } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2] || 'data/latest.json';
  let data;
  try { data = JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { console.error(`✗ ${file} 읽기 실패: ${e.message}`); process.exit(1); }
  const { errors, notes, stats } = validateData(data);
  console.log(`데이터 검증: 지표 ${stats.series ?? 0}개 · 오래됨 ${stats.stale ?? 0} · 급변 ${stats.spikes ?? 0} · 수집 실패 ${stats.failed ?? 0}`);
  notes.forEach(n => console.log('  · ' + n));
  if (errors.length) { errors.slice(0, 30).forEach(e => console.error('  ✗ ' + e)); console.error(`구조 오류 ${errors.length}개 → 배포 중단`); process.exit(1); }
  console.log('구조 검증 통과');
}
