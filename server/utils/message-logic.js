/** Допустимі значення аудиторії. 'custom' встановлюється автоматично. */
export const VALID_AUDIENCES = ['clients', 'trainers', 'admins', 'all'];

/** Допустимі статуси оголошення. */
export const VALID_STATUSES = ['sent', 'planned'];

/**
 * Зводить перелік отримувачів до масиву додатних цілих id користувачів.
 * Дедублікує; нечислові та нульові значення відкидаються.
 *
 * @param {unknown} value Сирі дані з тіла запиту.
 * @returns {number[]}
 */
export function normalizeRecipientIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number))].filter((id) => Number.isInteger(id) && id > 0);
}

/**
 * Зводить аудиторію до допустимого значення, інакше повертає 'clients'.
 *
 * @param {string} value
 * @returns {string}
 */
export function normalizeAudience(value) {
  return VALID_AUDIENCES.includes(value) ? value : 'clients';
}

/**
 * Зводить статус до допустимого значення, інакше повертає 'sent'.
 *
 * @param {string} value
 * @returns {string}
 */
export function normalizeStatus(value) {
  return VALID_STATUSES.includes(value) ? value : 'sent';
}

/**
 * Визначає ефективну аудиторію: якщо є конкретні отримувачі — 'custom',
 * інакше нормалізує передане значення.
 *
 * @param {number[]} recipientIds Нормалізований перелік otримувачів.
 * @param {unknown}  rawAudience  Значення з тіла запиту.
 * @returns {string}
 */
export function resolveAudience(recipientIds, rawAudience) {
  return recipientIds.length > 0 ? 'custom' : normalizeAudience(rawAudience);
}

/**
 * SQL-фільтр за роллю для вибраної аудиторії.
 * Повертає null для 'custom' (запит до БД не потрібен).
 *
 * @param {string} audience
 * @returns {string|null}
 */
export function audienceToRoleFilter(audience) {
  switch (audience) {
    case 'clients':  return `role = 'client'`;
    case 'trainers': return `role = 'trainer'`;
    case 'admins':   return `role = 'admin'`;
    case 'all':      return `role in ('client', 'trainer', 'admin', 'manager')`;
    case 'custom':   return null;
    default:         return null;
  }
}

/**
 * Перевіряє, чи є дані коректними для створення/оновлення оголошення.
 * Повертає рядок з помилкою або null якщо все гаразд.
 *
 * @param {{ subject?: unknown, status?: unknown, send_date?: unknown, send_time?: unknown }} fields
 * @returns {string|null}
 */
export function validateMessageFields({ subject, status, send_date, send_time } = {}) {
  if (!subject || typeof subject !== 'string' || !subject.trim()) {
    return 'Missing subject';
  }
  if (normalizeStatus(status) === 'planned' && (!send_date || !send_time)) {
    return 'Для запланованого повідомлення вкажіть дату і час';
  }
  return null;
}
