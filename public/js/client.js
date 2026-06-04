import { apiFetch, clearAuth, formatDate, requireFreshAuth } from './api.js';
import { hydrateAccount } from './account.js';
import { PAGE, ROLE } from './constants.js';

const titles = {
  home: 'Головна',
  schedule: 'Розклад',
  records: 'Записи',
  profile: 'Профіль',
  subscription: 'Абонемент',
  personal: 'Особисті дані',
  activity: 'Моя активність',
  settings: 'Налаштування',
};

let activePlans = [];
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

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('uk-UA', { maximumFractionDigits: 0 })} грн`;
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
 * Формує відсортований перелік майбутніх днів (від сьогодні), на які є заняття.
 * Минулі дні до стрічки не потрапляють — клієнт бачить лише актуальний розклад.
 *
 * @returns {string[]} дати у форматі 'YYYY-MM-DD'.
 */
function getScheduleDates() {
  const today = new Date().toISOString().slice(0, 10);
  const dates = new Set(
    schedules
      .map((item) => formatDate(item.date))
      .filter((date) => date >= today)
  );
  dates.add(today);
  return [...dates].sort();
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
  if (!activeSubscription) {
    container.innerHTML = `
      <span class="chip">Немає активного</span>
      <h3>Активний абонемент відсутній</h3>
      <p>Оберіть один із доступних тарифів нижче.</p>
    `;
    return;
  }

  container.innerHTML = `
    <span class="chip active">Активний</span>
    <h3>${escapeHtml(activeSubscription.type || activeSubscription.plan_name || 'Абонемент')}</h3>
    <p>Початок: ${formatDate(activeSubscription.start_date)}</p>
    <p>Діє до: ${formatDate(activeSubscription.end_date)}</p>
  `;
}

function renderAvailablePlans() {
  const grid = document.querySelector('#client-plans-grid');
  if (!grid) return;

  if (activePlans.length === 0) {
    grid.innerHTML = `
      <article class="plan-card">
        <h3>Немає доступних тарифів</h3>
        <p>Адміністратор поки не увімкнув абонементи для купівлі.</p>
      </article>
    `;
    return;
  }

  grid.innerHTML = activePlans.map((plan, index) => `
    <article class="plan-card ${index === 0 ? 'featured' : ''}">
      <span class="visual-chip">${planTypeLabels[plan.plan_type] || plan.plan_type}</span>
      <h3>${escapeHtml(plan.name)}</h3>
      <p>${escapeHtml(plan.description || describePlan(plan))}</p>
      <p>${escapeHtml(describePlan(plan))}</p>
      <strong>${formatMoney(plan.price)}</strong>
      <button class="primary-btn" data-purchase-plan="${plan.id}">Придбати</button>
    </article>
  `).join('');
}

function renderDateStrip() {
  const strip = document.querySelector('#client-date-strip');
  if (!strip) {
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  strip.innerHTML = getScheduleDates().map((date) => {
    const isActive = date === selectedScheduleDate;
    const dayCount = schedules.filter((item) => formatDate(item.date) === date).length;
    const badge = date === today ? 'Сьогодні' : `${dayCount} зан.`;
    return `
      <button class="date-pill ${isActive ? 'active' : ''}" data-schedule-date="${date}">
        <strong>${formatShortDate(date)}</strong>
        <span>${getDayLabel(date)}</span>
        <small>${badge}</small>
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

function renderScheduleList() {
  const list = document.querySelector('#client-schedule-list');
  if (!list) return;

  const visibleSchedules = schedules.filter((item) => {
    const date = formatDate(item.date);
    const matchesDate = date === selectedScheduleDate;
    const matchesFilter = selectedWorkoutFilter === 'all' || item.workout_name === selectedWorkoutFilter;
    return matchesDate && matchesFilter;
  });

  if (visibleSchedules.length === 0) {
    list.innerHTML = `
      <article class="record-card">
        <h3>Занять не знайдено</h3>
        <p>Оберіть іншу дату або фільтр.</p>
      </article>
    `;
    return;
  }

  list.innerHTML = visibleSchedules.map((item) => {
    const booked = isAlreadyBooked(item.id);
    const available = Number(item.available || 0);
    const disabled = available <= 0 || booked;
    const actionText = booked ? 'Записано' : (available > 0 ? 'Записатися' : 'Недоступно');

    return `
      <div class="class-card ${disabled && !booked ? 'disabled' : ''}">
        <div class="class-time">${formatTime(item.time)}</div>
        <div class="class-info">
          <h3>${escapeHtml(item.workout_name)}</h3>
          <p>Тренер ${escapeHtml(item.trainer_name || 'не призначений')}</p>
          <p>${available > 0 ? `${available} місць` : 'місць немає'}</p>
        </div>
        <div class="class-actions">
          <button class="ghost-btn" data-schedule-details="${item.id}">Опис</button>
          <button class="primary-btn" data-book-schedule="${item.id}" ${disabled ? 'disabled' : ''}>${actionText}</button>
        </div>
      </div>
    `;
  }).join('');
}

async function loadSchedulePage() {
  if (!document.querySelector('#client-schedule-list')) return;

  try {
    setScheduleFeedback('Завантаження розкладу...');
    [schedules, bookings] = await Promise.all([
      apiFetch('/schedules'),
      apiFetch('/bookings/me'),
    ]);
    // На першому завантаженні починаємо з найближчого дня із заняттями,
    // а після запису зберігаємо вже обраний день, якщо він ще доступний.
    const dates = getScheduleDates();
    if (!selectedScheduleDate || !dates.includes(selectedScheduleDate)) {
      selectedScheduleDate = pickDefaultScheduleDate(dates);
    }
    renderDateStrip();
    renderScheduleFilters();
    renderScheduleList();
    setScheduleFeedback(`Занять у розкладі: ${schedules.length}`, 'success');
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
  try {
    await apiFetch('/bookings', {
      method: 'POST',
      body: JSON.stringify({ schedule_id: Number(scheduleId) }),
    });
    setScheduleFeedback('Запис створено', 'success');
    await loadSchedulePage();
  } catch (error) {
    setScheduleFeedback(`Не вдалося записатися: ${error.message}`, 'error');
  }
}

function renderBookingsPage() {
  const futureList = document.querySelector('#future-bookings-list');
  const historyList = document.querySelector('#history-bookings-list');
  if (!futureList || !historyList) return;

  const today = new Date().toISOString().slice(0, 10);
  const future = bookings.filter((booking) => booking.status === 'active' && formatDate(booking.date) >= today);
  const history = bookings.filter((booking) => booking.status !== 'active' || formatDate(booking.date) < today);

  futureList.innerHTML = future.length ? future.map((booking) => `
    <article class="record-card">
      <h3>${escapeHtml(booking.workout_name)}</h3>
      <p>${formatDate(booking.date)} · ${formatTime(booking.time)}</p>
      <p>Тренер ${escapeHtml(booking.trainer_name || 'не призначений')}</p>
      <div class="record-actions">
        <button class="ghost-btn" data-booking-details="${booking.schedule_id}">Деталі</button>
        <button class="danger-btn" data-cancel-booking="${booking.id}">Скасувати</button>
      </div>
    </article>
  `).join('') : `
    <article class="record-card">
      <h3>Немає майбутніх записів</h3>
      <p>Перейдіть у розклад, щоб записатися на заняття.</p>
      <button class="primary-btn" data-screen-link="schedule">Перейти до розкладу</button>
    </article>
  `;

  historyList.innerHTML = history.length ? history.map((booking) => `
    <article class="record-card">
      <h3>${escapeHtml(booking.workout_name)}</h3>
      <p>${formatDate(booking.date)} · ${formatTime(booking.time)}</p>
      <p>${booking.status === 'active' ? 'Завершено' : 'Скасовано'}</p>
    </article>
  `).join('') : `
    <article class="record-card">
      <h3>Історія порожня</h3>
      <p>Минулі тренування з’являться тут автоматично.</p>
    </article>
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
  try {
    await apiFetch(`/bookings/${bookingId}`, { method: 'DELETE' });
    await loadRecordsPage();
  } catch {
    const futureList = document.querySelector('#future-bookings-list');
    if (futureList) {
      futureList.insertAdjacentHTML('afterbegin', '<p class="form-error">Не вдалося скасувати запис</p>');
    }
  }
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
    renderCurrentSubscription(subscriptions);
    renderAvailablePlans();
    setSubscriptionFeedback(`Доступно тарифів: ${activePlans.length}`, 'success');
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

document.querySelector('.sheet-close').addEventListener('click', () => {
  sheet.classList.remove('active');
});

sheet.addEventListener('click', (event) => {
  if (event.target === sheet) {
    sheet.classList.remove('active');
  }
});

const modal = document.querySelector('#purchase-modal');

document.addEventListener('click', (event) => {
  if (event.target.closest('.logout, .logout-row')) {
    clearAuth();
    window.location.href = PAGE.HOME;
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

const currentUser = await requireFreshAuth([ROLE.CLIENT]);
if (currentUser) {
  hydrateAccount({ role: ROLE.CLIENT });
  loadSchedulePage();
  loadRecordsPage();
  loadSubscriptionPage();
}
