// Service worker установленной игры: после первого запуска «Держава» открывается и без интернета.
const CACHE = 'derzhava-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './manifest.webmanifest', './icon.svg', './icon-192.png'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const put = (req, res) => {
  if (res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // страница — сначала из сети (так приходят обновления), без сети — из кэша
    e.respondWith(fetch(req).then((res) => put(req, res)).catch(() => caches.match(req).then((hit) => hit || caches.match('./'))));
    return;
  }
  // assets/ — файлы сборки с хэшем в имени, они не меняются: только кэш.
  // Остальное (иконки, манифест) — сразу из кэша, а в фоне обновляем.
  const fixed = new URL(req.url).pathname.includes('/assets/');
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit && fixed) return hit;
      const net = fetch(req).then((res) => put(req, res));
      if (!hit) return net;
      net.catch(() => {});
      return hit;
    }),
  );
});
