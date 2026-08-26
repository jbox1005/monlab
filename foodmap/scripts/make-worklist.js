#!/usr/bin/env node
'use strict';

/**
 * 수동 수집 배치 - 작업지시서 생성
 *
 * MANUAL 등급 필드가 비어 있거나 오래된(stale) 업소를 골라 배치 파일을 만든다.
 * 이 파일을 Claude 에게 주면 docs/MANUAL_COLLECTION.md 프로토콜에 따라 fill 을 채워 돌려준다.
 *
 *   npm run worklist                  # 미채움 우선, 기본 25건
 *   npm run worklist -- --size 40
 *   npm run worklist -- --stale       # 이미 채웠지만 기한 지난 건 재수집
 *   npm run worklist -- --zone 을지로
 *   npm run worklist -- --badge DINNER
 *
 * 출력: data/manual/worklist-<batch>.json  (Claude 에게 줄 파일)
 *       out/worklist-<batch>.md            (사람이 눈으로 볼 요약)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/rules.json'), 'utf8'));
const CFG = rules.manual_batch;

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const flag = (k) => argv.includes(`--${k}`);

const SIZE = Number(opt('size', CFG.batch_size));
const ZONE = opt('zone', null);
const BADGE = opt('badge', null);
const STALE_MODE = flag('stale');
const INPUT = opt('input', null);

function resolveInput() {
  if (INPUT) return INPUT;
  for (const f of ['out/places.json', 'out/03b_enriched.json', 'out/02_enriched.json', 'out/01_base.json']) {
    if (fs.existsSync(path.join(ROOT, f))) return f;
  }
  throw new Error('입력 파일이 없습니다. `npm run collect` 또는 `npm run build` 를 먼저 실행하세요.');
}

const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);

/** 이 업소에서 아직 안 채워진 MANUAL 필드 목록 */
function missingFields(p) {
  const out = [];
  for (const f of rules.field_tiers.MANUAL) {
    if (f === 'menus[].price') {
      if ((p.menus || []).length === 0 || p.menus.some((m) => m.price == null)) out.push(f);
      continue;
    }
    if (f === 'menus[].is_signature') {
      if (!(p.menus || []).some((m) => m.is_signature)) out.push(f);
      continue;
    }
    const v = get(p, f);
    if (v === null || v === undefined || v === 'UNKNOWN' || (Array.isArray(v) && v.length === 0)) out.push(f);
  }
  return out;
}

/** 재수집 기한이 지났는지 */
function staleInfo(p, today) {
  const mm = p.manual_meta;
  if (!mm || !mm.filled_at) return { stale: false, reason: null };
  if (mm.next_review && mm.next_review <= today) return { stale: true, reason: `재검토 기한(${mm.next_review}) 경과` };

  const months = (a, b) => (new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24 * 30.44);
  const age = months(mm.filled_at, today);
  const hasVolatile = (mm.fields_filled || []).some((f) => CFG.volatile_fields.includes(f));
  const limit = hasVolatile ? CFG.stale_months_volatile : CFG.stale_months;
  if (age >= limit) return { stale: true, reason: `${Math.floor(age)}개월 경과 (기준 ${limit}개월)` };
  return { stale: false, reason: null };
}

function main() {
  const inputFile = resolveInput();
  const places = JSON.parse(fs.readFileSync(path.join(ROOT, inputFile), 'utf8'));
  const today = new Date().toISOString().slice(0, 10);

  let pool = places.filter((p) => p.data_status !== 'SAMPLE' || flag('include-sample'));
  if (ZONE) pool = pool.filter((p) => p.zone === ZONE);
  if (BADGE) pool = pool.filter((p) => (p.purpose_badges || []).includes(BADGE));

  const scored = pool.map((p) => {
    const missing = missingFields(p);
    const st = staleInfo(p, today);
    return { p, missing, stale: st.stale, stale_reason: st.reason };
  });

  let targets = STALE_MODE
    ? scored.filter((x) => x.stale)
    : scored.filter((x) => x.missing.length > 0);

  if (targets.length === 0) {
    console.log(STALE_MODE ? '재수집 대상이 없습니다.' : '모든 업소의 MANUAL 필드가 채워져 있습니다.');
    return;
  }

  // 우선순위: 뱃지 보유 > 기준점에 가까움 > 미채움 필드 많음
  targets.sort((a, b) => {
    const badge = (b.p.purpose_badges || []).length - (a.p.purpose_badges || []).length;
    if (badge !== 0) return badge;
    const walk = a.p.distance.ibk_hq.walk_min - b.p.distance.ibk_hq.walk_min;
    if (walk !== 0) return walk;
    return b.missing.length - a.missing.length;
  });

  const batchSeq = String(
    fs.existsSync(path.join(ROOT, 'data/manual'))
      ? fs.readdirSync(path.join(ROOT, 'data/manual')).filter((f) => f.startsWith(`worklist-${today}`)).length + 1
      : 1
  ).padStart(2, '0');
  const batchId = `${today}-${batchSeq}`;

  const picked = targets.slice(0, SIZE);

  const worklist = {
    batch_id: batchId,
    created_at: today,
    protocol: 'docs/MANUAL_COLLECTION.md',
    mode: STALE_MODE ? 'refresh' : 'initial',
    source_file: inputFile,
    total_candidates: targets.length,
    batch_size: picked.length,
    instructions: [
      '각 item 의 fill 객체만 채워서 같은 구조로 돌려주세요. 다른 필드는 건드리지 마세요.',
      '확인되지 않은 값은 추측하지 말고 UNKNOWN(또는 null)으로 두세요. 빈 값이 틀린 값보다 낫습니다.',
      '값을 하나라도 채웠다면 sources 에 최소 1개의 URL 을 넣어야 합니다. 없으면 병합 단계에서 거부됩니다.',
      '가격·웨이팅·콜키지금액은 잘 바뀌므로 field_sources 에 필드별 출처를 따로 기록하세요.',
      'confidence 는 HIGH(공식채널 직접확인) / MEDIUM(최근 리뷰 다수 일치) / LOW(단일·오래된 출처) 중 선택.',
    ],
    items: picked.map(({ p, missing, stale_reason }) => ({
      id: p.id,
      name: p.name,
      zone: p.zone,
      address_road: p.address.road,
      phone: p.phone,
      primary_category: p.primary_category,
      categories: p.categories,
      license_category: p.biz.license_category,
      badges_current: p.purpose_badges,
      walk_min: { ibk_hq: p.distance.ibk_hq.walk_min, ibk_finance_tower: p.distance.ibk_finance_tower.walk_min },
      links: p.links,
      known: {
        menus: (p.menus || []).map((m) => ({ name: m.name, price: m.price })),
        hours: p.hours,
        serves_alcohol: p.facility.serves_alcohol,
      },
      previous_manual: p.manual_meta || null,
      stale_reason: stale_reason || null,
      needs: missing,
      fill: {
        'facility.reservation': null,
        'facility.reservation_note': null,
        'facility.private_room': null,
        'facility.room_capacity_max': null,
        'facility.tabling': null,
        'facility.waiting_apps': null,
        'facility.corkage': null,
        'facility.corkage_fee': null,
        'facility.corkage_note': null,
        'facility.group_capacity_max': null,
        'menus': null,
        'price_range.lunch_per_person': null,
        'price_range.dinner_per_person': null,
        'price_range.level': null,
        'vibe.mood': null,
        'vibe.tags': null,
        'waiting.level': null,
        'waiting.peak_time': null,
      },
      sources: [],
      field_sources: {},
      confidence: null,
      note: null,
    })),
  };

  fs.mkdirSync(path.join(ROOT, 'data/manual'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true });
  const wlPath = `data/manual/worklist-${batchId}.json`;
  fs.writeFileSync(path.join(ROOT, wlPath), JSON.stringify(worklist, null, 2) + '\n');

  const md = `# 수동 수집 배치 ${batchId}

- 모드: ${worklist.mode === 'refresh' ? '재수집(stale)' : '최초 수집'}
- 대상 후보 ${targets.length}건 중 ${picked.length}건
- 프로토콜: \`docs/MANUAL_COLLECTION.md\`

| ID | 상호 | 구역 | 도보(본점) | 뱃지 | 미채움 | 비고 |
|---|---|---|---:|---|---:|---|
${picked.map(({ p, missing, stale_reason }) =>
  `| ${p.id} | ${p.name} | ${p.zone} | ${p.distance.ibk_hq.walk_min}분 | ${(p.purpose_badges || []).join(',') || '-'} | ${missing.length} | ${stale_reason || ''} |`
).join('\n')}

## 다음 단계

1. \`${wlPath}\` 를 Claude 에게 전달 (또는 \`/foodmap-enrich\` 실행)
2. 채워진 파일을 \`data/manual/filled-${batchId}.json\` 으로 저장
3. \`npm run merge -- ${batchId}\` 로 병합
`;
  fs.writeFileSync(path.join(ROOT, `out/worklist-${batchId}.md`), md);

  console.log(`=== 수동 수집 배치 생성: ${batchId} ===`);
  console.log(`  모드: ${worklist.mode}`);
  console.log(`  대상 후보 ${targets.length}건 -> 이번 배치 ${picked.length}건`);
  console.log(`  -> ${wlPath}`);
  console.log(`  -> out/worklist-${batchId}.md`);
  console.log(`\n  다음: 이 파일을 Claude 에게 주고, 채워진 결과를 data/manual/filled-${batchId}.json 으로 저장 후`);
  console.log(`        npm run merge -- ${batchId}`);
}

main();
