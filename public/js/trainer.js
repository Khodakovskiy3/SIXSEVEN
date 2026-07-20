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
import { escapeHtml } from './utils.js';
import { hydrateAccount } from './account.js';
import { PAGE, ROLE } from './constants.js';
import { initSidebar } from './sidebar.js';
import { initTheme } from './theme.js';
import { initNotifications } from './notifications.js';
import { initModalHotkeys } from './modal-hotkeys.js';

// Кількість днів у стрічці розкладу (тиждень наперед від сьогодні).
const WEEK_LENGTH = 14;

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

function formatTime(value = '') {
  return String(value).slice(0, 5);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatPillDate(value) {
  return new Date(value).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
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
  const dates = getWeekDates();
  const pillW = window.innerWidth < 720 ? '54px' : '1fr';
  strip.style.gridTemplateColumns = `repeat(${dates.length}, ${pillW})`;
  strip.innerHTML = dates.map((date) => {
    const isActive = date === selectedDate;
    const isToday = date === today;
    const dayCount = schedules.filter((item) => formatDate(item.date) === date && isMine(item)).length;
    return `
      <button class="sched-date-pill${isActive ? ' active' : ''}${isToday ? ' today' : ''}" data-trainer-date="${date}">
        <span class="sdp-weekday">${formatWeekday(date)}</span>
        <strong class="sdp-day">${formatPillDate(date)}</strong>
        <span class="sdp-count">${isToday ? 'Сьогодні' : `${dayCount} зан.`}</span>
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
  const avail = availableSpots(item);
  const fillPct = max > 0 ? Math.round((booked / max) * 100) : 0;
  const isFull = avail === 0 && max > 0;

  const meta = mode === 'mine'
    ? `<span>Записано ${booked}/${max}</span>`
    : `<span>${escapeHtml(item.trainer_name || 'Тренер не призначений')}</span>`;

  const actions = (mode === 'mine' || isMine(item))
    ? `<button class="ghost-btn" data-trainer-details="${item.id}">Деталі</button>
       <button class="primary-btn" data-trainer-clients="${item.id}">Клієнти</button>`
    : `<button class="ghost-btn" data-trainer-details="${item.id}">Деталі</button>`;

  return `
    <div class="sched-card${isFull ? ' sched-card--full' : ''}">
      <div class="sched-card-time">
        <span>${formatTime(item.time)}</span>
        ${item.duration_minutes ? `<span class="sched-duration sched-duration--time">${item.duration_minutes} хв</span>` : ''}
      </div>
      <div class="sched-card-body">
        <div class="sched-card-title">${escapeHtml(item.workout_name || '—')}</div>
        ${meta ? `<div class="sched-card-meta">${meta}</div>` : ''}
        <div class="sched-capacity">
          <div class="sched-capacity-bar"><div class="sched-capacity-fill${isFull ? ' full' : ''}" style="width:${fillPct}%"></div></div>
          ${mode !== 'mine' ? `<span class="sched-capacity-label${isFull ? ' full' : ''}">${booked}/${max}${isFull ? ' · повно' : ''}</span>` : ''}
        </div>
      </div>
      <div class="sched-card-actions">${actions}</div>
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
      : '<div class="sched-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" width="40" height="40" opacity=".35"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg><p>Цього дня у вас немає тренувань</p></div>';
  }

  if (allList) {
    const all = getDaySchedules('all');
    allList.innerHTML = all.length
      ? all.map((item) => buildScheduleCard(item, 'all')).join('')
      : '<div class="sched-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" width="40" height="40" opacity=".35"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg><p>Цього дня занять немає</p></div>';
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
    const [clients, myNotes] = await Promise.all([
      apiFetch(`/trainers/me/schedule/${scheduleId}/clients`),
      apiFetch('/trainers/me/client-notes').catch(() => []),
    ]);
    const active = clients.filter((client) => client.status === 'active');

    if (!active.length) {
      sheetDetails.innerHTML = '<div class="trainer-client-list"><p style="color:var(--muted);text-align:center;padding:24px 0">Ще ніхто не записався</p></div>';
      return;
    }

    // Власні нотатки
    const myNotesMap = {};
    (myNotes || []).forEach((n) => { myNotesMap[n.client_id] = { note: n.note || '', exercises: n.exercises || '' }; });

    // Нотатки всіх тренерів для кожного клієнта
    const allNotesResults = await Promise.all(
      active.map((c) => apiFetch(`/trainers/client-notes-all/${c.client_id}`).catch(() => []))
    );
    const allNotesMap = {};
    active.forEach((c, i) => { allNotesMap[c.client_id] = allNotesResults[i] || []; });

    // Fetch anthropometry for all active clients in parallel
    const anthropoResults = await Promise.all(
      active.map((c) => apiFetch(`/anthropometry/client/${c.client_id}`).catch(() => null))
    );
    const anthropoMap = {};
    active.forEach((c, i) => { anthropoMap[c.client_id] = anthropoResults[i]; });

    const ANTHRO_FIELDS = [
      { key: 'weight', label: 'Вага', unit: 'кг' },
      { key: 'height', label: 'Зріст', unit: 'см' },
      { key: 'chest',  label: 'Груди', unit: 'см' },
      { key: 'waist',  label: 'Талія', unit: 'см' },
      { key: 'hips',   label: 'Стегна', unit: 'см' },
      { key: 'bicep',  label: 'Біцепс', unit: 'см' },
      { key: 'thigh',  label: 'Стегно', unit: 'см' },
    ];

    function renderAnthroBlock(entries) {
      if (!entries || entries.length === 0) {
        return `<p class="trainer-anthro-empty">Антропометрія не заповнена</p>`;
      }
      const renderEntry = (a, idx) => {
        const chips = ANTHRO_FIELDS
          .filter((f) => a[f.key] != null)
          .map((f) => `<span class="trainer-anthro-chip"><b>${a[f.key]}</b> ${f.unit} <span>${f.label}</span></span>`)
          .join('');
        const dateStr = a.recorded_at
          ? new Date(a.recorded_at).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' })
          : '';
        return `
          <div class="trainer-anthro-entry${idx > 0 ? ' trainer-anthro-entry--old' : ''}">
            ${dateStr ? `<p class="trainer-anthro-date">${idx === 0 ? '🕐 Останній вимір: ' : ''}${dateStr}</p>` : ''}
            <div class="trainer-anthro-row">
              ${chips || '<span style="color:var(--muted);font-size:12px">Дані відсутні</span>'}
            </div>
            ${a.note ? `<p class="trainer-anthro-note">${escapeHtml(a.note)}</p>` : ''}
          </div>
        `;
      };
      const visible = entries.slice(0, 3);
      const hidden = entries.slice(3);
      const visibleHtml = visible.map((a, i) => renderEntry(a, i)).join('<hr class="trainer-anthro-divider">');
      if (!hidden.length) return visibleHtml;
      const hiddenId = `anthro-more-${Math.random().toString(36).slice(2)}`;
      const hiddenHtml = hidden.map((a, i) => renderEntry(a, i + 3)).join('<hr class="trainer-anthro-divider">');
      return `${visibleHtml}
        <div class="trainer-anthro-more" id="${hiddenId}" style="display:none">
          <hr class="trainer-anthro-divider">
          ${hiddenHtml}
        </div>
        <button class="ghost-btn trainer-anthro-show-more" data-target="${hiddenId}" style="font-size:12px;margin-top:4px">
          Показати ще ${hidden.length} вимір${hidden.length > 4 ? 'ів' : hidden.length > 1 ? 'и' : ''}
        </button>`;
    }

    sheetDetails.innerHTML = `<div class="trainer-client-list">${
      active.map((client) => {
        const initials = escapeHtml(
          (client.client_name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
        );
        const entry = myNotesMap[client.client_id] || { note: '', exercises: '' };
        const { note, exercises } = entry;
        const hasData = note || exercises;
        const noteId = `note-${client.client_id}`;
        const exId = `ex-${client.client_id}`;
        const areaId = `area-${client.client_id}`;
        const anthro = anthropoMap[client.client_id];
        const anthroId = `anthro-${client.client_id}`;
        const allClientNotes = allNotesMap[client.client_id] || [];
        const otherNotes = allClientNotes.filter((n) => !n.is_mine && (n.note || n.exercises));
        const otherNotesHtml = otherNotes.length
          ? otherNotes.map((n) => `
              <div class="trainer-other-note">
                <p class="trainer-other-note-author">🧑‍🏫 ${escapeHtml(n.trainer_name)}</p>
                ${n.note ? `<p class="trainer-other-note-text">${escapeHtml(n.note)}</p>` : ''}
                ${n.exercises ? `<p class="trainer-other-note-text"><b>Вправи:</b> ${escapeHtml(n.exercises)}</p>` : ''}
              </div>`).join('')
          : '';
        return `
          <div class="trainer-client-card" data-client-id="${client.client_id}">
            <div class="trainer-client-card-header">
              <span>${initials}</span>
              <div class="trainer-client-info">
                <h3>${escapeHtml(client.client_name)}</h3>
                <p class="trainer-client-phone" id="phone-${client.client_id}">${escapeHtml(client.client_phone || client.client_email || '—')}</p>
              </div>
              <div style="display:flex;gap:6px;flex-shrink:0">
                <button class="ghost-btn anthro-toggle-btn" data-anthro="${anthroId}" data-note="${areaId}" style="white-space:nowrap;font-size:12px" aria-label="Антропометрія">📏</button>
                <button class="ghost-btn note-toggle-btn" data-note="${areaId}" data-anthro="${anthroId}" style="white-space:nowrap;font-size:12px">
                  ${hasData ? '✏️ Картка' : '+ Картка'}
                </button>
              </div>
            </div>

            <!-- Антропометрія (read-only, max 3 видимих) -->
            <div class="trainer-note-area" id="${anthroId}">
              <label class="trainer-note-label">Антропометрія клієнта</label>
              ${renderAnthroBlock(anthro)}
            </div>

            <!-- Картка тренера + нотатки інших тренерів -->
            <div class="trainer-note-area${hasData ? ' open' : ''}" id="${areaId}">
              ${otherNotesHtml ? `<div class="trainer-other-notes-list">${otherNotesHtml}</div>` : ''}
              <label class="trainer-note-label">Моя характеристика</label>
              <textarea id="${noteId}" placeholder="Коротка характеристика клієнта, протипоказання…">${escapeHtml(note)}</textarea>
              <label class="trainer-note-label">Мої вправи</label>
              <textarea id="${exId}" placeholder="Вправи, які можна виконувати…">${escapeHtml(exercises)}</textarea>
              <div class="trainer-note-actions">
                <button class="primary-btn save-note-btn" style="font-size:12px;padding:7px 14px"
                  data-client-id="${client.client_id}"
                  data-textarea="${noteId}"
                  data-exercises="${exId}">Зберегти</button>
              </div>
            </div>
          </div>`;
      }).join('')
    }</div>`;
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

/**
 * На вузьких екранах номер телефону клієнта прихований, щоб повністю
 * влазило ім'я — показуємо його лише поки відкрита антропометрія або картка.
 *
 * @param {HTMLElement} toggleBtn — кнопка, що викликала перемикання.
 * @param {HTMLElement|null} anthroArea
 * @param {HTMLElement|null} noteArea
 */
function updateClientPhoneVisibility(toggleBtn, anthroArea, noteArea) {
  const card = toggleBtn.closest('.trainer-client-card');
  const phone = card?.querySelector('.trainer-client-phone');
  if (!phone) return;
  const isOpen = Boolean(anthroArea?.classList.contains('open') || noteArea?.classList.contains('open'));
  phone.classList.toggle('show', isOpen);
}

// ─── Делегування кліків (динамічні кнопки) ──────────────────────────────────────

document.addEventListener('click', async (event) => {
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
    return;
  }

  // "Показати ще" в антропометрії
  const showMoreBtn = event.target.closest('.trainer-anthro-show-more');
  if (showMoreBtn) {
    const target = document.getElementById(showMoreBtn.dataset.target);
    if (target) {
      target.style.display = 'block';
      showMoreBtn.style.display = 'none';
    }
    return;
  }

  // Антропометрія — відкрити, закрити картку
  const anthroToggle = event.target.closest('.anthro-toggle-btn');
  if (anthroToggle) {
    const anthroArea = document.getElementById(anthroToggle.dataset.anthro);
    const noteArea = document.getElementById(anthroToggle.dataset.note);
    if (anthroArea) anthroArea.classList.toggle('open');
    if (noteArea) noteArea.classList.remove('open');
    updateClientPhoneVisibility(anthroToggle, anthroArea, noteArea);
    return;
  }

  // Картка — відкрити, закрити антропометрію
  const noteToggle = event.target.closest('.note-toggle-btn');
  if (noteToggle) {
    const noteArea = document.getElementById(noteToggle.dataset.note);
    const anthroArea = document.getElementById(noteToggle.dataset.anthro);
    if (noteArea) noteArea.classList.toggle('open');
    if (anthroArea) anthroArea.classList.remove('open');
    updateClientPhoneVisibility(noteToggle, anthroArea, noteArea);
    return;
  }

  // Зберегти картку клієнта
  const saveNote = event.target.closest('.save-note-btn');
  if (saveNote) {
    const clientId = saveNote.dataset.clientId;
    const textareaId = saveNote.dataset.textarea;
    const exercisesId = saveNote.dataset.exercises;
    const textarea = document.getElementById(textareaId);
    const exTextarea = document.getElementById(exercisesId);
    if (!textarea) return;

    const note = textarea.value;
    const exercises = exTextarea ? exTextarea.value : '';
    saveNote.disabled = true;
    saveNote.textContent = 'Збереження…';
    try {
      await apiFetch(`/trainers/me/client-notes/${clientId}`, {
        method: 'PUT',
        body: JSON.stringify({ note, exercises }),
      });
      saveNote.textContent = 'Збережено ✓';
      const card = saveNote.closest('[data-client-id]');
      const toggle = card?.querySelector('.note-toggle-btn');
      if (toggle) toggle.textContent = (note.trim() || exercises.trim()) ? '✏️ Картка' : '+ Картка';
    } catch {
      saveNote.textContent = 'Помилка';
    } finally {
      saveNote.disabled = false;
      setTimeout(() => { saveNote.textContent = 'Зберегти'; }, 2000);
    }
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
initTheme();
initNotifications();
initModalHotkeys();

function normalizePhoneInput(value = '') {
  const digits = String(value).replace(/\D/g, '');
  let local = digits.startsWith('380') ? digits.slice(3) : digits.startsWith('0') ? digits.slice(1) : digits;
  return `+380${local.slice(0, 9)}`;
}

function attachPhoneMasks(root = document) {
  root.querySelectorAll('[data-phone-input]').forEach((input) => {
    if (input.dataset.phoneMaskReady) return;
    input.addEventListener('focus', () => { if (!input.value) input.value = '+380'; });
    input.addEventListener('input', () => { input.value = normalizePhoneInput(input.value); });
    input.addEventListener('keydown', (e) => {
      if ((e.key === 'Backspace' || e.key === 'Delete') && input.value.length <= 4) e.preventDefault();
    });
    input.dataset.phoneMaskReady = 'true';
    if (input.value) input.value = normalizePhoneInput(input.value);
  });
}

async function savePersonalData() {
  const nameInput = document.querySelector('[data-account-field="name"]');
  const phoneInput = document.querySelector('[data-account-field="phone"]');
  const saveBtn = document.querySelector('#trainer-personal-save');
  if (!nameInput || !saveBtn) return;

  const name = nameInput.value.trim();
  const phone = phoneInput ? phoneInput.value.trim() : '';
  if (!name) {
    saveBtn.textContent = 'Ім\'я не може бути порожнім';
    setTimeout(() => { saveBtn.textContent = 'Зберегти'; }, 2000);
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Збереження…';
  try {
    await apiFetch('/trainers/me', {
      method: 'PUT',
      body: JSON.stringify({ name, phone }),
    });
    saveBtn.textContent = 'Збережено ✓';
  } catch (err) {
    saveBtn.textContent = 'Помилка';
  } finally {
    saveBtn.disabled = false;
    setTimeout(() => { saveBtn.textContent = 'Зберегти'; }, 2000);
  }
}

const currentUser = await requireFreshAuth([ROLE.TRAINER]);
if (currentUser) {
  hydrateAccount({ role: ROLE.TRAINER });
  loadTrainerData();
  attachPhoneMasks(document);

  document.querySelector('#trainer-personal-save')?.addEventListener('click', savePersonalData);
}
