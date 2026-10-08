import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  setupIntegration, makeApi, createUser, giveSubscription, createClass, skipReason,
} from './helpers.js';

describe('booking rules & concurrency (integration)', { skip: skipReason }, () => {
  let ctx;
  let api;
  let service;

  before(async () => {
    ctx = await setupIntegration();
    api = makeApi(ctx.baseUrl);
    service = await import('../../server/services/booking-service.js');
  });
  after(async () => ctx?.teardown());

  async function member(subscription = {}) {
    const user = await createUser(ctx.query, { role: 'client' });
    if (subscription !== null) {
      await giveSubscription(ctx.query, user.clientId, subscription);
    }
    return user;
  }

  test('available slot → 201 and seat is taken', async () => {
    const user = await member();
    const slot = await createClass(ctx.query, { capacity: 5 });
    const res = await api('POST', '/api/bookings', { token: user.token, body: { schedule_id: slot.scheduleId } });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'active');
  });

  test('duplicate booking → 409 ALREADY_BOOKED', async () => {
    const user = await member();
    const slot = await createClass(ctx.query);
    await api('POST', '/api/bookings', { token: user.token, body: { schedule_id: slot.scheduleId } });
    const again = await api('POST', '/api/bookings', { token: user.token, body: { schedule_id: slot.scheduleId } });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'ALREADY_BOOKED');
  });

  test('full class → 409 CLASS_FULL', async () => {
    const slot = await createClass(ctx.query, { capacity: 1 });
    const first = await member();
    const second = await member();
    assert.equal((await api('POST', '/api/bookings', { token: first.token, body: { schedule_id: slot.scheduleId } })).status, 201);
    const res = await api('POST', '/api/bookings', { token: second.token, body: { schedule_id: slot.scheduleId } });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'CLASS_FULL');
  });

  test('no / expired subscription → NO_SUBSCRIPTION', async () => {
    const noSub = await member(null);
    const expired = await member({ endOffsetDays: -2 });
    const slot = await createClass(ctx.query);
    for (const user of [noSub, expired]) {
      const res = await api('POST', '/api/bookings', { token: user.token, body: { schedule_id: slot.scheduleId } });
      assert.equal(res.status, 409);
      assert.equal(res.body.code, 'NO_SUBSCRIPTION');
    }
  });

  test('subscription ending before the class date → rejected', async () => {
    const user = await member({ endOffsetDays: 2 });
    const slot = await createClass(ctx.query, { dayOffset: 5 });
    const res = await api('POST', '/api/bookings', { token: user.token, body: { schedule_id: slot.scheduleId } });
    assert.equal(res.body.code, 'SUBSCRIPTION_ENDS_BEFORE_CLASS');
  });

  test('wrong subscription type → ACCESS_DENIED', async () => {
    const gymOnly = await member({ accessType: 'gym' });
    const groupOnly = await member({ accessType: 'group' });
    const group = await createClass(ctx.query, { category: 'group' });
    const personal = await createClass(ctx.query, { category: 'personal', capacity: 1 });
    assert.equal((await api('POST', '/api/bookings', { token: gymOnly.token, body: { schedule_id: group.scheduleId } })).body.code, 'ACCESS_DENIED');
    assert.equal((await api('POST', '/api/bookings', { token: groupOnly.token, body: { schedule_id: personal.scheduleId } })).body.code, 'ACCESS_DENIED');
  });

  test('past class and inactive service cannot be booked', async () => {
    const user = await member();
    const past = await createClass(ctx.query, { dayOffset: -1 });
    const inactive = await createClass(ctx.query, { status: 'inactive' });
    assert.equal((await api('POST', '/api/bookings', { token: user.token, body: { schedule_id: past.scheduleId } })).body.code, 'CLASS_STARTED');
    assert.equal((await api('POST', '/api/bookings', { token: user.token, body: { schedule_id: inactive.scheduleId } })).body.code, 'CLASS_INACTIVE');
  });

  test('beyond booking horizon → BEYOND_HORIZON', async () => {
    const user = await member({ endOffsetDays: 400 });
    const far = await createClass(ctx.query, { dayOffset: 200 });
    assert.equal((await api('POST', '/api/bookings', { token: user.token, body: { schedule_id: far.scheduleId } })).body.code, 'BEYOND_HORIZON');
  });

  test('cancellation frees the seat and allows re-booking', async () => {
    const slot = await createClass(ctx.query, { capacity: 1 });
    const user = await member();
    const other = await member();
    const booked = await api('POST', '/api/bookings', { token: user.token, body: { schedule_id: slot.scheduleId } });
    const cancel = await api('DELETE', `/api/bookings/${booked.body.id}`, { token: user.token });
    assert.equal(cancel.status, 200);
    assert.equal((await api('POST', '/api/bookings', { token: other.token, body: { schedule_id: slot.scheduleId } })).status, 201);
  });

  test('client cannot cancel another client booking', async () => {
    const slot = await createClass(ctx.query);
    const owner = await member();
    const attacker = await member();
    const booked = await api('POST', '/api/bookings', { token: owner.token, body: { schedule_id: slot.scheduleId } });
    const res = await api('DELETE', `/api/bookings/${booked.body.id}`, { token: attacker.token });
    assert.equal(res.status, 404);
  });

  test('concurrent booking of the last seat: exactly one succeeds', async () => {
    const slot = await createClass(ctx.query, { capacity: 1 });
    const users = await Promise.all(Array.from({ length: 8 }, () => member()));
    const results = await Promise.allSettled(
      users.map((user) => service.createBooking({ clientId: user.clientId, scheduleId: slot.scheduleId }))
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const full = results.filter((r) => r.status === 'rejected' && r.reason.code === 'CLASS_FULL');
    assert.equal(ok.length, 1);
    assert.equal(full.length, 7);
    const { rows } = await ctx.query(
      "select count(*)::int as n from bookings where schedule_id = $1 and status = 'active'",
      [slot.scheduleId]
    );
    assert.equal(rows[0].n, 1);
  });

  test('concurrent use of a single-visit pass: only one booking, pass expires', async () => {
    const user = await member({ planType: 'single', usageCount: 1, accessType: 'group' });
    const slots = await Promise.all([1, 2, 3, 4].map((d) => createClass(ctx.query, { dayOffset: d })));
    const results = await Promise.allSettled(
      slots.map((slot) => service.createBooking({ clientId: user.clientId, scheduleId: slot.scheduleId }))
    );
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const { rows } = await ctx.query('select status from subscriptions where client_id = $1', [user.clientId]);
    assert.equal(rows[0].status, 'expired');
  });

  test('invalid schedule id → 400, unknown → 404', async () => {
    const user = await member();
    assert.equal((await api('POST', '/api/bookings', { token: user.token, body: { schedule_id: 'abc' } })).status, 400);
    assert.equal((await api('POST', '/api/bookings', { token: user.token, body: { schedule_id: 999999 } })).status, 404);
  });
});
