create or replace function public.get_player_profile(player uuid)
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
        and a.status = 'approved'::public.attempt_status
    ), '[]'::jsonb)
  )
  into result
  from public.profiles as p
  where p.id = $1;

  if result is null then
    raise exception 'Player profile not found' using errcode = 'P0002';
  end if;

  return result;
end;
$$;

revoke all on function public.get_player_profile(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_player_profile(uuid) to authenticated;
