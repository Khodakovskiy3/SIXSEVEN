/**
 * Fills organisation-specific labels from the public brand config
 * (GET /api/public/config), so pages carry no hardcoded club name.
 * Cached per tab in sessionStorage.
 */
(function applyBrand() {
  const CACHE_KEY = 'cluvyra_public_config';

  function apply(config) {
    if (!config) return;
    document.querySelectorAll('[data-org-name]').forEach((el) => {
      el.textContent = config.organizationName || '';
    });
    document.querySelectorAll('[data-product-name]').forEach((el) => {
      el.textContent = config.productName || 'Cluvyra';
    });
    document.querySelectorAll('.support-line').forEach((el) => {
      el.hidden = !config.supportEmail;
    });
    document.querySelectorAll('[data-support-email]').forEach((el) => {
      if (config.supportEmail) {
        el.textContent = config.supportEmail;
        if (el.tagName === 'A') el.href = `mailto:${config.supportEmail}`;
      } else {
        el.hidden = true;
      }
    });
  }

  let cached = null;
  try {
    cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
  } catch {
    cached = null;
  }
  if (cached) {
    apply(cached);
    return;
  }

  fetch('/api/public/config')
    .then((response) => (response.ok ? response.json() : null))
    .then((config) => {
      apply(config);
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(config));
      } catch {
        // Storage unavailable — labels are simply fetched again next time.
      }
    })
    .catch(() => {});
})();
