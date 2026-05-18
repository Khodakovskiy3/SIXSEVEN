/**
 * Маршрути керування тренуваннями (альтернативна модель занять).
 *
 * GET    /api/trainings     — список занять.
 * POST   /api/trainings     — створити заняття (admin).
 * PUT    /api/trainings/:id — оновити заняття (admin).
 * DELETE /api/trainings/:id — видалити заняття (admin).
 */

import { Router } from 'express';

import { query } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import {
  DEFAULT_TRAINING_CAPACITY,
  HTTP_BAD_REQUEST,
  HTTP_CREATED,
  HTTP_NOT_FOUND,
  ROLE,
} from '../utils/constants.js';

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

router.post('/', requireRole(ROLE.ADMIN), async (req, res) => {
  const { title, description, trainerId, startTime, endTime, capacity } = req.body || {};
  if (!title || !startTime || !endTime) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing required fields' });
  }

  const result = await query(
    `insert into trainings (title, description, trainer_id, start_time, end_time, capacity)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [
      title,
      description || null,
      trainerId || null,
      startTime,
      endTime,
      capacity || DEFAULT_TRAINING_CAPACITY,
    ]
  );
  return res.status(HTTP_CREATED).json(result.rows[0]);
});

router.put('/:id', requireRole(ROLE.ADMIN), async (req, res) => {
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
    [
      title || null,
      description || null,
      trainerId || null,
      startTime || null,
      endTime || null,
      capacity || null,
      id,
    ]
  );
  if (result.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
  }
  return res.json(result.rows[0]);
});

router.delete('/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  await query('delete from trainings where id = $1', [id]);
  return res.json({ ok: true });
});

export default router;
