-- ============================================================
--  СИКСЕВЕН — Схема бази даних спортивного клубу (PostgreSQL)
--  Автоматизована система: тренування, розклад, членство.
--
--  Цей файл — точна копія реальної схеми бази sports_club_db.
--  Призначення: довідка та відтворення БД на новому середовищі.
--
--  ⚠️ ЯКЩО ТАБЛИЦІ ВЖЕ ІСНУЮТЬ — НЕ ЗАПУСКАЙТЕ цей файл повторно:
--     розкоментовані DROP-и видалять усі дані. Блок DROP лишено
--     закоментованим саме з міркувань безпеки.
--
--  Виконати на чистій базі:
--    • npm run db:setup
--    • або у DBeaver: SQL-редактор → Execute SQL Script (Alt+X).
-- ============================================================

-- ─── (НЕБЕЗПЕЧНО) Очищення. Розкоментуйте лише для повного перестворення ───
-- DROP TABLE IF EXISTS visits        CASCADE;
-- DROP TABLE IF EXISTS payments      CASCADE;
-- DROP TABLE IF EXISTS bookings      CASCADE;
-- DROP TABLE IF EXISTS subscriptions CASCADE;
-- DROP TABLE IF EXISTS schedules     CASCADE;
-- DROP TABLE IF EXISTS workouts      CASCADE;
-- DROP TABLE IF EXISTS trainers      CASCADE;
-- DROP TABLE IF EXISTS clients       CASCADE;
-- DROP TABLE IF EXISTS users         CASCADE;

-- ─── Користувачі (загальні облікові записи) ───────────────────
CREATE TABLE IF NOT EXISTS public.users (
    id       serial4 PRIMARY KEY,
    "name"   varchar(100) NOT NULL,
    email    varchar(100) NOT NULL,
    "password" varchar(255) NOT NULL,            -- bcrypt-хеш
    "role"   varchar(20) NOT NULL,
    CONSTRAINT users_email_key UNIQUE (email),
    CONSTRAINT users_role_check CHECK (
        (role)::text = ANY (ARRAY['admin','trainer','client','manager']::text[])
    )
);

-- ─── Типи тренувань ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workouts (
    id          serial4 PRIMARY KEY,
    "name"      varchar(100) NOT NULL,
    description text NULL,
    max_clients int4 NOT NULL,
    status      varchar(20) NOT NULL DEFAULT 'active',
    CONSTRAINT workouts_max_clients_check CHECK (max_clients > 0),
    CONSTRAINT workouts_status_check CHECK (
        (status)::text = ANY (ARRAY['active','inactive']::text[])
    )
);

-- ─── Клієнти (доменна сутність ролі client) ───────────────────
CREATE TABLE IF NOT EXISTS public.clients (
    id      serial4 PRIMARY KEY,
    user_id int4 NOT NULL,
    phone   varchar(20) NULL,
    CONSTRAINT clients_user_id_key UNIQUE (user_id),
    CONSTRAINT clients_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.users(id) ON DELETE CASCADE
);

-- ─── Тренери (доменна сутність ролі trainer) ──────────────────
CREATE TABLE IF NOT EXISTS public.trainers (
    id             serial4 PRIMARY KEY,
    user_id        int4 NOT NULL,
    phone          varchar(20) NULL,
    specialization varchar(100) NULL,
    CONSTRAINT trainers_user_id_key UNIQUE (user_id),
    CONSTRAINT trainers_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.users(id) ON DELETE CASCADE
);

-- ─── Абонементи ───────────────────────────────────────────────
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

CREATE TABLE IF NOT EXISTS public.subscriptions (
    id         serial4 PRIMARY KEY,
    client_id  int4 NOT NULL,
    plan_id    int4 NULL,
    "type"     varchar(50) NOT NULL,
    start_date date NOT NULL,
    end_date   date NOT NULL,
    status     varchar(20) DEFAULT 'active'::character varying NULL,
    CONSTRAINT subscriptions_check CHECK (end_date > start_date),
    CONSTRAINT subscriptions_client_id_fkey FOREIGN KEY (client_id)
        REFERENCES public.clients(id) ON DELETE CASCADE,
    CONSTRAINT subscriptions_plan_id_fkey FOREIGN KEY (plan_id)
        REFERENCES public.subscription_plans(id) ON DELETE SET NULL
);

-- ─── Розклад занять ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.schedules (
    id         serial4 PRIMARY KEY,
    workout_id int4 NOT NULL,
    trainer_id int4 NULL,
    "date"     date NOT NULL,
    "time"     time NOT NULL,
    CONSTRAINT schedules_trainer_id_fkey FOREIGN KEY (trainer_id)
        REFERENCES public.trainers(id) ON DELETE SET NULL,
    CONSTRAINT schedules_workout_id_fkey FOREIGN KEY (workout_id)
        REFERENCES public.workouts(id) ON DELETE CASCADE
);

-- ─── Бронювання занять ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bookings (
    id          serial4 PRIMARY KEY,
    client_id   int4 NOT NULL,
    schedule_id int4 NOT NULL,
    status      varchar(20) DEFAULT 'active'::character varying NULL,
    -- Один клієнт не може забронювати те саме заняття двічі.
    CONSTRAINT bookings_client_id_schedule_id_key UNIQUE (client_id, schedule_id),
    CONSTRAINT bookings_client_id_fkey FOREIGN KEY (client_id)
        REFERENCES public.clients(id) ON DELETE CASCADE,
    CONSTRAINT bookings_schedule_id_fkey FOREIGN KEY (schedule_id)
        REFERENCES public.schedules(id) ON DELETE CASCADE
);

-- ─── Оплати ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payments (
    id              serial4 PRIMARY KEY,
    client_id       int4 NOT NULL,
    subscription_id int4 NULL,
    amount          numeric(10, 2) NOT NULL,
    "date"          date DEFAULT CURRENT_DATE NULL,
    status          varchar(20) DEFAULT 'completed'::character varying NULL,
    CONSTRAINT payments_amount_check CHECK (amount > (0)::numeric),
    CONSTRAINT payments_client_id_fkey FOREIGN KEY (client_id)
        REFERENCES public.clients(id),
    CONSTRAINT payments_subscription_id_fkey FOREIGN KEY (subscription_id)
        REFERENCES public.subscriptions(id) ON DELETE SET NULL
);

-- ─── Відвідування ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.visits (
    id              serial4 PRIMARY KEY,
    client_id       int4 NOT NULL,
    subscription_id int4 NULL,
    visit_time      timestamp DEFAULT CURRENT_TIMESTAMP NULL,
    schedule_id     int4 NULL,
    CONSTRAINT visits_client_id_fkey FOREIGN KEY (client_id)
        REFERENCES public.clients(id) ON DELETE CASCADE,
    CONSTRAINT visits_schedule_id_fkey FOREIGN KEY (schedule_id)
        REFERENCES public.schedules(id) ON DELETE SET NULL,
    CONSTRAINT visits_subscription_id_fkey FOREIGN KEY (subscription_id)
        REFERENCES public.subscriptions(id) ON DELETE SET NULL
);
