alter table public.wordle_game_sessions
  add column if not exists auth_user_id uuid references auth.users(id) on delete cascade;

create unique index wordle_game_sessions_one_user_date_mode_idx
  on public.wordle_game_sessions (auth_user_id, daily_date, mode)
  where auth_user_id is not null and daily_date is not null;

create index wordle_game_sessions_user_mode_idx
  on public.wordle_game_sessions (auth_user_id, mode, daily_date);
