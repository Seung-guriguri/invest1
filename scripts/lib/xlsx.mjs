/* =====================================================================
 * xlsx.mjs — 외부 패키지 없이 .xlsx 시트를 행 배열로 읽기 (World Bank 원자재 월간 가격표용)
 *   readSheet(buffer, nameRe) → [[셀, 셀, ...], ...]  (빈 셀은 null, 숫자는 Number, 글자는 String)
 *   xlsx = zip(우리가 쓰는 건 저장(0)·deflate(8) 두 방식) + XML
 * ===================================================================== */
import { inflateRawSync } from 'node:zlib';

/** zip 안의 파일들: 이름 → 내용(Buffer) */
export function unzip(buf) {
  // 끝에서 중앙 디렉터리 끝 레코드(0x06054b50) 찾기
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip 형식 아님');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 중앙 디렉터리 손상');
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    files.set(name, () => (method === 0 ? raw : method === 8 ? inflateRawSync(raw) : (() => { throw new Error(`zip 압축 방식 ${method} 미지원`); })()));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
const textOf = xml => decode([...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''));
/** "AB12" → 열 번호 27 (0부터) */
const colIndex = ref => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

/** 시트 이름이 nameRe 에 맞는 첫 시트를 행 배열로 */
export function readSheet(buf, nameRe) {
  const files = unzip(buf);
  const get = name => { const f = files.get(name); if (!f) throw new Error(`xlsx 안에 ${name} 없음`); return f().toString('utf8'); };
  const shared = files.has('xl/sharedStrings.xml') ? [...get('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1])) : [];
  const wb = get('xl/workbook.xml');
  const sheets = [...wb.matchAll(/<sheet\b[^>]*>/g)].map(m => ({ name: decode((/name="([^"]*)"/.exec(m[0]) || [])[1] || ''), rid: (/r:id="([^"]*)"/.exec(m[0]) || [])[1] }));
  const sheet = sheets.find(s => nameRe.test(s.name));
  if (!sheet) throw new Error(`시트 없음 (있는 시트: ${sheets.map(s => s.name).join(', ')})`);
  const rels = get('xl/_rels/workbook.xml.rels');
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => m[0]).find(r => r.includes(`Id="${sheet.rid}"`));
  const target = (/Target="([^"]*)"/.exec(rel || '') || [])[1];
  if (!target) throw new Error(`시트 위치 없음: ${sheet.name}`);
  const xml = get(target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, ''));
  const rows = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], inner = cm[2] || '';
      const ref = (/r="([A-Z]+\d+)"/.exec(attrs) || [])[1];
      const type = (/t="([^"]*)"/.exec(attrs) || [])[1];
      const v = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
      let val = null;
      if (type === 's') val = v != null ? shared[+v] : null;
      else if (type === 'inlineStr') val = textOf(inner);
      else if (type === 'str') val = v != null ? decode(v) : null;
      else if (v != null) { const num = Number(v); val = Number.isFinite(num) ? num : decode(v); }
      const ci = ref ? colIndex(ref) : row.length;
      row[ci] = val;
    }
    rows.push(Array.from(row, x => (x === undefined ? null : x)));
  }
  return rows;
}
