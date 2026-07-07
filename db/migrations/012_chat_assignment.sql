-- Розподіл чат-діалогів між адміністраторами.
--
-- Нове звернення створюється «нічиїм» (assigned_admin_id IS NULL) і видиме
-- всім адміністраторам як таке, що очікує. Перший адміністратор, який бере
-- діалог у роботу, атомарно закріплює його за собою. Додається службовий
-- відправник 'system' для повідомлень на кшталт «адміністратор приєднався».

ALTER TABLE public.chat_conversations
    ADD COLUMN IF NOT EXISTS assigned_admin_id int4 NULL
        REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.chat_messages
    DROP CONSTRAINT IF EXISTS chat_messages_sender_check;

ALTER TABLE public.chat_messages
    ADD CONSTRAINT chat_messages_sender_check
        CHECK ((sender)::text = ANY (ARRAY['guest', 'admin', 'system']::text[]));
