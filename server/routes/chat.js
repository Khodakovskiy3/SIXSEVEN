/**
 * Маршрути живого чату «гість ↔ адміністратор».
 *
 * Гостьова частина (публічна, без авторизації):
 *   POST /api/chat/guest/messages         — надіслати повідомлення.
 *   GET  /api/chat/guest/messages         — отримати повідомлення діалогу (polling).
 *
 * Адмінська частина (захищена простим паролем у заголовку X-Chat-Password):
 *   GET  /api/chat/admin/conversations               — список діалогів.
 *   GET  /api/chat/admin/conversations/:id/messages  — повідомлення діалогу (polling).
 *   POST /api/chat/admin/conversations/:id/messages  — відповісти гостю.
 *
 * Реалтайм реалізовано через polling на боці клієнта — стек суто REST,
 * websocket свідомо не вводимо.
 */

import { Router } from 'express';

import { query } from '../db.js';
import {
  HTTP_BAD_REQUEST,
  HTTP_CREATED,
  HTTP_NOT_FOUND,
  HTTP_UNAUTHORIZED,
} from '../utils/constants.js';

const router = Router();

// Пароль адмін-частини чату. За замовчуванням '123' (вимога бети),
// але переозначується через .env, щоб легко підняти безпеку пізніше.
const CHAT_ADMIN_PASSWORD = process.env.CHAT_ADMIN_PASSWORD || '123';

// Обмеження довжини, щоб уникнути зловживань і переповнення.
const MAX_BODY_LENGTH = 2000;
const MAX_TOKEN_LENGTH = 64;

/**
 * Зводить тіло повідомлення до коректного вигляду:
 * обрізає пробіли та довжину. Повертає null, якщо порожнє.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeBody(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_BODY_LENGTH);
}

/**
 * Перевіряє гостьовий токен: непорожній рядок розумної довжини.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeToken(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_TOKEN_LENGTH) return null;
  return trimmed;
}

/**
 * Парсить параметр `after` (id останнього отриманого повідомлення) у число.
 * За відсутності/некоректності повертає 0 — тобто «з початку діалогу».
 *
 * @param {unknown} value
 * @returns {number}
 */
function parseAfter(value) {
  const num = Number.parseInt(value, 10);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

// ─── Гостьова частина ─────────────────────────────────────────────────────────

router.post('/guest/messages', async (req, res) => {
  const token = normalizeToken(req.body?.guestToken);
  const body = normalizeBody(req.body?.body);

  if (!token) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing guest token' });
  }
  if (!body) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Повідомлення не може бути порожнім' });
  }

  // Знаходимо або створюємо діалог за токеном (idempotent через unique-обмеження).
  const conversation = await query(
    `insert into chat_conversations (guest_token)
     values ($1)
     on conflict (guest_token) do update set updated_at = now()
     returning id`,
    [token]
  );
  const conversationId = conversation.rows[0].id;

  const message = await query(
    `insert into chat_messages (conversation_id, sender, body)
     values ($1, 'guest', $2)
     returning id, conversation_id, sender, body, created_at`,
    [conversationId, body]
  );

  return res.status(HTTP_CREATED).json(message.rows[0]);
});

router.get('/guest/messages', async (req, res) => {
  const token = normalizeToken(req.query.token);
  const after = parseAfter(req.query.after);

  if (!token) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing guest token' });
  }

  const result = await query(
    `select m.id, m.sender, m.body, m.created_at
     from chat_messages m
     join chat_conversations c on c.id = m.conversation_id
     where c.guest_token = $1 and m.id > $2
     order by m.id`,
    [token, after]
  );

  return res.json(result.rows);
});

// ─── Адмінська частина (за паролем) ───────────────────────────────────────────

/**
 * Middleware: пропускає лише запити з правильним паролем у заголовку
 * X-Chat-Password. Свідомо проста «заглушка» під вимогу бети.
 */
function requireChatPassword(req, res, next) {
  const provided = req.headers['x-chat-password'];
  if (provided !== CHAT_ADMIN_PASSWORD) {
    return res.status(HTTP_UNAUTHORIZED).json({ error: 'Невірний пароль' });
  }
  return next();
}

router.use('/admin', requireChatPassword);

router.get('/admin/conversations', async (req, res) => {
  const result = await query(
    `select c.id,
            c.guest_token,
            c.guest_name,
            c.updated_at,
            (select body from chat_messages
             where conversation_id = c.id
             order by id desc limit 1) as last_message,
            (select count(*) from chat_messages
             where conversation_id = c.id
               and sender = 'guest'
               and read_by_admin = false) as unread
     from chat_conversations c
     order by c.updated_at desc`
  );

  return res.json(result.rows);
});

router.get('/admin/conversations/:id/messages', async (req, res) => {
  const { id } = req.params;
  const after = parseAfter(req.query.after);

  const exists = await query('select id from chat_conversations where id = $1', [id]);
  if (exists.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
  }

  // Позначаємо вхідні повідомлення гостя прочитаними.
  await query(
    `update chat_messages
     set read_by_admin = true
     where conversation_id = $1 and sender = 'guest' and read_by_admin = false`,
    [id]
  );

  const result = await query(
    `select id, sender, body, created_at
     from chat_messages
     where conversation_id = $1 and id > $2
     order by id`,
    [id, after]
  );

  return res.json(result.rows);
});

router.post('/admin/conversations/:id/messages', async (req, res) => {
  const { id } = req.params;
  const body = normalizeBody(req.body?.body);

  if (!body) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Повідомлення не може бути порожнім' });
  }

  const exists = await query('select id from chat_conversations where id = $1', [id]);
  if (exists.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
  }

  const message = await query(
    `insert into chat_messages (conversation_id, sender, body)
     values ($1, 'admin', $2)
     returning id, conversation_id, sender, body, created_at`,
    [id, body]
  );

  await query('update chat_conversations set updated_at = now() where id = $1', [id]);

  return res.status(HTTP_CREATED).json(message.rows[0]);
});

export default router;
