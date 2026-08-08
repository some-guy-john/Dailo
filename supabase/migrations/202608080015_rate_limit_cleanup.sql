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

  if random() < 0.01 then
    delete from public.dailo_rate_limits
    where updated_at < now() - interval '2 days';
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

revoke all on function public.dailo_consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.dailo_consume_rate_limit(text, integer, integer) to service_role;
