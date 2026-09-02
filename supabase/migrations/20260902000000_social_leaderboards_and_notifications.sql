create index attempts_approved_user_category_elapsed_idx
  on public.attempts (user_id, category_id, elapsed_ms)
  where status = 'approved'::public.attempt_status
    and invalidated_at is null;

create table public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  url text not null,
  source_user_id uuid references public.profiles (id) on delete set null,
  attempt_id uuid references public.attempts (id) on delete set null,
  category_id uuid references public.categories (id) on delete set null,
  "position" smallint,
  dedupe_key text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  read_at timestamptz,
  push_sent_at timestamptz,
  constraint notifications_type check (
    type in ('friend_request', 'peer_review_ping', 'leaderboard_top3')
  ),
  constraint notifications_url check (url like '/%'),
  constraint notifications_position check (position is null or position between 1 and 3)
);

create index notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

create index notifications_pending_push_idx
  on public.notifications (created_at)
  where push_sent_at is null;

create unique index notifications_user_dedupe_idx
  on public.notifications (user_id, dedupe_key)
  where dedupe_key is not null;

alter table public.notifications enable row level security;

create table public.push_subscriptions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint push_subscriptions_endpoint_length check (pg_catalog.char_length(endpoint) between 1 and 2048),
  constraint push_subscriptions_p256dh_length check (pg_catalog.char_length(p256dh) between 1 and 512),
  constraint push_subscriptions_auth_length check (pg_catalog.char_length(auth) between 1 and 256)
);

create index push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create or replace function public.search_friend_profiles(prefix text)
returns table (
  user_id uuid,
  username text,
  avatar_path text,
  relationship text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  clean_prefix text := pg_catalog.btrim(coalesce($1, ''));
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if pg_catalog.char_length(clean_prefix) not between 1 and 64 then
    raise exception 'Search prefix must contain between 1 and 64 characters'
      using errcode = '22023';
  end if;

  return query
  select
    p.id,
    p.username::text,
    p.avatar_path,
    case
      when f.status = 'accepted' then 'friend'
      when f.recipient_id = current_user_id then 'incoming'
      when f.requester_id = current_user_id then 'outgoing'
      else null
    end
  from public.profiles as p
  left join public.friendships as f
    on (f.requester_id = current_user_id and f.recipient_id = p.id)
    or (f.recipient_id = current_user_id and f.requester_id = p.id)
  where p.id <> current_user_id
    and pg_catalog.left(
      pg_catalog.lower(p.username::text),
      pg_catalog.char_length(pg_catalog.lower(clean_prefix))
    ) = pg_catalog.lower(clean_prefix)
  order by pg_catalog.lower(p.username::text), p.id
  limit 10;
end;
$$;

create or replace function public.list_friend_recommendations()
returns table (
  user_id uuid,
  username text,
  avatar_path text,
  mutual_friend_count bigint,
  mutual_usernames text[]
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
  with direct_friends as (
    select case
      when f.requester_id = current_user_id then f.recipient_id
      else f.requester_id
    end as user_id
    from public.friendships as f
    where f.status = 'accepted'
      and (f.requester_id = current_user_id or f.recipient_id = current_user_id)
  ),
  friend_connections as (
    select
      direct.user_id as mutual_user_id,
      case
        when f.requester_id = direct.user_id then f.recipient_id
        else f.requester_id
      end as candidate_id
    from direct_friends as direct
    join public.friendships as f
      on f.status = 'accepted'
      and (f.requester_id = direct.user_id or f.recipient_id = direct.user_id)
  )
  select
    candidate.id,
    candidate.username::text,
    candidate.avatar_path,
    pg_catalog.count(distinct connection.mutual_user_id),
    pg_catalog.array_agg(distinct mutual.username::text order by mutual.username::text)
  from friend_connections as connection
  join public.profiles as candidate on candidate.id = connection.candidate_id
  join public.profiles as mutual on mutual.id = connection.mutual_user_id
  where connection.candidate_id <> current_user_id
    and not exists (
      select 1
      from public.friendships as existing
      where (existing.requester_id = current_user_id and existing.recipient_id = connection.candidate_id)
         or (existing.recipient_id = current_user_id and existing.requester_id = connection.candidate_id)
    )
  group by candidate.id, candidate.username, candidate.avatar_path
  order by pg_catalog.count(distinct connection.mutual_user_id) desc,
           pg_catalog.lower(candidate.username::text),
           candidate.id;
end;
$$;

create or replace function public.get_drink_director_leaderboard(
  clan uuid default null,
  friends_only boolean default false
)
returns table (
  rank bigint,
  user_id uuid,
  username text,
  avatar_path text,
  approved_count bigint
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

  if coalesce($2, false) and $1 is not null then
    raise exception 'Friends and clan scopes cannot be combined' using errcode = '22023';
  end if;

  if $1 is not null and not exists (
    select 1
    from public.clan_members as caller_membership
    where caller_membership.clan_id = $1
      and caller_membership.user_id = current_user_id
  ) then
    raise exception 'Clan membership required' using errcode = '42501';
  end if;

  return query
  with approved_counts as (
    select a.user_id, pg_catalog.count(*) as completed_count
    from public.attempts as a
    where a.status = 'approved'::public.attempt_status
      and a.invalidated_at is null
      and (
        (
          coalesce($2, false)
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
          not coalesce($2, false)
          and (
            $1 is null
            or (
              a.clan_id = $1
              and exists (
                select 1
                from public.clan_members as current_member
                where current_member.clan_id = $1
                  and current_member.user_id = a.user_id
              )
            )
          )
        )
      )
    group by a.user_id
  ),
  ranked_counts as (
    select
      pg_catalog.rank() over (order by counts.completed_count desc) as leaderboard_rank,
      counts.user_id,
      counts.completed_count
    from approved_counts as counts
  )
  select
    ranked.leaderboard_rank,
    profile.id,
    profile.username::text,
    profile.avatar_path,
    ranked.completed_count
  from ranked_counts as ranked
  join public.profiles as profile on profile.id = ranked.user_id
  order by ranked.leaderboard_rank, pg_catalog.lower(profile.username::text), profile.id;
end;
$$;

create or replace function public.get_friend_profile(friend uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  result jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if $1 is null or $1 = current_user_id or not exists (
    select 1
    from public.friendships as f
    where f.status = 'accepted'
      and (
        (f.requester_id = current_user_id and f.recipient_id = $1)
        or (f.recipient_id = current_user_id and f.requester_id = $1)
      )
  ) then
    raise exception 'Accepted friendship required to view profile' using errcode = '42501';
  end if;

  select pg_catalog.jsonb_build_object(
    'profile', pg_catalog.jsonb_build_object(
      'id', p.id,
      'username', p.username::text,
      'avatar_path', p.avatar_path,
      'role', p.role,
      'created_at', p.created_at
    ),
    'attempts', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', a.id,
          'category_id', a.category_id,
          'clan_id', a.clan_id,
          'elapsed_ms', a.elapsed_ms,
          'confirmed_at', a.confirmed_at,
          'submitted_for_review_at', a.submitted_for_review_at,
          'reviewed_by', a.reviewed_by,
          'status', a.status,
          'invalidated_reason', a.invalidated_reason,
          'created_at', a.created_at,
          'scope_name', case when a.clan_id is null then 'Global' else coalesce(clan.name, 'Klan') end,
          'categories', pg_catalog.jsonb_build_object(
            'id', category.id,
            'name', category.name,
            'icon_key', category.icon_key,
            'accent_color', category.accent_color
          ),
          'reviewer', case
            when reviewer.id is null then null
            else pg_catalog.jsonb_build_object('username', reviewer.username::text)
          end
        )
        order by a.created_at desc, a.id desc
      )
      from public.attempts as a
      join public.categories as category on category.id = a.category_id
      left join public.clans as clan on clan.id = a.clan_id
      left join public.profiles as reviewer on reviewer.id = a.reviewed_by
      where a.user_id = p.id
        and a.status in (
          'approved'::public.attempt_status,
          'pending_review'::public.attempt_status,
          'invalidated'::public.attempt_status
        )
    ), '[]'::jsonb)
  )
  into result
  from public.profiles as p
  where p.id = $1;

  if result is null then
    raise exception 'Friend profile not found' using errcode = 'P0002';
  end if;

  return result;
end;
$$;

create or replace function public.get_social_badges()
returns jsonb
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

  return pg_catalog.jsonb_build_object(
    'friend_requests', (
      select pg_catalog.count(*)
      from public.friendships as f
      where f.recipient_id = current_user_id
        and f.status = 'pending'
    ),
    'peer_reviews', (
      select pg_catalog.count(*)
      from public.attempts as a
      where a.status = 'pending_review'::public.attempt_status
        and a.user_id <> current_user_id
        and (a.recorded_by is null or a.recorded_by <> current_user_id)
        and public.is_friend(a.user_id)
    ),
    'notifications', (
      select pg_catalog.count(*)
      from public.notifications as n
      where n.user_id = current_user_id
        and n.read_at is null
    )
  );
end;
$$;

create or replace function public.list_notifications(max_items integer default 20)
returns table (
  notification_id uuid,
  type text,
  title text,
  body text,
  url text,
  source_user_id uuid,
  source_username text,
  source_avatar_path text,
  "position" smallint,
  created_at timestamptz,
  read_at timestamptz
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

  if $1 not between 1 and 50 then
    raise exception 'Notification limit must be between 1 and 50' using errcode = '22023';
  end if;

  return query
  select
    n.id,
    n.type,
    n.title,
    n.body,
    n.url,
    n.source_user_id,
    source.username::text,
    source.avatar_path,
    n.position,
    n.created_at,
    n.read_at
  from public.notifications as n
  left join public.profiles as source on source.id = n.source_user_id
  where n.user_id = current_user_id
  order by n.created_at desc, n.id desc
  limit $1;
end;
$$;

create or replace function public.mark_notifications_read(notification_ids uuid[] default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  changed_count bigint;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  with changed as (
    update public.notifications as n
    set read_at = pg_catalog.clock_timestamp()
    where n.user_id = current_user_id
      and n.read_at is null
      and ($1 is null or n.id = any($1))
    returning n.id
  )
  select pg_catalog.count(*) into changed_count from changed;

  return changed_count;
end;
$$;

create or replace function public.upsert_push_subscription(
  subscription_endpoint text,
  subscription_p256dh text,
  subscription_auth text,
  subscription_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  subscription_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if pg_catalog.char_length(coalesce($1, '')) not between 1 and 2048
     or pg_catalog.char_length(coalesce($2, '')) not between 1 and 512
     or pg_catalog.char_length(coalesce($3, '')) not between 1 and 256 then
    raise exception 'Invalid push subscription' using errcode = '22023';
  end if;

  insert into public.push_subscriptions (
    user_id,
    endpoint,
    p256dh,
    auth,
    user_agent
  ) values (
    current_user_id,
    $1,
    $2,
    $3,
    pg_catalog.left($4, 512)
  )
  on conflict (endpoint) do update
  set user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = excluded.user_agent,
      updated_at = pg_catalog.clock_timestamp()
  returning id into subscription_id;

  return subscription_id;
end;
$$;

create or replace function public.remove_push_subscription(subscription_endpoint text)
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

  delete from public.push_subscriptions as subscription
  where subscription.user_id = current_user_id
    and subscription.endpoint = $1;

  return found;
end;
$$;

create or replace function public.ping_friend_for_review(friend uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  pending_attempt_id uuid;
  pending_category_id uuid;
  pending_category_name text;
  current_username text;
  inserted boolean;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.friendships as f
    where f.status = 'accepted'
      and (
        (f.requester_id = current_user_id and f.recipient_id = $1)
        or (f.recipient_id = current_user_id and f.requester_id = $1)
      )
  ) then
    raise exception 'Accepted friendship required to ping reviewer' using errcode = '42501';
  end if;

  select a.id, a.category_id, category.name
  into pending_attempt_id, pending_category_id, pending_category_name
  from public.attempts as a
  join public.categories as category on category.id = a.category_id
  where a.user_id = current_user_id
    and a.status = 'pending_review'::public.attempt_status
    and (a.recorded_by is null or a.recorded_by <> $1)
  order by a.submitted_for_review_at desc, a.id desc
  limit 1;

  if pending_attempt_id is null then
    raise exception 'No reviewable attempt is waiting' using errcode = 'P0002';
  end if;

  select p.username::text into current_username
  from public.profiles as p
  where p.id = current_user_id;

  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    url,
    source_user_id,
    attempt_id,
    category_id,
    dedupe_key
  ) values (
    $1,
    'peer_review_ping',
    'Peer review venter',
    '@' || current_username || ' vil gerne have dig til at tjekke en ' || pending_category_name || '-tid.',
    '/venner#reviews',
    current_user_id,
    pending_attempt_id,
    pending_category_id,
    'review-ping:' || pending_attempt_id::text || ':' || $1::text
  )
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing
  returning true into inserted;

  return coalesce(inserted, false);
end;
$$;

create or replace function public.notify_friend_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester_username text;
begin
  select p.username::text into requester_username
  from public.profiles as p
  where p.id = new.requester_id;

  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    url,
    source_user_id,
    dedupe_key
  ) values (
    new.recipient_id,
    'friend_request',
    'Ny venneanmodning',
    '@' || requester_username || ' vil gerne være venner.',
    '/venner',
    new.requester_id,
    'friend-request:' || new.id::text
  );

  return new;
end;
$$;

create trigger friendships_notify_request
after insert on public.friendships
for each row
when (new.status = 'pending')
execute function public.notify_friend_request();

create or replace function public.friend_category_rank(
  viewer uuid,
  player uuid,
  category uuid,
  excluded_attempt uuid default null
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  with scoped_users as (
    select $1 as user_id
    union
    select case
      when f.requester_id = $1 then f.recipient_id
      else f.requester_id
    end
    from public.friendships as f
    where f.status = 'accepted'
      and (f.requester_id = $1 or f.recipient_id = $1)
  ),
  best_times as (
    select a.user_id, pg_catalog.min(a.elapsed_ms) as elapsed_ms
    from public.attempts as a
    join scoped_users as scoped on scoped.user_id = a.user_id
    where a.category_id = $3
      and a.status = 'approved'::public.attempt_status
      and a.invalidated_at is null
      and ($4 is null or a.id <> $4)
    group by a.user_id
  ),
  target as (
    select best.elapsed_ms
    from best_times as best
    where best.user_id = $2
  )
  select case
    when (select target.elapsed_ms from target) is null then null
    else 1 + (
      select pg_catalog.count(*)
      from best_times as competitor
      where competitor.elapsed_ms < (select target.elapsed_ms from target)
    )
  end;
$$;

create or replace function public.notify_friend_top_three()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient record;
  new_rank bigint;
  old_rank bigint;
  player_username text;
  category_name text;
begin
  if new.status <> 'approved'::public.attempt_status
     or old.status = 'approved'::public.attempt_status then
    return new;
  end if;

  select p.username::text, c.name
  into player_username, category_name
  from public.profiles as p
  cross join public.categories as c
  where p.id = new.user_id
    and c.id = new.category_id;

  for recipient in
    select case
      when f.requester_id = new.user_id then f.recipient_id
      else f.requester_id
    end as user_id
    from public.friendships as f
    where f.status = 'accepted'
      and (f.requester_id = new.user_id or f.recipient_id = new.user_id)
  loop
    new_rank := public.friend_category_rank(
      recipient.user_id,
      new.user_id,
      new.category_id,
      null
    );
    old_rank := public.friend_category_rank(
      recipient.user_id,
      new.user_id,
      new.category_id,
      new.id
    );

    if new_rank between 1 and 3 and (old_rank is null or old_rank > 3) then
      insert into public.notifications (
        user_id,
        type,
        title,
        body,
        url,
        source_user_id,
        attempt_id,
        category_id,
        position,
        dedupe_key
      ) values (
        recipient.user_id,
        'leaderboard_top3',
        'En ven ramte top 3',
        '@' || player_username || ' er nu nr. ' || new_rank::text || ' i ' || category_name || ' blandt dine venner.',
        '/rangliste?kategori=' || new.category_id::text || '&venner=1',
        new.user_id,
        new.id,
        new.category_id,
        new_rank::smallint,
        'top3:' || new.id::text || ':' || recipient.user_id::text
      )
      on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
    end if;
  end loop;

  return new;
end;
$$;

create trigger attempts_notify_friend_top_three
after update of status on public.attempts
for each row
when (
  new.status = 'approved'::public.attempt_status
  and old.status <> 'approved'::public.attempt_status
)
execute function public.notify_friend_top_three();

revoke all on table public.notifications from public, anon, authenticated;
revoke all on table public.push_subscriptions from public, anon, authenticated;
grant select, update, delete on table public.notifications to service_role;
grant all on table public.push_subscriptions to service_role;

revoke all on function public.search_friend_profiles(text) from public, anon, authenticated, service_role;
revoke all on function public.list_friend_recommendations() from public, anon, authenticated, service_role;
revoke all on function public.get_drink_director_leaderboard(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.get_friend_profile(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_social_badges() from public, anon, authenticated, service_role;
revoke all on function public.list_notifications(integer) from public, anon, authenticated, service_role;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.upsert_push_subscription(text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.remove_push_subscription(text) from public, anon, authenticated, service_role;
revoke all on function public.ping_friend_for_review(uuid) from public, anon, authenticated, service_role;
revoke all on function public.notify_friend_request() from public, anon, authenticated, service_role;
revoke all on function public.friend_category_rank(uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.notify_friend_top_three() from public, anon, authenticated, service_role;

grant execute on function public.search_friend_profiles(text) to authenticated;
grant execute on function public.list_friend_recommendations() to authenticated;
grant execute on function public.get_drink_director_leaderboard(uuid, boolean) to authenticated;
grant execute on function public.get_friend_profile(uuid) to authenticated;
grant execute on function public.get_social_badges() to authenticated;
grant execute on function public.list_notifications(integer) to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.upsert_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.remove_push_subscription(text) to authenticated;
grant execute on function public.ping_friend_for_review(uuid) to authenticated;

comment on function public.get_drink_director_leaderboard(uuid, boolean) is
  'Ranks players exclusively by their number of approved attempts.';
comment on table public.notifications is
  'Small persistent social notification feed used by in-app and Web Push delivery.';
