/**
 * Middleware та утиліти для автентифікації / авторизації.
 *
 * Експортує:
 *  • authRequired — перевіряє наявність валідного JWT-токена;
 *  • requireRole  — допускає лише користувачів із заданими ролями;
 *  • signToken    — формує JWT-токен для виданого користувача.
 */

import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

import { query } from '../db.js';
import {
  AUTH_HEADER_PREFIX,
  HTTP_UNAUTHORIZED,
  HTTP_FORBIDDEN,
  JWT_TTL,
} from '../utils/constants.js';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'change_me';

/**
 * Middleware, що перевіряє валідність токена з заголовка Authorization.
 * У разі успіху додає об’єкт декодованого користувача у req.user.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith(AUTH_HEADER_PREFIX)
    ? header.slice(AUTH_HEADER_PREFIX.length)
    : null;

  if (!token) {
    return res.status(HTTP_UNAUTHORIZED).json({ error: 'Unauthorized' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const result = await query(
      `select id, name, email, role, twofa_enabled
       from users
       where id = $1`,
      [payload.id]
    );

    if (result.rows.length === 0) {
      return res.status(HTTP_UNAUTHORIZED).json({ error: 'User not found' });
    }

    req.user = result.rows[0];
    return next();
  } catch {
    // Будь-яка помилка верифікації (прострочений, підроблений токен)
    // трактується однаково — як невалідний токен.
    return res.status(HTTP_UNAUTHORIZED).json({ error: 'Invalid token' });
  }
}

/**
 * Будує middleware, що пропускає лише користувачів із зазначеними ролями.
 * Викликати ПІСЛЯ authRequired, інакше req.user буде undefined.
 *
 * @param {...string} roles — ролі, яким дозволено доступ.
 * @returns {import('express').RequestHandler}
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(HTTP_FORBIDDEN).json({ error: 'Forbidden' });
    }
    return next();
  };
}

/**
 * Створює підписаний JWT-токен для користувача.
 *
 * @param {{ id: number, email: string, role: string, name: string }} user
 * @returns {string} токен у форматі JWT.
 */
export function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    },
    JWT_SECRET,
    { expiresIn: JWT_TTL }
  );
}
