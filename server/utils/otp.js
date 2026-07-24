/**
 * Генерація та перевірка одноразових кодів (OTP) для двофакторної автентифікації.
 *
 * Коди зберігаються у таблиці email_codes лише у вигляді bcrypt-хешу.
 * На одного користувача та призначення тримається один активний код.
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';

import { query } from '../db.js';
import {
  BCRYPT_SALT_ROUNDS,
  OTP_LENGTH,
  OTP_TTL_MIN,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SEC,
} from './constants.js';

/**
 * Скільки секунд лишилося до можливості надіслати новий код (антиспам).
 * 0 — можна надсилати одразу.
 *
 * @param {number} userId
 * @param {string} purpose — OTP_PURPOSE.*
 * @returns {Promise<number>} секунд очікування (0, якщо не потрібно чекати).
 */
export async function getResendWaitSeconds(userId, purpose) {
  const result = await query(
    `select extract(epoch from (now() - created_at)) as age_sec
     from email_codes
     where user_id = $1 and purpose = $2
     order by created_at desc
     limit 1`,
    [userId, purpose]
  );
  const row = result.rows[0];
  if (!row) {
    return 0;
  }
  const wait = OTP_RESEND_COOLDOWN_SEC - Math.floor(Number(row.age_sec));
  return wait > 0 ? wait : 0;
}

/**
 * Чи є для користувача розпочатий OTP-потік цього призначення.
 *
 * Навмисно НЕ вимагаємо, щоб код був ще чинним: саме прострочений код —
 * головна причина натиснути «надіслати повторно». Наявність рядка означає,
 * що попередній крок (напр. перевірка пароля) уже пройдено, тож ендпоінт
 * повторного надсилання не можна використати для розсилки листів на чужі
 * адреси.
 *
 * @param {number} userId
 * @param {string} purpose — OTP_PURPOSE.*
 * @returns {Promise<boolean>} true — потік розпочато.
 */
export async function hasPendingCode(userId, purpose) {
  const result = await query(
    'select 1 from email_codes where user_id = $1 and purpose = $2 limit 1',
    [userId, purpose]
  );
  return Boolean(result.rows[0]);
}

/**
 * Генерує випадковий числовий код фіксованої довжини.
 *
 * @returns {string} код, напр. "043915".
 */
export function generateCode() {
  const max = 10 ** OTP_LENGTH;
  return String(crypto.randomInt(0, max)).padStart(OTP_LENGTH, '0');
}

/**
 * Створює новий код для користувача, зберігає його хеш і повертає сам код
 * (для надсилання на email). Старі коди того ж призначення видаляються.
 *
 * @param {number} userId
 * @param {string} purpose — OTP_PURPOSE.*
 * @returns {Promise<string>} згенерований код.
 */
export async function issueCode(userId, purpose) {
  const code = generateCode();
  const hash = await bcrypt.hash(code, BCRYPT_SALT_ROUNDS);

  await query('delete from email_codes where user_id = $1 and purpose = $2', [userId, purpose]);
  await query(
    `insert into email_codes (user_id, purpose, code_hash, expires_at)
     values ($1, $2, $3, now() + ($4 || ' minutes')::interval)`,
    [userId, purpose, hash, String(OTP_TTL_MIN)]
  );

  return code;
}

/**
 * Перевіряє код. У разі успіху код видаляється (одноразовість).
 * Невдалі спроби рахуються; після OTP_MAX_ATTEMPTS код анулюється.
 *
 * @param {number} userId
 * @param {string} purpose — OTP_PURPOSE.*
 * @param {string} code — введений користувачем код.
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function verifyCode(userId, purpose, code) {
  // Прострочення рахуємо в SQL (expires_at < now()), а не через JS:
  // колонка expires_at має тип timestamp без зони, і при читанні в Node
  // вона інтерпретується у зоні процесу — на хості (Київ) це давало зсув
  // на кілька годин і код помилково вважався простроченим.
  const result = await query(
    `select id, code_hash, attempts, (expires_at < now()) as is_expired
     from email_codes
     where user_id = $1 and purpose = $2
     order by created_at desc
     limit 1`,
    [userId, purpose]
  );

  const row = result.rows[0];
  if (!row) {
    return { ok: false, reason: 'no_code' };
  }

  if (row.is_expired) {
    await query('delete from email_codes where id = $1', [row.id]);
    return { ok: false, reason: 'expired' };
  }

  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    await query('delete from email_codes where id = $1', [row.id]);
    return { ok: false, reason: 'too_many_attempts' };
  }

  const match = await bcrypt.compare(String(code || ''), row.code_hash);
  if (!match) {
    await query('update email_codes set attempts = attempts + 1 where id = $1', [row.id]);
    return { ok: false, reason: 'invalid' };
  }

  await query('delete from email_codes where id = $1', [row.id]);
  return { ok: true };
}
