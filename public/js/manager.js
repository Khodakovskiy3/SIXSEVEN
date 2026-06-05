import {
  apiFetch,
  clearAuth,
  formatDate,
  requireFreshAuth,
} from './api.js';

import { hydrateAccount } from './account.js';
import { PAGE, ROLE } from './constants.js';

const currentPath = location.pathname;

const titles = {
  dashboard: 'Панель керування',
  users: 'Користувачі',
  analytics: 'Аналітика',
  profile: 'Мій профіль',
  personal: 'Особисті дані',
  'profile-settings': 'Сповіщення',
};

const pageRoutes = {
  dashboard: '/pages/manager/index.html',
  users: '/pages/manager/users.html',
  analytics: '/pages/manager/analytics.html',
  profile: '/pages/manager/profile.html',
  personal: '/pages/manager/personal.html',
  'profile-settings': '/pages/manager/settings.html',
};

function esc(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function money(value) {
  return `${Number(value || 0).toLocaleString('uk-UA')} грн`;
}

function number(value) {
  return Number(value || 0).toLocaleString('uk-UA');
}

function roleText(role) {
  const roles = {
    client: 'Клієнт',
    trainer: 'Тренер',
    admin: 'Адміністратор',
    manager: 'Менеджер',
  };

  return roles[role] || role;
}

function setScreen(screen) {
  const nextScreen = titles[screen] ? screen : 'dashboard';

  if (!document.querySelector(`[data-screen-panel="${nextScreen}"]`) && pageRoutes[nextScreen]) {
    window.location.href = pageRoutes[nextScreen];
    return;
  }

  const activeNav = ['personal', 'profile-settings'].includes(nextScreen)
    ? 'profile'
    : nextScreen;

  document.querySelectorAll('.screen').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.screenPanel === nextScreen);
  });

  document.querySelectorAll('[data-screen]').forEach((button) => {
    button.classList.toggle('active', button.dataset.screen === activeNav);
  });

  const title = document.querySelector('#screen-title');

  if (title) {
    title.textContent = titles[nextScreen];
  }
}

function simpleBars(items, labelKey, valueKey, suffix = '') {
  const max = Math.max(...items.map((item) => Number(item[valueKey] || 0)), 1);

  return `
    <div class="manager-chart">
      ${
        items.length
          ? items.map((item) => {
              const value = Number(item[valueKey] || 0);
              const width = Math.max((value / max) * 100, 4);

              return `
                <div class="manager-chart-row">
                  <span>${esc(formatDate(item[labelKey]) || item[labelKey])}</span>
                  <div class="manager-chart-line">
                    <i style="width:${width}%"></i>
                  </div>
                  <b>${number(value)}${suffix}</b>
                </div>
              `;
            }).join('')
          : '<p class="form-note">Даних за обраний період немає.</p>'
      }
    </div>
  `;
}

async function loadManagerReport() {
  const startInput = document.querySelector('[data-manager-start]');
  const endInput = document.querySelector('[data-manager-end]');

  const params = new URLSearchParams();

  if (startInput?.value) {
    params.set('start', startInput.value);
  }

  if (endInput?.value) {
    params.set('end', endInput.value);
  }

  const query = params.toString();

  return await apiFetch(`/reports/manager${query ? `?${query}` : ''}`);
}

async function renderManagerDashboard() {
  const panel = document.querySelector('[data-screen-panel="dashboard"]');

  if (!panel) return;

  const report = await loadManagerReport();
  const summary = report.summary;

  panel.innerHTML = `
    <div class="manager-page-head">
      <div>
        <h2>Панель менеджера</h2>
        <p>Аналіз діяльності спортивного клубу та управлінські показники.</p>
      </div>

      <button class="primary-btn" data-refresh-manager>Оновити</button>
    </div>

    <div class="manager-stats-grid">
      <article><span>Користувачів</span><strong>${number(summary.total_users)}</strong></article>
      <article><span>Клієнтів</span><strong>${number(summary.total_clients)}</strong></article>
      <article><span>Тренерів</span><strong>${number(summary.total_trainers)}</strong></article>
      <article><span>Активних абонементів</span><strong>${number(summary.active_subscriptions)}</strong></article>
      <article><span>Дохід</span><strong>${money(summary.revenue)}</strong></article>
      <article><span>Середній платіж</span><strong>${money(summary.average_payment)}</strong></article>
    </div>

    <div class="manager-two-columns">
      <section class="panel">
        <h3>Дохід за період</h3>
        ${simpleBars(report.revenueByDay, 'date', 'revenue', ' грн')}
      </section>

      <section class="panel">
        <h3>Відвідуваність</h3>
        ${simpleBars(report.visitsByDay, 'date', 'visits_count')}
      </section>
    </div>
  `;
}

async function renderManagerAnalytics() {
  const panel = document.querySelector('[data-screen-panel="analytics"]');

  if (!panel) return;

  const report = await loadManagerReport();
  const summary = report.summary;

  panel.innerHTML = `
    <div class="manager-page-head">
      <div>
        <h2>Аналітика</h2>
        <p>Фінанси, оплати, відвідуваність та робота персоналу.</p>
      </div>

      <div class="manager-period">
        <input type="date" data-manager-start value="${report.period.start}">
        <input type="date" data-manager-end value="${report.period.end}">
        <button class="primary-btn" data-refresh-manager>Показати</button>
      </div>
    </div>

    <div class="manager-stats-grid">
      <article><span>Дохід</span><strong>${money(summary.revenue)}</strong></article>
     <article class="manager-click-card" data-open-payments>
  <span>Кількість оплат</span>
  <strong>${number(summary.payments_count)}</strong>
  <small>Натисніть, щоб переглянути всі оплати</small>
</article>
      <article><span>Середній платіж</span><strong>${money(summary.average_payment)}</strong></article>
      <article><span>Відвідувань</span><strong>${number(summary.visits_count)}</strong></article>
    </div>

    <div class="manager-two-columns">
      <section class="panel">
        <h3>Графік доходів</h3>
        ${simpleBars(report.revenueByDay, 'date', 'revenue', ' грн')}
      </section>

      <section class="panel">
        <h3>Графік відвідуваності</h3>
        ${simpleBars(report.visitsByDay, 'date', 'visits_count')}
      </section>
    </div>

    <section class="panel">
      <h3>Завантаженість тренерів</h3>

      <div class="manager-table">
        <div class="manager-table-head">
          <span>Тренер</span>
          <span>Занять</span>
          <span>Записів</span>
          <span>Ефективність</span>
        </div>

        ${
          report.trainerLoad.length
            ? report.trainerLoad.map((trainer) => {
                const efficiency = trainer.sessions_count
                  ? Math.round((trainer.bookings_count / trainer.sessions_count) * 10) / 10
                  : 0;

                return `
                  <div class="manager-table-row">
                    <span>${esc(trainer.trainer_name)}</span>
                    <span>${number(trainer.sessions_count)}</span>
                    <span>${number(trainer.bookings_count)}</span>
                    <span>${efficiency} клієнта/заняття</span>
                  </div>
                `;
              }).join('')
            : '<p class="form-note">Даних по тренерах немає.</p>'
        }
      </div>
    </section>
  `;
}

async function renderManagerUsers() {
  const panel = document.querySelector('[data-screen-panel="users"]');

  if (!panel) return;

  const users = await apiFetch('/users');

  panel.innerHTML = `
    <div class="manager-page-head">
      <div>
        <h2>Користувачі системи</h2>
        <p>Перегляд, пошук, контроль та зміна ролей користувачів.</p>
      </div>

      <button class="primary-btn" data-refresh-users>Оновити</button>
    </div>

    <div class="manager-search">
      <input
        type="text"
        id="managerUserSearch"
        placeholder="Пошук користувача за ім’ям, email або роллю..."
      >
    </div>

    <div class="manager-table manager-users-table">
      <div class="manager-table-head">
        <span>Ім’я</span>
        <span>Email</span>
        <span>Роль</span>
        <span>Дія</span>
      </div>

      ${
        users.length
          ? users.map((user) => {
              const searchText = `${user.name || ''} ${user.email || ''} ${user.role || ''}`.toLowerCase();

              return `
                <div
                  class="manager-table-row manager-user-row"
                  data-user-search="${esc(searchText)}"
                >
                  <span>${esc(user.name)}</span>
                  <span>${esc(user.email)}</span>

                  <span>
                    <select data-user-role="${user.id}">
                      <option value="client" ${user.role === 'client' ? 'selected' : ''}>Клієнт</option>
                      <option value="trainer" ${user.role === 'trainer' ? 'selected' : ''}>Тренер</option>
                      <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Адміністратор</option>
                      <option value="manager" ${user.role === 'manager' ? 'selected' : ''}>Менеджер</option>
                    </select>
                  </span>

                  <span>
                    <button class="ghost-btn" data-user-details="${user.id}">Деталі</button>
                    <button class="primary-btn" data-save-role="${user.id}">Зберегти роль</button>
                  </span>
                </div>
              `;
            }).join('')
          : '<p class="form-note">Користувачів немає.</p>'
      }
    </div>

    <p id="managerSearchEmpty" class="form-note" style="display:none;">
      Користувача не знайдено.
    </p>
  `;

  bindManagerUserSearch();
}

function bindManagerUserSearch() {
  const input = document.querySelector('#managerUserSearch');
  const rows = document.querySelectorAll('.manager-user-row');
  const empty = document.querySelector('#managerSearchEmpty');

  if (!input) return;

  input.addEventListener('input', () => {
    const value = input.value.trim().toLowerCase();
    let visibleCount = 0;

    rows.forEach((row) => {
      const searchableText = row.dataset.userSearch || '';
      const isVisible = searchableText.includes(value);

      row.style.display = isVisible ? '' : 'none';

      if (isVisible) visibleCount += 1;
    });

    if (empty) {
      empty.style.display = visibleCount === 0 ? 'block' : 'none';
    }
  });
}

const sheet = document.querySelector('#sheet');
const sheetTitle = document.querySelector('#sheet-title');
const sheetContentBox = document.querySelector('#sheet-content');

function openSheet(title, html) {
  if (!sheet || !sheetTitle || !sheetContentBox) {
    alert(`${title}\n\n${html.replace(/<[^>]*>/g, '')}`);
    return;
  }

  sheetTitle.textContent = title;
  sheetContentBox.innerHTML = html;
  sheet.classList.add('active');
}

async function openPaymentsList() {
  try {
    const payments = await apiFetch('/reports/payments-list');

    openSheet(
      'Список оплат',
      `
        <div class="manager-payments-list">
          ${
            payments.length
              ? payments.map((payment) => `
                <article class="manager-payment-card">
                  <h3>${esc(payment.client_name || 'Невідомий клієнт')}</h3>
                  <p><b>Email:</b> ${esc(payment.client_email || 'не вказано')}</p>
                  <p><b>Сума:</b> ${money(payment.amount)}</p>
                  <p><b>Дата і час:</b> ${formatDate(payment.date)}</p>
                  <p><b>Статус:</b> ${esc(payment.status || 'невідомо')}</p>
                </article>
              `).join('')
              : '<p>Оплат ще немає.</p>'
          }
        </div>
      `
    );
  } catch (error) {
    alert(error.message);
  }
}

function bindManagerActions() {
  document.addEventListener('click', async (event) => {
    const target = event.target;

    if (!(target instanceof HTMLElement)) return;

    const paymentCard = target.closest('[data-open-payments]');

if (paymentCard) {
  await openPaymentsList();
  return;
}

    if (target.dataset.refreshManager !== undefined) {
      if (currentPath.includes('/analytics.html')) {
        await renderManagerAnalytics();
      } else {
        await renderManagerDashboard();
      }
    }

    if (target.dataset.refreshUsers !== undefined) {
      await renderManagerUsers();
    }

    if (target.dataset.userDetails) {
      const userId = target.dataset.userDetails;
      const row = target.closest('.manager-table-row');

      if (!row) return;

      const name = row.children[0]?.textContent || '';
      const email = row.children[1]?.textContent || '';
      const role = row.querySelector('select')?.value || '';

      openSheet(
        'Деталі користувача',
        `
          <p><b>Ім’я:</b> ${esc(name)}</p>
          <p><b>Email:</b> ${esc(email)}</p>
          <p><b>Поточна роль:</b> ${roleText(role)}</p>
          <p><b>ID користувача:</b> ${esc(userId)}</p>
        `
      );
    }

    if (target.dataset.saveRole) {
      const userId = target.dataset.saveRole;
      const select = document.querySelector(`[data-user-role="${userId}"]`);
      const role = select?.value;

      if (!role) return;

      if (!confirm(`Змінити роль користувача на "${roleText(role)}"?`)) {
        return;
      }

      try {
        await apiFetch(`/users/${userId}`, {
          method: 'PUT',
          body: JSON.stringify({ role }),
        });

        alert('Роль користувача оновлено');
        await renderManagerUsers();
      } catch (error) {
        alert(error.message);
      }
    }
  });
}

function bindBaseActions() {
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

  document.querySelectorAll('.sheet-close').forEach((button) => {
    button.addEventListener('click', () => {
      sheet?.classList.remove('active');
    });
  });

  sheet?.addEventListener('click', (event) => {
    if (event.target === sheet) {
      sheet.classList.remove('active');
    }
  });
}

async function initManagerArm() {
  await requireFreshAuth([ROLE.MANAGER]);
  hydrateAccount({ role: ROLE.MANAGER });

  bindBaseActions();
  bindManagerActions();

  if (
    currentPath.includes('/manager/index.html') ||
    currentPath.endsWith('/manager/')
  ) {
    await renderManagerDashboard();
  }

  if (currentPath.includes('/manager/analytics.html')) {
    await renderManagerAnalytics();
  }

  if (currentPath.includes('/manager/users.html')) {
    await renderManagerUsers();
  }
}

if (currentPath.includes('/manager/')) {
  initManagerArm().catch((error) => {
    console.error(error);
  });
}