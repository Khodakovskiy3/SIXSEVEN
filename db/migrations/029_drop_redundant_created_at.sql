-- ============================================================
--  Міграція 029: видалення надлишкових created_at
-- ============================================================
--  clients.created_at і trainers.created_at завжди збігаються з
--  users.created_at (роль присвоюється одразу при реєстрації).
--  Жоден запит їх не читає — підтверджено аудитом 18.07.2026.
-- ============================================================

ALTER TABLE public.clients  DROP COLUMN IF EXISTS created_at;
ALTER TABLE public.trainers DROP COLUMN IF EXISTS created_at;
