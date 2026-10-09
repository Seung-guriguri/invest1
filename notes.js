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

/* =====================================================================
 * 2차: 금리 · 물가 · 경기 · 시장·신용 · 환율 · ETF
 * ===================================================================== */
(function (global) {
  'use strict';
  const has = (S, ...ids) => ids.every(id => S.has(id));
  const pp = v => (v > 0 ? '+' : '') + v.toFixed(2) + '%p';

  /* 국채 금리 공통 */
  const yieldStates = {
    surge: '급등 — 채권 가격 급락, 대출 금리·밸류에이션에 빠르게 부담',
    rise: '금리 상승 — 채권 가격 하락, 성장주 밸류에이션·변동금리 대출 이자 부담',
    fall: '금리 하락 — 채권 가격 상승, 경기 둔화 우려 반영 여부 확인',
    plunge: '급락 — 경기 충격이나 안전자산 쏠림 신호인 경우가 많음',
    high: '최근 수년 중 높은 금리 구간 — 자금 조달 비용이 높은 상태가 이어짐',
    low: '낮은 금리 구간 — 조달 여건 우호적',
    flat: '보합 — 다음 물가·고용 발표와 통화정책 회의가 변수'
  };
  const usYieldPairs = [
    { when: S => S.up('us10y') && S.up('bei10y'), text: '기대인플레이션도 상승 → 물가 우려가 금리를 끌어올리는 중' },
    { when: S => S.up('us10y') && S.up('real10y') && !S.up('bei10y'), text: '실질금리 주도 상승 → 긴축적 금융 여건, 성장주·금에 부담' },
    { when: S => S.up('us10y') && S.up('dxy'), text: '달러 강세 동반 → 원화 약세·수입물가 경로 점검' },
    { when: S => S.down('us10y') && S.down('sp500'), text: '주가와 함께 하락 → 경기 우려·안전자산 선호 쪽 해석' },
    { when: S => S.lvl('hy_spread') >= 1, text: '하이일드 스프레드도 높은 구간 → 저신용 기업 차환 부담 가중' }
  ];
  const krYieldPairs = [
    { when: S => S.up('kr3y') && S.up('us2y'), text: '미국 단기금리와 동반 상승 → 대외 금리 영향' },
    { when: S => has(S, 'kr10y', 'us10y') && S.v('us10y') - S.v('kr10y') >= 0.5, text: S => `미국 10년물이 한국보다 ${(S.v('us10y') - S.v('kr10y')).toFixed(2)}%p 높음 → 자본 유출·원화 약세 압력 요인` },
    { when: S => S.up('usdkrw'), text: '원화 약세 동반 → 외국인 채권 자금 흐름 확인' },
    { when: S => S.lvl('kr_cpi') >= 1, text: '한국 물가가 목표 위 → 금리 인하 여지 제한' }
  ];

  /* 물가 공통 */
  const inflStates = {
    rise: '물가 재상승 — 금리 인하 기대가 약해지고 실질 구매력 부담',
    fall: '물가 둔화 — 통화정책 완화 여지 확대',
    high: '목표(2%)를 크게 웃도는 구간 — 긴축 기조가 길어질 수 있음',
    low: '낮은 물가 구간 — 완화 여지, 디플레이션 우려 여부도 확인',
    flat: '횡보 — 세부 항목(주거·서비스·에너지) 흐름이 관건'
  };
  const inflPairs = [
    { when: S => S.up('wti') || S.up('gasoline'), text: '유가·휘발유 상승 중 → 다음 발표의 에너지 항목 상방 압력' },
    { when: S => S.up('bei10y'), text: '시장 기대인플레이션도 상승 → 물가 우려가 금리에 반영 중' },
    { when: S => S.lvl('freight_ppi') >= 1 || S.up('us_ppi'), text: '생산자·운송 물가 상승 → 소비자물가로 시차 전가 가능' },
    { when: S => S.down('us_cpi') && S.down('us_core_cpi'), text: '헤드라인·근원 모두 둔화 → 물가 진정 흐름이 넓게 확인' }
  ];

  /* 주가지수 공통 */
  const eqStates = {
    surge: '급등 — 위험선호 급반전, 과열 여부와 변동성 함께 확인',
    rise: '상승 — 위험선호 개선',
    fall: '하락 — 위험선호 약화 여부 관찰',
    plunge: '급락 — 변동성 확대, 레버리지·신용 비중 점검',
    high: '최근 수년 중 고점권 — 기대가 많이 반영된 구간',
    low: '저점권 — 비관이 많이 반영된 구간',
    flat: '횡보'
  };
  const eqPairs = [
    { when: S => S.up('vix'), text: '변동성(VIX) 상승 동반 → 위험 회피 흐름' },
    { when: S => S.up('us10y') && S.up('real10y'), text: '실질금리 상승 중 → 밸류에이션 부담 요인' },
    { when: S => S.up('hy_spread'), text: '하이일드 스프레드 확대 → 신용시장도 위험 회피' },
    { when: S => S.pos('vix') <= 15 && S.pos('hy_spread') <= 20, text: '변동성·스프레드 모두 낮음 → 낙관 국면, 충격 시 변동폭 확대 가능' }
  ];

  /* ETF 공통 (기초 지표를 따라감) */
  const etfStates = name => ({
    surge: `${name} 급등 — 하루 변동이 평소보다 큼, 원인 뉴스 확인`,
    rise: `${name} 상승`,
    fall: `${name} 하락`,
    plunge: `${name} 급락 — 하루 변동이 평소보다 큼, 원인 뉴스 확인`,
    high: '최근 2년 중 고점권',
    low: '최근 2년 중 저점권',
    flat: '횡보'
  });

  Object.assign(global.NOTES, {
    /* ───────── 금리 ───────── */
    kr_base: {
      what: '한국은행 기준금리 — 국내 대출·예금 금리의 출발점',
      states: {
        rise: '인상 — 변동금리 대출 이자·기업 조달 비용 증가, 부동산 수요 위축',
        fall: '인하 — 이자 부담 완화, 경기 둔화 대응인지 함께 확인',
        high: '높은 기준금리 유지 — 가계·자영업 이자 부담이 큰 구간',
        flat: '동결 — 다음 금통위 의사록·총재 발언이 변수'
      },
      pairs: [
        { when: S => has(S, 'kr_base', 'us_ffr') && S.v('us_ffr') - S.v('kr_base') >= 1, text: S => `미국 기준금리가 ${(S.v('us_ffr') - S.v('kr_base')).toFixed(2)}%p 높음 → 원화 약세·자본 유출 압력 요인` },
        { when: S => S.lvl('kr_cpi') >= 1, text: '한국 물가가 목표 위 → 인하 여지 제한' },
        { when: S => S.up('usdkrw'), text: '원화 약세 중 → 금리 결정에 환율 부담' },
        { when: S => S.down('kr3y'), text: '국고채 3년이 하락 중 → 시장은 인하를 미리 반영하는 중' }
      ],
      watch: '금융통화위원회(연 8회) · 한국 CPI · 원/달러 · 가계부채'
    },
    kr3y: {
      what: '한국 국고채 3년 — 시장이 보는 향후 기준금리 경로, 대출·회사채 금리의 기준',
      states: yieldStates, pairs: krYieldPairs,
      watch: '금통위 · 한국 CPI · 미국 2년물 · 국채 발행 계획'
    },
    kr10y: {
      what: '한국 국고채 10년 — 장기 성장·물가 기대, 주택담보대출 고정금리의 기준',
      states: yieldStates, pairs: krYieldPairs,
      watch: '미국 10년물 · 국채 발행 물량 · 한국 성장률 전망'
    },
    us_ffr: {
      what: '미국 연방기금금리 목표 상단 — 세계 달러 자금의 기준 금리',
      states: {
        rise: '인상 — 달러 강세·글로벌 유동성 축소 방향',
        fall: '인하 — 달러 약세·유동성 완화 방향, 경기 둔화 대응인지 확인',
        high: '높은 정책금리 유지 — 긴축 효과가 시차를 두고 실물에 누적',
        flat: '동결 — 점도표·의장 발언이 변수'
      },
      pairs: [
        { when: S => has(S, 'us_ffr', 'us2y') && S.v('us2y') < S.v('us_ffr') - 0.25, text: S => `2년물(${S.fmt('us2y')}%)이 기준금리보다 낮음 → 시장은 인하를 예상` },
        { when: S => has(S, 'us_ffr', 'us2y') && S.v('us2y') > S.v('us_ffr') + 0.1, text: '2년물이 기준금리보다 높음 → 시장은 추가 인상 또는 장기 동결을 예상' },
        { when: S => S.lvl('us_core_pce') >= 1, text: '근원 PCE가 목표 위 → 인하 여지 제한' },
        { when: S => S.lvl('sahm') >= 1, text: '고용 둔화 신호(삼의 법칙) → 인하 압력' }
      ],
      watch: 'FOMC(연 8회) · 근원 PCE · 고용 보고서'
    },
    us3m: {
      what: '미국 3개월 국채 — 현재 정책금리를 거의 그대로 반영, 현금성 자산 수익률',
      states: yieldStates,
      pairs: [
        { when: S => has(S, 'us3m', 'us_ffr') && S.v('us3m') < S.v('us_ffr') - 0.3, text: '정책금리보다 낮음 → 가까운 시일 내 인하 예상 반영' },
        { when: S => S.v('spread3m') < 0, text: '10년물보다 높음(10Y−3M 역전) → 경기 둔화 신호로 해석되는 경우가 많음' }
      ],
      watch: 'FOMC · 단기 국채 발행 물량'
    },
    us2y: {
      what: '미국 2년물 — 앞으로 1~2년 기준금리 경로에 대한 시장 기대',
      states: yieldStates,
      pairs: [
        { when: S => has(S, 'us2y', 'us_ffr') && S.v('us2y') < S.v('us_ffr') - 0.25, text: '기준금리보다 낮음 → 인하 기대 반영' },
        { when: S => S.up('us2y') && S.up('usdjpy'), text: '엔/달러도 상승 → 미·일 금리 차 확대가 엔화 약세로' },
        ...usYieldPairs.slice(2)
      ],
      watch: '고용 보고서 · CPI · FOMC 점도표'
    },
    us10y: {
      what: '미국 10년물 — 세계 자산 가격의 기준 금리, 주택담보대출·회사채 금리의 출발점',
      states: yieldStates, pairs: usYieldPairs,
      watch: '국채 입찰(10년·30년) · CPI · 재정적자·국채 발행 계획 · FOMC'
    },
    us30y: {
      what: '미국 30년물 — 초장기 재정·물가 우려를 반영, 연기금·보험 자산의 기준',
      states: yieldStates,
      pairs: [
        { when: S => S.up('us30y') && !S.up('us2y'), text: '단기보다 장기가 더 오름 → 재정·장기 물가 우려(기간 프리미엄) 쪽 해석' },
        ...usYieldPairs.slice(0, 3)
      ],
      watch: '30년물 입찰 · 재정적자 전망 · 신용등급 뉴스'
    },
    spread: {
      what: '미국 장단기 금리차(10년−2년) — 경기 전망의 대표 신호, 0 아래면 역전',
      states: {
        rise: '금리차 확대(가팔라짐) — 역전 해소 국면은 과거 경기 변곡점과 겹친 사례가 많음',
        fall: '금리차 축소(평탄화) — 경기 기대 약화 또는 단기금리 상승',
        low: '역전 또는 0 근처 — 경기 둔화 신호로 해석되는 경우가 많음',
        high: '정상적인 우상향 곡선 — 경기 확장 기대',
        flat: '변화 작음'
      },
      pairs: [
        { when: S => S.v('spread') < 0, text: '역전 상태 — 과거 침체 1~2년 전 자주 나타났지만 시점은 일정치 않음' },
        { when: S => S.up('spread') && S.down('us2y'), text: '단기금리 하락이 주도 → 인하 기대 반영(불 스티프닝)' },
        { when: S => S.up('spread') && S.up('us10y'), text: '장기금리 상승이 주도 → 재정·물가 우려(베어 스티프닝)' }
      ],
      watch: '2년물·10년물 · 고용 · 경기선행지표'
    },
    spread3m: {
      what: '미국 장단기 금리차(10년−3개월) — 연준이 경기 신호로 중시하는 금리차',
      states: {
        rise: '금리차 확대 — 역전 해소 국면이면 경기 변곡점 신호로 주목',
        fall: '금리차 축소 — 경기 기대 약화',
        low: '역전 또는 0 근처 — 경기 둔화 신호',
        high: '정상 곡선 — 경기 확장 기대',
        flat: '변화 작음'
      },
      pairs: [
        { when: S => S.v('spread3m') < 0 && S.v('spread') >= 0, text: '10Y−2Y는 정상인데 10Y−3M은 역전 → 단기 정책금리가 높게 유지되는 국면' },
        { when: S => S.down('us3m'), text: '3개월물 하락 중 → 인하 기대가 금리차를 넓히는 방향' }
      ],
      watch: 'FOMC · 10년물'
    },
    real10y: {
      what: '미국 10년 실질금리(TIPS) — 물가를 뺀 진짜 자금 비용, 성장주·금 가격의 핵심 변수',
      states: {
        surge: '급등 — 성장주·금·부동산 밸류에이션에 강한 압박',
        rise: '실질금리 상승 — 이자 없는 자산(금)과 장기 성장 자산에 부담',
        fall: '실질금리 하락 — 금·성장 자산에 우호적',
        high: '높은 실질금리 — 긴축적 금융 여건, 신규 투자 문턱이 높음',
        low: '낮은 실질금리 — 완화적 여건',
        flat: '보합'
      },
      pairs: [
        { when: S => S.up('real10y') && S.up('gold'), text: '실질금리 상승에도 금 강세 → 중앙은행 매입·지정학 수요 등 다른 요인' },
        { when: S => S.up('real10y') && S.down('nasdaq'), text: '나스닥 하락 동반 → 성장주 밸류에이션 압박' },
        { when: S => S.up('real10y') && S.down('etf_itb'), text: '주택건설 업종 약세 동반 → 금리 민감 업종 부담' }
      ],
      watch: 'FOMC · 물가연동채 입찰 · 기대인플레이션'
    },
    bei10y: {
      what: '미국 10년 기대인플레이션(명목−실질 금리차) — 시장이 예상하는 장기 물가',
      states: {
        rise: '기대인플레이션 상승 — 물가 재상승 우려, 장기금리 상방 압력',
        fall: '기대인플레이션 하락 — 물가 안정 기대 또는 경기 둔화 반영',
        high: '높은 기대인플레이션 — 연준의 긴축 유지 근거',
        low: '낮은 기대인플레이션 — 디스인플레이션 기대',
        flat: '안정'
      },
      pairs: [
        { when: S => S.up('bei10y') && (S.up('wti') || S.up('brent')), text: '유가 상승 동반 → 에너지 가격이 물가 기대를 자극' },
        { when: S => S.up('bei10y') && S.up('gold'), text: '금 강세 동반 → 인플레이션 헤지 수요' },
        { when: S => S.down('bei10y') && S.down('copper'), text: '구리도 하락 → 경기 둔화 기대 쪽 해석' }
      ],
      watch: 'CPI · 유가 · 물가연동채 입찰'
    },
    mortgage: {
      what: '미국 30년 고정 모기지 금리(주간) — 주택 구매 여력과 부동산 경기의 핵심',
      states: {
        rise: '모기지 금리 상승 — 주택 구매 여력 감소, 거래 위축',
        fall: '모기지 금리 하락 — 구매·재융자 수요 회복',
        high: '높은 금리 구간 — 기존 저금리 대출자가 집을 팔지 않는 "고착 효과"로 매물 부족',
        low: '낮은 금리 구간 — 주택 수요 회복 여건',
        flat: '보합'
      },
      pairs: [
        { when: S => has(S, 'mortgage', 'us10y') && S.v('mortgage') - S.v('us10y') >= 2.5, text: S => `10년물 대비 ${(S.v('mortgage') - S.v('us10y')).toFixed(2)}%p 높음 → 평소(약 1.7%p)보다 넓은 가산금리, 대출 여건 빡빡` },
        { when: S => S.down('etf_itb'), text: '주택건설 업종(ITB) 약세 동반 → 주택 경기 부담' },
        { when: S => S.up('etf_itb') && S.down('mortgage'), text: '금리 하락에 주택건설 업종 반응 → 수요 회복 기대' }
      ],
      watch: '매주 목요일 프레디맥 발표 · 주택 착공·판매 지표'
    },

    /* ───────── 물가 ───────── */
    us_cpi: {
      what: '미국 소비자물가 상승률(전년비) — 가계가 체감하는 물가, 연금·임금 조정 기준',
      states: inflStates, pairs: inflPairs,
      watch: '매월 중순 CPI 발표 · 휘발유 가격 · 주거비'
    },
    us_core_cpi: {
      what: '미국 근원 CPI(식품·에너지 제외) — 물가의 기조적 흐름',
      states: inflStates,
      pairs: [
        { when: S => has(S, 'us_cpi', 'us_core_cpi') && S.v('us_core_cpi') > S.v('us_cpi'), text: '근원이 헤드라인보다 높음 → 에너지 하락이 전체 물가를 낮추는 중, 기조 물가는 여전히 높음' },
        { when: S => S.up('us_core_cpi') && S.up('us_core_pce'), text: '근원 PCE도 상승 → 연준이 중시하는 지표 모두 재상승' },
        ...inflPairs.slice(1, 3)
      ],
      watch: '매월 중순 CPI · 주거비·서비스 물가'
    },
    us_core_pce: {
      what: '미국 근원 PCE 물가 — 연준이 2% 목표로 삼는 핵심 물가 지표',
      states: inflStates,
      pairs: [
        { when: S => S.v('us_core_pce') >= 2.5, text: S => `목표(2%)보다 ${(S.v('us_core_pce') - 2).toFixed(1)}%p 높음 → 금리 인하 속도 제한 요인` },
        { when: S => S.down('us_core_pce') && S.lvl('sahm') >= 1, text: '물가 둔화 + 고용 둔화 → 인하 근거가 강해지는 조합' },
        ...inflPairs.slice(1, 3)
      ],
      watch: '매월 말 PCE 발표 · FOMC 경제전망'
    },
    us_ppi: {
      what: '미국 생산자물가(최종수요, 전년비) — 기업 원가, 소비자물가의 선행 신호',
      states: {
        rise: '생산자물가 상승 — 기업 원가 부담 증가, 소비자물가 전가 여부 확인',
        fall: '생산자물가 둔화 — 원가 부담 완화, 소비자물가 하향 요인',
        high: '높은 상승률 — 기업 마진 압박 또는 가격 전가로 이어짐',
        low: '낮은 상승률 — 원가 안정',
        flat: '횡보'
      },
      pairs: [
        { when: S => has(S, 'us_ppi', 'us_cpi') && S.v('us_ppi') > S.v('us_cpi') + 1, text: '생산자물가가 소비자물가보다 크게 높음 → 기업 마진 압박 또는 향후 소비자 가격 전가' },
        { when: S => S.up('diesel') || S.up('wti'), text: '에너지 가격 상승 중 → 원가 상승 압력 지속' }
      ],
      watch: '매월 중순 PPI 발표 (CPI 전후)'
    },
    kr_cpi: {
      what: '한국 소비자물가 상승률(전년비) — 한국은행 목표 2%',
      states: inflStates,
      pairs: [
        { when: S => S.up('usdkrw'), text: '원화 약세 중 → 수입물가 경로로 물가 상방 압력' },
        { when: S => S.up('brent'), text: '국제 유가 상승 → 석유류 물가 상승 요인' },
        { when: S => S.up('wheat') || S.up('corn') || S.up('soybean'), text: '곡물 가격 상승 → 가공식품 물가에 시차 전가' }
      ],
      watch: '매월 초 통계청 발표 · 원/달러 · 국제 유가 · 농산물 작황'
    },

    /* ───────── 경기·고용 ───────── */
    us_unemp: {
      what: '미국 실업률 — 연준 이중 책무 중 하나, 소비 여력의 바탕',
      states: {
        surge: '급등 — 해고 확산 신호, 침체 우려 확대',
        rise: '실업률 상승 — 고용 둔화, 소비 약화로 이어질 수 있음',
        fall: '고용 개선 — 경기 견조, 금리 인하 기대는 약해질 수 있음',
        high: '높은 실업률 — 경기 둔화 국면',
        low: '낮은 실업률 — 노동시장 과열·임금 상승 압력',
        flat: '안정'
      },
      pairs: [
        { when: S => S.lvl('sahm') >= 1, text: '삼의 법칙 경계 구간 → 실업률 상승 속도가 침체 초기와 비슷' },
        { when: S => S.up('claims'), text: '신규 실업수당 청구도 증가 → 해고 증가 신호' },
        { when: S => S.down('payems') || S.lvl('payems') >= 1, text: '고용 증가폭 둔화 동반' }
      ],
      watch: '매월 첫 금요일 고용 보고서 · 매주 목요일 실업수당 청구'
    },
    sahm: {
      what: '삼의 법칙 지표 — 실업률 3개월 평균이 최근 1년 저점보다 0.5%p 이상 오르면 침체 초기로 봄',
      states: {
        rise: '상승 — 실업률 오름 속도가 빨라지는 중',
        fall: '하락 — 고용 둔화 압력 완화',
        high: '발동 수준 근접·초과 — 과거 침체 초기와 겹친 경우가 많음',
        flat: '안정 — 고용 둔화 신호 제한적'
      },
      pairs: [
        { when: S => S.v('sahm') >= 0.5, text: '0.5 이상 → 역사적으로 침체 시작과 자주 겹친 수준 (예외도 있음)' },
        { when: S => S.v('spread') < 0 || S.v('spread3m') < 0, text: '장단기 금리차 역전도 함께 → 경기 둔화 신호 중첩' }
      ],
      watch: '고용 보고서(실업률) · 실업수당 청구'
    },
    payems: {
      what: '미국 비농업 고용 증감(천명, 전월비) — 일자리 창출 속도',
      states: {
        rise: '고용 증가폭 확대 — 노동시장 견조',
        fall: '고용 증가폭 축소 — 노동시장 냉각',
        low: '증가폭이 작거나 감소 — 경기 둔화 신호',
        high: '강한 고용 — 임금·서비스 물가 압력',
        flat: '흐름 유지'
      },
      pairs: [
        { when: S => S.v('payems') < 0, text: '고용 감소 → 경기 둔화 신호, 수정치도 확인' },
        { when: S => S.v('payems') >= 200, text: '20만 명 이상 증가 → 금리 인하 기대 약화 요인' },
        { when: S => S.up('claims'), text: '실업수당 청구 증가 동반 → 다음 달 고용도 약할 가능성' }
      ],
      watch: '매월 첫 금요일 고용 보고서 (이전 두 달 수정치 포함)'
    },
    claims: {
      what: '미국 신규 실업수당 청구(주간) — 가장 빠른 해고 신호',
      states: {
        surge: '급증 — 해고 확산 신호, 다음 고용 보고서 악화 가능',
        rise: '증가 — 고용 둔화 초기 신호 여부 관찰',
        fall: '감소 — 해고 적음, 노동시장 견조',
        high: '높은 수준 — 노동시장 약화',
        low: '낮은 수준 — 해고가 매우 적음',
        flat: '안정'
      },
      pairs: [
        { when: S => S.up('claims') && S.up('us_unemp'), text: '실업률도 상승 → 고용 둔화가 확인되는 중' },
        { when: () => [1, 7, 11, 12].includes(new Date().getMonth() + 1), text: '연말연시·7월은 계절 요인으로 변동이 큼 — 4주 흐름으로 확인' }
      ],
      watch: '매주 목요일 발표'
    },
    indpro: {
      what: '미국 산업생산(전년비) — 제조업·광업·전력 생산 활동',
      states: {
        rise: '생산 증가율 개선 — 제조업 회복',
        fall: '생산 증가율 둔화',
        low: '감소 구간 — 제조업 경기 위축',
        high: '강한 생산 증가',
        flat: '흐름 유지'
      },
      pairs: [
        { when: S => S.down('indpro') && S.down('copper'), text: '구리도 하락 → 제조업 둔화 신호 중첩' },
        { when: S => S.down('distill_demand'), text: '디젤 수요 감소 동반 → 산업·화물 활동 둔화' },
        { when: S => S.up('indpro') && S.up('etf_xli'), text: '산업재 업종(XLI) 강세 동반 → 제조업 회복 기대' }
      ],
      watch: '매월 중순 연준 발표 · ISM 제조업 지수(매월 첫 영업일)'
    },
    retail: {
      what: '미국 소매판매(명목, 전년비) — 소비 경기',
      states: {
        rise: '소비 증가세 확대 — 경기 견조',
        fall: '소비 증가세 둔화 — 물가 감안 실질 소비 확인',
        low: '소비 위축 — 경기 둔화 신호',
        high: '강한 소비 — 물가 압력 요인',
        flat: '흐름 유지'
      },
      pairs: [
        { when: S => has(S, 'retail', 'us_cpi') && S.v('retail') < S.v('us_cpi'), text: '명목 증가율이 물가보다 낮음 → 실질 소비는 감소' },
        { when: S => S.pos('umcsent') <= 15, text: '소비자심리가 매우 낮음 → 심리와 실제 소비의 괴리 확인' },
        { when: S => S.down('gasoline_demand'), text: '휘발유 수요도 감소 → 소비 둔화 신호 중첩' }
      ],
      watch: '매월 중순 발표 · 카드 소비 데이터'
    },
    umcsent: {
      what: '미시간대 소비자심리지수 — 가계의 체감 경기와 물가 기대',
      states: {
        rise: '심리 개선',
        fall: '심리 악화 — 물가·금리 부담이나 고용 불안 반영',
        low: '매우 낮은 심리 — 실제 소비와의 괴리 여부 확인',
        high: '높은 심리 — 소비 여력 기대',
        flat: '횡보'
      },
      pairs: [
        { when: S => S.up('gasoline'), text: '휘발유 가격 상승 → 심리 악화 요인' },
        { when: S => S.up('retail') && S.pos('umcsent') <= 20, text: '심리는 낮은데 소비는 증가 → "말과 행동이 다른" 소비' }
      ],
      watch: '매월 두 번(속보·확정) 발표 · 기대인플레이션 항목'
    },
    gdp: {
      what: '미국 실질 GDP 성장률(전기비 연율, 분기) — 경제 전체의 성장 속도',
      states: {
        rise: '성장률 개선',
        fall: '성장률 둔화',
        low: '마이너스 또는 매우 낮음 — 경기 위축',
        high: '강한 성장 — 잠재성장률(약 2%) 상회',
        flat: '흐름 유지'
      },
      pairs: [
        { when: S => S.v('gdp') < 0, text: '마이너스 성장 → 두 분기 연속이면 흔히 기술적 침체로 부름' },
        { when: S => S.v('gdp') >= 3 && S.lvl('us_core_pce') >= 1, text: '강한 성장 + 높은 물가 → 금리 인하 지연 요인' }
      ],
      watch: '분기 종료 약 1개월 뒤 속보치, 이후 두 차례 수정'
    },

    /* ───────── 시장·신용 ───────── */
    sp500: {
      what: 'S&P 500 — 미국 대형주 500개, 세계 위험자산의 기준',
      states: eqStates, pairs: eqPairs,
      watch: '기업 실적 시즌 · FOMC · CPI · 고용 보고서'
    },
    nasdaq: {
      what: '나스닥 종합 — 기술·성장주 중심, 금리(특히 실질금리)에 민감',
      states: eqStates,
      pairs: [
        { when: S => S.up('real10y'), text: '실질금리 상승 중 → 성장주 밸류에이션 부담' },
        { when: S => S.down('real10y') && S.up('nasdaq'), text: '실질금리 하락과 동반 상승 → 금리 요인' },
        { when: S => S.up('nasdaq') && !S.up('sp500'), text: '나스닥만 강세 → 소수 대형 기술주 집중 여부 확인' },
        ...eqPairs.slice(0, 1)
      ],
      watch: '대형 기술주 실적 · 실질금리 · AI 투자 뉴스'
    },
    kospi: {
      what: '코스피 — 한국 대표 지수, 반도체·수출 경기와 외국인 자금에 민감',
      states: eqStates,
      pairs: [
        { when: S => S.up('usdkrw') && S.down('kospi'), text: '원화 약세와 동반 하락 → 외국인 매도 흐름 가능성' },
        { when: S => S.down('usdkrw') && S.up('kospi'), text: '원화 강세와 동반 상승 → 외국인 자금 유입 흐름' },
        { when: S => S.up('copper') && S.up('kospi'), text: '구리 강세 동반 → 글로벌 경기 기대가 수출주에 반영' },
        { when: S => S.down('sp500'), text: '미국 증시 약세 → 다음 날 한국 증시에 영향' }
      ],
      watch: '수출 통계(매월 1일) · 반도체 업황 · 원/달러 · 외국인 순매수'
    },
    hy_spread: {
      what: '미국 하이일드 스프레드 — 저신용 회사채가 국채보다 더 내는 금리, 신용 위험의 온도계',
      states: {
        surge: '급확대 — 신용 경색 신호, 저신용 기업 차환 어려움',
        rise: '확대 — 신용 위험 회피, 차입 여건 악화',
        fall: '축소 — 신용 위험선호 개선',
        high: '높은 구간 — 신용 스트레스, 부도율 상승 가능성',
        low: '매우 낮은 구간 — 신용 위험이 싸게 매겨진 상태',
        flat: '안정'
      },
      pairs: [
        { when: S => S.up('hy_spread') && S.down('etf_kre'), text: '지역은행(KRE) 약세 동반 → 대출 시장 전반의 위축 가능성' },
        { when: S => S.up('hy_spread') && S.up('vix'), text: '변동성 상승 동반 → 주식·신용 동시 위험 회피' },
        { when: S => S.up('hy_spread') && S.down('wti'), text: '유가 하락 동반 → 에너지 기업 비중이 큰 하이일드 시장 부담' },
        { when: S => S.v('us10y') >= 4.75, text: '높은 국채 금리 위에 스프레드가 더해짐 → 저신용 기업의 절대 조달 금리 부담' }
      ],
      watch: '매일 (FRED 1일 지연) · 회사채 발행·부도 뉴스'
    },
    ig_spread: {
      what: '미국 투자등급 회사채 스프레드 — 우량 기업의 추가 조달 비용',
      states: {
        rise: '확대 — 우량 기업까지 조달 비용 상승',
        fall: '축소 — 신용 여건 개선',
        high: '높은 구간 — 신용 여건 악화가 우량 기업까지 확산',
        low: '낮은 구간 — 우량 기업 조달 여건 매우 우호적',
        flat: '안정'
      },
      pairs: [
        { when: S => S.up('ig_spread') && S.up('hy_spread'), text: '하이일드도 확대 → 신용 위험 회피가 전반적' },
        { when: S => S.up('hy_spread') && !S.up('ig_spread'), text: '하이일드만 확대 → 위험이 저신용 쪽에 집중' }
      ],
      watch: '대형 회사채 발행 · 은행 대출 태도 조사(분기)'
    },
    nfci: {
      what: '시카고 연은 금융여건지수(주간) — 0보다 크면 평균보다 긴축적',
      states: {
        rise: '긴축 방향 — 자금 조달·위험 여건 악화',
        fall: '완화 방향',
        high: '평균보다 긴축적 — 신용·유동성 여건 점검',
        low: '매우 완화적 — 위험선호 우호적',
        flat: '안정'
      },
      pairs: [
        { when: S => S.v('nfci') < 0 && S.v('us_ffr') >= 4, text: '정책금리는 높은데 금융여건은 완화적 → 긴축 효과가 시장에서 덜 느껴지는 상태' },
        { when: S => S.up('nfci') && S.up('hy_spread'), text: '스프레드 확대 동반 → 신용 쪽에서 긴축 진행' }
      ],
      watch: '매주 수요일 발표'
    },
    stlfsi: {
      what: '세인트루이스 연은 금융스트레스지수(주간) — 0 = 평균 수준의 스트레스',
      states: {
        rise: '스트레스 상승 — 시장 불안 요인 확인',
        fall: '스트레스 완화',
        high: '평균 이상 스트레스 — 금융 불안 국면',
        low: '낮은 스트레스',
        flat: '안정'
      },
      pairs: [
        { when: S => S.up('stlfsi') && S.up('vix'), text: '변동성 상승 동반 → 시장 전반의 불안' },
        { when: S => S.up('stlfsi') && S.down('etf_kre'), text: '지역은행 약세 동반 → 은행권 스트레스 여부 확인' }
      ],
      watch: '매주 목요일 발표'
    },
    fed_bs: {
      what: '연준 총자산(조 달러) — 양적완화·긴축으로 늘고 주는 시중 유동성의 원천',
      states: {
        rise: '자산 증가 — 유동성 공급 확대 (긴급 대출이면 금융 불안 신호일 수도)',
        fall: '자산 감소(양적긴축) — 유동성 축소 방향',
        flat: '변화 작음 — 양적긴축 종료·속도 조절 여부 확인'
      },
      pairs: [
        { when: S => S.down('fed_bs') && S.up('nfci'), text: '양적긴축 + 금융여건 긴축 → 유동성 축소 효과 확인' },
        { when: S => S.up('fed_bs') && S.up('stlfsi'), text: '자산 증가 + 금융 스트레스 상승 → 긴급 유동성 공급 가능성' }
      ],
      watch: '매주 목요일 H.4.1 발표 · FOMC 대차대조표 정책'
    },
    m2: {
      what: '미국 M2 통화량 증가율(전년비) — 시중에 풀린 돈의 증가 속도',
      states: {
        rise: '통화량 증가율 확대 — 유동성 개선',
        fall: '통화량 증가율 둔화',
        low: '감소 또는 정체 — 유동성 위축',
        high: '빠른 증가 — 자산가격·물가 상방 요인',
        flat: '흐름 유지'
      },
      pairs: [
        { when: S => S.up('m2') && S.down('fed_bs'), text: '양적긴축에도 통화량 증가 → 은행 대출 등 민간 신용 확대' },
        { when: S => S.v('m2') < 0, text: '통화량 감소 → 역사적으로 드문 유동성 위축' }
      ],
      watch: '매월 넷째 주 화요일 발표'
    },

    /* ───────── 환율·변동성 ───────── */
    usdkrw: {
      what: '원/달러 환율 — 오르면 원화 약세, 수입물가·해외자산 원화 가치에 직결',
      states: {
        surge: '원화 급약세 — 수입물가·해외 결제 비용 급등, 외환 당국 대응 주목',
        rise: '원화 약세 — 수입물가 상승, 해외자산 원화 환산 가치 증가',
        fall: '원화 강세 — 수입 원가 부담 완화, 해외자산 원화 가치 감소',
        plunge: '원화 급강세 — 해외자산 원화 환산 손실 확대',
        high: '원화 약세 구간 — 수입물가·환노출 점검',
        low: '원화 강세 구간',
        flat: '안정'
      },
      pairs: [
        { when: S => S.up('usdkrw') && S.up('dxy'), text: '달러인덱스도 상승 → 글로벌 달러 강세가 원인' },
        { when: S => S.up('usdkrw') && !S.up('dxy'), text: '달러는 강하지 않은데 원화만 약세 → 한국 고유 요인(수출·외국인 매도) 점검' },
        { when: S => S.up('usdkrw') && S.up('usdcny'), text: '위안화 약세 동반 → 아시아 통화 동반 약세' },
        { when: S => has(S, 'us_ffr', 'kr_base') && S.v('us_ffr') - S.v('kr_base') >= 1, text: '한미 금리차 확대 상태 → 원화 약세 압력 요인' }
      ],
      watch: '수출입 통계 · 외국인 증권 매매 · 한미 통화정책 · 외환 당국 발언'
    },
    dxy: {
      what: '달러인덱스 — 유로·엔 등 6개 통화 대비 달러 가치',
      states: {
        rise: '달러 강세 — 신흥국 통화·원자재 가격 하방 압력, 미국 밖 달러 부채 부담',
        fall: '달러 약세 — 원자재·신흥국 자산에 우호적',
        high: '달러 강세 구간 — 글로벌 유동성 위축',
        low: '달러 약세 구간',
        flat: '보합'
      },
      pairs: [
        { when: S => S.up('dxy') && S.up('us2y'), text: '미국 단기금리 상승 동반 → 금리 차가 달러를 지지' },
        { when: S => S.up('dxy') && S.up('gold'), text: '달러와 금이 함께 상승 → 안전자산 수요가 강한 국면' },
        { when: S => S.down('dxy') && S.up('etf_eem'), text: '신흥국 주식 강세 동반 → 위험선호·자금 유입' }
      ],
      watch: 'FOMC·ECB·일본은행 · 미국 고용·물가'
    },
    usdjpy: {
      what: '엔/달러 환율 — 오르면 엔화 약세, 엔캐리 거래와 아시아 금융시장의 변수',
      states: {
        rise: '엔화 약세 — 미·일 금리 차 반영, 엔캐리 거래 확대 가능성',
        fall: '엔화 강세 — 위험회피 또는 일본 통화정책 변화',
        plunge: '엔화 급강세 — 엔캐리 청산 시 세계 위험자산 동반 급락 사례 있음',
        high: '엔화 약세 심화 — 일본 당국 개입 경계 구간',
        low: '엔화 강세 구간',
        flat: '보합'
      },
      pairs: [
        { when: S => S.up('usdjpy') && S.up('us10y'), text: '미국 금리 상승 동반 → 금리 차가 엔화 약세를 주도' },
        { when: S => S.down('usdjpy') && S.up('vix'), text: '엔화 강세 + 변동성 상승 → 위험회피 흐름' }
      ],
      watch: '일본은행 회의 · 일본 당국 발언 · 미국 금리'
    },
    eurusd: {
      what: '유로/달러 — 1유로당 달러, 오르면 달러 약세',
      states: {
        rise: '유로 강세(달러 약세)',
        fall: '유로 약세(달러 강세) — 유럽 경기·금리 차 확인',
        high: '유로 강세 구간',
        low: '유로 약세 구간 — 유럽 수입 에너지 비용 부담',
        flat: '보합'
      },
      pairs: [
        { when: S => S.down('eurusd') && S.up('natgas'), text: '가스 가격 상승 동반 → 유럽 에너지 부담이 유로 약세 요인' },
        { when: S => S.up('eurusd') && S.down('dxy'), text: '달러인덱스 하락과 일치 → 달러 전반 약세' }
      ],
      watch: 'ECB 회의 · 유로존 물가·PMI'
    },
    usdcny: {
      what: '위안/달러 — 오르면 위안화 약세, 중국 경기와 아시아 통화의 기준',
      states: {
        rise: '위안화 약세 — 중국 경기 부진·자본 유출 우려, 아시아 통화 동반 약세 가능',
        fall: '위안화 강세 — 중국 경기 기대·자금 유입',
        high: '위안화 약세 구간 — 당국 관리 여부 주시',
        low: '위안화 강세 구간',
        flat: '안정 — 당국이 관리하는 환율 특성'
      },
      pairs: [
        { when: S => S.up('usdcny') && S.up('usdkrw'), text: '원화 동반 약세 → 중국 요인이 원화에 전이' },
        { when: S => S.up('usdcny') && S.down('iron_ore'), text: '철광석 하락 동반 → 중국 경기 부진 신호' }
      ],
      watch: '인민은행 기준환율(매일) · 중국 경기 지표 · 미중 관계'
    },
    vix: {
      what: 'VIX — S&P 500 옵션으로 본 향후 30일 예상 변동성, "공포 지수"',
      states: {
        surge: '급등 — 시장 불안 급확대, 레버리지·신용 비중 점검',
        rise: '상승 — 위험 회피 심리 확대',
        fall: '하락 — 시장 심리 안정',
        high: '공포 구간 — 가격 변동폭 확대',
        low: '매우 낮은 변동성 — 안도감이 큰 구간, 충격 시 급반등 가능',
        flat: '안정'
      },
      pairs: [
        { when: S => S.up('vix') && S.up('hy_spread'), text: '신용 스프레드도 확대 → 주식·신용 동시 위험 회피' },
        { when: S => S.up('vix') && S.down('usdjpy'), text: '엔화 강세 동반 → 엔캐리 청산형 위험회피 가능성' },
        { when: S => S.pos('vix') <= 10, text: '최근 2년 중 하위권 → 낙관 국면' }
      ],
      watch: 'FOMC·CPI 발표일 · 옵션 만기(매월 셋째 금요일)'
    },

    /* ───────── ETF ───────── */
    etf_tlt: {
      what: 'TLT — 미국 20년+ 장기국채, 장기금리와 반대로 움직임',
      states: etfStates('장기채'),
      pairs: [
        { when: S => S.up('us30y') || S.up('us10y'), text: '장기금리 상승 중 → 가격 하락 압력' },
        { when: S => S.up('etf_tlt') && S.down('sp500'), text: '주식 하락 속 장기채 상승 → 안전자산 역할' },
        { when: S => S.down('etf_tlt') && S.down('sp500'), text: '주식·장기채 동반 하락 → 금리 상승이 모든 자산을 누르는 국면' }
      ],
      watch: '10년·30년 입찰 · CPI · FOMC'
    },
    etf_tip: {
      what: 'TIP — 미국 물가연동국채, 실질금리와 반대로 움직이고 물가가 오르면 원금이 늘어남',
      states: etfStates('물가연동채'),
      pairs: [
        { when: S => S.up('real10y'), text: '실질금리 상승 중 → 가격 하락 압력' },
        { when: S => S.up('bei10y'), text: '기대인플레이션 상승 → 일반 국채보다 상대적으로 유리' }
      ],
      watch: '실질금리 · CPI'
    },
    etf_hyg: {
      what: 'HYG — 미국 하이일드 회사채, 신용 위험선호를 그대로 반영',
      states: etfStates('하이일드채'),
      pairs: [
        { when: S => S.up('hy_spread'), text: '스프레드 확대 중 → 가격 하락 압력' },
        { when: S => S.down('etf_hyg') && S.down('sp500'), text: '주식과 동반 하락 → 위험자산 전반 회피' }
      ],
      watch: '하이일드 스프레드 · 부도 뉴스'
    },
    etf_uup: {
      what: 'UUP — 달러 강세 ETF, 달러인덱스(DXY)를 따라감',
      states: etfStates('달러'),
      pairs: [
        { when: S => S.up('etf_uup') && S.up('usdkrw'), text: '원/달러도 상승 → 원화 기준으로 달러 강세 체감' },
        { when: S => S.up('us2y'), text: '미국 단기금리 상승 → 달러 지지 요인' }
      ],
      watch: 'FOMC · 미국 고용·물가'
    },
    etf_xle: {
      what: 'XLE — 미국 에너지 업종(정유·석유 기업) 주식',
      states: etfStates('에너지주'),
      pairs: [
        { when: S => S.up('etf_xle') && S.up('wti'), text: '유가와 동반 → 유가가 업종을 주도' },
        { when: S => S.up('etf_xle') && !S.up('wti'), text: '유가와 무관하게 강세 → 정제 마진·주주환원 등 업종 요인' },
        { when: S => S.down('etf_xle') && S.up('wti'), text: '유가 상승에도 약세 → 유가 지속성에 대한 의구심' }
      ],
      watch: '유가 · 정제 마진 · 실적 시즌'
    },
    etf_gld: {
      what: 'GLD — 금 현물 ETF, 금 가격을 그대로 따라감',
      states: etfStates('금'),
      pairs: [
        { when: S => S.down('real10y'), text: '실질금리 하락 → 금에 우호적' },
        { when: S => S.up('etf_gld') && S.up('vix'), text: '변동성 상승 동반 → 안전자산 수요' }
      ],
      watch: '실질금리 · 달러 · 중앙은행 금 매입'
    },
    etf_lit: {
      what: 'LIT — 리튬 채굴·배터리 기업 주식, 리튬 가격과 전기차 수요의 대용',
      states: etfStates('리튬·배터리주'),
      pairs: [
        { when: S => S.up('lithium'), text: '리튬 가격(직접 입력)도 상승 → 업종과 원자재 동반' },
        { when: S => S.up('nickel') || S.up('copper'), text: '배터리·전기 금속 강세 동반' },
        { when: S => S.up('real10y'), text: '실질금리 상승 → 성장 업종 밸류에이션 부담' }
      ],
      watch: '전기차 판매 · 리튬 가격 · 배터리 정책'
    },
    etf_dbc: {
      what: 'DBC — 원자재 종합(에너지 비중 큼) 선물 ETF, 인플레이션 압력의 대용',
      states: etfStates('원자재 종합'),
      pairs: [
        { when: S => S.up('etf_dbc') && S.up('bei10y'), text: '기대인플레이션 상승 동반 → 물가 압력 신호' },
        { when: S => S.up('etf_dbc') && S.up('dxy'), text: '달러 강세에도 원자재 상승 → 공급 요인 가능성' },
        { when: S => S.down('etf_dbc') && S.down('copper'), text: '산업금속도 하락 → 수요 둔화 신호' }
      ],
      watch: '유가 · 달러 · 중국 경기 (선물 롤오버 비용으로 장기 수익률은 현물과 다를 수 있음)'
    },
    etf_dba: {
      what: 'DBA — 농산물 종합 선물 ETF(곡물·설탕·커피·가축)',
      states: etfStates('농산물'),
      pairs: [
        { when: S => S.up('etf_dba') && (S.up('wheat') || S.up('corn') || S.up('soybean')), text: '곡물 가격 상승 동반 → 식품 물가 상방 요인' },
        { when: S => S.up('natgas'), text: '천연가스 상승 → 비료 원가 경로' }
      ],
      watch: 'USDA WASDE · 기상 · 달러'
    },
    etf_bwet: {
      what: 'BWET — 유조선 운임 선물 ETF, 원유·석유제품 해상 운송비',
      states: etfStates('유조선 운임'),
      pairs: [
        { when: S => S.up('etf_bwet') && S.up('brent'), text: '유가와 동반 상승 → 원유 물동량 증가 또는 운송 차질' },
        { when: S => S.up('etf_bwet') && S.up('bdry'), text: '벌크선 운임도 상승 → 해운 전반 강세' }
      ],
      watch: '산유국 수출 · 중동 해상 운송 위험 · 제재 뉴스 (규모가 작은 ETF라 가격 변동 큼)'
    },
    etf_xli: {
      what: 'XLI — 미국 산업재 업종(기계·항공·운송·방산)',
      states: etfStates('산업재'),
      pairs: [
        { when: S => S.up('etf_xli') && S.up('copper'), text: '구리 강세 동반 → 제조업 경기 기대' },
        { when: S => S.down('etf_xli') && S.down('indpro'), text: '산업생산 둔화 동반 → 제조업 경기 둔화' }
      ],
      watch: 'ISM 제조업 지수 · 산업생산 · 설비투자'
    },
    etf_itb: {
      what: 'ITB — 미국 주택건설 업종, 모기지 금리에 가장 민감한 업종 중 하나',
      states: etfStates('주택건설주'),
      pairs: [
        { when: S => S.up('mortgage'), text: '모기지 금리 상승 중 → 주택 수요 부담' },
        { when: S => S.down('mortgage') && S.up('etf_itb'), text: '모기지 금리 하락에 반응 → 주택 수요 회복 기대' }
      ],
      watch: '모기지 금리 · 주택 착공·판매'
    },
    etf_kre: {
      what: 'KRE — 미국 지역은행, 금리차·예금 이탈·상업용 부동산 대출 위험에 민감',
      states: etfStates('지역은행'),
      pairs: [
        { when: S => S.down('etf_kre') && S.up('hy_spread'), text: '신용 스프레드 확대 동반 → 금융권 스트레스 신호' },
        { when: S => S.up('spread') && S.up('etf_kre'), text: '장단기 금리차 확대 → 예대마진 개선 기대' },
        { when: S => S.lvl('stlfsi') >= 1, text: '금융스트레스지수 평균 상회 → 은행권 위험 점검' }
      ],
      watch: '은행 실적 · 상업용 부동산 · 예금 동향(H.8 주간)'
    },
    etf_ewy: {
      what: 'EWY — 한국 주식 ETF(달러 기준), 외국인 관점의 한국 시장 = 코스피 × 원화 가치',
      states: etfStates('한국 ETF'),
      pairs: [
        { when: S => S.up('kospi') && S.down('etf_ewy'), text: '코스피는 오르는데 EWY는 하락 → 원화 약세가 달러 수익을 깎는 중' },
        { when: S => S.up('etf_ewy') && S.down('usdkrw'), text: '원화 강세 동반 → 달러 기준 수익이 더 큼' }
      ],
      watch: '코스피 · 원/달러 · 반도체 업황'
    },
    etf_eem: {
      what: 'EEM — 신흥국 주식 종합, 달러·중국 경기·원자재에 민감',
      states: etfStates('신흥국'),
      pairs: [
        { when: S => S.up('etf_eem') && S.down('dxy'), text: '달러 약세 동반 → 신흥국 자금 유입 환경' },
        { when: S => S.down('etf_eem') && S.up('usdcny'), text: '위안화 약세 동반 → 중국 요인' },
        { when: S => S.up('etf_eem') && S.up('copper'), text: '원자재 강세 동반 → 자원 수출국 수혜' }
      ],
      watch: '달러 · 중국 경기 · 연준 정책'
    }
  });
})(window);
