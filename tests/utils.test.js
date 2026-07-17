/**
 * Тести спільних фронтенд-хелперів (public/js/utils.js).
 * Найважливіше — escapeHtml, від якого залежить захист від XSS.
 * Запуск: node --test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  escapeHtml,
  getInitials,
  getAvatarColor,
  formatMoney,
  AVATAR_PALETTE,
} from '../public/js/utils.js';

test('escapeHtml: екранує небезпечні символи, включно з лапками', () => {
  assert.equal(
    escapeHtml('<script>alert("x")</script>'),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
  );
  assert.equal(escapeHtml(`O'Brien`), 'O&#039;Brien');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
});

test('escapeHtml: запобігає виходу зі значення HTML-атрибута', () => {
  // Класична атака: лапка закриває атрибут і додає обробник події.
  const payload = '" onmouseover="alert(1)';
  const escaped = escapeHtml(payload);
  assert.ok(!escaped.includes('"'), 'подвійні лапки мають бути екрановані');
});

test('escapeHtml: не кидає помилку на не-рядках', () => {
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(null), 'null');
  assert.equal(escapeHtml(42), '42');
});

test('getInitials: два слова — перша+остання літери', () => {
  assert.equal(getInitials('Максим Шевченко'), 'МШ');
  assert.equal(getInitials('Анна Іванівна Коваль'), 'АК');
});

test('getInitials: одне слово — перші дві літери', () => {
  assert.equal(getInitials('trener1'), 'TR');
});

test('getAvatarColor: детермінований — те саме ім’я дає той самий колір', () => {
  assert.equal(getAvatarColor('Олена'), getAvatarColor('Олена'));
  assert.ok(AVATAR_PALETTE.includes(getAvatarColor('Олена')));
});

test('formatMoney: форматує суму у гривнях без копійок', () => {
  assert.match(formatMoney(1800), /1\s?800/);
  assert.ok(formatMoney(1800).endsWith('грн'));
  assert.match(formatMoney(0), /^0/);
});
