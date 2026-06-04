/*
 * Засів демонстраційного розкладу.
 *
 * Додає по одному заняттю на кожен день на 30 днів уперед, починаючи від
 * сьогодні. Послуги чергуються по колу серед активних, час заняття залежить
 * від послуги. Якщо знайдено тренера з відповідною спеціалізацією — його
 * призначають, інакше заняття лишається без тренера.
 *
 * Скрипт ідемпотентний: дні, на які вже є заняття, пропускаються, тож
 * повторний запуск не створює дублів.
 *
 * Запуск:
 *   PGPASSWORD=123654 psql -U postgres -h localhost -d sports_club_db -f db/seed-schedule.sql
 */

with active_workouts as (
  select id,
         name,
         row_number() over (order by id) - 1 as workout_index,
         count(*) over () as workout_count
  from workouts
  where status = 'active'
),
schedule_days as (
  select (current_date + (n - 1)) as day,
         (n - 1) as day_index
  from generate_series(1, 30) as n
)
insert into schedules (workout_id, trainer_id, date, time)
select aw.id,
       tr.id,
       d.day,
       (time '09:00' + (aw.workout_index * interval '2 hours')) as start_time
from schedule_days d
join active_workouts aw
  on aw.workout_index = (d.day_index % aw.workout_count)
left join lateral (
  select t.id
  from trainers t
  where position(lower(aw.name) in lower(coalesce(t.specialization, ''))) > 0
  order by t.id
  limit 1
) tr on true
where not exists (
  select 1
  from schedules s
  where s.date = d.day
);
