-- ============================================================
--  Міграція 021: Виправлення за результатами аудиту БД (АУДИТ_БД.md) — I.
--                created_at на основних таблицях, CHECK на статуси
--                (П3) та access_type, індекс trainer_client_notes(client_id)
--                (П8), розумні межі антропометрії.
--
--  Ідемпотентна й безпечна для автозапуску: CHECK-и додаються лише
--  за відсутності наявних значень поза словником (інакше NOTICE і крок
--  пропускається — як у міграції 020).
-- ============================================================

-- ─── 1. created_at на основних таблицях (аудит, аналітика) ────
ALTER TABLE public.users         ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.clients       ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.trainers      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.schedules     ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- payments: точний момент створення запису (П4) — окремо від бізнес-дати "date".
ALTER TABLE public.payments      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- bookings.created_at уже існує в проді (читається у trainers.js /me/notifications),
-- але додаємо тут ще раз ідемпотентно на випадок середовища без нього.
ALTER TABLE public.bookings      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- ─── 2. CHECK на статуси (П3) ──────────────────────────────────
-- Код оперує фіксованими словниками (SUBSCRIPTION_STATUS, BOOKING_STATUS,
-- PAYMENT_STATUS_COMPLETED-і-сусіди), але БД досі приймає будь-який рядок.
-- Перевіряємо наявні дані перед додаванням — щоб не впасти на "брудних" рядках.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.subscriptions
        WHERE status NOT IN ('active','paused','expired','cancelled')
    ) THEN
        RAISE NOTICE 'subscriptions_status_check ПРОПУЩЕНО: є значення status поза словником.';
    ELSIF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_status_check'
    ) THEN
        ALTER TABLE public.subscriptions
            ADD CONSTRAINT subscriptions_status_check
            CHECK (status IN ('active','paused','expired','cancelled'));
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.bookings WHERE status NOT IN ('active','cancelled')
    ) THEN
        RAISE NOTICE 'bookings_status_check ПРОПУЩЕНО: є значення status поза словником.';
    ELSIF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'bookings_status_check'
    ) THEN
        ALTER TABLE public.bookings
            ADD CONSTRAINT bookings_status_check
            CHECK (status IN ('active','cancelled'));
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.payments WHERE status NOT IN ('completed','pending','refunded')
    ) THEN
        RAISE NOTICE 'payments_status_check ПРОПУЩЕНО: є значення status поза словником.';
    ELSIF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'payments_status_check'
    ) THEN
        ALTER TABLE public.payments
            ADD CONSTRAINT payments_status_check
            CHECK (status IN ('completed','pending','refunded'));
    END IF;
END $$;

-- CHECK на access_type (фактичний словник, що використовує фронтенд/звіти).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.subscription_plans
        WHERE access_type NOT IN ('gym','gym_group','group','personal')
    ) THEN
        RAISE NOTICE 'subscription_plans_access_check ПРОПУЩЕНО: є значення access_type поза словником.';
    ELSIF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'subscription_plans_access_check'
    ) THEN
        ALTER TABLE public.subscription_plans
            ADD CONSTRAINT subscription_plans_access_check
            CHECK (access_type IN ('gym','gym_group','group','personal'));
    END IF;
END $$;

-- ─── 3. Індекс trainer_client_notes(client_id) (П8) ────────────
-- UNIQUE(trainer_id, client_id) покриває лише префікс trainer_id;
-- ендпоінт /client-notes-all/:clientId фільтрує за client_id окремо.
CREATE INDEX IF NOT EXISTS idx_trainer_notes_client
    ON public.trainer_client_notes(client_id);

-- ─── 4. Розумні межі антропометрії ─────────────────────────────
-- Захист від очевидних одруків (напр. вага 234 кг замість 23.4 кг), не
-- звужує легітимний діапазон значень. Діапазони навмисно широкі.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.client_anthropometry
        WHERE (weight IS NOT NULL AND NOT (weight > 0  AND weight < 400))
           OR (height IS NOT NULL AND NOT (height > 40 AND height < 260))
           OR (chest  IS NOT NULL AND NOT (chest  > 20 AND chest  < 250))
           OR (waist  IS NOT NULL AND NOT (waist  > 20 AND waist  < 250))
           OR (hips   IS NOT NULL AND NOT (hips   > 20 AND hips   < 250))
           OR (bicep  IS NOT NULL AND NOT (bicep  > 5  AND bicep  < 100))
           OR (thigh  IS NOT NULL AND NOT (thigh  > 10 AND thigh  < 150))
    ) THEN
        RAISE NOTICE 'client_anthropometry: розумні межі ПРОПУЩЕНО — є значення поза діапазоном, почистіть і перезапустіть.';
    ELSE
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'anthro_weight_check') THEN
            ALTER TABLE public.client_anthropometry ADD CONSTRAINT anthro_weight_check CHECK (weight IS NULL OR (weight > 0  AND weight < 400));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'anthro_height_check') THEN
            ALTER TABLE public.client_anthropometry ADD CONSTRAINT anthro_height_check CHECK (height IS NULL OR (height > 40 AND height < 260));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'anthro_chest_check') THEN
            ALTER TABLE public.client_anthropometry ADD CONSTRAINT anthro_chest_check CHECK (chest IS NULL OR (chest > 20 AND chest < 250));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'anthro_waist_check') THEN
            ALTER TABLE public.client_anthropometry ADD CONSTRAINT anthro_waist_check CHECK (waist IS NULL OR (waist > 20 AND waist < 250));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'anthro_hips_check') THEN
            ALTER TABLE public.client_anthropometry ADD CONSTRAINT anthro_hips_check CHECK (hips IS NULL OR (hips > 20 AND hips < 250));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'anthro_bicep_check') THEN
            ALTER TABLE public.client_anthropometry ADD CONSTRAINT anthro_bicep_check CHECK (bicep IS NULL OR (bicep > 5 AND bicep < 100));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'anthro_thigh_check') THEN
            ALTER TABLE public.client_anthropometry ADD CONSTRAINT anthro_thigh_check CHECK (thigh IS NULL OR (thigh > 10 AND thigh < 150));
        END IF;
    END IF;
END $$;
