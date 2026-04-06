import { apiFetch, clearAuth, requireAuth, formatDate } from './api.js';

requireAuth(['client']);

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
    if (schedule.available === 0) option.disabled = true;
    select.appendChild(option);
  });
}

async function loadSubscription() {
  const profile = await apiFetch('/clients/me');
  const statusEl = document.querySelector('#subscription-status');

  if (!profile.subscription) {
    statusEl.innerHTML = 'Абонемент відсутній. Зверніться до адміністратора.';
    return;
  }

  const sub = profile.subscription;
  statusEl.innerHTML = `
    <strong>Статус абонемента:</strong> ${sub.status}<br>
    <strong>Тип:</strong> ${sub.type}<br>
    <strong>Термін дії до:</strong> ${formatDate(sub.end_date)}
  `;
}

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
  } catch (err) {
    setMessage('#booking-status', err.message, true);
  }
});

const payBtn = document.querySelector('#pay-btn');
payBtn.addEventListener('click', async () => {
  setMessage('#payment-status', '');
  const amount = Number(document.querySelector('#payment-amount').value) || 0;
  if (amount <= 0) {
    setMessage('#payment-status', 'Вкажіть суму оплати', true);
    return;
  }

  try {
    await apiFetch('/payments', {
      method: 'POST',
      body: JSON.stringify({ amount }),
    });
    setMessage('#payment-status', 'Оплата успішна!');
  } catch (err) {
    setMessage('#payment-status', err.message, true);
  }
});

async function init() {
  await Promise.all([loadSchedule(), loadSubscription(), loadVisits()]);
}

init();
