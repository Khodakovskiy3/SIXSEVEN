import { apiFetch, clearAuth, requireAuth, formatDate } from './api.js';

requireAuth(['admin']);

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

async function loadClients() {
  const clients = await apiFetch('/clients');
  const tbody = document.querySelector('#clients-table');
  tbody.innerHTML = '';
  clients.forEach((client) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${client.id}</td>
      <td>${client.name}</td>
      <td>${client.email}</td>
      <td>${client.phone || ''}</td>
    `;
    tbody.appendChild(row);
  });

  const clientOptions = clients
    .map((client) => `<option value="${client.id}">${client.name}</option>`)
    .join('');

  document.querySelector('#subscription-client').innerHTML = clientOptions;
  document.querySelector('#payment-client').innerHTML = clientOptions;
  document.querySelector('#visit-client').innerHTML = clientOptions;
}

async function loadTrainers() {
  const trainers = await apiFetch('/trainers');
  const tbody = document.querySelector('#trainers-table');
  tbody.innerHTML = '';
  trainers.forEach((trainer) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${trainer.id}</td>
      <td>${trainer.name}</td>
      <td>${trainer.email}</td>
      <td>${trainer.specialization || ''}</td>
    `;
    tbody.appendChild(row);
  });

  const trainerOptions = ['<option value="">(не вказано)</option>']
    .concat(trainers.map((trainer) => `<option value="${trainer.id}">${trainer.name}</option>`))
    .join('');

  document.querySelector('#schedule-trainer').innerHTML = trainerOptions;
}

async function loadWorkouts() {
  const workouts = await apiFetch('/workouts');
  const tbody = document.querySelector('#workouts-table');
  tbody.innerHTML = '';
  workouts.forEach((workout) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${workout.id}</td>
      <td>${workout.name}</td>
      <td>${workout.description || ''}</td>
      <td>${workout.max_clients}</td>
    `;
    tbody.appendChild(row);
  });

  const workoutOptions = workouts
    .map((workout) => `<option value="${workout.id}">${workout.name}</option>`)
    .join('');

  document.querySelector('#schedule-workout').innerHTML = workoutOptions;
}

async function loadSchedules() {
  const schedules = await apiFetch('/schedules');
  const tbody = document.querySelector('#schedules-table');
  tbody.innerHTML = '';
  schedules.forEach((schedule) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${schedule.id}</td>
      <td>${formatDate(schedule.date)}</td>
      <td>${schedule.time}</td>
      <td>${schedule.workout_name}</td>
      <td>${schedule.trainer_name || ''}</td>
      <td>${schedule.available}/${schedule.max_clients}</td>
    `;
    tbody.appendChild(row);
  });
}

async function loadSubscriptions() {
  const subscriptions = await apiFetch('/subscriptions');
  const tbody = document.querySelector('#subscriptions-table');
  tbody.innerHTML = '';
  subscriptions.forEach((sub) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${sub.id}</td>
      <td>${sub.client_name}</td>
      <td>${sub.type}</td>
      <td>${formatDate(sub.start_date)}</td>
      <td>${formatDate(sub.end_date)}</td>
      <td>${sub.status}</td>
    `;
    tbody.appendChild(row);
  });
}

async function loadPayments() {
  const payments = await apiFetch('/payments');
  const tbody = document.querySelector('#payments-table');
  tbody.innerHTML = '';
  payments.forEach((payment) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${payment.id}</td>
      <td>${payment.client_name}</td>
      <td>${payment.amount}</td>
      <td>${formatDate(payment.date)}</td>
      <td>${payment.status}</td>
    `;
    tbody.appendChild(row);
  });
}

async function loadVisits() {
  const visits = await apiFetch('/visits');
  const tbody = document.querySelector('#visits-table');
  tbody.innerHTML = '';
  visits.forEach((visit) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${visit.id}</td>
      <td>${visit.client_name}</td>
      <td>${new Date(visit.visit_time).toLocaleString()}</td>
    `;
    tbody.appendChild(row);
  });
}

const clientForm = document.querySelector('#client-form');
clientForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('#client-message', '');
  try {
    await apiFetch('/clients', {
      method: 'POST',
      body: JSON.stringify({
        name: document.querySelector('#client-name').value.trim(),
        email: document.querySelector('#client-email').value.trim(),
        password: document.querySelector('#client-password').value,
        phone: document.querySelector('#client-phone').value.trim(),
      }),
    });
    clientForm.reset();
    setMessage('#client-message', 'Клієнта додано');
    await loadClients();
    await loadUsers();
  } catch (err) {
    setMessage('#client-message', err.message, true);
  }
});

const trainerForm = document.querySelector('#trainer-form');
trainerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('#trainer-message', '');
  try {
    await apiFetch('/trainers', {
      method: 'POST',
      body: JSON.stringify({
        name: document.querySelector('#trainer-name').value.trim(),
        email: document.querySelector('#trainer-email').value.trim(),
        password: document.querySelector('#trainer-password').value,
        specialization: document.querySelector('#trainer-specialization').value.trim(),
      }),
    });
    trainerForm.reset();
    setMessage('#trainer-message', 'Тренера додано');
    await loadTrainers();
    await loadUsers();
  } catch (err) {
    setMessage('#trainer-message', err.message, true);
  }
});

const workoutForm = document.querySelector('#workout-form');
workoutForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('#workout-message', '');
  try {
    await apiFetch('/workouts', {
      method: 'POST',
      body: JSON.stringify({
        name: document.querySelector('#workout-name').value.trim(),
        description: document.querySelector('#workout-description').value.trim(),
        max_clients: Number(document.querySelector('#workout-max').value),
      }),
    });
    workoutForm.reset();
    setMessage('#workout-message', 'Тренування додано');
    await loadWorkouts();
    await loadSchedules();
  } catch (err) {
    setMessage('#workout-message', err.message, true);
  }
});

const scheduleForm = document.querySelector('#schedule-form');
scheduleForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('#schedule-message', '');
  try {
    await apiFetch('/schedules', {
      method: 'POST',
      body: JSON.stringify({
        workout_id: Number(document.querySelector('#schedule-workout').value),
        trainer_id: document.querySelector('#schedule-trainer').value || null,
        date: document.querySelector('#schedule-date').value,
        time: document.querySelector('#schedule-time').value,
      }),
    });
    scheduleForm.reset();
    setMessage('#schedule-message', 'Розклад оновлено');
    await loadSchedules();
  } catch (err) {
    setMessage('#schedule-message', err.message, true);
  }
});

const subscriptionForm = document.querySelector('#subscription-form');
subscriptionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('#subscription-message', '');
  try {
    await apiFetch('/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        client_id: Number(document.querySelector('#subscription-client').value),
        type: document.querySelector('#subscription-type').value.trim(),
        start_date: document.querySelector('#subscription-start').value,
        end_date: document.querySelector('#subscription-end').value,
        status: document.querySelector('#subscription-status').value,
      }),
    });
    subscriptionForm.reset();
    setMessage('#subscription-message', 'Абонемент додано');
    await loadSubscriptions();
  } catch (err) {
    setMessage('#subscription-message', err.message, true);
  }
});

const paymentForm = document.querySelector('#payment-form');
paymentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('#payment-message', '');
  try {
    await apiFetch('/payments', {
      method: 'POST',
      body: JSON.stringify({
        client_id: Number(document.querySelector('#payment-client').value),
        amount: Number(document.querySelector('#payment-amount').value),
        status: document.querySelector('#payment-status').value,
      }),
    });
    paymentForm.reset();
    setMessage('#payment-message', 'Оплату додано');
    await loadPayments();
  } catch (err) {
    setMessage('#payment-message', err.message, true);
  }
});

const visitForm = document.querySelector('#visit-form');
visitForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('#visit-message', '');
  try {
    await apiFetch('/visits', {
      method: 'POST',
      body: JSON.stringify({
        client_id: Number(document.querySelector('#visit-client').value),
      }),
    });
    visitForm.reset();
    setMessage('#visit-message', 'Візит зафіксовано');
    await loadVisits();
  } catch (err) {
    setMessage('#visit-message', err.message, true);
  }
});

async function init() {
  await Promise.all([
    loadUsers(),
    loadClients(),
    loadTrainers(),
    loadWorkouts(),
  ]);
  await Promise.all([
    loadSchedules(),
    loadSubscriptions(),
    loadPayments(),
    loadVisits(),
  ]);
}

init();
