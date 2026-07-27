-- ============================================================
--  СИКСЕВЕН (OLIMP) — Схема бази даних спортивного клубу (PostgreSQL 15+)
--  Автоматизована система: тренування, розклад, членство.
--
--  Цей файл — точна копія реальної схеми бази sports_club_db, включно
--  з усіма міграціями db/migrations/001…028 (востаннє звірено після
--  аудиту БД від 18.07.2026 — виправлення В1–В3, С4–С6, Н10–Н11).
--  Файл не виконується
--  сервером автоматично (це робить server/migrate.js за db/migrations/*.sql
--  при кожному старті) — призначення схеми лише довідкове: відтворення
--  БД на новому середовищі одним запуском або звірка з живою базою.
--
--  ⚠️ ЯКЩО ТАБЛИЦІ ВЖЕ ІСНУЮТЬ — НЕ ЗАПУСКАЙТЕ цей файл повторно:
--     розкоментовані DROP-и видалять усі дані. Блок DROP лишено
--     закоментованим саме з міркувань безпеки.
--
--  Виконати на чистій базі:
--    • psql -U postgres -d sports_club_db -f db/schema.sql
--    • або у DBeaver: SQL-редактор → Execute SQL Script (Alt+X).
--  Далі: npm run db:migrate (ідемпотентно, безпечно навіть одразу після
--  цього файлу) і, за потреби, npm run db:seed.
--
-- ============================================================

-- ─── (НЕБЕЗПЕЧНО) Очищення. Розкоментуйте лише для повного перестворення ───
-- DROP TABLE IF EXISTS client_anthropometry CASCADE;
-- DROP TABLE IF EXISTS trainer_client_notes CASCADE;
-- DROP TABLE IF EXISTS pending_registrations CASCADE;
-- DROP TABLE IF EXISTS email_codes       CASCADE;
-- DROP TABLE IF EXISTS chat_messages     CASCADE;
-- DROP TABLE IF EXISTS chat_conversations CASCADE;
-- DROP TABLE IF EXISTS notification_reads CASCADE;
-- DROP TABLE IF EXISTS message_recipients CASCADE;
-- DROP TABLE IF EXISTS messages         CASCADE;
-- DROP TABLE IF EXISTS club_settings    CASCADE;
-- DROP TABLE IF EXISTS visits           CASCADE;
-- DROP TABLE IF EXISTS payments         CASCADE;
-- DROP TABLE IF EXISTS bookings         CASCADE;
-- DROP TABLE IF EXISTS subscriptions    CASCADE;
-- DROP TABLE IF EXISTS schedules        CASCADE;
-- DROP TABLE IF EXISTS subscription_plans CASCADE;
-- DROP TABLE IF EXISTS workouts         CASCADE;
-- DROP TABLE IF EXISTS trainers         CASCADE;
-- DROP TABLE IF EXISTS clients          CASCADE;
-- DROP TABLE IF EXISTS users            CASCADE;

-- ─── Користувачі (загальні облікові записи) ───────────────────
-- Телефон — атрибут людини, не ролі, тож зберігається тут для всіх ролей
-- (єдине джерело; раніше дублювався в clients/trainers — АУДИТ_БД.md П1).
CREATE TABLE IF NOT EXISTS public.users (
    id            serial4 PRIMARY KEY,
    "name"        varchar(100) NOT NULL,
    email         varchar(100) NOT NULL,
    "password"    varchar(255) NOT NULL,              -- bcrypt-хеш
    "role"        varchar(20)  NOT NULL,
    twofa_enabled    boolean      NOT NULL DEFAULT false,
    phone            varchar(30)  NULL,
    notif_training   boolean      NOT NULL DEFAULT true,
    notif_hour_reminder boolean   NOT NULL DEFAULT true,
    notif_push       boolean      NOT NULL DEFAULT false,
    created_at       timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT users_email_key UNIQUE (email),
    CONSTRAINT users_role_check CHECK (
        role IN ('admin','trainer','client','manager')
    )
);

-- Email зберігається в нижньому регістрі (auth.js нормалізує при вході й
-- реєстрації); індекс закріплює регістронезалежну унікальність на рівні БД.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key
    ON public.users (lower(email));

-- ─── Клієнти (доменна сутність ролі client, 1:1 до users) ──────
CREATE TABLE IF NOT EXISTS public.clients (
    id         serial4 PRIMARY KEY,
    user_id    int4 NOT NULL,
    CONSTRAINT clients_user_id_key  UNIQUE (user_id),   -- гарантія 1:1
    CONSTRAINT clients_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.users(id) ON DELETE CASCADE
);

-- ─── Тренери (доменна сутність ролі trainer, 1:1 до users) ─────
CREATE TABLE IF NOT EXISTS public.trainers (
    id             serial4 PRIMARY KEY,
    user_id        int4 NOT NULL,
    specialization varchar(100) NULL,
    CONSTRAINT trainers_user_id_key  UNIQUE (user_id),
    CONSTRAINT trainers_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.users(id) ON DELETE CASCADE
);

-- ─── Послуги (типи занять) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workouts (
    id               serial4 PRIMARY KEY,
    "name"           varchar(100) NOT NULL,
    description      text NULL,
    max_clients      int4 NOT NULL,
    status           varchar(20) NOT NULL DEFAULT 'active',
    image_url        text NULL,
    duration_minutes int4 NOT NULL DEFAULT 60,
    CONSTRAINT workouts_name_key          UNIQUE (name),
    CONSTRAINT workouts_max_clients_check CHECK (max_clients > 0),
    CONSTRAINT workouts_duration_check    CHECK (duration_minutes > 0),
    CONSTRAINT workouts_status_check      CHECK (status IN ('active','inactive'))
);

-- ─── Шаблони абонементів ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscription_plans (
    id            serial4 PRIMARY KEY,
    "name"        varchar(100) NOT NULL,
    description   text NULL,
    plan_type     varchar(20)  NOT NULL DEFAULT 'subscription',
    access_type   varchar(100) NOT NULL,
    duration_days int4 NULL,
    usage_count   int4 NULL,
    price         numeric(10, 2) NOT NULL,
    status        varchar(20)  NOT NULL DEFAULT 'active',
    CONSTRAINT subscription_plans_name_key     UNIQUE (name),
    CONSTRAINT subscription_plans_price_check  CHECK (price > 0),
    CONSTRAINT subscription_plans_type_check   CHECK (plan_type IN ('subscription','single')),
    CONSTRAINT subscription_plans_status_check CHECK (status IN ('active','inactive')),
    -- Закріплює фактичний словник значень доступу, що використовує код.
    CONSTRAINT subscription_plans_access_check CHECK (
        access_type IN ('gym','gym_group','group','personal')
    ),
    -- Умовні обмеження за plan_type (В28: уникаємо планів-примар без тривалості/ліміту).
    CONSTRAINT subscription_plans_duration_check
        CHECK (plan_type <> 'subscription' OR duration_days > 0),
    CONSTRAINT subscription_plans_usage_check
        CHECK (plan_type <> 'single' OR usage_count > 0)
);

-- ─── Куплені абонементи ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id         serial4 PRIMARY KEY,
    -- SET NULL: видалення клієнта не знищує його підписку — вона лишається
    -- у зведеній аналітиці (reports.js: planStats), симетрично до payments
    -- і visits. З клієнт-орієнтованих списків (INNER JOIN clients) така
    -- підписка природно зникає, як і осиротілі payments/visits.
    client_id  int4 NULL,
    plan_id    int4 NULL,
    -- Знімок назви плану на момент покупки (свідома денормалізація):
    -- якщо план перейменують чи видалять (plan_id стане NULL), підписка
    -- збереже назву того, що реально було продано.
    "type"     varchar(100) NOT NULL,
    start_date date NOT NULL,
    end_date   date NOT NULL,
    status     varchar(20) NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT subscriptions_check CHECK (end_date > start_date),
    -- Словник статусів відповідає SUBSCRIPTION_STATUS у коді.
    CONSTRAINT subscriptions_status_check CHECK (
        status IN ('active','paused','expired','cancelled')
    ),
    CONSTRAINT subscriptions_client_id_fkey FOREIGN KEY (client_id)
        REFERENCES public.clients(id) ON DELETE SET NULL,
    CONSTRAINT subscriptions_plan_id_fkey FOREIGN KEY (plan_id)
        REFERENCES public.subscription_plans(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_client ON public.subscriptions(client_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan   ON public.subscriptions(plan_id);
-- Прискорює регулярний UPDATE протермінування
-- (subscriptions.js: WHERE status='active' AND end_date < CURRENT_DATE).
CREATE INDEX IF NOT EXISTS idx_subscriptions_active_end
    ON public.subscriptions(end_date) WHERE status = 'active';

-- ─── Розклад занять ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.schedules (
    id         serial4 PRIMARY KEY,
    workout_id int4 NOT NULL,
    trainer_id int4 NULL,
    "date"     date NOT NULL,
    "time"     time NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT schedules_trainer_id_fkey FOREIGN KEY (trainer_id)
        REFERENCES public.trainers(id) ON DELETE SET NULL,
    CONSTRAINT schedules_workout_id_fkey FOREIGN KEY (workout_id)
        REFERENCES public.workouts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_schedules_workout   ON public.schedules(workout_id);
CREATE INDEX IF NOT EXISTS idx_schedules_trainer   ON public.schedules(trainer_id);
CREATE INDEX IF NOT EXISTS idx_schedules_date_time ON public.schedules(date, "time");
-- Два часткові унікальні індекси замість UNIQUE NULLS NOT DISTINCT (міг. 028):
-- видалення тренера (SET NULL) більше не ламає DELETE через constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedules_slot_with_trainer
    ON public.schedules (workout_id, trainer_id, "date", "time")
    WHERE trainer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedules_slot_no_trainer
    ON public.schedules (workout_id, "date", "time")
    WHERE trainer_id IS NULL;

-- ─── Бронювання занять ──────────────────────────────────────────
-- Скасування клієнтом переводить статус у 'cancelled' (не DELETE) —
-- зберігає історію броней/скасувань (АУДИТ_БД.md П2).
CREATE TABLE IF NOT EXISTS public.bookings (
    id           serial4 PRIMARY KEY,
    client_id    int4 NOT NULL,
    schedule_id  int4 NOT NULL,
    status       varchar(20) NOT NULL DEFAULT 'active',
    created_at   timestamptz NOT NULL DEFAULT now(),
    cancelled_at timestamptz NULL,
    CONSTRAINT bookings_status_check CHECK (status IN ('active','cancelled')),
    CONSTRAINT bookings_client_id_fkey FOREIGN KEY (client_id)
        REFERENCES public.clients(id) ON DELETE CASCADE,
    CONSTRAINT bookings_schedule_id_fkey FOREIGN KEY (schedule_id)
        REFERENCES public.schedules(id) ON DELETE CASCADE
);

-- Активна бронь на пару (клієнт, заняття) — одна; після скасування можна
-- записатися знову (частковий індекс замінює звичайний UNIQUE).
CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_unique
    ON public.bookings(client_id, schedule_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_bookings_schedule ON public.bookings(schedule_id);
CREATE INDEX IF NOT EXISTS idx_bookings_client   ON public.bookings(client_id);

-- ─── Оплати ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payments (
    id              serial4 PRIMARY KEY,
    -- client_id nullable: при видаленні клієнта оплата зберігається у звітах
    -- (ON DELETE SET NULL), лише відв'язується від клієнта.
    client_id       int4 NULL,
    subscription_id int4 NULL,
    amount          numeric(10, 2) NOT NULL,
    "date"          date NOT NULL DEFAULT CURRENT_DATE,   -- бізнес-дата оплати
    status          varchar(20) NOT NULL DEFAULT 'completed',
    -- Точний момент створення запису — для аудиту й звірки (АУДИТ_БД.md П4).
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT payments_amount_check CHECK (amount > 0),
    CONSTRAINT payments_status_check CHECK (status IN ('completed','pending','refunded')),
    CONSTRAINT payments_client_id_fkey FOREIGN KEY (client_id)
        REFERENCES public.clients(id) ON DELETE SET NULL,
    CONSTRAINT payments_subscription_id_fkey FOREIGN KEY (subscription_id)
        REFERENCES public.subscriptions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_client       ON public.payments(client_id);
CREATE INDEX IF NOT EXISTS idx_payments_subscription ON public.payments(subscription_id);
CREATE INDEX IF NOT EXISTS idx_payments_date         ON public.payments(date);

-- ─── Відвідування ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.visits (
    id              serial4 PRIMARY KEY,
    -- SET NULL: видалення клієнта не знищує статистику відвідуваності
    -- (симетрично до payments).
    client_id       int4 NULL,
    subscription_id int4 NULL,
    -- Заняття, якого стосується візит; NULL = звичайний вхід у зал без
    -- прив'язки. Підготовка під заплановану функцію авто-відмітки
    -- відвідувань (АУДИТ_БД.md П5) — поточний production-код цю колонку
    -- ще не заповнює.
    schedule_id     int4 NULL,
    visit_time      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT visits_client_id_fkey FOREIGN KEY (client_id)
        REFERENCES public.clients(id) ON DELETE SET NULL,
    CONSTRAINT visits_subscription_id_fkey FOREIGN KEY (subscription_id)
        REFERENCES public.subscriptions(id) ON DELETE SET NULL,
    CONSTRAINT visits_schedule_id_fkey FOREIGN KEY (schedule_id)
        REFERENCES public.schedules(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_visits_client       ON public.visits(client_id);
CREATE INDEX IF NOT EXISTS idx_visits_subscription ON public.visits(subscription_id);
CREATE INDEX IF NOT EXISTS idx_visits_time         ON public.visits(visit_time);
CREATE INDEX IF NOT EXISTS idx_visits_schedule     ON public.visits(schedule_id);

-- ─── Налаштування клубу (singleton) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.club_settings (
    id            int4 PRIMARY KEY DEFAULT 1,
    name          varchar(100) NOT NULL DEFAULT 'OLIMP',
    address       varchar(255) NULL,
    phone         varchar(30)  NULL,
    email         varchar(100) NULL,
    weekday_hours varchar(50)  NOT NULL DEFAULT '07:00 - 22:00',
    weekend_hours varchar(50)  NOT NULL DEFAULT '09:00 - 20:00',
    remind_clients  boolean NOT NULL DEFAULT true,   -- вимикає сповіщення категорії 'training' клієнтам
    remind_trainers boolean NOT NULL DEFAULT true,   -- вимикає сповіщення категорії 'training' тренерам
    CONSTRAINT club_settings_singleton CHECK (id = 1)
);

-- ─── Оголошення адміністрації ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.messages (
    id         serial4 PRIMARY KEY,
    subject    varchar(150) NOT NULL,
    body       text NULL,
    audience   varchar(20) NOT NULL DEFAULT 'clients',
    status     varchar(20) NOT NULL DEFAULT 'sent',
    send_date  date NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Автор розсилки; SET NULL — оголошення переживає видалення автора.
    created_by int4 NULL REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT messages_audience_check CHECK (
        audience IN ('clients','trainers','all','custom')
    ),
    CONSTRAINT messages_status_check CHECK (status IN ('sent','planned')),
    -- Заплановане повідомлення без дати зависає назавжди (міг. 028).
    CONSTRAINT messages_planned_requires_date
        CHECK (status <> 'planned' OR send_date IS NOT NULL)
);

-- Адресати custom-розсилок (M:N, складений PK).
CREATE TABLE IF NOT EXISTS public.message_recipients (
    message_id int4 NOT NULL,
    user_id    int4 NOT NULL,
    PRIMARY KEY (message_id, user_id),
    CONSTRAINT message_recipients_message_id_fkey FOREIGN KEY (message_id)
        REFERENCES public.messages(id) ON DELETE CASCADE,
    CONSTRAINT message_recipients_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_message_recipients_user ON public.message_recipients(user_id);

-- Факти прочитання оголошень (M:N, складений PK).
CREATE TABLE IF NOT EXISTS public.notification_reads (
    message_id int4 NOT NULL,
    user_id    int4 NOT NULL,
    read_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id),
    CONSTRAINT notification_reads_message_fkey FOREIGN KEY (message_id)
        REFERENCES public.messages(id) ON DELETE CASCADE,
    CONSTRAINT notification_reads_user_fkey FOREIGN KEY (user_id)
        REFERENCES public.users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS notification_reads_user_idx ON public.notification_reads(user_id);

-- ─── Чат «гість/клієнт ↔ адміністратор» ──────────────────────────
-- Діалог гостя ідентифікується випадковим токеном з localStorage.
CREATE TABLE IF NOT EXISTS public.chat_conversations (
    id                serial4 PRIMARY KEY,
    guest_token       varchar(64) NOT NULL UNIQUE,
    -- Ім'я співрозмовника: для авторизованих клієнтів сюди пишеться ім'я
    -- з облікового запису, щоб адміністратор бачив, з ким говорить.
    guest_name        varchar(120) NULL,
    -- Явний FK для авторизованих (замість парсингу токена
    -- 'client-<userId>'); NULL — анонімний гість (АУДИТ_БД.md П7).
    user_id           int4 NULL REFERENCES public.users(id) ON DELETE SET NULL,
    -- Адміністратор, який взяв діалог у роботу; NULL — звернення очікує.
    assigned_admin_id int4 NULL REFERENCES public.users(id) ON DELETE SET NULL,
    -- Час завершення діалогу адміністратором; NULL — діалог відкритий.
    closed_at         timestamptz NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_user ON public.chat_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_conv_admin_open
    ON public.chat_conversations (assigned_admin_id)
    WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.chat_messages (
    id              serial4 PRIMARY KEY,
    conversation_id int4 NOT NULL,
    sender          varchar(10) NOT NULL,
    body            text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    read_by_admin   boolean NOT NULL DEFAULT false,
    CONSTRAINT chat_messages_sender_check
        CHECK (sender IN ('guest','admin','system')),
    CONSTRAINT chat_messages_conversation_id_fkey FOREIGN KEY (conversation_id)
        REFERENCES public.chat_conversations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
    ON public.chat_messages(conversation_id, id);

-- ─── 2FA: одноразові коди ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_codes (
    id         serial4 PRIMARY KEY,
    user_id    int4 NOT NULL,
    purpose    varchar(20) NOT NULL,               -- 'login' | 'enable_2fa'
    code_hash  varchar(255) NOT NULL,               -- bcrypt-хеш, не сам код
    expires_at timestamptz NOT NULL,
    attempts   int4 NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT email_codes_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT email_codes_purpose_check CHECK (purpose IN ('login','enable_2fa'))
);
CREATE INDEX IF NOT EXISTS idx_email_codes_user_purpose
    ON public.email_codes(user_id, purpose);

-- ─── Незавершені реєстрації ──────────────────────────────────────
-- Дані нового користувача тримаються тут до підтвердження email-кодом;
-- запис у users з'являється лише після успішної перевірки.
CREATE TABLE IF NOT EXISTS public.pending_registrations (
    id         serial4 PRIMARY KEY,
    email      varchar(100) NOT NULL UNIQUE,
    "name"     varchar(100) NOT NULL,
    "password" varchar(255) NOT NULL,               -- bcrypt-хеш
    phone      varchar(30) NULL,
    "role"     varchar(20) NOT NULL DEFAULT 'client',
    code_hash  varchar(255) NOT NULL,
    expires_at timestamptz NOT NULL,
    attempts   int4 NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pending_registrations_role_check CHECK (
        role IN ('admin','trainer','client','manager')
    )
);

-- ─── Нотатки тренера про клієнта ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trainer_client_notes (
    id         serial4 PRIMARY KEY,
    trainer_id int4 NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
    client_id  int4 NOT NULL REFERENCES public.clients(id)  ON DELETE CASCADE,
    note       text NOT NULL DEFAULT '',
    exercises  text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (trainer_id, client_id)
);
-- Вибірка «всі нотатки по клієнту» (/client-notes-all/:clientId).
CREATE INDEX IF NOT EXISTS idx_trainer_notes_client
    ON public.trainer_client_notes(client_id);

-- ─── Антропометрія клієнта ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_anthropometry (
    id          serial4 PRIMARY KEY,
    client_id   int4 NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    recorded_at date NOT NULL DEFAULT CURRENT_DATE,
    weight numeric(5,1) NULL,
    height numeric(5,1) NULL,
    chest  numeric(5,1) NULL,
    waist  numeric(5,1) NULL,
    hips   numeric(5,1) NULL,
    bicep  numeric(5,1) NULL,
    thigh  numeric(5,1) NULL,
    note        text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    -- Розумні межі — захист від очевидних одруків (напр. вага 234 кг
    -- замість 23.4 кг); діапазони навмисно широкі, не звужують легітимні
    -- значення (АУДИТ_БД.md, розділ 3).
    CONSTRAINT anthro_weight_check CHECK (weight IS NULL OR (weight > 0   AND weight < 400)),
    CONSTRAINT anthro_height_check CHECK (height IS NULL OR (height > 40  AND height < 260)),
    CONSTRAINT anthro_chest_check  CHECK (chest  IS NULL OR (chest  > 20  AND chest  < 250)),
    CONSTRAINT anthro_waist_check  CHECK (waist  IS NULL OR (waist  > 20  AND waist  < 250)),
    CONSTRAINT anthro_hips_check   CHECK (hips   IS NULL OR (hips   > 20  AND hips   < 250)),
    CONSTRAINT anthro_bicep_check  CHECK (bicep  IS NULL OR (bicep  > 5   AND bicep  < 100)),
    CONSTRAINT anthro_thigh_check  CHECK (thigh  IS NULL OR (thigh  > 10  AND thigh  < 150))
);
CREATE INDEX IF NOT EXISTS client_anthropometry_client_idx
    ON public.client_anthropometry(client_id, recorded_at DESC);

-- ─── Web Push підписки (міг. 027 + виправлення В2 в міг. 028) ───────
-- UNIQUE(endpoint): один браузер = один запис; перелогін перезаписує власника.
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id         serial4 PRIMARY KEY,
    user_id    int4 NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    endpoint   text NOT NULL,
    p256dh     text NOT NULL,
    auth       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint)
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions(user_id);
