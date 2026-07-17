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

/** Непорожній рядок із обрізанням пробілів і верхньою межею довжини. */
const str = (max) =>
  z.string({ invalid_type_error: 'Очікується текстове значення' })
    .trim()
    .min(1, 'Поле не може бути порожнім')
    .max(max, 'Значення задовге');

/** Пароль: рядок; межі — щоб відсікти порожнє та аномально велике. */
const password = z
  .string({ invalid_type_error: 'Пароль має бути рядком' })
  .min(1, 'Введіть пароль')
  .max(200, 'Пароль задовгий');

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
  password,
  phone: str(20),
});

export const registerVerifySchema = z.object({
  email: str(100),
  code,
});

export const registerResendSchema = z.object({
  email: str(100),
});

/** Оновлення профілю: усі поля опційні (обробник застосовує coalesce). */
export const profileUpdateSchema = z.object({
  name: z.string().trim().max(100, 'Ім’я задовге').optional(),
  phone: z.string().trim().max(20, 'Телефон задовгий').optional(),
  specialization: z.string().trim().max(100, 'Спеціалізація задовга').optional(),
});

/** Зміна пароля: поточний обов'язковий, новий — мінімум 6 символів. */
export const passwordChangeSchema = z.object({
  currentPassword: z
    .string({ invalid_type_error: 'Пароль має бути рядком' })
    .min(1, 'Введіть поточний пароль')
    .max(200, 'Пароль задовгий'),
  newPassword: z
    .string({ invalid_type_error: 'Пароль має бути рядком' })
    .min(6, 'Пароль має бути мінімум 6 символів')
    .max(200, 'Пароль задовгий'),
});
