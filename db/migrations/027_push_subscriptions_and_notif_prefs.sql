-- ============================================================
--  Міграція 027: Web Push підписки та налаштування сповіщень
-- ============================================================

-- Таблиця підписок на push-сповіщення (Web Push API)
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id          serial PRIMARY KEY,
    user_id     int4 NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    endpoint    text NOT NULL,
    p256dh      text NOT NULL,
    auth        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions(user_id);

-- Налаштування сповіщень на рівні користувача
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notif_training   boolean NOT NULL DEFAULT true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notif_hour_reminder boolean NOT NULL DEFAULT true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notif_push       boolean NOT NULL DEFAULT false;
