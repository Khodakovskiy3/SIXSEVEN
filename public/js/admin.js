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

let allUsers = [];
let clientsCache = [];
let trainersCache = [];
let workoutsCache = [];
let schedulesCache = [];
let subscriptionsCache = [];
let paymentsCache = [];
let visitsCache = [];

function getSearchValue(id) {
  const el = document.querySelector(id);
  return el ? el.value.trim().toLowerCase() : '';
}

function renderUsers() {
  const tbody = document.querySelector('#users-table');
  const roleFilter = document.querySelector('#user-role-filter').value;
  const searchValue = getSearchValue('#user-search');

  const filtered = allUsers.filter((user) => {
    const matchesRole = roleFilter === 'all' || user.role === roleFilter;
    const haystack = `${user.name} ${user.email}`.toLowerCase();
    const matchesSearch = !searchValue || haystack.includes(searchValue);
    return matchesRole && matchesSearch;
  });

  tbody.innerHTML = '';
  filtered.forEach((user) => {
    const canMark = user.role === 'client' && user.client_id;
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${user.id}</td>
      <td>${user.name}</td>
      <td>${user.email}</td>
      <td>${user.role}</td>
      <td>
        <button class="edit-btn" data-user-id="${user.id}">Редагувати</button>
        <button class="visit-btn" data-client-id="${user.client_id || ''}" ${canMark ? '' : 'disabled'}>
          Прийшов
        </button>
        <button class="delete-btn" data-user-id="${user.id}">Видалити</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function toggleAddGroups(type) {
  document.querySelectorAll('.add-group').forEach((group) => {
    group.style.display = group.dataset.type === type ? 'block' : 'none';
  });
}

function fillSelect(selector, options, includeEmpty = false) {
  const select = document.querySelector(selector);
  if (!select) return;
  const emptyOption = includeEmpty ? '<option value="">(не вказано)</option>' : '';
  select.innerHTML = emptyOption + options.join('');
}

async function loadUsers() {
  allUsers = await apiFetch('/users');
  renderUsers();
}

async function loadClients() {
  clientsCache = await apiFetch('/clients');
  renderClients();

  const clientOptions = clientsCache
    .map((client) => `<option value="${client.id}">${client.name}</option>`);

  fillSelect('#add-subscription-client', clientOptions);
  fillSelect('#add-payment-client', clientOptions);
  fillSelect('#add-visit-client', clientOptions);
}

function renderClients() {
  const tbody = document.querySelector('#clients-table');
  const searchValue = getSearchValue('#clients-search');
  const filtered = clientsCache.filter((client) => {
    const haystack = `${client.name} ${client.email}`.toLowerCase();
    return !searchValue || haystack.includes(searchValue);
  });

  tbody.innerHTML = '';
  filtered.forEach((client) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${client.id}</td>
      <td>${client.name}</td>
      <td>${client.email}</td>
      <td>${client.phone || ''}</td>
      <td>
        <button class="edit-btn" data-client-id="${client.id}">Редагувати</button>
        <button class="delete-btn" data-client-id="${client.id}">Видалити</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

async function loadTrainers() {
  trainersCache = await apiFetch('/trainers');
  renderTrainers();

  const trainerOptions = trainersCache
    .map((trainer) => `<option value="${trainer.id}">${trainer.name}</option>`);

  fillSelect('#add-schedule-trainer', trainerOptions, true);
}

function renderTrainers() {
  const tbody = document.querySelector('#trainers-table');
  const searchValue = getSearchValue('#trainers-search');
  const filtered = trainersCache.filter((trainer) => {
    const haystack = `${trainer.name} ${trainer.email}`.toLowerCase();
    return !searchValue || haystack.includes(searchValue);
  });

  tbody.innerHTML = '';
  filtered.forEach((trainer) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${trainer.id}</td>
      <td>${trainer.name}</td>
      <td>${trainer.email}</td>
      <td>${trainer.specialization || ''}</td>
      <td>
        <button class="edit-btn" data-trainer-id="${trainer.id}">Редагувати</button>
        <button class="delete-btn" data-trainer-id="${trainer.id}">Видалити</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

async function loadWorkouts() {
  workoutsCache = await apiFetch('/workouts');
  renderWorkouts();

  const workoutOptions = workoutsCache
    .map((workout) => `<option value="${workout.id}">${workout.name}</option>`);

  fillSelect('#add-schedule-workout', workoutOptions);
}

function renderWorkouts() {
  const tbody = document.querySelector('#workouts-table');
  const searchValue = getSearchValue('#workouts-search');
  const filtered = workoutsCache.filter((workout) => {
    const haystack = `${workout.name} ${workout.description || ''}`.toLowerCase();
    return !searchValue || haystack.includes(searchValue);
  });

  tbody.innerHTML = '';
  filtered.forEach((workout) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${workout.id}</td>
      <td>${workout.name}</td>
      <td>${workout.description || ''}</td>
      <td>${workout.max_clients}</td>
      <td>
        <button class="edit-btn" data-workout-id="${workout.id}">Редагувати</button>
        <button class="delete-btn" data-workout-id="${workout.id}">Видалити</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

async function loadSchedules() {
  schedulesCache = await apiFetch('/schedules');
  renderSchedules();
}

function renderSchedules() {
  const tbody = document.querySelector('#schedules-table');
  const searchValue = getSearchValue('#schedules-search');
  const filtered = schedulesCache.filter((schedule) => {
    const haystack = `${schedule.workout_name} ${schedule.trainer_name || ''}`.toLowerCase();
    return !searchValue || haystack.includes(searchValue);
  });

  tbody.innerHTML = '';
  filtered.forEach((schedule) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${schedule.id}</td>
      <td>${formatDate(schedule.date)}</td>
      <td>${schedule.time}</td>
      <td>${schedule.workout_name}</td>
      <td>${schedule.trainer_name || ''}</td>
      <td>${schedule.available}/${schedule.max_clients}</td>
      <td>
        <button class="edit-btn" data-schedule-id="${schedule.id}">Редагувати</button>
        <button class="group-btn" data-schedule-id="${schedule.id}">Група</button>
        <button class="delete-btn" data-schedule-id="${schedule.id}">Видалити</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

async function loadSubscriptions() {
  subscriptionsCache = await apiFetch('/subscriptions');
  renderSubscriptions();
}

function renderSubscriptions() {
  const tbody = document.querySelector('#subscriptions-table');
  const searchValue = getSearchValue('#subscriptions-search');
  const filtered = subscriptionsCache.filter((sub) => {
    const haystack = `${sub.client_name} ${sub.type}`.toLowerCase();
    return !searchValue || haystack.includes(searchValue);
  });

  tbody.innerHTML = '';
  filtered.forEach((sub) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${sub.id}</td>
      <td>${sub.client_name}</td>
      <td>${sub.type}</td>
      <td>${formatDate(sub.start_date)}</td>
      <td>${formatDate(sub.end_date)}</td>
      <td>${sub.status}</td>
      <td>
        <button class="edit-btn" data-subscription-id="${sub.id}">Редагувати</button>
        <button class="delete-btn" data-subscription-id="${sub.id}">Видалити</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

async function loadPayments() {
  paymentsCache = await apiFetch('/payments');
  renderPayments();
}

function renderPayments() {
  const tbody = document.querySelector('#payments-table');
  const searchValue = getSearchValue('#payments-search');
  const filtered = paymentsCache.filter((payment) => {
    const haystack = `${payment.client_name} ${payment.status}`.toLowerCase();
    return !searchValue || haystack.includes(searchValue);
  });

  tbody.innerHTML = '';
  filtered.forEach((payment) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${payment.id}</td>
      <td>${payment.client_name}</td>
      <td>${payment.amount}</td>
      <td>${formatDate(payment.date)}</td>
      <td>${payment.status}</td>
      <td>
        <button class="edit-btn" data-payment-id="${payment.id}" disabled>Редагувати</button>
        <button class="delete-btn" data-payment-id="${payment.id}">Видалити</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

async function loadVisits() {
  visitsCache = await apiFetch('/visits');
  renderVisits();
}

function renderVisits() {
  const tbody = document.querySelector('#visits-table');
  const searchValue = getSearchValue('#visits-search');
  const filtered = visitsCache.filter((visit) => {
    const haystack = `${visit.client_name}`.toLowerCase();
    return !searchValue || haystack.includes(searchValue);
  });

  tbody.innerHTML = '';
  filtered.forEach((visit) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${visit.id}</td>
      <td>${visit.client_name}</td>
      <td>${new Date(visit.visit_time).toLocaleString()}</td>
      <td>
        <button class="edit-btn" data-visit-id="${visit.id}" disabled>Редагувати</button>
        <button class="delete-btn" data-visit-id="${visit.id}">Видалити</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

const roleFilter = document.querySelector('#user-role-filter');
const userSearch = document.querySelector('#user-search');
roleFilter.addEventListener('change', renderUsers);
userSearch.addEventListener('input', renderUsers);
document.querySelector('#clients-search').addEventListener('input', renderClients);
document.querySelector('#trainers-search').addEventListener('input', renderTrainers);
document.querySelector('#workouts-search').addEventListener('input', renderWorkouts);
document.querySelector('#schedules-search').addEventListener('input', renderSchedules);
document.querySelector('#subscriptions-search').addEventListener('input', renderSubscriptions);
document.querySelector('#payments-search').addEventListener('input', renderPayments);
document.querySelector('#visits-search').addEventListener('input', renderVisits);

// Unified add form
const addTypeSelect = document.querySelector('#add-type');
const unifiedForm = document.querySelector('#unified-form');
addTypeSelect.addEventListener('change', () => toggleAddGroups(addTypeSelect.value));

unifiedForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('#add-message', '');
  const type = addTypeSelect.value;

  try {
    if (type === 'user') {
      await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: document.querySelector('#add-name').value.trim(),
          email: document.querySelector('#add-email').value.trim(),
          password: document.querySelector('#add-password').value,
          role: document.querySelector('#add-role').value,
          phone: document.querySelector('#add-phone').value.trim(),
          specialization: document.querySelector('#add-specialization').value.trim(),
        }),
      });
      await Promise.all([loadUsers(), loadClients(), loadTrainers()]);
    }

    if (type === 'workout') {
      await apiFetch('/workouts', {
        method: 'POST',
        body: JSON.stringify({
          name: document.querySelector('#add-workout-name').value.trim(),
          description: document.querySelector('#add-workout-description').value.trim(),
          max_clients: Number(document.querySelector('#add-workout-max').value),
        }),
      });
      await loadWorkouts();
    }

    if (type === 'schedule') {
      await apiFetch('/schedules', {
        method: 'POST',
        body: JSON.stringify({
          workout_id: Number(document.querySelector('#add-schedule-workout').value),
          trainer_id: document.querySelector('#add-schedule-trainer').value || null,
          date: document.querySelector('#add-schedule-date').value,
          time: document.querySelector('#add-schedule-time').value,
        }),
      });
      await loadSchedules();
    }

    if (type === 'subscription') {
      await apiFetch('/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          client_id: Number(document.querySelector('#add-subscription-client').value),
          type: document.querySelector('#add-subscription-type').value.trim(),
          start_date: document.querySelector('#add-subscription-start').value,
          end_date: document.querySelector('#add-subscription-end').value,
          status: document.querySelector('#add-subscription-status').value,
        }),
      });
      await loadSubscriptions();
    }

    if (type === 'payment') {
      await apiFetch('/payments', {
        method: 'POST',
        body: JSON.stringify({
          client_id: Number(document.querySelector('#add-payment-client').value),
          amount: Number(document.querySelector('#add-payment-amount').value),
          status: document.querySelector('#add-payment-status').value,
        }),
      });
      await loadPayments();
    }

    if (type === 'visit') {
      await apiFetch('/visits', {
        method: 'POST',
        body: JSON.stringify({
          client_id: Number(document.querySelector('#add-visit-client').value),
        }),
      });
      await loadVisits();
    }

    unifiedForm.reset();
    toggleAddGroups(addTypeSelect.value);
    setMessage('#add-message', 'Додано успішно');
  } catch (err) {
    setMessage('#add-message', err.message, true);
  }
});

// Edit modal
const modal = document.querySelector('#edit-modal');
const editForm = document.querySelector('#edit-form');
const editFields = document.querySelector('#edit-fields');
const editTitle = document.querySelector('#edit-title');
const editCancel = document.querySelector('#edit-cancel');
let editState = null;

function openModal(title, fields, onSubmit) {
  editTitle.textContent = title;
  editFields.innerHTML = fields;
  editState = onSubmit;
  setMessage('#edit-message', '');
  modal.style.display = 'flex';
}

function closeModal() {
  modal.style.display = 'none';
  editState = null;
}

editCancel.addEventListener('click', closeModal);
modal.addEventListener('click', (event) => {
  if (event.target === modal) closeModal();
});

editForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!editState) return;
  try {
    await editState();
    closeModal();
  } catch (err) {
    setMessage('#edit-message', err.message, true);
  }
});

// Edit handlers

document.querySelector('#users-table').addEventListener('click', (event) => {
  const button = event.target.closest('.edit-btn');
  if (!button) return;

  const userId = Number(button.dataset.userId);
  const user = allUsers.find((item) => item.id === userId);
  if (!user) return;

  openModal('Редагувати користувача', `
    <div class="form-group">
      <label for="edit-name">Ім'я:</label>
      <input type="text" id="edit-name" value="${user.name}">
    </div>
    <div class="form-group">
      <label for="edit-email">Email:</label>
      <input type="email" id="edit-email" value="${user.email}">
    </div>
    <div class="form-group">
      <label for="edit-role">Роль:</label>
      <select id="edit-role">
        <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Адміністратор</option>
        <option value="manager" ${user.role === 'manager' ? 'selected' : ''}>Керівник</option>
        <option value="trainer" ${user.role === 'trainer' ? 'selected' : ''}>Тренер</option>
        <option value="client" ${user.role === 'client' ? 'selected' : ''}>Клієнт</option>
      </select>
    </div>
  `, async () => {
    await apiFetch(`/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: document.querySelector('#edit-name').value.trim(),
        email: document.querySelector('#edit-email').value.trim(),
        role: document.querySelector('#edit-role').value,
      }),
    });
    await loadUsers();
  });
});

document.querySelector('#users-table').addEventListener('click', async (event) => {
  const button = event.target.closest('.visit-btn');
  if (!button || button.disabled) return;

  const clientId = Number(button.dataset.clientId);
  if (!clientId) return;

  try {
    await apiFetch('/visits', {
      method: 'POST',
      body: JSON.stringify({ client_id: clientId }),
    });
    await loadVisits();
  } catch (err) {
    alert(err.message);
  }
});

document.querySelector('#users-table').addEventListener('click', async (event) => {
  const button = event.target.closest('.delete-btn');
  if (!button) return;

  const userId = Number(button.dataset.userId);
  if (!userId) return;
  if (!confirm('Видалити користувача?')) return;

  try {
    await apiFetch(`/users/${userId}`, { method: 'DELETE' });
    await Promise.all([loadUsers(), loadClients(), loadTrainers()]);
  } catch (err) {
    alert(err.message);
  }
});

document.querySelector('#clients-table').addEventListener('click', async (event) => {
  const button = event.target.closest('.delete-btn');
  if (!button) return;

  const clientId = Number(button.dataset.clientId);
  if (!clientId) return;
  if (!confirm('Видалити клієнта?')) return;

  try {
    await apiFetch(`/clients/${clientId}`, { method: 'DELETE' });
    await Promise.all([loadClients(), loadUsers()]);
  } catch (err) {
    alert(err.message);
  }
});

document.querySelector('#trainers-table').addEventListener('click', async (event) => {
  const button = event.target.closest('.delete-btn');
  if (!button) return;

  const trainerId = Number(button.dataset.trainerId);
  if (!trainerId) return;
  if (!confirm('Видалити тренера?')) return;

  try {
    await apiFetch(`/trainers/${trainerId}`, { method: 'DELETE' });
    await Promise.all([loadTrainers(), loadUsers()]);
  } catch (err) {
    alert(err.message);
  }
});

document.querySelector('#workouts-table').addEventListener('click', async (event) => {
  const button = event.target.closest('.delete-btn');
  if (!button) return;

  const workoutId = Number(button.dataset.workoutId);
  if (!workoutId) return;
  if (!confirm('Видалити тренування?')) return;

  try {
    await apiFetch(`/workouts/${workoutId}`, { method: 'DELETE' });
    await Promise.all([loadWorkouts(), loadSchedules()]);
  } catch (err) {
    alert(err.message);
  }
});

document.querySelector('#schedules-table').addEventListener('click', async (event) => {
  const button = event.target.closest('.delete-btn');
  if (!button) return;

  const scheduleId = Number(button.dataset.scheduleId);
  if (!scheduleId) return;
  if (!confirm('Видалити запис розкладу?')) return;

  try {
    await apiFetch(`/schedules/${scheduleId}`, { method: 'DELETE' });
    await loadSchedules();
  } catch (err) {
    alert(err.message);
  }
});

document.querySelector('#subscriptions-table').addEventListener('click', async (event) => {
  const button = event.target.closest('.delete-btn');
  if (!button) return;

  const subscriptionId = Number(button.dataset.subscriptionId);
  if (!subscriptionId) return;
  if (!confirm('Видалити абонемент?')) return;

  try {
    await apiFetch(`/subscriptions/${subscriptionId}`, { method: 'DELETE' });
    await loadSubscriptions();
  } catch (err) {
    alert(err.message);
  }
});

document.querySelector('#payments-table').addEventListener('click', async (event) => {
  const button = event.target.closest('.delete-btn');
  if (!button) return;

  const paymentId = Number(button.dataset.paymentId);
  if (!paymentId) return;
  if (!confirm('Видалити оплату?')) return;

  try {
    await apiFetch(`/payments/${paymentId}`, { method: 'DELETE' });
    await loadPayments();
  } catch (err) {
    alert(err.message);
  }
});

document.querySelector('#visits-table').addEventListener('click', async (event) => {
  const button = event.target.closest('.delete-btn');
  if (!button) return;

  const visitId = Number(button.dataset.visitId);
  if (!visitId) return;
  if (!confirm('Видалити відвідування?')) return;

  try {
    await apiFetch(`/visits/${visitId}`, { method: 'DELETE' });
    await loadVisits();
  } catch (err) {
    alert(err.message);
  }
});

document.querySelector('#clients-table').addEventListener('click', (event) => {
  const button = event.target.closest('.edit-btn');
  if (!button) return;

  const clientId = Number(button.dataset.clientId);
  const client = clientsCache.find((item) => item.id === clientId);
  if (!client) return;

  openModal('Редагувати клієнта', `
    <div class="form-group">
      <label for="edit-name">Ім'я:</label>
      <input type="text" id="edit-name" value="${client.name}">
    </div>
    <div class="form-group">
      <label for="edit-email">Email:</label>
      <input type="email" id="edit-email" value="${client.email}">
    </div>
    <div class="form-group">
      <label for="edit-phone">Телефон:</label>
      <input type="text" id="edit-phone" value="${client.phone || ''}">
    </div>
  `, async () => {
    await apiFetch(`/clients/${clientId}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: document.querySelector('#edit-name').value.trim(),
        email: document.querySelector('#edit-email').value.trim(),
        phone: document.querySelector('#edit-phone').value.trim(),
      }),
    });
    await loadClients();
    await loadUsers();
  });
});

document.querySelector('#trainers-table').addEventListener('click', (event) => {
  const button = event.target.closest('.edit-btn');
  if (!button) return;

  const trainerId = Number(button.dataset.trainerId);
  const trainer = trainersCache.find((item) => item.id === trainerId);
  if (!trainer) return;

  openModal('Редагувати тренера', `
    <div class="form-group">
      <label for="edit-name">Ім'я:</label>
      <input type="text" id="edit-name" value="${trainer.name}">
    </div>
    <div class="form-group">
      <label for="edit-email">Email:</label>
      <input type="email" id="edit-email" value="${trainer.email}">
    </div>
    <div class="form-group">
      <label for="edit-specialization">Спеціалізація:</label>
      <input type="text" id="edit-specialization" value="${trainer.specialization || ''}">
    </div>
  `, async () => {
    await apiFetch(`/trainers/${trainerId}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: document.querySelector('#edit-name').value.trim(),
        email: document.querySelector('#edit-email').value.trim(),
        specialization: document.querySelector('#edit-specialization').value.trim(),
      }),
    });
    await loadTrainers();
    await loadUsers();
  });
});

document.querySelector('#workouts-table').addEventListener('click', (event) => {
  const button = event.target.closest('.edit-btn');
  if (!button) return;

  const workoutId = Number(button.dataset.workoutId);
  const workout = workoutsCache.find((item) => item.id === workoutId);
  if (!workout) return;

  openModal('Редагувати тренування', `
    <div class="form-group">
      <label for="edit-name">Назва:</label>
      <input type="text" id="edit-name" value="${workout.name}">
    </div>
    <div class="form-group">
      <label for="edit-description">Опис:</label>
      <textarea id="edit-description">${workout.description || ''}</textarea>
    </div>
    <div class="form-group">
      <label for="edit-max">Макс. кількість:</label>
      <input type="number" id="edit-max" value="${workout.max_clients}">
    </div>
  `, async () => {
    await apiFetch(`/workouts/${workoutId}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: document.querySelector('#edit-name').value.trim(),
        description: document.querySelector('#edit-description').value.trim(),
        max_clients: Number(document.querySelector('#edit-max').value),
      }),
    });
    await loadWorkouts();
    await loadSchedules();
  });
});

document.querySelector('#schedules-table').addEventListener('click', (event) => {
  const button = event.target.closest('.edit-btn');
  if (!button) return;

  const scheduleId = Number(button.dataset.scheduleId);
  const schedule = schedulesCache.find((item) => item.id === scheduleId);
  if (!schedule) return;

  const workoutOptions = workoutsCache
    .map((workout) => `<option value="${workout.id}" ${workout.id === schedule.workout_id ? 'selected' : ''}>${workout.name}</option>`)
    .join('');
  const trainerOptions = ['<option value="">(не вказано)</option>']
    .concat(trainersCache.map((trainer) => `
      <option value="${trainer.id}" ${trainer.id === schedule.trainer_id ? 'selected' : ''}>${trainer.name}</option>
    `)).join('');

  openModal('Редагувати розклад', `
    <div class="form-group">
      <label for="edit-workout">Тренування:</label>
      <select id="edit-workout">${workoutOptions}</select>
    </div>
    <div class="form-group">
      <label for="edit-trainer">Тренер:</label>
      <select id="edit-trainer">${trainerOptions}</select>
    </div>
    <div class="form-group">
      <label for="edit-date">Дата:</label>
      <input type="date" id="edit-date" value="${formatDate(schedule.date)}">
    </div>
    <div class="form-group">
      <label for="edit-time">Час:</label>
      <input type="time" id="edit-time" value="${schedule.time}">
    </div>
  `, async () => {
    await apiFetch(`/schedules/${scheduleId}`, {
      method: 'PUT',
      body: JSON.stringify({
        workout_id: Number(document.querySelector('#edit-workout').value),
        trainer_id: document.querySelector('#edit-trainer').value || null,
        date: document.querySelector('#edit-date').value,
        time: document.querySelector('#edit-time').value,
      }),
    });
    await loadSchedules();
  });
});

document.querySelector('#schedules-table').addEventListener('click', async (event) => {
  const button = event.target.closest('.group-btn');
  if (!button) return;

  const scheduleId = Number(button.dataset.scheduleId);
  if (!scheduleId) return;

  try {
    const bookings = await apiFetch(`/bookings/schedule/${scheduleId}`);
    const list = bookings
      .map((booking, index) => {
        const checked = booking.visit_id ? 'checked' : '';
        return `
          <div class="form-group">
            <label>
              <input type="checkbox" data-client-id="${booking.client_id}" data-visit-id="${booking.visit_id || ''}" ${checked}>
              ${index + 1}. ${booking.client_name}
            </label>
          </div>
        `;
      })
      .join('');

    openModal('Відвідуваність групи', `
      <div>
        ${list || '<p>Немає записів</p>'}
      </div>
    `, async () => {
      const checkboxes = Array.from(editFields.querySelectorAll('input[type=\"checkbox\"]'));
      const toCreate = checkboxes.filter((cb) => cb.checked && !cb.dataset.visitId);
      const toDelete = checkboxes.filter((cb) => !cb.checked && cb.dataset.visitId);

      await Promise.all([
        ...toCreate.map((cb) =>
          apiFetch('/visits', {
            method: 'POST',
            body: JSON.stringify({
              client_id: Number(cb.dataset.clientId),
              schedule_id: scheduleId,
            }),
          })
        ),
        ...toDelete.map((cb) => apiFetch(`/visits/${cb.dataset.visitId}`, { method: 'DELETE' })),
      ]);

      await loadVisits();
    });
  } catch (err) {
    alert(err.message);
  }
});

document.querySelector('#subscriptions-table').addEventListener('click', (event) => {
  const button = event.target.closest('.edit-btn');
  if (!button) return;

  const subscriptionId = Number(button.dataset.subscriptionId);
  const subscription = subscriptionsCache.find((item) => item.id === subscriptionId);
  if (!subscription) return;

  openModal('Редагувати абонемент', `
    <div class="form-group">
      <label for="edit-type">Тип:</label>
      <input type="text" id="edit-type" value="${subscription.type}">
    </div>
    <div class="form-group">
      <label for="edit-start">Початок:</label>
      <input type="date" id="edit-start" value="${formatDate(subscription.start_date)}">
    </div>
    <div class="form-group">
      <label for="edit-end">Кінець:</label>
      <input type="date" id="edit-end" value="${formatDate(subscription.end_date)}">
    </div>
    <div class="form-group">
      <label for="edit-status">Статус:</label>
      <select id="edit-status">
        <option value="active" ${subscription.status === 'active' ? 'selected' : ''}>Активний</option>
        <option value="paused" ${subscription.status === 'paused' ? 'selected' : ''}>Призупинений</option>
        <option value="expired" ${subscription.status === 'expired' ? 'selected' : ''}>Закінчений</option>
      </select>
    </div>
  `, async () => {
    await apiFetch(`/subscriptions/${subscriptionId}`, {
      method: 'PUT',
      body: JSON.stringify({
        type: document.querySelector('#edit-type').value.trim(),
        start_date: document.querySelector('#edit-start').value,
        end_date: document.querySelector('#edit-end').value,
        status: document.querySelector('#edit-status').value,
      }),
    });
    await loadSubscriptions();
  });
});

async function init() {
  toggleAddGroups(addTypeSelect.value);
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
