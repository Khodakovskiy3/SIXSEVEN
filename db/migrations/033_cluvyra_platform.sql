-- ============================================================
--  033: Cluvyra platform — відкликання JWT, AI-бронювання, облік AI,
--  службові мітки застосунку.
--  Лише додавання об'єктів; існуючі дані не змінюються.
-- ============================================================

-- Версія токенів користувача: збільшується при зміні пароля чи ролі,
-- що робить недійсними раніше видані JWT (claim "tv").
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS token_version int4 NOT NULL DEFAULT 0;

-- Серверні підтвердження бронювань, підготовлених AI-асистентом.
-- Модель НЕ отримує токен: його бачить лише браузер користувача, і запис
-- створюється тільки після явного натискання «Підтвердити».
-- token_hash — SHA-256 від випадкового токена (сам токен не зберігається).
CREATE TABLE IF NOT EXISTS public.ai_booking_confirmations (
    id           serial4 PRIMARY KEY,
    token_hash   char(64)    NOT NULL,
    user_id      int4        NOT NULL REFERENCES public.users(id)     ON DELETE CASCADE,
    client_id    int4        NOT NULL REFERENCES public.clients(id)   ON DELETE CASCADE,
    schedule_id  int4        NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
    status       varchar(20) NOT NULL DEFAULT 'pending',
    expires_at   timestamptz NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    resolved_at  timestamptz NULL,
    booking_id   int4        NULL REFERENCES public.bookings(id) ON DELETE SET NULL,
    CONSTRAINT ai_booking_confirmations_token_key UNIQUE (token_hash),
    CONSTRAINT ai_booking_confirmations_status_check
        CHECK (status IN ('pending', 'confirmed', 'declined', 'expired', 'failed'))
);
CREATE INDEX IF NOT EXISTS idx_ai_booking_conf_user
    ON public.ai_booking_confirmations (user_id, created_at DESC);

-- Мінімальний облік використання AI (без тексту повідомлень і персональних
-- даних): для лімітів, контролю витрат і метрик.
CREATE TABLE IF NOT EXISTS public.ai_usage_events (
    id            bigserial PRIMARY KEY,
    user_id       int4        NULL REFERENCES public.users(id) ON DELETE SET NULL,
    provider      varchar(20) NOT NULL,
    model         varchar(80) NOT NULL,
    status        varchar(20) NOT NULL,
    input_tokens  int4        NOT NULL DEFAULT 0,
    output_tokens int4        NOT NULL DEFAULT 0,
    tool_calls    int4        NOT NULL DEFAULT 0,
    latency_ms    int4        NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_time
    ON public.ai_usage_events (user_id, created_at DESC);

-- Службові мітки застосунку (напр. факт демо-наповнення бази).
CREATE TABLE IF NOT EXISTS public.app_meta (
    key        varchar(100) PRIMARY KEY,
    value      text         NOT NULL,
    updated_at timestamptz  NOT NULL DEFAULT now()
);
