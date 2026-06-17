/**
 * Маршрути реєстрації та авторизації користувачів.
 *
 * POST /api/auth/register — публічна реєстрація клієнта, повертає JWT-токен.
 * POST /api/auth/login    — перевіряє пароль і повертає JWT-токен.
 */

import { Router } from 'express';
import bcrypt from 'bcryptjs';

import { query, withClient } from '../db.js';
import { authRequired, signToken } from '../middleware/auth.js';
import {
  BCRYPT_SALT_ROUNDS,
  HTTP_BAD_REQUEST,
  HTTP_UNAUTHORIZED,
  HTTP_CONFLICT,
  HTTP_SERVER_ERROR,
  PG_UNIQUE_VIOLATION,
  ROLE,
} from '../utils/constants.js';

const router = Router();

router.get('/me', authRequired, async (req, res) => {
  return res.json({ user: req.user });
});

router.get('/profile', authRequired, async (req, res) => {
  const result = await query(
    `select id, name, email, role from users where id = $1`,
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

  const result = await query(
    `select id, name, email, role from users where id = $1`,
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

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  try {
    // Створення користувача та доменної сутності виконуємо в одній транзакції,
    // щоб уникнути сирітських users без відповідного запису clients/trainers.
    const user = await withClient(async (client) => {
      await client.query('begin');
      const result = await client.query(
        `insert into users (name, email, password, role)
         values ($1, $2, $3, $4)
         returning id, name, email, role`,
        [name, email.toLowerCase(), passwordHash, normalizedRole]
      );

      const created = result.rows[0];

      if (normalizedRole === ROLE.CLIENT) {
        await client.query(
          `insert into clients (user_id, phone)
           values ($1, $2)`,
          [created.id, phone || null]
        );
      }

      await client.query('commit');
      return created;
    });

    const token = signToken(user);
    return res.json({ token, user });
  } catch (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return res.status(HTTP_CONFLICT).json({ error: 'Цей email вже зареєстрований' });
    }
    return res.status(HTTP_SERVER_ERROR).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing email or password' });
  }

  const result = await query(
    `select id, name, email, password, role
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

  const token = signToken(user);
  return res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
});

export default router;
