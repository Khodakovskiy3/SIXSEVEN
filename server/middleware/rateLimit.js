/**
 * Обмеження частоти запитів (rate limiting) для чутливих ендпоінтів.
 *
 * Захищає вхід і роботу з кодами підтвердження (OTP/2FA) від перебору:
 * без ліміту зловмисник може підбирати пароль чи код необмеженою кількістю
 * спроб. Ліміт рахується за IP у ковзному вікні.
 *
 * Реалізація тримає лічильники в пам'яті процесу — цього достатньо для
 * одного інстансу. За горизонтального масштабування варто підключити
 * спільне сховище (наприклад Redis) через store-адаптер.
 */

import rateLimit from 'express-rate-limit';

import { HTTP_TOO_MANY_REQUESTS } from '../utils/constants.js';

/** Стандартна відповідь при перевищенні ліміту. */
const limitMessage = {
  error: 'Забагато спроб. Спробуйте ще раз за хвилину.',
};

/**
 * Ліміт для автентифікації: 10 запитів за хвилину з однієї IP-адреси.
 *
 * Покриває весь /api/auth (вхід, реєстрація, надсилання та перевірка кодів).
 * Значення підібране так, щоб не заважати нормальному користувачу
 * (кілька спроб входу + повторне надсилання коду), але робити перебір
 * непрактичним.
 */
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,          // вікно: 1 хвилина
  max: 60,                      // не більше 60 запитів на IP за вікно
  standardHeaders: true,        // додає заголовки RateLimit-*
  legacyHeaders: false,         // без застарілих X-RateLimit-*
  statusCode: HTTP_TOO_MANY_REQUESTS,
  message: limitMessage,
});

/**
 * Суворий ліміт для перевірки облікових даних і кодів: вхід, реєстрація,
 * підтвердження OTP та повторне надсилання. Успішні запити не рахуються,
 * тож звичайний користувач (навіть за спільним NAT залу) ліміт не відчує,
 * а перебір пароля чи 6-значного коду стає непрактичним.
 */
export const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: HTTP_TOO_MANY_REQUESTS,
  message: { error: 'Забагато невдалих спроб. Спробуйте ще раз за 15 хвилин.' },
});

/** Загальний ліміт для всього API (захист від зловживань і випадкових циклів). */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: HTTP_TOO_MANY_REQUESTS,
  message: limitMessage,
});

/** Публічні ендпоінти без авторизації (гостьовий чат, публічні дані). */
export const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: HTTP_TOO_MANY_REQUESTS,
  message: limitMessage,
});

/** Форма заявки з лендингу: не більше 5 заявок за 10 хвилин з однієї IP. */
export const formLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  skip: (req) => req.method !== 'POST',
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: HTTP_TOO_MANY_REQUESTS,
  message: { error: 'Too many requests. Please try again later.' },
});
