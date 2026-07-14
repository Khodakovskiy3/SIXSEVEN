/**
 * Маршрути керування абонементами клієнтів.
 *
 * GET    /api/subscriptions     — список усіх абонементів (admin, manager).
 * GET    /api/subscriptions/me  — абонементи поточного клієнта.
 * POST   /api/subscriptions     — створити абонемент (admin, manager).
 * PUT    /api/subscriptions/:id — оновити абонемент.
 * DELETE /api/subscriptions/:id — видалити абонемент (admin).
 */

import { Router } from 'express';

import { query, withClient } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { getClientIdByUserId } from '../utils/identity.js';
import { notifyUsers } from '../utils/notify.js';
import {
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  HTTP_CREATED,
  HTTP_NOT_FOUND,
  PG_FOREIGN_KEY_VIOLATION,
  ROLE,
  SUBSCRIPTION_STATUS,
} from '../utils/constants.js';

const router = Router();

router.use(authRequired);

const PLAN_STATUS = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
});

const PLAN_TYPE = Object.freeze({
  SUBSCRIPTION: 'subscription',
  SINGLE: 'single',
});

function toPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizePlanPayload(body = {}, current = null) {
  const planType = body.plan_type || current?.plan_type || PLAN_TYPE.SUBSCRIPTION;
  const durationDays = planType === PLAN_TYPE.SUBSCRIPTION
    ? toPositiveNumber(body.duration_days ?? current?.duration_days)
    : null;
  const usageCount = planType === PLAN_TYPE.SINGLE
    ? toPositiveNumber(body.usage_count ?? current?.usage_count)
    : null;

  return {
    name: body.name?.trim() || current?.name,
    description: body.description?.trim() || null,
    planType,
    accessType: body.access_type?.trim() || current?.access_type,
    durationDays,
    usageCount,
    price: toPositiveNumber(body.price ?? current?.price),
    status: body.status || current?.status || PLAN_STATUS.ACTIVE,
  };
}

function validatePlanPayload(plan) {
  if (!plan.name || !plan.accessType || !plan.price) {
    return 'Missing required fields';
  }
  if (!Object.values(PLAN_TYPE).includes(plan.planType)) {
    return 'Invalid plan type';
  }
  if (!Object.values(PLAN_STATUS).includes(plan.status)) {
    return 'Invalid status';
  }
  if (plan.planType === PLAN_TYPE.SUBSCRIPTION && !plan.durationDays) {
    return 'Duration is required';
  }
  if (plan.planType === PLAN_TYPE.SINGLE && !plan.usageCount) {
    return 'Usage count is required';
  }
  return '';
}

/**
 * Перед видачею абонементів актуалізує їх статуси:
 * усі, що минули end_date, переводяться в 'expired'.
 * Виконується лазиво при кожному запиті, щоб не тримати окремого cron-job.
 *
 * @returns {Promise<void>}
 */
async function refreshSubscriptionStatuses() {
  await query(
    `update subscriptions
     set status = $1
     where end_date < CURRENT_DATE and status != $1`,
    [SUBSCRIPTION_STATUS.EXPIRED]
  );
}

router.get('/', requireRole(ROLE.ADMIN, ROLE.MANAGER), async (req, res) => {
  await refreshSubscriptionStatuses();
  const result = await query(
    `select s.id, s.client_id, s.plan_id, s.type, s.start_date, s.end_date, s.status,
            u.name as client_name, u.email as client_email,
            sp.name as plan_name, sp.price as plan_price, sp.plan_type, sp.access_type
     from subscriptions s
     join clients c on c.id = s.client_id
     join users u on u.id = c.user_id
     left join subscription_plans sp on sp.id = s.plan_id
     order by s.end_date desc`
  );
  return res.json(result.rows);
});

router.get('/plans', requireRole(ROLE.ADMIN, ROLE.MANAGER), async (req, res) => {
  const result = await query(
    `select id, name, description, plan_type, access_type, duration_days, usage_count, price, status
     from subscription_plans
     order by status, id desc`
  );
  return res.json(result.rows);
});

router.get(
  '/plans/active',
  requireRole(ROLE.ADMIN, ROLE.MANAGER, ROLE.CLIENT),
  async (req, res) => {
    const result = await query(
      `select id, name, description, plan_type, access_type,
              duration_days, usage_count, price, status
       from subscription_plans
       where status = $1
       order by plan_type, price, id`,
      [PLAN_STATUS.ACTIVE]
    );
    return res.json(result.rows);
  }
);

router.post('/plans', requireRole(ROLE.ADMIN), async (req, res) => {
  const plan = normalizePlanPayload(req.body);
  const error = validatePlanPayload(plan);
  if (error) {
    return res.status(HTTP_BAD_REQUEST).json({ error });
  }

  const result = await query(
    `insert into subscription_plans
      (name, description, plan_type, access_type, duration_days, usage_count, price, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id, name, description, plan_type, access_type,
               duration_days, usage_count, price, status`,
    [
      plan.name,
      plan.description,
      plan.planType,
      plan.accessType,
      plan.durationDays,
      plan.usageCount,
      plan.price,
      plan.status,
    ]
  );

  return res.status(HTTP_CREATED).json(result.rows[0]);
});

router.put('/plans/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  const currentResult = await query(
    `select id, name, description, plan_type, access_type,
            duration_days, usage_count, price, status
     from subscription_plans
     where id = $1`,
    [id]
  );
  if (currentResult.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Plan not found' });
  }

  const plan = normalizePlanPayload(req.body, currentResult.rows[0]);
  const error = validatePlanPayload(plan);
  if (error) {
    return res.status(HTTP_BAD_REQUEST).json({ error });
  }

  const result = await query(
    `update subscription_plans
     set name = $1,
         description = $2,
         plan_type = $3,
         access_type = $4,
         duration_days = $5,
         usage_count = $6,
         price = $7,
         status = $8
     where id = $9
     returning id, name, description, plan_type, access_type,
               duration_days, usage_count, price, status`,
    [
      plan.name,
      plan.description,
      plan.planType,
      plan.accessType,
      plan.durationDays,
      plan.usageCount,
      plan.price,
      plan.status,
      id,
    ]
  );

  if (result.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Plan not found' });
  }
  return res.json(result.rows[0]);
});

router.delete('/plans/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await query('delete from subscription_plans where id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(HTTP_NOT_FOUND).json({ error: 'Plan not found' });
    }
    return res.json({ ok: true });
  } catch (error) {
    // На випадок, якщо тариф жорстко повʼязаний з іншими записами.
    if (error.code === PG_FOREIGN_KEY_VIOLATION) {
      return res.status(HTTP_CONFLICT).json({
        error: 'Тариф використовується — спершу приберіть повʼязані абонементи',
      });
    }
    throw error;
  }
});

router.patch('/plans/:id/status', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  if (!Object.values(PLAN_STATUS).includes(status)) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Invalid status' });
  }

  const result = await query(
    `update subscription_plans
     set status = $1
     where id = $2
     returning id, name, description, plan_type, access_type,
               duration_days, usage_count, price, status`,
    [status, id]
  );

  if (result.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Plan not found' });
  }
  return res.json(result.rows[0]);
});

/**
 * Сповіщає клієнта про наданий йому абонемент (у дзвіночок, зі звуком).
 *
 * @param {number} clientId Ідентифікатор клієнта (clients.id).
 * @param {string} planName Назва тарифу або тип абонемента.
 * @param {string|Date} endDate Дата завершення дії.
 * @returns {Promise<void>}
 */
async function notifyClientAboutSubscription(clientId, planName, endDate) {
  const user = await query(
    `select u.id from clients c join users u on u.id = c.user_id where c.id = $1`,
    [clientId]
  );
  if (user.rows.length === 0) {
    return;
  }

  const until = new Date(endDate).toLocaleDateString('uk-UA');
  await notifyUsers(
    [user.rows[0].id],
    `Вам надано абонемент «${planName}»`,
    `Абонемент діє до ${until}. Гарних тренувань!`
  );
}

router.post('/assign', requireRole(ROLE.ADMIN, ROLE.MANAGER), async (req, res) => {
  const {
    client_id: clientId,
    plan_id: planId,
    start_date: startDate,
    status,
  } = req.body || {};

  if (!clientId || !planId || !startDate) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing required fields' });
  }

  const assigned = await withClient(async (client) => {
    await client.query('begin');

    const planResult = await client.query(
      `select id, name, plan_type, duration_days, usage_count, price, status
       from subscription_plans
       where id = $1`,
      [planId]
    );
    const plan = planResult.rows[0];
    if (!plan || plan.status !== PLAN_STATUS.ACTIVE) {
      await client.query('rollback');
      return null;
    }

    const start = new Date(startDate);
    const end = new Date(start);
    const days = plan.plan_type === PLAN_TYPE.SUBSCRIPTION
      ? Number(plan.duration_days || 30)
      : 30;
    end.setDate(end.getDate() + days);

    const subscriptionResult = await client.query(
      `insert into subscriptions (client_id, plan_id, type, start_date, end_date, status)
       values ($1, $2, $3, $4, $5, $6)
       returning id, client_id, plan_id, type, start_date, end_date, status`,
      [
        clientId,
        plan.id,
        plan.name,
        startDate,
        end.toISOString().slice(0, 10),
        status || SUBSCRIPTION_STATUS.ACTIVE,
      ]
    );

    const subscription = subscriptionResult.rows[0];
    const paymentResult = await client.query(
      `insert into payments (client_id, subscription_id, amount, status)
       values ($1, $2, $3, 'completed')
       returning id, client_id, subscription_id, amount, date, status`,
      [clientId, subscription.id, plan.price]
    );

    await client.query('commit');
    return { subscription, payment: paymentResult.rows[0] || null };
  });

  if (!assigned) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Plan is not available' });
  }

  await notifyClientAboutSubscription(
    clientId,
    assigned.subscription.type,
    assigned.subscription.end_date
  );

  return res.status(HTTP_CREATED).json(assigned);
});

router.post('/purchase', requireRole(ROLE.CLIENT), async (req, res) => {
  const { plan_id: planId } = req.body || {};
  if (!planId) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing required fields' });
  }

  const clientId = await getClientIdByUserId(req.user.id);
  if (!clientId) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Client not found' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const purchased = await withClient(async (client) => {
    await client.query('begin');

    const planResult = await client.query(
      `select id, name, plan_type, duration_days, price, status
       from subscription_plans
       where id = $1`,
      [planId]
    );
    const plan = planResult.rows[0];
    if (!plan || plan.status !== PLAN_STATUS.ACTIVE) {
      await client.query('rollback');
      return null;
    }

    const end = new Date(today);
    const days = plan.plan_type === PLAN_TYPE.SUBSCRIPTION
      ? Number(plan.duration_days || 30)
      : 30;
    end.setDate(end.getDate() + days);

    const subscriptionResult = await client.query(
      `insert into subscriptions (client_id, plan_id, type, start_date, end_date, status)
       values ($1, $2, $3, $4, $5, $6)
       returning id, client_id, plan_id, type, start_date, end_date, status`,
      [
        clientId,
        plan.id,
        plan.name,
        today,
        end.toISOString().slice(0, 10),
        SUBSCRIPTION_STATUS.ACTIVE,
      ]
    );

    const subscription = subscriptionResult.rows[0];
    const paymentResult = await client.query(
      `insert into payments (client_id, subscription_id, amount, status)
       values ($1, $2, $3, 'completed')
       returning id, client_id, subscription_id, amount, date, status`,
      [clientId, subscription.id, plan.price]
    );

    await client.query('commit');
    return { subscription, payment: paymentResult.rows[0] };
  });

  if (!purchased) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Plan is not available' });
  }

  return res.status(HTTP_CREATED).json(purchased);
});

router.get('/me', requireRole(ROLE.CLIENT), async (req, res) => {
  await refreshSubscriptionStatuses();
  const clientId = await getClientIdByUserId(req.user.id);
  if (!clientId) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Client not found' });
  }

  const result = await query(
    `select s.id, s.plan_id, s.type, s.start_date, s.end_date, s.status,
            sp.name as plan_name, sp.price as plan_price, sp.plan_type, sp.access_type
     from subscriptions s
     left join subscription_plans sp on sp.id = s.plan_id
     where s.client_id = $1
     order by s.end_date desc`,
    [clientId]
  );

  return res.json(result.rows);
});

router.post('/', requireRole(ROLE.ADMIN, ROLE.MANAGER), async (req, res) => {
  const {
    client_id: clientId,
    plan_id: planId,
    type,
    start_date: startDate,
    end_date: endDate,
    status,
  } = req.body || {};

  if (!clientId || !type || !startDate || !endDate) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing required fields' });
  }

  const result = await query(
    `insert into subscriptions (client_id, plan_id, type, start_date, end_date, status)
     values ($1, $2, $3, $4, $5, $6)
     returning id, client_id, plan_id, type, start_date, end_date, status`,
    [clientId, planId || null, type, startDate, endDate, status || SUBSCRIPTION_STATUS.ACTIVE]
  );

  await notifyClientAboutSubscription(clientId, type, endDate);

  return res.status(HTTP_CREATED).json(result.rows[0]);
});

router.put('/:id', requireRole(ROLE.ADMIN, ROLE.MANAGER), async (req, res) => {
  const { id } = req.params;
  const {
    type,
    start_date: startDate,
    end_date: endDate,
    status,
  } = req.body || {};

  const result = await query(
    `update subscriptions
     set type = coalesce($1, type),
         start_date = coalesce($2, start_date),
         end_date = coalesce($3, end_date),
         status = coalesce($4, status)
     where id = $5
     returning id, client_id, type, start_date, end_date, status`,
    [type || null, startDate || null, endDate || null, status || null, id]
  );

  if (result.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
  }
  return res.json(result.rows[0]);
});

router.delete('/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  await query('delete from subscriptions where id = $1', [id]);
  return res.json({ ok: true });
});

export default router;
