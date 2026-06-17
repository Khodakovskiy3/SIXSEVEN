/**
 * Точка входу серверної частини «Системи обліку спортивного клубу».
 *
 * Налаштовує Express-застосунок:
 *  • CORS і JSON-парсер;
 *  • роздачу статичних файлів із public/;
 *  • маршрути API /api/* (по одному модулю на доменну сутність).
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

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

import { DEFAULT_HTTP_PORT, HTTP_SERVER_ERROR } from './utils/constants.js';
console.log('SERVER INDEX JS STARTED');
dotenv.config();

const PORT = Number(process.env.PORT) || DEFAULT_HTTP_PORT;
const STATIC_DIR = 'public';

// Небезпечний дефолт секрету не повинен потрапити у продакшн: без власного
// JWT_SECRET підписані токени легко підробити.
const INSECURE_JWT_SECRET = 'change_me';
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === INSECURE_JWT_SECRET) {
  const message = 'JWT_SECRET не задано або використовується дефолтне значення.';
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${message} Запуск у production заблоковано.`);
  }
  console.warn(`Попередження: ${message} Задайте власний у .env перед деплоєм.`);
}

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(STATIC_DIR));

// Простий health-чек, корисний для моніторингу та deployment-перевірок.
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// ─── Реєстрація доменних маршрутів ────────────────────────────────────────────
app.use('/api/auth', authRoutes);
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
app.use('/api/public', publicRoutes);
app.use('/api/club', clubRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/upload', uploadRoutes);

// ─── Глобальна обробка помилок ────────────────────────────────────────────────
// Будь-яка помилка, передана через next(err), повертається клієнту як 500,
// а не валить процес. Залишаємо чотири параметри — так Express розпізнає
// саме обробник помилок.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Необроблена помилка запиту:', err);
  if (res.headersSent) {
    return next(err);
  }
  return res.status(HTTP_SERVER_ERROR).json({ error: 'Internal server error' });
});

// Підстраховка на рівні процесу: непередбачена відмова промісу чи виняток
// в асинхронному обробнику не повинні «вбивати» сервер для всіх користувачів.
process.on('unhandledRejection', (reason) => {
  console.error('Необроблений reject промісу:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Необроблений виняток:', error);
});

console.log('ROUTES REGISTERED');

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

