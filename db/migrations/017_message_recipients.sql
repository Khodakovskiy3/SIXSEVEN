-- Адресні сповіщення конкретним користувачам.
--
-- Досі повідомлення розсилалися лише широким аудиторіям (clients/trainers/all).
-- Додаємо audience='custom': такі повідомлення бачать тільки користувачі,
-- перелічені у message_recipients. Це вмикає і системні сповіщення
-- (наданий абонемент, перенесене заняття, новий запис до тренера),
-- і вибір конкретних отримувачів у формі адміністратора.
--
-- Файл ідемпотентний: DROP+ADD constraint і IF NOT EXISTS дозволяють
-- запускати його при кожному старті сервера.

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_audience_check;
ALTER TABLE messages ADD CONSTRAINT messages_audience_check
    CHECK ((audience)::text = ANY (ARRAY['clients', 'trainers', 'all', 'custom']::text[]));

CREATE TABLE IF NOT EXISTS message_recipients (
    message_id int4 NOT NULL,
    user_id    int4 NOT NULL,
    PRIMARY KEY (message_id, user_id),
    CONSTRAINT message_recipients_message_id_fkey FOREIGN KEY (message_id)
        REFERENCES messages(id) ON DELETE CASCADE,
    CONSTRAINT message_recipients_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE
);

-- Вибірка сповіщень іде за користувачем — без цього індексу кожен полінг
-- дзвіночка сканував би таблицю повністю.
CREATE INDEX IF NOT EXISTS idx_message_recipients_user ON message_recipients(user_id);
