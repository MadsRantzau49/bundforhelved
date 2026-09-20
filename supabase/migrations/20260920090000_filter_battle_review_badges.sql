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
      from public.friendships as friendship
      where friendship.recipient_id = current_user_id
        and friendship.status = 'pending'
    ),
    'peer_reviews', (
      with friend_ids as (
        select friendship.recipient_id as user_id
        from public.friendships as friendship
        where friendship.requester_id = current_user_id
          and friendship.status = 'accepted'
        union all
        select friendship.requester_id
        from public.friendships as friendship
        where friendship.recipient_id = current_user_id
          and friendship.status = 'accepted'
      )
      select pg_catalog.count(*)
      from friend_ids as friend
      join public.attempts as attempt on attempt.user_id = friend.user_id
      where attempt.status = 'pending_review'::public.attempt_status
        and (attempt.recorded_by is null or attempt.recorded_by <> current_user_id)
        and (
          not exists (
            select 1
            from public.battle_participants as participant
            where participant.attempt_id = attempt.id
          )
          or exists (
            select 1
            from public.battle_participants as participant
            join public.battles as battle on battle.id = participant.battle_id
            where participant.attempt_id = attempt.id
              and current_user_id in (battle.challenger_id, battle.opponent_id)
          )
        )
    ),
    'notifications', (
      select pg_catalog.count(*)
      from public.notifications as notification
      where notification.user_id = current_user_id
        and notification.read_at is null
    )
  );
end;
$$;

revoke all on function public.get_social_badges() from public, anon, authenticated, service_role;
grant execute on function public.get_social_badges() to authenticated;
