import { apiFetch, clearAuth, requireAuth, formatDate } from './api.js';

requireAuth(['trainer']);

const logoutBtn = document.querySelector('#logout-btn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    clearAuth();
    window.location.href = '/pages/login.html';
  });
}

function setMessage(id, message, isError = false) {
  const el = document.querySelector(id);
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? '#c0392b' : '#1e8449';
}

let currentScheduleId = null;

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

  if (schedules.length > 0) {
    currentScheduleId = schedules[0].id;
    select.value = currentScheduleId;
  }
}

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

const viewGroupBtn = document.querySelector('#view-group');
viewGroupBtn.addEventListener('click', () => {
  viewGroup().catch((err) => setMessage('#visit-message', err.message, true));
});

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
  } catch (err) {
    setMessage('#visit-message', err.message, true);
  }
});

async function init() {
  await loadSchedule();
  await viewGroup();
}

init();
