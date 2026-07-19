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
 * Чи дозволяє тип доступу абонемента (access_type) записатися на заняття
 * заданої категорії (category заняття: 'group' | 'personal').
 *
 * Словник access_type у subscription_plans:
 *  - 'gym'        — лише відвідування залу, без запису на заняття взагалі;
 *  - 'gym_group'  — зал + групові заняття (персональні НЕ включені);
 *  - 'group'      — лише групові заняття;
 *  - 'personal'   — лише персональні заняття.
 *
 * @param {string|null} accessType — access_type активного абонемента клієнта
 *   (null, якщо план видалено або невідомий — трактується як заборона).
 * @param {string} category — категорія заняття ('group' | 'personal').
 * @returns {boolean} true, якщо запис дозволений.
 */
export function isBookingAllowedForAccessType(accessType, category) {
  if (accessType === 'gym_group') {
    return category === 'group';
  }
  if (accessType === 'group') {
    return category === 'group';
  }
  if (accessType === 'personal') {
    return category === 'personal';
  }
  // 'gym' і будь-яке невідоме/відсутнє значення — запис на заняття заборонено.
  return false;
}

/**
 * Формує зрозуміле повідомлення про причину відмови в записі на заняття,
 * коли тип абонемента не відповідає категорії заняття.
 *
 * @param {string|null} accessType
 * @param {string} category
 * @returns {string}
 */
export function bookingDeniedMessage(accessType, category) {
  if (accessType === 'gym') {
    return 'Ваш абонемент дає доступ лише до тренажерного залу — запис на заняття не передбачений';
  }
  if (!accessType) {
    return 'Не вдалося визначити тип вашого абонемента — зверніться до адміністратора';
  }
  return category === 'personal'
    ? 'Ваш абонемент не дозволяє записуватися на персональні тренування'
    : 'Ваш абонемент не дозволяє записуватися на групові заняття';
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
