/**
 * Серверні константи системи обліку спортивного клубу.
 *
 * Усі магічні числа та рядкові літерали, що мають бізнес-сенс,
 * винесені сюди для централізованого керування та документації.
 */

// ─── Безпека ─────────────────────────────────────────────────────────────────

/** Кількість раундів для bcrypt-хешування паролю. */
export const BCRYPT_SALT_ROUNDS = 10;

/** Тривалість дії JWT-токена. */
export const JWT_TTL = '7d';

/** Префікс для заголовка Authorization (Bearer <token>). */
export const AUTH_HEADER_PREFIX = 'Bearer ';

// ─── База даних ──────────────────────────────────────────────────────────────

/** Максимальна кількість одночасних з’єднань у пулі PostgreSQL. */
export const DB_POOL_MAX = 10;

/** Час життя простого з’єднання у пулі (мс). */
export const DB_IDLE_TIMEOUT_MS = 30_000;

/** Порт PostgreSQL за замовчуванням. */
export const DEFAULT_DB_PORT = 5432;

/** Код помилки PostgreSQL для порушення унікальності (unique_violation). */
export const PG_UNIQUE_VIOLATION = '23505';

// ─── HTTP-сервер ─────────────────────────────────────────────────────────────

/** Порт HTTP-сервера за замовчуванням. */
export const DEFAULT_HTTP_PORT = 3000;

// ─── HTTP-статуси ────────────────────────────────────────────────────────────
// Виносимо часті статуси у константи, щоб не плутати числа у коді
// та підвищити читабельність відповідей маршрутів.

export const HTTP_OK = 200;
export const HTTP_CREATED = 201;
export const HTTP_BAD_REQUEST = 400;
export const HTTP_UNAUTHORIZED = 401;
export const HTTP_FORBIDDEN = 403;
export const HTTP_NOT_FOUND = 404;
export const HTTP_CONFLICT = 409;
export const HTTP_SERVER_ERROR = 500;

// ─── Доменна модель ──────────────────────────────────────────────────────────

/** Доступні ролі користувачів системи. */
export const ROLE = Object.freeze({
  ADMIN: 'admin',
  MANAGER: 'manager',
  TRAINER: 'trainer',
  CLIENT: 'client',
});

/** Перелік допустимих ролей як масив (для валідації input). */
export const VALID_ROLES = Object.values(ROLE);

/** Статуси абонемента. */
export const SUBSCRIPTION_STATUS = Object.freeze({
  ACTIVE: 'active',
  PAUSED: 'paused',
  EXPIRED: 'expired',
});

/** Статуси бронювання. */
export const BOOKING_STATUS = Object.freeze({
  ACTIVE: 'active',
  CANCELLED: 'cancelled',
});

/** Статус оплати за замовчуванням. */
export const PAYMENT_STATUS_COMPLETED = 'completed';

// ─── Діапазони звітів ───────────────────────────────────────────────────────

/** Дата, що використовується як «початок історії» у звітах. */
export const REPORT_MIN_DATE = '2000-01-01';

/** Дата, що використовується як «нескінченність» у звітах. */
export const REPORT_MAX_DATE = '2100-01-01';

// ─── Тренування за замовчуванням ─────────────────────────────────────────────

/** Місткість тренування за замовчуванням, якщо не вказано явно. */
export const DEFAULT_TRAINING_CAPACITY = 20;
