create or replace function public.wordle_versus_submit_guess(
  p_player_token_hash text, p_guess text, p_expected_attempt smallint, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare player_row public.wordle_versus_players%rowtype; match_row public.wordle_versus_matches%rowtype;
  existing public.wordle_versus_attempts%rowtype; answer text; result jsonb; next_status text;
begin
  select * into player_row from public.wordle_versus_players where token_hash = p_player_token_hash for update;
  if not found then raise exception using errcode = 'P0001', message = 'invalid_participant'; end if;
  select * into match_row from public.wordle_versus_matches where id = player_row.match_id for update;
  select * into existing from public.wordle_versus_attempts where player_id = player_row.id and idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('sequence_number', existing.sequence_number, 'guess', existing.guess_word, 'result', existing.tile_result); end if;
  if match_row.status <> 'active' or player_row.status <> 'playing' then raise exception using errcode = 'P0001', message = 'match_not_active'; end if;
  if match_row.expires_at <= now() then raise exception using errcode = 'P0001', message = 'match_expired'; end if;
  if p_expected_attempt <> player_row.attempt_count + 1 then raise exception using errcode = 'P0001', message = 'attempt_sequence_conflict'; end if;
  p_guess := upper(trim(p_guess));
  if p_guess !~ '^[A-Z]{5}$' then raise exception using errcode = 'P0001', message = 'invalid_guess_format'; end if;
  if not exists (select 1 from public.wordle_words where normalized_word = p_guess and accepted_guess and active) then
    raise exception using errcode = 'P0001', message = 'guess_not_in_accepted_list';
  end if;
  select normalized_word into answer from public.wordle_words where id = match_row.puzzle_word_id;
  result := to_jsonb(public.wordle_score_guess(answer, p_guess));
  next_status := case when p_guess = answer then 'won' when p_expected_attempt = 6 then 'lost' else 'playing' end;
  insert into public.wordle_versus_attempts (player_id, sequence_number, guess_word, tile_result, idempotency_key)
  values (player_row.id, p_expected_attempt, p_guess, result, p_idempotency_key);
  update public.wordle_versus_players set attempt_count = p_expected_attempt, status = next_status,
    completed_at = case when next_status <> 'playing' then now() else null end where id = player_row.id;
  perform public.wordle_versus_finalize(match_row.id);
  return jsonb_build_object('sequence_number', p_expected_attempt, 'guess', p_guess, 'result', result);
end;
$$;

revoke all on function public.wordle_versus_submit_guess(text,text,smallint,text) from public, anon, authenticated;
grant execute on function public.wordle_versus_submit_guess(text,text,smallint,text) to service_role;
