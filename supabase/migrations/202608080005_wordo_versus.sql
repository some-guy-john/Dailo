create table public.wordle_versus_matches (
  id uuid primary key default gen_random_uuid(),
  public_key uuid not null unique default gen_random_uuid(),
  invite_token_hash text not null unique,
  puzzle_word_id uuid not null references public.wordle_words(id),
  status text not null default 'waiting' check (status in ('waiting', 'active', 'completed', 'expired', 'cancelled')),
  winner_seat smallint check (winner_seat in (1, 2)),
  created_at timestamptz not null default now(),
  joined_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null
);

create table public.wordle_versus_players (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.wordle_versus_matches(id) on delete cascade,
  seat smallint not null check (seat in (1, 2)),
  token_hash text not null unique,
  display_name text not null check (display_name ~ '^[A-Za-z0-9][A-Za-z0-9 _-]{0,14}[A-Za-z0-9]$'),
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'won', 'lost', 'conceded')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 6),
  joined_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (match_id, seat)
);

create table public.wordle_versus_attempts (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.wordle_versus_players(id) on delete cascade,
  sequence_number smallint not null check (sequence_number between 1 and 6),
  guess_word text not null check (guess_word ~ '^[A-Z]{5}$'),
  tile_result jsonb not null check (jsonb_typeof(tile_result) = 'array' and jsonb_array_length(tile_result) = 5),
  idempotency_key text not null,
  accepted_at timestamptz not null default now(),
  unique (player_id, sequence_number),
  unique (player_id, idempotency_key)
);

create index wordle_versus_players_match_idx on public.wordle_versus_players (match_id, seat);
create index wordle_versus_attempts_player_idx on public.wordle_versus_attempts (player_id, sequence_number);
create index wordle_versus_matches_expiry_idx on public.wordle_versus_matches (status, expires_at);

alter table public.wordle_versus_matches enable row level security;
alter table public.wordle_versus_players enable row level security;
alter table public.wordle_versus_attempts enable row level security;
revoke all on table public.wordle_versus_matches from anon, authenticated;
revoke all on table public.wordle_versus_players from anon, authenticated;
revoke all on table public.wordle_versus_attempts from anon, authenticated;

create or replace function public.wordle_versus_create(
  p_invite_token_hash text, p_player_token_hash text, p_display_name text, p_puzzle_word_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare match_row public.wordle_versus_matches%rowtype;
begin
  insert into public.wordle_versus_matches (invite_token_hash, puzzle_word_id, expires_at)
  values (p_invite_token_hash, p_puzzle_word_id, now() + interval '24 hours') returning * into match_row;
  insert into public.wordle_versus_players (match_id, seat, token_hash, display_name, status)
  values (match_row.id, 1, p_player_token_hash, p_display_name, 'waiting');
  return jsonb_build_object('match_id', match_row.id, 'public_key', match_row.public_key, 'expires_at', match_row.expires_at);
end;
$$;

create or replace function public.wordle_versus_join(
  p_invite_token_hash text, p_player_token_hash text, p_display_name text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare match_row public.wordle_versus_matches%rowtype;
begin
  select * into match_row from public.wordle_versus_matches where invite_token_hash = p_invite_token_hash for update;
  if not found then raise exception using errcode = 'P0001', message = 'invalid_invite'; end if;
  if match_row.status <> 'waiting' then raise exception using errcode = 'P0001', message = 'invite_unavailable'; end if;
  if match_row.expires_at <= now() then
    update public.wordle_versus_matches set status = 'expired', completed_at = now() where id = match_row.id;
    raise exception using errcode = 'P0001', message = 'invite_expired';
  end if;
  insert into public.wordle_versus_players (match_id, seat, token_hash, display_name, status)
  values (match_row.id, 2, p_player_token_hash, p_display_name, 'playing');
  update public.wordle_versus_players set status = 'playing' where match_id = match_row.id and seat = 1;
  update public.wordle_versus_matches set status = 'active', joined_at = now(), expires_at = now() + interval '24 hours'
  where id = match_row.id returning * into match_row;
  return jsonb_build_object('match_id', match_row.id, 'public_key', match_row.public_key, 'expires_at', match_row.expires_at);
end;
$$;

create or replace function public.wordle_versus_finalize(p_match_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare one_row public.wordle_versus_players%rowtype; two_row public.wordle_versus_players%rowtype; winner smallint;
begin
  select * into one_row from public.wordle_versus_players where match_id = p_match_id and seat = 1;
  select * into two_row from public.wordle_versus_players where match_id = p_match_id and seat = 2;
  if one_row.status = 'conceded' then winner := 2;
  elsif two_row.status = 'conceded' then winner := 1;
  elsif one_row.status in ('won','lost') and two_row.status in ('won','lost') then
    if one_row.status = 'won' and two_row.status = 'lost' then winner := 1;
    elsif two_row.status = 'won' and one_row.status = 'lost' then winner := 2;
    elsif one_row.status = 'won' and two_row.status = 'won' and one_row.attempt_count < two_row.attempt_count then winner := 1;
    elsif one_row.status = 'won' and two_row.status = 'won' and two_row.attempt_count < one_row.attempt_count then winner := 2;
    else winner := null;
    end if;
  else return;
  end if;
  update public.wordle_versus_matches set status = 'completed', winner_seat = winner, completed_at = now() where id = p_match_id;
end;
$$;

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
  result := public.wordle_score_guess(answer, p_guess);
  next_status := case when p_guess = answer then 'won' when p_expected_attempt = 6 then 'lost' else 'playing' end;
  insert into public.wordle_versus_attempts (player_id, sequence_number, guess_word, tile_result, idempotency_key)
  values (player_row.id, p_expected_attempt, p_guess, result, p_idempotency_key);
  update public.wordle_versus_players set attempt_count = p_expected_attempt, status = next_status,
    completed_at = case when next_status <> 'playing' then now() else null end where id = player_row.id;
  perform public.wordle_versus_finalize(match_row.id);
  return jsonb_build_object('sequence_number', p_expected_attempt, 'guess', p_guess, 'result', result);
end;
$$;

create or replace function public.wordle_versus_concede(p_player_token_hash text)
returns void language plpgsql security definer set search_path = public
as $$
declare player_row public.wordle_versus_players%rowtype; match_row public.wordle_versus_matches%rowtype;
begin
  select * into player_row from public.wordle_versus_players where token_hash = p_player_token_hash for update;
  if not found then raise exception using errcode = 'P0001', message = 'invalid_participant'; end if;
  select * into match_row from public.wordle_versus_matches where id = player_row.match_id for update;
  if match_row.status not in ('waiting','active') then raise exception using errcode = 'P0001', message = 'match_not_active'; end if;
  if match_row.status = 'waiting' then
    update public.wordle_versus_players set status = 'conceded', completed_at = now() where id = player_row.id;
    update public.wordle_versus_matches set status = 'cancelled', completed_at = now() where id = match_row.id;
  else
    update public.wordle_versus_players set status = 'conceded', completed_at = now() where id = player_row.id;
    perform public.wordle_versus_finalize(match_row.id);
  end if;
end;
$$;

revoke all on function public.wordle_versus_create(text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.wordle_versus_join(text,text,text) from public, anon, authenticated;
revoke all on function public.wordle_versus_finalize(uuid) from public, anon, authenticated;
revoke all on function public.wordle_versus_submit_guess(text,text,smallint,text) from public, anon, authenticated;
revoke all on function public.wordle_versus_concede(text) from public, anon, authenticated;
grant execute on function public.wordle_versus_create(text,text,text,uuid) to service_role;
grant execute on function public.wordle_versus_join(text,text,text) to service_role;
grant execute on function public.wordle_versus_finalize(uuid) to service_role;
grant execute on function public.wordle_versus_submit_guess(text,text,smallint,text) to service_role;
grant execute on function public.wordle_versus_concede(text) to service_role;
