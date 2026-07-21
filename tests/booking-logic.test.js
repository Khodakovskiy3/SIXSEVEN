/**
 * Тести бізнес-логіки бронювань і перекриття занять.
 * Запуск: node --test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  hasAvailableSlot,
  intervalsOverlap,
  timeToMinutes,
  isBookingAllowedForAccessType,
  bookingDeniedMessage,
} from '../server/utils/booking-logic.js';

// ── hasAvailableSlot ────────────────────────────────────────────────────────

test('hasAvailableSlot: є місце, коли броней менше за місткість', () => {
  assert.equal(hasAvailableSlot(0, 10), true);
  assert.equal(hasAvailableSlot(9, 10), true);
});

test('hasAvailableSlot: немає місця, коли група заповнена або переповнена', () => {
  assert.equal(hasAvailableSlot(10, 10), false);
  assert.equal(hasAvailableSlot(11, 10), false);
});

test('hasAvailableSlot: коректно працює з рядковими числами (як з БД)', () => {
  assert.equal(hasAvailableSlot('5', '10'), true);
  assert.equal(hasAvailableSlot('10', '10'), false);
});

// ── isBookingAllowedForAccessType ────────────────────────────────────────────

test('isBookingAllowedForAccessType: gym_group дозволяє групові заняття', () => {
  assert.equal(isBookingAllowedForAccessType('gym_group', 'group'), true);
});

test('isBookingAllowedForAccessType: gym_group забороняє персональні тренування', () => {
  assert.equal(isBookingAllowedForAccessType('gym_group', 'personal'), false);
});

test('isBookingAllowedForAccessType: group дозволяє групові заняття', () => {
  assert.equal(isBookingAllowedForAccessType('group', 'group'), true);
});

test('isBookingAllowedForAccessType: group забороняє персональні тренування', () => {
  assert.equal(isBookingAllowedForAccessType('group', 'personal'), false);
});

test('isBookingAllowedForAccessType: personal дозволяє персональні тренування', () => {
  assert.equal(isBookingAllowedForAccessType('personal', 'personal'), true);
});

test('isBookingAllowedForAccessType: personal забороняє групові заняття', () => {
  assert.equal(isBookingAllowedForAccessType('personal', 'group'), false);
});

test('isBookingAllowedForAccessType: gym забороняє будь-який запис на заняття', () => {
  assert.equal(isBookingAllowedForAccessType('gym', 'group'), false);
  assert.equal(isBookingAllowedForAccessType('gym', 'personal'), false);
});

test('isBookingAllowedForAccessType: null (план видалено) забороняє запис', () => {
  assert.equal(isBookingAllowedForAccessType(null, 'group'), false);
  assert.equal(isBookingAllowedForAccessType(null, 'personal'), false);
});

test('isBookingAllowedForAccessType: невідомий тип забороняє запис', () => {
  assert.equal(isBookingAllowedForAccessType('unknown', 'group'), false);
});

// ── bookingDeniedMessage ────────────────────────────────────────────────────

test('bookingDeniedMessage: gym — повідомлення про тренажерний зал', () => {
  const msg = bookingDeniedMessage('gym', 'group');
  assert.ok(msg.includes('тренажерного залу'), `Отримано: "${msg}"`);
});

test('bookingDeniedMessage: null — повідомлення звернутися до адміністратора', () => {
  const msg = bookingDeniedMessage(null, 'group');
  assert.ok(msg.includes('адміністратора'), `Отримано: "${msg}"`);
});

test('bookingDeniedMessage: gym_group + personal — про персональні тренування', () => {
  const msg = bookingDeniedMessage('gym_group', 'personal');
  assert.ok(msg.includes('персональні'), `Отримано: "${msg}"`);
});

test('bookingDeniedMessage: personal + group — про групові заняття', () => {
  const msg = bookingDeniedMessage('personal', 'group');
  assert.ok(msg.includes('групові'), `Отримано: "${msg}"`);
});

// ── intervalsOverlap ────────────────────────────────────────────────────────

test('intervalsOverlap: заняття, що накладаються, конфліктують', () => {
  // 10:00–11:00 і 10:30–11:30
  assert.equal(intervalsOverlap(600, 60, 630, 60), true);
});

test('intervalsOverlap: заняття «встик» не конфліктують', () => {
  // 10:00–11:00 і 11:00–12:00
  assert.equal(intervalsOverlap(600, 60, 660, 60), false);
});

test('intervalsOverlap: заняття, що не перетинаються, не конфліктують', () => {
  // 09:00–10:00 і 14:00–15:00
  assert.equal(intervalsOverlap(540, 60, 840, 60), false);
});

test('intervalsOverlap: одне заняття повністю всередині іншого', () => {
  // 10:00–12:00 і 10:30–11:00
  assert.equal(intervalsOverlap(600, 120, 630, 30), true);
});

// ── timeToMinutes ───────────────────────────────────────────────────────────

test('timeToMinutes: розбирає HH:MM і HH:MM:SS', () => {
  assert.equal(timeToMinutes('00:00'), 0);
  assert.equal(timeToMinutes('09:30'), 570);
  assert.equal(timeToMinutes('18:00:00'), 1080);
});
