with ranked as (
  select
    id,
    row_number() over (
      partition by
        location_id,
        lesson_date,
        lower(trim(instructor_name)),
        lower(trim(lesson_category)),
        num_lessons,
        lower(trim(coalesce(payment_type, ''))),
        price_unit
      order by created_at asc, id asc
    ) as rn
  from public.instructor_lessons
)
delete from public.instructor_lessons
where id in (
  select id
  from ranked
  where rn > 1
);

create unique index if not exists idx_instructor_lessons_dedupe
on public.instructor_lessons (
  location_id,
  lesson_date,
  lower(trim(instructor_name)),
  lower(trim(lesson_category)),
  num_lessons,
  lower(trim(coalesce(payment_type, ''))),
  price_unit
);
