/**
 * Модуль сповіщень — спільний для всіх ролей.
 *
 * Експортує initNotifications() — підключає дропдаун до кнопки дзвіночка.
 * - Завантажує список сповіщень з /api/notifications.
 * - Показує/ховає помаранчеву крапку залежно від кількості непрочитаних.
 * - При кліку на дзвіночок відкриває/закриває дропдаун.
 * - Кнопка «Позначити всі прочитаними» викликає POST /api/notifications/read-all.
 * - Стилі інжектуються через <style> тег — не потрібно підключати окремий CSS.
 */

import { apiFetch } from './api.js';

const DROPDOWN_ID = 'notif-dropdown';
const STYLE_ID = 'notif-styles';

// ─── Стилі ────────────────────────────────────────────────────────────────────

const CSS = `
/* ── Дропдаун ── */
#notif-dropdown {
  position: fixed;
  z-index: 9990;
  top: 60px;
  right: 16px;
  width: min(360px, calc(100vw - 24px));
  background: var(--surface, #1a1a1a);
  border: 1px solid var(--line, rgba(255,255,255,.1));
  border-radius: 16px;
  box-shadow: 0 12px 40px rgba(0,0,0,.55);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: notif-in .16s ease;
}

@keyframes notif-in {
  from { opacity: 0; transform: translateY(-6px) scale(.97); }
  to   { opacity: 1; transform: translateY(0)   scale(1); }
}

.notif-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--line, rgba(255,255,255,.08));
  flex-shrink: 0;
}

.notif-header > span {
  font-size: 14px;
  font-weight: 800;
  color: var(--text, #fff);
  letter-spacing: .01em;
}

.notif-read-all {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--accent, #e85002);
  font-size: 12px;
  font-weight: 700;
  padding: 4px 6px;
  border-radius: 6px;
  transition: background .15s;
}
.notif-read-all:hover { background: rgba(232,80,2,.1); }
.notif-read-all:disabled { opacity: .4; cursor: default; }

.notif-list {
  overflow-y: auto;
  max-height: 360px;
  padding: 6px 0;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,.12) transparent;
}

.notif-empty {
  padding: 28px 16px;
  text-align: center;
  color: var(--muted, #666);
  font-size: 13px;
}

.notif-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 16px;
  cursor: pointer;
  transition: background .12s;
  border: none;
  background: transparent;
  width: 100%;
  text-align: left;
}
.notif-item:hover { background: rgba(255,255,255,.06); }

.notif-dot-indicator {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-top: 5px;
  flex-shrink: 0;
  background: transparent;
}
.notif-item--unread .notif-dot-indicator {
  background: var(--accent, #e85002);
}

.notif-body { flex: 1; min-width: 0; }

.notif-subject {
  font-size: 13px;
  font-weight: 600;
  color: var(--text, #fff);
  line-height: 1.35;
  margin-bottom: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.notif-item--unread .notif-subject { font-weight: 700; }

.notif-time {
  font-size: 11px;
  color: var(--muted, #777);
}

/* ── Модалка повного тексту ── */
#notif-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9995;
  background: rgba(0,0,0,.65);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0;
  animation: notif-backdrop-in .18s ease;
}

@media (min-width: 520px) {
  #notif-modal-backdrop {
    align-items: center;
    padding: 24px;
  }
}

@keyframes notif-backdrop-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

#notif-modal {
  width: min(520px, 100%);
  max-height: 80dvh;
  background: var(--surface, #1c1c1c);
  border: 1px solid var(--line, rgba(255,255,255,.1));
  border-radius: 20px 20px 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: notif-modal-in .2s ease;
}

@media (min-width: 520px) {
  #notif-modal {
    border-radius: 20px;
  }
}

@keyframes notif-modal-in {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}

.notif-modal-handle {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: rgba(255,255,255,.18);
  margin: 12px auto 0;
  flex-shrink: 0;
}

@media (min-width: 520px) {
  .notif-modal-handle { display: none; }
}

.notif-modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--line, rgba(255,255,255,.08));
  flex-shrink: 0;
}

.notif-modal-title {
  font-size: 17px;
  font-weight: 800;
  color: var(--text, #fff);
  line-height: 1.3;
  margin: 0;
}

.notif-modal-close {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--line, rgba(255,255,255,.12));
  background: rgba(255,255,255,.04);
  color: var(--muted, #888);
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background .15s, color .15s;
  line-height: 1;
}
.notif-modal-close:hover {
  background: rgba(255,255,255,.1);
  color: var(--text, #fff);
}

.notif-modal-meta {
  padding: 8px 20px 0;
  font-size: 12px;
  color: var(--muted, #777);
  flex-shrink: 0;
}

.notif-modal-body {
  padding: 14px 20px 24px;
  overflow-y: auto;
  flex: 1;
  font-size: 14px;
  color: var(--text, #e0e0e0);
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

.notif-modal-empty-body {
  color: var(--muted, #777);
  font-style: italic;
}

/* ── Крапка на дзвіночку ── */
.notification-dot {
  display: none;
}
.notification-dot.visible {
  display: block;
}
`;

// ─── Допоміжні функції ────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const min  = Math.floor(diff / 60000);
  const hr   = Math.floor(min / 60);
  const day  = Math.floor(hr / 24);
  if (min < 1)  return 'щойно';
  if (min < 60) return `${min} хв. тому`;
  if (hr  < 24) return `${hr} год. тому`;
  if (day <  7) return `${day} дн. тому`;
  return new Date(dateStr).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function closeDropdown() {
  document.getElementById(DROPDOWN_ID)?.remove();
}

function closeModal() {
  document.getElementById('notif-modal-backdrop')?.remove();
}

// ─── Звук сповіщення ─────────────────────────────────────────────────────────
//
// Браузер блокує audio.play() якщо його не викликати під час жесту (click/touch).
// Рішення: при першому кліку зберігаємо "розблокований" Audio елемент,
// потім переграємо його коли треба — autoplay-обмеження вже не діє.

let _readyAudio = null; // розблокований елемент, готовий до відтворення

/**
 * Генерує WAV-beep в пам'яті та повертає blob:// URL.
 */
function _makeBlobUrl() {
  const sr = 22050, dur = 0.25, freq = 880;
  const n   = Math.floor(sr * dur);
  const buf = new ArrayBuffer(44 + n * 2);
  const v   = new DataView(buf);
  const w   = (off, s) => [...s].forEach((c, i) => v.setUint8(off + i, c.charCodeAt(0)));
  w(0,  'RIFF'); v.setUint32(4, 36 + n * 2, true);
  w(8,  'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2,  true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const s = Math.sin(2 * Math.PI * freq * t) * Math.min(1, t / 0.008) * Math.exp(-t * 10) * 0.7;
    v.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

/**
 * Розблоковує аудіо при першому жесті: тихо програє і зупиняє звук,
 * щоб наступні виклики play() не блокувалися autoplay-політикою.
 */
function _unlockAudio() {
  if (_readyAudio) return;
  try {
    const url   = _makeBlobUrl();
    const audio = new Audio(url);
    audio.volume = 0;
    audio.play().then(() => {
      audio.pause();
      audio.currentTime = 0;
      audio.volume      = 0.85;
      _readyAudio = audio;
    }).catch(() => {});
  } catch {}
}

/**
 * Мінімальний інтервал між сигналами, мс.
 * Одну подію (нове повідомлення в чаті) незалежно помічають кілька джерел:
 * полінг /notifications, полінг чату в кабінеті адміна, обробник PUSH_RECEIVED
 * і сам чат-віджет. Без спільного вікна користувач чує 2–3 сигнали поспіль,
 * що сприймається як «звук нізвідки».
 */
const SOUND_COOLDOWN_MS = 4000;

/**
 * Спільний для всіх джерел запобіжник від повторних сигналів.
 * Лежить на window, бо chat-widget.js підключається звичайним скриптом
 * (не модулем) і не може імпортувати цей файл.
 *
 * @returns {boolean} true, якщо сигнал дозволено відтворити.
 */
export function canPlayChime() {
  const now = Date.now();
  if (now - (window.__olimpLastChimeAt || 0) < SOUND_COOLDOWN_MS) {
    return false;
  }
  window.__olimpLastChimeAt = now;
  return true;
}

/**
 * Грає звук сповіщення.
 * Якщо аудіо ще не розблоковано — намагається напряму (спрацює якщо браузер
 * лояльний, або якщо є нещодавній жест).
 */
function playNotificationSound() {
  if (!canPlayChime()) {
    return;
  }
  if (_readyAudio) {
    // Клонуємо щоб одночасно могло грати кілька
    const clone = /** @type {HTMLAudioElement} */ (_readyAudio.cloneNode());
    clone.volume = 0.85;
    clone.play().catch(() => {});
    return;
  }
  // Fallback: спробуємо напряму
  try {
    const audio = new Audio(_makeBlobUrl());
    audio.volume = 0.85;
    audio.play().catch(() => {});
  } catch {}
}

// Для ручного тестування прямо з DevTools консолі
window._testNotifSound = playNotificationSound;
window._testPush = async () => {
  const { apiFetch } = await import('./api.js');
  const r = await apiFetch('/push/test', { method: 'POST' });
  console.log('[push] test result:', r);
};

// ─── Головний експорт ─────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000; // перевіряти кожні 30 секунд

export async function initNotifications() {
  injectStyles();

  // Розблоковуємо аудіо при першому жесті користувача
  document.addEventListener('click',    _unlockAudio, { once: true, passive: true });
  document.addEventListener('touchend', _unlockAudio, { once: true, passive: true });
  document.addEventListener('keydown',  _unlockAudio, { once: true, passive: true });

  const btn = document.querySelector('.notification-btn');
  if (!btn) return;

  const dot = btn.querySelector('.notification-dot');

  let data = { items: [], unread: 0 };
  // null = ще не ініціалізовано (перший запит не грає звук)
  let knownIds = null;

  // ── Завантаження з сервера ──
  async function load() {
    try {
      const fresh = await apiFetch('/notifications');

      // Перший запит — просто запам'ятовуємо ID, без звуку
      if (knownIds === null) {
        knownIds = new Set(fresh.items.map((i) => i.id));
        data = fresh;
        updateDot();
        return;
      }

      // Шукаємо нові ID яких раніше не було
      const newItems = fresh.items.filter((i) => !knownIds.has(i.id));
      if (newItems.length > 0) {
        newItems.forEach((i) => knownIds.add(i.id));
        playNotificationSound();
        document.dispatchEvent(new CustomEvent('olimp:notifications:new', {
          detail: { items: newItems },
        }));
      }

      data = fresh;
      updateDot();
    } catch {
      // не падаємо — сповіщення не критичні
    }
  }

  function updateDot() {
    if (!dot) return;
    if (data.unread > 0) {
      dot.classList.add('visible');
    } else {
      dot.classList.remove('visible');
    }
  }

  // ── Відкрити повне повідомлення ──
  async function openMessage(item) {
    closeDropdown();
    closeModal();

    // Позначити прочитаним якщо ще ні
    if (!item.is_read) {
      try {
        await apiFetch(`/notifications/${item.id}/read`, { method: 'POST' });
        const idx = data.items.findIndex((i) => i.id === item.id);
        if (idx !== -1) {
          data.items[idx] = { ...data.items[idx], is_read: true };
          data.unread = Math.max(0, data.unread - 1);
          updateDot();
        }
      } catch {
        // не критично
      }
    }

    const formattedDate = new Date(item.created_at).toLocaleString('uk-UA', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const backdrop = document.createElement('div');
    backdrop.id = 'notif-modal-backdrop';
    backdrop.innerHTML = `
      <div id="notif-modal">
        <div class="notif-modal-handle"></div>
        <div class="notif-modal-head">
          <h2 class="notif-modal-title">${escapeHtml(item.subject)}</h2>
          <button class="notif-modal-close" aria-label="Закрити">×</button>
        </div>
        <p class="notif-modal-meta">${formattedDate}</p>
        <div class="notif-modal-body">
          ${item.body
            ? escapeHtml(item.body)
            : '<span class="notif-modal-empty-body">Текст повідомлення відсутній</span>'
          }
        </div>
      </div>
    `;

    // Закрити по кліку на кнопку або на бекдроп поза модалкою
    backdrop.querySelector('.notif-modal-close').addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });

    document.body.appendChild(backdrop);
  }

  // ── Рендер дропдауну ──
  function renderDropdown() {
    closeDropdown();

    const dropdown = document.createElement('div');
    dropdown.id = DROPDOWN_ID;

    const isEmpty = data.items.length === 0;

    dropdown.innerHTML = `
      <div class="notif-header">
        <span>Сповіщення</span>
        <button class="notif-read-all" ${isEmpty || data.unread === 0 ? 'disabled' : ''}>Позначити прочитаними</button>
      </div>
      <div class="notif-list">
        ${isEmpty
          ? '<div class="notif-empty">Немає сповіщень</div>'
          : data.items.map((item) => `
              <button class="notif-item ${item.is_read ? '' : 'notif-item--unread'}" data-id="${item.id}">
                <div class="notif-dot-indicator"></div>
                <div class="notif-body">
                  <div class="notif-subject">${escapeHtml(item.subject)}</div>
                  <div class="notif-time">${timeAgo(item.created_at)}</div>
                </div>
              </button>
            `).join('')
        }
      </div>
    `;

    // Клік на конкретне сповіщення → відкрити повний текст
    dropdown.querySelectorAll('.notif-item[data-id]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = Number(el.dataset.id);
        const item = data.items.find((i) => i.id === id);
        if (item) openMessage(item);
      });
    });

    // Позначити все прочитаним
    dropdown.querySelector('.notif-read-all')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await apiFetch('/notifications/read-all', { method: 'POST' });
        data = {
          ...data,
          unread: 0,
          items: data.items.map((i) => ({ ...i, is_read: true })),
        };
        updateDot();
        renderDropdown();
      } catch {
        // ігноруємо
      }
    });

    document.body.appendChild(dropdown);
  }

  // ── Клік на дзвіночок — toggle ──
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (document.getElementById(DROPDOWN_ID)) {
      closeDropdown();
    } else {
      renderDropdown();
    }
  });

  // ── Закрити при кліку поза дропдауном ──
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById(DROPDOWN_ID);
    if (dropdown && !dropdown.contains(e.target)) {
      closeDropdown();
    }
  });

  // ── Перший завантаження ──
  await load();

  // ── Polling: перевіряти нові сповіщення кожні 30 сек ──
  const pollTimer = setInterval(load, POLL_INTERVAL_MS);

  // ── Перевірити одразу коли вкладка стає активною ──
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') load();
  });

  // Зупиняємо polling коли сторінка вивантажується
  window.addEventListener('pagehide', () => clearInterval(pollTimer), { once: true });
}
