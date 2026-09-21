create function public.battle_handicap_expected_challenger(
  challenger_best bigint,
  opponent_best bigint,
  recipient uuid,
  challenger uuid,
  handicap bigint,
  challenger_elo integer,
  opponent_elo integer
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select least(0.99::numeric, greatest(0.01::numeric,
    1.0 / (1.0 + pg_catalog.power(10.0,
      -(
        (challenger_elo - opponent_elo)::numeric
        + 400.0 * pg_catalog.ln(
          greatest(1::numeric, opponent_best::numeric - case when recipient <> challenger then greatest(0::bigint, handicap)::numeric else 0 end)
          / greatest(1::numeric, challenger_best::numeric - case when recipient = challenger then greatest(0::bigint, handicap)::numeric else 0 end)
        ) / pg_catalog.ln(2.0)
      ) / 400.0
    )))
  );
$$;

update public.battles as b
set handicap_expected_challenger = public.battle_handicap_expected_challenger(
  b.challenger_best_ms,
  b.opponent_best_ms,
  b.handicap_user_id,
  b.challenger_id,
  b.handicap_ms,
  coalesce((select bp.elo_before from public.battle_participants as bp where bp.battle_id = b.id and bp.user_id = b.challenger_id), 500),
  coalesce((select bp.elo_before from public.battle_participants as bp where bp.battle_id = b.id and bp.user_id = b.opponent_id), 500)
)
where b.battle_mode = 'handicap' and b.handicap_expected_challenger is null;

alter table public.battles
  drop constraint battles_handicap_terms_valid,
  add constraint battles_handicap_terms_valid check (
    (battle_mode = 'normal'
      and handicap_user_id is null
      and handicap_ms = 0
      and suggested_handicap_ms = 0
      and max_handicap_ms = 0
      and handicap_expected_challenger is null
      and handicap_elo_stake = 0)
    or
    (battle_mode = 'handicap'
      and handicap_user_id in (challenger_id, opponent_id)
      and challenger_best_ms > 0 and opponent_best_ms > 0
      and suggested_handicap_ms >= 0
      and handicap_ms >= 0
      and max_handicap_ms >= greatest(suggested_handicap_ms, handicap_ms)
      and handicap_expected_challenger between 0.01 and 0.99
      and handicap_elo_stake >= 0)
  );

drop function public.get_battle_handicap_preview(uuid, uuid);

create function public.get_battle_handicap_preview(category uuid, opponent uuid)
returns table (
  challenger_best_ms bigint,
  opponent_best_ms bigint,
  handicap_user_id uuid,
  suggested_handicap_ms bigint,
  time_elo_per_doubling numeric,
  battle_elo_factor integer,
  challenger_elo integer,
  opponent_elo integer,
  repeat_opponent_count integer,
  elo_stake_multiplier numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  challenger uuid := auth.uid();
  challenger_best_value bigint;
  opponent_best_value bigint;
  challenger_elo_value integer;
  opponent_elo_value integer;
  suggested_recipient uuid;
  suggested_value bigint;
  elo_difference numeric;
  bounded_elo_difference numeric;
  baseline_advantage numeric;
  target_adjusted_time numeric;
  repeats integer;
begin
  if challenger is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if opponent is null or opponent = challenger or not public.is_friend(opponent) then
    raise exception 'Accepted friendship required' using errcode = '42501';
  end if;
  perform 1 from public.categories as c where c.id = category and c.is_active;
  if not found then raise exception 'Category is not active' using errcode = '22023'; end if;

  select pg_catalog.min(a.elapsed_ms) into challenger_best_value
  from public.attempts as a
  where a.user_id = challenger and a.category_id = category
    and a.status = 'approved'::public.attempt_status and a.invalidated_at is null;
  select pg_catalog.min(a.elapsed_ms) into opponent_best_value
  from public.attempts as a
  where a.user_id = opponent and a.category_id = category
    and a.status = 'approved'::public.attempt_status and a.invalidated_at is null;
  if challenger_best_value is null or opponent_best_value is null then
    raise exception 'Approved personal bests required for handicap' using errcode = '22023';
  end if;
  select br.elo into challenger_elo_value from public.battle_ratings as br where br.user_id = challenger;
  select br.elo into opponent_elo_value from public.battle_ratings as br where br.user_id = opponent;

  elo_difference := challenger_elo_value - opponent_elo_value;
  bounded_elo_difference := least(4000::numeric, greatest(-4000::numeric, elo_difference));
  baseline_advantage := elo_difference
    + 400.0 * pg_catalog.ln(opponent_best_value::numeric / challenger_best_value::numeric) / pg_catalog.ln(2.0);
  if baseline_advantage >= 0 then
    suggested_recipient := opponent;
    target_adjusted_time := greatest(1::numeric,
      pg_catalog.round(challenger_best_value::numeric * pg_catalog.power(2.0, -bounded_elo_difference / 400.0)));
    suggested_value := greatest(0::bigint, opponent_best_value - least(opponent_best_value::numeric, target_adjusted_time)::bigint);
  else
    suggested_recipient := challenger;
    target_adjusted_time := greatest(1::numeric,
      pg_catalog.round(opponent_best_value::numeric * pg_catalog.power(2.0, bounded_elo_difference / 400.0)));
    suggested_value := greatest(0::bigint, challenger_best_value - least(challenger_best_value::numeric, target_adjusted_time)::bigint);
  end if;
  repeats := public.battle_repeat_opponent_count(challenger, opponent);

  return query
  select challenger_best_value, opponent_best_value, suggested_recipient, suggested_value,
    400::numeric, c.battle_elo_factor, challenger_elo_value, opponent_elo_value,
    repeats, pg_catalog.power(0.75::numeric, repeats)
  from public.categories as c where c.id = category;
end;
$$;

create or replace function public.create_battle(category uuid, clan uuid, opponent uuid, match_mode text, handicap_user uuid, handicap bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  challenger uuid := auth.uid();
  result uuid;
  category_factor integer;
  challenger_best_value bigint;
  opponent_best_value bigint;
  suggested_value bigint := 0;
  challenger_elo_value integer;
  opponent_elo_value integer;
  expected_challenger numeric;
  fair_stake integer := 0;
  repeats integer;
  stake_multiplier numeric;
begin
  if challenger is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if opponent is null or opponent = challenger then raise exception 'Choose a different opponent' using errcode = '22023'; end if;
  if not public.is_friend(opponent) then raise exception 'Accepted friendship required' using errcode = '42501'; end if;
  if match_mode not in ('normal', 'handicap') then raise exception 'Battle mode is invalid' using errcode = '22023'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(least(challenger::text, opponent::text), 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(greatest(challenger::text, opponent::text), 0));
  select c.battle_elo_factor into category_factor from public.categories as c where c.id = category and c.is_active for share;
  if not found then raise exception 'Category is not active' using errcode = '22023'; end if;
  if clan is not null and not (
    exists (select 1 from public.clan_members where clan_id = clan and user_id = challenger)
    and exists (select 1 from public.clan_members where clan_id = clan and user_id = opponent)
  ) then raise exception 'Both players must be clan members' using errcode = '42501'; end if;

  if exists (
    select 1 from public.attempts as a where a.user_id in (challenger, opponent)
      and a.status in ('running'::public.attempt_status, 'awaiting_confirmation'::public.attempt_status)
  ) then raise exception 'A player has an active timer' using errcode = '23505'; end if;
  if exists (
    select 1 from public.battles as b where (
      b.status in ('ready', 'countdown', 'active') and challenger in (b.challenger_id, b.opponent_id)
    ) or (b.status = 'pending' and b.challenger_id = challenger)
  ) then raise exception 'Challenger already has an open battle' using errcode = '23505'; end if;
  if exists (
    select 1 from public.battles as b where b.status in ('ready', 'countdown', 'active')
      and opponent in (b.challenger_id, b.opponent_id)
  ) then raise exception 'Opponent is already battling' using errcode = '23505'; end if;

  repeats := public.battle_repeat_opponent_count(challenger, opponent);
  stake_multiplier := pg_catalog.power(0.75::numeric, repeats);
  if match_mode = 'handicap' then
    select p.challenger_best_ms, p.opponent_best_ms, p.suggested_handicap_ms, p.challenger_elo, p.opponent_elo
      into challenger_best_value, opponent_best_value, suggested_value, challenger_elo_value, opponent_elo_value
    from public.get_battle_handicap_preview(category, opponent) as p;
    if handicap_user is null or handicap_user not in (challenger, opponent) or handicap is null or handicap < 0 then
      raise exception 'Handicap terms are invalid' using errcode = '22023';
    end if;
    expected_challenger := public.battle_handicap_expected_challenger(
      challenger_best_value, opponent_best_value, handicap_user, challenger, handicap,
      challenger_elo_value, opponent_elo_value
    );
    fair_stake := pg_catalog.round(category_factor * stake_multiplier / 2.0)::integer;
  else
    handicap_user := null;
    handicap := 0;
  end if;

  insert into public.battles (
    challenger_id, opponent_id, category_id, clan_id, battle_mode, handicap_user_id,
    handicap_ms, suggested_handicap_ms, max_handicap_ms, challenger_best_ms,
    opponent_best_ms, handicap_expected_challenger, battle_elo_factor, handicap_elo_stake,
    repeat_opponent_count, elo_stake_multiplier
  ) values (
    challenger, opponent, category, clan, match_mode, handicap_user, handicap,
    suggested_value,
    case when match_mode = 'handicap' then greatest(suggested_value, handicap) else 0 end,
    challenger_best_value, opponent_best_value, expected_challenger, category_factor, fair_stake,
    repeats, stake_multiplier
  ) returning id into result;

  insert into public.battle_participants (battle_id, user_id, accepted_at, elo_before, rank_before_name, rank_before_image_path)
  select result, challenger, pg_catalog.clock_timestamp(), br.elo, rank.name, rank.image_path
  from public.battle_ratings as br left join lateral public.battle_rank_for_elo(br.elo) as rank on true
  where br.user_id = challenger;
  insert into public.battle_participants (battle_id, user_id, elo_before, rank_before_name, rank_before_image_path)
  select result, opponent, br.elo, rank.name, rank.image_path
  from public.battle_ratings as br left join lateral public.battle_rank_for_elo(br.elo) as rank on true
  where br.user_id = opponent;
  return result;
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
  select bp.user_id, bp.elapsed_ms, a.status,
    greatest(0::bigint, bp.elapsed_ms - case when bp.user_id = existing.handicap_user_id then existing.handicap_ms else 0 end) as adjusted_ms
  into faster from public.battle_participants as bp join public.attempts as a on a.id = bp.attempt_id
  where bp.battle_id = existing.id order by adjusted_ms, bp.finished_at, bp.user_id limit 1;
  select bp.user_id, bp.elapsed_ms, a.status,
    greatest(0::bigint, bp.elapsed_ms - case when bp.user_id = existing.handicap_user_id then existing.handicap_ms else 0 end) as adjusted_ms
  into slower from public.battle_participants as bp join public.attempts as a on a.id = bp.attempt_id
  where bp.battle_id = existing.id order by adjusted_ms desc, bp.finished_at desc, bp.user_id desc limit 1;
  if faster.user_id is null or slower.user_id is null or faster.user_id = slower.user_id then return false; end if;
  if faster.adjusted_ms = slower.adjusted_ms then
    if faster.status = 'pending_review'::public.attempt_status or slower.status = 'pending_review'::public.attempt_status then return false;
    elsif faster.status = 'approved'::public.attempt_status and slower.status = 'approved'::public.attempt_status then winner := null;
    elsif faster.status = 'approved'::public.attempt_status then winner := faster.user_id;
    elsif slower.status = 'approved'::public.attempt_status then winner := slower.user_id;
    else winner := null; end if;
  elsif faster.status = 'approved'::public.attempt_status then winner := faster.user_id;
  elsif faster.status = 'pending_review'::public.attempt_status then return false;
  elsif slower.status = 'approved'::public.attempt_status then winner := slower.user_id;
  elsif slower.status = 'pending_review'::public.attempt_status then return false;
  else winner := null; end if;

  if winner is null then
    update public.battle_participants set elo_after = elo_before, elo_change = 0,
      rank_after_name = rank_before_name, rank_after_image_path = rank_before_image_path where battle_id = existing.id;
    update public.battle_ratings set draws = draws + 1, updated_at = pg_catalog.clock_timestamp()
    where user_id in (existing.challenger_id, existing.opponent_id);
    update public.battles set winner_id = null, settled_at = pg_catalog.clock_timestamp() where id = existing.id;
    return true;
  end if;

  select bp.* into challenger_player from public.battle_participants as bp
  where bp.battle_id = existing.id and bp.user_id = existing.challenger_id for update;
  select bp.* into opponent_player from public.battle_participants as bp
  where bp.battle_id = existing.id and bp.user_id = existing.opponent_id for update;
  perform 1 from public.battle_ratings as br where br.user_id in (existing.challenger_id, existing.opponent_id) order by br.user_id for update;
  select br.elo into challenger_current from public.battle_ratings as br where br.user_id = existing.challenger_id;
  select br.elo into opponent_current from public.battle_ratings as br where br.user_id = existing.opponent_id;

  if existing.battle_mode = 'handicap' then
    challenger_expected := existing.handicap_expected_challenger;
  else
    challenger_expected := 1.0 / (1.0 + pg_catalog.power(10.0, (opponent_player.elo_before - challenger_player.elo_before) / 400.0));
  end if;
  challenger_score := case when winner = existing.challenger_id then 1.0 else 0.0 end;
  challenger_delta := pg_catalog.round(existing.battle_elo_factor * existing.elo_stake_multiplier * (challenger_score - challenger_expected))::integer;
  challenger_after := greatest(0, challenger_current + challenger_delta);
  opponent_after := greatest(0, opponent_current - challenger_delta);

  update public.battle_ratings set elo = challenger_after,
    wins = wins + case when winner = existing.challenger_id then 1 else 0 end,
    losses = losses + case when winner = existing.opponent_id then 1 else 0 end,
    updated_at = pg_catalog.clock_timestamp() where user_id = existing.challenger_id;
  update public.battle_ratings set elo = opponent_after,
    wins = wins + case when winner = existing.opponent_id then 1 else 0 end,
    losses = losses + case when winner = existing.challenger_id then 1 else 0 end,
    updated_at = pg_catalog.clock_timestamp() where user_id = existing.opponent_id;

  with changes as (
    select bp.user_id,
      case when bp.user_id = existing.challenger_id then challenger_after else opponent_after end as global_elo,
      case when bp.user_id = existing.challenger_id then challenger_after - challenger_current else opponent_after - opponent_current end as elo_delta
    from public.battle_participants as bp where bp.battle_id = existing.id
  ), ranked as (
    select changes.*, rank.name, rank.image_path from changes
    left join lateral public.battle_rank_for_elo(changes.global_elo) as rank on true
  )
  update public.battle_participants as bp set elo_after = bp.elo_before + ranked.elo_delta,
    elo_change = ranked.elo_delta, rank_after_name = ranked.name, rank_after_image_path = ranked.image_path
  from ranked where bp.battle_id = existing.id and bp.user_id = ranked.user_id;
  insert into public.battle_rating_events (battle_id, user_id, elo_before, elo_after, change) values
    (existing.id, existing.challenger_id, challenger_current, challenger_after, challenger_after - challenger_current),
    (existing.id, existing.opponent_id, opponent_current, opponent_after, opponent_after - opponent_current);
  update public.battles set winner_id = winner, settled_at = pg_catalog.clock_timestamp() where id = existing.id;
  return true;
end;
$$;

revoke all on function public.battle_handicap_expected_challenger(bigint, bigint, uuid, uuid, bigint, integer, integer), public.get_battle_handicap_preview(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_battle_handicap_preview(uuid, uuid) to authenticated, service_role;
grant execute on function public.battle_handicap_expected_challenger(bigint, bigint, uuid, uuid, bigint, integer, integer) to service_role;

comment on column public.battles.handicap_expected_challenger is 'Challenger win probability snapshotted from both players Elo, personal bests, and selected handicap.';
comment on column public.battles.handicap_elo_stake is 'Legacy fair-match display value; settlement uses standard Elo odds from handicap_expected_challenger.';
