/**
 * Реєстрація Service Worker для PWA-функцій.
 *
 * Виконується тільки після події load, щоб не сповільнювати
 * перший рендер сторінки. Помилки реєстрації навмисно мовчазно
 * ігноруємо — PWA-функції необов’язкові для роботи системи.
 */

import { SERVICE_WORKER_URL } from './constants.js';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(SERVICE_WORKER_URL).catch(() => {});
  });
}
