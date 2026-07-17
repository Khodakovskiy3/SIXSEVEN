/**
 * Спільні DOM/рядкові хелпери, які раніше дублювалися по кабінетах
 * (admin.js, client.js, trainer.js, home.js, manager.js).
 *
 * Модуль без побічних ефектів — лише чисті функції та константи.
 */

/**
 * Екранує рядок для безпечної вставки у innerHTML (захист від XSS).
 *
 * @param {*} value
 * @returns {string}
 */
export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/**
 * Повертає ініціали з імені: перша+остання літери для двох слів,
 * інакше — перші дві літери.
 *
 * @param {string} name
 * @returns {string}
 */
export function getInitials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : String(name).slice(0, 2).toUpperCase();
}

/** Палітра кольорів для аватарів (детермінований вибір за іменем). */
export const AVATAR_PALETTE = [
  '#e05555', '#ff6424', '#e0a020', '#4ade80',
  '#22d3ee', '#818cf8', '#f472b6', '#a78bfa',
];

/**
 * Детерміновано обирає колір аватара за іменем (однакове ім'я — той самий колір).
 *
 * @param {string} name
 * @returns {string} hex-колір
 */
export function getAvatarColor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  }
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

/**
 * Форматує число як грошову суму у гривнях (без копійок).
 *
 * @param {*} value
 * @returns {string}
 */
export function formatMoney(value) {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('uk-UA', { maximumFractionDigits: 0 })} грн`;
}
