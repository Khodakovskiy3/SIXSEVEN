/**
 * Автозапуск Ollama перед стартом dev-сервера (хук predev у package.json).
 *
 * Логіка:
 *  1. Якщо Ollama вже відповідає — нічого не робимо.
 *  2. Якщо ні — запускаємо `ollama serve` відв'язаним фоновим процесом
 *     (він переживає завершення npm run dev) і чекаємо готовності.
 *  3. Якщо бінарник ollama не знайдено або адреса віддалена — лише
 *     попереджаємо і НЕ блокуємо запуск сервера: без Ollama працює все,
 *     крім АІ-асистента, який чемно відповість 503.
 */

import { spawn } from 'node:child_process';
import dotenv from 'dotenv';

dotenv.config();

/** Адреса Ollama — та сама змінна, що використовує server/routes/ai.js. */
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

/** Тайм-аут одиничної перевірки доступності, мс. */
const PROBE_TIMEOUT_MS = 1000;

/** Скільки часу чекати, поки щойно запущена Ollama стане готовою, мс. */
const STARTUP_WAIT_MS = 15_000;

/** Інтервал між повторними перевірками готовності, мс. */
const POLL_INTERVAL_MS = 500;

/**
 * Перевіряє, чи відповідає Ollama на базовий запит.
 *
 * @returns {Promise<boolean>} true, якщо сервер живий.
 */
async function isOllamaUp() {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Пауза на задану кількість мілісекунд.
 *
 * @param {number} ms Тривалість паузи.
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const isLocalUrl = OLLAMA_URL.includes('localhost') || OLLAMA_URL.includes('127.0.0.1');

if (await isOllamaUp()) {
  console.log('Ollama вже запущена — ок.');
  process.exit(0);
}

// Віддалену Ollama (інший хост/Docker) звідси не запустити — лише попереджаємо.
if (!isLocalUrl) {
  console.warn(`Ollama на ${OLLAMA_URL} не відповідає. АІ-асистент буде недоступний.`);
  process.exit(0);
}

console.log('Запускаю ollama serve у фоні…');

// detached + unref: процес живе окремо від npm run dev і не тримає його.
// Помилка запуску (бінарник відсутній) не повинна зривати старт сервера.
let hasSpawnFailed = false;
const child = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' });
child.on('error', () => {
  hasSpawnFailed = true;
});
child.unref();

const deadline = Date.now() + STARTUP_WAIT_MS;
let isReady = false;
while (Date.now() < deadline) {
  if (hasSpawnFailed) {
    break;
  }
  if (await isOllamaUp()) {
    isReady = true;
    break;
  }
  await sleep(POLL_INTERVAL_MS);
}

if (isReady) {
  console.log('Ollama готова.');
} else if (hasSpawnFailed) {
  console.warn(
    'Не знайдено бінарник ollama (brew install ollama). АІ-асистент буде недоступний.'
  );
} else {
  console.warn('Ollama не піднялася за відведений час. АІ-асистент може бути недоступний.');
}

// У будь-якому разі не блокуємо запуск сервера.
process.exit(0);
