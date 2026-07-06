/**
 * Collapsible sidebar — shared across all roles.
 * Requires HTML to already have .sidebar-toggle button and .nav-icon/.nav-label spans.
 * Persists expanded state in localStorage.
 */

const STORAGE_KEY_SIDEBAR = 'olimp-sidebar-expanded';

export function initSidebar() {
  const appShell = document.querySelector('.app-shell');
  const toggle = document.querySelector('.sidebar-toggle');
  if (!appShell || !toggle) return;

  // Restore saved state
  const saved = localStorage.getItem(STORAGE_KEY_SIDEBAR);
  if (saved === 'true') {
    appShell.classList.add('sidebar-expanded');
  }

  toggle.addEventListener('click', () => {
    const expanded = appShell.classList.toggle('sidebar-expanded');
    localStorage.setItem(STORAGE_KEY_SIDEBAR, expanded);
  });
}
