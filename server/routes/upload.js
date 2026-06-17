/**
 * Маршрути завантаження зображень.
 *
 * POST /api/upload/image
 *   Body: { data: "data:image/jpeg;base64,..." }
 *   Returns: { url: "/assets/uploads/abc123.jpg" }
 *
 * Файли зберігаються у public/assets/uploads/.
 * Дозволені формати: jpeg, png, webp, gif.
 * Максимальний розмір: 5 МБ.
 */

import { Router } from 'express';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import { authRequired, requireRole } from '../middleware/auth.js';
import { HTTP_BAD_REQUEST, ROLE } from '../utils/constants.js';

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = join(__dirname, '../../public/assets/uploads');

mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const MIME_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

function hasImageSignature(mime, buffer) {
  if (mime === 'image/jpeg') {
    return buffer.length >= 3
      && buffer[0] === 0xff
      && buffer[1] === 0xd8
      && buffer[2] === 0xff;
  }

  if (mime === 'image/png') {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return buffer.length >= pngHeader.length
      && buffer.subarray(0, pngHeader.length).equals(pngHeader);
  }

  if (mime === 'image/webp') {
    return buffer.length >= 12
      && buffer.toString('ascii', 0, 4) === 'RIFF'
      && buffer.toString('ascii', 8, 12) === 'WEBP';
  }

  if (mime === 'image/gif') {
    const header = buffer.toString('ascii', 0, 6);
    return header === 'GIF87a' || header === 'GIF89a';
  }

  return false;
}

router.post('/image', authRequired, requireRole(ROLE.ADMIN), async (req, res) => {
  const { data } = req.body || {};

  if (!data || typeof data !== 'string') {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Поле data є обовʼязковим' });
  }

  const match = data.match(
    /^data:([a-zA-Z0-9+/]+\/[a-zA-Z0-9+/]+);base64,([a-zA-Z0-9+/=\s]+)$/
  );
  if (!match) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Невірний формат зображення' });
  }

  const [, mime, rawBase64] = match;
  const b64 = rawBase64.replace(/\s/g, '');

  if (!ALLOWED_MIME.has(mime)) {
    return res.status(HTTP_BAD_REQUEST).json({
      error: 'Дозволені формати: jpg, png, webp, gif',
    });
  }

  const buffer = Buffer.from(b64, 'base64');

  if (buffer.length === 0 || buffer.length > MAX_FILE_SIZE_BYTES) {
    return res.status(HTTP_BAD_REQUEST).json({
      error: 'Файл порожній або більший за 5 МБ',
    });
  }

  if (!hasImageSignature(mime, buffer)) {
    return res.status(HTTP_BAD_REQUEST).json({
      error: 'Вміст файлу не відповідає заявленому типу зображення',
    });
  }

  const name = `${randomBytes(12).toString('hex')}${MIME_EXTENSIONS[mime]}`;
  await writeFile(join(UPLOADS_DIR, name), buffer, { flag: 'wx' });

  return res.json({ url: `/assets/uploads/${name}` });
});

export default router;
