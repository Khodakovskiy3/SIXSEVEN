/**
 * Zod-схема для запису антропометрії.
 *
 * Межі навмисно збігаються з CHECK-обмеженнями в db/schema.sql і міграції 021:
 * перевірка тут — не заміна БД, а перший рубіж, який дає користувачу зрозуміле
 * повідомлення замість помилки Postgres. Діапазони широкі: вони відсікають
 * очевидні одруки (вага 7567 кг), а не звужують легітимні значення.
 */

import { z } from 'zod';

const MAX_NOTE_LENGTH = 500;

/**
 * Поле виміру: порожнє значення означає «не вимірювали» (null), інакше —
 * число у заданих межах.
 *
 * Форма надсилає значення рядками, тож приводимо тип самі: Number('') === 0,
 * і без явної обробки порожнє поле збереглося б як нуль.
 *
 * @param {number} min — виключна нижня межа.
 * @param {number} max — виключна верхня межа.
 * @param {string} label — назва поля для повідомлення про помилку.
 * @param {string} unit — одиниці виміру для повідомлення.
 * @returns {import('zod').ZodTypeAny}
 */
const measure = (min, max, label, unit) =>
  z.preprocess(
    (value) => {
      if (value === '' || value === null || value === undefined) {
        return null;
      }
      return typeof value === 'string' ? Number(value.replace(',', '.')) : value;
    },
    z
      .number({ invalid_type_error: `${label}: введіть число` })
      .finite(`${label}: введіть число`)
      .gt(min, `${label}: значення має бути більшим за ${min} ${unit}`)
      .lt(max, `${label}: значення має бути меншим за ${max} ${unit}`)
      .nullable()
  );

/** Дата виміру: коректний день і не в майбутньому. */
const recordedAt = z
  .string({ invalid_type_error: 'Дата має бути рядком' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Некоректна дата виміру')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Некоректна дата виміру')
  .refine(
    // Порівнюємо рядки в ISO-форматі: так уникаємо розбіжності часових поясів,
    // через яку «сьогодні» на сервері й у клієнта може відрізнятися на день.
    (value) => value <= new Date().toISOString().slice(0, 10),
    'Дата виміру не може бути в майбутньому'
  )
  .optional();

export const anthropometryCreateSchema = z
  .object({
    recorded_at: recordedAt,
    weight: measure(0, 400, 'Вага', 'кг'),
    height: measure(40, 260, 'Зріст', 'см'),
    chest: measure(20, 250, 'Груди', 'см'),
    waist: measure(20, 250, 'Талія', 'см'),
    hips: measure(20, 250, 'Стегна', 'см'),
    bicep: measure(5, 100, 'Біцепс', 'см'),
    thigh: measure(10, 150, 'Стегно', 'см'),
    note: z.string().trim().max(MAX_NOTE_LENGTH, 'Нотатка задовга').default(''),
  })
  .refine(
    (data) =>
      [data.weight, data.height, data.chest, data.waist, data.hips, data.bicep, data.thigh]
        .some((value) => value !== null),
    { message: 'Заповніть хоча б одне поле виміру' }
  );
