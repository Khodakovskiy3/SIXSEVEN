import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query, withClient } from '../db.js';
import { signToken } from '../middleware/auth.js';

const router = Router();

const VALID_ROLES = ['admin', 'trainer', 'manager', 'client'];

router.post('/register', async (req, res) => {
  const { name, email, password, role, phone, specialization } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const normalizedRole = (role || 'client').toLowerCase();
  if (!VALID_ROLES.includes(normalizedRole)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const user = await withClient(async (client) => {
      await client.query('begin');
      const result = await client.query(
        `insert into users (name, email, password, role)
         values ($1, $2, $3, $4)
         returning id, name, email, role`,
        [name, email.toLowerCase(), passwordHash, normalizedRole]
      );

      const created = result.rows[0];

      if (normalizedRole === 'client') {
        await client.query(
          `insert into clients (user_id, phone)
           values ($1, $2)`,
          [created.id, phone || null]
        );
      }

      if (normalizedRole === 'trainer') {
        await client.query(
          `insert into trainers (user_id, specialization)
           values ($1, $2)`,
          [created.id, specialization || null]
        );
      }

      await client.query('commit');
      return created;
    });

    const token = signToken(user);
    return res.json({ token, user });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    return res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Missing email or password' });
  }

  const result = await query(
    `select id, name, email, password, role
     from users where email = $1`,
    [email.toLowerCase()]
  );

  const user = result.rows[0];
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const token = signToken(user);
  return res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
});

export default router;
