'use strict';

const fs = require('fs');
const iconv = require('iconv-lite');

/** LOCALDATA CSV 는 대개 CP949. BOM/UTF-8 도 섞여 들어오므로 자동 판별한다. */
function readTextAuto(file) {
  const buf = fs.readFileSync(file);
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.slice(3).toString('utf8');

  const asUtf8 = buf.toString('utf8');
  // U+FFFD 가 많으면 UTF-8 이 아니다
  const bad = (asUtf8.match(/�/g) || []).length;
  if (bad > asUtf8.length * 0.0005) return iconv.decode(buf, 'cp949');
  return asUtf8;
}

/** 따옴표/줄바꿈 포함 필드를 처리하는 최소 CSV 파서 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** 헤더행 기준 객체 배열로 변환 */
function toRecords(file) {
  const rows = parseCsv(readTextAuto(file));
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.length >= header.length - 2 && r.some((v) => v && v.trim()))
    .map((r) => {
      const o = {};
      header.forEach((h, i) => { o[h] = (r[i] || '').trim(); });
      return o;
    });
}

module.exports = { readTextAuto, parseCsv, toRecords };
