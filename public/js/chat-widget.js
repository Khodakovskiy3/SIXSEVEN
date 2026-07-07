/**
 * Плаваючий чат-віджет «відвідувач ↔ адміністратор».
 *
 * Працює у двох режимах:
 *  - гість (публічні сторінки): анонімний випадковий токен у localStorage,
 *    діалог зберігається між перезавантаженнями у межах браузера;
 *  - авторизований користувач (кабінет клієнта): діалог прив'язаний до
 *    облікового запису через JWT, тож доступний з будь-якого пристрою,
 *    а адміністратор бачить ім'я клієнта замість «Гість #N».
 *
 * Нові повідомлення підтягуються через polling (кожні CHAT_POLL_MS),
 * активний лише поки панель відкрита.
 *
 * API:
 *   POST /api/chat/guest/messages   { guestToken, body }      — без авторизації
 *   GET  /api/chat/guest/messages?token=…&after=<lastId>
 *   POST /api/chat/client/messages  { body }                  — Bearer <token>
 *   GET  /api/chat/client/messages?after=<lastId>
 */

(function initChatWidget() {
  const API_BASE = '/api';
  const TOKEN_KEY = 'chat_guest_token';
  const AUTH_TOKEN_KEY = 'token';
  const AUTH_USER_KEY = 'user';
  const CHAT_POLL_MS = 3000;

  // Режим авторизованого користувача: є JWT і збережений профіль.
  const authToken = localStorage.getItem(AUTH_TOKEN_KEY);
  let authUser = null;
  try {
    authUser = JSON.parse(localStorage.getItem(AUTH_USER_KEY) || 'null');
  } catch {
    authUser = null;
  }
  const isAuthenticated = Boolean(authToken && authUser && authUser.id);

  /**
   * Повертає токен гостя, створюючи його при першому виклику.
   * @returns {string}
   */
  function getGuestToken() {
    let token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      token = (crypto.randomUUID && crypto.randomUUID())
        || `g-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(TOKEN_KEY, token);
    }
    return token;
  }

  /** Екранує текст перед вставкою в HTML. */
  function escapeHtml(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  const guestToken = getGuestToken();
  let lastMessageId = 0;
  let pollTimer = null;
  let isOpen = false;

  // ─── Розмітка віджета ───────────────────────────────────────────────────────
  const button = document.createElement('button');
  button.className = 'chat-widget-btn';
  button.type = 'button';
  button.setAttribute('aria-label', 'Чат з адміністратором');
  button.innerHTML = '💬<span class="chat-widget-badge" data-badge>0</span>';

  const panel = document.createElement('div');
  panel.className = 'chat-widget-panel';
  panel.innerHTML = `
    <div class="chat-widget-header">
      <span>Чат з адміністратором</span>
      <button type="button" class="chat-widget-close" aria-label="Закрити">×</button>
    </div>
    <div class="chat-widget-body" data-body>
      <div class="chat-widget-empty">Напишіть нам — адміністратор відповість тут.</div>
    </div>
    <div class="chat-widget-error" data-error></div>
    <form class="chat-widget-form" data-form>
      <textarea data-input placeholder="Ваше повідомлення…" maxlength="2000"></textarea>
      <button type="submit">▶</button>
    </form>
  `;

  document.body.appendChild(button);
  document.body.appendChild(panel);

  const bodyEl = panel.querySelector('[data-body]');
  const errorEl = panel.querySelector('[data-error]');
  const formEl = panel.querySelector('[data-form]');
  const inputEl = panel.querySelector('[data-input]');
  const closeEl = panel.querySelector('.chat-widget-close');

  let hasMessages = false;

  /** Додає одне повідомлення у стрічку. */
  function appendMessage(message) {
    if (!hasMessages) {
      bodyEl.innerHTML = '';
      hasMessages = true;
    }
    const el = document.createElement('div');
    if (message.sender === 'system') {
      // Службові події (адміністратор приєднався тощо) — нейтральним рядком.
      el.className = 'chat-msg system';
    } else {
      el.className = `chat-msg ${message.sender === 'admin' ? 'admin' : 'guest'}`;
    }
    el.innerHTML = escapeHtml(message.body);
    bodyEl.appendChild(el);
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function showError(text) {
    errorEl.textContent = text;
    errorEl.classList.add('show');
  }

  function clearError() {
    errorEl.textContent = '';
    errorEl.classList.remove('show');
  }

  /**
   * Формує URL і заголовки під поточний режим (гість або клієнт).
   *
   * @returns {{ url: string, headers: object }}
   */
  function buildFetchParams() {
    if (isAuthenticated) {
      return {
        url: `${API_BASE}/chat/client/messages?after=${lastMessageId}`,
        headers: { Authorization: `Bearer ${authToken}` },
      };
    }
    const params = `token=${encodeURIComponent(guestToken)}&after=${lastMessageId}`;
    return { url: `${API_BASE}/chat/guest/messages?${params}`, headers: {} };
  }

  /** Підтягує нові повідомлення діалогу (polling). */
  async function fetchMessages() {
    try {
      const { url, headers } = buildFetchParams();
      const response = await fetch(url, { headers });
      if (!response.ok) return;
      const messages = await response.json();
      messages.forEach((message) => {
        appendMessage(message);
        lastMessageId = Math.max(lastMessageId, message.id);
      });
    } catch {
      // Тимчасова мережева помилка — наступний цикл polling спробує знову.
    }
  }

  function startPolling() {
    if (pollTimer) return;
    fetchMessages();
    pollTimer = setInterval(fetchMessages, CHAT_POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function openPanel() {
    isOpen = true;
    panel.classList.add('open');
    startPolling();
    inputEl.focus();
  }

  function closePanel() {
    isOpen = false;
    panel.classList.remove('open');
    stopPolling();
  }

  button.addEventListener('click', () => {
    if (isOpen) closePanel();
    else openPanel();
  });

  closeEl.addEventListener('click', closePanel);

  formEl.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();
    const body = inputEl.value.trim();
    if (!body) return;

    inputEl.value = '';
    try {
      const postUrl = isAuthenticated
        ? `${API_BASE}/chat/client/messages`
        : `${API_BASE}/chat/guest/messages`;
      const postHeaders = { 'Content-Type': 'application/json' };
      if (isAuthenticated) {
        postHeaders.Authorization = `Bearer ${authToken}`;
      }
      const response = await fetch(postUrl, {
        method: 'POST',
        headers: postHeaders,
        body: JSON.stringify(isAuthenticated ? { body } : { guestToken, body }),
      });
      const data = await response.json();
      if (!response.ok) {
        showError(data.error || 'Не вдалося надіслати повідомлення');
        inputEl.value = body;
        return;
      }
      // Одразу показуємо власне повідомлення, не чекаючи циклу polling.
      appendMessage(data);
      lastMessageId = Math.max(lastMessageId, data.id);
    } catch {
      showError('Немає зв’язку з сервером. Спробуйте ще раз.');
      inputEl.value = body;
    }
  });

  // Enter — надіслати, Shift+Enter — новий рядок.
  inputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      formEl.requestSubmit();
    }
  });
})();
