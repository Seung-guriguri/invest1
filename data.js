/* =====================================================================
 * data.js — 데이터 모듈
 *
 * 화면(index.html)은 이 모듈의 공개 API(window.DataStore)만 사용합니다.
 * 나중에 API 자동 조회로 바꾸고 싶다면 아래 "Provider" 영역에
 * 새 provider를 추가하고 index.html CONFIG의 지표에 source 정보를 넣으면 됩니다.
 *
 * 저장 구조 (localStorage)
 *   macroDash.data.v1     : { version, series: { [지표ID]: [{date, value, source, updatedAt}, ...] } }
 *                           각 배열은 기준일(date) 내림차순. [0]=현재 값, [1]=직전 값
 *   macroDash.settings.v1 : 화면 설정 (테마, 마지막 탭, 프록시 URL)
 *   macroDash.secrets.v1  : API 키 — 이 기기 localStorage에만 저장, JSON 내보내기에 포함되지 않음
 *
 * source 값: 'manual'(직접 입력) | 'sample'(샘플) | 'fred'(FRED 자동 조회) | 'import'(백업 불러오기)
 * ===================================================================== */
(function (global) {
  'use strict';

  const DATA_KEY = 'macroDash.data.v1';
  const SETTINGS_KEY = 'macroDash.settings.v1';
  const SECRETS_KEY = 'macroDash.secrets.v1';
  const MAX_HISTORY = 24; // 지표별 보관할 이력 개수

  /* ---------- localStorage 래퍼 (사생활 보호 모드 등에서 실패해도 앱은 동작) ---------- */
  const memory = {};
  function readJSON(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return memory[key] ? JSON.parse(memory[key]) : null;
    }
  }
  function writeJSON(key, value) {
    const raw = JSON.stringify(value);
    memory[key] = raw;
    try { localStorage.setItem(key, raw); return true; } catch (e) { return false; }
  }

  /* ---------- 날짜 유틸 ---------- */
  function isoDate(d) {
    const z = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  }
  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return isoDate(d);
  }
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  /* ---------- 상태 ---------- */
  let state = readJSON(DATA_KEY);
  if (!state || typeof state !== 'object' || !state.series) state = { version: 1, series: {} };

  function persist() { writeJSON(DATA_KEY, state); }

  function sortDesc(list) {
    return list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  /** 지표 하나의 현재/직전 값과 이력 */
  function getSnapshot(id) {
    const history = state.series[id] || [];
    return { current: history[0] || null, prev: history[1] || null, history };
  }

  /**
   * 값 추가/수정. 같은 기준일 값이 있으면 덮어씀.
   * 실제 값(샘플이 아닌 값)을 넣으면 그 지표의 샘플 값은 모두 지움 (샘플과 실제 값이 섞이지 않게).
   */
  function upsert(id, entry) {
    const value = Number(entry.value);
    if (!Number.isFinite(value)) throw new Error('숫자가 아닌 값입니다.');
    if (!DATE_RE.test(entry.date || '')) throw new Error('기준일 형식이 올바르지 않습니다 (YYYY-MM-DD).');
    const source = entry.source || 'manual';
    let list = (state.series[id] || []).filter(e => e.date !== entry.date);
    if (source !== 'sample') list = list.filter(e => e.source !== 'sample');
    list.push({ date: entry.date, value, source, updatedAt: entry.updatedAt || new Date().toISOString() });
    state.series[id] = sortDesc(list).slice(0, MAX_HISTORY);
    persist();
  }

  function removeEntry(id, date) {
    state.series[id] = (state.series[id] || []).filter(e => e.date !== date);
    if (!state.series[id].length) delete state.series[id];
    persist();
  }

  function clearAll() {
    state = { version: 1, series: {} };
    persist();
  }

  function hasAnyData() { return Object.keys(state.series).length > 0; }

  /* ---------- 샘플 데이터 ----------
   * 화면 시연용 가짜 값입니다. 실제 시세가 아니며, 일부러 둥근 숫자를 사용했습니다.
   * 화면에서는 기준일 대신 "샘플"로 표시되고, 카드에 샘플 표식이 붙습니다.
   * [현재 값, 직전 값]
   */
  const SAMPLE_DATA = {
    kr_base: [3.00, 3.25], us_ffr: [4.50, 4.50], us10y: [4.50, 4.20], us2y: [4.60, 4.40],
    us_cpi: [3.0, 2.8], kr_cpi: [2.0, 2.0], us_unemp: [4.0, 3.8],
    usdkrw: [1450, 1400], dxy: [105, 103], vix: [25, 18],
    wti: [80, 75], natgas: [3.0, 3.0], coal: [100, 110],
    copper: [10000, 9000], gold: [2000, 2000], silver: [25, 24],
    iron_ore: [100, 100], lithium: [100000, 120000], nickel: [15000, 15000],
    wheat: [250, 230], corn: [200, 190], soybean: [400, 400]
  };

  function loadSample() {
    const now = new Date().toISOString();
    state = { version: 1, series: {} };
    Object.entries(SAMPLE_DATA).forEach(([id, [cur, prev]]) => {
      state.series[id] = [
        { date: daysAgo(0), value: cur, source: 'sample', updatedAt: now },
        { date: daysAgo(7), value: prev, source: 'sample', updatedAt: now }
      ];
    });
    persist();
  }

  function isSampleOnly() {
    const lists = Object.values(state.series);
    return lists.length > 0 && lists.every(l => l.every(e => e.source === 'sample'));
  }

  /* ---------- 백업 (JSON 내보내기/불러오기) ----------
   * API 키(secrets)는 내보내기에 포함하지 않습니다.
   */
  function exportJSON() {
    return JSON.stringify({
      app: 'macro-dashboard',
      version: 1,
      exportedAt: new Date().toISOString(),
      series: state.series
    }, null, 2);
  }

  /** 백업 파일 내용을 검증한 뒤 현재 데이터를 교체. 불러온 지표 개수 반환 */
  function importJSON(text) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { throw new Error('JSON 형식이 아닙니다.'); }
    if (!obj || obj.app !== 'macro-dashboard' || typeof obj.series !== 'object') {
      throw new Error('이 대시보드의 백업 파일이 아닙니다.');
    }
    const series = {};
    Object.entries(obj.series).forEach(([id, list]) => {
      if (!/^[a-z0-9_]+$/i.test(id) || !Array.isArray(list)) return;
      const clean = list
        .filter(e => e && DATE_RE.test(e.date) && Number.isFinite(Number(e.value)))
        .map(e => ({
          date: e.date,
          value: Number(e.value),
          source: ['manual', 'sample', 'fred', 'import'].includes(e.source) ? e.source : 'import',
          updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : new Date().toISOString()
        }));
      if (clean.length) series[id] = sortDesc(clean).slice(0, MAX_HISTORY);
    });
    state = { version: 1, series };
    persist();
    return Object.keys(series).length;
  }

  /* ---------- 설정 / 비밀값 ---------- */
  function getSettings() { return Object.assign({ theme: 'system', tab: 'rates', proxy: '' }, readJSON(SETTINGS_KEY)); }
  function setSettings(patch) { writeJSON(SETTINGS_KEY, Object.assign(getSettings(), patch)); }
  function getSecrets() { return Object.assign({ fredKey: '' }, readJSON(SECRETS_KEY)); }
  function setSecrets(patch) { writeJSON(SECRETS_KEY, Object.assign(getSecrets(), patch)); }

  /* =====================================================================
   * Provider (2단계: 자동 조회)
   *
   * provider 인터페이스:
   *   {
   *     id: 'fred',
   *     label: '표시 이름',
   *     isReady(): boolean                    — 키 등 준비 여부
   *     supports(indicator): boolean          — 이 지표를 조회할 수 있는지 (indicator.source[id] 존재 등)
   *     fetch(indicator): Promise<[{date, value}]>  — 최신순 관측치 (최소 2개면 직전 대비 계산 가능)
   *   }
   *
   * 새 소스를 붙이려면 PROVIDERS 배열에 객체를 추가하고,
   * index.html CONFIG.indicators[].source 에 { 새provider: {...} } 를 넣으면 됩니다.
   * ===================================================================== */

  /** 프록시 URL 적용: '{url}'이 있으면 인코딩해서 치환, 없으면 앞에 붙임 */
  function withProxy(url) {
    const proxy = (getSettings().proxy || '').trim();
    if (!proxy) return url;
    return proxy.includes('{url}') ? proxy.replace('{url}', encodeURIComponent(url)) : proxy + url;
  }

  /*
   * FRED (미국 세인트루이스 연준) — https://fred.stlouisfed.org/docs/api/fred/
   * - 무료 API 키 필요. 키는 설정 화면에서 입력 → localStorage(secrets)에만 저장.
   * - 브라우저에서 직접 호출 시 CORS로 막힐 수 있음 → 설정의 "프록시 URL" 사용 (README 참고).
   * - indicator.source.fred = { series: 'DGS10', units: 'pc1'(선택, 전년동월비) }
   */
  const FredProvider = {
    id: 'fred',
    label: 'FRED',
    isReady() { return !!getSecrets().fredKey; },
    supports(ind) { return !!(ind.source && ind.source.fred); },
    async fetch(ind) {
      const { series, units } = ind.source.fred;
      const params = new URLSearchParams({
        series_id: series,
        api_key: getSecrets().fredKey,
        file_type: 'json',
        sort_order: 'desc',
        limit: '15'
      });
      if (units) params.set('units', units);
      const url = withProxy('https://api.stlouisfed.org/fred/series/observations?' + params);
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return (json.observations || [])
        .filter(o => o.value !== '.' && Number.isFinite(Number(o.value)))
        .slice(0, 2)
        .map(o => ({ date: o.date, value: Number(o.value) }));
    }
  };

  /*
   * (예시 자리) 공개 시세 소스 — 원자재·환율·VIX 등
   * 예: Alpha Vantage(무료 키, 원자재 월간), 거래소/정부 공개 API, 직접 만든 서버리스 함수 등.
   * 무료 시세 사이트 대부분은 브라우저 CORS를 허용하지 않으므로
   * Cloudflare Workers 같은 작은 프록시를 두고 그 응답을 {date, value} 배열로 바꿔주면 됩니다.
   *
   * const MyQuoteProvider = {
   *   id: 'quote', label: '시세',
   *   isReady() { return true; },
   *   supports(ind) { return !!(ind.source && ind.source.quote); },
   *   async fetch(ind) {
   *     const res = await fetch(withProxy('https://example.com/quote?symbol=' + ind.source.quote.symbol));
   *     const j = await res.json();
   *     return [{ date: j.date, value: j.price }, { date: j.prevDate, value: j.prevPrice }];
   *   }
   * };
   */
  const PROVIDERS = [FredProvider];

  function canAutoFetch() { return PROVIDERS.some(p => p.isReady()); }

  /**
   * 자동 조회 실행. 준비된 provider가 지원하는 지표만 조회해서 이력에 저장.
   * onProgress(message) 콜백으로 진행 상황 전달. 결과 요약 반환.
   */
  async function refreshAll(indicators, onProgress) {
    const log = msg => onProgress && onProgress(msg);
    const result = { ok: 0, fail: 0, skipped: 0 };
    for (const ind of indicators) {
      const provider = PROVIDERS.find(p => p.isReady() && p.supports(ind));
      if (!provider) { result.skipped++; continue; }
      try {
        const obs = await provider.fetch(ind);
        if (!obs.length) throw new Error('관측치 없음');
        const now = new Date().toISOString();
        obs.slice().reverse().forEach(o => upsert(ind.id, { date: o.date, value: o.value, source: provider.id, updatedAt: now }));
        result.ok++;
        log(`✓ ${ind.name} (${provider.label}) ${obs[0].date}`);
      } catch (e) {
        result.fail++;
        log(`✗ ${ind.name}: ${e.message}${e instanceof TypeError ? ' — CORS/네트워크 문제일 수 있음, 프록시 확인' : ''}`);
      }
    }
    return result;
  }

  global.DataStore = {
    getSnapshot, upsert, removeEntry, clearAll, hasAnyData, isSampleOnly,
    loadSample, exportJSON, importJSON,
    getSettings, setSettings, getSecrets, setSecrets,
    canAutoFetch, refreshAll, isoDate
  };
})(window);
