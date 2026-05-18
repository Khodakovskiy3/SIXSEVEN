/**
 * Сторінка клієнта: розклад, бронювання, абонемент, історія візитів, оплата.
 *
 * Викликається з public/pages/client.html. Потребує авторизованого користувача
 * з роллю client; інакше requireAuth робить редирект на /login.
 */

import { apiFetch, clearAuth, requireAuth, formatDate } from './api.js';
import { MESSAGE_COLOR, PAGE, ROLE } from './constants.js';

/** Мінімальна допустима сума оплати, грн. */
const MIN_PAYMENT_AMOUNT = 1;

requireAuth([ROLE.CLIENT]);

// ─── Логаут ──────────────────────────────────────────────────────────────────
const logoutBtn = document.querySelector('#logout-btn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    clearAuth();
    window.location.href = PAGE.LOGIN;
  });
}

/**
 * Виводить повідомлення в елемент за CSS-селектором.
 *
 * @param {string} selector — селектор цільового елемента.
 * @param {string} message  — текст повідомлення.
 * @param {boolean} [isError=false]
 */
function setMessage(selector, message, isError = false) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? MESSAGE_COLOR.ERROR : MESSAGE_COLOR.SUCCESS;
}

/**
 * Завантажує розклад і відображає його у таблиці та у списку для бронювання.
 *
 * @returns {Promise<void>}
 */
async function loadSchedule() {
  const schedules = await apiFetch('/schedules');
  const tbody = document.querySelector('#schedule-table-body');
  const select = document.querySelector('#booking-select');

  tbody.innerHTML = '';
  select.innerHTML = '';

  schedules.forEach((schedule) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${formatDate(schedule.date)}</td>
      <td>${schedule.time}</td>
      <td>${schedule.workout_name}</td>
      <td>${schedule.trainer_name || ''}</td>
      <td>${schedule.available}/${schedule.max_clients}</td>
    `;
    tbody.appendChild(row);

    const option = document.createElement('option');
    option.value = schedule.id;
    option.textContent = `${formatDate(schedule.date)} ${schedule.time} — ${schedule.workout_name}`;
    // Якщо вільних місць нема — робимо опцію неактивною, але показуємо.
    if (schedule.available === 0) {
      option.disabled = true;
    }
    select.appendChild(option);
  });
}

/**
 * Завантажує профіль клієнта і відображає поточний абонемент.
 *
 * @returns {Promise<void>}
 */
async function loadSubscription() {
  const profile = await apiFetch('/clients/me');
  const statusEl = document.querySelector('#subscription-status');

  if (!profile.subscription) {
    statusEl.innerHTML = 'Абонемент відсутній. Зверніться до адміністратора.';
    return;
  }

  const subscription = profile.subscription;
  statusEl.innerHTML = `
    <strong>Статус абонемента:</strong> ${subscription.status}<br>
    <strong>Тип:</strong> ${subscription.type}<br>
    <strong>Термін дії до:</strong> ${formatDate(subscription.end_date)}
  `;
}

/**
 * Завантажує історію візитів клієнта і виводить її у таблиці.
 *
 * @returns {Promise<void>}
 */
async function loadVisits() {
  const visits = await apiFetch('/visits/me');
  const tbody = document.querySelector('#visits-table-body');
  tbody.innerHTML = '';
  visits.forEach((visit) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${new Date(visit.visit_time).toLocaleDateString()}</td>
      <td>Відвідав</td>
    `;
    tbody.appendChild(row);
  });
}

// ─── Кнопка бронювання ───────────────────────────────────────────────────────
const bookingBtn = document.querySelector('#booking-btn');
bookingBtn.addEventListener('click', async () => {
  setMessage('#booking-status', '');
  const scheduleId = document.querySelector('#booking-select').value;
  if (!scheduleId) return;

  try {
    await apiFetch('/bookings', {
      method: 'POST',
      body: JSON.stringify({ schedule_id: Number(scheduleId) }),
    });
    setMessage('#booking-status', 'Місце заброньовано!');
    await loadSchedule();
  } catch (error) {
    setMessage('#booking-status', error.message, true);
  }
});

// ─── Кнопка оплати ───────────────────────────────────────────────────────────
const payBtn = document.querySelector('#pay-btn');
payBtn.addEventListener('click', async () => {
  setMessage('#payment-status', '');
  const amount = Number(document.querySelector('#payment-amount').value) || 0;
  if (amount < MIN_PAYMENT_AMOUNT) {
    setMessage('#payment-status', 'Вкажіть суму оплати', true);
    return;
  }

  try {
    await apiFetch('/payments', {
      method: 'POST',
      body: JSON.stringify({ amount }),
    });
    setMessage('#payment-status', 'Оплата успішна!');
  } catch (error) {
    setMessage('#payment-status', error.message, true);
  }
});

/**
 * Початкове завантаження даних сторінки.
 * Викликаємо у трьох потоках паралельно, щоб не блокувати рендер.
 *
 * @returns {Promise<void>}
 */
async function init() {
  await Promise.all([loadSchedule(), loadSubscription(), loadVisits()]);
}

init();
