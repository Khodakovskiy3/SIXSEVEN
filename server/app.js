/**
 * Збирання Express-застосунку Cluvyra (без запуску HTTP-сервера).
 *
 * Винесено окремо від server/index.js, щоб інтеграційні тести могли
 * підняти застосунок на випадковому порту без міграцій і фонових задач.
 */

import express from 'express';
import cors from 'cors';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './config.js';
import { pingDatabase, query } from './db.js';
import { areMigrationsComplete } from './migrate.js';
import { logError } from './utils/logger.js';
import { notifyUsers } from './utils/notify.js';
import { UPLOADS_DIR, UPLOADS_URL_PREFIX } from './utils/uploads.js';
import { HTTP_SERVER_ERROR } from './utils/constants.js';
import { securityHeaders, uploadHeaders, noStore } from './middleware/security.js';
import { authLimiter, credentialLimiter, apiLimiter, publicLimiter, formLimiter } from './middleware/rateLimit.js';

import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import clientsRoutes from './routes/clients.js';
import trainersRoutes from './routes/trainers.js';
import workoutsRoutes from './routes/workouts.js';
import schedulesRoutes from './routes/schedules.js';
import bookingsRoutes from './routes/bookings.js';
import subscriptionsRoutes from './routes/subscriptions.js';
import paymentsRoutes from './routes/payments.js';
import visitsRoutes from './routes/visits.js';
import reportsRoutes from './routes/reports.js';
import publicRoutes from './routes/public.js';
import clubRoutes from './routes/club.js';
import messagesRoutes from './routes/messages.js';
import chatRoutes from './routes/chat.js';
import uploadRoutes from './routes/upload.js';
import anthropometryRoutes from './routes/anthropometry.js';
import notificationsRoutes from './routes/notifications.js';
import pushRoutes from './routes/push.js';
import aiRoutes from './routes/ai.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = join(__dirname, '..', 'public');
const DEFAULT_JSON_LIMIT = '1mb';

/** Пересилати критичні помилки керівникам не частіше, ніж раз на хвилину. */
const MANAGER_ALERT_COOLDOWN_MS = 60_000;
let lastManagerAlertAt = 0;

export async function notifyManagers(title, body) {
  const now = Date.now();
  if (now - lastManagerAlertAt < MANAGER_ALERT_COOLDOWN_MS) {
    return;
  }
  lastManagerAlertAt = now;
  try {
    const result = await query(`select id from users where role in ('admin', 'manager')`);
    const ids = result.rows.map((r) => r.id);
    if (ids.length) {
      await notifyUsers(ids, title, body, { link: '/pages/manager/index.html' });
    }
  } catch {
    // Сповіщення про помилку не повинно породжувати нову помилку.
  }
}

/**
 * @returns {import('express').Express}
 */
export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // На Railway перед застосунком один реверс-проксі (edge), тож довіряємо
  // рівно одному хопу X-Forwarded-For — коректна IP для rate limiting.
  app.set('trust proxy', config.server.trustProxyHops);

  app.use(securityHeaders({ isProduction: config.isProduction }));

  app.use(cors({
    origin: config.server.corsOrigins.length > 0
      ? config.server.corsOrigins
      // Без явного CORS_ORIGIN у production — лише same-origin запити.
      : !config.isProduction,
  }));

  // Upload має власний парсер із більшим лімітом (див. routes/upload.js).
  const jsonParser = express.json({ limit: DEFAULT_JSON_LIMIT });
  app.use((req, res, next) => (req.path.startsWith('/api/upload') ? next() : jsonParser(req, res, next)));

  // ─── Health checks ────────────────────────────────────────────────────────
  // /api/health/live — процес живий; /api/health — готовий обслуговувати
  // запити (БД доступна, міграції застосовано). Railway healthcheck → /api/health.
  app.get('/api/health/live', (req, res) => res.json({ ok: true }));
  app.get('/api/health', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!areMigrationsComplete()) {
      return res.status(503).json({ ok: false, status: 'migrating' });
    }
    try {
      await pingDatabase();
      return res.json({ ok: true, status: 'ready', product: config.brand.productName });
    } catch {
      return res.status(503).json({ ok: false, status: 'database_unavailable' });
    }
  });

  // ─── Завантажені файли (persistent volume) ────────────────────────────────
  app.use(UPLOADS_URL_PREFIX, uploadHeaders, express.static(UPLOADS_DIR, {
    index: false,
    dotfiles: 'deny',
    maxAge: '7d',
  }));

  // ─── Статика: лендинг, кабінети, PWA ──────────────────────────────────────
  // extensions: ['html'] — чисті адреси /privacy, /terms, /app.
  app.use(express.static(STATIC_DIR, { extensions: ['html'], index: 'index.html' }));

  // ─── API ──────────────────────────────────────────────────────────────────
  app.use('/api', noStore, apiLimiter);
  app.use(['/api/auth/login', '/api/auth/register'], credentialLimiter);
  app.use('/api/auth', authLimiter, authRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/clients', clientsRoutes);
  app.use('/api/trainers', trainersRoutes);
  app.use('/api/workouts', workoutsRoutes);
  app.use('/api/schedules', schedulesRoutes);
  app.use('/api/bookings', bookingsRoutes);
  app.use('/api/subscriptions', subscriptionsRoutes);
  app.use('/api/payments', paymentsRoutes);
  app.use('/api/visits', visitsRoutes);
  app.use('/api/reports', reportsRoutes);
  app.use('/api/public/early-access', formLimiter);
  app.use('/api/public', publicLimiter, publicRoutes);
  app.use('/api/club', clubRoutes);
  app.use('/api/messages', messagesRoutes);
  app.use('/api/chat/guest', publicLimiter);
  app.use('/api/chat', chatRoutes);
  app.use('/api/upload', uploadRoutes);
  app.use('/api/anthropometry', anthropometryRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/push', pushRoutes);
  app.use('/api/ai', aiRoutes);

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // ─── Глобальна обробка помилок ────────────────────────────────────────────
  // Express 5 сам передає сюди відхилені проміси async-обробників.
  // Клієнт отримує загальне повідомлення; деталі — лише в журнал.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Запит завеликий' });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Некоректний JSON' });
    }
    logError('Необроблена помилка запиту', err, {
      method: req.method,
      path: req.originalUrl,
      userId: req.user?.id,
    });
    notifyManagers('⚠️ Помилка сервера', `${req.method} ${req.path}`).catch(() => {});
    if (res.headersSent) {
      return next(err);
    }
    return res.status(HTTP_SERVER_ERROR).json({ error: 'Internal server error' });
  });

  return app;
}
