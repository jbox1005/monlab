'use strict';

const fs = require('fs');
const path = require('path');

const CFG = path.join(__dirname, '..', '..', 'config');
const taxonomy = JSON.parse(fs.readFileSync(path.join(CFG, 'taxonomy.json'), 'utf8'));
const rules = JSON.parse(fs.readFileSync(path.join(CFG, 'rules.json'), 'utf8'));

/** L2 코드 -> { l1, name } 인덱스 */
const L2 = new Map();
for (const l1 of taxonomy.tree) {
  for (const l2 of l1.children) {
    L2.set(l2.code, { l1: l1.code, l1name: l1.name, name: l2.name, menus: l2.menus });
  }
}

function l1Of(code) {
  return L2.get(code) ? L2.get(code).l1 : null;
}
function nameOf(code) {
  return L2.get(code) ? L2.get(code).name : code;
}

/**
 * 상호명 + 업태 + 메뉴명 텍스트에서 L2 카테고리를 추론한다.
 * 키워드 매칭 횟수로 점수를 매기고, 업태 매핑은 가중치 2를 준다(인허가 정보가 더 신뢰도 높음).
 */
function classify({ name = '', uptae = '', menus = [] }) {
  const score = new Map();
  const bump = (code, w) => score.set(code, (score.get(code) || 0) + w);

  // 업태는 L1 판별엔 유용하나 L2 구분엔 무력하다("까페"는 커피·베이커리·디저트를 못 가름).
  // 대표메뉴 1건(가중치 2)이 업태를 이기도록 0.8 만 준다.
  const uptaeCodes = taxonomy.uptae_map[uptae] || [];
  for (const c of uptaeCodes) bump(c, 0.8);

  const plain = [name, ...menus.map((m) => (typeof m === 'string' ? m : m.name || ''))]
    .join(' ')
    .replace(/\s+/g, ' ');
  // 대표메뉴는 가게 정체성을 가장 잘 나타내므로 가중치를 2배 준다.
  // (베이커리의 "크루아상"이 업태 "까페"에 밀려 커피로 분류되던 문제)
  const signature = menus
    .filter((m) => typeof m === 'object' && m.is_signature)
    .map((m) => m.name || '')
    .join(' ');

  for (const [code, meta] of L2) {
    for (const kw of meta.menus) {
      if (signature.includes(kw)) bump(code, 2);
      else if (plain.includes(kw)) bump(code, 1);
    }
  }

  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return { categories: [], categories_l1: [], primary_category: null };

  const top = ranked[0][1];
  // 최고점의 60% 이상만 채택 — 스치듯 걸린 키워드로 카테고리가 오염되는 걸 막는다
  const categories = ranked.filter(([, s]) => s >= Math.max(1, top * 0.6)).map(([c]) => c);
  const categories_l1 = [...new Set(categories.map(l1Of).filter(Boolean))];

  return { categories, categories_l1, primary_category: ranked[0][0] };
}

/** 메뉴 하나에 L2 코드 붙이기 */
function classifyMenu(menuName) {
  for (const [code, meta] of L2) {
    if (meta.menus.some((kw) => menuName.includes(kw))) return code;
  }
  return null;
}

/** 주류 판매 여부 추정 */
function inferAlcohol(place) {
  const inf = rules.alcohol_inference;
  const lt = place.biz && place.biz.license_type;
  const ut = place.biz && place.biz.license_category;
  if (inf.license_type_true.includes(lt)) return true;
  if (inf.uptae_true.includes(ut)) return true;
  if ((place.categories_l1 || []).some((c) => inf.category_l1_true.includes(c))) return true;
  // 메뉴에 주류가 있으면 업태와 무관하게 술을 판다 (일식당의 하이볼, 족발집의 소주)
  const menuText = (place.menus || []).map((m) => m.name || '').join(' ');
  if ((inf.menu_keywords_true || []).some((kw) => menuText.includes(kw))) return true;
  if (inf.license_type_false.includes(lt)) return false;
  return null;
}

/** rules.json 의 선언적 조건 평가 */
function getField(obj, pathStr) {
  return pathStr.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function evalCond(place, cond) {
  if (cond.all) return cond.all.every((c) => evalCond(place, c));
  if (cond.any) return cond.any.some((c) => evalCond(place, c));

  const v = getField(place, cond.field);
  switch (cond.op) {
    case 'eq':       return v === cond.value;
    case 'ne':       return v !== cond.value;
    case 'lte':      return typeof v === 'number' && v <= cond.value;
    case 'gte':      return typeof v === 'number' && v >= cond.value;
    case 'contains': return Array.isArray(v) && v.includes(cond.value);
    case 'not_in':   return !(Array.isArray(v) ? v.some((x) => cond.value.includes(x)) : cond.value.includes(v));
    default:         return false;
  }
}

/** 목적 뱃지(LUNCH/CAFE/DINNER) 부여 */
function assignBadges(place) {
  const out = [];
  for (const b of rules.purpose_badges) {
    if (evalCond(place, b.auto_rule)) out.push(b.code);
  }
  return out;
}

/** 분위기 태그 화이트리스트 필터 */
function sanitizeVibeTags(tags) {
  const allowed = new Set(rules.vibe_tags.allowed);
  return (tags || []).filter((t) => allowed.has(t));
}

module.exports = { taxonomy, rules, L2, l1Of, nameOf, classify, classifyMenu, inferAlcohol, assignBadges, sanitizeVibeTags };
