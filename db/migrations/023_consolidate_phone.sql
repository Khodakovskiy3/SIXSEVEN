-- ============================================================
--  Міграція 023: Консолідація телефону в users.phone (П1, АУДИТ_БД.md).
--
--  Раніше телефон зберігався у ТРЬОХ місцях: users.phone (адмін/менеджер,
--  міграція 015), clients.phone, trainers.phone. Це вже спричиняло активний
--  баг: reports.js читав u.phone для тренерів, а реальний телефон лежав
--  у trainers.phone, тож звіт по тренерах показував порожнє поле.
--
--  Крок 1 — переносимо наявні дані в users.phone (лише де там ще NULL,
--  щоб не затерти телефон адміністратора/менеджера, якщо він уже є).
--  Крок 2 — прибираємо дублікатні колонки. Код (clients.js, trainers.js,
--  users.js, auth.js) оновлено в цьому ж коміті, тож розбіжності між
--  БД і кодом не буде.
-- ============================================================

-- Бекфіл — лише якщо колонка-джерело ще існує (migrate.js виконує всі файли
-- при кожному старті сервера, тож на другому запуску clients.phone/
-- trainers.phone вже видалені попереднім запуском цієї ж міграції).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'phone'
    ) THEN
        UPDATE public.users u
           SET phone = c.phone
          FROM public.clients c
         WHERE c.user_id = u.id
           AND u.phone IS NULL
           AND c.phone IS NOT NULL;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'trainers' AND column_name = 'phone'
    ) THEN
        UPDATE public.users u
           SET phone = t.phone
          FROM public.trainers t
         WHERE t.user_id = u.id
           AND u.phone IS NULL
           AND t.phone IS NOT NULL;
    END IF;
END $$;

ALTER TABLE public.clients  DROP COLUMN IF EXISTS phone;
ALTER TABLE public.trainers DROP COLUMN IF EXISTS phone;
