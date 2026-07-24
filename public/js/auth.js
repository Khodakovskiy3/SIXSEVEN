/**
 * Обробка форм автентифікації: логін та реєстрація.
 *
 * Відстежує submit-події на формах #login-form і #register-form,
 * викликає відповідні API-методи і робить редирект за роллю.
 */

import { apiFetch, setAuth } from './api.js';
import { PAGE, ROLE } from './constants.js';

const MS_PER_SEC = 1000;
const MIN_PASSWORD_LENGTH = 8;
const LOWERCASE_PATTERN = /[a-zа-яїієґ]/;
const UPPERCASE_PATTERN = /[A-ZА-ЯЇІЄҐ]/;
const DIGIT_PATTERN = /\d/;

/**
 * Перевіряє пароль на мінімальну стійкість (дублює серверні правила
 * registerSchema, щоб показати помилку без зайвого запиту до API).
 *
 * @param {string} password — пароль у відкритому вигляді.
 * @returns {string|null} текст помилки або null, якщо пароль прийнятний.
 */
function getPasswordError(password) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Пароль має бути мінімум ${MIN_PASSWORD_LENGTH} символів`;
  }
  if (!LOWERCASE_PATTERN.test(password)) {
    return 'Пароль має містити малу літеру';
  }
  if (!UPPERCASE_PATTERN.test(password)) {
    return 'Пароль має містити велику літеру';
  }
  if (!DIGIT_PATTERN.test(password)) {
    return 'Пароль має містити цифру';
  }
  return null;
}

/**
 * Відображає повідомлення у DOM-елементі з заданим кольором.
 *
 * @param {HTMLElement|null} el     — цільовий елемент (може бути відсутній).
 * @param {string} message          — текст повідомлення.
 * @param {boolean} [isError=false] — true — червоний колір, false — зелений.
 */
function showMessage(el, message, isError = false) {
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  el.classList.toggle('success', !isError);
}

// Автоформат телефону: +380 XX XXX XX XX
const phoneInput = document.querySelector('#phone');
if (phoneInput) {
  phoneInput.addEventListener('input', (e) => {
    let digits = e.target.value.replace(/\D/g, '');

    // Завжди починаємо з 380
    if (!digits.startsWith('380')) {
      if (digits.startsWith('0')) digits = '38' + digits;
      else if (!digits.startsWith('38')) digits = '380' + digits.replace(/^3?8?0?/, '');
    }

    // Обмежуємо до 12 цифр (380 + 9)
    digits = digits.slice(0, 12);

    // Форматуємо: +380 XX XXX XX XX
    let formatted = '+';
    if (digits.length > 0)  formatted += digits.slice(0, 3);
    if (digits.length > 3)  formatted += ' ' + digits.slice(3, 5);
    if (digits.length > 5)  formatted += ' ' + digits.slice(5, 8);
    if (digits.length > 8)  formatted += ' ' + digits.slice(8, 10);
    if (digits.length > 10) formatted += ' ' + digits.slice(10, 12);

    e.target.value = formatted;
  });

  phoneInput.addEventListener('keydown', (e) => {
    // Не дозволяємо видаляти префікс +380
    const minLen = '+380'.length;
    if ((e.key === 'Backspace' || e.key === 'Delete') && phoneInput.value.length <= minLen) {
      e.preventDefault();
    }
  });

  phoneInput.addEventListener('focus', () => {
    if (!phoneInput.value) phoneInput.value = '+380 ';
  });
}

document.querySelectorAll('[data-password-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    const input = document.querySelector(`#${button.dataset.passwordToggle}`);
    if (!input) return;

    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    button.setAttribute('aria-label', isHidden ? 'Сховати пароль' : 'Показати пароль');
    button.querySelector('.eye-icon')?.classList.toggle('eye-visible', isHidden);
    button.querySelector('.eye-icon')?.classList.toggle('eye-hidden', !isHidden);
  });
});

/**
 * Виконує редирект на сторінку відповідно до ролі користувача.
 *
 * @param {string} role — роль користувача (admin/manager/trainer/client).
 */
function redirectByRole(role) {
  if (role === ROLE.ADMIN) {
    window.location.href = PAGE.ADMIN;
  } else if (role === ROLE.MANAGER) {
    window.location.href = PAGE.MANAGER;
  } else if (role === ROLE.TRAINER) {
    window.location.href = PAGE.TRAINER;
  } else {
    window.location.href = PAGE.CLIENT;
  }
}

/** Активні відліки затримки за кнопкою, щоб не плодити паралельні таймери. */
const resendTimers = new WeakMap();

/**
 * Блокує кнопку повторного надсилання на час антиспам-затримки і показує
 * зворотний відлік, щоб користувач не тиснув її даремно (сервер усе одно
 * відповість 429).
 *
 * @param {HTMLButtonElement|null} button — кнопка «надіслати повторно».
 * @param {number} seconds — скільки секунд лишилося чекати.
 */
function startResendCooldown(button, seconds) {
  if (!button || !(seconds > 0)) return;
  const label = button.dataset.label || button.textContent;
  button.dataset.label = label;
  let left = Math.ceil(seconds);

  // Попередній відлік міг ще тривати (напр. повторний вхід у тій самій вкладці) —
  // інакше два інтервали переписували б підпис кнопки навперемін.
  clearInterval(resendTimers.get(button));

  button.disabled = true;
  button.textContent = `${label} (${left})`;
  const timerId = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      clearInterval(timerId);
      resendTimers.delete(button);
      button.disabled = false;
      button.textContent = label;
      return;
    }
    button.textContent = `${label} (${left})`;
  }, MS_PER_SEC);
  resendTimers.set(button, timerId);
}

// ─── Форма входу ─────────────────────────────────────────────────────────────
const loginForm = document.querySelector('#login-form');
const login2faForm = document.querySelector('#login-2fa-form');
const login2faResendBtn = document.querySelector('#login-2fa-resend');
let pending2faEmail = null; // email, для якого очікується код 2FA

if (loginForm) {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const messageEl = document.querySelector('#login-message');
    const email = document.querySelector('#username').value.trim();
    const password = document.querySelector('#password').value;

    try {
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      // Увімкнено 2FA — переходимо до кроку введення коду.
      if (data.twofaRequired) {
        pending2faEmail = data.email;
        loginForm.style.display = 'none';
        if (login2faForm) login2faForm.style.display = 'block';
        const hint = data.message
          ? data.message
          : data.devCode
            ? `Код надіслано. DEV-режим: код ${data.devCode}`
            : 'Код надіслано на вашу пошту.';
        showMessage(messageEl, hint, false);
        // Якщо код надіслано щойно (або ще діє попередній) — тримаємо кнопку
        // повторного надсилання заблокованою рівно стільки, скільки скаже сервер.
        startResendCooldown(login2faResendBtn, data.resendIn);
        document.querySelector('#login-code')?.focus();
        return;
      }

      setAuth(data.token, data.user);
      redirectByRole(data.user.role);
    } catch (error) {
      showMessage(messageEl, error.message, true);
    }
  });
}

// ─── Другий крок входу: підтвердження коду 2FA ───────────────────────────────
if (login2faForm) {
  login2faForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const messageEl = document.querySelector('#login-message');
    const code = document.querySelector('#login-code').value.trim();

    try {
      const data = await apiFetch('/auth/login/verify', {
        method: 'POST',
        body: JSON.stringify({ email: pending2faEmail, code }),
      });
      setAuth(data.token, data.user);
      redirectByRole(data.user.role);
    } catch (error) {
      showMessage(messageEl, error.message, true);
    }
  });

  login2faResendBtn?.addEventListener('click', async () => {
    const messageEl = document.querySelector('#login-message');
    try {
      const data = await apiFetch('/auth/login/resend', {
        method: 'POST',
        body: JSON.stringify({ email: pending2faEmail }),
      });
      showMessage(
        messageEl,
        data.devCode
          ? `Новий код надіслано. DEV-режим: код ${data.devCode}`
          : 'Новий код надіслано на вашу пошту.',
        false
      );
      startResendCooldown(login2faResendBtn, data.resendIn);
    } catch (error) {
      showMessage(messageEl, error.message, true);
      // 429 повертає retryAfter — блокуємо кнопку до кінця затримки.
      startResendCooldown(login2faResendBtn, error.retryAfter);
    }
  });

  document.querySelector('#login-2fa-back')?.addEventListener('click', () => {
    pending2faEmail = null;
    login2faForm.style.display = 'none';
    if (loginForm) loginForm.style.display = 'block';
    const codeInput = document.querySelector('#login-code');
    if (codeInput) codeInput.value = '';
  });
}

// ─── Форма реєстрації ────────────────────────────────────────────────────────
const registerForm = document.querySelector('#register-form');
if (registerForm) {
  const phoneGroup = document.querySelector('#phone-group');
  if (phoneGroup) phoneGroup.style.display = 'block';

  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const messageEl = document.querySelector('#register-message');
    const name = document.querySelector('#fullname').value.trim();
    const email = document.querySelector('#email').value.trim();
    const password = document.querySelector('#password').value;
    const confirmPassword = document.querySelector('#confirm-password').value;
    const phone = document.querySelector('#phone')?.value.trim();

    const passwordError = getPasswordError(password);
    if (passwordError) {
      showMessage(messageEl, passwordError, true);
      return;
    }

    if (password !== confirmPassword) {
      showMessage(messageEl, 'Паролі не співпадають', true);
      return;
    }

    if (!phone) {
      showMessage(messageEl, 'Введіть номер телефону', true);
      return;
    }
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 12) {
      showMessage(messageEl, 'Введіть повний номер телефону', true);
      return;
    }

    try {
      const data = await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password, phone }),
      });

      // Реєстрація вимагає підтвердження кодом 2FA — переходимо до другого кроку.
      pendingRegisterEmail = data.email || email;
      registerForm.style.display = 'none';
      if (register2faForm) register2faForm.style.display = 'block';
      showMessage(
        messageEl,
        data.devCode
          ? `Код надіслано. DEV-режим: код ${data.devCode}`
          : 'Код підтвердження надіслано на вашу пошту.',
        false
      );
      startResendCooldown(register2faResendBtn, data.resendIn);
      document.querySelector('#register-code')?.focus();
    } catch (error) {
      showMessage(messageEl, error.message, true);
    }
  });
}

// ─── Другий крок реєстрації: підтвердження коду 2FA ──────────────────────────
const register2faForm = document.querySelector('#register-2fa-form');
const register2faResendBtn = document.querySelector('#register-2fa-resend');
let pendingRegisterEmail = null; // email, для якого очікується код підтвердження

if (register2faForm) {
  register2faForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const messageEl = document.querySelector('#register-message');
    const code = document.querySelector('#register-code').value.trim();

    try {
      const data = await apiFetch('/auth/register/verify', {
        method: 'POST',
        body: JSON.stringify({ email: pendingRegisterEmail, code }),
      });
      setAuth(data.token, data.user);
      redirectByRole(data.user.role);
    } catch (error) {
      showMessage(messageEl, error.message, true);
    }
  });

  register2faResendBtn?.addEventListener('click', async () => {
    const messageEl = document.querySelector('#register-message');
    try {
      const data = await apiFetch('/auth/register/resend', {
        method: 'POST',
        body: JSON.stringify({ email: pendingRegisterEmail }),
      });
      showMessage(
        messageEl,
        data.devCode
          ? `Новий код надіслано. DEV-режим: код ${data.devCode}`
          : 'Новий код надіслано на вашу пошту.',
        false
      );
      startResendCooldown(register2faResendBtn, data.resendIn);
    } catch (error) {
      showMessage(messageEl, error.message, true);
      // 429 повертає retryAfter — блокуємо кнопку до кінця затримки.
      startResendCooldown(register2faResendBtn, error.retryAfter);
    }
  });

  document.querySelector('#register-2fa-back')?.addEventListener('click', () => {
    pendingRegisterEmail = null;
    register2faForm.style.display = 'none';
    const registerFormEl = document.querySelector('#register-form');
    if (registerFormEl) registerFormEl.style.display = 'block';
    const codeInput = document.querySelector('#register-code');
    if (codeInput) codeInput.value = '';
  });
}
