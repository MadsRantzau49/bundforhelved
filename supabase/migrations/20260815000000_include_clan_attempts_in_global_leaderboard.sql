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

comment on column public.attempts.clan_id is
  'Null means Global only; otherwise the attempt counts both Globally and for the selected clan.';
