create or replace function public.battle_repeat_opponent_count(first_player uuid, second_player uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select 0;
$$;

update public.battles
set repeat_opponent_count = 0,
    elo_stake_multiplier = 1
where settled_at is null;

create or replace function public.stop_attempt(attempt uuid)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  existing_attempt public.attempts%rowtype;
  result public.attempts%rowtype;
  server_stopped_at timestamptz;
  server_elapsed_ms bigint;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select a.*
  into existing_attempt
  from public.attempts as a
  where a.id = $1
    and (a.recorded_by = current_user_id or a.user_id = current_user_id)
  for update;

  if not found then
    raise exception 'Attempt not found' using errcode = 'P0002';
  end if;
  if existing_attempt.status <> 'running'::public.attempt_status then
    if existing_attempt.stopped_at is not null and existing_attempt.elapsed_ms is not null then
      return existing_attempt;
    end if;
    raise exception 'Only a running attempt can be stopped' using errcode = '22023';
  end if;

  server_stopped_at := greatest(pg_catalog.clock_timestamp(), existing_attempt.started_at);
  server_elapsed_ms := pg_catalog.floor(
    extract(epoch from (server_stopped_at - existing_attempt.started_at)) * 1000
  )::bigint;

  update public.attempts as a
  set stopped_at = server_stopped_at,
      elapsed_ms = server_elapsed_ms,
      status = 'awaiting_confirmation'::public.attempt_status
  where a.id = existing_attempt.id
  returning a.* into result;
  return result;
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
  if not found then raise exception 'Ready battle not found' using errcode = 'P0002'; end if;
  if existing.status in ('countdown', 'active') and existing.starts_at is not null then
    return existing.starts_at;
  end if;
  if existing.status <> 'ready' then raise exception 'Ready battle not found' using errcode = 'P0002'; end if;

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

  select bp.elapsed_ms into elapsed
  from public.battle_participants as bp
  where bp.battle_id = existing.id and bp.user_id = current_user_id and bp.finished_at is not null
  for update;
  if found then return elapsed; end if;

  if existing.status not in ('countdown', 'active', 'completed') or existing.starts_at is null then
    raise exception 'Battle is not running' using errcode = '22023';
  end if;
  stopped_at := pg_catalog.clock_timestamp();
  if stopped_at < existing.starts_at then raise exception 'Battle has not started' using errcode = '22023'; end if;
  elapsed := pg_catalog.floor(extract(epoch from (stopped_at - existing.starts_at)) * 1000)::bigint;

  perform 1 from public.battle_participants as bp
  where bp.battle_id = existing.id and bp.user_id = current_user_id and bp.finished_at is null
  for update;
  if not found then raise exception 'Battle participant not found' using errcode = 'P0002'; end if;

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

comment on function public.stop_attempt(uuid) is 'Stops a timer using server time; repeated stop requests return the existing stopped attempt.';
comment on function public.stop_battle(uuid) is 'Stops a battle timer using server time; repeated stop requests return the existing elapsed time.';
