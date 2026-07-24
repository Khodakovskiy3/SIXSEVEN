/**
 * Zod-схеми для тіл запитів авторизації.
 *
 * Принцип: валідувати ТИП і МЕЖІ, не змінюючи логіку прийому даних.
 * Тому email тут — просто непорожній рядок (а не .email()): службовий
 * акаунт входить під логіном "admin", який не є валідною email-адресою.
 * Точніші доменні перевірки (формат телефону, наявність усіх полів)
 * лишаються в самих обробниках.
 */

import { z } from 'zod';

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;
const LOWERCASE_PATTERN = /[a-zа-яїієґ]/;
const UPPERCASE_PATTERN = /[A-ZА-ЯЇІЄҐ]/;
const DIGIT_PATTERN = /\d/;

/** Непорожній рядок із обрізанням пробілів і верхньою межею довжини. */
const str = (max) =>
  z.string({ invalid_type_error: 'Очікується текстове значення' })
    .trim()
    .min(1, 'Поле не може бути порожнім')
    .max(max, 'Значення задовге');

/**
 * Пароль для входу: рядок; межі — щоб відсікти порожнє та аномально велике.
 * Вимоги до стійкості тут НЕ застосовуємо: інакше акаунти, створені до
 * посилення політики, не змогли б увійти, а текст помилки видавав би саму
 * політику ще до перевірки облікових даних.
 */
const password = z
  .string({ invalid_type_error: 'Пароль має бути рядком' })
  .min(1, 'Введіть пароль')
  .max(MAX_PASSWORD_LENGTH, 'Пароль задовгий');

/**
 * Пароль для встановлення (реєстрація, зміна пароля): мінімальна стійкість.
 * Перевіряємо на сервері, бо клієнтську перевірку легко обійти прямим
 * запитом до API.
 */
const strongPassword = z
  .string({ invalid_type_error: 'Пароль має бути рядком' })
  .min(MIN_PASSWORD_LENGTH, `Пароль має бути мінімум ${MIN_PASSWORD_LENGTH} символів`)
  .max(MAX_PASSWORD_LENGTH, 'Пароль задовгий')
  .refine((value) => LOWERCASE_PATTERN.test(value), {
    message: 'Пароль має містити малу літеру',
  })
  .refine((value) => UPPERCASE_PATTERN.test(value), {
    message: 'Пароль має містити велику літеру',
  })
  .refine((value) => DIGIT_PATTERN.test(value), {
    message: 'Пароль має містити цифру',
  });

/** Код підтвердження (OTP/2FA): короткий рядок. */
const code = z
  .string({ invalid_type_error: 'Код має бути рядком' })
  .trim()
  .min(1, 'Введіть код')
  .max(12, 'Невірний код');

export const loginSchema = z.object({
  email: str(100),
  password,
});

export const loginVerifySchema = z.object({
  email: str(100),
  code,
});

export const registerSchema = z.object({
  name: str(100),
  email: str(100),
  password: strongPassword,
  phone: str(20),
});

export const registerVerifySchema = z.object({
  email: str(100),
  code,
});

export const registerResendSchema = z.object({
  email: str(100),
});

export const loginResendSchema = z.object({
  email: str(100),
});

/** Оновлення профілю: усі поля опційні (обробник застосовує coalesce). */
export const profileUpdateSchema = z.object({
  name: z.string().trim().max(100, 'Ім’я задовге').optional(),
  phone: z.string().trim().max(20, 'Телефон задовгий').optional(),
  specialization: z.string().trim().max(100, 'Спеціалізація задовга').optional(),
});

/**
 * Зміна пароля: поточний обов'язковий, новий — за тими самими вимогами
 * стійкості, що й реєстрація (інакше політику можна обійти зміною пароля).
 */
export const passwordChangeSchema = z.object({
  currentPassword: z
    .string({ invalid_type_error: 'Пароль має бути рядком' })
    .min(1, 'Введіть поточний пароль')
    .max(MAX_PASSWORD_LENGTH, 'Пароль задовгий'),
  newPassword: strongPassword,
});
