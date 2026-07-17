/**
 * Модуль чату кабінету адміністратора «адмін ↔ відвідувач».
 *
 * Винесено з admin.js як самодостатній екран: увесь стан і функції чату
 * (список діалогів, відкрита розмова, polling+SSE) живуть тут. Назовні
 * експортуються лише дві точки входу, які викликає перемикач екрана
 * «Повідомлення → Чат»: startChatListPolling() і stopChatPolling().
 *
 * Зовнішні залежності — спільні хелпери:
 *   • apiFetch   — авторизований fetch до /api (../api.js);
 *   • escapeHtml — екранування тексту перед вставкою в HTML (../utils.js).
 */

import { apiFetch } from '../api.js';
import { escapeHtml } from '../utils.js';

/* ══════════════════════════════════════════
   ЧАТ З ПОТЕНЦІЙНИМИ КЛІЄНТАМИ (messages → Чат)
   ══════════════════════════════════════════ */
let chatConversations = [];
let activeChatId = null;
let _chatMsgPollTimer = null;   // поллінг повідомлень активної розмови
let _chatListPollTimer = null;  // поллінг списку розмов
let _lastMsgId = 0;             // id останнього отриманого повідомлення

// Реалтайм чату: основний канал — SSE, polling лишається запобіжником.
// Поки SSE підключений, інтервали опитування сповільнюються; якщо SSE
// недоступний — повертаються швидкі значення. Так поведінка не гіршає.
let _chatSse = null;
let _chatListPollMs = 5000;     // швидкий інтервал списку (fallback)
let _chatMsgPollMs = 3000;      // швидкий інтервал повідомлень (fallback)
const _CHAT_SAFETY_POLL_MS = 20000; // запобіжний інтервал, коли SSE активний

/** Перезапускає таймер списку розмов із поточним інтервалом. */
function _restartChatListTimer() {
  clearInterval(_chatListPollTimer);
  _chatListPollTimer = setInterval(loadChatConversations, _chatListPollMs);
}

/** Перезапускає таймер повідомлень активної розмови (якщо така відкрита). */
function _restartChatMsgTimer() {
  clearInterval(_chatMsgPollTimer);
  if (activeChatId !== null) {
    _chatMsgPollTimer = setInterval(() => _loadAndAppendMsgs(activeChatId, true), _chatMsgPollMs);
  }
}

/** Відкриває SSE-стрім адміністратора (пуш про зміни діалогів). */
async function startAdminChatSse() {
  if (_chatSse) return;
  try {
    const { ticket } = await apiFetch('/chat/admin/stream-ticket');
    const es = new EventSource(`/api/chat/stream?ticket=${encodeURIComponent(ticket)}`);
    _chatSse = es;
    es.addEventListener('ready', () => {
      // Канал відкрито — сповільнюємо запобіжний polling.
      _chatListPollMs = _CHAT_SAFETY_POLL_MS;
      _chatMsgPollMs = _CHAT_SAFETY_POLL_MS;
      _restartChatListTimer();
      _restartChatMsgTimer();
    });
    es.addEventListener('conversations', () => {
      // Є зміни — одразу оновлюємо список і відкриту розмову.
      loadChatConversations();
      if (activeChatId !== null) _loadAndAppendMsgs(activeChatId, true);
    });
    es.onerror = () => {
      es.close();
      if (_chatSse === es) _chatSse = null;
      // Втратили пуш — повертаємось до швидкого опитування.
      _chatListPollMs = 5000;
      _chatMsgPollMs = 3000;
      _restartChatListTimer();
      _restartChatMsgTimer();
    };
  } catch {
    // Не вдалося — тихо лишаємось на polling.
  }
}

/** Закриває SSE-стрім адміністратора і повертає швидкі інтервали. */
function stopAdminChatSse() {
  if (_chatSse) {
    _chatSse.close();
    _chatSse = null;
  }
  _chatListPollMs = 5000;
  _chatMsgPollMs = 3000;
}

/* ── Список розмов ── */
async function loadChatConversations() {
  const listEl = document.getElementById('msg-chat-list');
  if (!listEl) return;
  try {
    const data = await apiFetch('/chat/admin/conversations');
    chatConversations = data || [];
    renderChatList();
  } catch (e) {
    listEl.innerHTML = '<div class="msg-chat-list-empty">Помилка завантаження</div>';
  }
}

/**
 * Формує позначку стану діалогу: очікує / ваш / ім'я іншого адміна / завершено.
 *
 * @param {object} conv Діалог зі списку /chat/admin/conversations.
 * @returns {string} HTML-рядок статусу.
 */
function buildChatStatusChip(conv) {
  if (conv.closed_at) {
    return '<span class="msg-chat-status closed">завершено</span>';
  }
  if (conv.assigned_admin_id === null) {
    return '<span class="msg-chat-status waiting">очікує</span>';
  }
  if (conv.assigned_admin_id === currentUser.id) {
    return '<span class="msg-chat-status mine">ваш</span>';
  }
  const adminName = escapeHtml(conv.assigned_admin_name || 'інший адмін');
  return `<span class="msg-chat-status other">${adminName}</span>`;
}

function renderChatList() {
  const listEl = document.getElementById('msg-chat-list');
  if (!listEl) return;
  if (!chatConversations.length) {
    listEl.innerHTML = '<div class="msg-chat-list-empty">Нових діалогів немає</div>';
    return;
  }
  listEl.innerHTML = chatConversations.map((conv) => {
    const unread = conv.unread > 0
      ? `<span class="msg-chat-badge">${conv.unread}</span>` : '';
    const preview = escapeHtml(conv.last_message || '…').slice(0, 48);
    const time = conv.updated_at
      ? new Date(conv.updated_at).toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' }) : '';
    const active = conv.id === activeChatId ? ' active' : '';
    const title = conv.guest_name ? escapeHtml(conv.guest_name) : `Гість #${conv.id}`;
    return `
      <button class="msg-chat-item${active}" data-conv-id="${conv.id}">
        <div class="msg-chat-item-header">
          <span class="msg-chat-item-name">${title} ${buildChatStatusChip(conv)}</span>
          <span class="msg-chat-item-time">${time}</span>
        </div>
        <div class="msg-chat-item-preview">${preview}${unread}</div>
      </button>`;
  }).join('');
  listEl.querySelectorAll('[data-conv-id]').forEach(btn => {
    btn.addEventListener('click', () => openChatConversation(Number(btn.dataset.convId)));
  });

  // Стан активного діалогу міг змінитись (взяв інший адмін, завершено).
  updateChatControls();
}

/* ── Відкрити розмову ── */
async function openChatConversation(id) {
  activeChatId = id;
  _lastMsgId = 0;
  clearInterval(_chatMsgPollTimer);
  renderChatList(); // підсвітити активну

  // Мобільний: показуємо вікно чату, ховаємо список
  const chatLayout = document.querySelector('.msg-chat-layout');
  if (chatLayout) chatLayout.classList.add('chat-active');

  _renderChatWindowShell(id); // одразу рендеримо форму (більше не чіпаємо її)
  await _loadAndAppendMsgs(id, false); // перший раз — всі повідомлення

  // Поллінг нових повідомлень — ТІЛЬКИ дописуємо нові, не перебудовуємо форму.
  // Інтервал залежить від того, чи активний SSE (запобіжник vs швидкий).
  _restartChatMsgTimer();
}

/* ── Шаблон вікна (один раз при відкритті розмови) ── */
function _renderChatWindowShell(id) {
  const win = document.getElementById('msg-chat-window');
  if (!win) return;
  win.innerHTML = `
    <div class="msg-chat-win-header">
      <button class="msg-chat-back-btn" id="msg-chat-back">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="15" height="15"><polyline points="15 18 9 12 15 6"/></svg>
        Назад
      </button>
    </div>
    <div class="msg-chat-messages" id="msg-chat-messages"></div>
    <form class="msg-chat-reply" id="msg-chat-reply-form">
      <input type="text" id="msg-chat-input" placeholder="Відповідь…" autocomplete="off">
      <button type="submit" class="clients-add-btn" style="flex-shrink:0;height:40px;padding:0 16px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="14" height="14"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        Надіслати
      </button>
    </form>`;

  updateChatControls();

  // Кнопка "Назад" — повертаємось до списку на мобільному
  win.querySelector('#msg-chat-back')?.addEventListener('click', () => {
    const chatLayout = document.querySelector('.msg-chat-layout');
    if (chatLayout) chatLayout.classList.remove('chat-active');
    activeChatId = null;
    clearInterval(_chatMsgPollTimer);
  });

  win.querySelector('#msg-chat-reply-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = win.querySelector('#msg-chat-input');
    const body = input?.value.trim();
    if (!body) return;
    input.value = '';
    try {
      await apiFetch(`/chat/admin/conversations/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      await _loadAndAppendMsgs(id, true); // відразу показуємо відповідь
      loadChatConversations();            // оновити прев'ю та стан у списку
    } catch (err) {
      // Наприклад, діалог щойно взяв інший адмін — список покаже, хто саме.
      loadChatConversations();
      console.error('Chat send error:', err);
    }
  });
}

/**
 * Оновлює верхню панель активного діалогу (хто веде, кнопки дій)
 * та доступність поля відповіді. Викликається при відкритті діалогу
 * і після кожного оновлення списку, щоб стан не застарівав.
 *
 * @returns {void}
 */
function updateChatControls() {
  const topbar = document.getElementById('msg-chat-topbar');
  const replyForm = document.getElementById('msg-chat-reply-form');
  if (!topbar || activeChatId === null) return;

  const conv = chatConversations.find((item) => item.id === activeChatId);
  if (!conv) return;

  const isMine = conv.assigned_admin_id === currentUser.id;
  const isFree = conv.assigned_admin_id === null;
  const isClosed = Boolean(conv.closed_at);

  if (isClosed) {
    topbar.innerHTML = '<span class="msg-chat-note">Діалог завершено</span>';
  } else if (isFree) {
    topbar.innerHTML = `
      <button type="button" class="clients-add-btn msg-chat-claim" data-chat-claim>Взяти в роботу</button>
      <span class="msg-chat-note">або просто відповідайте</span>
      <button type="button" class="msg-chat-close-btn" data-chat-close>Завершити</button>`;
  } else if (isMine) {
    topbar.innerHTML = `
      <span class="msg-chat-note">Ви ведете цей діалог</span>
      <button type="button" class="msg-chat-close-btn" data-chat-close>Завершити чат</button>`;
  } else {
    const adminName = escapeHtml(conv.assigned_admin_name || 'інший адміністратор');
    topbar.innerHTML = `<span class="msg-chat-note">Веде ${adminName} — лише перегляд</span>`;
  }

  if (replyForm) {
    replyForm.style.display = (isClosed || (!isFree && !isMine)) ? 'none' : '';
  }

  const claimBtn = topbar.querySelector('[data-chat-claim]');
  if (claimBtn) {
    claimBtn.addEventListener('click', async () => {
      try {
        await apiFetch(`/chat/admin/conversations/${activeChatId}/claim`, { method: 'POST' });
      } catch (err) {
        console.error('Chat claim error:', err); // 409 — випередив інший адмін
      }
      loadChatConversations();
    });
  }

  const closeBtn = topbar.querySelector('[data-chat-close]');
  if (closeBtn) {
    closeBtn.addEventListener('click', async () => {
      try {
        await apiFetch(`/chat/admin/conversations/${activeChatId}/close`, { method: 'POST' });
        await _loadAndAppendMsgs(activeChatId, true); // системне «діалог завершено»
      } catch (err) {
        console.error('Chat close error:', err);
      }
      loadChatConversations();
    });
  }
}

/* ── Підвантаження повідомлень ── */
function _buildBubble(m) {
  if (m.sender === 'system') {
    return `<div class="msg-bubble--system">${escapeHtml(m.body)}</div>`;
  }
  const isAdmin = m.sender === 'admin';
  const time = m.created_at
    ? new Date(m.created_at).toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' }) : '';
  return `<div class="msg-bubble ${isAdmin ? 'msg-bubble--admin' : 'msg-bubble--guest'}">
    <div class="msg-bubble-text">${escapeHtml(m.body)}</div>
    <div class="msg-bubble-time">${time}</div>
  </div>`;
}

async function _loadAndAppendMsgs(id, incremental) {
  const msgList = document.getElementById('msg-chat-messages');
  if (!msgList) return;
  try {
    const after = incremental ? _lastMsgId : 0;
    const msgs = await apiFetch(`/chat/admin/conversations/${id}/messages?after=${after}`);
    if (!msgs || msgs.length === 0) return; // нічого нового — не чіпаємо DOM

    if (!incremental) {
      msgList.innerHTML = msgs.map(_buildBubble).join('');
    } else {
      msgs.forEach(m => msgList.insertAdjacentHTML('beforeend', _buildBubble(m)));
    }
    _lastMsgId = msgs[msgs.length - 1].id;
    msgList.scrollTop = msgList.scrollHeight;

    // Оновити список якщо прийшло нове (від гостя)
    if (msgs.some(m => m.sender === 'guest')) loadChatConversations();
  } catch (e) {
    console.error('Chat poll error:', e);
  }
}

/* ── Запуск/зупинка поллінгу списку розмов ── */
function startChatListPolling() {
  clearInterval(_chatListPollTimer);
  clearInterval(_chatMsgPollTimer);
  loadChatConversations();
  _restartChatListTimer();
  // Пробуємо підключити пуш-канал; успіх сповільнить polling до запобіжного.
  startAdminChatSse();
}
function stopChatPolling() {
  clearInterval(_chatListPollTimer);
  clearInterval(_chatMsgPollTimer);
  stopAdminChatSse();
  activeChatId = null;
  _lastMsgId = 0;
}

// Точки входу, які використовує перемикач екрана «Повідомлення → Чат».
export { startChatListPolling, stopChatPolling };
