drop function if exists public.list_peer_review_attempts(integer, integer);

create function public.list_peer_review_attempts(
  page_size integer default 21,
  before_submitted_at timestamptz default null,
  before_attempt_id uuid default null
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

  if $1 is null
     or $1 not between 1 and 51
     or (($2 is null) <> ($3 is null)) then
    raise exception 'Invalid review page' using errcode = '22023';
  end if;

  return query
  with friend_ids as (
    select f.recipient_id as friend_id
    from public.friendships as f
    where f.requester_id = current_user_id
      and f.status = 'accepted'
    union all
    select f.requester_id
    from public.friendships as f
    where f.recipient_id = current_user_id
      and f.status = 'accepted'
  ),
  matching as (
    select
      a.id as matched_attempt_id,
      p.id as matched_user_id,
      p.username::text as matched_username,
      p.avatar_path as matched_avatar_path,
      c.id as matched_category_id,
      c.name as matched_category_name,
      c.icon_key as matched_category_icon_key,
      c.accent_color as matched_category_accent_color,
      a.clan_id as matched_clan_id,
      clan.name as matched_clan_name,
      a.elapsed_ms as matched_elapsed_ms,
      a.stopped_at as matched_stopped_at,
      a.submitted_for_review_at as matched_submitted_at,
      a.evidence_video_path as matched_evidence_path
    from friend_ids as friend
    join public.attempts as a on a.user_id = friend.friend_id
    join public.profiles as p on p.id = a.user_id
    join public.categories as c on c.id = a.category_id
    left join public.clans as clan on clan.id = a.clan_id
    where a.status = 'pending_review'::public.attempt_status
      and (a.recorded_by is null or a.recorded_by <> current_user_id)
  )
  select
    matched.matched_attempt_id,
    matched.matched_user_id,
    matched.matched_username,
    matched.matched_avatar_path,
    matched.matched_category_id,
    matched.matched_category_name,
    matched.matched_category_icon_key,
    matched.matched_category_accent_color,
    matched.matched_clan_id,
    matched.matched_clan_name,
    matched.matched_elapsed_ms,
    matched.matched_stopped_at,
    matched.matched_submitted_at,
    matched.matched_evidence_path,
    (select pg_catalog.count(*) from matching)
  from matching as matched
  where $2 is null
     or (matched.matched_submitted_at, matched.matched_attempt_id) < ($2, $3)
  order by matched.matched_submitted_at desc, matched.matched_attempt_id desc
  limit $1;
end;
$$;

revoke all on function public.list_peer_review_attempts(integer, timestamptz, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_peer_review_attempts(integer, timestamptz, uuid) to authenticated;

drop function if exists public.list_admin_attempts(text, text, integer, integer);

create function public.list_admin_attempts(
  search_query text default '',
  status_filter text default null,
  before_stopped_at timestamptz default null,
  before_attempt_id uuid default null,
  page_size integer default 51
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

  if $1 is null
     or pg_catalog.char_length(clean_query) > 100
     or ($2 is not null and $2 not in ('awaiting_confirmation', 'pending_review', 'approved', 'declined', 'invalidated'))
     or (($3 is null) <> ($4 is null))
     or $5 is null
     or $5 not between 1 and 101 then
    raise exception 'Invalid admin attempt page' using errcode = '22023';
  end if;

  return query
  with matching as (
    select
      a.id as matched_id,
      a.user_id as matched_user_id,
      a.recorded_by as matched_recorded_by,
      a.category_id as matched_category_id,
      a.clan_id as matched_clan_id,
      a.elapsed_ms as matched_elapsed_ms,
      a.stopped_at as matched_stopped_at,
      a.confirmed_at as matched_confirmed_at,
      a.submitted_for_review_at as matched_submitted_at,
      a.reviewed_at as matched_reviewed_at,
      a.status as matched_status,
      a.invalidated_reason as matched_invalidated_reason,
      player.username::text as matched_player_username,
      player.avatar_path as matched_player_avatar_path,
      recorder.username::text as matched_recorder_username,
      category.name as matched_category_name,
      category.icon_key as matched_category_icon_key,
      category.accent_color as matched_category_accent_color,
      clan.name as matched_clan_name
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
  )
  select
    matched.matched_id,
    matched.matched_user_id,
    matched.matched_recorded_by,
    matched.matched_category_id,
    matched.matched_clan_id,
    matched.matched_elapsed_ms,
    matched.matched_stopped_at,
    matched.matched_confirmed_at,
    matched.matched_submitted_at,
    matched.matched_reviewed_at,
    matched.matched_status,
    matched.matched_invalidated_reason,
    matched.matched_player_username,
    matched.matched_player_avatar_path,
    matched.matched_recorder_username,
    matched.matched_category_name,
    matched.matched_category_icon_key,
    matched.matched_category_accent_color,
    matched.matched_clan_name,
    (select pg_catalog.count(*) from matching)
  from matching as matched
  where $3 is null
     or (matched.matched_stopped_at, matched.matched_id) < ($3, $4)
  order by matched.matched_stopped_at desc, matched.matched_id desc
  limit $5;
end;
$$;

revoke all on function public.list_admin_attempts(text, text, timestamptz, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_admin_attempts(text, text, timestamptz, uuid, integer) to authenticated;
