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
  where token_hash = p_token_hash
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
  where token_hash = p_token_hash
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'invalid_session';
  end if;

  select * into existing_attempt
  from public.connections_attempts attempt
  where attempt.session_id = session_row.id
    and attempt.idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object('result', existing_attempt.result, 'group', existing_attempt.group_data);
  end if;

  if session_row.status = 'active' and session_row.expires_at <= now() then
    update public.connections_game_sessions
    set status = 'expired', completed_at = now()
    where id = session_row.id;
    return jsonb_build_object('error', 'expired_session');
  end if;

  if jsonb_typeof(p_selected_words) <> 'array'
     or jsonb_array_length(p_selected_words) <> 4
     or exists (
       select 1 from jsonb_array_elements(p_selected_words) item
       where jsonb_typeof(item) <> 'string'
     )
     or (select count(distinct upper(btrim(value))) from jsonb_array_elements_text(p_selected_words) value) <> 4 then
    raise exception using errcode = 'P0001', message = 'invalid_selection';
  end if;

  selected := array(select upper(btrim(value)) from jsonb_array_elements_text(p_selected_words) value);
  canonical := (select array_agg(value order by value) from unnest(selected) value);

  select * into existing_attempt
  from public.connections_attempts attempt
  where attempt.session_id = session_row.id
    and (
      select array_agg(value order by value)
      from jsonb_array_elements_text(attempt.selected_words) value
    ) = canonical
  limit 1;

  if found then
    return jsonb_build_object('result', existing_attempt.result, 'group', existing_attempt.group_data);
  end if;

  if session_row.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'game_already_complete';
  end if;

  select * into puzzle_row from public.connections_daily_puzzles where id = session_row.puzzle_id;
  if puzzle_row.id is null then
    raise exception using errcode = 'P0001', message = 'puzzle_unavailable';
  end if;

  if not (puzzle_row.words @> to_jsonb(selected)) then
    raise exception using errcode = 'P0001', message = 'invalid_selection';
  end if;

  for group_row in select value from jsonb_array_elements(puzzle_row.groups)
  loop
    overlap := (
      select count(*) from unnest(selected) word
      where group_row->'words' @> to_jsonb(array[word])
    );
    if overlap = 4 then matching_group := group_row; end if;
    if overlap = 3 then one_away := true; end if;
  end loop;

  if matching_group is not null then
    group_key := matching_group->>'key';
    if session_row.solved_groups ? group_key then
      raise exception using errcode = 'P0001', message = 'group_already_solved';
    end if;
    solved := session_row.solved_groups || jsonb_build_array(group_key);
    next_status := case when jsonb_array_length(solved) = 4 then 'won' else 'active' end;
    next_mistakes := session_row.mistake_count;
  else
    solved := session_row.solved_groups;
    next_mistakes := session_row.mistake_count + 1;
    next_status := case when next_mistakes >= 4 then 'lost' else 'active' end;
  end if;

  insert into public.connections_attempts (session_id, sequence_number, selected_words, result, group_data, idempotency_key)
  values (
    session_row.id,
    (select coalesce(max(sequence_number), 0) + 1 from public.connections_attempts where session_id = session_row.id),
    to_jsonb(selected),
    case when matching_group is not null then 'correct' when one_away then 'one-away' else 'incorrect' end,
    matching_group,
    p_idempotency_key
  );

  update public.connections_game_sessions
  set mistake_count = next_mistakes,
      solved_groups = solved,
      status = next_status,
      completed_at = case when next_status <> 'active' then now() else null end
  where id = session_row.id;

  return jsonb_build_object(
    'result', case when matching_group is not null then 'correct' when one_away then 'one-away' else 'incorrect' end,
    'group', matching_group
  );
end;
$$;

create or replace function public.wordle_versus_join(
  p_invite_token_hash text, p_player_token_hash text, p_display_name text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare match_row public.wordle_versus_matches%rowtype;
begin
  select * into match_row
  from public.wordle_versus_matches
  where invite_token_hash = p_invite_token_hash
  for update;

  if not found then raise exception using errcode = 'P0001', message = 'invalid_invite'; end if;
  if match_row.status <> 'waiting' then raise exception using errcode = 'P0001', message = 'invite_unavailable'; end if;
  if match_row.expires_at <= now() then
    update public.wordle_versus_matches
    set status = 'expired', completed_at = now()
    where id = match_row.id;
    return jsonb_build_object('error', 'invite_expired');
  end if;

  insert into public.wordle_versus_players (match_id, seat, token_hash, display_name, status)
  values (match_row.id, 2, p_player_token_hash, p_display_name, 'playing');
  update public.wordle_versus_players set status = 'playing' where match_id = match_row.id and seat = 1;
  update public.wordle_versus_matches
  set status = 'active', joined_at = now(), expires_at = now() + interval '24 hours'
  where id = match_row.id
  returning * into match_row;
  return jsonb_build_object('match_id', match_row.id, 'public_key', match_row.public_key, 'expires_at', match_row.expires_at);
end;
$$;

create or replace function public.wordle_versus_expire(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  match_row public.wordle_versus_matches%rowtype;
  one_row public.wordle_versus_players%rowtype;
  two_row public.wordle_versus_players%rowtype;
  winner smallint;
begin
  select * into match_row
  from public.wordle_versus_matches
  where id = p_match_id
  for update;

  if not found then return jsonb_build_object('status', 'missing'); end if;
  if match_row.status not in ('waiting', 'active') or match_row.expires_at > now() then
    return jsonb_build_object('status', match_row.status, 'winner_seat', match_row.winner_seat);
  end if;

  perform public.wordle_versus_finalize(match_row.id);
  select * into match_row from public.wordle_versus_matches where id = p_match_id;
  if match_row.status not in ('waiting', 'active') then
    return jsonb_build_object('status', match_row.status, 'winner_seat', match_row.winner_seat);
  end if;

  select * into one_row from public.wordle_versus_players where match_id = p_match_id and seat = 1;
  select * into two_row from public.wordle_versus_players where match_id = p_match_id and seat = 2;
  if one_row.status = 'won' and two_row.status <> 'won' then winner := 1;
  elsif two_row.status = 'won' and one_row.status <> 'won' then winner := 2;
  else winner := null;
  end if;

  update public.wordle_versus_matches
  set status = 'expired', winner_seat = winner, completed_at = now()
  where id = p_match_id;
  return jsonb_build_object('status', 'expired', 'winner_seat', winner);
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
  select * into player_row
  from public.wordle_versus_players
  where token_hash = p_player_token_hash;
  if not found then raise exception using errcode = 'P0001', message = 'invalid_participant'; end if;

  select * into match_row
  from public.wordle_versus_matches
  where id = player_row.match_id
  for update;
  select * into player_row from public.wordle_versus_players where id = player_row.id for update;

  select * into existing
  from public.wordle_versus_attempts
  where player_id = player_row.id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('sequence_number', existing.sequence_number, 'guess', existing.guess_word, 'result', existing.tile_result);
  end if;

  if match_row.status <> 'active' or player_row.status <> 'playing' then
    raise exception using errcode = 'P0001', message = 'match_not_active';
  end if;
  if match_row.expires_at <= now() then
    perform public.wordle_versus_expire(match_row.id);
    return jsonb_build_object('error', 'match_expired');
  end if;
  if p_expected_attempt <> player_row.attempt_count + 1 then raise exception using errcode = 'P0001', message = 'attempt_sequence_conflict'; end if;

  p_guess := upper(trim(p_guess));
  if p_guess !~ '^[A-Z]{5}$' then raise exception using errcode = 'P0001', message = 'invalid_guess_format'; end if;
  if not exists (select 1 from public.wordle_words where normalized_word = p_guess and accepted_guess and active) then
    raise exception using errcode = 'P0001', message = 'guess_not_in_accepted_list';
  end if;

  select normalized_word into answer from public.wordle_words where id = match_row.puzzle_word_id;
  result := public.wordle_score_guess(answer, p_guess);
  next_status := case when p_guess = answer then 'won' when p_expected_attempt = 6 then 'lost' else 'playing' end;
  insert into public.wordle_versus_attempts (player_id, sequence_number, guess_word, tile_result, idempotency_key)
  values (player_row.id, p_expected_attempt, p_guess, to_jsonb(result), p_idempotency_key);
  update public.wordle_versus_players
  set attempt_count = p_expected_attempt,
      status = next_status,
      completed_at = case when next_status <> 'playing' then now() else null end
  where id = player_row.id;
  perform public.wordle_versus_finalize(match_row.id);
  return jsonb_build_object('sequence_number', p_expected_attempt, 'guess', p_guess, 'result', to_jsonb(result));
end;
$$;

create or replace function public.wordle_versus_concede(p_player_token_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  player_row public.wordle_versus_players%rowtype;
  match_row public.wordle_versus_matches%rowtype;
begin
  select * into player_row
  from public.wordle_versus_players
  where token_hash = p_player_token_hash;
  if not found then raise exception using errcode = 'P0001', message = 'invalid_participant'; end if;

  select * into match_row
  from public.wordle_versus_matches
  where id = player_row.match_id
  for update;
  select * into player_row from public.wordle_versus_players where id = player_row.id for update;

  if match_row.status in ('waiting', 'active') and match_row.expires_at <= now() then
    perform public.wordle_versus_expire(match_row.id);
    return;
  end if;
  if match_row.status not in ('waiting', 'active') then raise exception using errcode = 'P0001', message = 'match_not_active'; end if;
  if (match_row.status = 'waiting' and player_row.status <> 'waiting')
     or (match_row.status = 'active' and player_row.status <> 'playing') then
    raise exception using errcode = 'P0001', message = 'match_not_active';
  end if;

  update public.wordle_versus_players set status = 'conceded', completed_at = now() where id = player_row.id;
  if match_row.status = 'waiting' then
    update public.wordle_versus_matches set status = 'cancelled', completed_at = now() where id = match_row.id;
  else
    perform public.wordle_versus_finalize(match_row.id);
  end if;
end;
$$;

revoke all on function public.connections_expire_session(text) from public, anon, authenticated;
revoke all on function public.wordle_versus_expire(uuid) from public, anon, authenticated;
grant execute on function public.connections_expire_session(text) to service_role;
grant execute on function public.wordle_versus_expire(uuid) to service_role;
