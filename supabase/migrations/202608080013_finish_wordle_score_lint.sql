create or replace function public.wordle_score_guess(
  p_answer text,
  p_guess text
) returns text[]
language plpgsql
immutable
set search_path = public
as $$
declare
  result text[] := array['absent', 'absent', 'absent', 'absent', 'absent'];
  remaining integer[] := array_fill(0, array[26]);
  letter_index integer;
begin
  for position in 1..5 loop
    if substr(p_guess, position, 1) = substr(p_answer, position, 1) then
      result[position] := 'correct';
    else
      letter_index := ascii(substr(p_answer, position, 1)) - ascii('A') + 1;
      remaining[letter_index] := remaining[letter_index] + 1;
    end if;
  end loop;

  for position in 1..5 loop
    if result[position] <> 'correct' then
      letter_index := ascii(substr(p_guess, position, 1)) - ascii('A') + 1;
      if remaining[letter_index] > 0 then
        result[position] := 'present';
        remaining[letter_index] := remaining[letter_index] - 1;
      end if;
    end if;
  end loop;

  return result;
end;
$$;
