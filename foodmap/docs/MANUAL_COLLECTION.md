# 수동 수집 프로토콜

MANUAL 등급 19개 필드를 주기 배치로 채우는 규칙. 이 문서가 정본이다.

---

## 대원칙 3가지

1. **모르면 비운다.** 확인되지 않은 값은 추측하지 말고 `UNKNOWN`(또는 `null`)으로 둔다.
   빈 칸은 "아직 안 알아봄"이지만, 틀린 값은 팀원을 헛걸음시킨다. 빈 값이 항상 낫다.
2. **출처 없는 값은 값이 아니다.** 하나라도 채웠으면 `sources`에 URL이 최소 1개 있어야 한다.
   없으면 `merge-manual.js`가 그 업소 전체를 거부한다.
3. **오래된 정보는 표시한다.** 출처의 기준 시점을 `as_of`(YYYY-MM)에 적는다.
   2년 전 블로그의 가격을 오늘 가격처럼 적으면 안 된다.

---

## 필드별 판정 기준

### `facility.reservation` — 예약가능
| 값 | 조건 |
|---|---|
| `YES` | 예약앱에 등록되어 있거나, 가게가 "예약 가능"을 명시 |
| `COND` | 조건부 — 인원 하한("6인 이상만"), 시간대 한정, 전화만 가능 등. **`reservation_note`에 조건 필수** |
| `NO` | "예약 불가/노쇼 방지 워크인만" 명시 |
| `UNKNOWN` | 위 어디에도 근거 없음 |

리뷰에 "예약하고 갔다"가 여러 건이면 `YES`(confidence `MEDIUM`). 1건뿐이면 `UNKNOWN`.

### `facility.private_room` / `room_capacity_max` — 룸
- `YES`는 **문이 닫히는 독립 공간**만. 파티션·커튼 칸막이는 `COND` + note에 형태 기재.
- `room_capacity_max`는 룸 하나의 최대 인원. 룸이 여러 개면 가장 큰 룸 기준, note에 개수 기재.
- 좌식/입식 구분이 확인되면 note에 적는다. 회식 자리 정할 때 실제로 쓰인다.

### `facility.tabling` / `waiting_apps` — 원격 웨이팅
- `tabling: YES`는 **원격으로 대기 등록이 되는 경우만.** 현장 태블릿만 있으면 `NO` + `waiting_apps: ["현장only"]`.
- `waiting_apps` 허용값: `테이블링` `캐치테이블` `나우웨이팅` `현장only`

### `facility.corkage` / `corkage_fee` / `corkage_note` — 콜키지
| 값 | 조건 |
|---|---|
| `YES` | 반입 허용. 무료면 `corkage_fee: 0` |
| `COND` | 조건부 — "룸 이용 시만", "2병까지", "와인만" 등. **`corkage_note`에 조건 필수** |
| `NO` | 반입 불가 명시 |
| `UNKNOWN` | 근거 없음 |

`corkage_fee`는 **병당 원 단위 정수**. `0` = 콜키지 프리, `null` = 금액 미확인.
콜키지는 조용히 바뀌는 정책이라 확실치 않으면 `UNKNOWN`으로 두는 편이 낫다.

### `facility.group_capacity_max` — 단체 수용
한 팀이 한자리에 앉을 수 있는 최대 인원. 가게 총 좌석 수가 아니다.
"단체석 있음"만 확인되고 숫자가 없으면 `null`로 두고 `vibe.tags`에 `단체석`을 넣는다.

### `menus` — 대표메뉴와 가격
- 대표메뉴 1개는 반드시 `is_signature: true`.
- `price`는 **원 단위 정수** (`10000`). `"1만원"`, `"10,000"` 안 됨.
- 시가·변동가는 `price: null` + `price_note: "시가"`.
- 3~6개면 충분하다. 메뉴판 전체를 옮길 필요 없다.
- **가격은 가장 잘 틀리는 값이다.** `field_sources["menus[].price"]`에 출처를 반드시 남긴다.

### `price_range` — 1인 예산
- `lunch_per_person` / `dinner_per_person`: 1인 실제 지출 추정 (음료·주류 제외 기준).
- `level`: `₩`(1만 미만) `₩₩`(1~2.5만) `₩₩₩`(2.5~5만) `₩₩₩₩`(5만 이상)

### `vibe.mood` — 분위기 (1개만)
`캐주얼` `정갈` `시끌벅적` `모던` `노포` `접대용` — 이 6개 밖은 거부된다.

### `vibe.tags` — 분위기 태그 (복수)
`조용한` `시끌벅적` `모던` `레트로` `노포` `깔끔한` `아늑한` `가성비` `고급스러운`
`단체석` `1인석` `야외석` `루프탑` `뷰맛집` `인테리어좋음` `혼밥가능` `접대용` `데이트`

화이트리스트 밖 태그는 자동 제거된다. 2~4개가 적당하다.

### `waiting.level` / `peak_time` — 웨이팅
| 값 | 기준 |
|---|---|
| `NONE` | 대기 거의 없음 |
| `LOW` | 피크에만 5~10분 |
| `HIGH` | 피크 15~30분 |
| `EXTREME` | 상시 30분 이상 |

`peak_time`은 `HH:MM-HH:MM`. 점심 웨이팅이 핵심 정보이므로 점심 시간대를 우선 확인한다.

---

## `confidence` 판정

| 값 | 기준 |
|---|---|
| `HIGH` | 가게 공식 채널(인스타·홈페이지·예약앱 상세)에서 직접 확인 |
| `MEDIUM` | 최근 1년 내 리뷰·블로그 **2건 이상**이 일치 |
| `LOW` | 단일 출처이거나 1년 이상 지난 정보 |

`LOW`로 채운 값은 다음 배치에서 우선 재확인 대상이 된다.

---

## 출력 형식

작업지시서(`worklist-*.json`)의 **구조를 그대로 유지**하고 각 item의
`fill` / `sources` / `field_sources` / `confidence` / `note`만 채워서 돌려준다.
`id`, `name` 등 다른 필드는 절대 수정하지 않는다.

```jsonc
{
  "id": "FM-00042",
  "fill": {
    "facility.reservation": "COND",
    "facility.reservation_note": "6인 이상만 전화 예약",
    "facility.private_room": "YES",
    "facility.room_capacity_max": 12,
    "facility.tabling": "NO",
    "facility.waiting_apps": ["현장only"],
    "facility.corkage": "UNKNOWN",     // 근거 못 찾음 -> 추측 금지
    "facility.corkage_fee": null,
    "facility.group_capacity_max": 20,
    "menus": [
      { "name": "바지락칼국수", "price": 10000, "is_signature": true },
      { "name": "왕만두", "price": 7000 }
    ],
    "price_range.lunch_per_person": 11000,
    "price_range.level": "₩",
    "vibe.mood": "노포",
    "vibe.tags": ["노포", "가성비", "혼밥가능"],
    "waiting.level": "HIGH",
    "waiting.peak_time": "11:50-13:10"
  },
  "sources": [
    { "url": "https://...", "title": "가게 인스타그램", "as_of": "2026-07" }
  ],
  "field_sources": {
    "menus[].price": "https://...",
    "waiting.level": "https://..."
  },
  "confidence": "MEDIUM",
  "note": "2층 룸 1개, 좌식"
}
```

**채우지 못한 필드는 키를 지우지 말고 `null` 또는 `"UNKNOWN"`으로 남긴다.**

---

## 병합 시 거부 사유

`merge-manual.js`가 아래 경우 해당 업소를 통째로 거부한다.

- 값을 채웠는데 `sources`가 비었거나 URL 형식이 아님
- `confidence`가 `HIGH`/`MEDIUM`/`LOW` 중 하나가 아님
- enum 밖의 코드값 (`facility.reservation: "가능"` 같은 한글 값)
- `corkage_fee`, `room_capacity_max` 등에 정수가 아닌 값
- 병합 결과가 JSON Schema 검증에 실패

거부되어도 다른 업소는 정상 병합된다. 거부 사유가 콘솔에 출력되므로 고쳐서 다시 돌리면 된다.

---

## 재수집 주기

| 대상 | 주기 |
|---|---|
| 가격, 웨이팅, 콜키지 금액 등 잘 바뀌는 값 | **3개월** |
| 룸, 예약, 분위기 등 안정적인 값 | **6개월** |

`manual_meta.next_review`가 지나면 `npm run worklist -- --stale`에 자동으로 잡힌다.

`human_verified: true`(사내 인원이 실제 방문·전화로 확인)인 필드는 자동 배치가 덮어쓰지 않는다.
