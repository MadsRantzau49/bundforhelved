create or replace function public.enforce_attempt_clan_memberships()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.clan_id is null then
    return new;
  end if;

  perform 1
  from public.clan_members as player_membership
  where player_membership.clan_id = new.clan_id
    and player_membership.user_id = new.user_id
  for key share;

  if not found then
    raise exception 'Player clan membership required' using errcode = '42501';
  end if;

  -- Profile deletion intentionally preserves a guest's result while SET NULL
  -- removes the deleted phone owner from the recorder audit column.
  if tg_op = 'UPDATE' and old.recorded_by is not null and new.recorded_by is null then
    return new;
  end if;

  if new.recorded_by is null then
    raise exception 'Attempt recorder is required for a scoped attempt' using errcode = '23514';
  end if;

  perform 1
  from public.clan_members as recorder_membership
  where recorder_membership.clan_id = new.clan_id
    and recorder_membership.user_id = new.recorded_by
  for key share;

  if not found then
    raise exception 'Recorder clan membership required' using errcode = '42501';
  end if;

  return new;
end;
$$;
