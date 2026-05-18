/**
 * Маршрути керування типами тренувань (каталог).
 *
 * GET    /api/workouts     — список тренувань.
 * POST   /api/workouts     — створити тренування (admin).
 * PUT    /api/workouts/:id — оновити тренування (admin).
 * DELETE /api/workouts/:id — видалити тренування (admin).
 */

import { Router } from 'express';

import { query } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import {
  HTTP_BAD_REQUEST,
  HTTP_CREATED,
  HTTP_NOT_FOUND,
  ROLE,
} from '../utils/constants.js';

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

router.post('/', requireRole(ROLE.ADMIN), async (req, res) => {
  const { name, description, max_clients: maxClients } = req.body || {};
  if (!name || !maxClients) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing required fields' });
  }

  const result = await query(
    `insert into workouts (name, description, max_clients)
     values ($1, $2, $3)
     returning id, name, description, max_clients`,
    [name, description || null, maxClients]
  );

  return res.status(HTTP_CREATED).json(result.rows[0]);
});

router.put('/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  const { name, description, max_clients: maxClients } = req.body || {};

  const result = await query(
    `update workouts
     set name = coalesce($1, name),
         description = coalesce($2, description),
         max_clients = coalesce($3, max_clients)
     where id = $4
     returning id, name, description, max_clients`,
    [name || null, description || null, maxClients || null, id]
  );

  if (result.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
  }
  return res.json(result.rows[0]);
});

router.delete('/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  await query('delete from workouts where id = $1', [id]);
  return res.json({ ok: true });
});

export default router;
