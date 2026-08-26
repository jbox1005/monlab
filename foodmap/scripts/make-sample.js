#!/usr/bin/env node
'use strict';

/**
 * 샘플 반입 파일 생성기.
 *
 * ⚠ 여기 등장하는 상호·메뉴·가격·분위기·웨이팅·콜키지 값은 전부 스키마 예시용 가공 데이터이며
 *   실재하는 특정 업소의 정보가 아니다. 좌표만 4개 구역 내 실제 지리 범위를 따른다.
 *   실데이터는 scripts/collect.js -> enrich.js -> build.js 파이프라인으로 생성한다.
 */

const fs = require('fs');
const path = require('path');
const geo = require('./lib/geo');
const tax = require('./lib/taxonomy');
const { toCsv } = require('./lib/flatten');

const ROOT = path.join(__dirname, '..');
const anchors = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/anchors.json'), 'utf8'));
const zonesCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/zones.json'), 'utf8'));
const Z = Object.fromEntries(zonesCfg.zones.map((z) => [z.name, z.center]));

const off = (c, dLat, dLng) => ({ lat: +(c.lat + dLat).toFixed(6), lng: +(c.lng + dLng).toFixed(6) });

// zone, name, license_type, uptae, coord offset, menus, 나머지 필드
const S = [
  ['종각','종각손칼국수','일반음식점','한식',[0.0008,-0.0012],
    [['바지락칼국수',10000,1],['들깨칼국수',11000,0],['왕만두',7000,0],['겉절이보쌈',18000,0]],
    {lunch:11000,dinner:14000,lvl:'₩',res:'NO',room:'NO',tab:'NO',cork:'NO',cap:12,mood:'노포',tags:['가성비','노포','혼밥가능'],wait:'HIGH',peak:'11:50-13:10',
     hours:{o:'10:30',c:'21:00',b:'15:00-16:30',lo:'20:20',h:'일요일 휴무'},note:'점심 피크에 웨이팅. 11시 40분 전 도착 권장.'}],
  ['종각','종각커피로스터스','휴게음식점','까페',[-0.0006,0.0009],
    [['아메리카노',4500,1],['콜드브루',5500,0],['플랫화이트',5000,0],['스콘',4000,0]],
    {lunch:5500,dinner:null,lvl:'₩',res:'NO',room:'NO',tab:'NO',cork:'UNKNOWN',cap:4,mood:'모던',tags:['조용한','1인석','인테리어좋음'],wait:'LOW',peak:'13:00-13:40',
     hours:{o:'08:00',c:'21:00',b:null,lo:'20:30',h:'연중무휴'},note:'식후 커피 수요 몰리는 13시 전후 자리 부족.'}],
  ['종각','종각이자카야 마루','일반음식점','일식',[0.0011,0.0007],
    [['모듬사시미',48000,1],['야키토리 5종',22000,0],['명란계란말이',14000,0],['하이볼',8000,0]],
    {lunch:null,dinner:38000,lvl:'₩₩₩',res:'YES',resn:'2일 전까지 전화 예약',room:'YES',roomcap:12,tab:'YES',apps:['캐치테이블'],cork:'COND',corkfee:20000,corkn:'와인 1병까지 병당 2만원',cap:20,mood:'모던',tags:['단체석','접대용','아늑한'],wait:'LOW',
     hours:{o:'17:00',c:'01:00',b:null,lo:'24:00',h:'일요일 휴무'},note:'룸 2개 보유, 회식 12인까지.'}],
  ['종각','종각백반집','일반음식점','한식',[-0.0013,-0.0005],
    [['제육볶음정식',9000,1],['김치찌개',8000,0],['고등어구이정식',10000,0]],
    {lunch:9000,dinner:11000,lvl:'₩',res:'NO',room:'NO',tab:'NO',cork:'UNKNOWN',cap:8,mood:'캐주얼',tags:['가성비','혼밥가능','시끌벅적'],wait:'HIGH',peak:'12:00-13:00',
     hours:{o:'07:00',c:'20:00',b:null,lo:'19:30',h:'토·일 휴무'},note:null}],

  ['종로','종로설렁탕','일반음식점','한식',[0.0006,0.0011],
    [['설렁탕',12000,1],['도가니탕',18000,0],['수육',35000,0]],
    {lunch:12000,dinner:16000,lvl:'₩₩',res:'COND',resn:'6인 이상 단체만',room:'NO',tab:'NO',cork:'NO',cap:30,mood:'노포',tags:['노포','단체석','혼밥가능'],wait:'LOW',
     hours:{o:'06:00',c:'22:00',b:null,lo:'21:30',h:'연중무휴'},note:null}],
  ['종로','종로왕족발','일반음식점','한식',[-0.0009,0.0014],
    [['족발 중',38000,1],['보쌈 중',36000,0],['막국수',9000,0],['소주',5000,0]],
    {lunch:null,dinner:22000,lvl:'₩₩',res:'YES',resn:'전화 예약',room:'YES',roomcap:10,tab:'NO',cork:'YES',corkfee:0,corkn:'콜키지 프리',cap:24,mood:'시끌벅적',tags:['단체석','시끌벅적','가성비'],wait:'LOW',
     hours:{o:'16:00',c:'02:00',b:null,lo:'01:00',h:'연중무휴'},note:'2층 룸 회식 10인까지.'}],
  ['종로','종로노가리호프','일반음식점','호프/통닭',[0.0014,-0.0008],
    [['생맥주 500',4000,1],['노가리',3000,0],['후라이드치킨',18000,0]],
    {lunch:null,dinner:18000,lvl:'₩',res:'NO',room:'NO',tab:'NO',cork:'NO',cap:40,mood:'시끌벅적',tags:['야외석','시끌벅적','가성비','단체석'],wait:'HIGH',peak:'19:00-21:00',
     hours:{o:'16:00',c:'01:00',b:null,lo:'24:00',h:'연중무휴'},note:'야외 테이블 위주, 우천 시 좌석 급감.'}],
  ['종로','종로평양냉면','일반음식점','한식',[-0.0004,-0.0016],
    [['평양냉면',15000,1],['비빔냉면',15000,0],['수육',32000,0],['녹두전',14000,0]],
    {lunch:15000,dinner:20000,lvl:'₩₩',res:'NO',room:'NO',tab:'YES',apps:['테이블링'],cork:'NO',cap:6,mood:'정갈',tags:['노포','깔끔한'],wait:'EXTREME',peak:'11:40-14:00',
     hours:{o:'11:00',c:'20:30',b:'15:30-17:00',lo:'20:00',h:'둘째·넷째 주 월요일 휴무'},note:'테이블링 원격 등록 가능. 피크 40분 이상 대기.'}],
  ['종로','종로디저트살롱','휴게음식점','까페',[0.0010,0.0018],
    [['말차빙수',13000,1],['얼그레이케이크',7500,0],['아메리카노',4800,0]],
    {lunch:null,dinner:null,lvl:'₩₩',res:'NO',room:'NO',tab:'NO',cork:'UNKNOWN',cap:6,mood:'모던',tags:['데이트','인테리어좋음','조용한'],wait:'LOW',
     hours:{o:'11:00',c:'22:00',b:null,lo:'21:20',h:'월요일 휴무'},note:null}],

  ['명동','명동돈카츠','일반음식점','일식',[0.0007,0.0009],
    [['등심돈카츠',13000,1],['모둠카츠',17000,0],['카레돈카츠',14000,0]],
    {lunch:13000,dinner:15000,lvl:'₩₩',res:'NO',room:'NO',tab:'YES',apps:['테이블링'],cork:'NO',cap:6,mood:'캐주얼',tags:['깔끔한','혼밥가능','1인석'],wait:'HIGH',peak:'12:00-13:30',
     hours:{o:'11:00',c:'21:00',b:'15:00-17:00',lo:'20:20',h:'연중무휴'},note:null}],
  ['명동','명동손만두','일반음식점','한식',[-0.0011,0.0006],
    [['고기만두',8000,1],['김치만두',8000,0],['만둣국',9500,0],['떡만둣국',10000,0]],
    {lunch:9000,dinner:11000,lvl:'₩',res:'NO',room:'NO',tab:'NO',cork:'UNKNOWN',cap:8,mood:'캐주얼',tags:['가성비','혼밥가능'],wait:'LOW',
     hours:{o:'10:00',c:'21:00',b:null,lo:'20:30',h:'연중무휴'},note:null}],
  ['명동','명동중화원','일반음식점','중국식',[0.0013,-0.0010],
    [['짜장면',8000,0],['삼선짬뽕',12000,1],['탕수육 중',25000,0],['코스 A',45000,0],['고량주',18000,0]],
    {lunch:10000,dinner:28000,lvl:'₩₩',res:'YES',resn:'룸은 3일 전 예약',room:'YES',roomcap:16,tab:'NO',cork:'COND',corkfee:15000,corkn:'룸 이용 시에만 병당 1.5만원',cap:16,mood:'접대용',tags:['단체석','접대용','고급스러운'],wait:'NONE',
     hours:{o:'11:00',c:'22:00',b:'15:00-17:00',lo:'21:00',h:'연중무휴'},note:'룸 3개, 최대 16인.'}],
  ['명동','명동베이커리','휴게음식점','까페',[-0.0005,-0.0013],
    [['크루아상',4200,1],['소금빵',3500,0],['아메리카노',4500,0]],
    {lunch:null,dinner:null,lvl:'₩',res:'NO',room:'NO',tab:'NO',cork:'UNKNOWN',cap:4,mood:'캐주얼',tags:['혼밥가능','1인석'],wait:'LOW',
     hours:{o:'07:30',c:'20:00',b:null,lo:'19:40',h:'연중무휴'},note:null}],
  ['명동','명동와인바 셀라','일반음식점','경양식',[0.0016,0.0004],
    [['글라스와인',12000,0],['치즈플래터',32000,1],['트러플파스타',26000,0]],
    {lunch:null,dinner:55000,lvl:'₩₩₩',res:'YES',resn:'캐치테이블 예약',room:'COND',roomcap:8,tab:'YES',apps:['캐치테이블'],cork:'YES',corkfee:30000,corkn:'병당 3만원, 2병까지',cap:10,mood:'접대용',tags:['데이트','고급스러운','아늑한','조용한'],wait:'NONE',
     hours:{o:'17:00',c:'01:00',b:null,lo:'24:00',h:'일요일 휴무'},note:'프라이빗석 커튼 분리형.'}],

  ['을지로','을지로곱창골목','일반음식점','한식',[0.0006,-0.0009],
    [['소곱창',22000,1],['대창',22000,0],['곱창전골',30000,0],['소주',5000,0]],
    {lunch:null,dinner:32000,lvl:'₩₩',res:'COND',resn:'8인 이상만 예약',room:'NO',tab:'NO',cork:'NO',cap:20,mood:'시끌벅적',tags:['단체석','시끌벅적','노포'],wait:'HIGH',peak:'18:30-20:30',
     hours:{o:'16:00',c:'24:00',b:null,lo:'23:00',h:'일요일 휴무'},note:null}],
  ['을지로','을지로빈대떡','일반음식점','탁주(막걸리)',[-0.0008,0.0012],
    [['녹두빈대떡',13000,1],['모듬전',22000,0],['생막걸리',6000,0]],
    {lunch:13000,dinner:20000,lvl:'₩',res:'NO',room:'NO',tab:'NO',cork:'NO',cap:16,mood:'노포',tags:['노포','레트로','시끌벅적','단체석'],wait:'HIGH',peak:'18:00-20:00',
     hours:{o:'11:30',c:'23:00',b:null,lo:'22:20',h:'연중무휴'},note:null}],
  ['을지로','을지로한정식 미담','일반음식점','한식',[0.0012,0.0006],
    [['점심 반상',22000,1],['저녁 정식',48000,0],['보리굴비정식',35000,0]],
    {lunch:22000,dinner:48000,lvl:'₩₩₩',res:'YES',resn:'전일 예약 필수',room:'YES',roomcap:20,tab:'NO',cork:'COND',corkfee:20000,corkn:'룸 한정 병당 2만원',cap:20,alc:true,mood:'정갈',tags:['접대용','조용한','고급스러운','단체석'],wait:'NONE',
     hours:{o:'11:30',c:'21:30',b:'14:30-17:30',lo:'20:30',h:'일요일 휴무'},note:'전 좌석 룸. 접대·팀 회식용.'}],
  ['을지로','을지로마라공방','일반음식점','중국식',[-0.0014,-0.0004],
    [['마라탕',12000,1],['마라샹궈',26000,0],['꿔바로우',18000,0]],
    {lunch:12000,dinner:20000,lvl:'₩₩',res:'NO',room:'NO',tab:'YES',apps:['테이블링'],cork:'NO',cap:8,mood:'캐주얼',tags:['혼밥가능','가성비'],wait:'LOW',
     hours:{o:'11:00',c:'22:00',b:null,lo:'21:30',h:'연중무휴'},note:null}],
  ['을지로','을지로수제맥주펍','일반음식점','호프/통닭',[0.0009,0.0015],
    [['수제맥주 파인트',9000,1],['피시앤칩스',19000,0],['소시지플래터',26000,0]],
    {lunch:null,dinner:30000,lvl:'₩₩',res:'YES',resn:'6인 이상 예약 가능',room:'NO',tab:'YES',apps:['캐치테이블'],cork:'NO',cap:14,mood:'모던',tags:['단체석','인테리어좋음','루프탑'],wait:'LOW',
     hours:{o:'17:00',c:'01:00',b:null,lo:'24:00',h:'월요일 휴무'},note:'루프탑 12석, 동절기 미운영.'}],
  ['을지로','을지로김밥분식','휴게음식점','분식',[-0.0003,0.0017],
    [['참치김밥',4500,1],['떡볶이',5000,0],['라볶이',6500,0],['모둠튀김',5000,0]],
    {lunch:6000,dinner:7000,lvl:'₩',res:'NO',room:'NO',tab:'NO',cork:'NO',cap:4,mood:'캐주얼',tags:['가성비','혼밥가능'],wait:'LOW',
     hours:{o:'07:00',c:'20:00',b:null,lo:'19:40',h:'일요일 휴무'},note:null}],
];

const TRI = (v) => (v === undefined ? 'UNKNOWN' : v);

const places = S.map((row, i) => {
  const [zone, name, licenseType, uptae, [dLat, dLng], menuRows, x] = row;
  const coord = off(Z[zone], dLat, dLng);
  const menus = menuRows.map(([n, price, sig]) => ({
    name: n, price, price_note: null, is_signature: !!sig, category: tax.classifyMenu(n),
  }));

  const cls = tax.classify({ name, uptae, menus });

  const p = {
    id: `SMP-${String(i + 1).padStart(5, '0')}`,
    data_status: 'SAMPLE',
    source: { localdata_mgtno: null, kakao_place_id: null, google_place_id: null, naver_place_url: null, collected_by: ['manual'] },
    name,
    name_legal: name,
    branch: null,
    status: '영업',
    zone,
    address: { road: `서울특별시 ${zone === '종로' || zone === '종각' ? '종로구' : '중구'} (샘플 주소 — 실주소 아님)`, jibun: null, detail: null },
    coord,
    phone: null,
    biz: { license_type: licenseType, license_category: uptae, license_date: null },
    purpose_badges: [],
    categories: cls.categories,
    categories_l1: cls.categories_l1,
    primary_category: cls.primary_category,
    menus,
    price_range: { lunch_per_person: x.lunch, dinner_per_person: x.dinner, level: x.lvl },
    facility: {
      reservation: TRI(x.res), reservation_note: x.resn || null,
      private_room: TRI(x.room), room_capacity_max: x.roomcap ?? null,
      tabling: TRI(x.tab), waiting_apps: x.apps || (x.tab === 'NO' ? ['현장only'] : []),
      corkage: TRI(x.cork), corkage_fee: x.corkfee ?? null, corkage_note: x.corkn || null,
      group_capacity_max: x.cap ?? null,
      serves_alcohol: null,
      parking: 'UNKNOWN', takeout: null,
    },
    vibe: { mood: x.mood, tags: tax.sanitizeVibeTags(x.tags), note: null },
    waiting: { level: x.wait, peak_time: x.peak || null, note: null },
    hours: {
      raw: null, lunch_open: x.hours.o < '12:00',
      open: x.hours.o, close: x.hours.c, break_time: x.hours.b, last_order: x.hours.lo, holiday: x.hours.h,
    },
    distance: {},
    links: { kakao: null, naver: null, google: null },
    verification: { in_google: null, in_kakao: null, match_score: null, match_method: null, confidence: 'LOW' },
    updated_at: new Date().toISOString().slice(0, 10),
    note: x.note || null,
  };

  // alc 가 명시되면 수동값 우선 (MANUAL 티어). 없으면 업태·메뉴에서 추정.
  p.facility.serves_alcohol = x.alc !== undefined ? x.alc : tax.inferAlcohol(p);
  for (const a of anchors.anchors) p.distance[a.key] = geo.walkFrom(a.coord, coord, anchors.walking);
  p.purpose_badges = tax.assignBadges(p);
  return p;
});

fs.mkdirSync(path.join(ROOT, 'sample'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'sample/places.sample.json'), JSON.stringify(places, null, 2) + '\n');
fs.writeFileSync(path.join(ROOT, 'sample/places.sample.csv'), toCsv(places));

console.log(`샘플 ${places.length} 건 생성`);
for (const p of places) {
  console.log(
    `  ${p.id} ${p.zone.padEnd(4)} ${p.name.padEnd(16)} ${(p.purpose_badges.join(',') || '-').padEnd(18)} ` +
    `${p.primary_category.padEnd(14)} 본점 ${String(p.distance.ibk_hq.meters).padStart(4)}m/${p.distance.ibk_hq.walk_min}분  ` +
    `타워 ${String(p.distance.ibk_finance_tower.meters).padStart(4)}m/${p.distance.ibk_finance_tower.walk_min}분`
  );
}
