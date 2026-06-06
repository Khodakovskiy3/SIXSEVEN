/**
 * Спільні константи клієнтської частини.
 *
 * Містить шляхи до сторінок, префікс API та ключі localStorage,
 * щоб уникнути магічних рядків у решті клієнтського коду.
 */

/** Префікс для всіх API-запитів. */
export const API_BASE = '/api';

/** Шляхи до сторінок ролей. Використовуються для редиректів після логіну. */
export const PAGE = Object.freeze({
  HOME: '/pages/home/index.html',
  LOGIN: '/pages/auth/login.html',
  ADMIN: '/pages/admin/index.html',
  MANAGER: '/pages/manager/index.html',
  TRAINER: '/pages/trainer/index.html',
  CLIENT: '/pages/client/index.html',
});

/** Ключі для зберігання даних автентифікації у localStorage. */
export const STORAGE_KEY = Object.freeze({
  TOKEN: 'token',
  USER: 'user',
  SETTINGS: 'clientSettings',
});

/** Ролі користувачів — копія серверного списку для перевірок на клієнті. */
export const ROLE = Object.freeze({
  ADMIN: 'admin',
  MANAGER: 'manager',
  TRAINER: 'trainer',
  CLIENT: 'client',
});

/** HTTP-статуси, які клієнтський код розрізняє окремо. */
export const HTTP_UNAUTHORIZED = 401;

/** Кольори повідомлень про успіх/помилку у формах. */
export const MESSAGE_COLOR = Object.freeze({
  SUCCESS: '#1e8449',
  ERROR: '#c0392b',
});

/** Шлях до Service Worker для PWA. */
export const SERVICE_WORKER_URL = '/sw.js';
