import {
  apiFetch,
  clearAuth,
  formatDate,
  getAuth,
  requireFreshAuth,
  setAuth,
} from './api.js';

import { escapeHtml } from './utils.js';
import { hydrateAccount } from './account.js';
import { PAGE, ROLE } from './constants.js';
import { initSidebar } from './sidebar.js';
import { initTheme } from './theme.js';
import { initNotifications } from './notifications.js';
import { initModalHotkeys } from './modal-hotkeys.js';

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

// Повне екранування (включно з лапками) — безпечне і для тексту, і для
// значень HTML-атрибутів. Делегуємо у спільний escapeHtml, щоб не дублювати.
function esc(value = '') {
  return escapeHtml(value);
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
    manager: 'Керівник',
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
// Агрегує щоденні дані в тижневі або місячні бакети
function aggregateChartData(rows, valueKey) {
  if (rows.length <= 35) return rows;
  const byMonth = rows.length > 90;
  const groups  = new Map();
  rows.forEach(r => {
    const s  = r.date.slice(0, 10);
    const [y, mo, d] = s.split('-').map(Number);
    let key;
    if (byMonth) {
      key = `${y}-${String(mo).padStart(2,'0')}-01`;
    } else {
      const dt  = new Date(y, mo - 1, d);
      const dow = (dt.getDay() + 6) % 7; // 0=Пн … 6=Нд
      const mon = new Date(y, mo - 1, d - dow);
      key = `${mon.getFullYear()}-${String(mon.getMonth()+1).padStart(2,'0')}-${String(mon.getDate()).padStart(2,'0')}`;
    }
    const cur = groups.get(key) || { date: key, [valueKey]: 0 };
    cur[valueKey] += Number(r[valueKey] || 0);
    groups.set(key, cur);
  });
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const MONTHS_UA = ['','Січ','Лют','Бер','Кві','Тра','Чер','Лип','Сер','Вер','Жов','Лис','Гру'];

function svgAreaChart(rows, valueKey, {
  W = 600, H = 160,
  color = null,
} = {}) {
  if (!rows.length) return '<p class="form-note" style="padding:18px 0">Немає даних за цей період.</p>';

  const data  = aggregateChartData(rows, valueKey);
  const vals  = data.map(d => Number(d[valueKey] || 0));
  const max   = Math.max(...vals, 1);
  const n     = data.length;
  const isRev = valueKey === 'revenue';
  const clr   = color || (isRev ? '#F59E0B' : '#E85002');
  const showDots = n <= 20;
  const sw    = n > 50 ? 1.8 : n > 25 ? 2.2 : 2.5;
  const PAD_T = 18, PAD_B = 10;
  const gradId = 'cg' + Math.random().toString(36).slice(2, 6);
  const byMonth = rows.length > 90;

  const px = i  => +(n === 1 ? W / 2 : (i / (n - 1)) * W).toFixed(1);
  const py = v  => +(PAD_T + (H - PAD_T - PAD_B) * (1 - v / max)).toFixed(1);
  const pts = vals.map((v, i) => [px(i), py(v)]);

  const line = pts.reduce((acc, [x, y], i) => {
    if (i === 0) return `M${x},${y}`;
    const [pvx, pvy] = pts[i - 1];
    const t = (x - pvx) / 2.5;
    return `${acc} C${(pvx + t).toFixed(1)},${pvy} ${(x - t).toFixed(1)},${y} ${x},${y}`;
  }, '');

  const area = `${line} L${pts.at(-1)[0]},${H} L${pts[0][0]},${H} Z`;

  // Horizontal grid lines
  const grid = [0.33, 0.66].map(f => {
    const y = (PAD_T + (H - PAD_T - PAD_B) * (1 - f)).toFixed(1);
    return `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="currentColor" stroke-width="0.6" opacity="0.10"/>`;
  }).join('');

  // Dots
  const dots = showDots
    ? pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.5"/>`).join('')
    : '';

  // Hover strips
  const stripW = n > 1 ? W / n : W;
  const strips = data.map((d, i) => {
    const [cx2, cy2] = pts[i];
    const s  = d.date.slice(0, 10);
    const [yr, mo, day] = s.split('-').map(Number);
    const dateLbl = byMonth ? `${MONTHS_UA[mo]} ${yr}` : `${day} ${MONTHS_UA[mo]}`;
    const v  = vals[i];
    const valLbl = isRev
      ? v.toLocaleString('uk-UA') + ' грн'
      : v + ' відв.';
    const sx = Math.max(0, cx2 - stripW / 2);
    return `<rect class="chart-strip" x="${sx.toFixed(1)}" y="0" width="${Math.min(stripW, W - sx).toFixed(1)}" height="${H}" fill="transparent" data-cx="${cx2}" data-cy="${cy2}" data-date="${dateLbl}" data-val="${valLbl}"/>`;
  }).join('');

  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" data-chart>
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${clr}" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="${clr}" stop-opacity="0.01"/>
      </linearGradient>
    </defs>
    <g color="var(--muted)">${grid}</g>
    <path d="${area}" fill="url(#${gradId})"/>
    <path d="${line}" stroke="${clr}" stroke-width="${sw}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    ${showDots ? `<g fill="${clr}" stroke="var(--bg,#fff)" stroke-width="2">${dots}</g>` : ''}
    <g class="chart-cursor" style="display:none" pointer-events="none">
      <line class="chart-cursor-line" stroke="${clr}" stroke-width="1" stroke-dasharray="4,3" x1="0" x2="0" y1="${PAD_T}" y2="${H}"/>
      <circle class="chart-cursor-dot" r="5" fill="${clr}" stroke="var(--bg,#fff)" stroke-width="2.5"/>
    </g>
    ${strips}
  </svg>`;
}

// ── Підписи дат — абсолютне позиціонування ────────────────────────────────
function chartDateLabels(rows, n = 6, valueKey = 'revenue') {
  if (!rows.length) return '';
  const data    = aggregateChartData(rows, valueKey);
  const total   = data.length;
  const byMonth = rows.length > 90;

  const indices = total <= n
    ? data.map((_, i) => i)
    : Array.from({ length: n }, (_, k) => Math.round(k * (total - 1) / (n - 1)));

  const labels = [...new Set(indices)].map(i => {
    const s = data[i].date.slice(0, 10);
    const [, mo, d] = s.split('-').map(Number);
    const lbl = byMonth ? MONTHS_UA[mo] : `${+d} ${MONTHS_UA[mo]}`;
    const pct = total === 1 ? 50 : (i / (total - 1)) * 100;
    return `<span style="position:absolute;left:${pct.toFixed(1)}%;transform:translateX(-50%);white-space:nowrap">${lbl}</span>`;
  }).join('');

  return `<div class="chart-labels" style="position:relative;height:16px;margin-top:6px">${labels}</div>`;
}

// ── Tooltip при наведенні на графік ───────────────────────────────────────
function initChartTooltips(container) {
  let tip = document.getElementById('__chart_tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = '__chart_tip';
    tip.className = 'chart-tooltip';
    document.body.appendChild(tip);
  }

  // SVG charts (analytics page)
  container.querySelectorAll('[data-chart]').forEach(svg => {
    const cursor     = svg.querySelector('.chart-cursor');
    const cursorLine = svg.querySelector('.chart-cursor-line');
    const cursorDot  = svg.querySelector('.chart-cursor-dot');

    svg.querySelectorAll('.chart-strip').forEach(strip => {
      strip.addEventListener('mouseenter', () => {
        const cx = strip.dataset.cx;
        const cy = strip.dataset.cy;
        if (cursor) {
          cursorLine.setAttribute('x1', cx); cursorLine.setAttribute('x2', cx);
          cursorDot.setAttribute('cx', cx);  cursorDot.setAttribute('cy', cy);
          cursor.style.display = '';
        }
        tip.innerHTML = `<span class="ct-date">${strip.dataset.date}</span><strong class="ct-val">${strip.dataset.val}</strong>`;
        tip.style.display = 'block';
      });
      strip.addEventListener('mousemove', e => {
        tip.style.left = (e.pageX + 14) + 'px';
        tip.style.top  = (e.pageY - 58) + 'px';
      });
      strip.addEventListener('mouseleave', () => {
        if (cursor) cursor.style.display = 'none';
        tip.style.display = 'none';
      });
    });
  });

  // Dashboard charts (HTML-based, .dch-strip)
  container.querySelectorAll('.dch-strip').forEach(strip => {
    strip.addEventListener('mouseenter', () => {
      tip.innerHTML = `<span class="ct-date">${strip.dataset.date}</span><strong class="ct-val">${strip.dataset.val}</strong>`;
      tip.style.display = 'block';
    });
    strip.addEventListener('mousemove', e => {
      tip.style.left = (e.pageX + 14) + 'px';
      tip.style.top  = (e.pageY - 58) + 'px';
    });
    strip.addEventListener('mouseleave', () => {
      tip.style.display = 'none';
    });
  });
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
  const showDotsDash = data.length <= 20;
  const dotsHtml = showDotsDash
    ? pts.map(([x, y]) => `<span class="dch-dot" style="left:${x}%;top:${y}%"></span>`).join('')
    : '';

  // Hover strips for tooltip
  const isRevDash = valueKey === 'revenue';
  const byMonthDash = data.length > 90;
  const stripWPct = 100 / data.length;
  const hoverStripsHtml = data.map((d, i) => {
    const [x, y] = pts[i];
    const s  = d.date.slice(0, 10);
    const [yr, mo, day] = s.split('-').map(Number);
    const dateLbl = byMonthDash ? `${MONTHS_UA[mo]} ${yr}` : `${day} ${MONTHS_UA[mo]}`;
    const v = vals[i];
    const valLbl = isRevDash ? v.toLocaleString('uk-UA') + ' грн' : v + ' відв.';
    const sx = Math.max(0, x - stripWPct / 2);
    return `<span class="dch-strip" style="left:${sx.toFixed(2)}%;width:${stripWPct.toFixed(2)}%;height:100%;position:absolute;top:0;cursor:crosshair" data-cx="${x}" data-cy="${y}" data-date="${dateLbl}" data-val="${valLbl}"></span>`;
  }).join('');

  // X-axis labels (max 8 evenly spaced)
  const n    = Math.min(8, data.length);
  const step = Math.max(1, Math.floor(data.length / n));
  const xLabelsHtml = data.map((d, i) => {
    if (i % step !== 0 && i !== data.length - 1) return '';
    const pct = data.length === 1 ? 50 : (i / (data.length - 1)) * 100;
    const s   = d.date.slice(0, 10);
    const [, mo, dy] = s.split('-').map(Number);
    const lbl = byMonthDash ? MONTHS_UA[mo] : `${+dy} ${MONTHS_UA[mo]}`;
    return `<span style="left:${pct}%">${lbl}</span>`;
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
          ${hoverStripsHtml}
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
  const endInput   = document.querySelector('[data-manager-end]');

  const now   = new Date();
  const pad   = n => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const firstOfMonth = `${now.getFullYear()}-${pad(now.getMonth()+1)}-01`;

  const params = new URLSearchParams();
  params.set('start', startInput?.value || firstOfMonth);
  params.set('end',   endInput?.value   || today);

  return await apiFetch(`/reports/manager?${params}`);
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

  // ── Skeleton поки дані завантажуються ──────────────────
  panel.innerHTML = `
    <p class="skel" style="width:320px;height:14px;margin:0 0 20px"></p>
    <div class="skel-kpi-grid">
      ${Array(4).fill(0).map(() => `
        <div class="skel-kpi-card">
          <div class="skel" style="width:44px;height:44px;border-radius:12px;flex-shrink:0"></div>
          <div style="flex:1;display:flex;flex-direction:column;gap:8px">
            <div class="skel" style="height:11px;width:70%"></div>
            <div class="skel" style="height:26px;width:50%"></div>
            <div class="skel" style="height:10px;width:45%"></div>
          </div>
        </div>`).join('')}
    </div>
    <div class="skel-chart">
      <div class="skel" style="height:14px;width:180px;margin-bottom:12px"></div>
      <div class="skel" style="height:140px;width:100%;border-radius:6px"></div>
    </div>
    <div class="skel-bars">
      ${Array(2).fill(0).map(() => `
        <div class="skel-bar-card">
          <div class="skel" style="height:14px;width:60%"></div>
          ${Array(3).fill(0).map(() => `
            <div style="display:flex;align-items:center;gap:10px">
              <div class="skel" style="width:32px;height:32px;border-radius:50%;flex-shrink:0"></div>
              <div style="flex:1;display:flex;flex-direction:column;gap:6px">
                <div class="skel" style="height:10px;width:80%"></div>
                <div class="skel" style="height:8px;width:100%"></div>
              </div>
            </div>`).join('')}
        </div>`).join('')}
    </div>
  `;

  // ── Дати ───────────────────────────────────────────────
  const now  = new Date();
  const pad2 = n => String(n).padStart(2, '0');
  const fmtD = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;

  const from30        = new Date(now); from30.setDate(now.getDate() - 29);
  const prevMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0);        // останній день мин. місяця
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);   // перший день мин. місяця

  // ── 2 паралельних запити ───────────────────────────────
  const [report, prevReport] = await Promise.all([
    apiFetch(`/reports/manager?start=${fmtD(from30)}&end=${fmtD(now)}`),
    apiFetch(`/reports/manager?start=${fmtD(prevMonthStart)}&end=${fmtD(prevMonthEnd)}`),
  ]);

  const { summary, revenueByDay, workoutStats, trainerLoad } = report;
  const prevS = prevReport.summary;

  // ── Стрілка порівняння з минулим місяцем ──────────────
  function cmpBadge(curr, prev) {
    if (!prev || prev === 0) return '';
    const pct = Math.round(((curr - prev) / prev) * 100);
    if (pct === 0) return '';
    const color = pct > 0 ? '#39d98a' : '#ff8585';
    const arrow = pct > 0 ? '↑' : '↓';
    return `<small style="color:${color};font-size:11px;font-weight:600">${arrow} ${Math.abs(pct)}% мін. міс.</small>`;
  }

  const topWorkout = workoutStats[0];
  const topTrainer = [...trainerLoad].sort((a, b) => b.sessions_count - a.sessions_count)[0];

  const revBadge  = cmpBadge(summary.revenue,         prevS.revenue);
  const visBadge  = cmpBadge(summary.visits_count,    prevS.visits_count);
  const payBadge  = cmpBadge(summary.payments_count,  prevS.payments_count);
  const subBadge  = cmpBadge(summary.active_subscriptions, prevS.active_subscriptions);

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
    <p style="margin:0 0 20px;color:var(--muted)">Огляд за останні 30 днів · ${fmtD(from30)} — ${fmtD(now)}</p>

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
            ${subBadge}
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
            ${revBadge}
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
            ${visBadge}
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

  // Tooltip на дашборд-графіку
  initChartTooltips(panel);
}

async function renderManagerAnalytics() {
  const panel = document.querySelector('[data-screen-panel="analytics"]');
  if (!panel) return;

  const report = await loadManagerReport();
  if (!report) return;

  const {
    summary, revenueByDay, visitsByDay, trainerLoad, planStats,
    prevPeriod = {}, visitsByDayOfWeek = [], cancellationStats = {},
    workoutStats = [],
  } = report;

  // Розрахунки
  const totalRev    = summary.revenue;
  const revPerVisit = summary.visits_count > 0 ? Math.round(totalRev / summary.visits_count) : 0;
  const topPlan     = planStats[0];
  const topPlanShare = totalRev > 0 && topPlan ? Math.round((topPlan.revenue / totalRev) * 100) : 0;

  // Тренд-хелпер: +12% / -5% / без змін
  function trend(curr, prev) {
    if (!prev) return '';
    const pct = Math.round(((curr - prev) / prev) * 100);
    if (pct === 0) return '<small style="color:var(--muted);font-size:11px">без змін</small>';
    const color = pct > 0 ? '#39d98a' : '#ff8585';
    const arrow = pct > 0 ? '↑' : '↓';
    return `<small style="color:${color};font-size:11px;font-weight:700">${arrow} ${Math.abs(pct)}% до попереднього</small>`;
  }

  // DOW бар-чарт (Пн–Нд)
  const maxDow = Math.max(...(visitsByDayOfWeek.map(d => d.visits_count)), 1);
  const dowBars = visitsByDayOfWeek.map(d => {
    const pct = Math.round((d.visits_count / maxDow) * 100);
    const color = pct === 100 ? 'var(--accent)' : pct >= 60 ? '#ffce45' : 'var(--surface2,#333)';
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1">
      <span style="font-size:10px;color:var(--muted);font-weight:700">${d.visits_count || ''}</span>
      <div style="height:60px;width:100%;background:var(--surface);border-radius:4px;position:relative;overflow:hidden">
        <div style="position:absolute;bottom:0;width:100%;height:${pct}%;background:${color};border-radius:4px;transition:.3s"></div>
      </div>
      <span style="font-size:11px;color:var(--text);font-weight:600">${esc(d.day)}</span>
    </div>`;
  }).join('');

  // Популярність тренувань — бари
  const totalBookings = workoutStats.reduce((s, w) => s + w.bookings_count, 0);
  const CHART_COLORS = ['var(--accent)', '#f97316', '#ffce45', '#39d98a', '#818cf8', '#06b6d4'];
  const workoutPopularityHtml = workoutStats.length
    ? workoutStats.map((w, i) => {
        const max   = workoutStats[0]?.bookings_count || 1;
        const pct   = Math.max(Math.round((w.bookings_count / max) * 100), w.bookings_count > 0 ? 2 : 0);
        const color = CHART_COLORS[i % CHART_COLORS.length];
        const share = totalBookings > 0 ? Math.round((w.bookings_count / totalBookings) * 100) : 0;
        return '<div style="display:flex;align-items:center;gap:10px">'
          + '<span style="width:22px;text-align:right;font-size:11px;color:var(--muted);font-weight:700;flex-shrink:0">' + (i + 1) + '</span>'
          + '<span style="flex:1;min-width:0">'
          + '<div style="display:flex;justify-content:space-between;margin-bottom:4px">'
          + '<span style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(w.workout_name) + '</span>'
          + '<span style="font-size:12px;color:var(--muted);flex-shrink:0;margin-left:8px">' + number(w.bookings_count) + ' зап. · ' + share + '%</span>'
          + '</div>'
          + '<div style="height:6px;background:var(--surface);border-radius:3px;overflow:hidden">'
          + '<div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:3px;transition:.4s"></div>'
          + '</div>'
          + '</span></div>';
      }).join('')
    : '<p class="form-note">Немає даних про тренування за цей період.</p>';

  const now2 = new Date();
  const pad2 = n => String(n).padStart(2,'0');
  const todayStr       = `${now2.getFullYear()}-${pad2(now2.getMonth()+1)}-${pad2(now2.getDate())}`;
  const weekAgo        = new Date(now2 - 6*86400000);
  const weekAgoStr     = `${weekAgo.getFullYear()}-${pad2(weekAgo.getMonth()+1)}-${pad2(weekAgo.getDate())}`;
  const monthStart     = `${now2.getFullYear()}-${pad2(now2.getMonth()+1)}-01`;
  const yearStart      = `${now2.getFullYear()}-01-01`;

  panel.innerHTML = `
    <div style="margin-bottom:20px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <!-- Чіпи -->
        <div class="ana-chips-row" style="flex-shrink:0;margin:0">
          <button class="chip ana-chip${_anaActiveChip==='today'?' active':''}" data-chip="today" data-s="${todayStr}"  data-e="${todayStr}">Сьогодні</button>
          <button class="chip ana-chip${_anaActiveChip==='week'?' active':''}"  data-chip="week"  data-s="${weekAgoStr}" data-e="${todayStr}">Тиждень</button>
          <button class="chip ana-chip${_anaActiveChip==='month'?' active':''}" data-chip="month" data-s="${monthStart}" data-e="${todayStr}">Місяць</button>
          <button class="chip ana-chip${_anaActiveChip==='year'?' active':''}"  data-chip="year"  data-s="${yearStart}"  data-e="${todayStr}">Рік</button>
        </div>
        <!-- Розділювач -->
        <div style="width:1px;height:24px;background:var(--line);flex-shrink:0"></div>
        <!-- Дати -->
        <input type="date" data-manager-start value="${report.period.start}" style="flex:1;min-width:120px;max-width:160px">
        <span style="color:var(--muted);font-size:13px;flex-shrink:0">—</span>
        <input type="date" data-manager-end value="${report.period.end}" style="flex:1;min-width:120px;max-width:160px">
        <!-- Кнопки -->
        <button class="primary-btn" data-refresh-manager style="flex-shrink:0">Показати</button>
        <button class="ghost-btn" id="analytics-pdf-btn" style="white-space:nowrap;flex-shrink:0">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span class="pdf-btn-label">PDF</span>
        </button>
      </div>
    </div>

    <!-- KPI картки з трендами -->
    <div class="manager-stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
      <article>
        <span>Дохід за період</span>
        <strong>${money(totalRev)}</strong>
        ${trend(totalRev, prevPeriod.revenue)}
      </article>
      <article class="manager-click-card" data-open-payments style="cursor:pointer;position:relative">
        <span>Кількість оплат</span>
        <strong>${number(summary.payments_count)}</strong>
        ${trend(summary.payments_count, prevPeriod.payments_count)}
        <svg style="position:absolute;top:10px;right:10px;opacity:.4" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h10M9 4l4 4-4 4"/></svg>
      </article>
      <article>
        <span>Середній платіж</span>
        <strong>${money(summary.average_payment)}</strong>
      </article>
      <article>
        <span>Відвідувань</span>
        <strong>${number(summary.visits_count)}</strong>
        ${trend(summary.visits_count, prevPeriod.visits_count)}
      </article>
      <article>
        <span>Актуальних клієнтів</span>
        <strong>${number(summary.total_clients)}</strong>
        ${trend(summary.total_clients, prevPeriod.total_clients)}
      </article>
      <article>
        <span>Активних абонементів</span>
        <strong>${number(summary.active_subscriptions)}</strong>
      </article>
    </div>

    <!-- Два графіки -->
    <div class="manager-two-columns" style="margin-top:16px">
      <section class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0">Дохід</h3>
          <span style="color:var(--muted);font-size:12px">${money(totalRev)} загалом</span>
        </div>
        <div class="finance-line-chart" style="min-height:180px">
          <div class="chart-grid"></div>
          ${svgAreaChart(revenueByDay, 'revenue', { W: 500, H: 160 })}
          ${chartDateLabels(revenueByDay, 6, 'revenue')}
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
          ${chartDateLabels(visitsByDay, 6, 'visits_count')}
        </div>
      </section>
    </div>

    <!-- Аналітика популярності тренувань -->
    <section class="panel" style="margin-top:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3 style="margin:0">Популярність тренувань</h3>
        ${workoutStats.length ? '<span style="color:var(--muted);font-size:12px">' + workoutStats.length + ' типів · ' + number(totalBookings) + ' записів</span>' : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">${workoutPopularityHtml}</div>
    </section>

    <!-- Ефективність тренерів -->
    <section class="panel" style="margin-top:16px">
      <h3>Ефективність тренерів</h3>
      <div class="manager-table manager-table--5col">
        <div class="manager-table-head">
          <span>Тренер</span><span>Занять</span><span>Записів</span><span>Кл/заняття</span><span>Заповненість</span>
        </div>
        ${trainerLoad.length
          ? trainerLoad.map(t => {
              const eff       = t.sessions_count ? Math.round((t.bookings_count / t.sessions_count) * 10) / 10 : 0;
              const cap       = t.average_capacity || 0;
              const fillPct   = cap > 0 ? Math.min(100, Math.round((eff / cap) * 100)) : 0;
              const fillColor = fillPct >= 80 ? '#39d98a' : fillPct >= 50 ? '#ffce45' : 'var(--muted)';
              const hue       = [...t.trainer_name].reduce((n, c) => n + c.charCodeAt(0), 0) % 360;
              const tInit     = initials(t.trainer_name);
              const detailsPayload = JSON.stringify({
                name:     t.trainer_name,
                email:    t.trainer_email || '—',
                phone:    t.trainer_phone || '—',
                sessions: t.sessions_count,
                bookings: t.bookings_count,
                fill:     fillPct,
              }).replace(/"/g, '&quot;');
              return `<div class="manager-table-row">
                <span style="display:flex;align-items:center;gap:8px">
                  <span style="width:32px;height:32px;border-radius:50%;background:hsl(${hue},45%,38%);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">${esc(tInit)}</span>
                  <span style="display:flex;flex-direction:column">
                    <strong style="font-size:13px">${esc(t.trainer_name)}</strong>
                    ${t.trainer_email ? `<span style="font-size:11px;color:var(--muted)">${esc(t.trainer_email)}</span>` : ''}
                  </span>
                </span>
                <span>${number(t.sessions_count)}</span>
                <span>${number(t.bookings_count)}</span>
                <span>${eff}</span>
                <span style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  <span style="display:flex;align-items:center;gap:6px;flex:1;min-width:80px">
                    <span class="fill-bar" style="flex:1"><span style="width:${fillPct}%;background:${fillColor}"></span></span>
                    <em style="font-size:11px;color:${fillColor};min-width:28px">${fillPct}%</em>
                  </span>
                  <button class="ghost-btn trainer-details-btn" style="font-size:11px;padding:3px 8px;flex-shrink:0" data-trainer="${detailsPayload}">Деталі</button>
                </span>
              </div>`;
            }).join('')
          : '<p class="form-note">Немає даних.</p>'}
      </div>
    </section>

    <!-- Рентабельність тарифів -->
    <section class="panel" style="margin-top:16px">
      <h3 style="margin:0 0 14px">Рентабельність тарифів</h3>
      <div class="manager-table manager-table--5col">
        <div class="manager-table-head">
          <span>Тариф</span><span>Ціна</span><span>Абонем.</span><span>Оплат</span><span>Дохід</span>
        </div>
        ${planStats.length
          ? planStats.map((p, idx) => {
              const share = totalRev > 0 ? Math.round((p.revenue / totalRev) * 100) : 0;
              const isLeader = idx === 0 && p.revenue > 0;
              const rowStyle = isLeader ? 'background:rgba(var(--accent-rgb,233,83,34),.07);border-left:3px solid var(--accent);padding-left:13px' : '';
              return '<div class="manager-table-row" style="' + rowStyle + '">'
                + '<span style="display:flex;align-items:center;gap:6px">'
                + (isLeader ? '<span style="font-size:14px" title="Лідер">🏆</span>' : '')
                + '<span style="' + (isLeader ? 'font-weight:600' : '') + '">' + esc(p.plan_name) + '</span>'
                + '</span>'
                + '<span>' + money(p.price) + '</span>'
                + '<span>' + number(p.subscriptions_count) + '</span>'
                + '<span>' + number(p.payments_count) + '</span>'
                + '<span style="display:flex;flex-direction:column;gap:4px;min-width:120px">'
                + '<span style="font-weight:600">' + money(p.revenue) + '</span>'
                + '<span style="display:flex;align-items:center;gap:6px">'
                + '<span style="flex:1;height:4px;background:var(--surface);border-radius:2px;overflow:hidden;min-width:40px">'
                + '<span style="display:block;height:100%;width:' + share + '%;background:var(--accent);border-radius:2px"></span>'
                + '</span>'
                + '<em style="font-size:11px;color:var(--muted);flex-shrink:0">' + share + '%</em>'
                + '</span>'
                + '</span>'
                + '</div>';
            }).join('')
          : '<p class="form-note">Немає даних.</p>'}
      </div>
    </section>
  `;

  // Відкривати календар по кліку на весь інпут (не тільки на іконку)
  panel.querySelectorAll('[data-manager-start],[data-manager-end]').forEach(input => {
    input.addEventListener('click', () => {
      try { input.showPicker(); } catch {}
    });
  });

  // Tooltips при наведенні на графіки
  initChartTooltips(panel);
}

const ROLE_LABEL = { client: 'Клієнт', trainer: 'Тренер', admin: 'Адміністратор', manager: 'Керівник' };
const ROLE_FILTER_MAP = { all: null, clients: 'client', trainers: 'trainer', admins: 'admin' };

// Module-level filter state — persists across re-renders
let _anaActiveChip = 'month'; // поточний активний чіп аналітики
let _muActiveFilter = null;
let _muSearch = '';

function _muApplyFilters() {
  const rows = document.querySelectorAll('#users-table-body .mu-row');
  const feedback = document.querySelector('#users-feedback');
  let visible = 0;
  rows.forEach((row) => {
    const matchesSearch = !_muSearch || (row.dataset.userSearch || '').includes(_muSearch);
    const matchesRole   = !_muActiveFilter || row.dataset.userRole === _muActiveFilter;
    const show = matchesSearch && matchesRole;
    // Use class instead of inline style — CSS `!important` beats element.style
    row.classList.toggle('mu-hidden', !show);
    if (show) visible++;
  });
  if (feedback) feedback.textContent = visible === 0 ? 'Користувача не знайдено.' : '';
}

// AbortController — скасовує старі слухачі кнопок фільтру при кожному ре-рендері
let _muAbort = null;
function _muRebindFilters() {
  if (_muAbort) _muAbort.abort();
  _muAbort = new AbortController();
  const signal = _muAbort.signal;

  // Кнопки фільтру ролей
  document.querySelectorAll('.cseg-btn[data-user-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cseg-btn[data-user-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _muActiveFilter = ROLE_FILTER_MAP[btn.dataset.userFilter] ?? null;
      _muApplyFilters();
    }, { signal });
  });

  // Пошук
  const searchInput = document.querySelector('#users-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      _muSearch = searchInput.value.trim().toLowerCase();
      _muApplyFilters();
    }, { signal });
  }
}

// Кастомний confirm у стилі сайту — повертає Promise<boolean>
function muConfirm(title, text) {
  return new Promise((resolve) => {
    const backdrop = document.getElementById('manager-modal');
    const elTitle  = document.getElementById('modal-title');
    const elText   = document.getElementById('modal-text');
    const btnOk    = document.getElementById('modal-confirm');
    const btnCancel= document.getElementById('modal-cancel');
    if (!backdrop || !btnOk || !btnCancel) { resolve(window.confirm(text)); return; }

    if (elTitle) elTitle.textContent = title;
    if (elText)  elText.textContent  = text;
    backdrop.classList.add('active');

    const finish = (result) => {
      backdrop.classList.remove('active');
      btnOk.removeEventListener('click', onOk);
      btnCancel.removeEventListener('click', onCancel);
      backdrop.removeEventListener('click', onBackdrop);
      resolve(result);
    };
    const onOk       = () => finish(true);
    const onCancel   = () => finish(false);
    const onBackdrop = (e) => { if (e.target === backdrop) finish(false); };

    btnOk.addEventListener('click', onOk);
    btnCancel.addEventListener('click', onCancel);
    backdrop.addEventListener('click', onBackdrop);
  });
}

// Зміна ролі + dropdown — лише один раз (event delegation на document)
let _muRoleDelegated = false;
function _muBindRoleOnce() {
  if (_muRoleDelegated) return;
  _muRoleDelegated = true;
  const ROLE_LABEL_UA = { client: 'Клієнт', trainer: 'Тренер', admin: 'Адміністратор' };

  document.addEventListener('click', async (e) => {
    // Відкрити/закрити dropdown
    const ddBtn = e.target.closest('.mu-role-dd-btn');
    if (ddBtn) {
      e.stopPropagation();
      // Закрити всі інші
      document.querySelectorAll('.mu-role-dd.open').forEach(d => {
        if (d !== ddBtn.closest('.mu-role-dd')) d.classList.remove('open');
      });
      ddBtn.closest('.mu-role-dd').classList.toggle('open');
      return;
    }

    // Закрити dropdown при кліку поза ним
    if (!e.target.closest('.mu-role-dd')) {
      document.querySelectorAll('.mu-role-dd.open').forEach(d => d.classList.remove('open'));
    }

    // Вибрати нову роль
    const option = e.target.closest('.mu-role-option');
    if (!option) return;
    const userId  = option.dataset.userId;
    const newRole = option.dataset.newRole;
    const label   = ROLE_LABEL_UA[newRole] || newRole;
    const row     = option.closest('.mu-row');
    const name    = row?.querySelector('strong')?.textContent || '';
    option.closest('.mu-role-dd')?.classList.remove('open');
    const ok = await muConfirm('Зміна ролі', `Змінити роль «${name}» на ${label}?`);
    if (!ok) return;
    apiFetch(`/users/${userId}`, { method: 'PUT', body: JSON.stringify({ role: newRole }) })
      .then(() => renderManagerUsers())
      .catch(() => alert('Помилка зміни ролі'));
  });
}

function initials(name) {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

async function renderManagerUsers() {
  const panel = document.querySelector('[data-screen-panel="users"]');
  if (!panel) return;

  const users = await apiFetch('/users');

  // Update stats
  const clients = users.filter((u) => u.role === 'client').length;
  const trainers = users.filter((u) => u.role === 'trainer').length;
  const statTotal = panel.querySelector('#mu-stat-total');
  const statClients = panel.querySelector('#mu-stat-clients');
  const statTrainers = panel.querySelector('#mu-stat-trainers');
  if (statTotal) statTotal.textContent = users.length;
  if (statClients) statClients.textContent = clients;
  if (statTrainers) statTrainers.textContent = trainers;

  // Populate table
  const tbody = panel.querySelector('#users-table-body');
  if (!tbody) return;

  if (!users.length) {
    tbody.innerHTML = '<p class="form-note" style="padding:16px">Користувачів немає.</p>';
    return;
  }

  // Сортування: адміни → тренери → клієнти
  const ROLE_ORDER = { admin: 0, manager: 1, trainer: 2, client: 3 };
  const sorted = [...users].sort((a, b) =>
    (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)
  );

  tbody.innerHTML = sorted.map((user) => {
    const roleKey = user.role || 'client';
    const roleLabel = ROLE_LABEL[roleKey] || roleKey;
    const phone = user.phone || '—';
    const email = user.email || '—';
    const searchText = `${user.name || ''} ${email} ${phone} ${roleLabel}`.toLowerCase();
    const avatarClass = roleKey === 'trainer' ? 'trainer' : roleKey === 'admin' ? 'admin' : roleKey === 'manager' ? 'admin' : 'client';
    const sub = `${roleLabel}${user.phone ? ' · ' + user.phone : ''}`;

    // Кнопка вибору ролі (dropdown)
    const roleOptions = {
      client:  [{ role: 'trainer', label: 'Тренер' }, { role: 'admin', label: 'Адміністратор' }],
      trainer: [{ role: 'client', label: 'Клієнт' }, { role: 'admin', label: 'Адміністратор' }],
      admin:   [{ role: 'client', label: 'Клієнт' }, { role: 'trainer', label: 'Тренер' }],
      manager: [],
    };
    const options = roleOptions[roleKey] || [];
    let roleActions = '';
    if (options.length) {
      const optHTML = options.map(o =>
        `<button class="mu-role-option" data-user-id="${user.id}" data-new-role="${o.role}">${o.label}</button>`
      ).join('');
      roleActions = `
        <div class="mu-role-dd">
          <button class="mu-role-dd-btn" data-user-id="${user.id}">Роль ▾</button>
          <div class="mu-role-dd-menu">${optHTML}</div>
        </div>
      `;
    }

    // Деталі-дата для модального вікна
    const createdAt = user.created_at
      ? new Date(user.created_at).toLocaleDateString('uk-UA', { day:'2-digit', month:'long', year:'numeric' })
      : 'невідомо';

    const detailsData = JSON.stringify({
      name:  user.name || '—',
      email: user.email || '—',
      phone: user.phone || '—',
      role:  roleLabel,
      id:    user.id,
      created: createdAt,
    }).replace(/"/g, '&quot;');

    return `
      <div class="mu-row" data-user-role="${roleKey}" data-user-search="${esc(searchText)}">
        <span class="mu-avatar-name">
          <span class="mu-avatar mu-avatar--${avatarClass}">${esc(initials(user.name))}</span>
          <span class="mu-name-block">
            <strong>${esc(user.name || '—')}</strong>
            <span class="mu-sub">${esc(sub)}</span>
          </span>
        </span>
        <span class="mu-phone">${esc(phone)}</span>
        <span class="mu-email">${esc(email)}</span>
        <span class="mu-role">${esc(roleLabel)}</span>
        <span class="mu-status"><span class="status active">Активний</span></span>
        <span class="mu-actions">
          <button class="ghost-btn mu-details-btn" data-user-details="${detailsData}">Деталі</button>
          ${roleActions}
        </span>
      </div>
    `;
  }).join('');

  _muRebindFilters();  // прив'язуємо фільтр-кнопки до свіжих елементів
  _muBindRoleOnce();   // зміна ролі — лише одна делегація
  _muApplyFilters();   // відновлюємо активний фільтр
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

    const cardsHtml = payments.length
      ? payments.map((p) => `
          <article class="manager-payment-card" data-pay-search="${esc((p.client_name + ' ' + (p.client_email || '')).toLowerCase())}" style="border:1px solid var(--border);border-radius:10px;padding:12px 14px;background:var(--surface)">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;min-width:0">
              <div style="min-width:0;flex:1">
                <strong style="font-size:14px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.client_name || 'Невідомий клієнт')}</strong>
                <div style="color:var(--muted);font-size:12px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.client_email || '—')}</div>
              </div>
              <strong style="color:var(--accent);white-space:nowrap;font-size:15px;flex-shrink:0">${money(p.amount)}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:12px;color:var(--muted)">
              <span>${formatDate(p.date)}</span>
              <span style="background:var(--surface2,#eee);padding:2px 8px;border-radius:999px">${esc(p.status || '—')}</span>
            </div>
          </article>
        `).join('')
      : '<p style="color:var(--muted);text-align:center;padding:24px 0">Оплат ще немає.</p>';

    openSheet(
      'Список оплат',
      `<div style="display:flex;flex-direction:column;gap:10px">
        <input id="pay-search" type="text" placeholder="Пошук клієнта…" style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:13px">
        <div id="pay-list" class="manager-payments-list" style="display:flex;flex-direction:column;gap:8px">${cardsHtml}</div>
        <p id="pay-empty" style="display:none;color:var(--muted);text-align:center;padding:12px 0;font-size:13px">Нічого не знайдено</p>
      </div>`
    );

    // Пошук у списку оплат
    setTimeout(() => {
      const inp = document.getElementById('pay-search');
      if (!inp) return;
      inp.addEventListener('input', () => {
        const q = inp.value.trim().toLowerCase();
        const cards = document.querySelectorAll('#pay-list .manager-payment-card');
        let found = 0;
        cards.forEach(c => {
          const match = !q || (c.dataset.paySearch || '').includes(q);
          c.style.display = match ? '' : 'none';
          if (match) found++;
        });
        document.getElementById('pay-empty').style.display = found === 0 ? '' : 'none';
      });
    }, 50);

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

    const pdfBtn = target.closest('#analytics-pdf-btn');
    if (pdfBtn) {
      // Show period-choice modal
      const start = document.querySelector('[data-manager-start]')?.value || '';
      const end   = document.querySelector('[data-manager-end]')?.value || '';
      const startFmt = start ? start.split('-').reverse().join('.') : '';
      const endFmt   = end   ? end.split('-').reverse().join('.')   : '';
      const filterLabel = startFmt && endFmt ? `${startFmt} — ${endFmt}` : 'поточний фільтр';

      // Remove any existing modal
      document.getElementById('pdf-choice-modal')?.remove();
      const modal = document.createElement('div');
      modal.id = 'pdf-choice-modal';
      modal.innerHTML = `
        <div class="pdf-modal-backdrop"></div>
        <div class="pdf-modal-box">
          <p style="font-weight:700;font-size:14px;margin:0 0 6px">Завантажити PDF</p>
          <p style="color:var(--muted);font-size:12px;margin:0 0 16px">Оберіть діапазон даних</p>
          <div style="display:flex;flex-direction:column;gap:8px">
            <button class="primary-btn" id="pdf-choice-filter" style="text-align:left;padding:10px 14px">
              <strong style="display:block;font-size:13px">Поточний фільтр</strong>
              <span style="font-size:11px;font-weight:400;opacity:.8">${filterLabel}</span>
            </button>
            <button class="ghost-btn" id="pdf-choice-all" style="text-align:left;padding:10px 14px">
              <strong style="display:block;font-size:13px">За весь час</strong>
              <span style="font-size:11px;opacity:.8">без обмеження дат</span>
            </button>
          </div>
          <button class="ghost-btn" id="pdf-choice-cancel" style="width:100%;margin-top:10px;font-size:12px">Скасувати</button>
        </div>
      `;
      document.body.appendChild(modal);

      const closeModal = () => modal.remove();
      modal.querySelector('.pdf-modal-backdrop').addEventListener('click', closeModal);
      modal.querySelector('#pdf-choice-cancel').addEventListener('click', closeModal);

      const triggerPdf = async (useFilter) => {
        closeModal();
        const origHTML = pdfBtn.innerHTML;
        pdfBtn.disabled = true;
        pdfBtn.textContent = 'Формуємо…';
        try {
          const { token } = getAuth();
          const params = new URLSearchParams();
          if (useFilter) {
            if (start) params.set('start', start);
            if (end)   params.set('end', end);
          }
          const qs = params.toString() ? `?${params}` : '';
          const res = await fetch(`/api/reports/pdf${qs}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!res.ok) {
            let detail = `HTTP ${res.status}`;
            try { const j = await res.json(); detail += ': ' + (j.detail || j.error || ''); } catch {}
            throw new Error(detail);
          }
          const blob = await res.blob();
          if (blob.size === 0) throw new Error('PDF порожній (розмір 0)');
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          const now2 = new Date();
          const pad2 = n => String(n).padStart(2,'0');
          const dateStr = `${now2.getFullYear()}-${pad2(now2.getMonth()+1)}-${pad2(now2.getDate())}`;
          a.download = `olimp-analytics-${dateStr}.pdf`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (err) {
          alert('Помилка при формуванні PDF: ' + err.message);
        } finally {
          pdfBtn.disabled = false;
          pdfBtn.innerHTML = origHTML;
        }
      };

      modal.querySelector('#pdf-choice-filter').addEventListener('click', () => triggerPdf(true));
      modal.querySelector('#pdf-choice-all').addEventListener('click', () => triggerPdf(false));
      return;
    }

    // Чіпи швидкого вибору діапазону
    const chip = target.closest('.ana-chip');
    if (chip) {
      _anaActiveChip = chip.dataset.chip;
      document.querySelectorAll('.ana-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const s = chip.dataset.s;
      const e = chip.dataset.e;
      const si = document.querySelector('[data-manager-start]');
      const ei = document.querySelector('[data-manager-end]');
      if (si) si.value = s;
      if (ei) ei.value = e;
      await renderManagerAnalytics();
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

    const detailsBtn = target.closest('.mu-details-btn');
    if (detailsBtn && detailsBtn.dataset.userDetails) {
      let u = {};
      try { u = JSON.parse(detailsBtn.dataset.userDetails.replace(/&quot;/g, '"')); } catch {}
      openSheet(
        'Деталі користувача',
        `<div style="display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;align-items:center;gap:14px;padding-bottom:14px;border-bottom:1px solid var(--border)">
            <span style="width:52px;height:52px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;flex-shrink:0">${esc(initials(u.name))}</span>
            <div><strong style="font-size:16px">${esc(u.name)}</strong><br><span style="color:var(--muted);font-size:12px">${esc(u.role)}</span></div>
          </div>
          <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border)">
              <span style="color:var(--muted);font-size:13px">Email</span>
              <strong style="font-size:13px">${esc(u.email)}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border)">
              <span style="color:var(--muted);font-size:13px">Телефон</span>
              <strong style="font-size:13px">${esc(u.phone)}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px">
              <span style="color:var(--muted);font-size:13px">Роль</span>
              <strong style="font-size:13px">${esc(u.role)}</strong>
            </div>
          </div>
        </div>`
      );
    }

    // Деталі тренера
    const trainerBtn = target.closest('.trainer-details-btn');
    if (trainerBtn && trainerBtn.dataset.trainer) {
      let t = {};
      try { t = JSON.parse(trainerBtn.dataset.trainer.replace(/&quot;/g, '"')); } catch {}
      const fillColor = t.fill >= 80 ? '#39d98a' : t.fill >= 50 ? '#ffce45' : 'var(--muted)';
      const hue = [...(t.name || '')].reduce((n, c) => n + c.charCodeAt(0), 0) % 360;
      openSheet(
        'Тренер',
        `<div style="display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;align-items:center;gap:14px;padding-bottom:14px;border-bottom:1px solid var(--border)">
            <span style="width:52px;height:52px;border-radius:50%;background:hsl(${hue},45%,38%);color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;flex-shrink:0">${esc(initials(t.name))}</span>
            <div><strong style="font-size:16px">${esc(t.name)}</strong><br><span style="color:var(--muted);font-size:12px">Тренер</span></div>
          </div>
          <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border)">
              <span style="color:var(--muted);font-size:13px">Email</span>
              <strong style="font-size:13px">${esc(t.email)}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border)">
              <span style="color:var(--muted);font-size:13px">Телефон</span>
              <strong style="font-size:13px">${esc(t.phone)}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border)">
              <span style="color:var(--muted);font-size:13px">Занять за період</span>
              <strong style="font-size:13px">${number(t.sessions)}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border)">
              <span style="color:var(--muted);font-size:13px">Записів клієнтів</span>
              <strong style="font-size:13px">${number(t.bookings)}</strong>
            </div>
            <div style="padding:10px 14px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <span style="color:var(--muted);font-size:13px">Заповненість</span>
                <strong style="font-size:13px;color:${fillColor}">${t.fill}%</strong>
              </div>
              <div style="height:6px;background:var(--surface);border-radius:3px;overflow:hidden">
                <div style="height:100%;width:${t.fill}%;background:${fillColor};border-radius:3px;transition:.3s"></div>
              </div>
            </div>
          </div>
        </div>`
      );
      return;
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
      showLogoutConfirm().then((confirmed) => {
        if (!confirmed) return;
        clearAuth();
        window.location.href = PAGE.HOME;
      });
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
 * Відновлює стан і підключає реальну підписку/відписку Web Push для
 * менеджера — та сама механіка, що на сторінках клієнта й тренера.
 */
async function loadManagerSettings() {
  const list = document.querySelector('#manager-settings-list');
  if (!list) {
    return;
  }

  const feedback = '#manager-settings-feedback';
  const pushEl = list.querySelector('[data-setting="push"]');

  let pushModule = null;
  try {
    pushModule = await import('./push.js');
  } catch {
    /* push не підтримується в цьому браузері */
  }
  if (pushEl && pushModule) {
    pushEl.checked = await pushModule.getPushStatus();
  }

  pushEl?.addEventListener('change', async () => {
    const checked = pushEl.checked;
    if (!pushModule) {
      setManagerNote(feedback, 'Push не підтримується в цьому браузері', 'error');
      pushEl.checked = !checked;
      return;
    }
    if (checked) {
      const result = await pushModule.subscribePush();
      if (!result.ok) {
        setManagerNote(feedback, result.error || 'Не вдалось підписатись', 'error');
        pushEl.checked = false;
        return;
      }
    } else {
      await pushModule.unsubscribePush();
    }
    setManagerNote(feedback, checked ? 'Push-сповіщення увімкнено' : 'Push-сповіщення вимкнено', 'success');
  });
}

async function initManagerArm() {
  initSidebar();
  initTheme();
  initNotifications();
  initModalHotkeys();
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