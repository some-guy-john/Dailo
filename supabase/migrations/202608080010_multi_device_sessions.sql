create table public.wordle_game_session_tokens (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.wordle_game_sessions(id) on delete cascade,
  token_hash text not null unique,
  browser_id_hash text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create index wordle_game_session_tokens_session_idx
  on public.wordle_game_session_tokens (session_id);

alter table public.wordle_game_session_tokens enable row level security;
revoke all on table public.wordle_game_session_tokens from anon, authenticated;

create table public.connections_game_session_tokens (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.connections_game_sessions(id) on delete cascade,
  token_hash text not null unique,
  browser_id_hash text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create index connections_game_session_tokens_session_idx
  on public.connections_game_session_tokens (session_id);

alter table public.connections_game_session_tokens enable row level security;
revoke all on table public.connections_game_session_tokens from anon, authenticated;

create or replace function public.wordle_session_id_for_token(p_token_hash text)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from public.wordle_game_sessions where token_hash = p_token_hash
  union all
  select session_id from public.wordle_game_session_tokens where token_hash = p_token_hash
  limit 1;
$$;

create or replace function public.connections_session_id_for_token(p_token_hash text)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from public.connections_game_sessions where token_hash = p_token_hash
  union all
  select session_id from public.connections_game_session_tokens where token_hash = p_token_hash
  limit 1;
$$;

create or replace function public.wordle_claim_or_find_session(
  p_session_id uuid,
  p_auth_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.wordle_game_sessions%rowtype;
  existing_id uuid;
begin
  select * into session_row from public.wordle_game_sessions where id = p_session_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'invalid_session'; end if;
  if session_row.auth_user_id is not null then
    if session_row.auth_user_id <> p_auth_user_id then raise exception using errcode = 'P0001', message = 'invalid_session'; end if;
    return session_row.id;
  end if;

  if session_row.daily_date is not null then
    select id into existing_id from public.wordle_game_sessions
    where auth_user_id = p_auth_user_id
      and daily_date = session_row.daily_date
      and mode = session_row.mode
      and id <> session_row.id
    for update;
    if existing_id is not null then return existing_id; end if;
  end if;

  update public.wordle_game_sessions set auth_user_id = p_auth_user_id where id = session_row.id;
  return session_row.id;
end;
$$;

create or replace function public.connections_claim_or_find_session(
  p_session_id uuid,
  p_auth_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.connections_game_sessions%rowtype;
  existing_id uuid;
begin
  select * into session_row from public.connections_game_sessions where id = p_session_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'invalid_session'; end if;
  if session_row.auth_user_id is not null then
    if session_row.auth_user_id <> p_auth_user_id then raise exception using errcode = 'P0001', message = 'invalid_session'; end if;
    return session_row.id;
  end if;

  select id into existing_id from public.connections_game_sessions
  where auth_user_id = p_auth_user_id
    and london_date = session_row.london_date
    and mode = session_row.mode
    and id <> session_row.id
  for update;
  if existing_id is not null then return existing_id; end if;

  update public.connections_game_sessions set auth_user_id = p_auth_user_id where id = session_row.id;
  return session_row.id;
end;
$$;

create or replace function public.connections_expire_session(p_token_hash text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.connections_game_sessions%rowtype;
begin
  select * into session_row
  from public.connections_game_sessions
  where id = public.connections_session_id_for_token(p_token_hash)
  for update;

  if not found then return 'invalid'; end if;
  if session_row.status = 'active' and session_row.expires_at <= now() then
    update public.connections_game_sessions
    set status = 'expired', completed_at = now()
    where id = session_row.id;
    return 'expired';
  end if;
  return session_row.status;
end;
$$;

create or replace function public.connections_submit_guess(
  p_token_hash text,
  p_selected_words jsonb,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.connections_game_sessions%rowtype;
  puzzle_row public.connections_daily_puzzles%rowtype;
  existing_attempt public.connections_attempts%rowtype;
  selected text[];
  canonical text[];
  group_row jsonb;
  matching_group jsonb;
  one_away boolean := false;
  overlap integer;
  next_status text;
  next_mistakes integer;
  solved jsonb;
  group_key text;
begin
  select * into session_row
  from public.connections_game_sessions
  where id = public.connections_session_id_for_token(p_token_hash)
  for update;

  if not found then raise exception using errcode = 'P0001', message = 'invalid_session'; end if;

  select * into existing_attempt from public.connections_attempts
  where session_id = session_row.id and idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('result', existing_attempt.result, 'group', existing_attempt.group_data); end if;

  if session_row.status = 'active' and session_row.expires_at <= now() then
    update public.connections_game_sessions set status = 'expired', completed_at = now() where id = session_row.id;
    return jsonb_build_object('error', 'expired_session');
  end if;

  if jsonb_typeof(p_selected_words) <> 'array'
     or jsonb_array_length(p_selected_words) <> 4
     or exists (select 1 from jsonb_array_elements(p_selected_words) item where jsonb_typeof(item) <> 'string')
     or (select count(distinct upper(btrim(value))) from jsonb_array_elements_text(p_selected_words) value) <> 4 then
    raise exception using errcode = 'P0001', message = 'invalid_selection';
  end if;

  selected := array(select upper(btrim(value)) from jsonb_array_elements_text(p_selected_words) value);
  canonical := (select array_agg(value order by value) from unnest(selected) value);
  select * into existing_attempt from public.connections_attempts attempt
  where attempt.session_id = session_row.id
    and (select array_agg(value order by value) from jsonb_array_elements_text(attempt.selected_words) value) = canonical
  limit 1;
  if found then return jsonb_build_object('result', existing_attempt.result, 'group', existing_attempt.group_data); end if;

  if session_row.status <> 'active' then raise exception using errcode = 'P0001', message = 'game_already_complete'; end if;
  select * into puzzle_row from public.connections_daily_puzzles where id = session_row.puzzle_id;
  if puzzle_row.id is null then raise exception using errcode = 'P0001', message = 'puzzle_unavailable'; end if;
  if not (puzzle_row.words @> to_jsonb(selected)) then raise exception using errcode = 'P0001', message = 'invalid_selection'; end if;

  for group_row in select value from jsonb_array_elements(puzzle_row.groups)
  loop
    overlap := (select count(*) from unnest(selected) word where group_row->'words' @> to_jsonb(array[word]));
    if overlap = 4 then matching_group := group_row; end if;
    if overlap = 3 then one_away := true; end if;
  end loop;

  if matching_group is not null then
    group_key := matching_group->>'key';
    if session_row.solved_groups ? group_key then raise exception using errcode = 'P0001', message = 'group_already_solved'; end if;
    solved := session_row.solved_groups || jsonb_build_array(group_key);
    next_status := case when jsonb_array_length(solved) = 4 then 'won' else 'active' end;
    next_mistakes := session_row.mistake_count;
  else
    solved := session_row.solved_groups;
    next_mistakes := session_row.mistake_count + 1;
    next_status := case when next_mistakes >= 4 then 'lost' else 'active' end;
  end if;

  insert into public.connections_attempts (session_id, sequence_number, selected_words, result, group_data, idempotency_key)
  values (session_row.id, (select coalesce(max(sequence_number), 0) + 1 from public.connections_attempts where session_id = session_row.id),
    to_jsonb(selected), case when matching_group is not null then 'correct' when one_away then 'one-away' else 'incorrect' end,
    matching_group, p_idempotency_key);

  update public.connections_game_sessions
  set mistake_count = next_mistakes, solved_groups = solved, status = next_status,
      completed_at = case when next_status <> 'active' then now() else null end
  where id = session_row.id;

  return jsonb_build_object('result', case when matching_group is not null then 'correct' when one_away then 'one-away' else 'incorrect' end, 'group', matching_group);
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
  select * into session_row
  from public.wordle_game_sessions
  where id = public.wordle_session_id_for_token(p_token_hash)
  for update;
  if not found then raise exception using errcode = 'P0001', message = 'invalid_session'; end if;

  select * into existing_attempt from public.wordle_attempts
  where session_id = session_row.id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('sessionId', session_row.id, 'status', session_row.status, 'attemptCount', session_row.attempt_count,
      'attempt', jsonb_build_object('guess', existing_attempt.guess_word, 'result', existing_attempt.tile_result),
      'answer', case when session_row.status in ('won', 'lost') then (select normalized_word from public.wordle_words where id = session_row.puzzle_word_id) else null end);
  end if;

  if session_row.status <> 'active' then raise exception using errcode = 'P0001', message = 'game_already_complete'; end if;
  if session_row.expires_at < now() then
    update public.wordle_game_sessions set status = 'expired', completed_at = now() where id = session_row.id;
    raise exception using errcode = 'P0001', message = 'expired_session';
  end if;
  if p_expected_attempt <> session_row.attempt_count + 1 then raise exception using errcode = 'P0001', message = 'attempt_sequence_conflict'; end if;

  p_guess := upper(trim(p_guess));
  if p_guess !~ '^[A-Z]{5}$' then raise exception using errcode = 'P0001', message = 'invalid_guess_format'; end if;
  if not exists (select 1 from public.wordle_words where normalized_word = p_guess and accepted_guess and active) then
    raise exception using errcode = 'P0001', message = 'guess_not_in_accepted_list';
  end if;
  select normalized_word into answer_word from public.wordle_words where id = session_row.puzzle_word_id and active;
  if answer_word is null then raise exception using errcode = 'P0001', message = 'puzzle_unavailable'; end if;

  result := public.wordle_score_guess(answer_word, p_guess);
  next_status := case when result = array['correct', 'correct', 'correct', 'correct', 'correct'] then 'won' when session_row.attempt_count + 1 >= 6 then 'lost' else 'active' end;
  insert into public.wordle_attempts (session_id, sequence_number, guess_word, tile_result, idempotency_key)
  values (session_row.id, session_row.attempt_count + 1, p_guess, to_jsonb(result), p_idempotency_key);
  update public.wordle_game_sessions
  set attempt_count = session_row.attempt_count + 1, status = next_status,
      completed_at = case when next_status <> 'active' then now() else null end
  where id = session_row.id;
  return jsonb_build_object('sessionId', session_row.id, 'status', next_status, 'attemptCount', session_row.attempt_count + 1,
    'attempt', jsonb_build_object('guess', p_guess, 'result', to_jsonb(result)),
    'answer', case when next_status in ('won', 'lost') then answer_word else null end);
end;
$$;

revoke all on function public.wordle_session_id_for_token(text) from public, anon, authenticated;
revoke all on function public.connections_session_id_for_token(text) from public, anon, authenticated;
grant execute on function public.wordle_session_id_for_token(text) to service_role;
grant execute on function public.connections_session_id_for_token(text) to service_role;
revoke all on function public.wordle_claim_or_find_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.connections_claim_or_find_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.wordle_claim_or_find_session(uuid, uuid) to service_role;
grant execute on function public.connections_claim_or_find_session(uuid, uuid) to service_role;
