create or replace function public.connections_puzzle_is_valid(p_words jsonb, p_groups jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    jsonb_typeof(p_words) = 'array'
    and jsonb_array_length(p_words) = 16
    and (
      select count(*) = 16
        and count(distinct upper(value)) = 16
        and bool_and(value = upper(btrim(value)) and btrim(value) ~ '^[A-Z][A-Z0-9 ''&-]*$')
      from jsonb_array_elements_text(p_words)
    )
    and jsonb_typeof(p_groups) = 'array'
    and jsonb_array_length(p_groups) = 4
    and (
      select count(*) = 4
        and count(distinct item->>'key') = 4
        and count(distinct item->>'label') = 4
        and count(distinct (item->>'difficulty')::integer) = 4
        and min((item->>'difficulty')::integer) = 1
        and max((item->>'difficulty')::integer) = 4
        and bool_and(
          jsonb_typeof(item) = 'object'
          and jsonb_typeof(item->'words') = 'array'
          and jsonb_array_length(item->'words') = 4
          and coalesce(item->>'key', '') ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
          and char_length(btrim(coalesce(item->>'label', ''))) between 1 and 80
        )
      from jsonb_array_elements(p_groups) item
    )
    and (
      select count(*) = 16
        and count(distinct upper(group_word)) = 16
        and bool_and(p_words @> jsonb_build_array(upper(group_word)))
      from jsonb_array_elements(p_groups) item
      cross join lateral jsonb_array_elements_text(item->'words') group_word
    );
$$;

update public.connections_daily_puzzles
set groups = (
  select jsonb_agg(item || jsonb_build_object('difficulty', position) order by position)
  from jsonb_array_elements(groups) with ordinality group_items(item, position)
)
where not public.connections_puzzle_is_valid(words, groups);

alter table public.connections_daily_puzzles
  add constraint connections_daily_puzzles_content
  check (public.connections_puzzle_is_valid(words, groups));

create or replace function public.protect_connections_published_content()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status in ('published', 'archived')
     and (new.london_date, new.words, new.groups) is distinct from (old.london_date, old.words, old.groups) then
    raise exception using errcode = 'P0001', message = 'published_puzzle_is_immutable';
  end if;

  if old.status = 'published' and new.status = 'draft' then
    raise exception using errcode = 'P0001', message = 'published_puzzle_cannot_be_draft';
  end if;

  return new;
end;
$$;

create trigger connections_daily_puzzles_protect_published
before update on public.connections_daily_puzzles
for each row execute function public.protect_connections_published_content();

revoke all on function public.connections_puzzle_is_valid(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.connections_submit_guess(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.connections_puzzle_is_valid(jsonb, jsonb) to service_role;
grant execute on function public.connections_submit_guess(text, jsonb, text) to service_role;
