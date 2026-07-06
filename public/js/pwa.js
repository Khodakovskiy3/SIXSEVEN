/**
 * PWA-функції: реєстрація Service Worker та кнопка «Встановити».
 *
 * Кнопка додається динамічно:
 *  - у кабінетах (клієнт, тренер, менеджер, адмін) — кругла іконка
 *    у `.top-actions` поруч із дзвіночком;
 *  - на публічних сторінках — текстова кнопка у `.topbar` перед «Увійти».
 *
 * Кнопка видима лише коли браузер повідомив, що застосунок можна
 * встановити (подія beforeinstallprompt), і зникає одразу після
 * встановлення (подія appinstalled) або якщо застосунок уже запущено
 * як PWA (display-mode: standalone).
 */

import { SERVICE_WORKER_URL } from './constants.js';

/** Ідентифікатор блока стилів кнопки, щоб не вставляти його двічі. */
const INSTALL_STYLES_ID = 'pwa-install-styles';

/** SVG-іконка «завантажити» для кнопки встановлення. */
const INSTALL_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">' +
  '<path d="M12 3a1 1 0 0 1 1 1v8.6l2.3-2.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0' +
  'l-4-4a1 1 0 1 1 1.4-1.4L11 12.6V4a1 1 0 0 1 1-1Z"></path>' +
  '<path d="M5 15a1 1 0 0 1 1 1v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2a1 1 0 1 1 2 0v2' +
  'a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-2a1 1 0 0 1 1-1Z"></path>' +
  '</svg>';

/** Збережена подія beforeinstallprompt для показу системного діалогу. */
let deferredPrompt = null;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(SERVICE_WORKER_URL).catch(() => {});
  });
}

/**
 * Перевіряє, чи запущено застосунок уже як встановлений PWA.
 *
 * @returns {boolean} true, якщо застосунок працює у standalone-режимі.
 */
function isInstalled() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

/**
 * Додає на сторінку стилі кнопки встановлення (один раз).
 *
 * @returns {void}
 */
function injectStyles() {
  if (document.getElementById(INSTALL_STYLES_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = INSTALL_STYLES_ID;
  style.textContent = `
    .pwa-install-btn[hidden] { display: none !important; }
    .pwa-install-btn { cursor: pointer; }
    .pwa-install-btn svg { width: 22px; height: 22px; }
    .pwa-install-btn.icon-btn { color: #ffbf17; }
    .pwa-install-text-btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 16px; border-radius: 999px;
      border: 1px solid rgba(255, 191, 23, 0.55);
      background: transparent; color: #ffbf17;
      font: inherit; font-weight: 700; font-size: 14px;
    }
    .pwa-install-text-btn svg { width: 18px; height: 18px; }
    .pwa-install-text-btn:hover { background: rgba(255, 191, 23, 0.12); }
  `;
  document.head.appendChild(style);
}

/**
 * Обробляє натискання кнопки: показує системний діалог встановлення.
 * Якщо користувач відмовився — повертає кнопку на місце.
 *
 * @param {MouseEvent} event Подія кліку по кнопці встановлення.
 * @returns {Promise<void>}
 */
async function handleInstallClick(event) {
  const btn = event.currentTarget;
  if (!deferredPrompt) {
    return;
  }
  const promptEvent = deferredPrompt;
  deferredPrompt = null;
  btn.hidden = true;
  promptEvent.prompt();
  const { outcome } = await promptEvent.userChoice.catch(() => ({ outcome: 'dismissed' }));
  if (outcome !== 'accepted') {
    btn.hidden = false;
  }
}

/**
 * Створює кнопку встановлення і вставляє її у відповідне місце шапки:
 * у кабінетах — перед дзвіночком, на публічних сторінках — перед «Увійти».
 *
 * @returns {HTMLButtonElement|null} Кнопка або null, якщо шапки немає.
 */
function mountButton() {
  const existingBtn = document.querySelector('.pwa-install-btn');
  if (existingBtn) {
    return existingBtn;
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.hidden = true;
  btn.setAttribute('aria-label', 'Встановити застосунок');
  btn.title = 'Встановити застосунок';

  const topActions = document.querySelector('.top-actions');
  const topbar = document.querySelector('header.topbar');

  if (topActions) {
    // Кабінет: кругла іконка поруч із дзвіночком.
    const bell = topActions.querySelector('.notification-btn');
    btn.className = 'icon-btn pwa-install-btn';
    btn.innerHTML = INSTALL_ICON;
    topActions.insertBefore(btn, bell || topActions.firstChild);
  } else if (topbar) {
    // Публічна сторінка: текстова кнопка перед «Увійти».
    const loginBtn = topbar.querySelector('.login-btn');
    btn.className = 'pwa-install-text-btn pwa-install-btn';
    btn.innerHTML = `${INSTALL_ICON}<span>Встановити</span>`;
    topbar.insertBefore(btn, loginBtn || null);
  } else {
    return null;
  }

  btn.addEventListener('click', handleInstallClick);
  return btn;
}

/**
 * Показує або ховає кнопку встановлення.
 *
 * @param {boolean} visible Чи має кнопка бути видимою.
 * @returns {void}
 */
function setVisible(visible) {
  const btn = mountButton();
  if (btn) {
    btn.hidden = !visible;
  }
}

/**
 * Обробляє подію beforeinstallprompt: зберігає її та показує кнопку.
 *
 * @param {Event} event Подія beforeinstallprompt від браузера.
 * @returns {void}
 */
function handleBeforeInstallPrompt(event) {
  event.preventDefault();
  if (isInstalled()) {
    return;
  }
  deferredPrompt = event;
  injectStyles();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setVisible(true), { once: true });
  } else {
    setVisible(true);
  }
}

/**
 * Обробляє подію appinstalled: ховає кнопку після встановлення.
 *
 * @returns {void}
 */
function handleAppInstalled() {
  deferredPrompt = null;
  setVisible(false);
}

window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
window.addEventListener('appinstalled', handleAppInstalled);
