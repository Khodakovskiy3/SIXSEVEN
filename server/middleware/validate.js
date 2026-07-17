/**
 * Middleware валідації тіла запиту через zod-схему.
 *
 * Призначення — захистити обробники від некоректних або зловмисних вхідних
 * даних (нерядкові значення там, де очікується рядок; надмірно великі поля;
 * зайві типи). Схеми навмисно НЕ суворіші за наявну ручну перевірку в
 * обробниках: вони лише гарантують тип і межі, тож жоден коректний запит,
 * який приймався раніше, не почне відхилятися.
 *
 * Використання:
 *   router.post('/login', validateBody(loginSchema), handler);
 */

import { HTTP_BAD_REQUEST } from '../utils/constants.js';

/**
 * Створює middleware, що перевіряє req.body за zod-схемою.
 * У разі помилки повертає 400 з першим людиночитним повідомленням.
 * У разі успіху підставляє нормалізований результат назад у req.body.
 *
 * @param {import('zod').ZodTypeAny} schema
 * @returns {import('express').RequestHandler}
 */
export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body || {});
    if (!result.success) {
      const first = result.error.issues[0];
      const message = first?.message || 'Некоректні вхідні дані';
      return res.status(HTTP_BAD_REQUEST).json({ error: message });
    }
    req.body = result.data;
    return next();
  };
}
