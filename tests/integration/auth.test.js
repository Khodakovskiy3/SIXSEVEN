import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { setupIntegration, makeApi, createUser, skipReason } from './helpers.js';

describe('auth & authorization (integration)', { skip: skipReason }, () => {
  let ctx;
  let api;

  before(async () => {
    ctx = await setupIntegration();
    api = makeApi(ctx.baseUrl);
  });
  after(async () => ctx?.teardown());

  test('health reports ready with DB and migrations', async () => {
    const res = await api('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ready');
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  test('security headers are present on pages and API', async () => {
    const page = await fetch(`${ctx.baseUrl}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(page.headers.get('x-powered-by'), null);
  });

  test('public pages are reachable without auth (landing, privacy, terms, app)', async () => {
    for (const path of ['/', '/privacy', '/terms', '/app', '/manifest.json', '/sw.js']) {
      const res = await fetch(`${ctx.baseUrl}${path}`);
      assert.equal(res.status, 200, path);
    }
  });

  test('register → verify (dev OTP) → login', async () => {
    const email = `new.${Date.now()}@test.local`;
    const reg = await api('POST', '/api/auth/register', {
      body: { name: 'New Member', email, password: 'Strong1pass', phone: '+380501112233' },
    });
    assert.equal(reg.status, 200);
    assert.equal(reg.body.twofaRequired, true);
    assert.match(reg.body.devCode, /^\d{6}$/, 'devCode only because NODE_ENV=test and DEBUG_OTP=1');

    const wrong = await api('POST', '/api/auth/register/verify', { body: { email, code: '000000' === reg.body.devCode ? '111111' : '000000' } });
    assert.equal(wrong.status, 401);

    const verify = await api('POST', '/api/auth/register/verify', { body: { email, code: reg.body.devCode } });
    assert.equal(verify.status, 200);
    assert.ok(verify.body.token);
    assert.equal(verify.body.user.role, 'client', 'public registration always creates a client');

    // Registered users get 2FA on → login requires a code.
    const login = await api('POST', '/api/auth/login', { body: { email, password: 'Strong1pass' } });
    assert.equal(login.status, 200);
    assert.equal(login.body.twofaRequired, true);
    const loginVerify = await api('POST', '/api/auth/login/verify', { body: { email, code: login.body.devCode } });
    assert.equal(loginVerify.status, 200);
    assert.ok(loginVerify.body.token);
  });

  test('registration rejects weak passwords and invalid emails', async () => {
    const weak = await api('POST', '/api/auth/register', {
      body: { name: 'X', email: 'weak@test.local', password: 'short', phone: '+380501112233' },
    });
    assert.equal(weak.status, 400);
    const badEmail = await api('POST', '/api/auth/register', {
      body: { name: 'X', email: 'not-an-email', password: 'Strong1pass', phone: '+380501112233' },
    });
    assert.equal(badEmail.status, 400);
  });

  test('wrong password → 401, unknown user → same message', async () => {
    const user = await createUser(ctx.query, { role: 'client' });
    const wrong = await api('POST', '/api/auth/login', { body: { email: user.email, password: 'nope' } });
    const unknown = await api('POST', '/api/auth/login', { body: { email: 'ghost@test.local', password: 'nope' } });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.error, unknown.body.error);
  });

  test('token validation: missing, malformed, forged and alg=none tokens are rejected', async () => {
    assert.equal((await api('GET', '/api/auth/me')).status, 401);
    assert.equal((await api('GET', '/api/auth/me', { token: 'garbage' })).status, 401);
    const jwt = (await import('jsonwebtoken')).default;
    const forged = jwt.sign({ id: 1, role: 'admin' }, 'not-the-secret');
    assert.equal((await api('GET', '/api/auth/me', { token: forged })).status, 401);
    const none = jwt.sign({ id: 1, role: 'admin' }, '', { algorithm: 'none' });
    assert.equal((await api('GET', '/api/auth/me', { token: none })).status, 401);
  });

  test('role restrictions: client cannot reach staff endpoints', async () => {
    const client = await createUser(ctx.query, { role: 'client' });
    for (const [method, path] of [
      ['GET', '/api/users'],
      ['GET', '/api/clients'],
      ['GET', '/api/reports/summary'],
      ['GET', '/api/bookings'],
      ['POST', '/api/upload/image'],
      ['GET', '/api/ai/usage'],
    ]) {
      const res = await api(method, path, { token: client.token, body: method === 'POST' ? {} : undefined });
      assert.equal(res.status, 403, `${method} ${path}`);
    }
  });

  test('clients can no longer create payment records', async () => {
    const client = await createUser(ctx.query, { role: 'client' });
    const res = await api('POST', '/api/payments', {
      token: client.token,
      body: { amount: 99999, status: 'completed' },
    });
    assert.equal(res.status, 403);
    const { rows } = await ctx.query('select count(*)::int as n from payments where client_id = $1', [client.clientId]);
    assert.equal(rows[0].n, 0);
  });

  test('manager payment input is validated', async () => {
    const manager = await createUser(ctx.query, { role: 'manager' });
    const client = await createUser(ctx.query, { role: 'client' });
    const bad = await api('POST', '/api/payments', { token: manager.token, body: { client_id: client.clientId, amount: -5 } });
    assert.equal(bad.status, 400);
    const badStatus = await api('POST', '/api/payments', { token: manager.token, body: { client_id: client.clientId, amount: 10, status: 'stolen' } });
    assert.equal(badStatus.status, 400);
    const ok = await api('POST', '/api/payments', { token: manager.token, body: { client_id: client.clientId, amount: 250 } });
    assert.equal(ok.status, 201);
  });

  test('password change revokes old tokens and returns a fresh one', async () => {
    const user = await createUser(ctx.query, { role: 'client' });
    const change = await api('PUT', '/api/auth/password', {
      token: user.token,
      body: { currentPassword: user.password, newPassword: 'N3wStrongPass' },
    });
    assert.equal(change.status, 200);
    assert.ok(change.body.refreshedToken);
    assert.equal((await api('GET', '/api/auth/me', { token: user.token })).status, 401, 'old token revoked');
    assert.equal((await api('GET', '/api/auth/me', { token: change.body.refreshedToken })).status, 200);
  });

  test('trainer cannot read anthropometry of clients outside their classes (IDOR)', async () => {
    const trainer = await createUser(ctx.query, { role: 'trainer' });
    const client = await createUser(ctx.query, { role: 'client' });
    const res = await api('GET', `/api/anthropometry/client/${client.clientId}`, { token: trainer.token });
    assert.equal(res.status, 403);
  });

  test('unknown API route → JSON 404, malformed JSON → 400 without stack trace', async () => {
    const missing = await api('GET', '/api/does-not-exist');
    assert.equal(missing.status, 404);
    const response = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"email":',
    });
    assert.equal(response.status, 400);
    const text = await response.text();
    assert.doesNotMatch(text, /at .*\.js:\d+/);
  });

  test('public config exposes brand only; early-access form stores leads, honeypot drops bots', async () => {
    const config = await api('GET', '/api/public/config');
    assert.equal(config.status, 200);
    assert.equal(config.body.productName, 'Cluvyra');
    assert.doesNotMatch(JSON.stringify(config.body), /key|secret|password|smtp/i);

    const bad = await api('POST', '/api/public/early-access', { body: { name: 'X', email: 'nope' } });
    assert.equal(bad.status, 400);
    const ok = await api('POST', '/api/public/early-access', {
      body: { name: 'Studio Owner', email: 'Owner@Studio.test', studio_type: 'yoga', message: 'Hello' },
    });
    assert.equal(ok.status, 201);
    const dup = await api('POST', '/api/public/early-access', {
      body: { name: 'Studio Owner', email: 'owner@studio.test', message: 'double click' },
    });
    assert.equal(dup.status, 200);
    assert.equal(dup.body.duplicate, true);
    const bot = await api('POST', '/api/public/early-access', {
      body: { name: 'Bot', email: 'bot@spam.test', website: 'http://spam' },
    });
    assert.equal(bot.status, 202);
    const { rows } = await ctx.query('select email, studio_type from early_access_requests order by id');
    assert.deepEqual(rows, [{ email: 'owner@studio.test', studio_type: 'yoga' }]);

    const client = await createUser(ctx.query, { role: 'client' });
    assert.equal((await api('GET', '/api/public/early-access', { token: client.token })).status, 403);
    const manager = await createUser(ctx.query, { role: 'manager' });
    const list = await api('GET', '/api/public/early-access', { token: manager.token });
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);
  });

  test('admin login requires 2FA code (mandatory for staff)', async () => {
    const admin = await createUser(ctx.query, { role: 'admin' });
    const login = await api('POST', '/api/auth/login', { body: { email: admin.email, password: admin.password } });
    assert.equal(login.status, 200);
    assert.equal(login.body.twofaRequired, true);
    assert.equal(login.body.token, undefined);
  });
});
