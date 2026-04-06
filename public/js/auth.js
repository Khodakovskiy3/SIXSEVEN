import { apiFetch, setAuth } from './api.js';

function showMessage(el, message, isError = false) {
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? '#c0392b' : '#1e8449';
}

function redirectByRole(role) {
  if (role === 'admin') window.location.href = '/pages/admin.html';
  else if (role === 'manager') window.location.href = '/pages/manager.html';
  else if (role === 'trainer') window.location.href = '/pages/trainer.html';
  else window.location.href = '/pages/client.html';
}

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
    } catch (err) {
      showMessage(messageEl, err.message, true);
    }
  });
}

const registerForm = document.querySelector('#register-form');
if (registerForm) {
  const roleSelect = document.querySelector('#role');
  const phoneGroup = document.querySelector('#phone-group');
  const specializationGroup = document.querySelector('#specialization-group');

  const updateRoleFields = () => {
    const role = roleSelect.value;
    phoneGroup.style.display = role === 'client' ? 'block' : 'none';
    specializationGroup.style.display = role === 'trainer' ? 'block' : 'none';
  };

  if (roleSelect) {
    roleSelect.addEventListener('change', updateRoleFields);
    updateRoleFields();
  }

  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const messageEl = document.querySelector('#register-message');
    const name = document.querySelector('#fullname').value.trim();
    const email = document.querySelector('#email').value.trim();
    const password = document.querySelector('#password').value;
    const confirmPassword = document.querySelector('#confirm-password').value;
    const role = roleSelect.value;
    const phone = document.querySelector('#phone')?.value.trim();
    const specialization = document.querySelector('#specialization')?.value.trim();

    if (password !== confirmPassword) {
      showMessage(messageEl, 'Паролі не співпадають', true);
      return;
    }

    try {
      const data = await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password, role, phone, specialization }),
      });

      setAuth(data.token, data.user);
      redirectByRole(data.user.role);
    } catch (err) {
      showMessage(messageEl, err.message, true);
    }
  });
}
