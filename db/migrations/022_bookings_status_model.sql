-- ============================================================
--  Міграція 022: Статусна модель бронювань (П2, АУДИТ_БД.md).
--
--  Раніше скасування бронювання клієнтом було фізичним DELETE —
--  історія (хто записувався і скасовував) знищувалась. Код уже фільтрує
--  підрахунок місць через status='active' (bookings.js, booking-logic.js),
--  тож зміна лише додає стан 'cancelled', що переживає скасування.
--
--  UNIQUE(client_id, schedule_id) замінюється частковим унікальним
--  індексом WHERE status='active', щоб клієнт міг записатися повторно
--  після скасування (раніше повторний INSERT впав би на старому UNIQUE,
--  бо скасований рядок більше не видаляється).
-- ============================================================

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'bookings_client_id_schedule_id_key'
    ) THEN
        ALTER TABLE public.bookings DROP CONSTRAINT bookings_client_id_schedule_id_key;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_unique
    ON public.bookings(client_id, schedule_id) WHERE status = 'active';

-- client_id раніше покривався префіксом старого UNIQUE-обмеження;
-- після його заміни частковим індексом потрібен явний індекс.
CREATE INDEX IF NOT EXISTS idx_bookings_client ON public.bookings(client_id);
