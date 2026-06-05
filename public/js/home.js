/**
 * Публічна частина сайту (pages/home).
 *
 * Відповідає за мобільне меню та підвантаження відкритих даних клубу:
 * послуги, абонементи, найближчий розклад і контакти. Авторизація не
 * потрібна — використовуються публічні ендпоінти /api/public/* та /api/club.
 */

const menuToggle = document.querySelector('[data-menu-toggle]');
const mobileMenu = document.querySelector('[data-mobile-menu]');

menuToggle?.addEventListener('click', () => {
  mobileMenu?.classList.toggle('active');
});

// Відповідність назви послуги до оформлення картки (для фонової графіки).
const SERVICE_CARD_CLASS = {
  'фітнес': 'fitness-card',
  'йога': 'yoga-card',
  'персональні': 'personal-card',
  'єдиноборства': 'fight-card',
};

/**
 * Екранує текст перед вставкою в HTML, щоб уникнути XSS.
 *
 * @param {string} [value]
 * @returns {string}
 */
function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/**
 * Виконує GET-запит до публічного API і повертає розпаковану JSON-відповідь.
 *
 * @param {string} path — шлях відносно /api.
 * @returns {Promise<any>}
 */
async function fetchJson(path) {
  const response = await fetch(`/api${path}`);
  if (!response.ok) {
    throw new Error('Не вдалося завантажити дані');
  }
  return response.json();
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('uk-UA', { maximumFractionDigits: 0 })} грн`;
}

function formatDayMonth(value) {
  return new Date(value).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
}

function formatTime(value = '') {
  return String(value).slice(0, 5);
}

function renderServices(workouts) {
  const grid = document.querySelector('#services-grid');
  if (!grid) {
    return;
  }

  if (workouts.length === 0) {
    grid.innerHTML = '<article class="orange-card"><h2>Послуг поки немає</h2></article>';
    return;
  }

  grid.innerHTML = workouts.map((workout) => {
    const cardClass = SERVICE_CARD_CLASS[String(workout.name).toLowerCase()] || '';
    return `
      <article class="orange-card ${cardClass}">
        <div class="card-art"></div>
        <h2>${escapeHtml(workout.name)}</h2>
        <p>${escapeHtml(workout.description || 'Опис незабаром.')}</p>
        <a href="../auth/register.html">Записатися</a>
      </article>
    `;
  }).join('');
}

function renderPlans(plans) {
  const grid = document.querySelector('#plans-grid');
  if (!grid) {
    return;
  }

  if (plans.length === 0) {
    grid.innerHTML = '<article class="dark-card"><h2>Тарифів поки немає</h2></article>';
    return;
  }

  // Найдорожчий тариф виділяємо як «популярний».
  const featuredPlan = plans.reduce(
    (top, plan) => (Number(plan.price) > Number(top.price) ? plan : top),
    plans[0]
  );

  grid.innerHTML = plans.map((plan) => {
    const meta = plan.duration_days
      ? `${plan.duration_days} днів`
      : `${plan.usage_count || 1} відвідування`;
    const isFeatured = plan.id === featuredPlan.id;
    return `
      <article class="dark-card ${isFeatured ? 'featured' : ''}">
        <span>${isFeatured ? 'Популярний' : escapeHtml(meta)}</span>
        <h2>${escapeHtml(plan.name)}</h2>
        <p>${escapeHtml(plan.description || '')}</p>
        <strong>${formatMoney(plan.price)}</strong>
      </article>
    `;
  }).join('');
}

function renderSchedule(schedules) {
  const board = document.querySelector('#schedule-board');
  if (!board) {
    return;
  }

  if (schedules.length === 0) {
    board.innerHTML = '<article><div><h2>Найближчих занять немає</h2><p>Загляньте пізніше.</p></div></article>';
    return;
  }

  board.innerHTML = schedules.map((item) => `
    <article>
      <strong>${formatDayMonth(item.date)} · ${formatTime(item.time)}</strong>
      <div>
        <h2>${escapeHtml(item.workout_name)}</h2>
        <p>${escapeHtml(item.trainer_name || 'тренер не призначений')} · до ${escapeHtml(item.max_clients || '—')} місць</p>
      </div>
      <a href="../auth/register.html">Запис</a>
    </article>
  `).join('');
}

function renderContacts(club) {
  const values = {
    address: club.address,
    phone: club.phone,
    email: club.email,
    name: club.name,
  };

  document.querySelectorAll('[data-club]').forEach((element) => {
    const value = values[element.dataset.club];
    if (value) {
      element.textContent = value;
    }
  });
}

/**
 * Підвантажує дані лише для тих блоків, які присутні на поточній сторінці.
 */
async function loadHomeData() {
  if (document.querySelector('#services-grid, #plans-grid, #schedule-board')) {
    try {
      const data = await fetchJson('/public/home-data');
      renderServices(data.workouts || []);
      renderPlans(data.plans || []);
      renderSchedule(data.schedules || []);
    } catch {
      // Якщо дані недоступні — лишаємо порожні контейнери, сторінка робоча.
    }
  }

  if (document.querySelector('[data-club]')) {
    try {
      const club = await fetchJson('/club');
      renderContacts(club);
    } catch {
      // Контакти лишаються із дефолтних значень розмітки.
    }
  }
}

loadHomeData();
