create function public.enforce_minimum_timer_duration()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    (tg_op = 'INSERT' and new.status = 'pending_review'::public.attempt_status)
    or
    (tg_op = 'UPDATE'
      and old.status = 'running'::public.attempt_status
      and new.status = 'awaiting_confirmation'::public.attempt_status)
  ) and coalesce(new.elapsed_ms, 0) < 300 then
    raise exception 'Minimum timer duration is 300ms' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger attempts_minimum_timer_duration
before insert or update on public.attempts
for each row execute function public.enforce_minimum_timer_duration();

comment on function public.enforce_minimum_timer_duration() is 'Rejects recorded timer and battle results shorter than 300 milliseconds.';
