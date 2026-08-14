-- Attempts now belong either to Global (clan_id is null) or one selected clan.
-- Existing attempts remain Global because their original scope cannot be inferred.
alter table public.attempts
  add column clan_id uuid references public.clans (id) on delete cascade,
  add column recorded_by uuid references public.profiles (id) on delete set null;

update public.attempts
set recorded_by = user_id
where recorded_by is null;

drop index if exists public.attempts_leaderboard_idx;

create index attempts_scope_leaderboard_idx
  on public.attempts (category_id, clan_id, user_id, elapsed_ms, confirmed_at, id)
  where status = 'approved'::public.attempt_status
    and invalidated_at is null;

create unique index attempts_one_unresolved_per_recorder_idx
  on public.attempts (recorded_by)
  where recorded_by is not null
    and status in (
      'running'::public.attempt_status,
      'awaiting_confirmation'::public.attempt_status
    );

create table public.guest_access_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  target_id uuid not null references public.profiles (id) on delete cascade,
  otp_digest text,
  otp_expires_at timestamptz,
  failed_attempts integer not null default 0,
  expires_at timestamptz not null default (pg_catalog.clock_timestamp() + interval '10 minutes'),
  redeemed_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint guest_access_requests_different_users check (requester_id <> target_id),
  constraint guest_access_requests_otp_together check (
    (otp_digest is null) = (otp_expires_at is null)
  ),
  constraint guest_access_requests_otp_format check (
    otp_digest is null or otp_digest ~ '^[0-9a-f]{64}$'
  ),
  constraint guest_access_requests_attempts_range check (failed_attempts between 0 and 5),
  constraint guest_access_requests_terminal_state check (
    redeemed_at is null or rejected_at is null
  )
);

create unique index guest_access_requests_one_pending_idx
  on public.guest_access_requests (requester_id, target_id)
  where redeemed_at is null and rejected_at is null;

create index guest_access_requests_target_idx
  on public.guest_access_requests (target_id, created_at desc)
  where redeemed_at is null and rejected_at is null;

create table public.guest_access (
  operator_id uuid not null references public.profiles (id) on delete cascade,
  guest_id uuid not null references public.profiles (id) on delete cascade,
  request_id uuid references public.guest_access_requests (id) on delete set null,
  granted_at timestamptz not null default pg_catalog.clock_timestamp(),
  revoked_at timestamptz,
  primary key (operator_id, guest_id),
  constraint guest_access_different_users check (operator_id <> guest_id)
);

create index guest_access_guest_idx
  on public.guest_access (guest_id, granted_at desc)
  where revoked_at is null;

create table public.attempt_attribution_events (
  id bigint generated always as identity primary key,
  attempt_id uuid not null references public.attempts (id) on delete cascade,
  from_user_id uuid references public.profiles (id) on delete set null,
  to_user_id uuid references public.profiles (id) on delete set null,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default pg_catalog.clock_timestamp()
);

create index attempt_attribution_events_attempt_idx
  on public.attempt_attribution_events (attempt_id, changed_at);

alter table public.guest_access_requests enable row level security;
alter table public.guest_access enable row level security;
alter table public.attempt_attribution_events enable row level security;

-- A recorder needs to reload an unresolved attempt even when it is credited to a guest.
create policy attempts_recorder_read
on public.attempts
for select
to authenticated
using (recorded_by = (select auth.uid()));

-- Historical attempts keep their category label after an admin archives a category.
create policy categories_attempt_history_read
on public.categories
for select
to authenticated
using (
  exists (
    select 1
    from public.attempts as a
    where a.category_id = categories.id
      and (
        a.user_id = (select auth.uid())
        or a.recorded_by = (select auth.uid())
      )
  )
);

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
  operator_id uuid := auth.uid();
  player_id uuid := coalesce($3, auth.uid());
  result public.attempts%rowtype;
begin
  if operator_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  perform 1
  from public.profiles as p
  where p.id = player_id
  for share;

  if not found then
    raise exception 'Player not found' using errcode = 'P0002';
  end if;

  if player_id <> operator_id then
    perform 1
    from public.guest_access as ga
    where ga.operator_id = operator_id
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
        or a.recorded_by = operator_id
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
      operator_id,
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

-- Keep old clients safe: their one-argument starts are explicitly Global/self.
create or replace function public.start_attempt(category uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.start_attempt($1, null, auth.uid());
end;
$$;

create or replace function public.stop_attempt(attempt uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  existing_attempt public.attempts%rowtype;
  result public.attempts%rowtype;
  server_stopped_at timestamptz;
  server_elapsed_ms bigint;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select a.*
  into existing_attempt
  from public.attempts as a
  where a.id = $1
    and (a.recorded_by = current_user_id or a.user_id = current_user_id)
  for update;

  if not found then
    raise exception 'Attempt not found' using errcode = 'P0002';
  end if;

  if existing_attempt.status <> 'running'::public.attempt_status then
    raise exception 'Only a running attempt can be stopped'
      using errcode = '22023';
  end if;

  server_stopped_at := pg_catalog.clock_timestamp();
  if server_stopped_at < existing_attempt.started_at then
    server_stopped_at := existing_attempt.started_at;
  end if;

  server_elapsed_ms := pg_catalog.floor(
    extract(epoch from (server_stopped_at - existing_attempt.started_at)) * 1000
  )::bigint;

  update public.attempts as a
  set stopped_at = server_stopped_at,
      elapsed_ms = server_elapsed_ms,
      status = 'awaiting_confirmation'::public.attempt_status
  where a.id = existing_attempt.id
  returning a.* into result;

  return result;
end;
$$;

create or replace function public.confirm_attempt(attempt uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  existing_attempt public.attempts%rowtype;
  result public.attempts%rowtype;
  server_confirmed_at timestamptz;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select a.*
  into existing_attempt
  from public.attempts as a
  where a.id = $1
    and (a.recorded_by = current_user_id or a.user_id = current_user_id)
  for update;

  if not found then
    raise exception 'Attempt not found' using errcode = 'P0002';
  end if;

  if existing_attempt.status <> 'awaiting_confirmation'::public.attempt_status then
    raise exception 'Only an awaiting attempt can be confirmed'
      using errcode = '22023';
  end if;

  server_confirmed_at := pg_catalog.clock_timestamp();
  if server_confirmed_at < existing_attempt.stopped_at then
    server_confirmed_at := existing_attempt.stopped_at;
  end if;

  update public.attempts as a
  set status = 'approved'::public.attempt_status,
      confirmed_at = server_confirmed_at
  where a.id = existing_attempt.id
  returning a.* into result;

  return result;
end;
$$;

create or replace function public.decline_attempt(attempt uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  existing_attempt public.attempts%rowtype;
  result public.attempts%rowtype;
  server_stopped_at timestamptz;
  server_elapsed_ms bigint;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select a.*
  into existing_attempt
  from public.attempts as a
  where a.id = $1
    and (a.recorded_by = current_user_id or a.user_id = current_user_id)
  for update;

  if not found then
    raise exception 'Attempt not found' using errcode = 'P0002';
  end if;

  if existing_attempt.status not in (
    'running'::public.attempt_status,
    'awaiting_confirmation'::public.attempt_status
  ) then
    raise exception 'Only an unresolved attempt can be declined'
      using errcode = '22023';
  end if;

  if existing_attempt.status = 'running'::public.attempt_status then
    server_stopped_at := pg_catalog.clock_timestamp();
    if server_stopped_at < existing_attempt.started_at then
      server_stopped_at := existing_attempt.started_at;
    end if;

    server_elapsed_ms := pg_catalog.floor(
      extract(epoch from (server_stopped_at - existing_attempt.started_at)) * 1000
    )::bigint;
  else
    server_stopped_at := existing_attempt.stopped_at;
    server_elapsed_ms := existing_attempt.elapsed_ms;
  end if;

  update public.attempts as a
  set stopped_at = server_stopped_at,
      elapsed_ms = server_elapsed_ms,
      status = 'declined'::public.attempt_status,
      confirmed_at = null
  where a.id = existing_attempt.id
  returning a.* into result;

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
  operator_id uuid := auth.uid();
  existing_attempt public.attempts%rowtype;
  result public.attempts%rowtype;
begin
  if operator_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select a.*
  into existing_attempt
  from public.attempts as a
  where a.id = $1
    and a.recorded_by = operator_id
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

  if $2 <> operator_id then
    perform 1
    from public.guest_access as ga
    where ga.operator_id = operator_id
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
    operator_id
  );

  update public.attempts as a
  set user_id = $2
  where a.id = existing_attempt.id
  returning a.* into result;

  return result;
end;
$$;

create or replace function public.get_leaderboard(
  category uuid,
  clan uuid default null
)
returns table (
  rank bigint,
  user_id uuid,
  username text,
  avatar_path text,
  elapsed_ms bigint,
  attempt_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.categories as c
    where c.id = $1
      and (c.is_active or public.is_admin())
  ) then
    raise exception 'Category not found or inactive' using errcode = 'P0002';
  end if;

  if $2 is not null and not exists (
    select 1
    from public.clan_members as caller_membership
    where caller_membership.clan_id = $2
      and caller_membership.user_id = current_user_id
  ) then
    raise exception 'Clan membership required' using errcode = '42501';
  end if;

  return query
  with best_attempts as (
    select distinct on (a.user_id)
      a.user_id,
      a.elapsed_ms,
      a.id as attempt_id
    from public.attempts as a
    where a.category_id = $1
      and a.status = 'approved'::public.attempt_status
      and a.invalidated_at is null
      and (
        ($2 is null and a.clan_id is null)
        or (
          $2 is not null
          and a.clan_id = $2
          and exists (
            select 1
            from public.clan_members as current_member
            where current_member.clan_id = $2
              and current_member.user_id = a.user_id
          )
        )
      )
    order by a.user_id, a.elapsed_ms, a.confirmed_at, a.id
  ),
  ranked_attempts as (
    select
      rank() over (order by best.elapsed_ms) as leaderboard_rank,
      best.user_id,
      best.elapsed_ms,
      best.attempt_id
    from best_attempts as best
  )
  select
    ranked.leaderboard_rank,
    profile.id,
    profile.username::text,
    profile.avatar_path,
    ranked.elapsed_ms,
    ranked.attempt_id
  from ranked_attempts as ranked
  join public.profiles as profile
    on profile.id = ranked.user_id
  order by ranked.leaderboard_rank, profile.username::text, profile.id;
end;
$$;

create or replace function public.get_timer_players()
returns table (
  player_id uuid,
  username text,
  avatar_path text,
  is_host boolean,
  clans jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  return query
  with authorized_players as (
    select current_user_id as id
    union
    select ga.guest_id
    from public.guest_access as ga
    where ga.operator_id = current_user_id
      and ga.revoked_at is null
    union
    select a.user_id
    from public.attempts as a
    where a.recorded_by = current_user_id
      and a.status in (
        'running'::public.attempt_status,
        'awaiting_confirmation'::public.attempt_status
      )
  )
  select
    p.id,
    p.username::text,
    p.avatar_path,
    p.id = current_user_id,
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object('id', c.id, 'name', c.name)
          order by cm.joined_at, c.name
        )
        from public.clan_members as cm
        join public.clans as c on c.id = cm.clan_id
        where cm.user_id = p.id
          and exists (
            select 1
            from public.clan_members as operator_membership
            where operator_membership.clan_id = cm.clan_id
              and operator_membership.user_id = current_user_id
          )
      ),
      '[]'::jsonb
    )
  from authorized_players as ap
  join public.profiles as p on p.id = ap.id
  order by (p.id = current_user_id) desc, p.username::text, p.id;
end;
$$;

create or replace function public.get_attempt_live_elapsed(attempt uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  attempt_row public.attempts%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select a.*
  into attempt_row
  from public.attempts as a
  where a.id = $1
    and (a.recorded_by = current_user_id or a.user_id = current_user_id);

  if not found then
    raise exception 'Attempt not found' using errcode = 'P0002';
  end if;

  if attempt_row.status <> 'running'::public.attempt_status then
    return coalesce(attempt_row.elapsed_ms, 0);
  end if;

  return greatest(
    0,
    pg_catalog.floor(
      extract(epoch from (pg_catalog.clock_timestamp() - attempt_row.started_at)) * 1000
    )::bigint
  );
end;
$$;

create or replace function public.request_guest_access(target_username text)
returns table (
  request_id uuid,
  guest_id uuid,
  username text,
  avatar_path text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_username text := pg_catalog.lower(pg_catalog.btrim(coalesce($1, '')));
  target_profile public.profiles%rowtype;
  existing_request public.guest_access_requests%rowtype;
  request_row public.guest_access_requests%rowtype;
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if normalized_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Invalid username' using errcode = '22023';
  end if;

  select p.*
  into target_profile
  from public.profiles as p
  where p.username = normalized_username
  for share;

  if not found then
    raise exception 'Guest user not found' using errcode = 'P0002';
  end if;

  if target_profile.id = current_user_id then
    raise exception 'Cannot add yourself as a guest' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.guest_access as ga
    where ga.operator_id = current_user_id
      and ga.guest_id = target_profile.id
      and ga.revoked_at is null
  ) then
    raise exception 'Guest access already exists' using errcode = '23505';
  end if;

  update public.guest_access_requests as r
  set rejected_at = now_at
  where r.requester_id = current_user_id
    and r.target_id = target_profile.id
    and r.redeemed_at is null
    and r.rejected_at is null
    and r.expires_at <= now_at;

  select r.*
  into existing_request
  from public.guest_access_requests as r
  where r.requester_id = current_user_id
    and r.target_id = target_profile.id
    and r.redeemed_at is null
    and r.rejected_at is null
  for update;

  if found then
    request_row := existing_request;
  else
    if (
      select pg_catalog.count(*)
      from public.guest_access_requests as recent
      where recent.requester_id = current_user_id
        and recent.created_at >= now_at - interval '1 hour'
    ) >= 10 then
      raise exception 'Guest request rate limit reached' using errcode = 'P0001';
    end if;

    insert into public.guest_access_requests (
      requester_id,
      target_id,
      expires_at
    )
    values (
      current_user_id,
      target_profile.id,
      now_at + interval '10 minutes'
    )
    returning * into request_row;
  end if;

  return query
  select
    request_row.id,
    target_profile.id,
    target_profile.username::text,
    target_profile.avatar_path,
    request_row.expires_at;
end;
$$;

create or replace function public.list_guest_requests()
returns table (
  request_id uuid,
  direction text,
  other_user_id uuid,
  username text,
  avatar_path text,
  created_at timestamptz,
  expires_at timestamptz,
  otp_issued boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  return query
  select
    r.id,
    case when r.target_id = current_user_id then 'incoming' else 'outgoing' end,
    other_profile.id,
    other_profile.username::text,
    other_profile.avatar_path,
    r.created_at,
    r.expires_at,
    r.otp_digest is not null and r.otp_expires_at > pg_catalog.now()
  from public.guest_access_requests as r
  join public.profiles as other_profile
    on other_profile.id = case
      when r.target_id = current_user_id then r.requester_id
      else r.target_id
    end
  where (r.requester_id = current_user_id or r.target_id = current_user_id)
    and r.redeemed_at is null
    and r.rejected_at is null
    and r.expires_at > pg_catalog.now()
  order by r.created_at desc, r.id;
end;
$$;

create or replace function public.issue_guest_otp(request uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  request_row public.guest_access_requests%rowtype;
  random_bytes bytea;
  random_number bigint;
  generated_code text;
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select r.*
  into request_row
  from public.guest_access_requests as r
  where r.id = $1
    and r.target_id = current_user_id
    and r.redeemed_at is null
    and r.rejected_at is null
    and r.expires_at > now_at
  for update;

  if not found then
    raise exception 'Guest request not found or expired' using errcode = 'P0002';
  end if;

  random_bytes := extensions.gen_random_bytes(4);
  random_number := (
    pg_catalog.get_byte(random_bytes, 0)::bigint * 16777216
    + pg_catalog.get_byte(random_bytes, 1)::bigint * 65536
    + pg_catalog.get_byte(random_bytes, 2)::bigint * 256
    + pg_catalog.get_byte(random_bytes, 3)::bigint
  ) % 1000000;
  generated_code := pg_catalog.lpad(random_number::text, 6, '0');

  update public.guest_access_requests as r
  set otp_digest = pg_catalog.encode(
        extensions.digest(r.id::text || ':' || generated_code, 'sha256'),
        'hex'
      ),
      otp_expires_at = least(r.expires_at, now_at + interval '5 minutes'),
      failed_attempts = 0
  where r.id = request_row.id;

  return generated_code;
end;
$$;

create or replace function public.redeem_guest_access(
  request uuid,
  otp text
)
returns table (
  success boolean,
  error_message text,
  player_id uuid,
  username text,
  avatar_path text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  request_row public.guest_access_requests%rowtype;
  normalized_otp text := pg_catalog.btrim(coalesce($2, ''));
  supplied_digest text;
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select r.*
  into request_row
  from public.guest_access_requests as r
  where r.id = $1
    and r.requester_id = current_user_id
  for update;

  if not found or request_row.redeemed_at is not null or request_row.rejected_at is not null then
    return query select false, 'Anmodningen findes ikke længere.', null::uuid, null::text, null::text;
    return;
  end if;

  if request_row.expires_at <= now_at then
    update public.guest_access_requests as r
    set rejected_at = now_at
    where r.id = request_row.id;
    return query select false, 'Anmodningen er udløbet. Send en ny.', null::uuid, null::text, null::text;
    return;
  end if;

  if request_row.otp_digest is null or request_row.otp_expires_at <= now_at then
    return query select false, 'Koden er ikke klar eller er udløbet.', null::uuid, null::text, null::text;
    return;
  end if;

  if normalized_otp !~ '^[0-9]{6}$' then
    return query select false, 'Koden skal være seks cifre.', null::uuid, null::text, null::text;
    return;
  end if;

  supplied_digest := pg_catalog.encode(
    extensions.digest(request_row.id::text || ':' || normalized_otp, 'sha256'),
    'hex'
  );

  if supplied_digest <> request_row.otp_digest then
    update public.guest_access_requests as r
    set failed_attempts = least(5, r.failed_attempts + 1),
        rejected_at = case when r.failed_attempts + 1 >= 5 then now_at else null end
    where r.id = request_row.id;

    return query select false, 'Koden er forkert.', null::uuid, null::text, null::text;
    return;
  end if;

  insert into public.guest_access (
    operator_id,
    guest_id,
    request_id,
    granted_at,
    revoked_at
  )
  values (
    current_user_id,
    request_row.target_id,
    request_row.id,
    now_at,
    null
  )
  on conflict (operator_id, guest_id) do update
  set request_id = excluded.request_id,
      granted_at = excluded.granted_at,
      revoked_at = null;

  update public.guest_access_requests as r
  set redeemed_at = now_at,
      otp_digest = null,
      otp_expires_at = null
  where r.id = request_row.id;

  return query
  select true, null::text, p.id, p.username::text, p.avatar_path
  from public.profiles as p
  where p.id = request_row.target_id;
end;
$$;

create or replace function public.list_guest_access()
returns table (
  direction text,
  other_user_id uuid,
  username text,
  avatar_path text,
  granted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  return query
  select
    case when ga.operator_id = current_user_id then 'guest' else 'operator' end,
    other_profile.id,
    other_profile.username::text,
    other_profile.avatar_path,
    ga.granted_at
  from public.guest_access as ga
  join public.profiles as other_profile
    on other_profile.id = case
      when ga.operator_id = current_user_id then ga.guest_id
      else ga.operator_id
    end
  where (ga.operator_id = current_user_id or ga.guest_id = current_user_id)
    and ga.revoked_at is null
  order by ga.granted_at desc, other_profile.username::text;
end;
$$;

create or replace function public.revoke_guest_access(other_user uuid)
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

  update public.guest_access as ga
  set revoked_at = pg_catalog.clock_timestamp()
  where ga.revoked_at is null
    and (
      (ga.operator_id = current_user_id and ga.guest_id = $1)
      or (ga.guest_id = current_user_id and ga.operator_id = $1)
    );

  if not found then
    raise exception 'Guest access not found' using errcode = 'P0002';
  end if;

  return true;
end;
$$;

revoke all on table public.guest_access_requests from public, anon, authenticated;
revoke all on table public.guest_access from public, anon, authenticated;
revoke all on table public.attempt_attribution_events from public, anon, authenticated;

revoke all on function public.start_attempt(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.reassign_attempt(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_timer_players() from public, anon, authenticated;
revoke all on function public.get_attempt_live_elapsed(uuid) from public, anon, authenticated;
revoke all on function public.request_guest_access(text) from public, anon, authenticated;
revoke all on function public.list_guest_requests() from public, anon, authenticated;
revoke all on function public.issue_guest_otp(uuid) from public, anon, authenticated;
revoke all on function public.redeem_guest_access(uuid, text) from public, anon, authenticated;
revoke all on function public.list_guest_access() from public, anon, authenticated;
revoke all on function public.revoke_guest_access(uuid) from public, anon, authenticated;

grant execute on function public.start_attempt(uuid, uuid, uuid) to authenticated;
grant execute on function public.reassign_attempt(uuid, uuid) to authenticated;
grant execute on function public.get_timer_players() to authenticated;
grant execute on function public.get_attempt_live_elapsed(uuid) to authenticated;
grant execute on function public.request_guest_access(text) to authenticated;
grant execute on function public.list_guest_requests() to authenticated;
grant execute on function public.issue_guest_otp(uuid) to authenticated;
grant execute on function public.redeem_guest_access(uuid, text) to authenticated;
grant execute on function public.list_guest_access() to authenticated;
grant execute on function public.revoke_guest_access(uuid) to authenticated;

comment on column public.attempts.clan_id is
  'Null means Global; otherwise the attempt belongs only to this clan leaderboard.';
comment on column public.attempts.recorded_by is
  'Authenticated account that operated the timer; user_id is the credited player.';
