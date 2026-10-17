# 구조와 데이터 흐름

빌드 도구·프레임워크·외부 패키지 없이 **정적 파일(GitHub Pages) + GitHub Actions** 로 돌아갑니다.

## 1. 데이터 흐름

```
[GitHub Actions — update-data.yml]  평일 07:20(cron-job.org) · 16:45 · GitHub 예약 · main push
  ① 단위 테스트            node --test tests/unit.test.mjs        실패 → 배포 중단(기존 사이트 유지)
  ② 이전 배포본 받기        previous.json · ai-previous.json · alerts-previous.json
  ③ 지표 수집              scripts/fetch-data.mjs  → _site/data/latest.json
                           소스: FRED · Yahoo · 한국은행 ECOS · EIA(+EIA-930) · NRC · Ember · Eurostat
                           실패 지표는 이전 값 유지, 대체 소스가 더 오래되면 이전 값 유지, 계산 지표(COMPUTED) 생성
  ④ 데이터 구조 검증        scripts/validate-data.mjs              구조 오류 → 배포 중단 / 급변·오래됨은 기록만
  ⑤ 긴급 경고              scripts/alerts.mjs     → alerts.json, 텔레그램
  ⑥ AI 인사이트            scripts/ai-insight.mjs → ai.json, 텔레그램 (평일 아침 1회, Gemini)
  ⑦ 관심 종목 성적표        scripts/track.mjs      (private/ 캐시, 월요일 텔레그램)
  ⑧ 사이트 파일 구성·배포   index.html … + data/*.json → GitHub Pages
```

## 2. 화면(브라우저)

| 파일 | 역할 |
|---|---|
| `index.html` | CONFIG(지표 정의·임계값·해설 묶음), 분석(신호등·추세·분포·평년), 화면 그리기(AI·오늘·지표 3화면), 상세 시트, 설정 |
| `data.js` | DataStore: 자동 데이터(latest.json) + 직접 입력(localStorage) 병합, 백업·복원 |
| `notes.js` | 지표별 인사이트 문구(의미·함께 보면·확인할 것) |
| `season.js` | 계절 메모 (화면·AI 프롬프트 공용) |
| `tankers.js` · `guides.js` | 유조선·벌크선·석유 밸류체인 가이드 |
| `share.js` | 공유 이미지(캔버스) + 바로가기 링크(`#ind=지표ID`) |
| `ui-v2.css` · `ui-v2.js` | v2 디자인(목록형·하단 메뉴). v1 은 index.html 기본 스타일 |
| `sw.js` | 서비스 워커(네트워크 우선, 오프라인 대비) |

**기기 저장소(localStorage) — 키를 바꾸면 사용자 데이터가 사라지므로 바꾸지 않음**

| 키 | 내용 |
|---|---|
| `macroDash.data.v1` | 직접 입력한 값 (백업 대상) |
| `macroDash.remote.v1` | 자동 데이터 캐시 |
| `macroDash.settings.v1` | 테마·탭·차트 기간 |
| `macroDash.ai.v1` | AI 브리핑 캐시 |
| `macroDash.ui` | 디자인 v1 / v2 |

## 3. 지표 정의는 한 곳

- 이름·분류·단위·임계값: `index.html` 의 `CONFIG.indicators`
- 수집 소스: `scripts/sources.mjs` (1순위 → 대체)
- 계산 지표 공식: `scripts/fetch-data.mjs` 의 `COMPUTED`
- 사람이 읽는 목록: `docs/indicator-catalog.md` (`node scripts/catalog.mjs` 로 자동 생성, 테스트가 최신 여부 확인)

Node 스크립트는 `scripts/lib/config.mjs` 로 index.html 의 CONFIG 를 그대로 읽어 씁니다 (정의가 두 곳으로 갈라지지 않게).

## 4. 테스트

| 명령 | 내용 | 언제 |
|---|---|---|
| `node --test tests/unit.test.mjs` | 계산 공식, 관측치 정리, AI 문장 다듬기, 지표 정의 일관성, 해설 id, 카탈로그 최신, 데이터 구조 검증 | 배포 워크플로 시작 시 · PR |
| `node tests/ui-smoke.mjs` | 합성 데이터로 실제 브라우저: v1·v2 × 라이트·다크, 화면 전환, 모든 분류·지표 상세, 공유 이미지, 백업·복원, 공유 링크, 360px 가로 넘침 | PR · 작업 브랜치 push (`test.yml`) |
| `node scripts/validate-data.mjs <파일>` | 수집 결과 구조 검증 | 배포 워크플로 수집 직후 |

로컬에서 화면 테스트: `PW_CHROMIUM=<크롬 경로> NODE_PATH=$(npm root -g) node tests/ui-smoke.mjs` (전역 playwright 필요)

## 5. 롤백

v2 작업 전 상태는 **`v1-final` 브랜치**에 보존돼 있습니다. 되돌릴 때는 그 브랜치의 화면 파일로 되돌리는 변경을 main 에 반영합니다
(데이터 수집·텔레그램·기기에 저장된 직접 입력값은 그대로).
