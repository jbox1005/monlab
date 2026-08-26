#!/usr/bin/env node
'use strict';

/**
 * 2단계: 카카오 로컬 API 로 실제 간판 상호 / 정확 좌표 / 카테고리 / 딥링크 보강
 *
 * 입력: out/01_base.json
 * 출력: out/02_enriched.json
 *
 * 행안부 상호(인허가 명의)를 카카오 상호(실제 간판)로 교체하는 것이 목적.
 * 카카오는 평점·리뷰를 제공하지 않으므로 그 필드는 여기서 채워지지 않는다.
 */

const fs = require('fs');
const path = require('path');
const { req, sleep } = require('./lib/http');
const match = require('./lib/match');
const tax = require('./lib/taxonomy');

const ROOT = path.join(__dirname, '..');
const KEY = process.env.KAKAO_REST_KEY;

async function kakaoNearby(coord, keyword) {
  const url =
    `https://dapi.kakao.com/v2/local/search/keyword.json` +
    `?query=${encodeURIComponent(keyword)}` +
    `&x=${coord.lng}&y=${coord.lat}&radius=200&size=15&sort=distance`;
  const j = await req(url, { headers: { Authorization: `KakaoAK ${KEY}` } });
  return (j.documents || []).map((d) => ({
    name: d.place_name,
    coord: { lat: Number(d.y), lng: Number(d.x) },
    phone: d.phone || null,
    road: d.road_address_name || null,
    jibun: d.address_name || null,
    category: d.category_name || null,
    group: d.category_group_code || null,
    id: d.id,
    url: d.place_url || null,
  }));
}

(async () => {
  if (!KEY) {
    console.error('[!] KAKAO_REST_KEY 환경변수가 필요합니다.');
    process.exit(1);
  }

  const places = JSON.parse(fs.readFileSync(path.join(ROOT, 'out/01_base.json'), 'utf8'));
  const stats = { total: places.length, matched: 0, renamed: 0, unmatched: 0 };

  for (let i = 0; i < places.length; i++) {
    const p = places[i];
    let cands = [];
    try {
      cands = await kakaoNearby(p.coord, match.coreName(p.name_legal) || p.name_legal);
      // 상호로 못 찾으면 좌표 주변 음식점 전체를 후보로
      if (cands.length === 0) cands = await kakaoNearby(p.coord, '음식점');
    } catch (e) {
      console.warn(`  [경고] ${p.name}: ${e.message}`);
    }

    const best = match.bestMatch(p, cands, { maxDistanceM: 80, minScore: 0.55 });

    if (best) {
      const c = best.candidate;
      if (match.normalizeName(c.name) !== match.normalizeName(p.name)) stats.renamed++;
      p.name = c.name;                       // 실제 간판 상호로 교체
      p.coord = c.coord;                     // 카카오 좌표가 더 정확
      p.phone = c.phone || p.phone;
      p.address.road = c.road || p.address.road;
      p.source.kakao_place_id = c.id;
      p.links.kakao = c.url;
      p.source.collected_by.push('kakao');
      p.verification.in_kakao = true;
      p.verification.match_score = best.score;
      p.verification.match_method = best.method;
      p.verification.confidence = best.score >= 0.85 ? 'HIGH' : 'MEDIUM';

      // 카카오 카테고리 문자열로 분류 재실행 ("음식점 > 한식 > 국수 > 칼국수")
      const catText = (c.category || '').split('>').map((s) => s.trim()).join(' ');
      const cls = tax.classify({ name: p.name, uptae: p.biz.license_category, menus: [catText] });
      if (cls.primary_category) {
        p.categories = cls.categories;
        p.categories_l1 = cls.categories_l1;
        p.primary_category = cls.primary_category;
      }
      p.facility.serves_alcohol = tax.inferAlcohol(p);
      p.purpose_badges = tax.assignBadges(p);
      stats.matched++;
    } else {
      p.verification.in_kakao = false;
      p.verification.confidence = 'LOW';
      p.note = '카카오 매칭 실패 — 폐업했거나 상호가 크게 다를 수 있음. 수동 확인 필요.';
      stats.unmatched++;
    }

    if ((i + 1) % 50 === 0) console.log(`  ...${i + 1}/${places.length}`);
    await sleep(120); // 카카오 레이트리밋 여유
  }

  fs.writeFileSync(path.join(ROOT, 'out/02_enriched.json'), JSON.stringify(places, null, 2));
  console.log('\n=== 2단계: 카카오 보강 ===');
  console.log(`  매칭 ${stats.matched}/${stats.total} (상호 교체 ${stats.renamed}건) / 미매칭 ${stats.unmatched}건`);
  console.log('  -> out/02_enriched.json');
})().catch((e) => { console.error(e.message); process.exit(1); });
