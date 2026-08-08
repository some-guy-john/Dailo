alter table public.connections_game_sessions
  add column auth_user_id uuid references auth.users(id) on delete cascade;

create unique index connections_game_sessions_one_user_daily_idx
  on public.connections_game_sessions (auth_user_id, london_date)
  where auth_user_id is not null;

create index connections_game_sessions_user_daily_idx
  on public.connections_game_sessions (auth_user_id, london_date desc);
