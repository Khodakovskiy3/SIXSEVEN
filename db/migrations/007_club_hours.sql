-- Години роботи клубу зберігаються разом з рештою налаштувань клубу.
alter table public.club_settings
add column if not exists weekday_hours varchar(50) not null default '07:00 - 22:00';

alter table public.club_settings
add column if not exists weekend_hours varchar(50) not null default '09:00 - 20:00';
