// App-shell cache so the app opens with no network at all. Patient data never
// goes through here — it lives in IndexedDB and syncs via /api.
const CACHE = 'clinic-os-shell-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/index.html', '/manifest.webmanifest', '/icon.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  const isPage = e.request.mode === 'navigate';
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(isPage ? '/index.html' : e.request);
      const fresh = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(isPage ? '/index.html' : e.request, res.clone());
          return res;
        })
        .catch(() => cached);
      // Pages: try network first (new version after an update), fall back to cache.
      // Hashed assets: cache first, they never change.
      if (!isPage) return cached || fresh;
      if (!cached) return fresh;
      const slow = new Promise((resolve) => setTimeout(() => resolve(cached), 2500));
      return Promise.race([fresh.then((r) => r || cached), slow]);
    }),
  );
});
