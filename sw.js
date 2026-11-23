// sw.js: service worker. Keeps a copy of the app shell (pages, styles, scripts, logo, fonts)
// so TR Orders opens instantly. Data always comes live from the back end and is never cached.
//
// Strategy: "stale while revalidate". The saved copy is shown right away and a fresh copy
// is fetched in the background, so a new release shows up on the next launch by itself.
// Bump VERSION (keep it equal to APP_VERSION in js/config.js) when files are added,
// removed or renamed, so old copies are cleared.

const VERSION = '0.5.0';
const SHELL_CACHE = 'tr-shell-' + VERSION;
const FONT_CACHE = 'tr-fonts-v1';

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/base.css',
  'css/admin.css',
  'js/config.js',
  'js/api.js',
  'js/router.js',
  'js/store.js',
  'js/ui.js',
  'js/money.js',
  'js/rules.js',
  'js/app.js',
  'js/screens/login.js',
  'js/screens/home.js',
  'js/screens/orders.js',
  'js/screens/customers.js',
  'js/screens/products.js',
  'js/screens/product-edit.js',
  'js/screens/package-edit.js',
  'js/screens/patches.js',
  'js/screens/customer-detail.js',
  'js/screens/customer-edit.js',
  'js/screens/settings.js',
  'js/screens/order-edit.js',
  'js/screens/order-item.js',
  'js/screens/order-detail.js',
  'assets/logo-full-sm.png',
  'assets/logo-monogram-sm.png',
  'assets/icon-180.png',
  'assets/icon-192.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith('tr-') && k !== SHELL_CACHE && k !== FONT_CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // API calls are POST: always straight to the network
  const url = new URL(req.url);

  if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(req, FONT_CACHE));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // The customer page and the test pages are always loaded fresh.
  if (url.pathname.endsWith('/view.html') || url.pathname.includes('/tests/') ||
      url.pathname.includes('/js/view/') || url.pathname.endsWith('/css/view.css') || url.pathname.endsWith('/zelle-qr.png')) return;

  // Any navigation inside the app gets the app page (routes live after the #).
  if (req.mode === 'navigate') {
    event.respondWith(staleWhileRevalidate(new Request('index.html'), SHELL_CACHE));
    return;
  }
  event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
});

// When testing on this computer, always try the network first so edits show on reload.
const DEV = ['localhost', '127.0.0.1'].includes(self.location.hostname);

/** Answer from the cache if possible, and refresh the cache from the network in the background. */
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  if (DEV && cacheName === SHELL_CACHE) {
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  }
  const cached = await cache.match(req, { ignoreSearch: cacheName === SHELL_CACHE });
  // Fonts are cross-origin (opaque), so they are fetched as is; shell files skip the HTTP cache.
  const fresh = fetch(req, cacheName === SHELL_CACHE ? { cache: 'no-cache' } : undefined)
    .then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  if (cached) {
    fresh.catch(() => {});
    return cached;
  }
  const res = await fresh;
  return res || new Response('TR Orders is offline. Please connect to the internet and try again.', {
    status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}
