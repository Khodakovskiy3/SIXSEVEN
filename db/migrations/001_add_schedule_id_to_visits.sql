ALTER TABLE public.visits
ADD COLUMN IF NOT EXISTS schedule_id int4;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'visits_schedule_id_fkey'
    ) THEN
        ALTER TABLE public.visits
        ADD CONSTRAINT visits_schedule_id_fkey
        FOREIGN KEY (schedule_id) REFERENCES public.schedules(id) ON DELETE SET NULL;
    END IF;
END $$;
