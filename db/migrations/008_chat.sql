-- Живий чат «гість ↔ адміністратор».
--
-- Гість неавторизований, тож ідентифікується випадковим токеном (UUID),
-- який зберігається в localStorage браузера. Один токен — один діалог.
-- Адміністратор відповідає з окремої сторінки під простим паролем.

create table if not exists public.chat_conversations (
    id          serial4 primary key,
    guest_token varchar(64) not null unique,   -- UUID гостя з localStorage
    guest_name  varchar(120) null,             -- опційно, на майбутнє
    created_at  timestamp not null default now(),
    updated_at  timestamp not null default now()
);

create table if not exists public.chat_messages (
    id              serial4 primary key,
    conversation_id int4 not null references public.chat_conversations(id) on delete cascade,
    sender          varchar(10) not null,      -- 'guest' | 'admin'
    body            text not null,
    created_at      timestamp not null default now(),
    read_by_admin   boolean not null default false,
    constraint chat_messages_sender_check
        check ((sender)::text = any (array['guest','admin']::text[]))
);

create index if not exists idx_chat_messages_conversation
    on public.chat_messages(conversation_id, id);
