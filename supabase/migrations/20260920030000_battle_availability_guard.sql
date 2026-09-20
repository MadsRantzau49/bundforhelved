create or replace function public.prevent_battle_during_timer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.attempts as a
    where a.user_id in (new.challenger_id, new.opponent_id)
      and a.status in ('running'::public.attempt_status, 'awaiting_confirmation'::public.attempt_status)
  ) then
    raise exception 'A player has an active timer' using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger battles_prevent_during_timer
before insert on public.battles
for each row execute function public.prevent_battle_during_timer();
