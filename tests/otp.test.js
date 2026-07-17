/**
 * Тести генерації одноразових кодів (OTP).
 * Перевіряється лише чиста функція generateCode (без БД).
 * Запуск: node --test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateCode } from '../server/utils/otp.js';
import { OTP_LENGTH } from '../server/utils/constants.js';

test('generateCode: повертає рядок фіксованої довжини', () => {
  for (let i = 0; i < 200; i++) {
    assert.equal(generateCode().length, OTP_LENGTH);
  }
});

test('generateCode: містить лише цифри (нулі на початку зберігаються)', () => {
  const re = new RegExp(`^\\d{${OTP_LENGTH}}$`);
  for (let i = 0; i < 200; i++) {
    assert.match(generateCode(), re);
  }
});

test('generateCode: значення різняться (не константа)', () => {
  const set = new Set();
  for (let i = 0; i < 50; i++) set.add(generateCode());
  // З 50 генерацій хоча б кілька мають бути унікальними.
  assert.ok(set.size > 1, 'коди не мають бути однаковими');
});
