# 매크로 대시보드

금리·물가·환율·원자재 22개 지표를 한 화면에서 보는 **모바일용 개인 대시보드**입니다.
빌드 도구 없이 HTML/CSS/JS만으로 동작하고, 홈 화면에 추가(PWA)하면 앱처럼 쓸 수 있습니다.

> 정보 정리용이며 투자 권유나 매매 판단이 아닙니다.

## 파일 구조

```
index.html        화면 + 스타일 + 앱 로직. 스크립트 상단에 CONFIG / COMMENTS / CHECKLIST (수정 지점)
data.js           데이터 모듈: localStorage 저장, 샘플, 백업, 자동 조회 Provider(FRED)
manifest.json     PWA 매니페스트
sw.js             서비스 워커 (앱 파일 캐시 → 오프라인 열람)
icons/            앱 아이콘 (svg, png)
.nojekyll         GitHub Pages가 파일을 그대로 서빙하도록
```

## 화면 구성

- **요약**: 경고/주의/양호/오래됨 개수, **오늘의 체크리스트**(규칙 기반 3~5개, 체크 상태는 당일만 유지)
- **카테고리 탭**: 금리 / 물가 / 환율 / 에너지 / 금속 / 곡물 (탭 옆 점 = 그 카테고리의 가장 나쁜 신호)
- **지표 카드**: 현재 값, 직전 값 대비 변화(▲▼, %p 또는 %), 기준일, 마지막 업데이트 날짜, 신호등, 한 줄 해설
  - `샘플` 표식: 화면 예시용 가짜 값 (빗금 배경 + 보라색 값 + 상단 배너)
  - `오래된 데이터`: 마지막 업데이트 후 7일 이상 경과
  - 장단기 금리차는 10년물·2년물 값에서 자동 계산
- 하단에 면책 문구 고정

## 사용법

1. **처음 열면** 샘플 데이터가 표시됩니다. 실제 시세가 아니니 우측 상단 **입력·설정**에서 실제 값을 넣으세요.
2. **일괄 입력**: 기준일을 고르고 값이 있는 칸만 채운 뒤 저장. 기존 현재 값은 자동으로 "직전 값"이 됩니다.
   같은 기준일로 다시 저장하면 덮어씁니다. 어떤 지표든 실제 값을 넣으면 그 지표의 샘플 값은 사라집니다.
3. **개별 수정**: 카드를 누르면 임계값 안내, 값 추가, 이력(최대 24개) 확인·삭제가 가능합니다.
   처음 쓸 때는 직전 값도 이전 날짜로 한 번 입력해 두면 변화율과 해설이 바로 나옵니다.
4. **백업**: 설정 → `JSON 내보내기` / `JSON 불러오기`. 데이터는 그 기기 브라우저에만 저장되므로
   기기 변경·브라우저 데이터 삭제 전에 내보내 두세요. (API 키는 백업 파일에 들어가지 않습니다.)
5. **테마**: 시스템 설정 따름 / 라이트 / 다크.

### 값 입력 단위 (기본값)

| 지표 | 단위 | 비고 |
|---|---|---|
| 기준금리·국채금리·CPI·실업률 | % | CPI는 전년 동월 대비 상승률 |
| 원/달러 | 원 | |
| DXY, VIX | 지수 | |
| WTI | $/bbl | |
| 천연가스 | $/MMBtu | 헨리허브 |
| 석탄·구리·철광석·니켈·곡물 | $/t | 곡물을 ¢/bu로 쓰려면 CONFIG의 unit만 바꾸면 됨 |
| 금·은 | $/oz | |
| 리튬 | CNY/t | 탄산리튬 |

단위는 표시용이라 자유롭게 바꿔도 됩니다. 변화 신호는 비율(%)로 계산하므로 단위와 무관합니다.

## 임계값·해설·체크리스트 수정

모두 `index.html` 스크립트 상단에 있습니다.

- `CONFIG.indicators[]` — 지표별 신호등 임계값
  - `level` (수준): `dir:'up'` 이면 값 ≥ warn → 노랑, ≥ danger → 빨강 / `dir:'down'` 이면 값 < warn → 노랑, < danger → 빨강
  - `change` (직전 대비): 금리류(`changeMode:'pp'`)는 %p 차이, 가격류(`'pct'`)는 변화율 %.
    `dir`: `up`(상승만 경고) / `down` / `both`. `flat` 미만은 "보합", `danger` 이상은 "급등·급락" 해설
  - 최종 신호등 = 수준 신호와 변화 신호 중 더 나쁜 쪽
- `CONFIG.staleDays` (기본 7), `CONFIG.staleBasis` (`'updated'` 입력/조회한 날 기준, `'date'` 기준일 기준)
- `COMMENTS` — 상태별 한 줄 해설 (surge / rise / flat / fall / plunge / high / warn)
- `CHECKLIST` — `test(S)` 조건이 참인 규칙을 priority 순으로 3~5개 표시. 부족하면 `default` 항목으로 채움

기본 임계값:

| 지표 | 수준 주의 / 경고 | 직전 대비 주의 / 경고 |
|---|---|---|
| 한국 기준금리 | ≥3.5 / ≥4.5 | ±0.25 / ±0.5%p |
| 미국 기준금리 | ≥4.0 / ≥5.0 | ±0.25 / ±0.5%p |
| 미국 10Y·2Y | ≥4.5 / ≥5.0 | ±0.15 / ±0.3%p |
| 장단기 금리차 | <0.25 / <0 (역전) | −0.15 / −0.3%p |
| 미국·한국 CPI | ≥3.0 / ≥4.0 | +0.3 / +0.6%p |
| 미국 실업률 | ≥4.5 / ≥5.5 | +0.2 / +0.4%p |
| 원/달러 | ≥1,400 / ≥1,450 | ±1 / ±2% |
| DXY | ≥105 / ≥110 | ±1 / ±2% |
| VIX | ≥20 / ≥30 | +15 / +30% |
| WTI | ≥90 / ≥100 | ±5 / ±10% |
| 천연가스 | — | ±8 / ±15% |
| 석탄·구리·은·철광석·곡물 | — | ±5 / ±10% |
| 금 | — | ±3 / ±6% |
| 니켈 | — | ±7 / ±15% |
| 리튬 | — | ±10 / ±20% |

해설·체크리스트 문구는 일반적인 해석만 담고, 특정 종목 추천이나 매수·매도 표현은 쓰지 않습니다. 문구를 바꿀 때도 이 원칙을 지켜 주세요.

## 2단계(선택): 자동 조회

### 구조

`data.js`의 **Provider**가 교체 지점입니다. 화면은 `DataStore` API만 쓰므로 소스를 바꿔도 화면 코드는 그대로입니다.

```js
// provider 인터페이스
{ id, label,
  isReady(),            // API 키 등 준비 여부
  supports(indicator),  // indicator.source[id] 가 있으면 true
  fetch(indicator)      // Promise<[{date, value}, ...]> 최신순 (2개면 직전 대비 계산)
}
```

지표에 `source: { fred: { series: 'DGS10' } }` 처럼 적으면 해당 provider가 조회합니다.
조회 결과는 직접 입력값과 같은 이력에 `source:'fred'` 로 저장됩니다.

### FRED (구현됨)

1. https://fred.stlouisfed.org/docs/api/api_key.html 에서 무료 API 키 발급
2. 대시보드 → 입력·설정 → **자동 조회**에 키 입력 → `지금 조회`
3. 키는 **그 기기 localStorage에만** 저장됩니다. 코드·저장소·백업 파일에는 들어가지 않습니다.
4. 키가 저장돼 있으면 메인 화면 상단에 새로고침 버튼이 생깁니다.

기본 연결된 시리즈:

| 지표 | FRED 시리즈 | 주기 |
|---|---|---|
| 미국 기준금리 | DFEDTARU (목표 상단) | 일 |
| 미국 10Y / 2Y | DGS10 / DGS2 | 일 |
| 미국 CPI | CPIAUCSL (units=pc1, 전년비) | 월 |
| 한국 CPI | KORCPIALLMINMEI (units=pc1) | 월 (OECD, 발표 지연 있음) |
| 미국 실업률 | UNRATE | 월 |
| 원/달러 | DEXKOUS | 일 |
| VIX | VIXCLS | 일 |
| WTI | DCOILWTICO | 일 |
| 천연가스 | DHHNGSP | 일 |

FRED에는 IMF 월간 원자재 가격(`PCOPPUSDM` 구리, `PNICKUSDM` 니켈, `PIORECRUSDM` 철광석, `PCOALAUUSDM` 호주 석탄,
`PWHEAMTUSDM` 밀, `PMAIZMTUSDM` 옥수수, `PSOYBUSDM` 대두 등, 모두 $/t)도 있습니다. 월간 값이라도 괜찮다면
해당 지표에 `source: { fred: { series: '...' } }` 를 추가하면 됩니다. 한국 기준금리·DXY·금·은·리튬은 직접 입력하거나
별도 소스(한국은행 ECOS API 등)를 provider로 추가하세요.

### CORS와 프록시

FRED 등 많은 API는 브라우저에서 직접 호출하면 CORS로 차단될 수 있습니다. 조회 로그에 "CORS/네트워크 문제"가 보이면
작은 프록시를 두고 설정의 **프록시 URL**에 입력하세요. `{url}` 이 있으면 원래 주소(인코딩)로 치환되고, 없으면 앞에 붙습니다.

Cloudflare Workers 예시 (무료 플랜으로 충분):

```js
export default {
  async fetch(req) {
    const target = new URL(req.url).searchParams.get('url');
    // 허용할 호스트만 열어 두기 (오픈 프록시 방지)
    if (!target || !target.startsWith('https://api.stlouisfed.org/')) {
      return new Response('forbidden', { status: 403 });
    }
    const res = await fetch(target);
    return new Response(res.body, {
      status: res.status,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
    });
  }
};
```

설정의 프록시 URL: `https://<워커이름>.<계정>.workers.dev/?url={url}`

주의: API 키가 요청 URL에 포함되어 프록시를 거칩니다. 본인이 만든 프록시만 쓰세요.

### 공개 시세 소스 추가하기

`data.js` 의 `MyQuoteProvider` 주석 예시를 참고해 provider를 만들고 `PROVIDERS` 배열에 추가한 뒤,
`CONFIG.indicators[].source` 에 `{ quote: { symbol: '...' } }` 같은 정보를 넣으면 됩니다.
무료 시세 API(예: Alpha Vantage 원자재 엔드포인트)는 키·호출 제한·이용 약관을 확인하세요.

## 로컬에서 열기

서비스 워커는 `file://` 에서 동작하지 않으므로 간단한 서버로 여세요.

```bash
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000
```

(`index.html` 을 직접 더블클릭해도 대시보드 자체는 동작합니다. PWA 설치·오프라인만 안 됩니다.)

## GitHub Pages 배포

1. 이 파일들을 GitHub 저장소에 push (저장소 루트에 `index.html` 이 있어야 함)
2. 저장소 **Settings → Pages**
3. **Build and deployment → Source: Deploy from a branch**
4. **Branch**: 배포할 브랜치(예: `main`) / 폴더 `/ (root)` 선택 → **Save**
5. 1~2분 뒤 `https://<사용자명>.github.io/<저장소명>/` 에서 열림 (Pages 화면 상단에 주소 표시)
6. 휴대폰에서 그 주소를 열고
   - **iPhone (Safari)**: 공유 버튼 → **홈 화면에 추가**
   - **Android (Chrome)**: 메뉴(⋮) → **앱 설치** 또는 **홈 화면에 추가**

모든 경로가 상대 경로(`./`)라서 `/<저장소명>/` 하위 경로에서도 그대로 동작합니다.

### 업데이트 배포 시

- 수정 후 push 하면 Pages가 자동 재배포됩니다.
- HTML은 네트워크 우선이라 바로 반영되지만, `data.js`·아이콘 등은 캐시 우선입니다.
  이런 파일을 바꿨다면 `sw.js` 의 `CACHE = 'macro-dash-v1'` 버전을 올려 주세요 (`v2` 등).
- 데이터는 localStorage에 있으므로 재배포해도 지워지지 않습니다. 단, 저장소 이름(=주소)을 바꾸면 다른 사이트로 취급되어 데이터가 보이지 않으니 먼저 JSON 내보내기를 해 두세요.

### 공개 저장소 주의

GitHub Pages는 (유료 플랜이 아니면) 공개 저장소에서 동작합니다. 코드에는 개인 데이터나 API 키가 들어가지 않으므로
공개해도 무방하지만, 백업 JSON 파일을 저장소에 커밋하지 않도록 주의하세요.
