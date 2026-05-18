/**
 * Клієнтський шар роботи з REST API.
 *
 * Інкапсулює:
 *  • зберігання токена та користувача у localStorage;
 *  • перевірку автентифікації на захищених сторінках;
 *  • універсальну функцію apiFetch з обробкою 401 та помилок.
 */

import {
  API_BASE,
  HTTP_UNAUTHORIZED,
  PAGE,
  STORAGE_KEY,
} from './constants.js';

/**
 * Повертає поточні дані автентифікації з localStorage.
 *
 * @returns {{ token: string|null, user: object|null }}
 */
export function getAuth() {
  const token = localStorage.getItem(STORAGE_KEY.TOKEN);
  const userRaw = localStorage.getItem(STORAGE_KEY.USER);
  const user = userRaw ? JSON.parse(userRaw) : null;
  return { token, user };
}

/**
 * Зберігає токен і дані користувача у localStorage.
 *
 * @param {string} token — JWT-токен.
 * @param {object} user  — об’єкт користувача.
 */
export function setAuth(token, user) {
  localStorage.setItem(STORAGE_KEY.TOKEN, token);
  localStorage.setItem(STORAGE_KEY.USER, JSON.stringify(user));
}

/**
 * Видаляє дані автентифікації — використовується при логауті
 * та при отриманні 401-відповіді від сервера.
 */
export function clearAuth() {
  localStorage.removeItem(STORAGE_KEY.TOKEN);
  localStorage.removeItem(STORAGE_KEY.USER);
}

/**
 * Перевіряє автентифікацію та роль користувача.
 * Якщо немає токена або роль не у дозволеному переліку — редиректить на /login.
 *
 * @param {string[]} [expectedRoles] — дозволені ролі. Порожній масив = будь-яка.
 * @returns {object|null} користувач або null (тоді сторінку буде перезавантажено).
 */
export function requireAuth(expectedRoles = []) {
  const { token, user } = getAuth();
  if (!token || !user) {
    window.location.href = PAGE.LOGIN;
    return null;
  }

  if (expectedRoles.length && !expectedRoles.includes(user.role)) {
    window.location.href = PAGE.LOGIN;
    return null;
  }

  return user;
}

/**
 * Виконує запит до API з автоматичним додаванням токена та обробкою помилок.
 *
 * @param {string} path — шлях відносно /api (наприклад, '/clients/me').
 * @param {RequestInit} [options] — стандартні опції fetch.
 * @returns {Promise<any>} розпакована JSON-відповідь.
 * @throws {Error} з повідомленням сервера, якщо статус не 2xx.
 */
export async function apiFetch(path, options = {}) {
  const { token } = getAuth();
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  // 401 від сервера завжди трактуємо як «токен невалідний» —
  // чистимо локальне сховище й відсилаємо користувача на логін.
  if (response.status === HTTP_UNAUTHORIZED) {
    clearAuth();
    window.location.href = PAGE.LOGIN;
    return null;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error || 'Request failed';
    throw new Error(message);
  }

  return data;
}

/**
 * Форматує значення дати у вигляді 'YYYY-MM-DD'.
 *
 * @param {string|Date|null} value
 * @returns {string} відформатована дата або порожній рядок.
 */
export function formatDate(value) {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}
