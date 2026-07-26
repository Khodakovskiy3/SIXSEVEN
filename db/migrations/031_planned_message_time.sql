-- Час відправлення запланованих розсилок у часовому поясі клубу.
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS send_time time NULL;

-- Старі заплановані повідомлення зберігають колишню поведінку: початок дня.
UPDATE public.messages
SET send_time = '00:00'::time
WHERE status = 'planned' AND send_date IS NOT NULL AND send_time IS NULL;
