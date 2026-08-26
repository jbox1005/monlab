# foodmap — 종각·종로·명동·을지로 맛집 데이터 수집

사내 맛집 프로그램 반입용 데이터셋을 만드는 파이프라인과 스키마.

기준점은 **IBK기업은행 본점**(중구 을지로 79)과 **IBK파이낸스타워**(중구 을지로 82) 두 곳이며,
모든 업소에 두 건물로부터의 도보 거리·소요시간이 붙는다.

---

## 지금 바로 볼 것

| 파일 | 내용 |
|---|---|
| `sample/places.sample.json` | **반입 샘플 20건** (JSON 정본 형식) |
| `sample/places.sample.csv` | 같은 20건의 평탄화 CSV (UTF-8 BOM) |
| `sample/taxonomy_index.sample.json` | 카테고리 > 메뉴 > 가게 3단 탐색 인덱스 |
| `docs/HANDOFF.md` | **다른 Claude 세션에서 수집을 이어받을 때 읽을 문서** |
| `docs/MANUAL_COLLECTION.md` | 수동 수집 프로토콜 (필드별 판정 기준) |
| `schema/place.schema.json` | JSON Schema (draft 2020-12) |
| `schema/CODEBOOK.md` | **모든 코드값 정의 — 먼저 읽을 것** |

> ⚠ **샘플의 상호·메뉴·가격·분위기·웨이팅·콜키지 값은 전부 스키마 예시용 가공 데이터다.**
> 실재하는 특정 업소의 정보가 아니다. 좌표만 4개 구역의 실제 지리 범위를 따른다.
> 실데이터는 아래 파이프라인으로 생성한다.

---

## 데이터 소스 설계

| 역할 | 소스 | 이유 |
|---|---|---|
| **기본 모수** | 행안부 LOCALDATA (지방행정인허가) | 인허가 기준 전수 데이터. 음식점·카페·**단란/유흥주점** 전 업종 포함. 무료, 쿼터 없음, CSV 일괄 다운로드 |
| **상호·좌표 보정** | 카카오 로컬 API | 인허가 상호("주식회사 ○○")를 실제 간판 상호로 교체. 좌표 정확도도 더 높음 |
| **신뢰성 검증** | Google Places (New) | 1회성 교차검증 전용 |
| 평점·리뷰 | — | **어떤 공개 API로도 안 나온다.** 사내 자체 평점 기능 권장 |

### 네이버를 쓰지 않는 이유

네이버 지역검색 API는 `display` 최대 5건에 페이징이 불가하다.
"을지로 술집"을 검색하면 5개가 나오고 끝이라 **모수 수집 용도로 쓸 수 없다.**
네이버 지도 내부 API에는 평점·리뷰가 있지만 약관상 크롤링이 금지되어 있어 사내 상시 운영에는 부적합하다.
네이버는 `links.naver` 딥링크로만 연결한다.

### 구글 약관 주의

Google Maps Platform 약관은 응답 데이터의 영구 저장을 금지한다.
**무기한 저장이 허용되는 필드는 `place_id` 뿐이다.**
따라서 이 파이프라인은 구글에서 평점·리뷰·영업시간을 가져와 저장하지 않는다.
구글은 **① 모수 신뢰성 1회 검증**, **② `place_id` 기반 딥링크** 두 가지로만 쓴다.

---

## 파이프라인

```
data/raw/*.csv  (행안부 LOCALDATA 다운로드)
      │
      ├─ npm run collect   → out/01_base.json          구역 필터 + EPSG:5174→WGS84 + 도보거리 + 1차 분류
      ├─ npm run enrich    → out/02_enriched.json      카카오로 실제 상호·좌표·딥링크 보강
      ├─ npm run verify    → out/03_verification.md    ★ 행안부 신뢰성 교차검증 (1회)
      └─ npm run build     → out/places.json/.csv      최종 반입 파일 + 탐색 인덱스
                             out/taxonomy_index.json
                             out/manifest.json         건수·체크섬
```

### 사전 준비

```bash
npm install

export KAKAO_REST_KEY=...          # developers.kakao.com → REST API 키
export GOOGLE_MAPS_API_KEY=...     # 검증 단계에서만 필요

npm run geocode                    # IBK 두 기준점 좌표 확정 (config/anchors.json 갱신)
```

`data/raw/` 에 아래를 넣는다 — [localdata.go.kr](https://www.localdata.go.kr) → 데이터받기 → 지역별 데이터,
**서울특별시 종로구 / 중구** 를 업종별로 각각 다운로드:

- 일반음식점
- 휴게음식점
- 단란주점영업
- 유흥주점영업

### 실행

```bash
npm run collect
npm run enrich
npm run verify -- --confirm      # 생략하면 API 호출 규모만 출력하는 드라이런
npm run build
npm run validate                 # 반입 전 스키마 게이트
```

---

## ★ 행안부 신뢰성 교차검증

`npm run verify` 는 구글 Places로 4개 구역을 **격자 스캔**해 독립 인구조사를 만든 뒤,
행안부 모수와 대조한다.

- 격자: 148개 지점 (간격 180m / 반경 130m) × 3개 타입 패스 = **약 444회 API 호출**
- 드라이런(`--confirm` 없이)으로 규모를 먼저 확인할 것

산출물 `out/03_verification_report.md`:

| 집합 | 의미 |
|---|---|
| `BOTH` | 양쪽 모두 존재 → 행안부 정상 |
| `LOCALDATA_ONLY` | 행안부에만 → 대개 정상 (구글의 한국 커버리지가 얕음) |
| **`GOOGLE_ONLY`** | **구글에만 → 행안부 누락 후보. 신뢰성의 핵심 지표** |

**`행안부 recall = BOTH / (BOTH + GOOGLE_ONLY)`**

- 90% 이상 → 행안부를 모수로 삼는 데 문제 없음
- 80% 미만 → `google_only` 목록을 직접 검토해 수동 추가하거나, 구역 반경·업태 필터 재검토

`GOOGLE_ONLY` 에는 신규 개업(인허가 반영 지연), 건물 내 푸드코트, 구글 중복 등록이 섞여 있으므로
숫자만 보지 말고 목록을 눈으로 확인해야 한다.

---

## 수동 수집 배치 (MANUAL 필드)

예약가능 / 룸 / 테이블링 / 콜키지 / 대표메뉴 가격 / 분위기 / 웨이팅 — 이 계열 19개 필드는
행안부·카카오·구글 어디에도 없다. **주기 배치로 Claude가 조사해서 채운다.**

```
npm run worklist                  # 작업지시서 생성
  → data/manual/worklist-<batch>.json
        ↓  Claude 에게 전달 (docs/HANDOFF.md 5장 지시문 사용)
     fill 채워서 반환
        ↓  data/manual/filled-<batch>.json 으로 저장
npm run merge -- <batch>          # 검증 후 병합
npm run build                     # CSV·인덱스 재생성
```

| 옵션 | 용도 |
|---|---|
| `--size 40` | 배치 크기 (기본 25) |
| `--zone 을지로` | 구역 한정 |
| `--badge DINNER` | 회식장소만 |
| `--stale` | 재검토 기한 지난 건만 |
| `--dry` (merge) | 병합 없이 검증만 |

### 병합 안전장치

출처 없는 값은 추측이므로 병합하지 않는다. 아래에 걸리면 **해당 업소만** 거부하고 나머지는 정상 병합한다.

- 값을 채웠는데 `sources` 가 비었거나 URL 형식이 아님
- `confidence` 가 `HIGH`/`MEDIUM`/`LOW` 가 아님
- enum 밖의 값(`"가능"`), 숫자 자리에 문자열(`"16명"`)
- 병합 결과가 스키마 검증 실패 → 이 경우 **아무것도 저장하지 않음**
- `manual_meta.human_verified: true` 인 필드는 자동 배치가 덮어쓰지 않음

### 출처 추적

채워진 값은 `manual_meta` 에 출처·시점·신뢰도가 함께 기록된다.

```json
"manual_meta": {
  "filled_at": "2026-08-26", "filled_by": "claude", "batch_id": "2026-08-26-01",
  "confidence": "MEDIUM",
  "sources": [{ "url": "...", "title": "가게 인스타그램", "as_of": "2026-07" }],
  "fields_filled": ["facility.tabling", "vibe.tags"],
  "field_sources": { "menus[].price": "..." },
  "human_verified": false,
  "next_review": "2026-11-26"
}
```

재수집 주기는 가격·웨이팅·콜키지금액 등 잘 바뀌는 값 **3개월**, 룸·예약·분위기 **6개월**.
기한이 지나면 `--stale` 배치에 자동으로 잡힌다.

상세 규칙은 `docs/MANUAL_COLLECTION.md`, 다른 Claude 세션 인수인계는 `docs/HANDOFF.md`.

---

## 사내망 반입

사내망은 보통 아웃바운드가 막혀 있어 런타임 API 호출이 동작하지 않는다.
**외부에서 수집 → 파일로 반입 → 사내에서는 로컬 파일만 읽기** 구조를 전제로 설계했다.

- 정본: `out/places.json`
- 반입용: `out/places.csv` (UTF-8 BOM, `|` 다중값, `이름~가격` 메뉴 직렬화)
- 무결성: `out/manifest.json` 의 sha256 으로 반입 전후 대조

`data_status: SAMPLE` 인 레코드는 운영 반입에서 제외할 것.

---

## 설정 파일

| 파일 | 용도 |
|---|---|
| `config/zones.json` | 4개 구역 중심·반경, 행안부 업종/업태 필터 |
| `config/anchors.json` | IBK 두 기준점, 도보 추정 계수 |
| `config/taxonomy.json` | 카테고리 트리 + 자동분류 키워드 사전 |
| `config/rules.json` | 목적 뱃지 규칙, 주류 추정, 분위기 태그 화이트리스트 |

**코드를 고치지 않고 설정만으로 조정 가능하게 만들었다.**
뱃지 기준을 바꾸려면 `rules.json` 의 `auto_rule` 만 수정하면 된다.

---

## 알려진 한계

- 카카오 매칭은 상호가 크게 다르거나 체인 법인명이 붙은 경우(예: `스타벅스 종로점` ↔ `스타벅스커피코리아 종로점`) 실패할 수 있다. 실패 건은 `verification.in_kakao = false` 와 `note` 로 표시되니 수동 확인 대상으로 뽑아 쓸 것.
- 구글 Nearby Search는 셀당 최대 20건이라 밀집 구역에서 일부 누락될 수 있다. 격자 간격을 줄이면 정확해지지만 호출 수가 는다.
- 도보 시간은 실제 보행경로가 아닌 우회계수 추정이다. 지하상가·육교가 많은 을지로 구간은 실제와 차이가 날 수 있다.
- 행안부 좌표가 비어 있거나 0인 레코드는 제외된다 (`collect.js` 가 건수를 출력).
