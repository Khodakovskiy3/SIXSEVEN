/**
 * Файловий журнал серверних помилок.
 *
 * Кожна серверна помилка дублюється у файл журналу (за замовчуванням
 * logs/error.log) і в консоль. Журнал потрібен, щоб збої фіксувалися
 * навіть тоді, коли ніхто не дивиться у консоль (продакшн, фон).
 *
 * Формат запису — рядок з UTC-міткою часу, рівнем і повідомленням,
 * далі (за наявності) стек помилки. Мітку беремо в UTC (ISO 8601), щоб
 * уникнути неоднозначності часових зон, з якою вже стикався проєкт.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));

/** Каталог журналів (налаштовується через LOG_DIR; типово — logs/ у корені проєкту). */
const LOG_DIR = process.env.LOG_DIR || join(CURRENT_DIR, '..', '..', 'logs');

/** Файл журналу серверних помилок. */
const ERROR_LOG_FILE = join(LOG_DIR, 'error.log');

/** Рівень запису журналу. */
const LOG_LEVEL_ERROR = 'ERROR';

// Каталог створюємо один раз при завантаженні модуля. Якщо не вдалося —
// логер не має «вбивати» сервер, тож лише попереджаємо в консоль.
try {
  mkdirSync(LOG_DIR, { recursive: true });
} catch (error) {
  console.error('Не вдалося створити каталог журналу:', error.message);
}

/**
 * Формує один текстовий запис журналу.
 *
 * @param {string} level Рівень запису (напр., ERROR).
 * @param {string} message Короткий опис події.
 * @param {Error|unknown} [error] Об'єкт помилки (для стеку).
 * @param {object} [meta] Додатковий контекст (метод, шлях, id користувача тощо).
 * @returns {string} Рядок запису із завершальним переносом.
 */
function formatEntry(level, message, error, meta) {
  const timestamp = new Date().toISOString();
  const parts = [`[${timestamp}] ${level} ${message}`];

  if (meta && Object.keys(meta).length > 0) {
    parts.push(`  context: ${JSON.stringify(meta)}`);
  }

  if (error) {
    // Для Error беремо стек; для іншого — рядкове подання.
    parts.push(error instanceof Error ? error.stack || error.message : String(error));
  }

  return `${parts.join('\n')}\n`;
}

/**
 * Реєструє серверну помилку: у консоль і у файл журналу.
 * Запис у файл синхронний — щоб гарантовано зберегтися навіть перед
 * аварійним завершенням процесу (uncaughtException).
 *
 * @param {string} message Короткий опис того, що сталося.
 * @param {Error|unknown} [error] Об'єкт помилки.
 * @param {object} [meta] Додатковий контекст запиту.
 * @returns {void}
 */
export function logError(message, error, meta) {
  const entry = formatEntry(LOG_LEVEL_ERROR, message, error, meta);

  // У консоль — без завершального переносу (console його додасть сам).
  console.error(entry.trimEnd());

  try {
    appendFileSync(ERROR_LOG_FILE, entry);
  } catch (writeError) {
    // Збій запису журналу не має ламати основний потік обробки помилки.
    console.error('Не вдалося записати у журнал помилок:', writeError.message);
  }
}
