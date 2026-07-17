-- Індекси продуктивності для часто-запитуваних колонок.
--
-- Досі за замовчуванням індексувалися лише первинні ключі та UNIQUE-обмеження.
-- Але аналітика керівника, розклад і бронювання постійно фільтрують за:
--   • bookings.schedule_id  — підрахунок зайнятих місць у занятті
--   • schedules.date        — вибірка розкладу на день/тиждень
--   • payments.date         — фінансові звіти за період
--   • visits.client_id      — історія відвідувань клієнта
--   • visits.visit_time     — аналітика відвідувань за період
-- Без індексів кожен такий запит робить повне сканування таблиці,
-- що на великих обсягах даних помітно гальмує.
--
-- Файл ідемпотентний: CREATE INDEX IF NOT EXISTS дозволяє повторний запуск
-- при кожному старті сервера. Всі колонки вже існують у схемі.

-- Підрахунок броней конкретного заняття (перевірка вільних місць).
CREATE INDEX IF NOT EXISTS idx_bookings_schedule ON bookings(schedule_id);

-- Вибірка розкладу за датою (клієнт/тренер/адмін розклад).
CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules(date);

-- Фінансові звіти та KPI за період.
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date);

-- Історія відвідувань клієнта.
CREATE INDEX IF NOT EXISTS idx_visits_client ON visits(client_id);

-- Аналітика відвідувань за проміжок часу.
CREATE INDEX IF NOT EXISTS idx_visits_time ON visits(visit_time);
