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
  // 제조업 체감지수 (ISM PMI는 유료 → 연준 무료 지역 제조업 지수·전미활동지수로 대용)
  pmi_philly: [{ fred: 'GACDFSA066MSFRBPHI' }],    // 필라델피아 연준 제조업 현재 활동 (확산지수, 0 기준)
  pmi_empire: [{ fred: 'GACDINA066MSFRBNY' }],     // 뉴욕 연준 Empire State 제조업 (확산지수, 0 기준)
  pmi_dallas: [{ fred: 'BACTSAMFRBDAL' }],         // 댈러스 연준 텍사스 제조업 (확산지수, 0 기준)
  cfnai:      [{ fred: 'CFNAIMA3' }],              // 시카고 연준 전미활동지수 3개월 평균 (0 = 추세 성장)
  bci_us:     [{ fred: 'BSCICP03USM665S' }],       // OECD 기업신뢰지수 미국 (100 기준)
  bci_cn:     [{ fred: 'BSCICP03CNM665S' }],       // OECD 기업신뢰지수 중국 (100 기준)
  bci_kr:     [{ fred: 'BSCICP03KRM665S' }],       // OECD 기업신뢰지수 한국 (100 기준)

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
  ttf: [{ yahoo: 'TTF=F' }],                                 // 유럽 천연가스 TTF (€/MWh)
  coal:   [{ fred: 'PCOALAUUSDM' }],                       // IMF 호주(뉴캐슬) 석탄, 월간
  gasoline: [{ yahoo: 'RB=F' }, { fred: 'DGASNYH' }],       // RBOB 휘발유 선물 (실패 시 뉴욕항 현물)
  diesel:   [{ yahoo: 'HO=F' }, { fred: 'DDFUELNYH' }],     // 초저유황 디젤(ULSD) 선물 (실패 시 뉴욕항 현물)

  // ── 운임 ──
  bdry:        [{ yahoo: 'BDRY' }],                          // 벌크선 운임 선물 ETF (BDI 대용)
  freight_ppi: [{ fred: 'PCU483111483111', units: 'pc1' }],  // 미국 PPI 원양 화물운송, 전년비
  tanker_fro:  [{ yahoo: 'FRO' }],                           // Frontline — VLCC 원유선사 (VLCC 운임 대용)
  tanker_stng: [{ yahoo: 'STNG' }],                          // Scorpio Tankers — 석유제품선사
  lng_flng:    [{ yahoo: 'FLNG' }],                          // Flex LNG — LNG 운반선사 (LNG선 운임 대용)
  // scfi: 상하이 컨테이너 운임지수 — 무료 API 없음 → 직접 입력

  // ── 비축·재고 (EIA 주간, 천 배럴 → 백만 배럴) ──
  us_spr:      [{ eia: 'PET.WCSSTUS1.W', scale: 0.001 }],   // 미국 전략비축유(SPR)
  us_crude:    [{ eia: 'PET.WCESTUS1.W', scale: 0.001 }],   // 미국 상업 원유 재고 (SPR 제외)
  us_gasoline: [{ eia: 'PET.WGTSTUS1.W', scale: 0.001 }],   // 미국 휘발유 재고
  us_distill:  [{ eia: 'PET.WDISTUS1.W', scale: 0.001 }],   // 미국 디젤·난방유(중간유분) 재고
  // 미국 에너지 수급 (EIA, 주간)
  ng_storage:   [{ eia: 'NG.NW2_EPG0_SWO_R48_BCF.W' }],                   // 천연가스 저장량, 본토 48개 주 (Bcf)
  cushing:      [{ eia: 'PET.W_EPC0_SAX_YCUOK_MBBL.W', scale: 0.001 }],  // 쿠싱 원유 재고 (백만 배럴)
  refinery_util:[{ eia: 'PET.WPULEUS3.W' }],                              // 정제 가동률 (%)
  us_crude_prod:[{ eia: 'PET.WCRFPUS2.W', scale: 0.001 }],                // 원유 생산 (백만 배럴/일)
  gasoline_demand: [{ eia: 'PET.WGFUPUS2.W', scale: 0.001, avg: 4 }],     // 휘발유 제품 공급 = 수요, 4주 평균 (백만 배럴/일)
  distill_demand:  [{ eia: 'PET.WDIUPUS2.W', scale: 0.001, avg: 4 }],     // 디젤·난방유 수요, 4주 평균
  crude_net_imports: [{ eia: 'PET.WCRNTUS2.W', scale: 0.001 }],           // 원유 순수입 (백만 배럴/일)
  // 독일 비상 석유 비축 (월간, 수개월 지연). EU 합계는 데이터셋에 없어 독일을 대표로 사용
  // stk_flow STK_EUE_DIR = EU 지침에 따른 비상 비축 (일수 환산), unit NR = 일수
  eu_oil_stock: [{ eurostat: 'nrg_stk_oem', filters: { geo: 'DE' }, prefer: { stk_flow: /^STK_EUE_DIR$/, unit: /^NR$/ } }],

  // ── 매크로 ETF (Yahoo) ──
  etf_tlt: [{ yahoo: 'TLT' }],
  etf_tip: [{ yahoo: 'TIP' }],
  etf_hyg: [{ yahoo: 'HYG' }],
  etf_uup: [{ yahoo: 'UUP' }],
  etf_xle: [{ yahoo: 'XLE' }],
  etf_gld: [{ yahoo: 'GLD' }],
  etf_lit: [{ yahoo: 'LIT' }],
  etf_dbc: [{ yahoo: 'DBC' }],
  etf_dba: [{ yahoo: 'DBA' }],
  etf_bwet: [{ yahoo: 'BWET' }],
  etf_xli: [{ yahoo: 'XLI' }],
  etf_itb: [{ yahoo: 'ITB' }],
  etf_kre: [{ yahoo: 'KRE' }],
  etf_ewy: [{ yahoo: 'EWY' }],
  etf_eem: [{ yahoo: 'EEM' }],
  etf_ung: [{ yahoo: 'UNG' }],
  etf_coal: [{ yahoo: 'COAL' }],
  etf_ura: [{ yahoo: 'URA' }],
  etf_copx: [{ yahoo: 'COPX' }],
  etf_pick: [{ yahoo: 'PICK' }],
  etf_remx: [{ yahoo: 'REMX' }],

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
