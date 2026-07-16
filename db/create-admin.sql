-- ============================================================
--  Створення облікового запису адміністратора
--  Логін (email):  admin
--  Пароль:         admin123   (зберігається як bcrypt-хеш)
--
--  Виконати у DBeaver, ОБОВ'ЯЗКОВО у базі sports_club_db
--  (вгорі має бути public@sports_club_db, а не public@postgres).
--
--  Адміністратор не має записів у clients/trainers — лише в users.
--  Далі він сам створює тренерів/керівників через адмін-панель.
-- ============================================================

-- Для ролі admin двофакторна автентифікація обов'язкова (twofa_enabled = true).
INSERT INTO users (name, email, password, role, twofa_enabled)
VALUES (
    'Адміністратор',
    'admin',
    '$2b$10$Yb1HzGzudDWNLUo1nDObrOtReERMM3vp8skaQ4Z4ecIsohymrOGwG',
    'admin',
    true
)
ON CONFLICT (email) DO UPDATE
    SET password      = EXCLUDED.password,
        role          = EXCLUDED.role,
        twofa_enabled = true;

-- Перевірка:
-- SELECT id, name, email, role FROM users WHERE email = 'admin';
