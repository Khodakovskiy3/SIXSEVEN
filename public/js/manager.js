/**
 * Сторінка керівника: список користувачів і трійка зведених звітів.
 *
 * Викликається з public/pages/manager.html. Доступ для ролей manager та admin.
 */

import { apiFetch, clearAuth, requireAuth, formatDate } from './api.js';
import { PAGE, ROLE } from './constants.js';

/** Множник для перетворення частки у відсотки. */
const PERCENT_MULTIPLIER = 100;

requireAuth([ROLE.MANAGER, ROLE.ADMIN]);

// ─── Логаут ──────────────────────────────────────────────────────────────────
const logoutBtn = document.querySelector('#logout-btn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    clearAuth();
    window.location.href = PAGE.LOGIN;
  });
}

/**
 * Завантажує і відображає таблицю користувачів.
 *
 * @returns {Promise<void>}
 */
async function loadUsers() {
  const users = await apiFetch('/users');
  const tbody = document.querySelector('#users-table');
  tbody.innerHTML = '';
  users.forEach((user) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${user.id}</td>
      <td>${user.name}</td>
      <td>${user.email}</td>
      <td>${user.role}</td>
    `;
    tbody.appendChild(row);
  });
}

/**
 * Завантажує зведену статистику (виручка, активні абонементи, клієнти).
 *
 * @returns {Promise<void>}
 */
async function loadSummary() {
  const summary = await apiFetch('/reports/summary');
  document.querySelector('#revenue-total').textContent = summary.revenue;
  document.querySelector('#active-subs').textContent = summary.active_subscriptions;
  document.querySelector('#total-clients').textContent = summary.total_clients;
}

/**
 * Завантажує звіт відвідуваності: для кожного запису рахуємо завантаженість групи.
 *
 * @returns {Promise<void>}
 */
async function loadAttendance() {
  const rows = await apiFetch('/reports/attendance');
  const tbody = document.querySelector('#attendance-table tbody');
  tbody.innerHTML = '';
  rows.forEach((row) => {
    // Уникаємо ділення на нуль, якщо у тренування невказана місткість.
    const attendancePercent = row.max_clients
      ? Math.round((Number(row.attendees) / Number(row.max_clients)) * PERCENT_MULTIPLIER)
      : 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.workout_name}</td>
      <td>${formatDate(row.date)}</td>
      <td>${row.attendees}</td>
      <td>${attendancePercent}%</td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Завантажує звіт по тренерах: скільки сесій провів кожен.
 *
 * @returns {Promise<void>}
 */
async function loadStaff() {
  const rows = await apiFetch('/reports/staff');
  const tbody = document.querySelector('#staff-table');
  tbody.innerHTML = '';
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.trainer_name}</td>
      <td>${row.sessions}</td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Початкове завантаження сторінки.
 * Усі чотири запити запускаємо паралельно — вони незалежні.
 *
 * @returns {Promise<void>}
 */
async function init() {
  await Promise.all([loadUsers(), loadSummary(), loadAttendance(), loadStaff()]);
}

init();
