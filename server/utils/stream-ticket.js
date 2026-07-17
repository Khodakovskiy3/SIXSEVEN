/**
 * Одноразові короткоживучі квитки для авторизації SSE-стрімів.
 *
 * Проблема: EventSource (SSE у браузері) не вміє надсилати заголовок
 * Authorization, а класти JWT у query-рядок небезпечно (потрапляє в логи).
 * Рішення: авторизований клієнт спершу звичайним запитом (з Bearer-токеном)
 * отримує випадковий квиток, а потім відкриває SSE з ?ticket=... Квиток
 * живе кілька секунд, одноразовий і не містить персональних даних.
 *
 * Сховище — у пам'яті процесу (для одного інстансу цього достатньо).
 */

import crypto from 'node:crypto';

/** Час життя квитка — достатньо, щоб одразу відкрити SSE. */
const TICKET_TTL_MS = 30 * 1000;

/** @type {Map<string, { userId: number, role: string, expires: number }>} */
const tickets = new Map();

/** Прибирає прострочені квитки (викликається принагідно). */
function sweep() {
  const now = Date.now();
  for (const [key, value] of tickets) {
    if (value.expires <= now) {
      tickets.delete(key);
    }
  }
}

/**
 * Створює одноразовий квиток для користувача.
 *
 * @param {{ id: number, role: string }} user
 * @returns {string} випадковий квиток.
 */
export function issueTicket(user) {
  sweep();
  const ticket = crypto.randomBytes(24).toString('hex');
  tickets.set(ticket, {
    userId: user.id,
    role: user.role,
    expires: Date.now() + TICKET_TTL_MS,
  });
  return ticket;
}

/**
 * Погашає квиток і повертає пов'язаного користувача (або null).
 * Квиток одноразовий: після успішного використання видаляється.
 *
 * @param {unknown} ticket
 * @returns {{ userId: number, role: string } | null}
 */
export function redeemTicket(ticket) {
  if (typeof ticket !== 'string' || !ticket) {
    return null;
  }
  const entry = tickets.get(ticket);
  if (!entry) {
    return null;
  }
  tickets.delete(ticket);
  if (entry.expires <= Date.now()) {
    return null;
  }
  return { userId: entry.userId, role: entry.role };
}
