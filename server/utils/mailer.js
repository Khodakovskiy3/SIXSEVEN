/**
 * Надсилання електронних листів (коди підтвердження / 2FA).
 *
 * Транспорт налаштовується через змінні оточення:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * Безпека кодів:
 *  • у production код ніколи не друкується в лог і не повертається в API;
 *  • без SMTP у production код узагалі не видається (маршрути відповідають
 *    503) — щоб не створювати «обхід» перевірки;
 *  • для локальної розробки без поштового сервера: DEBUG_OTP=1 — код
 *    друкується в консоль і повертається у відповіді як devCode.
 */

import nodemailer from 'nodemailer';

import { config } from '../config.js';
import { OTP_TTL_MIN, OTP_PURPOSE } from './constants.js';

const { host, port, user, pass, from } = config.mail;

/** true, якщо налаштовано реальний SMTP-сервер. */
export const isMailConfigured = Boolean(host);

/**
 * Діагностичний режим розробника: код показується в консолі та API.
 * Неможливий у production (додатково блокується validateConfig()).
 */
export const isDevOtpExposureAllowed = !config.isProduction && config.mail.debugOtp;

/** Чи може система доставити одноразовий код користувачу. */
export function canDeliverOtp() {
  return isMailConfigured || isDevOtpExposureAllowed;
}

/** Повідомлення для відповіді 503, коли доставка кодів неможлива. */
export const MAIL_UNAVAILABLE_MESSAGE =
  'Надсилання кодів підтвердження тимчасово недоступне. Зверніться до адміністратора.';

const transporter = isMailConfigured
  ? nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user ? { user, pass } : undefined,
      // Пул з'єднань: повторне використання TLS-сесії пришвидшує надсилання.
      pool: true,
      maxConnections: 3,
    })
  : null;

const SUBJECTS = {
  [OTP_PURPOSE.LOGIN]: `${config.brand.productName}: код для входу`,
  [OTP_PURPOSE.ENABLE_2FA]: `${config.brand.productName}: код підтвердження`,
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
  const subject = SUBJECTS[purpose] || `${config.brand.productName}: код підтвердження`;
  const text =
    `Ваш одноразовий код: ${code}\n\n` +
    `Код дійсний ${OTP_TTL_MIN} хвилин. ` +
    `Якщо ви не робили цей запит — просто проігноруйте цей лист.\n\n` +
    `— ${config.brand.organizationName} · ${config.brand.productName}`;

  if (isDevOtpExposureAllowed) {
    console.log(`[2FA] (DEBUG_OTP) код для ${to} [${purpose}]: ${code}`);
  }

  // Службові логіни без справжньої адреси (напр. «admin») листа отримати
  // не можуть — nodemailer впав би з «No recipients defined».
  const isRealEmail = String(to || '').includes('@');
  if (!transporter || !isRealEmail) {
    return;
  }

  await transporter.sendMail({
    from: from || user,
    to,
    subject,
    text,
  });
}

/**
 * Сповіщає власника про нову заявку на демо (SUPPORT_EMAIL). Нічого не робить,
 * якщо SMTP або SUPPORT_EMAIL не налаштовані. Значення очищені від переносів
 * рядків, щоб не допустити ін'єкції заголовків.
 *
 * @param {{ name: string, email: string, studio_name?: string|null, studio_type?: string|null, message?: string|null }} lead
 */
export async function sendDemoRequestNotification(lead) {
  const to = config.brand.supportEmail;
  if (!transporter || !to) return;
  const oneLine = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').slice(0, 200);
  await transporter.sendMail({
    from: from || user,
    to,
    replyTo: oneLine(lead.email),
    subject: `${config.brand.productName}: new demo request`,
    text:
      `Name: ${oneLine(lead.name)}\n` +
      `Email: ${oneLine(lead.email)}\n` +
      `Studio: ${oneLine(lead.studio_name) || '-'} (${oneLine(lead.studio_type) || '-'})\n\n` +
      `${String(lead.message ?? '').slice(0, 2000)}`,
  });
}
