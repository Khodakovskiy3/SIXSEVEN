/**
 * Адмінська сторінка чату з клієнтами (захищена простим паролем).
 *
 * Доступ за прямим URL /pages/chat-admin.html. Введений пароль зберігається в
 * sessionStorage і додається до кожного запиту заголовком X-Chat-Password.
 * Нові повідомлення й список діалогів оновлюються через polling.
 *
 * API (за паролем):
 *   GET  /api/chat/admin/conversations
 *   GET  /api/chat/admin/conversations/:id/messages?after=<lastId>
 *   POST /api/chat/admin/conversations/:id/messages  { body }
 */

(function initChatAdmin() {
  const API_BASE = '/api';
  const PASSWORD_KEY = 'chat_admin_password';
  const LIST_POLL_MS = 4000;
  const THREAD_POLL_MS = 3000;

  const gate = document.querySelector('[data-gate]');
  const gateForm = document.querySelector('[data-gate-form]');
  const passwordInput = document.querySelector('[data-password]');
  const gateError = document.querySelector('[data-gate-error]');

  const app = document.querySelector('[data-app]');
  const convListEl = document.querySelector('[data-conv-list]');
  const threadEl = document.querySelector('[data-thread]');
  const mainEmpty = document.querySelector('[data-main-empty]');
  const composer = document.querySelector('[data-composer]');
  const replyInput = document.querySelector('[data-reply]');

  let password = '';
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
   * Обгортка над fetch, що додає заголовок пароля.
   * Кидає об'єкт { status } при невдачі авторизації, щоб викликач міг
   * повернути користувача на екран пароля.
   */
  async function apiFetch(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Chat-Password': password,
        ...(options.headers || {}),
      },
    });
    if (response.status === 401 || response.status === 403) {
      handleAuthFailure();
      throw new Error('unauthorized');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Помилка запиту');
    }
    return data;
  }

  /** Повертає на екран пароля при втраті авторизації. */
  function handleAuthFailure() {
    stopPolling();
    sessionStorage.removeItem(PASSWORD_KEY);
    password = '';
    app.classList.remove('active');
    gate.style.display = 'flex';
    gateError.textContent = 'Сесію завершено. Введіть пароль знову.';
  }

  // ─── Список діалогів ────────────────────────────────────────────────────────
  async function loadConversations() {
    let conversations;
    try {
      conversations = await apiFetch('/chat/admin/conversations');
    } catch {
      return;
    }

    if (conversations.length === 0) {
      convListEl.innerHTML = '<div style="padding:16px;color:var(--muted);font-size:13px;">Поки що немає звернень.</div>';
      return;
    }

    convListEl.innerHTML = conversations.map((conv) => {
      const unread = Number(conv.unread) > 0
        ? `<span class="conv-badge">${conv.unread}</span>`
        : '';
      const isActive = conv.id === activeConversationId ? ' active' : '';
      const last = conv.last_message ? escapeHtml(conv.last_message) : '';
      return `
        <div class="conv-item${isActive}" data-conv-id="${conv.id}">
          <span class="conv-title">Гість #${conv.id}${unread}</span>
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

  // ─── Активний діалог ────────────────────────────────────────────────────────
  function appendMessage(message) {
    const el = document.createElement('div');
    el.className = `msg ${message.sender === 'admin' ? 'admin' : 'guest'}`;
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
    composer.classList.add('active');

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
    } catch {
      replyInput.value = body;
    }
  });

  replyInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });

  // ─── Вхід за паролем ────────────────────────────────────────────────────────
  function enterApp() {
    gate.style.display = 'none';
    app.classList.add('active');
    startPolling();
  }

  gateForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    gateError.textContent = '';
    const candidate = passwordInput.value;
    if (!candidate) return;

    password = candidate;
    // Перевіряємо пароль реальним запитом до захищеного ендпоінта.
    try {
      await apiFetch('/chat/admin/conversations');
      sessionStorage.setItem(PASSWORD_KEY, password);
      passwordInput.value = '';
      enterApp();
    } catch (error) {
      if (error.message === 'unauthorized') {
        // handleAuthFailure вже показав повідомлення.
        gateError.textContent = 'Невірний пароль';
      } else {
        gateError.textContent = error.message || 'Помилка з’єднання';
      }
      password = '';
    }
  });

  // Автовхід, якщо пароль уже збережений у цій сесії браузера.
  const stored = sessionStorage.getItem(PASSWORD_KEY);
  if (stored) {
    password = stored;
    apiFetch('/chat/admin/conversations')
      .then(enterApp)
      .catch(() => {
        // Невалідний збережений пароль — лишаємо екран входу.
        password = '';
        sessionStorage.removeItem(PASSWORD_KEY);
      });
  }
})();
