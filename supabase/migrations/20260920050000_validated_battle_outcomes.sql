alter table public.battles
  drop constraint battles_settlement_state,
  add column provisional_winner_id uuid references public.profiles (id) on delete set null,
  add constraint battles_settlement_state check (winner_id is null or settled_at is not null);

alter table public.notifications drop constraint notifications_type;
alter table public.notifications add constraint notifications_type check (
  type in ('friend_request', 'peer_review_ping', 'leaderboard_top3', 'battle_invite', 'battle_review')
);

create or replace function public.stop_battle(battle uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  existing public.battles%rowtype;
  stopped_at timestamptz;
  elapsed bigint;
  created_attempt uuid;
  other_user_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select b.* into existing from public.battles as b
  where b.id = battle and current_user_id in (b.challenger_id, b.opponent_id)
  for update;
  if not found then raise exception 'Battle not found' using errcode = 'P0002'; end if;
  if existing.status not in ('countdown', 'active', 'completed') or existing.starts_at is null then
    raise exception 'Battle is not running' using errcode = '22023';
  end if;

  stopped_at := pg_catalog.clock_timestamp();
  if stopped_at < existing.starts_at then raise exception 'Battle has not started' using errcode = '22023'; end if;
  elapsed := pg_catalog.floor(extract(epoch from (stopped_at - existing.starts_at)) * 1000)::bigint;

  perform 1 from public.battle_participants as bp
  where bp.battle_id = existing.id and bp.user_id = current_user_id and bp.finished_at is null
  for update;
  if not found then raise exception 'Battle time already stopped' using errcode = '23505'; end if;

  insert into public.attempts (
    user_id, recorded_by, category_id, clan_id, started_at, stopped_at, elapsed_ms,
    status, submitted_for_review_at
  ) values (
    current_user_id, current_user_id, existing.category_id, existing.clan_id, existing.starts_at, stopped_at, elapsed,
    'pending_review'::public.attempt_status, stopped_at
  ) returning id into created_attempt;

  update public.battle_participants
  set finished_at = stopped_at, elapsed_ms = elapsed, attempt_id = created_attempt
  where battle_id = existing.id and user_id = current_user_id;

  update public.battles
  set status = 'completed',
      completed_at = coalesce(completed_at, stopped_at),
      provisional_winner_id = coalesce(provisional_winner_id, current_user_id)
  where id = existing.id;

  other_user_id := case when current_user_id = existing.challenger_id then existing.opponent_id else existing.challenger_id end;
  insert into public.notifications (user_id, type, title, body, url, source_user_id, category_id, dedupe_key)
  select other_user_id, 'battle_review', 'Godkend en 1v1-tid',
    '@' || p.username::text || ' har afsluttet kampen.', '/battle', current_user_id, existing.category_id,
    'battle-review:' || existing.id::text || ':' || current_user_id::text
  from public.profiles as p where p.id = current_user_id
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;

  return elapsed;
end;
$$;

create or replace function public.resolve_battle_outcome(battle uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.battles%rowtype;
  faster record;
  slower record;
  winner uuid;
  challenger_player public.battle_participants%rowtype;
  opponent_player public.battle_participants%rowtype;
  challenger_expected numeric;
  challenger_score numeric;
  challenger_delta integer;
  challenger_current integer;
  opponent_current integer;
  challenger_after integer;
  opponent_after integer;
begin
  select b.* into existing from public.battles as b where b.id = battle for update;
  if not found or existing.settled_at is not null then return false; end if;

  select bp.user_id, bp.elapsed_ms, bp.finished_at, a.status
  into faster
  from public.battle_participants as bp
  join public.attempts as a on a.id = bp.attempt_id
  where bp.battle_id = existing.id
  order by bp.elapsed_ms, bp.finished_at, bp.user_id
  limit 1;
  select bp.user_id, bp.elapsed_ms, bp.finished_at, a.status
  into slower
  from public.battle_participants as bp
  join public.attempts as a on a.id = bp.attempt_id
  where bp.battle_id = existing.id
  order by bp.elapsed_ms desc, bp.finished_at desc, bp.user_id desc
  limit 1;

  if faster.user_id is null or slower.user_id is null or faster.user_id = slower.user_id then return false; end if;

  if faster.status = 'approved'::public.attempt_status then
    winner := faster.user_id;
  elsif faster.status = 'pending_review'::public.attempt_status then
    return false;
  elsif slower.status = 'approved'::public.attempt_status then
    winner := slower.user_id;
  elsif slower.status = 'pending_review'::public.attempt_status then
    return false;
  else
    winner := null;
  end if;

  if winner is null then
    update public.battle_participants
    set elo_after = elo_before, elo_change = 0,
        rank_after_name = rank_before_name, rank_after_image_path = rank_before_image_path
    where battle_id = existing.id;
    update public.battles set winner_id = null, settled_at = pg_catalog.clock_timestamp() where id = existing.id;
    return true;
  end if;

  select bp.* into challenger_player from public.battle_participants as bp
  where bp.battle_id = existing.id and bp.user_id = existing.challenger_id for update;
  select bp.* into opponent_player from public.battle_participants as bp
  where bp.battle_id = existing.id and bp.user_id = existing.opponent_id for update;

  perform 1 from public.battle_ratings as br
  where br.user_id in (existing.challenger_id, existing.opponent_id)
  order by br.user_id for update;
  select br.elo into challenger_current from public.battle_ratings as br where br.user_id = existing.challenger_id;
  select br.elo into opponent_current from public.battle_ratings as br where br.user_id = existing.opponent_id;

  challenger_expected := 1.0 / (1.0 + pg_catalog.power(10.0, (opponent_player.elo_before - challenger_player.elo_before) / 400.0));
  challenger_score := case when winner = existing.challenger_id then 1.0 else 0.0 end;
  challenger_delta := pg_catalog.round(40 * (challenger_score - challenger_expected))::integer;
  if challenger_delta = 0 then challenger_delta := case when challenger_score = 1.0 then 1 else -1 end; end if;
  challenger_after := greatest(0, challenger_current + challenger_delta);
  opponent_after := greatest(0, opponent_current - challenger_delta);

  update public.battle_ratings as br
  set elo = challenger_after,
      wins = wins + case when winner = existing.challenger_id then 1 else 0 end,
      losses = losses + case when winner = existing.opponent_id then 1 else 0 end,
      updated_at = pg_catalog.clock_timestamp()
  where br.user_id = existing.challenger_id;
  update public.battle_ratings as br
  set elo = opponent_after,
      wins = wins + case when winner = existing.opponent_id then 1 else 0 end,
      losses = losses + case when winner = existing.challenger_id then 1 else 0 end,
      updated_at = pg_catalog.clock_timestamp()
  where br.user_id = existing.opponent_id;

  with changes as (
    select
      bp.user_id,
      case when bp.user_id = existing.challenger_id then challenger_after else opponent_after end as global_elo,
      case when bp.user_id = existing.challenger_id then challenger_after - challenger_current else opponent_after - opponent_current end as elo_delta
    from public.battle_participants as bp where bp.battle_id = existing.id
  ), ranked as (
    select changes.*, rank.name, rank.image_path
    from changes left join lateral public.battle_rank_for_elo(changes.global_elo) as rank on true
  )
  update public.battle_participants as bp
  set elo_after = bp.elo_before + ranked.elo_delta,
      elo_change = ranked.elo_delta,
      rank_after_name = ranked.name,
      rank_after_image_path = ranked.image_path
  from ranked where bp.battle_id = existing.id and bp.user_id = ranked.user_id;

  insert into public.battle_rating_events (battle_id, user_id, elo_before, elo_after, change)
  values
    (existing.id, existing.challenger_id, challenger_current, challenger_after, challenger_after - challenger_current),
    (existing.id, existing.opponent_id, opponent_current, opponent_after, opponent_after - opponent_current);

  update public.battles set winner_id = winner, settled_at = pg_catalog.clock_timestamp() where id = existing.id;
  return true;
end;
$$;

create or replace function public.review_battle_time(battle uuid, approve boolean)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_user_id uuid;
  target_attempt uuid;
  result public.attempts%rowtype;
begin
  if current_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if approve is null then raise exception 'Decision is required' using errcode = '22023'; end if;
  select bp.user_id, bp.attempt_id into target_user_id, target_attempt
  from public.battles as b
  join public.battle_participants as bp on bp.battle_id = b.id and bp.user_id <> current_user_id
  where b.id = battle and current_user_id in (b.challenger_id, b.opponent_id);
  if target_attempt is null then raise exception 'Opponent time is not ready' using errcode = 'P0002'; end if;
  result := public.review_attempt(target_attempt, approve);
  delete from public.notifications
  where user_id = current_user_id and dedupe_key = 'battle-review:' || battle::text || ':' || target_user_id::text;
  return result;
end;
$$;

create or replace function public.validate_battle_time(battle uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.review_battle_time(battle, true);
end;
$$;

create or replace function public.decline_own_battle_time(battle uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_attempt uuid;
  result public.attempts%rowtype;
begin
  if current_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select bp.attempt_id into target_attempt
  from public.battles as b
  join public.battle_participants as bp on bp.battle_id = b.id and bp.user_id = current_user_id
  where b.id = battle and current_user_id in (b.challenger_id, b.opponent_id)
  for update of bp;
  if target_attempt is null then raise exception 'Own time is not ready' using errcode = 'P0002'; end if;
  update public.attempts as a
  set status = 'declined'::public.attempt_status
  where a.id = target_attempt and a.status = 'pending_review'::public.attempt_status
  returning a.* into result;
  if not found then raise exception 'Own time is already resolved' using errcode = '22023'; end if;
  return result;
end;
$$;

create or replace function public.settle_battle_after_attempt_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  battle uuid;
begin
  select bp.battle_id into battle from public.battle_participants as bp where bp.attempt_id = new.id;
  if battle is not null and new.status is distinct from old.status then
    perform public.resolve_battle_outcome(battle);
  end if;
  return new;
end;
$$;

create trigger attempts_settle_battle_after_review
after update of status on public.attempts
for each row execute function public.settle_battle_after_attempt_review();

create or replace function public.prevent_timer_during_battle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('running'::public.attempt_status, 'awaiting_confirmation'::public.attempt_status)
    and exists (
      select 1
      from public.battles as b
      join public.battle_participants as bp on bp.battle_id = b.id and bp.user_id = new.user_id
      where b.starts_at is not null and bp.finished_at is null
    )
  then
    raise exception 'A battle is already running' using errcode = '23505';
  end if;
  return new;
end;
$$;

create or replace function public.prevent_battle_during_timer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.attempts as a
    where a.user_id in (new.challenger_id, new.opponent_id)
      and a.status in ('running'::public.attempt_status, 'awaiting_confirmation'::public.attempt_status)
  ) or exists (
    select 1
    from public.battle_participants as bp
    join public.battles as b on b.id = bp.battle_id
    where bp.user_id in (new.challenger_id, new.opponent_id)
      and b.starts_at is not null and bp.finished_at is null
  ) then
    raise exception 'A player has an active timer' using errcode = '23505';
  end if;
  return new;
end;
$$;

revoke all on function public.review_battle_time(uuid, boolean), public.decline_own_battle_time(uuid), public.resolve_battle_outcome(uuid) from public, anon, authenticated, service_role;
grant execute on function public.review_battle_time(uuid, boolean), public.decline_own_battle_time(uuid) to authenticated, service_role;
