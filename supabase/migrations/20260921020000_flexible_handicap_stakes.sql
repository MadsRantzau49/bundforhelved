alter table public.battles
  add column handicap_elo_stake integer not null default 0;

create or replace function public.battle_handicap_elo_stake(
  challenger_best bigint,
  opponent_best bigint,
  recipient uuid,
  challenger uuid,
  handicap bigint,
  elo_factor integer
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select greatest(0, pg_catalog.round(
    (elo_factor / 2.0) * pg_catalog.exp(
      -pg_catalog.abs(
        (challenger_best - case when recipient = challenger then handicap else 0 end)
        - (opponent_best - case when recipient <> challenger then handicap else 0 end)
      ) / greatest(1000.0, least(challenger_best, opponent_best) / 4.0)
    )
  )::integer);
$$;

update public.battles
set handicap_elo_stake = public.battle_handicap_elo_stake(
  challenger_best_ms, opponent_best_ms, handicap_user_id, challenger_id, handicap_ms, battle_elo_factor
)
where battle_mode = 'handicap';

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
      and suggested_handicap_ms > 0
      and handicap_ms >= 0
      and handicap_elo_stake between 0 and pg_catalog.ceil(battle_elo_factor / 2.0)::integer)
  );

drop function public.get_battle_handicap_preview(uuid, uuid);

create function public.get_battle_handicap_preview(category uuid, opponent uuid)
returns table (
  challenger_best_ms bigint,
  opponent_best_ms bigint,
  handicap_user_id uuid,
  suggested_handicap_ms bigint,
  odds_scale_ms numeric,
  battle_elo_factor integer,
  challenger_elo integer,
  opponent_elo integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  challenger uuid := auth.uid();
  challenger_best bigint;
  opponent_best bigint;
  suggested bigint;
begin
  if challenger is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if opponent is null or opponent = challenger or not public.is_friend(opponent) then
    raise exception 'Accepted friendship required' using errcode = '42501';
  end if;
  perform 1 from public.categories as c where c.id = category and c.is_active;
  if not found then raise exception 'Category is not active' using errcode = '22023'; end if;

  select pg_catalog.min(a.elapsed_ms) into challenger_best
  from public.attempts as a
  where a.user_id = challenger and a.category_id = category
    and a.status = 'approved'::public.attempt_status and a.invalidated_at is null;
  select pg_catalog.min(a.elapsed_ms) into opponent_best
  from public.attempts as a
  where a.user_id = opponent and a.category_id = category
    and a.status = 'approved'::public.attempt_status and a.invalidated_at is null;
  if challenger_best is null or opponent_best is null then
    raise exception 'Approved personal bests required for handicap' using errcode = '22023';
  end if;
  suggested := pg_catalog.abs(challenger_best - opponent_best);
  if suggested = 0 then raise exception 'Personal bests are already equal' using errcode = '22023'; end if;

  return query
  select challenger_best, opponent_best,
    case when challenger_best > opponent_best then challenger else opponent end,
    suggested,
    greatest(1000::numeric, least(challenger_best, opponent_best)::numeric / 4),
    c.battle_elo_factor, challenger_rating.elo, opponent_rating.elo
  from public.categories as c
  join public.battle_ratings as challenger_rating on challenger_rating.user_id = challenger
  join public.battle_ratings as opponent_rating on opponent_rating.user_id = opponent
  where c.id = category;
end;
$$;

drop function public.create_battle(uuid, uuid, uuid, text, bigint);

create function public.create_battle(category uuid, clan uuid, opponent uuid, match_mode text, handicap_user uuid, handicap bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  challenger uuid := auth.uid();
  result uuid;
  category_factor integer;
  terms record;
  elo_stake integer := 0;
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
  if exists (
    select 1 from public.battles as b
    where b.settled_at >= pg_catalog.clock_timestamp() - interval '30 minutes'
      and least(challenger, opponent) = least(b.challenger_id, b.opponent_id)
      and greatest(challenger, opponent) = greatest(b.challenger_id, b.opponent_id)
  ) then raise exception 'Battle pair cooldown active' using errcode = '22023'; end if;
  if (
    select pg_catalog.count(*) from public.battles as b
    where b.settled_at >= pg_catalog.clock_timestamp() - interval '24 hours'
      and least(challenger, opponent) = least(b.challenger_id, b.opponent_id)
      and greatest(challenger, opponent) = greatest(b.challenger_id, b.opponent_id)
  ) >= 5 then raise exception 'Battle pair daily limit reached' using errcode = '22023'; end if;

  if match_mode = 'handicap' then
    select * into terms from public.get_battle_handicap_preview(category, opponent);
    if handicap_user is null or handicap_user not in (challenger, opponent) or handicap is null or handicap < 0 then
      raise exception 'Handicap terms are invalid' using errcode = '22023';
    end if;
    elo_stake := public.battle_handicap_elo_stake(
      terms.challenger_best_ms, terms.opponent_best_ms, handicap_user, challenger, handicap, category_factor
    );
  else
    handicap_user := null;
    handicap := 0;
  end if;

  insert into public.battles (
    challenger_id, opponent_id, category_id, clan_id, battle_mode, handicap_user_id,
    handicap_ms, suggested_handicap_ms, max_handicap_ms, challenger_best_ms,
    opponent_best_ms, handicap_expected_challenger, battle_elo_factor, handicap_elo_stake
  ) values (
    challenger, opponent, category, clan, match_mode, handicap_user, handicap,
    case when match_mode = 'handicap' then terms.suggested_handicap_ms else 0 end,
    case when match_mode = 'handicap' then greatest(terms.suggested_handicap_ms, handicap) else 0 end,
    case when match_mode = 'handicap' then terms.challenger_best_ms else null end,
    case when match_mode = 'handicap' then terms.opponent_best_ms else null end,
    null, category_factor, elo_stake
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
    challenger_delta := case when winner = existing.challenger_id then existing.handicap_elo_stake else -existing.handicap_elo_stake end;
  else
    challenger_expected := 1.0 / (1.0 + pg_catalog.power(10.0, (opponent_player.elo_before - challenger_player.elo_before) / 400.0));
    challenger_score := case when winner = existing.challenger_id then 1.0 else 0.0 end;
    challenger_delta := pg_catalog.round(existing.battle_elo_factor * (challenger_score - challenger_expected))::integer;
    if challenger_delta = 0 then challenger_delta := case when challenger_score = 1.0 then 1 else -1 end; end if;
  end if;
  if challenger_delta > 0 then challenger_delta := least(challenger_delta, opponent_current);
  else challenger_delta := -least(pg_catalog.abs(challenger_delta), challenger_current); end if;
  challenger_after := challenger_current + challenger_delta;
  opponent_after := opponent_current - challenger_delta;

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

revoke all on function public.battle_handicap_elo_stake(bigint, bigint, uuid, uuid, bigint, integer), public.get_battle_handicap_preview(uuid, uuid), public.create_battle(uuid, uuid, uuid, text, uuid, bigint) from public, anon, authenticated, service_role;
grant execute on function public.get_battle_handicap_preview(uuid, uuid), public.create_battle(uuid, uuid, uuid, text, uuid, bigint) to authenticated, service_role;
grant execute on function public.battle_handicap_elo_stake(bigint, bigint, uuid, uuid, bigint, integer) to service_role;

comment on column public.battles.handicap_elo_stake is 'Symmetric zero-sum Elo stake based on how closely adjusted personal bests match.';
