-- Додає поле image_url до таблиці workouts
-- Адмін може вказати URL зображення при створенні/редагуванні послуги.
-- Якщо URL не вказано — фронтенд показує CSS-градієнт як fallback.

ALTER TABLE workouts
  ADD COLUMN IF NOT EXISTS image_url text;
