-- Крок 1: Додати колонку (якщо ще не додано)
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS image_url text;

-- Крок 2: Встановити шляхи до фото
UPDATE workouts SET image_url = '/assets/home/svc-fitness.webp'
  WHERE lower(name) LIKE '%фітнес%';

UPDATE workouts SET image_url = '/assets/home/svc-yoga.webp'
  WHERE lower(name) LIKE '%йога%';

UPDATE workouts SET image_url = '/assets/home/svc-personal.webp'
  WHERE lower(name) LIKE '%персональн%';

UPDATE workouts SET image_url = '/assets/home/svc-fighting.webp'
  WHERE lower(name) LIKE '%єдиноборств%';

-- Перевірка:
SELECT id, name, image_url FROM workouts ORDER BY id;
