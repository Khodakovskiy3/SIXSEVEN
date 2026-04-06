import { Router } from 'express';
import { query } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { getClientIdByUserId } from '../utils/identity.js';

const router = Router();

router.use(authRequired);

router.get('/', requireRole('admin', 'manager'), async (req, res) => {
  const result = await query(
    `select v.id, v.client_id, v.subscription_id, v.visit_time,
            u.name as client_name, u.email as client_email
     from visits v
     join clients c on c.id = v.client_id
     join users u on u.id = c.user_id
     order by v.visit_time desc`
  );
  return res.json(result.rows);
});

router.get('/me', requireRole('client'), async (req, res) => {
  const clientId = await getClientIdByUserId(req.user.id);
  if (!clientId) return res.status(404).json({ error: 'Client not found' });

  const result = await query(
    `select id, client_id, subscription_id, visit_time
     from visits
     where client_id = $1
     order by visit_time desc`,
    [clientId]
  );

  return res.json(result.rows);
});

router.post('/', requireRole('admin', 'trainer'), async (req, res) => {
  const { client_id, subscription_id } = req.body || {};
  if (!client_id) return res.status(400).json({ error: 'Missing client_id' });

  const result = await query(
    `insert into visits (client_id, subscription_id)
     values ($1, $2)
     returning id, client_id, subscription_id, visit_time`,
    [client_id, subscription_id || null]
  );

  return res.status(201).json(result.rows[0]);
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  await query('delete from visits where id = $1', [id]);
  return res.json({ ok: true });
});

export default router;
