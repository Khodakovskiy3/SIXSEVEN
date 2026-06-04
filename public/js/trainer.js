import { clearAuth, requireFreshAuth } from './api.js';
import { hydrateAccount } from './account.js';
import { PAGE, ROLE } from './constants.js';

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

const sheetContent = {
  fitness: {
    title: 'Фітнес',
    text: 'Сьогодні · 10:00 · зал 1',
    details: [
      ['Тривалість', '45 хв'],
      ['Записані клієнти', 'Олена Коваль, Марія Іваненко, Олег Петренко'],
      ['Кількість', '12 клієнтів'],
    ],
  },
  personal: {
    title: 'Персональне тренування',
    text: 'Сьогодні · 14:00 · зал 4',
    details: [
      ['Клієнт', 'Марія Іваненко'],
      ['Телефон', '+380 67 000 00 00'],
      ['Абонемент', 'активний'],
    ],
  },
  yoga: {
    title: 'Йога',
    text: 'Сьогодні · 18:30 · зал 2',
    details: [
      ['Тривалість', '50 хв'],
      ['Записані клієнти', '8 клієнтів'],
      ['Фокус', 'гнучкість та дихання'],
    ],
  },
  fight: {
    title: 'Єдиноборства',
    text: 'Сьогодні · 20:00 · зал 3',
    details: [
      ['Тривалість', '60 хв'],
      ['Тренер', 'Максим'],
      ['Кількість', '10 клієнтів'],
    ],
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

document.querySelectorAll('[data-mode-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    const mode = button.dataset.modeTab;

    document.querySelectorAll('[data-mode-tab]').forEach((item) => {
      item.classList.toggle('active', item.dataset.modeTab === mode);
    });

    document.querySelectorAll('[data-mode-panel]').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.modePanel === mode);
    });

    document.querySelector('.training-filters').classList.toggle('active', mode === 'all');
  });
});

document.querySelectorAll('.date-pill').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.date-pill').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
  });
});

document.querySelectorAll('.chip').forEach((button) => {
  button.addEventListener('click', () => {
    const row = button.closest('.chip-row');
    row.querySelectorAll('.chip').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
  });
});

const sheet = document.querySelector('#sheet');
const sheetDetails = document.querySelector('#sheet-details');

document.querySelectorAll('.sheet-open').forEach((button) => {
  button.addEventListener('click', () => {
    const content = sheetContent[button.dataset.sheet] || sheetContent.fitness;
    document.querySelector('#sheet-title').textContent = content.title;
    document.querySelector('#sheet-text').textContent = content.text;
    sheetDetails.innerHTML = content.details
      .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
      .join('');
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

const modal = document.querySelector('#password-modal');

document.querySelectorAll('.modal-open').forEach((button) => {
  button.addEventListener('click', () => modal.classList.add('active'));
});

document.querySelectorAll('.modal-close').forEach((button) => {
  button.addEventListener('click', () => modal.classList.remove('active'));
});

modal.addEventListener('click', (event) => {
  if (event.target === modal) {
    modal.classList.remove('active');
  }
});

// Перевіряємо актуальну роль на сервері: без валідного токена тренера
// сторінку буде перенаправлено на вхід, а дані акаунта підтягнуться лише
// для авторизованого користувача.
const currentUser = await requireFreshAuth([ROLE.TRAINER]);
if (currentUser) {
  hydrateAccount({ role: ROLE.TRAINER });
}
