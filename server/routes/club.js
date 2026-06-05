/**
 * Маршрути налаштувань клубу (єдиний запис у таблиці club_settings).
 *
 * GET /api/club — публічні дані клубу (назва, адреса, контакти).
 * PUT /api/club — оновлення даних клубу (лише admin).
 */

import { Router } from 'express';

import { query } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { HTTP_NOT_FOUND, ROLE } from '../utils/constants.js';

const router = Router();

// Налаштування клубу зберігаються одним рядком із фіксованим id.
const CLUB_SETTINGS_ID = 1;

router.get('/', async (req, res) => {
  const result = await query(
    `select id, name, address, phone, email
     from club_settings
     where id = $1`,
    [CLUB_SETTINGS_ID]
  );

  if (result.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Club settings not found' });
  }
  return res.json(result.rows[0]);
});

router.put('/', authRequired, requireRole(ROLE.ADMIN), async (req, res) => {
  const { name, address, phone, email } = req.body || {};

  const result = await query(
    `update club_settings
     set name = coalesce($1, name),
         address = coalesce($2, address),
         phone = coalesce($3, phone),
         email = coalesce($4, email)
     where id = $5
     returning id, name, address, phone, email`,
    [name || null, address || null, phone || null, email || null, CLUB_SETTINGS_ID]
  );

  if (result.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Club settings not found' });
  }
  return res.json(result.rows[0]);
});

export default router;
