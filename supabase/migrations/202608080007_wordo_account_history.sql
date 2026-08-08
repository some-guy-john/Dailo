create index wordle_game_sessions_user_mode_completed_idx
  on public.wordle_game_sessions (auth_user_id, mode, completed_at desc)
  where auth_user_id is not null and status in ('won', 'lost');
