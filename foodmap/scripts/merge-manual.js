#!/usr/bin/env node
'use strict';

/**
 * 수동 수집 배치 - 병합
 *
 *   npm run merge -- <batch_id>              # data/manual/filled-<batch>.json 을 병합
 *   npm run merge -- <batch_id> --dry        # 병합 없이 검증만
 *
 * 안전장치
 *   - 값을 채웠는데 sources 가 비어 있으면 그 item 전체를 거부한다 (출처 없는 값 = 추측)
 *   - 화이트리스트에 없는 vibe tag, enum 밖의 코드값은 거부
 *   - 기존 human_verified=true 인 필드는 덮어쓰지 않는다 (사람 확인이 우선)
 *   - 병합 후 스키마 재검증까지 통과해야 저장
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const tax = require('./lib/taxonomy');

const ROOT = path.join(__dirname, '..');
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/rules.json'), 'utf8'));
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schema/place.schema.json'), 'utf8'));

const argv = process.argv.slice(2);
const batchId = argv.find((a) => !a.startsWith('--'));
const DRY = argv.includes('--dry');

if (!batchId) {
  console.error('사용법: npm run merge -- <batch_id> [--dry]');
  process.exit(1);
}

const TRI = ['YES', 'NO', 'COND', 'UNKNOWN'];
const WAIT = ['NONE', 'LOW', 'HIGH', 'EXTREME', 'UNKNOWN'];
const MOOD = ['캐주얼', '정갈', '시끌벅적', '모던', '노포', '접대용'];
const APPS = ['테이블링', '캐치테이블', '나우웨이팅', '현장only'];
const LEVEL = ['₩', '₩₩', '₩₩₩', '₩₩₩₩'];

const ENUMS = {
  'facility.reservation': TRI,
  'facility.private_room': TRI,
  'facility.tabling': ['YES', 'NO', 'UNKNOWN'],
  'facility.corkage': TRI,
  'vibe.mood': MOOD,
  'waiting.level': WAIT,
  'price_range.level': LEVEL,
};

const isEmpty = (v) => v === null || v === undefined || v === 'UNKNOWN' || (Array.isArray(v) && v.length === 0);

function setPath(obj, p, v) {
  const ks = p.split('.');
  const last = ks.pop();
  const t = ks.reduce((o, k) => (o[k] = o[k] || {}), obj);
  t[last] = v;
}
function getPath(obj, p) {
  return p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function validateFill(item) {
  const errs = [];
  const filled = [];

  for (const [key, val] of Object.entries(item.fill || {})) {
    if (isEmpty(val)) continue;

    if (ENUMS[key] && !ENUMS[key].includes(val)) {
      errs.push(`${key}: "${val}" 는 허용값이 아님 -> ${ENUMS[key].join('/')}`);
      continue;
    }
    if (key === 'facility.waiting_apps') {
      if (!Array.isArray(val)) { errs.push(`${key}: 배열이어야 함`); continue; }
      const bad = val.filter((a) => !APPS.includes(a));
      if (bad.length) { errs.push(`${key}: 알 수 없는 앱 ${bad.join(',')}`); continue; }
    }
    if (key === 'vibe.tags') {
      if (!Array.isArray(val)) { errs.push(`${key}: 배열이어야 함`); continue; }
      const clean = tax.sanitizeVibeTags(val);
      const bad = val.filter((t) => !clean.includes(t));
      if (bad.length) errs.push(`${key}: 화이트리스트 밖 태그 제거됨 (${bad.join(',')})`);
      item.fill[key] = clean;
      if (clean.length === 0) continue;
    }
    if (key === 'menus') {
      if (!Array.isArray(val)) { errs.push('menus: 배열이어야 함'); continue; }
      for (const m of val) {
        if (!m || typeof m.name !== 'string' || !m.name) { errs.push('menus: name 없는 항목'); break; }
        if (m.price != null && (!Number.isInteger(m.price) || m.price < 0)) { errs.push(`menus[${m.name}]: price 는 0 이상 정수`); break; }
      }
    }
    if (/(corkage_fee|room_capacity_max|group_capacity_max|per_person)$/.test(key)) {
      if (!Number.isInteger(val) || val < 0) { errs.push(`${key}: 0 이상 정수여야 함 (받은 값: ${JSON.stringify(val)})`); continue; }
    }
    filled.push(key);
  }

  // 출처 없는 값은 추측이다
  if (rules.manual_batch.require_source_when_filled && filled.length > 0) {
    const srcs = (item.sources || []).filter((s) => s && typeof s.url === 'string' && /^https?:\/\//.test(s.url));
    if (srcs.length === 0) errs.push('값을 채웠으나 sources 가 비어 있음 — 출처 없는 값은 병합하지 않음');
  }
  if (filled.length > 0 && !['HIGH', 'MEDIUM', 'LOW'].includes(item.confidence)) {
    errs.push(`confidence 누락 또는 잘못됨 (받은 값: ${JSON.stringify(item.confidence)})`);
  }

  return { errs, filled };
}

function main() {
  const filledPath = path.join(ROOT, `data/manual/filled-${batchId}.json`);
  if (!fs.existsSync(filledPath)) {
    console.error(`[!] 파일 없음: data/manual/filled-${batchId}.json`);
    process.exit(1);
  }
  const batch = JSON.parse(fs.readFileSync(filledPath, 'utf8'));

  const targetFile = batch.source_file && fs.existsSync(path.join(ROOT, batch.source_file))
    ? batch.source_file : 'out/places.json';
  const places = JSON.parse(fs.readFileSync(path.join(ROOT, targetFile), 'utf8'));
  const byId = new Map(places.map((p) => [p.id, p]));

  const today = new Date().toISOString().slice(0, 10);
  const report = { merged: 0, rejected: 0, skipped: 0, fieldsWritten: 0, problems: [] };

  for (const item of batch.items || []) {
    const p = byId.get(item.id);
    if (!p) { report.problems.push(`${item.id}: 대상 파일에 없음`); report.rejected++; continue; }

    const { errs, filled } = validateFill(item);
    // 검증 오류가 먼저다. 잘못된 값 때문에 filled 가 비어도 '미채움'이 아니라 '거부'로 보고해야
    // 무엇이 왜 빠졌는지 드러난다.
    if (errs.length) {
      report.rejected++;
      report.problems.push(`${item.id} ${p.name}\n      - ${errs.join('\n      - ')}`);
      continue;
    }
    if (filled.length === 0) { report.skipped++; continue; }

    const prev = p.manual_meta || {};
    const lockedFields = prev.human_verified ? (prev.fields_filled || []) : [];
    const written = [];

    for (const key of filled) {
      if (lockedFields.includes(key)) continue;   // 사람이 확인한 값은 덮지 않는다
      const val = item.fill[key];
      if (key === 'menus') {
        p.menus = val.map((m) => ({
          name: m.name,
          price: m.price ?? null,
          price_note: m.price_note ?? null,
          is_signature: !!m.is_signature,
          category: m.category ?? tax.classifyMenu(m.name),
        }));
      } else {
        setPath(p, key, val);
      }
      written.push(key);
    }

    if (written.length === 0) { report.skipped++; continue; }

    p.manual_meta = {
      filled_at: today,
      filled_by: batch.filled_by || 'claude',
      batch_id: batch.batch_id || batchId,
      confidence: item.confidence,
      sources: (item.sources || []).map((s) => ({ url: s.url, title: s.title ?? null, as_of: s.as_of ?? null })),
      fields_filled: [...new Set([...(prev.fields_filled || []), ...written])],
      field_sources: { ...(prev.field_sources || {}), ...(item.field_sources || {}) },
      human_verified: prev.human_verified || false,
      next_review: nextReview(written, today),
    };
    if (item.note) p.note = item.note;

    // 값이 바뀌었으니 주류판매·뱃지·카테고리를 다시 계산
    if (p.facility.serves_alcohol == null) p.facility.serves_alcohol = tax.inferAlcohol(p);
    if (p.menus && p.menus.length) {
      const cls = tax.classify({ name: p.name, uptae: p.biz.license_category, menus: p.menus });
      if (cls.primary_category) {
        p.categories = cls.categories;
        p.categories_l1 = cls.categories_l1;
        p.primary_category = cls.primary_category;
      }
    }
    p.purpose_badges = tax.assignBadges(p);
    if (p.data_status === 'DRAFT') p.data_status = 'VERIFIED';

    report.merged++;
    report.fieldsWritten += written.length;
  }

  // 스키마 재검증 — 통과 못 하면 저장하지 않는다
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const invalid = places.filter((p) => !validate(p));

  console.log(`=== 수동 배치 병합: ${batchId} ===`);
  console.log(`  대상 파일 : ${targetFile}`);
  console.log(`  병합 ${report.merged} / 거부 ${report.rejected} / 미채움 ${report.skipped}`);
  console.log(`  기록된 필드 ${report.fieldsWritten}개`);

  if (report.problems.length) {
    console.log('\n  [거부 사유]');
    for (const s of report.problems) console.log(`    - ${s}`);
  }

  if (invalid.length) {
    console.error(`\n[!] 병합 결과가 스키마 검증에 실패했습니다 (${invalid.length}건). 저장하지 않습니다.`);
    validate(invalid[0]);
    console.error(`    예: ${invalid[0].id} ->`, validate.errors.slice(0, 3).map((e) => `${e.instancePath} ${e.message}`).join(' / '));
    process.exit(1);
  }

  if (DRY) { console.log('\n  (--dry: 저장하지 않음)'); return; }

  fs.writeFileSync(path.join(ROOT, targetFile), JSON.stringify(places, null, 2));
  console.log(`\n  -> ${targetFile} 갱신`);
  console.log('  다음: npm run build (CSV·인덱스 재생성)');
}

/** 잘 바뀌는 필드가 포함되면 짧게, 아니면 길게 */
function nextReview(fields, today) {
  const v = rules.manual_batch;
  const months = fields.some((f) => v.volatile_fields.includes(f) || f === 'menus') ? v.stale_months_volatile : v.stale_months;
  const d = new Date(today);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

main();
