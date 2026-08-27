create index friendships_requester_accepted_idx
  on public.friendships (requester_id, recipient_id)
  where status = 'accepted';

create index friendships_recipient_accepted_idx
  on public.friendships (recipient_id, requester_id)
  where status = 'accepted';

alter table public.notifications
  drop constraint notifications_url,
  add constraint notifications_url check (url like '/%' and url not like '//%');

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
  requested_items integer := coalesce($1, 20);
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if requested_items not between 1 and 50 then
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
  limit requested_items;
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
  existing_subscription public.push_subscriptions%rowtype;
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

  if $1 !~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|web\.push\.apple\.com|[a-zA-Z0-9.-]+\.notify\.windows\.com)(/|$)' then
    raise exception 'Unsupported push service' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(current_user_id::text, 0)
  );

  select subscription.*
  into existing_subscription
  from public.push_subscriptions as subscription
  where subscription.endpoint = $1
  for update;

  if found then
    if existing_subscription.user_id <> current_user_id
       and (existing_subscription.p256dh <> $2 or existing_subscription.auth <> $3) then
      raise exception 'Push subscription belongs to another device' using errcode = '42501';
    end if;

    update public.push_subscriptions as subscription
    set user_id = current_user_id,
        p256dh = $2,
        auth = $3,
        user_agent = pg_catalog.left($4, 512),
        updated_at = pg_catalog.clock_timestamp()
    where subscription.id = existing_subscription.id
    returning subscription.id into subscription_id;
  else
    if (
      select pg_catalog.count(*)
      from public.push_subscriptions as subscription
      where subscription.user_id = current_user_id
    ) >= 5 then
      raise exception 'Push subscription limit reached' using errcode = '42501';
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
    returning id into subscription_id;
  end if;

  return subscription_id;
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
          'clan_id', case
            when a.clan_id is null or exists (
              select 1
              from public.clan_members as viewer_membership
              where viewer_membership.clan_id = a.clan_id
                and viewer_membership.user_id = current_user_id
            ) then a.clan_id
            else null
          end,
          'elapsed_ms', a.elapsed_ms,
          'confirmed_at', a.confirmed_at,
          'submitted_for_review_at', a.submitted_for_review_at,
          'reviewed_by', a.reviewed_by,
          'status', a.status,
          'invalidated_reason', null,
          'created_at', a.created_at,
          'scope_name', case
            when a.clan_id is null then 'Global'
            when exists (
              select 1
              from public.clan_members as viewer_membership
              where viewer_membership.clan_id = a.clan_id
                and viewer_membership.user_id = current_user_id
            ) then coalesce(clan.name, 'Klan')
            else 'Privat klan'
          end,
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
      and a.status in (
        'approved'::public.attempt_status,
        'pending_review'::public.attempt_status
      )
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
  if new.status not in (
       'approved'::public.attempt_status,
       'pending_review'::public.attempt_status
     )
     or old.status in (
       'approved'::public.attempt_status,
       'pending_review'::public.attempt_status
     ) then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.category_id::text, 0)
  );

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

drop trigger attempts_notify_friend_top_three on public.attempts;

create trigger attempts_notify_friend_top_three
after update of status on public.attempts
for each row
when (
  new.status in (
    'approved'::public.attempt_status,
    'pending_review'::public.attempt_status
  )
  and old.status not in (
    'approved'::public.attempt_status,
    'pending_review'::public.attempt_status
  )
)
execute function public.notify_friend_top_three();

revoke all on function public.list_notifications(integer) from public, anon, authenticated, service_role;
revoke all on function public.upsert_push_subscription(text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.get_friend_profile(uuid) from public, anon, authenticated, service_role;
revoke all on function public.friend_category_rank(uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.notify_friend_top_three() from public, anon, authenticated, service_role;

grant execute on function public.list_notifications(integer) to authenticated;
grant execute on function public.upsert_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.get_friend_profile(uuid) to authenticated;
