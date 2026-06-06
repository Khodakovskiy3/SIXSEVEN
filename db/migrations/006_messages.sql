-- Оголошення (розсилки) адміністратора клієнтам або тренерам.
create table if not exists public.messages (
    id         serial4 primary key,
    subject    varchar(150) not null,
    body       text null,
    audience   varchar(20) not null default 'clients',
    status     varchar(20) not null default 'sent',
    send_date  date null,
    created_at timestamp not null default now(),
    constraint messages_audience_check check (
        (audience)::text = any (array['clients','trainers','all']::text[])
    ),
    constraint messages_status_check check (
        (status)::text = any (array['sent','planned']::text[])
    )
);
