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
  if new.status <> 'approved'::public.attempt_status
     or old.status = 'approved'::public.attempt_status then
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

drop trigger attempts_notify_friend_top_three on public.attempts;

create trigger attempts_notify_friend_top_three
after update of status on public.attempts
for each row
when (
  new.status = 'approved'::public.attempt_status
  and old.status <> 'approved'::public.attempt_status
)
execute function public.notify_friend_top_three();

revoke all on function public.notify_friend_top_three() from public, anon, authenticated, service_role;
