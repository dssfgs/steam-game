/* sw.js - Service Worker
 * D-002: Stale-While-Revalidate
 * 先用快取即時渲染，背景抓取新版寫回快取，下次開啟生效。
 * 取得新版時以 postMessage 通知頁面顯示 toast (D-011)。
 */
const CACHE_NAME = 'hkdse-math-p2-v1';
const PRECACHE = [
  './',
  './index.html',
  './data.js',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function notifyUpdate(url) {
  self.clients.matchAll({ type: 'window' }).then((cs) => {
    cs.forEach((c) => c.postMessage({ type: 'SW_CONTENT_UPDATED', url: url }));
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                      // 同步 POST 絕不攔截
  const url = new URL(req.url);
  if (url.href.indexOf('script.google.com') !== -1) return; // Apps Script 一律走網路

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req, { ignoreSearch: false });

    const network = fetch(req).then(async (res) => {
      if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
        const clone = res.clone();
        const oldBody = cached ? await cached.clone().text().catch(() => null) : null;
        await cache.put(req, clone);
        if (oldBody !== null) {
          const newBody = await res.clone().text().catch(() => null);
          if (newBody !== null && newBody !== oldBody) notifyUpdate(req.url);
        }
      }
      return res;
    }).catch(() => null);

    if (cached) { event.waitUntil(network); return cached; }
    const fresh = await network;
    if (fresh) return fresh;
    if (req.mode === 'navigate') {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    return new Response('離線且無快取', { status: 503, statusText: 'Offline' });
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
