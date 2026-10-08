/**
 * OTP must never be exposed in production — even with DEBUG_OTP=1 and no SMTP.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { setupIntegration, makeApi, createUser, skipReason } from './helpers.js';

describe('OTP in production mode (integration)', { skip: skipReason }, () => {
  let ctx;
  let api;
  const logs = [];
  const originalLog = console.log;

  before(async () => {
    ctx = await setupIntegration({ NODE_ENV: 'production', DEBUG_OTP: '1', SMTP_HOST: '' });
    api = makeApi(ctx.baseUrl);
    console.log = (...args) => {
      logs.push(args.join(' '));
      originalLog(...args);
    };
  });
  after(async () => {
    console.log = originalLog;
    await ctx?.teardown();
  });

  test('registration without SMTP returns 503 and no code', async () => {
    const res = await api('POST', '/api/auth/register', {
      body: { name: 'Prod', email: 'prod@test.local', password: 'Strong1pass', phone: '+380501112233' },
    });
    assert.equal(res.status, 503);
    assert.equal(res.body.devCode, undefined);
    const { rows } = await ctx.query('select count(*)::int as n from pending_registrations');
    assert.equal(rows[0].n, 0, 'no undeliverable code is issued');
  });

  test('staff login without SMTP returns 503, never a token or code', async () => {
    const admin = await createUser(ctx.query, { role: 'admin' });
    const res = await api('POST', '/api/auth/login', { body: { email: admin.email, password: admin.password } });
    assert.equal(res.status, 503);
    assert.equal(res.body.devCode, undefined);
    assert.equal(res.body.token, undefined);
  });

  test('clients without 2FA can still sign in', async () => {
    const client = await createUser(ctx.query, { role: 'client' });
    const res = await api('POST', '/api/auth/login', { body: { email: client.email, password: client.password } });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
  });

  test('no OTP code was written to the logs', () => {
    assert.equal(logs.some((line) => /\[2FA\]/.test(line)), false);
  });

  test('HSTS is enabled in production', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/health/live`);
    assert.match(res.headers.get('strict-transport-security') || '', /max-age=/);
  });
});
