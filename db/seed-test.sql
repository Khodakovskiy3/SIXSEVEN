-- ============================================================
--  SEED: Тестові дані для кабінету менеджера OLIMP
--
--  Передумова: схема вже застосована (schema.sql + migrations/).
--  Запуск:
--    psql -U postgres -d sports_club_db -f db/seed-test.sql
--  або через npm:
--    PGPASSWORD=... psql -U postgres -h localhost -d sports_club_db -f db/seed-test.sql
--
--  Що створиться:
--    • 1 менеджер + 3 тренери + 8 клієнтів (усі паролі: admin123)
--    • Абонементи для кожного клієнта
--    • Розклад за останні 30 днів (2 заняття на день)
--    • Бронювання: ~60% клієнтів на кожне заняття
--    • Оплати: ~100 платежів рівномірно по 30 днях
--    • Відвідування: з кожного підтвердженого бронювання
--
--  Ідемпотентність:
--    • users         — ON CONFLICT (email) DO NOTHING
--    • trainers      — ON CONFLICT (user_id) DO NOTHING
--    • clients       — ON CONFLICT (user_id) DO NOTHING
--    • subscriptions — пропускає, якщо вже є активний абонемент
--    • schedules     — пропускає існуючі дати/тренер/тренування
--    • bookings      — ON CONFLICT (client_id, schedule_id) DO NOTHING
--    • payments/visits — append-only; повторний запуск дублює рядки
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. КОРИСТУВАЧІ
--    Хеш відповідає паролю: admin123
-- ─────────────────────────────────────────────────────────────

INSERT INTO users (name, email, password, role)
VALUES
  ('Адміністратор',    'admin',             '$2b$10$Yb1HzGzudDWNLUo1nDObrOtReERMM3vp8skaQ4Z4ecIsohymrOGwG', 'admin'),
  ('Роман Керівник',   'manager@olimp.ua',  '$2b$10$Yb1HzGzudDWNLUo1nDObrOtReERMM3vp8skaQ4Z4ecIsohymrOGwG', 'manager'),
  ('Анна Мельник',     'anna@olimp.ua',     '$2b$10$Yb1HzGzudDWNLUo1nDObrOtReERMM3vp8skaQ4Z4ecIsohymrOGwG', 'trainer'),
  ('Ігор Бондар',      'ihor@olimp.ua',     '$2b$10$Yb1HzGzudDWNLUo1nDObrOtReERMM3vp8skaQ4Z4ecIsohymrOGwG', 'trainer'),
  ('Максим Шевченко',  'maksym@olimp.ua',   '$2b$10$Yb1HzGzudDWNLUo1nDObrOtReERMM3vp8skaQ4Z4ecIsohymrOGwG', 'trainer'),
  ('Олена Коваль',     'olena@mail.com',    '$2b$10$Yb1HzGzudDWNLUo1nDObrOtReERMM3vp8skaQ4Z4ecIsohymrOGwG', 'client'),
  ('Дарина Павленко',  'daryna@mail.com',   '$2b$10$Yb1HzGzudDWNLUo1nDObrOtReERMM3vp8skaQ4Z4ecIsohymrOGwG', 'client'),
  ('Сергій Лисенко',   'serhii@mail.com',   '$2b$10$Yb1HzGzudDWNLUo1nDObrOtReERMM3vp8skaQ4Z4ecIsohymrOGwG', 'client'),
  ('Тетяна Романюк',   'tetiana@mail.com',  '$2b$10$Yb1HzGzudDWNLUo1nDObrOtReERMM3vp8skaQ4Z4ecIsohymrOGwG', 'client'),
  ('Василь Петренко',  'vasyl@mail.com',    '$2b$10$Yb1HzGzudDWNLUo1nDObrOtReERMM3vp8skaQ4Z4ecIsohymrOGwG', 'client'),
  ('Ірина Савченко',   'iryna@mail.com',    '$2b$10$Yb1HzGzudDWNLUo1nDObrOtReERMM3vp8skaQ4Z4ecIsohymrOGwG', 'client'),
  ('Микола Гриценко',  'mykola@mail.com',   '$2b$10$Yb1HzGzudDWNLUo1nDObrOtReERMM3vp8skaQ4Z4ecIsohymrOGwG', 'client'),
  ('Юлія Бойченко',    'yulia@mail.com',    '$2b$10$Yb1HzGzudDWNLUo1nDObrOtReERMM3vp8skaQ4Z4ecIsohymrOGwG', 'client')
ON CONFLICT (email) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 2. ТРЕНЕРИ
--    Спеціалізації містять точні назви занять — для seed-schedule.sql
-- ─────────────────────────────────────────────────────────────

INSERT INTO trainers (user_id, phone, specialization)
SELECT u.id, d.phone, d.spec
FROM (VALUES
  ('anna@olimp.ua',    '+380671000001', 'Йога, Фітнес'),
  ('ihor@olimp.ua',    '+380672000002', 'Єдиноборства, Фітнес'),
  ('maksym@olimp.ua',  '+380673000003', 'Персональні, Фітнес')
) AS d(email, phone, spec)
JOIN users u ON u.email = d.email
ON CONFLICT (user_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 3. КЛІЄНТИ
-- ─────────────────────────────────────────────────────────────

INSERT INTO clients (user_id, phone)
SELECT u.id, d.phone
FROM (VALUES
  ('olena@mail.com',   '+380670001001'),
  ('daryna@mail.com',  '+380670001002'),
  ('serhii@mail.com',  '+380670001003'),
  ('tetiana@mail.com', '+380670001004'),
  ('vasyl@mail.com',   '+380670001005'),
  ('iryna@mail.com',   '+380670001006'),
  ('mykola@mail.com',  '+380670001007'),
  ('yulia@mail.com',   '+380670001008')
) AS d(email, phone)
JOIN users u ON u.email = d.email
ON CONFLICT (user_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 4. АБОНЕМЕНТИ (по одному на кожного клієнта)
--    Пропускається, якщо у клієнта вже є активний абонемент
-- ─────────────────────────────────────────────────────────────

INSERT INTO subscriptions (client_id, plan_id, type, start_date, end_date, status)
SELECT
  c.id,
  sp.id,
  sp.access_type,
  current_date - interval '10 days',
  current_date + interval '20 days',
  'active'
FROM clients c
JOIN users u ON u.id = c.user_id
JOIN subscription_plans sp ON sp.name = CASE
  WHEN u.email IN ('olena@mail.com',  'daryna@mail.com',
                   'serhii@mail.com', 'tetiana@mail.com')
    THEN 'Безліміт "Зал + Групові"'
  WHEN u.email IN ('vasyl@mail.com', 'iryna@mail.com')
    THEN 'Безліміт "Зал"'
  WHEN u.email IN ('mykola@mail.com')
    THEN 'Разове персональне тренування'
  ELSE
    'Разове групове тренування'
END
WHERE NOT EXISTS (
  SELECT 1 FROM subscriptions ex
  WHERE ex.client_id = c.id AND ex.status = 'active'
);

-- ─────────────────────────────────────────────────────────────
-- 5. РОЗКЛАД — останні 30 днів (по 2 заняття на день)
--
--    Перший блок — основне заняття (чергування тренувань)
--    Другий блок — додаткове заняття (персональне/парне)
--    Пропускає дні, де вже є такий самий (тренер + тренування)
-- ─────────────────────────────────────────────────────────────

WITH
workout_seq AS (
  SELECT id,
         row_number() OVER (ORDER BY id) - 1 AS rn,
         count(*)     OVER ()                  AS cnt
  FROM workouts
  WHERE status = 'active'
),
trainer_seq AS (
  SELECT id,
         row_number() OVER (ORDER BY id) - 1 AS rn,
         count(*)     OVER ()                  AS cnt
  FROM trainers
),
day_range AS (
  SELECT generate_series(1, 30) AS d
)
INSERT INTO schedules (workout_id, trainer_id, date, time)
SELECT
  w.id,
  t.id,
  (current_date - dr.d * interval '1 day')::date,
  CASE dr.d % 3
    WHEN 0 THEN '09:00'::time
    WHEN 1 THEN '11:00'::time
    ELSE        '18:00'::time
  END
FROM day_range dr
CROSS JOIN (SELECT cnt FROM trainer_seq LIMIT 1) tc
CROSS JOIN (SELECT cnt FROM workout_seq LIMIT 1) wc
JOIN workout_seq  w ON w.rn = (dr.d % wc.cnt)
JOIN trainer_seq  t ON t.rn = (dr.d % tc.cnt)
WHERE NOT EXISTS (
  SELECT 1 FROM schedules ex
  WHERE ex.date       = (current_date - dr.d * interval '1 day')::date
    AND ex.workout_id = w.id
    AND ex.trainer_id = t.id
);

-- ─────────────────────────────────────────────────────────────
-- 6. БРОНЮВАННЯ
--    Кожен клієнт бронює ~60% занять (парність id + дня року)
-- ─────────────────────────────────────────────────────────────

INSERT INTO bookings (client_id, schedule_id, status)
SELECT DISTINCT c.id, s.id, 'active'
FROM schedules s
CROSS JOIN clients c
WHERE s.date >= current_date - interval '30 days'
  AND s.date <  current_date
  AND (c.id + date_part('doy', s.date)::int) % 5 != 0
ON CONFLICT (client_id, schedule_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 7. ОПЛАТИ — ~3–4 на день протягом 30 днів (~100 разом)
--
--    Логіка вибору (rn = порядковий номер клієнта 0..7):
--      (rn + день) % 3 != 0  — прибирає 1/3 комбінацій
--      (rn + день) % 8 < 5   — залишає 5/8 від решти
--    Сума варіюється ±10% від ціни плану
-- ─────────────────────────────────────────────────────────────

INSERT INTO payments (client_id, subscription_id, amount, date, status)
WITH
ranked_clients AS (
  SELECT
    c.id                                    AS cid,
    sub.id                                  AS sid,
    sp.price                                AS base_price,
    row_number() OVER (ORDER BY c.id) - 1  AS rn
  FROM clients c
  JOIN subscriptions sub ON sub.client_id = c.id AND sub.status = 'active'
  JOIN subscription_plans sp ON sp.id = sub.plan_id
),
day_series AS (
  SELECT generate_series(0, 29) AS d
)
SELECT
  rc.cid,
  rc.sid,
  ROUND(rc.base_price * (0.9 + (rc.rn + ds.d) % 3 * 0.1), 2)::numeric(10,2),
  (current_date - ds.d * interval '1 day')::date,
  'completed'
FROM day_series ds
JOIN ranked_clients rc
  ON (rc.rn + ds.d) % 3 != 0
 AND (rc.rn + ds.d) % 8 <  5;

-- ─────────────────────────────────────────────────────────────
-- 8. ВІДВІДУВАННЯ
--    З кожного підтвердженого бронювання — один візит
--    Час = дата заняття + час заняття + невеликий зсув
-- ─────────────────────────────────────────────────────────────

INSERT INTO visits (client_id, subscription_id, visit_time, schedule_id)
SELECT
  b.client_id,
  sub.id,
  (s.date + s.time + ((b.client_id % 10) * interval '5 minutes')),
  s.id
FROM bookings b
JOIN schedules s ON s.id = b.schedule_id
LEFT JOIN subscriptions sub
  ON sub.client_id = b.client_id AND sub.status = 'active'
WHERE s.date >= current_date - interval '30 days'
  AND s.date <  current_date
  AND b.status = 'active';

-- ─────────────────────────────────────────────────────────────
-- 9. ОГОЛОШЕННЯ (розсилки адміністратора)
--    Ідемпотентність: пропускає, якщо оголошення з таким subject вже є
-- ─────────────────────────────────────────────────────────────

INSERT INTO messages (subject, body, audience, status, send_date)
SELECT d.subject, d.body, d.audience, d.status, d.send_date
FROM (VALUES
  ('Оновлений розклад групових занять',
   'З понеділка додаємо ранкові групові тренування о 08:00. Чекаємо всіх!',
   'clients', 'sent', current_date - 3),
  ('Технічні роботи в басейні',
   'У суботу басейн зачинено через планове обслуговування. Вибачте за незручності.',
   'all', 'sent', current_date - 1),
  ('Нарада тренерського складу',
   'У пʼятницю о 17:00 збір усіх тренерів у залі №2.',
   'trainers', 'planned', current_date + 2)
) AS d(subject, body, audience, status, send_date)
WHERE NOT EXISTS (
  SELECT 1 FROM messages ex WHERE ex.subject = d.subject
);

-- ─────────────────────────────────────────────────────────────
-- 10. ЧАТ «гість ↔ адміністратор» (демо-діалоги)
--    Діалоги ідентифікуються токеном; повторний запуск не дублює.
-- ─────────────────────────────────────────────────────────────

INSERT INTO chat_conversations (guest_token, guest_name)
VALUES
  ('seed-guest-0001', 'Гість (демо 1)'),
  ('seed-guest-0002', 'Гість (демо 2)')
ON CONFLICT (guest_token) DO NOTHING;

INSERT INTO chat_messages (conversation_id, sender, body, read_by_admin)
SELECT c.id, d.sender, d.body, d.read_by_admin
FROM (VALUES
  ('seed-guest-0001', 'guest', 'Доброго дня! Скільки коштує разове відвідування залу?', true),
  ('seed-guest-0001', 'admin', 'Вітаємо! Разове відвідування — 150 грн.', true),
  ('seed-guest-0001', 'guest', 'Дякую, а є ранкові групові заняття?', false),
  ('seed-guest-0002', 'guest', 'Чи можна заморозити абонемент на тиждень?', false)
) AS d(token, sender, body, read_by_admin)
JOIN chat_conversations c ON c.guest_token = d.token
WHERE NOT EXISTS (
  SELECT 1 FROM chat_messages ex
  WHERE ex.conversation_id = c.id AND ex.body = d.body
);

COMMIT;

-- ─────────────────────────────────────────────────────────────
-- ПІДСУМКОВА ПЕРЕВІРКА (виводиться після виконання)
-- ─────────────────────────────────────────────────────────────

SELECT
  (SELECT count(*)                FROM users)              AS users_total,
  (SELECT count(*)                FROM trainers)           AS trainers,
  (SELECT count(*)                FROM clients)            AS clients,
  (SELECT count(*)                FROM workouts)           AS workouts,
  (SELECT count(*)                FROM subscription_plans) AS sub_plans,
  (SELECT count(*)                FROM subscriptions
   WHERE status = 'active')                                AS active_subs,
  (SELECT count(*)                FROM schedules
   WHERE date < current_date
     AND date >= current_date - 30)                        AS past_schedules,
  (SELECT count(*)                FROM bookings)           AS bookings,
  (SELECT count(*)                FROM payments
   WHERE date >= current_date - 30)                        AS payments_30d,
  (SELECT coalesce(sum(amount),0) FROM payments
   WHERE date >= current_date - 30)                        AS revenue_30d,
  (SELECT count(*)                FROM visits
   WHERE visit_time >= current_date - 30)                  AS visits_30d,
  (SELECT count(*)                FROM messages)           AS announcements,
  (SELECT count(*)                FROM chat_conversations) AS chat_dialogs,
  (SELECT count(*)                FROM chat_messages)      AS chat_messages;
