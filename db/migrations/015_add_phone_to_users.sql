-- Додаємо поле phone до таблиці users для зберігання номера адміністратора.
-- Клієнти та тренери залишаються з телефоном у своїх таблицях,
-- але для admin/manager зручно тримати телефон безпосередньо в users.
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS phone varchar(20) NULL;
