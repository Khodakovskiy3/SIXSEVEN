-- Нотатки тренера по клієнту (тільки тренер, який створив, бачить свої нотатки)
create table if not exists trainer_client_notes (
  id          serial primary key,
  trainer_id  integer not null references trainers(id) on delete cascade,
  client_id   integer not null references clients(id) on delete cascade,
  note        text not null default '',
  updated_at  timestamptz not null default now(),
  unique (trainer_id, client_id)
);
