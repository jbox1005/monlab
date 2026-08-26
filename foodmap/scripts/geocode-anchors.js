#!/usr/bin/env node
'use strict';

/** IBK 두 기준점 주소를 카카오 지오코딩으로 확정 좌표로 교체한다. */

const fs = require('fs');
const path = require('path');
const { req } = require('./lib/http');

const ROOT = path.join(__dirname, '..');
const KEY = process.env.KAKAO_REST_KEY;

(async () => {
  if (!KEY) {
    console.error('[!] KAKAO_REST_KEY 환경변수가 필요합니다.\n    https://developers.kakao.com → 내 애플리케이션 → REST API 키');
    process.exit(1);
  }

  const p = path.join(ROOT, 'config/anchors.json');
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));

  for (const a of cfg.anchors) {
    const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(a.address_road)}`;
    const j = await req(url, { headers: { Authorization: `KakaoAK ${KEY}` } });
    const doc = j.documents && j.documents[0];
    if (!doc) {
      console.warn(`  [경고] 지오코딩 실패: ${a.name} (${a.address_road}) — 기존 근사좌표 유지`);
      continue;
    }
    const lat = Number(doc.y);
    const lng = Number(doc.x);
    const moved = Math.abs(lat - a.coord.lat) > 1e-5 || Math.abs(lng - a.coord.lng) > 1e-5;
    a.coord = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
    a.coord_verified = true;
    console.log(`  ${a.name.padEnd(18)} ${a.coord.lat}, ${a.coord.lng} ${moved ? '(갱신됨)' : '(동일)'}`);
  }

  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
  console.log('-> config/anchors.json 갱신 완료');
})().catch((e) => { console.error(e.message); process.exit(1); });
