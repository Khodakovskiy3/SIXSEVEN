/**
 * AI-асистент Cluvyra (Claude API у production, Ollama — опційно локально).
 *
 * Маршрути (JWT, будь-яка роль, якщо не зазначено інше):
 *   GET  /api/ai/status            — чи доступний асистент (для UI).
 *   POST /api/ai/assistant         — відповідь на діалог; для клієнта може
 *                                    повернути реальні слоти (slots) або картку
 *                                    підтвердження бронювання (pendingBooking).
 *   POST /api/ai/bookings/prepare  — (client) підготувати бронювання обраного
 *                                    слоту без участі моделі (кнопка на картці).
 *   POST /api/ai/bookings/confirm  — (client) підтвердити бронювання токеном.
 *   POST /api/ai/bookings/decline  — (client) відхилити пропозицію.
 *   GET  /api/ai/usage             — (admin, manager) агреговані метрики AI.
 *
 * Бронювання створюється ЛИШЕ через /bookings/confirm — модель токена не бачить.
 */

import { Router } from 'express';

import { config } from '../config.js';
import { logError } from '../utils/logger.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { getClientIdByUserId } from '../utils/identity.js';
import { runAssistant, aiStatus, AiUnavailableError } from '../ai/assistant.js';
import { checkMinuteLimit, isUnderDailyLimit, recordUsage, usageSummary } from '../ai/usage.js';
import {
  prepareBookingConfirmation,
  confirmBooking,
  declineBooking,
  ConfirmationError,
} from '../ai/booking-confirmations.js';
import { BookingError } from '../services/booking-service.js';
import { notifyClientBookingConfirmed, notifyTrainerIfClassFull } from '../services/booking-notifications.js';
import {
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  HTTP_CREATED,
  HTTP_NOT_FOUND,
  HTTP_TOO_MANY_REQUESTS,
  ROLE,
} from '../utils/constants.js';

const router = Router();

const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_GONE = 410;

/**
 * Нормалізує історію діалогу з фронтенда: лише ролі user/assistant,
 * непорожні рядки з обмеженою довжиною, останні AI_HISTORY_LIMIT повідомлень,
 * перше — від користувача, останнє — питання користувача.
 *
 * @param {unknown} value
 * @returns {Array<{role: 'user'|'assistant', content: string}>|null}
 */
export function normalizeHistory(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) {
    return null;
  }

  const history = [];
  for (const item of value.slice(-config.ai.historyLimit)) {
    const isValidRole = item?.role === 'user' || item?.role === 'assistant';
    const content = typeof item?.content === 'string' ? item.content.trim() : '';
    if (!isValidRole || !content) {
      return null;
    }
    history.push({ role: item.role, content: content.slice(0, config.ai.maxMessageChars) });
  }

  while (history.length > 0 && history[0].role !== 'user') {
    history.shift();
  }
  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    return null;
  }
  return history;
}

const UNAVAILABLE_MESSAGES = {
  disabled: 'АІ-асистент вимкнений для цього клубу.',
  not_configured: 'АІ-асистент ще не налаштований. Зверніться до адміністратора.',
  rate_limited: 'АІ-асистент зараз перевантажений. Спробуйте за хвилину.',
  timeout: 'АІ-асистент не відповів вчасно. Спробуйте ще раз.',
  default: 'АІ-асистент тимчасово недоступний. Спробуйте пізніше.',
};

router.use(authRequired);

router.get('/status', (req, res) => {
  const status = aiStatus();
  return res.json({ enabled: status.enabled, available: status.available, bookingEnabled: req.user.role === ROLE.CLIENT });
});

router.post('/assistant', async (req, res) => {
  const history = normalizeHistory(req.body?.messages);
  if (!history) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Некоректний формат діалогу' });
  }

  const status = aiStatus();
  if (!status.available) {
    return res.status(HTTP_SERVICE_UNAVAILABLE).json({
      error: UNAVAILABLE_MESSAGES[status.enabled ? 'not_configured' : 'disabled'],
      code: 'AI_UNAVAILABLE',
    });
  }

  const minute = checkMinuteLimit(req.user.id);
  if (!minute.allowed) {
    return res.status(HTTP_TOO_MANY_REQUESTS).json({
      error: 'Занадто часті запити до асистента. Зачекайте трохи.',
      retryAfter: minute.retryAfterSec,
    });
  }
  if (!(await isUnderDailyLimit(req.user.id))) {
    return res.status(HTTP_TOO_MANY_REQUESTS).json({
      error: 'Денний ліміт запитів до асистента вичерпано. Спробуйте завтра.',
      code: 'AI_DAILY_LIMIT',
    });
  }

  const startedAt = Date.now();
  try {
    const result = await runAssistant({ user: req.user, history });
    await recordUsage({
      userId: req.user.id,
      provider: result.stats.provider,
      model: result.stats.model,
      status: 'ok',
      inputTokens: result.stats.inputTokens,
      outputTokens: result.stats.outputTokens,
      toolCalls: result.stats.toolCalls,
      latencyMs: Date.now() - startedAt,
    });
    const { stats, ...payload } = result;
    return res.json(payload);
  } catch (error) {
    if (error instanceof AiUnavailableError) {
      // Без вмісту повідомлень: лише код причини.
      logError('АІ-асистент недоступний', error.cause || error, { userId: req.user.id, reason: error.reason });
      await recordUsage({
        userId: req.user.id,
        provider: aiStatus().provider,
        model: config.ai.provider === 'ollama' ? config.ai.ollamaModel : config.ai.anthropicModel,
        status: `error:${error.reason}`.slice(0, 20),
        latencyMs: Date.now() - startedAt,
      });
      return res.status(HTTP_SERVICE_UNAVAILABLE).json({
        error: UNAVAILABLE_MESSAGES[error.reason] || UNAVAILABLE_MESSAGES.default,
        code: 'AI_UNAVAILABLE',
      });
    }
    throw error;
  }
});

router.post('/bookings/prepare', requireRole(ROLE.CLIENT), async (req, res) => {
  const scheduleId = Number(req.body?.schedule_id);
  if (!Number.isInteger(scheduleId) || scheduleId <= 0) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing schedule_id' });
  }
  const clientId = await getClientIdByUserId(req.user.id);
  if (!clientId) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Client not found' });
  }

  const prepared = await prepareBookingConfirmation({ userId: req.user.id, clientId, scheduleId });
  if (!prepared.ok) {
    return res.status(HTTP_CONFLICT).json({ error: prepared.message, code: prepared.code });
  }
  return res.json({
    pendingBooking: { token: prepared.token, expiresAt: prepared.expiresAt, slot: prepared.slot },
  });
});

router.post('/bookings/confirm', requireRole(ROLE.CLIENT), async (req, res) => {
  const token = req.body?.token;
  try {
    const { booking, slot } = await confirmBooking({ userId: req.user.id, token });
    notifyClientBookingConfirmed(req.user.id, booking.schedule_id).catch(() => {});
    notifyTrainerIfClassFull(booking.schedule_id).catch(() => {});
    return res.status(HTTP_CREATED).json({ booking, slot });
  } catch (error) {
    if (error instanceof ConfirmationError) {
      const status = error.code === 'EXPIRED' ? HTTP_GONE
        : error.code === 'ALREADY_CONFIRMED' ? HTTP_CONFLICT
          : HTTP_BAD_REQUEST;
      return res.status(status).json({ error: error.message, code: error.code });
    }
    if (error instanceof BookingError) {
      return res.status(HTTP_CONFLICT).json({ error: error.message, code: error.code });
    }
    throw error;
  }
});

router.post('/bookings/decline', requireRole(ROLE.CLIENT), async (req, res) => {
  const declined = await declineBooking({ userId: req.user.id, token: req.body?.token });
  return res.json({ ok: true, declined });
});

router.get('/usage', requireRole(ROLE.ADMIN, ROLE.MANAGER), async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  return res.json({ days, rows: await usageSummary(days) });
});

export default router;
