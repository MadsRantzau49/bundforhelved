alter table public.notifications drop constraint notifications_type;
alter table public.notifications add constraint notifications_type check (
  type in ('friend_request', 'peer_review_ping', 'leaderboard_top3', 'battle_invite')
);

create or replace function public.notify_battle_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, type, title, body, url, source_user_id, category_id, dedupe_key)
  select new.opponent_id, 'battle_invite', 'Du er udfordret til 1v1',
    '@' || p.username::text || ' har inviteret dig til en kamp.',
    '/battle', new.challenger_id, new.category_id, 'battle-invite:' || new.id::text
  from public.profiles as p where p.id = new.challenger_id;
  return new;
end;
$$;

create trigger battles_notify_invitation
after insert on public.battles
for each row execute function public.notify_battle_invitation();

create or replace function public.clear_battle_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'pending' and new.status <> 'pending' then
    delete from public.notifications where dedupe_key = 'battle-invite:' || new.id::text;
  end if;
  return new;
end;
$$;

create trigger battles_clear_invitation
after update of status on public.battles
for each row execute function public.clear_battle_invitation();

create or replace function public.prevent_timer_during_battle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('running'::public.attempt_status, 'awaiting_confirmation'::public.attempt_status)
    and exists (
      select 1 from public.battles as b
      where b.status in ('countdown', 'active')
        and new.user_id in (b.challenger_id, b.opponent_id)
    )
  then
    raise exception 'A battle is already running' using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists attempts_prevent_timer_during_battle on public.attempts;
create trigger attempts_prevent_timer_during_battle
before insert on public.attempts
for each row execute function public.prevent_timer_during_battle();
