/**
 * Гарячі клавіші для модальних вікон — спільні для всіх ролей.
 *
 * Esc  — закриває активне модальне вікно (натискає кнопку скасування/
 *        закриття, щоб зберегти існуючу логіку закриття кожної форми,
 *        зокрема Promise-обіцянки підтвердження).
 * Enter — підтверджує активне модальне вікно (натискає основну кнопку),
 *        якщо фокус не в багаторядковому полі (textarea), де Enter
 *        повинен просто додавати новий рядок.
 *
 * Tab / Shift+Tab не потребують окремої обробки — стандартна поведінка
 * браузера для фокусованих елементів (button, input, a, select) вже
 * забезпечує перехід між ними.
 *
 * Усі модальні вікна системи мають єдину структуру: контейнер з класом
 * .modal-backdrop, що отримує клас .active при відкритті.
 */

const CANCEL_SELECTOR = '.modal-close, .ghost-btn, #confirm-cancel-btn, #modal-cancel';
const CONFIRM_SELECTOR = '#confirm-accept-btn, #modal-confirm, .primary-btn, .danger-btn';

export function initModalHotkeys() {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' && event.key !== 'Enter') return;

    const backdrop = document.querySelector('.modal-backdrop.active');
    if (!backdrop) return;

    if (event.key === 'Escape') {
      const cancelBtn = backdrop.querySelector(CANCEL_SELECTOR);
      if (cancelBtn) {
        event.preventDefault();
        cancelBtn.click();
      } else {
        backdrop.classList.remove('active');
      }
      return;
    }

    // Enter: не перехоплюємо в textarea (там Enter — новий рядок).
    if (document.activeElement?.tagName === 'TEXTAREA') return;

    const confirmBtn = backdrop.querySelector(CONFIRM_SELECTOR);
    if (confirmBtn) {
      event.preventDefault();
      confirmBtn.click();
    }
  });
}
