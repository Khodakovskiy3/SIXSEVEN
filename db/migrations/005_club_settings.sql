-- Налаштування клубу зберігаються одним рядком (singleton із id = 1).
create table if not exists public.club_settings (
    id      int4 primary key default 1,
    name    varchar(100) not null default 'OLIMP',
    address varchar(255) null,
    phone   varchar(30) null,
    email   varchar(100) null,
    constraint club_settings_singleton check (id = 1)
);

-- Початкові дані клубу; повторний запуск нічого не змінює.
insert into public.club_settings (id, name, address, phone, email)
values (1, 'OLIMP', 'вул. Спортивна, 10, Київ', '+380 44 123 45 67', 'info@olimp.ua')
on conflict (id) do nothing;
