begin;

select plan(32);

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

select throws_ok(
  $$ select public.wordle_submit_guess('missing-token'::text, 'CRANE'::text, 1::smallint, 'missing-key'::text) $$,
  'P0001',
  'invalid_session',
  'Wordo rejects unknown session tokens'
);

select throws_ok(
  $$ select public.connections_submit_guess('missing-token', '["APPLE", "MANGO", "PEAR", "PLUM"]'::jsonb, 'missing-key') $$,
  'P0001',
  'invalid_session',
  'Connections rejects unknown session tokens'
);

select throws_ok(
  $$ select public.wordle_claim_or_find_session(gen_random_uuid(), gen_random_uuid()) $$,
  'P0001',
  'invalid_session',
  'Wordo ownership claims reject missing sessions'
);

select throws_ok(
  $$ select public.connections_claim_or_find_session(gen_random_uuid(), gen_random_uuid()) $$,
  'P0001',
  'invalid_session',
  'Connections ownership claims reject missing sessions'
);

select throws_ok(
  $$ select public.wordle_versus_concede('missing-token') $$,
  'P0001',
  'invalid_participant',
  'Versus rejects unknown participant tokens'
);

select is(
  public.wordle_versus_expire(gen_random_uuid())->>'status',
  'missing',
  'Versus expiry is safe for missing matches'
);

select ok(
  public.wordle_session_id_for_token('missing-token') is null,
  'Wordo token lookup does not resolve unknown tokens'
);

select ok(
  public.connections_session_id_for_token('missing-token') is null,
  'Connections token lookup does not resolve unknown tokens'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'wordle_game_sessions_one_user_date_mode_idx'
      and indexdef ilike 'create unique%'
  ),
  'Wordo enforces one authenticated session per date and mode'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'connections_game_sessions_one_user_date_mode_idx'
      and indexdef ilike 'create unique%'
  ),
  'Connections enforces one authenticated session per daily date'
);

select ok(
  has_function_privilege('anon', 'public.wordle_claim_or_find_session(uuid,uuid)', 'EXECUTE') = false
    and has_function_privilege('authenticated', 'public.wordle_claim_or_find_session(uuid,uuid)', 'EXECUTE') = false
    and has_function_privilege('anon', 'public.connections_claim_or_find_session(uuid,uuid)', 'EXECUTE') = false
    and has_function_privilege('authenticated', 'public.connections_claim_or_find_session(uuid,uuid)', 'EXECUTE') = false,
  'Authenticated session ownership RPCs are service-role only'
);

select ok(
  has_function_privilege('anon', 'public.wordle_versus_concede(text)', 'EXECUTE') = false
    and has_function_privilege('authenticated', 'public.wordle_versus_concede(text)', 'EXECUTE') = false
    and has_function_privilege('anon', 'public.wordle_versus_expire(uuid)', 'EXECUTE') = false
    and has_function_privilege('authenticated', 'public.wordle_versus_expire(uuid)', 'EXECUTE') = false,
  'Versus lifecycle RPCs are service-role only'
);

select ok(
  has_table_privilege('anon', 'public.wordle_game_session_tokens', 'SELECT') = false
    and has_table_privilege('authenticated', 'public.wordle_game_session_tokens', 'SELECT') = false
    and has_table_privilege('anon', 'public.connections_game_session_tokens', 'SELECT') = false
    and has_table_privilege('authenticated', 'public.connections_game_session_tokens', 'SELECT') = false,
  'Cross-device capability tables are not readable by browser roles'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.wordle_attempts'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%idempotency_key%'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = 'public.connections_attempts'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%idempotency_key%'
  ),
  'Wordo and Connections attempts enforce idempotency uniqueness'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.wordle_game_sessions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%attempt_count%>= 0%'
      and pg_get_constraintdef(oid) ilike '%attempt_count%<= 6%'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = 'public.connections_game_sessions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%mistake_count%>= 0%'
      and pg_get_constraintdef(oid) ilike '%mistake_count%<= 4%'
  ),
  'Game lifecycle counters remain bounded by database constraints'
);

select ok(
  has_function_privilege('anon', 'public.protect_wordle_daily_assignment()', 'EXECUTE') = false
    and has_function_privilege('authenticated', 'public.protect_wordle_daily_assignment()', 'EXECUTE') = false
    and has_function_privilege('anon', 'public.protect_connections_published_content()', 'EXECUTE') = false
    and has_function_privilege('authenticated', 'public.protect_connections_published_content()', 'EXECUTE') = false,
  'Content protection trigger functions are not callable by browser roles'
);

select ok(
  has_table_privilege('anon', 'public.dailo_rate_limits', 'SELECT') = false
    and has_table_privilege('authenticated', 'public.dailo_rate_limits', 'SELECT') = false,
  'Rate-limit buckets are not readable by browser roles'
);

insert into public.dailo_rate_limits (bucket_key, window_started_at, request_count, updated_at)
values
  ('stale-cleanup-test', now() - interval '3 days', 1, now() - interval '3 days'),
  ('fresh-cleanup-test', now(), 1, now());

select is(
  public.dailo_cleanup_rate_limits(now() - interval '2 days'),
  1,
  'Rate-limit cleanup removes stale buckets'
);

select ok(
  not exists (select 1 from public.dailo_rate_limits where bucket_key = 'stale-cleanup-test')
    and exists (select 1 from public.dailo_rate_limits where bucket_key = 'fresh-cleanup-test'),
  'Rate-limit cleanup preserves current buckets'
);

select ok(
  has_function_privilege('anon', 'public.dailo_cleanup_rate_limits(timestamp with time zone)', 'EXECUTE') = false
    and has_function_privilege('authenticated', 'public.dailo_cleanup_rate_limits(timestamp with time zone)', 'EXECUTE') = false,
  'Rate-limit cleanup is not callable by browser roles'
);

select throws_ok(
  $$ select public.dailo_create_connections_draft(
    gen_random_uuid(),
    date '2099-01-02',
    '["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"]'::jsonb,
    '[
      {"key":"first","label":"First","difficulty":1,"words":["A","B","C","D"]},
      {"key":"second","label":"Second","difficulty":2,"words":["E","F","G","H"]},
      {"key":"third","label":"Third","difficulty":3,"words":["I","J","K","L"]},
      {"key":"fourth","label":"Fourth","difficulty":4,"words":["M","N","O","P"]}
    ]'::jsonb
  ) $$,
  '23503',
  null,
  'Admin draft creation rejects an unknown audit user'
);

select is(
  (select count(*)::integer from public.connections_daily_puzzles where london_date = date '2099-01-02'),
  0,
  'Failed admin draft creation rolls back the puzzle insert'
);

insert into public.connections_daily_puzzles (london_date, words, groups, status)
values (
  date '2099-01-03',
  '["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"]'::jsonb,
  '[
    {"key":"first","label":"First","difficulty":1,"words":["A","B","C","D"]},
    {"key":"second","label":"Second","difficulty":2,"words":["E","F","G","H"]},
    {"key":"third","label":"Third","difficulty":3,"words":["I","J","K","L"]},
    {"key":"fourth","label":"Fourth","difficulty":4,"words":["M","N","O","P"]}
  ]'::jsonb,
  'draft'
);

select throws_ok(
  $$ select public.dailo_publish_connections(gen_random_uuid(), date '2099-01-03') $$,
  '23503',
  null,
  'Admin publication rejects an unknown audit user'
);

select is(
  (select status from public.connections_daily_puzzles where london_date = date '2099-01-03'),
  'draft',
  'Failed admin publication rolls back the status update'
);

select * from finish();
rollback;
