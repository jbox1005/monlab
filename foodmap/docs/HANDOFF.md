# 인수인계 — 회사 공용 Claude에서 수집 이어가기

이 문서 하나만 있으면 다른 Claude 세션에서 수집 작업을 이어갈 수 있다.
**레포 접근이 안 되는 환경에서도 동작하도록 필요한 규칙을 전부 안에 적어두었다.**

---

## 1. 프로젝트 한 줄 요약

서울 **종각·종로·명동·을지로** 4개 구역의 음식점·카페·주점 데이터를 모아,
사내 맛집 프로그램에 반입할 파일(`places.json` / `places.csv`)을 만드는 작업.

기준점은 **IBK기업은행 본점**(중구 을지로 79)과 **IBK파이낸스타워**(중구 을지로 82).
모든 업소에 두 건물로부터의 도보 거리·시간이 붙는다.

레포: `jbox1005/monlab` 브랜치 `claude/naver-restaurant-data-p01le2`, 디렉터리 `foodmap/`

---

## 2. 이미 되어 있는 것 / 남은 것

| | 상태 |
|---|---|
| 스키마·코드북·수집 파이프라인 | ✅ 완성 |
| 목적 뱃지 3종 자동 부여 규칙 | ✅ 완성 |
| 카테고리 8대분류 × 32중분류 자동 분류 | ✅ 완성 |
| 도보 거리 계산 (IBK 2개 지점) | ✅ 완성 |
| 행안부↔구글 교차검증 스크립트 | ✅ 완성 (미실행) |
| **실데이터 수집** | ❌ **0건. 아직 안 돌림** |
| **MANUAL 19개 필드 채우기** | ❌ **이번 작업** |

샘플 20건이 있지만 **전부 예시용 가공 데이터**이며 실재 업소가 아니다. 운영 반입에서 제외할 것.

---

## 3. 실데이터를 먼저 만들어야 한다

수동 수집은 대상 목록이 있어야 시작된다. 아직 안 돌렸다면 이 순서:

```bash
cd foodmap && npm install
export KAKAO_REST_KEY=...          # developers.kakao.com → REST API 키
export GOOGLE_MAPS_API_KEY=...     # 교차검증에만 필요

npm run geocode                    # IBK 두 기준점 좌표 확정
```

`data/raw/`에 [localdata.go.kr](https://www.localdata.go.kr) → 데이터받기 → 지역별 데이터에서
**서울특별시 종로구 / 중구**를 아래 4개 업종으로 각각 받아 넣는다:
일반음식점 · 휴게음식점 · 단란주점영업 · 유흥주점영업

```bash
npm run collect                    # → out/01_base.json   (기본 모수)
npm run enrich                     # → out/02_enriched.json (카카오 상호·좌표 보정)
npm run verify                     # 드라이런: API 호출 규모만 출력
npm run verify -- --confirm        # 실제 교차검증 (약 444회 호출)
npm run build                      # → out/places.json, places.csv
```

교차검증 리포트(`out/03_verification_report.md`)의 **행안부 recall**이 90% 이상이면 모수로 문제없다.

---

## 4. 수동 수집 루프 (이번 작업의 본체)

```
npm run worklist                        # 작업지시서 생성
  → data/manual/worklist-<batch>.json
        ↓  이 파일을 Claude에게 전달
     Claude가 fill 채워서 반환
        ↓  data/manual/filled-<batch>.json 으로 저장
npm run merge -- <batch>                # 검증 후 병합
npm run build                           # CSV·인덱스 재생성
```

옵션:
```bash
npm run worklist -- --size 40           # 배치 크기 (기본 25)
npm run worklist -- --zone 을지로        # 구역 한정
npm run worklist -- --badge DINNER      # 회식장소만
npm run worklist -- --stale             # 기한 지난 건 재수집
npm run merge -- <batch> --dry          # 병합 없이 검증만
```

**레포 접근이 안 되는 환경이라면**: `worklist-<batch>.json` 파일 내용을 채팅창에 붙여넣고,
아래 5·6장 규칙에 따라 채운 JSON을 받아서 `filled-<batch>.json`으로 저장하면 된다.

---

## 5. Claude에게 줄 지시문 (그대로 복사해서 쓸 것)

> 아래 작업지시서 JSON의 각 item에서 `fill` / `sources` / `field_sources` / `confidence` / `note`
> **다섯 개만** 채워서 같은 구조의 JSON으로 돌려주세요. `id`를 비롯한 다른 필드는 절대 수정하지 마세요.
>
> **대원칙 3가지**
> 1. **모르면 비운다.** 확인 안 된 값은 추측하지 말고 `"UNKNOWN"` 또는 `null`로 두세요. 빈 값이 틀린 값보다 낫습니다.
> 2. **출처 없는 값은 값이 아니다.** 하나라도 채웠으면 `sources`에 실제 URL이 최소 1개 있어야 합니다. 없으면 병합 단계에서 그 업소 전체가 거부됩니다.
> 3. **오래된 정보는 표시한다.** 각 출처의 기준 시점을 `as_of`에 `YYYY-MM`으로 적으세요.
>
> **코드값 (이 값 외에는 거부됩니다)**
> - `facility.reservation` / `private_room` / `corkage`: `YES` `NO` `COND` `UNKNOWN`
>   - `COND`(조건부)면 대응하는 `*_note`에 조건을 반드시 적을 것
> - `facility.tabling`: `YES` `NO` `UNKNOWN` — **원격 대기등록이 되는 경우만 YES.** 현장 태블릿만 있으면 `NO`
> - `facility.waiting_apps`: `테이블링` `캐치테이블` `나우웨이팅` `현장only`
> - `waiting.level`: `NONE`(없음) `LOW`(피크 5~10분) `HIGH`(피크 15~30분) `EXTREME`(상시 30분↑) `UNKNOWN`
> - `waiting.peak_time`: `"11:50-13:10"` 형식
> - `vibe.mood`: `캐주얼` `정갈` `시끌벅적` `모던` `노포` `접대용` **중 1개만**
> - `vibe.tags` (2~4개): `조용한` `시끌벅적` `모던` `레트로` `노포` `깔끔한` `아늑한` `가성비` `고급스러운` `단체석` `1인석` `야외석` `루프탑` `뷰맛집` `인테리어좋음` `혼밥가능` `접대용` `데이트`
> - `price_range.level`: `₩`(1만 미만) `₩₩`(1~2.5만) `₩₩₩`(2.5~5만) `₩₩₩₩`(5만↑)
> - `confidence`: `HIGH`(가게 공식채널 직접확인) `MEDIUM`(최근 1년 리뷰 2건 이상 일치) `LOW`(단일 출처 또는 1년 이상 된 정보)
>
> **숫자 필드는 전부 정수** (`10000`). `"1만원"`, `"10,000"`, `"16명"` 모두 거부됩니다.
> - `corkage_fee`: 병당 원. **`0` = 콜키지 프리**, `null` = 금액 미확인
> - `room_capacity_max`: 룸 하나의 최대 인원 (여러 개면 가장 큰 룸 기준, 개수는 note에)
> - `group_capacity_max`: 한 팀이 한자리에 앉는 최대 인원 (가게 총 좌석 수 아님)
>
> **`menus`**: 3~6개면 충분합니다. 메뉴판 전체를 옮기지 마세요.
> 대표메뉴 1개에 `"is_signature": true`. 가격은 원 단위 정수, 시가는 `price: null` + `price_note: "시가"`.
> **가격은 가장 잘 틀리는 값이므로** `field_sources["menus[].price"]`에 출처를 반드시 남기세요.
>
> **판정이 애매할 때**
> - 룸: 문이 닫히는 독립 공간만 `YES`. 파티션·커튼은 `COND` + note에 형태 기재
> - 예약: 리뷰에 "예약하고 갔다"가 2건 이상이면 `YES`(confidence `MEDIUM`), 1건뿐이면 `UNKNOWN`
> - 콜키지: 조용히 바뀌는 정책이라 확실치 않으면 `UNKNOWN`이 정답
> - 웨이팅: **점심 시간대를 우선 확인**하세요. 팀에서 가장 많이 쓰는 정보입니다.
>
> 채우지 못한 필드는 키를 지우지 말고 `null` 또는 `"UNKNOWN"`으로 남겨주세요.

---

## 6. 응답 형식 예시

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
    "facility.corkage": "UNKNOWN",
    "facility.corkage_fee": null,
    "facility.corkage_note": null,
    "facility.group_capacity_max": 20,
    "menus": [
      { "name": "바지락칼국수", "price": 10000, "is_signature": true },
      { "name": "왕만두", "price": 7000 }
    ],
    "price_range.lunch_per_person": 11000,
    "price_range.dinner_per_person": null,
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

---

## 7. 병합이 거부하는 경우

`npm run merge`가 아래를 만나면 **해당 업소만** 거부하고 나머지는 정상 병합한다.
사유가 콘솔에 출력되니 고쳐서 다시 돌리면 된다.

- 값을 채웠는데 `sources`가 비었거나 URL 형식이 아님
- `confidence`가 `HIGH`/`MEDIUM`/`LOW` 중 하나가 아님
- enum 밖의 값 (`"가능"`, `"불가"` 같은 한글)
- 숫자 자리에 문자열 (`"16명"`)
- 병합 결과가 JSON Schema 검증 실패 → **이 경우엔 아무것도 저장되지 않음**

---

## 8. 재수집 주기

| 대상 | 주기 |
|---|---|
| 가격, 웨이팅, 콜키지 금액 | **3개월** |
| 룸, 예약, 분위기 | **6개월** |

`manual_meta.next_review`가 지나면 `npm run worklist -- --stale`에 자동으로 잡힌다.
사내 인원이 직접 방문·전화로 확인한 필드는 `manual_meta.human_verified: true`로 두면
이후 자동 배치가 덮어쓰지 않는다.

---

## 9. 절대 하지 말 것

- **네이버 지도 내부 API 크롤링** — 약관 위반. 평점·리뷰는 딥링크로만 연결한다.
- **구글 Places 응답을 파일에 저장** — 약관상 무기한 저장이 허용되는 필드는 `place_id`뿐이다.
  평점·리뷰·영업시간을 `places.json`에 넣으면 위반이다.
- **출처 없이 값 채우기** — 병합이 거부하지만, 애초에 하지 말 것.
- **`data_status: SAMPLE` 레코드를 운영에 반입** — 전부 가공 데이터다.

---

## 10. 참고 문서

| 문서 | 내용 |
|---|---|
| `foodmap/README.md` | 파이프라인 전체 구조, 소스 선택 근거 |
| `foodmap/schema/CODEBOOK.md` | 모든 코드값 정의, 필드 채움 등급표 |
| `foodmap/docs/MANUAL_COLLECTION.md` | 수동 수집 프로토콜 (이 문서 5장의 상세판) |
| `foodmap/schema/place.schema.json` | JSON Schema — 반입 전 `npm run validate`로 검증 |
