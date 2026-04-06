import { Router } from 'express';
import { query } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

router.use(authRequired);

router.get('/', requireRole('admin', 'manager'), async (req, res) => {
  const result = await query(
    `select id, name, email, role
     from users
     order by id desc`
  );
  return res.json(result.rows);
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { name, email, role } = req.body || {};

  const normalizedRole = role ? role.toLowerCase() : null;
  if (normalizedRole && !['admin', 'trainer', 'manager', 'client'].includes(normalizedRole)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const result = await query(
    `update users
     set name = coalesce($1, name),
         email = coalesce($2, email),
         role = coalesce($3, role)
     where id = $4
     returning id, name, email, role`,
    [name || null, email ? email.toLowerCase() : null, normalizedRole, id]
  );

  if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  return res.json(result.rows[0]);
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  await query('delete from users where id = $1', [id]);
  return res.json({ ok: true });
});

export default router;
