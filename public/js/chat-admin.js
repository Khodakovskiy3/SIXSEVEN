/**
 * Адмінська сторінка чату з клієнтами (JWT-авторизація, role=admin).
 *
 * Доступ за прямим URL /pages/chat-admin.html. Використовується токен
 * адміністратора з localStorage (той самий, що й у кабінеті). Нові
 * повідомлення й список діалогів оновлюються через polling.
 *
 * Розподіл звернень: нове звернення бачать усі адміністратори зі статусом
 * «очікує». Перший, хто натиснув «Взяти в роботу» (або відповів), закріплює
 * діалог за собою; іншим діалог доступний лише для читання, доки його не
 * повернуто в чергу.
 *
 * API (Authorization: Bearer <token>):
 *   GET  /api/chat/admin/conversations
 *   GET  /api/chat/admin/conversations/:id/messages?after=<lastId>
 *   POST /api/chat/admin/conversations/:id/messages  { body }
 *   POST /api/chat/admin/conversations/:id/claim
 *   POST /api/chat/admin/conversations/:id/release
 */

(function initChatAdmin() {
  const API_BASE = '/api';
  const TOKEN_KEY = 'token';
  const USER_KEY = 'user';
  const LOGIN_URL = '/pages/auth/login.html';
  const LIST_POLL_MS = 4000;
  const THREAD_POLL_MS = 3000;

  const gate = document.querySelector('[data-gate]');
  const app = document.querySelector('[data-app]');
  const convListEl = document.querySelector('[data-conv-list]');
  const threadEl = document.querySelector('[data-thread]');
  const mainEmpty = document.querySelector('[data-main-empty]');
  const claimBar = document.querySelector('[data-claim-bar]');
  const composer = document.querySelector('[data-composer]');
  const replyInput = document.querySelector('[data-reply]');

  const token = localStorage.getItem(TOKEN_KEY);
  let currentAdmin = null;
  try {
    currentAdmin = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    currentAdmin = null;
  }

  /** Діалоги з останнього оновлення списку, за id. */
  const conversationById = new Map();

  let activeConversationId = null;
  let lastMessageId = 0;
  let listTimer = null;
  let threadTimer = null;

  /** Екранує текст перед вставкою в HTML. */
  function escapeHtml(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  /**
   * Обгортка над fetch із заголовком авторизації.
   * При 401 повертає користувача на екран входу.
   *
   * @param {string} path Шлях відносно API_BASE.
   * @param {RequestInit} [options] Параметри fetch.
   * @returns {Promise<object>} Розібране тіло відповіді.
   */
  async function apiFetch(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    if (response.status === 401) {
      handleAuthFailure();
      throw new Error('unauthorized');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Помилка запиту');
    }
    return data;
  }

  /** Показує екран входу при відсутній або простроченій сесії. */
  function handleAuthFailure() {
    stopPolling();
    app.classList.remove('active');
    gate.style.display = 'flex';
  }

  // ─── Список діалогів ────────────────────────────────────────────────────────

  /**
   * Формує підпис стану діалогу для списку.
   *
   * @param {object} conv Діалог зі списку /admin/conversations.
   * @returns {string} HTML-рядок статусу.
   */
  function renderStatus(conv) {
    if (conv.assigned_admin_id === null) {
      return '<span class="conv-status waiting">очікує</span>';
    }
    if (conv.assigned_admin_id === currentAdmin.id) {
      return '<span class="conv-status mine">ваш діалог</span>';
    }
    const adminName = escapeHtml(conv.assigned_admin_name || 'інший адмін');
    return `<span class="conv-status other">${adminName}</span>`;
  }

  async function loadConversations() {
    let conversations;
    try {
      conversations = await apiFetch('/chat/admin/conversations');
    } catch {
      return;
    }

    conversationById.clear();
    conversations.forEach((conv) => conversationById.set(conv.id, conv));

    if (activeConversationId !== null) {
      renderClaimBar(conversationById.get(activeConversationId));
    }

    if (conversations.length === 0) {
      convListEl.innerHTML = '<div style="padding:16px;color:var(--muted);font-size:13px;">'
        + 'Поки що немає звернень.</div>';
      return;
    }

    convListEl.innerHTML = conversations.map((conv) => {
      const unread = Number(conv.unread) > 0
        ? `<span class="conv-badge">${conv.unread}</span>`
        : '';
      const isActive = conv.id === activeConversationId ? ' active' : '';
      const last = conv.last_message ? escapeHtml(conv.last_message) : '';
      // Авторизований клієнт підписаний власним ім'ям, анонім — номером.
      const title = conv.guest_name ? escapeHtml(conv.guest_name) : `Гість #${conv.id}`;
      return `
        <div class="conv-item${isActive}" data-conv-id="${conv.id}">
          <span class="conv-title">${title}${unread}${renderStatus(conv)}</span>
          <span class="conv-last">${last}</span>
        </div>
      `;
    }).join('');

    convListEl.querySelectorAll('[data-conv-id]').forEach((el) => {
      el.addEventListener('click', () => {
        openConversation(Number(el.dataset.convId));
      });
    });
  }

  // ─── Панель стану активного діалогу ─────────────────────────────────────────

  /**
   * Малює панель над композером: кнопку «Взяти в роботу», позначку власника
   * або ім'я адміністратора, який уже веде діалог. Композер доступний, лише
   * коли діалог вільний (відповідь візьме його автоматично) або ваш.
   *
   * @param {object|undefined} conv Активний діалог.
   * @returns {void}
   */
  function renderClaimBar(conv) {
    if (!conv) {
      claimBar.innerHTML = '';
      return;
    }

    const isMine = conv.assigned_admin_id === currentAdmin.id;
    const isFree = conv.assigned_admin_id === null;

    if (isFree) {
      claimBar.innerHTML =
        '<button type="button" class="claim-btn" data-claim>Взяти в роботу</button>'
        + '<span class="claim-note">або просто відповідайте — діалог закріпиться за вами</span>';
    } else if (isMine) {
      claimBar.innerHTML = '<span class="claim-note">Ви ведете цей діалог</span>'
        + '<button type="button" class="release-btn" data-release>Повернути в чергу</button>';
    } else {
      const ownerName = escapeHtml(conv.assigned_admin_name || 'інший адміністратор');
      claimBar.innerHTML =
        `<span class="claim-note">Діалог веде ${ownerName} — лише перегляд</span>`;
    }

    composer.classList.toggle('active', isFree || isMine);

    const claimBtn = claimBar.querySelector('[data-claim]');
    if (claimBtn) {
      claimBtn.addEventListener('click', () => claimConversation(conv.id));
    }
    const releaseBtn = claimBar.querySelector('[data-release]');
    if (releaseBtn) {
      releaseBtn.addEventListener('click', () => releaseConversation(conv.id));
    }
  }

  /**
   * Бере діалог у роботу. При програші гонки (409) просто оновлює список —
   * користувач побачить, хто встиг першим.
   *
   * @param {number} id Ідентифікатор діалогу.
   * @returns {Promise<void>}
   */
  async function claimConversation(id) {
    try {
      await apiFetch(`/chat/admin/conversations/${id}/claim`, { method: 'POST' });
    } catch {
      // 409 — діалог щойно взяв інший адміністратор; список покаже актуальний стан.
    }
    await loadConversations();
  }

  /**
   * Повертає власний діалог у чергу очікування.
   *
   * @param {number} id Ідентифікатор діалогу.
   * @returns {Promise<void>}
   */
  async function releaseConversation(id) {
    try {
      await apiFetch(`/chat/admin/conversations/${id}/release`, { method: 'POST' });
    } catch {
      // Помилка не критична — стан підтягнеться наступним оновленням списку.
    }
    await loadConversations();
  }

  // ─── Активний діалог ────────────────────────────────────────────────────────
  function appendMessage(message) {
    const el = document.createElement('div');
    if (message.sender === 'system') {
      el.className = 'msg system';
    } else {
      el.className = `msg ${message.sender === 'admin' ? 'admin' : 'guest'}`;
    }
    el.innerHTML = escapeHtml(message.body);
    threadEl.appendChild(el);
    threadEl.scrollTop = threadEl.scrollHeight;
  }

  async function fetchThreadMessages() {
    if (activeConversationId == null) return;
    let messages;
    try {
      messages = await apiFetch(
        `/chat/admin/conversations/${activeConversationId}/messages?after=${lastMessageId}`
      );
    } catch {
      return;
    }
    messages.forEach((message) => {
      appendMessage(message);
      lastMessageId = Math.max(lastMessageId, message.id);
    });
  }

  function openConversation(id) {
    activeConversationId = id;
    lastMessageId = 0;
    threadEl.innerHTML = '';
    mainEmpty.style.display = 'none';
    threadEl.classList.add('active');
    renderClaimBar(conversationById.get(id));

    convListEl.querySelectorAll('[data-conv-id]').forEach((el) => {
      el.classList.toggle('active', Number(el.dataset.convId) === id);
    });

    fetchThreadMessages();
    startThreadPolling();
    replyInput.focus();
  }

  // ─── Polling ────────────────────────────────────────────────────────────────
  function startPolling() {
    loadConversations();
    listTimer = setInterval(loadConversations, LIST_POLL_MS);
  }

  function startThreadPolling() {
    if (threadTimer) clearInterval(threadTimer);
    threadTimer = setInterval(fetchThreadMessages, THREAD_POLL_MS);
  }

  function stopPolling() {
    if (listTimer) { clearInterval(listTimer); listTimer = null; }
    if (threadTimer) { clearInterval(threadTimer); threadTimer = null; }
  }

  // ─── Надсилання відповіді ───────────────────────────────────────────────────
  composer.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = replyInput.value.trim();
    if (!body || activeConversationId == null) return;

    replyInput.value = '';
    try {
      const message = await apiFetch(
        `/chat/admin/conversations/${activeConversationId}/messages`,
        { method: 'POST', body: JSON.stringify({ body }) }
      );
      appendMessage(message);
      lastMessageId = Math.max(lastMessageId, message.id);
      // Відповідь могла автоматично закріпити діалог — оновлюємо стан.
      await loadConversations();
    } catch (error) {
      replyInput.value = body;
      if (error.message !== 'unauthorized') {
        // Наприклад, діалог щойно взяв інший адміністратор (409).
        await loadConversations();
      }
    }
  });

  replyInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });

  // ─── Вхід ───────────────────────────────────────────────────────────────────
  if (!token || !currentAdmin || currentAdmin.role !== 'admin') {
    gate.style.display = 'flex';
  } else {
    gate.style.display = 'none';
    app.classList.add('active');
    startPolling();
  }
})();
