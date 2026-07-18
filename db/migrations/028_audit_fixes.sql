-- ============================================================
--  Міграція 028: виправлення проблем, знайдених аудитом
-- ============================================================
--
--  В1. schedules_slot_unique → два часткові індекси (замість NULLS NOT DISTINCT)
--      Видалення тренера (SET NULL) більше не ламає DELETE через constraint.
--  В2. push_subscriptions: UNIQUE(endpoint) замість UNIQUE(user_id, endpoint)
--      Один endpoint → один власник; перелогін перезаписує.
--  В3. users.phone varchar(20) → varchar(30) (= pending_registrations.phone)
--      Телефон >20 символів більше не обрізається при підтвердженні реєстрації.
--  С4. messages: CHECK (status<>'planned' OR send_date IS NOT NULL)
--      Заплановане повідомлення без дати більше не зависає назавжди.
--  С5. subscriptions.type varchar(50) → varchar(100) (= subscription_plans.name)
--      Назва плану >50 символів більше не валить INSERT підписки.
--  С6. subscription_plans: умовні CHECK за plan_type
--      subscription без duration_days і single без usage_count → помилка.
--  Н10. DROP INDEX idx_schedules_date (покритий idx_schedules_date_time)
--  Н11. Частковий індекс на chat_conversations(assigned_admin_id) для відкритих
-- ============================================================

-- ── В1. schedules: замінюємо UNIQUE NULLS NOT DISTINCT на два часткові індекси ──

ALTER TABLE public.schedules
    DROP CONSTRAINT IF EXISTS schedules_slot_unique;

-- Слоти з тренером: (workout, trainer, date, time) мають бути унікальні
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedules_slot_with_trainer
    ON public.schedules (workout_id, trainer_id, "date", "time")
    WHERE trainer_id IS NOT NULL;

-- Слоти без тренера: (workout, date, time) унікальні окремо
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedules_slot_no_trainer
    ON public.schedules (workout_id, "date", "time")
    WHERE trainer_id IS NULL;

-- ── В2. push_subscriptions: endpoint унікальний сам по собі ──

-- Видаляємо дублі: залишаємо лише найновіший рядок для кожного endpoint
DELETE FROM public.push_subscriptions
WHERE id NOT IN (
    SELECT DISTINCT ON (endpoint) id
    FROM public.push_subscriptions
    ORDER BY endpoint, id DESC
);

ALTER TABLE public.push_subscriptions
    DROP CONSTRAINT IF EXISTS push_subscriptions_user_id_endpoint_key;

ALTER TABLE public.push_subscriptions
    DROP CONSTRAINT IF EXISTS push_subscriptions_endpoint_key;

ALTER TABLE public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);

-- ── В3. users.phone: вирівнюємо до varchar(30) ──

ALTER TABLE public.users
    ALTER COLUMN phone TYPE varchar(30);

-- ── С4. messages: CHECK що 'planned' потребує send_date ──

ALTER TABLE public.messages
    DROP CONSTRAINT IF EXISTS messages_planned_requires_date;
ALTER TABLE public.messages
    ADD CONSTRAINT messages_planned_requires_date
    CHECK (status <> 'planned' OR send_date IS NOT NULL);

-- ── С5. subscriptions.type: вирівнюємо до varchar(100) ──

ALTER TABLE public.subscriptions
    ALTER COLUMN "type" TYPE varchar(100);

-- ── С6. subscription_plans: умовні CHECK за plan_type ──

ALTER TABLE public.subscription_plans
    DROP CONSTRAINT IF EXISTS subscription_plans_duration_check;
ALTER TABLE public.subscription_plans
    ADD CONSTRAINT subscription_plans_duration_check
    CHECK (plan_type <> 'subscription' OR duration_days > 0);

ALTER TABLE public.subscription_plans
    DROP CONSTRAINT IF EXISTS subscription_plans_usage_check;
ALTER TABLE public.subscription_plans
    ADD CONSTRAINT subscription_plans_usage_check
    CHECK (plan_type <> 'single' OR usage_count > 0);

-- ── Н10. Видаляємо дубльований індекс (покритий idx_schedules_date_time) ──

DROP INDEX IF EXISTS idx_schedules_date;

-- ── Н11. Частковий індекс для списку відкритих діалогів адміна ──

CREATE INDEX IF NOT EXISTS idx_chat_conv_admin_open
    ON public.chat_conversations (assigned_admin_id)
    WHERE closed_at IS NULL;
