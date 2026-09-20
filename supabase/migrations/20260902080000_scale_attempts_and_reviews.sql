create index friendships_recipient_status_idx
  on public.friendships (recipient_id, status, created_at desc);

create index attempts_pending_review_user_idx
  on public.attempts (user_id, submitted_for_review_at desc, id)
  where status = 'pending_review'::public.attempt_status;

create index attempts_admin_stopped_idx
  on public.attempts (stopped_at desc, id desc)
  where status <> 'running'::public.attempt_status;

create index attempts_admin_status_stopped_idx
  on public.attempts (status, stopped_at desc, id desc)
  where status <> 'running'::public.attempt_status;

create index notifications_user_unread_idx
  on public.notifications (user_id)
  where read_at is null;

drop function if exists public.list_peer_review_attempts();

create function public.list_peer_review_attempts(
  page_offset integer default 0,
  page_size integer default 20
)
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
  evidence_video_path text,
  total_count bigint
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

  if $1 < 0 or $2 not between 1 and 50 then
    raise exception 'Invalid review page' using errcode = '22023';
  end if;

  return query
  with friend_ids as (
    select f.recipient_id as user_id
    from public.friendships as f
    where f.requester_id = current_user_id
      and f.status = 'accepted'
    union all
    select f.requester_id
    from public.friendships as f
    where f.recipient_id = current_user_id
      and f.status = 'accepted'
  )
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
    a.evidence_video_path,
    pg_catalog.count(*) over()
  from friend_ids as friend
  join public.attempts as a on a.user_id = friend.user_id
  join public.profiles as p on p.id = a.user_id
  join public.categories as c on c.id = a.category_id
  left join public.clans as clan on clan.id = a.clan_id
  where a.status = 'pending_review'::public.attempt_status
    and (a.recorded_by is null or a.recorded_by <> current_user_id)
  order by a.submitted_for_review_at desc, a.id desc
  offset $1
  limit $2;
end;
$$;

revoke all on function public.list_peer_review_attempts(integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_peer_review_attempts(integer, integer) to authenticated;

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
      with friend_ids as (
        select f.recipient_id as user_id
        from public.friendships as f
        where f.requester_id = current_user_id
          and f.status = 'accepted'
        union all
        select f.requester_id
        from public.friendships as f
        where f.recipient_id = current_user_id
          and f.status = 'accepted'
      )
      select pg_catalog.count(*)
      from friend_ids as friend
      join public.attempts as a on a.user_id = friend.user_id
      where a.status = 'pending_review'::public.attempt_status
        and (a.recorded_by is null or a.recorded_by <> current_user_id)
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

create or replace function public.notify_friend_top_three()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
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

  with recipients as (
    select friend.user_id
    from (
      select f.recipient_id as user_id
      from public.friendships as f
      where f.requester_id = new.user_id
        and f.status = 'accepted'
      union all
      select f.requester_id
      from public.friendships as f
      where f.recipient_id = new.user_id
        and f.status = 'accepted'
    ) as friend
    left join public.notification_preferences as preference
      on preference.user_id = friend.user_id
    where coalesce(preference.friends_top_three, true)
  ),
  scoped_users as (
    select recipient.user_id as recipient_id, recipient.user_id as scoped_user_id
    from recipients as recipient
    union
    select recipient.user_id, friendship.recipient_id
    from recipients as recipient
    join public.friendships as friendship
      on friendship.requester_id = recipient.user_id
     and friendship.status = 'accepted'
    union
    select recipient.user_id, friendship.requester_id
    from recipients as recipient
    join public.friendships as friendship
      on friendship.recipient_id = recipient.user_id
     and friendship.status = 'accepted'
  ),
  player_best as (
    select
      pg_catalog.min(a.elapsed_ms) as new_elapsed_ms,
      pg_catalog.min(a.elapsed_ms) filter (where a.id <> new.id) as old_elapsed_ms
    from public.attempts as a
    where a.user_id = new.user_id
      and a.category_id = new.category_id
      and a.status in (
        'approved'::public.attempt_status,
        'pending_review'::public.attempt_status
      )
      and a.invalidated_at is null
  ),
  competitor_best as (
    select scoped.recipient_id, a.user_id, pg_catalog.min(a.elapsed_ms) as elapsed_ms
    from scoped_users as scoped
    join public.attempts as a on a.user_id = scoped.scoped_user_id
    where a.user_id <> new.user_id
      and a.category_id = new.category_id
      and a.status in (
        'approved'::public.attempt_status,
        'pending_review'::public.attempt_status
      )
      and a.invalidated_at is null
    group by scoped.recipient_id, a.user_id
  ),
  ranks as (
    select
      recipient.user_id,
      1 + pg_catalog.count(competitor.user_id) filter (
        where competitor.elapsed_ms < best.new_elapsed_ms
      ) as new_rank,
      case
        when best.old_elapsed_ms is null then null
        else 1 + pg_catalog.count(competitor.user_id) filter (
          where competitor.elapsed_ms < best.old_elapsed_ms
        )
      end as old_rank
    from recipients as recipient
    cross join player_best as best
    left join competitor_best as competitor on competitor.recipient_id = recipient.user_id
    group by recipient.user_id, best.new_elapsed_ms, best.old_elapsed_ms
  )
  insert into public.notifications (
    user_id, type, title, body, url, source_user_id, attempt_id, category_id, position, dedupe_key
  )
  select
    ranked.user_id,
    'leaderboard_top3',
    'En ven ramte top 3',
    '@' || player_username || ' er nu nr. ' || ranked.new_rank::text || ' i ' || category_name || ' blandt dine venner.',
    '/rangliste?kategori=' || new.category_id::text || '&venner=1',
    new.user_id,
    new.id,
    new.category_id,
    ranked.new_rank::smallint,
    'top3:' || new.id::text || ':' || ranked.user_id::text
  from ranks as ranked
  where ranked.new_rank between 1 and 3
    and (ranked.old_rank is null or ranked.old_rank > 3)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;

  return new;
end;
$$;

create function public.list_admin_attempts(
  search_query text default '',
  status_filter text default null,
  page_offset integer default 0,
  page_size integer default 50
)
returns table (
  id uuid,
  user_id uuid,
  recorded_by uuid,
  category_id uuid,
  clan_id uuid,
  elapsed_ms bigint,
  stopped_at timestamptz,
  confirmed_at timestamptz,
  submitted_for_review_at timestamptz,
  reviewed_at timestamptz,
  status public.attempt_status,
  invalidated_reason text,
  player_username text,
  player_avatar_path text,
  recorder_username text,
  category_name text,
  category_icon_key text,
  category_accent_color text,
  clan_name text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  clean_query text := pg_catalog.lower(pg_catalog.btrim(coalesce($1, '')));
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if pg_catalog.char_length(clean_query) > 100
     or ($2 is not null and $2 not in ('awaiting_confirmation', 'pending_review', 'approved', 'declined', 'invalidated'))
     or $3 < 0
     or $4 not between 1 and 100 then
    raise exception 'Invalid admin attempt page' using errcode = '22023';
  end if;

  return query
  select
    a.id,
    a.user_id,
    a.recorded_by,
    a.category_id,
    a.clan_id,
    a.elapsed_ms,
    a.stopped_at,
    a.confirmed_at,
    a.submitted_for_review_at,
    a.reviewed_at,
    a.status,
    a.invalidated_reason,
    player.username::text,
    player.avatar_path,
    recorder.username::text,
    category.name,
    category.icon_key,
    category.accent_color,
    clan.name,
    pg_catalog.count(*) over()
  from public.attempts as a
  join public.profiles as player on player.id = a.user_id
  left join public.profiles as recorder on recorder.id = a.recorded_by
  join public.categories as category on category.id = a.category_id
  left join public.clans as clan on clan.id = a.clan_id
  where a.status <> 'running'::public.attempt_status
    and ($2 is null or a.status::text = $2)
    and (
      clean_query = ''
      or pg_catalog.strpos(pg_catalog.lower(player.username::text), clean_query) > 0
      or pg_catalog.strpos(pg_catalog.lower(category.name), clean_query) > 0
      or pg_catalog.strpos(pg_catalog.lower(coalesce(clan.name, 'global')), clean_query) > 0
      or pg_catalog.strpos(pg_catalog.lower(a.id::text), clean_query) > 0
    )
  order by a.stopped_at desc, a.id desc
  offset $3
  limit $4;
end;
$$;

revoke all on function public.list_admin_attempts(text, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_admin_attempts(text, text, integer, integer) to authenticated;
