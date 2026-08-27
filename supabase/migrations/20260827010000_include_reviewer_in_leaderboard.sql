drop function if exists public.get_leaderboard(uuid, uuid, boolean);

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
  status public.attempt_status,
  reviewer_username text
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
      a.status,
      a.reviewed_by
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
      best.status,
      best.reviewed_by
    from best_attempts as best
  )
  select
    ranked.leaderboard_rank,
    profile.id,
    profile.username::text,
    profile.avatar_path,
    ranked.elapsed_ms,
    ranked.attempt_id,
    ranked.status,
    reviewer.username::text
  from ranked_attempts as ranked
  join public.profiles as profile on profile.id = ranked.user_id
  left join public.profiles as reviewer on reviewer.id = ranked.reviewed_by
  order by ranked.leaderboard_rank, profile.username::text, profile.id;
end;
$$;

revoke all on function public.get_leaderboard(uuid, uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.get_leaderboard(uuid, uuid, boolean) to authenticated;
