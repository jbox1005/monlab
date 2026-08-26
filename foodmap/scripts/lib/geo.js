'use strict';

/** 행안부 LOCALDATA 좌표계(중부원점 TM, EPSG:5174) -> WGS84 */
const EPSG5174 =
  '+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 ' +
  '+ellps=bessel +units=m +no_defs ' +
  '+towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43';

let _proj4 = null;
function proj4() {
  if (!_proj4) {
    try {
      _proj4 = require('proj4');
    } catch (e) {
      throw new Error('proj4 가 필요합니다. `npm install` 을 먼저 실행하세요.');
    }
  }
  return _proj4;
}

/** @returns {{lat:number,lng:number}|null} */
function tm5174ToWgs84(x, y) {
  const px = Number(x);
  const py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py) || px === 0 || py === 0) return null;
  const [lng, lat] = proj4()(EPSG5174, 'EPSG:4326', [px, py]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat: round6(lat), lng: round6(lng) };
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

/** 두 좌표 사이 직선거리(m) */
function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * 도보 거리/시간 추정.
 * 직선거리에 우회계수를 곱해 실보행거리를 추정하고, 보행속도와 횡단보도 대기 보정으로 분을 계산한다.
 * 도심(종로/을지로)은 격자형 도로라 1.3~1.4 계수가 실측과 잘 맞는다.
 */
function walkFrom(anchorCoord, placeCoord, opt) {
  const { detour_factor = 1.35, speed_m_per_min = 67, crossing_penalty_sec_per_100m = 6 } = opt || {};
  const straight = haversine(anchorCoord, placeCoord);
  const meters = straight * detour_factor;
  const baseMin = meters / speed_m_per_min;
  const penaltyMin = ((meters / 100) * crossing_penalty_sec_per_100m) / 60;
  return {
    meters: Math.round(meters),
    walk_min: Math.max(1, Math.round(baseMin + penaltyMin)),
    straight_m: Math.round(straight),
    method: 'estimate',
  };
}

/** 점이 폴리곤 내부인지 (ray casting). polygon = [[lat,lng], ...] */
function inPolygon(pt, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    const intersect =
      yi > pt.lat !== yj > pt.lat &&
      pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** 좌표가 속한 zone 반환. 폴리곤이 있으면 폴리곤 우선, 없으면 중심+반경. 여러 곳에 걸치면 가장 가까운 중심. */
function resolveZone(coord, zones) {
  const polyHit = zones.find((z) => z.polygon && z.polygon.length >= 3 && inPolygon(coord, z.polygon));
  if (polyHit) return polyHit;

  let best = null;
  for (const z of zones) {
    const d = haversine(coord, z.center);
    if (d <= (z.radius_m || 0) && (!best || d < best.d)) best = { z, d };
  }
  return best ? best.z : null;
}

module.exports = { tm5174ToWgs84, haversine, walkFrom, inPolygon, resolveZone, round6 };
