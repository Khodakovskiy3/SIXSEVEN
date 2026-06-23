/**
 * Надсилання електронних листів (для двофакторної автентифікації).
 *
 * Транспорт налаштовується через змінні оточення (.env):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * Якщо SMTP не налаштовано (типово для локальної розробки), листи не
 * надсилаються, а код друкується в консоль сервера — щоб можна було
 * протестувати 2FA без реального поштового сервера.
 */

import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

import { OTP_TTL_MIN, OTP_PURPOSE } from './constants.js';

dotenv.config();

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

/** true, якщо налаштовано реальний SMTP-сервер. */
export const isMailConfigured = Boolean(SMTP_HOST);

const transporter = isMailConfigured
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT || 587),
      secure: Number(SMTP_PORT) === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    })
  : null;

const SUBJECTS = {
  [OTP_PURPOSE.LOGIN]: 'Код для входу в систему',
  [OTP_PURPOSE.ENABLE_2FA]: 'Код підтвердження двофакторної автентифікації',
};

/**
 * Надсилає одноразовий код на email користувача.
 *
 * @param {string} to — адреса отримувача.
 * @param {string} code — одноразовий код.
 * @param {string} purpose — призначення (OTP_PURPOSE.*).
 * @returns {Promise<void>}
 */
export async function sendOtpEmail(to, code, purpose) {
  const subject = SUBJECTS[purpose] || 'Код підтвердження';
  const text =
    `Ваш одноразовий код: ${code}\n\n` +
    `Код дійсний ${OTP_TTL_MIN} хвилин. ` +
    `Якщо ви не робили цей запит — просто проігноруйте цей лист.`;

  if (!transporter) {
    // Dev-режим без SMTP: код у консоль сервера.
    console.log(`[2FA] (DEV) код для ${to} [${purpose}]: ${code}`);
    return;
  }

  await transporter.sendMail({
    from: SMTP_FROM || 'no-reply@sixseven.local',
    to,
    subject,
    text,
  });
}
