-- ============================================================
--  Міграція 025: Виправлення за результатами аудиту БД — III
--                (пункти з розділу 3 АУДИТ_БД.md, пропущені в 021–024).
--
--  • messages.created_by — автор розсилки (аудит); SET NULL — оголошення
--    переживає видалення автора-адміністратора.
--  • idx_subscriptions_active_end — прискорює регулярний UPDATE
--    протермінування (subscriptions.js: refreshSubscriptionStatuses,
--    WHERE status='active' AND end_date < CURRENT_DATE).
-- ============================================================

ALTER TABLE public.messages
    ADD COLUMN IF NOT EXISTS created_by int4 NULL REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_active_end
    ON public.subscriptions(end_date) WHERE status = 'active';
