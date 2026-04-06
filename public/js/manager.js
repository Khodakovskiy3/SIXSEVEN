import { apiFetch, clearAuth, requireAuth, formatDate } from './api.js';

requireAuth(['manager', 'admin']);

const logoutBtn = document.querySelector('#logout-btn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    clearAuth();
    window.location.href = '/pages/login.html';
  });
}

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

async function loadSummary() {
  const summary = await apiFetch('/reports/summary');
  document.querySelector('#revenue-total').textContent = summary.revenue;
  document.querySelector('#active-subs').textContent = summary.active_subscriptions;
  document.querySelector('#total-clients').textContent = summary.total_clients;
}

async function loadAttendance() {
  const data = await apiFetch('/reports/attendance');
  const tbody = document.querySelector('#attendance-table tbody');
  tbody.innerHTML = '';
  data.forEach((row) => {
    const attendance = row.max_clients
      ? Math.round((Number(row.attendees) / Number(row.max_clients)) * 100)
      : 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.workout_name}</td>
      <td>${formatDate(row.date)}</td>
      <td>${row.attendees}</td>
      <td>${attendance}%</td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadStaff() {
  const data = await apiFetch('/reports/staff');
  const tbody = document.querySelector('#staff-table');
  tbody.innerHTML = '';
  data.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.trainer_name}</td>
      <td>${row.sessions}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function init() {
  await Promise.all([loadUsers(), loadSummary(), loadAttendance(), loadStaff()]);
}

init();
