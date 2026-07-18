/**
 * Модуль Web Push підписки.
 *
 * Використовується зі сторінки налаштувань:
 *   import { subscribePush, unsubscribePush, getPushStatus } from './push.js';
 */

import { apiFetch } from './api.js';

// Тест push з DevTools: window._testPush()
window._testPush = async () => {
  const r = await apiFetch('/push/test', { method: 'POST' });
  console.log('[push] test result:', r);
};

/**
 * Конвертує base64url рядок у Uint8Array для VAPID-ключа.
 * @param {string} base64String
 * @returns {Uint8Array}
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Повертає реєстрацію service worker (чекає якщо ще не готова).
 * @returns {Promise<ServiceWorkerRegistration|null>}
 */
async function getRegistration() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

/**
 * Перевіряє поточний стан push-підписки.
 * @returns {Promise<boolean>} true якщо підписано
 */
export async function getPushStatus() {
  const reg = await getRegistration();
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

/**
 * Підписує користувача на push-сповіщення.
 * Запитує дозвіл у браузера, потім зберігає підписку на сервері.
 *
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function subscribePush() {
  if (!('Notification' in window)) {
    return { ok: false, error: 'Браузер не підтримує сповіщення' };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, error: 'Дозвіл не надано' };
  }

  const reg = await getRegistration();
  if (!reg) {
    return { ok: false, error: 'Service Worker недоступний' };
  }

  try {
    const { publicKey } = await apiFetch('/push/vapid-key');
    if (!publicKey) return { ok: false, error: 'VAPID ключ відсутній' };

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    await apiFetch('/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(sub.toJSON()),
    });

    return { ok: true };
  } catch (e) {
    console.error('[push] subscribe error:', e);
    return { ok: false, error: e.message || 'Помилка підписки' };
  }
}

/**
 * Відписує користувача від push-сповіщень.
 * @returns {Promise<{ ok: boolean }>}
 */
export async function unsubscribePush() {
  const reg = await getRegistration();
  if (!reg) return { ok: true };

  try {
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      await apiFetch('/push/subscribe', {
        method: 'DELETE',
        body: JSON.stringify({ endpoint }),
      });
    }
    return { ok: true };
  } catch (e) {
    console.error('[push] unsubscribe error:', e);
    return { ok: false };
  }
}
