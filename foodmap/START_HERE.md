# START HERE

이 폴더를 프로젝트에 넣으셨다면 아래 순서대로 보세요.

## 1분 안에 확인

```bash
cd foodmap
npm install
npm run sample          # 샘플 20건 생성 (API 키 불필요)
```

`sample/places.sample.csv` 를 엑셀로 열어보시면 반입 데이터 형태를 바로 확인하실 수 있습니다.
(UTF-8 BOM 이라 한글이 깨지지 않습니다.)

## 문서 읽는 순서

| 순서 | 문서 | 내용 |
|---|---|---|
| 1 | `docs/HANDOFF.md` | **여기부터.** 뭐가 되어 있고 뭐가 남았는지, 다음에 뭘 해야 하는지 |
| 2 | `README.md` | 파이프라인 구조, 왜 네이버 대신 행안부를 모수로 썼는지 |
| 3 | `schema/CODEBOOK.md` | 모든 코드값 정의, 필드 채움 등급표 |
| 4 | `docs/MANUAL_COLLECTION.md` | 수동 수집 시 필드별 판정 기준 |

## 지금 상태

- 파이프라인·스키마·문서: **완성**
- 실데이터: **0건** — 행안부 CSV 다운로드와 카카오 API 키가 필요합니다
- 샘플 20건은 전부 예시용 가공 데이터입니다 (`data_status: "SAMPLE"`). 운영 반입에서 제외하세요.

## 다음 할 일

`docs/HANDOFF.md` 3장 순서대로 진행하시면 됩니다.

1. 카카오 REST API 키 발급 (developers.kakao.com)
2. localdata.go.kr 에서 **서울 종로구·중구 × 4개 업종** CSV 다운로드 → `data/raw/`
3. `npm run collect && npm run enrich` ← 여기서 실데이터 건수가 처음 나옵니다
4. `npm run build`

## 원본 위치

GitHub `jbox1005/monlab` 브랜치 `claude/naver-restaurant-data-p01le2` 의 `foodmap/` 디렉터리와 동일합니다.
