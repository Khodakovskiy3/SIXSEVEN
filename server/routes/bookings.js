import { Router } from 'express';
import { query, withClient } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { getClientIdByUserId } from '../utils/identity.js';

const router = Router();

router.use(authRequired);

router.get('/', requireRole('admin', 'manager'), async (req, res) => {
  const result = await query(
    `select b.id, b.status, b.schedule_id, b.client_id,
            u.name as client_name, u.email as client_email,
            s.date, s.time, w.name as workout_name
     from bookings b
     join clients c on c.id = b.client_id
     join users u on u.id = c.user_id
     join schedules s on s.id = b.schedule_id
     join workouts w on w.id = s.workout_id
     order by s.date desc, s.time desc`
  );
  return res.json(result.rows);
});

router.get('/me', requireRole('client'), async (req, res) => {
  const clientId = await getClientIdByUserId(req.user.id);
  if (!clientId) return res.status(404).json({ error: 'Client not found' });

  const result = await query(
    `select b.id, b.status, b.schedule_id,
            s.date, s.time, w.name as workout_name
     from bookings b
     join schedules s on s.id = b.schedule_id
     join workouts w on w.id = s.workout_id
     where b.client_id = $1
     order by s.date desc, s.time desc`,
    [clientId]
  );
  return res.json(result.rows);
});

router.get('/schedule/:id', requireRole('admin', 'manager', 'trainer'), async (req, res) => {
  const { id } = req.params;
  const result = await query(
    `select b.id, b.status, b.client_id, u.name as client_name
     from bookings b
     join clients c on c.id = b.client_id
     join users u on u.id = c.user_id
     where b.schedule_id = $1
     order by u.name asc`,
    [id]
  );
  return res.json(result.rows);
});

router.post('/', requireRole('client'), async (req, res) => {
  const { schedule_id } = req.body || {};
  if (!schedule_id) return res.status(400).json({ error: 'Missing schedule_id' });

  const clientId = await getClientIdByUserId(req.user.id);
  if (!clientId) return res.status(404).json({ error: 'Client not found' });

  const today = new Date().toISOString().slice(0, 10);

  try {
    const booking = await withClient(async (client) => {
      await client.query('begin');

      const subscription = await client.query(
        `select id from subscriptions
         where client_id = $1
           and status = 'active'
           and end_date >= $2
         order by end_date desc
         limit 1`,
        [clientId, today]
      );

      if (subscription.rows.length === 0) {
        await client.query('rollback');
        return { error: 'No active subscription' };
      }

      const scheduleInfo = await client.query(
        `select s.id, w.max_clients,
                (select count(*) from bookings b where b.schedule_id = s.id and b.status = 'active') as booked
         from schedules s
         join workouts w on w.id = s.workout_id
         where s.id = $1`,
        [schedule_id]
      );

      if (scheduleInfo.rows.length === 0) {
        await client.query('rollback');
        return { error: 'Schedule not found' };
      }

      const { max_clients, booked } = scheduleInfo.rows[0];
      if (Number(booked) >= Number(max_clients)) {
        await client.query('rollback');
        return { error: 'No available slots' };
      }

      const result = await client.query(
        `insert into bookings (client_id, schedule_id)
         values ($1, $2)
         returning id, client_id, schedule_id, status`,
        [clientId, schedule_id]
      );

      await client.query('commit');
      return { booking: result.rows[0] };
    });

    if (booking.error) {
      return res.status(409).json({ error: booking.error });
    }

    return res.status(201).json(booking.booking);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Already booked' });
    }
    return res.status(500).json({ error: 'Booking failed' });
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  const { id } = req.params;

  if (req.user.role === 'client') {
    const clientId = await getClientIdByUserId(req.user.id);
    const result = await query(
      `delete from bookings
       where id = $1 and client_id = $2`,
      [id, clientId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    return res.json({ ok: true });
  }

  if (!['admin', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  await query('delete from bookings where id = $1', [id]);
  return res.json({ ok: true });
});

export default router;
