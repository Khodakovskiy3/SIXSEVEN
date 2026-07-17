/**
 * Легкий in-memory хаб подій чату для Server-Sent Events (SSE).
 *
 * Замість того щоб клієнти опитували сервер кожні кілька секунд, вони
 * тримають одне SSE-з'єднання і отримують подію «є зміни» саме тоді, коли
 * у діалозі з'являється нове повідомлення. Отримавши подію, клієнт
 * дозавантажує нові повідомлення звичайним GET (з курсором after).
 *
 * Хаб свідомо простий: тримає підписників у пам'яті процесу. Для одного
 * інстансу цього достатньо; за горизонтального масштабування знадобиться
 * спільна шина (Redis pub/sub тощо).
 *
 * Транспорт лишається сумісним із наявним polling: SSE — це лише швидший
 * «дзвінок», а самі дані клієнт бере тими ж REST-ендпоінтами.
 */

import { EventEmitter } from 'node:events';

const emitter = new EventEmitter();
// Підписників може бути багато (кожна вкладка/діалог) — знімаємо ліміт.
emitter.setMaxListeners(0);

/** Назва події для конкретного діалогу. */
const messageEvent = (conversationId) => `msg:${conversationId}`;
/** Подія зміни списку діалогів (для адміністраторів). */
const CONVERSATIONS_EVENT = 'conversations';

/**
 * Готує HTTP-відповідь до SSE-стріму: правильні заголовки, вимкнене
 * буферування, періодичний heartbeat (щоб проксі не рвали idle-з'єднання).
 *
 * @param {import('express').Response} res
 * @returns {() => void} функція зупинки heartbeat.
 */
function initSseResponse(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // вимкнути буферування в nginx
  res.flushHeaders?.();

  // Коментар-heartbeat кожні 25с — тримає з'єднання живим.
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* з'єднання вже закрите — ігноруємо */
    }
  }, 25000);

  return () => clearInterval(heartbeat);
}

/** Надсилає одну SSE-подію. */
function sendEvent(res, event, data = {}) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Підписує SSE-клієнта на нові повідомлення конкретного діалогу.
 *
 * @param {number|string} conversationId
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function subscribeToConversation(conversationId, req, res) {
  const stopHeartbeat = initSseResponse(res);
  const eventName = messageEvent(conversationId);

  const onMessage = () => sendEvent(res, 'message', { conversationId });
  emitter.on(eventName, onMessage);

  // Одразу шлемо «ready», щоб клієнт знав: канал відкрито (можна гасити polling).
  sendEvent(res, 'ready', {});

  req.on('close', () => {
    stopHeartbeat();
    emitter.off(eventName, onMessage);
  });
}

/**
 * Підписує адміністратора на зміни списку діалогів і на будь-яке нове
 * повідомлення (щоб оновлювати лічильники непрочитаного).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function subscribeToConversations(req, res) {
  const stopHeartbeat = initSseResponse(res);

  const onChange = () => sendEvent(res, 'conversations', {});
  emitter.on(CONVERSATIONS_EVENT, onChange);

  sendEvent(res, 'ready', {});

  req.on('close', () => {
    stopHeartbeat();
    emitter.off(CONVERSATIONS_EVENT, onChange);
  });
}

/**
 * Сповіщає підписників про нове повідомлення у діалозі.
 * Викликається після успішного INSERT у chat_messages.
 *
 * @param {number|string} conversationId
 */
export function publishMessage(conversationId) {
  emitter.emit(messageEvent(conversationId));
  emitter.emit(CONVERSATIONS_EVENT);
}

/**
 * Сповіщає адміністраторів про зміну у списку діалогів
 * (claim / release / close), навіть без нового повідомлення.
 */
export function publishConversationsChange() {
  emitter.emit(CONVERSATIONS_EVENT);
}
