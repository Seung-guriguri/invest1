/* =====================================================================
 * 지표별 자동 수집 소스 — GitHub Actions(scripts/fetch-data.mjs)가 사용
 *
 * 각 지표는 소스 배열을 위에서부터 시도하고, 처음 성공한 소스의 시계열 전체를 씁니다.
 * (한 시계열 안에서 소스를 섞지 않으므로 단위가 달라도 차트가 튀지 않음)
 *
 *   { fred:  'DGS10', units: 'pc1'(선택: 전년비 %), scale: 1(선택: 곱할 값) }
 *   { yahoo: 'CL=F',  scale: 1 }                         — 비공식 Yahoo Finance 차트 API
 *   { ecos:  '722Y001', item: '0101000', cycle: 'D'|'M', transform: 'yoy'(선택) } — 한국은행 ECOS
 *
 * 화면 표시 단위는 index.html CONFIG 의 unit 이고, 여기 scale 로 그 단위에 맞춰 환산합니다.
 * 지표 ID는 index.html CONFIG.indicators 의 id 와 같아야 합니다.
 * ===================================================================== */

// 단위 환산 상수
const LB_PER_T = 2204.62262;          // $/lb → $/t
const WHEAT_SOY = 36.7437 / 100;      // ¢/bu → $/t (밀·대두 1부셸 = 27.2155kg)
const CORN = 39.3683 / 100;           // ¢/bu → $/t (옥수수 1부셸 = 25.4012kg)

export const SOURCES = {
  // ── 금리 ──
  kr_base:   [{ ecos: '722Y001', item: '0101000', cycle: 'D' }, { ecos: '722Y001', item: '0101000', cycle: 'M' }],
  kr3y:      [{ ecos: '817Y002', item: '010200000', cycle: 'D' }],
  kr10y:     [{ ecos: '817Y002', item: '010210000', cycle: 'D' }, { fred: 'IRLTLT01KRM156N' }],
  us_ffr:    [{ fred: 'DFEDTARU' }],
  us3m:      [{ fred: 'DGS3MO' }],
  us2y:      [{ fred: 'DGS2' }],
  us10y:     [{ fred: 'DGS10' }],
  us30y:     [{ fred: 'DGS30' }],
  spread:    [{ fred: 'T10Y2Y' }],
  spread3m:  [{ fred: 'T10Y3M' }],
  real10y:   [{ fred: 'DFII10' }],
  bei10y:    [{ fred: 'T10YIE' }],
  mortgage:  [{ fred: 'MORTGAGE30US' }],

  // ── 물가 ──
  us_cpi:      [{ fred: 'CPIAUCSL', units: 'pc1' }],
  us_core_cpi: [{ fred: 'CPILFESL', units: 'pc1' }],
  us_core_pce: [{ fred: 'PCEPILFE', units: 'pc1' }],
  us_ppi:      [{ fred: 'PPIFIS', units: 'pc1' }],
  kr_cpi:      [{ ecos: '901Y009', item: '0', cycle: 'M', transform: 'yoy' }, { fred: 'KORCPIALLMINMEI', units: 'pc1' }],

  // ── 경기·고용 ──
  us_unemp: [{ fred: 'UNRATE' }],
  sahm:     [{ fred: 'SAHMREALTIME' }],
  payems:   [{ fred: 'PAYEMS', units: 'chg' }],
  claims:   [{ fred: 'ICSA' }],
  indpro:   [{ fred: 'INDPRO', units: 'pc1' }],
  retail:   [{ fred: 'RSAFS', units: 'pc1' }],
  umcsent:  [{ fred: 'UMCSENT' }],
  gdp:      [{ fred: 'A191RL1Q225SBEA' }],

  // ── 시장·신용 ──
  sp500:     [{ yahoo: '^GSPC' }, { fred: 'SP500' }],
  nasdaq:    [{ yahoo: '^IXIC' }, { fred: 'NASDAQCOM' }],
  kospi:     [{ yahoo: '^KS11' }],
  hy_spread: [{ fred: 'BAMLH0A0HYM2' }],
  ig_spread: [{ fred: 'BAMLC0A0CM' }],
  nfci:      [{ fred: 'NFCI' }],
  stlfsi:    [{ fred: 'STLFSI4' }],
  fed_bs:    [{ fred: 'WALCL', scale: 1e-6 }],          // 백만$ → 조$
  m2:        [{ fred: 'M2SL', units: 'pc1' }],

  // ── 환율·변동성 ──
  usdkrw: [{ yahoo: 'KRW=X' }, { fred: 'DEXKOUS' }],
  dxy:    [{ yahoo: 'DX-Y.NYB' }],
  usdjpy: [{ yahoo: 'JPY=X' }, { fred: 'DEXJPUS' }],
  eurusd: [{ yahoo: 'EURUSD=X' }, { fred: 'DEXUSEU' }],
  usdcny: [{ yahoo: 'CNY=X' }, { fred: 'DEXCHUS' }],
  vix:    [{ yahoo: '^VIX' }, { fred: 'VIXCLS' }],

  // ── 에너지 ──
  wti:    [{ yahoo: 'CL=F' }, { fred: 'DCOILWTICO' }],
  brent:  [{ yahoo: 'BZ=F' }, { fred: 'DCOILBRENTEU' }],
  natgas: [{ yahoo: 'NG=F' }, { fred: 'DHHNGSP' }],
  coal:   [{ fred: 'PCOALAUUSDM' }],                       // IMF 호주(뉴캐슬) 석탄, 월간

  // ── 금속·광물 ──
  copper:   [{ yahoo: 'HG=F', scale: LB_PER_T }, { fred: 'PCOPPUSDM' }],
  gold:     [{ yahoo: 'GC=F' }],
  silver:   [{ yahoo: 'SI=F' }],
  aluminum: [{ yahoo: 'ALI=F' }, { fred: 'PALUMUSDM' }],
  iron_ore: [{ yahoo: 'TIO=F' }, { fred: 'PIORECRUSDM' }],
  nickel:   [{ fred: 'PNICKUSDM' }],                       // IMF 월간
  // lithium: 무료 공개 소스 없음 → 직접 입력

  // ── 곡물 (선물 ¢/bu → $/t 환산, 실패 시 IMF 월간 $/t) ──
  wheat:   [{ yahoo: 'ZW=F', scale: WHEAT_SOY }, { fred: 'PWHEAMTUSDM' }],
  corn:    [{ yahoo: 'ZC=F', scale: CORN }, { fred: 'PMAIZMTUSDM' }],
  soybean: [{ yahoo: 'ZS=F', scale: WHEAT_SOY }, { fred: 'PSOYBUSDM' }]
};
