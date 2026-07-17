-- ============================================================
--  Міграція 024: Виправлення за результатами аудиту БД — II.
--
--  П7. chat_conversations.user_id — явний FK для авторизованих діалогів
--      замість парсингу магічного рядка guest_token = 'client-<userId>'.
--      Видалення користувача більше не лишає діалог-сирітку з нечитним
--      токеном; JOIN до users можливий напряму.
--
--  §4. visits.client_id: CASCADE → SET NULL, симетрично до payments —
--      видалення клієнта більше не знищує статистику відвідуваності.
--
--  П5. visits.schedule_id — повертаємо колонку (прибрану міграцією 020 як
--      незаповнювану): db/seed-test.sql і цільова схема (schema_v2.sql)
--      уже покладаються на неї для звʼязку візиту з конкретним заняттям.
--      NULL — звичайний вхід у зал без прив'язки до заняття. Реальний
--      production-код (visits.js) поки що її не заповнює — це підготовка
--      під заплановану функцію авто-відмітки відвідувань, а не її реалізація.
-- ============================================================

-- ─── chat_conversations.user_id ────────────────────────────────
ALTER TABLE public.chat_conversations
    ADD COLUMN IF NOT EXISTS user_id int4 NULL REFERENCES public.users(id) ON DELETE SET NULL;

-- Бекфіл із токенів вигляду 'client-<userId>', лише для існуючих users.
UPDATE public.chat_conversations c
   SET user_id = sub.uid
  FROM (
    SELECT id, (regexp_match(guest_token, '^client-(\d+)$'))[1]::int AS uid
    FROM public.chat_conversations
    WHERE guest_token ~ '^client-\d+$'
  ) sub
 WHERE sub.id = c.id
   AND c.user_id IS NULL
   AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = sub.uid);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_user
    ON public.chat_conversations(user_id);

-- ─── visits.client_id: CASCADE → SET NULL ──────────────────────
ALTER TABLE public.visits ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE public.visits DROP CONSTRAINT IF EXISTS visits_client_id_fkey;
ALTER TABLE public.visits
    ADD CONSTRAINT visits_client_id_fkey FOREIGN KEY (client_id)
    REFERENCES public.clients(id) ON DELETE SET NULL;

-- ─── visits.schedule_id (повернення підготовчої колонки) ───────
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS schedule_id int4 NULL;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'visits_schedule_id_fkey'
    ) THEN
        ALTER TABLE public.visits
            ADD CONSTRAINT visits_schedule_id_fkey FOREIGN KEY (schedule_id)
            REFERENCES public.schedules(id) ON DELETE SET NULL;
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_visits_schedule ON public.visits(schedule_id);
