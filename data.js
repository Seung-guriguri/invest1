/* =====================================================================
 * data.js — 데이터 모듈
 *
 * 화면(index.html)은 이 모듈의 공개 API(window.DataStore)만 사용합니다.
 *
 * 데이터는 두 군데에서 옵니다.
 *   1) 자동 데이터: data/latest.json
 *      GitHub Actions(scripts/fetch-data.mjs)가 FRED·Yahoo·한국은행에서 받아 배포 때 함께 올림.
 *      브라우저는 같은 사이트의 파일만 읽으므로 CORS·API 키 문제가 없습니다.
 *      마지막으로 받은 파일은 localStorage에 캐시해 오프라인에서도 보입니다.
 *   2) 직접 입력: localStorage (자동 소스가 없는 지표, 또는 자동 값 덮어쓰기)
 *
 * 두 데이터는 기준일로 합쳐지고, 같은 기준일이면 직접 입력 값이 우선합니다.
 * 자동 데이터가 하나라도 있으면 샘플 값은 쓰지 않습니다.
 *
 * 저장 구조 (localStorage)
 *   macroDash.data.v1     : { version, series: { [지표ID]: [{date, value, source, updatedAt}, ...] } } — 직접 입력
 *   macroDash.remote.v1   : data/latest.json 캐시
 *   macroDash.settings.v1 : 화면 설정 (테마, 탭, 차트 기간)
 *
 * 다른 자동 소스를 붙이려면 scripts/sources.mjs 에 소스를 추가하면 됩니다 (README 참고).
 * ===================================================================== */
(function (global) {
  'use strict';

  const DATA_KEY = 'macroDash.data.v1';
  const REMOTE_KEY = 'macroDash.remote.v1';
  const SETTINGS_KEY = 'macroDash.settings.v1';
  const REMOTE_URL = 'data/latest.json';
  const AI_URL = 'data/ai.json';           // AI 인사이트 (하루 1회 생성, 없을 수 있음)
  const AI_KEY = 'macroDash.ai.v1';
  const MAX_HISTORY = 60; // 직접 입력 이력 보관 개수

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
  const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

  /* ---------- 상태 ---------- */
  let state = readJSON(DATA_KEY);
  if (!state || typeof state !== 'object' || !state.series) state = { version: 1, series: {} };
  let remote = validRemote(readJSON(REMOTE_KEY));
  let remoteStatus = { loaded: !!remote, fromCache: !!remote, error: null };
  let ai = readJSON(AI_KEY);
  let cache = {}; // 합친 이력 메모

  function validRemote(r) {
    return r && typeof r === 'object' && r.series && typeof r.series === 'object' ? r : null;
  }
  function changed() { cache = {}; }
  function persist() { writeJSON(DATA_KEY, state); changed(); }
  const hasRemote = () => !!(remote && Object.keys(remote.series).length);

  /* ---------- 자동 데이터 ---------- */
  async function loadRemote() {
    try {
      const res = await fetch(REMOTE_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status === 404 ? '자동 데이터 파일 없음 (아직 Actions가 실행되지 않음)' : `HTTP ${res.status}`);
      const r = validRemote(await res.json());
      if (!r) throw new Error('자동 데이터 형식 오류');
      remote = r;
      writeJSON(REMOTE_KEY, r);
      remoteStatus = { loaded: true, fromCache: false, error: null };
    } catch (e) {
      remoteStatus = { loaded: !!remote, fromCache: !!remote, error: e.message };
    }
    try {
      const r = await fetch(AI_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) { const j = await r.json(); if (j && j.briefing) { ai = j; writeJSON(AI_KEY, j); } }
    } catch (e) { /* AI 해설은 없어도 됨 — 캐시 유지 */ }
    changed();
    return remoteStatus;
  }

  /** AI 인사이트 (없으면 null) */
  function getAI() { return ai && ai.briefing ? ai : null; }

  function remoteInfo() {
    return Object.assign({}, remoteStatus, {
      generatedAt: remote ? remote.generatedAt : null,
      count: remote ? Object.keys(remote.series).length : 0,
      errors: remote ? remote.errors || [] : []
    });
  }

  /** 지표의 자동 데이터 메타 (출처, 주기, 수집 시각) */
  function getMeta(id) {
    const s = remote && remote.series[id];
    return s ? { source: s.source, freq: s.freq, fetchedAt: s.fetchedAt } : null;
  }

  /* ---------- 조회 ---------- */
  /** 자동 + 직접 입력을 합친 이력 (기준일 내림차순). [0]=현재, [1]=직전 */
  function getHistory(id) {
    if (cache[id]) return cache[id];
    const map = new Map();
    const rs = remote && remote.series[id];
    if (rs && Array.isArray(rs.obs)) {
      const origin = String(rs.source || '').split(':')[0] || 'auto';
      rs.obs.forEach(([date, value]) => map.set(date, { date, value, source: 'auto', origin, updatedAt: rs.fetchedAt || remote.generatedAt }));
    }
    const skipSample = hasRemote();
    (state.series[id] || []).forEach(e => { if (!(skipSample && e.source === 'sample')) map.set(e.date, e); });
    cache[id] = [...map.values()].sort(byDateDesc);
    return cache[id];
  }

  function getSnapshot(id) {
    const history = getHistory(id);
    return { current: history[0] || null, prev: history[1] || null, history };
  }

  /** 직접 입력한 값만 (편집 화면·백업용) */
  function getManual(id) { return (state.series[id] || []).slice(); }

  /* ---------- 직접 입력 ---------- */
  /**
   * 값 추가/수정. 같은 기준일 값이 있으면 덮어씀.
   * 실제 값(샘플이 아닌 값)을 넣으면 그 지표의 샘플 값은 모두 지움.
   */
  function upsert(id, entry) {
    const value = Number(entry.value);
    if (!Number.isFinite(value)) throw new Error('숫자가 아닌 값입니다.');
    if (!DATE_RE.test(entry.date || '')) throw new Error('기준일 형식이 올바르지 않습니다 (YYYY-MM-DD).');
    const source = entry.source || 'manual';
    let list = (state.series[id] || []).filter(e => e.date !== entry.date);
    if (source !== 'sample') list = list.filter(e => e.source !== 'sample');
    list.push({ date: entry.date, value, source, updatedAt: entry.updatedAt || new Date().toISOString() });
    state.series[id] = list.sort(byDateDesc).slice(0, MAX_HISTORY);
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

  function hasAnyData() { return Object.keys(state.series).length > 0 || hasRemote(); }

  /* ---------- 샘플 데이터 ----------
   * 자동 데이터가 없을 때 화면 시연용으로만 쓰는 가짜 값입니다. 일부러 둥근 숫자를 사용했습니다.
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

  /* ---------- 백업 (직접 입력 값만. 자동 데이터는 다시 받으면 되므로 제외) ---------- */
  function exportJSON() {
    return JSON.stringify({
      app: 'macro-dashboard',
      version: 1,
      exportedAt: new Date().toISOString(),
      series: state.series
    }, null, 2);
  }

  /** 백업 파일 내용을 검증한 뒤 직접 입력 데이터를 교체. 불러온 지표 개수 반환 */
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
          source: ['manual', 'sample', 'import'].includes(e.source) ? e.source : 'import',
          updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : new Date().toISOString()
        }));
      if (clean.length) series[id] = clean.sort(byDateDesc).slice(0, MAX_HISTORY);
    });
    state = { version: 1, series };
    persist();
    return Object.keys(series).length;
  }

  /* ---------- 설정 ---------- */
  function getSettings() { return Object.assign({ theme: 'system', tab: 'rates', range: null }, readJSON(SETTINGS_KEY)); }
  function setSettings(patch) { writeJSON(SETTINGS_KEY, Object.assign(getSettings(), patch)); }

  // 이전 버전에서 저장했던 브라우저용 API 키는 더 이상 쓰지 않으므로 정리
  try { localStorage.removeItem('macroDash.secrets.v1'); } catch (e) {}

  global.DataStore = {
    loadRemote, remoteInfo, hasRemote, getMeta, getAI,
    getHistory, getSnapshot, getManual, upsert, removeEntry, clearAll, hasAnyData,
    loadSample, exportJSON, importJSON,
    getSettings, setSettings, isoDate
  };
})(window);
