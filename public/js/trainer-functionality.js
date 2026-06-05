import {
  apiFetch,
  requireFreshAuth,
  formatDate,
} from './api.js';

import { ROLE } from './constants.js';

const path = location.pathname;

// ======================================================
// Допоміжні функції
// ======================================================

function esc(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function formatTime(value) {
  return String(value || '').slice(0, 5);
}

function addBlock(title, html) {
  const main = document.querySelector('main') || document.body;

  const block = document.createElement('section');
  block.className = 'panel';

  block.innerHTML = `
    <h2>${title}</h2>
    ${html}
  `;

  main.append(block);
}

// ======================================================
// Стилізоване модальне вікно тренера
// Заміна звичайного alert()
// ======================================================

function openTrainerModal(title, html) {
  let modal = document.querySelector('#trainerModal');

  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'trainerModal';
    modal.className = 'trainer-modal';

    modal.innerHTML = `
      <div class="trainer-modal-box">
        <button class="trainer-modal-close" type="button">×</button>
        <h2 id="trainerModalTitle"></h2>
        <div id="trainerModalContent"></div>
      </div>
    `;

    document.body.append(modal);

    modal.querySelector('.trainer-modal-close').addEventListener('click', () => {
      modal.classList.remove('active');
    });

    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        modal.classList.remove('active');
      }
    });
  }

  modal.querySelector('#trainerModalTitle').textContent = title;
  modal.querySelector('#trainerModalContent').innerHTML = html;
  modal.classList.add('active');
}

// ======================================================
// Розклад тренера
// ======================================================

async function renderTrainerSchedule() {
  const schedules = await apiFetch('/trainers/me/schedule');

  addBlock('Мій розклад тренувань', `
    <div class="trainer-schedule-grid">
      ${
        schedules.length
          ? schedules.map((item) => `
            <article class="trainer-schedule-card">
              <div class="trainer-schedule-header">
                <h3>${esc(item.workout_name)}</h3>
                <span>${formatTime(item.time)}</span>
              </div>

              <div class="trainer-schedule-info">
                <p><b>Дата:</b> ${formatDate(item.date)}</p>
                <p><b>Записано:</b> ${item.booked_count} клієнтів</p>
              </div>

              <button
                class="primary-btn trainer-schedule-btn"
                data-schedule-id="${item.id}"
              >
                Переглянути клієнтів
              </button>
            </article>
          `).join('')
          : '<p class="form-note">Запланованих тренувань немає.</p>'
      }
    </div>
  `);
}

// ======================================================
// Список клієнтів на тренування
// ======================================================

function bindScheduleClients() {
  document.addEventListener('click', async (event) => {
    const target = event.target;

    if (!(target instanceof HTMLElement)) return;

    const button = target.closest('[data-schedule-id]');

    if (!button) return;

    const scheduleId = button.dataset.scheduleId;

    if (!scheduleId) return;

    try {
      const clients = await apiFetch(`/trainers/me/schedule/${scheduleId}/clients`);

      if (!clients.length) {
        openTrainerModal(
          'Клієнти на тренуванні',
          '<p class="form-note">На це тренування ще ніхто не записався.</p>'
        );

        return;
      }

      openTrainerModal(
        'Клієнти на тренуванні',
        `
          <div class="trainer-client-list">
            ${
              clients.map((client, index) => `
                <article class="trainer-client-card">
                  <span>${index + 1}</span>

                  <div>
                    <h3>${esc(client.client_name)}</h3>
                    <p><b>Email:</b> ${esc(client.client_email || 'не вказано')}</p>
                    <p><b>Телефон:</b> ${esc(client.client_phone || 'телефон не вказано')}</p>
                    <p><b>Статус:</b> ${esc(client.status || 'active')}</p>
                  </div>
                </article>
              `).join('')
            }
          </div>
        `
      );
    } catch (error) {
      openTrainerModal(
        'Помилка',
        `<p class="form-note">${esc(error.message || 'Не вдалося завантажити клієнтів.')}</p>`
      );
    }
  });
}

// ======================================================
// Історія відвідувань
// ======================================================

async function renderTrainerVisits() {
  const visits = await apiFetch('/trainers/me/visits');

  addBlock('Історія відвідувань', `
    <div class="trainer-schedule-grid">
      ${
        visits.length
          ? visits.map((visit) => `
            <article class="trainer-schedule-card">
              <div class="trainer-schedule-header">
                <h3>${esc(visit.workout_name || 'Тренування')}</h3>
                <span>${formatTime(visit.time)}</span>
              </div>

              <div class="trainer-schedule-info">
                <p><b>Клієнт:</b> ${esc(visit.client_name)}</p>
                <p><b>Дата:</b> ${formatDate(visit.visit_time || visit.date)}</p>
              </div>
            </article>
          `).join('')
          : '<p class="form-note">Історії відвідувань ще немає.</p>'
      }
    </div>
  `);
}

// ======================================================
// Сповіщення
// ======================================================

async function renderTrainerNotifications() {
  const notifications = await apiFetch('/trainers/me/notifications');

  addBlock('Сповіщення', `
    <div class="trainer-schedule-grid">
      ${
        notifications.length
          ? notifications.map((item) => `
            <article class="trainer-schedule-card">
              <div class="trainer-schedule-header">
                <h3>${esc(item.title)}</h3>
              </div>

              <div class="trainer-schedule-info">
                <p>${esc(item.message)}</p>
                <p><b>Дата:</b> ${formatDate(item.date)}</p>
              </div>
            </article>
          `).join('')
          : '<p class="form-note">Нових сповіщень немає.</p>'
      }
    </div>
  `);
}

// ======================================================
// Запуск функціоналу тренера
// ======================================================

async function initTrainerFunctionality() {
  await requireFreshAuth([ROLE.TRAINER]);

  if (
    path.includes('/trainer/index.html') ||
    path.includes('/trainer/schedule.html') ||
    path.endsWith('/trainer/')
  ) {
    await renderTrainerSchedule();
    bindScheduleClients();
  }

  if (
    path.includes('/trainer/index.html') ||
    path.includes('/trainer/activity.html')
  ) {
    await renderTrainerVisits();
  }

  if (
    path.includes('/trainer/index.html') ||
    path.includes('/trainer/notifications.html')
  ) {
    await renderTrainerNotifications();
  }
}

if (path.includes('/trainer/')) {
  initTrainerFunctionality().catch((error) => {
    console.error(error);
  });
}