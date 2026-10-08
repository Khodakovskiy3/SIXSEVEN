// Cluvyra service worker. Збільшуйте версію при кожній зміні CORE_ASSETS
// чи стратегії кешування — activate видалить старі кеші.
const CACHE_NAME = 'cluvyra-v1';
const PRODUCT_NAME = 'Cluvyra';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/app',
  '/styles/landing.css',
  '/assets/brand/cluvyra-logo.svg',
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
  let data = { title: PRODUCT_NAME, body: '' };
  try { data = event.data?.json() ?? data; } catch {}

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || PRODUCT_NAME, {
        body: data.body || '',
        icon: '/assets/icons/icon-192.png',
        badge: '/assets/icons/icon-192.png',
        tag: 'cluvyra-notification',
        renotify: true,
        data: { link: data.link || '/' },
      }),
      // Сповіщаємо відкриті вкладки щоб зіграли звук
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
        list.forEach((client) => client.postMessage({ type: 'PUSH_RECEIVED', title: data.title }));
      }),
    ])
  );
});

/**
 * Безпечне посилання зі сповіщення: лише відносний шлях нашого ж домену
 * (payload push-повідомлення не повинен відкривати сторонні сайти).
 */
function resolveNotificationTarget(link) {
  try {
    const url = new URL(link || '/', self.location.origin);
    return url.origin === self.location.origin ? url.href : self.location.origin + '/';
  } catch {
    return self.location.origin + '/';
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = resolveNotificationTarget(event.notification.data?.link);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.url === target);
      if (existing) return existing.focus();
      return self.clients.openWindow(target);
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
  // Чужі домени, API (персональні дані) і завантаження користувачів
  // не кешуємо і не перехоплюємо.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api')) return;
  if (url.pathname.startsWith('/assets/uploads/')) return;

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

        // Сторінки, яких немає в кеші, отримують зрозумілу офлайн-сторінку
        // замість порожнього екрана (у встановленому PWA немає адресного рядка).
        if (request.mode === 'navigate') {
          return new Response(
            '<!doctype html><meta charset="utf-8">' +
              '<title>' + PRODUCT_NAME + ' — немає зв\'язку</title>' +
              '<div style="font:16px system-ui;padding:40px;text-align:center;background:#131F2C;color:#fff;min-height:100vh;box-sizing:border-box">' +
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
