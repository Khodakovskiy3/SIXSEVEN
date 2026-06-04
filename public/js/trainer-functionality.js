import {
  apiFetch,
  requireFreshAuth,
  formatDate,
} from './api.js';

import { ROLE } from './constants.js';

const path = location.pathname;

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
// Розклад тренера
// ======================================================

async function renderTrainerSchedule() {
  const schedules = await apiFetch('/trainers/me/schedule');

  addBlock('Мій розклад тренувань', `
    ${
      schedules.length
        ? schedules.map((item) => `
          <article class="card">
            <h3>${esc(item.workout_name)}</h3>

            <p>Дата: <b>${formatDate(item.date)}</b></p>
            <p>Час: <b>${formatTime(item.time)}</b></p>
            <p>Записано клієнтів: <b>${item.booked_count}</b></p>

            <button
              class="primary-btn"
              data-schedule-id="${item.id}"
            >
              Переглянути клієнтів
            </button>
          </article>
        `).join('')
        : '<p>Запланованих тренувань немає.</p>'
    }
  `);
}


// ======================================================
// Список клієнтів на тренування
// ======================================================

function bindScheduleClients() {
  document.addEventListener('click', async (event) => {
    const scheduleId = event.target.dataset.scheduleId;

    if (!scheduleId) return;

    const clients = await apiFetch(`/trainers/me/schedule/${scheduleId}/clients`);

    if (!clients.length) {
      alert('На це тренування ще ніхто не записався');
      return;
    }

    alert(
      clients.map((client, index) => {
        return `${index + 1}. ${client.client_name} | ${client.client_email} | ${client.client_phone || 'телефон не вказано'}`;
      }).join('\n')
    );
  });
}


// ======================================================
// Історія відвідувань
// ======================================================

async function renderTrainerVisits() {
  const visits = await apiFetch('/trainers/me/visits');

  addBlock('Історія відвідувань', `
    ${
      visits.length
        ? visits.map((visit) => `
          <article class="card">
            <h3>${esc(visit.workout_name || 'Тренування')}</h3>
            <p>Клієнт: <b>${esc(visit.client_name)}</b></p>
            <p>Дата: ${formatDate(visit.visit_time || visit.date)}</p>
            <p>Час: ${formatTime(visit.time)}</p>
          </article>
        `).join('')
        : '<p>Історії відвідувань ще немає.</p>'
    }
  `);
}


// ======================================================
// Сповіщення
// ======================================================

async function renderTrainerNotifications() {
  const notifications = await apiFetch('/trainers/me/notifications');

  addBlock('Сповіщення', `
    ${
      notifications.length
        ? notifications.map((item) => `
          <article class="card">
            <h3>${esc(item.title)}</h3>
            <p>${esc(item.message)}</p>
            <small>${formatDate(item.date)}</small>
          </article>
        `).join('')
        : '<p>Нових сповіщень немає.</p>'
    }
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
  initTrainerFunctionality().catch(console.error);
}