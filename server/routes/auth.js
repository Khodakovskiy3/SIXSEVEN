/**
 * Маршрути реєстрації та авторизації користувачів.
 *
 * POST /api/auth/register        — публічна реєстрація клієнта; надсилає 2FA-код на email.
 * POST /api/auth/register/verify — підтвердження коду: вмикає 2FA і повертає JWT-токен.
 * POST /api/auth/register/resend — повторне надсилання коду підтвердження реєстрації.
 * POST /api/auth/login         — перевіряє пароль; за увімкненої 2FA надсилає код.
 * POST /api/auth/login/verify  — другий крок входу: перевірка email-коду 2FA.
 * POST /api/auth/2fa/request   — надіслати код для увімкнення 2FA.
 * POST /api/auth/2fa/enable    — підтвердити код і увімкнути 2FA.
 * POST /api/auth/2fa/disable   — вимкнути 2FA (за паролем).
 */

import { Router } from 'express';
import bcrypt from 'bcryptjs';

import { query, withClient } from '../db.js';
import { authRequired, signToken } from '../middleware/auth.js';
import { issueCode, verifyCode, getResendWaitSeconds, generateCode } from '../utils/otp.js';
import { sendOtpEmail, isMailConfigured } from '../utils/mailer.js';
import {
  BCRYPT_SALT_ROUNDS,
  HTTP_BAD_REQUEST,
  HTTP_UNAUTHORIZED,
  HTTP_FORBIDDEN,
  HTTP_CONFLICT,
  HTTP_TOO_MANY_REQUESTS,
  HTTP_SERVER_ERROR,
  PG_UNIQUE_VIOLATION,
  ROLE,
  OTP_PURPOSE,
  OTP_RESEND_COOLDOWN_SEC,
  OTP_TTL_MIN,
  OTP_MAX_ATTEMPTS,
  isMandatory2faRole,
} from '../utils/constants.js';

/**
 * Формує безпечну відповідь успішного входу (токен + публічні поля користувача).
 */
function authResponse(user) {
  return {
    token: signToken(user),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  };
}

/** Людиночитні повідомлення для невдалої перевірки коду. */
const OTP_ERRORS = {
  no_code: 'Код не знайдено. Запитайте новий код.',
  expired: 'Термін дії коду минув. Запитайте новий код.',
  too_many_attempts: 'Перевищено кількість спроб. Запитайте новий код.',
  invalid: 'Невірний код',
};

// ─── Непідтверджені реєстрації (pending_registrations) ───────────────────────
// Дані нового користувача тримаємо тут до підтвердження кодом. Запис у users
// створюється лише після успішної перевірки, тож недопідтверджені реєстрації
// не займають email і не лишають «сирітських» акаунтів.

/**
 * Створює або оновлює запис очікуваної реєстрації та новий код.
 * Повертає згенерований код (для надсилання на email).
 */
async function upsertPendingRegistration({ name, email, passwordHash, phone, role }) {
  const code = generateCode();
  const codeHash = await bcrypt.hash(code, BCRYPT_SALT_ROUNDS);
  await query(
    `insert into pending_registrations
       (email, name, password, phone, role, code_hash, expires_at, attempts, created_at)
     values ($1, $2, $3, $4, $5, $6, now() + ($7 || ' minutes')::interval, 0, now())
     on conflict (email) do update set
       name       = excluded.name,
       password   = excluded.password,
       phone      = excluded.phone,
       role       = excluded.role,
       code_hash  = excluded.code_hash,
       expires_at = excluded.expires_at,
       attempts   = 0,
       created_at = now()`,
    [email, name, passwordHash, phone || null, role, codeHash, String(OTP_TTL_MIN)]
  );
  return code;
}

/** Скільки секунд лишилось до можливості надіслати новий код (антиспам). */
async function getPendingResendWait(email) {
  const result = await query(
    `select extract(epoch from (now() - created_at)) as age_sec
     from pending_registrations where email = $1`,
    [email]
  );
  const row = result.rows[0];
  if (!row) return 0;
  const wait = OTP_RESEND_COOLDOWN_SEC - Math.floor(Number(row.age_sec));
  return wait > 0 ? wait : 0;
}

/**
 * Перевіряє код очікуваної реєстрації. У разі успіху повертає сам запис
 * (для створення користувача). Невдалі спроби рахуються.
 */
async function verifyPendingCode(email, code) {
  // Прострочення рахуємо в SQL (expires_at < now()), а не через JS:
  // timestamp без зони при читанні в Node зсувається на зону процесу,
  // тому на хості (Київ) код помилково вважався простроченим одразу.
  const result = await query(
    `select id, email, name, password, phone, role, code_hash, attempts,
            (expires_at < now()) as is_expired
     from pending_registrations where email = $1`,
    [email]
  );
  const row = result.rows[0];
  if (!row) return { ok: false, reason: 'no_code' };

  if (row.is_expired) {
    await query('delete from pending_registrations where id = $1', [row.id]);
    return { ok: false, reason: 'expired' };
  }

  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    await query('delete from pending_registrations where id = $1', [row.id]);
    return { ok: false, reason: 'too_many_attempts' };
  }

  const match = await bcrypt.compare(String(code || ''), row.code_hash);
  if (!match) {
    await query('update pending_registrations set attempts = attempts + 1 where id = $1', [row.id]);
    return { ok: false, reason: 'invalid' };
  }

  return { ok: true, pending: row };
}

const router = Router();

router.get('/me', authRequired, async (req, res) => {
  return res.json({ user: req.user });
});

router.get('/profile', authRequired, async (req, res) => {
  const result = await query(
    `select id, name, email, role, phone, twofa_enabled from users where id = $1`,
    [req.user.id]
  );

  const user = result.rows[0];

  if (!user) {
    return res.status(401).json({ error: 'Користувача не знайдено' });
  }

  if (user.role === ROLE.CLIENT) {
    const client = await query(
      `select phone from clients where user_id = $1`,
      [user.id]
    );

    user.phone = client.rows[0]?.phone || '';
  }

  if (user.role === ROLE.TRAINER) {
    const trainer = await query(
      `select phone, specialization from trainers where user_id = $1`,
      [user.id]
    );

    user.phone = trainer.rows[0]?.phone || '';
    user.specialization = trainer.rows[0]?.specialization || '';
  }

  res.json({ user });
});

router.put('/profile', authRequired, async (req, res) => {
  const { name, phone, specialization } = req.body;

  await query(
    `update users set name = coalesce($1, name) where id = $2`,
    [name || null, req.user.id]
  );

  if (req.user.role === ROLE.CLIENT) {
    await query(
      `update clients set phone = coalesce($1, phone) where user_id = $2`,
      [phone || null, req.user.id]
    );
  }

  if (req.user.role === ROLE.TRAINER) {
    await query(
      `update trainers
       set phone = coalesce($1, phone),
           specialization = coalesce($2, specialization)
       where user_id = $3`,
      [phone || null, specialization || null, req.user.id]
    );
  }

  if (req.user.role === ROLE.ADMIN || req.user.role === 'manager') {
    await query(
      `update users set phone = $1 where id = $2`,
      [phone || null, req.user.id]
    );
  }

  const result = await query(
    `select id, name, email, role, phone from users where id = $1`,
    [req.user.id]
  );

  const user = result.rows[0];
  const token = signToken(user);

  res.json({ token, user });
});

router.put('/password', authRequired, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Пароль має бути мінімум 6 символів' });
  }

  const result = await query(
    `select password from users where id = $1`,
    [req.user.id]
  );

  const isValid = await bcrypt.compare(currentPassword, result.rows[0].password);

  if (!isValid) {
    return res.status(401).json({ error: 'Неправильний поточний пароль' });
  }

  const hash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);

  await query(
    `update users set password = $1 where id = $2`,
    [hash, req.user.id]
  );

  res.json({ ok: true });
});

router.post('/register', async (req, res) => {
  const { name, email, password, phone } = req.body || {};
  if (!name || !email || !password || !phone) {
    return res.status(HTTP_BAD_REQUEST).json({ error: "Заповніть усі обов'язкові поля" });
  }

  if (/[^\d\s\+\-\(\)]/.test(phone)) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Телефон містить недопустимі символи' });
  }
  const phoneDigits = phone.replace(/\D/g, '');
  if (phoneDigits.length < 10 || phoneDigits.length > 13) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Невірний номер телефону (10–13 цифр)' });
  }

  // Публічна реєстрація завжди створює клієнта.
  // Службові ролі (admin/manager/trainer) призначаються тільки через захищені
  // маршрути користувачів, щоб людина не могла видати права сама собі.
  const normalizedRole = ROLE.CLIENT;

  const emailLc = email.toLowerCase();
  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  try {
    // Якщо email уже належить підтвердженому користувачу — реєстрація неможлива.
    const existing = await query('select id from users where email = $1', [emailLc]);
    if (existing.rows[0]) {
      return res.status(HTTP_CONFLICT).json({ error: 'Цей email вже зареєстрований' });
    }

    // Користувача НЕ створюємо. Дані реєстрації зберігаємо в pending_registrations
    // і надсилаємо код. Запис у users з'явиться лише після підтвердження коду
    // через POST /api/auth/register/verify.
    const code = await upsertPendingRegistration({
      name,
      email: emailLc,
      passwordHash,
      phone,
      role: normalizedRole,
    });
    // Надсилання листа не блокує відповідь: код уже збережено, тож одразу
    // переходимо до кроку вводу коду, а лист летить у фоні.
    sendOtpEmail(emailLc, code, OTP_PURPOSE.ENABLE_2FA)
      .catch((e) => console.error('[2FA] помилка надсилання листа реєстрації:', e.message));
    return res.json({
      twofaRequired: true,
      email: emailLc,
      resendIn: OTP_RESEND_COOLDOWN_SEC,
      // У dev-режимі без SMTP повертаємо код, щоб можна було протестувати.
      ...(isMailConfigured ? {} : { devCode: code }),
    });
  } catch (error) {
    return res.status(HTTP_SERVER_ERROR).json({ error: 'Registration failed' });
  }
});

// Другий крок реєстрації: підтвердження email-коду. Лише ПІСЛЯ успішної
// перевірки створюємо користувача (з увімкненою 2FA) і видаємо токен.
router.post('/register/verify', async (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !code) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Вкажіть email і код' });
  }
  const emailLc = email.toLowerCase();

  const check = await verifyPendingCode(emailLc, code);
  if (!check.ok) {
    return res.status(HTTP_UNAUTHORIZED).json({ error: OTP_ERRORS[check.reason] || 'Невірний код' });
  }

  const pending = check.pending;
  try {
    // Створення користувача та доменної сутності — в одній транзакції,
    // щоб уникнути сирітських users без відповідного запису clients/trainers.
    const user = await withClient(async (client) => {
      await client.query('begin');
      const result = await client.query(
        `insert into users (name, email, password, role, twofa_enabled)
         values ($1, $2, $3, $4, true)
         returning id, name, email, role`,
        [pending.name, pending.email, pending.password, pending.role]
      );

      const created = result.rows[0];

      if (pending.role === ROLE.CLIENT) {
        await client.query(
          `insert into clients (user_id, phone) values ($1, $2)`,
          [created.id, pending.phone || null]
        );
      }

      await client.query('delete from pending_registrations where id = $1', [pending.id]);
      await client.query('commit');
      return created;
    });

    return res.json(authResponse(user));
  } catch (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      // Email зайняли між реєстрацією і підтвердженням.
      await query('delete from pending_registrations where id = $1', [pending.id]);
      return res.status(HTTP_CONFLICT).json({ error: 'Цей email вже зареєстрований' });
    }
    return res.status(HTTP_SERVER_ERROR).json({ error: 'Registration failed' });
  }
});

// Повторне надсилання коду підтвердження реєстрації (антиспам).
router.post('/register/resend', async (req, res) => {
  const { email } = req.body || {};
  if (!email) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Вкажіть email' });
  }
  const emailLc = email.toLowerCase();

  const result = await query(
    `select id, name, password, phone, role from pending_registrations where email = $1`,
    [emailLc]
  );
  const pending = result.rows[0];
  if (!pending) {
    return res.status(HTTP_UNAUTHORIZED).json({ error: 'Невірний запит' });
  }

  const wait = await getPendingResendWait(emailLc);
  if (wait > 0) {
    return res.status(HTTP_TOO_MANY_REQUESTS).json({
      error: `Зачекайте ${wait} с перед повторним запитом коду.`,
      retryAfter: wait,
    });
  }

  // Оновлюємо код (зберігаючи збережені дані реєстрації).
  const code = await upsertPendingRegistration({
    name: pending.name,
    email: emailLc,
    passwordHash: pending.password,
    phone: pending.phone,
    role: pending.role,
  });
  sendOtpEmail(emailLc, code, OTP_PURPOSE.ENABLE_2FA)
    .catch((e) => console.error('[2FA] помилка повторного надсилання листа:', e.message));
  return res.json({
    ok: true,
    email: emailLc,
    resendIn: OTP_RESEND_COOLDOWN_SEC,
    ...(isMailConfigured ? {} : { devCode: code }),
  });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing email or password' });
  }

  const result = await query(
    `select id, name, email, password, role, twofa_enabled
     from users where email = $1`,
    [email.toLowerCase()]
  );

  const user = result.rows[0];
  if (!user) {
    return res.status(HTTP_UNAUTHORIZED).json({ error: 'Невірний email або пароль' });
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    return res.status(HTTP_UNAUTHORIZED).json({ error: 'Невірний email або пароль' });
  }

  // Якщо увімкнено 2FA — не видаємо токен одразу, а надсилаємо код на email.
  // Вхід завершується другим кроком: POST /api/auth/login/verify.
  // Для привілейованих ролей (admin, manager) 2FA примусова: код надсилається
  // навіть якщо прапорець twofa_enabled ще не встановлено.
  if (user.twofa_enabled || isMandatory2faRole(user.role)) {
    // Антиспам: якщо код уже надсилали нещодавно — не надсилаємо новий,
    // а просимо скористатися наявним (він ще дійсний).
    const wait = await getResendWaitSeconds(user.id, OTP_PURPOSE.LOGIN);
    if (wait > 0) {
      return res.json({
        twofaRequired: true,
        email: user.email,
        resendIn: wait,
        message: `Код уже надіслано. Новий можна запитати через ${wait} с.`,
      });
    }

    const code = await issueCode(user.id, OTP_PURPOSE.LOGIN);
    sendOtpEmail(user.email, code, OTP_PURPOSE.LOGIN)
      .catch((e) => console.error('[2FA] помилка надсилання листа входу:', e.message));
    return res.json({
      twofaRequired: true,
      email: user.email,
      resendIn: OTP_RESEND_COOLDOWN_SEC,
      // У dev-режимі без SMTP повертаємо код, щоб можна було протестувати.
      ...(isMailConfigured ? {} : { devCode: code }),
    });
  }

  return res.json(authResponse(user));
});

// Другий крок входу за увімкненої 2FA: перевірка email-коду.
router.post('/login/verify', async (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !code) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Вкажіть email і код' });
  }

  const result = await query(
    `select id, name, email, role, twofa_enabled
     from users where email = $1`,
    [email.toLowerCase()]
  );
  const user = result.rows[0];
  // Дозволяємо другий крок як за увімкненою 2FA, так і для ролей із примусовою.
  if (!user || !(user.twofa_enabled || isMandatory2faRole(user.role))) {
    return res.status(HTTP_UNAUTHORIZED).json({ error: 'Невірний запит' });
  }

  const check = await verifyCode(user.id, OTP_PURPOSE.LOGIN, code);
  if (!check.ok) {
    return res.status(HTTP_UNAUTHORIZED).json({ error: OTP_ERRORS[check.reason] || 'Невірний код' });
  }

  return res.json(authResponse(user));
});

// Надіслати код для увімкнення 2FA на email поточного користувача.
router.post('/2fa/request', authRequired, async (req, res) => {
  if (req.user.twofa_enabled) {
    return res.status(HTTP_BAD_REQUEST).json({ error: '2FA вже увімкнено' });
  }
  // Антиспам: не частіше, ніж раз на OTP_RESEND_COOLDOWN_SEC секунд.
  const wait = await getResendWaitSeconds(req.user.id, OTP_PURPOSE.ENABLE_2FA);
  if (wait > 0) {
    return res.status(HTTP_TOO_MANY_REQUESTS).json({
      error: `Зачекайте ${wait} с перед повторним запитом коду.`,
      retryAfter: wait,
    });
  }

  const code = await issueCode(req.user.id, OTP_PURPOSE.ENABLE_2FA);
  sendOtpEmail(req.user.email, code, OTP_PURPOSE.ENABLE_2FA)
    .catch((e) => console.error('[2FA] помилка надсилання листа увімкнення 2FA:', e.message));
  return res.json({
    ok: true,
    sentTo: req.user.email,
    resendIn: OTP_RESEND_COOLDOWN_SEC,
    ...(isMailConfigured ? {} : { devCode: code }),
  });
});

// Підтвердити код і увімкнути 2FA.
router.post('/2fa/enable', authRequired, async (req, res) => {
  const { code } = req.body || {};
  if (!code) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Вкажіть код' });
  }
  const check = await verifyCode(req.user.id, OTP_PURPOSE.ENABLE_2FA, code);
  if (!check.ok) {
    return res.status(HTTP_BAD_REQUEST).json({ error: OTP_ERRORS[check.reason] || 'Невірний код' });
  }
  await query('update users set twofa_enabled = true where id = $1', [req.user.id]);
  return res.json({ ok: true, twofa_enabled: true });
});

// Вимкнути 2FA — підтвердження поточним паролем.
router.post('/2fa/disable', authRequired, async (req, res) => {
  const { password } = req.body || {};
  if (!password) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Вкажіть поточний пароль' });
  }
  // Для привілейованих ролей 2FA примусова — вимкнути її не можна.
  if (isMandatory2faRole(req.user.role)) {
    return res.status(HTTP_FORBIDDEN).json({
      error: 'Для вашої ролі двофакторна автентифікація обов’язкова і не може бути вимкнена',
    });
  }
  const result = await query('select password from users where id = $1', [req.user.id]);
  const isValid = await bcrypt.compare(password, result.rows[0].password);
  if (!isValid) {
    return res.status(HTTP_UNAUTHORIZED).json({ error: 'Неправильний пароль' });
  }
  await query('update users set twofa_enabled = false where id = $1', [req.user.id]);
  await query('delete from email_codes where user_id = $1', [req.user.id]);
  return res.json({ ok: true, twofa_enabled: false });
});

export default router;
