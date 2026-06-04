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

INSERT INTO users (name, email, password, role)
VALUES (
    'Адміністратор',
    'admin',
    '$2b$10$Yb1HzGzudDWNLUo1nDObrOtReERMM3vp8skaQ4Z4ecIsohymrOGwG',
    'admin'
)
ON CONFLICT (email) DO UPDATE
    SET password = EXCLUDED.password,
        role     = EXCLUDED.role;

-- Перевірка:
-- SELECT id, name, email, role FROM users WHERE email = 'admin';
