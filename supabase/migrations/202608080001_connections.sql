create table public.connections_daily_puzzles (
  id uuid primary key default gen_random_uuid(),
  public_key uuid not null unique default gen_random_uuid(),
  london_date date not null unique,
  words jsonb not null,
  groups jsonb not null,
  status text not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connections_daily_puzzles_status check (status in ('draft', 'published', 'archived')),
  constraint connections_daily_puzzles_words check (jsonb_typeof(words) = 'array' and jsonb_array_length(words) = 16),
  constraint connections_daily_puzzles_groups check (jsonb_typeof(groups) = 'array' and jsonb_array_length(groups) = 4)
);

create table public.connections_game_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  browser_id_hash text,
  puzzle_id uuid not null references public.connections_daily_puzzles(id),
  london_date date not null,
  status text not null default 'active',
  mistake_count smallint not null default 0,
  solved_groups jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null,
  constraint connections_game_sessions_status check (status in ('active', 'won', 'lost', 'expired')),
  constraint connections_game_sessions_mistakes check (mistake_count between 0 and 4)
);

create table public.connections_attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.connections_game_sessions(id) on delete cascade,
  sequence_number smallint not null,
  selected_words jsonb not null,
  result text not null,
  group_data jsonb,
  idempotency_key text not null,
  accepted_at timestamptz not null default now(),
  unique (session_id, sequence_number),
  unique (session_id, idempotency_key),
  constraint connections_attempts_result check (result in ('correct', 'one-away', 'incorrect')),
  constraint connections_attempts_words check (jsonb_typeof(selected_words) = 'array' and jsonb_array_length(selected_words) = 4)
);

create unique index connections_game_sessions_one_browser_puzzle_idx
  on public.connections_game_sessions (browser_id_hash, puzzle_id)
  where browser_id_hash is not null;

create index connections_daily_puzzles_playable_idx
  on public.connections_daily_puzzles (london_date, status);

create index connections_game_sessions_puzzle_idx
  on public.connections_game_sessions (puzzle_id, status);

create index connections_attempts_session_idx
  on public.connections_attempts (session_id, sequence_number);

alter table public.connections_daily_puzzles enable row level security;
alter table public.connections_game_sessions enable row level security;
alter table public.connections_attempts enable row level security;

revoke all on table public.connections_daily_puzzles from anon, authenticated;
revoke all on table public.connections_game_sessions from anon, authenticated;
revoke all on table public.connections_attempts from anon, authenticated;

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
  from public.connections_attempts
  where session_id = session_row.id
    and idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object('result', existing_attempt.result, 'group', existing_attempt.group_data);
  end if;

  if session_row.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'game_already_complete';
  end if;

  if session_row.expires_at < now() then
    update public.connections_game_sessions set status = 'expired' where id = session_row.id;
    raise exception using errcode = 'P0001', message = 'expired_session';
  end if;

  select * into puzzle_row from public.connections_daily_puzzles where id = session_row.puzzle_id;
  if puzzle_row.id is null then
    raise exception using errcode = 'P0001', message = 'puzzle_unavailable';
  end if;

  if jsonb_typeof(p_selected_words) <> 'array'
     or jsonb_array_length(p_selected_words) <> 4
     or (select count(distinct value) from jsonb_array_elements_text(p_selected_words) value) <> 4 then
    raise exception using errcode = 'P0001', message = 'invalid_selection';
  end if;

  selected := array(select upper(value) from jsonb_array_elements_text(p_selected_words) value);
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

insert into public.connections_daily_puzzles (london_date, words, groups, status, published_at)
values (
  date '2026-08-08',
  '["APPLE", "MANGO", "PEAR", "PLUM", "HARP", "GUITAR", "VIOLIN", "CELLO", "CIRCLE", "OVAL", "SQUARE", "TRIANGLE", "LION", "PUMA", "TIGER", "LEOPARD"]'::jsonb,
  '[
    {"key":"fruit","label":"Fruit","words":["APPLE","MANGO","PEAR","PLUM"]},
    {"key":"strings","label":"String instruments","words":["HARP","GUITAR","VIOLIN","CELLO"]},
    {"key":"shapes","label":"Shapes","words":["CIRCLE","OVAL","SQUARE","TRIANGLE"]},
    {"key":"cats","label":"Big cats","words":["LION","PUMA","TIGER","LEOPARD"]}
  ]'::jsonb,
  'published',
  now()
)
on conflict (london_date) do nothing;
