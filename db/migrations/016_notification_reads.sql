-- Відстеження прочитаних оголошень по кожному користувачу.
-- Дозволяє показувати лічильник непрочитаних і ховати крапку після прочитання.

create table if not exists public.notification_reads (
    id         serial4 primary key,
    message_id integer not null
        references public.messages(id) on delete cascade,
    user_id    integer not null
        references public.users(id) on delete cascade,
    read_at    timestamp not null default now(),
    constraint notification_reads_unique unique (message_id, user_id)
);

create index if not exists notification_reads_user_idx
    on public.notification_reads (user_id);
