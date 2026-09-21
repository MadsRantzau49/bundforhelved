alter table public.categories
  add column battle_elo_factor integer not null default 40,
  add constraint categories_battle_elo_factor_positive check (battle_elo_factor > 0);

alter table public.battle_ranks
  drop constraint battle_ranks_hundred_point_band,
  add constraint battle_ranks_valid_band check (min_elo >= 0 and max_elo >= min_elo);

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
  elo_factor integer;
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

  if faster.elapsed_ms = slower.elapsed_ms then
    if faster.status = 'pending_review'::public.attempt_status
       or slower.status = 'pending_review'::public.attempt_status then
      return false;
    elsif faster.status = 'approved'::public.attempt_status
          and slower.status = 'approved'::public.attempt_status then
      winner := null;
    elsif faster.status = 'approved'::public.attempt_status then
      winner := faster.user_id;
    elsif slower.status = 'approved'::public.attempt_status then
      winner := slower.user_id;
    else
      winner := null;
    end if;
  elsif faster.status = 'approved'::public.attempt_status then
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
    update public.battle_ratings
    set draws = draws + 1, updated_at = pg_catalog.clock_timestamp()
    where user_id in (existing.challenger_id, existing.opponent_id);
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
  select c.battle_elo_factor into elo_factor from public.categories as c where c.id = existing.category_id;

  challenger_expected := 1.0 / (1.0 + pg_catalog.power(10.0, (opponent_player.elo_before - challenger_player.elo_before) / 400.0));
  challenger_score := case when winner = existing.challenger_id then 1.0 else 0.0 end;
  challenger_delta := pg_catalog.round(elo_factor * (challenger_score - challenger_expected))::integer;
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

comment on column public.categories.battle_elo_factor is 'Per-map Elo adjustment factor used when settling 1v1 battles.';
comment on table public.battle_ranks is 'Administrator-defined Elo bands; changing bands never changes player Elo.';
