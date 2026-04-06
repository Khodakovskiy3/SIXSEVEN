import { Router } from 'express';
import { query } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

router.use(authRequired);

router.get('/', async (req, res) => {
  const result = await query(
    `select id, name, description, max_clients
     from workouts
     order by id desc`
  );
  return res.json(result.rows);
});

router.post('/', requireRole('admin'), async (req, res) => {
  const { name, description, max_clients } = req.body || {};
  if (!name || !max_clients) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const result = await query(
    `insert into workouts (name, description, max_clients)
     values ($1, $2, $3)
     returning id, name, description, max_clients`,
    [name, description || null, max_clients]
  );

  return res.status(201).json(result.rows[0]);
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { name, description, max_clients } = req.body || {};
  const result = await query(
    `update workouts
     set name = coalesce($1, name),
         description = coalesce($2, description),
         max_clients = coalesce($3, max_clients)
     where id = $4
     returning id, name, description, max_clients`,
    [name || null, description || null, max_clients || null, id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  return res.json(result.rows[0]);
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  await query('delete from workouts where id = $1', [id]);
  return res.json({ ok: true });
});

export default router;
