#!/usr/bin/env node
'use strict';

/** 반입 전 스키마 검증. 사내 프로그램에 넣기 전 게이트로 쓴다. */

const fs = require('fs');
const path = require('path');
// 스키마가 draft 2020-12 이므로 기본 export(draft-07) 대신 2020 빌드를 쓴다
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const ROOT = path.join(__dirname, '..');
const target = process.argv[2] || 'out/places.json';

const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schema/place.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

const file = path.isAbsolute(target) ? target : path.join(ROOT, target);
if (!fs.existsSync(file)) {
  console.error(`[!] 파일 없음: ${target}`);
  process.exit(1);
}

const places = JSON.parse(fs.readFileSync(file, 'utf8'));
let bad = 0;

places.forEach((p, i) => {
  if (!validate(p)) {
    bad++;
    if (bad <= 10) {
      console.error(`\n[${i}] ${p.id || '(id없음)'} ${p.name || ''}`);
      for (const e of validate.errors.slice(0, 6)) {
        console.error(`    ${e.instancePath || '/'} ${e.message}${e.params && e.params.allowedValues ? ' -> ' + JSON.stringify(e.params.allowedValues) : ''}`);
      }
    }
  }
});

console.log(`\n검증 대상: ${target}`);
console.log(`  총 ${places.length} 건 / 통과 ${places.length - bad} / 실패 ${bad}`);
if (bad > 10) console.log(`  (실패 상세는 상위 10건만 출력)`);
process.exit(bad > 0 ? 1 : 0);
