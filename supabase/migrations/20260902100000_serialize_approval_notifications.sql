create or replace function public.lock_attempt_category_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'approved'::public.attempt_status
     and old.status <> 'approved'::public.attempt_status then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(new.category_id::text, 0)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists attempts_lock_category_approval on public.attempts;

create trigger attempts_lock_category_approval
before update of status on public.attempts
for each row
when (
  new.status = 'approved'::public.attempt_status
  and old.status <> 'approved'::public.attempt_status
)
execute function public.lock_attempt_category_approval();

revoke all on function public.lock_attempt_category_approval()
  from public, anon, authenticated, service_role;
