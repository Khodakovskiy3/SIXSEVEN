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

router.post('/register', async (req, res) => {
  const { name, email, password, phone } = req.body || {};
  if (!name || !email || !password) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing required fields' });
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
      return res.status(HTTP_CONFLICT).json({ error: 'Email already registered' });
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
    return res.status(HTTP_UNAUTHORIZED).json({ error: 'Invalid credentials' });
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    return res.status(HTTP_UNAUTHORIZED).json({ error: 'Invalid credentials' });
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
