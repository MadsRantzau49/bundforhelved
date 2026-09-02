create or replace function public.change_attempt_category(
  attempt uuid,
  category uuid
)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  existing_attempt public.attempts%rowtype;
  result public.attempts%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select a.*
  into existing_attempt
  from public.attempts as a
  where a.id = $1
    and (a.user_id = current_user_id or a.recorded_by = current_user_id)
  for update;

  if not found then
    raise exception 'Attempt not found' using errcode = 'P0002';
  end if;

  if existing_attempt.status <> 'awaiting_confirmation'::public.attempt_status then
    raise exception 'Category can only be changed while awaiting confirmation'
      using errcode = '22023';
  end if;

  perform 1
  from public.categories as c
  where c.id = $2
    and c.is_active
  for key share;

  if not found then
    raise exception 'Active category not found' using errcode = 'P0002';
  end if;

  update public.attempts as a
  set category_id = $2
  where a.id = existing_attempt.id
  returning a.* into result;

  return result;
end;
$$;

revoke all on function public.change_attempt_category(uuid, uuid)
from public, anon, authenticated, service_role;

grant execute on function public.change_attempt_category(uuid, uuid) to authenticated;
