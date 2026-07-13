-- Додаємо поле вправ до нотаток тренера по клієнту
alter table trainer_client_notes
  add column if not exists exercises text not null default '';
