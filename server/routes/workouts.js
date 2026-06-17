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
  HTTP_CONFLICT,
  HTTP_CREATED,
  HTTP_NOT_FOUND,
  PG_FOREIGN_KEY_VIOLATION,
  ROLE,
} from '../utils/constants.js';

const router = Router();

router.use(authRequired);

router.get('/', async (req, res) => {
  const result = await query(
    `select id, name, description, max_clients, status, image_url
     from workouts
     order by id desc`
  );
  return res.json(result.rows);
});

router.post('/', requireRole(ROLE.ADMIN), async (req, res) => {
  const {
    name,
    description,
    max_clients: maxClients,
    status,
    image_url: imageUrl,
  } = req.body || {};
  if (!name || !maxClients) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing required fields' });
  }

  const result = await query(
    `insert into workouts (name, description, max_clients, status, image_url)
     values ($1, $2, $3, $4, $5)
     returning id, name, description, max_clients, status, image_url`,
    [name, description || null, maxClients, status || 'active', imageUrl || null]
  );

  return res.status(HTTP_CREATED).json(result.rows[0]);
});

router.put('/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  const {
    name,
    description,
    max_clients: maxClients,
    status,
    image_url: imageUrl,
  } = req.body || {};

  const result = await query(
    `update workouts
     set name      = coalesce($1, name),
         description = coalesce($2, description),
         max_clients = coalesce($3, max_clients),
         status     = coalesce($4, status),
         image_url  = coalesce($5, image_url)
     where id = $6
     returning id, name, description, max_clients, status, image_url`,
    [name || null, description || null, maxClients || null, status || null, imageUrl ?? null, id]
  );

  if (result.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
  }
  return res.json(result.rows[0]);
});

router.delete('/:id', requireRole(ROLE.ADMIN), async (req, res) => {
  const { id } = req.params;
  try {
    await query('delete from workouts where id = $1', [id]);
    return res.json({ ok: true });
  } catch (error) {
    // Послугу не можна видалити, поки на неї посилаються заняття у розкладі.
    if (error.code === PG_FOREIGN_KEY_VIOLATION) {
      return res.status(HTTP_CONFLICT).json({
        error: 'Послугу використано в розкладі — спершу видаліть відповідні заняття',
      });
    }
    throw error;
  }
});

export default router;
