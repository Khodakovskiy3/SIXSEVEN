const API_BASE = '/api';

export function getAuth() {
  const token = localStorage.getItem('token');
  const userRaw = localStorage.getItem('user');
  const user = userRaw ? JSON.parse(userRaw) : null;
  return { token, user };
}

export function setAuth(token, user) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

export function requireAuth(expectedRoles = []) {
  const { token, user } = getAuth();
  if (!token || !user) {
    window.location.href = '/pages/login.html';
    return null;
  }

  if (expectedRoles.length && !expectedRoles.includes(user.role)) {
    window.location.href = '/pages/login.html';
    return null;
  }

  return user;
}

export async function apiFetch(path, options = {}) {
  const { token } = getAuth();
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearAuth();
    window.location.href = '/pages/login.html';
    return null;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error || 'Request failed';
    throw new Error(message);
  }

  return data;
}

export function formatDate(value) {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}
