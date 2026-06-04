/**
 * Обробка форм автентифікації: логін та реєстрація.
 *
 * Відстежує submit-події на формах #login-form і #register-form,
 * викликає відповідні API-методи і робить редирект за роллю.
 */

import { apiFetch, setAuth } from './api.js';
import { PAGE, ROLE } from './constants.js';

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

// ─── Форма входу ─────────────────────────────────────────────────────────────
const loginForm = document.querySelector('#login-form');
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

      setAuth(data.token, data.user);
      redirectByRole(data.user.role);
    } catch (error) {
      showMessage(messageEl, error.message, true);
    }
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

    if (password !== confirmPassword) {
      showMessage(messageEl, 'Паролі не співпадають', true);
      return;
    }

    try {
      const data = await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password, phone }),
      });

      setAuth(data.token, data.user);
      redirectByRole(data.user.role);
    } catch (error) {
      showMessage(messageEl, error.message, true);
    }
  });
}
