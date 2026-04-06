import { Router } from 'express';
import { query } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

router.use(authRequired);

router.get('/', async (req, res) => {
  const result = await query(
    `select t.id, t.title, t.description, t.start_time, t.end_time, t.capacity,
            t.trainer_id, u.full_name as trainer_name
     from trainings t
     left join users u on u.id = t.trainer_id
     order by t.start_time asc`
  );
  return res.json(result.rows);
});

router.post('/', requireRole('admin'), async (req, res) => {
  const { title, description, trainerId, startTime, endTime, capacity } = req.body || {};
  if (!title || !startTime || !endTime) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const result = await query(
    `insert into trainings (title, description, trainer_id, start_time, end_time, capacity)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [title, description || null, trainerId || null, startTime, endTime, capacity || 20]
  );
  return res.status(201).json(result.rows[0]);
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { title, description, trainerId, startTime, endTime, capacity } = req.body || {};
  const result = await query(
    `update trainings
     set title = coalesce($1, title),
         description = coalesce($2, description),
         trainer_id = coalesce($3, trainer_id),
         start_time = coalesce($4, start_time),
         end_time = coalesce($5, end_time),
         capacity = coalesce($6, capacity)
     where id = $7
     returning *`,
    [title || null, description || null, trainerId || null, startTime || null, endTime || null, capacity || null, id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  return res.json(result.rows[0]);
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  await query('delete from trainings where id = $1', [id]);
  return res.json({ ok: true });
});

export default router;
