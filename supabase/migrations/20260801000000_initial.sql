create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

create type public.profile_role as enum ('user', 'admin');
create type public.attempt_status as enum (
  'running',
  'awaiting_confirmation',
  'approved',
  'declined',
  'invalidated'
);
create type public.clan_member_role as enum ('owner', 'member');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username extensions.citext not null,
  avatar_path text,
  role public.profile_role not null default 'user'::public.profile_role,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint profiles_username_key unique (username),
  constraint profiles_username_format check (
    username::text ~ '^[a-z0-9_]{3,24}$'
  )
);

create table public.categories (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  icon_key text not null,
  accent_color text not null,
  description text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint categories_name_key unique (name),
  constraint categories_name_length check (
    pg_catalog.char_length(pg_catalog.btrim(name)) between 1 and 80
  ),
  constraint categories_icon_key_format check (
    icon_key ~ '^[a-z0-9][a-z0-9_-]{0,49}$'
  ),
  constraint categories_accent_color_format check (
    accent_color ~ '^#[0-9A-Fa-f]{6}$'
  )
);

create table public.attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete restrict,
  started_at timestamptz not null,
  stopped_at timestamptz,
  elapsed_ms bigint,
  status public.attempt_status not null default 'running'::public.attempt_status,
  confirmed_at timestamptz,
  invalidated_at timestamptz,
  invalidated_by uuid references public.profiles (id) on delete set null,
  invalidated_reason text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint attempts_elapsed_nonnegative check (
    elapsed_ms is null or elapsed_ms >= 0
  ),
  constraint attempts_stopped_after_start check (
    stopped_at is null or stopped_at >= started_at
  ),
  constraint attempts_stopped_elapsed_together check (
    (stopped_at is null) = (elapsed_ms is null)
  ),
  constraint attempts_status_timing check (
    (
      status = 'running'::public.attempt_status
      and stopped_at is null
    )
    or (
      status <> 'running'::public.attempt_status
      and stopped_at is not null
    )
  ),
  constraint attempts_confirmation_state check (
    (
      status = 'approved'::public.attempt_status
      and confirmed_at is not null
    )
    or (
      status in (
        'running'::public.attempt_status,
        'awaiting_confirmation'::public.attempt_status,
        'declined'::public.attempt_status
      )
      and confirmed_at is null
    )
    or status = 'invalidated'::public.attempt_status
  ),
  constraint attempts_confirmed_after_stop check (
    confirmed_at is null or confirmed_at >= stopped_at
  ),
  constraint attempts_invalidation_state check (
    (
      status = 'invalidated'::public.attempt_status
      and invalidated_at is not null
      and nullif(pg_catalog.btrim(invalidated_reason), '') is not null
    )
    or (
      status <> 'invalidated'::public.attempt_status
      and invalidated_at is null
      and invalidated_by is null
      and invalidated_reason is null
    )
  ),
  constraint attempts_invalidated_after_start check (
    invalidated_at is null or invalidated_at >= started_at
  )
);

create table public.clans (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  invite_code text not null default pg_catalog.encode(extensions.gen_random_bytes(12), 'hex'),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint clans_invite_code_key unique (invite_code),
  constraint clans_id_created_by_key unique (id, created_by),
  constraint clans_name_format check (
    name = pg_catalog.btrim(name)
    and pg_catalog.char_length(name) between 2 and 64
  ),
  constraint clans_invite_code_format check (
    invite_code ~ '^[0-9a-f]{24}$'
  )
);

create table public.clan_members (
  clan_id uuid not null references public.clans (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.clan_member_role not null default 'member'::public.clan_member_role,
  joined_at timestamptz not null default pg_catalog.now(),
  primary key (clan_id, user_id)
);

-- Only service-role login actions can reach this table through the throttle RPCs.
create table public.login_attempts (
  id bigint generated always as identity primary key,
  identity_hash text not null,
  ip_hash text not null,
  attempted_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint login_attempts_identity_hash_format check (identity_hash ~ '^[0-9a-f]{64}$'),
  constraint login_attempts_ip_hash_format check (ip_hash ~ '^[0-9a-f]{64}$')
);

-- This deferred circular FK keeps the designated clan owner in clan_members while
-- still allowing create/transfer RPCs to update both records in one transaction.
alter table public.clans
  add constraint clans_owner_membership_fkey
  foreign key (id, created_by)
  references public.clan_members (clan_id, user_id)
  deferrable initially deferred;

create unique index attempts_one_unresolved_per_user_idx
  on public.attempts (user_id)
  where status in (
    'running'::public.attempt_status,
    'awaiting_confirmation'::public.attempt_status
  );

create index attempts_user_history_idx
  on public.attempts (user_id, created_at desc);

create index attempts_leaderboard_idx
  on public.attempts (category_id, elapsed_ms, user_id, id)
  where status = 'approved'::public.attempt_status
    and invalidated_at is null;

create index categories_active_sort_idx
  on public.categories (sort_order, name)
  where is_active;

create index clans_created_by_idx
  on public.clans (created_by);

create index clan_members_user_idx
  on public.clan_members (user_id, joined_at);

create index login_attempts_identity_window_idx
  on public.login_attempts (identity_hash, attempted_at desc);

create index login_attempts_ip_window_idx
  on public.login_attempts (ip_hash, attempted_at desc);

create index login_attempts_cleanup_idx
  on public.login_attempts (attempted_at);

create unique index clan_members_one_owner_idx
  on public.clan_members (clan_id)
  where role = 'owner'::public.clan_member_role;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger categories_set_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

create trigger attempts_set_updated_at
before update on public.attempts
for each row execute function public.set_updated_at();

create trigger clans_set_updated_at
before update on public.clans
for each row execute function public.set_updated_at();

create or replace function public.prevent_profile_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'Profile id is immutable' using errcode = '22023';
  end if;

  -- Compare the underlying text because citext considers case-only changes equal.
  if new.username::text is distinct from old.username::text then
    raise exception 'Username is immutable' using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger profiles_prevent_identity_change
before update on public.profiles
for each row execute function public.prevent_profile_identity_change();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select p.role = 'admin'::public.profile_role
      from public.profiles as p
      where p.id = auth.uid()
    ),
    false
  );
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_username text;
  expected_email text;
begin
  normalized_username := pg_catalog.lower(
    pg_catalog.btrim(
      coalesce(new.raw_user_meta_data ->> 'username', '')
    )
  );

  if normalized_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Username must match [a-z0-9_]{3,24}'
      using errcode = '23514';
  end if;

  expected_email := pg_catalog.encode(
    extensions.digest(normalized_username, 'sha256'),
    'hex'
  ) || '@users.bundforhelved.invalid';

  if new.email is distinct from expected_email then
    raise exception 'Account identity does not match username'
      using errcode = '23514';
  end if;

  -- Deliberately copy only the username; role metadata is never trusted.
  insert into public.profiles (id, username)
  values (new.id, normalized_username);

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.prevent_auth_identity_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    raise exception 'Account email identity is immutable' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger auth_users_prevent_identity_change
before update on auth.users
for each row execute function public.prevent_auth_identity_change();

create or replace function public.is_clan_member(clan uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.clan_members as cm
      where cm.clan_id = $1
        and cm.user_id = auth.uid()
    );
$$;

-- clans.created_by uses RESTRICT. This BEFORE DELETE trigger resolves every
-- owned clan before an auth.users -> profiles cascade reaches that restriction.
create or replace function public.handle_profile_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owned_clan_id uuid;
  next_owner_id uuid;
begin
  for owned_clan_id in
    select c.id
    from public.clans as c
    where c.created_by = old.id
    order by c.id
    for update
  loop
    next_owner_id := null;

    select cm.user_id
    into next_owner_id
    from public.clan_members as cm
    where cm.clan_id = owned_clan_id
      and cm.user_id <> old.id
    order by cm.joined_at, cm.user_id
    limit 1
    for update;

    if next_owner_id is null then
      delete from public.clans as c
      where c.id = owned_clan_id;
    else
      -- Demote first so the partial unique owner index is never transiently violated.
      update public.clan_members as cm
      set role = 'member'::public.clan_member_role
      where cm.clan_id = owned_clan_id
        and cm.user_id = old.id;

      update public.clan_members as cm
      set role = 'owner'::public.clan_member_role
      where cm.clan_id = owned_clan_id
        and cm.user_id = next_owner_id;

      update public.clans as c
      set created_by = next_owner_id
      where c.id = owned_clan_id;
    end if;
  end loop;

  return old;
end;
$$;

create trigger profiles_transfer_owned_clans
before delete on public.profiles
for each row execute function public.handle_profile_before_delete();

comment on function public.handle_profile_before_delete() is
  'Transfers each owned clan to its oldest remaining member, or deletes it when empty, before profile/auth cascade deletion.';

insert into public.categories (
  id,
  name,
  icon_key,
  accent_color,
  description,
  sort_order,
  is_active
)
values
  (
    '00000000-0000-4000-8000-000000000001'::uuid,
    'Flaske',
    'bottle',
    '#D97706',
    'Øl drukket fra flaske.',
    10,
    true
  ),
  (
    '00000000-0000-4000-8000-000000000002'::uuid,
    'Dåse',
    'can',
    '#2563EB',
    'Øl drukket fra dåse.',
    20,
    true
  ),
  (
    '00000000-0000-4000-8000-000000000003'::uuid,
    'Krus',
    'cup',
    '#7C3AED',
    'Øl drukket fra krus.',
    30,
    true
  )
on conflict (id) do update
set name = excluded.name,
    icon_key = excluded.icon_key,
    accent_color = excluded.accent_color,
    description = excluded.description,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active;

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.attempts enable row level security;
alter table public.clans enable row level security;
alter table public.clan_members enable row level security;
alter table public.login_attempts enable row level security;

create policy profiles_authenticated_read
on public.profiles
for select
to authenticated
using (true);

create policy profiles_admin_update
on public.profiles
for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy categories_active_read
on public.categories
for select
to anon, authenticated
using (is_active);

create policy categories_admin_manage
on public.categories
for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

-- Archived categories stay readable only while the current user must resolve
-- a timer in that category.
create policy categories_unresolved_attempt_read
on public.categories
for select
to authenticated
using (
  exists (
    select 1
    from public.attempts as a
    where a.category_id = categories.id
      and a.user_id = (select auth.uid())
      and a.status in (
        'running'::public.attempt_status,
        'awaiting_confirmation'::public.attempt_status
      )
  )
);

create policy attempts_owner_read
on public.attempts
for select
to authenticated
using (user_id = (select auth.uid()));

create policy attempts_admin_manage
on public.attempts
for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

-- Membership checks run in a SECURITY DEFINER helper, avoiding clan_members RLS recursion.
create policy clans_member_read
on public.clans
for select
to authenticated
using ((select public.is_clan_member(id)));

create policy clans_owner_delete
on public.clans
for delete
to authenticated
using (created_by = (select auth.uid()));

create policy clans_admin_manage
on public.clans
for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy clan_members_member_read
on public.clan_members
for select
to authenticated
using ((select public.is_clan_member(clan_id)));

create policy clan_members_admin_manage
on public.clan_members
for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create or replace function public.start_attempt(category uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  result public.attempts%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  perform 1
  from public.categories as c
  where c.id = $1
    and c.is_active
  for share;

  if not found then
    raise exception 'Category is not active' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.attempts as a
    where a.user_id = current_user_id
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
      category_id,
      started_at,
      status
    )
    values (
      current_user_id,
      $1,
      pg_catalog.clock_timestamp(),
      'running'::public.attempt_status
    )
    returning * into result;
  exception
    when unique_violation then
      -- The partial unique index closes the race between concurrent starts.
      raise exception 'An unresolved attempt already exists'
        using errcode = '23505';
  end;

  return result;
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
    and a.user_id = current_user_id
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
    and a.user_id = current_user_id
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
    and a.user_id = current_user_id
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

create or replace function public.set_own_avatar(path text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_path text := $1;
  result public.profiles%rowtype;
  required_prefix text;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  required_prefix := current_user_id::text || '/';

  if requested_path is not null and (
    pg_catalog.char_length(requested_path) > 512
    or pg_catalog.char_length(requested_path) <= pg_catalog.char_length(required_prefix)
    or pg_catalog.left(requested_path, pg_catalog.char_length(required_prefix)) <> required_prefix
  ) then
    raise exception 'Avatar path must be beneath the current user UUID folder'
      using errcode = '22023';
  end if;

  update public.profiles as p
  set avatar_path = requested_path
  where p.id = current_user_id
  returning p.* into result;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  return result;
end;
$$;

create or replace function public.consume_login_attempt(
  identity_hash text,
  ip_hash text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  window_start timestamptz := pg_catalog.clock_timestamp() - interval '15 minutes';
  cleanup_before timestamptz := pg_catalog.clock_timestamp() - interval '1 day';
  identity_lock bigint := pg_catalog.hashtextextended($1, 0);
  ip_lock bigint := pg_catalog.hashtextextended($2, 1);
begin
  if $1 !~ '^[0-9a-f]{64}$' or $2 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid login throttle key' using errcode = '22023';
  end if;

  -- Lock both counters in stable order so neither concurrent username nor IP
  -- requests can race a limit or deadlock each other.
  if identity_lock <= ip_lock then
    perform pg_catalog.pg_advisory_xact_lock(identity_lock);
    if identity_lock <> ip_lock then
      perform pg_catalog.pg_advisory_xact_lock(ip_lock);
    end if;
  else
    perform pg_catalog.pg_advisory_xact_lock(ip_lock);
    perform pg_catalog.pg_advisory_xact_lock(identity_lock);
  end if;

  delete from public.login_attempts
  where attempted_at < cleanup_before;

  if (
    select pg_catalog.count(*)
    from public.login_attempts
    where login_attempts.identity_hash = $1
      and attempted_at >= window_start
  ) >= 8 then
    raise exception 'Login rate limit reached' using errcode = 'P0001';
  end if;

  if (
    select pg_catalog.count(*)
    from public.login_attempts
    where login_attempts.ip_hash = $2
      and attempted_at >= window_start
  ) >= 40 then
    raise exception 'Login rate limit reached' using errcode = 'P0001';
  end if;

  insert into public.login_attempts (identity_hash, ip_hash)
  values ($1, $2);
end;
$$;

create or replace function public.clear_login_attempts(
  identity_hash text,
  ip_hash text
)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.login_attempts
  where login_attempts.identity_hash = $1
    and login_attempts.ip_hash = $2;
$$;

create or replace function public.invalidate_attempt(
  attempt uuid,
  reason text
)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_attempt public.attempts%rowtype;
  result public.attempts%rowtype;
  normalized_reason text := pg_catalog.btrim(coalesce($2, ''));
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if normalized_reason = '' then
    normalized_reason := 'Markeret som falsk af admin.';
  end if;

  select a.*
  into existing_attempt
  from public.attempts as a
  where a.id = $1
  for update;

  if not found then
    raise exception 'Attempt not found' using errcode = 'P0002';
  end if;

  if existing_attempt.status <> 'approved'::public.attempt_status then
    raise exception 'Only an approved attempt can be invalidated' using errcode = '22023';
  end if;

  update public.attempts as a
  set status = 'invalidated'::public.attempt_status,
      invalidated_at = pg_catalog.clock_timestamp(),
      invalidated_by = auth.uid(),
      invalidated_reason = normalized_reason
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
        $2 is null
        or exists (
          select 1
          from public.clan_members as current_member
          where current_member.clan_id = $2
            and current_member.user_id = a.user_id
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

create or replace function public.create_clan(name text)
returns public.clans
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_name text := pg_catalog.btrim(coalesce($1, ''));
  generated_code text;
  result public.clans%rowtype;
  created boolean := false;
  try_number integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if pg_catalog.char_length(normalized_name) not between 2 and 64 then
    raise exception 'Clan name must be between 2 and 64 characters'
      using errcode = '22023';
  end if;

  for try_number in 1..5 loop
    generated_code := pg_catalog.encode(extensions.gen_random_bytes(12), 'hex');

    begin
      insert into public.clans (name, invite_code, created_by)
      values (normalized_name, generated_code, current_user_id)
      returning * into result;

      created := true;
    exception
      when unique_violation then
        created := false;
    end;

    exit when created;
  end loop;

  if not created then
    raise exception 'Could not generate a unique clan invite code';
  end if;

  insert into public.clan_members (clan_id, user_id, role)
  values (
    result.id,
    current_user_id,
    'owner'::public.clan_member_role
  );

  return result;
end;
$$;

create or replace function public.join_clan(invite_code text)
returns public.clans
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_code text := pg_catalog.lower(pg_catalog.btrim(coalesce($1, '')));
  result public.clans%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select c.*
  into result
  from public.clans as c
  where c.invite_code = normalized_code
  for update;

  if not found then
    raise exception 'Invite code not found' using errcode = 'P0002';
  end if;

  insert into public.clan_members (clan_id, user_id, role)
  values (
    result.id,
    current_user_id,
    'member'::public.clan_member_role
  )
  on conflict (clan_id, user_id) do nothing;

  return result;
end;
$$;

create or replace function public.leave_clan(clan uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  owner_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select c.created_by
  into owner_id
  from public.clans as c
  where c.id = $1
  for update;

  if not found then
    raise exception 'Clan not found' using errcode = 'P0002';
  end if;

  if owner_id = current_user_id then
    raise exception 'Transfer ownership or delete the clan before leaving'
      using errcode = '22023';
  end if;

  delete from public.clan_members as cm
  where cm.clan_id = $1
    and cm.user_id = current_user_id;

  if not found then
    raise exception 'Clan membership not found' using errcode = 'P0002';
  end if;

  return true;
end;
$$;

create or replace function public.regenerate_clan_code(clan uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  existing_clan public.clans%rowtype;
  generated_code text;
  try_number integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select c.*
  into existing_clan
  from public.clans as c
  where c.id = $1
  for update;

  if not found then
    raise exception 'Clan not found' using errcode = 'P0002';
  end if;

  if existing_clan.created_by <> current_user_id and not public.is_admin() then
    raise exception 'Clan owner access required' using errcode = '42501';
  end if;

  for try_number in 1..5 loop
    generated_code := pg_catalog.encode(extensions.gen_random_bytes(12), 'hex');

    if generated_code = existing_clan.invite_code then
      continue;
    end if;

    begin
      update public.clans as c
      set invite_code = generated_code
      where c.id = existing_clan.id;

      return generated_code;
    exception
      when unique_violation then
        null;
    end;
  end loop;

  raise exception 'Could not generate a unique clan invite code';
end;
$$;

create or replace function public.remove_clan_member(clan uuid, "user" uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  existing_clan public.clans%rowtype;
  target_role public.clan_member_role;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select c.*
  into existing_clan
  from public.clans as c
  where c.id = $1
  for update;

  if not found then
    raise exception 'Clan not found' using errcode = 'P0002';
  end if;

  if existing_clan.created_by <> current_user_id and not public.is_admin() then
    raise exception 'Clan owner access required' using errcode = '42501';
  end if;

  select cm.role
  into target_role
  from public.clan_members as cm
  where cm.clan_id = existing_clan.id
    and cm.user_id = $2
  for update;

  if not found then
    raise exception 'Clan membership not found' using errcode = 'P0002';
  end if;

  if $2 = existing_clan.created_by or target_role = 'owner'::public.clan_member_role then
    raise exception 'The clan owner must transfer ownership before removal'
      using errcode = '22023';
  end if;

  delete from public.clan_members as cm
  where cm.clan_id = existing_clan.id
    and cm.user_id = $2;

  return true;
end;
$$;

create or replace function public.transfer_clan(clan uuid, new_owner uuid)
returns public.clans
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  existing_clan public.clans%rowtype;
  result public.clans%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if $2 is null then
    raise exception 'New owner is required' using errcode = '22023';
  end if;

  select c.*
  into existing_clan
  from public.clans as c
  where c.id = $1
  for update;

  if not found then
    raise exception 'Clan not found' using errcode = 'P0002';
  end if;

  if existing_clan.created_by <> current_user_id and not public.is_admin() then
    raise exception 'Clan owner access required' using errcode = '42501';
  end if;

  if existing_clan.created_by = $2 then
    return existing_clan;
  end if;

  perform 1
  from public.clan_members as cm
  where cm.clan_id = existing_clan.id
    and cm.user_id = $2
  for update;

  if not found then
    raise exception 'New owner must be a current clan member'
      using errcode = '22023';
  end if;

  update public.clan_members as cm
  set role = 'member'::public.clan_member_role
  where cm.clan_id = existing_clan.id
    and cm.user_id = existing_clan.created_by;

  if not found then
    raise exception 'Current owner membership is missing'
      using errcode = '23514';
  end if;

  update public.clan_members as cm
  set role = 'owner'::public.clan_member_role
  where cm.clan_id = existing_clan.id
    and cm.user_id = $2;

  update public.clans as c
  set created_by = $2
  where c.id = existing_clan.id
  returning c.* into result;

  return result;
end;
$$;

revoke all on table public.profiles from public, anon, authenticated;
revoke all on table public.categories from public, anon, authenticated;
revoke all on table public.attempts from public, anon, authenticated;
revoke all on table public.clans from public, anon, authenticated;
revoke all on table public.clan_members from public, anon, authenticated;
revoke all on table public.login_attempts from public, anon, authenticated;

grant select, update on table public.profiles to authenticated;
grant select on table public.categories to anon, authenticated;
grant insert, update, delete on table public.categories to authenticated;
grant select, insert, update, delete on table public.attempts to authenticated;
grant select, insert, update, delete on table public.clans to authenticated;
grant select, insert, update, delete on table public.clan_members to authenticated;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.prevent_profile_identity_change() from public, anon, authenticated;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.prevent_auth_identity_change() from public, anon, authenticated;
revoke all on function public.handle_profile_before_delete() from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon, authenticated;
revoke all on function public.is_clan_member(uuid) from public, anon, authenticated;
revoke all on function public.start_attempt(uuid) from public, anon, authenticated;
revoke all on function public.stop_attempt(uuid) from public, anon, authenticated;
revoke all on function public.confirm_attempt(uuid) from public, anon, authenticated;
revoke all on function public.decline_attempt(uuid) from public, anon, authenticated;
revoke all on function public.set_own_avatar(text) from public, anon, authenticated;
revoke all on function public.consume_login_attempt(text, text) from public, anon, authenticated, service_role;
revoke all on function public.clear_login_attempts(text, text) from public, anon, authenticated, service_role;
revoke all on function public.invalidate_attempt(uuid, text) from public, anon, authenticated;
revoke all on function public.get_leaderboard(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_clan(text) from public, anon, authenticated;
revoke all on function public.join_clan(text) from public, anon, authenticated;
revoke all on function public.leave_clan(uuid) from public, anon, authenticated;
revoke all on function public.regenerate_clan_code(uuid) from public, anon, authenticated;
revoke all on function public.remove_clan_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public.transfer_clan(uuid, uuid) from public, anon, authenticated;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_clan_member(uuid) to authenticated;
grant execute on function public.start_attempt(uuid) to authenticated;
grant execute on function public.stop_attempt(uuid) to authenticated;
grant execute on function public.confirm_attempt(uuid) to authenticated;
grant execute on function public.decline_attempt(uuid) to authenticated;
grant execute on function public.set_own_avatar(text) to authenticated;
grant execute on function public.consume_login_attempt(text, text) to service_role;
grant execute on function public.clear_login_attempts(text, text) to service_role;
grant execute on function public.invalidate_attempt(uuid, text) to authenticated;
grant execute on function public.get_leaderboard(uuid, uuid) to authenticated;
grant execute on function public.create_clan(text) to authenticated;
grant execute on function public.join_clan(text) to authenticated;
grant execute on function public.leave_clan(uuid) to authenticated;
grant execute on function public.regenerate_clan_code(uuid) to authenticated;
grant execute on function public.remove_clan_member(uuid, uuid) to authenticated;
grant execute on function public.transfer_clan(uuid, uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Public buckets permit media reads; object mutation remains owner-folder scoped.
create policy avatars_owner_manage
on storage.objects
for all
to authenticated
using (
  bucket_id = 'avatars'
  and name like ((select auth.uid())::text || '/%')
)
with check (
  bucket_id = 'avatars'
  and name like ((select auth.uid())::text || '/%')
);

create policy avatars_admin_manage
on storage.objects
for all
to authenticated
using (
  bucket_id = 'avatars'
  and (select public.is_admin())
)
with check (
  bucket_id = 'avatars'
  and (select public.is_admin())
);
