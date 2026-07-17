-- ============================================================
--  Міграція 026: subscriptions.client_id CASCADE → SET NULL.
--
--  Рішення власника системи (усне уточнення після АУДИТ_БД.md, розділ
--  "Відкриті питання", п.1): видалення клієнта не повинно асиметрично
--  знищувати одну частину його історії (підписки) і зберігати іншу
--  (оплати). У проєкті вже є встановлений патерн для цього — payments
--  (міграція 020) і visits (міграція 024) переживають видалення клієнта
--  через SET NULL, лишаючись у зведеній аналітиці (reports.js: planStats
--  рахує підписки по sp.id, не по клієнту), але зникаючи зі списків,
--  прив'язаних до конкретного клієнта (INNER JOIN clients — так само,
--  як уже поводяться payments.js/GET та subscriptions.js/GET).
--  RESTRICT тут не підійшов би: майже кожен клієнт має підписку, тож
--  видалення клієнта з адмінки перестало б працювати взагалі — це
--  зламало б наявний робочий функціонал.
-- ============================================================

ALTER TABLE public.subscriptions ALTER COLUMN client_id DROP NOT NULL;

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_client_id_fkey;
ALTER TABLE public.subscriptions
    ADD CONSTRAINT subscriptions_client_id_fkey FOREIGN KEY (client_id)
    REFERENCES public.clients(id) ON DELETE SET NULL;
