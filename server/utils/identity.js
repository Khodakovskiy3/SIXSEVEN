/**
 * Допоміжні функції для зв’язування користувача (users.id)
 * із його доменною сутністю — клієнтом або тренером.
 *
 * Користувач у системі — це загальний обліковий запис; роль клієнта чи
 * тренера зберігається в окремих таблицях, на які посилається user_id.
 */

import { query } from '../db.js';

/**
 * Повертає id клієнта, що відповідає заданому користувачу.
 *
 * @param {number} userId — ідентифікатор користувача.
 * @returns {Promise<number|null>} id клієнта або null, якщо такого немає.
 */
export async function getClientIdByUserId(userId) {
  const result = await query(
    'select id from clients where user_id = $1',
    [userId]
  );
  return result.rows[0]?.id || null;
}

/**
 * Повертає id тренера, що відповідає заданому користувачу.
 *
 * @param {number} userId — ідентифікатор користувача.
 * @returns {Promise<number|null>} id тренера або null, якщо такого немає.
 */
export async function getTrainerIdByUserId(userId) {
  const result = await query(
    'select id from trainers where user_id = $1',
    [userId]
  );
  return result.rows[0]?.id || null;
}
