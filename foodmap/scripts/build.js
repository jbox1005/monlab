#!/usr/bin/env node
'use strict';

/**
 * 4단계: 최종 반입 파일 생성
 *
 * 출력:
 *   out/places.json          - 정본 (스키마 준수)
 *   out/places.csv           - 사내 프로그램 반입용 평탄화 CSV (UTF-8 BOM)
 *   out/taxonomy_index.json  - 카테고리 > 메뉴 > 가게 탐색 인덱스
 *   out/manifest.json        - 반입 메타 (건수/체크섬/생성일)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const tax = require('./lib/taxonomy');
const { toCsv } = require('./lib/flatten');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'out');

function latestInput() {
  for (const f of ['03b_enriched.json', '02_enriched.json', '01_base.json']) {
    if (fs.existsSync(path.join(OUT, f))) return f;
  }
  throw new Error('out/ 에 입력 파일이 없습니다. `npm run collect` 를 먼저 실행하세요.');
}

/** 카테고리 > 메뉴 > 가게 3단 탐색 인덱스 */
function buildIndex(places) {
  const index = { version: tax.taxonomy.version, l1: [] };

  for (const l1 of tax.taxonomy.tree) {
    const l2s = [];
    for (const l2 of l1.children) {
      const shops = places
        .filter((p) => (p.categories || []).includes(l2.code))
        .map((p) => ({
          id: p.id,
          name: p.name,
          zone: p.zone,
          badges: p.purpose_badges,
          walk_min_hq: p.distance.ibk_hq.walk_min,
          walk_min_ft: p.distance.ibk_finance_tower.walk_min,
        }))
        .sort((a, b) => a.walk_min_hq - b.walk_min_hq);

      // 이 카테고리에서 실제로 등장한 메뉴명 (메뉴 단계 탐색용)
      const menuCounts = new Map();
      for (const p of places) {
        if (!(p.categories || []).includes(l2.code)) continue;
        for (const m of p.menus || []) {
          if (m.category && m.category !== l2.code) continue;
          menuCounts.set(m.name, (menuCounts.get(m.name) || 0) + 1);
        }
      }
      const menus = [...menuCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count }));

      if (shops.length > 0) l2s.push({ code: l2.code, name: l2.name, shop_count: shops.length, menus, shops });
    }
    if (l2s.length > 0) index.l1.push({ code: l1.code, name: l1.name, shop_count: l2s.reduce((s, x) => s + x.shop_count, 0), l2: l2s });
  }
  return index;
}

function main() {
  const input = latestInput();
  const places = JSON.parse(fs.readFileSync(path.join(OUT, input), 'utf8'));

  // 뱃지/분위기태그 최종 정규화
  for (const p of places) {
    p.vibe.tags = tax.sanitizeVibeTags(p.vibe.tags);
    if (!p.purpose_badges || p.purpose_badges.length === 0) p.purpose_badges = tax.assignBadges(p);
    for (const m of p.menus || []) {
      if (!m.category) m.category = tax.classifyMenu(m.name);
    }
  }

  const json = JSON.stringify(places, null, 2);
  const csv = toCsv(places);
  const index = buildIndex(places);

  fs.writeFileSync(path.join(OUT, 'places.json'), json);
  fs.writeFileSync(path.join(OUT, 'places.csv'), csv);
  fs.writeFileSync(path.join(OUT, 'taxonomy_index.json'), JSON.stringify(index, null, 2));

  const badge = { LUNCH: 0, CAFE: 0, DINNER: 0, NONE: 0 };
  const zone = {};
  for (const p of places) {
    zone[p.zone] = (zone[p.zone] || 0) + 1;
    if (!p.purpose_badges.length) badge.NONE++;
    for (const b of p.purpose_badges) badge[b]++;
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    source_file: input,
    schema: 'schema/place.schema.json',
    counts: { total: places.length, by_zone: zone, by_badge: badge },
    anchors: ['ibk_hq', 'ibk_finance_tower'],
    files: {
      'places.json': { sha256: crypto.createHash('sha256').update(json).digest('hex'), bytes: Buffer.byteLength(json) },
      'places.csv': { sha256: crypto.createHash('sha256').update(csv).digest('hex'), bytes: Buffer.byteLength(csv) },
    },
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log('=== 4단계: 반입 파일 생성 ===');
  console.log(`  입력: ${input}`);
  console.log(`  총 ${places.length} 건`, JSON.stringify(zone));
  console.log(`  뱃지: 점심 ${badge.LUNCH} / 카페 ${badge.CAFE} / 회식 ${badge.DINNER} / 미부여 ${badge.NONE}`);
  console.log('  -> out/places.json, out/places.csv, out/taxonomy_index.json, out/manifest.json');
}

main();
