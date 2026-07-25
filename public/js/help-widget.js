/**
 * Довідка (FAQ) для гостя та клієнта — самодостатній модуль.
 *
 * Вставляє кнопку «?» у шапку сторінки й модальне вікно з відповідями на
 * типові запитання. Завантажується наявними скриптами кожної ролі
 * (home.js — гість, client.js — клієнт), тож окремих правок HTML не потребує.
 *
 * Стилі інжектуються один раз і використовують CSS-змінні теми
 * (--surface, --text, --line, --accent…), тож світла й темна теми
 * підхоплюються автоматично.
 */

// Ідентифікатори вставлених вузлів — щоб не дублювати при повторній ініціалізації.
const STYLE_ID = 'help-widget-style';
const BACKDROP_ID = 'help-widget-backdrop';

// z-index вищий за чат-віджет (1000), щоб довідка відкривалася поверх нього.
const HELP_Z_INDEX = 1100;

/**
 * Контент довідки за ролями. Кожен пункт — запитання + HTML-відповідь.
 * Текст статичний і довірений (не містить даних користувача), тож
 * вставляється як розмітка без екранування.
 */
const HELP_CONTENT = {
  guest: {
    title: 'Довідка',
    intro: 'OLIMP — це зал, групові та персональні тренування з онлайн-записом. '
      + 'Ось як почати користуватися.',
    items: [
      {
        q: 'Як зареєструватися?',
        a: 'Натисніть <b>«Увійти»</b> у шапці, далі <b>«Зареєструватися»</b>. '
          + 'Реєстрацію треба підтвердити кодом, який надійде на вашу пошту.',
      },
      {
        q: 'Де переглянути послуги та ціни?',
        a: 'Розділи <b>«Послуги»</b> й <b>«Абонементи»</b> в меню — там опис '
          + 'тренувань, тривалість і вартість.',
      },
      {
        q: 'Як подивитися розклад занять?',
        a: 'Розділ <b>«Розклад»</b> показує заняття за днями. Записатися на них '
          + 'можна після входу в особистий кабінет.',
      },
      {
        q: 'Як купити абонемент або записатися на заняття?',
        a: 'Спершу зареєструйтесь і увійдіть — купівля абонемента та запис на '
          + 'заняття доступні в кабінеті клієнта.',
      },
      {
        q: 'Як поставити запитання клубу?',
        a: 'Натисніть кнопку чату <b>💬</b> внизу праворуч і напишіть '
          + 'адміністратору — він відповість у робочі години.',
      },
      {
        q: 'Де знайти адресу та години роботи?',
        a: 'Розділ <b>«Про нас»</b> — там контакти, адреса й графік роботи клубу.',
      },
    ],
  },
  client: {
    title: 'Довідка',
    intro: 'Ваш особистий кабінет: запис на заняття, абонемент, відвідування '
      + 'та вимірювання. Нижче — короткі підказки.',
    items: [
      {
        q: 'Як записатися на заняття?',
        a: 'Відкрийте <b>«Розклад»</b>, оберіть потрібне заняття й натисніть '
          + '<b>«Записатися»</b>. Для запису потрібен активний абонемент.',
      },
      {
        q: 'Як скасувати запис?',
        a: 'У розділі <b>«Записи»</b> (або в «Розкладі») знайдіть своє бронювання '
          + 'й скасуйте його. Зробіть це до початку заняття.',
      },
      {
        q: 'Як купити або продовжити абонемент?',
        a: 'Перегляньте доступні тарифи в розділі <b>«Абонемент»</b> і зверніться '
          + 'до адміністратора. Лише адміністратор може надати, продовжити або скасувати абонемент.',
      },
      {
        q: 'Де побачити історію відвідувань?',
        a: 'Розділ <b>«Записи»</b> показує ваші заняття, а <b>«Активність»</b> — '
          + 'загальну історію відвідувань залу.',
      },
      {
        q: 'Як додати вимірювання тіла?',
        a: 'Відкрийте <b>«Антропометрія»</b> й додайте новий запис (вага, зріст, '
          + 'обхвати). Динаміка відобразиться графіком.',
      },
      {
        q: 'Що означає дзвіночок угорі?',
        a: 'Це <b>сповіщення</b>: оголошення клубу й системні повідомлення '
          + '(наданий абонемент, перенесене заняття тощо). Крапка — є непрочитані.',
      },
      {
        q: 'Як зв’язатися з адміністратором?',
        a: 'Кнопка чату <b>💬</b> внизу праворуч. Авторизованим також доступна '
          + 'вкладка <b>АІ-асистент</b> для швидких запитань.',
      },
      {
        q: 'Де змінити дані профілю та безпеку?',
        a: 'Розділ <b>«Профіль»</b> — особисті дані; <b>«Налаштування»</b> — '
          + 'двофакторна автентифікація (2FA) та тема оформлення.',
      },
    ],
  },
};

/**
 * Одноразово вставляє стилі довідки в <head>.
 * @returns {void}
 */
function injectStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .help-widget-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 38px;
      height: 38px;
      border-radius: 50%;
      border: 1px solid var(--line, #333);
      background: transparent;
      color: var(--text, #eee);
      font-size: 18px;
      font-weight: 700;
      cursor: pointer;
      line-height: 1;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .help-widget-btn:hover {
      border-color: var(--accent, #6c8cff);
      color: var(--accent, #6c8cff);
    }
    .help-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
      z-index: ${HELP_Z_INDEX};
    }
    .help-modal-backdrop.open {
      display: flex;
    }
    .help-modal {
      background: var(--surface, #17181c);
      color: var(--text, #eee);
      border: 1px solid var(--line, #2a2b31);
      border-radius: var(--radius, 14px);
      box-shadow: var(--shadow, 0 20px 60px rgba(0, 0, 0, 0.5));
      width: 560px;
      max-width: 100%;
      max-height: 82vh;
      overflow-y: auto;
      padding: 22px 24px 8px;
    }
    .help-modal-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 6px;
    }
    .help-modal-head h2 {
      margin: 0;
      font-size: 20px;
    }
    .help-modal-close {
      background: transparent;
      border: none;
      color: var(--muted, #9aa0ab);
      font-size: 26px;
      line-height: 1;
      cursor: pointer;
      padding: 0 4px;
    }
    .help-modal-close:hover {
      color: var(--text, #eee);
    }
    .help-modal-intro {
      color: var(--muted, #9aa0ab);
      font-size: 14px;
      margin: 0 0 14px;
    }
    .help-item {
      border-top: 1px solid var(--line, #2a2b31);
      padding: 4px 0;
    }
    .help-item > summary {
      cursor: pointer;
      list-style: none;
      padding: 12px 28px 12px 2px;
      font-weight: 600;
      position: relative;
      outline: none;
    }
    .help-item > summary::-webkit-details-marker {
      display: none;
    }
    .help-item > summary::after {
      content: '+';
      position: absolute;
      right: 6px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--muted, #9aa0ab);
      font-weight: 700;
    }
    .help-item[open] > summary::after {
      content: '–';
    }
    .help-item-body {
      padding: 0 2px 14px;
      color: var(--muted, #9aa0ab);
      font-size: 14px;
      line-height: 1.5;
    }
    .help-item-body b {
      color: var(--text, #eee);
    }
    .help-modal-foot {
      color: var(--muted, #9aa0ab);
      font-size: 13px;
      text-align: center;
      padding: 14px 0 18px;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Знаходить контейнер у шапці, куди вставити кнопку «?», залежно від ролі.
 * @param {'guest'|'client'} role
 * @returns {{ container: Element, before: Element|null }|null}
 */
function findButtonSlot(role) {
  if (role === 'client') {
    const actions = document.querySelector('.top-actions');
    if (actions) {
      // Перед дзвіночком, щоб «?» стояла лівіше за сповіщення й аватар.
      return { container: actions, before: actions.firstElementChild };
    }
    return null;
  }
  // Гість: поряд із кнопкою входу у верхньому меню.
  const topbar = document.querySelector('.topbar');
  const loginBtn = topbar && topbar.querySelector('.login-btn');
  if (topbar && loginBtn) {
    return { container: topbar, before: loginBtn };
  }
  return null;
}

/**
 * Будує модальне вікно довідки з контенту ролі.
 * @param {{title: string, intro: string, items: Array<{q: string, a: string}>}} content
 * @returns {HTMLElement} Кореневий елемент backdrop.
 */
function buildModal(content) {
  const backdrop = document.createElement('div');
  backdrop.id = BACKDROP_ID;
  backdrop.className = 'help-modal-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', content.title);

  const items = content.items
    .map((item) => `
      <details class="help-item">
        <summary>${item.q}</summary>
        <div class="help-item-body">${item.a}</div>
      </details>
    `)
    .join('');

  backdrop.innerHTML = `
    <div class="help-modal">
      <div class="help-modal-head">
        <h2>${content.title}</h2>
        <button class="help-modal-close" aria-label="Закрити">×</button>
      </div>
      <p class="help-modal-intro">${content.intro}</p>
      ${items}
      <div class="help-modal-foot">Не знайшли відповідь? Напишіть нам у чат 💬</div>
    </div>
  `;
  return backdrop;
}

/**
 * Ініціалізує довідку для вказаної ролі: вставляє кнопку «?» та модалку.
 * Безпечно викликати повторно — повторна вставка ігнорується.
 *
 * @param {'guest'|'client'} role Роль поточного інтерфейсу.
 * @returns {void}
 */
export function initHelpWidget(role) {
  const content = HELP_CONTENT[role];
  if (!content || document.getElementById(BACKDROP_ID)) {
    return;
  }

  const slot = findButtonSlot(role);
  if (!slot) {
    return;
  }

  injectStyles();

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'help-widget-btn';
  button.setAttribute('aria-label', 'Довідка');
  button.title = 'Довідка';
  button.textContent = '?';
  slot.container.insertBefore(button, slot.before);

  const backdrop = buildModal(content);
  document.body.appendChild(backdrop);

  const open = () => {
    backdrop.classList.add('open');
  };
  const close = () => {
    backdrop.classList.remove('open');
  };

  button.addEventListener('click', open);
  backdrop.querySelector('.help-modal-close').addEventListener('click', close);
  // Клік по тлу (поза модалкою) закриває довідку.
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) {
      close();
    }
  });
  // Esc закриває відкриту довідку.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && backdrop.classList.contains('open')) {
      close();
    }
  });
}
