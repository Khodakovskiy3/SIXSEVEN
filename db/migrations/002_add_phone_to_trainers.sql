ALTER TABLE public.trainers
ADD COLUMN IF NOT EXISTS phone varchar(20) NULL;
