ALTER TABLE public.workouts
ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'active';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'workouts_status_check'
    ) THEN
        ALTER TABLE public.workouts
        ADD CONSTRAINT workouts_status_check
        CHECK ((status)::text = ANY (ARRAY['active','inactive']::text[]));
    END IF;
END $$;

INSERT INTO public.workouts ("name", description, max_clients, status)
SELECT *
FROM (
    VALUES
        ('Фітнес', 'Загальні тренування для зміцнення тіла та покращення фізичної форми.', 12, 'active'),
        ('Йога', 'Релаксація, гнучкість та розвиток балансу.', 8, 'active'),
        ('Персональні', 'Індивідуальні заняття з тренером під цілі клієнта.', 1, 'active'),
        ('Єдиноборства', 'Тренування з бойових мистецтв для різних рівнів підготовки.', 10, 'active')
) AS defaults("name", description, max_clients, status)
WHERE NOT EXISTS (
    SELECT 1
    FROM public.workouts existing
    WHERE existing.name = defaults.name
);
