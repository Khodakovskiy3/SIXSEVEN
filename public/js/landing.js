/**
 * Cluvyra landing page: early-access form and small progressive enhancements.
 */
(function initLanding() {
  const year = document.getElementById('year');
  if (year) {
    year.textContent = String(new Date().getFullYear());
  }

  const form = document.getElementById('early-access-form');
  if (!form) {
    return;
  }
  const status = form.querySelector('.form-status');
  const submit = form.querySelector('button[type="submit"]');

  function setStatus(text, variant) {
    status.textContent = text;
    status.dataset.variant = variant;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    if (!data.name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email || '')) {
      setStatus('Please enter your name and a valid email.', 'error');
      return;
    }
    submit.disabled = true;
    setStatus('Sending…', 'info');
    try {
      const response = await fetch('/api/public/early-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(body.error || 'Something went wrong. Please try again.', 'error');
        return;
      }
      form.reset();
      setStatus('Thank you! We received your request and will get back to you.', 'success');
    } catch {
      setStatus('Network error. Please check your connection and try again.', 'error');
    } finally {
      submit.disabled = false;
    }
  });
})();
