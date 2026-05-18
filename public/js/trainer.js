/**
 * Сторінка тренера: власний розклад, список клієнтів групи, відмітка візиту.
 *
 * Викликається з public/pages/trainer.html. Доступ лише для ролі trainer.
 */

import { apiFetch, clearAuth, requireAuth, formatDate } from './api.js';
import { MESSAGE_COLOR, PAGE, ROLE } from './constants.js';

requireAuth([ROLE.TRAINER]);

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
 * @param {string} selector
 * @param {string} message
 * @param {boolean} [isError=false]
 */
function setMessage(selector, message, isError = false) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? MESSAGE_COLOR.ERROR : MESSAGE_COLOR.SUCCESS;
}

// Поточне обране заняття (id з таблиці schedules).
let currentScheduleId = null;

/**
 * Завантажує розклад поточного тренера.
 *
 * @returns {Promise<void>}
 */
async function loadSchedule() {
  const trainer = await apiFetch('/trainers/me');
  const schedules = await apiFetch(`/schedules?trainer_id=${trainer.id}`);

  const tbody = document.querySelector('#trainer-schedule');
  const select = document.querySelector('#training-select');
  tbody.innerHTML = '';
  select.innerHTML = '';

  schedules.forEach((schedule) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${formatDate(schedule.date)}</td>
      <td>${schedule.time}</td>
      <td>${schedule.workout_name}</td>
    `;
    tbody.appendChild(row);

    const option = document.createElement('option');
    option.value = schedule.id;
    option.textContent = `${formatDate(schedule.date)} ${schedule.time} — ${schedule.workout_name}`;
    select.appendChild(option);
  });

  // Якщо у тренера є заняття — обираємо перше для початкового перегляду групи.
  if (schedules.length > 0) {
    currentScheduleId = schedules[0].id;
    select.value = currentScheduleId;
  }
}

/**
 * Завантажує учасників обраного заняття у бічну панель.
 *
 * @returns {Promise<void>}
 */
async function viewGroup() {
  const select = document.querySelector('#training-select');
  const scheduleId = select.value;
  if (!scheduleId) return;

  currentScheduleId = scheduleId;
  const bookings = await apiFetch(`/bookings/schedule/${scheduleId}`);

  const groupInfo = document.querySelector('#group-info');
  const tbody = document.querySelector('#clients-table tbody');
  const attendanceSelect = document.querySelector('#attendance-client');

  tbody.innerHTML = '';
  attendanceSelect.innerHTML = '';

  bookings.forEach((booking) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${booking.client_name}</td>
      <td>${booking.status}</td>
    `;
    tbody.appendChild(row);

    const option = document.createElement('option');
    option.value = booking.client_id;
    option.textContent = booking.client_name;
    attendanceSelect.appendChild(option);
  });

  groupInfo.style.display = 'block';
}

// ─── Перегляд групи ──────────────────────────────────────────────────────────
const viewGroupBtn = document.querySelector('#view-group');
viewGroupBtn.addEventListener('click', () => {
  viewGroup().catch((error) => setMessage('#visit-message', error.message, true));
});

// ─── Відмітка візиту ─────────────────────────────────────────────────────────
const markVisitBtn = document.querySelector('#mark-visit');
markVisitBtn.addEventListener('click', async () => {
  setMessage('#visit-message', '');
  const clientId = document.querySelector('#attendance-client').value;
  if (!clientId) {
    setMessage('#visit-message', 'Оберіть клієнта', true);
    return;
  }

  try {
    await apiFetch('/visits', {
      method: 'POST',
      body: JSON.stringify({ client_id: Number(clientId) }),
    });
    setMessage('#visit-message', 'Візит зафіксовано');
  } catch (error) {
    setMessage('#visit-message', error.message, true);
  }
});

/**
 * Початкове завантаження сторінки тренера.
 *
 * @returns {Promise<void>}
 */
async function init() {
  await loadSchedule();
  await viewGroup();
}

init();
