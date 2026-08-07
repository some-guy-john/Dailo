insert into public.wordle_words (normalized_word, accepted_guess, eligible_answer, active)
values
  ('CRANE', true, true, true),
  ('BLUSH', true, true, true),
  ('MERCY', true, true, true),
  ('SHELF', true, true, true),
  ('TRAIL', true, true, true),
  ('CROWN', true, true, true),
  ('LIGHT', true, true, true),
  ('PRIDE', true, true, true),
  ('OCEAN', true, true, true),
  ('GRACE', true, true, true)
on conflict (normalized_word) do nothing;

insert into public.wordle_daily_assignments (london_date, answer_word_id, status, published_at)
select date '2026-08-07', id, 'published', now()
from public.wordle_words
where normalized_word = 'CRANE'
  and not exists (
    select 1
    from public.wordle_daily_assignments
    where london_date = date '2026-08-07'
  );
