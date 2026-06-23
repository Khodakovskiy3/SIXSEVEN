-- ============================================================
--  Міграція 010: Двофакторна автентифікація (2FA) через email-код.
--
--  • users.twofa_enabled — прапорець увімкнення 2FA користувачем (опційно).
--  • email_codes — одноразові коди (OTP) для входу та підтвердження
--    увімкнення 2FA. Зберігається лише bcrypt-хеш коду, не сам код.
--
--  Безпечно запускати повторно (IF NOT EXISTS).
-- ============================================================

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS twofa_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.email_codes (
    id         serial4 PRIMARY KEY,
    user_id    int4 NOT NULL,
    purpose    varchar(20) NOT NULL,            -- 'login' | 'enable_2fa'
    code_hash  varchar(255) NOT NULL,           -- bcrypt-хеш коду
    expires_at timestamp NOT NULL,
    attempts   int4 NOT NULL DEFAULT 0,
    created_at timestamp NOT NULL DEFAULT now(),
    CONSTRAINT email_codes_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT email_codes_purpose_check CHECK (
        (purpose)::text = ANY (ARRAY['login','enable_2fa']::text[])
    )
);

CREATE INDEX IF NOT EXISTS idx_email_codes_user_purpose
    ON public.email_codes(user_id, purpose);
