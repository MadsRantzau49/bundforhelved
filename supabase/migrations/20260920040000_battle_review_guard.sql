create or replace function public.enforce_battle_reviewer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'pending_review'::public.attempt_status
    and new.status is distinct from old.status
    and exists (
      select 1
      from public.battle_participants as bp
      join public.battles as b on b.id = bp.battle_id
      where bp.attempt_id = old.id
        and auth.uid() not in (b.challenger_id, b.opponent_id)
    )
    and not public.is_admin()
  then
    raise exception 'Only the battle opponent can review this time' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger attempts_enforce_battle_reviewer
before update of status on public.attempts
for each row execute function public.enforce_battle_reviewer();

create or replace function public.list_peer_review_attempts()
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
  evidence_video_path text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  return query
  select
    a.id, p.id, p.username::text, p.avatar_path, c.id, c.name, c.icon_key, c.accent_color,
    a.clan_id, clan.name, a.elapsed_ms, a.stopped_at, a.submitted_for_review_at, a.evidence_video_path
  from public.attempts as a
  join public.profiles as p on p.id = a.user_id
  join public.categories as c on c.id = a.category_id
  left join public.clans as clan on clan.id = a.clan_id
  where a.status = 'pending_review'::public.attempt_status
    and a.user_id <> current_user_id
    and (a.recorded_by is null or a.recorded_by <> current_user_id)
    and public.is_friend(a.user_id)
    and (
      not exists (select 1 from public.battle_participants as bp where bp.attempt_id = a.id)
      or exists (
        select 1 from public.battle_participants as bp
        join public.battles as b on b.id = bp.battle_id
        where bp.attempt_id = a.id and current_user_id in (b.challenger_id, b.opponent_id)
      )
    )
  order by a.submitted_for_review_at desc, a.id
  limit 100;
end;
$$;
