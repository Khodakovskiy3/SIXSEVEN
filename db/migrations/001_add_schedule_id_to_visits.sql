ALTER TABLE public.visits
ADD COLUMN IF NOT EXISTS schedule_id int4;

ALTER TABLE public.visits
ADD CONSTRAINT visits_schedule_id_fkey
FOREIGN KEY (schedule_id) REFERENCES public.schedules(id) ON DELETE SET NULL;
