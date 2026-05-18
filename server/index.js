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

import { DEFAULT_HTTP_PORT } from './utils/constants.js';

dotenv.config();

const PORT = Number(process.env.PORT) || DEFAULT_HTTP_PORT;
const STATIC_DIR = 'public';

const app = express();

app.use(cors());
app.use(express.json());
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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
