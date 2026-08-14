create or replace function public.start_attempt(
  category uuid,
  clan uuid,
  player uuid
)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_operator_id uuid := auth.uid();
  player_id uuid := coalesce($3, auth.uid());
  result public.attempts%rowtype;
begin
  if current_operator_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  perform 1
  from public.profiles as p
  where p.id = player_id
  for share;

  if not found then
    raise exception 'Player not found' using errcode = 'P0002';
  end if;

  if player_id <> current_operator_id then
    perform 1
    from public.guest_access as ga
    where ga.operator_id = current_operator_id
      and ga.guest_id = player_id
      and ga.revoked_at is null
    for share;

    if not found then
      raise exception 'Guest access required' using errcode = '42501';
    end if;
  end if;

  perform 1
  from public.categories as c
  where c.id = $1
    and c.is_active
  for share;

  if not found then
    raise exception 'Category is not active' using errcode = '22023';
  end if;

  if $2 is not null then
    perform 1
    from public.clan_members as cm
    where cm.clan_id = $2
      and cm.user_id = player_id
    for share;

    if not found then
      raise exception 'Player clan membership required' using errcode = '42501';
    end if;
  end if;

  if exists (
    select 1
    from public.attempts as a
    where (
        a.user_id = player_id
        or a.recorded_by = current_operator_id
      )
      and a.status in (
        'running'::public.attempt_status,
        'awaiting_confirmation'::public.attempt_status
      )
  ) then
    raise exception 'An unresolved attempt already exists'
      using errcode = '23505';
  end if;

  begin
    insert into public.attempts (
      user_id,
      recorded_by,
      category_id,
      clan_id,
      started_at,
      status
    )
    values (
      player_id,
      current_operator_id,
      $1,
      $2,
      pg_catalog.clock_timestamp(),
      'running'::public.attempt_status
    )
    returning * into result;
  exception
    when unique_violation then
      raise exception 'An unresolved attempt already exists'
        using errcode = '23505';
  end;

  return result;
end;
$$;

create or replace function public.reassign_attempt(
  attempt uuid,
  new_player uuid
)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_operator_id uuid := auth.uid();
  existing_attempt public.attempts%rowtype;
  result public.attempts%rowtype;
begin
  if current_operator_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select a.*
  into existing_attempt
  from public.attempts as a
  where a.id = $1
    and a.recorded_by = current_operator_id
  for update;

  if not found then
    raise exception 'Attempt not found' using errcode = 'P0002';
  end if;

  if existing_attempt.status <> 'awaiting_confirmation'::public.attempt_status then
    raise exception 'Only an awaiting attempt can be reassigned'
      using errcode = '22023';
  end if;

  perform 1
  from public.profiles as p
  where p.id = $2
  for share;

  if not found then
    raise exception 'Player not found' using errcode = 'P0002';
  end if;

  if $2 <> current_operator_id then
    perform 1
    from public.guest_access as ga
    where ga.operator_id = current_operator_id
      and ga.guest_id = $2
      and ga.revoked_at is null
    for share;

    if not found then
      raise exception 'Guest access required' using errcode = '42501';
    end if;
  end if;

  if existing_attempt.clan_id is not null and not exists (
    select 1
    from public.clan_members as cm
    where cm.clan_id = existing_attempt.clan_id
      and cm.user_id = $2
  ) then
    raise exception 'Player clan membership required' using errcode = '42501';
  end if;

  if existing_attempt.user_id = $2 then
    return existing_attempt;
  end if;

  if exists (
    select 1
    from public.attempts as a
    where a.user_id = $2
      and a.id <> existing_attempt.id
      and a.status in (
        'running'::public.attempt_status,
        'awaiting_confirmation'::public.attempt_status
      )
  ) then
    raise exception 'An unresolved attempt already exists'
      using errcode = '23505';
  end if;

  insert into public.attempt_attribution_events (
    attempt_id,
    from_user_id,
    to_user_id,
    changed_by
  )
  values (
    existing_attempt.id,
    existing_attempt.user_id,
    $2,
    current_operator_id
  );

  update public.attempts as a
  set user_id = $2
  where a.id = existing_attempt.id
  returning a.* into result;

  return result;
end;
$$;
