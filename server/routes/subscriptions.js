import { Router } from 'express';
import { query } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { getClientIdByUserId } from '../utils/identity.js';

const router = Router();

router.use(authRequired);

async function refreshSubscriptionStatuses() {
  await query(
    `update subscriptions
     set status = 'expired'
     where end_date < CURRENT_DATE and status != 'expired'`
  );
}

router.get('/', requireRole('admin', 'manager'), async (req, res) => {
  await refreshSubscriptionStatuses();
  const result = await query(
    `select s.id, s.client_id, s.type, s.start_date, s.end_date, s.status,
            u.name as client_name, u.email as client_email
     from subscriptions s
     join clients c on c.id = s.client_id
     join users u on u.id = c.user_id
     order by s.end_date desc`
  );
  return res.json(result.rows);
});

router.get('/me', requireRole('client'), async (req, res) => {
  await refreshSubscriptionStatuses();
  const clientId = await getClientIdByUserId(req.user.id);
  if (!clientId) return res.status(404).json({ error: 'Client not found' });

  const result = await query(
    `select id, type, start_date, end_date, status
     from subscriptions
     where client_id = $1
     order by end_date desc`,
    [clientId]
  );

  return res.json(result.rows);
});

router.post('/', requireRole('admin', 'manager'), async (req, res) => {
  const { client_id, type, start_date, end_date, status } = req.body || {};
  if (!client_id || !type || !start_date || !end_date) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const result = await query(
    `insert into subscriptions (client_id, type, start_date, end_date, status)
     values ($1, $2, $3, $4, $5)
     returning id, client_id, type, start_date, end_date, status`,
    [client_id, type, start_date, end_date, status || 'active']
  );

  return res.status(201).json(result.rows[0]);
});

router.put('/:id', requireRole('admin', 'manager'), async (req, res) => {
  const { id } = req.params;
  const { type, start_date, end_date, status } = req.body || {};

  const result = await query(
    `update subscriptions
     set type = coalesce($1, type),
         start_date = coalesce($2, start_date),
         end_date = coalesce($3, end_date),
         status = coalesce($4, status)
     where id = $5
     returning id, client_id, type, start_date, end_date, status`,
    [type || null, start_date || null, end_date || null, status || null, id]
  );

  if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  return res.json(result.rows[0]);
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  await query('delete from subscriptions where id = $1', [id]);
  return res.json({ ok: true });
});

export default router;
