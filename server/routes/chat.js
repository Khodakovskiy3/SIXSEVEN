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
 * Реалтайм реалізовано через polling на боці клієнта — стек суто REST,
 * websocket свідомо не вводимо.
 */

import { Router } from 'express';

import { query } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
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
  await reopenIfClosed(conversationId);

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

/**
 * Знову відкриває завершений діалог після нового повідомлення відвідувача.
 * Діалог повертається в чергу очікування (assigned_admin_id скидається),
 * бо попередній адміністратор може бути вже не на зміні.
 *
 * @param {number} conversationId Ідентифікатор діалогу.
 * @returns {Promise<void>}
 */
async function reopenIfClosed(conversationId) {
  await query(
    `update chat_conversations
     set closed_at = null, assigned_admin_id = null, updated_at = now()
     where id = $1 and closed_at is not null`,
    [conversationId]
  );
}

// ─── Клієнтська частина (JWT, будь-яка роль) ─────────────────────────────────

router.use('/client', authRequired);

/**
 * Знаходить або створює діалог авторизованого користувача.
 * Ім'я оновлюється при кожному зверненні, щоб перейменування акаунта
 * відображалось у списку адміністратора.
 *
 * @param {{ id: number, name: string }} user Користувач із JWT.
 * @returns {Promise<number>} Ідентифікатор діалогу.
 */
async function findOrCreateClientConversation(user) {
  const token = `${CLIENT_TOKEN_PREFIX}${user.id}`;
  const conversation = await query(
    `insert into chat_conversations (guest_token, guest_name)
     values ($1, $2)
     on conflict (guest_token) do update set updated_at = now(), guest_name = $2
     returning id`,
    [token, user.name]
  );
  return conversation.rows[0].id;
}

router.post('/client/messages', async (req, res) => {
  const body = normalizeBody(req.body?.body);
  if (!body) {
    return res.status(HTTP_BAD_REQUEST).json({ error: 'Повідомлення не може бути порожнім' });
  }

  const conversationId = await findOrCreateClientConversation(req.user);
  await reopenIfClosed(conversationId);
  const message = await query(
    `insert into chat_messages (conversation_id, sender, body)
     values ($1, 'guest', $2)
     returning id, conversation_id, sender, body, created_at`,
    [conversationId, body]
  );

  return res.status(HTTP_CREATED).json(message.rows[0]);
});

router.get('/client/messages', async (req, res) => {
  const after = parseAfter(req.query.after);
  const token = `${CLIENT_TOKEN_PREFIX}${req.user.id}`;

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

  return res.status(HTTP_CREATED).json(message.rows[0]);
});

export default router;
