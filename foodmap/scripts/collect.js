#!/usr/bin/env node
'use strict';

/**
 * 1단계: 행안부 LOCALDATA CSV -> 4개 구역 기본 모수
 *
 * 입력: data/raw/*.csv  (지방행정인허가데이터 - 일반음식점/휴게음식점/단란주점/유흥주점)
 *       https://www.localdata.go.kr 에서 서울특별시 종로구·중구 다운로드
 * 출력: out/01_base.json
 */

const fs = require('fs');
const path = require('path');
const { toRecords } = require('./lib/csv');
const geo = require('./lib/geo');
const tax = require('./lib/taxonomy');

const ROOT = path.join(__dirname, '..');
const zonesCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/zones.json'), 'utf8'));
const anchorsCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/anchors.json'), 'utf8'));

// LOCALDATA 표준 컬럼명. 배포본마다 표기가 조금씩 달라 후보를 순서대로 찾는다.
const COL = {
  mgtno:   ['관리번호', 'MGTNO'],
  name:    ['사업장명', 'BPLCNM'],
  state:   ['영업상태명', 'TRDSTATENM'],
  detail:  ['상세영업상태명', 'DTLSTATENM'],
  tel:     ['소재지전화', 'SITETEL'],
  jibun:   ['소재지전체주소', '지번주소', 'SITEWHLADDR'],
  road:    ['도로명전체주소', '도로명주소', 'RDNWHLADDR'],
  uptae:   ['업태구분명', 'UPTAENM'],
  x:       ['좌표정보(X)', '좌표정보(x)', 'X'],
  y:       ['좌표정보(Y)', '좌표정보(y)', 'Y'],
  permYmd: ['인허가일자', 'APVPERMYMD'],
  bizType: ['개방서비스명', 'OPNSFTEAMCODE', 'OPNSVCNM'],
};

function pick(rec, keys) {
  for (const k of keys) {
    if (rec[k] !== undefined && rec[k] !== '') return rec[k];
  }
  return '';
}

function licenseTypeOf(rec, fileHint) {
  const svc = pick(rec, COL.bizType) || fileHint || '';
  if (svc.includes('일반음식점')) return '일반음식점';
  if (svc.includes('휴게음식점')) return '휴게음식점';
  if (svc.includes('단란주점')) return '단란주점영업';
  if (svc.includes('유흥주점')) return '유흥주점영업';
  if (svc.includes('제과점')) return '제과점영업';
  return '기타';
}

function ymd(s) {
  const d = String(s || '').replace(/[^0-9]/g, '');
  if (d.length !== 8) return null;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

function main() {
  const rawDir = path.join(ROOT, 'data/raw');
  const files = fs.existsSync(rawDir) ? fs.readdirSync(rawDir).filter((f) => /\.csv$/i.test(f)) : [];

  if (files.length === 0) {
    console.error(`
[!] data/raw/ 에 CSV 가 없습니다.

  https://www.localdata.go.kr → 데이터받기 → 지역별 데이터
  서울특별시 종로구 / 중구 를 아래 업종으로 각각 받아 data/raw/ 에 넣으세요.
    - 일반음식점
    - 휴게음식점
    - 단란주점영업
    - 유흥주점영업
`);
    process.exit(1);
  }

  const f = zonesCfg.localdata_filter;
  const stats = { read: 0, closed: 0, outOfZone: 0, noCoord: 0, uptaeExcluded: 0, kept: 0 };
  const out = [];
  const seen = new Set();

  for (const file of files) {
    const recs = toRecords(path.join(rawDir, file));
    for (const rec of recs) {
      stats.read++;

      const state = pick(rec, COL.state);
      const detail = pick(rec, COL.detail);
      if (!f.status_include.some((s) => state.includes(s) || detail.includes('영업'))) {
        stats.closed++;
        continue;
      }

      const licenseType = licenseTypeOf(rec, file);
      if (!f.license_types_include.includes(licenseType)) continue;

      const uptae = pick(rec, COL.uptae);
      if (f.uptae_exclude.some((u) => uptae.includes(u))) { stats.uptaeExcluded++; continue; }

      const coord = geo.tm5174ToWgs84(pick(rec, COL.x), pick(rec, COL.y));
      if (!coord) { stats.noCoord++; continue; }

      const zone = geo.resolveZone(coord, zonesCfg.zones);
      if (!zone) { stats.outOfZone++; continue; }

      const mgtno = pick(rec, COL.mgtno);
      if (mgtno && seen.has(mgtno)) continue;
      if (mgtno) seen.add(mgtno);

      const nameLegal = pick(rec, COL.name);
      const cls = tax.classify({ name: nameLegal, uptae, menus: [] });

      const place = {
        id: null,
        data_status: 'DRAFT',
        source: { localdata_mgtno: mgtno || null, kakao_place_id: null, google_place_id: null, naver_place_url: null, collected_by: ['localdata'] },
        name: nameLegal,
        name_legal: nameLegal,
        branch: null,
        status: '영업',
        zone: zone.name,
        address: { road: pick(rec, COL.road) || null, jibun: pick(rec, COL.jibun) || null, detail: null },
        coord,
        phone: pick(rec, COL.tel) || null,
        biz: { license_type: licenseType, license_category: uptae || null, license_date: ymd(pick(rec, COL.permYmd)) },
        purpose_badges: [],
        categories: cls.categories,
        categories_l1: cls.categories_l1,
        primary_category: cls.primary_category,
        menus: [],
        price_range: { lunch_per_person: null, dinner_per_person: null, level: null },
        facility: { reservation: 'UNKNOWN', private_room: 'UNKNOWN', tabling: 'UNKNOWN', waiting_apps: [], corkage: 'UNKNOWN', corkage_fee: null, group_capacity_max: null, serves_alcohol: null, parking: 'UNKNOWN', takeout: null },
        vibe: { mood: null, tags: [], note: null },
        waiting: { level: 'UNKNOWN', peak_time: null, note: null },
        hours: { raw: null, lunch_open: null, open: null, close: null, break_time: null, last_order: null, holiday: null },
        distance: {},
        links: { kakao: null, naver: null, google: null },
        verification: { in_google: null, in_kakao: null, match_score: null, match_method: null, confidence: 'LOW' },
        updated_at: new Date().toISOString().slice(0, 10),
        note: null,
      };

      place.facility.serves_alcohol = tax.inferAlcohol(place);

      // 도보 거리 — 두 기준점 모두
      for (const a of anchorsCfg.anchors) {
        place.distance[a.key] = geo.walkFrom(a.coord, coord, anchorsCfg.walking);
      }

      out.push(place);
      stats.kept++;
    }
  }

  // 구역 -> 기준점 거리 순
  out.sort((a, b) => a.distance.ibk_hq.meters - b.distance.ibk_hq.meters);
  out.forEach((p, i) => { p.id = `FM-${String(i + 1).padStart(5, '0')}`; });

  fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'out/01_base.json'), JSON.stringify(out, null, 2));

  const byZone = {};
  for (const p of out) byZone[p.zone] = (byZone[p.zone] || 0) + 1;

  console.log('=== 1단계: 행안부 기본 모수 ===');
  console.log(`  읽음 ${stats.read} / 폐업·휴업 제외 ${stats.closed} / 업태 제외 ${stats.uptaeExcluded} / 좌표없음 ${stats.noCoord} / 구역밖 ${stats.outOfZone}`);
  console.log(`  최종 ${stats.kept} 건`, JSON.stringify(byZone));
  console.log('  -> out/01_base.json');
  if (!anchorsCfg.anchors.every((a) => a.coord_verified)) {
    console.log('\n  [주의] anchors.json 좌표가 미검증 상태입니다. `npm run geocode` 로 확정하세요.');
  }
}

main();
