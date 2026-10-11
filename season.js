/* =====================================================================
 * season.js — 계절 요인 메모 (규칙 기반, 일반적인 계절 패턴만)
 *
 * 카드 아래 "🗓 지금은 ○○ 시기" 한 줄과 AI 브리핑 프롬프트의 [이번 달 계절 요인] 에 쓰입니다.
 *   GROUPS[그룹] = [{ m: [해당 월...], text }]   — 월은 한국시간 기준 1~12
 *   IDS[지표 id] = 그룹
 * 실제 데이터로 확인된 사실이 아니라 "그런 시기"라는 일반론입니다. 단정 표현은 쓰지 않습니다.
 * 브라우저(window)와 Node(ai-insight.mjs, globalThis) 양쪽에서 읽습니다.
 * ===================================================================== */
(function (global) {
  'use strict';

  const GROUPS = {
    gas: [
      { m: [11, 12, 1, 2, 3], text: '난방 시즌 — 가스 수요가 가장 많고 한파 뉴스에 가격이 크게 출렁이기 쉬운 시기' },
      { m: [4, 5, 9, 10], text: '봄·가을 비수기 — 수요가 약해 가격이 처지기 쉽고 저장량 채우는 속도가 관건' },
      { m: [6, 7, 8], text: '여름 냉방 시즌 — 폭염 때 발전용 가스 수요가 늘어나는 시기' }
    ],
    gasStorage: [
      { m: [4, 5, 6, 7, 8, 9, 10], text: '주입 시즌 — 겨울에 대비해 저장량을 채우는 시기' },
      { m: [11, 12, 1, 2, 3], text: '인출 시즌 — 난방용으로 저장량을 꺼내 쓰는 시기' }
    ],
    gasoline: [
      { m: [2, 3, 4, 5], text: '여름용 휘발유 전환기 — 원가가 비싼 여름 규격으로 바뀌며 휘발유값·정유 마진이 오르기 쉬운 시기' },
      { m: [6, 7, 8], text: '드라이빙 시즌 — 휘발유 수요가 연중 가장 많은 시기' },
      { m: [9, 10, 11], text: '여름 시즌 종료 — 겨울 규격 전환으로 휘발유값·마진이 약해지기 쉬운 시기' },
      { m: [12, 1], text: '비수기 — 휘발유 수요가 연중 가장 적은 시기' }
    ],
    distillate: [
      { m: [11, 12, 1, 2, 3], text: '난방 시즌 — 난방유 수요로 디젤값이 강해지기 쉬운 시기' },
      { m: [4, 5, 9, 10], text: '파종·수확기 — 농기계·화물용 디젤 수요가 늘어나는 시기' },
      { m: [6, 7, 8], text: '상대적 비수기 — 겨울에 대비해 재고를 쌓는 시기' }
    ],
    refinery: [
      { m: [2, 3, 4], text: '봄 정비 시즌 — 정비로 가동률이 낮아지는 시기' },
      { m: [9, 10], text: '가을 정비 시즌 — 정비로 가동률이 낮아지는 시기' },
      { m: [6, 7, 8], text: '여름 성수기 — 가동률이 연중 가장 높은 시기' }
    ],
    grain: [
      { m: [4, 5], text: '북반구 파종기 — 재배 면적·작황 기대가 가격에 반영되는 시기' },
      { m: [6, 7, 8], text: '날씨 장세 — 미국 작황 날씨 뉴스에 가격이 크게 흔들리는 시기' },
      { m: [9, 10, 11], text: '수확기 — 공급이 몰려 가격이 약해지기 쉬운 시기' },
      { m: [12, 1, 2, 3], text: '남미 작황 시즌 — 브라질·아르헨티나 날씨가 변수인 시기' }
    ],
    bulk: [
      { m: [1, 2], text: '춘절 전후 비수기 — 중국 공장 휴무로 벌크 운임이 약하기 쉬운 시기' },
      { m: [3, 4, 5], text: '춘절 이후 회복기 — 중국 원자재 수입이 다시 늘어나는 시기' },
      { m: [6, 7, 8, 9, 10, 11], text: '하반기 성수기 — 남미 곡물·철광석 물동량으로 운임이 강해지기 쉬운 시기' },
      { m: [12], text: '연말 — 중국 원자재 비축 수요가 운임을 받치기 쉬운 시기' }
    ],
    container: [
      { m: [1, 2], text: '춘절 직전 밀어내기 — 운임이 올랐다가 춘절 뒤 꺾이기 쉬운 시기' },
      { m: [3, 4, 5, 6], text: '비수기 — 컨테이너 물동량이 적은 시기' },
      { m: [7, 8, 9, 10], text: '성수기 — 연말 쇼핑 물량 선적으로 운임이 강하기 쉬운 시기' },
      { m: [11, 12], text: '성수기 종료 — 운임이 약해지기 쉬운 시기' }
    ],
    tanker: [
      { m: [10, 11, 12, 1, 2], text: '겨울 성수기 — 난방 수요·재고 비축으로 유조선 운임이 강하기 쉬운 시기' },
      { m: [3, 4, 5], text: '봄 정비철 — 정제 수요가 줄어 유조선 운임이 약하기 쉬운 시기' },
      { m: [6, 7, 8, 9], text: '여름 비수기 — 허리케인 때 미국 걸프 수송이 일시 차질을 빚기도 하는 시기' }
    ],
    lngShip: [
      { m: [9, 10, 11, 12, 1], text: '겨울 대비 성수기 — LNG 비축 수요로 LNG선 용선료가 강하기 쉬운 시기' },
      { m: [2, 3, 4, 5, 6, 7, 8], text: '비수기 — LNG선 용선료가 약하기 쉬운 시기' }
    ],
    coal: [
      { m: [12, 1, 2], text: '겨울 난방·발전 수요기 — 석탄 수요가 늘어나는 시기' },
      { m: [6, 7, 8], text: '여름 냉방 전력 피크 — 발전용 석탄 수요가 늘어나는 시기' },
      { m: [3, 4, 5, 9, 10, 11], text: '비수기 — 발전용 수요가 약한 시기' }
    ],
    claims: [
      { m: [1], text: '연초 — 연말 임시직 계약 종료로 청구가 튀기 쉬워 주간 수치 잡음이 큰 시기' },
      { m: [7], text: '7월 — 자동차 공장 여름 휴업으로 청구가 일시 늘 수 있는 시기' },
      { m: [11, 12], text: '연말 휴일 — 주간 수치 잡음이 큰 시기, 4주 흐름으로 볼 것' }
    ]
  };

  const IDS = {
    natgas: 'gas', ttf: 'gas', etf_ung: 'gas', lng_spread: 'gas',
    ng_storage: 'gasStorage',
    gasoline: 'gasoline', crack321: 'gasoline', gasoline_demand: 'gasoline', us_gasoline: 'gasoline',
    diesel: 'distillate', distill_demand: 'distillate', us_distill: 'distillate',
    refinery_util: 'refinery',
    wheat: 'grain', corn: 'grain', soybean: 'grain', etf_dba: 'grain',
    bdry: 'bulk', scfi: 'container',
    tanker_fro: 'tanker', tanker_stng: 'tanker', etf_bwet: 'tanker',
    lng_flng: 'lngShip',
    coal: 'coal', etf_coal: 'coal',
    claims: 'claims'
  };

  /** 한국시간 기준 현재 월 */
  const kstMonth = (d = new Date()) => new Date(d.getTime() + 9 * 3600000).getUTCMonth() + 1;

  /** 지표 id 의 이번 달 계절 메모 (없으면 null) */
  function note(id, month = kstMonth()) {
    const g = GROUPS[IDS[id]];
    const hit = g && g.find(x => x.m.includes(month));
    return hit ? hit.text : null;
  }

  /** 그룹별 이번 달 메모 목록 (AI 프롬프트용) */
  function monthNotes(month = kstMonth()) {
    const label = { gas: '천연가스', gasStorage: '가스 저장량', gasoline: '휘발유', distillate: '디젤·난방유', refinery: '정제 가동률',
      grain: '곡물', bulk: '벌크선 운임', container: '컨테이너 운임', tanker: '유조선', lngShip: 'LNG선', coal: '석탄', claims: '실업수당 청구' };
    return Object.keys(GROUPS).map(k => {
      const hit = GROUPS[k].find(x => x.m.includes(month));
      return hit ? `- ${label[k]}: ${hit.text}` : null;
    }).filter(Boolean);
  }

  global.SEASON = { GROUPS, IDS, note, monthNotes, kstMonth };
})(typeof window !== 'undefined' ? window : globalThis);
