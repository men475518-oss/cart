// オフライン対応 Service Worker（アプリシェルをキャッシュ）
// サブパス配信（例: https://example.github.io/cart/）でも動くよう、
// パスはすべて Service Worker 自身の場所を基準に解決する。
const CACHE = 'mofukart-v2';
const BASE = new URL('./', self.location).href;
const SHELL = ['', 'index.html', 'manifest.webmanifest', 'icon.svg'].map((p) => BASE + p);

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached || (req.mode === 'navigate' ? caches.match(BASE + 'index.html') : undefined));
      return cached || network;
    })
  );
});
