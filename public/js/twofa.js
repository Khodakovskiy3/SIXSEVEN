/**
 * Налаштування двофакторної автентифікації (2FA) у профілі користувача.
 *
 * Самостійно під'єднується до контейнера #twofa-settings (якщо він є на сторінці)
 * і керує увімкненням/вимкненням 2FA через email-код.
 *
 * Послідовність увімкнення:
 *   1) «Увімкнути 2FA» → POST /auth/2fa/request (надсилає код на email);
 *   2) користувач вводить код → POST /auth/2fa/enable.
 * Вимкнення: введення поточного пароля → POST /auth/2fa/disable.
 */

import { apiFetch } from './api.js';

const root = document.querySelector('#twofa-settings');
if (root) init(root);

function setFeedback(el, text, isError = false) {
  el.textContent = text;
  el.style.color = isError ? '#e05555' : '#4caf50';
}

async function init(container) {
  let user;
  try {
    user = (await apiFetch('/auth/me')).user;
  } catch {
    return;
  }
  render(container, Boolean(user.twofa_enabled));
}

function render(container, enabled) {
  container.innerHTML = `
    <h3 style="margin:0 0 .4rem">Двофакторна автентифікація</h3>
    <p style="margin:0 0 .6rem;opacity:.8">
      Статус: <strong>${enabled ? 'увімкнено' : 'вимкнено'}</strong>.
      ${enabled ? 'При вході надсилається код на пошту.' : 'Додатковий захист входу через код на email.'}
    </p>
    <div data-twofa-controls style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:center"></div>
    <p data-twofa-feedback role="status" style="margin-top:.6rem"></p>
  `;
  const controls = container.querySelector('[data-twofa-controls]');
  const feedback = container.querySelector('[data-twofa-feedback]');
  enabled ? renderDisable(container, controls, feedback) : renderEnable(container, controls, feedback);
}

// ─── Вимкнення ───────────────────────────────────────────────────────────────
function renderDisable(container, controls, feedback) {
  controls.innerHTML = `
    <input type="password" data-twofa-pass placeholder="Поточний пароль"
           style="padding:.5rem;flex:1 1 180px;min-width:160px">
    <button type="button" data-twofa-disable style="padding:.5rem 1rem;white-space:nowrap;cursor:pointer">Вимкнути 2FA</button>
  `;
  controls.querySelector('[data-twofa-disable]').addEventListener('click', async () => {
    const password = controls.querySelector('[data-twofa-pass]').value;
    if (!password) return setFeedback(feedback, 'Введіть поточний пароль', true);
    try {
      await apiFetch('/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ password }) });
      render(container, false);
      const fb = container.querySelector('[data-twofa-feedback]');
      setFeedback(fb, '2FA вимкнено.');
    } catch (e) {
      setFeedback(feedback, e.message, true);
    }
  });
}

// ─── Увімкнення ──────────────────────────────────────────────────────────────
function renderEnable(container, controls, feedback) {
  controls.innerHTML = `<button type="button" data-twofa-request style="padding:.5rem 1rem;cursor:pointer">Увімкнути 2FA</button>`;

  controls.querySelector('[data-twofa-request]').addEventListener('click', async () => {
    try {
      const res = await apiFetch('/auth/2fa/request', { method: 'POST' });
      controls.innerHTML = `
        <input type="text" data-twofa-code inputmode="numeric" maxlength="6"
               placeholder="Код з листа" style="padding:.5rem;flex:1 1 160px;min-width:140px">
        <button type="button" data-twofa-confirm style="padding:.5rem 1rem;white-space:nowrap;cursor:pointer">Підтвердити</button>
      `;
      setFeedback(feedback, res.devCode
        ? `Код надіслано. DEV-режим: код ${res.devCode}`
        : `Код надіслано на ${res.sentTo}.`);
      controls.querySelector('[data-twofa-confirm]').addEventListener('click', async () => {
        const code = controls.querySelector('[data-twofa-code]').value.trim();
        if (!code) return setFeedback(feedback, 'Введіть код', true);
        try {
          await apiFetch('/auth/2fa/enable', { method: 'POST', body: JSON.stringify({ code }) });
          render(container, true);
          const fb = container.querySelector('[data-twofa-feedback]');
          setFeedback(fb, '2FA успішно увімкнено.');
        } catch (e) {
          setFeedback(feedback, e.message, true);
        }
      });
    } catch (e) {
      setFeedback(feedback, e.message, true);
    }
  });
}
