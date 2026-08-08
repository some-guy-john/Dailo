create or replace function public.protect_wordle_daily_assignment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('published', 'archived') then
      raise exception using errcode = 'P0001', message = 'published_assignment_is_immutable';
    end if;
    return old;
  end if;

  if old.status = 'archived' then
    raise exception using errcode = 'P0001', message = 'archived_assignment_is_immutable';
  end if;

  if old.status in ('published', 'archived')
     and (new.london_date, new.answer_word_id) is distinct from (old.london_date, old.answer_word_id) then
    raise exception using errcode = 'P0001', message = 'published_assignment_is_immutable';
  end if;

  if old.status = 'published' and new.status not in ('published', 'archived') then
    raise exception using errcode = 'P0001', message = 'published_assignment_cannot_be_draft';
  end if;

  return new;
end;
$$;

drop trigger if exists wordle_daily_assignments_protect_published on public.wordle_daily_assignments;
create trigger wordle_daily_assignments_protect_published
before update or delete on public.wordle_daily_assignments
for each row execute function public.protect_wordle_daily_assignment();

create or replace function public.protect_wordle_referenced_word()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.normalized_word is distinct from new.normalized_word
     and (
       exists (select 1 from public.wordle_daily_assignments where answer_word_id = old.id)
       or exists (select 1 from public.wordle_game_sessions where puzzle_word_id = old.id)
       or exists (select 1 from public.wordle_versus_matches where puzzle_word_id = old.id)
     ) then
    raise exception using errcode = 'P0001', message = 'referenced_word_is_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists wordle_words_protect_referenced on public.wordle_words;
create trigger wordle_words_protect_referenced
before update on public.wordle_words
for each row execute function public.protect_wordle_referenced_word();

create or replace function public.protect_connections_published_content()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('published', 'archived') then
      raise exception using errcode = 'P0001', message = 'published_puzzle_is_immutable';
    end if;
    return old;
  end if;

  if old.status = 'archived' then
    raise exception using errcode = 'P0001', message = 'archived_puzzle_is_immutable';
  end if;

  if old.status = 'published'
     and (new.london_date, new.words, new.groups) is distinct from (old.london_date, old.words, old.groups) then
    raise exception using errcode = 'P0001', message = 'published_puzzle_is_immutable';
  end if;

  if old.status = 'published' and new.status = 'draft' then
    raise exception using errcode = 'P0001', message = 'published_puzzle_cannot_be_draft';
  end if;

  return new;
end;
$$;

drop trigger if exists connections_daily_puzzles_protect_published on public.connections_daily_puzzles;
create trigger connections_daily_puzzles_protect_published
before update or delete on public.connections_daily_puzzles
for each row execute function public.protect_connections_published_content();

create table public.dailo_rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null,
  updated_at timestamptz not null default now(),
  constraint dailo_rate_limits_request_count check (request_count > 0)
);

create index dailo_rate_limits_updated_idx on public.dailo_rate_limits (updated_at);
alter table public.dailo_rate_limits enable row level security;
revoke all on table public.dailo_rate_limits from anon, authenticated;

create or replace function public.dailo_consume_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed boolean;
begin
  if p_bucket_key is null or p_bucket_key = '' or p_limit < 1 or p_window_seconds < 1 then
    raise exception using errcode = 'P0001', message = 'invalid_rate_limit';
  end if;

  insert into public.dailo_rate_limits (bucket_key, window_started_at, request_count)
  values (p_bucket_key, now(), 1)
  on conflict (bucket_key) do update
  set window_started_at = case
        when public.dailo_rate_limits.window_started_at <= now() - (p_window_seconds * interval '1 second') then now()
        else public.dailo_rate_limits.window_started_at
      end,
      request_count = case
        when public.dailo_rate_limits.window_started_at <= now() - (p_window_seconds * interval '1 second') then 1
        else public.dailo_rate_limits.request_count + 1
      end,
      updated_at = now()
  returning request_count <= p_limit into allowed;

  return allowed;
end;
$$;

create or replace function public.dailo_create_connections_draft(
  p_auth_user_id uuid,
  p_london_date date,
  p_words jsonb,
  p_groups jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  created public.connections_daily_puzzles%rowtype;
begin
  insert into public.connections_daily_puzzles (london_date, words, groups, status)
  values (p_london_date, p_words, p_groups, 'draft')
  returning * into created;

  insert into public.dailo_admin_audit (auth_user_id, action, entity_type, entity_key, details)
  values (p_auth_user_id, 'create_draft', 'connections', p_london_date::text, jsonb_build_object('publicKey', created.public_key));

  return jsonb_build_object('public_key', created.public_key, 'london_date', created.london_date, 'status', created.status);
end;
$$;

create or replace function public.dailo_publish_connections(
  p_auth_user_id uuid,
  p_london_date date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  published public.connections_daily_puzzles%rowtype;
begin
  update public.connections_daily_puzzles
  set status = 'published',
      published_at = coalesce(published_at, now()),
      updated_at = now()
  where london_date = p_london_date and status = 'draft'
  returning * into published;

  if not found then
    raise exception using errcode = 'P0001', message = 'draft_not_found';
  end if;

  insert into public.dailo_admin_audit (auth_user_id, action, entity_type, entity_key, details)
  values (p_auth_user_id, 'publish', 'connections', p_london_date::text, jsonb_build_object('publicKey', published.public_key));

  return jsonb_build_object('public_key', published.public_key, 'london_date', published.london_date, 'status', published.status);
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
  if not exists (select 1 from public.wordle_words where normalized_word = p_guess and accepted_guess and (active or id = session_row.puzzle_word_id)) then
    raise exception using errcode = 'P0001', message = 'guess_not_in_accepted_list';
  end if;
  select normalized_word into answer_word from public.wordle_words where id = session_row.puzzle_word_id;
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

create or replace function public.wordle_versus_submit_guess(
  p_player_token_hash text, p_guess text, p_expected_attempt smallint, p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  player_row public.wordle_versus_players%rowtype;
  match_row public.wordle_versus_matches%rowtype;
  existing public.wordle_versus_attempts%rowtype;
  answer text;
  result text[];
  next_status text;
begin
  select * into player_row from public.wordle_versus_players where token_hash = p_player_token_hash;
  if not found then raise exception using errcode = 'P0001', message = 'invalid_participant'; end if;
  select * into match_row from public.wordle_versus_matches where id = player_row.match_id for update;
  select * into player_row from public.wordle_versus_players where id = player_row.id for update;
  select * into existing from public.wordle_versus_attempts where player_id = player_row.id and idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('sequence_number', existing.sequence_number, 'guess', existing.guess_word, 'result', existing.tile_result); end if;
  if match_row.status <> 'active' or player_row.status <> 'playing' then raise exception using errcode = 'P0001', message = 'match_not_active'; end if;
  if match_row.expires_at <= now() then
    perform public.wordle_versus_expire(match_row.id);
    return jsonb_build_object('error', 'match_expired');
  end if;
  if p_expected_attempt <> player_row.attempt_count + 1 then raise exception using errcode = 'P0001', message = 'attempt_sequence_conflict'; end if;

  p_guess := upper(trim(p_guess));
  if p_guess !~ '^[A-Z]{5}$' then raise exception using errcode = 'P0001', message = 'invalid_guess_format'; end if;
  if not exists (select 1 from public.wordle_words where normalized_word = p_guess and accepted_guess and (active or id = match_row.puzzle_word_id)) then
    raise exception using errcode = 'P0001', message = 'guess_not_in_accepted_list';
  end if;
  select normalized_word into answer from public.wordle_words where id = match_row.puzzle_word_id;
  if answer is null then raise exception using errcode = 'P0001', message = 'puzzle_unavailable'; end if;

  result := public.wordle_score_guess(answer, p_guess);
  next_status := case when p_guess = answer then 'won' when p_expected_attempt = 6 then 'lost' else 'playing' end;
  insert into public.wordle_versus_attempts (player_id, sequence_number, guess_word, tile_result, idempotency_key)
  values (player_row.id, p_expected_attempt, p_guess, to_jsonb(result), p_idempotency_key);
  update public.wordle_versus_players set attempt_count = p_expected_attempt, status = next_status,
    completed_at = case when next_status <> 'playing' then now() else null end where id = player_row.id;
  perform public.wordle_versus_finalize(match_row.id);
  return jsonb_build_object('sequence_number', p_expected_attempt, 'guess', p_guess, 'result', to_jsonb(result));
end;
$$;

revoke all on function public.dailo_consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.dailo_consume_rate_limit(text, integer, integer) to service_role;
revoke all on function public.dailo_create_connections_draft(uuid, date, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.dailo_create_connections_draft(uuid, date, jsonb, jsonb) to service_role;
revoke all on function public.dailo_publish_connections(uuid, date) from public, anon, authenticated;
grant execute on function public.dailo_publish_connections(uuid, date) to service_role;
revoke all on function public.wordle_submit_guess(text, text, smallint, text) from public, anon, authenticated;
grant execute on function public.wordle_submit_guess(text, text, smallint, text) to service_role;
revoke all on function public.wordle_versus_submit_guess(text, text, smallint, text) from public, anon, authenticated;
grant execute on function public.wordle_versus_submit_guess(text, text, smallint, text) to service_role;
