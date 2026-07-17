import { apiFetch, clearAuth, formatDate, requireFreshAuth, setAuth } from './api.js';
import { escapeHtml, getInitials, getAvatarColor, AVATAR_PALETTE, formatMoney } from './utils.js';
import { hydrateAccount } from './account.js';
import { PAGE, ROLE } from './constants.js';
import { initSidebar } from './sidebar.js';
import { initTheme } from './theme.js';
import { initNotifications } from './notifications.js';
import { startChatListPolling, stopChatPolling } from "./admin/chat.js";

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
let selectedScheduleDate = '';
let scheduleServices = [];
let scheduleTrainers = [];
let services = [];
let servicesFilter = 'all';
let _adminSvcOffset = 0;
const ADM_SVC_VISIBLE = 4;
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
const scheduleDateStrip = document.querySelector('#schedule-date-strip');
const scheduleDayList = document.querySelector('#schedule-day-list');
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
const dashboardPage = document.querySelector('[data-screen-panel="dashboard"]');

// Заняття вважається «майже заповненим», якщо вільних місць не більше цього.
const ALMOST_FULL_THRESHOLD = 2;

// Скільки днів уперед вважати «цим тижнем» для абонементів, що завершуються.
const ENDING_SOON_DAYS = 7;

const messagesPage = document.querySelector('[data-screen-panel="messages"]');
const messagesTableBody = document.querySelector('#messages-table-body');
const messagesSearch = document.querySelector('#messages-search');
const profilePage = document.querySelector('[data-screen-panel="profile"]');
const clubForm = document.querySelector('#club-form');

let messages = [];
let messagesFilter = 'all';

const messageAudienceLabels = {
  clients: 'Клієнтам',
  trainers: 'Тренерам',
  all: 'Усім',
  custom: 'Вибраним',
};

const messageStatusLabels = {
  sent: 'Надіслано',
  planned: 'Заплановано',
};

const statusLabels = {
  active: 'Активний',
  inactive: 'Неактивний',
  paused: 'Пауза',
  expired: 'Неактивний',
  cancelled: 'Скасований',
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

/** Через скільки мс ховати повідомлення про успішну дію (помилки лишаються). */
const FEEDBACK_HIDE_MS = 5000;
let feedbackHideTimer = null;

function setFeedback(message, type = 'info') {
  if (!clientsFeedback) {
    return;
  }
  clientsFeedback.textContent = message;
  clientsFeedback.dataset.type = type;

  // Повідомлення про успіх не повинно «висіти» вічно і мандрувати між
  // екранами — прибираємо його автоматично; помилки чекають реакції.
  clearTimeout(feedbackHideTimer);
  if (type === 'success') {
    feedbackHideTimer = setTimeout(() => {
      clientsFeedback.textContent = '';
      delete clientsFeedback.dataset.type;
    }, FEEDBACK_HIDE_MS);
  }
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

/// Стрічка днів за замовчуванням: від сьогодні і два тижні вперед.
const SCHEDULE_DAYS_BACK = 0;
const SCHEDULE_DAYS_FORWARD = 14;

// Користувацький діапазон (порожній = діапазон за замовчуванням).
let scheduleRangeStart = '';
let scheduleRangeEnd = '';

/**
 * Формує БЕЗПЕРЕРВНИЙ перелік днів для стрічки — кожен день показується
 * незалежно від наявності занять. За замовчуванням це тиждень назад і два
 * тижні вперед; якщо задано користувацький діапазон — використовується він.
 *
 * @returns {string[]} дати 'YYYY-MM-DD' за зростанням, без пропусків.
 */
function getScheduleDates() {
  const today = todayIso();
  const start = scheduleRangeStart || addDaysIso(today, -SCHEDULE_DAYS_BACK);
  let end = scheduleRangeEnd || addDaysIso(today, SCHEDULE_DAYS_FORWARD);
  if (end < start) {
    end = start;
  }

  const dates = [];
  let cursor = start;
  while (cursor <= end) {
    dates.push(cursor);
    cursor = addDaysIso(cursor, 1);
  }
  return dates;
}

/**
 * День за замовчуванням — сьогодні, якщо він у діапазоні; інакше перший день
 * діапазону (актуально для користувацького діапазону без сьогодні).
 *
 * @returns {string}
 */
function pickDefaultScheduleDate() {
  const dates = getScheduleDates();
  const today = todayIso();
  return dates.includes(today) ? today : (dates[0] || today);
}

/**
 * Прокручує стрічку днів так, щоб активний день був по центру (виклик після
 * завантаження — щоб одразу опинитися на поточному дні).
 */
function scrollScheduleStripToActive() {
  const activePill = scheduleDateStrip?.querySelector('.sched-date-pill.active');
  activePill?.scrollIntoView({ inline: 'center', block: 'nearest' });
}

/**
 * Форматує дату для пігулки дня у вигляді 'дд.мм'.
 *
 * @param {string} value
 * @returns {string}
 */
function formatScheduleDay(value) {
  return new Date(value).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
}

/**
 * Повертає скорочену назву дня тижня для пігулки дня.
 *
 * @param {string} value
 * @returns {string}
 */
function formatScheduleWeekday(value) {
  return new Date(value).toLocaleDateString('uk-UA', { weekday: 'short' });
}

/**
 * Повертає заняття обраного дня з урахуванням пошукового запиту,
 * відсортовані за часом початку.
 *
 * @returns {object[]}
 */
function getSchedulesForSelectedDay() {
  const query = normalizeText(scheduleSearch?.value);

  return schedules
    .filter((schedule) => formatDate(schedule.date) === selectedScheduleDate)
    .filter((schedule) => {
      const haystack = normalizeText(`${schedule.workout_name} ${schedule.trainer_name} ${schedule.time}`);
      return !query || haystack.includes(query);
    })
    .sort((first, second) => formatTime(first.time).localeCompare(formatTime(second.time)));
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
    if (plan.status === 'deleted') return false;
    const matchesFilter = plansFilter === 'all'
      || plan.status === plansFilter
      || plan.plan_type === plansFilter;
    const haystack = normalizeText(`${plan.name} ${plan.description} ${plan.access_type}`);
    return matchesFilter && (!query || haystack.includes(query));
  });
}

/**
 * Малює горизонтальну стрічку днів. Кожна пігулка показує дату, день тижня
 * і кількість занять (або позначку «Сьогодні»), активний день підсвічено.
 */
function renderScheduleDateStrip() {
  if (!scheduleDateStrip) {
    return;
  }

  const today = todayIso();
  const dates = getScheduleDates();
  // На мобільному — фіксована ширина + скрол; на десктопі — 1fr (розтяжка)
  const pillW = window.innerWidth < 720 ? '54px' : '1fr';
  scheduleDateStrip.style.gridTemplateColumns = `repeat(${dates.length}, ${pillW})`;
  scheduleDateStrip.innerHTML = dates.map((date) => {
    const isActive = date === selectedScheduleDate;
    const isToday = date === today;
    const dayCount = schedules.filter((s) => formatDate(s.date) === date).length;
    return `
      <button class="sched-date-pill${isActive ? ' active' : ''}${isToday ? ' today' : ''}" data-schedule-date="${date}">
        <span class="sdp-weekday">${formatScheduleWeekday(date)}</span>
        <strong class="sdp-day">${formatScheduleDay(date)}</strong>
        <span class="sdp-count">${isToday ? 'Сьогодні' : `${dayCount} зан.`}</span>
      </button>
    `;
  }).join('');
}

/**
 * Малює список занять обраного дня з діями адміністратора
 * (редагувати / видалити).
 */
function renderScheduleDayList() {
  if (!scheduleDayList) {
    return;
  }

  const daySchedules = getSchedulesForSelectedDay();
  if (daySchedules.length === 0) {
    scheduleDayList.innerHTML = `
      <div class="sched-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>
        <p>На цей день занять немає</p>
        <button class="primary-btn" id="open-schedule-modal-empty">
          Створити заняття
        </button>
      </div>
    `;
    return;
  }

  scheduleDayList.innerHTML = daySchedules.map((schedule) => {
    const maxClients = Number(schedule.max_clients || 0);
    const booked = Number(schedule.booked || 0);
    const available = typeof schedule.available === 'number'
      ? schedule.available
      : Math.max(maxClients - booked, 0);
    const fillPct = maxClients > 0 ? Math.round((booked / maxClients) * 100) : 0;
    const isFull = available === 0 && maxClients > 0;

    const trainerInitials = getInitials(schedule.trainer_name || '?');
    const trainerColor = getAvatarColor(schedule.trainer_name || '');

    return `
      <div class="sched-card">
        <div class="sched-card-time">
          <span>${formatTime(schedule.time)}</span>
          ${schedule.duration_minutes ? `<span class="sched-duration sched-duration--time">${schedule.duration_minutes} хв</span>` : ''}
        </div>
        <div class="sched-card-body">
          <div class="sched-card-title">
            ${escapeHtml(schedule.workout_name || '—')}
            ${schedule.duration_minutes ? `<span class="sched-duration sched-duration--title">${schedule.duration_minutes} хв</span>` : ''}
          </div>
          <div class="sched-card-meta">
            <div class="client-avatar" style="background:${trainerColor};width:20px;height:20px;font-size:8px;flex-shrink:0">${escapeHtml(trainerInitials)}</div>
            <span>${escapeHtml(schedule.trainer_name || 'Тренер не призначений')}</span>
          </div>
          <div class="sched-capacity">
            <div class="sched-capacity-bar">
              <div class="sched-capacity-fill${isFull ? ' full' : ''}" style="width:${fillPct}%"></div>
            </div>
            <span class="sched-capacity-label${isFull ? ' full' : ''}">${booked}/${maxClients}${isFull ? ' · повно' : ''}</span>
          </div>
        </div>
        <div class="sched-card-actions">
          <button class="icon-btn" data-schedule-view="${schedule.id}" title="Деталі">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </button>
          <button class="icon-btn" data-schedule-edit="${schedule.id}" title="Редагувати">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
          </button>
          <button class="icon-btn icon-btn--danger" data-schedule-delete="${schedule.id}" title="Видалити">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Відкриває панель з повною інформацією про заплановане заняття:
 * послуга, опис, дата й час, тренер, заповнення груп і список записаних
 * клієнтів. Базові дані беремо з уже завантаженого розкладу, а список
 * записаних — окремим запитом до /bookings/schedule/:id.
 *
 * @param {string|number} scheduleId
 */
async function openScheduleDetails(scheduleId) {
  const schedule = schedules.find((item) => String(item.id) === String(scheduleId));
  if (!schedule) {
    return;
  }

  const maxClients = Number(schedule.max_clients || 0);
  const booked = Number(schedule.booked || 0);
  const available = typeof schedule.available === 'number'
    ? schedule.available
    : Math.max(maxClients - booked, 0);

  sheetTitle.textContent = schedule.workout_name || 'Заняття';
  sheetBody.innerHTML = `
    <dl>
      <div><dt>Дата</dt><dd>${formatDate(schedule.date)}</dd></div>
      <div><dt>Час</dt><dd>${formatTime(schedule.time)}</dd></div>
      <div><dt>Тренер</dt><dd>${escapeHtml(schedule.trainer_name || 'Не призначений')}</dd></div>
      <div><dt>Заповнення</dt><dd>${booked}/${maxClients} · вільно ${available}</dd></div>
    </dl>
    <p>${escapeHtml(schedule.workout_description || 'Опис заняття не додано.')}</p>
    <h3>Записані клієнти</h3>
    <ul id="schedule-attendees"><li>Завантаження...</li></ul>
  `;
  sheet.classList.add('active');

  try {
    const attendees = await apiFetch(`/bookings/schedule/${scheduleId}`);
    // Показуємо лише активні записи (скасовані до уваги не беремо).
    const activeAttendees = attendees.filter((item) => item.status === 'active');
    const attendeeList = document.querySelector('#schedule-attendees');
    if (!attendeeList) {
      return;
    }

    attendeeList.innerHTML = activeAttendees.length
      ? activeAttendees
        .map((item) => `<li>${escapeHtml(item.client_name)}${item.attended ? ' · відвідав' : ''}</li>`)
        .join('')
      : '<li>Ще ніхто не записався</li>';
  } catch (error) {
    const attendeeList = document.querySelector('#schedule-attendees');
    if (attendeeList) {
      attendeeList.innerHTML = `<li>Не вдалося завантажити список: ${escapeHtml(error.message)}</li>`;
    }
  }
}

/**
 * Оновлює весь блок розкладу: стрічку днів і список занять обраного дня.
 * Якщо обраний день зник із розкладу (наприклад, після видалення),
 * автоматично переходить на найближчий доступний день.
 */
function renderSchedules() {
  if (!scheduleDayList) {
    return;
  }

  const dates = getScheduleDates();
  if (!dates.includes(selectedScheduleDate)) {
    selectedScheduleDate = pickDefaultScheduleDate(dates);
  }

  renderScheduleDateStrip();
  renderScheduleDayList();
}

async function loadSchedules() {
  if (scheduleDayList) {
    scheduleDayList.innerHTML = `<div class="sched-empty"><p>Завантаження розкладу...</p></div>`;
  }

  try {
    schedules = await apiFetch('/schedules');
    // На першому завантаженні стаємо на сьогодні; після save/delete зберігаємо
    // вже обраний день, якщо він лишився в діапазоні.
    const dates = getScheduleDates();
    if (!selectedScheduleDate || !dates.includes(selectedScheduleDate)) {
      selectedScheduleDate = pickDefaultScheduleDate();
    }
    renderSchedules();
    scrollScheduleStripToActive();
  } catch (error) {
    setScheduleFeedback(`Не вдалося завантажити розклад: ${error.message}`, 'error');
    if (scheduleDayList) {
      scheduleDayList.innerHTML = `<div class="sched-empty"><p>Помилка завантаження розкладу</p></div>`;
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
    <div class="spec-chips">
      ${scheduleServices.map((service) => {
        const checked = selected.includes(normalizeSpecialization(service.name)) ? 'checked' : '';
        const id = `spec-${escapeHtml(service.name).replace(/\s+/g, '-')}`;
        return `
          <label class="spec-chip${checked ? ' checked' : ''}" for="${id}">
            <input type="checkbox" id="${id}" name="specializations" value="${escapeHtml(service.name)}" ${checked}>
            ${escapeHtml(service.name)}
          </label>
        `;
      }).join('')}
    </div>
  `;
}

function updateClientStats() {
  const total = clients.length;
  const active = clients.filter((c) => c.status === 'active').length;
  const inactive = total - active;
  const elTotal = document.querySelector('#stat-total');
  const elActive = document.querySelector('#stat-active');
  const elInactive = document.querySelector('#stat-inactive');
  if (elTotal) animateCountUp(elTotal, total);
  if (elActive) animateCountUp(elActive, active);
  if (elInactive) animateCountUp(elInactive, inactive);
}

function renderClients() {
  if (!clientsTableBody) return;

  updateClientStats();

  const visibleClients = getFilteredClients();
  if (visibleClients.length === 0) {
    clientsTableBody.innerHTML = `
      <div class="table-row table-empty">
        <span>Клієнтів не знайдено</span>
      </div>
    `;
    return;
  }

  const eyeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const editIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  const checkIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  const trashIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;

  clientsTableBody.innerHTML = visibleClients.map((client) => {
    const status = client.status || 'inactive';
    const subscription = client.subscription_type || 'Немає';
    const endDate = formatDate(client.subscription_end_date) || '—';
    const phone = client.phone || '—';
    const initials = getInitials(client.name);
    const avatarColor = getAvatarColor(client.name);

    const visitBtn = status === 'active'
      ? `<button class="icon-action-btn icon-action-btn--accent" data-client-visit="${client.id}" title="Відмітити візит">${checkIcon}</button>`
      : `<button class="icon-action-btn" disabled title="Немає активного абонемента" style="opacity:.3">${checkIcon}</button>`;

    return `
      <div class="table-row client-row">
        <div class="cc-avatar-name">
          <div class="client-avatar" style="background:${avatarColor}">${escapeHtml(initials)}</div>
          <div class="cc-name-block">
            <strong>${escapeHtml(client.name)}</strong>
            <span class="cc-sub">${escapeHtml(phone)} · ${escapeHtml(client.email)}</span>
            <span class="cc-plan-mobile">${escapeHtml(subscription)}${endDate !== '—' ? ` · до ${endDate}` : ''}</span>
          </div>
        </div>
        <span class="cc-phone">${escapeHtml(phone)}</span>
        <span class="cc-email">${escapeHtml(client.email)}</span>
        <span class="cc-plan">${escapeHtml(subscription)}</span>
        <span class="cc-status"><mark class="status ${status}">${statusLabels[status] || status}</mark></span>
        <span class="cc-date">${escapeHtml(endDate)}</span>
        <div class="cc-actions">
          <button class="icon-action-btn" data-client-details="${client.id}" title="Деталі">${eyeIcon}</button>
          <button class="icon-action-btn" data-client-edit="${client.id}" title="Редагувати">${editIcon}</button>
          ${visitBtn}
          <button class="icon-action-btn icon-action-btn--danger" data-client-delete="${client.id}" title="Видалити">${trashIcon}</button>
        </div>
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
  } catch (error) {
    setFeedback(`Не вдалося завантажити клієнтів: ${error.message}`, 'error');
    if (clientsTableBody) {
      clientsTableBody.innerHTML = '<div class="table-row table-empty"><span>Помилка завантаження</span></div>';
    }
  }
}

function updateTrainerStats() {
  const total = trainers.length;
  const active = trainers.filter((t) => t.status === 'active').length;
  const inactive = total - active;
  const elTotal = document.querySelector('#tstat-total');
  const elActive = document.querySelector('#tstat-active');
  const elInactive = document.querySelector('#tstat-inactive');
  if (elTotal) animateCountUp(elTotal, total);
  if (elActive) animateCountUp(elActive, active);
  if (elInactive) animateCountUp(elInactive, inactive);
}

function renderTrainers() {
  if (!trainersTableBody) return;

  updateTrainerStats();

  const eyeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const editIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  const revokeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" y1="8" x2="23" y2="14"/><line x1="23" y1="8" x2="17" y2="14"/></svg>`;

  const visibleTrainers = getFilteredTrainers();
  if (visibleTrainers.length === 0) {
    trainersTableBody.innerHTML = `<div class="table-row table-empty"><span>Тренерів не знайдено</span></div>`;
    return;
  }

  trainersTableBody.innerHTML = visibleTrainers.map((trainer) => {
    const status = trainer.status || 'inactive';
    const name = escapeHtml(trainer.name || '—');
    const phone = escapeHtml(trainer.phone || '—');
    const email = escapeHtml(trainer.email || '—');
    const spec = escapeHtml(trainer.specialization || 'Не вказано');
    const initials = getInitials(trainer.name);
    const avatarColor = getAvatarColor(trainer.name);

    return `
      <div class="table-row trainer-row">
        <div class="cc-avatar-name">
          <div class="client-avatar" style="background:${avatarColor}">${initials}</div>
          <div class="cc-name-block">
            <strong>${name}</strong>
            <span class="cc-sub">${phone} · ${email}</span>
            <span class="cc-plan-mobile">${spec}</span>
          </div>
        </div>
        <span class="tc-phone">${phone}</span>
        <span class="tc-email">${email}</span>
        <span class="tc-spec">${spec}</span>
        <span class="tc-status"><mark class="status ${status}">${statusLabels[status] || status}</mark></span>
        <div class="cc-actions">
          <button class="icon-action-btn" data-trainer-details="${trainer.id}" title="Деталі">${eyeIcon}</button>
          <button class="icon-action-btn" data-trainer-edit="${trainer.id}" title="Редагувати">${editIcon}</button>
          <button class="icon-action-btn icon-action-btn--danger" data-trainer-revoke="${trainer.id}" title="Забрати права">${revokeIcon}</button>
        </div>
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
  } catch (error) {
    setTrainerFeedback(`Не вдалося завантажити тренерів: ${error.message}`, 'error');
    trainersTableBody.innerHTML = '<div class="table-row table-empty"><span>Помилка завантаження</span></div>';
  }
}

const _svcTheme = {
  'trx':          { color: '#ff6424', gradient: 'linear-gradient(135deg,#ff6424 0%,#8a2200 100%)' },
  'фітнес':       { color: '#ff6424', gradient: 'linear-gradient(135deg,#ff6424 0%,#c23a00 100%)' },
  'йога':         { color: '#6ec8a0', gradient: 'linear-gradient(135deg,#2a8a62 0%,#0e3d2c 100%)' },
  'персональні':  { color: '#ffbf17', gradient: 'linear-gradient(135deg,#ffbf17 0%,#b87800 100%)' },
  'єдиноборства': { color: '#e05555', gradient: 'linear-gradient(135deg,#c93333 0%,#6b0a0a 100%)' },
};

function _buildAdminSvcCard(service, globalIndex) {
  const key = String(service.name).toLowerCase();
  const theme = _svcTheme[key] || { color: '#ff6424', gradient: 'linear-gradient(135deg,#ff6424 0%,#8a2200 100%)' };
  const bg = service.image_url
    ? `background-image:url('${escapeHtml(service.image_url)}')`
    : `background:${theme.gradient}`;
  const isActive = (service.status || 'active') === 'active';
  const num = String(globalIndex + 1).padStart(2, '0');
  const capacity = Number(service.max_clients) > 1
    ? `До ${escapeHtml(String(service.max_clients))} осіб`
    : 'Індивідуально';
  const duration = service.duration_minutes ? `${service.duration_minutes} хв` : '';
  const statusLabel = isActive ? '● Активна' : '● Неактивна';

  return `
    <article class="svc-card adm-svc-card" style="--svc-color:${theme.color};${bg}">
      <span class="svc-card__num">${num}</span>
      <div class="svc-card__overlay"></div>
      <div class="adm-svc-actions">
        <button class="adm-svc-btn adm-svc-btn--edit" data-service-edit="${service.id}" title="Редагувати">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="adm-svc-btn adm-svc-btn--toggle ${isActive ? 'toggle-off' : 'toggle-on'}"
          data-service-status="${service.id}" data-next-status="${isActive ? 'inactive' : 'active'}" title="${isActive ? 'Вимкнути' : 'Увімкнути'}">
          ${isActive
            ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`
            : `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`}
        </button>
        <button class="adm-svc-btn adm-svc-btn--delete" data-service-delete="${service.id}" title="Видалити">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
      <span class="adm-svc-status ${isActive ? 'active' : 'inactive'}">${statusLabel}</span>
      <div class="svc-card__body">
        <h3 class="svc-card__title">${escapeHtml(service.name)}</h3>
        <p class="svc-card__desc">${escapeHtml(service.description || 'Опис не вказано')}</p>
        <div class="svc-card__chips">
          <span>${capacity}</span>
          ${duration ? `<span>⏱ ${duration}</span>` : ''}
        </div>
      </div>
    </article>
  `;
}

function renderServices() {
  if (!servicesGrid) return;
  const all = getFilteredServices();

  if (all.length === 0) {
    servicesGrid.innerHTML = '<p style="color:var(--muted);grid-column:1/-1;padding:20px 0">Послуг не знайдено</p>';
    _updateSvcNav(all);
    return;
  }

  const slice = all.slice(_adminSvcOffset, _adminSvcOffset + ADM_SVC_VISIBLE);
  servicesGrid.innerHTML = slice.map((s, i) => _buildAdminSvcCard(s, _adminSvcOffset + i)).join('');
  _updateSvcNav(all);
}

function _updateSvcNav(all) {
  const total = all.length;
  const prevBtn = document.getElementById('svc-prev');
  const nextBtn = document.getElementById('svc-next');
  const dotsEl = document.getElementById('svc-dots');
  if (prevBtn) prevBtn.disabled = _adminSvcOffset === 0;
  if (nextBtn) nextBtn.disabled = _adminSvcOffset + ADM_SVC_VISIBLE >= total;
  if (dotsEl) {
    const steps = Math.max(1, Math.ceil(total / ADM_SVC_VISIBLE));
    const active = Math.floor(_adminSvcOffset / ADM_SVC_VISIBLE);
    dotsEl.innerHTML = Array.from({ length: steps }, (_, i) =>
      `<span class="svc-nav-dot ${i === active ? 'active' : ''}"></span>`
    ).join('');
  }
}

// ── Plans carousel ──
const _plansGrid = document.getElementById('plans-grid');
const _plansPrev = document.getElementById('plans-prev');
const _plansNext = document.getElementById('plans-next');

function _updatePlansBtns() {
  if (!_plansPrev || !_plansNext || !_plansGrid) return;
  // якщо layout ще не готовий — не блокуємо кнопки
  if (_plansGrid.scrollWidth <= 1) return;
  _plansPrev.disabled = _plansGrid.scrollLeft <= 2;
  _plansNext.disabled = _plansGrid.scrollLeft + _plansGrid.clientWidth >= _plansGrid.scrollWidth - 2;
}

// Перевіряємо state кнопок після стабілізації layout
function _deferUpdatePlansBtns() {
  // подвійний rAF гарантує що layout вже прорахований
  requestAnimationFrame(() => requestAnimationFrame(_updatePlansBtns));
  // запасний таймер для випадків з margin:auto / flex layout
  setTimeout(_updatePlansBtns, 120);
}

if (_plansGrid && _plansPrev && _plansNext) {
  _plansPrev.addEventListener('click', () => {
    const step = (_plansGrid.querySelector('.manage-card')?.offsetWidth ?? 280) + 14;
    _plansGrid.scrollBy({ left: -step, behavior: 'smooth' });
  });
  _plansNext.addEventListener('click', () => {
    const step = (_plansGrid.querySelector('.manage-card')?.offsetWidth ?? 280) + 14;
    _plansGrid.scrollBy({ left: step, behavior: 'smooth' });
  });
  _plansGrid.addEventListener('scroll', _updatePlansBtns, { passive: true });
  window.addEventListener('resize', _deferUpdatePlansBtns);
}

function _initAdminSvcCarousel() {
  const prevBtn = document.getElementById('svc-prev');
  const nextBtn = document.getElementById('svc-next');
  if (!prevBtn || !nextBtn) return;
  prevBtn.addEventListener('click', () => {
    if (_adminSvcOffset > 0) { _adminSvcOffset -= ADM_SVC_VISIBLE; renderServices(); }
  });
  nextBtn.addEventListener('click', () => {
    const all = getFilteredServices();
    if (_adminSvcOffset + ADM_SVC_VISIBLE < all.length) { _adminSvcOffset += ADM_SVC_VISIBLE; renderServices(); }
  });
}

async function loadServices() {
  if (!servicesGrid) return;
  servicesGrid.innerHTML = '<article class="manage-card"><p>Завантаження послуг...</p></article>';
  try {
    services = await apiFetch('/workouts');
    _adminSvcOffset = 0;
    renderServices();
    _initAdminSvcCarousel();
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
    plansGrid.innerHTML = '<article class="manage-card"><p style="padding:20px">Тарифів не знайдено</p></article>';
    _deferUpdatePlansBtns();
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

    const checkSvg = `<svg viewBox="0 0 16 16" fill="none" width="14" height="14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 8.5 6 12 13.5 4"/></svg>`;
    const priceNum = Number(plan.price || 0).toLocaleString('uk-UA', { maximumFractionDigits: 0 });
    const period = isSubscription ? '/ міс' : '/ відв.';
    const features = [
      isSubscription ? `${plan.duration_days || 0} днів доступу` : `${plan.usage_count || 0} відвідувань`,
      access,
      isSubscription ? 'Необмежені відвідування' : 'Разовий прохід',
    ];

    return `
      <article class="manage-card ${status === 'active' ? 'featured' : ''}">
        <div class="manage-card__dark">
          <div class="manage-card__topline">
            <span class="manage-card__type">${planTypeLabels[plan.plan_type] || 'Тариф'} · ${escapeHtml(meta)}</span>
            <span class="status ${status}">${statusLabels[status] || status}</span>
          </div>
          <h3>${escapeHtml(plan.name)}</h3>
          <p class="manage-card__desc">${escapeHtml(plan.description || 'Опис відсутній')}</p>
          <div class="manage-card__price">
            <sup class="manage-card__currency">грн</sup>
            <strong>${escapeHtml(priceNum)}</strong>
            <span class="manage-card__period">${period}</span>
          </div>
          <div class="manage-card__cta">
            ${statusAction}
          </div>
        </div>
        <div class="manage-card__light">
          <ul class="manage-card__features">
            ${features.map(f => `<li>${checkSvg}<span>${escapeHtml(f)}</span></li>`).join('')}
          </ul>
          <div class="manage-card__footer">
            <button class="manage-card__action" data-plan-edit="${plan.id}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
              <span>Редагувати</span>
            </button>
            <button class="manage-card__action manage-card__action--danger" data-plan-delete="${plan.id}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              <span>Вилучити</span>
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');

  _deferUpdatePlansBtns();
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
    _deferUpdatePlansBtns();
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
  // Скидаємо компактний режим вікна підтвердження, щоб наступна форма
  // відкрилася зі стандартною шириною.
  modal.querySelector('.modal')?.classList.remove('modal--confirm');
}

/**
 * Показує компактне модальне вікно підтвердження у стилі системи —
 * заміна window.confirm, який ламає єдиний вигляд інтерфейсу.
 *
 * @param {object} options Параметри вікна.
 * @param {string} options.title Заголовок вікна.
 * @param {string} options.message Основний текст (дані попередньо екранувати).
 * @param {string} [options.note] Пояснювальний рядок під текстом.
 * @param {string} [options.confirmLabel] Напис на кнопці підтвердження.
 * @param {boolean} [options.isDanger] Червона кнопка для незворотних дій.
 * @param {string} [options.warningHtml] Додатковий блок-попередження над текстом.
 * @returns {Promise<boolean>} true, якщо користувач підтвердив дію.
 */
function openConfirmModal({
  title,
  message,
  note = 'Цю дію не можна скасувати.',
  confirmLabel = 'Видалити',
  isDanger = true,
  warningHtml = '',
}) {
  return new Promise((resolve) => {
    openModal(title, `
      ${warningHtml}
      <p style="margin:0;line-height:1.5">${message}${note ? `<br><span style="font-size:13px;opacity:.6">${note}</span>` : ''}</p>
      <div class="modal-actions">
        <button type="button" class="ghost-btn" id="confirm-cancel-btn">Скасувати</button>
        <button type="button" class="${isDanger ? 'danger-btn' : 'primary-btn'}" id="confirm-accept-btn">${confirmLabel}</button>
      </div>
    `);
    modal.querySelector('.modal')?.classList.add('modal--confirm');

    const finish = (isConfirmed) => {
      closeModal();
      resolve(isConfirmed);
    };
    document.querySelector('#confirm-accept-btn').addEventListener('click', () => finish(true));
    document.querySelector('#confirm-cancel-btn').addEventListener('click', () => finish(false));
  });
}

function renderClientForm(client = null) {
  const isEdit = Boolean(client);
  const iconPerson = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
  const iconPhone = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;
  const iconEmail = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/></svg>`;
  const iconLock = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;

  return `
    <form id="client-form" class="client-modal-form" data-client-id="${client?.id || ''}">

      <div class="cmf-section">
        <div class="cmf-section-label">Особисті дані</div>
        <div class="cmf-field">
          <span class="cmf-icon">${iconPerson}</span>
          <div class="cmf-input-wrap">
            <label class="cmf-label" for="cf-name">Ім'я</label>
            <input id="cf-name" name="name" type="text" class="cmf-input" required
              placeholder="Прізвище та ім'я"
              value="${escapeHtml(client?.name || '')}">
          </div>
        </div>
        <div class="cmf-field">
          <span class="cmf-icon">${iconPhone}</span>
          <div class="cmf-input-wrap">
            <label class="cmf-label" for="cf-phone">Телефон</label>
            <input id="cf-phone" name="phone" type="tel" class="cmf-input"
              inputmode="tel" autocomplete="tel" maxlength="13"
              placeholder="+380XXXXXXXXX" data-phone-input required
              value="${escapeHtml(client?.phone || '+380')}">
          </div>
        </div>
      </div>

      ${isEdit ? `
        <div class="cmf-section">
          <div class="cmf-section-label">Обліковий запис</div>
          <div class="cmf-field cmf-field--disabled">
            <span class="cmf-icon">${iconEmail}</span>
            <div class="cmf-input-wrap">
              <label class="cmf-label">Email</label>
              <input type="email" class="cmf-input" value="${escapeHtml(client.email)}" disabled>
            </div>
          </div>
        </div>
      ` : `
        <div class="cmf-section">
          <div class="cmf-section-label">Обліковий запис</div>
          <div class="cmf-field">
            <span class="cmf-icon">${iconEmail}</span>
            <div class="cmf-input-wrap">
              <label class="cmf-label" for="cf-email">Email</label>
              <input id="cf-email" name="email" type="email" class="cmf-input"
                required autocomplete="email" placeholder="email@example.com">
            </div>
          </div>
          <div class="cmf-field">
            <span class="cmf-icon">${iconLock}</span>
            <div class="cmf-input-wrap">
              <label class="cmf-label" for="cf-password">Тимчасовий пароль</label>
              <input id="cf-password" name="password" type="password" class="cmf-input"
                required autocomplete="new-password" placeholder="Мінімум 6 символів">
            </div>
          </div>
          <div class="cmf-field">
            <span class="cmf-icon">${iconLock}</span>
            <div class="cmf-input-wrap">
              <label class="cmf-label" for="cf-password2">Повторіть пароль</label>
              <input id="cf-password2" name="password2" type="password" class="cmf-input"
                required autocomplete="new-password" placeholder="Введіть пароль ще раз">
            </div>
          </div>
        </div>
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
  const client = clientId ? clients.find((c) => String(c.id) === String(clientId)) : null;

  // Якщо клієнт вже відомий — просто показуємо його, без дропдауну
  if (client) {
    const initials = getInitials(client.name);
    const avatarColor = getAvatarColor(client.name);
    return `
      <form id="visit-form" class="admin-form">
        <input type="hidden" name="client_id" value="${client.id}">
        <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--line);border-radius:10px;background:rgba(255,255,255,0.03)">
          <div class="client-avatar" style="background:${avatarColor};width:36px;height:36px;font-size:13px;flex-shrink:0">${escapeHtml(initials)}</div>
          <div>
            <div style="font-weight:700;font-size:15px">${escapeHtml(client.name)}</div>
            <div style="font-size:12px;color:var(--muted)">${escapeHtml(client.email)}</div>
          </div>
        </div>
        <p class="form-note">Візит можна підтвердити тільки для клієнта з активним абонементом.</p>
        <div class="modal-actions">
          <button type="button" class="ghost-btn modal-close">Скасувати</button>
          <button type="submit" class="primary-btn">Підтвердити візит</button>
        </div>
      </form>
    `;
  }

  // Без конкретного клієнта — показуємо дропдаун
  const options = clients.map((c) => `
    <option value="${c.id}">${escapeHtml(c.name)} · ${escapeHtml(c.email)}</option>
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

  const iconPerson = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
  const iconPhone = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;
  const iconEmail = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/></svg>`;
  const iconLock = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
  const iconSearch = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`;
  const iconSpec = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;

  const html = `
    <form id="trainer-form" class="client-modal-form" data-trainer-mode="create">

      <div class="cmf-section">
        <div class="cmf-section-label">Тип додавання</div>
        <div class="form-switch cmf-mode-switch">
          <label><input type="radio" name="mode" value="existing" checked> З існуючого клієнта</label>
          <label><input type="radio" name="mode" value="new"> Новий тренер</label>
        </div>
      </div>

      <div data-trainer-mode-panel="existing">
        <div class="cmf-section">
          <div class="cmf-section-label">Пошук клієнта</div>
          <div class="cmf-field cmf-field--search">
            <span class="cmf-icon">${iconSearch}</span>
            <div class="cmf-input-wrap" style="position:relative">
              <input type="hidden" name="client_id" id="tcf-client-id">
              <div id="tcf-search-row">
                <label class="cmf-label">Клієнт</label>
                <input id="tcf-search" type="search" class="cmf-input" placeholder="Ім'я або email" autocomplete="off">
              </div>
              <div id="tcf-results" class="tcf-results" hidden></div>
            </div>
          </div>
          <div id="tcf-selected" class="tcf-selected" hidden></div>
        </div>
      </div>

      <div data-trainer-mode-panel="new" hidden>
        <div class="cmf-section">
          <div class="cmf-section-label">Особисті дані</div>
          <div class="cmf-field">
            <span class="cmf-icon">${iconPerson}</span>
            <div class="cmf-input-wrap">
              <label class="cmf-label" for="tf-name">Ім'я</label>
              <input id="tf-name" name="name" type="text" class="cmf-input"
                placeholder="Прізвище та ім'я" autocomplete="name" required disabled>
            </div>
          </div>
          <div class="cmf-field">
            <span class="cmf-icon">${iconPhone}</span>
            <div class="cmf-input-wrap">
              <label class="cmf-label" for="tf-phone">Телефон</label>
              <input id="tf-phone" name="phone" type="tel" class="cmf-input"
                inputmode="tel" autocomplete="tel" maxlength="13"
                placeholder="+380XXXXXXXXX" data-phone-input value="+380" required disabled>
            </div>
          </div>
        </div>
        <div class="cmf-section">
          <div class="cmf-section-label">Обліковий запис</div>
          <div class="cmf-field">
            <span class="cmf-icon">${iconEmail}</span>
            <div class="cmf-input-wrap">
              <label class="cmf-label" for="tf-email">Email</label>
              <input id="tf-email" name="email" type="email" class="cmf-input"
                placeholder="email@example.com" autocomplete="email" required disabled>
            </div>
          </div>
          <div class="cmf-field">
            <span class="cmf-icon">${iconLock}</span>
            <div class="cmf-input-wrap">
              <label class="cmf-label" for="tf-password">Тимчасовий пароль</label>
              <input id="tf-password" name="password" type="password" class="cmf-input"
                placeholder="Мінімум 6 символів" autocomplete="new-password" required disabled>
            </div>
          </div>
          <div class="cmf-field">
            <span class="cmf-icon">${iconLock}</span>
            <div class="cmf-input-wrap">
              <label class="cmf-label" for="tf-password2">Повторіть пароль</label>
              <input id="tf-password2" name="password_confirm" type="password" class="cmf-input"
                placeholder="Введіть пароль ще раз" autocomplete="new-password" required disabled>
            </div>
          </div>
        </div>
      </div>

      <div class="cmf-section cmf-section--chips">
        <div class="cmf-section-label">Спеціалізація</div>
        ${renderSpecializationCheckboxes()}
      </div>

      <p class="form-error" id="modal-error" role="alert"></p>
      <div class="modal-actions">
        <button type="button" class="ghost-btn modal-close">Скасувати</button>
        <button type="submit" class="primary-btn">Зберегти тренера</button>
      </div>
    </form>
  `;
  return { html, clientOptions };
}

// Ініціалізація пошуку клієнтів у формі тренера (викликається після openModal)
function initTrainerClientSearch(clientOptions) {
  const searchInput = document.querySelector('#tcf-search');
  const resultsBox = document.querySelector('#tcf-results');
  const selectedBox = document.querySelector('#tcf-selected');
  const hiddenInput = document.querySelector('#tcf-client-id');
  if (!searchInput) return;

  const norm = (s) => String(s || '').toLowerCase().trim();

  function selectClient(client) {
    hiddenInput.value = client.id;
    const initials = getInitials(client.name);
    const color = getAvatarColor(client.name);
    selectedBox.innerHTML = `
      <div class="tcf-selected-card">
        <div class="client-avatar" style="background:${color};width:32px;height:32px;font-size:12px;flex-shrink:0">${escapeHtml(initials)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:14px">${escapeHtml(client.name)}</div>
          <div style="font-size:12px;color:var(--muted)">${escapeHtml(client.email)}</div>
        </div>
        <button type="button" class="tcf-clear-btn" title="Змінити">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="width:14px;height:14px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;
    selectedBox.hidden = false;
    document.querySelector('#tcf-search-row').hidden = true;
    resultsBox.hidden = true;

    selectedBox.querySelector('.tcf-clear-btn').addEventListener('click', () => {
      hiddenInput.value = '';
      selectedBox.hidden = true;
      document.querySelector('#tcf-search-row').hidden = false;
      searchInput.value = '';
      searchInput.focus();
    });
  }

  searchInput.addEventListener('input', () => {
    const q = norm(searchInput.value);
    if (!q) { resultsBox.hidden = true; return; }
    const matches = clientOptions.filter((c) =>
      norm(c.name).includes(q) || norm(c.email).includes(q) || norm(c.phone).includes(q)
    ).slice(0, 8);

    if (!matches.length) {
      resultsBox.innerHTML = '<div class="tcf-no-results">Нічого не знайдено</div>';
    } else {
      resultsBox.innerHTML = matches.map((c) => {
        const initials = getInitials(c.name);
        const color = getAvatarColor(c.name);
        return `
          <button type="button" class="tcf-result-item" data-id="${c.id}">
            <div class="client-avatar" style="background:${color};width:28px;height:28px;font-size:11px;flex-shrink:0">${escapeHtml(initials)}</div>
            <div style="min-width:0">
              <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(c.name)}</div>
              <div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(c.email)}</div>
            </div>
          </button>`;
      }).join('');
      resultsBox.querySelectorAll('.tcf-result-item').forEach((btn) => {
        btn.addEventListener('click', () => {
          const client = clientOptions.find((c) => String(c.id) === btn.dataset.id);
          if (client) selectClient(client);
        });
      });
    }
    resultsBox.hidden = false;
  });
}

function renderTrainerEditForm(trainer) {
  const iconPerson = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
  const iconPhone = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;
  const iconEmail = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/></svg>`;

  return `
    <form id="trainer-form" class="client-modal-form" data-trainer-mode="edit" data-trainer-id="${trainer.id}">

      <div class="cmf-section">
        <div class="cmf-section-label">Особисті дані</div>
        <div class="cmf-field">
          <span class="cmf-icon">${iconPerson}</span>
          <div class="cmf-input-wrap">
            <label class="cmf-label" for="tf-name">Ім'я</label>
            <input id="tf-name" name="name" type="text" class="cmf-input"
              required value="${escapeHtml(trainer.name || '')}">
          </div>
        </div>
        <div class="cmf-field">
          <span class="cmf-icon">${iconPhone}</span>
          <div class="cmf-input-wrap">
            <label class="cmf-label" for="tf-phone">Телефон</label>
            <input id="tf-phone" name="phone" type="tel" class="cmf-input"
              inputmode="tel" autocomplete="tel" maxlength="13"
              placeholder="+380XXXXXXXXX" data-phone-input required
              value="${escapeHtml(trainer.phone || '+380')}">
          </div>
        </div>
        <div class="cmf-field cmf-field--disabled">
          <span class="cmf-icon">${iconEmail}</span>
          <div class="cmf-input-wrap">
            <label class="cmf-label">Email</label>
            <input type="email" class="cmf-input" value="${escapeHtml(trainer.email)}" disabled>
          </div>
        </div>
      </div>

      <div class="cmf-section cmf-section--chips">
        <div class="cmf-section-label">Спеціалізація</div>
        ${renderSpecializationCheckboxes(trainer.specialization || '')}
      </div>

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
  const iconDumbbell = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 5v14M18 5v14"/><path d="M2 9v6M22 9v6"/><path d="M6 12h12"/></svg>`;
  const iconPerson = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
  const iconCalendar = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;
  const iconClock = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`;

  const serviceOptions = scheduleServices.map((service) => `
    <option value="${service.id}" ${String(service.id) === String(schedule?.workout_id) ? 'selected' : ''}>
      ${escapeHtml(service.name)}
    </option>
  `).join('');
  const trainerOptions = renderScheduleTrainerOptions(schedule?.workout_id || '', schedule?.trainer_id || '');

  return `
    <form id="schedule-form" class="client-modal-form" data-schedule-id="${schedule?.id || ''}">

      <div class="cmf-section">
        <div class="cmf-section-label">Заняття</div>
        <div class="cmf-field">
          <span class="cmf-icon">${iconDumbbell}</span>
          <div class="cmf-input-wrap">
            <label class="cmf-label" for="sf-workout">Послуга / вид тренування</label>
            <select id="sf-workout" name="workout_id" class="cmf-input" required>
              <option value="">Оберіть послугу</option>
              ${serviceOptions}
            </select>
          </div>
        </div>
        <div class="cmf-field">
          <span class="cmf-icon">${iconPerson}</span>
          <div class="cmf-input-wrap">
            <label class="cmf-label" for="sf-trainer">Тренер</label>
            <select id="sf-trainer" name="trainer_id" class="cmf-input">
              ${trainerOptions}
            </select>
          </div>
        </div>
      </div>

      <div class="cmf-section">
        <div class="cmf-section-label">Час і дата</div>
        <div class="cmf-field">
          <span class="cmf-icon">${iconCalendar}</span>
          <div class="cmf-input-wrap">
            <label class="cmf-label" for="sf-date">Дата</label>
            <input id="sf-date" name="date" type="date" class="cmf-input" required
              ${isEdit ? '' : `min="${todayIso()}"`}
              value="${formatDate(schedule?.date) || todayIso()}">
          </div>
        </div>
        <div class="cmf-field">
          <span class="cmf-icon">${iconClock}</span>
          <div class="cmf-input-wrap">
            <label class="cmf-label" for="sf-time">Час початку</label>
            <input id="sf-time" name="time" type="time" class="cmf-input" required
              value="${formatTime(schedule?.time || '10:00')}">
          </div>
        </div>
      </div>

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
      <label>Тривалість заняття, хв
        <input name="duration_minutes" type="number" min="5" max="480" required value="${escapeHtml(service?.duration_minutes || 60)}">
      </label>
      <div class="image-upload-field">
        <div class="img-drop-zone" id="img-drop-zone">
          ${service?.image_url
            ? `<img id="svc-img-preview" src="${escapeHtml(service.image_url)}" alt="Фото послуги">`
            : `<div id="svc-img-preview" class="img-placeholder">
                 <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                 <span>Перетягніть фото або натисніть</span>
               </div>`}
        </div>
        <input type="file" id="img-file-input" name="image_file" accept="image/jpeg,image/png,image/webp,image/gif" style="display:none">
        <input name="image_url" type="hidden" value="${escapeHtml(service?.image_url || '')}">
        <p class="img-upload-status"></p>
      </div>
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
      <p class="form-note">Після підтвердження система створить абонемент і оплату зі статусом "оплачено".</p>
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

    sheetTitle.textContent = client.name;
    sheetBody.innerHTML = `
      <dl>
        <div><dt>Телефон</dt><dd>${escapeHtml(client.phone || '—')}</dd></div>
        <div><dt>Email</dt><dd>${escapeHtml(client.email)}</dd></div>
        <div><dt>Абонемент</dt><dd>${escapeHtml(client.subscription_type || 'Немає')}</dd></div>
        <div><dt>Статус</dt><dd>${statusLabels[status] || status}</dd></div>
        <div><dt>Діє до</dt><dd>${formatDate(client.subscription_end_date) || '—'}</dd></div>
      </dl>
      <button class="ghost-btn" style="width:100%;margin-top:8px" data-open-client-history="${clientId}">Історія</button>
    `;
    sheet.classList.add('active');

    sheetBody.querySelector('[data-open-client-history]')?.addEventListener('click', () => {
      openClientHistory(clientId, visits);
    });
  } catch (error) {
    setFeedback(`Не вдалося відкрити деталі: ${error.message}`, 'error');
  }
}

function buildVisitItems(visits) {
  return visits.length
    ? visits.map((v) => `<li>${formatDate(v.visit_time)} · ${escapeHtml(v.workout_name || 'Відвідування залу')}</li>`).join('')
    : '<li style="color:var(--muted)">Відвідувань ще немає</li>';
}

function buildSubItems(subs) {
  const subStatusLabels = { active: 'Активний', expired: 'Завершений', cancelled: 'Скасований', inactive: 'Неактивний' };
  return subs.length
    ? subs.map((s) => `
        <li style="display:flex;flex-direction:column;gap:2px;padding:8px 0;border-bottom:1px solid var(--line)">
          <span style="font-weight:600">${escapeHtml(s.plan_name || 'Абонемент')}</span>
          <span style="font-size:12px;color:var(--muted)">${formatDate(s.start_date)} — ${s.end_date ? formatDate(s.end_date) : '∞'}</span>
          <span style="font-size:11px;color:${s.status === 'active' ? 'var(--accent)' : 'var(--muted)'}">${subStatusLabels[s.status] || s.status}</span>
        </li>`).join('')
    : '<li style="color:var(--muted)">Абонементів ще немає</li>';
}

async function openClientHistory(clientId, visits) {
  const overlay = document.createElement('div');
  overlay.className = 'custom-confirm-overlay';
  overlay.style.cssText = 'align-items:flex-end;z-index:9999';
  overlay.innerHTML = `
    <div class="custom-confirm-box" style="width:100%;max-width:520px;border-radius:20px 20px 0 0;max-height:78vh;overflow:hidden;display:flex;flex-direction:column">
      <h3 style="margin:0 0 10px;font-size:17px">Історія</h3>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="chip active" id="hist-tab-visits">Відвідування</button>
        <button class="chip" id="hist-tab-subs">Абонементи</button>
      </div>
      <div style="overflow-y:auto;flex:1">
        <ul id="hist-panel-visits" style="list-style:none;padding:0;margin:0">${buildVisitItems(visits)}</ul>
        <ul id="hist-panel-subs" style="list-style:none;padding:0;margin:0;display:none"><li style="color:var(--muted);padding:8px 0">Завантаження…</li></ul>
      </div>
      <button class="primary-btn" style="margin-top:14px;width:100%;flex-shrink:0" id="hist-close">Закрити</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const tabVisits = overlay.querySelector('#hist-tab-visits');
  const tabSubs = overlay.querySelector('#hist-tab-subs');
  const panelVisits = overlay.querySelector('#hist-panel-visits');
  const panelSubs = overlay.querySelector('#hist-panel-subs');

  let subsLoaded = false;

  tabVisits.addEventListener('click', () => {
    tabVisits.classList.add('active'); tabSubs.classList.remove('active');
    panelVisits.style.display = ''; panelSubs.style.display = 'none';
  });

  tabSubs.addEventListener('click', async () => {
    tabSubs.classList.add('active'); tabVisits.classList.remove('active');
    panelSubs.style.display = ''; panelVisits.style.display = 'none';
    if (!subsLoaded) {
      subsLoaded = true;
      try {
        const subs = await apiFetch(`/subscriptions/client/${clientId}`);
        panelSubs.innerHTML = buildSubItems(subs);
      } catch {
        panelSubs.innerHTML = '<li style="color:var(--muted)">Не вдалося завантажити</li>';
      }
    }
  });

  const close = () => overlay.remove();
  overlay.querySelector('#hist-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
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
    const password = formData.get('password');
    const password2 = formData.get('password2');
    if (password !== password2) {
      setModalError('Паролі не збігаються');
      return;
    }
    if (password.length < 6) {
      setModalError('Пароль має бути не менше 6 символів');
      return;
    }
    payload.email = formData.get('email')?.trim();
    payload.password = password;
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

    const password = formData.get('password');
    const passwordConfirm = formData.get('password_confirm');
    if (password.length < 6) {
      setModalError('Пароль має бути не менше 6 символів');
      return;
    }
    if (password !== passwordConfirm) {
      setModalError('Паролі не співпадають');
      return;
    }

    await apiFetch('/trainers', {
      method: 'POST',
      body: JSON.stringify({
        name: formData.get('name')?.trim(),
        email: formData.get('email')?.trim(),
        password,
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

  // Дзеркало серверного правила для миттєвого фідбеку: нове заняття не може
  // починатися в минулому. Остаточну перевірку робить сервер у зоні клубу.
  if (!scheduleId) {
    const slot = new Date(`${payload.date}T${payload.time}`);
    if (!Number.isNaN(slot.getTime()) && slot.getTime() < Date.now()) {
      setModalError('Не можна створити заняття на час, що вже минув');
      return;
    }
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
  const name = escapeHtml(`${schedule?.workout_name || 'заняття'} · ${formatDate(schedule?.date)} · ${formatTime(schedule?.time)}`);

  const isConfirmed = await openConfirmModal({
    title: 'Видалити заняття',
    message: `Видалити <strong>${name}</strong>?`,
    note: 'Усі записи клієнтів на це заняття також буде скасовано.',
  });
  if (!isConfirmed) {
    return;
  }

  try {
    await apiFetch(`/schedules/${scheduleId}`, { method: 'DELETE' });
    await loadSchedules();
    setScheduleFeedback('Заняття видалено', 'success');
  } catch (error) {
    setScheduleFeedback(`Не вдалося видалити заняття: ${error.message}`, 'error');
  }
}

function bindImageUpload() {
  const dropZone = document.querySelector('#img-drop-zone');
  const fileInput = document.querySelector('#img-file-input');
  if (!dropZone || !fileInput) return;

  // Click on drop zone → open file picker
  dropZone.addEventListener('click', () => fileInput.click());

  // Drag-and-drop events
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) uploadImage(file);
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) uploadImage(file);
  });

  async function uploadImage(file) {
    const urlInput = document.querySelector('#admin-modal input[name="image_url"]');
    const status = document.querySelector('.img-upload-status');

    if (status) {
      status.textContent = 'Завантаження…';
      status.style.color = '';
    }
    dropZone.classList.add('uploading');

    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const response = await apiFetch('/upload/image', {
        method: 'POST',
        body: JSON.stringify({ data: dataUrl, filename: file.name }),
      });

      if (urlInput) urlInput.value = response.url;

      // Update preview
      const existing = document.querySelector('#svc-img-preview');
      if (existing?.tagName === 'IMG') {
        existing.src = response.url;
      } else {
        const img = document.createElement('img');
        img.id = 'svc-img-preview';
        img.src = response.url;
        img.alt = 'Фото послуги';
        existing?.replaceWith(img);
      }

      if (status) {
        status.textContent = 'Фото завантажено ✓';
        status.style.color = '#4caf50';
      }
    } catch (err) {
      if (status) {
        status.textContent = `Помилка: ${err.message}`;
        status.style.color = '#e05555';
      }
    } finally {
      dropZone.classList.remove('uploading');
    }
  }
}

async function saveService(form) {
  const formData = new FormData(form);
  const serviceId = form.dataset.serviceId;
  const payload = {
    name: formData.get('name')?.trim(),
    description: formData.get('description')?.trim(),
    max_clients: Number(formData.get('max_clients')),
    duration_minutes: Number(formData.get('duration_minutes')) || 60,
    status: formData.get('status'),
    image_url: formData.get('image_url')?.trim() || null,
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

/**
 * Видаляє послугу (тип тренування) після підтвердження.
 *
 * @param {string|number} serviceId
 */
async function deleteService(serviceId) {
  const service = services.find((item) => String(item.id) === String(serviceId));
  const isConfirmed = await openConfirmModal({
    title: 'Видалити послугу',
    message: `Видалити послугу «<strong>${escapeHtml(service?.name || '')}</strong>»?`,
  });
  if (!isConfirmed) {
    return;
  }

  try {
    await apiFetch(`/workouts/${serviceId}`, { method: 'DELETE' });
    await loadServices();
    setServicesFeedback('Послугу видалено', 'success');
  } catch (error) {
    setServicesFeedback(`Не вдалося видалити: ${error.message}`, 'error');
  }
}

/**
 * Видаляє тариф абонемента після підтвердження.
 *
 * @param {string|number} planId
 */
async function deletePlan(planId) {
  const plan = plans.find((item) => String(item.id) === String(planId));
  const isConfirmed = await openConfirmModal({
    title: 'Видалити тариф',
    message: `Видалити тариф «<strong>${escapeHtml(plan?.name || '')}</strong>»?`,
  });
  if (!isConfirmed) {
    return;
  }

  try {
    await apiFetch(`/subscriptions/plans/${planId}`, { method: 'DELETE' });
    await loadPlans();
    setPlansFeedback('Тариф видалено', 'success');
  } catch (error) {
    setPlansFeedback(`Не вдалося видалити: ${error.message}`, 'error');
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
  const isConfirmed = await openConfirmModal({
    title: 'Завершити абонемент',
    message: 'Завершити цей абонемент?',
    note: 'Він стане неактивним для клієнта.',
    confirmLabel: 'Завершити',
    isDanger: false,
  });
  if (!isConfirmed) {
    return;
  }

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
  const name = escapeHtml(trainer?.name || 'тренера');

  const isConfirmed = await openConfirmModal({
    title: 'Забрати права тренера',
    message: `Забрати права тренера у <strong>${name}</strong>?`,
    note: 'Після цього він стане звичайним клієнтом.',
    confirmLabel: 'Забрати права',
  });
  if (!isConfirmed) {
    return;
  }

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
  const name = escapeHtml(client?.name || '');
  const hasActive = client?.status === 'active';

  const warningBlock = hasActive ? `
    <div style="display:flex;gap:10px;align-items:flex-start;background:rgba(251,146,60,0.1);border:1px solid rgba(251,146,60,0.35);border-radius:8px;padding:12px 14px;margin-bottom:16px">
      <svg viewBox="0 0 24 24" fill="none" stroke="#fb923c" stroke-width="2" stroke-linecap="round" style="width:18px;height:18px;flex-shrink:0;margin-top:1px"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      <div style="font-size:13px;line-height:1.5;color:#fb923c">
        <strong>У клієнта є діючий абонемент.</strong><br>
        Разом із клієнтом буде видалено абонемент, платежі та всю історію відвідувань.
      </div>
    </div>` : '';

  const isConfirmed = await openConfirmModal({
    title: 'Видалити клієнта',
    message: `Видалити клієнта <strong>${name}</strong>?`,
    warningHtml: warningBlock,
  });
  if (!isConfirmed) {
    return;
  }

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

  // Feedback-рядки стосуються екрана, де відбулася дія: при переході
  // на інший екран застарілі повідомлення прибираємо.
  document.querySelectorAll('.admin-feedback').forEach((element) => {
    element.textContent = '';
    delete element.dataset.type;
  });
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

/**
 * Діалог підтвердження виходу з кабінету.
 * @returns {Promise<boolean>}
 */
function showLogoutConfirm() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'custom-confirm-overlay';
    overlay.innerHTML = `
      <div class="custom-confirm-box">
        <p class="custom-confirm-msg">Вийти з кабінету?</p>
        <div class="custom-confirm-actions">
          <button class="ghost-btn custom-confirm-cancel">Скасувати</button>
          <button class="primary-btn custom-confirm-ok">Вийти</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const cleanup = (result) => { overlay.remove(); resolve(result); };
    overlay.querySelector('.custom-confirm-ok').addEventListener('click', () => cleanup(true));
    overlay.querySelector('.custom-confirm-cancel').addEventListener('click', () => cleanup(false));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
  });
}

document.querySelectorAll('.logout, .logout-row').forEach((button) => {
  button.addEventListener('click', () => {
    showLogoutConfirm().then((confirmed) => {
      if (!confirmed) return;
      clearAuth();
      window.location.href = PAGE.HOME;
    });
  });
});

document.querySelectorAll('.chip, .cseg-btn').forEach((button) => {
  button.addEventListener('click', () => {
    const row = button.closest('.chip-row, .clients-seg');
    row.querySelectorAll('.chip, .cseg-btn').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');

    if (button.dataset.clientFilter) {
      clientsFilter = button.dataset.clientFilter;
      renderClients();
    }

    if (button.dataset.trainerFilter) {
      trainersFilter = button.dataset.trainerFilter;
      renderTrainers();
    }

    if (button.dataset.serviceFilter) {
      servicesFilter = button.dataset.serviceFilter;
      _adminSvcOffset = 0;
      renderServices();
    }

    if (button.dataset.planFilter) {
      plansFilter = button.dataset.planFilter;
      if (_plansGrid) _plansGrid.scrollLeft = 0;
      renderPlans();
    }

    if (button.dataset.messageFilter) {
      messagesFilter = button.dataset.messageFilter;
      const broadcastPanel  = document.getElementById('messages-broadcast-panel');
      const chatPanel       = document.getElementById('messages-chat-panel');
      const createBtn       = document.getElementById('open-message-modal');
      const searchInput     = document.getElementById('messages-search');
      const feedbackEl      = document.getElementById('messages-feedback');

      if (messagesFilter === 'chat') {
        // Ховаємо все зайве
        if (broadcastPanel) broadcastPanel.style.display = 'none';
        if (createBtn)      createBtn.style.display = 'none';
        if (searchInput)    searchInput.closest('.admin-toolbar').style.display = 'none';
        if (feedbackEl)     feedbackEl.style.display = 'none';
        // Показуємо чат на повну висоту
        if (chatPanel) { chatPanel.style.display = 'flex'; chatPanel.removeAttribute('hidden'); }
        startChatListPolling();
      } else {
        // Відновлюємо видимість
        if (broadcastPanel) broadcastPanel.style.display = '';
        if (createBtn)      createBtn.style.display = '';
        if (searchInput)    searchInput.closest('.admin-toolbar').style.display = '';
        if (feedbackEl)     feedbackEl.style.display = '';
        if (chatPanel) { chatPanel.style.display = 'none'; chatPanel.setAttribute('hidden', ''); }
        stopChatPolling();
        renderMessages();
      }
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
      const { html, clientOptions } = await renderTrainerCreateForm();
      openModal('Додати тренера', html);
      initTrainerClientSearch(clientOptions);
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

  const addScheduleButton = event.target.closest('#open-schedule-modal, #open-schedule-modal-empty');
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
    bindImageUpload();
    return;
  }

  const addMessageButton = event.target.closest('#open-message-modal');
  if (addMessageButton) {
    openModal('Створити повідомлення', renderMessageForm());
    bindRecipientPicker();
    return;
  }

  const messageViewButton = event.target.closest('[data-message-view]');
  if (messageViewButton) {
    openMessageDetails(messageViewButton.dataset.messageView);
    return;
  }

  const messageEditButton = event.target.closest('[data-message-edit]');
  if (messageEditButton) {
    const message = messages.find((item) => String(item.id) === messageEditButton.dataset.messageEdit);
    if (message) {
      openModal('Редагувати повідомлення', renderMessageForm(message));
      bindRecipientPicker(message);
    }
    return;
  }

  const messageDeleteButton = event.target.closest('[data-message-delete]');
  if (messageDeleteButton) {
    deleteMessage(messageDeleteButton.dataset.messageDelete);
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

  // Вибір дня у стрічці дат: перемикаємо активний день і перемальовуємо список.
  const scheduleDateButton = event.target.closest('[data-schedule-date]');
  if (scheduleDateButton) {
    selectedScheduleDate = scheduleDateButton.dataset.scheduleDate;
    renderSchedules();
    return;
  }

  const scheduleViewButton = event.target.closest('[data-schedule-view]');
  if (scheduleViewButton) {
    openScheduleDetails(scheduleViewButton.dataset.scheduleView);
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
      bindImageUpload();
    }
    return;
  }

  const serviceStatusButton = event.target.closest('[data-service-status]');
  if (serviceStatusButton) {
    updateServiceStatus(serviceStatusButton.dataset.serviceStatus, serviceStatusButton.dataset.nextStatus);
    return;
  }

  const serviceDeleteButton = event.target.closest('[data-service-delete]');
  if (serviceDeleteButton) {
    deleteService(serviceDeleteButton.dataset.serviceDelete);
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

  const planDeleteButton = event.target.closest('[data-plan-delete]');
  if (planDeleteButton) {
    deletePlan(planDeleteButton.dataset.planDelete);
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
  // Оновлюємо клас .checked на чіпі при зміні чекбокса
  const specCheckbox = event.target.closest('.spec-chip input[type="checkbox"]');
  if (specCheckbox) {
    specCheckbox.closest('.spec-chip').classList.toggle('checked', specCheckbox.checked);
  }

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
  const adminProfileForm = event.target.closest('#admin-profile-form');
  if (adminProfileForm) {
    event.preventDefault();
    saveAdminProfile(adminProfileForm);
    return;
  }

  const clubFormSubmit = event.target.closest('#club-form');
  if (clubFormSubmit) {
    event.preventDefault();
    saveClubSettings(clubFormSubmit);
    return;
  }

  const messageForm = event.target.closest('#message-form');
  if (messageForm) {
    event.preventDefault();
    saveMessage(messageForm);
    return;
  }

  const passwordForm = event.target.closest('#password-form');
  if (passwordForm) {
    event.preventDefault();
    changeAdminPassword(passwordForm);
    return;
  }

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

modal?.addEventListener('click', (event) => {
  if (event.target === modal) {
    closeModal();
  }
});

clientsSearch?.addEventListener('input', renderClients);
trainersSearch?.addEventListener('input', renderTrainers);
scheduleSearch?.addEventListener('input', renderSchedules);

// ── Inline calendar range picker ──────────────────────────────────────────
const schedRangePopup = document.querySelector('#sched-range-popup');
const schedRangeToggle = document.querySelector('#sched-range-toggle');
const schedRangeLabel = document.querySelector('#sched-range-label');

const MONTHS_UK = ['Січень','Лютий','Березень','Квітень','Травень','Червень',
                   'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
const MONTHS_SHORT = ['січ','лют','бер','кві','тра','чер','лип','сер','вер','жов','лис','гру'];
const WDAYS = ['Пн','Вт','Ср','Чт','Пт','Сб','Нд'];

let schedCalYear = new Date().getFullYear();
let schedCalMonth = new Date().getMonth();
let schedCalStart = '';
let schedCalEnd = '';
let schedCalHover = '';

function fmtCalDate(d) {
  if (!d) return '';
  const [, m, day] = d.split('-');
  return `${Number(day)} ${MONTHS_SHORT[Number(m) - 1]}`;
}

function updateSchedRangeLabel() {
  if (!schedRangeLabel) return;
  if (scheduleRangeStart && scheduleRangeEnd) {
    schedRangeLabel.innerHTML = `${fmtCalDate(scheduleRangeStart)} – ${fmtCalDate(scheduleRangeEnd)}<span class="sched-range-clear" title="Скинути">&#x2715;</span>`;
    schedRangeToggle?.classList.add('active');
  } else {
    schedRangeLabel.innerHTML = '';
    schedRangeToggle?.classList.remove('active');
  }
}

function buildCalHtml() {
  const today = todayIso();
  const firstDay = new Date(schedCalYear, schedCalMonth, 1);
  const lastDate = new Date(schedCalYear, schedCalMonth + 1, 0).getDate();
  let startDow = firstDay.getDay() - 1;
  if (startDow < 0) startDow = 6;

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push('');
  for (let d = 1; d <= lastDate; d++) {
    cells.push(`${schedCalYear}-${String(schedCalMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  while (cells.length % 7 !== 0) cells.push('');

  const ref = schedCalEnd || schedCalHover;
  const lo = schedCalStart && ref ? [schedCalStart, ref].sort()[0] : schedCalStart;
  const hi = schedCalStart && ref ? [schedCalStart, ref].sort()[1] : '';

  const hint = !schedCalStart ? 'Оберіть початок діапазону'
    : !schedCalEnd ? 'Тепер оберіть кінець'
    : `${fmtCalDate(schedCalStart)} – ${fmtCalDate(schedCalEnd)}`;

  const applyBtn = (schedCalStart && schedCalEnd)
    ? `<button type="button" class="sched-cal-apply" data-cal-apply>Застосувати</button>`
    : '';

  return `
    <div class="sched-cal-header">
      <button type="button" class="sched-cal-nav" data-cal-prev>&#8249;</button>
      <span>${MONTHS_UK[schedCalMonth]} ${schedCalYear}</span>
      <button type="button" class="sched-cal-nav" data-cal-next>&#8250;</button>
    </div>
    <div class="sched-cal-grid">
      ${WDAYS.map((w) => `<div class="sched-cal-wday">${w}</div>`).join('')}
      ${cells.map((dateStr) => {
        if (!dateStr) return '<div class="sched-cal-cell empty"></div>';
        const day = Number(dateStr.split('-')[2]);
        let cls = 'sched-cal-cell';
        if (dateStr === today) cls += ' today';
        if (lo && dateStr === lo) cls += ' range-lo';
        if (hi && dateStr === hi) cls += ' range-hi';
        if (lo && hi && dateStr > lo && dateStr < hi) cls += ' in-range';
        return `<button type="button" class="${cls}" data-cal-date="${dateStr}">${day}</button>`;
      }).join('')}
    </div>
    <div class="sched-cal-hint">${hint}</div>
    ${applyBtn}
  `;
}

function renderSchedCalendar() {
  const container = document.querySelector('#sched-cal-container');
  if (!container) return;

  // Рендеримо один раз
  container.innerHTML = `<div class="sched-cal" id="sched-cal">${buildCalHtml()}</div>`;
  const cal = container.querySelector('#sched-cal');

  // Клік — event delegation (не перемальовує при hover)
  cal.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cal-date]');
    const prev = e.target.closest('[data-cal-prev]');
    const next = e.target.closest('[data-cal-next]');

    if (prev) {
      schedCalMonth--;
      if (schedCalMonth < 0) { schedCalMonth = 11; schedCalYear--; }
      renderSchedCalendar(); return;
    }
    if (next) {
      schedCalMonth++;
      if (schedCalMonth > 11) { schedCalMonth = 0; schedCalYear++; }
      renderSchedCalendar(); return;
    }

    // "Застосувати" — перевіряємо ДО if (!btn), бо apply не має data-cal-date
    const apply = e.target.closest('[data-cal-apply]');
    if (apply) {
      scheduleRangeStart = schedCalStart;
      scheduleRangeEnd = schedCalEnd;
      updateSchedRangeLabel();
      if (schedRangePopup) schedRangePopup.hidden = true;
      schedRangeToggle?.setAttribute('aria-expanded', 'false');
      schedCalStart = ''; schedCalEnd = ''; schedCalHover = '';
      if (!getScheduleDates().includes(selectedScheduleDate)) selectedScheduleDate = pickDefaultScheduleDate();
      renderSchedules();
      scrollScheduleStripToActive();
      return;
    }

    if (!btn) return;
    const d = btn.dataset.calDate;
    if (!schedCalStart || (schedCalStart && schedCalEnd)) {
      schedCalStart = d; schedCalEnd = ''; schedCalHover = '';
    } else {
      if (d === schedCalStart) return;
      schedCalEnd = d; schedCalHover = '';
      if (schedCalEnd < schedCalStart) [schedCalStart, schedCalEnd] = [schedCalEnd, schedCalStart];
    }
    renderSchedCalendar();
  });

  // Hover — теж delegation, перемальовуємо ТІЛЬКИ якщо дата змінилась
  const grid = cal.querySelector('.sched-cal-grid');
  grid.addEventListener('mousemove', (e) => {
    if (!schedCalStart || schedCalEnd) return;
    const cell = e.target.closest('[data-cal-date]');
    const d = cell?.dataset.calDate || '';
    if (d !== schedCalHover) {
      schedCalHover = d;
      // Оновлюємо тільки класи, без повного перемальовування
      const ref = schedCalEnd || schedCalHover;
      const lo = [schedCalStart, ref].sort()[0];
      const hi = [schedCalStart, ref].sort()[1];
      grid.querySelectorAll('[data-cal-date]').forEach((b) => {
        const bd = b.dataset.calDate;
        b.classList.toggle('range-lo', bd === lo);
        b.classList.toggle('range-hi', bd === hi && lo !== hi);
        b.classList.toggle('in-range', lo && hi && bd > lo && bd < hi);
      });
    }
  });
  grid.addEventListener('mouseleave', () => {
    if (!schedCalStart || schedCalEnd) return;
    schedCalHover = '';
    grid.querySelectorAll('[data-cal-date]').forEach((b) => {
      b.classList.remove('range-hi', 'in-range');
    });
  });
}

function positionSchedPopup() {
  if (!schedRangePopup || !schedRangeToggle) return;
  const rect = schedRangeToggle.getBoundingClientRect();
  const popupWidth = 264;
  let left = rect.right - popupWidth;
  if (left < 8) left = 8;
  schedRangePopup.style.top = `${rect.bottom + 8}px`;
  schedRangePopup.style.left = `${left}px`;
}

schedRangeToggle?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (e.target.closest('.sched-range-clear')) {
    resetSchedRange();
    return;
  }
  const wasHidden = schedRangePopup?.hidden;
  if (schedRangePopup) schedRangePopup.hidden = !wasHidden;
  schedRangeToggle.setAttribute('aria-expanded', String(wasHidden));
  if (wasHidden) {
    // Ініціалізуємо стан календаря з поточного застосованого діапазону
    schedCalStart = scheduleRangeStart || '';
    schedCalEnd = scheduleRangeEnd || '';
    schedCalHover = '';
    positionSchedPopup();
    renderSchedCalendar();
  }
});

// Закрити при кліку будь-де — popup зупиняє розповсюдження кліку
document.addEventListener('click', () => {
  if (schedRangePopup && !schedRangePopup.hidden) {
    schedRangePopup.hidden = true;
    schedRangeToggle?.setAttribute('aria-expanded', 'false');
    // Скидаємо незастосований вибір
    schedCalStart = ''; schedCalEnd = ''; schedCalHover = '';
  }
});
schedRangePopup?.addEventListener('click', (e) => e.stopPropagation());

function resetSchedRange() {
  scheduleRangeStart = '';
  scheduleRangeEnd = '';
  schedCalStart = '';
  schedCalEnd = '';
  schedCalHover = '';
  updateSchedRangeLabel();
  if (schedRangePopup) schedRangePopup.hidden = true;
  schedRangeToggle?.setAttribute('aria-expanded', 'false');
  selectedScheduleDate = pickDefaultScheduleDate();
  renderSchedules();
  scrollScheduleStripToActive();
}
servicesSearch?.addEventListener('input', () => { _adminSvcOffset = 0; renderServices(); });
plansSearch?.addEventListener('input', () => {
  if (_plansGrid) _plansGrid.scrollLeft = 0;
  renderPlans();
});
messagesSearch?.addEventListener('input', renderMessages);

/**
 * CountUp-анімація числа від 0 до target за 800 мс.
 *
 * @param {HTMLElement} el
 * @param {number} target
 */
function animateCountUp(el, target) {
  if (!el || !target) { if (el) el.textContent = String(target); return; }
  const duration = 800;
  const start = performance.now();
  const step = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(eased * target);
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * Встановлює значення метрики з CountUp-анімацією.
 *
 * @param {string} selector — CSS-селектор елемента метрики.
 * @param {number} value
 */
function setMetric(selector, value) {
  const element = document.querySelector(selector);
  if (element) {
    animateCountUp(element, value);
  }
}

/**
 * Встановлює тренд-індикатор метрики.
 *
 * @param {string} id
 * @param {number} diff — різниця (позитивна = вгору, від'ємна = вниз, 0 = нейтрально).
 * @param {string} [unit='']
 */
function setTrend(id, diff, unit = '') {
  const el = document.querySelector(`#${id}`);
  if (!el) return;
  if (diff === 0) { el.textContent = ''; return; }
  const sign = diff > 0 ? '↑' : '↓';
  el.textContent = `${sign} ${Math.abs(diff)}${unit}`;
  el.className = `metric-trend ${diff > 0 ? 'up' : 'down'}`;
}

/**
 * Повертає дату, зсунуту на задану кількість днів, у форматі 'YYYY-MM-DD'.
 *
 * @param {string} baseIso — базова дата 'YYYY-MM-DD'.
 * @param {number} days
 * @returns {string}
 */
function addDaysIso(baseIso, days) {
  const date = new Date(baseIso);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Малює дашборд: метрики, сьогоднішній розклад і блок «Потребує уваги»
 * на основі реальних даних клубу.
 *
 * @param {{clients: object[], trainers: object[], services: object[],
 *          schedules: object[], subscriptions: object[]}} data
 */
function renderDashboard(data) {
  const today = todayIso();
  const yesterday = addDaysIso(today, -1);
  const weekAhead = addDaysIso(today, ENDING_SOON_DAYS);

  const activeClients = data.clients.filter((client) => client.status === 'active').length;
  const totalClients = data.clients.length;
  const activeServices = data.services.filter((service) => (service.status || 'active') === 'active').length;
  const totalServices = data.services.length;
  const todaySchedules = data.schedules
    .filter((schedule) => formatDate(schedule.date) === today)
    .sort((first, second) => formatTime(first.time).localeCompare(formatTime(second.time)));
  const yesterdayCount = data.schedules.filter((s) => formatDate(s.date) === yesterday).length;

  // Метрики з CountUp
  setMetric('#metric-clients', activeClients);
  setMetric('#metric-trainers', data.trainers.length);
  setMetric('#metric-today', todaySchedules.length);
  setMetric('#metric-services', activeServices);

  // Тренди
  const inactiveClients = totalClients - activeClients;
  setTrend('trend-clients', activeClients > 0 ? Math.round((activeClients / totalClients) * 100) - 80 : 0, '%');
  setTrend('trend-today', todaySchedules.length - yesterdayCount, ' вчора');
  setTrend('trend-services', totalServices > 0 ? activeServices - (totalServices - activeServices) : 0, '');

  // Таймлайн сьогоднішнього розкладу
  const todayList = document.querySelector('#dashboard-today-list');
  if (todayList) {
    todayList.innerHTML = todaySchedules.length
      ? todaySchedules.map((schedule) => {
          const booked = Number(schedule.booked || 0);
          const max = Number(schedule.max_clients || 0);
          return `
            <div class="tl-item">
              <div class="tl-time">${formatTime(schedule.time)}</div>
              <div class="tl-dot"></div>
              <div class="tl-body">
                <strong>${escapeHtml(schedule.workout_name || '—')}</strong>
                <span>${escapeHtml(schedule.trainer_name || 'без тренера')} · ${booked}/${max}</span>
              </div>
            </div>
          `;
        }).join('')
      : '<p class="tl-empty">Сьогодні занять немає</p>';
  }

  // Потребує уваги
  const endingSubscriptions = data.subscriptions.filter((subscription) => (
    subscription.status === 'active'
    && formatDate(subscription.end_date) >= today
    && formatDate(subscription.end_date) <= weekAhead
  )).length;

  const clientsWithoutSubscription = data.clients.filter((client) => client.status !== 'active').length;

  const almostFullClasses = data.schedules.filter((schedule) => {
    const available = Math.max(Number(schedule.max_clients || 0) - Number(schedule.booked || 0), 0);
    return formatDate(schedule.date) >= today && available > 0 && available <= ALMOST_FULL_THRESHOLD;
  }).length;

  const attention = document.querySelector('#dashboard-attention');
  if (attention) {
    attention.innerHTML = `
      <div class="attention-item warning">
        <div class="attention-item__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <div class="attention-item__body">
          <strong>${endingSubscriptions} абонементів</strong>
          <span>закінчуються цього тижня</span>
        </div>
      </div>
      <div class="attention-item danger">
        <div class="attention-item__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <div class="attention-item__body">
          <strong>${clientsWithoutSubscription} клієнтів</strong>
          <span>без активного абонемента</span>
        </div>
      </div>
      <div class="attention-item">
        <div class="attention-item__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <div class="attention-item__body">
          <strong>${almostFullClasses} занять</strong>
          <span>майже заповнені</span>
        </div>
      </div>
    `;
  }

  // Останні дії (топ-7 найновіших абонементів)
  const activityEl = document.querySelector('#dashboard-activity');
  if (activityEl) {
    const recent = [...data.subscriptions]
      .filter((s) => s.start_date)
      .sort((a, b) => (b.start_date > a.start_date ? 1 : -1))
      .slice(0, 7);

    activityEl.innerHTML = recent.length
      ? recent.map((s) => {
          const daysAgo = Math.round((new Date(today) - new Date(formatDate(s.start_date))) / 86400000);
          const when = daysAgo === 0 ? 'сьогодні' : daysAgo === 1 ? 'вчора' : `${daysAgo} д. тому`;
          return `
            <div class="activity-item">
              <div class="activity-dot"></div>
              <div class="activity-body">
                <strong>${escapeHtml(s.client_name || '—')}</strong>
                <span>${escapeHtml(s.type || s.plan_name || 'Абонемент')} · ${when}</span>
              </div>
            </div>
          `;
        }).join('')
      : '<p class="tl-empty">Активностей ще немає</p>';
  }

  // Привітання
  const greetingTime = document.querySelector('#greeting-time');
  const greetingDate = document.querySelector('#greeting-date');
  if (greetingTime) {
    const h = new Date().getHours();
    greetingTime.textContent = h < 12 ? 'Доброго ранку' : h < 18 ? 'Доброго дня' : 'Доброго вечора';
  }
  if (greetingDate) {
    const now = new Date();
    const days = ['Неділя','Понеділок','Вівторок','Середа','Четвер','Пʼятниця','Субота'];
    const months = ['січня','лютого','березня','квітня','травня','червня','липня','серпня','вересня','жовтня','листопада','грудня'];
    greetingDate.textContent = `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]}`;
  }
}

/**
 * Завантажує дані для дашборду й малює його. Працює лише на головній сторінці.
 */
async function loadDashboard() {
  if (!dashboardPage) {
    return;
  }

  try {
    const [clientsData, trainersData, servicesData, schedulesData, subscriptionsData] = await Promise.all([
      apiFetch('/clients'),
      apiFetch('/trainers'),
      apiFetch('/workouts'),
      apiFetch('/schedules'),
      apiFetch('/subscriptions'),
    ]);
    renderDashboard({
      clients: clientsData,
      trainers: trainersData,
      services: servicesData,
      schedules: schedulesData,
      subscriptions: subscriptionsData,
    });
  } catch (error) {
    console.error('Не вдалося завантажити дашборд:', error);
  }
}

// ─── Швидкий пошук клієнта на дашборді ────────────────────────────────────────

const dashSearch = document.querySelector('#dash-client-search');
const dashSearchResults = document.querySelector('#dash-search-results');

let dashSearchClients = [];

async function ensureDashClients() {
  if (!dashSearchClients.length) {
    try { dashSearchClients = await apiFetch('/clients'); } catch {}
  }
}

if (dashSearch) {
  dashSearch.addEventListener('input', async () => {
    const q = normalizeText(dashSearch.value);
    if (!q || q.length < 2) {
      dashSearchResults?.toggleAttribute('hidden', true);
      return;
    }
    await ensureDashClients();
    const matches = dashSearchClients.filter((c) => {
      return normalizeText(`${c.name} ${c.phone} ${c.email}`).includes(q);
    }).slice(0, 6);

    if (!dashSearchResults) return;
    if (!matches.length) {
      dashSearchResults.innerHTML = '<div class="dash-sr-empty">Клієнтів не знайдено</div>';
    } else {
      dashSearchResults.innerHTML = matches.map((c) => {
        const status = c.status || 'inactive';
        return `
          <button class="dash-sr-item" data-client-details="${c.id}">
            <span class="dash-sr-name">${escapeHtml(c.name)}</span>
            <span class="dash-sr-meta">${escapeHtml(c.phone || c.email || '')} · <mark class="status ${status} small">${statusLabels[status] || status}</mark></span>
          </button>
        `;
      }).join('');
    }
    dashSearchResults.removeAttribute('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!dashSearch.contains(e.target) && !dashSearchResults?.contains(e.target)) {
      dashSearchResults?.toggleAttribute('hidden', true);
    }
  });

  dashSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      dashSearch.value = '';
      dashSearchResults?.toggleAttribute('hidden', true);
    }
  });
}

// ─── Дані клубу ──────────────────────────────────────────────────────────────

/**
 * Завантажує дані клубу у форму налаштувань. Працює лише на сторінці клубу.
 */
async function loadClubSettings() {
  if (!clubForm) {
    return;
  }

  try {
    const club = await apiFetch('/club');
    clubForm.querySelector('[name="name"]').value = club.name || '';
    clubForm.querySelector('[name="address"]').value = club.address || '';
    clubForm.querySelector('[name="phone"]').value = club.phone || '';
    clubForm.querySelector('[name="email"]').value = club.email || '';
    clubForm.querySelector('[name="weekday_hours"]').value = club.weekday_hours || '';
    clubForm.querySelector('[name="weekend_hours"]').value = club.weekend_hours || '';
  } catch (error) {
    setNote('#club-feedback', `Не вдалося завантажити дані клубу: ${error.message}`, 'error');
  }
}

/**
 * Зберігає дані клубу через PUT /api/club.
 *
 * @param {HTMLFormElement} form
 */
async function saveClubSettings(form) {
  const formData = new FormData(form);
  try {
    await apiFetch('/club', {
      method: 'PUT',
      body: JSON.stringify({
        name: formData.get('name')?.trim(),
        address: formData.get('address')?.trim(),
        phone: formData.get('phone')?.trim(),
        email: formData.get('email')?.trim(),
        weekday_hours: formData.get('weekday_hours')?.trim(),
        weekend_hours: formData.get('weekend_hours')?.trim(),
      }),
    });
    setNote('#club-feedback', 'Дані клубу збережено', 'success');
  } catch (error) {
    setNote('#club-feedback', `Не вдалося зберегти: ${error.message}`, 'error');
  }
}

// ─── Повідомлення (оголошення) ───────────────────────────────────────────────

function setMessagesFeedback(message, type = 'info') {
  const feedback = document.querySelector('#messages-feedback');
  if (feedback) {
    feedback.textContent = message;
    feedback.dataset.type = type;
  }
}

/**
 * Повертає оголошення з урахуванням активного фільтра та пошуку.
 *
 * @returns {object[]}
 */
function getFilteredMessages() {
  const search = normalizeText(messagesSearch?.value);
  return messages.filter((item) => {
    const matchesFilter = messagesFilter === 'all'
      || item.audience === messagesFilter
      || item.status === messagesFilter;
    const haystack = normalizeText(`${item.subject} ${item.body || ''}`);
    return matchesFilter && (!search || haystack.includes(search));
  });
}

function renderMessages() {
  if (!messagesTableBody) {
    return;
  }

  const visibleMessages = getFilteredMessages();
  if (visibleMessages.length === 0) {
    messagesTableBody.innerHTML = '<div class="table-row table-empty"><span>Повідомлень не знайдено</span></div>';
    return;
  }

  const sentIcon = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  const plannedIcon = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

  messagesTableBody.innerHTML = visibleMessages.map((item) => {
    const isSent = item.status === 'sent';
    const statusClass = isSent ? 'active' : 'planned';
    const statusLabel = messageStatusLabels[item.status] || item.status;
    const audienceLabel = messageAudienceLabels[item.audience] || item.audience;
    const dateInfo = isSent
      ? `Надіслано ${item.send_date ? formatDate(item.send_date) : '—'} · Створено ${formatDate(item.created_at)}`
      : `Заплановано на ${item.send_date ? formatDate(item.send_date) : '—'} · Створено ${formatDate(item.created_at)}`;

    return `
      <div class="msg-card">
        <div class="msg-card__ico msg-card__ico--${isSent ? 'sent' : 'planned'}">
          ${isSent ? sentIcon : plannedIcon}
        </div>
        <div class="msg-card__body">
          <p class="msg-card__subject">${escapeHtml(item.subject)}</p>
          <p class="msg-card__meta">
            <span class="msg-card__audience">${audienceLabel}</span>
            <span class="msg-card__dot">·</span>
            ${dateInfo}
          </p>
        </div>
        <div class="msg-card__side">
          <mark class="status ${statusClass}">${statusLabel}</mark>
          <div class="msg-actions">
            <button class="icon-action-btn" data-message-view="${item.id}" title="Деталі">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            <button class="icon-action-btn" data-message-edit="${item.id}" title="Редагувати">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
            </button>
            <button class="icon-action-btn icon-action-btn--danger" data-message-delete="${item.id}" title="Видалити">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function loadMessages() {
  if (!messagesTableBody) {
    return;
  }

  try {
    messages = await apiFetch('/messages');
    renderMessages();
    setMessagesFeedback(`Повідомлень: ${messages.length}`, 'success');
  } catch (error) {
    setMessagesFeedback(`Не вдалося завантажити повідомлення: ${error.message}`, 'error');
  }
}

/**
 * Будує форму створення/редагування оголошення.
 *
 * @param {object|null} [message]
 * @returns {string} HTML форми.
 */
function renderMessageForm(message = null) {
  const isEdit = Boolean(message);
  const audience = message?.audience || 'clients';
  const status = message?.status || 'sent';
  return `
    <form id="message-form" class="admin-form" data-message-id="${message?.id || ''}">
      <label>Тема
        <input name="subject" type="text" required value="${escapeHtml(message?.subject || '')}">
      </label>
      <label>Текст
        <textarea name="body" rows="3">${escapeHtml(message?.body || '')}</textarea>
      </label>
      <label>Кому
        <select name="audience">
          <option value="all" ${audience === 'all' ? 'selected' : ''}>Усім</option>
          <option value="clients" ${audience === 'clients' ? 'selected' : ''}>Клієнтам</option>
          <option value="trainers" ${audience === 'trainers' ? 'selected' : ''}>Тренерам</option>
          ${audience === 'custom' ? '<option value="custom" selected>Вибраним</option>' : ''}
        </select>
      </label>
      <div id="recipients-box" hidden></div>
      <label>Статус
        <select name="status">
          <option value="sent" ${status === 'sent' ? 'selected' : ''}>Надіслано</option>
          <option value="planned" ${status === 'planned' ? 'selected' : ''}>Заплановано</option>
        </select>
      </label>
      <label>Дата надсилання
        <input name="send_date" type="date" value="${message?.send_date ? formatDate(message.send_date) : ''}">
      </label>
      <div class="modal-actions">
        <button type="button" class="ghost-btn modal-close">Скасувати</button>
        <button type="submit" class="primary-btn">${isEdit ? 'Зберегти зміни' : 'Створити'}</button>
      </div>
    </form>
  `;
}

// Кеш списків отримувачів, щоб не смикати API при кожному
// перемиканні аудиторії у формі повідомлення.
const recipientListCache = { clients: null, trainers: null };

/**
 * Повертає перелік можливих отримувачів обраної групи: user_id + ім'я.
 *
 * @param {'clients'|'trainers'} group Група отримувачів.
 * @returns {Promise<Array<{userId: number, name: string}>>}
 */
async function loadRecipientOptions(group) {
  if (recipientListCache[group]) {
    return recipientListCache[group];
  }
  const rows = await apiFetch(group === 'clients' ? '/clients' : '/trainers');
  const options = rows
    .filter((row) => row.user_id)
    .map((row) => ({ userId: row.user_id, name: row.name }));
  recipientListCache[group] = options;
  return options;
}

/**
 * Рендерить список чекбоксів отримувачів.
 *
 * @param {Array<{userId: number, name: string}>} options Кандидати.
 * @param {number[]} checkedIds Попередньо обрані user_id.
 * @returns {string} HTML списку.
 */
function renderRecipientCheckboxes(options, checkedIds = []) {
  if (options.length === 0) {
    return '<div class="recipients-hint">У цій групі поки нікого немає.</div>';
  }
  const items = options.map((option) => `
    <label class="recipient-item">
      <input type="checkbox" name="recipient" value="${option.userId}"
        ${checkedIds.includes(option.userId) ? 'checked' : ''}>
      <span>${escapeHtml(option.name)}</span>
    </label>`).join('');
  return `
    <div class="recipients-hint">
      Кому саме. Нікого не обрано — повідомлення отримає вся група.
    </div>
    <div class="recipient-list">${items}</div>`;
}

/**
 * Оживляє вибір конкретних отримувачів у формі повідомлення:
 * при аудиторії «Клієнтам»/«Тренерам» показує список людей із чекбоксами.
 * Викликати одразу після openModal з формою повідомлення.
 *
 * @param {object|null} message Повідомлення при редагуванні (з recipients).
 * @returns {void}
 */
function bindRecipientPicker(message = null) {
  const select = document.querySelector('#message-form select[name="audience"]');
  const box = document.querySelector('#recipients-box');
  if (!select || !box) {
    return;
  }

  const checkedIds = (message?.recipients || []).map((recipient) => recipient.id);

  async function update() {
    const group = select.value;

    if (group === 'custom') {
      // Редагування адресного повідомлення: показуємо його отримувачів.
      const options = (message?.recipients || [])
        .map((recipient) => ({ userId: recipient.id, name: recipient.name }));
      box.hidden = false;
      box.innerHTML = renderRecipientCheckboxes(options, checkedIds);
      return;
    }

    if (group !== 'clients' && group !== 'trainers') {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }

    box.hidden = false;
    box.innerHTML = '<div class="recipients-hint">Завантаження списку…</div>';
    try {
      const options = await loadRecipientOptions(group);
      box.innerHTML = renderRecipientCheckboxes(options, checkedIds);
    } catch (error) {
      box.innerHTML = `<div class="recipients-hint">Не вдалося завантажити список: ${escapeHtml(error.message)}</div>`;
    }
  }

  select.addEventListener('change', update);
  update();
}

/**
 * Створює або оновлює оголошення залежно від наявності id у формі.
 *
 * @param {HTMLFormElement} form
 */
async function saveMessage(form) {
  const formData = new FormData(form);
  const messageId = form.dataset.messageId;
  const audienceValue = formData.get('audience');
  const recipientIds = [...form.querySelectorAll('input[name="recipient"]:checked')]
    .map((input) => Number(input.value));

  const payload = {
    subject: formData.get('subject')?.trim(),
    body: formData.get('body')?.trim(),
    // 'custom' — службове значення: сервер визначає його сам за наявністю
    // recipient_ids, тому з форми аудиторію в цьому разі не передаємо.
    audience: audienceValue === 'custom' ? undefined : audienceValue,
    status: formData.get('status'),
    send_date: formData.get('send_date') || null,
    recipient_ids: recipientIds,
  };

  if (!payload.subject) {
    setModalError('Вкажіть тему повідомлення');
    return;
  }

  try {
    if (messageId) {
      await apiFetch(`/messages/${messageId}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await apiFetch('/messages', { method: 'POST', body: JSON.stringify(payload) });
    }
    closeModal();
    await loadMessages();
  } catch (error) {
    setModalError(`Не вдалося зберегти: ${error.message}`);
  }
}

async function deleteMessage(messageId) {
  const isConfirmed = await openConfirmModal({
    title: 'Видалити повідомлення',
    message: 'Видалити це повідомлення?',
  });
  if (!isConfirmed) {
    return;
  }

  try {
    await apiFetch(`/messages/${messageId}`, { method: 'DELETE' });
    await loadMessages();
  } catch (error) {
    setMessagesFeedback(`Не вдалося видалити: ${error.message}`, 'error');
  }
}

function openMessageDetails(messageId) {
  const message = messages.find((item) => String(item.id) === String(messageId));
  if (!message) {
    return;
  }

  sheetTitle.textContent = message.subject;
  sheetBody.innerHTML = `
    <dl>
      <div><dt>Кому</dt><dd>${messageAudienceLabels[message.audience] || message.audience}</dd></div>
      <div><dt>Статус</dt><dd>${messageStatusLabels[message.status] || message.status}</dd></div>
      <div><dt>Створено</dt><dd>${formatDate(message.created_at)}</dd></div>
      <div><dt>Надсилання</dt><dd>${message.send_date ? formatDate(message.send_date) : '—'}</dd></div>
    </dl>
    <p>${escapeHtml(message.body || 'Без тексту.')}</p>
  `;
  sheet.classList.add('active');
}

// ─── Особисті дані та налаштування адміністратора ────────────────────────────

const ADMIN_SETTINGS_KEY = 'adminSettings';

/**
 * Встановлює текст і тип повідомлення у вказаному полі-нотатці.
 *
 * @param {string} selector
 * @param {string} message
 * @param {string} [type]
 */
function setNote(selector, message, type = 'info') {
  const element = document.querySelector(selector);
  if (element) {
    element.textContent = message;
    element.dataset.type = type;
  }
}

/**
 * Зберігає ім'я та телефон адміністратора через PUT /auth/profile.
 *
 * @param {HTMLFormElement} form
 */
async function saveAdminProfile(form) {
  const formData = new FormData(form);
  try {
    const data = await apiFetch('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify({
        name: formData.get('name')?.trim(),
        phone: formData.get('phone')?.trim(),
      }),
    });
    if (data && data.token && data.user) {
      setAuth(data.token, data.user);
    }
    await hydrateAccount({ role: ROLE.ADMIN });
    setNote('#admin-profile-feedback', 'Дані збережено', 'success');
  } catch (error) {
    setNote('#admin-profile-feedback', `Не вдалося зберегти: ${error.message}`, 'error');
  }
}

const passwordModal = document.querySelector('#password-modal');

function openPasswordModal() {
  passwordModal?.classList.add('active');
}

function closePasswordModal() {
  if (!passwordModal) {
    return;
  }
  passwordModal.classList.remove('active');
  passwordModal.querySelector('form')?.reset();
  setNote('#password-feedback', '');
}

/**
 * Змінює пароль адміністратора через PUT /auth/password.
 *
 * @param {HTMLFormElement} form
 */
async function changeAdminPassword(form) {
  const formData = new FormData(form);
  const newPassword = formData.get('newPassword');
  if (newPassword !== formData.get('confirmPassword')) {
    setNote('#password-feedback', 'Паролі не співпадають', 'error');
    return;
  }

  try {
    await apiFetch('/auth/password', {
      method: 'PUT',
      skipAuthRedirect: true,
      body: JSON.stringify({
        currentPassword: formData.get('currentPassword'),
        newPassword,
      }),
    });
    closePasswordModal();
    setNote('#admin-profile-feedback', 'Пароль змінено', 'success');
  } catch (error) {
    setNote('#password-feedback', `Не вдалося змінити пароль: ${error.message}`, 'error');
  }
}

/**
 * Відновлює та зберігає налаштування адміністратора у localStorage
 * (окремого серверного сховища налаштувань немає).
 */
function loadAdminSettings() {
  const panel = document.querySelector('[data-screen-panel="admin-settings"]');
  if (!panel) {
    return;
  }

  const saved = JSON.parse(localStorage.getItem(ADMIN_SETTINGS_KEY) || '{}');
  panel.querySelectorAll('[data-setting]').forEach((input) => {
    const key = input.dataset.setting;
    if (!(key in saved)) {
      return;
    }
    if (input.type === 'checkbox') {
      input.checked = Boolean(saved[key]);
    } else {
      input.value = saved[key];
    }
  });

  panel.querySelector('#save-admin-settings')?.addEventListener('click', () => {
    const next = {};
    panel.querySelectorAll('[data-setting]').forEach((input) => {
      next[input.dataset.setting] = input.type === 'checkbox' ? input.checked : input.value;
    });
    localStorage.setItem(ADMIN_SETTINGS_KEY, JSON.stringify(next));
    setNote('#admin-settings-feedback', 'Налаштування збережено', 'success');
  });
}

document.querySelector('[data-change-password]')?.addEventListener('click', openPasswordModal);
document.querySelector('[data-password-cancel]')?.addEventListener('click', closePasswordModal);
passwordModal?.addEventListener('click', (event) => {
  if (event.target === passwordModal) {
    closePasswordModal();
  }
});

initSidebar();
initTheme();
initNotifications();

const currentUser = await requireFreshAuth([ROLE.ADMIN]);
if (currentUser) {
  hydrateAccount({ role: ROLE.ADMIN });
  loadAdminSettings();
  loadClubSettings();
  attachPhoneMasks(document); // маска для статичних полів телефону
}
if (currentUser && dashboardPage) {
  const greetingName = document.querySelector('#greeting-name');
  if (greetingName && currentUser.name) {
    greetingName.textContent = currentUser.name.split(' ')[0];
  }
  loadDashboard();
}
if (currentUser && messagesPage) {
  loadMessages();
}
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
if (currentUser && profilePage) {
  loadProfileStats();
}

/* ══════════════════════════════════════════
   СТАТИСТИКА ПРОФІЛЮ АДМІНА
   ══════════════════════════════════════════ */
async function loadProfileStats() {
  try {
    const [cls, trs, pls] = await Promise.all([
      apiFetch('/clients').catch(() => []),
      apiFetch('/trainers').catch(() => []),
      apiFetch('/subscriptions/plans').catch(() => []),
    ]);
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setEl('prof-stat-clients', cls.length ?? '—');
    setEl('prof-stat-trainers', trs.length ?? '—');
    setEl('prof-stat-plans', (pls.filter ? pls.filter(p => p.status !== 'deleted') : pls).length ?? '—');
  } catch (_) { /* ігноруємо */ }
}

