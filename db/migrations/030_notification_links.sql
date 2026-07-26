-- Посилання для адресного переходу з Push та центру сповіщень.
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS link text NULL;

-- Оголошення можуть бути адресовані також адміністраторам.
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_audience_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_audience_check
    CHECK ((audience)::text = ANY (ARRAY['clients', 'trainers', 'admins', 'all', 'custom']::text[]));

CREATE INDEX IF NOT EXISTS idx_messages_planned_send_date
    ON public.messages (send_date)
    WHERE status = 'planned';
