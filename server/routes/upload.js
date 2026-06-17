/**
 * Завантаження файлів зображень.
 *
 * POST /api/upload/image
 *   Body: { data: "data:image/jpeg;base64,...", filename: "foto.jpg" }
 *   Returns: { url: "/assets/uploads/abc123.webp" }
 *
 * Файл зберігається у public/assets/uploads/.
 * Дозволені формати: jpeg, png, webp, gif.
 * Максимальний розмір: 5 МБ.
 */

import { Router } from 'express';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import { authRequired, requireRole } from '../middleware/auth.js';
import { HTTP_BAD_REQUEST, ROLE } from '../utils/constants.js';

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = join(__dirname, '../../public/assets/uploads');

// Ensure upload directory exists
mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

router.post('/image', authRequired, requireRole(ROLE.ADMIN), (req, res) => {
  const { data, filename } = req.body || {};

  if (!data || typeof data !== 'string') {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Поле data обовʼязкове' });
  }

  // Parse data URL: "data:<mime>;base64,<content>"
  const match = data.match(/^data:([a-zA-Z0-9+/]+\/[a-zA-Z0-9+/]+);base64,(.+)$/);
  if (!match) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Невірний формат зображення' });
  }

  const [, mime, b64] = match;

  if (!ALLOWED_MIME.has(mime)) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Дозволені формати: jpg, png, webp, gif' });
  }

  const buffer = Buffer.from(b64, 'base64');

  if (buffer.length > MAX_BYTES) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Файл занадто великий (максимум 5 МБ)' });
  }

  // Determine extension
  const originalExt = filename ? extname(filename).toLowerCase() : '';
  const extMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
  const ext = originalExt || extMap[mime] || '.jpg';

  const name = `${randomBytes(12).toString('hex')}${ext}`;
  const filePath = join(UPLOADS_DIR, name);

  writeFileSync(filePath, buffer);

  return res.json({ url: `/assets/uploads/${name}` });
});

export default router;
