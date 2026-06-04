import { clearAuth } from './api.js';
import { hydrateAccount } from './account.js';
import { PAGE } from './constants.js';

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

const sheetContent = {
  client: {
    title: 'Олена Коваль',
    html: `
      <p>Телефон: +380 67 000 00 00</p>
      <p>Email: olena@mail.com</p>
      <p>Роль: Клієнт · статус: активний</p>
      <p>Абонемент: Безліміт “Зал + Групові” · до 24.06.2026</p>
      <h3>Історія ролей</h3>
      <ul><li>23.05 · Надано права адміністратора</li><li>25.05 · Забрано права адміністратора</li></ul>
    `,
  },
  trainer: {
    title: 'Анна Мельник',
    html: `
      <p>Телефон: +380 67 222 11 00</p>
      <p>Email: anna@mail.com</p>
      <p>Роль: Тренер · статус: активний</p>
      <p>Спеціалізація: Йога, Фітнес</p>
    `,
  },
  admin: {
    title: 'Ігор Кравець',
    html: `
      <p>Телефон: +380 63 444 55 66</p>
      <p>Email: ihor@mail.com</p>
      <p>Поточна роль: Адміністратор</p>
      <p>Після зняття адмінських прав користувач залишиться у своїй основній ролі.</p>
    `,
  },
};

const modalText = {
  'Надати права адміністратора':
    'Користувач отримає доступ до адмін-панелі: клієнти, тренери, розклад, послуги, абонементи, повідомлення.',
  'Забрати права адміністратора':
    'Користувач більше не матиме доступу до адмін-панелі. Його основна роль залишиться без змін.',
  'Сформувати звіт':
    'Оберіть тип звіту: фінансовий, відвідуваність, продажі абонементів, робота тренерів або повний звіт.',
  'Змінити пароль': 'Введіть поточний пароль, новий пароль і підтвердження нового пароля.',
};

function setScreen(screen) {
  const nextScreen = titles[screen] ? screen : 'dashboard';
  if (!document.querySelector(`[data-screen-panel="${nextScreen}"]`) && pageRoutes[nextScreen]) {
    window.location.href = pageRoutes[nextScreen];
    return;
  }
  const activeNav = ['personal', 'profile-settings'].includes(nextScreen) ? 'profile' : nextScreen;

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
  });
});

document.querySelectorAll('[data-analytics-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    const tab = button.dataset.analyticsTab;

    document.querySelectorAll('[data-analytics-tab]').forEach((item) => {
      item.classList.toggle('active', item.dataset.analyticsTab === tab);
    });

    document.querySelectorAll('[data-analytics-panel]').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.analyticsPanel === tab);
    });
  });
});

const sheet = document.querySelector('#sheet');
const sheetTitle = document.querySelector('#sheet-title');
const sheetContentBox = document.querySelector('#sheet-content');

document.querySelectorAll('.sheet-open').forEach((button) => {
  button.addEventListener('click', () => {
    const content = sheetContent[button.dataset.sheet] || sheetContent.client;
    sheetTitle.textContent = content.title;
    sheetContentBox.innerHTML = content.html;
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

const modal = document.querySelector('#manager-modal');
const modalTitle = document.querySelector('#modal-title');
const modalTextBox = document.querySelector('#modal-text');

document.querySelectorAll('.modal-open').forEach((button) => {
  button.addEventListener('click', () => {
    const title = button.dataset.modalTitle || 'Підтвердження';
    modalTitle.textContent = title;
    modalTextBox.textContent = modalText[title] || 'Дія буде застосована після підтвердження.';
    modal.classList.add('active');
  });
});

document.querySelectorAll('.modal-close').forEach((button) => {
  button.addEventListener('click', () => modal.classList.remove('active'));
});

modal.addEventListener('click', (event) => {
  if (event.target === modal) {
    modal.classList.remove('active');
  }
});

hydrateAccount({ role: 'manager' });
