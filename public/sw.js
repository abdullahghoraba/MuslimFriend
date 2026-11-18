/* Offline support for the web version (iPhone home-screen app). Not used by the Android app.
 * Pages: the network first, the saved copy offline. The app's own files: the saved copy at once, refreshed in the
 * background. Other sites (recitations, tafsir downloads) are left to the browser: audio needs its range requests. */
const CACHE = 'uns-web-v1';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('uns-web-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin || req.headers.has('range')) return;
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        if (res.ok) caches.open(CACHE).then((c) => c.put('index.html', copy));
        return res;
      }).catch(() => caches.match('index.html')),
    );
    return;
  }
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const saved = await c.match(req);
      const fresh = fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') c.put(req, res.clone());
        return res;
      });
      if (saved) { e.waitUntil(fresh.catch(() => undefined)); return saved; }
      return fresh;
    }),
  );
});
