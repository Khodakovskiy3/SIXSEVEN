/**
 * Логіка кабінету тренера.
 *
 * Сторінка «Розклад»: тиждень від сьогодні, вкладки «Мої / Усі тренування»,
 * заняття обраного дня з деталями та списком записаних клієнтів.
 * Головна: кількість занять сьогодні, найближче заняття, сьогоднішні заняття
 * та мій розклад тренувань. Дані підтягуються з /trainers/me та /schedules,
 * список клієнтів — з /trainers/me/schedule/:id/clients.
 */

import { apiFetch, clearAuth, formatDate, requireFreshAuth } from './api.js';
import { hydrateAccount } from './account.js';
import { PAGE, ROLE } from './constants.js';
import { initSidebar } from './sidebar.js';

// Кількість днів у стрічці розкладу (тиждень наперед від сьогодні).
const WEEK_LENGTH = 7;

const titles = {
  home: 'Головна',
  schedule: 'Розклад',
  profile: 'Профіль',
  personal: 'Особисті дані',
  specialization: 'Моя спеціалізація',
  settings: 'Налаштування',
};

const pageRoutes = {
  home: '/pages/trainer/index.html',
  schedule: '/pages/trainer/schedule.html',
  profile: '/pages/trainer/profile.html',
  personal: '/pages/trainer/personal.html',
  specialization: '/pages/trainer/specialization.html',
  settings: '/pages/trainer/settings.html',
};

let schedules = [];
let myTrainerId = null;
let selectedDate = new Date().toISOString().slice(0, 10);

// ─── Навігація ────────────────────────────────────────────────────────────────

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

// Перемикання вкладок «Мої / Усі тренування»: обидві панелі вже відрендерені,
// тож лише показуємо потрібну.
document.querySelectorAll('[data-mode-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    const mode = button.dataset.modeTab;
    document.querySelectorAll('[data-mode-tab]').forEach((item) => {
      item.classList.toggle('active', item.dataset.modeTab === mode);
    });
    document.querySelectorAll('[data-mode-panel]').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.modePanel === mode);
    });
  });
});

// ─── Допоміжні функції ─────────────────────────────────────────────────────────

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatTime(value = '') {
  return String(value).slice(0, 5);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatPillDate(value) {
  return new Date(value).toLocaleDateString('uk-UA', { day: '2-digit', month: 'short' });
}

function formatWeekday(value) {
  return new Date(value).toLocaleDateString('uk-UA', { weekday: 'short' });
}

/**
 * Описує день людською мовою: «Сьогодні», «Завтра» або 'дд.мм'.
 *
 * @param {string} value
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

function availableSpots(item) {
  return Math.max(Number(item.max_clients || 0) - Number(item.booked || 0), 0);
}

function isMine(item) {
  return String(item.trainer_id) === String(myTrainerId);
}

// ─── Розклад: стрічка тижня та списки ───────────────────────────────────────────

/**
 * Повертає 7 дат тижня, починаючи з сьогодні, у форматі 'YYYY-MM-DD'.
 *
 * @returns {string[]}
 */
function getWeekDates() {
  const today = new Date();
  return Array.from({ length: WEEK_LENGTH }, (unused, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

function renderDateStrip() {
  const strip = document.querySelector('#trainer-date-strip');
  if (!strip) {
    return;
  }

  const today = todayIso();
  strip.innerHTML = getWeekDates().map((date) => {
    const isActive = date === selectedDate;
    const dayCount = schedules.filter((item) => formatDate(item.date) === date && isMine(item)).length;
    const badge = date === today ? 'Сьогодні' : `${dayCount} занять`;
    return `
      <button class="date-pill ${isActive ? 'active' : ''}" data-trainer-date="${date}">
        <strong>${formatPillDate(date)}</strong>
        <span>${formatWeekday(date)}</span>
        <small>${badge}</small>
      </button>
    `;
  }).join('');
}

/**
 * Повертає заняття обраного дня для режиму «mine» (лише мої) або «all».
 *
 * @param {'mine'|'all'} mode
 * @returns {object[]}
 */
function getDaySchedules(mode) {
  return schedules
    .filter((item) => formatDate(item.date) === selectedDate)
    .filter((item) => mode === 'all' || isMine(item))
    .sort((first, second) => formatTime(first.time).localeCompare(formatTime(second.time)));
}

function buildScheduleCard(item, mode) {
  const max = Number(item.max_clients || 0);
  const booked = Number(item.booked || 0);
  const secondLine = mode === 'mine'
    ? `Записано ${booked}/${max}`
    : `Тренер ${escapeHtml(item.trainer_name || 'не призначений')}`;
  const clientsButton = mode === 'mine'
    ? `<button class="primary-btn" data-trainer-clients="${item.id}">Клієнти</button>`
    : '';

  return `
    <div class="class-card">
      <div class="class-time">${formatTime(item.time)}</div>
      <div class="class-info">
        <h3>${escapeHtml(item.workout_name || '—')}</h3>
        <p>${secondLine}</p>
        <p>Вільно ${availableSpots(item)} місць</p>
      </div>
      <div class="class-actions">
        <button class="ghost-btn" data-trainer-details="${item.id}">Деталі</button>
        ${clientsButton}
      </div>
    </div>
  `;
}

function renderScheduleLists() {
  const mineList = document.querySelector('#trainer-list-mine');
  const allList = document.querySelector('#trainer-list-all');

  if (mineList) {
    const mine = getDaySchedules('mine');
    mineList.innerHTML = mine.length
      ? mine.map((item) => buildScheduleCard(item, 'mine')).join('')
      : '<div class="class-card"><div class="class-info"><h3>Цього дня у вас немає тренувань</h3></div></div>';
  }

  if (allList) {
    const all = getDaySchedules('all');
    allList.innerHTML = all.length
      ? all.map((item) => buildScheduleCard(item, 'all')).join('')
      : '<div class="class-card"><div class="class-info"><h3>Цього дня занять немає</h3></div></div>';
  }
}

// ─── Деталі та клієнти заняття (нижня панель) ───────────────────────────────────

const sheet = document.querySelector('#sheet');
const sheetTitle = document.querySelector('#sheet-title');
const sheetText = document.querySelector('#sheet-text');
const sheetDetails = document.querySelector('#sheet-details');

function openScheduleDetails(scheduleId) {
  const item = schedules.find((schedule) => String(schedule.id) === String(scheduleId));
  if (!item || !sheet) {
    return;
  }

  const max = Number(item.max_clients || 0);
  const booked = Number(item.booked || 0);
  sheetTitle.textContent = item.workout_name || 'Заняття';
  sheetText.textContent = item.workout_description || 'Опис заняття не додано.';
  sheetDetails.innerHTML = `
    <div><dt>Дата</dt><dd>${formatDate(item.date)}</dd></div>
    <div><dt>Час</dt><dd>${formatTime(item.time)}</dd></div>
    <div><dt>Тренер</dt><dd>${escapeHtml(item.trainer_name || 'не призначений')}</dd></div>
    <div><dt>Заповнення</dt><dd>${booked}/${max} · вільно ${availableSpots(item)}</dd></div>
  `;
  sheet.classList.add('active');
}

async function openScheduleClients(scheduleId) {
  const item = schedules.find((schedule) => String(schedule.id) === String(scheduleId));
  if (!sheet) {
    return;
  }

  sheetTitle.textContent = `Клієнти · ${item ? escapeHtml(item.workout_name || 'заняття') : 'заняття'}`;
  sheetText.textContent = '';
  sheetDetails.innerHTML = '<div><dt>Завантаження…</dt><dd></dd></div>';
  sheet.classList.add('active');

  try {
    const clients = await apiFetch(`/trainers/me/schedule/${scheduleId}/clients`);
    const active = clients.filter((client) => client.status === 'active');
    sheetDetails.innerHTML = active.length
      ? active
        .map((client) => `
          <div>
            <dt>${escapeHtml(client.client_name)}</dt>
            <dd>${escapeHtml(client.client_phone || client.client_email || '—')}</dd>
          </div>
        `).join('')
      : '<div><dt>Ще ніхто не записався</dt><dd></dd></div>';
  } catch (error) {
    sheetDetails.innerHTML = `<div><dt>Помилка</dt><dd>${escapeHtml(error.message)}</dd></div>`;
  }
}

sheet?.querySelector('.sheet-close')?.addEventListener('click', () => {
  sheet.classList.remove('active');
});

sheet?.addEventListener('click', (event) => {
  if (event.target === sheet) {
    sheet.classList.remove('active');
  }
});

// ─── Головна сторінка тренера ───────────────────────────────────────────────────

function buildMiniSession(item) {
  const max = Number(item.max_clients || 0);
  const booked = Number(item.booked || 0);
  return `
    <button class="mini-session" data-trainer-details="${item.id}">
      <strong>${formatTime(item.time)}</strong>
      <span>${escapeHtml(item.workout_name || '—')} · ${booked}/${max} клієнтів</span>
    </button>
  `;
}

function renderTrainerHome() {
  const countEl = document.querySelector('#trainer-today-count');
  if (!countEl) {
    return;
  }

  const today = todayIso();
  const myUpcoming = schedules
    .filter((item) => isMine(item) && formatDate(item.date) >= today)
    .sort((first, second) => (
      `${formatDate(first.date)} ${first.time}`.localeCompare(`${formatDate(second.date)} ${second.time}`)
    ));
  const myToday = myUpcoming.filter((item) => formatDate(item.date) === today);

  countEl.textContent = String(myToday.length);

  const nextContainer = document.querySelector('#trainer-next-training');
  const nextItem = myUpcoming[0];
  if (nextContainer) {
    nextContainer.innerHTML = nextItem
      ? `
        <div class="training-main">
          <div>
            <h2>${escapeHtml(nextItem.workout_name || '—')}</h2>
            <p>${describeDay(nextItem.date)} · ${formatTime(nextItem.time)}</p>
            <p>Записано ${Number(nextItem.booked || 0)}/${Number(nextItem.max_clients || 0)}</p>
          </div>
          <button class="primary-btn" data-trainer-details="${nextItem.id}">Деталі</button>
        </div>
      `
      : '<div class="training-main"><div><h2>Немає запланованих занять</h2><p>Розклад порожній.</p></div></div>';
  }

  const todayList = document.querySelector('#trainer-today-list');
  if (todayList) {
    todayList.innerHTML = myToday.length
      ? myToday.map(buildMiniSession).join('')
      : '<p class="form-note">Сьогодні занять немає.</p>';
  }

  const upcomingList = document.querySelector('#trainer-upcoming-list');
  if (upcomingList) {
    upcomingList.innerHTML = myUpcoming.length
      ? myUpcoming.map(buildMiniSession).join('')
      : '<p class="form-note">Майбутніх тренувань немає.</p>';
  }
}

// ─── Делегування кліків (динамічні кнопки) ──────────────────────────────────────

document.addEventListener('click', (event) => {
  const dateButton = event.target.closest('[data-trainer-date]');
  if (dateButton) {
    selectedDate = dateButton.dataset.trainerDate;
    renderDateStrip();
    renderScheduleLists();
    return;
  }

  const detailsButton = event.target.closest('[data-trainer-details]');
  if (detailsButton) {
    openScheduleDetails(detailsButton.dataset.trainerDetails);
    return;
  }

  const clientsButton = event.target.closest('[data-trainer-clients]');
  if (clientsButton) {
    openScheduleClients(clientsButton.dataset.trainerClients);
  }
});

// ─── Зміна пароля (модалка на сторінках із кнопкою) ──────────────────────────────

const passwordModal = document.querySelector('#password-modal');

document.querySelectorAll('.modal-open').forEach((button) => {
  button.addEventListener('click', () => passwordModal?.classList.add('active'));
});

document.querySelectorAll('.modal-close').forEach((button) => {
  button.addEventListener('click', () => passwordModal?.classList.remove('active'));
});

passwordModal?.addEventListener('click', (event) => {
  if (event.target === passwordModal) {
    passwordModal.classList.remove('active');
  }
});

// ─── Завантаження даних ──────────────────────────────────────────────────────────

/**
 * Підтягує мій профіль тренера та повний розклад, після чого наповнює
 * сторінку розкладу й/або головну (залежно від наявних контейнерів).
 */
async function loadTrainerData() {
  if (!document.querySelector('#trainer-date-strip, #trainer-today-count')) {
    return;
  }

  try {
    const [me, allSchedules] = await Promise.all([
      apiFetch('/trainers/me'),
      apiFetch('/schedules'),
    ]);
    myTrainerId = me.id;
    schedules = allSchedules;

    renderDateStrip();
    renderScheduleLists();
    renderTrainerHome();
  } catch (error) {
    const feedback = document.querySelector('#trainer-schedule-feedback');
    if (feedback) {
      feedback.textContent = `Не вдалося завантажити розклад: ${error.message}`;
      feedback.dataset.type = 'error';
    }
  }
}

// ─── Старт ───────────────────────────────────────────────────────────────────────

initSidebar();

const currentUser = await requireFreshAuth([ROLE.TRAINER]);
if (currentUser) {
  hydrateAccount({ role: ROLE.TRAINER });
  loadTrainerData();
}
