/* 서비스 워커 — 앱 파일을 캐시해 오프라인에서도 열리게 함.
 * 모든 파일을 "네트워크 우선"으로 받아 배포 즉시 새 버전이 보이게 하고,
 * 오프라인일 때만 마지막으로 받은 파일을 씁니다.
 * BUILD 는 배포 때 GitHub Actions 가 커밋 번호로 바꿔 넣습니다 → 배포마다 새 캐시, 이전 캐시 정리.
 * 직접 입력한 데이터는 localStorage에 있으므로 캐시와 무관합니다. */
const BUILD = '__BUILD__';
const CACHE = 'macro-dash-' + BUILD;
const ASSETS = [
  './', './index.html', './data.js', './manifest.json',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
  './icons/maskable-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .catch(() => {})            // 일부 실패해도 설치는 진행 (네트워크 우선이라 문제 없음)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('macro-dash-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // 캐시 키: 페이지 이동은 index.html 하나로, 자동 데이터는 쿼리 문자열 무시
  const key = req.mode === 'navigate' ? new URL('index.html', self.registration.scope).href
    : url.pathname.endsWith('/data/latest.json') ? new URL('data/latest.json', self.registration.scope).href
    : url.origin + url.pathname;

  e.respondWith(
    // cache: 'no-cache' → 브라우저 HTTP 캐시도 서버에 재확인 (GitHub Pages 기본 10분 캐시 우회)
    fetch(req.mode === 'navigate' ? req : new Request(req, { cache: 'no-cache' }))
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
        return res;
      })
      .catch(() => caches.match(key).then(r => r || caches.match(req)).then(r => r || Response.error()))
  );
});
