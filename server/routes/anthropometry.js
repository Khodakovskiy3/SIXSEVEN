/**
 * Антропометрія клієнта.
 *
 * GET  /api/anthropometry/me        — вся історія вимірів клієнта (новіші перші)
 * POST /api/anthropometry/me        — додати новий запис
 * DELETE /api/anthropometry/me/:id  — видалити запис
 */

import { Router } from 'express';
import { query } from '../db.js';
import { logError } from '../utils/logger.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { getClientIdByUserId } from '../utils/identity.js';
import {
  HTTP_BAD_REQUEST,
  HTTP_CREATED,
  HTTP_NOT_FOUND,
  HTTP_SERVER_ERROR,
  ROLE,
} from '../utils/constants.js';

const router = Router();
router.use(authRequired);

// ── Lazy table init (safety net if migrate.js hasn't run yet) ─────────────────
let _tableEnsured = false;
async function ensureAnthroTable() {
  if (_tableEnsured) {
    return;
  }
  await query(`
    create table if not exists client_anthropometry (
      id          serial primary key,
      client_id   integer not null references clients(id) on delete cascade,
      recorded_at date not null default current_date,
      weight      numeric(5,1),
      height      numeric(5,1),
      chest       numeric(5,1),
      waist       numeric(5,1),
      hips        numeric(5,1),
      bicep       numeric(5,1),
      thigh       numeric(5,1),
      note        text not null default '',
      created_at  timestamptz not null default now()
    );
    create index if not exists client_anthropometry_client_idx
      on client_anthropometry(client_id, recorded_at desc);
  `);
  _tableEnsured = true;
}

// ── GET /api/anthropometry/me ─────────────────────────────────────────────────
router.get('/me', requireRole(ROLE.CLIENT), async (req, res) => {
  try {
    await ensureAnthroTable();
    const clientId = await getClientIdByUserId(req.user.id);
    if (!clientId) {
      return res.status(HTTP_NOT_FOUND).json({ error: 'Client not found' });
    }

    const result = await query(
      `select id, recorded_at, weight, height, chest, waist, hips, bicep, thigh, note
       from client_anthropometry
       where client_id = $1
       order by recorded_at desc, created_at desc`,
      [clientId]
    );
    return res.json(result.rows);
  } catch (err) {
    logError('[anthro GET /me]', err, { userId: req.user?.id });
    return res.status(HTTP_SERVER_ERROR).json({ error: err.message });
  }
});

// ── POST /api/anthropometry/me ────────────────────────────────────────────────
router.post('/me', requireRole(ROLE.CLIENT), async (req, res) => {
  try {
    await ensureAnthroTable();
    const clientId = await getClientIdByUserId(req.user.id);
    if (!clientId) {
      return res.status(HTTP_NOT_FOUND).json({ error: 'Client not found' });
    }

    const {
      recorded_at,
      weight, height,
      chest, waist, hips,
      bicep, thigh,
      note = '',
    } = req.body || {};

    const toNum = (v) => (v !== undefined && v !== '' && v !== null ? Number(v) : null);

    const result = await query(
      `insert into client_anthropometry
         (client_id, recorded_at, weight, height, chest, waist, hips, bicep, thigh, note)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       returning id, recorded_at, weight, height, chest, waist, hips, bicep, thigh, note`,
      [
        clientId,
        recorded_at || new Date().toISOString().slice(0, 10),
        toNum(weight), toNum(height),
        toNum(chest), toNum(waist), toNum(hips),
        toNum(bicep), toNum(thigh),
        String(note).trim(),
      ]
    );
    return res.status(HTTP_CREATED).json(result.rows[0]);
  } catch (err) {
    logError('[anthro POST]', err, { userId: req.user?.id });
    // Повертаємо реальну помилку, щоб було видно в UI
    return res.status(HTTP_SERVER_ERROR).json({ error: err.message });
  }
});

// ── GET /api/anthropometry/client/:clientId ──────────────────────────────────
// Тренер переглядає повну історію антропометрії клієнта (лише читання)
router.get('/client/:clientId', requireRole(ROLE.TRAINER), async (req, res) => {
  await ensureAnthroTable().catch(() => {});
  const clientId = Number(req.params.clientId);
  if (!clientId) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Invalid clientId' });
  }

  try {
    const result = await query(
      `select id, recorded_at, weight, height, chest, waist, hips, bicep, thigh, note
       from client_anthropometry
       where client_id = $1
       order by recorded_at desc, created_at desc`,
      [clientId]
    );
    return res.json(result.rows);
  } catch (err) {
    logError('[anthro GET /client]', err, { userId: req.user?.id });
    return res.status(HTTP_SERVER_ERROR).json({ error: err.message });
  }
});

// ── DELETE /api/anthropometry/me/:id ─────────────────────────────────────────
router.delete('/me/:id', requireRole(ROLE.CLIENT), async (req, res) => {
  try {
    await ensureAnthroTable();
    const clientId = await getClientIdByUserId(req.user.id);
    if (!clientId) {
      return res.status(HTTP_NOT_FOUND).json({ error: 'Client not found' });
    }

    const result = await query(
      `delete from client_anthropometry where id = $1 and client_id = $2`,
      [Number(req.params.id), clientId]
    );
    if (result.rowCount === 0) {
      return res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
    }
    return res.json({ ok: true });
  } catch (err) {
    logError('[anthro DELETE]', err, { userId: req.user?.id });
    return res.status(HTTP_SERVER_ERROR).json({ error: err.message });
  }
});

export default router;
