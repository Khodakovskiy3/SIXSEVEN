const CACHE_NAME = 'sports-club-v9';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/pages/home/index.html',
  '/styles/home.css',
  '/js/home.js',
  '/assets/home/space-bg.png',
  '/assets/home/olimp-statue.png',
  '/pages/auth/login.html',
  '/pages/auth/register.html',
  '/js/pwa.js',
  '/manifest.json',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/icon-192-maskable.png',
  '/assets/icons/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => (key === CACHE_NAME ? null : caches.delete(key))))
    ).then(() => self.clients.claim())
  );
});

// ── Web Push ──────────────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  let data = { title: 'OLIMP', body: '' };
  try { data = event.data?.json() ?? data; } catch {}

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || 'OLIMP', {
        body: data.body || '',
        icon: '/assets/icons/icon-192.png',
        badge: '/assets/icons/icon-192.png',
        tag: 'olimp-notification',
        renotify: true,
      }),
      // Сповіщаємо відкриті вкладки щоб зіграли звук
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
        list.forEach((client) => client.postMessage({ type: 'PUSH_RECEIVED', title: data.title }));
      }),
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.url.includes('/pages/'));
      if (existing) return existing.focus();
      return clients.openWindow('/');
    })
  );
});

// ── Fetch cache ───────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
