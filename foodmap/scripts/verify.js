#!/usr/bin/env node
'use strict';

/**
 * 3단계 (1회성): 행안부 모수의 신뢰성 교차검증
 *
 * 구글 Places(New) Nearby Search 로 4개 구역을 격자 스캔해 "독립 인구조사"를 만든 뒤,
 * 행안부 모수와 대조해 아래 4개 집합을 산출한다.
 *
 *   BOTH        : 양쪽 모두 존재            -> 행안부 정상
 *   LOCALDATA_ONLY : 행안부에만 존재         -> 대개 정상 (구글 한국 커버리지 부족)
 *   GOOGLE_ONLY : 구글에만 존재             -> ★ 행안부 누락 후보. 신뢰성의 핵심 지표
 *   RECALL      : BOTH / (BOTH + GOOGLE_ONLY)
 *
 * 구글 약관: 응답 중 무기한 저장이 허용되는 필드는 place_id 뿐이다.
 * 이 스크립트는 검증 리포트 산출이 목적이며, 결과 파일에는 place_id 와 집계만 남긴다.
 * 상호명은 대조 확인용으로만 리포트에 기록되며 최종 반입 파일로는 넘어가지 않는다.
 *
 * 입력: out/02_enriched.json (없으면 out/01_base.json)
 * 출력: out/03_verification.json, out/03_verification_report.md
 */

const fs = require('fs');
const path = require('path');
const { req, sleep } = require('./lib/http');
const geo = require('./lib/geo');
const match = require('./lib/match');

const ROOT = path.join(__dirname, '..');
const KEY = process.env.GOOGLE_MAPS_API_KEY;
const zonesCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/zones.json'), 'utf8'));

const GRID_SPACING_M = 180;   // 격자 간격
const CELL_RADIUS_M = 130;    // 셀 반경 (간격보다 커야 사각지대가 안 생김)
const TYPES = [
  ['restaurant'],
  ['cafe', 'bakery', 'coffee_shop'],
  ['bar', 'pub', 'wine_bar'],
];

/** zone 원을 덮는 격자점 생성 */
function gridPoints(zone) {
  const pts = [];
  const dLat = GRID_SPACING_M / 111320;
  const dLng = GRID_SPACING_M / (111320 * Math.cos((zone.center.lat * Math.PI) / 180));
  const steps = Math.ceil(zone.radius_m / GRID_SPACING_M);
  for (let i = -steps; i <= steps; i++) {
    for (let j = -steps; j <= steps; j++) {
      const pt = { lat: zone.center.lat + i * dLat, lng: zone.center.lng + j * dLng };
      if (geo.haversine(zone.center, pt) <= zone.radius_m + CELL_RADIUS_M) pts.push(pt);
    }
  }
  return pts;
}

async function nearby(center, includedTypes) {
  const body = {
    includedTypes,
    maxResultCount: 20,
    locationRestriction: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: CELL_RADIUS_M } },
    languageCode: 'ko',
    regionCode: 'KR',
  };
  const j = await req('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      // 필드마스크를 최소로 유지 = 과금 SKU 를 낮게 유지
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.primaryType,places.businessStatus',
    },
    body: JSON.stringify(body),
  });
  return (j.places || []).map((p) => ({
    id: p.id,
    name: (p.displayName && p.displayName.text) || '',
    coord: { lat: p.location.latitude, lng: p.location.longitude },
    type: p.primaryType || null,
    status: p.businessStatus || null,
  }));
}

(async () => {
  if (!KEY) {
    console.error(`[!] GOOGLE_MAPS_API_KEY 환경변수가 필요합니다.
    Google Cloud Console → Places API (New) 활성화 후 API 키 발급.`);
    process.exit(1);
  }

  const srcFile = fs.existsSync(path.join(ROOT, 'out/02_enriched.json'))
    ? 'out/02_enriched.json' : 'out/01_base.json';
  const places = JSON.parse(fs.readFileSync(path.join(ROOT, srcFile), 'utf8'));

  const allPts = zonesCfg.zones.flatMap((z) => gridPoints(z).map((pt) => ({ zone: z, pt })));
  const callCount = allPts.length * TYPES.length;

  if (!process.argv.includes('--confirm')) {
    console.log(`
=== 3단계: 교차검증 (드라이런) ===
  대상 구역      : ${zonesCfg.zones.map((z) => z.name).join(', ')}
  격자점         : ${allPts.length} 개 (간격 ${GRID_SPACING_M}m / 반경 ${CELL_RADIUS_M}m)
  타입 패스      : ${TYPES.length} 회
  예상 API 호출  : ${callCount} 회  (Nearby Search, 최소 필드마스크)

  * 구글 Places 는 무료 한도를 넘기면 과금됩니다. 실행 전 콘솔에서 현재 단가와 무료 한도를 확인하세요.
  * 실제로 돌리려면: npm run verify -- --confirm
`);
    process.exit(0);
  }

  const census = new Map();
  let done = 0;

  for (const { zone, pt } of allPts) {
    for (const types of TYPES) {
      try {
        for (const g of await nearby(pt, types)) {
          if (g.status && g.status !== 'OPERATIONAL') continue;
          if (!census.has(g.id)) census.set(g.id, { ...g, zone: zone.name });
        }
      } catch (e) {
        console.warn(`  [경고] ${zone.name} 격자 실패: ${e.message}`);
      }
      done++;
      if (done % 25 === 0) console.log(`  ...${done}/${callCount}`);
      await sleep(80);
    }
  }

  console.log(`\n  구글 인구조사: ${census.size} 건 수집`);

  // ---- 대조 ----
  const googleList = [...census.values()];
  const usedGoogle = new Set();
  const both = [];
  const localOnly = [];

  for (const p of places) {
    const cands = googleList.filter((g) => !usedGoogle.has(g.id));
    const best = match.bestMatch(p, cands, { maxDistanceM: 100, minScore: 0.5 });
    if (best) {
      usedGoogle.add(best.candidate.id);
      p.verification.in_google = true;
      p.source.google_place_id = best.candidate.id;
      p.links.google = `https://www.google.com/maps/place/?q=place_id:${best.candidate.id}`;
      both.push({ id: p.id, localdata_name: p.name, google_name: best.candidate.name, score: best.score, distance_m: best.distance_m });
    } else {
      p.verification.in_google = false;
      localOnly.push({ id: p.id, name: p.name, zone: p.zone, category: p.primary_category });
    }
  }

  const googleOnly = googleList
    .filter((g) => !usedGoogle.has(g.id))
    .map((g) => ({ google_place_id: g.id, name: g.name, zone: g.zone, type: g.type, coord: g.coord }));

  const recall = both.length + googleOnly.length > 0
    ? both.length / (both.length + googleOnly.length) : 1;

  const result = {
    run_date: new Date().toISOString().slice(0, 10),
    source_file: srcFile,
    zones: zonesCfg.zones.map((z) => z.name),
    counts: {
      localdata_total: places.length,
      google_census_total: census.size,
      both: both.length,
      localdata_only: localOnly.length,
      google_only: googleOnly.length,
    },
    localdata_recall: Math.round(recall * 1000) / 1000,
    both_sample: both.slice(0, 30),
    localdata_only: localOnly,
    google_only: googleOnly,
    caveats: [
      '구글의 한국 로컬 커버리지는 네이버/카카오보다 얕아 LOCALDATA_ONLY 가 크게 나오는 것은 정상입니다.',
      'GOOGLE_ONLY 중에는 신규 개업(인허가 데이터 반영 지연), 건물 내 푸드코트, 구글의 중복/유령 등록이 섞여 있습니다.',
      '격자 스캔은 셀당 최대 20건 제한이 있어 밀집 구역에서 일부 누락될 수 있습니다.',
      '구글 약관상 place_id 외 응답 데이터의 영구 저장은 허용되지 않습니다. 이 리포트의 상호명은 1회 검증 확인용입니다.',
    ],
  };

  fs.writeFileSync(path.join(ROOT, 'out/03_verification.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(ROOT, srcFile.replace(/\d+_/, '03b_')), JSON.stringify(places, null, 2));

  const md = `# 행안부 데이터 신뢰성 교차검증 리포트

- 실행일: ${result.run_date}
- 대상 구역: ${result.zones.join(', ')}
- 기준 모수: 행안부 LOCALDATA (\`${srcFile}\`)
- 대조군: Google Places (New) 격자 스캔

## 결과

| 항목 | 건수 |
|---|---:|
| 행안부 모수 | ${result.counts.localdata_total} |
| 구글 인구조사 | ${result.counts.google_census_total} |
| 양쪽 모두 (BOTH) | ${result.counts.both} |
| 행안부에만 | ${result.counts.localdata_only} |
| **구글에만 (행안부 누락 후보)** | **${result.counts.google_only}** |

**행안부 recall = ${(recall * 100).toFixed(1)}%**  (BOTH / (BOTH + GOOGLE_ONLY))

## 해석

recall 이 90% 이상이면 행안부를 모수로 삼는 데 문제가 없습니다.
80% 아래로 떨어지면 \`google_only\` 목록을 직접 검토해 수동 추가하거나, 구역 반경/업태 필터를 재검토하세요.

## 주의사항

${result.caveats.map((c) => `- ${c}`).join('\n')}

## 구글에만 있는 업소 (상위 50)

| 상호 | 구역 | 타입 |
|---|---|---|
${googleOnly.slice(0, 50).map((g) => `| ${g.name} | ${g.zone} | ${g.type || '-'} |`).join('\n')}
`;
  fs.writeFileSync(path.join(ROOT, 'out/03_verification_report.md'), md);

  console.log('\n=== 교차검증 결과 ===');
  console.log(`  행안부 ${result.counts.localdata_total} / 구글 ${result.counts.google_census_total}`);
  console.log(`  BOTH ${both.length} / 행안부만 ${localOnly.length} / 구글만 ${googleOnly.length}`);
  console.log(`  ★ 행안부 recall = ${(recall * 100).toFixed(1)}%`);
  console.log('  -> out/03_verification.json, out/03_verification_report.md');
})().catch((e) => { console.error(e.message); process.exit(1); });
