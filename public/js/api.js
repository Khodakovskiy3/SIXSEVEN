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

function getPageByRole(role) {
  if (role === 'admin') return PAGE.ADMIN;
  if (role === 'manager') return PAGE.MANAGER;
  if (role === 'trainer') return PAGE.TRAINER;
  return PAGE.CLIENT;
}

/**
 * Перевіряє актуальну роль на сервері, а не тільки роль зі старого localStorage.
 *
 * @param {string[]} [expectedRoles] — дозволені ролі.
 * @returns {Promise<object|null>} актуальний користувач або null.
 */
export async function requireFreshAuth(expectedRoles = []) {
  const { token, user } = getAuth();
  if (!token || !user) {
    window.location.href = PAGE.LOGIN;
    return null;
  }

  try {
    const data = await apiFetch('/auth/me');
    // apiFetch повертає null при 401 (уже очистив auth і редіректнув)
    if (!data) return null;

    const freshUser = data.user;
    localStorage.setItem(STORAGE_KEY.USER, JSON.stringify(freshUser));

    if (expectedRoles.length && !expectedRoles.includes(freshUser.role)) {
      window.location.href = getPageByRole(freshUser.role);
      return null;
    }

    return freshUser;
  } catch {
    // Мережева помилка або 5xx — НЕ виходимо з облікового запису.
    // Токен валідний 7 днів, тому працюємо з кешованим користувачем.
    if (expectedRoles.length && !expectedRoles.includes(user.role)) {
      window.location.href = getPageByRole(user.role);
      return null;
    }
    return user;
  }
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
  const { skipAuthRedirect, ...fetchOptions } = options;
  const { token } = getAuth();
  const headers = new Headers(fetchOptions.headers || {});
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...fetchOptions,
    headers,
  });

  // Обробка 401 залежить від того, чи був у запиті токен:
  //  • токен БУВ — це протермінована/невалідна сесія: чистимо сховище
  //    й відсилаємо користувача на логін;
  //  • токена НЕ було (напр. форма входу) — це невірні дані входу,
  //    тож повертаємо помилку формі, щоб вона показала попередження.
  //  • skipAuthRedirect — ендпоінт навмисно повертає 401 (напр. неправильний
  //    поточний пароль): не розлогінюємо, а кидаємо помилку до форми.
  if (response.status === HTTP_UNAUTHORIZED) {
    if (token && !skipAuthRedirect) {
      clearAuth();
      window.location.href = PAGE.LOGIN;
      return null;
    }
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Невірний логін або пароль');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error || 'Request failed';
    const error = new Error(message);
    if (data.code) {
      error.code = data.code;
    }
    // Антиспам-відповіді (429) містять retryAfter — пробрасуємо його далі,
    // щоб форма могла заблокувати кнопку на потрібний час.
    if (data.retryAfter) {
      error.retryAfter = data.retryAfter;
    }
    throw error;
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
