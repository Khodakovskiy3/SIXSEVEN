import { apiFetch, clearAuth, formatDate, requireFreshAuth } from './api.js';
import { PAGE, ROLE } from './constants.js';

const titles = {
  dashboard: 'Головна',
  clients: 'Клієнти',
  trainers: 'Тренери',
  schedule: 'Розклад',
  services: 'Послуги',
  plans: 'Абонементи',
  messages: 'Повідомлення',
  profile: 'Мій профіль',
  'admin-personal': 'Особисті дані',
  'club-settings': 'Дані клубу',
  'admin-settings': 'Налаштування',
};

const pageRoutes = {
  dashboard: '/pages/admin/index.html',
  clients: '/pages/admin/clients.html',
  trainers: '/pages/admin/trainers.html',
  schedule: '/pages/admin/schedule.html',
  services: '/pages/admin/services.html',
  plans: '/pages/admin/plans.html',
  messages: '/pages/admin/messages.html',
  profile: '/pages/admin/profile.html',
  'admin-personal': '/pages/admin/personal.html',
  'club-settings': '/pages/admin/club.html',
  'admin-settings': '/pages/admin/settings.html',
};

const sheetContent = {
  client: {
    title: 'Олена Коваль',
    html: `
      <p>Телефон: +380 67 000 00 00</p>
      <p>Email: olena@mail.com</p>
      <p>Абонемент: Безлімітний · активний до 24.06.2026</p>
      <h3>Історія відвідувань</h3>
      <ul><li>23.05 · Відвідування залу · 14:30</li><li>20.05 · Йога · відвідано</li><li>18.05 · Фітнес · відвідано</li></ul>
    `,
  },
  trainer: {
    title: 'Анна Мельник',
    html: `
      <p>Телефон: +380 67 222 11 00</p>
      <p>Email: anna@mail.com</p>
      <p>Статус: активний</p>
      <h3>Спеціалізація</h3>
      <p>Йога, Фітнес · досвід 5 років</p>
      <h3>Найближчі заняття</h3>
      <ul><li>24.05 · 18:30 · Йога · зал 2</li><li>25.05 · 10:00 · Фітнес · зал 1</li></ul>
      <button class="danger-btn modal-open" data-modal-title="Забрати права тренера">Забрати права тренера</button>
    `,
  },
  message: {
    title: 'Зміна графіку на вихідні',
    html: `
      <p>Кому: усі клієнти</p>
      <p>Статус: надіслано</p>
      <p>Дата створення: 20.05.2026</p>
      <p>Текст: У суботу спортзал працює до 18:00.</p>
    `,
  },
};

let clients = [];
let clientsFilter = 'all';
let trainers = [];
let trainersFilter = 'all';
let schedules = [];
let scheduleFilter = 'upcoming';
let scheduleServices = [];
let scheduleTrainers = [];
let services = [];
let servicesFilter = 'all';
let plans = [];
let plansFilter = 'all';
let subscriptions = [];

const clientsPage = document.querySelector('[data-screen-panel="clients"]');
const clientsTableBody = document.querySelector('#clients-table-body');
const clientsSearch = document.querySelector('#clients-search');
const clientsFeedback = document.querySelector('#clients-feedback');
const trainersPage = document.querySelector('[data-screen-panel="trainers"]');
const trainersTableBody = document.querySelector('#trainers-table-body');
const trainersSearch = document.querySelector('#trainers-search');
const trainersFeedback = document.querySelector('#trainers-feedback');
const schedulePage = document.querySelector('[data-screen-panel="schedule"]');
const scheduleTableBody = document.querySelector('#schedule-table-body');
const scheduleSearch = document.querySelector('#schedule-search');
const scheduleFeedback = document.querySelector('#schedule-feedback');
const servicesPage = document.querySelector('[data-screen-panel="services"]');
const servicesGrid = document.querySelector('#services-grid');
const servicesSearch = document.querySelector('#services-search');
const servicesFeedback = document.querySelector('#services-feedback');
const plansPage = document.querySelector('[data-screen-panel="plans"]');
const plansGrid = document.querySelector('#plans-grid');
const plansSearch = document.querySelector('#plans-search');
const plansFeedback = document.querySelector('#plans-feedback');
const subscriptionsTableBody = document.querySelector('#subscriptions-table-body');

const statusLabels = {
  active: 'Активний',
  inactive: 'Неактивний',
  paused: 'Пауза',
  expired: 'Неактивний',
};

const planTypeLabels = {
  subscription: 'Абонемент',
  single: 'Разовий',
};

const accessTypeLabels = {
  gym: 'Зал',
  group: 'Групові',
  personal: 'Персональне',
  gym_group: 'Зал + групові',
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setFeedback(message, type = 'info') {
  if (!clientsFeedback) return;
  clientsFeedback.textContent = message;
  clientsFeedback.dataset.type = type;
}

function setTrainerFeedback(message, type = 'info') {
  if (!trainersFeedback) return;
  trainersFeedback.textContent = message;
  trainersFeedback.dataset.type = type;
}

function setScheduleFeedback(message, type = 'info') {
  if (!scheduleFeedback) return;
  scheduleFeedback.textContent = message;
  scheduleFeedback.dataset.type = type;
}

function setServicesFeedback(message, type = 'info') {
  if (!servicesFeedback) return;
  servicesFeedback.textContent = message;
  servicesFeedback.dataset.type = type;
}

function setPlansFeedback(message, type = 'info') {
  if (!plansFeedback) return;
  plansFeedback.textContent = message;
  plansFeedback.dataset.type = type;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhoneInput(value = '') {
  const digits = String(value).replace(/\D/g, '');
  let localPart = digits;

  if (localPart.startsWith('380')) {
    localPart = localPart.slice(3);
  } else if (localPart.startsWith('0')) {
    localPart = localPart.slice(1);
  }

  return `+380${localPart.slice(0, 9)}`;
}

function isValidPhone(value = '') {
  return /^\+380\d{9}$/.test(value);
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('uk-UA', { maximumFractionDigits: 0 })} грн`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatTime(value) {
  if (!value) return '—';
  return String(value).slice(0, 5);
}

function attachPhoneMasks(root = document) {
  root.querySelectorAll('[data-phone-input]').forEach((input) => {
    const updateValue = () => {
      input.value = normalizePhoneInput(input.value);
    };

    if (!input.dataset.phoneMaskReady) {
      input.addEventListener('focus', () => {
        if (!input.value) input.value = '+380';
      });
      input.addEventListener('input', updateValue);
      input.dataset.phoneMaskReady = 'true';
    }

    if (input.value) updateValue();
  });
}

function setModalError(message = '') {
  const error = document.querySelector('#modal-error');
  if (error) error.textContent = message;
}

function getFilteredClients() {
  const query = normalizeText(clientsSearch?.value);
  return clients.filter((client) => {
    const matchesStatus = clientsFilter === 'all' || client.status === clientsFilter;
    const haystack = normalizeText(`${client.name} ${client.email} ${client.phone}`);
    return matchesStatus && (!query || haystack.includes(query));
  });
}

function getFilteredTrainers() {
  const query = normalizeText(trainersSearch?.value);
  return trainers.filter((trainer) => {
    const matchesStatus = trainersFilter === 'all' || trainer.status === trainersFilter;
    const haystack = normalizeText(`${trainer.name} ${trainer.email} ${trainer.phone} ${trainer.specialization}`);
    return matchesStatus && (!query || haystack.includes(query));
  });
}

function getFilteredSchedules() {
  const query = normalizeText(scheduleSearch?.value);
  const today = todayIso();

  return schedules.filter((schedule) => {
    const date = formatDate(schedule.date);
    const matchesFilter = scheduleFilter === 'all'
      || (scheduleFilter === 'today' && date === today)
      || (scheduleFilter === 'upcoming' && date >= today)
      || (scheduleFilter === 'past' && date < today);
    const haystack = normalizeText(`${schedule.workout_name} ${schedule.trainer_name} ${schedule.date} ${schedule.time}`);
    return matchesFilter && (!query || haystack.includes(query));
  });
}

function getFilteredServices() {
  const query = normalizeText(servicesSearch?.value);
  return services.filter((service) => {
    const matchesStatus = servicesFilter === 'all' || service.status === servicesFilter;
    const haystack = normalizeText(`${service.name} ${service.description}`);
    return matchesStatus && (!query || haystack.includes(query));
  });
}

function getFilteredPlans() {
  const query = normalizeText(plansSearch?.value);
  return plans.filter((plan) => {
    const matchesFilter = plansFilter === 'all'
      || plan.status === plansFilter
      || plan.plan_type === plansFilter;
    const haystack = normalizeText(`${plan.name} ${plan.description} ${plan.access_type}`);
    return matchesFilter && (!query || haystack.includes(query));
  });
}

function renderSchedules() {
  if (!scheduleTableBody) return;

  const visibleSchedules = getFilteredSchedules();
  if (visibleSchedules.length === 0) {
    scheduleTableBody.innerHTML = `
      <div class="table-row table-empty">
        <span>Занять не знайдено</span>
      </div>
    `;
    return;
  }

  scheduleTableBody.innerHTML = visibleSchedules.map((schedule) => {
    const maxClients = Number(schedule.max_clients || 0);
    const booked = Number(schedule.booked || 0);
    const available = typeof schedule.available === 'number'
      ? schedule.available
      : Math.max(maxClients - booked, 0);

    return `
      <div class="table-row">
        <span>${formatDate(schedule.date)}</span>
        <span>${formatTime(schedule.time)}</span>
        <span>${escapeHtml(schedule.workout_name || '—')}</span>
        <span>${escapeHtml(schedule.trainer_name || 'Без тренера')}</span>
        <span>${booked}/${maxClients} · вільно ${available}</span>
        <span>
          <button class="ghost-btn" data-schedule-edit="${schedule.id}">Редагувати</button>
          <button class="danger-btn" data-schedule-delete="${schedule.id}">Видалити</button>
        </span>
      </div>
    `;
  }).join('');
}

async function loadSchedules() {
  if (scheduleTableBody) {
    scheduleTableBody.innerHTML = '<div class="table-row table-empty"><span>Завантаження розкладу...</span></div>';
  }
  try {
    schedules = await apiFetch('/schedules');
    renderSchedules();
    setScheduleFeedback(`Завантажено занять: ${schedules.length}`, 'success');
  } catch (error) {
    setScheduleFeedback(`Не вдалося завантажити розклад: ${error.message}`, 'error');
    if (scheduleTableBody) {
      scheduleTableBody.innerHTML = '<div class="table-row table-empty"><span>Помилка завантаження</span></div>';
    }
  }
}

async function ensureScheduleOptions() {
  if (!scheduleServices.length) {
    const workouts = await apiFetch('/workouts');
    scheduleServices = workouts.filter((workout) => (workout.status || 'active') === 'active');
  }

  if (!scheduleTrainers.length) {
    const loadedTrainers = await apiFetch('/trainers');
    scheduleTrainers = loadedTrainers;
  }
}

async function ensureActiveServices() {
  if (!scheduleServices.length) {
    const workouts = await apiFetch('/workouts');
    scheduleServices = workouts.filter((workout) => (workout.status || 'active') === 'active');
  }
}

function getSpecializationList(value = '') {
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSpecialization(value = '') {
  return normalizeText(value).replaceAll('ё', 'е');
}

function trainerMatchesService(trainer, serviceName) {
  const selectedService = normalizeSpecialization(serviceName);
  if (!selectedService) return false;
  return getSpecializationList(trainer.specialization).some((item) => (
    normalizeSpecialization(item) === selectedService
  ));
}

function renderSpecializationCheckboxes(selectedValue = '') {
  const selected = getSpecializationList(selectedValue).map(normalizeSpecialization);

  if (!scheduleServices.length) {
    return '<p class="form-note">Активних послуг ще немає. Спочатку додайте послугу.</p>';
  }

  return `
    <div class="form-switch specialization-list">
      ${scheduleServices.map((service) => {
        const checked = selected.includes(normalizeSpecialization(service.name)) ? 'checked' : '';
        return `
          <label>
            <input type="checkbox" name="specializations" value="${escapeHtml(service.name)}" ${checked}>
            ${escapeHtml(service.name)}
          </label>
        `;
      }).join('')}
    </div>
  `;
}

function renderClients() {
  if (!clientsTableBody) return;

  const visibleClients = getFilteredClients();
  if (visibleClients.length === 0) {
    clientsTableBody.innerHTML = `
      <div class="table-row table-empty">
        <span>Клієнтів не знайдено</span>
      </div>
    `;
    return;
  }

  clientsTableBody.innerHTML = visibleClients.map((client) => {
    const status = client.status || 'inactive';
    const subscription = client.subscription_type || 'Немає';
    const endDate = formatDate(client.subscription_end_date) || '—';
    const phone = client.phone || '—';
    const visitButton = status === 'active'
      ? `<button class="primary-btn small" data-client-visit="${client.id}">Візит</button>`
      : `<button class="primary-btn small" disabled title="Немає активного абонемента">Візит</button>`;

    return `
      <div class="table-row">
        <span>${escapeHtml(client.name)}</span>
        <span>${escapeHtml(phone)}</span>
        <span>${escapeHtml(client.email)}</span>
        <span>${escapeHtml(subscription)}</span>
        <span><mark class="status ${status}">${statusLabels[status] || status}</mark></span>
        <span>${escapeHtml(endDate)}</span>
        <span>
          <button class="ghost-btn" data-client-details="${client.id}">Деталі</button>
          <button class="ghost-btn" data-client-edit="${client.id}">Редагувати</button>
          ${visitButton}
          <button class="danger-btn" data-client-delete="${client.id}">Видалити</button>
        </span>
      </div>
    `;
  }).join('');
}

async function loadClients() {
  if (clientsTableBody) {
    clientsTableBody.innerHTML = '<div class="table-row table-empty"><span>Завантаження клієнтів...</span></div>';
  }
  try {
    clients = await apiFetch('/clients');
    renderClients();
    setFeedback(`Завантажено клієнтів: ${clients.length}`, 'success');
  } catch (error) {
    setFeedback(`Не вдалося завантажити клієнтів: ${error.message}`, 'error');
    if (clientsTableBody) {
      clientsTableBody.innerHTML = '<div class="table-row table-empty"><span>Помилка завантаження</span></div>';
    }
  }
}

function renderTrainers() {
  if (!trainersTableBody) return;

  const visibleTrainers = getFilteredTrainers();
  if (visibleTrainers.length === 0) {
    trainersTableBody.innerHTML = `
      <div class="table-row table-empty">
        <span>Тренерів не знайдено</span>
      </div>
    `;
    return;
  }

  trainersTableBody.innerHTML = visibleTrainers.map((trainer) => {
    const status = trainer.status || 'inactive';
    return `
      <div class="table-row">
        <span>${escapeHtml(trainer.name)}</span>
        <span>${escapeHtml(trainer.phone || '—')}</span>
        <span>${escapeHtml(trainer.email)}</span>
        <span>${escapeHtml(trainer.specialization || 'Не вказано')}</span>
        <span><mark class="status ${status}">${statusLabels[status] || status}</mark></span>
        <span>
          <button class="ghost-btn" data-trainer-details="${trainer.id}">Деталі</button>
          <button class="ghost-btn" data-trainer-edit="${trainer.id}">Редагувати</button>
          <button class="danger-btn" data-trainer-revoke="${trainer.id}">Забрати права</button>
        </span>
      </div>
    `;
  }).join('');
}

async function loadTrainers() {
  if (!trainersTableBody) return;
  trainersTableBody.innerHTML = '<div class="table-row table-empty"><span>Завантаження тренерів...</span></div>';
  try {
    trainers = await apiFetch('/trainers');
    renderTrainers();
    setTrainerFeedback(`Завантажено тренерів: ${trainers.length}`, 'success');
  } catch (error) {
    setTrainerFeedback(`Не вдалося завантажити тренерів: ${error.message}`, 'error');
    trainersTableBody.innerHTML = '<div class="table-row table-empty"><span>Помилка завантаження</span></div>';
  }
}

function renderServices() {
  if (!servicesGrid) return;

  const visibleServices = getFilteredServices();
  if (visibleServices.length === 0) {
    servicesGrid.innerHTML = '<article class="manage-card"><p>Послуг не знайдено</p></article>';
    return;
  }

  servicesGrid.innerHTML = visibleServices.map((service) => {
    const status = service.status || 'active';
    const nextStatus = status === 'active' ? 'inactive' : 'active';
    const statusButton = status === 'active'
      ? `<button class="danger-btn" data-service-status="${service.id}" data-next-status="inactive">Вимкнути</button>`
      : `<button class="primary-btn" data-service-status="${service.id}" data-next-status="active">Увімкнути</button>`;

    return `
      <article class="manage-card ${status === 'active' ? 'featured' : ''}">
        <h3>${escapeHtml(service.name)}</h3>
        <p>${escapeHtml(service.description || 'Опис не вказано')}</p>
        <p>Місткість: ${escapeHtml(service.max_clients || '—')} клієнтів</p>
        <span class="status ${status}">${statusLabels[status] || status}</span>
        <div>
          <button class="ghost-btn" data-service-edit="${service.id}">Редагувати</button>
          ${statusButton}
        </div>
      </article>
    `;
  }).join('');
}

async function loadServices() {
  if (!servicesGrid) return;
  servicesGrid.innerHTML = '<article class="manage-card"><p>Завантаження послуг...</p></article>';
  try {
    services = await apiFetch('/workouts');
    renderServices();
    setServicesFeedback(`Завантажено послуг: ${services.length}`, 'success');
  } catch (error) {
    setServicesFeedback(`Не вдалося завантажити послуги: ${error.message}`, 'error');
    servicesGrid.innerHTML = '<article class="manage-card"><p>Помилка завантаження</p></article>';
  }
}

function renderPlans() {
  if (!plansGrid) return;

  const visiblePlans = getFilteredPlans();
  if (visiblePlans.length === 0) {
    plansGrid.innerHTML = '<article class="manage-card"><p>Тарифів не знайдено</p></article>';
    return;
  }

  plansGrid.innerHTML = visiblePlans.map((plan) => {
    const status = plan.status || 'inactive';
    const isSubscription = plan.plan_type === 'subscription';
    const meta = isSubscription
      ? `${plan.duration_days || 0} днів`
      : `${plan.usage_count || 0} використання`;
    const access = accessTypeLabels[plan.access_type] || plan.access_type || 'Не вказано';
    const statusAction = status === 'active'
      ? `<button class="danger-btn" data-plan-status="${plan.id}" data-next-status="inactive">Вимкнути</button>`
      : `<button class="primary-btn" data-plan-status="${plan.id}" data-next-status="active">Увімкнути</button>`;

    return `
      <article class="manage-card ${status === 'active' ? 'featured' : ''}">
        <h3>${escapeHtml(plan.name)}</h3>
        <p>${escapeHtml(plan.description || 'Опис не вказано')}</p>
        <p>${planTypeLabels[plan.plan_type] || plan.plan_type} · ${escapeHtml(access)} · ${escapeHtml(meta)}</p>
        <strong>${formatMoney(plan.price)}</strong>
        <span class="status ${status}">${statusLabels[status] || status}</span>
        <div>
          <button class="ghost-btn" data-plan-edit="${plan.id}">Редагувати</button>
          ${statusAction}
        </div>
      </article>
    `;
  }).join('');
}

function renderSubscriptions() {
  if (!subscriptionsTableBody) return;

  if (subscriptions.length === 0) {
    subscriptionsTableBody.innerHTML = `
      <div class="table-row table-empty">
        <span>Виданих абонементів ще немає</span>
      </div>
    `;
    return;
  }

  subscriptionsTableBody.innerHTML = subscriptions.map((subscription) => {
    const status = subscription.status || 'expired';
    const canExpire = status === 'active' || status === 'paused';
    const action = canExpire
      ? `<button class="danger-btn" data-subscription-expire="${subscription.id}">Завершити</button>`
      : `<button class="ghost-btn" disabled>Завершено</button>`;

    return `
      <div class="table-row">
        <span>${escapeHtml(subscription.client_name || '—')}</span>
        <span>${escapeHtml(subscription.client_email || '—')}</span>
        <span>${escapeHtml(subscription.type || subscription.plan_name || '—')}</span>
        <span><mark class="status ${status}">${statusLabels[status] || status}</mark></span>
        <span>${formatDate(subscription.end_date) || '—'}</span>
        <span>${action}</span>
      </div>
    `;
  }).join('');
}

async function loadPlans() {
  if (!plansGrid) return;
  plansGrid.innerHTML = '<article class="manage-card"><p>Завантаження тарифів...</p></article>';
  try {
    plans = await apiFetch('/subscriptions/plans');
    renderPlans();
    setPlansFeedback(`Завантажено тарифів: ${plans.length}`, 'success');
  } catch (error) {
    setPlansFeedback(`Не вдалося завантажити тарифи: ${error.message}`, 'error');
    plansGrid.innerHTML = '<article class="manage-card"><p>Помилка завантаження</p></article>';
  }
}

async function loadSubscriptions() {
  if (!subscriptionsTableBody) return;
  subscriptionsTableBody.innerHTML = '<div class="table-row table-empty"><span>Завантаження абонементів...</span></div>';
  try {
    subscriptions = await apiFetch('/subscriptions');
    renderSubscriptions();
  } catch (error) {
    setPlansFeedback(`Не вдалося завантажити видані абонементи: ${error.message}`, 'error');
    subscriptionsTableBody.innerHTML = '<div class="table-row table-empty"><span>Помилка завантаження</span></div>';
  }
}

function openModal(title, html) {
  modalTitle.textContent = title;
  const content = document.querySelector('#modal-content');
  if (content) content.innerHTML = html;
  attachPhoneMasks(content || document);
  modal.classList.add('active');
}

function closeModal() {
  modal.classList.remove('active');
}

function renderClientForm(client = null) {
  const isEdit = Boolean(client);
  return `
    <form id="client-form" class="admin-form" data-client-id="${client?.id || ''}">
      <label>Ім’я
        <input name="name" type="text" required value="${escapeHtml(client?.name || '')}">
      </label>
      <label>Телефон
        <input
          name="phone"
          type="tel"
          inputmode="tel"
          autocomplete="tel"
          maxlength="13"
          pattern="\\+380\\d{9}"
          placeholder="+380XXXXXXXXX"
          data-phone-input
          required
          value="${escapeHtml(client?.phone || '+380')}"
        >
      </label>
      ${isEdit ? `
        <label>Email
          <input type="email" value="${escapeHtml(client.email)}" disabled>
        </label>
      ` : `
        <label>Email
          <input name="email" type="email" required autocomplete="email">
        </label>
        <label>Тимчасовий пароль
          <input name="password" type="password" required autocomplete="new-password">
        </label>
      `}
      <p class="form-error" id="modal-error" role="alert"></p>
      <div class="modal-actions">
        <button type="button" class="ghost-btn modal-close">Скасувати</button>
        <button type="submit" class="primary-btn">${isEdit ? 'Зберегти зміни' : 'Створити клієнта'}</button>
      </div>
    </form>
  `;
}

function renderVisitForm(clientId = '') {
  const options = clients.map((client) => `
    <option value="${client.id}" ${String(client.id) === String(clientId) ? 'selected' : ''}>
      ${escapeHtml(client.name)} · ${escapeHtml(client.email)}
    </option>
  `).join('');

  return `
    <form id="visit-form" class="admin-form">
      <label>Клієнт
        <select name="client_id" required>
          <option value="">Оберіть клієнта</option>
          ${options}
        </select>
      </label>
      <p class="form-note">Візит можна підтвердити тільки для клієнта з активним абонементом.</p>
      <div class="modal-actions">
        <button type="button" class="ghost-btn modal-close">Скасувати</button>
        <button type="submit" class="primary-btn">Підтвердити візит</button>
      </div>
    </form>
  `;
}

async function renderTrainerCreateForm() {
  await ensureActiveServices();
  const clientOptions = await apiFetch('/clients');
  const options = clientOptions.map((client) => `
    <option value="${client.id}">
      ${escapeHtml(client.name)} · ${escapeHtml(client.email)} · ${escapeHtml(client.phone || 'без телефону')}
    </option>
  `).join('');

  return `
    <form id="trainer-form" class="admin-form" data-trainer-mode="create">
      <div class="form-switch">
        <label><input type="radio" name="mode" value="existing" checked> З існуючого клієнта</label>
        <label><input type="radio" name="mode" value="new"> Новий тренер</label>
      </div>

      <div data-trainer-mode-panel="existing">
        <label>Клієнт
          <select name="client_id" required>
            <option value="">Оберіть клієнта</option>
            ${options}
          </select>
        </label>
      </div>

      <div data-trainer-mode-panel="new" hidden>
        <label>Ім’я
          <input name="name" type="text" autocomplete="name" required disabled>
        </label>
        <label>Телефон
          <input
            name="phone"
            type="tel"
            inputmode="tel"
            autocomplete="tel"
            maxlength="13"
            pattern="\\+380\\d{9}"
            placeholder="+380XXXXXXXXX"
            data-phone-input
            value="+380"
            required
            disabled
          >
        </label>
        <label>Email
          <input name="email" type="email" autocomplete="email" required disabled>
        </label>
        <label>Тимчасовий пароль
          <input name="password" type="password" autocomplete="new-password" required disabled>
        </label>
      </div>

      <label>Спеціалізація
        ${renderSpecializationCheckboxes()}
      </label>
      <p class="form-error" id="modal-error" role="alert"></p>
      <div class="modal-actions">
        <button type="button" class="ghost-btn modal-close">Скасувати</button>
        <button type="submit" class="primary-btn">Зберегти тренера</button>
      </div>
    </form>
  `;
}

function renderTrainerEditForm(trainer) {
  const specializations = renderSpecializationCheckboxes(trainer.specialization || '');
  return `
    <form id="trainer-form" class="admin-form" data-trainer-mode="edit" data-trainer-id="${trainer.id}">
      <label>Ім’я
        <input name="name" type="text" required value="${escapeHtml(trainer.name || '')}">
      </label>
      <label>Телефон
        <input
          name="phone"
          type="tel"
          inputmode="tel"
          autocomplete="tel"
          maxlength="13"
          pattern="\\+380\\d{9}"
          placeholder="+380XXXXXXXXX"
          data-phone-input
          required
          value="${escapeHtml(trainer.phone || '+380')}"
        >
      </label>
      <label>Email
        <input type="email" value="${escapeHtml(trainer.email)}" disabled>
      </label>
      <label>Спеціалізація
        ${specializations}
      </label>
      <p class="form-error" id="modal-error" role="alert"></p>
      <div class="modal-actions">
        <button type="button" class="ghost-btn modal-close">Скасувати</button>
        <button type="submit" class="primary-btn">Зберегти зміни</button>
      </div>
    </form>
  `;
}

function renderScheduleTrainerOptions(workoutId, selectedTrainerId = '') {
  const service = scheduleServices.find((item) => String(item.id) === String(workoutId));
  const matchingTrainers = scheduleTrainers.filter((trainer) => trainerMatchesService(trainer, service?.name));

  if (!workoutId) {
    return '<option value="">Спочатку оберіть послугу</option>';
  }

  if (matchingTrainers.length === 0) {
    return '<option value="">Немає тренера з такою спеціалізацією</option>';
  }

  return `
    <option value="">Без тренера</option>
    ${matchingTrainers.map((trainer) => `
      <option value="${trainer.id}" ${String(trainer.id) === String(selectedTrainerId) ? 'selected' : ''}>
        ${escapeHtml(trainer.name)}${trainer.specialization ? ` · ${escapeHtml(trainer.specialization)}` : ''}
      </option>
    `).join('')}
  `;
}

function renderScheduleForm(schedule = null) {
  const isEdit = Boolean(schedule);
  const serviceOptions = scheduleServices.map((service) => `
    <option value="${service.id}" ${String(service.id) === String(schedule?.workout_id) ? 'selected' : ''}>
      ${escapeHtml(service.name)}
    </option>
  `).join('');
  const trainerOptions = renderScheduleTrainerOptions(schedule?.workout_id || '', schedule?.trainer_id || '');

  return `
    <form id="schedule-form" class="admin-form" data-schedule-id="${schedule?.id || ''}">
      <label>Послуга / вид тренування
        <select name="workout_id" required>
          <option value="">Оберіть послугу</option>
          ${serviceOptions}
        </select>
      </label>
      <label>Тренер
        <select name="trainer_id">
          ${trainerOptions}
        </select>
      </label>
      <label>Дата
        <input name="date" type="date" required value="${formatDate(schedule?.date) || todayIso()}">
      </label>
      <label>Час
        <input name="time" type="time" required value="${formatTime(schedule?.time || '10:00')}">
      </label>
      <p class="form-note">У клієнта це заняття з’явиться в розкладі автоматично, якщо послуга активна.</p>
      <p class="form-error" id="modal-error" role="alert"></p>
      <div class="modal-actions">
        <button type="button" class="ghost-btn modal-close">Скасувати</button>
        <button type="submit" class="primary-btn">${isEdit ? 'Зберегти зміни' : 'Створити заняття'}</button>
      </div>
    </form>
  `;
}

function renderServiceForm(service = null) {
  const isEdit = Boolean(service);
  const status = service?.status || 'active';
  return `
    <form id="service-form" class="admin-form" data-service-id="${service?.id || ''}">
      <label>Назва
        <input name="name" type="text" required value="${escapeHtml(service?.name || '')}">
      </label>
      <label>Опис
        <textarea name="description" rows="4">${escapeHtml(service?.description || '')}</textarea>
      </label>
      <label>Максимальна кількість клієнтів
        <input name="max_clients" type="number" min="1" required value="${escapeHtml(service?.max_clients || 10)}">
      </label>
      <label>Статус
        <select name="status" required>
          <option value="active" ${status === 'active' ? 'selected' : ''}>Активна</option>
          <option value="inactive" ${status === 'inactive' ? 'selected' : ''}>Неактивна</option>
        </select>
      </label>
      <p class="form-error" id="modal-error" role="alert"></p>
      <div class="modal-actions">
        <button type="button" class="ghost-btn modal-close">Скасувати</button>
        <button type="submit" class="primary-btn">${isEdit ? 'Зберегти зміни' : 'Створити послугу'}</button>
      </div>
    </form>
  `;
}

function renderPlanForm(plan = null) {
  const isEdit = Boolean(plan);
  const planType = plan?.plan_type || 'subscription';
  const status = plan?.status || 'active';
  return `
    <form id="plan-form" class="admin-form" data-plan-id="${plan?.id || ''}">
      <label>Назва
        <input name="name" type="text" required value="${escapeHtml(plan?.name || '')}">
      </label>
      <label>Опис
        <textarea name="description" rows="3">${escapeHtml(plan?.description || '')}</textarea>
      </label>
      <label>Тип
        <select name="plan_type" required>
          <option value="subscription" ${planType === 'subscription' ? 'selected' : ''}>Абонемент</option>
          <option value="single" ${planType === 'single' ? 'selected' : ''}>Разовий</option>
        </select>
      </label>
      <label>Доступ
        <select name="access_type" required>
          <option value="gym" ${plan?.access_type === 'gym' ? 'selected' : ''}>Зал</option>
          <option value="gym_group" ${plan?.access_type === 'gym_group' ? 'selected' : ''}>Зал + групові</option>
          <option value="group" ${plan?.access_type === 'group' ? 'selected' : ''}>Групові</option>
          <option value="personal" ${plan?.access_type === 'personal' ? 'selected' : ''}>Персональне</option>
        </select>
      </label>
      <label data-plan-field="duration">Термін дії, днів
        <input name="duration_days" type="number" min="1" value="${escapeHtml(plan?.duration_days || 30)}">
      </label>
      <label data-plan-field="usage">Кількість використань
        <input name="usage_count" type="number" min="1" value="${escapeHtml(plan?.usage_count || 1)}">
      </label>
      <label>Ціна, грн
        <input name="price" type="number" min="1" step="1" required value="${escapeHtml(plan?.price || '')}">
      </label>
      <label>Статус
        <select name="status" required>
          <option value="active" ${status === 'active' ? 'selected' : ''}>Активний</option>
          <option value="inactive" ${status === 'inactive' ? 'selected' : ''}>Неактивний</option>
        </select>
      </label>
      <p class="form-error" id="modal-error" role="alert"></p>
      <div class="modal-actions">
        <button type="button" class="ghost-btn modal-close">Скасувати</button>
        <button type="submit" class="primary-btn">${isEdit ? 'Зберегти зміни' : 'Створити тариф'}</button>
      </div>
    </form>
  `;
}

function updatePlanFormFields(form) {
  const planType = form.querySelector('select[name="plan_type"]')?.value;
  const durationField = form.querySelector('[data-plan-field="duration"]');
  const usageField = form.querySelector('[data-plan-field="usage"]');
  const durationInput = form.querySelector('input[name="duration_days"]');
  const usageInput = form.querySelector('input[name="usage_count"]');
  const isSubscription = planType === 'subscription';

  if (durationField) durationField.hidden = !isSubscription;
  if (usageField) usageField.hidden = isSubscription;
  if (durationInput) durationInput.disabled = !isSubscription;
  if (usageInput) usageInput.disabled = isSubscription;
}

function renderAssignPlanForm() {
  const activePlans = plans.filter((plan) => plan.status === 'active');
  const clientOptions = clients.map((client) => `
    <option value="${client.id}">
      ${escapeHtml(client.name)} · ${escapeHtml(client.email)}
    </option>
  `).join('');
  const planOptions = activePlans.map((plan) => `
    <option value="${plan.id}">
      ${escapeHtml(plan.name)} · ${formatMoney(plan.price)}
    </option>
  `).join('');

  return `
    <form id="assign-plan-form" class="admin-form">
      <label>Клієнт
        <select name="client_id" required>
          <option value="">Оберіть клієнта</option>
          ${clientOptions}
        </select>
      </label>
      <label>Абонемент / тариф
        <select name="plan_id" required>
          <option value="">Оберіть тариф</option>
          ${planOptions}
        </select>
      </label>
      <label>Дата початку
        <input name="start_date" type="date" required value="${todayIso()}">
      </label>
      <p class="form-note">Після підтвердження система створить абонемент і оплату зі статусом “оплачено”.</p>
      <p class="form-error" id="modal-error" role="alert"></p>
      <div class="modal-actions">
        <button type="button" class="ghost-btn modal-close">Скасувати</button>
        <button type="submit" class="primary-btn">Призначити</button>
      </div>
    </form>
  `;
}

async function openClientDetails(clientId) {
  try {
    const data = await apiFetch(`/clients/${clientId}`);
    const { client, visits } = data;
    const status = client.status || 'inactive';
    const visitItems = visits.length
      ? visits.map((visit) => `<li>${formatDate(visit.visit_time)} · ${escapeHtml(visit.workout_name || 'Відвідування залу')}</li>`).join('')
      : '<li>Відвідувань ще немає</li>';

    sheetTitle.textContent = client.name;
    sheetBody.innerHTML = `
      <dl>
        <div><dt>Телефон</dt><dd>${escapeHtml(client.phone || '—')}</dd></div>
        <div><dt>Email</dt><dd>${escapeHtml(client.email)}</dd></div>
        <div><dt>Абонемент</dt><dd>${escapeHtml(client.subscription_type || 'Немає')}</dd></div>
        <div><dt>Статус</dt><dd>${statusLabels[status] || status}</dd></div>
        <div><dt>Діє до</dt><dd>${formatDate(client.subscription_end_date) || '—'}</dd></div>
      </dl>
      <h3>Історія відвідувань</h3>
      <ul>${visitItems}</ul>
    `;
    sheet.classList.add('active');
  } catch (error) {
    setFeedback(`Не вдалося відкрити деталі: ${error.message}`, 'error');
  }
}

async function openTrainerDetails(trainerId) {
  try {
    const data = await apiFetch(`/trainers/${trainerId}`);
    const { trainer, schedules } = data;
    const status = trainer.status || 'inactive';
    const scheduleItems = schedules.length
      ? schedules.map((item) => `<li>${formatDate(item.date)} · ${String(item.time).slice(0, 5)} · ${escapeHtml(item.workout_name)}</li>`).join('')
      : '<li>Майбутніх занять немає</li>';

    sheetTitle.textContent = trainer.name;
    sheetBody.innerHTML = `
      <dl>
        <div><dt>Телефон</dt><dd>${escapeHtml(trainer.phone || '—')}</dd></div>
        <div><dt>Email</dt><dd>${escapeHtml(trainer.email)}</dd></div>
        <div><dt>Спеціалізація</dt><dd>${escapeHtml(trainer.specialization || 'Не вказано')}</dd></div>
        <div><dt>Статус</dt><dd>${statusLabels[status] || status}</dd></div>
      </dl>
      <h3>Найближчі заняття</h3>
      <ul>${scheduleItems}</ul>
    `;
    sheet.classList.add('active');
  } catch (error) {
    setTrainerFeedback(`Не вдалося відкрити деталі: ${error.message}`, 'error');
  }
}

async function saveClient(form) {
  const formData = new FormData(form);
  const clientId = form.dataset.clientId;
  const phone = normalizePhoneInput(formData.get('phone'));

  if (!isValidPhone(phone)) {
    setModalError('Телефон має бути у форматі +380XXXXXXXXX');
    return;
  }

  const payload = {
    name: formData.get('name')?.trim(),
    phone,
  };

  if (!clientId) {
    payload.email = formData.get('email')?.trim();
    payload.password = formData.get('password');
  }

  try {
    setModalError('');
    const method = clientId ? 'PUT' : 'POST';
    const path = clientId ? `/clients/${clientId}` : '/clients';
    await apiFetch(path, {
      method,
      body: JSON.stringify(payload),
    });
    closeModal();
    await loadClients();
    setFeedback(clientId ? 'Дані клієнта оновлено' : 'Клієнта створено', 'success');
  } catch (error) {
    setModalError(error.message);
    setFeedback(`Не вдалося зберегти клієнта: ${error.message}`, 'error');
  }
}

async function saveTrainer(form) {
  const formData = new FormData(form);
  const mode = formData.get('mode') || form.dataset.trainerMode;
  const trainerId = form.dataset.trainerId;
  const specialization = formData.getAll('specializations').join(', ');

  if (!specialization) {
    setModalError('Оберіть хоча б одну спеціалізацію з активних послуг');
    return;
  }

  try {
    setModalError('');

    if (trainerId) {
      const phone = normalizePhoneInput(formData.get('phone'));
      if (!isValidPhone(phone)) {
        setModalError('Телефон має бути у форматі +380XXXXXXXXX');
        return;
      }

      await apiFetch(`/trainers/${trainerId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: formData.get('name')?.trim(),
          phone,
          specialization,
        }),
      });
      closeModal();
      await loadTrainers();
      setTrainerFeedback('Дані тренера оновлено', 'success');
      return;
    }

    if (mode === 'existing') {
      const clientId = formData.get('client_id');
      if (!clientId) {
        setModalError('Оберіть клієнта зі списку');
        return;
      }

      await apiFetch('/trainers/from-client', {
        method: 'POST',
        body: JSON.stringify({
          client_id: Number(clientId),
          specialization,
        }),
      });
      closeModal();
      await Promise.all([loadTrainers(), loadClients()]);
      setTrainerFeedback('Клієнту надано права тренера', 'success');
      return;
    }

    const phone = normalizePhoneInput(formData.get('phone'));
    if (!isValidPhone(phone)) {
      setModalError('Телефон має бути у форматі +380XXXXXXXXX');
      return;
    }

    await apiFetch('/trainers', {
      method: 'POST',
      body: JSON.stringify({
        name: formData.get('name')?.trim(),
        email: formData.get('email')?.trim(),
        password: formData.get('password'),
        phone,
        specialization,
      }),
    });
    closeModal();
    await loadTrainers();
    setTrainerFeedback('Тренера створено', 'success');
  } catch (error) {
    setModalError(error.message);
    setTrainerFeedback(`Не вдалося зберегти тренера: ${error.message}`, 'error');
  }
}

async function saveSchedule(form) {
  const formData = new FormData(form);
  const scheduleId = form.dataset.scheduleId;
  const payload = {
    workout_id: Number(formData.get('workout_id')),
    trainer_id: formData.get('trainer_id') ? Number(formData.get('trainer_id')) : null,
    date: formData.get('date'),
    time: formData.get('time'),
  };

  if (!payload.workout_id || !payload.date || !payload.time) {
    setModalError('Оберіть послугу, дату та час заняття');
    return;
  }

  if (payload.trainer_id) {
    const service = scheduleServices.find((item) => String(item.id) === String(payload.workout_id));
    const trainer = scheduleTrainers.find((item) => String(item.id) === String(payload.trainer_id));
    if (!trainer || !trainerMatchesService(trainer, service?.name)) {
      setModalError('Оберіть тренера, який має цю спеціалізацію');
      return;
    }
  }

  try {
    setModalError('');
    await apiFetch(scheduleId ? `/schedules/${scheduleId}` : '/schedules', {
      method: scheduleId ? 'PUT' : 'POST',
      body: JSON.stringify(payload),
    });
    closeModal();
    await loadSchedules();
    setScheduleFeedback(scheduleId ? 'Заняття оновлено' : 'Заняття створено', 'success');
  } catch (error) {
    setModalError(error.message);
    setScheduleFeedback(`Не вдалося зберегти заняття: ${error.message}`, 'error');
  }
}

async function deleteSchedule(scheduleId) {
  const schedule = schedules.find((item) => String(item.id) === String(scheduleId));
  const confirmed = window.confirm(`Видалити заняття ${schedule?.workout_name || ''} ${formatDate(schedule?.date)} ${formatTime(schedule?.time)}?`);
  if (!confirmed) return;

  try {
    await apiFetch(`/schedules/${scheduleId}`, { method: 'DELETE' });
    await loadSchedules();
    setScheduleFeedback('Заняття видалено', 'success');
  } catch (error) {
    setScheduleFeedback(`Не вдалося видалити заняття: ${error.message}`, 'error');
  }
}

async function saveService(form) {
  const formData = new FormData(form);
  const serviceId = form.dataset.serviceId;
  const payload = {
    name: formData.get('name')?.trim(),
    description: formData.get('description')?.trim(),
    max_clients: Number(formData.get('max_clients')),
    status: formData.get('status'),
  };

  if (!payload.name || !payload.max_clients) {
    setModalError('Заповніть назву та місткість послуги');
    return;
  }

  try {
    setModalError('');
    await apiFetch(serviceId ? `/workouts/${serviceId}` : '/workouts', {
      method: serviceId ? 'PUT' : 'POST',
      body: JSON.stringify(payload),
    });
    closeModal();
    await loadServices();
    setServicesFeedback(serviceId ? 'Послугу оновлено' : 'Послугу створено', 'success');
  } catch (error) {
    setModalError(error.message);
    setServicesFeedback(`Не вдалося зберегти послугу: ${error.message}`, 'error');
  }
}

async function updateServiceStatus(serviceId, status) {
  try {
    await apiFetch(`/workouts/${serviceId}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    await loadServices();
    setServicesFeedback(status === 'active' ? 'Послугу увімкнено' : 'Послугу вимкнено', 'success');
  } catch (error) {
    setServicesFeedback(`Не вдалося змінити статус послуги: ${error.message}`, 'error');
  }
}

async function savePlan(form) {
  const formData = new FormData(form);
  const planId = form.dataset.planId;
  const planType = formData.get('plan_type');
  const payload = {
    name: formData.get('name')?.trim(),
    description: formData.get('description')?.trim(),
    plan_type: planType,
    access_type: formData.get('access_type'),
    duration_days: planType === 'subscription' ? Number(formData.get('duration_days')) : null,
    usage_count: planType === 'single' ? Number(formData.get('usage_count')) : null,
    price: Number(formData.get('price')),
    status: formData.get('status'),
  };

  if (!payload.name || !payload.access_type || !payload.price) {
    setModalError('Заповніть назву, доступ і ціну');
    return;
  }

  try {
    setModalError('');
    await apiFetch(planId ? `/subscriptions/plans/${planId}` : '/subscriptions/plans', {
      method: planId ? 'PUT' : 'POST',
      body: JSON.stringify(payload),
    });
    closeModal();
    await loadPlans();
    setPlansFeedback(planId ? 'Тариф оновлено' : 'Тариф створено', 'success');
  } catch (error) {
    setModalError(error.message);
    setPlansFeedback(`Не вдалося зберегти тариф: ${error.message}`, 'error');
  }
}

async function updatePlanStatus(planId, status) {
  try {
    await apiFetch(`/subscriptions/plans/${planId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    await loadPlans();
    setPlansFeedback(status === 'active' ? 'Тариф увімкнено' : 'Тариф вимкнено', 'success');
  } catch (error) {
    setPlansFeedback(`Не вдалося змінити статус тарифу: ${error.message}`, 'error');
  }
}

async function assignPlan(form) {
  const formData = new FormData(form);
  const payload = {
    client_id: Number(formData.get('client_id')),
    plan_id: Number(formData.get('plan_id')),
    start_date: formData.get('start_date'),
  };

  if (!payload.client_id || !payload.plan_id || !payload.start_date) {
    setModalError('Оберіть клієнта, тариф і дату початку');
    return;
  }

  try {
    setModalError('');
    await apiFetch('/subscriptions/assign', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    closeModal();
    await Promise.all([loadSubscriptions(), loadClients()]);
    setPlansFeedback('Абонемент призначено клієнту, оплату створено', 'success');
  } catch (error) {
    setModalError(error.message);
    setPlansFeedback(`Не вдалося призначити абонемент: ${error.message}`, 'error');
  }
}

async function expireSubscription(subscriptionId) {
  const confirmed = window.confirm('Завершити цей абонемент? Він стане неактивним для клієнта.');
  if (!confirmed) return;

  try {
    await apiFetch(`/subscriptions/${subscriptionId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'expired' }),
    });
    await Promise.all([loadSubscriptions(), loadClients()]);
    setPlansFeedback('Абонемент завершено', 'success');
  } catch (error) {
    setPlansFeedback(`Не вдалося завершити абонемент: ${error.message}`, 'error');
  }
}

async function revokeTrainer(trainerId) {
  const trainer = trainers.find((item) => String(item.id) === String(trainerId));
  const confirmed = window.confirm(`Забрати права тренера у ${trainer?.name || 'користувача'}? Після цього він стане клієнтом.`);
  if (!confirmed) return;

  try {
    await apiFetch(`/trainers/${trainerId}`, { method: 'DELETE' });
    await Promise.all([loadTrainers(), loadClients()]);
    setTrainerFeedback('Права тренера забрано, користувач став клієнтом', 'success');
  } catch (error) {
    setTrainerFeedback(`Не вдалося забрати права тренера: ${error.message}`, 'error');
  }
}

async function createVisit(form) {
  const formData = new FormData(form);
  const clientId = formData.get('client_id');
  try {
    await apiFetch('/visits', {
      method: 'POST',
      body: JSON.stringify({ client_id: Number(clientId) }),
    });
    closeModal();
    setFeedback('Візит клієнта зафіксовано', 'success');
  } catch (error) {
    setFeedback(`Не вдалося відмітити візит: ${error.message}`, 'error');
  }
}

async function deleteClient(clientId) {
  const client = clients.find((item) => String(item.id) === String(clientId));
  const confirmed = window.confirm(`Видалити клієнта ${client?.name || ''}? Цю дію не можна скасувати.`);
  if (!confirmed) return;

  try {
    await apiFetch(`/clients/${clientId}`, { method: 'DELETE' });
    await loadClients();
    setFeedback('Клієнта видалено', 'success');
  } catch (error) {
    setFeedback(`Не вдалося видалити клієнта: ${error.message}`, 'error');
  }
}

function setScreen(screen) {
  const nextScreen = titles[screen] ? screen : 'dashboard';
  if (!document.querySelector(`[data-screen-panel="${nextScreen}"]`) && pageRoutes[nextScreen]) {
    window.location.href = pageRoutes[nextScreen];
    return;
  }
  const activeNav = ['admin-personal', 'club-settings', 'admin-settings'].includes(nextScreen)
    ? 'profile'
    : nextScreen;

  document.querySelectorAll('.screen').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.screenPanel === nextScreen);
  });

  document.querySelectorAll('[data-screen]').forEach((button) => {
    button.classList.toggle('active', button.dataset.screen === activeNav);
  });

  document.querySelector('#screen-title').textContent = titles[nextScreen];
}

document.querySelectorAll('[data-screen], [data-screen-link]').forEach((button) => {
  button.addEventListener('click', () => {
    setScreen(button.dataset.screen || button.dataset.screenLink);
  });
});

document.querySelectorAll('.logout, .logout-row').forEach((button) => {
  button.addEventListener('click', () => {
    clearAuth();
    window.location.href = PAGE.HOME;
  });
});

document.querySelectorAll('.chip').forEach((button) => {
  button.addEventListener('click', () => {
    const row = button.closest('.chip-row');
    row.querySelectorAll('.chip').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');

    if (button.dataset.clientFilter) {
      clientsFilter = button.dataset.clientFilter;
      renderClients();
    }

    if (button.dataset.trainerFilter) {
      trainersFilter = button.dataset.trainerFilter;
      renderTrainers();
    }

    if (button.dataset.scheduleFilter) {
      scheduleFilter = button.dataset.scheduleFilter;
      renderSchedules();
    }

    if (button.dataset.serviceFilter) {
      servicesFilter = button.dataset.serviceFilter;
      renderServices();
    }

    if (button.dataset.planFilter) {
      plansFilter = button.dataset.planFilter;
      renderPlans();
    }
  });
});

const sheet = document.querySelector('#sheet');
const sheetTitle = document.querySelector('#sheet-title');
const sheetBody = document.querySelector('#sheet-content');

document.addEventListener('click', async (event) => {
  const sheetButton = event.target.closest('.sheet-open');
  if (sheetButton) {
    const content = sheetContent[sheetButton.dataset.sheet] || sheetContent.client;
    sheetTitle.textContent = content.title;
    sheetBody.innerHTML = content.html;
    sheet.classList.add('active');
  }
});

document.querySelector('.sheet-close').addEventListener('click', () => {
  sheet.classList.remove('active');
});

sheet.addEventListener('click', (event) => {
  if (event.target === sheet) {
    sheet.classList.remove('active');
  }
});

const modal = document.querySelector('#admin-modal');
const modalTitle = document.querySelector('#modal-title');

document.addEventListener('click', async (event) => {
  const closeButton = event.target.closest('.modal-close');
  if (closeButton) {
    closeModal();
    return;
  }

  const addClientButton = event.target.closest('#open-client-modal');
  if (addClientButton) {
    openModal('Додати клієнта', renderClientForm());
    return;
  }

  const addTrainerButton = event.target.closest('#open-trainer-modal');
  if (addTrainerButton) {
    try {
      openModal('Додати тренера', '<p class="form-note">Завантаження клієнтів...</p>');
      const formHtml = await renderTrainerCreateForm();
      openModal('Додати тренера', formHtml);
    } catch (error) {
      openModal('Додати тренера', `
        <p class="form-error">Не вдалося завантажити клієнтів: ${escapeHtml(error.message)}</p>
        <div class="modal-actions">
          <button type="button" class="ghost-btn modal-close">Закрити</button>
        </div>
      `);
    }
    return;
  }

  const addScheduleButton = event.target.closest('#open-schedule-modal');
  if (addScheduleButton) {
    try {
      openModal('Створити заняття', '<p class="form-note">Завантаження послуг і тренерів...</p>');
      await ensureScheduleOptions();
      openModal('Створити заняття', renderScheduleForm());
    } catch (error) {
      openModal('Створити заняття', `
        <p class="form-error">Не вдалося завантажити дані: ${escapeHtml(error.message)}</p>
        <div class="modal-actions">
          <button type="button" class="ghost-btn modal-close">Закрити</button>
        </div>
      `);
    }
    return;
  }

  const addServiceButton = event.target.closest('#open-service-modal');
  if (addServiceButton) {
    openModal('Додати послугу', renderServiceForm());
    return;
  }

  const addPlanButton = event.target.closest('#open-plan-modal');
  if (addPlanButton) {
    openModal('Додати тариф', renderPlanForm());
    const form = document.querySelector('#plan-form');
    if (form) updatePlanFormFields(form);
    return;
  }

  const assignPlanButton = event.target.closest('#open-assign-plan-modal');
  if (assignPlanButton) {
    if (!clients.length) await loadClients();
    if (!plans.length) await loadPlans();
    openModal('Призначити абонемент клієнту', renderAssignPlanForm());
    return;
  }

  const visitModalButton = event.target.closest('#open-visit-modal, [data-client-visit]');
  if (visitModalButton) {
    openModal('Відмітити візит', renderVisitForm(visitModalButton.dataset.clientVisit || ''));
    return;
  }

  const detailsButton = event.target.closest('[data-client-details]');
  if (detailsButton) {
    openClientDetails(detailsButton.dataset.clientDetails);
    return;
  }

  const editButton = event.target.closest('[data-client-edit]');
  if (editButton) {
    const client = clients.find((item) => String(item.id) === editButton.dataset.clientEdit);
    if (client) {
      openModal('Редагувати клієнта', renderClientForm(client));
    }
    return;
  }

  const deleteButton = event.target.closest('[data-client-delete]');
  if (deleteButton) {
    deleteClient(deleteButton.dataset.clientDelete);
    return;
  }

  const trainerDetailsButton = event.target.closest('[data-trainer-details]');
  if (trainerDetailsButton) {
    openTrainerDetails(trainerDetailsButton.dataset.trainerDetails);
    return;
  }

  const trainerEditButton = event.target.closest('[data-trainer-edit]');
  if (trainerEditButton) {
    const trainer = trainers.find((item) => String(item.id) === trainerEditButton.dataset.trainerEdit);
    if (trainer) {
      try {
        openModal('Редагувати тренера', '<p class="form-note">Завантаження спеціалізацій...</p>');
        await ensureActiveServices();
        openModal('Редагувати тренера', renderTrainerEditForm(trainer));
      } catch (error) {
        openModal('Редагувати тренера', `
          <p class="form-error">Не вдалося завантажити послуги: ${escapeHtml(error.message)}</p>
          <div class="modal-actions">
            <button type="button" class="ghost-btn modal-close">Закрити</button>
          </div>
        `);
      }
    }
    return;
  }

  const trainerRevokeButton = event.target.closest('[data-trainer-revoke]');
  if (trainerRevokeButton) {
    revokeTrainer(trainerRevokeButton.dataset.trainerRevoke);
    return;
  }

  const scheduleEditButton = event.target.closest('[data-schedule-edit]');
  if (scheduleEditButton) {
    const schedule = schedules.find((item) => String(item.id) === scheduleEditButton.dataset.scheduleEdit);
    if (schedule) {
      try {
        openModal('Редагувати заняття', '<p class="form-note">Завантаження послуг і тренерів...</p>');
        await ensureScheduleOptions();
        openModal('Редагувати заняття', renderScheduleForm(schedule));
      } catch (error) {
        setScheduleFeedback(`Не вдалося відкрити форму: ${error.message}`, 'error');
        closeModal();
      }
    }
    return;
  }

  const scheduleDeleteButton = event.target.closest('[data-schedule-delete]');
  if (scheduleDeleteButton) {
    deleteSchedule(scheduleDeleteButton.dataset.scheduleDelete);
    return;
  }

  const serviceEditButton = event.target.closest('[data-service-edit]');
  if (serviceEditButton) {
    const service = services.find((item) => String(item.id) === serviceEditButton.dataset.serviceEdit);
    if (service) {
      openModal('Редагувати послугу', renderServiceForm(service));
    }
    return;
  }

  const serviceStatusButton = event.target.closest('[data-service-status]');
  if (serviceStatusButton) {
    updateServiceStatus(serviceStatusButton.dataset.serviceStatus, serviceStatusButton.dataset.nextStatus);
    return;
  }

  const planEditButton = event.target.closest('[data-plan-edit]');
  if (planEditButton) {
    const plan = plans.find((item) => String(item.id) === planEditButton.dataset.planEdit);
    if (plan) {
      openModal('Редагувати тариф', renderPlanForm(plan));
      const form = document.querySelector('#plan-form');
      if (form) updatePlanFormFields(form);
    }
    return;
  }

  const planStatusButton = event.target.closest('[data-plan-status]');
  if (planStatusButton) {
    updatePlanStatus(planStatusButton.dataset.planStatus, planStatusButton.dataset.nextStatus);
    return;
  }

  const subscriptionExpireButton = event.target.closest('[data-subscription-expire]');
  if (subscriptionExpireButton) {
    expireSubscription(subscriptionExpireButton.dataset.subscriptionExpire);
    return;
  }

  const modalButton = event.target.closest('.modal-open');
  if (modalButton) {
    modalTitle.textContent = modalButton.dataset.modalTitle || 'Форма';
    const content = document.querySelector('#modal-content');
    if (content) {
      content.innerHTML = `
        <p class="form-note">Ця форма буде підключена на наступних етапах.</p>
        <div class="modal-actions">
          <button type="button" class="ghost-btn modal-close">Закрити</button>
        </div>
      `;
    }
    modal.classList.add('active');
  }
});

document.addEventListener('change', (event) => {
  const scheduleWorkoutSelect = event.target.closest('#schedule-form select[name="workout_id"]');
  if (scheduleWorkoutSelect) {
    const form = scheduleWorkoutSelect.closest('#schedule-form');
    const trainerSelect = form?.querySelector('select[name="trainer_id"]');
    if (trainerSelect) {
      trainerSelect.innerHTML = renderScheduleTrainerOptions(scheduleWorkoutSelect.value);
    }
    return;
  }

  const planTypeSelect = event.target.closest('select[name="plan_type"]');
  if (planTypeSelect) {
    const planForm = planTypeSelect.closest('#plan-form');
    if (planForm) updatePlanFormFields(planForm);
    return;
  }

  const modeInput = event.target.closest('input[name="mode"]');
  if (!modeInput) return;

  const form = modeInput.closest('#trainer-form');
  if (!form) return;

  form.querySelectorAll('[data-trainer-mode-panel]').forEach((panel) => {
    const isActive = panel.dataset.trainerModePanel === modeInput.value;
    panel.hidden = !isActive;
    panel.querySelectorAll('input, select, textarea').forEach((field) => {
      field.disabled = !isActive;
    });
  });
  attachPhoneMasks(form);
});

document.addEventListener('submit', (event) => {
  const clientForm = event.target.closest('#client-form');
  if (clientForm) {
    event.preventDefault();
    saveClient(clientForm);
    return;
  }

  const visitForm = event.target.closest('#visit-form');
  if (visitForm) {
    event.preventDefault();
    createVisit(visitForm);
    return;
  }

  const trainerForm = event.target.closest('#trainer-form');
  if (trainerForm) {
    event.preventDefault();
    saveTrainer(trainerForm);
    return;
  }

  const scheduleForm = event.target.closest('#schedule-form');
  if (scheduleForm) {
    event.preventDefault();
    saveSchedule(scheduleForm);
    return;
  }

  const serviceForm = event.target.closest('#service-form');
  if (serviceForm) {
    event.preventDefault();
    saveService(serviceForm);
    return;
  }

  const planForm = event.target.closest('#plan-form');
  if (planForm) {
    event.preventDefault();
    savePlan(planForm);
    return;
  }

  const assignPlanForm = event.target.closest('#assign-plan-form');
  if (assignPlanForm) {
    event.preventDefault();
    assignPlan(assignPlanForm);
  }
});

modal.addEventListener('click', (event) => {
  if (event.target === modal) {
    closeModal();
  }
});

clientsSearch?.addEventListener('input', renderClients);
trainersSearch?.addEventListener('input', renderTrainers);
scheduleSearch?.addEventListener('input', renderSchedules);
servicesSearch?.addEventListener('input', renderServices);
plansSearch?.addEventListener('input', renderPlans);

const currentUser = await requireFreshAuth([ROLE.ADMIN]);
if (currentUser && clientsPage) {
  loadClients();
}
if (currentUser && trainersPage) {
  loadTrainers();
}
if (currentUser && schedulePage) {
  loadSchedules();
}
if (currentUser && servicesPage) {
  loadServices();
}
if (currentUser && plansPage) {
  loadPlans();
  loadSubscriptions();
  loadClients();
}
