-- Додає тривалість заняття у хвилинах до таблиці послуг.
-- Використовується для перевірки конфліктів у розкладі тренера:
-- нове заняття не може розпочинатися, поки не завершилось попереднє.
ALTER TABLE public.workouts
  ADD COLUMN IF NOT EXISTS duration_minutes integer NOT NULL DEFAULT 60
    CONSTRAINT workouts_duration_check CHECK (duration_minutes > 0);
