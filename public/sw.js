const CACHE_NAME = 'sports-club-v11';
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
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        // addAll падає цілком, якщо хоч один файл недоступний, і тоді
        // Service Worker взагалі не встановлюється. Кладемо поштучно.
        Promise.all(
          CORE_ASSETS.map((asset) => cache.add(asset).catch(() => {}))
        )
      )
      .then(() => self.skipWaiting())
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

/**
 * Чи можна класти відповідь у кеш.
 * Кешуємо лише успішні (200) власні відповіді без редіректу — інакше
 * у кеш потрапляли 404/500 і потім віддавалися замість робочої сторінки,
 * а redirected-відповідь на навігацію взагалі кидає помилку.
 */
function isCacheable(response) {
  return response && response.status === 200 && response.type === 'basic' && !response.redirected;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Чужі домени та API не кешуємо і не перехоплюємо.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (isCacheable(response)) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(async () => {
        // Мережа недоступна — віддаємо копію з кешу.
        const cached = await caches.match(request);
        if (cached) return cached;

        // Сторінки кабінетів у CORE_ASSETS не входять, тож при першому
        // офлайн-заході кеш порожній. Раніше тут повертався undefined,
        // і respondWith(undefined) валив навігацію жорсткою помилкою —
        // у встановленому PWA (без адресного рядка) користувач лишався
        // на порожньому екрані без можливості повернутись.
        if (request.mode === 'navigate') {
          const shell =
            (await caches.match('/pages/home/index.html')) ||
            (await caches.match('/index.html'));
          if (shell) return shell;

          return new Response(
            '<!doctype html><meta charset="utf-8">' +
              '<title>OLIMP — немає зв\'язку</title>' +
              '<div style="font:16px system-ui;padding:40px;text-align:center">' +
              '<h1>Немає зв\'язку</h1>' +
              '<p>Перевірте підключення до інтернету та спробуйте ще раз.</p>' +
              '<button onclick="location.reload()" ' +
              'style="padding:10px 20px;font:inherit;cursor:pointer">Оновити</button>' +
              '</div>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        }

        // Для решти ресурсів (css/js/зображення) — коректна порожня
        // відповідь замість undefined, щоб не ламати сторінку.
        return new Response('', { status: 504, statusText: 'Offline' });
      })
  );
});
