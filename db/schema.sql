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

-- Email зберігається в нижньому регістрі (auth.js нормалізує при вході й
-- реєстрації); індекс закріплює регістронезалежну унікальність на рівні БД.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key
    ON public.users (lower(email));

-- ─── Типи тренувань ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workouts (
    id          serial4 PRIMARY KEY,
    "name"      varchar(100) NOT NULL,
    description text NULL,
    max_clients int4 NOT NULL,
    status      varchar(20) NOT NULL DEFAULT 'active',
    CONSTRAINT workouts_name_key UNIQUE (name),
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
    CONSTRAINT subscription_plans_name_key UNIQUE (name),
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
    -- Знімок назви плану на момент покупки (свідома денормалізація):
    -- якщо план перейменують чи видалять (plan_id стане NULL), підписка
    -- збереже назву того, що реально було продано.
    "type"     varchar(50) NOT NULL,
    start_date date NOT NULL,
    end_date   date NOT NULL,
    status     varchar(20) DEFAULT 'active'::character varying NOT NULL,
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
    -- Однаковий слот (послуга + тренер + дата + час) — помилка вводу.
    -- NULLS NOT DISTINCT, щоб дублі ловилися й для занять без тренера.
    CONSTRAINT schedules_slot_unique
        UNIQUE NULLS NOT DISTINCT (workout_id, trainer_id, "date", "time"),
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
    status      varchar(20) DEFAULT 'active'::character varying NOT NULL,
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
    -- client_id nullable: при видаленні клієнта оплата зберігається у звітах
    -- (ON DELETE SET NULL), лише відв'язується від клієнта.
    client_id       int4 NULL,
    subscription_id int4 NULL,
    amount          numeric(10, 2) NOT NULL,
    "date"          date DEFAULT CURRENT_DATE NOT NULL,
    status          varchar(20) DEFAULT 'completed'::character varying NOT NULL,
    CONSTRAINT payments_amount_check CHECK (amount > (0)::numeric),
    CONSTRAINT payments_client_id_fkey FOREIGN KEY (client_id)
        REFERENCES public.clients(id) ON DELETE SET NULL,
    CONSTRAINT payments_subscription_id_fkey FOREIGN KEY (subscription_id)
        REFERENCES public.subscriptions(id) ON DELETE SET NULL
);

-- ─── Відвідування ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.visits (
    id              serial4 PRIMARY KEY,
    client_id       int4 NOT NULL,
    subscription_id int4 NULL,
    visit_time      timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT visits_client_id_fkey FOREIGN KEY (client_id)
        REFERENCES public.clients(id) ON DELETE CASCADE,
    CONSTRAINT visits_subscription_id_fkey FOREIGN KEY (subscription_id)
        REFERENCES public.subscriptions(id) ON DELETE SET NULL
);

-- ─── Чат «гість ↔ адміністратор» ──────────────────────────────
-- Діалог гостя ідентифікується випадковим токеном з localStorage.
CREATE TABLE IF NOT EXISTS public.chat_conversations (
    id                serial4 PRIMARY KEY,
    guest_token       varchar(64) NOT NULL UNIQUE,
    -- Ім'я співрозмовника: для авторизованих клієнтів (токен client-<userId>)
    -- сюди пишеться ім'я з облікового запису, щоб адміністратор бачив, з ким говорить.
    guest_name        varchar(120) NULL,
    -- Адміністратор, який взяв діалог у роботу; NULL — звернення очікує.
    assigned_admin_id int4 NULL REFERENCES public.users(id) ON DELETE SET NULL,
    -- Час завершення діалогу адміністратором; NULL — діалог відкритий.
    closed_at         timestamptz NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chat_messages (
    id              serial4 PRIMARY KEY,
    conversation_id int4 NOT NULL,
    sender          varchar(10) NOT NULL,
    body            text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    read_by_admin   boolean NOT NULL DEFAULT false,
    CONSTRAINT chat_messages_sender_check
        CHECK ((sender)::text = ANY (ARRAY['guest','admin','system']::text[])),
    CONSTRAINT chat_messages_conversation_id_fkey FOREIGN KEY (conversation_id)
        REFERENCES public.chat_conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
    ON public.chat_messages(conversation_id, id);
