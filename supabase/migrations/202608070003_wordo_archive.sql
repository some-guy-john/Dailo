alter table public.wordle_game_sessions
  drop constraint wordle_game_sessions_mode,
  add constraint wordle_game_sessions_mode
    check (mode in ('daily', 'unlimited', 'archive'));

alter table public.wordle_game_sessions
  drop constraint wordle_game_sessions_daily_date,
  add constraint wordle_game_sessions_daily_date
    check ((mode in ('daily', 'archive') and daily_date is not null) or (mode = 'unlimited' and daily_date is null));

drop index if exists public.wordle_game_sessions_one_daily_per_browser_idx;

create unique index wordle_game_sessions_one_browser_date_mode_idx
  on public.wordle_game_sessions (browser_id_hash, daily_date, mode)
  where browser_id_hash is not null and daily_date is not null;

create index wordle_daily_assignments_archive_idx
  on public.wordle_daily_assignments (london_date desc, status);
