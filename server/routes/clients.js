/**
 * Маршрути керування клієнтами клубу.
 *
 * GET    /api/clients      — список клієнтів (admin, manager).
 * GET    /api/clients/me   — профіль поточного клієнта та його абонемент.
 * POST   /api/clients      — створити клієнта (лише admin).
 * PUT    /api/clients/:id  — оновити дані клієнта (admin).
 * DELETE /api/clients/:id  — видалити клієнта (admin).
 */

import { Router } from 'express';
import bcrypt from 'bcryptjs';

import { query, withClient } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { getClientIdByUserId } from '../utils/identity.js';
import {
  BCRYPT_SALT_ROUNDS,
  HTTP_BAD_REQUEST,
  HTTP_NOT_FOUND,
  HTTP_CONFLICT,
  HTTP_CREATED,
  HTTP_SERVER_ERROR,
  PG_UNIQUE_VIOLATION,
  ROLE,
} from '../utils/constants.js';

const router = Router();

router.use(authRequired);

router.get('/', requireRole(ROLE.ADMIN, ROLE.MANAGER), async (req, res) => {
  const result = await query(
    `select c.id, u.name, u.email, c.phone
     from clients c
     join users u on u.id = c.user_id
     order by c.id desc`
  );
  return res.json(result.rows);
});

router.get('/me', requireRole(ROLE.CLIENT), async (req, res) => {
  const clientId = await getClientIdByUserId(req.user.id);
  if (!clientId) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Client not found' });
  }

  const profile = await query(
    `select c.id, u.name, u.email, c.phone
     from clients c
     join users u on u.id = c.user_id
     where c.id = $1`,
    [clientId]
  );

  // Беремо лише найсвіжіший абонемент — клієнтам відображаємо актуальний.
  const subscription = await query(
    `select id, type, start_date, end_date, status
     from subscriptions
     where client_id = $1
     order by end_date desc
     limit 1`,
    [clientId]
  );

  return res.json({
    client: profile.rows[0],
    subscription: subscription.rows[0] || null,
  });
});

router.post('/', requireRole(ROLE.ADMIN), async (req, res) => {
  const { name, email, password, phone } = req.body || {};
  if (!name || !email || !password) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing required fields' });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  try {
    // Створюємо users і clients у транзакції, щоб гарантувати атомарність.
    const created = await withClient(async (client) => {
      await client.query('begin');
      const userResult = await client.query(
        `insert into users (name, email, password, role)
         values ($1, $2, $3, 'client')
         returning id, name, email, role`,
        [name, email.toLowerCase(), passwordHash]
      );

      const user = userResult.rows[0];
      const clientResult = await client.query(
        `insert into clients (user_id, phone)
         values ($1, $2)
         returning id, phone`,
        [user.id, phone || null]
      );

      await client.query('commit');
      return {
        ...user,
        client_id: clientResult.rows[0].id,
        phone: clientResult.rows[0].phone,
      };
    });

    return res.status(HTTP_CREATED).json(created);
  } catch (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return res.status(HTTP_CONFLICT).json({ error: 'Email already registered' });
    }
    return res.status(HTTP_SERVER_ERROR).json({ error: 'Client creation failed' });
  }
});

router.put('/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  const { name, email, phone } = req.body || {};

  // Оновлення зачіпає одразу дві таблиці (users + clients),
  // тому виконуємо його в транзакції.
  const updated = await withClient(async (client) => {
    await client.query('begin');
    const current = await client.query(
      'select user_id from clients where id = $1',
      [id]
    );

    if (current.rows.length === 0) {
      await client.query('rollback');
      return null;
    }

    const userId = current.rows[0].user_id;

    await client.query(
      `update users
       set name = coalesce($1, name),
           email = coalesce($2, email)
       where id = $3`,
      [name || null, email ? email.toLowerCase() : null, userId]
    );

    const clientResult = await client.query(
      `update clients
       set phone = coalesce($1, phone)
       where id = $2
       returning id, phone`,
      [phone || null, id]
    );

    const userResult = await client.query(
      'select id, name, email, role from users where id = $1',
      [userId]
    );

    await client.query('commit');
    return {
      ...userResult.rows[0],
      client_id: clientResult.rows[0].id,
      phone: clientResult.rows[0].phone,
    };
  });

  if (!updated) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
  }
  return res.json(updated);
});

router.delete('/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  await query('delete from clients where id = $1', [id]);
  return res.json({ ok: true });
});

export default router;
