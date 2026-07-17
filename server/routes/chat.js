/**
 * Маршрути живого чату «гість ↔ адміністратор».
 *
 * Гостьова частина (публічна, без авторизації):
 *   POST /api/chat/guest/messages         — надіслати повідомлення.
 *   GET  /api/chat/guest/messages         — отримати повідомлення діалогу (polling).
 *
 * Клієнтська частина (JWT-авторизація, будь-яка роль):
 *   POST /api/chat/client/messages        — надіслати повідомлення від свого імені.
 *   GET  /api/chat/client/messages        — отримати власний діалог (polling).
 *   Діалог прив'язується до облікового запису токеном client-<userId>,
 *   тому зберігається між пристроями, а адміністратор бачить ім'я клієнта.
 *
 * Адмінська частина (JWT-авторизація, role=admin):
 *   GET  /api/chat/admin/conversations               — список діалогів.
 *   GET  /api/chat/admin/conversations/:id/messages  — повідомлення діалогу (polling).
 *   POST /api/chat/admin/conversations/:id/messages  — відповісти гостю.
 *   POST /api/chat/admin/conversations/:id/claim     — взяти діалог у роботу.
 *   POST /api/chat/admin/conversations/:id/release   — повернути діалог у чергу.
 *   POST /api/chat/admin/conversations/:id/close     — завершити діалог.
 *
 * Розподіл звернень: нове звернення «нічиє» і видиме всім адміністраторам.
 * Перший адміністратор, який виконує claim (або просто відповідає),
 * атомарно закріплює діалог за собою; відповіді інших блокуються, доки
 * діалог не повернуто в чергу.
 *
 * Реалтайм: основний канал — Server-Sent Events (SSE, пуш про зміни), а
 * polling лишається запобіжником на боці клієнта. Авторизація SSE — через
 * одноразовий квиток (EventSource не вміє слати Bearer-токен). Websocket
 * свідомо не вводимо: SSE достатньо для односпрямованих сповіщень.
 *   GET /api/chat/guest/stream?token=…            — SSE для гостя
 *   GET /api/chat/client/stream-ticket            — квиток для SSE клієнта
 *   GET /api/chat/admin/stream-ticket             — квиток для SSE адміна
 *   GET /api/chat/stream?ticket=…                 — SSE (клієнт/адмін)
 */

import { Router } from 'express';

import { query, withClient } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import {
  subscribeToConversation,
  subscribeToConversations,
  publishMessage,
  publishConversationsChange,
} from '../utils/chat-events.js';
import { issueTicket, redeemTicket } from '../utils/stream-ticket.js';
import {
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  HTTP_CREATED,
  HTTP_FORBIDDEN,
  HTTP_NOT_FOUND,
} from '../utils/constants.js';

const router = Router();

// Обмеження довжини, щоб уникнути зловживань і переповнення.
const MAX_BODY_LENGTH = 2000;
const MAX_TOKEN_LENGTH = 64;

// Префікс токена діалогу авторизованого користувача: client-<userId>.
// Гостьові токени — випадкові UUID, тож колізія з цим префіксом неможлива.
const CLIENT_TOKEN_PREFIX = 'client-';

/**
 * Зводить тіло повідомлення до коректного вигляду:
 * обрізає пробіли та довжину. Повертає null, якщо порожнє.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeBody(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, MAX_BODY_LENGTH);
}

/**
 * Перевіряє гостьовий токен: непорожній рядок розумної довжини.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeToken(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_TOKEN_LENGTH) {
    return null;
  }

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

/**
 * Стан діалогу з погляду відвідувача. Окремої колонки в БД не потрібно:
 * стан однозначно виводиться з assigned_admin_id та closed_at.
 */
const CHAT_STATE = Object.freeze({
  NONE: 'none',       // діалогу немає — можна надіслати запит
  PENDING: 'pending', // запит надіслано, очікує підтвердження адміністратора
  ACTIVE: 'active',   // адміністратор підтвердив — можна листуватися
  CLOSED: 'closed',   // адміністратор завершив — можна запросити новий
});

/**
 * Повертає діалог за токеном.
 *
 * @param {string} token Токен гостя або client-<userId>.
 * @returns {Promise<{id: number, assigned_admin_id: number|null, closed_at: Date|null}|null>}
 */
async function findConversation(token) {
  const result = await query(
    `select id, assigned_admin_id, closed_at
     from chat_conversations
     where guest_token = $1`,
    [token]
  );
  return result.rows[0] || null;
}

/**
 * Зводить рядок діалогу до стану, зрозумілого віджету.
 *
 * @param {{assigned_admin_id: number|null, closed_at: Date|null}|null} conversation
 * @returns {string} Одне зі значень CHAT_STATE.
 */
function toChatState(conversation) {
  if (!conversation) {
    return CHAT_STATE.NONE;
  }
  if (conversation.closed_at !== null) {
    return CHAT_STATE.CLOSED;
  }
  if (conversation.assigned_admin_id === null) {
    return CHAT_STATE.PENDING;
  }
  return CHAT_STATE.ACTIVE;
}

/**
 * Пояснює, чому писати зараз не можна.
 *
 * @param {string} state Поточний стан діалогу.
 * @returns {string}
 */
function describeGate(state) {
  if (state === CHAT_STATE.PENDING) {
    return 'Запит очікує підтвердження адміністратора';
  }
  if (state === CHAT_STATE.CLOSED) {
    return 'Діалог завершено. Надішліть новий запит.';
  }
  return 'Спершу надішліть запит на діалог';
}

/**
 * Створює новий запит на діалог, видаляючи попередній діалог цього токена
 * разом із повідомленнями (ON DELETE CASCADE) — так користувач починає
 * листування «з чистого аркуша».
 *
 * Видалення і вставка в одній транзакції: guest_token унікальний, тож без неї
 * паралельний запит міг би впасти на конфлікті унікальності.
 *
 * @param {string} token Токен гостя або client-<userId>.
 * @param {string|null} [guestName] Ім'я для списку адміністратора.
 * @param {number|null} [userId] Явний FK на users для авторизованих (П7,
 *   АУДИТ_БД.md) — замінює парсинг токена 'client-<userId>' у JOIN-ах.
 * @returns {Promise<number>} Ідентифікатор створеного діалогу.
 */
async function createConversationRequest(token, guestName = null, userId = null) {
  return withClient(async (client) => {
    await client.query('begin');
    await client.query('delete from chat_conversations where guest_token = $1', [token]);
    const created = await client.query(
      `insert into chat_conversations (guest_token, guest_name, user_id)
       values ($1, $2, $3)
       returning id`,
      [token, guestName, userId]
    );
    await client.query('commit');
    return created.rows[0].id;
  });
}

// ─── Гостьова частина ─────────────────────────────────────────────────────────

router.post('/guest/request', async (req, res) => {
  const token = normalizeToken(req.body?.guestToken);
  if (!token) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing guest token' });
  }

  await createConversationRequest(token);
  return res.status(HTTP_CREATED).json({ state: CHAT_STATE.PENDING });
});

router.post('/guest/messages', async (req, res) => {
  const token = normalizeToken(req.body?.guestToken);
  const body = normalizeBody(req.body?.body);

  if (!token) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing guest token' });
  }
  if (!body) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Повідомлення не може бути порожнім' });
  }

  // Писати можна лише в підтверджений діалог: діалог більше не створюється
  // повідомленням і завершений не відкривається знову — потрібен новий запит.
  const conversation = await findConversation(token);
  const state = toChatState(conversation);
  if (state !== CHAT_STATE.ACTIVE) {
    return res.status(HTTP_CONFLICT).json({ error: describeGate(state), state });
  }

  const message = await query(
    `insert into chat_messages (conversation_id, sender, body)
     values ($1, 'guest', $2)
     returning id, conversation_id, sender, body, created_at`,
    [conversation.id, body]
  );
  await query(
    'update chat_conversations set updated_at = now() where id = $1',
    [conversation.id]
  );

  publishMessage(conversationId);
  return res.status(HTTP_CREATED).json(message.rows[0]);
});

// SSE-стрім гостя: пуш-сповіщення про нові повідомлення діалогу.
// Токен діалогу — випадковий (не персональні дані), тож допустимо у query.
// Публічний маршрут (до жодного auth-префіксу не належить).
router.get('/guest/stream', async (req, res) => {
  const token = normalizeToken(req.query.token);
  if (!token) {
    return res.status(HTTP_BAD_REQUEST).end();
  }
  const conv = await query(
    'select id from chat_conversations where guest_token = $1',
    [token]
  );
  if (conv.rows.length === 0) {
    // Діалогу ще немає (гість нічого не писав) — нема на що підписуватись.
    // Клієнт лишиться на polling, доки не надішле перше повідомлення.
    return res.status(HTTP_NOT_FOUND).end();
  }
  return subscribeToConversation(conv.rows[0].id, req, res);
});

router.get('/guest/messages', async (req, res) => {
  const token = normalizeToken(req.query.token);
  const after = parseAfter(req.query.after);

  if (!token) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Missing guest token' });
  }

  const conversation = await findConversation(token);
  const state = toChatState(conversation);
  if (!conversation) {
    return res.json({ state, messages: [] });
  }

  const result = await query(
    `select id, sender, body, created_at
     from chat_messages
     where conversation_id = $1 and id > $2
     order by id`,
    [conversation.id, after]
  );

  return res.json({ state, messages: result.rows });
});

// ─── Клієнтська частина (JWT, будь-яка роль) ─────────────────────────────────

router.use('/client', authRequired);

/**
 * Токен діалогу авторизованого користувача.
 *
 * @param {{ id: number }} user Користувач із JWT.
 * @returns {string}
 */
function clientToken(user) {
  return `${CLIENT_TOKEN_PREFIX}${user.id}`;
}

router.post('/client/request', async (req, res) => {
  // Ім'я зберігаємо при створенні запиту, щоб адміністратор бачив, хто звернувся.
  // user_id — явний FK (П7), а не лише кодування в токені.
  await createConversationRequest(clientToken(req.user), req.user.name, req.user.id);
  return res.status(HTTP_CREATED).json({ state: CHAT_STATE.PENDING });
});

router.post('/client/messages', async (req, res) => {
  const body = normalizeBody(req.body?.body);
  if (!body) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Повідомлення не може бути порожнім' });
  }

  const conversation = await findConversation(clientToken(req.user));
  const state = toChatState(conversation);
  if (state !== CHAT_STATE.ACTIVE) {
    return res.status(HTTP_CONFLICT).json({ error: describeGate(state), state });
  }

  const message = await query(
    `insert into chat_messages (conversation_id, sender, body)
     values ($1, 'guest', $2)
     returning id, conversation_id, sender, body, created_at`,
    [conversation.id, body]
  );
  await query(
    'update chat_conversations set updated_at = now() where id = $1',
    [conversation.id]
  );

  publishMessage(conversationId);
  return res.status(HTTP_CREATED).json(message.rows[0]);
});

// Квиток для SSE-стріму клієнта (EventSource не вміє слати Bearer-токен).
// Викликається звичайним авторизованим запитом; квиток одноразовий.
router.get('/client/stream-ticket', (req, res) => {
  return res.json({ ticket: issueTicket(req.user) });
});

router.get('/client/messages', async (req, res) => {
  const after = parseAfter(req.query.after);

  const conversation = await findConversation(clientToken(req.user));
  const state = toChatState(conversation);
  if (!conversation) {
    return res.json({ state, messages: [] });
  }

  const result = await query(
    `select id, sender, body, created_at
     from chat_messages
     where conversation_id = $1 and id > $2
     order by id`,
    [conversation.id, after]
  );

  return res.json({ state, messages: result.rows });
});

// ─── Адмінська частина (JWT, role=admin) ─────────────────────────────────────

router.use('/admin', authRequired, requireRole('admin'));

/**
 * Атомарно закріплює діалог за адміністратором, якщо той ще «нічий».
 * Саме умова `assigned_admin_id is null` гарантує, що з кількох
 * одночасних спроб виграє лише одна.
 *
 * @param {number} conversationId Ідентифікатор діалогу.
 * @param {{ id: number, name: string }} admin Адміністратор, що бере діалог.
 * @returns {Promise<boolean>} true, якщо діалог закріплено цим викликом.
 */
async function tryClaimConversation(conversationId, admin) {
  const claimed = await query(
    `update chat_conversations
     set assigned_admin_id = $1, updated_at = now()
     where id = $2 and assigned_admin_id is null
     returning id`,
    [admin.id, conversationId]
  );

  if (claimed.rows.length === 0) {
    return false;
  }

  // Системне повідомлення бачать і гість, і адміністратори.
  await query(
    `insert into chat_messages (conversation_id, sender, body, read_by_admin)
     values ($1, 'system', $2, true)`,
    [conversationId, `Адміністратор ${admin.name} приєднався до діалогу`]
  );

  return true;
}

router.get('/admin/conversations', async (req, res) => {
  const result = await query(
    `select c.id,
            c.guest_token,
            c.guest_name,
            c.updated_at,
            c.assigned_admin_id,
            c.closed_at,
            u.name as assigned_admin_name,
            (select body from chat_messages
             where conversation_id = c.id
             order by id desc limit 1) as last_message,
            (select count(*) from chat_messages
             where conversation_id = c.id
               and sender = 'guest'
               and read_by_admin = false) as unread
     from chat_conversations c
     left join users u on u.id = c.assigned_admin_id
     order by (c.closed_at is null) desc,
              (c.assigned_admin_id is null and c.closed_at is null) desc,
              c.updated_at desc`
  );

  return res.json(result.rows);
});

router.post('/admin/conversations/:id/claim', async (req, res) => {
  const { id } = req.params;

  const existing = await query(
    'select assigned_admin_id, closed_at from chat_conversations where id = $1',
    [id]
  );
  if (existing.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
  }
  if (existing.rows[0].closed_at !== null) {
    return res.status(HTTP_CONFLICT).json({ error: 'Діалог завершено' });
  }

  // Повторний claim власного діалогу — не помилка (ідемпотентність).
  if (existing.rows[0].assigned_admin_id === req.user.id) {
    return res.json({ id: Number(id), assignedAdminId: req.user.id });
  }

  const isClaimed = await tryClaimConversation(Number(id), req.user);
  if (!isClaimed) {
    return res
      .status(HTTP_CONFLICT)
      .json({ error: 'Діалог уже взяв інший адміністратор' });
  }

  publishConversationsChange();
  publishMessage(Number(id));
  return res.json({ id: Number(id), assignedAdminId: req.user.id });
});

router.post('/admin/conversations/:id/release', async (req, res) => {
  const { id } = req.params;

  const existing = await query(
    'select assigned_admin_id from chat_conversations where id = $1',
    [id]
  );
  if (existing.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
  }
  if (existing.rows[0].assigned_admin_id !== req.user.id) {
    return res
      .status(HTTP_FORBIDDEN)
      .json({ error: 'Повернути в чергу може лише призначений адміністратор' });
  }

  await query(
    `update chat_conversations
     set assigned_admin_id = null, updated_at = now()
     where id = $1`,
    [id]
  );
  await query(
    `insert into chat_messages (conversation_id, sender, body, read_by_admin)
     values ($1, 'system', 'Діалог повернуто в чергу очікування', true)`,
    [id]
  );

  publishConversationsChange();
  publishMessage(Number(id));
  return res.json({ id: Number(id), assignedAdminId: null });
});

router.post('/admin/conversations/:id/close', async (req, res) => {
  const { id } = req.params;

  const existing = await query(
    'select assigned_admin_id, closed_at from chat_conversations where id = $1',
    [id]
  );
  if (existing.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
  }
  if (existing.rows[0].closed_at !== null) {
    return res.json({ id: Number(id), closed: true });
  }

  // Завершити може відповідальний адміністратор; «нічий» діалог — будь-хто
  // (щоб можна було закривати спам, який ніхто не брав у роботу).
  const assignedAdminId = existing.rows[0].assigned_admin_id;
  if (assignedAdminId !== null && assignedAdminId !== req.user.id) {
    return res
      .status(HTTP_FORBIDDEN)
      .json({ error: 'Завершити може лише адміністратор, який веде діалог' });
  }

  await query(
    `update chat_conversations
     set closed_at = now(), updated_at = now()
     where id = $1`,
    [id]
  );
  await query(
    `insert into chat_messages (conversation_id, sender, body, read_by_admin)
     values ($1, 'system', $2, true)`,
    [id, `Діалог завершено адміністратором ${req.user.name}`]
  );

  publishConversationsChange();
  publishMessage(Number(id));
  return res.json({ id: Number(id), closed: true });
});

router.get('/admin/conversations/:id/messages', async (req, res) => {
  const { id } = req.params;
  const after = parseAfter(req.query.after);

  const exists = await query(
    'select id, assigned_admin_id from chat_conversations where id = $1',
    [id]
  );
  if (exists.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
  }

  // Прочитаними повідомлення позначає лише відповідальний адміністратор,
  // інакше перегляд чужого діалогу гасив би лічильник непрочитаного.
  const assignedAdminId = exists.rows[0].assigned_admin_id;
  if (assignedAdminId === null || assignedAdminId === req.user.id) {
    await query(
      `update chat_messages
       set read_by_admin = true
       where conversation_id = $1 and sender = 'guest' and read_by_admin = false`,
      [id]
    );
  }

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

  const exists = await query(
    'select id, assigned_admin_id, closed_at from chat_conversations where id = $1',
    [id]
  );
  if (exists.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).json({ error: 'Not found' });
  }
  if (exists.rows[0].closed_at !== null) {
    return res.status(HTTP_CONFLICT).json({ error: 'Діалог завершено' });
  }

  // Відповідь у «нічий» діалог автоматично бере його в роботу; якщо діалог
  // уже веде інший адміністратор — відповідь блокується.
  const assignedAdminId = exists.rows[0].assigned_admin_id;
  if (assignedAdminId === null) {
    const isClaimed = await tryClaimConversation(Number(id), req.user);
    if (!isClaimed) {
      return res
        .status(HTTP_CONFLICT)
        .json({ error: 'Діалог щойно взяв інший адміністратор' });
    }
  } else if (assignedAdminId !== req.user.id) {
    return res
      .status(HTTP_FORBIDDEN)
      .json({ error: 'Діалог веде інший адміністратор' });
  }

  const message = await query(
    `insert into chat_messages (conversation_id, sender, body)
     values ($1, 'admin', $2)
     returning id, conversation_id, sender, body, created_at`,
    [id, body]
  );

  await query('update chat_conversations set updated_at = now() where id = $1', [id]);

  publishMessage(Number(id));
  return res.status(HTTP_CREATED).json(message.rows[0]);
});

// Квиток для SSE-стріму адміністратора.
router.get('/admin/stream-ticket', (req, res) => {
  return res.json({ ticket: issueTicket(req.user) });
});

// ─── SSE-стрім для авторизованих (клієнт / адміністратор) ────────────────────
// Поза auth-префіксами /client та /admin, бо EventSource не шле Bearer-токен.
// Авторизація — через одноразовий квиток у query (не містить персональних даних).
router.get('/stream', async (req, res) => {
  const user = redeemTicket(req.query.ticket);
  if (!user) {
    return res.status(HTTP_FORBIDDEN).end();
  }

  // Адміністратор слухає зміни списку діалогів; клієнт — свій діалог.
  if (user.role === 'admin') {
    return subscribeToConversations(req, res);
  }

  const token = `${CLIENT_TOKEN_PREFIX}${user.userId}`;
  const conv = await query(
    'select id from chat_conversations where guest_token = $1',
    [token]
  );
  if (conv.rows.length === 0) {
    return res.status(HTTP_NOT_FOUND).end();
  }
  return subscribeToConversation(conv.rows[0].id, req, res);
});

export default router;
