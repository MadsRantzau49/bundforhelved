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

create trigger attempts_clan_memberships_insert
before insert on public.attempts
for each row execute function public.enforce_attempt_clan_memberships();

create trigger attempts_clan_memberships_update
before update of user_id, clan_id, recorded_by on public.attempts
for each row execute function public.enforce_attempt_clan_memberships();

create or replace function public.enforce_guest_request_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.requester_id::text, 7319)
  );

  if (
    select pg_catalog.count(*)
    from public.guest_access_requests as recent
    where recent.requester_id = new.requester_id
      and recent.created_at >= pg_catalog.clock_timestamp() - interval '1 hour'
  ) >= 10 then
    raise exception 'Guest request rate limit reached' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger guest_access_requests_rate_limit
before insert on public.guest_access_requests
for each row execute function public.enforce_guest_request_rate();

create or replace function public.revoke_guest_access(
  other_user uuid,
  access_direction text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if $2 = 'guest' then
    update public.guest_access as ga
    set revoked_at = pg_catalog.clock_timestamp()
    where ga.operator_id = current_user_id
      and ga.guest_id = $1
      and ga.revoked_at is null;
  elsif $2 = 'operator' then
    update public.guest_access as ga
    set revoked_at = pg_catalog.clock_timestamp()
    where ga.guest_id = current_user_id
      and ga.operator_id = $1
      and ga.revoked_at is null;
  else
    raise exception 'Invalid guest access direction' using errcode = '22023';
  end if;

  if not found then
    raise exception 'Guest access not found' using errcode = 'P0002';
  end if;

  return true;
end;
$$;

revoke all on function public.enforce_attempt_clan_memberships() from public, anon, authenticated;
revoke all on function public.enforce_guest_request_rate() from public, anon, authenticated;
revoke all on function public.revoke_guest_access(uuid) from authenticated;
revoke all on function public.revoke_guest_access(uuid, text) from public, anon, authenticated;
grant execute on function public.revoke_guest_access(uuid, text) to authenticated;
