CREATE TABLE IF NOT EXISTS public.subscription_plans (
    id            serial4 PRIMARY KEY,
    "name"        varchar(100) NOT NULL,
    description   text NULL,
    plan_type     varchar(20) NOT NULL DEFAULT 'subscription',
    access_type   varchar(100) NOT NULL,
    duration_days int4 NULL,
    usage_count   int4 NULL,
    price         numeric(10, 2) NOT NULL,
    status        varchar(20) NOT NULL DEFAULT 'active',
    CONSTRAINT subscription_plans_price_check CHECK (price > (0)::numeric),
    CONSTRAINT subscription_plans_type_check CHECK (
        (plan_type)::text = ANY (ARRAY['subscription','single']::text[])
    ),
    CONSTRAINT subscription_plans_status_check CHECK (
        (status)::text = ANY (ARRAY['active','inactive']::text[])
    )
);

ALTER TABLE public.subscriptions
ADD COLUMN IF NOT EXISTS plan_id int4 NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'subscriptions_plan_id_fkey'
    ) THEN
        ALTER TABLE public.subscriptions
        ADD CONSTRAINT subscriptions_plan_id_fkey
        FOREIGN KEY (plan_id)
        REFERENCES public.subscription_plans(id)
        ON DELETE SET NULL;
    END IF;
END $$;

INSERT INTO public.subscription_plans
    ("name", description, plan_type, access_type, duration_days, usage_count, price, status)
SELECT *
FROM (
    VALUES
        ('Безліміт "Зал"', 'Тренажерний зал без обмежень протягом 30 днів.', 'subscription', 'gym', 30, NULL, 1200.00, 'active'),
        ('Безліміт "Зал + Групові"', 'Тренажерний зал і групові тренування протягом 30 днів.', 'subscription', 'gym_group', 30, NULL, 1800.00, 'active'),
        ('Разове відвідування залу', 'Одне відвідування тренажерного залу.', 'single', 'gym', NULL, 1, 150.00, 'active'),
        ('Разове групове тренування', 'Одне групове тренування за розкладом.', 'single', 'group', NULL, 1, 200.00, 'active'),
        ('Разове персональне тренування', 'Одне індивідуальне заняття з тренером.', 'single', 'personal', NULL, 1, 500.00, 'active')
) AS defaults("name", description, plan_type, access_type, duration_days, usage_count, price, status)
WHERE NOT EXISTS (
    SELECT 1
    FROM public.subscription_plans existing
    WHERE existing.name = defaults.name
);
