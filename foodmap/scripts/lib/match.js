'use strict';

const { haversine } = require('./geo');

/**
 * 행안부 인허가 상호는 실제 간판과 자주 다르다.
 *   "주식회사 우리식당" / "우리식당 종로점" / "우리 식당"  -> 모두 같은 가게
 * 법인격·지점·공백·괄호·특수문자를 걷어내고 비교 가능한 형태로 정규화한다.
 */
const CORP = /(주식회사|주\)|\(주\)|유한회사|\(유\)|합자회사|영업소|사업자)/g;
// 지점명은 실제로 짧다(명동점, 종각점, 종로3가점). {1,10} 은 상호 전체를 삼켜버려 코어 추출이 무력화된다.
const BRANCH = /(본점|본관|직영점|[가-힣A-Za-z0-9]{1,5}점)$/;

function normalizeName(raw) {
  if (!raw) return '';
  let s = String(raw)
    .replace(/\(.*?\)/g, ' ')
    .replace(CORP, ' ')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .trim();
  return s;
}

/** 지점명을 떼어낸 코어 상호 */
function coreName(raw) {
  const n = normalizeName(raw);
  const m = n.match(BRANCH);
  if (m && n.length - m[0].length >= 2) return n.slice(0, n.length - m[0].length);
  return n;
}

/** 문자 bigram 자카드 유사도 */
function bigrams(s) {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  if (s.length === 1) out.add(s);
  return out;
}

function similarity(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return a === b ? 1 : 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

function nameScore(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ca = coreName(a);
  const cb = coreName(b);
  if (ca && ca === cb) return 0.95;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  // "커피빈코리아 명동점" vs "커피빈 명동점" — 지점명을 뗀 코어끼리도 포함관계를 본다
  if (ca && cb && ca.length >= 2 && cb.length >= 2 && (ca.includes(cb) || cb.includes(ca))) return 0.88;
  return similarity(na, nb);
}

/**
 * 후보군에서 최적 매칭 1건을 고른다.
 * 좌표가 가까울수록, 이름이 비슷할수록 높은 점수. 좌표 게이트를 먼저 통과해야 한다.
 */
function bestMatch(target, candidates, opt) {
  const { maxDistanceM = 80, minScore = 0.6 } = opt || {};
  let best = null;

  for (const c of candidates) {
    if (!c.coord || !target.coord) continue;
    const d = haversine(target.coord, c.coord);
    if (d > maxDistanceM) continue;

    const ns = nameScore(target.name, c.name);
    // 거리 점수: 0m=1.0, maxDistance=0.0 선형
    const ds = 1 - d / maxDistanceM;
    const score = ns * 0.75 + ds * 0.25;

    if (!best || score > best.score) {
      best = {
        candidate: c,
        score: Math.round(score * 100) / 100,
        distance_m: Math.round(d),
        name_score: Math.round(ns * 100) / 100,
        method: ns >= 0.9 ? 'name+coord' : ns >= 0.6 ? 'name+coord' : 'coord_only',
      };
    }
  }

  if (!best || best.score < minScore) return null;
  return best;
}

module.exports = { normalizeName, coreName, similarity, nameScore, bestMatch };
