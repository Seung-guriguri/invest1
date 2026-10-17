/* =====================================================================
 * index.html 의 CONFIG(지표 정의)를 Node 에서 읽기 — 테스트·지표 카탈로그 생성용
 * 화면 코드와 같은 원본을 쓰므로 지표 정의가 두 곳으로 갈라지지 않음.
 * ===================================================================== */
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

/** 'const NAME = {' 로 시작하는 객체 리터럴 원문을 괄호 짝으로 잘라냄 (문자열·주석 안의 괄호는 건너뜀) */
export function sliceObject(src, name) {
  const start = src.indexOf(`const ${name} = {`);
  if (start < 0) throw new Error(`${name} 정의를 찾지 못함`);
  let i = src.indexOf('{', start), depth = 0, q = null;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '/' && n === '/') { i = src.indexOf('\n', i); continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) break;
  }
  return src.slice(src.indexOf('{', start), i + 1);
}

export async function loadConfig(htmlPath = new URL('../../index.html', import.meta.url)) {
  const html = await readFile(htmlPath, 'utf8');
  return vm.runInNewContext(`(${sliceObject(html, 'CONFIG')})`, {});
}
