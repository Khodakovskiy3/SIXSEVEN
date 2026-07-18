/**
 * Маршрути Web Push сповіщень.
 *
 * GET    /api/push/vapid-key        — VAPID публічний ключ для підписки
 * POST   /api/push/subscribe        — зберегти push-підписку
 * DELETE /api/push/subscribe        — видалити push-підписку
 * GET    /api/push/prefs            — отримати налаштування сповіщень
 * PUT    /api/push/prefs            — зберегти налаштування сповіщень
 */

import { Router } from 'express';
import { query } from '../db.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();
router.use(authRequired);

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';

/** GET /api/push/vapid-key */
router.get('/vapid-key', (_req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

/** POST /api/push/subscribe */
router.post('/subscribe', async (req, res) => {
  try {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'Невірний формат підписки' });
    }

    await query(
      `insert into push_subscriptions (user_id, endpoint, p256dh, auth)
       values ($1, $2, $3, $4)
       on conflict (endpoint) do update
         set user_id = excluded.user_id,
             p256dh  = excluded.p256dh,
             auth    = excluded.auth`,
      [req.user.id, endpoint, keys.p256dh, keys.auth]
    );

    // Позначити що пуш увімкнено у профілі
    await query(
      `update users set notif_push = true where id = $1`,
      [req.user.id]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error('[push] subscribe:', e);
    return res.status(500).json({ error: 'Помилка збереження підписки' });
  }
});

/** DELETE /api/push/subscribe */
router.delete('/subscribe', async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (endpoint) {
      await query(
        `delete from push_subscriptions where user_id = $1 and endpoint = $2`,
        [req.user.id, endpoint]
      );
    } else {
      // Видалити всі підписки цього користувача
      await query(
        `delete from push_subscriptions where user_id = $1`,
        [req.user.id]
      );
    }

    // Перевірити чи є ще підписки
    const remaining = await query(
      `select count(*) as cnt from push_subscriptions where user_id = $1`,
      [req.user.id]
    );
    if (Number(remaining.rows[0].cnt) === 0) {
      await query(`update users set notif_push = false where id = $1`, [req.user.id]);
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('[push] unsubscribe:', e);
    return res.status(500).json({ error: 'Помилка видалення підписки' });
  }
});

/** GET /api/push/prefs */
router.get('/prefs', async (req, res) => {
  try {
    const result = await query(
      `select notif_training, notif_hour_reminder, notif_push
       from users where id = $1`,
      [req.user.id]
    );
    return res.json(result.rows[0] || {});
  } catch (e) {
    console.error('[push] prefs GET:', e);
    return res.status(500).json({ error: 'Помилка завантаження налаштувань' });
  }
});

/** POST /api/push/test — надіслати тестовий push до поточного користувача */
router.post('/test', async (req, res) => {
  try {
    const { sendPush } = await import('../utils/notify.js');
    await sendPush([req.user.id], 'OLIMP — тест 🔔', 'Пуш сповіщення працюють!');
    return res.json({ ok: true });
  } catch (e) {
    console.error('[push] test:', e);
    return res.status(500).json({ error: e.message });
  }
});

/** PUT /api/push/prefs */
router.put('/prefs', async (req, res) => {
  try {
    const { notif_training, notif_hour_reminder } = req.body || {};
    await query(
      `update users
       set notif_training      = coalesce($2, notif_training),
           notif_hour_reminder = coalesce($3, notif_hour_reminder)
       where id = $1`,
      [
        req.user.id,
        notif_training    != null ? Boolean(notif_training)    : null,
        notif_hour_reminder != null ? Boolean(notif_hour_reminder) : null,
      ]
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error('[push] prefs PUT:', e);
    return res.status(500).json({ error: 'Помилка збереження налаштувань' });
  }
});

export default router;
