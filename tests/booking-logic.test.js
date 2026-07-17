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
} from '../server/utils/booking-logic.js';

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

test('timeToMinutes: розбирає HH:MM і HH:MM:SS', () => {
  assert.equal(timeToMinutes('00:00'), 0);
  assert.equal(timeToMinutes('09:30'), 570);
  assert.equal(timeToMinutes('18:00:00'), 1080);
});
