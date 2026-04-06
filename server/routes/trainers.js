import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query, withClient } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

router.use(authRequired);

router.get('/me', requireRole('trainer'), async (req, res) => {
  const result = await query(
    `select t.id, u.name, u.email, t.specialization
     from trainers t
     join users u on u.id = t.user_id
     where t.user_id = $1`,
    [req.user.id]
  );

  if (result.rows.length === 0) return res.status(404).json({ error: 'Trainer not found' });
  return res.json(result.rows[0]);
});

router.get('/', requireRole('admin', 'manager'), async (req, res) => {
  const result = await query(
    `select t.id, u.name, u.email, t.specialization
     from trainers t
     join users u on u.id = t.user_id
     order by t.id desc`
  );
  return res.json(result.rows);
});

router.post('/', requireRole('admin'), async (req, res) => {
  const { name, email, password, specialization } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const created = await withClient(async (client) => {
      await client.query('begin');
      const userResult = await client.query(
        `insert into users (name, email, password, role)
         values ($1, $2, $3, 'trainer')
         returning id, name, email, role`,
        [name, email.toLowerCase(), passwordHash]
      );

      const user = userResult.rows[0];
      const trainerResult = await client.query(
        `insert into trainers (user_id, specialization)
         values ($1, $2)
         returning id, specialization`,
        [user.id, specialization || null]
      );

      await client.query('commit');
      return { ...user, trainer_id: trainerResult.rows[0].id, specialization: trainerResult.rows[0].specialization };
    });

    return res.status(201).json(created);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    return res.status(500).json({ error: 'Trainer creation failed' });
  }
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { name, email, specialization } = req.body || {};

  const result = await withClient(async (client) => {
    await client.query('begin');
    const current = await client.query(
      `select user_id from trainers where id = $1`,
      [id]
    );

    if (current.rows.length === 0) {
      await client.query('rollback');
      return null;
    }

    const userId = current.rows[0].user_id;

    await client.query(
      `update users
       set name = coalesce($1, name),
           email = coalesce($2, email)
       where id = $3`,
      [name || null, email ? email.toLowerCase() : null, userId]
    );

    const trainerResult = await client.query(
      `update trainers
       set specialization = coalesce($1, specialization)
       where id = $2
       returning id, specialization`,
      [specialization || null, id]
    );

    const userResult = await client.query(
      `select id, name, email, role from users where id = $1`,
      [userId]
    );

    await client.query('commit');
    return { ...userResult.rows[0], trainer_id: trainerResult.rows[0].id, specialization: trainerResult.rows[0].specialization };
  });

  if (!result) return res.status(404).json({ error: 'Not found' });
  return res.json(result);
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  await query('delete from trainers where id = $1', [id]);
  return res.json({ ok: true });
});

export default router;
