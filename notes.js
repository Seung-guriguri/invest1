/* =====================================================================
 * notes.js — 지표별 인사이트 문구 (규칙 기반)
 *
 * 지표 상세 화면의 "인사이트" 4단 구성에 쓰입니다.
 *   what   : 무엇인가 (한 줄)
 *   states : 상태별 의미 — surge(급등) rise(상승) fall(하락) plunge(급락)
 *            high(최근 분포 상단·평년보다 많음) low(하단·평년보다 적음) flat(보합)
 *            없는 상태는 비슷한 상태로 대체 (surge→rise, plunge→fall, high/low→flat)
 *   pairs  : 함께 보면 — [{ when: S => 조건, text: 문자열 또는 S => 문자열 }]
 *            조건이 참인 것만 최대 3개 표시. S 도우미는 index.html CHECKLIST 설명 참고
 *            (S.up/down/surge/plunge, S.v 값, S.pos 분포 위치 0~100, S.season 평년 대비 %, S.m1t 1개월 변화)
 *   watch  : 확인할 것 (발표 일정·변수)
 *
 * 일반적인 해석만 쓰고, 종목 추천이나 매수·매도 표현은 쓰지 않습니다.
 * 나중에 AI 해설을 붙일 때는 states 부분을 AI 문장으로 바꾸면 됩니다.
 * ===================================================================== */
(function (global) {
  'use strict';

  const month = () => new Date().getMonth() + 1;
  const winter = () => [11, 12, 1, 2, 3].includes(month());
  const pct = v => (v > 0 ? '+' : '') + v.toFixed(1) + '%';

  /* 곡물 공통 */
  const grainPairs = [
    { when: S => S.up('dxy'), text: '달러 강세 → 미국산 곡물 수출 경쟁력 약화, 국제 가격엔 하방 요인' },
    { when: S => S.up('usdkrw'), text: '원화 약세 겹침 → 원화 기준 수입 곡물 가격은 더 오름' },
    { when: S => S.up('natgas'), text: '천연가스 상승 → 질소비료 원가 상승, 다음 시즌 재배 비용 부담' },
    { when: S => S.up('bdry'), text: '벌크선 운임도 상승 → 수입 곡물의 운송비 추가 부담' },
    { when: () => [6, 7, 8].includes(month()), text: '북반구 생육기(6~8월) — 기상 뉴스에 가격이 민감한 시기' }
  ];

  global.NOTES = {
    /* ───────── 에너지 ───────── */
    wti: {
      what: '미국 원유 기준가격 — 휘발유·디젤·항공유 원가와 물가 기대에 직결',
      states: {
        surge: '단기 급등은 공급 차질(산유국·지정학)이나 재고 급감이 원인인 경우가 많음 — 물가·운송비로 빠르게 전가',
        rise: '유가 상승은 1~2개월 시차로 휘발유·디젤 가격과 소비자물가를 밀어 올림',
        fall: '원가 부담은 줄지만, 수요 둔화가 원인이면 경기 둔화 신호로도 읽힘',
        plunge: '급락은 수요 충격이나 산유국 증산 신호인 경우가 많음 — 에너지 기업 실적·신용에 부담',
        high: '최근 수년 중 높은 가격대 — 소비 여력 위축과 물가 재가속 위험',
        low: '낮은 가격대 — 소비자엔 우호적이지만 생산 투자 위축으로 이어질 수 있음',
        flat: '방향성 없는 횡보 — 재고 발표·산유국 회의 전후 변동에 주의'
      },
      pairs: [
        { when: S => S.down('cushing') || S.pos('cushing') <= 15, text: '쿠싱 재고 감소·낮은 수준 → WTI 근월물 수급이 빠듯, 가격 지지 요인' },
        { when: S => S.up('cushing'), text: '쿠싱 재고 증가 → 단기 수급 완화' },
        { when: S => S.up('dxy') && S.up('wti'), text: '달러 강세에도 유가 상승 → 수요보다 공급 요인일 가능성' },
        { when: S => S.up('us_crude_prod'), text: '미국 원유 생산 증가 중 → 상승폭을 제한하는 요인' },
        { when: S => S.has('brent') && S.has('wti') && S.v('brent') - S.v('wti') >= 8, text: S => `브렌트-WTI 차이 ${(S.v('brent') - S.v('wti')).toFixed(1)}달러 → 국제 수급이 미국보다 빠듯` }
      ],
      watch: '매주 수요일 EIA 재고 · OPEC+ 회의 · 중동 정세 · 미국 원유 생산'
    },
    brent: {
      what: '국제 원유 기준가격(북해) — 한국 등 아시아 수입 원유 가격 흐름과 밀접',
      states: {
        surge: '급등은 중동·러시아 공급 차질이나 해상 운송 위험이 원인인 경우가 많음 — 수입국 물가에 직접 충격',
        rise: '수입 원유 비용 상승 → 무역수지와 국내 물가 부담 (원화 약세와 겹치면 더 커짐)',
        fall: '수입 원가 부담 완화 — 수요 둔화 반영 여부는 함께 확인',
        plunge: '급락은 세계 수요 충격 또는 산유국 공급 확대 신호',
        high: '높은 가격대 — 원유 수입국 경기·물가에 부담',
        low: '낮은 가격대 — 수입국엔 교역 조건 개선 요인',
        flat: '횡보 — 산유국 정책·지정학 뉴스가 변수'
      },
      pairs: [
        { when: S => S.up('usdkrw') && S.up('brent'), text: '원화 약세와 유가 상승이 겹침 → 원화 기준 원유 도입 비용 이중 부담' },
        { when: S => S.up('etf_bwet'), text: '유조선 운임도 상승 → 도입 비용 추가 부담' },
        { when: S => S.has('brent') && S.has('wti') && S.v('brent') - S.v('wti') >= 8, text: S => `브렌트-WTI 차이 ${(S.v('brent') - S.v('wti')).toFixed(1)}달러로 넓음 → 미국 밖 수급이 더 빠듯` },
        { when: S => S.down('usdkrw') && S.up('brent'), text: '원화 강세가 유가 상승을 일부 상쇄' }
      ],
      watch: 'OPEC+ 회의 · 중동·러시아 공급 뉴스 · 원/달러 환율'
    },
    natgas: {
      what: '미국 천연가스(헨리허브) — 난방·발전 연료이자 비료·화학 원료',
      states: {
        surge: '한파·LNG 수출 증가·저장량 부족이 겹치면 급등 — 변동성이 매우 큰 품목',
        rise: '전력·난방비와 비료·화학 원가 상승 요인',
        fall: '따뜻한 날씨나 저장량 여유를 반영하는 경우가 많음',
        plunge: '급락은 온화한 날씨·생산 증가 반영 — 가스 생산 기업 수익성 부담',
        high: '높은 가격대 — 전력 요금·비료 가격 상승으로 이어질 수 있음',
        low: '낮은 가격대가 오래가면 생산 감소로 이어져 이후 반등 요인이 됨',
        flat: '횡보 — 기상 전망과 주간 저장량 발표가 변수'
      },
      pairs: [
        { when: S => S.season('ng_storage') <= -5, text: S => `저장량 평년 대비 ${pct(S.season('ng_storage'))} → 가격 상승 압력` },
        { when: S => S.season('ng_storage') >= 5, text: S => `저장량 평년 대비 ${pct(S.season('ng_storage'))} → 상승 제한 요인` },
        { when: () => winter(), text: '난방 수요 시즌(11~3월) — 기온 전망에 특히 민감' },
        { when: S => S.up('coal'), text: '석탄도 상승 → 발전 연료 전반의 비용 압력' }
      ],
      watch: '매주 목요일 EIA 가스 저장량 · 기상 전망 · LNG 수출'
    },
    coal: {
      what: '호주 뉴캐슬 발전용 석탄(IMF 월간) — 아시아 발전 원가의 기준',
      states: {
        surge: '급등은 공급 차질(호주·인도네시아 기상·수출 제한)이나 가스 대체 수요 증가 때 나타남',
        rise: '아시아 발전 원가·전력 요금 상승 압력 — 가스 가격과 함께 움직이는 경우가 많음',
        fall: '발전 원가 부담 완화',
        high: '높은 가격대 — 전력 요금과 철강(제철용 석탄) 원가 부담',
        low: '낮은 가격대 — 발전 원가 안정',
        flat: '큰 변화 없음'
      },
      pairs: [
        { when: S => S.up('natgas') && S.up('coal'), text: '가스·석탄 동반 상승 → 발전 연료 전반의 비용 압력' },
        { when: S => S.down('natgas') && S.up('coal'), text: '가스 약세 속 석탄 강세 → 석탄 자체 공급 요인 점검' },
        { when: S => S.up('iron_ore'), text: '철광석도 상승 → 중국 철강 생산 확대와 연관 가능성' }
      ],
      watch: '월간 발표(1~2개월 지연) · 중국·인도 전력 수요 · 호주 기상'
    },
    gasoline: {
      what: 'RBOB 휘발유 선물 — 미국 소비자 휘발유 가격과 체감 물가의 선행지표',
      states: {
        surge: '정제 차질이나 수요기 재고 부족 때 급등 — 기대인플레이션을 빠르게 자극',
        rise: '휘발유 상승은 기대인플레이션과 소비 심리에 가장 빨리 영향',
        fall: '체감 물가 부담 완화 — 소비 여력 개선 요인',
        plunge: '급락은 수요 둔화나 원유 급락 반영',
        high: '높은 가격대 — 가계 소비 여력 위축',
        low: '낮은 가격대 — 소비 심리에 우호적',
        flat: '큰 변화 없음'
      },
      pairs: [
        { when: S => S.season('us_gasoline') <= -5, text: S => `휘발유 재고 평년 대비 ${pct(S.season('us_gasoline'))} → 공급 완충 부족` },
        { when: S => S.down('refinery_util'), text: '정제 가동률 하락 중 → 공급 차질 요인' },
        { when: S => S.up('gasoline') && !S.up('wti'), text: '원유보다 휘발유가 강함 → 정제 마진 확대(정제 병목) 신호' },
        { when: S => S.down('gasoline_demand'), text: '휘발유 수요 감소 중 → 상승 지속력은 제한될 수 있음' }
      ],
      watch: '매주 수요일 EIA 휘발유 재고·수요 · 여름 드라이빙 시즌(5~9월) · 허리케인'
    },
    diesel: {
      what: '초저유황 디젤 선물 — 트럭·철도·선박·농기계·건설 연료, 물류비와 산업 원가의 핵심',
      states: {
        surge: '재고 부족·정제 차질 때 급등 — 산업 전반에 비용 충격',
        rise: '디젤 상승은 물류·농업·건설 원가로 넓게 전가',
        fall: '물류 원가 부담 완화 — 산업 수요 둔화 반영일 수도 있음',
        plunge: '급락은 산업·화물 수요 둔화 신호일 수 있음',
        high: '높은 가격대 — 물류비·생산원가 부담이 큰 구간',
        low: '낮은 가격대 — 물류비 부담 완화',
        flat: '큰 변화 없음'
      },
      pairs: [
        { when: S => S.season('us_distill') <= -5, text: S => `디젤 재고 평년 대비 ${pct(S.season('us_distill'))} → 공급 완충 부족` },
        { when: S => S.down('distill_demand'), text: '디젤 수요 감소 중 → 화물·산업 활동 둔화 신호와 함께 확인' },
        { when: S => S.up('diesel') && !S.up('wti'), text: '원유보다 디젤이 강함 → 정제 병목 신호' },
        { when: () => winter(), text: '난방유 수요 시즌 — 재고 감소 속도에 주의' }
      ],
      watch: '매주 수요일 EIA 중간유분 재고 · 정제 가동률 · 겨울 난방 수요'
    },

    /* ───────── 운임 ───────── */
    bdry: {
      what: '벌크선 운임 선물 ETF(BDI 대용) — 철광석·석탄·곡물 해상 운송 수요',
      states: {
        surge: '항로 차질이나 중국 원자재 수입 급증 때 급등',
        rise: '원자재 물동량 증가 또는 선박 공급 부족 — 원자재 수입 비용 상승',
        fall: '원자재 수요 둔화 신호일 수 있음',
        plunge: '급락은 중국 수입 감소나 선박 공급 과잉 반영',
        high: '높은 운임 구간 — 원자재 수입 비용 부담',
        low: '낮은 운임 구간 — 원자재 물동량 부진 가능성',
        flat: '큰 변화 없음'
      },
      pairs: [
        { when: S => S.up('iron_ore') && S.up('bdry'), text: '철광석·운임 동반 상승 → 중국 철강 수요 회복 쪽 해석' },
        { when: S => S.down('iron_ore') && S.up('bdry'), text: '원자재 가격과 반대 → 항로·선박 공급 요인 점검' },
        { when: S => S.up('etf_bwet'), text: '유조선 운임도 상승 → 해운 전반 강세' },
        { when: S => S.up('wheat') || S.up('soybean'), text: '곡물 가격도 상승 → 곡물 수출 물동량 요인 가능성' }
      ],
      watch: '중국 원자재 수입 통계(월초) · 홍해·파나마 운하 뉴스 · 곡물 수출기'
    },
    scfi: {
      what: '상하이 컨테이너 운임지수(직접 입력) — 공산품 수출입 물류비',
      states: {
        surge: '항로 차질(홍해 등)이나 성수기 선적 집중 때 급등',
        rise: '수출입 기업 물류비 상승 — 수입 소비재 가격에 시차를 두고 전가',
        fall: '물류비 부담 완화 — 교역량 둔화 반영일 수도 있음',
        plunge: '급락은 선박 공급 과잉이나 교역 위축 신호',
        flat: '큰 변화 없음'
      },
      pairs: [
        { when: S => S.up('diesel'), text: '디젤도 상승 → 육상·해상 물류비 동시 부담' },
        { when: S => S.up('usdkrw'), text: '원화 약세 겹침 → 원화 기준 물류비 이중 부담' },
        { when: S => S.lvl('freight_ppi') >= 1, text: '운송 물가(PPI)도 높은 상태 → 상품 물가 전가 경로 점검' }
      ],
      watch: '매주 금요일 발표 · 홍해·수에즈 운항 · 미국 수입 성수기(7~10월)'
    },
    freight_ppi: {
      what: '미국 원양 화물운송 생산자물가(전년비) — 해상 운송비가 물가로 넘어가는 경로',
      states: {
        rise: '운송 물가 상승률 확대 — 수입 상품 가격에 시차를 두고 반영',
        fall: '운송 물가 둔화 — 상품 물가 하향 요인',
        high: '운송 물가 급등 구간 — 상품 물가 재가속 위험',
        low: '운송 물가 하락 구간 — 상품 물가 안정 요인',
        flat: '흐름 유지'
      },
      pairs: [
        { when: S => S.lvl('us_core_pce') >= 1, text: '근원 물가도 높은 상태 → 상품 물가 재가속 위험 점검' },
        { when: S => S.up('bdry'), text: '현재 운임(BDRY)도 상승 중 → 운송 물가 상승이 이어질 수 있음' },
        { when: S => S.down('bdry'), text: '현재 운임(BDRY)은 하락 중 → 운송 물가는 시차를 두고 둔화 가능' }
      ],
      watch: '매월 PPI 발표 · 컨테이너·벌크 운임 추이'
    },

    /* ───────── 비축·재고 ───────── */
    us_spr: {
      what: '미국 정부 전략비축유 — 공급 차질 때 방출하는 정책 완충재',
      states: {
        rise: '재비축 매입 — 정부가 원유 수요자로 참여, 비상 여력 회복',
        fall: '방출·판매 — 단기 공급 보완, 비상 여력 축소',
        low: '수십 년 중 낮은 수준이면 다음 공급 충격 때 대응 여력 제한',
        high: '비축 여유 — 공급 충격 때 정책 대응 여력',
        flat: '변화 없음 — 방출·매입 정책 발표 여부만 확인'
      },
      pairs: [
        { when: S => S.up('wti') && S.down('us_spr'), text: '유가 상승 중 방출 → 가격 억제 정책 가능성' },
        { when: S => S.up('us_spr') && S.up('wti'), text: '재비축 매입이 유가 지지 요인' },
        { when: S => S.pos('us_crude') <= 20, text: '상업 재고도 낮은 편 → 민간·정부 완충이 함께 얇음' }
      ],
      watch: '미 에너지부 방출·매입 공고 · 매주 수요일 EIA'
    },
    us_crude: {
      what: '미국 상업 원유 재고(SPR 제외) — 원유 수급의 주간 성적표',
      states: {
        rise: '재고 증가 — 수요 둔화 또는 공급 증가, 유가 하방 압력',
        fall: '재고 감소 — 수급이 빠듯해지는 방향, 유가 지지',
        low: '평년보다 적은 재고 — 공급 충격 때 가격 변동폭 확대',
        high: '평년보다 많은 재고 — 공급 여유',
        flat: '큰 변화 없음'
      },
      pairs: [
        { when: S => S.up('refinery_util'), text: '정제 가동률 상승 → 원유 소비가 늘어 재고 감소 요인' },
        { when: S => S.up('crude_net_imports'), text: '순수입 증가 → 재고 증가 요인' },
        { when: S => S.up('us_crude_prod'), text: '미국 생산 증가 → 재고 증가 요인' },
        { when: S => S.down('cushing'), text: '쿠싱 재고도 감소 → WTI 인도 지점 수급까지 빠듯' }
      ],
      watch: '매주 수요일 EIA (전날 API 민간 집계)'
    },
    us_gasoline: {
      what: '미국 휘발유 재고 — 휘발유 가격의 단기 완충',
      states: {
        rise: '재고 증가 — 수요 둔화 또는 정제 증가',
        fall: '재고 감소 — 수요 강세 또는 공급 차질',
        low: '평년보다 적음 — 드라이빙 시즌·허리케인 때 가격 급등 위험',
        high: '평년보다 많음 — 휘발유 가격 상승 제한',
        flat: '큰 변화 없음'
      },
      pairs: [
        { when: S => S.up('gasoline_demand'), text: '휘발유 수요 증가 중 → 재고 감소 압력' },
        { when: S => S.down('refinery_util'), text: '정제 가동률 하락 → 공급 감소 요인' },
        { when: S => S.up('gasoline'), text: '휘발유 가격도 상승 → 재고 부족이 가격에 반영 중' }
      ],
      watch: '매주 수요일 EIA · 드라이빙 시즌(5~9월)'
    },
    us_distill: {
      what: '미국 디젤·난방유(중간유분) 재고 — 물류·산업·난방 연료의 완충',
      states: {
        rise: '재고 증가 — 산업 수요 둔화 또는 정제 증가',
        fall: '재고 감소 — 수요 강세 또는 정제·수출 요인',
        low: '평년보다 적음 — 겨울 난방 수요·물류 성수기에 가격 급등 위험',
        high: '평년보다 많음 — 디젤 가격 안정 요인',
        flat: '큰 변화 없음'
      },
      pairs: [
        { when: S => S.up('diesel'), text: '디젤 가격도 상승 → 재고 부족이 가격에 반영 중' },
        { when: S => S.down('distill_demand'), text: '디젤 수요 감소 중 → 재고 감소는 공급 요인일 가능성' },
        { when: () => winter(), text: '난방 시즌 — 재고 소진 속도 주의' }
      ],
      watch: '매주 수요일 EIA · 겨울 기온 전망'
    },
    ng_storage: {
      what: '미국 천연가스 저장량 — 겨울 가스 가격의 핵심 완충',
      states: {
        rise: '주입기(4~10월) 재고 확충',
        fall: '인출기(11~3월) 재고 소진',
        low: '평년보다 적음 — 한파 때 가격 급등 위험',
        high: '평년보다 많음 — 겨울 가격 안정 요인',
        flat: '변화 작음 (주입·인출 전환기)'
      },
      pairs: [
        { when: S => S.up('natgas') && S.season('ng_storage') <= -5, text: '저장량 부족 속 가스 가격 상승 → 수급 압박이 가격에 반영 중' },
        { when: S => S.down('natgas') && S.season('ng_storage') <= -5, text: '저장량은 부족한데 가격은 하락 → 온화한 날씨 기대 반영 가능성' },
        { when: () => [9, 10].includes(month()), text: '겨울 직전 — 11월 초 저장량이 겨울 가격의 출발점' }
      ],
      watch: '매주 목요일 EIA · 기상 전망 · LNG 수출'
    },
    cushing: {
      what: '오클라호마 쿠싱 원유 재고 — WTI 선물 인도 지점',
      states: {
        rise: '재고 증가 — WTI 근월물 수급 완화',
        fall: '재고 감소 — WTI 근월물 수급 빠듯',
        low: '운영 하한(약 2천만 배럴) 근접 시 WTI 근월물 변동성 급확대',
        high: '재고 여유 — WTI 근월물 약세 요인',
        flat: '큰 변화 없음'
      },
      pairs: [
        { when: S => S.up('wti'), text: 'WTI 상승과 함께 → 인도 지점 수급이 가격을 지지' },
        { when: S => S.has('brent') && S.has('wti') && S.v('brent') - S.v('wti') <= 3, text: '브렌트-WTI 차이 좁음 → 미국 내 수급이 상대적으로 빠듯' }
      ],
      watch: '매주 수요일 EIA'
    },
    refinery_util: {
      what: '미국 정제 가동률 — 휘발유·디젤 공급 여력',
      states: {
        rise: '가동률 상승 — 제품 공급 확대, 원유 수요 증가',
        fall: '가동률 하락 — 정비 시즌 또는 설비 차질, 제품 가격 상승 압력',
        low: '낮은 가동률 — 정비(봄·가을)인지 사고인지 구분 필요',
        high: '높은 가동률 — 정제 설비가 거의 한계까지 가동, 추가 공급 여력 작음',
        flat: '안정'
      },
      pairs: [
        { when: S => S.season('us_distill') <= -5, text: '디젤 재고도 평년보다 적음 → 정제 병목 가능성' },
        { when: S => S.up('diesel') || S.up('gasoline'), text: '제품 가격 상승 중 → 가동률 변화가 가격에 영향' },
        { when: () => [3, 4, 9, 10].includes(month()), text: '정비 시즌(봄·가을) — 일시적 가동률 하락이 흔함' }
      ],
      watch: '매주 수요일 EIA · 정유 설비 사고·허리케인 뉴스'
    },
    us_crude_prod: {
      what: '미국 원유 생산량 — 셰일 중심의 세계 최대 산유량',
      states: {
        rise: '생산 증가 — 공급 여유, 유가 상승 제한 요인',
        fall: '생산 감소 — 기상 차질·투자 둔화 여부 확인',
        high: '사상 최고 수준권 — 산유국 감산 효과를 일부 상쇄',
        low: '생산 부진 — 공급 측 상승 요인',
        flat: '안정'
      },
      pairs: [
        { when: S => S.down('wti') && S.up('us_crude_prod'), text: '유가 하락 속 생산 증가 → 공급 과잉 우려와 연결' },
        { when: S => S.up('wti') && S.down('us_crude_prod'), text: '유가 상승에도 생산 감소 → 투자 둔화·기상 요인 점검' }
      ],
      watch: '매주 수요일 EIA · 시추 장비 수(베이커휴즈, 매주 금요일)'
    },
    gasoline_demand: {
      what: '미국 휘발유 수요(제품 공급량 4주 평균) — 소비·이동 활동의 실물 지표',
      states: {
        rise: '수요 증가 — 소비 견조 (계절 요인 함께 확인)',
        fall: '수요 감소 — 소비 둔화 또는 계절 요인',
        high: '평년보다 높은 수요 — 휘발유 재고 감소 압력',
        low: '평년보다 낮은 수요 — 소비 둔화 신호일 수 있음',
        flat: '안정'
      },
      pairs: [
        { when: S => S.up('gasoline') && S.down('gasoline_demand'), text: '가격 상승 속 수요 감소 → 높은 가격이 소비를 줄이는 중' },
        { when: S => S.down('retail'), text: '소매판매도 둔화 → 소비 약화 신호가 겹침' }
      ],
      watch: '매주 수요일 EIA · 드라이빙 시즌(5~9월)'
    },
    distill_demand: {
      what: '미국 디젤·난방유 수요(4주 평균) — 화물 운송·산업 활동의 실물 지표',
      states: {
        rise: '수요 증가 — 화물·산업 활동 회복 신호일 수 있음',
        fall: '수요 감소 — 화물·산업 활동 둔화 신호일 수 있음',
        high: '평년보다 높은 수요 — 디젤 재고 감소 압력',
        low: '평년보다 낮은 수요 — 산업 경기 둔화 신호와 함께 확인',
        flat: '안정'
      },
      pairs: [
        { when: S => S.down('distill_demand') && S.down('indpro'), text: '산업생산도 둔화 → 제조업 경기 둔화 신호가 겹침' },
        { when: S => S.down('distill_demand') && S.down('bdry'), text: '벌크 운임도 하락 → 물동량 둔화 신호' }
      ],
      watch: '매주 수요일 EIA · 트럭 운송·산업생산 지표'
    },
    crude_net_imports: {
      what: '미국 원유 순수입 — 해외 원유 의존도',
      states: {
        rise: '순수입 증가 — 국내 생산 대비 정제 수요 확대',
        fall: '순수입 감소 — 국내 생산 증가 또는 수출 확대',
        flat: '큰 변화 없음'
      },
      pairs: [
        { when: S => S.down('crude_net_imports') && S.up('us_crude_prod'), text: '생산 증가가 수입을 대체 중' },
        { when: S => S.has('brent') && S.has('wti') && S.v('brent') - S.v('wti') >= 6, text: '브렌트-WTI 차이 확대 → 미국산 원유 수출 유인 커짐' }
      ],
      watch: '매주 수요일 EIA (주간 변동이 커서 4주 흐름으로 보는 게 좋음)'
    },
    eu_oil_stock: {
      what: '독일 비상 석유 비축(순수입 대비 일수) — EU 지침상 90일 이상 의무',
      states: {
        rise: '비축 일수 증가 — 공급 충격 대응 여력 확대',
        fall: '비축 일수 감소 — 방출 또는 수입 증가 반영',
        low: '의무 기준(90일) 근접 — 공급 충격 대응 여력 제한',
        flat: '안정'
      },
      pairs: [
        { when: S => S.up('brent'), text: '브렌트 상승 중 → 유럽 공급 불안 시 비축 방출 여부 주목' }
      ],
      watch: '월간(수개월 지연) · IEA 공동 방출 결정'
    },

    /* ───────── 금속·광물 ───────── */
    copper: {
      what: '구리 — 전선·건설·전기차·전력망에 두루 쓰여 경기 선행지표로 많이 봄',
      states: {
        surge: '급등은 광산 공급 차질이나 전력망·데이터센터 투자 기대가 겹칠 때 — 제조업 원가 부담 확대',
        rise: '경기 기대 반영 가능성 — 동시에 전선·전기 장비 원가 상승',
        fall: '수요 둔화(특히 중국 부동산·제조업) 반영 여부 확인',
        plunge: '급락은 경기 둔화 우려가 커질 때 자주 나타남',
        high: '고점권 — 경기 기대와 함께 제조업 원가 부담도 큰 구간',
        low: '저점권 — 제조업 경기 부진 반영 가능성',
        flat: '횡보 — 경기 기대 변화 제한적'
      },
      pairs: [
        { when: S => S.up('copper') && S.down('gold'), text: '금은 하락 → 안전자산보다 경기 기대 쪽 해석에 무게' },
        { when: S => S.up('copper') && S.up('dxy'), text: '달러 강세에도 상승 → 수요보다 공급 차질(광산·제련) 요인 점검' },
        { when: S => S.up('copper') && S.down('indpro'), text: '산업생산은 둔화 중 → 실물 수요와 가격 사이 괴리 확인' },
        { when: S => S.v('copper') && S.v('gold'), text: S => `구리/금 비율 ${(S.v('copper') / S.v('gold')).toFixed(2)} — 높아질수록 경기 기대 우위로 해석` }
      ],
      watch: '중국 제조업 PMI(매월 초) · LME·COMEX 재고 · 칠레·페루 광산 뉴스'
    },
    gold: {
      what: '금 — 안전자산·인플레이션 헤지, 실질금리·달러와 반대로 움직이는 경향',
      states: {
        surge: '급등은 지정학 위험·금융 불안·중앙은행 매입이 겹칠 때',
        rise: '안전자산 선호 또는 실질금리·달러 하락 반영 가능성',
        fall: '위험선호 회복 또는 실질금리 상승 반영 가능성',
        plunge: '급락은 실질금리 급등이나 위험선호 급반전 때',
        high: '고점권 — 불확실성에 대한 경계가 가격에 많이 반영된 상태',
        low: '저점권 — 위험선호가 강한 국면',
        flat: '횡보'
      },
      pairs: [
        { when: S => S.down('real10y'), text: '실질금리 하락 → 금 강세의 전통적 배경' },
        { when: S => S.up('real10y') && S.up('gold'), text: '실질금리 상승에도 금 강세 → 중앙은행 매입·지정학 수요 등 다른 요인' },
        { when: S => S.down('dxy'), text: '달러 약세 → 달러 표시 금 가격에 우호적' },
        { when: S => S.lvl('vix') >= 1, text: '변동성(VIX) 경계 구간 → 안전자산 수요' }
      ],
      watch: 'FOMC · 미국 CPI · 중앙은행 금 매입 통계(세계금협회 월간)'
    },
    silver: {
      what: '은 — 귀금속이면서 태양광·전자 산업 수요가 절반 이상',
      states: {
        surge: '급등은 금 강세와 산업 수요 기대가 겹칠 때 — 금보다 변동폭이 큼',
        rise: '귀금속·산업 수요 동반 반영 가능성',
        fall: '산업 수요 둔화 또는 귀금속 약세',
        plunge: '급락 — 변동성이 큰 품목 특성',
        high: '고점권 — 변동성 확대 주의',
        low: '저점권',
        flat: '횡보'
      },
      pairs: [
        { when: S => S.v('gold') && S.v('silver'), text: S => `금/은 비율 ${(S.v('gold') / S.v('silver')).toFixed(0)} — 높을수록 은이 금보다 약한 구간 (장기 평균 대략 60~80)` },
        { when: S => S.up('silver') && S.up('copper'), text: '구리도 상승 → 산업 수요 쪽 요인' },
        { when: S => S.up('silver') && S.up('gold') && !S.up('copper'), text: '금과 함께 오르고 구리는 아님 → 귀금속 수요 쪽 요인' }
      ],
      watch: '금 가격 · 태양광 설치 동향 · FOMC'
    },
    aluminum: {
      what: '알루미늄 — 생산에 전력이 많이 들어 에너지 가격 영향이 큼, 자동차·포장·건설 소재',
      states: {
        surge: '급등은 전력 비용 급등(유럽·중국 감산)이나 공급 제재 때',
        rise: '전력 비용·공급 이슈 또는 수요 회복 반영 가능성',
        fall: '수요 둔화 또는 공급 확대',
        high: '고점권 — 소재 원가 부담',
        low: '저점권',
        flat: '횡보'
      },
      pairs: [
        { when: S => S.up('natgas') || S.up('coal'), text: '발전 연료(가스·석탄) 상승 → 제련 원가 상승 요인' },
        { when: S => S.up('aluminum') && S.up('copper'), text: '구리와 동반 상승 → 산업금속 전반의 수요 기대' }
      ],
      watch: '중국 생산량 · 유럽 전력 가격 · LME 재고'
    },
    iron_ore: {
      what: '철광석 — 철강 원료, 중국 건설·인프라 경기의 바로미터',
      states: {
        surge: '급등은 중국 부양책 기대나 호주·브라질 공급 차질 때',
        rise: '철강·건설 수요(특히 중국) 기대 반영 가능성',
        fall: '중국 부동산·건설 둔화 반영 가능성',
        plunge: '급락은 중국 철강 감산이나 수요 충격 신호',
        high: '고점권 — 철강 원가 부담',
        low: '저점권 — 중국 건설 경기 부진 반영',
        flat: '횡보'
      },
      pairs: [
        { when: S => S.up('iron_ore') && S.up('bdry'), text: '벌크 운임도 상승 → 실제 물동량 증가를 동반' },
        { when: S => S.up('iron_ore') && S.down('bdry'), text: '운임은 하락 → 물동량보다 공급 요인일 가능성' },
        { when: S => S.up('coal'), text: '석탄도 상승 → 철강 원료 전반의 비용 상승' }
      ],
      watch: '중국 부동산·인프라 정책 · 중국 철강 생산(월간) · 호주·브라질 수출'
    },
    lithium: {
      what: '탄산리튬(직접 입력) — 전기차·ESS 배터리 핵심 원료, 변동성이 매우 큼',
      states: {
        surge: '급등은 공급 차질이나 배터리 수요 급증 기대 때',
        rise: '2차전지 공급망 수급 개선 반영',
        fall: '공급 과잉 또는 전기차 수요 둔화',
        plunge: '급락 — 신규 광산 공급 확대 국면에서 자주 나타남',
        flat: '횡보'
      },
      pairs: [
        { when: S => S.up('etf_lit'), text: '리튬·배터리 ETF(LIT)도 상승 → 업종 전반의 수요 기대' },
        { when: S => S.down('etf_lit'), text: '리튬·배터리 ETF(LIT) 하락 → 업종 전반 약세' },
        { when: S => S.up('nickel'), text: '니켈도 상승 → 배터리 소재 전반의 수급 변화' }
      ],
      watch: '중국 광저우선물거래소(GFEX) 가격 · 전기차 판매 · 신규 광산 가동'
    },
    nickel: {
      what: '니켈(IMF 월간) — 스테인리스강과 고성능 배터리 소재',
      states: {
        surge: '급등은 공급 차질(인도네시아 정책·제재) 때',
        rise: '배터리·스테인리스 수요 또는 공급 이슈 반영',
        fall: '인도네시아 증산 등 공급 확대 또는 수요 둔화',
        high: '고점권',
        low: '저점권 — 공급 과잉 국면',
        flat: '횡보'
      },
      pairs: [
        { when: S => S.up('etf_lit'), text: '배터리 업종(LIT)도 상승 → 배터리 수요 기대' },
        { when: S => S.up('nickel') && S.up('copper'), text: '구리와 동반 상승 → 산업금속 전반의 강세' }
      ],
      watch: '월간 발표(1~2개월 지연) · 인도네시아 수출 정책 · 스테인리스 생산'
    },

    /* ───────── 곡물 ───────── */
    wheat: {
      what: '밀 — 빵·면·사료 원료, 흑해(러시아·우크라이나) 수출 비중이 큼',
      states: {
        surge: '급등은 흑해 수출 차질·주요 산지 가뭄 때',
        rise: '식품 원가 상승 압력 — 국내 제분·가공식품 가격에 시차를 두고 반영',
        fall: '공급 여유 — 식품 원가 부담 완화',
        plunge: '급락은 풍작 전망이나 수출 재개 반영',
        high: '고점권 — 식품 물가 부담',
        low: '저점권 — 농가 수익성 부담',
        flat: '횡보'
      },
      pairs: grainPairs,
      watch: 'USDA WASDE(매월 중순) · 흑해 수출 · 주요 산지 기상'
    },
    corn: {
      what: '옥수수 — 사료·전분·바이오에탄올 원료, 미국이 최대 생산국',
      states: {
        surge: '급등은 미국 중서부 가뭄이나 수출 급증 때',
        rise: '사료 원가 상승 → 육류·유제품 가격으로 시차 전가',
        fall: '공급 여유 — 사료 원가 부담 완화',
        plunge: '급락은 풍작 전망 반영',
        high: '고점권 — 사료·식품 원가 부담',
        low: '저점권',
        flat: '횡보'
      },
      pairs: [
        { when: S => S.up('wti') || S.up('gasoline'), text: '유가·휘발유 상승 → 에탄올 수요로 옥수수 가격 지지' },
        ...grainPairs
      ],
      watch: 'USDA WASDE(매월 중순) · 미국 작황 보고서(생육기 매주 월요일) · 에탄올 생산'
    },
    soybean: {
      what: '대두 — 식용유·사료(대두박)·바이오디젤 원료, 중국이 최대 수입국',
      states: {
        surge: '급등은 남미 가뭄이나 중국 수입 급증 때',
        rise: '식용유·사료 원가 상승 압력',
        fall: '공급 여유 또는 중국 수요 둔화',
        plunge: '급락은 풍작·무역 분쟁 반영',
        high: '고점권 — 식용유·사료 원가 부담',
        low: '저점권',
        flat: '횡보'
      },
      pairs: [
        { when: S => S.up('diesel'), text: '디젤 상승 → 바이오디젤 원료 수요로 대두 가격 지지' },
        ...grainPairs
      ],
      watch: 'USDA WASDE(매월 중순) · 남미(브라질·아르헨티나) 작황 · 미중 무역 뉴스'
    }
  };
})(window);
