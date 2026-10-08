-- ============================================================
--  034: Заявки на демо / ранній доступ з публічного лендингу Cluvyra.
--  Зберігаються лише дані, які людина сама ввела у форму.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.early_access_requests (
    id          serial4 PRIMARY KEY,
    name        varchar(100) NOT NULL,
    email       varchar(150) NOT NULL,
    studio_name varchar(150) NULL,
    studio_type varchar(50)  NULL,
    message     text         NULL,
    created_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_early_access_created
    ON public.early_access_requests (created_at DESC);
