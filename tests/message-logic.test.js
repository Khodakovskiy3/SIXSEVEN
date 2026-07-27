/**
 * Тести бізнес-логіки повідомлень (розсилок).
 * Запуск: node --test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeRecipientIds,
  normalizeAudience,
  normalizeStatus,
  resolveAudience,
  audienceToRoleFilter,
  validateMessageFields,
  VALID_AUDIENCES,
  VALID_STATUSES,
} from '../server/utils/message-logic.js';

// ── normalizeRecipientIds ────────────────────────────────────────────────────

test('normalizeRecipientIds: повертає порожній масив коли передано не масив', () => {
  assert.deepEqual(normalizeRecipientIds(null), []);
  assert.deepEqual(normalizeRecipientIds(undefined), []);
  assert.deepEqual(normalizeRecipientIds('5'), []);
  assert.deepEqual(normalizeRecipientIds(42), []);
  assert.deepEqual(normalizeRecipientIds({}), []);
});

test('normalizeRecipientIds: повертає порожній масив для порожнього масиву', () => {
  assert.deepEqual(normalizeRecipientIds([]), []);
});

test('normalizeRecipientIds: конвертує рядкові числа в числа', () => {
  assert.deepEqual(normalizeRecipientIds(['1', '2', '3']), [1, 2, 3]);
});

test('normalizeRecipientIds: відкидає нуль і від\'ємні значення', () => {
  assert.deepEqual(normalizeRecipientIds([0, -1, -100]), []);
});

test('normalizeRecipientIds: відкидає NaN та нечислові рядки', () => {
  assert.deepEqual(normalizeRecipientIds(['abc', null, undefined, NaN]), []);
});

test('normalizeRecipientIds: дедублікує ідентифікатори', () => {
  const result = normalizeRecipientIds([1, 2, 2, 3, 1]);
  assert.deepEqual(result, [1, 2, 3]);
});

test('normalizeRecipientIds: обробляє змішані валідні та невалідні значення', () => {
  assert.deepEqual(normalizeRecipientIds([1, 'abc', 0, 3, -5, '7']), [1, 3, 7]);
});

// ── normalizeAudience ────────────────────────────────────────────────────────

test('normalizeAudience: приймає всі допустимі значення', () => {
  for (const a of VALID_AUDIENCES) {
    assert.equal(normalizeAudience(a), a);
  }
});

test('normalizeAudience: невідоме значення повертає clients', () => {
  assert.equal(normalizeAudience('unknown'), 'clients');
  assert.equal(normalizeAudience(''), 'clients');
  assert.equal(normalizeAudience(null), 'clients');
  assert.equal(normalizeAudience(undefined), 'clients');
});

test('normalizeAudience: custom не є допустимим вхідним значенням', () => {
  // 'custom' встановлюється лише автоматично через recipient_ids
  assert.equal(normalizeAudience('custom'), 'clients');
});

// ── normalizeStatus ──────────────────────────────────────────────────────────

test('normalizeStatus: приймає всі допустимі значення', () => {
  for (const s of VALID_STATUSES) {
    assert.equal(normalizeStatus(s), s);
  }
});

test('normalizeStatus: невідоме значення повертає sent', () => {
  assert.equal(normalizeStatus('draft'), 'sent');
  assert.equal(normalizeStatus(''), 'sent');
  assert.equal(normalizeStatus(null), 'sent');
  assert.equal(normalizeStatus(undefined), 'sent');
});

// ── resolveAudience ──────────────────────────────────────────────────────────

test('resolveAudience: без отримувачів нормалізує вхідну аудиторію', () => {
  assert.equal(resolveAudience([], 'clients'), 'clients');
  assert.equal(resolveAudience([], 'trainers'), 'trainers');
  assert.equal(resolveAudience([], 'all'), 'all');
});

test('resolveAudience: з отримувачами завжди повертає custom', () => {
  assert.equal(resolveAudience([1, 2], 'clients'), 'custom');
  assert.equal(resolveAudience([5], 'all'), 'custom');
  assert.equal(resolveAudience([3], undefined), 'custom');
});

test('resolveAudience: без отримувачів і невалідна аудиторія → clients', () => {
  assert.equal(resolveAudience([], 'garbage'), 'clients');
  assert.equal(resolveAudience([], null), 'clients');
});

// ── audienceToRoleFilter ─────────────────────────────────────────────────────

test('audienceToRoleFilter: clients → фільтр за role client', () => {
  assert.equal(audienceToRoleFilter('clients'), `role = 'client'`);
});

test('audienceToRoleFilter: trainers → фільтр за role trainer', () => {
  assert.equal(audienceToRoleFilter('trainers'), `role = 'trainer'`);
});

test('audienceToRoleFilter: admins → фільтр за role admin', () => {
  assert.equal(audienceToRoleFilter('admins'), `role = 'admin'`);
});

test('audienceToRoleFilter: all → фільтр за всіма ролями', () => {
  const filter = audienceToRoleFilter('all');
  assert.ok(filter.includes('client'), `Фільтр: "${filter}"`);
  assert.ok(filter.includes('trainer'), `Фільтр: "${filter}"`);
  assert.ok(filter.includes('admin'), `Фільтр: "${filter}"`);
  assert.ok(filter.includes('manager'), `Фільтр: "${filter}"`);
});

test('audienceToRoleFilter: custom → null (БД-запит не потрібен)', () => {
  assert.equal(audienceToRoleFilter('custom'), null);
});

test('audienceToRoleFilter: невідоме значення → null', () => {
  assert.equal(audienceToRoleFilter('garbage'), null);
  assert.equal(audienceToRoleFilter(undefined), null);
});

// ── validateMessageFields ────────────────────────────────────────────────────

test('validateMessageFields: валідне sent-повідомлення без дати проходить', () => {
  assert.equal(validateMessageFields({ subject: 'Тест', status: 'sent' }), null);
});

test('validateMessageFields: валідне planned-повідомлення з датою і часом проходить', () => {
  assert.equal(
    validateMessageFields({ subject: 'Акція', status: 'planned', send_date: '2025-12-01', send_time: '10:00' }),
    null
  );
});

test('validateMessageFields: відсутній subject повертає помилку', () => {
  const err = validateMessageFields({ status: 'sent' });
  assert.ok(err, 'Повинна бути помилка');
  assert.ok(err.toLowerCase().includes('subject'), `Отримано: "${err}"`);
});

test('validateMessageFields: порожній subject повертає помилку', () => {
  const err = validateMessageFields({ subject: '   ', status: 'sent' });
  assert.ok(err, 'Повинна бути помилка');
});

test('validateMessageFields: planned без send_date повертає помилку', () => {
  const err = validateMessageFields({ subject: 'Тест', status: 'planned', send_time: '10:00' });
  assert.ok(err, 'Повинна бути помилка');
  assert.ok(err.includes('дату'), `Отримано: "${err}"`);
});

test('validateMessageFields: planned без send_time повертає помилку', () => {
  const err = validateMessageFields({ subject: 'Тест', status: 'planned', send_date: '2025-12-01' });
  assert.ok(err, 'Повинна бути помилка');
});

test('validateMessageFields: planned без дати і часу повертає помилку', () => {
  const err = validateMessageFields({ subject: 'Тест', status: 'planned' });
  assert.ok(err, 'Повинна бути помилка');
});

test('validateMessageFields: невалідний status трактується як sent (без вимоги дати)', () => {
  // normalizeStatus('garbage') => 'sent', тому дата не потрібна
  assert.equal(validateMessageFields({ subject: 'Тест', status: 'garbage' }), null);
});
