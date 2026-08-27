create table public.friendships (
  id uuid primary key default extensions.gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  responded_at timestamptz,
  constraint friendships_different_users check (requester_id <> recipient_id),
  constraint friendships_status check (status in ('pending', 'accepted')),
  constraint friendships_response_state check (
    (status = 'pending' and responded_at is null)
    or (status = 'accepted' and responded_at is not null)
  )
);

create unique index friendships_pair_idx
  on public.friendships (
    least(requester_id, recipient_id),
    greatest(requester_id, recipient_id)
  );

create index friendships_recipient_pending_idx
  on public.friendships (recipient_id, created_at desc)
  where status = 'pending';

create index friendships_requester_status_idx
  on public.friendships (requester_id, status, created_at desc);

alter table public.friendships enable row level security;

create policy friendships_participant_read
on public.friendships
for select
to authenticated
using (
  requester_id = (select auth.uid())
  or recipient_id = (select auth.uid())
);

create or replace function public.is_friend(other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and $1 is not null
    and $1 <> auth.uid()
    and exists (
      select 1
      from public.friendships as f
      where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.recipient_id = $1)
          or (f.recipient_id = auth.uid() and f.requester_id = $1)
        )
    );
$$;

create or replace function public.request_friend(target_username text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  clean_username text := pg_catalog.btrim(coalesce($1, ''));
  target_user_id uuid;
  existing_friendship public.friendships%rowtype;
  friendship_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if pg_catalog.char_length(clean_username) not between 1 and 64 then
    raise exception 'Friend username must contain between 1 and 64 characters'
      using errcode = '22023';
  end if;

  select p.id
  into target_user_id
  from public.profiles as p
  where pg_catalog.lower(p.username::text) = pg_catalog.lower(clean_username)
  limit 1;

  if not found then
    raise exception 'Friend user not found' using errcode = 'P0002';
  end if;

  if target_user_id = current_user_id then
    raise exception 'Cannot add yourself as a friend' using errcode = '22023';
  end if;

  select f.*
  into existing_friendship
  from public.friendships as f
  where (f.requester_id = current_user_id and f.recipient_id = target_user_id)
     or (f.requester_id = target_user_id and f.recipient_id = current_user_id)
  for update;

  if found then
    if existing_friendship.status = 'accepted' then
      raise exception 'Users are already friends' using errcode = '23505';
    end if;

    if existing_friendship.recipient_id = current_user_id then
      raise exception 'Incoming friend request already exists' using errcode = '23505';
    end if;

    return existing_friendship.id;
  end if;

  if (
    select pg_catalog.count(*)
    from public.friendships as f
    where f.requester_id = current_user_id
      and f.status = 'pending'
  ) >= 100 then
    raise exception 'Friend request rate limit reached' using errcode = '42501';
  end if;

  begin
    insert into public.friendships (requester_id, recipient_id)
    values (current_user_id, target_user_id)
    returning id into friendship_id;
  exception
    when unique_violation then
      raise exception 'Friend request already exists' using errcode = '23505';
  end;

  return friendship_id;
end;
$$;

create or replace function public.respond_friend_request(
  friendship uuid,
  accept boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  existing_friendship public.friendships%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if $2 is null then
    raise exception 'Friend request decision is required' using errcode = '22023';
  end if;

  select f.*
  into existing_friendship
  from public.friendships as f
  where f.id = $1
    and f.recipient_id = current_user_id
    and f.status = 'pending'
  for update;

  if not found then
    raise exception 'Friend request not found' using errcode = 'P0002';
  end if;

  if $2 then
    update public.friendships as f
    set status = 'accepted',
        responded_at = pg_catalog.clock_timestamp()
    where f.id = existing_friendship.id;
  else
    delete from public.friendships as f
    where f.id = existing_friendship.id;
  end if;

  return true;
end;
$$;

create or replace function public.remove_friend(friendship uuid)
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

  delete from public.friendships as f
  where f.id = $1
    and (f.requester_id = current_user_id or f.recipient_id = current_user_id);

  if not found then
    raise exception 'Friendship not found' using errcode = 'P0002';
  end if;

  return true;
end;
$$;

create or replace function public.list_friendships()
returns table (
  friendship_id uuid,
  other_user_id uuid,
  username text,
  avatar_path text,
  direction text,
  created_at timestamptz
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
    f.id,
    other_profile.id,
    other_profile.username::text,
    other_profile.avatar_path,
    case
      when f.status = 'accepted' then 'friend'
      when f.recipient_id = current_user_id then 'incoming'
      else 'outgoing'
    end,
    f.created_at
  from public.friendships as f
  join public.profiles as other_profile
    on other_profile.id = case
      when f.requester_id = current_user_id then f.recipient_id
      else f.requester_id
    end
  where f.requester_id = current_user_id
     or f.recipient_id = current_user_id
  order by
    case
      when f.status = 'pending' and f.recipient_id = current_user_id then 0
      when f.status = 'accepted' then 1
      else 2
    end,
    other_profile.username::text,
    f.id;
end;
$$;

drop function if exists public.review_attempt(uuid, text, boolean);

alter table public.attempts
  drop constraint if exists attempts_review_state;

update public.attempts
set review_code = null
where review_code is not null;

alter table public.attempts
  add constraint attempts_review_state check (
    review_code is null
    and (
      (
        status = 'pending_review'::public.attempt_status
        and submitted_for_review_at is not null
        and reviewed_by is null
        and reviewed_at is null
        and review_note is null
      )
      or status <> 'pending_review'::public.attempt_status
    )
  );

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
  server_submitted_at timestamptz;
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
    raise exception 'Only an awaiting attempt can be submitted for review'
      using errcode = '22023';
  end if;

  server_submitted_at := pg_catalog.clock_timestamp();
  if server_submitted_at < existing_attempt.stopped_at then
    server_submitted_at := existing_attempt.stopped_at;
  end if;

  update public.attempts as a
  set status = 'pending_review'::public.attempt_status,
      review_code = null,
      submitted_for_review_at = server_submitted_at,
      confirmed_at = null,
      reviewed_by = null,
      reviewed_at = null,
      review_note = null,
      invalidated_at = null,
      invalidated_by = null,
      invalidated_reason = null
  where a.id = existing_attempt.id
  returning a.* into result;

  return result;
end;
$$;

create or replace function public.review_attempt(
  attempt uuid,
  approve boolean
)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  reviewer_id uuid := auth.uid();
  existing_attempt public.attempts%rowtype;
  result public.attempts%rowtype;
  server_reviewed_at timestamptz;
begin
  if reviewer_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if $2 is null then
    raise exception 'Review decision is required' using errcode = '22023';
  end if;

  select a.*
  into existing_attempt
  from public.attempts as a
  where a.id = $1
  for update;

  if not found then
    raise exception 'Attempt not found' using errcode = 'P0002';
  end if;

  if existing_attempt.status <> 'pending_review'::public.attempt_status then
    raise exception 'Attempt is not pending peer review' using errcode = '22023';
  end if;

  if reviewer_id = existing_attempt.user_id
     or reviewer_id = existing_attempt.recorded_by then
    raise exception 'A different account must review this attempt'
      using errcode = '42501';
  end if;

  if not public.is_friend(existing_attempt.user_id) then
    raise exception 'Accepted friendship required to review this attempt'
      using errcode = '42501';
  end if;

  server_reviewed_at := pg_catalog.clock_timestamp();
  if server_reviewed_at < existing_attempt.submitted_for_review_at then
    server_reviewed_at := existing_attempt.submitted_for_review_at;
  end if;

  if $2 then
    update public.attempts as a
    set status = 'approved'::public.attempt_status,
        review_code = null,
        confirmed_at = server_reviewed_at,
        reviewed_by = reviewer_id,
        reviewed_at = server_reviewed_at,
        review_note = null
    where a.id = existing_attempt.id
    returning a.* into result;
  else
    update public.attempts as a
    set status = 'declined'::public.attempt_status,
        review_code = null,
        confirmed_at = null,
        reviewed_by = reviewer_id,
        reviewed_at = server_reviewed_at,
        review_note = 'Declined by friend reviewer.'
    where a.id = existing_attempt.id
    returning a.* into result;
  end if;

  return result;
end;
$$;

create or replace function public.list_peer_review_attempts()
returns table (
  attempt_id uuid,
  user_id uuid,
  username text,
  avatar_path text,
  category_id uuid,
  category_name text,
  category_icon_key text,
  category_accent_color text,
  clan_id uuid,
  clan_name text,
  elapsed_ms bigint,
  stopped_at timestamptz,
  submitted_for_review_at timestamptz,
  evidence_video_path text
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
    a.id,
    p.id,
    p.username::text,
    p.avatar_path,
    c.id,
    c.name,
    c.icon_key,
    c.accent_color,
    a.clan_id,
    clan.name,
    a.elapsed_ms,
    a.stopped_at,
    a.submitted_for_review_at,
    a.evidence_video_path
  from public.attempts as a
  join public.profiles as p on p.id = a.user_id
  join public.categories as c on c.id = a.category_id
  left join public.clans as clan on clan.id = a.clan_id
  where a.status = 'pending_review'::public.attempt_status
    and a.user_id <> current_user_id
    and (a.recorded_by is null or a.recorded_by <> current_user_id)
    and public.is_friend(a.user_id)
  order by a.submitted_for_review_at desc, a.id
  limit 100;
end;
$$;

create or replace function public.can_review_attempt_video(path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and $1 is not null
    and exists (
      select 1
      from public.attempts as a
      where a.status = 'pending_review'::public.attempt_status
        and a.evidence_video_path = $1
        and a.id::text = pg_catalog.split_part($1, '/', 1)
        and a.user_id <> auth.uid()
        and (a.recorded_by is null or a.recorded_by <> auth.uid())
        and public.is_friend(a.user_id)
    );
$$;

drop function if exists public.get_leaderboard(uuid, uuid);

create function public.get_leaderboard(
  category uuid,
  clan uuid default null,
  friends_only boolean default false
)
returns table (
  rank bigint,
  user_id uuid,
  username text,
  avatar_path text,
  elapsed_ms bigint,
  attempt_id uuid,
  status public.attempt_status
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

  if coalesce($3, false) and $2 is not null then
    raise exception 'Friends and clan scopes cannot be combined' using errcode = '22023';
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
      a.id as attempt_id,
      a.status
    from public.attempts as a
    where a.category_id = $1
      and a.status in (
        'approved'::public.attempt_status,
        'pending_review'::public.attempt_status
      )
      and a.invalidated_at is null
      and (
        (
          coalesce($3, false)
          and (
            a.user_id = current_user_id
            or exists (
              select 1
              from public.friendships as f
              where f.status = 'accepted'
                and (
                  (f.requester_id = current_user_id and f.recipient_id = a.user_id)
                  or (f.recipient_id = current_user_id and f.requester_id = a.user_id)
                )
            )
          )
        )
        or (
          not coalesce($3, false)
          and (
            $2 is null
            or (
              a.clan_id = $2
              and exists (
                select 1
                from public.clan_members as current_member
                where current_member.clan_id = $2
                  and current_member.user_id = a.user_id
              )
            )
          )
        )
      )
    order by
      a.user_id,
      a.elapsed_ms,
      case when a.status = 'approved'::public.attempt_status then 0 else 1 end,
      coalesce(a.confirmed_at, a.submitted_for_review_at, a.stopped_at),
      a.id
  ),
  ranked_attempts as (
    select
      rank() over (order by best.elapsed_ms) as leaderboard_rank,
      best.user_id,
      best.elapsed_ms,
      best.attempt_id,
      best.status
    from best_attempts as best
  )
  select
    ranked.leaderboard_rank,
    profile.id,
    profile.username::text,
    profile.avatar_path,
    ranked.elapsed_ms,
    ranked.attempt_id,
    ranked.status
  from ranked_attempts as ranked
  join public.profiles as profile on profile.id = ranked.user_id
  order by ranked.leaderboard_rank, profile.username::text, profile.id;
end;
$$;

revoke all on table public.friendships from public, anon, authenticated;

revoke all on function public.is_friend(uuid) from public, anon, authenticated, service_role;
revoke all on function public.request_friend(text) from public, anon, authenticated, service_role;
revoke all on function public.respond_friend_request(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.remove_friend(uuid) from public, anon, authenticated, service_role;
revoke all on function public.list_friendships() from public, anon, authenticated, service_role;
revoke all on function public.confirm_attempt(uuid) from public, anon, authenticated, service_role;
revoke all on function public.review_attempt(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.list_peer_review_attempts() from public, anon, authenticated, service_role;
revoke all on function public.can_review_attempt_video(text) from public, anon, authenticated, service_role;
revoke all on function public.get_leaderboard(uuid, uuid, boolean) from public, anon, authenticated, service_role;

grant execute on function public.is_friend(uuid) to authenticated;
grant execute on function public.request_friend(text) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.list_friendships() to authenticated;
grant execute on function public.confirm_attempt(uuid) to authenticated;
grant execute on function public.review_attempt(uuid, boolean) to authenticated;
grant execute on function public.list_peer_review_attempts() to authenticated;
grant execute on function public.can_review_attempt_video(text) to authenticated;
grant execute on function public.get_leaderboard(uuid, uuid, boolean) to authenticated;

comment on table public.friendships is
  'Mutual friendships created by one user and accepted by the other.';
comment on column public.attempts.review_code is
  'Deprecated. Friend-only peer review no longer uses a shared code and this column must remain null.';
