/**
 * Підстановка даних поточного користувача у сторінки профілю.
 *
 * Замість «зашитих» у HTML значень (ім'я, email, телефон тощо) сторінки
 * позначають елементи атрибутом data-account-field, а цей модуль заповнює їх
 * реальними даними акаунта з API.
 *
 * Підтримувані поля (data-account-field):
 *  • name           — ім'я користувача;
 *  • email          — email;
 *  • phone          — телефон (клієнт/тренер; для admin/manager відсутній);
 *  • specialization — спеціалізація тренера;
 *  • initials       — ініціали для аватара (обчислюються з імені).
 *
 * Якщо значення відсутнє, береться запасне з data-account-fallback (або '').
 */

import { apiFetch, getAuth } from './api.js';

/**
 * Обчислює ініціали з імені: «Олена Коваль» → «ОК».
 *
 * @param {string} [name]
 * @returns {string}
 */
function computeInitials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  return parts.slice(0, 2).map((word) => word[0].toUpperCase()).join('');
}

/**
 * Заповнює всі елементи з data-account-field значеннями з об'єкта даних.
 *
 * @param {Record<string, unknown>} data
 */
function applyAccountFields(data) {
  document.querySelectorAll('[data-account-field]').forEach((el) => {
    const field = el.dataset.accountField;
    let value = field === 'initials' ? computeInitials(data.name) : data[field];

    if (value === undefined || value === null || value === '') {
      value = el.dataset.accountFallback ?? '';
    }

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.value = value;
    } else {
      el.textContent = value;
    }
  });
}

/**
 * Збирає дані акаунта: базові (name/email/role) з /auth/me або localStorage,
 * а телефон/спеціалізацію — з відповідного рольового ендпоінта.
 *
 * @param {string} [roleHint] — очікувана роль сторінки (резервний варіант).
 * @returns {Promise<Record<string, unknown>>}
 */
async function fetchAccount(roleHint) {
  let data = {};

  try {
    const me = await apiFetch('/auth/me');
    if (me && me.user) data = { ...me.user };
  } catch {
    // Якщо /auth/me недоступний — використовуємо кешованого користувача.
  }

  if (!data.name) {
    const { user } = getAuth();
    if (user) data = { ...user, ...data };
  }

  const role = data.role || roleHint;

  try {
    if (role === 'client') {
      const res = await apiFetch('/clients/me');
      if (res && res.client) data = { ...data, ...res.client };
    } else if (role === 'trainer') {
      const res = await apiFetch('/trainers/me');
      if (res) data = { ...data, ...res };
    } else if (role === 'admin' || role === 'manager') {
      const res = await apiFetch('/auth/profile');
      if (res && res.user && res.user.phone) data = { ...data, phone: res.user.phone };
    }
  } catch {
    // Телефон/спеціалізація — необов'язкові: показуємо запасні значення.
  }

  return data;
}

/**
 * Підтягує дані акаунта й підставляє їх у сторінку.
 * Нічого не робить, якщо на сторінці немає елементів data-account-field.
 *
 * @param {{ role?: string }} [options]
 * @returns {Promise<Record<string, unknown>|null>}
 */
export async function hydrateAccount(options = {}) {
  if (!document.querySelector('[data-account-field]')) return null;
  const data = await fetchAccount(options.role);
  applyAccountFields(data);
  return data;
}
