begin;

select plan(8);

select is(
  public.wordle_score_guess('CRANE', 'CRATE'),
  array['correct', 'correct', 'correct', 'absent', 'correct'],
  'Wordo scoring preserves repeated-position semantics'
);

select is(
  public.dailo_consume_rate_limit('pg_tap_rate_limit', 2, 60),
  true,
  'First rate-limit request is allowed'
);

select is(
  public.dailo_consume_rate_limit('pg_tap_rate_limit', 2, 60),
  true,
  'Second rate-limit request is allowed'
);

select is(
  public.dailo_consume_rate_limit('pg_tap_rate_limit', 2, 60),
  false,
  'Requests over the rate limit are rejected'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'wordle_daily_assignments_protect_published'
      and not tgisinternal
  ),
  'Wordo assignment immutability trigger exists'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'connections_daily_puzzles_protect_published'
      and not tgisinternal
  ),
  'Connections immutability trigger exists'
);

select ok(
  has_function_privilege('anon', 'public.protect_wordle_daily_assignment()', 'EXECUTE') = false
    and has_function_privilege('authenticated', 'public.protect_wordle_daily_assignment()', 'EXECUTE') = false,
  'Wordo trigger function is not callable by browser roles'
);

select ok(
  has_function_privilege('anon', 'public.dailo_consume_rate_limit(text,integer,integer)', 'EXECUTE') = false
    and has_function_privilege('authenticated', 'public.dailo_consume_rate_limit(text,integer,integer)', 'EXECUTE') = false,
  'Rate-limit RPC is not callable by browser roles'
);

select * from finish();
rollback;
