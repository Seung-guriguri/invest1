# 지표 카탈로그

> 자동 생성 문서입니다. 직접 고치지 말고 `node scripts/catalog.mjs` 로 다시 만드세요.
> 원본: `index.html` CONFIG · `scripts/sources.mjs` · `scripts/fetch-data.mjs`(계산 지표)

성격: **실측**(기관·시장이 직접 발표한 값) · **계산**(다른 지표로 계산) · **대용**(직접 지표가 없어 주가·ETF 등으로 대신 봄) · **직접 입력**(자동 소스 없음)

## 금리 (16)

| ID | 이름 | 단위 | 성격 | 출처 (1순위 → 대체) | 변화 판단 |
|---|---|---|---|---|---|
| `kr_base` | 한국 기준금리 | % | 실측 | 한국은행 722Y001/0101000 → 한국은행 722Y001/0101000 | pp |
| `kr3y` | 한국 국고채 3년 | % | 실측 | 한국은행 817Y002/010200000 | pp |
| `kr10y` | 한국 국고채 10년 | % | 실측 | 한국은행 817Y002/010210000 → FRED IRLTLT01KRM156N | pp |
| `us_ffr` | 미국 기준금리 | % | 실측 | FRED DFEDTARU | pp |
| `us3m` | 미국 3개월물 금리 | % | 실측 | FRED DGS3MO | pp |
| `us2y` | 미국 2년물 금리 | % | 실측 | FRED DGS2 | pp |
| `us10y` | 미국 10년물 금리 | % | 실측 | FRED DGS10 | pp |
| `us30y` | 미국 30년물 금리 | % | 실측 | FRED DGS30 | pp |
| `spread` | 장단기 금리차 | %p | 실측 | FRED T10Y2Y (없으면 계산: us10y − us2y) | pp |
| `spread3m` | 장단기 금리차 | %p | 실측 | FRED T10Y3M (없으면 계산: us10y − us3m) | pp |
| `real10y` | 미국 10년 실질금리 | % | 실측 | FRED DFII10 | pp |
| `bei10y` | 미국 10년 기대인플레이션 | % | 실측 | FRED T10YIE | pp |
| `mortgage` | 미국 30년 모기지 금리 | % | 실측 | FRED MORTGAGE30US | pp |
| `kr_us_base` | 한미 기준금리차 | %p | 계산 | 계산: 한국−미국 기준금리 | pp |
| `kr_us_10y` | 한미 10년 금리차 | %p | 계산 | 계산: 한국−미국 10년 | pp |
| `us_real_policy` | 미국 실질 정책금리 | % | 계산 | 계산: FFR−근원PCE | pp |

## 물가 (5)

| ID | 이름 | 단위 | 성격 | 출처 (1순위 → 대체) | 변화 판단 |
|---|---|---|---|---|---|
| `us_cpi` | 미국 CPI 상승률 | % | 실측 | FRED CPIAUCSL | pp |
| `us_core_cpi` | 미국 근원 CPI | % | 실측 | FRED CPILFESL | pp |
| `us_core_pce` | 미국 근원 PCE | % | 실측 | FRED PCEPILFE | pp |
| `us_ppi` | 미국 PPI | % | 실측 | FRED PPIFIS | pp |
| `kr_cpi` | 한국 CPI 상승률 | % | 실측 | 한국은행 901Y009/0 → FRED KORCPIALLMINMEI | pp |

## 경기 (12)

| ID | 이름 | 단위 | 성격 | 출처 (1순위 → 대체) | 변화 판단 |
|---|---|---|---|---|---|
| `us_unemp` | 미국 실업률 | % | 실측 | FRED UNRATE | pp |
| `sahm` | 삼의 법칙 지표 | %p | 실측 | FRED SAHMREALTIME | pp |
| `payems` | 미국 비농업 고용 증감 | 천명 | 실측 | FRED PAYEMS | abs |
| `claims` | 미국 신규 실업수당 청구 | 건 | 실측 | FRED ICSA | pct |
| `indpro` | 미국 산업생산 | % | 실측 | FRED INDPRO | pp |
| `retail` | 미국 소매판매 | % | 실측 | FRED RSAFS | pp |
| `umcsent` | 미시간 소비자심리지수 |  | 실측 | FRED UMCSENT | abs |
| `pmi_philly` | 필라델피아 연은 제조업지수 |  | 실측 | FRED GACDFSA066MSFRBPHI | abs |
| `pmi_empire` | 뉴욕 연은 제조업지수 |  | 실측 | FRED GACDISA066MSFRBNY → FRED GACDINA066MNFRBNY | abs |
| `pmi_dallas` | 댈러스 연은 제조업지수 |  | 실측 | FRED BACTSAMFRBDAL | abs |
| `cfnai` | 시카고 연은 전미활동지수 |  | 실측 | FRED CFNAIMA3 | abs |
| `gdp` | 미국 실질 GDP 성장률 | % | 실측 | FRED A191RL1Q225SBEA | pp |

## 시장·신용 (10)

| ID | 이름 | 단위 | 성격 | 출처 (1순위 → 대체) | 변화 판단 |
|---|---|---|---|---|---|
| `sp500` | S&P 500 |  | 실측 | Yahoo ^GSPC → FRED SP500 | pct |
| `nasdaq` | 나스닥 종합 |  | 실측 | Yahoo ^IXIC → FRED NASDAQCOM | pct |
| `kospi` | 코스피 |  | 실측 | Yahoo ^KS11 | pct |
| `hy_spread` | 하이일드 스프레드 | %p | 실측 | FRED BAMLH0A0HYM2 | pp |
| `ig_spread` | 투자등급 스프레드 | %p | 실측 | FRED BAMLC0A0CM | pp |
| `hy_ig` | 저신용 추가 웃돈 | %p | 계산 | 계산: HY−IG | pp |
| `nfci` | 금융여건지수 |  | 실측 | FRED NFCI | abs |
| `stlfsi` | 금융스트레스지수 |  | 실측 | FRED STLFSI4 | abs |
| `fed_bs` | 연준 총자산 | 조$ | 실측 | FRED WALCL | pct |
| `m2` | 미국 M2 증가율 | % | 실측 | FRED M2SL | pp |

## 환율 (6)

| ID | 이름 | 단위 | 성격 | 출처 (1순위 → 대체) | 변화 판단 |
|---|---|---|---|---|---|
| `usdkrw` | 원/달러 환율 | 원 | 실측 | Yahoo KRW=X → FRED DEXKOUS | pct |
| `dxy` | 달러인덱스 |  | 실측 | Yahoo DX-Y.NYB | pct |
| `usdjpy` | 엔/달러 환율 | 엔 | 실측 | Yahoo JPY=X → FRED DEXJPUS | pct |
| `eurusd` | 유로/달러 환율 | $ | 실측 | Yahoo EURUSD=X → FRED DEXUSEU | pct |
| `usdcny` | 위안/달러 환율 | 위안 | 실측 | Yahoo CNY=X → FRED DEXCHUS | pct |
| `vix` | VIX |  | 실측 | Yahoo ^VIX → FRED VIXCLS | pct |

## 에너지 (13)

| ID | 이름 | 단위 | 성격 | 출처 (1순위 → 대체) | 변화 판단 |
|---|---|---|---|---|---|
| `wti` | WTI 원유 | $/bbl | 실측 | Yahoo CL=F → FRED DCOILWTICO | pct |
| `brent` | 브렌트유 | $/bbl | 실측 | Yahoo BZ=F → FRED DCOILBRENTEU | pct |
| `brent_krw` | 원화 환산 브렌트 | 원/bbl | 계산 | 계산: 브렌트×원/달러 | pct |
| `brent_wti` | 브렌트−WTI 가격차 | $/bbl | 계산 | 계산: 브렌트−WTI | abs |
| `natgas` | 천연가스 | $/MMBtu | 실측 | Yahoo NG=F → FRED DHHNGSP | pct |
| `ttf` | 유럽 천연가스 (TTF) | €/MWh | 실측 | Yahoo TTF=F | pct |
| `jkm` | 아시아 LNG (JKM) | $/MMBtu | 실측 | Yahoo JKM=F | pct |
| `coal` | 석탄 | $/t | 실측 | FRED PCOALAUUSDM | pct |
| `coal_jkm` | 석탄÷가스 상대가격 | 배 | 계산 | 계산: 뉴캐슬석탄÷JKM | pct |
| `coking_amr` | 원료탄 (AMR) | $ | 실측 | Yahoo AMR | pct |
| `gasoline` | 휘발유 | $/gal | 실측 | Yahoo RB=F → FRED DGASNYH | pct |
| `diesel` | 디젤 | $/gal | 실측 | Yahoo HO=F → FRED DDFUELNYH | pct |
| `crack321` | 3-2-1 크랙 스프레드 | $/bbl | 계산 | 계산: 2RB+HO−3CL | abs |

## 전력 (13)

| ID | 이름 | 단위 | 성격 | 출처 (1순위 → 대체) | 변화 판단 |
|---|---|---|---|---|---|
| `power_gas` | 미국 가스 발전 비중 | % | 실측 | EIA-930 NG | pp |
| `power_coal` | 미국 석탄 발전 비중 | % | 실측 | EIA-930 COL | pp |
| `nuclear_util` | 미국 원전 가동률 | % | 실측 | NRC 원자로 출력 | pp |
| `us_coal_cons` | 미국 석탄 소비량 | 백만 t | 실측 | EIA TOTAL.CLTCPUS.M | pct · 전년 동월 대비 |
| `coal_pw_jpn` | 일본 석탄 발전 비중 | % | 실측 | Ember JPN/Coal | pp · 전년 동월 대비 |
| `coal_pw_chn` | 중국 석탄 발전 비중 | % | 실측 | Ember CHN/Coal | pp · 전년 동월 대비 |
| `coal_pw_kor` | 한국 석탄 발전 비중 | % | 실측 | Ember KOR/Coal | pp · 전년 동월 대비 |
| `coal_pw_ind` | 인도 석탄 발전 비중 | % | 실측 | Ember IND/Coal | pp · 전년 동월 대비 |
| `coal_pw_twn` | 대만 석탄 발전 비중 | % | 실측 | Ember TWN/Coal | pp · 전년 동월 대비 |
| `gas_pw_jpn` | 일본 가스 발전 비중 | % | 실측 | Ember JPN/Gas | pp · 전년 동월 대비 |
| `gas_pw_kor` | 한국 가스 발전 비중 | % | 실측 | Ember KOR/Gas | pp · 전년 동월 대비 |
| `gas_pw_chn` | 중국 가스 발전 비중 | % | 실측 | Ember CHN/Gas | pp · 전년 동월 대비 |
| `gas_pw_eu` | EU 가스 발전 비중 | % | 실측 | Ember EU/Gas | pp · 전년 동월 대비 |

## 운임 (7)

| ID | 이름 | 단위 | 성격 | 출처 (1순위 → 대체) | 변화 판단 |
|---|---|---|---|---|---|
| `bdry` | 벌크선 운임 | $ | 실측 | Yahoo BDRY | pct |
| `scfi` | 컨테이너 운임 SCFI |  | 직접 입력 | — | pct |
| `freight_ppi` | 미국 원양 화물운송 PPI | % | 실측 | FRED PCU483111483111 | pp |
| `tanker_fro` | VLCC 원유선 (FRO) | $ | 실측 | Yahoo FRO | pct |
| `tanker_stng` | 석유제품선 (STNG) | $ | 실측 | Yahoo STNG | pct |
| `lng_flng` | LNG선 (FLNG) | $ | 실측 | Yahoo FLNG | pct |
| `lng_spread` | LNG 수출 마진 (TTF−헨리허브) | $/MMBtu | 계산 | 계산: TTF−HH | abs |

## 비축·재고 (13)

| ID | 이름 | 단위 | 성격 | 출처 (1순위 → 대체) | 변화 판단 |
|---|---|---|---|---|---|
| `us_spr` | 미국 전략비축유(SPR) | 백만 bbl | 실측 | EIA PET.WCSSTUS1.W | pct |
| `us_crude` | 미국 상업 원유 재고 | 백만 bbl | 실측 | EIA PET.WCESTUS1.W | pct |
| `us_crude_total` | 미국 원유 총재고 | 백만 bbl | 계산 | 계산: 상업+SPR | pct |
| `us_gasoline` | 미국 휘발유 재고 | 백만 bbl | 실측 | EIA PET.WGTSTUS1.W | pct |
| `us_distill` | 미국 디젤·난방유 재고 | 백만 bbl | 실측 | EIA PET.WDISTUS1.W | pct |
| `ng_storage` | 미국 천연가스 저장량 | Bcf | 실측 | EIA NG.NW2_EPG0_SWO_R48_BCF.W | pct |
| `cushing` | 쿠싱 원유 재고 | 백만 bbl | 실측 | EIA PET.W_EPC0_SAX_YCUOK_MBBL.W | pct |
| `refinery_util` | 미국 정제 가동률 | % | 실측 | EIA PET.WPULEUS3.W | pp |
| `us_crude_prod` | 미국 원유 생산 | 백만 b/d | 실측 | EIA PET.WCRFPUS2.W | pct |
| `gasoline_demand` | 미국 휘발유 수요 | 백만 b/d | 실측 | EIA PET.WGFUPUS2.W | pct |
| `distill_demand` | 미국 디젤·난방유 수요 | 백만 b/d | 실측 | EIA PET.WDIUPUS2.W | pct |
| `crude_net_imports` | 미국 원유 순수입 | 백만 b/d | 실측 | EIA PET.WCRNTUS2.W | abs |
| `eu_oil_stock` | 독일 비상 석유 비축 | 일 | 실측 | Eurostat nrg_stk_oem | pct |

## 금속 (8)

| ID | 이름 | 단위 | 성격 | 출처 (1순위 → 대체) | 변화 판단 |
|---|---|---|---|---|---|
| `copper` | 구리 | $/t | 실측 | Yahoo HG=F → FRED PCOPPUSDM | pct |
| `gold` | 금 | $/oz | 실측 | Yahoo GC=F | pct |
| `silver` | 은 | $/oz | 실측 | Yahoo SI=F | pct |
| `gold_silver` | 금/은 비율 | 배 | 계산 | 계산: 금÷은 | pct |
| `aluminum` | 알루미늄 | $/t | 실측 | Yahoo ALI=F → FRED PALUMUSDM | pct |
| `iron_ore` | 철광석 | $/t | 실측 | Yahoo TIO=F → FRED PIORECRUSDM | pct |
| `lithium` | 리튬 | CNY/t | 직접 입력 | — | pct |
| `nickel` | 니켈 | $/t | 실측 | FRED PNICKUSDM | pct |

## 곡물 (3)

| ID | 이름 | 단위 | 성격 | 출처 (1순위 → 대체) | 변화 판단 |
|---|---|---|---|---|---|
| `wheat` | 밀 | $/t | 실측 | Yahoo ZW=F → FRED PWHEAMTUSDM | pct |
| `corn` | 옥수수 | $/t | 실측 | Yahoo ZC=F → FRED PMAIZMTUSDM | pct |
| `soybean` | 대두 | $/t | 실측 | Yahoo ZS=F → FRED PSOYBUSDM | pct |

## 비료 (6)

| ID | 이름 | 단위 | 성격 | 출처 (1순위 → 대체) | 변화 판단 |
|---|---|---|---|---|---|
| `fert_urea` | 요소 | $/t | 실측 | World Bank 월간 가격표 Urea | pct |
| `fert_dap` | DAP (인산이암모늄) | $/t | 실측 | World Bank 월간 가격표 DAP | pct |
| `fert_potash` | 염화칼륨 (칼륨 비료) | $/t | 실측 | World Bank 월간 가격표 Potassium chloride | pct |
| `fert_phosrock` | 인광석 | $/t | 실측 | World Bank 월간 가격표 Phosphate rock | pct |
| `fert_mos` | 인산·칼륨 비료 (MOS) | $ | 실측 | Yahoo MOS | pct |
| `fert_cf` | 질소 비료 (CF) | $ | 실측 | Yahoo CF | pct |

## ETF (21)

| ID | 이름 | 단위 | 성격 | 출처 (1순위 → 대체) | 변화 판단 |
|---|---|---|---|---|---|
| `etf_tlt` | TLT | $ | 실측 | Yahoo TLT | pct |
| `etf_tip` | TIP | $ | 실측 | Yahoo TIP | pct |
| `etf_hyg` | HYG | $ | 실측 | Yahoo HYG | pct |
| `etf_uup` | UUP | $ | 실측 | Yahoo UUP | pct |
| `etf_xle` | XLE | $ | 실측 | Yahoo XLE | pct |
| `etf_ung` | UNG | $ | 실측 | Yahoo UNG | pct |
| `etf_coal` | COAL | $ | 실측 | Yahoo COAL | pct |
| `etf_ura` | URA | $ | 실측 | Yahoo URA | pct |
| `etf_gld` | GLD | $ | 실측 | Yahoo GLD | pct |
| `etf_lit` | LIT | $ | 실측 | Yahoo LIT | pct |
| `etf_copx` | COPX | $ | 실측 | Yahoo COPX | pct |
| `etf_pick` | PICK | $ | 실측 | Yahoo PICK | pct |
| `etf_remx` | REMX | $ | 실측 | Yahoo REMX | pct |
| `etf_dbc` | DBC | $ | 실측 | Yahoo DBC | pct |
| `etf_dba` | DBA | $ | 실측 | Yahoo DBA | pct |
| `etf_bwet` | BWET | $ | 실측 | Yahoo BWET | pct |
| `etf_xli` | XLI | $ | 실측 | Yahoo XLI | pct |
| `etf_itb` | ITB | $ | 실측 | Yahoo ITB | pct |
| `etf_kre` | KRE | $ | 실측 | Yahoo KRE | pct |
| `etf_ewy` | EWY | $ | 실측 | Yahoo EWY | pct |
| `etf_eem` | EEM | $ | 실측 | Yahoo EEM | pct |

## 가이드 전용 시세 (40)

카드로 보이지 않고 가이드(유조선·벌크선·석유 밸류체인)의 미니 시세와 관심 종목 후보에만 쓰는 주가입니다.

`aux_jkm_m` (Yahoo JKM=F) · `tk_dht` (Yahoo DHT) · `tk_tnk` (Yahoo TNK) · `tk_nat` (Yahoo NAT) · `tk_eco` (Yahoo ECO) · `tk_hafn` (Yahoo HAFN) · `tk_trmd` (Yahoo TRMD) · `tk_insw` (Yahoo INSW) · `gd_sblk` (Yahoo SBLK) · `gd_gnk` (Yahoo GNK) · `gd_sb` (Yahoo SB) · `gd_ship` (Yahoo SHIP) · `gd_dsx` (Yahoo DSX) · `gd_panl` (Yahoo PANL) · `gd_xop` (Yahoo XOP) · `gd_cop` (Yahoo COP) · `gd_eog` (Yahoo EOG) · `gd_oxy` (Yahoo OXY) · `gd_rig` (Yahoo RIG) · `gd_val` (Yahoo VAL) · `gd_ne` (Yahoo NE) · `gd_sdrl` (Yahoo SDRL) · `gd_borr` (Yahoo BORR) · `gd_fti` (Yahoo FTI) · `gd_tdw` (Yahoo TDW) · `gd_oih` (Yahoo OIH) · `gd_slb` (Yahoo SLB) · `gd_hal` (Yahoo HAL) · `gd_bkr` (Yahoo BKR) · `gd_amlp` (Yahoo AMLP) · `gd_epd` (Yahoo EPD) · `gd_et` (Yahoo ET) · `gd_kmi` (Yahoo KMI) · `gd_wmb` (Yahoo WMB) · `gd_crak` (Yahoo CRAK) · `gd_vlo` (Yahoo VLO) · `gd_mpc` (Yahoo MPC) · `gd_psx` (Yahoo PSX) · `gd_xom` (Yahoo XOM) · `gd_cvx` (Yahoo CVX)
