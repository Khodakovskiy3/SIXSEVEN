-- ============================================================
--  Міграція 011: Непідтверджені реєстрації (pending_registrations).
--
--  Дані нового користувача зберігаються тут до підтвердження email-кодом
--  (двофакторна автентифікація на етапі реєстрації). Запис у public.users
--  створюється лише ПІСЛЯ успішної перевірки коду, тож недопідтверджені
--  реєстрації не засмічують таблицю користувачів і не займають email.
--
--  • password  — bcrypt-хеш пароля (не відкритий текст).
--  • code_hash — bcrypt-хеш одноразового коду.
--  • один запис на email (UNIQUE); повторна реєстрація перезаписує його.
--
--  Безпечно запускати повторно (IF NOT EXISTS).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pending_registrations (
    id         serial4 PRIMARY KEY,
    email      varchar(100) NOT NULL UNIQUE,
    "name"     varchar(100) NOT NULL,
    "password" varchar(255) NOT NULL,           -- bcrypt-хеш пароля
    phone      varchar(30) NULL,
    "role"     varchar(20) NOT NULL DEFAULT 'client',
    code_hash  varchar(255) NOT NULL,           -- bcrypt-хеш коду
    expires_at timestamp NOT NULL,
    attempts   int4 NOT NULL DEFAULT 0,
    created_at timestamp NOT NULL DEFAULT now(),
    CONSTRAINT pending_registrations_role_check CHECK (
        (role)::text = ANY (ARRAY['admin','trainer','client','manager']::text[])
    )
);

CREATE INDEX IF NOT EXISTS idx_pending_registrations_email
    ON public.pending_registrations(email);
