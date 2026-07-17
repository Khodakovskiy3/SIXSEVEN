/**
 * Чисті функції бізнес-логіки бронювань і розкладу.
 *
 * Винесені окремо від маршрутів, щоб їх можна було покрити unit-тестами
 * без бази даних. Самі маршрути використовують ці ж функції для рішень,
 * а важкі вибірки лишають на SQL.
 */

/**
 * Чи є вільне місце у групі.
 *
 * @param {number} bookedCount — скільки активних броней уже є.
 * @param {number} maxClients  — місткість заняття.
 * @returns {boolean} true, якщо можна записати ще одного клієнта.
 */
export function hasAvailableSlot(bookedCount, maxClients) {
  return Number(bookedCount) < Number(maxClients);
}

/**
 * Чи перетинаються два часові інтервали, задані початком (у хвилинах від
 * півночі) та тривалістю (у хвилинах). Дотик «встик» (кінець одного =
 * початок іншого) перетином НЕ вважається.
 *
 * Це та сама умова, що й у SQL-перевірці конфлікту занять тренера:
 *   startA < endB AND endA > startB
 *
 * @param {number} startA
 * @param {number} durationA
 * @param {number} startB
 * @param {number} durationB
 * @returns {boolean}
 */
export function intervalsOverlap(startA, durationA, startB, durationB) {
  const endA = Number(startA) + Number(durationA);
  const endB = Number(startB) + Number(durationB);
  return Number(startA) < endB && endA > Number(startB);
}

/**
 * Переводить час "HH:MM" (або "HH:MM:SS") у хвилини від півночі.
 *
 * @param {string} time
 * @returns {number}
 */
export function timeToMinutes(time) {
  const [h = 0, m = 0] = String(time).split(':').map(Number);
  return h * 60 + m;
}
