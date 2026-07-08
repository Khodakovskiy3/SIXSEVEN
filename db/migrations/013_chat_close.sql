-- Завершення чат-діалогів адміністратором.
--
-- closed_at IS NOT NULL означає, що діалог завершено. Нове повідомлення
-- відвідувача автоматично відкриває діалог знову і повертає його в чергу
-- очікування (assigned_admin_id скидається).

ALTER TABLE public.chat_conversations
    ADD COLUMN IF NOT EXISTS closed_at timestamp NULL;
