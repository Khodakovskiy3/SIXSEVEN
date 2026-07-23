import { apiFetch, clearAuth, formatDate, requireFreshAuth, setAuth } from './api.js';
import { escapeHtml, getInitials, getAvatarColor, AVATAR_PALETTE, formatMoney } from './utils.js';
import { hydrateAccount } from './account.js';
import { PAGE, ROLE, STORAGE_KEY } from './constants.js';
import { initSidebar } from './sidebar.js';
import { initTheme } from './theme.js';
import { initNotifications } from './notifications.js';
import { initHelpWidget } from './help-widget.js';
import { initModalHotkeys } from './modal-hotkeys.js';

const titles = {
  home: 'Головна',
  schedule: 'Розклад',
  records: 'Записи',
  profile: 'Профіль',
  subscription: 'Абонемент',
  personal: 'Особисті дані',
  activity: 'Моя активність',
  anthropometry: 'Антропометрія',
  settings: 'Налаштування',
};

let activePlans = [];
let allClientSubscriptions = [];
// Чинний абонемент блокує купівлю нового: спершу його треба скасувати.
let hasActiveSubscription = false;
let currentPlanForPurchase = null;
let schedules = [];
let bookings = [];
let selectedScheduleDate = '';
let selectedWorkoutFilter = 'all';

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

/**
 * Кастомний діалог підтвердження замість window.confirm()
 * Повертає Promise<boolean>
 *
 * @param {string} message Текст запитання.
 * @param {string} [okLabel] Підпис кнопки підтвердження (дія не завжди «Видалити»).
 * @returns {Promise<boolean>}
 */
/**
 * Гнучкий діалог підтвердження з кастомним текстом кнопки.
 * @param {string} message
 * @param {string} okLabel  — текст кнопки підтвердження
 * @param {string} okClass  — CSS-клас кнопки ('primary-btn' або 'danger-btn')
 * @returns {Promise<boolean>}
 */
function showActionConfirm(message, okLabel = 'Підтвердити', okClass = 'primary-btn') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'custom-confirm-overlay';
    overlay.innerHTML = `
      <div class="custom-confirm-box">
        <p class="custom-confirm-msg">${escapeHtml(message)}</p>
        <div class="custom-confirm-actions">
          <button class="ghost-btn custom-confirm-cancel">Назад</button>
          <button class="${okClass} custom-confirm-ok">${escapeHtml(okLabel)}</button>
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

/**
 * Спливаюче вікно з повідомленням і однією кнопкою.
 * Потрібне там, де інлайн-фідбек недоступний: на головній сторінці немає
 * блоку #schedule-feedback, тож без діалогу помилка запису була б невидимою.
 *
 * @param {string} message Текст повідомлення.
 * @param {string} [title] Заголовок діалогу.
 * @returns {Promise<void>} Резолвиться після закриття.
 */
function showAlert(message, title = '') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'custom-confirm-overlay';
    overlay.innerHTML = `
      <div class="custom-confirm-box" role="alertdialog" aria-modal="true">
        ${title ? `<h3 class="custom-confirm-title">${escapeHtml(title)}</h3>` : ''}
        <p class="custom-confirm-msg">${escapeHtml(message)}</p>
        <div class="custom-confirm-actions custom-confirm-actions--single">
          <button class="primary-btn custom-confirm-ok">Зрозуміло</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const cleanup = () => {
      document.removeEventListener('keydown', onKeydown);
      overlay.remove();
      resolve();
    };
    function onKeydown(event) {
      if (event.key === 'Escape') {
        cleanup();
      }
    }
    overlay.querySelector('.custom-confirm-ok').addEventListener('click', cleanup);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });
    document.addEventListener('keydown', onKeydown);
    overlay.querySelector('.custom-confirm-ok').focus();
  });
}

function showConfirm(message, okLabel = 'Видалити') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'custom-confirm-overlay';
    overlay.innerHTML = `
      <div class="custom-confirm-box">
        <p class="custom-confirm-msg">${escapeHtml(message)}</p>
        <div class="custom-confirm-actions">
          <button class="ghost-btn custom-confirm-cancel">Скасувати</button>
          <button class="danger-btn custom-confirm-ok">${escapeHtml(okLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const cleanup = (result) => {
      overlay.remove();
      resolve(result);
    };
    overlay.querySelector('.custom-confirm-ok').addEventListener('click', () => cleanup(true));
    overlay.querySelector('.custom-confirm-cancel').addEventListener('click', () => cleanup(false));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
  });
}

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

function fmtLocalDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
}


function describePlan(plan) {
  const access = accessTypeLabels[plan.access_type] || plan.access_type || 'Доступ';
  const period = plan.plan_type === 'subscription'
    ? `${plan.duration_days || 30} днів`
    : `${plan.usage_count || 1} використання`;
  return `${access} · ${period}`;
}

function setSubscriptionFeedback(message = '', type = 'info') {
  const feedback = document.querySelector('#subscription-feedback');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.dataset.type = type;
}

function setScheduleFeedback(message = '', type = 'info') {
  const feedback = document.querySelector('#schedule-feedback');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.dataset.type = type;
}

function formatTime(value = '') {
  return String(value).slice(0, 5);
}

function formatShortDate(value) {
  const date = new Date(value);
  return date.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
}

function getDayLabel(value, mode = 'short') {
  return new Date(value).toLocaleDateString('uk-UA', { weekday: mode });
}

/**
 * Описує день людською мовою: «Сьогодні», «Завтра» або дата у форматі 'дд.мм'.
 *
 * @param {string|Date} value
 * @returns {string}
 */
function describeDay(value) {
  const date = formatDate(value);
  const today = new Date();
  if (date === today.toISOString().slice(0, 10)) {
    return 'Сьогодні';
  }

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date === tomorrow.toISOString().slice(0, 10)) {
    return 'Завтра';
  }

  return new Date(value).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
}

/**
 * Формує відсортований перелік майбутніх днів (від сьогодні), на які є заняття.
 * Минулі дні до стрічки не потрапляють — клієнт бачить лише актуальний розклад.
 *
 * @returns {string[]} дати у форматі 'YYYY-MM-DD'.
 */
function getScheduleDates() {
  const today = new Date();
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

/**
 * Обирає день за замовчуванням — найближчий день із заняттями,
 * інакше сьогодні.
 *
 * @param {string[]} dates — відсортовані дати з getScheduleDates().
 * @returns {string} обрана дата.
 */
function pickDefaultScheduleDate(dates) {
  const today = new Date().toISOString().slice(0, 10);
  const firstDateWithClasses = dates.find((date) => (
    schedules.some((item) => formatDate(item.date) === date)
  ));
  return firstDateWithClasses || today;
}

const pageRoutes = {
  home: '/pages/client/index.html',
  schedule: '/pages/client/schedule.html',
  records: '/pages/client/records.html',
  profile: '/pages/client/profile.html',
  subscription: '/pages/client/subscription.html',
  personal: '/pages/client/personal.html',
  activity: '/pages/client/activity.html',
  anthropometry: '/pages/client/anthropometry.html',
  settings: '/pages/client/settings.html',
};

const sheetContent = {
  yoga: {
    title: 'Йога',
    text: 'Релаксація, гнучкість та зміцнення тіла через комплекс вправ і дихальних практик.',
    duration: '50 хв',
    level: 'для всіх',
    trainer: 'Анна',
  },
  fight: {
    title: 'Єдиноборства',
    text: 'Інтенсивне тренування на витривалість, координацію та базову техніку ударів.',
    duration: '60 хв',
    level: 'середній',
    trainer: 'Максим',
  },
};

function setScreen(screen) {
  const nextScreen = titles[screen] ? screen : 'home';
  if (!document.querySelector(`[data-screen-panel="${nextScreen}"]`) && pageRoutes[nextScreen]) {
    window.location.href = pageRoutes[nextScreen];
    return;
  }

  document.querySelectorAll('.screen').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.screenPanel === nextScreen);
  });

  document.querySelectorAll('[data-screen]').forEach((button) => {
    button.classList.toggle('active', button.dataset.screen === nextScreen);
  });

  document.querySelector('#screen-title').textContent = titles[nextScreen];
}

function renderCurrentSubscription(subscriptions = []) {
  const container = document.querySelector('#current-subscription');
  if (!container) return;

  const activeSubscription = subscriptions.find((item) => item.status === 'active' && new Date(item.end_date) >= new Date());
  hasActiveSubscription = Boolean(activeSubscription);

  if (!activeSubscription) {
    container.innerHTML = `
      <span class="chip">Немає активного</span>
      <h3>Активний абонемент відсутній</h3>
      <p>Оберіть один із доступних тарифів нижче.</p>
    `;
    return;
  }

  const isSubscription = activeSubscription.plan_type === 'subscription';
  const usageLabel = isSubscription
    ? `${activeSubscription.duration_days || 30} днів`
    : `${activeSubscription.usage_count || 1} відвідування`;

  container.innerHTML = `
    <div class="sub-card">
      <div class="sub-card__content">
        <div class="sub-card__badge">
          <span class="sub-card__dot"></span>Активний
        </div>
        <h3 class="sub-card__name">${escapeHtml(activeSubscription.type || activeSubscription.plan_name || 'Абонемент')}</h3>
        <div class="sub-card__usage">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          ${escapeHtml(usageLabel)}
        </div>
        <div class="sub-dates">
          <div class="sub-date-row">
            <span class="sub-date-icon">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </span>
            <span class="sub-date-label">Початок</span>
            <span class="sub-date-divider"></span>
            <span class="sub-date-val">${fmtLocalDate(activeSubscription.start_date)}</span>
          </div>
          <div class="sub-date-row">
            <span class="sub-date-icon">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </span>
            <span class="sub-date-label">Діє до</span>
            <span class="sub-date-divider"></span>
            <span class="sub-date-val">${fmtLocalDate(activeSubscription.end_date)}</span>
          </div>
        </div>
        <p class="form-note">Щоб придбати інший тариф, спершу скасуйте поточний абонемент.</p>
        <button class="danger-btn" data-cancel-subscription>Скасувати абонемент</button>
      </div>
      <div class="sub-card__illo" aria-hidden="true">
        <svg viewBox="0 0 120 100" width="90" height="76" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="10" y="18" width="95" height="64" rx="14" fill="rgba(232,80,2,0.10)"/>
          <rect x="4" y="28" width="6" height="20" rx="3" fill="rgba(232,80,2,0.15)"/>
          <rect x="105" y="28" width="6" height="20" rx="3" fill="rgba(232,80,2,0.15)"/>
          <circle cx="60" cy="50" r="22" fill="rgba(232,80,2,0.10)"/>
          <rect x="34" y="46" width="12" height="8" rx="2" fill="rgba(232,80,2,0.5)"/>
          <rect x="74" y="46" width="12" height="8" rx="2" fill="rgba(232,80,2,0.5)"/>
          <rect x="44" y="48" width="32" height="4" rx="2" fill="rgba(232,80,2,0.5)"/>
          <rect x="32" y="44" width="6" height="12" rx="3" fill="rgba(232,80,2,0.6)"/>
          <rect x="82" y="44" width="6" height="12" rx="3" fill="rgba(232,80,2,0.6)"/>
        </svg>
      </div>
    </div>
  `;
}

function renderAvailablePlans() {
  const grid = document.querySelector('#client-plans-grid');
  if (!grid) return;

  if (activePlans.length === 0) {
    grid.innerHTML = `<article class="manage-card"><p style="padding:20px">Тарифів не знайдено</p></article>`;
    return;
  }

  const checkSvg = `<svg viewBox="0 0 16 16" fill="none" width="14" height="14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 8.5 6 12 13.5 4"/></svg>`;

  grid.innerHTML = activePlans.map((plan) => {
    const isSubscription = plan.plan_type === 'subscription';
    const meta = isSubscription
      ? `${plan.duration_days || 0} днів`
      : `${plan.usage_count || 0} використання`;
    const access = accessTypeLabels[plan.access_type] || plan.access_type || 'Доступ';
    const priceNum = Number(plan.price || 0).toLocaleString('uk-UA', { maximumFractionDigits: 0 });
    const period = isSubscription ? '/ міс' : '/ відв.';
    const features = [
      isSubscription ? `${plan.duration_days || 0} днів доступу` : `${plan.usage_count || 0} відвідувань`,
      access,
      isSubscription ? 'Необмежені відвідування' : 'Разовий прохід',
    ];

    return `
      <article class="manage-card featured">
        <div class="manage-card__dark">
          <div class="manage-card__topline">
            <span class="manage-card__type">${planTypeLabels[plan.plan_type] || 'Тариф'} · ${escapeHtml(meta)}</span>
          </div>
          <h3>${escapeHtml(plan.name)}</h3>
          <p class="manage-card__desc">${escapeHtml(plan.description || describePlan(plan))}</p>
          <div class="manage-card__price">
            <sup class="manage-card__currency">грн</sup>
            <strong>${escapeHtml(priceNum)}</strong>
            <span class="manage-card__period">${period}</span>
          </div>
          <div class="manage-card__cta">
            ${hasActiveSubscription
              ? `<button class="primary-btn" disabled
                   title="Спершу скасуйте поточний абонемент">Придбати</button>`
              : `<button class="primary-btn" data-purchase-plan="${plan.id}">Придбати</button>`}
          </div>
        </div>
        <div class="manage-card__light">
          <ul class="manage-card__features">
            ${features.map((f) => `<li>${checkSvg}<span>${escapeHtml(f)}</span></li>`).join('')}
          </ul>
        </div>
      </article>
    `;
  }).join('');
}

function renderDateStrip() {
  const strip = document.querySelector('#client-date-strip');
  if (!strip) {
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const dates = getScheduleDates();
  const pillW = window.innerWidth < 720 ? '54px' : '1fr';
  strip.style.gridTemplateColumns = `repeat(${dates.length}, ${pillW})`;
  strip.innerHTML = dates.map((date) => {
    const isActive = date === selectedScheduleDate;
    const isToday = date === today;
    const dayCount = schedules.filter((item) => formatDate(item.date) === date).length;
    return `
      <button class="sched-date-pill${isActive ? ' active' : ''}${isToday ? ' today' : ''}" data-schedule-date="${date}">
        <span class="sdp-weekday">${getDayLabel(date)}</span>
        <strong class="sdp-day">${formatShortDate(date)}</strong>
        <span class="sdp-count">${isToday ? 'Сьогодні' : `${dayCount} зан.`}</span>
      </button>
    `;
  }).join('');
}

function renderScheduleFilters() {
  const filterRow = document.querySelector('#client-schedule-filters');
  if (!filterRow) return;

  const workoutNames = [...new Set(schedules.map((item) => item.workout_name).filter(Boolean))];
  filterRow.innerHTML = [
    `<button class="chip ${selectedWorkoutFilter === 'all' ? 'active' : ''}" data-workout-filter="all">Усі</button>`,
    ...workoutNames.map((name) => `
      <button class="chip ${selectedWorkoutFilter === name ? 'active' : ''}" data-workout-filter="${escapeHtml(name)}">
        ${escapeHtml(name)}
      </button>
    `),
  ].join('');
}

function isAlreadyBooked(scheduleId) {
  return bookings.some((booking) => (
    String(booking.schedule_id) === String(scheduleId)
    && booking.status === 'active'
  ));
}

function getBookingIdBySchedule(scheduleId) {
  const b = bookings.find((booking) => (
    String(booking.schedule_id) === String(scheduleId)
    && booking.status === 'active'
  ));
  return b ? b.id : null;
}

function renderScheduleList() {
  const list = document.querySelector('#client-schedule-list');
  if (!list) return;

  const searchQuery = (document.querySelector('#client-schedule-search')?.value || '').trim().toLowerCase();

  const visibleSchedules = schedules.filter((item) => {
    const date = formatDate(item.date);
    const matchesDate = date === selectedScheduleDate;
    const matchesFilter = selectedWorkoutFilter === 'all' || item.workout_name === selectedWorkoutFilter;
    const matchesSearch = !searchQuery
      || (item.workout_name || '').toLowerCase().includes(searchQuery)
      || (item.trainer_name || '').toLowerCase().includes(searchQuery);
    return matchesDate && matchesFilter && matchesSearch;
  });

  if (visibleSchedules.length === 0) {
    list.innerHTML = `
      <div class="sched-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>
        <p>Занять не знайдено. Оберіть іншу дату або фільтр.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = visibleSchedules.map((item) => {
    const booked = isAlreadyBooked(item.id);
    const bookingId = booked ? getBookingIdBySchedule(item.id) : null;
    const available = Number(item.available || 0);
    const maxClients = Number(item.max_clients || 0);
    const bookedCount = maxClients - available;
    const fillPct = maxClients > 0 ? Math.round((bookedCount / maxClients) * 100) : 0;
    const isFull = available <= 0 && maxClients > 0;
    const disabled = isFull && !booked;

    const trainerInitials = getInitials(item.trainer_name || '?');
    const trainerColor = getAvatarColor(item.trainer_name || '');

    const actionBtn = booked
      ? `<button class="danger-btn" data-cancel-booking="${bookingId}">Скасувати</button>`
      : `<button class="${available > 0 ? 'primary-btn' : 'ghost-btn'}" data-book-schedule="${item.id}" ${disabled ? 'disabled' : ''}>${available > 0 ? 'Записатися' : 'Лист очікування'}</button>`;

    return `
      <div class="sched-card${isFull && !booked ? ' sched-card--full' : ''}">
        <div class="sched-card-time">
          <span>${formatTime(item.time)}</span>
          ${item.duration_minutes ? `<span class="sched-duration sched-duration--time">${item.duration_minutes} хв</span>` : ''}
        </div>
        <div class="sched-card-body">
          <div class="sched-card-title">
            ${escapeHtml(item.workout_name)}
            ${item.duration_minutes ? `<span class="sched-duration sched-duration--title">${item.duration_minutes} хв</span>` : ''}
          </div>
          <div class="sched-card-meta">
            <div class="client-avatar" style="background:${trainerColor};width:20px;height:20px;font-size:8px;flex-shrink:0">${escapeHtml(trainerInitials)}</div>
            <span>${escapeHtml(item.trainer_name || 'Тренер не призначений')}</span>
          </div>
          <div class="sched-capacity">
            <div class="sched-capacity-bar"><div class="sched-capacity-fill${isFull ? ' full' : ''}" style="width:${fillPct}%"></div></div>
            <span class="sched-capacity-label${isFull ? ' full' : ''}">${bookedCount}/${maxClients}${isFull ? ' · повно' : ''}</span>
          </div>
        </div>
        <div class="sched-card-actions">
          <button class="ghost-btn" data-schedule-details="${item.id}">Опис</button>
          ${actionBtn}
        </div>
      </div>
    `;
  }).join('');
}

async function loadSchedulePage() {
  if (!document.querySelector('#client-schedule-list')) return;

  // Підключаємо пошук
  const searchInput = document.querySelector('#client-schedule-search');
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = '1';
    searchInput.addEventListener('input', () => renderScheduleList());
  }

  try {
    setScheduleFeedback('Завантаження розкладу...');
    [schedules, bookings] = await Promise.all([
      apiFetch('/schedules'),
      apiFetch('/bookings/me'),
    ]);
    const dates = getScheduleDates();
    if (!selectedScheduleDate || !dates.includes(selectedScheduleDate)) {
      selectedScheduleDate = pickDefaultScheduleDate(dates);
    }
    renderDateStrip();
    renderScheduleFilters();
    renderScheduleList();
    setScheduleFeedback('');
  } catch (error) {
    setScheduleFeedback(`Не вдалося завантажити розклад: ${error.message}`, 'error');
  }
}

function openScheduleDetails(scheduleId) {
  const item = schedules.find((schedule) => String(schedule.id) === String(scheduleId))
    || bookings.find((booking) => String(booking.schedule_id) === String(scheduleId));
  if (!item || !sheet) return;

  document.querySelector('#sheet-title').textContent = item.workout_name || 'Заняття';
  document.querySelector('#sheet-text').textContent = item.workout_description || 'Опис заняття ще не додано.';
  const details = sheet.querySelectorAll('dd');
  if (details.length >= 3) {
    details[0].textContent = formatTime(item.time);
    details[1].textContent = formatDate(item.date);
    details[2].textContent = item.trainer_name || 'Не призначено';
  }
  sheet.classList.add('active');
}

async function bookSchedule(scheduleId) {
  const schedule = schedules.find(s => String(s.id) === String(scheduleId));
  const name = schedule ? escapeHtml(schedule.workout_name) : 'тренування';
  const time = schedule ? formatTime(schedule.time) : '';
  const confirmed = await showActionConfirm(
    `Записатися на ${name}${time ? ` о ${time}` : ''}?`,
    'Записатися',
    'primary-btn'
  );
  if (!confirmed) return;
  try {
    await apiFetch('/bookings', {
      method: 'POST',
      body: JSON.stringify({ schedule_id: Number(scheduleId) }),
    });
    setScheduleFeedback('Запис створено', 'success');
    await Promise.all([loadSchedulePage(), loadHomePage()]);
  } catch (error) {
    // Сервер пояснює причину відмови (невідповідний абонемент, немає місць
    // тощо) — показуємо її вікном, бо inline-підказка є лише на «Розкладі».
    setScheduleFeedback(`Не вдалося записатися: ${error.message}`, 'error');
    await showAlert(error.message, 'Не вдалося записатися');
  }
}

const MONTHS_UA = ['СІЧ','ЛЮТ','БЕР','КВІ','ТРА','ЧЕР','ЛИП','СЕР','ВЕР','ЖОВ','ЛИС','ГРУ'];

function bookingDateBadge(dateStr, past = false) {
  const d = new Date(dateStr);
  const day = d.getDate();
  const month = MONTHS_UA[d.getMonth()];
  const cls = past ? 'rc-date-badge rc-date-badge--past' : 'rc-date-badge';
  return `<div class="${cls}"><strong>${day}</strong><span>${month}</span></div>`;
}

function renderBookingsPage() {
  const futureList = document.querySelector('#future-bookings-list');
  const historyList = document.querySelector('#history-bookings-list');
  if (!futureList || !historyList) return;

  const today = new Date().toISOString().slice(0, 10);
  const future = bookings.filter((b) => b.status === 'active' && formatDate(b.date) >= today);
  const history = bookings.filter((b) => b.status !== 'active' || formatDate(b.date) < today);

  futureList.innerHTML = future.length ? future.map((b) => `
    <article class="record-card">
      ${bookingDateBadge(b.date)}
      <div class="rc-info">
        <h3 class="rc-title">${escapeHtml(b.workout_name)}</h3>
        <p class="rc-meta">${formatTime(b.time)} · Тренер ${escapeHtml(b.trainer_name || 'не призначений')}</p>
      </div>
      <div class="rc-actions">
        <button class="ghost-btn" data-booking-details="${b.schedule_id}">Деталі</button>
        <button class="danger-btn" data-cancel-booking="${b.id}">Скасувати</button>
      </div>
    </article>
  `).join('') : `
    <div class="records-empty">
      <div class="records-empty-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="34" height="34">
          <rect x="3" y="4" width="18" height="18" rx="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
          <line x1="8" y1="14" x2="8" y2="14" stroke-width="2.5"/>
          <line x1="12" y1="14" x2="12" y2="14" stroke-width="2.5"/>
          <line x1="16" y1="14" x2="16" y2="14" stroke-width="2.5"/>
        </svg>
      </div>
      <h3>Записів ще немає</h3>
      <p>Оберіть заняття в розкладі — і ми збережемо його тут</p>
      <button class="primary-btn" data-screen-link="schedule">Переглянути розклад</button>
    </div>
  `;

  historyList.innerHTML = history.length ? history.map((b) => {
    const done = b.status === 'active';
    return `
    <article class="record-card">
      ${bookingDateBadge(b.date, true)}
      <div class="rc-info">
        <h3 class="rc-title">${escapeHtml(b.workout_name)}</h3>
        <p class="rc-meta">${formatTime(b.time)} · Тренер ${escapeHtml(b.trainer_name || 'не призначений')}</p>
      </div>
      <span class="rc-status ${done ? 'rc-status--done' : 'rc-status--cancelled'}">${done ? 'Завершено' : 'Скасовано'}</span>
    </article>
  `}).join('') : `
    <div class="records-empty">
      <div class="records-empty-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="34" height="34">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
      </div>
      <h3>Історія порожня</h3>
      <p>Завершені та скасовані тренування з'являться тут</p>
    </div>
  `;
}

async function loadRecordsPage() {
  if (!document.querySelector('#future-bookings-list')) return;
  try {
    bookings = await apiFetch('/bookings/me');
    renderBookingsPage();
  } catch {
    const futureList = document.querySelector('#future-bookings-list');
    if (futureList) {
      futureList.innerHTML = '<article class="record-card"><h3>Не вдалося завантажити записи</h3></article>';
    }
  }
}

async function cancelBooking(bookingId) {
  const booking = bookings.find(b => String(b.id) === String(bookingId));
  const name = booking ? escapeHtml(booking.workout_name || 'тренування') : 'тренування';
  const confirmed = await showActionConfirm(
    `Скасувати запис на ${name}?`,
    'Скасувати запис',
    'danger-btn'
  );
  if (!confirmed) return;
  try {
    await apiFetch(`/bookings/${bookingId}`, { method: 'DELETE' });
    bookings = await apiFetch('/bookings/me').catch(() => bookings);
    await Promise.all([loadRecordsPage(), loadSchedulePage(), loadHomePage()]);
  } catch {
    const futureList = document.querySelector('#future-bookings-list');
    if (futureList) {
      futureList.insertAdjacentHTML('afterbegin', '<p class="form-error">Не вдалося скасувати запис</p>');
    }
  }
}

/**
 * Малює блок «Найближче тренування» на головній — найближче майбутнє
 * заняття, на яке клієнт записаний. Якщо записів немає — пропонує розклад.
 */
function renderNextTraining() {
  const container = document.querySelector('#client-next-training');
  if (!container) {
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const upcomingBookings = bookings
    .filter((booking) => booking.status === 'active' && formatDate(booking.date) >= today)
    .sort((first, second) => (
      `${formatDate(first.date)} ${first.time}`.localeCompare(`${formatDate(second.date)} ${second.time}`)
    ));

  const nextBooking = upcomingBookings[0];
  if (!nextBooking) {
    container.innerHTML = `
      <div class="next-icon-wrap">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>
        </svg>
      </div>
      <div class="next-info">
        <h2>Немає записів</h2>
        <p>Запишіться на заняття у розкладі</p>
      </div>
      <button class="primary-btn" data-screen-link="schedule">До розкладу</button>
    `;
    return;
  }

  const dayLabel = describeDay(nextBooking.date);
  const timeLabel = formatTime(nextBooking.time);

  container.innerHTML = `
    <div class="next-time-badge">
      <span class="next-day">${escapeHtml(dayLabel)}</span>
      <span class="next-hour">${escapeHtml(timeLabel)}</span>
    </div>
    <div class="next-info">
      <h2>${escapeHtml(nextBooking.workout_name)}</h2>
      <p>
        ${nextBooking.duration_minutes ? `<span class="next-dur">${nextBooking.duration_minutes} хв</span> · ` : ''}Тренер: ${escapeHtml(nextBooking.trainer_name || 'не призначений')}
      </p>
    </div>
    <button class="primary-btn" data-booking-details="${nextBooking.schedule_id}">Деталі</button>
  `;
}

/**
 * Малює короткий блок «Мій абонемент» на головній за активним абонементом.
 *
 * @param {object[]} [subscriptions]
 */
function renderHomeSubscription(subscriptions = []) {
  const container = document.querySelector('#client-subscription-summary');
  if (!container) {
    return;
  }

  const activeSubscription = subscriptions.find((item) => (
    item.status === 'active' && new Date(item.end_date) >= new Date()
  ));

  if (!activeSubscription) {
    container.innerHTML = `
      <div class="sub-ring-wrap">
        <svg viewBox="0 0 52 52" width="52" height="52" style="transform:rotate(-90deg)">
          <circle class="ring-track" cx="26" cy="26" r="21" stroke-width="3.5" fill="none"/>
          <circle class="ring-fill" cx="26" cy="26" r="21" stroke-width="3.5" fill="none"
            stroke-dasharray="0 132" stroke-linecap="round"/>
        </svg>
        <span class="sub-ring-label">0%</span>
      </div>
      <div>
        <h2>Немає активного</h2>
        <p>Оберіть тариф у розділі «Абонемент».</p>
      </div>
      <span class="chevron">›</span>
    `;
    return;
  }

  const isSubscription = activeSubscription.plan_type === 'subscription';
  const usageLabel = isSubscription
    ? `${activeSubscription.duration_days || 30} днів`
    : `${activeSubscription.usage_count || 1} відвідування`;

  container.innerHTML = `
    <div class="sub-card">
      <div class="sub-card__content">
        <div class="sub-card__badge">
          <span class="sub-card__dot"></span>Активний
        </div>
        <h3 class="sub-card__name">${escapeHtml(activeSubscription.type || activeSubscription.plan_name || 'Абонемент')}</h3>
        <div class="sub-card__usage">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          ${escapeHtml(usageLabel)}
        </div>
        <div class="sub-dates">
          <div class="sub-date-row">
            <span class="sub-date-icon">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </span>
            <span class="sub-date-label">Початок</span>
            <span class="sub-date-divider"></span>
            <span class="sub-date-val">${fmtLocalDate(activeSubscription.start_date)}</span>
          </div>
          <div class="sub-date-row">
            <span class="sub-date-icon">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </span>
            <span class="sub-date-label">Діє до</span>
            <span class="sub-date-divider"></span>
            <span class="sub-date-val">${fmtLocalDate(activeSubscription.end_date)}</span>
          </div>
        </div>
      </div>
      <div class="sub-card__illo" aria-hidden="true">
        <svg viewBox="0 0 120 100" width="90" height="76" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="10" y="18" width="95" height="64" rx="14" fill="rgba(232,80,2,0.10)"/>
          <rect x="4" y="28" width="6" height="20" rx="3" fill="rgba(232,80,2,0.15)"/>
          <rect x="105" y="28" width="6" height="20" rx="3" fill="rgba(232,80,2,0.15)"/>
          <circle cx="60" cy="50" r="22" fill="rgba(232,80,2,0.10)"/>
          <rect x="34" y="46" width="12" height="8" rx="2" fill="rgba(232,80,2,0.5)"/>
          <rect x="74" y="46" width="12" height="8" rx="2" fill="rgba(232,80,2,0.5)"/>
          <rect x="44" y="48" width="32" height="4" rx="2" fill="rgba(232,80,2,0.5)"/>
          <rect x="32" y="44" width="6" height="12" rx="3" fill="rgba(232,80,2,0.6)"/>
          <rect x="82" y="44" width="6" height="12" rx="3" fill="rgba(232,80,2,0.6)"/>
        </svg>
      </div>
    </div>
  `;
}

/**
 * Малює блок «Розклад на сьогодні» з можливістю запису на заняття.
 */
function renderTodaySchedule() {
  const list = document.querySelector('#client-today-list');
  if (!list) return;

  const today = new Date().toISOString().slice(0, 10);
  const todaySchedules = schedules
    .filter((item) => formatDate(item.date) === today)
    .sort((a, b) => formatTime(a.time).localeCompare(formatTime(b.time)));

  if (todaySchedules.length === 0) {
    list.innerHTML = `
      <div class="tl-count-badge">
        <span class="tl-count-num">0</span>
        <span class="tl-count-label">занять сьогодні</span>
      </div>
      <p class="tl-empty">Сьогодні занять немає — перегляньте інші дні</p>
    `;
    return;
  }

  const countBadge = `
    <div class="tl-count-badge">
      <span class="tl-count-num">${todaySchedules.length}</span>
      <span class="tl-count-label">занять сьогодні</span>
    </div>
  `;

  const items = todaySchedules.map((item) => {
    const isBooked = isAlreadyBooked(item.id);
    const bookingId = isBooked ? getBookingIdBySchedule(item.id) : null;
    const available = Number(item.available || 0);
    const disabled = available <= 0 && !isBooked;

    const actionBtn = isBooked
      ? `<button class="danger-btn small" data-cancel-booking="${bookingId}">Скасувати</button>`
      : `<button class="primary-btn small" data-book-schedule="${item.id}" ${disabled ? 'disabled' : ''}>${available > 0 ? 'Записатись' : 'Немає місць'}</button>`;

    return `
      <div class="tl-item${isBooked ? ' booked' : ''}">
        <div class="tl-time">${formatTime(item.time)}</div>
        <div class="tl-dot"></div>
        <div class="tl-body">
          <strong>${escapeHtml(item.workout_name)}</strong>
          <span>
            ${item.duration_minutes ? `${item.duration_minutes} хв · ` : ''}${escapeHtml(item.trainer_name || 'без тренера')} · ${available > 0 ? `${available} місць` : 'місць немає'}
          </span>
        </div>
        ${actionBtn}
      </div>
    `;
  }).join('');

  list.innerHTML = countBadge + items;
}

/**
 * Завантажує дані для головної сторінки клієнта (розклад, записи, абонемент)
 * і наповнює всі її блоки. Нічого не робить на інших сторінках.
 */
/**
 * Відображає короткий блок антропометрії на головній сторінці.
 * Показує останній запис та динаміку відносно попереднього.
 *
 * @param {object[]} entries — масив вимірів з /anthropometry/me.
 */
function renderHomeAnthro(entries) {
  const container = document.querySelector('#home-anthro-widget');
  if (!container) return;

  if (!entries.length) {
    container.innerHTML = `
      <div class="anthro-home-empty">
        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" width="40" height="40" opacity=".3">
          <circle cx="24" cy="18" r="8"/><path d="M8 42c0-8.8 7.2-16 16-16s16 7.2 16 16"/>
          <path d="M24 34v8M20 38h8" stroke-width="2"/>
        </svg>
        <p>Ще немає вимірів</p>
        <button class="anthro-add-btn" data-screen-link="anthropometry">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="13" height="13"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Додати вимірювання
        </button>
      </div>
    `;
    return;
  }

  const last = entries[0];
  const prev = entries[1] || null;

  // Ключові показники для відображення на дашборді
  const KEY_FIELDS = [
    { key: 'weight', label: 'Вага',   unit: 'кг' },
    { key: 'waist',  label: 'Талія',  unit: 'см' },
    { key: 'chest',  label: 'Груди',  unit: 'см' },
    { key: 'hips',   label: 'Стегна', unit: 'см' },
  ];

  const stats = KEY_FIELDS
    .filter((f) => last[f.key] != null)
    .map((f) => {
      const val = parseFloat(last[f.key]);
      let deltaHtml = '';
      if (prev && prev[f.key] != null) {
        const diff = +(val - parseFloat(prev[f.key])).toFixed(1);
        const sign = diff > 0 ? '+' : '';
        const cls = diff < 0 ? 'anthro-delta--down' : diff > 0 ? 'anthro-delta--up' : 'anthro-delta--same';
        if (diff !== 0) deltaHtml = `<span class="anthro-home-delta ${cls}">${sign}${diff}</span>`;
      }
      return `
        <div class="anthro-home-stat">
          <span class="anthro-home-val">${val}<span class="anthro-home-unit"> ${f.unit}</span></span>
          <span class="anthro-home-lbl">${f.label}</span>
          ${deltaHtml}
        </div>`;
    });

  if (!stats.length) {
    container.innerHTML = `<p class="form-note" style="margin:12px 0;text-align:center">Дані у записі відсутні</p>`;
    return;
  }

  container.innerHTML = `
    <p class="anthro-home-date">${fmtAnthroDate(last.recorded_at)}</p>
    <div class="anthro-home-stats">${stats.join('')}</div>
    <button class="anthro-add-btn" data-screen-link="anthropometry">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="13" height="13"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Нове вимірювання
    </button>
  `;
}

async function loadHomePage() {
  if (!document.querySelector('#client-today-list')) {
    return;
  }

  try {
    const [loadedSchedules, loadedBookings, subscriptions, anthroEntries] = await Promise.all([
      apiFetch('/schedules'),
      apiFetch('/bookings/me'),
      apiFetch('/subscriptions/me'),
      apiFetch('/anthropometry/me').catch(() => []),
    ]);
    schedules = loadedSchedules;
    bookings = loadedBookings;
    renderNextTraining();
    renderHomeSubscription(subscriptions);
    renderTodaySchedule();
    renderHomeAnthro(anthroEntries);
  } catch (error) {
    const list = document.querySelector('#client-today-list');
    if (list) {
      list.innerHTML = `
        <div class="class-card">
          <div class="class-info">
            <h3>Не вдалося завантажити дані</h3>
            <p>${escapeHtml(error.message)}</p>
          </div>
        </div>
      `;
    }
  }
}

/**
 * Витягує час 'гг:хв' із повного часового штампа візиту.
 *
 * @param {string} value — ISO-час (наприклад, visit_time).
 * @returns {string}
 */
function formatTimeFromTimestamp(value) {
  return new Date(value).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Малює стрічку активності: візити в зал і минулі заняття,
 * відсортовані за датою (новіші зверху).
 *
 * @param {object[]} visits — записи з /visits/me.
 * @param {object[]} clientBookings — записи з /bookings/me.
 */
function renderActivity(visits, clientBookings) {
  const list = document.querySelector('#client-activity-list');
  if (!list) {
    return;
  }

  const today = new Date().toISOString().slice(0, 10);

  const visitEntries = visits.map((visit) => ({
    sortKey: `${formatDate(visit.visit_time)} ${formatTimeFromTimestamp(visit.visit_time)}`,
    html: `<p><strong>${formatShortDate(visit.visit_time)}</strong> · Відвідування залу · ${formatTimeFromTimestamp(visit.visit_time)}</p>`,
  }));

  const classEntries = clientBookings
    .filter((booking) => formatDate(booking.date) < today)
    .map((booking) => {
      const statusLabel = booking.status === 'active' ? 'Відвідано' : 'Скасовано';
      return {
        sortKey: `${formatDate(booking.date)} ${formatTime(booking.time)}`,
        html: `<p><strong>${formatShortDate(booking.date)}</strong> · ${escapeHtml(booking.workout_name)} · Тренер ${escapeHtml(booking.trainer_name || 'не призначений')} · ${statusLabel}</p>`,
      };
    });

  const entries = [...visitEntries, ...classEntries]
    .sort((first, second) => second.sortKey.localeCompare(first.sortKey));

  list.innerHTML = entries.length
    ? entries.map((entry) => entry.html).join('')
    : '<p>Активності ще немає. Відвідайте зал або запишіться на заняття.</p>';
}

/**
 * Завантажує дані для сторінки «Моя активність» (візити + минулі записи).
 */
async function loadActivityPage() {
  const list = document.querySelector('#client-activity-list');
  if (!list) {
    return;
  }

  try {
    const [visits, clientBookings] = await Promise.all([
      apiFetch('/visits/me'),
      apiFetch('/bookings/me'),
    ]);
    renderActivity(visits, clientBookings);
  } catch (error) {
    list.innerHTML = `<p>Не вдалося завантажити активність: ${escapeHtml(error.message)}</p>`;
  }
}

// ── Антропометрія ─────────────────────────────────────────────────────────────

const ANTHRO_FIELDS = [
  { key: 'weight', label: 'Вага', unit: 'кг' },
  { key: 'height', label: 'Зріст', unit: 'см' },
  { key: 'chest',  label: 'Груди', unit: 'см' },
  { key: 'waist',  label: 'Талія', unit: 'см' },
  { key: 'hips',   label: 'Стегна', unit: 'см' },
  { key: 'bicep',  label: 'Біцепс', unit: 'см' },
  { key: 'thigh',  label: 'Стегно', unit: 'см' },
];

function fmtAnthroDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderAnthroProgress(entries) {
  const wrap = document.querySelector('#anthro-progress-wrap');
  const grid = document.querySelector('#anthro-progress');
  if (!wrap || !grid || entries.length < 2) {
    if (wrap) wrap.style.display = 'none';
    return;
  }
  const first = entries[entries.length - 1];
  const last = entries[0];
  const rows = ANTHRO_FIELDS
    .filter((f) => first[f.key] != null || last[f.key] != null)
    .map((f) => {
      const a = parseFloat(first[f.key]);
      const b = parseFloat(last[f.key]);
      if (isNaN(a) || isNaN(b)) return '';
      const diff = +(b - a).toFixed(1);
      const sign = diff > 0 ? '+' : '';
      const cls = diff < 0 ? 'anthro-delta--down' : diff > 0 ? 'anthro-delta--up' : 'anthro-delta--same';
      return `<div class="anthro-progress-row">
        <span class="anthro-progress-label">${f.label}</span>
        <span class="anthro-progress-val">${b} ${f.unit}</span>
        <span class="anthro-delta ${cls}">${sign}${diff}</span>
      </div>`;
    }).join('');
  grid.innerHTML = rows || '<p class="form-note">Недостатньо даних</p>';
  wrap.style.display = '';
}

function renderAnthroHistory(entries) {
  const list = document.querySelector('#anthro-history');
  if (!list) return;
  if (!entries.length) {
    list.innerHTML = '<p class="form-note" style="text-align:center;padding:24px 0">Ще немає вимірів — додайте перший!</p>';
    return;
  }
  list.innerHTML = entries.map((e) => {
    const fields = ANTHRO_FIELDS
      .filter((f) => e[f.key] != null)
      .map((f) => `<span class="anthro-chip"><b>${e[f.key]}</b> ${f.unit} ${f.label}</span>`)
      .join('');
    return `<div class="anthro-entry" data-anthro-id="${e.id}">
      <div class="anthro-entry-head">
        <span class="anthro-entry-date">${fmtAnthroDate(e.recorded_at)}</span>
        <button class="anthro-delete-btn" data-id="${e.id}" aria-label="Видалити">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
      ${fields ? `<div class="anthro-chips">${fields}</div>` : ''}
      ${e.note ? `<p class="anthro-note">${escapeHtml(e.note)}</p>` : ''}
    </div>`;
  }).join('');
}

async function loadAnthropometryPage() {
  const saveBtn = document.querySelector('#anthro-save-btn');
  if (!saveBtn) return;

  // Встановити сьогоднішню дату за замовчуванням
  const dateInput = document.querySelector('#anthro-date');
  if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);

  async function reload() {
    try {
      const entries = await apiFetch('/anthropometry/me');
      renderAnthroProgress(entries);
      renderAnthroHistory(entries);
    } catch {
      const h = document.querySelector('#anthro-history');
      if (h) h.innerHTML = '<p class="form-note">Не вдалося завантажити дані</p>';
    }
  }

  await reload();

  // Зберегти новий вимір
  saveBtn.addEventListener('click', async () => {
    const val = (id) => document.querySelector(`#${id}`)?.value.trim() || '';
    const body = {
      recorded_at: val('anthro-date') || new Date().toISOString().slice(0, 10),
      weight: val('af-weight'), height: val('af-height'),
      chest: val('af-chest'),   waist: val('af-waist'),
      hips: val('af-hips'),     bicep: val('af-bicep'),
      thigh: val('af-thigh'),   note: val('af-note'),
    };
    const hasValue = ANTHRO_FIELDS.some((f) => body[f.key] !== '');
    if (!hasValue) {
      setFormNote(document.querySelector('#anthro-feedback'), 'Заповніть хоча б одне поле', 'error');
      return;
    }
    saveBtn.disabled = true;
    try {
      await apiFetch('/anthropometry/me', { method: 'POST', body: JSON.stringify(body) });
      setFormNote(document.querySelector('#anthro-feedback'), 'Збережено ✓', 'success');
      ANTHRO_FIELDS.forEach((f) => { const el = document.querySelector(`#af-${f.key}`); if (el) el.value = ''; });
      const noteEl = document.querySelector('#af-note'); if (noteEl) noteEl.value = '';
      await reload();
      // Підсвічуємо і показуємо новий запис в історії
      const firstEntry = document.querySelector('#anthro-history .anthro-entry');
      if (firstEntry) {
        firstEntry.style.outline = '2px solid var(--accent)';
        firstEntry.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => { firstEntry.style.outline = ''; }, 2500);
      }
    } catch (err) {
      console.error('[anthro save]', err);
      setFormNote(document.querySelector('#anthro-feedback'), `Помилка: ${err.message}`, 'error');
      // Скролимо до повідомлення про помилку щоб воно було видно
      document.querySelector('#anthro-feedback')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } finally {
      saveBtn.disabled = false;
    }
  });

  // Видалити запис (делегування)
  document.querySelector('#anthro-history')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.anthro-delete-btn');
    if (!btn) return;
    if (!await showConfirm('Видалити цей вимір?')) return;
    try {
      await apiFetch(`/anthropometry/me/${btn.dataset.id}`, { method: 'DELETE' });
      await reload();
    } catch (err) {
      setFormNote(document.querySelector('#anthro-feedback'), `Не вдалося видалити: ${err.message}`, 'error');
    }
  });
}

/**
 * Налаштування клієнта: завантажує налаштування з сервера,
 * обробляє зміни і підписку на Web Push.
 */
async function loadSettingsPage() {
  const settingsList = document.querySelector('#client-settings-list');
  if (!settingsList) return;

  const feedback = document.querySelector('#settings-feedback');

  // Динамічно імпортуємо push-модуль
  let pushModule = null;
  try {
    pushModule = await import('./push.js');
  } catch {}

  // ── Завантажити налаштування з сервера ──
  try {
    const prefs = await apiFetch('/push/prefs');
    if (prefs) {
      const trainingEl = settingsList.querySelector('[data-setting="trainingNotifications"]');
      const hourEl     = settingsList.querySelector('[data-setting="hourReminder"]');
      const pushEl     = settingsList.querySelector('[data-setting="pushNotifications"]');
      if (trainingEl) trainingEl.checked = Boolean(prefs.notif_training);
      if (hourEl)     hourEl.checked     = Boolean(prefs.notif_hour_reminder);

      // Push: перевірити реальний стан підписки в браузері
      if (pushEl && pushModule) {
        pushEl.checked = await pushModule.getPushStatus();
      } else if (pushEl) {
        pushEl.checked = Boolean(prefs.notif_push);
      }
    }
  } catch {
    // fallback: нічого не робимо, залишаємо defaults з HTML
  }

  // ── Обробка змін ──
  settingsList.addEventListener('change', async (event) => {
    const input = event.target.closest('[data-setting]');
    if (!input) return;

    const key     = input.dataset.setting;
    const checked = input.checked;

    try {
      if (key === 'pushNotifications') {
        if (!pushModule) {
          setFormNote(feedback, 'Push не підтримується в цьому браузері', 'error');
          input.checked = !checked;
          return;
        }
        if (checked) {
          const result = await pushModule.subscribePush();
          if (!result.ok) {
            setFormNote(feedback, result.error || 'Не вдалось підписатись', 'error');
            input.checked = false;
            return;
          }
        } else {
          await pushModule.unsubscribePush();
        }
        setFormNote(feedback, checked ? 'Push-сповіщення увімкнено' : 'Push-сповіщення вимкнено', 'success');
      } else {
        // trainingNotifications / hourReminder → сервер
        await apiFetch('/push/prefs', {
          method: 'PUT',
          body: JSON.stringify({
            notif_training:      key === 'trainingNotifications' ? checked : undefined,
            notif_hour_reminder: key === 'hourReminder'          ? checked : undefined,
          }),
        });
        setFormNote(feedback, 'Налаштування збережено', 'success');
      }
    } catch (e) {
      setFormNote(feedback, 'Помилка збереження: ' + e.message, 'error');
      input.checked = !checked; // відкотити UI
    }
  });
}

const SUBSCRIPTION_STATUS_LABELS = {
  active: 'Активний',
  expired: 'Завершений',
  cancelled: 'Скасований',
  inactive: 'Неактивний',
};

function renderSubscriptionHistoryBtn(subscriptions) {
  const btn = document.querySelector('#subscription-history-btn');
  if (!btn) return;
  const hasPast = subscriptions.some((s) => s.status !== 'active' || new Date(s.end_date) < new Date());
  if (hasPast || subscriptions.length > 0) {
    btn.hidden = false;
    btn.onclick = () => openSubscriptionHistory(subscriptions);
  }
}

function openSubscriptionHistory(subscriptions) {
  const overlay = document.createElement('div');
  overlay.className = 'custom-confirm-overlay';
  overlay.style.alignItems = 'flex-end';

  const statusLabel = (s) => SUBSCRIPTION_STATUS_LABELS[s.status] || s.status;
  const rows = subscriptions.length
    ? subscriptions.map((s) => `
        <div class="sub-history-row">
          <div class="sub-history-name">${escapeHtml(s.type || s.plan_name || 'Абонемент')}</div>
          <div class="sub-history-meta">
            ${fmtLocalDate(s.start_date)} — ${s.end_date ? fmtLocalDate(s.end_date) : '∞'}
          </div>
          <span class="chip ${s.status === 'active' ? 'active' : ''}" style="font-size:11px">${statusLabel(s)}</span>
        </div>
      `).join('')
    : '<p style="color:var(--muted);text-align:center;padding:16px">Історії немає</p>';

  overlay.innerHTML = `
    <div class="custom-confirm-box" style="width:100%;max-width:480px;border-radius:20px 20px 0 0;max-height:75vh;overflow-y:auto">
      <h3 style="margin:0 0 14px;font-size:17px">Історія абонементів</h3>
      <div class="sub-history-list">${rows}</div>
      <button class="primary-btn" style="margin-top:14px;width:100%" id="sub-hist-close">Закрити</button>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#sub-hist-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

async function loadSubscriptionPage() {
  if (!document.querySelector('#client-plans-grid')) return;

  try {
    setSubscriptionFeedback('Завантаження абонементів...');
    const [plans, subscriptions] = await Promise.all([
      apiFetch('/subscriptions/plans/active'),
      apiFetch('/subscriptions/me'),
    ]);
    activePlans = plans;
    allClientSubscriptions = subscriptions;
    renderCurrentSubscription(subscriptions);
    renderAvailablePlans();
    renderSubscriptionHistoryBtn(subscriptions);
    setSubscriptionFeedback('', '');
  } catch (error) {
    setSubscriptionFeedback(`Не вдалося завантажити абонементи: ${error.message}`, 'error');
    const grid = document.querySelector('#client-plans-grid');
    if (grid) {
      grid.innerHTML = `
        <article class="plan-card">
          <h3>Помилка завантаження</h3>
          <p>Спробуйте оновити сторінку.</p>
        </article>
      `;
    }
  }
}

function openPurchaseModal(plan) {
  currentPlanForPurchase = plan;
  const content = document.querySelector('#purchase-modal-content');
  if (!content || !modal) return;

  content.innerHTML = `
    <p>${escapeHtml(plan.name)}</p>
    <p>Ціна: ${formatMoney(plan.price)}</p>
    <p>${escapeHtml(describePlan(plan))}</p>
    <div class="modal-actions">
      <button class="ghost-btn modal-close">Скасувати</button>
      <button class="primary-btn" id="confirm-purchase">Підтвердити</button>
    </div>
  `;
  modal.classList.add('active');
}

/**
 * Скасовує чинний абонемент клієнта після підтвердження.
 * Після успіху сторінка перезавантажує дані, і кнопки «Придбати» розблоковуються.
 *
 * @returns {Promise<void>}
 */
async function cancelCurrentSubscription() {
  const confirmed = await showConfirm(
    'Скасувати поточний абонемент? Після цього ви зможете придбати новий.',
    'Скасувати абонемент'
  );
  if (!confirmed) {
    return;
  }

  try {
    await apiFetch('/subscriptions/me/cancel', { method: 'POST' });
    setSubscriptionFeedback('Абонемент скасовано. Тепер можна придбати новий.', 'success');
    await loadSubscriptionPage();
  } catch (error) {
    setSubscriptionFeedback(`Не вдалося скасувати абонемент: ${error.message}`, 'error');
  }
}

async function purchaseSelectedPlan() {
  if (!currentPlanForPurchase) return;

  try {
    await apiFetch('/subscriptions/purchase', {
      method: 'POST',
      body: JSON.stringify({ plan_id: currentPlanForPurchase.id }),
    });
    modal.classList.remove('active');
    setSubscriptionFeedback('Абонемент придбано. Оплату створено.', 'success');
    await loadSubscriptionPage();
  } catch (error) {
    setSubscriptionFeedback(`Не вдалося придбати абонемент: ${error.message}`, 'error');
  }
}

document.querySelectorAll('[data-screen], [data-screen-link]').forEach((button) => {
  button.addEventListener('click', () => {
    setScreen(button.dataset.screen || button.dataset.screenLink);
  });
});

document.querySelectorAll('[data-record-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    const tab = button.dataset.recordTab;
    document.querySelectorAll('[data-record-tab]').forEach((item) => {
      item.classList.toggle('active', item.dataset.recordTab === tab);
    });
    document.querySelectorAll('[data-record-panel]').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.recordPanel === tab);
    });
  });
});

document.querySelectorAll('[data-club-dot]').forEach((button) => {
  button.addEventListener('click', () => {
    const slide = button.dataset.clubDot;
    document.querySelectorAll('[data-club-slide]').forEach((item) => {
      item.classList.toggle('active', item.dataset.clubSlide === slide);
    });
    document.querySelectorAll('[data-club-dot]').forEach((item) => {
      item.classList.toggle('active', item.dataset.clubDot === slide);
    });
  });
});

const sheet = document.querySelector('#sheet');

document.querySelectorAll('.sheet-open').forEach((button) => {
  button.addEventListener('click', () => {
    const content = sheetContent[button.dataset.sheet] || sheetContent.yoga;
    document.querySelector('#sheet-title').textContent = content.title;
    document.querySelector('#sheet-text').textContent = content.text;
    const details = sheet.querySelectorAll('dd');
    details[0].textContent = content.duration;
    details[1].textContent = content.level;
    details[2].textContent = content.trainer;
    sheet.classList.add('active');
  });
});

document.querySelector('.sheet-close')?.addEventListener('click', () => {
  sheet?.classList.remove('active');
});

sheet?.addEventListener('click', (event) => {
  if (event.target === sheet) {
    sheet.classList.remove('active');
  }
});

const modal = document.querySelector('#purchase-modal');

document.addEventListener('click', (event) => {
  if (event.target.closest('.logout, .logout-row')) {
    showLogoutConfirm().then((confirmed) => {
      if (!confirmed) return;
      clearAuth();
      window.location.href = PAGE.HOME;
    });
    return;
  }

  const dynamicScreenButton = event.target.closest('[data-screen-link]');
  if (dynamicScreenButton) {
    setScreen(dynamicScreenButton.dataset.screenLink);
    return;
  }

  const dateButton = event.target.closest('[data-schedule-date]');
  if (dateButton) {
    selectedScheduleDate = dateButton.dataset.scheduleDate;
    renderDateStrip();
    renderScheduleList();
    return;
  }

  const workoutFilterButton = event.target.closest('[data-workout-filter]');
  if (workoutFilterButton) {
    selectedWorkoutFilter = workoutFilterButton.dataset.workoutFilter;
    renderScheduleFilters();
    renderScheduleList();
    return;
  }

  const scheduleDetailsButton = event.target.closest('[data-schedule-details], [data-booking-details]');
  if (scheduleDetailsButton) {
    openScheduleDetails(scheduleDetailsButton.dataset.scheduleDetails || scheduleDetailsButton.dataset.bookingDetails);
    return;
  }

  const bookButton = event.target.closest('[data-book-schedule]');
  if (bookButton) {
    bookSchedule(bookButton.dataset.bookSchedule);
    return;
  }

  const cancelButton = event.target.closest('[data-cancel-booking]');
  if (cancelButton) {
    cancelBooking(cancelButton.dataset.cancelBooking);
    return;
  }

  if (event.target.closest('[data-cancel-subscription]')) {
    cancelCurrentSubscription();
    return;
  }

  const purchaseButton = event.target.closest('[data-purchase-plan]');
  if (purchaseButton) {
    const plan = activePlans.find((item) => String(item.id) === purchaseButton.dataset.purchasePlan);
    if (plan) openPurchaseModal(plan);
    return;
  }

  if (event.target.closest('#confirm-purchase')) {
    purchaseSelectedPlan();
    return;
  }

  if (event.target.closest('.modal-open')) {
    modal?.classList.add('active');
    return;
  }

  if (event.target.closest('.modal-close')) {
    modal?.classList.remove('active');
  }
});

modal?.addEventListener('click', (event) => {
  if (event.target === modal) {
    modal.classList.remove('active');
  }
});

// ─── Особисті дані: збереження профілю та зміна пароля ───────────────────────

/**
 * Встановлює текст і тип повідомлення (info/success/error) у полі-нотатці.
 *
 * @param {HTMLElement|null} element
 * @param {string} message
 * @param {string} [type]
 */
function setFormNote(element, message, type = 'info') {
  if (!element) {
    return;
  }
  element.textContent = message;
  element.dataset.type = type;
}

/**
 * Зберігає змінені ім'я та телефон клієнта через PUT /auth/profile
 * і оновлює відображені дані.
 *
 * @param {HTMLFormElement} form
 */
async function saveClientProfile(form) {
  const formData = new FormData(form);
  const feedback = document.querySelector('#profile-feedback');

  const phone = formData.get('phone')?.trim();
  if (phone && phone !== '+380') {
    // Повний номер: +380 + 9 цифр = 13 символів
    if (!/^\+380\d{9}$/.test(phone)) {
      setFormNote(feedback, 'Невірний номер телефону. Введіть у форматі +380XXXXXXXXX (9 цифр після +380)', 'error');
      return;
    }
  }

  try {
    const data = await apiFetch('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify({
        name: formData.get('name')?.trim(),
        phone: (phone && phone !== '+380') ? phone : '',
      }),
    });
    // Оновлюємо токен і кеш користувача, бо ім'я могло змінитися.
    if (data && data.token && data.user) {
      setAuth(data.token, data.user);
    }
    await hydrateAccount({ role: ROLE.CLIENT });
    setFormNote(feedback, 'Дані збережено', 'success');
  } catch (error) {
    setFormNote(feedback, `Не вдалося зберегти: ${error.message}`, 'error');
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
  setFormNote(document.querySelector('#password-feedback'), '');
}

/**
 * Змінює пароль клієнта через PUT /auth/password після перевірки збігу
 * нового пароля та його підтвердження.
 *
 * @param {HTMLFormElement} form
 */
async function changePassword(form) {
  const formData = new FormData(form);
  const feedback = document.querySelector('#password-feedback');
  const newPassword = formData.get('newPassword');

  if (newPassword !== formData.get('confirmPassword')) {
    setFormNote(feedback, 'Паролі не співпадають', 'error');
    return;
  }

  try {
    await apiFetch('/auth/password', {
      method: 'PUT',
      body: JSON.stringify({
        currentPassword: formData.get('currentPassword'),
        newPassword,
      }),
    });
    closePasswordModal();
    setFormNote(document.querySelector('#profile-feedback'), 'Пароль змінено', 'success');
  } catch (error) {
    setFormNote(feedback, `Не вдалося змінити пароль: ${error.message}`, 'error');
  }
}

const clientProfileForm = document.querySelector('#client-profile-form');
clientProfileForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  saveClientProfile(clientProfileForm);
});

const passwordForm = document.querySelector('#password-form');
passwordForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  changePassword(passwordForm);
});

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
initHelpWidget('client');
initModalHotkeys();

const currentUser = await requireFreshAuth([ROLE.CLIENT]);
if (currentUser) {
  hydrateAccount({ role: ROLE.CLIENT });
  loadHomePage();
  loadSchedulePage();
  loadRecordsPage();
  loadSubscriptionPage();
  loadActivityPage();
  loadAnthropometryPage();
  loadSettingsPage();
}
