-- Антропометрія клієнта (кожен запис — окремий вимір у часі)
create table if not exists client_anthropometry (
  id         serial primary key,
  client_id  integer not null references clients(id) on delete cascade,
  recorded_at date not null default current_date,
  weight     numeric(5,1),   -- кг
  height     numeric(5,1),   -- см
  chest      numeric(5,1),   -- груди, см
  waist      numeric(5,1),   -- талія, см
  hips       numeric(5,1),   -- стегна, см
  bicep      numeric(5,1),   -- біцепс, см
  thigh      numeric(5,1),   -- стегно, см
  note       text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists client_anthropometry_client_idx
  on client_anthropometry(client_id, recorded_at desc);
