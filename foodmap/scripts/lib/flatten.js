'use strict';

/**
 * 사내 프로그램 반입용 CSV 평탄화.
 * 배열/객체는 구분자로 직렬화한다. 중첩 구분자는 겹치지 않게 고른다.
 *   다중값       : |
 *   메뉴 name:price : ~
 */
const COLUMNS = [
  'id', 'data_status', 'name', 'name_legal', 'branch', 'status', 'zone',
  'address_road', 'address_jibun', 'address_detail', 'lat', 'lng', 'phone',
  'license_type', 'license_category', 'license_date',
  'purpose_badges', 'categories_l1', 'categories', 'primary_category',
  'menus', 'signature_menu', 'lunch_per_person', 'dinner_per_person', 'price_level',
  'reservation', 'reservation_note', 'private_room', 'room_capacity_max',
  'tabling', 'waiting_apps', 'corkage', 'corkage_fee', 'corkage_note',
  'group_capacity_max', 'serves_alcohol', 'parking', 'takeout',
  'mood', 'vibe_tags', 'vibe_note',
  'waiting_level', 'waiting_peak_time', 'waiting_note',
  'hours_open', 'hours_close', 'hours_break', 'hours_last_order', 'hours_holiday', 'lunch_open',
  'ibk_hq_m', 'ibk_hq_walk_min', 'ibk_finance_tower_m', 'ibk_finance_tower_walk_min',
  'link_kakao', 'link_naver', 'link_google',
  'localdata_mgtno', 'kakao_place_id', 'google_place_id',
  'in_kakao', 'in_google', 'match_score', 'confidence',
  'updated_at', 'note',
];

const j = (a) => (Array.isArray(a) ? a.join('|') : '');
const b = (v) => (v === true ? 'Y' : v === false ? 'N' : '');

function flatten(p) {
  const sig = (p.menus || []).find((m) => m.is_signature);
  return {
    id: p.id,
    data_status: p.data_status,
    name: p.name,
    name_legal: p.name_legal || '',
    branch: p.branch || '',
    status: p.status || '',
    zone: p.zone,
    address_road: (p.address && p.address.road) || '',
    address_jibun: (p.address && p.address.jibun) || '',
    address_detail: (p.address && p.address.detail) || '',
    lat: p.coord.lat,
    lng: p.coord.lng,
    phone: p.phone || '',
    license_type: (p.biz && p.biz.license_type) || '',
    license_category: (p.biz && p.biz.license_category) || '',
    license_date: (p.biz && p.biz.license_date) || '',
    purpose_badges: j(p.purpose_badges),
    categories_l1: j(p.categories_l1),
    categories: j(p.categories),
    primary_category: p.primary_category || '',
    menus: (p.menus || []).map((m) => `${m.name}~${m.price == null ? '' : m.price}`).join('|'),
    signature_menu: sig ? sig.name : '',
    lunch_per_person: (p.price_range && p.price_range.lunch_per_person) ?? '',
    dinner_per_person: (p.price_range && p.price_range.dinner_per_person) ?? '',
    price_level: (p.price_range && p.price_range.level) || '',
    reservation: p.facility.reservation,
    reservation_note: p.facility.reservation_note || '',
    private_room: p.facility.private_room,
    room_capacity_max: p.facility.room_capacity_max ?? '',
    tabling: p.facility.tabling,
    waiting_apps: j(p.facility.waiting_apps),
    corkage: p.facility.corkage,
    corkage_fee: p.facility.corkage_fee ?? '',
    corkage_note: p.facility.corkage_note || '',
    group_capacity_max: p.facility.group_capacity_max ?? '',
    serves_alcohol: b(p.facility.serves_alcohol),
    parking: p.facility.parking,
    takeout: b(p.facility.takeout),
    mood: (p.vibe && p.vibe.mood) || '',
    vibe_tags: j(p.vibe && p.vibe.tags),
    vibe_note: (p.vibe && p.vibe.note) || '',
    waiting_level: p.waiting.level,
    waiting_peak_time: p.waiting.peak_time || '',
    waiting_note: p.waiting.note || '',
    hours_open: p.hours.open || '',
    hours_close: p.hours.close || '',
    hours_break: p.hours.break_time || '',
    hours_last_order: p.hours.last_order || '',
    hours_holiday: p.hours.holiday || '',
    lunch_open: b(p.hours.lunch_open),
    ibk_hq_m: p.distance.ibk_hq.meters,
    ibk_hq_walk_min: p.distance.ibk_hq.walk_min,
    ibk_finance_tower_m: p.distance.ibk_finance_tower.meters,
    ibk_finance_tower_walk_min: p.distance.ibk_finance_tower.walk_min,
    link_kakao: p.links.kakao || '',
    link_naver: p.links.naver || '',
    link_google: p.links.google || '',
    localdata_mgtno: p.source.localdata_mgtno || '',
    kakao_place_id: p.source.kakao_place_id || '',
    google_place_id: p.source.google_place_id || '',
    in_kakao: b(p.verification.in_kakao),
    in_google: b(p.verification.in_google),
    match_score: p.verification.match_score ?? '',
    confidence: p.verification.confidence || '',
    updated_at: p.updated_at,
    note: p.note || '',
  };
}

function esc(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(places) {
  const lines = [COLUMNS.join(',')];
  for (const p of places) {
    const f = flatten(p);
    lines.push(COLUMNS.map((c) => esc(f[c])).join(','));
  }
  // 사내 레거시 도구를 위해 UTF-8 BOM 포함 (엑셀 한글 깨짐 방지)
  return '﻿' + lines.join('\n') + '\n';
}

module.exports = { COLUMNS, flatten, toCsv };
