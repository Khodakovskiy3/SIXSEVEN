-- ============================================================
--  Міграція 020: Покращення схеми — індекси, унікальність, timestamptz,
--                збереження історії оплат, NOT NULL для статусів,
--                регістронезалежний email, складений PK notification_reads,
--                прибирання протермінованих OTP-записів.
--
--  Файл ідемпотентний і БЕЗПЕЧНИЙ для автозапуску: жоден крок не кидає
--  помилку на наявних даних. UNIQUE-обмеження додаються лише тоді, коли
--  дублікатів немає (інакше крок пропускається з NOTICE), тому сервер
--  стартує навіть за «брудних» даних — їх можна почистити й перезапустити.
-- ============================================================

-- ─── 1. Прибрати дубль-індекс ─────────────────────────────────
-- email уже покритий UNIQUE-обмеженням pending_registrations_email_key,
-- тож окремий btree-індекс лише дублює його й уповільнює вставки.
DROP INDEX IF EXISTS public.idx_pending_registrations_email;

-- ─── 2. Індекси на зовнішніх ключах ───────────────────────────
-- PostgreSQL не створює індекси на FK автоматично. Без них JOIN-и та
-- звіти (reports.js) сканують таблиці повністю. bookings.client_id
-- пропущено навмисно — його вже покриває префікс UNIQUE(client_id, schedule_id).
CREATE INDEX IF NOT EXISTS idx_payments_client       ON public.payments(client_id);
CREATE INDEX IF NOT EXISTS idx_payments_subscription ON public.payments(subscription_id);
CREATE INDEX IF NOT EXISTS idx_payments_date         ON public.payments(date);
CREATE INDEX IF NOT EXISTS idx_subscriptions_client  ON public.subscriptions(client_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan    ON public.subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_bookings_schedule     ON public.bookings(schedule_id);
CREATE INDEX IF NOT EXISTS idx_schedules_workout     ON public.schedules(workout_id);
CREATE INDEX IF NOT EXISTS idx_schedules_trainer     ON public.schedules(trainer_id);
CREATE INDEX IF NOT EXISTS idx_schedules_date_time   ON public.schedules(date, "time");
CREATE INDEX IF NOT EXISTS idx_visits_client         ON public.visits(client_id);
CREATE INDEX IF NOT EXISTS idx_visits_subscription   ON public.visits(subscription_id);

-- ─── 3. Захист від дублікатів (UNIQUE лише за відсутності дублів) ───
-- Однаковий слот розкладу (та сама послуга, тренер, дата й час) — це помилка
-- вводу, а не валідний стан. NULLS NOT DISTINCT обов'язковий: без нього
-- звичайний UNIQUE вважає NULL-и різними, і заняття БЕЗ тренера
-- (trainer_id IS NULL) можна було б дублювати безмежно.
DO $$
BEGIN
    -- Прибираємо обмеження у старій формі (NULLS DISTINCT), якщо його встигла
    -- створити попередня версія цієї міграції: воно не ловить дублі без тренера.
    IF EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_index i ON i.indexrelid = c.conindid
        WHERE c.conname = 'schedules_slot_unique'
          AND i.indnullsnotdistinct = false
    ) THEN
        ALTER TABLE public.schedules DROP CONSTRAINT schedules_slot_unique;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.schedules
        GROUP BY workout_id, trainer_id, date, "time"
        HAVING count(*) > 1
    ) THEN
        RAISE NOTICE 'schedules_slot_unique ПРОПУЩЕНО: у розкладі є дублікати слотів — почистіть і перезапустіть.';
    ELSIF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'schedules_slot_unique'
    ) THEN
        ALTER TABLE public.schedules
            ADD CONSTRAINT schedules_slot_unique
            UNIQUE NULLS NOT DISTINCT (workout_id, trainer_id, date, "time");
    END IF;
END $$;

-- Унікальні назви послуг.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.workouts GROUP BY name HAVING count(*) > 1
    ) THEN
        RAISE NOTICE 'workouts_name_key ПРОПУЩЕНО: є послуги з однаковою назвою.';
    ELSIF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'workouts_name_key'
    ) THEN
        ALTER TABLE public.workouts ADD CONSTRAINT workouts_name_key UNIQUE (name);
    END IF;
END $$;

-- Унікальні назви абонементів/планів.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.subscription_plans GROUP BY name HAVING count(*) > 1
    ) THEN
        RAISE NOTICE 'subscription_plans_name_key ПРОПУЩЕНО: є плани з однаковою назвою.';
    ELSIF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'subscription_plans_name_key'
    ) THEN
        ALTER TABLE public.subscription_plans
            ADD CONSTRAINT subscription_plans_name_key UNIQUE (name);
    END IF;
END $$;

-- ─── 4. Оплати переживають видалення клієнта ──────────────────
-- Раніше payments.client_id був NOT NULL без ON DELETE, тож оплати
-- доводилося видаляти вручну (втрачаючи фінансову історію). Робимо колонку
-- nullable і додаємо ON DELETE SET NULL: при видаленні клієнта запис оплати
-- лишається у звітах, лише «відв'язується» від клієнта.
ALTER TABLE public.payments ALTER COLUMN client_id DROP NOT NULL;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_client_id_fkey;
ALTER TABLE public.payments
    ADD CONSTRAINT payments_client_id_fkey FOREIGN KEY (client_id)
    REFERENCES public.clients(id) ON DELETE SET NULL;

-- ─── 5. Прибрати мертву колонку visits.schedule_id ────────────
-- Колонку додала міграція 001, але код ніколи її не заповнював (insert у
-- visits.js ставить лише client_id + subscription_id). Присутність на
-- конкретному занятті тепер виводиться з бронювання (bookings) і часу заняття,
-- тож колонка й пов'язаний FK зайві.
ALTER TABLE public.visits DROP COLUMN IF EXISTS schedule_id;

-- ─── 6. timestamp → timestamptz ───────────────────────────────
-- Старі таблиці зберігали час без зони, новіші — з зоною. Уніфікуємо на
-- timestamptz. Наївне значення інтерпретуємо в поточній зоні сесії
-- (current_setting('TimeZone')) — саме в ній його записали now()/CURRENT_TIMESTAMP,
-- тож момент часу зберігається без зсуву. Крок спрацьовує лише для колонок,
-- які ще «без зони», тому повторний запуск нічого не ламає.
DO $$
DECLARE
    col record;
BEGIN
    FOR col IN
        SELECT t.table_name, t.column_name
        FROM (VALUES
            ('chat_conversations', 'created_at'),
            ('chat_conversations', 'updated_at'),
            ('chat_conversations', 'closed_at'),
            ('chat_messages',      'created_at'),
            ('email_codes',        'expires_at'),
            ('email_codes',        'created_at'),
            ('messages',           'created_at'),
            ('notification_reads', 'read_at'),
            ('pending_registrations', 'expires_at'),
            ('pending_registrations', 'created_at'),
            ('visits',             'visit_time')
        ) AS t(table_name, column_name)
    LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = col.table_name
              AND column_name = col.column_name
              AND data_type = 'timestamp without time zone'
        ) THEN
            EXECUTE format(
                'ALTER TABLE public.%I ALTER COLUMN %I TYPE timestamptz '
                'USING %I AT TIME ZONE current_setting(''TimeZone'')',
                col.table_name, col.column_name, col.column_name
            );
        END IF;
    END LOOP;
END $$;

-- ─── 7. NOT NULL для колонок зі стабільним дефолтом ───────────
-- Статуси й дати мають дефолти, але були nullable: рядок зі status IS NULL
-- випадав з усіх фільтрів виду where status = '...'. Спершу добиваємо
-- наявні NULL значеннями за замовчуванням, потім забороняємо NULL.
UPDATE public.subscriptions SET status = 'active'    WHERE status IS NULL;
UPDATE public.bookings      SET status = 'active'    WHERE status IS NULL;
UPDATE public.payments      SET status = 'completed' WHERE status IS NULL;
UPDATE public.payments      SET "date" = CURRENT_DATE WHERE "date" IS NULL;
UPDATE public.visits        SET visit_time = now()   WHERE visit_time IS NULL;

ALTER TABLE public.subscriptions ALTER COLUMN status     SET NOT NULL;
ALTER TABLE public.bookings      ALTER COLUMN status     SET NOT NULL;
ALTER TABLE public.payments      ALTER COLUMN status     SET NOT NULL;
ALTER TABLE public.payments      ALTER COLUMN "date"     SET NOT NULL;
ALTER TABLE public.visits        ALTER COLUMN visit_time SET NOT NULL;

-- ─── 8. Регістронезалежна унікальність email ──────────────────
-- users_email_key чутливий до регістру: 'Ivan@x.ua' та 'ivan@x.ua' вважалися
-- різними. Код (auth.js) завжди шукає за lower(email), тож нормалізуємо
-- наявні рядки й закріплюємо правило функціональним унікальним індексом.
-- За колізії (два email, що відрізняються лише регістром) крок пропускається.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.users
        GROUP BY lower(email) HAVING count(*) > 1
    ) THEN
        RAISE NOTICE 'users_email_lower_key ПРОПУЩЕНО: є email, що відрізняються лише регістром — розв''яжіть конфлікт і перезапустіть.';
    ELSE
        UPDATE public.users SET email = lower(email) WHERE email <> lower(email);
        IF NOT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public' AND indexname = 'users_email_lower_key'
        ) THEN
            CREATE UNIQUE INDEX users_email_lower_key ON public.users (lower(email));
        END IF;
    END IF;
END $$;

-- ─── 9. Складений PK для notification_reads ───────────────────
-- Сурогатний id ніде не використовувався, а пара (message_id, user_id) і так
-- унікальна. Переходимо на складений PK — як у message_recipients, мінус
-- зайва колонка та зайвий індекс під UNIQUE-обмеження.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'notification_reads'
          AND column_name = 'id'
    ) THEN
        ALTER TABLE public.notification_reads DROP CONSTRAINT IF EXISTS notification_reads_pkey;
        ALTER TABLE public.notification_reads DROP CONSTRAINT IF EXISTS notification_reads_unique;
        ALTER TABLE public.notification_reads DROP COLUMN id;
        ALTER TABLE public.notification_reads
            ADD CONSTRAINT notification_reads_pkey PRIMARY KEY (message_id, user_id);
    END IF;
END $$;

-- ─── 10. Прибирання протермінованих OTP-записів ───────────────
-- migrate.js виконує всі файли при кожному старті сервера, тож цей DELETE
-- слугує регулярним прибиранням: коди й недопідтверджені реєстрації, що
-- протермінувалися понад добу тому, вже нікому не потрібні (доба запасу —
-- щоб користувач ще міг отримати зрозумілу помилку «код протермінований»).
DELETE FROM public.email_codes
 WHERE expires_at < now() - interval '1 day';
DELETE FROM public.pending_registrations
 WHERE expires_at < now() - interval '1 day';
