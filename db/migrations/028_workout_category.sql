-- ============================================================
--  Міграція 028: Категорія заняття (group/personal) для перевірки
--  сумісності абонемента при бронюванні.
--
--  Проблема: subscription_plans.access_type розрізняє gym/gym_group/
--  group/personal, але жодне поле workouts не визначало, до якої
--  категорії належить конкретне заняття — тому клієнт з разовим
--  відвідуванням залу (access_type='gym') міг вільно записатися на
--  будь-яке групове чи персональне заняття. Бронювання (bookings.js)
--  перевіряло лише статус абонемента і вільні місця, без прив'язки
--  до типу доступу.
--
--  Рішення: явне поле workouts.category визначає тип заняття, а
--  server/utils/booking-logic.js::isBookingAllowedForAccessType()
--  звіряє його з access_type абонемента при кожному бронюванні.
--
--  Бекфіл: існуючі заняття з max_clients = 1 позначаються як
--  'personal' (це усталений спосіб створення персональних занять
--  в адмінці), решта лишається 'group' (значення за замовчуванням).
-- ============================================================

ALTER TABLE public.workouts
    ADD COLUMN IF NOT EXISTS category varchar(20) NOT NULL DEFAULT 'group';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'workouts_category_check'
    ) THEN
        ALTER TABLE public.workouts
            ADD CONSTRAINT workouts_category_check
            CHECK (category IN ('group', 'personal'));
    END IF;
END $$;

-- Бекфіл лише для рядків, які ще не редагували вручну (лишились на дефолті).
UPDATE public.workouts
   SET category = 'personal'
 WHERE max_clients = 1
   AND category = 'group';
