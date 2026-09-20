alter table public.battles
  drop constraint battles_status,
  drop constraint battles_start_state,
  drop constraint battles_completion_state,
  add column winner_id uuid references public.profiles (id) on delete set null,
  add column settled_at timestamptz;

alter table public.battles
  add constraint battles_status check (status in ('pending', 'ready', 'countdown', 'active', 'completed', 'declined', 'cancelled')),
  add constraint battles_start_state check (
    (status in ('pending', 'ready', 'declined', 'cancelled') and starts_at is null)
    or (status in ('countdown', 'active', 'completed') and starts_at is not null)
  ),
  add constraint battles_completion_state check ((status = 'completed') = (completed_at is not null)),
  add constraint battles_settlement_state check ((winner_id is null) = (settled_at is null));

create or replace function public.create_battle(category uuid, clan uuid, opponent uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  challenger uuid := auth.uid();
  result uuid;
begin
  if challenger is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if opponent is null or opponent = challenger then raise exception 'Choose a different opponent' using errcode = '22023'; end if;
  if not public.is_friend(opponent) then raise exception 'Accepted friendship required' using errcode = '42501'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(least(challenger::text, opponent::text), 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(greatest(challenger::text, opponent::text), 0));

  perform 1 from public.categories as c where c.id = category and c.is_active for share;
  if not found then raise exception 'Category is not active' using errcode = '22023'; end if;

  if clan is not null and not (
    exists (select 1 from public.clan_members where clan_id = clan and user_id = challenger)
    and exists (select 1 from public.clan_members where clan_id = clan and user_id = opponent)
  ) then
    raise exception 'Both players must be clan members' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.attempts as a
    where a.user_id in (challenger, opponent)
      and a.status in ('running'::public.attempt_status, 'awaiting_confirmation'::public.attempt_status)
  ) then
    raise exception 'A player has an active timer' using errcode = '23505';
  end if;

  if exists (
    select 1 from public.battles as b
    where (
      b.status in ('ready', 'countdown', 'active')
      and challenger in (b.challenger_id, b.opponent_id)
    ) or (b.status = 'pending' and b.challenger_id = challenger)
  ) then
    raise exception 'Challenger already has an open battle' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.battles as b
    where b.status in ('ready', 'countdown', 'active')
      and opponent in (b.challenger_id, b.opponent_id)
  ) then
    raise exception 'Opponent is already battling' using errcode = '23505';
  end if;

  insert into public.battles (challenger_id, opponent_id, category_id, clan_id)
  values (challenger, opponent, category, clan)
  returning id into result;

  insert into public.battle_participants (battle_id, user_id, accepted_at, elo_before, rank_before_name, rank_before_image_path)
  select result, challenger, pg_catalog.clock_timestamp(), br.elo, rank.name, rank.image_path
  from public.battle_ratings as br
  left join lateral public.battle_rank_for_elo(br.elo) as rank on true
  where br.user_id = challenger;

  insert into public.battle_participants (battle_id, user_id, elo_before, rank_before_name, rank_before_image_path)
  select result, opponent, br.elo, rank.name, rank.image_path
  from public.battle_ratings as br
  left join lateral public.battle_rank_for_elo(br.elo) as rank on true
  where br.user_id = opponent;

  return result;
end;
$$;

create or replace function public.respond_battle(battle uuid, accept boolean)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  existing public.battles%rowtype;
begin
  if current_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if accept is null then raise exception 'Decision is required' using errcode = '22023'; end if;

  select b.* into existing from public.battles as b
  where b.id = battle and b.opponent_id = current_user_id
  for update;
  if not found or existing.status <> 'pending' then raise exception 'Pending invitation not found' using errcode = 'P0002'; end if;

  if not accept then
    update public.battles set status = 'declined' where id = existing.id;
    return null;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(least(existing.challenger_id::text, existing.opponent_id::text), 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(greatest(existing.challenger_id::text, existing.opponent_id::text), 0));

  if exists (
    select 1 from public.battles as b
    where b.id <> existing.id and b.status in ('ready', 'countdown', 'active')
      and (
        existing.challenger_id in (b.challenger_id, b.opponent_id)
        or existing.opponent_id in (b.challenger_id, b.opponent_id)
      )
  ) then
    raise exception 'A player already has an active battle' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.attempts as a
    where a.user_id in (existing.challenger_id, existing.opponent_id)
      and a.status in ('running'::public.attempt_status, 'awaiting_confirmation'::public.attempt_status)
  ) then
    raise exception 'Resolve active timers before accepting' using errcode = '23505';
  end if;

  update public.battle_participants as bp
  set accepted_at = case when bp.user_id = current_user_id then pg_catalog.clock_timestamp() else bp.accepted_at end,
      elo_before = br.elo,
      rank_before_name = rank.name,
      rank_before_image_path = rank.image_path
  from public.battle_ratings as br
  left join lateral public.battle_rank_for_elo(br.elo) as rank on true
  where bp.battle_id = existing.id and br.user_id = bp.user_id;

  update public.battles set status = 'cancelled'
  where id <> existing.id and status = 'pending'
    and (
      existing.challenger_id in (challenger_id, opponent_id)
      or existing.opponent_id in (challenger_id, opponent_id)
    );
  update public.battles set status = 'ready' where id = existing.id;
  return null;
end;
$$;

create or replace function public.start_battle(battle uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.battles%rowtype;
  start_time timestamptz;
begin
  select b.* into existing from public.battles as b
  where b.id = battle and b.challenger_id = auth.uid()
  for update;
  if not found or existing.status <> 'ready' then raise exception 'Ready battle not found' using errcode = 'P0002'; end if;

  if exists (
    select 1 from public.attempts as a
    where a.user_id in (existing.challenger_id, existing.opponent_id)
      and a.status in ('running'::public.attempt_status, 'awaiting_confirmation'::public.attempt_status)
  ) then
    raise exception 'Resolve active timers before starting' using errcode = '23505';
  end if;

  start_time := pg_catalog.clock_timestamp()
    + pg_catalog.make_interval(secs => 5 + pg_catalog.floor(pg_catalog.random() * 6)::integer);
  update public.battles set status = 'countdown', starts_at = start_time where id = existing.id;
  return start_time;
end;
$$;

create or replace function public.cancel_battle(battle uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.battles as b set status = 'cancelled'
  where b.id = $1 and auth.uid() in (b.challenger_id, b.opponent_id) and b.status in ('pending', 'ready');
  if not found then raise exception 'Open battle not found' using errcode = 'P0002'; end if;
  return true;
end;
$$;

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
  challenger_player public.battle_participants%rowtype;
  opponent_player public.battle_participants%rowtype;
  challenger_expected numeric;
  challenger_score numeric;
  challenger_delta integer;
  challenger_after integer;
  opponent_after integer;
begin
  if current_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select b.* into existing from public.battles as b
  where b.id = battle and current_user_id in (b.challenger_id, b.opponent_id)
  for update;
  if not found then raise exception 'Battle not found' using errcode = 'P0002'; end if;
  if existing.status not in ('countdown', 'active') or existing.starts_at is null then raise exception 'Battle is not running' using errcode = '22023'; end if;

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

  if existing.winner_id is null then
    select bp.* into challenger_player from public.battle_participants as bp
    where bp.battle_id = existing.id and bp.user_id = existing.challenger_id for update;
    select bp.* into opponent_player from public.battle_participants as bp
    where bp.battle_id = existing.id and bp.user_id = existing.opponent_id for update;

    perform 1 from public.battle_ratings as br
    where br.user_id in (existing.challenger_id, existing.opponent_id)
    order by br.user_id for update;

    challenger_expected := 1.0 / (1.0 + pg_catalog.power(10.0, (opponent_player.elo_before - challenger_player.elo_before) / 400.0));
    challenger_score := case when current_user_id = existing.challenger_id then 1.0 else 0.0 end;
    challenger_delta := pg_catalog.round(40 * (challenger_score - challenger_expected))::integer;
    if challenger_delta = 0 then challenger_delta := case when challenger_score = 1.0 then 1 else -1 end; end if;

    select greatest(0, br.elo + challenger_delta) into challenger_after
    from public.battle_ratings as br where br.user_id = existing.challenger_id;
    select greatest(0, br.elo - challenger_delta) into opponent_after
    from public.battle_ratings as br where br.user_id = existing.opponent_id;

    update public.battle_ratings as br
    set elo = challenger_after,
        wins = wins + case when challenger_score = 1.0 then 1 else 0 end,
        losses = losses + case when challenger_score = 0.0 then 1 else 0 end,
        updated_at = pg_catalog.clock_timestamp()
    where br.user_id = existing.challenger_id;
    update public.battle_ratings as br
    set elo = opponent_after,
        wins = wins + case when challenger_score = 0.0 then 1 else 0 end,
        losses = losses + case when challenger_score = 1.0 then 1 else 0 end,
        updated_at = pg_catalog.clock_timestamp()
    where br.user_id = existing.opponent_id;

    with settled as (
      select bp.user_id, case when bp.user_id = existing.challenger_id then challenger_after else opponent_after end as next_elo
      from public.battle_participants as bp where bp.battle_id = existing.id
    ), ranked as (
      select settled.user_id, settled.next_elo, rank.name, rank.image_path
      from settled left join lateral public.battle_rank_for_elo(settled.next_elo) as rank on true
    )
    update public.battle_participants as bp
    set elo_after = ranked.next_elo,
        elo_change = ranked.next_elo - bp.elo_before,
        rank_after_name = ranked.name,
        rank_after_image_path = ranked.image_path
    from ranked where bp.battle_id = existing.id and bp.user_id = ranked.user_id;

    insert into public.battle_rating_events (battle_id, user_id, elo_before, elo_after, change)
    select bp.battle_id, bp.user_id, bp.elo_before, bp.elo_after, bp.elo_change
    from public.battle_participants as bp where bp.battle_id = existing.id;

    update public.battles set status = 'active', winner_id = current_user_id, settled_at = stopped_at
    where id = existing.id;
  end if;

  if (select pg_catalog.count(*) from public.battle_participants where battle_id = existing.id and finished_at is not null) = 2 then
    update public.battles set status = 'completed', completed_at = pg_catalog.clock_timestamp() where id = existing.id;
  else
    update public.battles set status = 'active' where id = existing.id;
  end if;
  return elapsed;
end;
$$;

create or replace function public.validate_battle_time(battle uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_attempt uuid;
begin
  if current_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select bp.attempt_id into target_attempt
  from public.battles as b
  join public.battle_participants as bp on bp.battle_id = b.id and bp.user_id <> current_user_id
  where b.id = battle and current_user_id in (b.challenger_id, b.opponent_id);
  if target_attempt is null then raise exception 'Opponent time is not ready' using errcode = 'P0002'; end if;
  return public.review_attempt(target_attempt, true);
end;
$$;

create policy attempts_battle_opponent_read
on public.attempts for select to authenticated
using (
  exists (
    select 1 from public.battle_participants as bp
    join public.battles as b on b.id = bp.battle_id
    where bp.attempt_id = attempts.id and (select auth.uid()) in (b.challenger_id, b.opponent_id)
  )
);

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
      where b.status in ('ready', 'countdown', 'active')
        and new.user_id in (b.challenger_id, b.opponent_id)
    )
  then
    raise exception 'A battle is already running' using errcode = '23505';
  end if;
  return new;
end;
$$;

revoke all on function public.start_battle(uuid), public.validate_battle_time(uuid) from public, anon, authenticated, service_role;
grant execute on function public.start_battle(uuid), public.validate_battle_time(uuid) to authenticated, service_role;
