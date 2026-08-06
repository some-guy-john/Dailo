create extension if not exists pgcrypto;

create table public.wordle_words (
  id uuid primary key default gen_random_uuid(),
  public_key uuid not null unique default gen_random_uuid(),
  normalized_word text not null unique,
  accepted_guess boolean not null default true,
  eligible_answer boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wordle_words_normalized_word_format
    check (normalized_word ~ '^[A-Z]{5}$')
);

create table public.wordle_daily_assignments (
  id uuid primary key default gen_random_uuid(),
  london_date date not null unique,
  answer_word_id uuid not null references public.wordle_words(id),
  status text not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wordle_daily_assignments_status
    check (status in ('draft', 'published', 'archived'))
);

create table public.wordle_game_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  browser_id_hash text,
  mode text not null,
  puzzle_word_id uuid not null references public.wordle_words(id),
  daily_date date,
  status text not null default 'active',
  attempt_count smallint not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null,
  constraint wordle_game_sessions_mode
    check (mode in ('daily', 'unlimited')),
  constraint wordle_game_sessions_status
    check (status in ('active', 'won', 'lost', 'abandoned', 'expired')),
  constraint wordle_game_sessions_attempt_count
    check (attempt_count between 0 and 6),
  constraint wordle_game_sessions_daily_date
    check ((mode = 'daily' and daily_date is not null) or (mode = 'unlimited' and daily_date is null))
);

create table public.wordle_attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.wordle_game_sessions(id) on delete cascade,
  sequence_number smallint not null,
  guess_word text not null,
  tile_result jsonb not null,
  idempotency_key text not null,
  accepted_at timestamptz not null default now(),
  unique (session_id, sequence_number),
  unique (session_id, idempotency_key),
  constraint wordle_attempts_sequence_number
    check (sequence_number between 1 and 6),
  constraint wordle_attempts_guess_word_format
    check (guess_word ~ '^[A-Z]{5}$'),
  constraint wordle_attempts_tile_result
    check (jsonb_typeof(tile_result) = 'array' and jsonb_array_length(tile_result) = 5)
);

create index wordle_words_answer_pool_idx
  on public.wordle_words (eligible_answer, active);

create index wordle_daily_assignments_playable_idx
  on public.wordle_daily_assignments (london_date, status);

create index wordle_game_sessions_browser_date_idx
  on public.wordle_game_sessions (browser_id_hash, daily_date);

create unique index wordle_game_sessions_one_daily_per_browser_idx
  on public.wordle_game_sessions (browser_id_hash, daily_date)
  where browser_id_hash is not null and daily_date is not null;

create index wordle_attempts_session_idx
  on public.wordle_attempts (session_id, sequence_number);

alter table public.wordle_words enable row level security;
alter table public.wordle_daily_assignments enable row level security;
alter table public.wordle_game_sessions enable row level security;
alter table public.wordle_attempts enable row level security;

revoke all on table public.wordle_words from anon, authenticated;
revoke all on table public.wordle_daily_assignments from anon, authenticated;
revoke all on table public.wordle_game_sessions from anon, authenticated;
revoke all on table public.wordle_attempts from anon, authenticated;

create or replace function public.wordle_score_guess(
  p_answer text,
  p_guess text
) returns text[]
language plpgsql
immutable
set search_path = public
as $$
declare
  result text[] := array['absent', 'absent', 'absent', 'absent', 'absent'];
  remaining jsonb := '{}'::jsonb;
  letter text;
  available integer;
  index integer;
begin
  for index in 1..5 loop
    if substr(p_guess, index, 1) = substr(p_answer, index, 1) then
      result[index] := 'correct';
    else
      letter := substr(p_answer, index, 1);
      remaining := jsonb_set(
        remaining,
        array[letter],
        to_jsonb(coalesce((remaining ->> letter)::integer, 0) + 1),
        true
      );
    end if;
  end loop;

  for index in 1..5 loop
    if result[index] <> 'correct' then
      letter := substr(p_guess, index, 1);
      available := coalesce((remaining ->> letter)::integer, 0);
      if available > 0 then
        result[index] := 'present';
        remaining := jsonb_set(remaining, array[letter], to_jsonb(available - 1), true);
      end if;
    end if;
  end loop;

  return result;
end;
$$;

create or replace function public.wordle_submit_guess(
  p_token_hash text,
  p_guess text,
  p_expected_attempt smallint,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.wordle_game_sessions%rowtype;
  answer_word text;
  result text[];
  next_status text;
  existing_attempt public.wordle_attempts%rowtype;
begin
  select *
  into session_row
  from public.wordle_game_sessions
  where token_hash = p_token_hash
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'invalid_session';
  end if;

  select *
  into existing_attempt
  from public.wordle_attempts
  where session_id = session_row.id
    and idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'sessionId', session_row.id,
      'status', session_row.status,
      'attemptCount', session_row.attempt_count,
      'attempt', jsonb_build_object(
        'guess', existing_attempt.guess_word,
        'result', existing_attempt.tile_result
      ),
      'answer', case when session_row.status in ('won', 'lost')
        then (select normalized_word from public.wordle_words where id = session_row.puzzle_word_id)
        else null end
    );
  end if;

  if session_row.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'game_already_complete';
  end if;

  if session_row.expires_at < now() then
    update public.wordle_game_sessions
    set status = 'expired'
    where id = session_row.id;
    raise exception using errcode = 'P0001', message = 'expired_session';
  end if;

  if p_expected_attempt <> session_row.attempt_count + 1 then
    raise exception using errcode = 'P0001', message = 'attempt_sequence_conflict';
  end if;

  p_guess := upper(trim(p_guess));
  if p_guess !~ '^[A-Z]{5}$' then
    raise exception using errcode = 'P0001', message = 'invalid_guess_format';
  end if;

  if not exists (
    select 1
    from public.wordle_words
    where normalized_word = p_guess
      and accepted_guess
      and active
  ) then
    raise exception using errcode = 'P0001', message = 'guess_not_in_accepted_list';
  end if;

  select normalized_word
  into answer_word
  from public.wordle_words
  where id = session_row.puzzle_word_id
    and active;

  if answer_word is null then
    raise exception using errcode = 'P0001', message = 'puzzle_unavailable';
  end if;

  result := public.wordle_score_guess(answer_word, p_guess);
  next_status := case
    when result = array['correct', 'correct', 'correct', 'correct', 'correct'] then 'won'
    when session_row.attempt_count + 1 >= 6 then 'lost'
    else 'active'
  end;

  insert into public.wordle_attempts (
    session_id,
    sequence_number,
    guess_word,
    tile_result,
    idempotency_key
  ) values (
    session_row.id,
    session_row.attempt_count + 1,
    p_guess,
    to_jsonb(result),
    p_idempotency_key
  );

  update public.wordle_game_sessions
  set attempt_count = session_row.attempt_count + 1,
      status = next_status,
      completed_at = case when next_status <> 'active' then now() else null end
  where id = session_row.id;

  return jsonb_build_object(
    'sessionId', session_row.id,
    'status', next_status,
    'attemptCount', session_row.attempt_count + 1,
    'attempt', jsonb_build_object('guess', p_guess, 'result', to_jsonb(result)),
    'answer', case when next_status in ('won', 'lost') then answer_word else null end
  );
end;
$$;

revoke execute on function public.wordle_score_guess(text, text) from public, anon, authenticated;
revoke execute on function public.wordle_submit_guess(text, text, smallint, text) from public, anon, authenticated;
grant execute on function public.wordle_submit_guess(text, text, smallint, text) to service_role;
