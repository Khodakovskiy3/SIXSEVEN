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

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  const normalized = digits.startsWith('380') ? digits : `380${digits.replace(/^0+/, '')}`;
  return `+${normalized.slice(0, 12)}`;
}

function isValidPhone(phone) {
  return !phone || /^\+380\d{9}$/.test(phone);
}

router.get('/', requireRole(ROLE.ADMIN, ROLE.MANAGER), async (req, res) => {
  const result = await query(
    `select c.id, u.id as user_id, u.name, u.email, c.phone,
            s.id as subscription_id,
            s.plan_id as subscription_plan_id,
            s.type as subscription_type,
            sp.price as subscription_price,
            sp.plan_type as subscription_plan_type,
            s.end_date as subscription_end_date,
            case
              when s.id is null then 'inactive'
              when s.status = 'active' and s.end_date >= current_date then 'active'
              else 'inactive'
            end as status
     from clients c
     join users u on u.id = c.user_id
     left join lateral (
       select id, plan_id, type, end_date, status
       from subscriptions
       where client_id = c.id
       order by end_date desc
       limit 1
     ) s on true
     left join subscription_plans sp on sp.id = s.plan_id
     where u.role = $1
     order by c.id desc`,
    [ROLE.CLIENT]
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

  const normalizedPhone = normalizePhone(phone);
  if (!isValidPhone(normalizedPhone)) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Invalid phone format' });
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
        [user.id, normalizedPhone]
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
  const { name, phone } = req.body || {};
  const normalizedPhone = normalizePhone(phone);
  if (!isValidPhone(normalizedPhone)) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Invalid phone format' });
  }

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
       set name = coalesce($1, name)
       where id = $2`,
      [name || null, userId]
    );

    const clientResult = await client.query(
      `update clients
       set phone = coalesce($1, phone)
       where id = $2
       returning id, phone`,
      [normalizedPhone, id]
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
  const current = await query('select user_id from clients where id = $1', [id]);
  if (current.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
  }

  // payments не має ON DELETE CASCADE, тому видаляємо вручну перед видаленням юзера
  await query('delete from payments where client_id = $1', [id]);
  await query('delete from users where id = $1', [current.rows[0].user_id]);
  return res.json({ ok: true });
});

router.get('/:id', requireRole(ROLE.ADMIN, ROLE.MANAGER), async (req, res) => {
  const { id } = req.params;

  const clientResult = await query(
    `select c.id, u.id as user_id, u.name, u.email, c.phone,
            s.id as subscription_id,
            s.plan_id as subscription_plan_id,
            s.type as subscription_type,
            sp.price as subscription_price,
            sp.plan_type as subscription_plan_type,
            s.start_date as subscription_start_date,
            s.end_date as subscription_end_date,
            case
              when s.id is null then 'inactive'
              when s.status = 'active' and s.end_date >= current_date then 'active'
              else 'inactive'
            end as status
     from clients c
     join users u on u.id = c.user_id
     left join lateral (
       select id, plan_id, type, start_date, end_date, status
       from subscriptions
       where client_id = c.id
       order by end_date desc
       limit 1
     ) s on true
     left join subscription_plans sp on sp.id = s.plan_id
     where c.id = $1`,
    [id]
  );

  if (clientResult.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Client not found' });
  }

  const visitsResult = await query(
    `select v.id, v.visit_time, null as workout_name
     from visits v
     where v.client_id = $1
     order by v.visit_time desc
     limit 8`,
    [id]
  );

  return res.json({
    client: clientResult.rows[0],
    visits: visitsResult.rows,
  });
});

export default router;
