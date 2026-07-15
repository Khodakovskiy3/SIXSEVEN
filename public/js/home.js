/**
 * Публічна частина сайту (pages/home).
 *
 * Відповідає за мобільне меню та підвантаження відкритих даних клубу:
 * послуги, абонементи, найближчий розклад і контакти. Авторизація не
 * потрібна — використовуються публічні ендпоінти /api/public/* та /api/club.
 */

const menuToggle = document.querySelector('[data-menu-toggle]');
const mobileMenu = document.querySelector('[data-mobile-menu]');

menuToggle?.addEventListener('click', (e) => {
  e.stopPropagation();
  mobileMenu?.classList.toggle('active');
});

document.addEventListener('click', (e) => {
  if (mobileMenu?.classList.contains('active') && !mobileMenu.contains(e.target)) {
    mobileMenu.classList.remove('active');
  }
});

// Акцентний колір і градієнт для кожної послуги (fallback якщо немає image_url).
const SERVICE_THEME = {
  'фітнес':       { color: '#ff6424', gradient: 'linear-gradient(135deg,#ff6424 0%,#c23a00 100%)' },
  'йога':         { color: '#6ec8a0', gradient: 'linear-gradient(135deg,#2a8a62 0%,#0e3d2c 100%)' },
  'персональні':  { color: '#ffbf17', gradient: 'linear-gradient(135deg,#ffbf17 0%,#b87800 100%)' },
  'єдиноборства': { color: '#e05555', gradient: 'linear-gradient(135deg,#c93333 0%,#6b0a0a 100%)' },
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

function formatWeekday(value) {
  return new Date(value).toLocaleDateString('uk-UA', { weekday: 'short' });
}

function formatTime(value = '') {
  return String(value).slice(0, 5);
}

/**
 * Обирає правильну форму українського слова за числівником.
 *
 * @param {number} count
 * @param {[string, string, string]} forms — форми для 1 / 2-4 / 5+.
 * @returns {string}
 */
function pluralizeUk(count, forms) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return forms[0];
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return forms[1];
  }
  return forms[2];
}

// Підписи типів тарифів та видів доступу для карток абонементів.
const PLAN_TYPE_LABEL = {
  subscription: 'Абонемент',
  single: 'Разовий',
};

const ACCESS_TYPE_LABEL = {
  gym: 'Зал',
  group: 'Групові',
  personal: 'Персональне',
  gym_group: 'Зал + групові',
};

// Глобальний масив послуг і поточний зсув (для каруселі)
let _allWorkouts = [];
let _svcOffset = 0;
const SVC_VISIBLE = 4;

// Глобальний масив планів і зсув
let _allPlans = [];
let _planOffset = 0;
const PLAN_VISIBLE = 4;

// Теми для карток абонементів
const PLAN_THEME = {
  gym:       { color: '#ff6424', gradient: 'linear-gradient(135deg,#ff6424 0%,#8a2200 100%)' },
  group:     { color: '#6ec8a0', gradient: 'linear-gradient(135deg,#2a8a62 0%,#0e3d2c 100%)' },
  personal:  { color: '#ffbf17', gradient: 'linear-gradient(135deg,#ffbf17 0%,#b87800 100%)' },
  gym_group: { color: '#e05555', gradient: 'linear-gradient(135deg,#c93333 0%,#6b0a0a 100%)' },
  single:    { color: '#a78bfa', gradient: 'linear-gradient(135deg,#7c3aed 0%,#2e1065 100%)' },
};

function buildCard(workout, globalIndex) {
  const key = String(workout.name).toLowerCase();
  const theme = SERVICE_THEME[key] || { color: '#ff6424', gradient: 'linear-gradient(135deg,#ff6424 0%,#8a2200 100%)' };
  const capacity = Number(workout.max_clients) > 1
    ? `До ${escapeHtml(workout.max_clients)} осіб`
    : 'Індивідуально';
  const upcomingCount = Number(workout.upcoming_count || 0);
  const num = String(globalIndex + 1).padStart(2, '0');
  const bgStyle = workout.image_url
    ? `background-image:url('${escapeHtml(workout.image_url)}')`
    : `background:${theme.gradient}`;

  return `
    <article class="svc-card" style="--svc-color:${theme.color};${bgStyle}">
      <span class="svc-card__num">${num}</span>
      <div class="svc-card__overlay"></div>
      <div class="svc-card__body">
        <h2 class="svc-card__title">${escapeHtml(workout.name)}</h2>
        <p class="svc-card__desc">${escapeHtml(workout.description || 'Опис незабаром.')}</p>
        <div class="svc-card__chips">
          <span>${capacity}</span>
        </div>
        <a class="svc-card__cta" href="../auth/register.html">Записатися →</a>
      </div>
    </article>
  `;
}

function renderServices(workouts) {
  _allWorkouts = workouts;
  _svcOffset = 0;
  const grid = document.querySelector('#services-grid');
  if (!grid) return;

  if (workouts.length === 0) {
    grid.innerHTML = '<p class="form-note" style="grid-column:1/-1">Послуг поки немає.</p>';
    return;
  }

  renderSvcSlice();
}

function bindDescToggle(grid) {
  grid.querySelectorAll('.svc-card__desc').forEach(desc => {
    // Перевіряємо чи текст реально обрізається
    if (desc.scrollHeight > desc.clientHeight + 2) {
      desc.closest('.svc-card').classList.add('desc-clipped');
    }

    desc.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = desc.closest('.svc-card');
      const isOpen = card.classList.contains('desc-open');

      // Закриваємо всі інші відкриті
      grid.querySelectorAll('.svc-card.desc-open').forEach(c => {
        c.classList.remove('desc-open');
        c.classList.add('desc-clipped');
      });

      // Якщо ця не була відкрита — відкриваємо
      if (!isOpen && card.classList.contains('desc-clipped')) {
        card.classList.add('desc-open');
        card.classList.remove('desc-clipped');
      }
    });
  });
}

function renderSvcSlice() {
  const grid = document.querySelector('#services-grid');
  const prevBtn = document.querySelector('#svc-prev');
  const nextBtn = document.querySelector('#svc-next');
  const dotsEl = document.querySelector('#svc-dots');
  if (!grid) return;

  const total = _allWorkouts.length;
  // Показуємо SVC_VISIBLE карток починаючи з offset; якщо менше — показуємо всі
  const slice = _allWorkouts.slice(_svcOffset, _svcOffset + SVC_VISIBLE);
  grid.innerHTML = slice.map((w, i) => buildCard(w, _svcOffset + i)).join('');
  bindDescToggle(grid);

  if (prevBtn) prevBtn.disabled = _svcOffset === 0;
  if (nextBtn) nextBtn.disabled = _svcOffset + SVC_VISIBLE >= total;

  // Dots: один на кожну "позицію" (0..total-SVC_VISIBLE)
  if (dotsEl) {
    const steps = Math.max(1, total - SVC_VISIBLE + 1);
    dotsEl.innerHTML = Array.from({ length: steps }, (_, i) =>
      `<span class="svc-nav-dot ${i === _svcOffset ? 'active' : ''}"></span>`
    ).join('');
  }
}

function initServicesCarousel() {
  const prevBtn = document.querySelector('#svc-prev');
  const nextBtn = document.querySelector('#svc-next');
  if (!prevBtn || !nextBtn) return;

  prevBtn.addEventListener('click', () => {
    if (_svcOffset > 0) {
      _svcOffset--;
      renderSvcSlice();
    }
  });

  nextBtn.addEventListener('click', () => {
    if (_svcOffset + SVC_VISIBLE < _allWorkouts.length) {
      _svcOffset++;
      renderSvcSlice();
    }
  });
}

/**
 * Готує підписи/значення тарифу, спільні для виділеної картки та рядків списку.
 */
function planFields(plan) {
  return {
    typeLabel: PLAN_TYPE_LABEL[plan.plan_type] || plan.plan_type || 'Тариф',
    accessLabel: ACCESS_TYPE_LABEL[plan.access_type] || plan.access_type || 'Доступ',
    period: plan.duration_days
      ? `${plan.duration_days} ${pluralizeUk(Number(plan.duration_days), ['день', 'дні', 'днів'])}`
      : `${plan.usage_count || 1} ${pluralizeUk(Number(plan.usage_count || 1), ['відвідування', 'відвідування', 'відвідувань'])}`,
    amount: Number(plan.price || 0).toLocaleString('uk-UA', { maximumFractionDigits: 0 }),
  };
}

function renderFeaturePlan(plan) {
  const { accessLabel, period, amount } = planFields(plan);
  return `
    <article class="plan-feature">
      <span class="plan-feature__ribbon">Популярний</span>
      <div class="plan-feature__head">
        <span class="plan-feature__tag">Найвигідніший вибір</span>
        <h2 class="plan-feature__title">${escapeHtml(plan.name)}</h2>
        <p class="plan-feature__desc">${escapeHtml(plan.description || '')}</p>
      </div>
      <div class="plan-feature__chips">
        <span>${escapeHtml(accessLabel)}</span>
        <span>${escapeHtml(period)}</span>
      </div>
      <div class="plan-feature__price">
        <span class="plan-feature__amount">${amount}</span>
        <span class="plan-feature__currency">грн</span>
      </div>
      <a class="plan-feature__cta" href="../auth/login.html">Обрати тариф →</a>
    </article>
  `;
}

function renderPlanRow(plan, index) {
  const { typeLabel, accessLabel, period, amount } = planFields(plan);
  const num = String(index + 1).padStart(2, '0');
  return `
    <article class="plan-row">
      <div class="plan-row__lead">
        <span class="plan-row__num">${num}</span>
        <span class="plan-row__tag">${escapeHtml(typeLabel)}</span>
      </div>
      <div class="plan-row__body">
        <h3 class="plan-row__title">${escapeHtml(plan.name)}</h3>
        <p class="plan-row__desc">${escapeHtml(plan.description || '')}</p>
        <div class="plan-row__chips">
          <span>${escapeHtml(accessLabel)}</span>
          <span>${escapeHtml(period)}</span>
        </div>
      </div>
      <div class="plan-row__right">
        <div class="plan-row__price">
          <span class="plan-row__amount">${amount}</span>
          <span class="plan-row__currency">грн</span>
        </div>
        <a class="plan-row__buy" href="../auth/login.html">Придбати</a>
      </div>
    </article>
  `;
}

/**
 * Повертає SVG-іконку для картки залежно від назви/типу абонементу.
 */
function planIcon(plan) {
  const txt = ((plan.name || '') + ' ' + (plan.plan_type || '')).toLowerCase();
  if (txt.includes('персон')) {
    return `<svg class="plan-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="8" r="3.5"/><path d="M3 21c0-3.6 3.1-6.5 7-6.5"/><polyline points="15 13 17 15 21 11"/></svg>`;
  }
  if (txt.includes('груп')) {
    return `<svg class="plan-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="7" r="3"/><path d="M3 21c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="8" r="2.5"/><path d="M21 21c0-2.5-2-4.5-4-4.5"/></svg>`;
  }
  if (txt.includes('безліміт')) {
    return `<svg class="plan-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12c0-2.2 1.8-4 4-4 1.1 0 2.1.4 2.8 1.2L15 12l-3.2 2.8C11.1 15.6 10.1 16 9 16c-2.2 0-4-1.8-4-4z"/><path d="M19 12c0 2.2-1.8 4-4 4-1.1 0-2.1-.4-2.8-1.2L9 12l3.2-2.8C12.9 8.4 13.9 8 15 8c2.2 0 4 1.8 4 4z"/></svg>`;
  }
  return `<svg class="plan-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
}

/**
 * Будує темну картку абонементу для мобільного каруселю.
 */
function buildPlanCard(plan, globalIndex, isFeatured) {
  const { accessLabel, period, amount } = planFields(plan);
  const num = String(globalIndex + 1).padStart(2, '0');
  const ribbon = isFeatured
    ? '<span class="plan-card__ribbon">Популярний</span>'
    : '';

  return `
    <article class="plan-card${isFeatured ? ' plan-card--featured' : ''}">
      ${ribbon}
      <span class="plan-card__bg-num">${num}</span>
      <div class="plan-card__header">
        <span class="plan-card__num">${num}</span>
        ${planIcon(plan)}
      </div>
      <h2 class="plan-card__title">${escapeHtml(plan.name)}</h2>
      ${plan.description ? `<p class="plan-card__desc">${escapeHtml(plan.description)}</p>` : ''}
      <ul class="plan-card__perks">
        <li>${escapeHtml(accessLabel)}</li>
        <li>${escapeHtml(period)}</li>
      </ul>
      <div class="plan-card__divider"></div>
      <div class="plan-card__price">
        <span class="plan-card__amount">${amount}</span>
        <span class="plan-card__currency">грн</span>
      </div>
      <a class="plan-card__cta" href="../auth/login.html">Придбати →</a>
    </article>
  `;
}

function renderPlanSlice() {
  const grid = document.querySelector('#plans-grid');
  const prevBtn = document.querySelector('#plan-prev');
  const nextBtn = document.querySelector('#plan-next');
  const dotsEl = document.querySelector('#plan-dots');
  if (!grid) return;

  const total = _allPlans.length;
  // Перший елемент масиву завжди featured (після сортування в renderPlans)
  const featuredId = _allPlans[0]?.id ?? null;

  const slice = _allPlans.slice(_planOffset, _planOffset + PLAN_VISIBLE);
  grid.innerHTML = slice.map((p, i) =>
    buildPlanCard(p, _planOffset + i, p.id === featuredId)
  ).join('');

  if (prevBtn) prevBtn.disabled = _planOffset === 0;
  if (nextBtn) nextBtn.disabled = _planOffset + PLAN_VISIBLE >= total;

  if (dotsEl) {
    const steps = Math.max(1, total - PLAN_VISIBLE + 1);
    dotsEl.innerHTML = Array.from({ length: steps }, (_, i) =>
      `<span class="svc-nav-dot ${i === _planOffset ? 'active' : ''}"></span>`
    ).join('');
  }
}

/**
 * Desktop-layout: featured зліва + список рядків справа (старий вигляд).
 */
function renderPlansDesktop(plans) {
  const container = document.querySelector('#plans-desktop');
  if (!container) return;

  if (plans.length === 0) {
    container.innerHTML = '<article class="dark-card"><h2>Тарифів поки немає</h2></article>';
    return;
  }

  const featuredPlan = plans.reduce(
    (top, plan) => (Number(plan.price) > Number(top.price) ? plan : top),
    plans[0]
  );
  const rest = plans.filter((plan) => plan.id !== featuredPlan.id);

  container.innerHTML = `
    <div class="plans-layout">
      ${renderFeaturePlan(featuredPlan)}
      <div class="plan-list">
        ${rest.map((plan, index) => renderPlanRow(plan, index)).join('')}
      </div>
    </div>
  `;
}

function renderPlans(plans) {
  if (!plans.length) {
    _allPlans = [];
    renderPlansDesktop([]);
    return;
  }

  // Популярний (найдорожчий) — завжди першим
  const featured = plans.reduce(
    (top, p) => Number(p.price) > Number(top.price) ? p : top, plans[0]
  );
  _allPlans = [featured, ...plans.filter(p => p.id !== featured.id)];
  _planOffset = 0;

  // Desktop: старий layout
  renderPlansDesktop(plans);

  // Mobile: 2×2 карусель
  const grid = document.querySelector('#plans-grid');
  if (!grid) return;
  renderPlanSlice();
}

function initPlansCarousel() {
  const prevBtn = document.querySelector('#plan-prev');
  const nextBtn = document.querySelector('#plan-next');
  if (!prevBtn || !nextBtn) return;

  prevBtn.addEventListener('click', () => {
    if (_planOffset > 0) { _planOffset--; renderPlanSlice(); }
  });
  nextBtn.addEventListener('click', () => {
    if (_planOffset + PLAN_VISIBLE < _allPlans.length) { _planOffset++; renderPlanSlice(); }
  });
}

function renderSchedule(schedules) {
  const board = document.querySelector('#schedule-board');
  if (!board) return;

  if (!schedules.length) {
    board.innerHTML = `
      <div class="sch-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <p>Найближчих занять немає</p>
        <span>Загляньте пізніше</span>
      </div>`;
    return;
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  // group by date
  const groups = {};
  schedules.forEach((item) => {
    const d = String(item.date).slice(0, 10);
    if (!groups[d]) groups[d] = [];
    groups[d].push(item);
  });

  board.innerHTML = Object.entries(groups).map(([date, items]) => {
    const d = new Date(date + 'T00:00:00');
    let dayLabel;
    if (date === todayStr) {
      dayLabel = `Сьогодні — ${d.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' })}`;
    } else if (date === tomorrowStr) {
      dayLabel = `Завтра — ${d.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' })}`;
    } else {
      dayLabel = d.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });
    }

    const cards = items.map((item) => {
      const max     = Number(item.max_clients || 0);
      const booked  = Number(item.booked || 0);
      const avail   = Math.max(max - booked, 0);
      const isFull  = avail === 0 && max > 0;
      const pct     = max > 0 ? booked / max : 0;

      // Компактний формат: "зайнято/всього" (напр. "3/10")
      const spotsText = max > 0 ? `${booked}/${max}` : '—';
      const fillPct = max > 0 ? Math.round((booked / max) * 100) : 0;

      return `
        <article class="sch-card${isFull ? ' sch-card--full' : ''}">
          <div class="sch-card__time">${formatTime(item.time)}</div>
          <div class="sch-card__body">
            <p class="sch-card__name">${escapeHtml(item.workout_name)}</p>
            <p class="sch-card__trainer">${escapeHtml(item.trainer_name || 'Тренер не призначений')}</p>
            <div class="sch-card__cap">
              <div class="sch-bar"><div class="sch-bar__fill${isFull ? ' sch-bar__fill--full' : ''}" style="width:${fillPct}%"></div></div>
              <span class="sch-spots${isFull ? ' sch-spots--full' : ''}">${spotsText}</span>
            </div>
          </div>
          <a class="sch-card__btn${isFull ? ' sch-card__btn--full' : ''}" href="../auth/register.html">
            ${isFull ? 'Лист очікування' : 'Записатись →'}
          </a>
        </article>`;
    }).join('');

    return `
      <div class="sch-day">
        <h3 class="sch-day__label">${dayLabel}</h3>
        <div class="sch-list">${cards}</div>
      </div>`;
  }).join('');
}

function renderContacts(club) {
  const values = {
    address: club.address,
    phone: club.phone,
    email: club.email,
    name: club.name,
    weekday_hours: club.weekday_hours,
    weekend_hours: club.weekend_hours,
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
  // Повна сторінка розкладу — окремий ендпоінт без ліміту 10
  const isSchedulePage = document.querySelector('#schedule-board') &&
                         !document.querySelector('#services-grid, #plans-grid');
  if (isSchedulePage) {
    try {
      const schedules = await fetchJson('/public/schedules');
      renderSchedule(schedules);
    } catch (err) {
      console.error('[schedules]', err);
    }
    return;
  }

  if (document.querySelector('#services-grid, #plans-grid, #schedule-board')) {
    try {
      const data = await fetchJson('/public/home-data');
      renderServices(data.workouts || []);
      renderPlans(data.plans || []);
      renderSchedule(data.schedules || []);
      initServicesCarousel();
      initPlansCarousel();
    } catch (err) {
      console.error('[home-data]', err);
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

// CountUp анімація для статистики на сторінці "Про нас"
function initCountUp() {
  const numsBlock = document.querySelector('.about-nums');
  if (!numsBlock) return;

  const strongs = numsBlock.querySelectorAll('strong');

  const animate = (el) => {
    const raw = el.textContent.trim();
    const suffix = raw.replace(/[\d]/g, '');        // '+', 'к', тощо
    const target = parseInt(raw.replace(/\D/g, ''), 10);
    if (!target) return;

    const duration = 1200;
    const start = performance.now();

    const step = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);  // ease-out cubic
      el.textContent = Math.round(eased * target) + suffix;
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        strongs.forEach(animate);
        observer.disconnect();
      }
    });
  }, { threshold: 0.5 });

  observer.observe(numsBlock);
}

initCountUp();
loadHomeData();
