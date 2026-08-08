alter table public.connections_game_sessions
  add column mode text not null default 'daily'
  constraint connections_game_sessions_mode check (mode in ('daily', 'archive'));

drop index connections_game_sessions_one_user_daily_idx;
create unique index connections_game_sessions_one_user_date_mode_idx
  on public.connections_game_sessions (auth_user_id, london_date, mode)
  where auth_user_id is not null;

create index connections_game_sessions_user_mode_date_idx
  on public.connections_game_sessions (auth_user_id, mode, london_date desc);

drop index connections_game_sessions_one_browser_puzzle_idx;
create unique index connections_game_sessions_one_browser_puzzle_mode_idx
  on public.connections_game_sessions (browser_id_hash, puzzle_id, mode)
  where browser_id_hash is not null;
