/**
 * Маршрути керування користувачами системи (всі ролі).
 *
 * GET    /api/users     — список усіх користувачів (admin, manager).
 * POST   /api/users     — створити користувача службової ролі (admin, manager з обмеженням).
 * PUT    /api/users/:id — оновити користувача / призначити роль (admin, manager з обмеженням).
 * DELETE /api/users/:id — видалити користувача (admin).
 */

import { Router } from 'express';
import bcrypt from 'bcryptjs';

import { query, withClient } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import {
  BCRYPT_SALT_ROUNDS,
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  HTTP_CREATED,
  HTTP_FORBIDDEN,
  HTTP_NOT_FOUND,
  HTTP_SERVER_ERROR,
  PG_UNIQUE_VIOLATION,
  ROLE,
  VALID_ROLES,
} from '../utils/constants.js';

const router = Router();

router.use(authRequired);

router.get('/', requireRole(ROLE.ADMIN, ROLE.MANAGER), async (req, res) => {
  const params = [];
  let whereClause = '';
  if (req.user.role === ROLE.ADMIN) {
    params.push([ROLE.CLIENT, ROLE.TRAINER]);
    whereClause = 'where u.role = any($1::text[])';
  }

  const result = await query(
    `select u.id, u.name, u.email, u.role,
            c.id as client_id,
            coalesce(c.phone, t.phone) as phone,
            t.id as trainer_id
     from users u
     left join clients c on c.user_id = u.id
     left join trainers t on t.user_id = u.id
     ${whereClause}
     order by u.id desc`,
    params
  );
  return res.json(result.rows);
});

function canAssignRole(actorRole, targetRole) {
  if (actorRole === ROLE.ADMIN) {
    return targetRole === ROLE.CLIENT || targetRole === ROLE.TRAINER;
  }
  return false;
}

function canManagerChangeRole(currentRole, targetRole) {
  return currentRole === ROLE.ADMIN && targetRole === ROLE.CLIENT;
}

async function ensureDomainRecord(client, userId, role) {
  if (role === ROLE.CLIENT) {
    await client.query(
      `insert into clients (user_id)
       values ($1)
       on conflict (user_id) do nothing`,
      [userId]
    );
  }

  if (role === ROLE.TRAINER) {
    await client.query(
      `insert into trainers (user_id)
       values ($1)
       on conflict (user_id) do nothing`,
      [userId]
    );
  }
}

router.post('/', requireRole(ROLE.ADMIN, ROLE.MANAGER), async (req, res) => {
  const { name, email, password, role, phone, specialization } = req.body || {};
  if (!name || !email || !password || !role) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing required fields' });
  }

  const normalizedRole = role.toLowerCase();
  if (!VALID_ROLES.includes(normalizedRole)) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Invalid role' });
  }

  if (!canAssignRole(req.user.role, normalizedRole)) {
    return res.status(HTTP_FORBIDDEN).json({ error: 'Forbidden' });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  try {
    const created = await withClient(async (client) => {
      await client.query('begin');

      const userResult = await client.query(
        `insert into users (name, email, password, role)
         values ($1, $2, $3, $4)
         returning id, name, email, role`,
        [name, email.toLowerCase(), passwordHash, normalizedRole]
      );

      const user = userResult.rows[0];
      if (normalizedRole === ROLE.CLIENT) {
        await client.query(
          `insert into clients (user_id, phone)
           values ($1, $2)`,
          [user.id, phone || null]
        );
      }

      if (normalizedRole === ROLE.TRAINER) {
        await client.query(
          `insert into trainers (user_id, specialization)
           values ($1, $2)`,
          [user.id, specialization || null]
        );
      }

      await client.query('commit');
      return user;
    });

    return res.status(HTTP_CREATED).json(created);
  } catch (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return res.status(HTTP_CONFLICT).json({ error: 'Email already registered' });
    }
    return res.status(HTTP_SERVER_ERROR).json({ error: 'User creation failed' });
  }
});

router.put('/:id', requireRole(ROLE.ADMIN, ROLE.MANAGER), async (req, res) => {
  const { id } = req.params;
  const { name, email, role } = req.body || {};

  // Якщо роль передана — нормалізуємо до нижнього регістру і валідуємо.
  const normalizedRole = role ? role.toLowerCase() : null;
  if (normalizedRole && !VALID_ROLES.includes(normalizedRole)) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Invalid role' });
  }

  if (normalizedRole && !canAssignRole(req.user.role, normalizedRole)) {
    if (req.user.role !== ROLE.MANAGER || normalizedRole !== ROLE.CLIENT) {
      return res.status(HTTP_FORBIDDEN).json({ error: 'Forbidden' });
    }
  }

  const result = await withClient(async (client) => {
    await client.query('begin');
    const current = await client.query(
      'select id, role from users where id = $1',
      [id]
    );

    if (current.rows.length === 0) {
      await client.query('rollback');
      return null;
    }

    if (req.user.role === ROLE.MANAGER) {
      const targetRole = normalizedRole;
      if (name || email || !targetRole || !canManagerChangeRole(current.rows[0].role, targetRole)) {
        await client.query('rollback');
        return { forbidden: true };
      }
    }

    if (
      req.user.role === ROLE.ADMIN
      && ![ROLE.CLIENT, ROLE.TRAINER].includes(current.rows[0].role)
    ) {
      await client.query('rollback');
      return { forbidden: true };
    }

    if (req.user.role === ROLE.ADMIN && (name || email || !normalizedRole)) {
      await client.query('rollback');
      return { forbidden: true };
    }

    const updated = await client.query(
      `update users
       set name = coalesce($1, name),
           email = coalesce($2, email),
           role = coalesce($3, role)
       where id = $4
       returning id, name, email, role`,
      [name || null, email ? email.toLowerCase() : null, normalizedRole, id]
    );

    if (updated.rows.length > 0 && normalizedRole) {
      await ensureDomainRecord(client, updated.rows[0].id, normalizedRole);
    }

    await client.query('commit');
    return updated;
  });

  if (result?.forbidden) {
    return res.status(HTTP_FORBIDDEN).json({ error: 'Forbidden' });
  }

  if (result.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
  }
  return res.json(result.rows[0]);
});

router.delete('/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  const current = await query('select role from users where id = $1', [id]);
  if (![ROLE.CLIENT, ROLE.TRAINER].includes(current.rows[0]?.role)) {
    return res.status(HTTP_FORBIDDEN).json({ error: 'Forbidden' });
  }

  await query('delete from users where id = $1', [id]);
  return res.json({ ok: true });
});

export default router;
