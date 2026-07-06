import {
  apiFetch,
  clearAuth,
  formatDate,
  requireFreshAuth,
  setAuth,
} from './api.js';

import { hydrateAccount } from './account.js';
import { PAGE, ROLE } from './constants.js';
import { initSidebar } from './sidebar.js';

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

// ── SVG area/line chart ─────────────────────────────────────────────────────
function svgAreaChart(data, valueKey, {
  areaClass = 'finance-area',
  lineClass  = 'finance-line',
  dotsClass  = 'finance-points',
  W = 600, H = 180,
} = {}) {
  if (!data.length) return '<p class="form-note" style="padding:18px 0">Немає даних за цей період.</p>';

  const vals = data.map(d => Number(d[valueKey] || 0));
  const max  = Math.max(...vals, 1);

  const pts = vals.map((v, i) => {
    const x = data.length === 1 ? W / 2 : (i / (data.length - 1)) * W;
    const y = H - (v / max) * H * 0.85 - H * 0.05;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  });

  const line = pts.reduce((d, [x, y], i) => {
    if (i === 0) return `M${x} ${y}`;
    const [px, py] = pts[i - 1];
    const cpx = (x - px) / 2.8;
    return `${d} C${px + cpx} ${py} ${x - cpx} ${y} ${x} ${y}`;
  }, '');

  const area = `${line} L${pts.at(-1)[0]} ${H} L${pts[0][0]} ${H} Z`;

  const dots = pts.map(([x, y]) =>
    `<circle cx="${x}" cy="${y}" r="5"/>`
  ).join('');

  return `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <path class="${areaClass}" d="${area}"/>
      <path class="${lineClass}" d="${line}"/>
      <g class="${dotsClass}">${dots}</g>
    </svg>`;
}

// ── Date labels under chart ──────────────────────────────────────────────────
function chartDateLabels(data, n = 7) {
  if (!data.length) return '';
  const step = Math.max(1, Math.floor(data.length / n));
  const labels = data
    .filter((_, i) => i % step === 0 || i === data.length - 1)
    .map(d => {
      const dt = new Date(d.date);
      return `<span>${dt.getDate()}.${String(dt.getMonth() + 1).padStart(2, '0')}</span>`;
    }).join('');
  return `<div class="chart-labels">${labels}</div>`;
}

// ── Dashboard revenue chart — HTML layout + SVG paths with preserveAspectRatio="none" ──
function svgDashChart(data, valueKey, totalLabel = '') {
  if (!data.length) return '<p class="form-note" style="padding:18px 0">Немає даних за цей період.</p>';

  const vals   = data.map(d => Number(d[valueKey] || 0));
  const rawMax = Math.max(...vals, 1);
  const mag    = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const yMax   = Math.ceil(rawMax / mag) * mag || 10000;

  // Normalized coords: X 0→100, Y 0→100 (0=top, 100=bottom)
  // 3% padding top/bottom inside the chart area
  const toXY = (v, i) => {
    const x = data.length === 1 ? 50 : (i / (data.length - 1)) * 100;
    const y = 3 + (1 - v / yMax) * 94;
    return [+x.toFixed(2), +y.toFixed(2)];
  };

  const pts = vals.map(toXY);

  const smooth = ps => ps.reduce((acc, [x, y], i) => {
    if (i === 0) return `M${x} ${y}`;
    const [px, py] = ps[i - 1];
    const cp = (x - px) / 2.8;
    return `${acc} C${px + cp} ${py} ${x - cp} ${y} ${x} ${y}`;
  }, '');

  const line    = smooth(pts);
  const area    = `${line} L100 100 L0 100 Z`;

  // 7-pt moving average
  const avgPts = vals.map((_, i) => {
    const s = Math.max(0, i - 3), e = Math.min(vals.length - 1, i + 3);
    const avg = vals.slice(s, e + 1).reduce((a, v) => a + v, 0) / (e - s + 1);
    return toXY(avg, i);
  });
  const avgLine = smooth(avgPts);

  // Y-axis ticks (5 levels)
  const ticks   = [0, 1, 2, 3, 4].map(i => (yMax / 4) * i);
  const fmtY    = v => v >= 1000 ? `${Math.round(v / 1000)} тис.` : '0';

  // Y-axis labels HTML (right-aligned, positioned by %)
  const yLabelsHtml = [...ticks].reverse().map(t => {
    const pct = 3 + (1 - t / yMax) * 94;
    return `<span style="top:${pct}%">${fmtY(t)}</span>`;
  }).join('');

  // SVG grid lines (horizontal, normalized)
  const gridLines = ticks.map(t => {
    const y = 3 + (1 - t / yMax) * 94;
    return `<line x1="0" y1="${y}" x2="100" y2="${y}" class="dch-grid"/>`;
  }).join('');

  // Dots as HTML (perfectly round, no distortion)
  const dotsHtml = pts.map(([x, y]) =>
    `<span class="dch-dot" style="left:${x}%;top:${y}%"></span>`
  ).join('');

  // X-axis labels (max 8 evenly spaced)
  const n    = Math.min(8, data.length);
  const step = Math.max(1, Math.floor(data.length / n));
  const xLabelsHtml = data.map((d, i) => {
    if (i % step !== 0 && i !== data.length - 1) return '';
    const pct = data.length === 1 ? 50 : (i / (data.length - 1)) * 100;
    const dt  = new Date(d.date);
    return `<span style="left:${pct}%">${dt.getDate()}.${String(dt.getMonth() + 1).padStart(2, '0')}</span>`;
  }).join('');

  // Summary label: near last point but shifted left if too close to edge
  const [lastX, lastY] = pts.at(-1);
  const sumLeft = Math.min(lastX, 88);
  const sumTop  = Math.max(8, Math.min(82, lastY - 14));

  return `
    <div class="dch-layout">
      <div class="dch-yaxis">${yLabelsHtml}</div>
      <div class="dch-col">
        <div class="dch-area">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="dch-svg">
            <defs>
              <linearGradient id="dchGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stop-color="#e85002" stop-opacity=".4"/>
                <stop offset="100%" stop-color="#e85002" stop-opacity=".02"/>
              </linearGradient>
              <filter id="dchGlow" x="-10%" y="-80%" width="120%" height="260%">
                <feGaussianBlur stdDeviation="2" result="b"/>
                <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>
            ${gridLines}
            <path d="${area}" fill="url(#dchGrad)"/>
            <path d="${avgLine}" stroke="#e85002" stroke-width="0.5" stroke-dasharray="2 2" fill="none" opacity=".4"/>
            <path d="${line}" stroke="#e85002" stroke-width="0.8" fill="none" filter="url(#dchGlow)" opacity=".65"/>
            <path d="${line}" stroke="#e85002" stroke-width="0.6" fill="none"/>
          </svg>
          ${dotsHtml}
          ${totalLabel ? `
            <div class="dch-sum" style="left:${sumLeft}%;top:${sumTop}%">
              <strong>${totalLabel}</strong><span>загалом</span>
            </div>` : ''}
        </div>
        <div class="dch-xaxis">${xLabelsHtml}</div>
      </div>
    </div>`;
}

// ── Horizontal bars (тренери / тренування) ──────────────────────────────────
function hBars(items, nameKey, valueKey, suffix = '') {
  if (!items.length) return '<p class="form-note">Немає даних.</p>';
  const max = Math.max(...items.map(d => Number(d[valueKey] || 0)), 1);

  return `
    <div class="trainer-bars">
      ${items.map(item => {
        const v = Number(item[valueKey] || 0);
        const w = Math.max((v / max) * 100, 2);
        return `
          <div>
            <span>${esc(String(item[nameKey]))}</span>
            <strong style="width:${w}%"></strong>
            <em>${number(v)}${suffix ? ' ' + suffix : ''}</em>
          </div>`;
      }).join('')}
    </div>`;
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

// ── Workout icon map ─────────────────────────────────────────────────────────
const WORKOUT_ICONS = {
  'Персональні': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="7" r="4"/><path d="M6 21v-1a6 6 0 0 1 12 0v1"/></svg>`,
  'Фітнес':      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
  'Єдиноборства':`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 18L4 12l4-6h8l4 6-4 6H8z"/><path d="M12 6v12M8 12h8"/></svg>`,
  'Йога':        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="4" r="2"/><path d="M12 6c-3 0-5 2-5 4.5 0 1.5.8 2.8 2 3.5l1 5h4l1-5c1.2-.7 2-2 2-3.5 0-2.5-2-4.5-5-4.5z"/></svg>`,
  'TRX':         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/><circle cx="12" cy="12" r="4"/></svg>`,
};
const DEFAULT_WORKOUT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 8h4M14 8h4M6 16h4M14 16h4M2 12h5M17 12h5"/><rect x="5" y="6" width="2" height="12" rx="1"/><rect x="17" y="6" width="2" height="12" rx="1"/></svg>`;

async function renderManagerDashboard() {
  const panel = document.querySelector('[data-screen-panel="dashboard"]');
  if (!panel) return;

  const today = new Date();
  const from  = new Date(today); from.setDate(from.getDate() - 29);
  const fmt   = d => d.toISOString().slice(0, 10);
  const report = await apiFetch(`/reports/manager?start=${fmt(from)}&end=${fmt(today)}`);
  const { summary, revenueByDay, workoutStats, trainerLoad } = report;

  // Тренд (перша vs друга половина)
  const half     = Math.floor(revenueByDay.length / 2);
  const rev1     = revenueByDay.slice(0, half).reduce((s, d) => s + d.revenue, 0);
  const rev2     = revenueByDay.slice(half).reduce((s, d) => s + d.revenue, 0);
  const trendPct = rev1 > 0 ? Math.round(((rev2 - rev1) / rev1) * 100) : 0;
  const trendPos = trendPct >= 0;

  const topWorkout = workoutStats[0];
  const topTrainer = [...trainerLoad].sort((a, b) => b.sessions_count - a.sessions_count)[0];

  // Workout bars HTML
  const workoutBarsHtml = workoutStats.length
    ? workoutStats.map(w => {
        const maxW = workoutStats[0]?.bookings_count || 1;
        const pct  = Math.max((w.bookings_count / maxW) * 100, w.bookings_count > 0 ? 3 : 0);
        const icon = WORKOUT_ICONS[w.workout_name] || DEFAULT_WORKOUT_ICON;
        return `<div class="dbar-item">
          <span class="dbar-icon">${icon}</span>
          <span class="dbar-name">${esc(w.workout_name)}</span>
          <span class="dbar-track"><span class="dbar-fill" style="width:${pct}%"></span></span>
          <span class="dbar-val">${number(w.bookings_count)} записів</span>
        </div>`;
      }).join('')
    : '<p class="form-note">Немає даних.</p>';

  // Trainer bars HTML (з ініціалами як аватар)
  const trainerBarsHtml = trainerLoad.length
    ? trainerLoad.map(t => {
        const maxT   = trainerLoad[0]?.sessions_count || 1;
        const pct    = Math.max((t.sessions_count / maxT) * 100, t.sessions_count > 0 ? 3 : 0);
        const parts  = t.trainer_name.split(' ');
        const initials = (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
        const hue    = [...t.trainer_name].reduce((n, c) => n + c.charCodeAt(0), 0) % 360;
        return `<div class="dbar-item">
          <span class="dbar-avatar" style="background:hsl(${hue},50%,30%)">${esc(initials.toUpperCase())}</span>
          <span class="dbar-name dbar-name--wrap">${esc(t.trainer_name)}</span>
          <span class="dbar-track"><span class="dbar-fill" style="width:${pct}%"></span></span>
          <span class="dbar-val">${number(t.sessions_count)} занять</span>
        </div>`;
      }).join('')
    : '<p class="form-note">Немає даних.</p>';

  panel.innerHTML = `
    <div class="manager-page-head">
      <div>
        <h2>Панель керування</h2>
        <p>Огляд за останні 30 днів · ${fmt(from)} — ${fmt(today)}</p>
      </div>
      <button class="primary-btn" data-refresh-manager>↺ Оновити</button>
    </div>

    <!-- KPI картки -->
    <div class="dash-kpi-grid">

      <article class="dash-kpi-card">
        <div class="dash-kpi-card__left">
          <div class="dash-kpi-card__ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M6 20v-1a6 6 0 0 1 12 0v1"/></svg>
          </div>
          <div class="dash-kpi-card__body">
            <span>Клієнтів</span>
            <strong>${number(summary.total_clients)}</strong>
          </div>
        </div>
        <div class="dash-kpi-card__deco">
          <svg viewBox="0 0 52 28" fill="none"><circle cx="18" cy="14" r="6" stroke="#e85002" stroke-width="1.2" opacity=".35"/><circle cx="34" cy="14" r="6" stroke="#e85002" stroke-width="1.2" opacity=".35"/><path d="M4 26v-1a10 10 0 0 1 14-9.2" stroke="#e85002" stroke-width="1" stroke-dasharray="2 2" opacity=".2"/><path d="M34 17A10 10 0 0 1 48 26v1" stroke="#e85002" stroke-width="1" stroke-dasharray="2 2" opacity=".2"/></svg>
        </div>
      </article>

      <article class="dash-kpi-card">
        <div class="dash-kpi-card__left">
          <div class="dash-kpi-card__ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="6" y1="15" x2="10" y2="15"/></svg>
          </div>
          <div class="dash-kpi-card__body">
            <span>Активних абонементів</span>
            <strong>${number(summary.active_subscriptions)}</strong>
          </div>
        </div>
        <div class="dash-kpi-card__deco">
          <svg viewBox="0 0 52 22" fill="none"><polyline points="0,18 12,10 24,14 36,4 52,12" stroke="#e85002" stroke-width="1.5" fill="none" opacity=".3"/></svg>
        </div>
      </article>

      <article class="dash-kpi-card">
        <div class="dash-kpi-card__left">
          <div class="dash-kpi-card__ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 7v5l3 3"/><path d="M9 1l3 3 3-3"/></svg>
          </div>
          <div class="dash-kpi-card__body">
            <span>Дохід за 30 днів</span>
            <strong>${money(summary.revenue)}</strong>
            <small class="${trendPos ? 'dash-trend--up' : 'dash-trend--down'}">${trendPos ? '↗' : '↘'} ${Math.abs(trendPct)}%</small>
          </div>
        </div>
        <div class="dash-kpi-card__deco">
          <svg viewBox="0 0 52 22" fill="none"><path d="M0 18 Q14 4 26 12 Q38 20 52 4" stroke="#e85002" stroke-width="1.5" fill="none" opacity=".3"/><path d="M0 18 Q14 4 26 12 Q38 20 52 4 L52 22 L0 22Z" fill="#e85002" opacity=".1"/></svg>
        </div>
      </article>

      <article class="dash-kpi-card">
        <div class="dash-kpi-card__left">
          <div class="dash-kpi-card__ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
          </div>
          <div class="dash-kpi-card__body">
            <span>Відвідувань</span>
            <strong>${number(summary.visits_count)}</strong>
          </div>
        </div>
        <div class="dash-kpi-card__deco">
          <svg viewBox="0 0 52 22" fill="none"><rect x="0"  y="12" width="9" height="10" rx="2" fill="#e85002" opacity=".3"/><rect x="14" y="6"  width="9" height="16" rx="2" fill="#e85002" opacity=".3"/><rect x="28" y="9"  width="9" height="13" rx="2" fill="#e85002" opacity=".3"/><rect x="42" y="2"  width="9" height="20" rx="2" fill="#e85002" opacity=".3"/></svg>
        </div>
      </article>

    </div>

    <!-- Графік доходу -->
    <section class="panel dash-chart-panel">
      <div class="dash-chart-head">
        <span class="dash-chart-title">
          <svg viewBox="0 0 20 20" width="16" height="16" fill="var(--accent)"><rect x="1" y="10" width="3" height="8" rx="1"/><rect x="6" y="6" width="3" height="12" rx="1"/><rect x="11" y="3" width="3" height="15" rx="1"/><rect x="16" y="8" width="3" height="10" rx="1"/></svg>
          Динаміка доходу
        </span>
        <span class="dash-chart-period">останні 30 днів</span>
      </div>
      <div class="dash-chart-wrap">
        ${svgDashChart(revenueByDay, 'revenue', money(summary.revenue))}
      </div>
    </section>

    <!-- Рейтинг тренувань + Тренери -->
    <div class="manager-two-columns">

      <section class="panel">
        <div class="dbar-head">
          <span class="dbar-head__title">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" width="16" height="16" stroke-linecap="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            Рейтинг тренувань
          </span>
          ${topWorkout ? `<span class="dbar-head__badge">🏆 ${esc(topWorkout.workout_name)}</span>` : ''}
        </div>
        <div class="dbar-list">${workoutBarsHtml}</div>
      </section>

      <section class="panel">
        <div class="dbar-head">
          <span class="dbar-head__title">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" width="16" height="16" stroke-linecap="round"><circle cx="9" cy="7" r="3"/><path d="M3 20v-1a5 5 0 0 1 10 0v1"/><circle cx="17" cy="7" r="3"/><path d="M14 20a5 5 0 0 1 9 0"/></svg>
            Тренери за заняттями
          </span>
          ${topTrainer ? `<span class="dbar-head__badge">🏆 ${esc(topTrainer.trainer_name)}</span>` : ''}
        </div>
        <div class="dbar-list">${trainerBarsHtml}</div>
      </section>

    </div>
  `;
}

async function renderManagerAnalytics() {
  const panel = document.querySelector('[data-screen-panel="analytics"]');
  if (!panel) return;

  const report = await loadManagerReport();
  const { summary, revenueByDay, visitsByDay, trainerLoad, planStats } = report;

  // Фінансові розрахунки
  const totalRev     = summary.revenue;
  const revPerVisit  = summary.visits_count > 0
    ? (totalRev / summary.visits_count).toFixed(0)
    : 0;
  const topPlan      = planStats[0];
  const topPlanShare = totalRev > 0 && topPlan
    ? Math.round((topPlan.revenue / totalRev) * 100)
    : 0;

  panel.innerHTML = `
    <div class="manager-page-head">
      <div>
        <h2>Аналітика</h2>
        <p>Фінансові показники, ефективність тренерів та рентабельність абонементів.</p>
      </div>
      <div class="manager-period">
        <input type="date" data-manager-start value="${report.period.start}">
        <input type="date" data-manager-end value="${report.period.end}">
        <button class="primary-btn" data-refresh-manager>Показати</button>
      </div>
    </div>

    <!-- 6 фінансових KPI -->
    <div class="manager-stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
      <article>
        <span>Дохід за період</span>
        <strong>${money(totalRev)}</strong>
      </article>
      <article class="manager-click-card" data-open-payments style="cursor:pointer">
        <span>Кількість оплат</span>
        <strong>${number(summary.payments_count)}</strong>
        <small style="color:var(--accent);font-size:11px;font-weight:700">↗ переглянути</small>
      </article>
      <article>
        <span>Середній платіж</span>
        <strong>${money(summary.average_payment)}</strong>
      </article>
      <article>
        <span>Відвідувань</span>
        <strong>${number(summary.visits_count)}</strong>
      </article>
      <article>
        <span>Дохід на відвідування</span>
        <strong>${money(revPerVisit)}</strong>
      </article>
      <article>
        <span>Активних абонементів</span>
        <strong>${number(summary.active_subscriptions)}</strong>
      </article>
    </div>

    <!-- Два графіки поруч -->
    <div class="manager-two-columns" style="margin-top:16px">
      <section class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0">Дохід</h3>
          <span style="color:var(--muted);font-size:12px">${money(totalRev)} загалом</span>
        </div>
        <div class="finance-line-chart" style="min-height:180px">
          <div class="chart-grid"></div>
          ${svgAreaChart(revenueByDay, 'revenue', { W: 500, H: 160 })}
          ${chartDateLabels(revenueByDay, 6)}
        </div>
      </section>

      <section class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0">Відвідуваність</h3>
          <span style="color:var(--muted);font-size:12px">${number(summary.visits_count)} відвідувань</span>
        </div>
        <div class="visit-line-chart" style="min-height:180px">
          <div class="chart-grid"></div>
          ${svgAreaChart(visitsByDay, 'visits_count', { areaClass: 'chart-area', lineClass: 'chart-line', dotsClass: 'chart-points', W: 500, H: 160 })}
          ${chartDateLabels(visitsByDay, 6)}
        </div>
      </section>
    </div>

    <!-- Ефективність тренерів -->
    <section class="panel" style="margin-top:16px">
      <h3>Ефективність тренерів</h3>
      <div class="manager-table manager-table--5col">
        <div class="manager-table-head">
          <span>Тренер</span>
          <span>Занять</span>
          <span>Записів</span>
          <span>Клієнтів на заняття</span>
          <span>Заповненість</span>
        </div>
        ${trainerLoad.length
          ? trainerLoad.map(t => {
              const eff        = t.sessions_count
                ? Math.round((t.bookings_count / t.sessions_count) * 10) / 10
                : 0;
              const cap        = t.average_capacity || 0;
              const fillPct    = cap > 0 ? Math.min(100, Math.round((eff / cap) * 100)) : 0;
              const fillColor  = fillPct >= 80
                ? '#39d98a'
                : fillPct >= 50 ? '#ffce45' : 'var(--muted)';
              return `
                <div class="manager-table-row">
                  <span>${esc(t.trainer_name)}</span>
                  <span>${number(t.sessions_count)}</span>
                  <span>${number(t.bookings_count)}</span>
                  <span>${eff}</span>
                  <span>
                    <span class="fill-bar">
                      <span style="width:${fillPct}%;background:${fillColor}"></span>
                    </span>
                    <em style="font-size:11px;color:${fillColor}">${fillPct}%</em>
                  </span>
                </div>`;
            }).join('')
          : '<p class="form-note">Немає даних.</p>'}
      </div>
    </section>

    <!-- Рентабельність тарифів -->
    <section class="panel" style="margin-top:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h3 style="margin:0">Рентабельність тарифів</h3>
        ${topPlan ? `<span style="font-size:12px;color:var(--muted)">Лідер: <strong style="color:var(--text)">${esc(topPlan.plan_name)}</strong> (${topPlanShare}% доходу)</span>` : ''}
      </div>
      <div class="manager-table manager-table--5col">
        <div class="manager-table-head">
          <span>Тариф</span>
          <span>Ціна</span>
          <span>Абонементів</span>
          <span>Оплат</span>
          <span>Дохід / частка</span>
        </div>
        ${planStats.length
          ? planStats.map(p => {
              const share = totalRev > 0 ? Math.round((p.revenue / totalRev) * 100) : 0;
              return `
                <div class="manager-table-row">
                  <span>${esc(p.plan_name)}</span>
                  <span>${money(p.price)}</span>
                  <span>${number(p.subscriptions_count)}</span>
                  <span>${number(p.payments_count)}</span>
                  <span>
                    ${money(p.revenue)}
                    <em style="font-size:11px;color:var(--muted);margin-left:4px">${share}%</em>
                  </span>
                </div>`;
            }).join('')
          : '<p class="form-note">Немає даних.</p>'}
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

// ─── Особисті дані та налаштування менеджера ────────────────────────────────

const MANAGER_SETTINGS_KEY = 'managerSettings';
const managerPasswordModal = document.querySelector('#password-modal');

function setManagerNote(selector, message, type = 'info') {
  const element = document.querySelector(selector);
  if (element) {
    element.textContent = message;
    element.dataset.type = type;
  }
}

/**
 * Зберігає ім'я та телефон менеджера через PUT /auth/profile.
 *
 * @param {HTMLFormElement} form
 */
async function saveManagerProfile(form) {
  const formData = new FormData(form);
  try {
    const data = await apiFetch('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify({
        name: formData.get('name')?.trim(),
        phone: formData.get('phone')?.trim(),
      }),
    });
    if (data && data.token && data.user) {
      setAuth(data.token, data.user);
    }
    await hydrateAccount({ role: ROLE.MANAGER });
    setManagerNote('#manager-profile-feedback', 'Дані збережено', 'success');
  } catch (error) {
    setManagerNote('#manager-profile-feedback', `Не вдалося зберегти: ${error.message}`, 'error');
  }
}

function openManagerPasswordModal() {
  managerPasswordModal?.classList.add('active');
}

function closeManagerPasswordModal() {
  if (!managerPasswordModal) {
    return;
  }
  managerPasswordModal.classList.remove('active');
  managerPasswordModal.querySelector('form')?.reset();
  setManagerNote('#password-feedback', '');
}

/**
 * Змінює пароль менеджера через PUT /auth/password.
 *
 * @param {HTMLFormElement} form
 */
async function changeManagerPassword(form) {
  const formData = new FormData(form);
  const newPassword = formData.get('newPassword');
  if (newPassword !== formData.get('confirmPassword')) {
    setManagerNote('#password-feedback', 'Паролі не співпадають', 'error');
    return;
  }

  try {
    await apiFetch('/auth/password', {
      method: 'PUT',
      body: JSON.stringify({
        currentPassword: formData.get('currentPassword'),
        newPassword,
      }),
    });
    closeManagerPasswordModal();
    setManagerNote('#manager-profile-feedback', 'Пароль змінено', 'success');
  } catch (error) {
    setManagerNote('#password-feedback', `Не вдалося змінити пароль: ${error.message}`, 'error');
  }
}

function bindManagerPersonal() {
  const profileForm = document.querySelector('#manager-profile-form');
  profileForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveManagerProfile(profileForm);
  });

  const passwordForm = document.querySelector('#password-form');
  passwordForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    changeManagerPassword(passwordForm);
  });

  document.querySelector('[data-change-password]')?.addEventListener('click', openManagerPasswordModal);
  document.querySelector('[data-password-cancel]')?.addEventListener('click', closeManagerPasswordModal);
  managerPasswordModal?.addEventListener('click', (event) => {
    if (event.target === managerPasswordModal) {
      closeManagerPasswordModal();
    }
  });
}

/**
 * Відновлює та зберігає налаштування сповіщень менеджера у localStorage
 * (окремого серверного сховища налаштувань немає).
 */
function loadManagerSettings() {
  const list = document.querySelector('#manager-settings-list');
  if (!list) {
    return;
  }

  const saved = JSON.parse(localStorage.getItem(MANAGER_SETTINGS_KEY) || '{}');
  list.querySelectorAll('[data-setting]').forEach((input) => {
    const key = input.dataset.setting;
    if (key in saved) {
      input.checked = Boolean(saved[key]);
    }
  });

  document.querySelector('#save-manager-settings')?.addEventListener('click', () => {
    const next = {};
    list.querySelectorAll('[data-setting]').forEach((input) => {
      next[input.dataset.setting] = input.checked;
    });
    localStorage.setItem(MANAGER_SETTINGS_KEY, JSON.stringify(next));
    setManagerNote('#manager-settings-feedback', 'Налаштування збережено', 'success');
  });
}

async function initManagerArm() {
  initSidebar();
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

  if (currentPath.includes('/manager/personal.html')) {
    bindManagerPersonal();
  }

  if (currentPath.includes('/manager/settings.html')) {
    loadManagerSettings();
  }
}

if (currentPath.includes('/manager/')) {
  initManagerArm().catch((error) => {
    console.error(error);
  });
}