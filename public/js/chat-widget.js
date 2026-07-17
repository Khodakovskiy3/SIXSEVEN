/**
 * Плаваючий чат-віджет «відвідувач ↔ адміністратор» + АІ-асистент.
 *
 * Працює у двох режимах:
 *  - гість (публічні сторінки): анонімний випадковий токен у localStorage,
 *    діалог зберігається між перезавантаженнями у межах браузера;
 *  - авторизований користувач (кабінет клієнта): діалог прив'язаний до
 *    облікового запису через JWT, тож доступний з будь-якого пристрою,
 *    а адміністратор бачить ім'я клієнта замість «Гість #N».
 *
 * Авторизованим користувачам додатково доступна вкладка «АІ-асистент» —
 * діалог із локальною LLM (маршрут /api/ai/assistant). Історія цього
 * діалогу живе лише в пам'яті сторінки: сервер stateless, тож увесь
 * контекст передається з кожним запитом.
 *
 * Нові повідомлення підтягуються через polling (кожні CHAT_POLL_MS),
 * активний лише поки панель відкрита.
 *
 * API:
 *   POST /api/chat/guest/messages   { guestToken, body }      — без авторизації
 *   GET  /api/chat/guest/messages?token=…&after=<lastId>
 *   POST /api/chat/client/messages  { body }                  — Bearer <token>
 *   GET  /api/chat/client/messages?after=<lastId>
 *   POST /api/ai/assistant          { messages }              — Bearer <token>
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
  let sse = null;
  let isOpen = false;

  // Стан діалогу з адміністратором (дзеркалить CHAT_STATE на сервері).
  // Писати можна лише в 'active'; решта станів показують блок запиту.
  const STATE_NONE = 'none';
  const STATE_PENDING = 'pending';
  const STATE_ACTIVE = 'active';
  const STATE_CLOSED = 'closed';
  let chatState = STATE_NONE;

  // ─── Стан АІ-асистента ──────────────────────────────────────────────────────
  const AI_MODE = 'ai';
  const ADMIN_MODE = 'admin';
  // Скільки останніх повідомлень історії надсилати серверу (він має свій ліміт).
  const AI_HISTORY_LIMIT = 20;
  // Скільки повідомлень тримати у сховищі: більше за ліміт надсилання, щоб
  // користувач бачив довшу стрічку, ніж отримує модель.
  const AI_HISTORY_STORAGE_LIMIT = 50;
  // Ключ на кожного користувача — щоб діалоги різних акаунтів в одному
  // браузері не змішувалися. Неавторизованим вкладка асистента недоступна.
  const AI_HISTORY_KEY = isAuthenticated ? `chat_ai_history_${authUser.id}` : '';

  /**
   * Читає збережену історію асистента зі сховища.
   * Сторонні чи пошкоджені дані відкидаємо: у localStorage міг потрапити
   * будь-який JSON, а рендер очікує лише { role, content }.
   *
   * @returns {Array<{role: string, content: string}>}
   */
  function loadAiHistory() {
    if (!AI_HISTORY_KEY) {
      return [];
    }
    try {
      const saved = JSON.parse(localStorage.getItem(AI_HISTORY_KEY) || '[]');
      if (!Array.isArray(saved)) {
        return [];
      }
      return saved.filter((item) => item
        && typeof item.content === 'string'
        && (item.role === 'user' || item.role === 'assistant'));
    } catch {
      return [];
    }
  }

  /** Зберігає історію асистента, обрізавши її до AI_HISTORY_STORAGE_LIMIT. */
  function saveAiHistory() {
    if (!AI_HISTORY_KEY) {
      return;
    }
    try {
      localStorage.setItem(
        AI_HISTORY_KEY,
        JSON.stringify(aiHistory.slice(-AI_HISTORY_STORAGE_LIMIT))
      );
    } catch {
      // Сховище переповнене або вимкнене — діалог просто не переживе перезавантаження.
    }
  }

  let mode = ADMIN_MODE;
  // Історія діалогу з асистентом у форматі API: { role, content }.
  // Відновлюється зі сховища, тож переживає перезавантаження сторінки.
  const aiHistory = loadAiHistory();
  let isAiPending = false;

  // ─── Розмітка віджета ───────────────────────────────────────────────────────
  // Заглушка порожнього діалогу з адміністратором — у константі, бо стрічку
  // треба скидати після запиту нового діалогу (старий видаляється на сервері).
  const ADMIN_EMPTY_HTML = `
    <div class="chat-widget-empty">Опишіть питання — адміністратор відповість тут.</div>
  `;

  // Заглушка порожнього діалогу асистента — у константі, бо її треба повернути
  // на місце після очищення історії.
  const AI_EMPTY_HTML = `
    <div class="chat-widget-empty">
      Привіт! Я АІ-асистент клубу OLIMP.
      Питайте про тренування, техніку вправ чи план занять.
    </div>
  `;

  // Контурна іконка у стилі решти іконок інтерфейсу (stroke, 24×24).
  const TRASH_ICON_SVG = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      <line x1="10" y1="11" x2="10" y2="17"/>
      <line x1="14" y1="11" x2="14" y2="17"/>
    </svg>
  `;

  const button = document.createElement('button');
  button.className = 'chat-widget-btn';
  button.type = 'button';
  button.setAttribute('aria-label', 'Чат з адміністратором');
  button.innerHTML = '💬<span class="chat-widget-badge" data-badge>0</span>';

  const panel = document.createElement('div');
  panel.className = 'chat-widget-panel';
  // Вкладка асистента доступна лише авторизованим: маршрут /api/ai — під JWT.
  const tabsHtml = isAuthenticated
    ? `<div class="chat-widget-tabs" data-tabs>
        <button type="button" class="chat-widget-tab active" data-tab="admin">
          Адміністратор
        </button>
        <button type="button" class="chat-widget-tab" data-tab="ai">АІ-асистент</button>
      </div>`
    : '';

  // Очищення стосується лише діалогу з асистентом: історія чату з
  // адміністратором живе на сервері, тож кнопку показуємо на вкладці АІ.
  const clearHtml = isAuthenticated
    ? `<button type="button" class="chat-widget-clear" data-ai-clear hidden
         aria-label="Очистити діалог з асистентом"
         title="Очистити діалог з асистентом">${TRASH_ICON_SVG}</button>`
    : '';

  panel.innerHTML = `
    <div class="chat-widget-header">
      <span>Чат клубу OLIMP</span>
      <span class="chat-widget-actions">
        ${clearHtml}
        <button type="button" class="chat-widget-close" aria-label="Закрити">×</button>
      </span>
    </div>
    ${tabsHtml}
    <div class="chat-widget-body" data-body>${ADMIN_EMPTY_HTML}</div>
    <div class="chat-widget-body" data-ai-body hidden>${AI_EMPTY_HTML}</div>
    <div class="chat-widget-gate" data-gate hidden>
      <p class="chat-widget-gate-text" data-gate-text></p>
      <button type="button" class="chat-widget-gate-btn" data-request></button>
    </div>
    <div class="chat-widget-confirm" data-ai-confirm hidden>
      <span>Очистити діалог?</span>
      <button type="button" class="chat-widget-confirm-btn" data-ai-confirm-no>
        Скасувати
      </button>
      <button type="button" class="chat-widget-confirm-btn is-danger" data-ai-confirm-yes>
        Очистити
      </button>
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
  const aiBodyEl = panel.querySelector('[data-ai-body]');
  const tabsEl = panel.querySelector('[data-tabs]');
  const errorEl = panel.querySelector('[data-error]');
  const formEl = panel.querySelector('[data-form]');
  const inputEl = panel.querySelector('[data-input]');
  const submitEl = formEl.querySelector('button[type="submit"]');
  const closeEl = panel.querySelector('.chat-widget-close');
  const aiClearEl = panel.querySelector('[data-ai-clear]');
  const aiConfirmEl = panel.querySelector('[data-ai-confirm]');
  const gateEl = panel.querySelector('[data-gate]');
  const gateTextEl = panel.querySelector('[data-gate-text]');
  const requestEl = panel.querySelector('[data-request]');

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

  /**
   * Показує або блок запиту, або поле вводу — залежно від стану діалогу.
   * Вкладку асистента шлюз не стосується: там поле доступне завжди.
   *
   * @returns {void}
   */
  function renderGate() {
    const isAi = mode === AI_MODE;
    const canWrite = isAi || chatState === STATE_ACTIVE;

    formEl.hidden = !canWrite;
    gateEl.hidden = canWrite;
    if (canWrite) {
      return;
    }

    if (chatState === STATE_PENDING) {
      gateTextEl.textContent = 'Запит надіслано. Очікуйте підтвердження адміністратора.';
      requestEl.hidden = true;
      return;
    }

    requestEl.hidden = false;
    if (chatState === STATE_CLOSED) {
      gateTextEl.textContent = 'Діалог завершено адміністратором.';
      requestEl.textContent = 'Запросити новий діалог';
      return;
    }
    gateTextEl.textContent = 'Щоб написати адміністратору, надішліть запит на діалог.';
    requestEl.textContent = 'Запросити діалог';
  }

  /**
   * Надсилає запит на діалог. Сервер видаляє попередній діалог цього
   * користувача разом з листуванням, тож стрічку теж скидаємо.
   *
   * @returns {Promise<void>}
   */
  async function requestConversation() {
    clearError();
    requestEl.disabled = true;
    try {
      const url = isAuthenticated
        ? `${API_BASE}/chat/client/request`
        : `${API_BASE}/chat/guest/request`;
      const headers = { 'Content-Type': 'application/json' };
      if (isAuthenticated) {
        headers.Authorization = `Bearer ${authToken}`;
      }
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(isAuthenticated ? {} : { guestToken }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        showError(data.error || 'Не вдалося надіслати запит');
        return;
      }

      // Старий діалог видалено — починаємо стрічку з чистого аркуша.
      bodyEl.innerHTML = ADMIN_EMPTY_HTML;
      hasMessages = false;
      lastMessageId = 0;
      chatState = data.state || STATE_PENDING;
      renderGate();
    } catch {
      showError('Немає зв’язку з сервером. Спробуйте ще раз.');
    } finally {
      requestEl.disabled = false;
    }
  }

  requestEl.addEventListener('click', requestConversation);

  function showError(text) {
    errorEl.textContent = text;
    errorEl.classList.add('show');
  }

  function clearError() {
    errorEl.textContent = '';
    errorEl.classList.remove('show');
  }

  // ─── АІ-асистент ────────────────────────────────────────────────────────────

  let hasAiMessages = false;

  /**
   * Додає повідомлення у стрічку асистента.
   * Повідомлення користувача і асистента перевикористовують стилі
   * guest/admin — візуально це той самий діалог «я ↔ співрозмовник».
   *
   * @param {'user'|'assistant'} role Автор повідомлення.
   * @param {string} text Текст повідомлення.
   */
  function appendAiMessage(role, text) {
    if (!hasAiMessages) {
      aiBodyEl.innerHTML = '';
      hasAiMessages = true;
    }
    const el = document.createElement('div');
    el.className = `chat-msg ${role === 'user' ? 'guest' : 'admin'}`;
    el.innerHTML = escapeHtml(text);
    aiBodyEl.appendChild(el);
    aiBodyEl.scrollTop = aiBodyEl.scrollHeight;
  }

  /** Показує індикатор «асистент друкує…» на час генерації відповіді. */
  function showAiTyping() {
    const el = document.createElement('div');
    el.className = 'chat-msg admin chat-msg-typing';
    el.dataset.typing = 'true';
    el.textContent = 'Асистент друкує…';
    aiBodyEl.appendChild(el);
    aiBodyEl.scrollTop = aiBodyEl.scrollHeight;
  }

  function removeAiTyping() {
    const typing = aiBodyEl.querySelector('[data-typing]');
    if (typing) {
      typing.remove();
    }
  }

  /** Ховає смужку підтвердження очищення. */
  function hideAiConfirm() {
    if (aiConfirmEl) {
      aiConfirmEl.hidden = true;
    }
  }

  /**
   * Очищує діалог з асистентом: пам'ять, сховище та стрічку на екрані.
   * Історія чату з адміністратором не зачіпається — вона зберігається на сервері.
   *
   * @returns {void}
   */
  function clearAiHistory() {
    aiHistory.length = 0;
    if (AI_HISTORY_KEY) {
      localStorage.removeItem(AI_HISTORY_KEY);
    }
    aiBodyEl.innerHTML = AI_EMPTY_HTML;
    hasAiMessages = false;
    hideAiConfirm();
    clearError();
  }

  if (aiClearEl) {
    aiClearEl.addEventListener('click', () => {
      // Порожній діалог чистити нема сенсу — не смикаємо зайвим запитом.
      if (aiHistory.length === 0) {
        return;
      }
      // Історія тепер переживає перезавантаження, тож випадковий клік знищив би
      // реальні дані. Підтвердження показуємо всередині віджета: системне
      // window.confirm виглядало б чужорідно.
      aiConfirmEl.hidden = false;
    });
  }

  aiConfirmEl?.querySelector('[data-ai-confirm-no]')
    ?.addEventListener('click', hideAiConfirm);
  aiConfirmEl?.querySelector('[data-ai-confirm-yes]')
    ?.addEventListener('click', clearAiHistory);

  // Відновлюємо збережену стрічку асистента після перезавантаження сторінки.
  aiHistory.forEach((message) => appendAiMessage(message.role, message.content));

  /**
   * Надсилає діалог асистенту та відображає його відповідь.
   * Кнопка блокується на час генерації: локальна модель відповідає
   * кілька секунд, а сервер однаково відхилить паралельний запит.
   *
   * @param {string} body Текст повідомлення користувача.
   * @returns {Promise<void>}
   */
  async function sendAiMessage(body) {
    aiHistory.push({ role: 'user', content: body });
    saveAiHistory();
    appendAiMessage('user', body);
    isAiPending = true;
    submitEl.disabled = true;
    showAiTyping();

    try {
      const response = await fetch(`${API_BASE}/ai/assistant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ messages: aiHistory.slice(-AI_HISTORY_LIMIT) }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        // Невдалий запит не лишаємо в історії, щоб повтор надіслав те саме.
        aiHistory.pop();
        saveAiHistory();
        showError(data.error || 'Асистент недоступний. Спробуйте пізніше.');
        return;
      }

      aiHistory.push({ role: 'assistant', content: data.reply });
      saveAiHistory();
      appendAiMessage('assistant', data.reply);
    } catch {
      aiHistory.pop();
      saveAiHistory();
      showError('Немає зв’язку з сервером. Спробуйте ще раз.');
    } finally {
      removeAiTyping();
      isAiPending = false;
      submitEl.disabled = false;
    }
  }

  /**
   * Перемикає вкладку віджета (адміністратор ↔ асистент).
   *
   * @param {string} next Цільовий режим: ADMIN_MODE або AI_MODE.
   */
  function switchMode(next) {
    if (mode === next) {
      return;
    }
    mode = next;
    clearError();

    const isAi = mode === AI_MODE;
    bodyEl.hidden = isAi;
    aiBodyEl.hidden = !isAi;
    inputEl.placeholder = isAi ? 'Запитайте про тренування…' : 'Ваше повідомлення…';
    submitEl.disabled = isAi && isAiPending;
    if (aiClearEl) {
      aiClearEl.hidden = !isAi;
    }
    // Незавершене підтвердження не має «переїжджати» на вкладку адміністратора.
    hideAiConfirm();
    // Поле вводу на вкладці адміністратора доступне лише в підтвердженому діалозі.
    renderGate();

    tabsEl.querySelectorAll('[data-tab]').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.tab === mode);
    });

    const activeBody = isAi ? aiBodyEl : bodyEl;
    activeBody.scrollTop = activeBody.scrollHeight;
    if (!formEl.hidden) {
      inputEl.focus();
    }
  }

  if (tabsEl) {
    tabsEl.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-tab]');
      if (tab) {
        switchMode(tab.dataset.tab);
      }
    });
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

  /**
   * Підтягує нові повідомлення діалогу та його стан (polling).
   * Саме звідси віджет дізнається, що адміністратор підтвердив або завершив
   * діалог, і перемальовує шлюз.
   */
  async function fetchMessages() {
    try {
      const { url, headers } = buildFetchParams();
      const response = await fetch(url, { headers });
      if (!response.ok) return;
      const data = await response.json();

      const previousState = chatState;
      chatState = data.state || STATE_NONE;
      (data.messages || []).forEach((message) => {
        appendMessage(message);
        lastMessageId = Math.max(lastMessageId, message.id);
      });
      if (chatState !== previousState) {
        renderGate();
      }
    } catch {
      // Тимчасова мережева помилка — наступний цикл polling спробує знову.
    }
  }

  // Реалтайм: основний канал — SSE (пуш), а polling лишається запобіжником.
  // Поки SSE підключений, опитування сповільнюється до SAFETY_POLL_MS; якщо
  // SSE недоступний або впав — повертається швидке опитування (CHAT_POLL_MS).
  // Так поведінка не гіршає навіть без SSE.
  const SAFETY_POLL_MS = 20000;

  function setPolling(intervalMs) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(fetchMessages, intervalMs);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  /** Відкриває SSE-стрім під поточний режим (гість/клієнт). */
  async function connectSse() {
    if (sse) return;
    try {
      let url;
      if (isAuthenticated) {
        // Клієнту потрібен одноразовий квиток (EventSource не шле Bearer).
        const ticketResp = await fetch(`${API_BASE}/chat/client/stream-ticket`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!ticketResp.ok) return; // лишаємось на швидкому polling
        const { ticket } = await ticketResp.json();
        url = `${API_BASE}/chat/stream?ticket=${encodeURIComponent(ticket)}`;
      } else {
        url = `${API_BASE}/chat/guest/stream?token=${encodeURIComponent(guestToken)}`;
      }

      const es = new EventSource(url);
      sse = es;
      // Канал відкрито — можна сповільнити запобіжний polling.
      es.addEventListener('ready', () => {
        if (isOpen) setPolling(SAFETY_POLL_MS);
      });
      // Є зміни — одразу дозавантажуємо нові повідомлення.
      es.addEventListener('message', () => { fetchMessages(); });
      es.onerror = () => {
        es.close();
        if (sse === es) sse = null;
        // Втратили пуш — повертаємось до швидкого опитування.
        if (isOpen) setPolling(CHAT_POLL_MS);
      };
    } catch {
      // Будь-яка помилка — тихо лишаємось на polling.
    }
  }

  function disconnectSse() {
    if (sse) {
      sse.close();
      sse = null;
    }
  }

  function startRealtime() {
    fetchMessages();
    setPolling(CHAT_POLL_MS); // базово — швидкий polling, поки не підключиться SSE
    connectSse();
  }

  function stopRealtime() {
    stopPolling();
    disconnectSse();
  }

  function openPanel() {
    isOpen = true;
    panel.classList.add('open');
    startRealtime();
    if (!formEl.hidden) {
      inputEl.focus();
    }
  }

  function closePanel() {
    isOpen = false;
    panel.classList.remove('open');
    stopRealtime();
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

    // Вкладка асистента має власний цикл надсилання (без polling).
    if (mode === AI_MODE) {
      if (isAiPending) {
        return;
      }
      inputEl.value = '';
      await sendAiMessage(body);
      return;
    }

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
        // Діалог могли завершити саме під час набору — показуємо актуальний шлюз.
        if (data.state) {
          chatState = data.state;
          renderGate();
        }
        return;
      }
      // Одразу показуємо власне повідомлення, не чекаючи циклу polling.
      appendMessage(data);
      lastMessageId = Math.max(lastMessageId, data.id);
      // Перше повідомлення щойно створило діалог — тепер можна відкрити SSE,
      // якщо він досі не під'єднаний (раніше стрім повертав 404).
      if (!sse && isOpen) connectSse();
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

  // До першого циклу polling стан невідомий, тож ховаємо поле одразу:
  // інакше користувач на мить побачив би форму, у яку не має права писати.
  renderGate();
})();
