/**
 * Маршрути керування користувачами системи (всі ролі).
 *
 * GET    /api/users     — список усіх користувачів (admin, manager).
 * PUT    /api/users/:id — оновити користувача (admin).
 * DELETE /api/users/:id — видалити користувача (admin).
 */

import { Router } from 'express';

import { query } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import {
  HTTP_BAD_REQUEST,
  HTTP_NOT_FOUND,
  ROLE,
  VALID_ROLES,
} from '../utils/constants.js';

const router = Router();

router.use(authRequired);

router.get('/', requireRole(ROLE.ADMIN, ROLE.MANAGER), async (req, res) => {
  const result = await query(
    `select u.id, u.name, u.email, u.role, c.id as client_id
     from users u
     left join clients c on c.user_id = u.id
     order by u.id desc`
  );
  return res.json(result.rows);
});

router.put('/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  const { name, email, role } = req.body || {};

  // Якщо роль передана — нормалізуємо до нижнього регістру і валідуємо.
  const normalizedRole = role ? role.toLowerCase() : null;
  if (normalizedRole && !VALID_ROLES.includes(normalizedRole)) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Invalid role' });
  }

  const result = await query(
    `update users
     set name = coalesce($1, name),
         email = coalesce($2, email),
         role = coalesce($3, role)
     where id = $4
     returning id, name, email, role`,
    [name || null, email ? email.toLowerCase() : null, normalizedRole, id]
  );

  if (result.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
  }
  return res.json(result.rows[0]);
});

router.delete('/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  await query('delete from users where id = $1', [id]);
  return res.json({ ok: true });
});

export default router;
