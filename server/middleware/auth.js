/**
 * Middleware та утиліти для автентифікації / авторизації.
 *
 * Експортує:
 *  • authRequired — перевіряє наявність валідного JWT-токена;
 *  • requireRole  — допускає лише користувачів із заданими ролями;
 *  • signToken    — формує JWT-токен для виданого користувача.
 */

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

import { query } from '../db.js';
import { config } from '../config.js';
import {
  AUTH_HEADER_PREFIX,
  HTTP_UNAUTHORIZED,
  HTTP_FORBIDDEN,
} from '../utils/constants.js';

// Секрет лише з конфігурації: у production validateConfig() не дасть
// стартувати без надійного JWT_SECRET. Для локальної розробки без секрету
// генеруємо випадковий на час життя процесу (токени не переживуть рестарт),
// а не відомий усім рядок на кшталт 'change_me'.
const JWT_SECRET = config.auth.jwtSecret
  || (config.isProduction ? '' : `dev-${crypto.randomUUID()}-${crypto.randomUUID()}`);
const JWT_ALGORITHM = 'HS256';

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
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
    const result = await query(
      `select id, name, email, role, twofa_enabled, token_version
       from users
       where id = $1`,
      [payload.id]
    );

    if (result.rows.length === 0) {
      return res.status(HTTP_UNAUTHORIZED).json({ error: 'User not found' });
    }

    // Токен, виданий до зміни пароля/ролі, відкликаний (claim tv застарів).
    const { token_version: tokenVersion, ...user } = result.rows[0];
    if (Number(payload.tv || 0) !== Number(tokenVersion || 0)) {
      return res.status(HTTP_UNAUTHORIZED).json({ error: 'Session expired' });
    }

    req.user = user;
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
 * @param {{ id: number, email: string, role: string, name: string, token_version?: number }} user
 * @returns {string} токен у форматі JWT.
 */
export function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      tv: Number(user.token_version || 0),
    },
    JWT_SECRET,
    { expiresIn: config.auth.jwtTtl, algorithm: JWT_ALGORITHM }
  );
}
