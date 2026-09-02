drop function public.get_drink_director_leaderboard(uuid, boolean);

create index attempts_approved_category_user_idx
  on public.attempts (category_id, user_id)
  where status = 'approved'::public.attempt_status
    and invalidated_at is null;

create function public.get_category_drink_director_leaderboard(
  category uuid,
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

  if not exists (
    select 1
    from public.categories as c
    where c.id = $1
      and (c.is_active or public.is_admin())
  ) then
    raise exception 'Category not found or inactive' using errcode = 'P0002';
  end if;

  return query
  with approved_counts as (
    select a.user_id, pg_catalog.count(*) as completed_count
    from public.attempts as a
    where a.category_id = $1
      and a.status = 'approved'::public.attempt_status
      and a.invalidated_at is null
      and (
        not coalesce($2, false)
        or a.user_id = current_user_id
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

revoke all on function public.get_category_drink_director_leaderboard(uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.get_category_drink_director_leaderboard(uuid, boolean)
  to authenticated;

comment on function public.get_category_drink_director_leaderboard(uuid, boolean) is
  'Ranks players by approved attempt count in one category, globally or among friends.';
