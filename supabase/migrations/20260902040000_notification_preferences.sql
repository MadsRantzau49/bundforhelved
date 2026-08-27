create table public.notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  friends_top_three boolean not null default true,
  peer_review_pings boolean not null default true,
  friend_requests boolean not null default true,
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);

alter table public.notification_preferences enable row level security;

create or replace function public.get_notification_preferences()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  preferences public.notification_preferences%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select preference.* into preferences
  from public.notification_preferences as preference
  where preference.user_id = current_user_id;

  return pg_catalog.jsonb_build_object(
    'friends_top_three', coalesce(preferences.friends_top_three, true),
    'peer_review_pings', coalesce(preferences.peer_review_pings, true),
    'friend_requests', coalesce(preferences.friend_requests, true)
  );
end;
$$;

create or replace function public.set_notification_preferences(
  receive_friends_top_three boolean,
  receive_peer_review_pings boolean,
  receive_friend_requests boolean
)
returns void
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

  insert into public.notification_preferences (
    user_id,
    friends_top_three,
    peer_review_pings,
    friend_requests
  ) values (
    current_user_id,
    coalesce($1, false),
    coalesce($2, false),
    coalesce($3, false)
  )
  on conflict (user_id) do update
  set friends_top_three = excluded.friends_top_three,
      peer_review_pings = excluded.peer_review_pings,
      friend_requests = excluded.friend_requests,
      updated_at = pg_catalog.clock_timestamp();
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
  if not coalesce((
    select preference.friend_requests
    from public.notification_preferences as preference
    where preference.user_id = new.recipient_id
  ), true) then
    return new;
  end if;

  select p.username::text into requester_username
  from public.profiles as p
  where p.id = new.requester_id;

  insert into public.notifications (
    user_id, type, title, body, url, source_user_id, dedupe_key
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

  if not coalesce((
    select preference.peer_review_pings
    from public.notification_preferences as preference
    where preference.user_id = $1
  ), true) then
    raise exception 'Recipient disabled review pings' using errcode = 'P0001';
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
    user_id, type, title, body, url, source_user_id, attempt_id, category_id, dedupe_key
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
    left join public.notification_preferences as preference
      on preference.user_id = case
        when f.requester_id = new.user_id then f.recipient_id
        else f.requester_id
      end
    where f.status = 'accepted'
      and (f.requester_id = new.user_id or f.recipient_id = new.user_id)
      and coalesce(preference.friends_top_three, true)
  loop
    new_rank := public.friend_category_rank(recipient.user_id, new.user_id, new.category_id, null);
    old_rank := public.friend_category_rank(recipient.user_id, new.user_id, new.category_id, new.id);

    if new_rank between 1 and 3 and (old_rank is null or old_rank > 3) then
      insert into public.notifications (
        user_id, type, title, body, url, source_user_id, attempt_id, category_id, position, dedupe_key
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

revoke all on table public.notification_preferences from public, anon, authenticated;
grant all on table public.notification_preferences to service_role;

revoke all on function public.get_notification_preferences() from public, anon, authenticated, service_role;
revoke all on function public.set_notification_preferences(boolean, boolean, boolean) from public, anon, authenticated, service_role;
grant execute on function public.get_notification_preferences() to authenticated;
grant execute on function public.set_notification_preferences(boolean, boolean, boolean) to authenticated;
