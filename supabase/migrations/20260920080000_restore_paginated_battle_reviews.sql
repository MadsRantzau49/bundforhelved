drop function if exists public.list_peer_review_attempts();
drop function if exists public.list_peer_review_attempts(integer, timestamptz, uuid);

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
      and (
        not exists (
          select 1
          from public.battle_participants as participant
          where participant.attempt_id = a.id
        )
        or exists (
          select 1
          from public.battle_participants as participant
          join public.battles as battle on battle.id = participant.battle_id
          where participant.attempt_id = a.id
            and current_user_id in (battle.challenger_id, battle.opponent_id)
        )
      )
  )
  select
    matching.matched_attempt_id,
    matching.matched_user_id,
    matching.matched_username,
    matching.matched_avatar_path,
    matching.matched_category_id,
    matching.matched_category_name,
    matching.matched_category_icon_key,
    matching.matched_category_accent_color,
    matching.matched_clan_id,
    matching.matched_clan_name,
    matching.matched_elapsed_ms,
    matching.matched_stopped_at,
    matching.matched_submitted_at,
    matching.matched_evidence_path,
    (select pg_catalog.count(*) from matching)
  from matching
  where $2 is null
     or (matching.matched_submitted_at, matching.matched_attempt_id) < ($2, $3)
  order by matching.matched_submitted_at desc, matching.matched_attempt_id desc
  limit $1;
end;
$$;

revoke all on function public.list_peer_review_attempts(integer, timestamptz, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_peer_review_attempts(integer, timestamptz, uuid) to authenticated;

notify pgrst, 'reload schema';
