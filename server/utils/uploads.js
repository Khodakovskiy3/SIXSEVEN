/**
 * Location of user-uploaded images.
 *
 * Production (Railway): mount a persistent volume and set UPLOADS_DIR, e.g.
 * /data/uploads, otherwise files disappear on every redeploy. Local
 * development defaults to public/assets/uploads (git-ignored).
 *
 * Files are always served under the stable URL prefix /assets/uploads/,
 * so image URLs already stored in the database keep working.
 */

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const UPLOADS_URL_PREFIX = '/assets/uploads';

export const UPLOADS_DIR = config.uploads.dir
  ? resolve(config.uploads.dir)
  : join(__dirname, '..', '..', 'public', 'assets', 'uploads');

mkdirSync(UPLOADS_DIR, { recursive: true });
