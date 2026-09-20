create table public.battle_ranks (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  image_path text,
  min_elo integer not null,
  max_elo integer not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint battle_ranks_name_length check (pg_catalog.char_length(pg_catalog.btrim(name)) between 1 and 50),
  constraint battle_ranks_hundred_point_band check (min_elo >= 0 and max_elo = min_elo + 99),
  constraint battle_ranks_min_elo_key unique (min_elo)
);

create table public.battle_ratings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  elo integer not null default 500,
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint battle_ratings_elo_nonnegative check (elo >= 0),
  constraint battle_ratings_record_nonnegative check (wins >= 0 and losses >= 0 and draws >= 0)
);

create table public.battles (
  id uuid primary key default extensions.gen_random_uuid(),
  challenger_id uuid not null references public.profiles (id) on delete cascade,
  opponent_id uuid not null references public.profiles (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete restrict,
  clan_id uuid references public.clans (id) on delete set null,
  status text not null default 'pending',
  starts_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint battles_different_users check (challenger_id <> opponent_id),
  constraint battles_status check (status in ('pending', 'countdown', 'active', 'completed', 'declined', 'cancelled')),
  constraint battles_start_state check (
    (status in ('pending', 'declined', 'cancelled') and starts_at is null)
    or (status in ('countdown', 'active', 'completed') and starts_at is not null)
  ),
  constraint battles_completion_state check ((status = 'completed') = (completed_at is not null))
);

create table public.battle_participants (
  battle_id uuid not null references public.battles (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  accepted_at timestamptz,
  finished_at timestamptz,
  elapsed_ms bigint,
  attempt_id uuid unique references public.attempts (id) on delete set null,
  elo_before integer,
  elo_after integer,
  elo_change integer,
  rank_before_name text,
  rank_before_image_path text,
  rank_after_name text,
  rank_after_image_path text,
  primary key (battle_id, user_id),
  constraint battle_participants_elapsed_nonnegative check (elapsed_ms is null or elapsed_ms >= 0),
  constraint battle_participants_finish_together check ((finished_at is null) = (elapsed_ms is null)),
  constraint battle_participants_rating_together check (
    (elo_after is null and elo_change is null)
    or (elo_after is not null and elo_change is not null and elo_before is not null)
  )
);

create table public.battle_rating_events (
  id bigint generated always as identity primary key,
  battle_id uuid not null references public.battles (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  elo_before integer not null,
  elo_after integer not null,
  change integer not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint battle_rating_events_once unique (battle_id, user_id)
);

create index battles_challenger_status_idx on public.battles (challenger_id, status, created_at desc);
create index battles_opponent_status_idx on public.battles (opponent_id, status, created_at desc);
create index battles_participant_history_idx on public.battles (created_at desc);
create index battle_participants_user_idx on public.battle_participants (user_id, battle_id);
create index battle_rating_events_user_idx on public.battle_rating_events (user_id, created_at desc);

create trigger battle_ranks_set_updated_at
before update on public.battle_ranks
for each row execute function public.set_updated_at();

create trigger battles_set_updated_at
before update on public.battles
for each row execute function public.set_updated_at();

create or replace function public.create_battle_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.battle_ratings (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger profiles_create_battle_rating
after insert on public.profiles
for each row execute function public.create_battle_rating();

insert into public.battle_ratings (user_id)
select p.id from public.profiles as p
on conflict (user_id) do nothing;

insert into public.battle_ranks (name, min_elo, max_elo, sort_order)
values
  ('Nybegynder', 0, 99, 0),
  ('Jern', 100, 199, 100),
  ('Bronze', 200, 299, 200),
  ('Sølv', 300, 399, 300),
  ('Guld', 400, 499, 400),
  ('Platin', 500, 599, 500),
  ('Diamant', 600, 699, 600),
  ('Mester', 700, 799, 700),
  ('Stormester', 800, 899, 800),
  ('Legende', 900, 999, 900);

create or replace function public.battle_rank_for_elo(rating integer)
returns public.battle_ranks
language sql
stable
security definer
set search_path = ''
as $$
  select r
  from public.battle_ranks as r
  order by
    case
      when $1 between r.min_elo and r.max_elo then 0
      when $1 < r.min_elo then r.min_elo - $1
      else $1 - r.max_elo
    end,
    r.min_elo
  limit 1;
$$;

create or replace function public.get_battle_standing(target uuid default auth.uid())
returns table (
  user_id uuid,
  elo integer,
  wins integer,
  losses integer,
  draws integer,
  rank_id uuid,
  rank_name text,
  rank_image_path text,
  rank_min_elo integer,
  rank_max_elo integer
)
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

  if $1 <> current_user_id and not public.is_friend($1) and not public.is_admin() then
    raise exception 'Standing not found' using errcode = 'P0002';
  end if;

  return query
  select
    br.user_id,
    case when $1 = current_user_id or public.is_admin() then br.elo else null end,
    br.wins,
    br.losses,
    br.draws,
    rank.id,
    rank.name,
    rank.image_path,
    rank.min_elo,
    rank.max_elo
  from public.battle_ratings as br
  left join lateral public.battle_rank_for_elo(br.elo) as rank on true
  where br.user_id = $1;
end;
$$;

create or replace function public.get_battle_rank_labels(targets uuid[])
returns table (user_id uuid, rank_name text, rank_image_path text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  return query
  select br.user_id, rank.name, rank.image_path
  from public.battle_ratings as br
  left join lateral public.battle_rank_for_elo(br.elo) as rank on true
  where br.user_id = any(coalesce(targets, array[]::uuid[]));
end;
$$;

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
  if challenger is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if opponent is null or opponent = challenger then
    raise exception 'Choose a different opponent' using errcode = '22023';
  end if;
  if not public.is_friend(opponent) then
    raise exception 'Accepted friendship required' using errcode = '42501';
  end if;

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
    select 1 from public.battles as b
    where b.status in ('pending', 'countdown', 'active')
      and (challenger in (b.challenger_id, b.opponent_id) or opponent in (b.challenger_id, b.opponent_id))
  ) then
    raise exception 'A player already has an open battle' using errcode = '23505';
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
  start_time timestamptz;
begin
  if current_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if accept is null then raise exception 'Decision is required' using errcode = '22023'; end if;

  select b.* into existing from public.battles as b
  where b.id = battle and b.opponent_id = current_user_id
  for update;
  if not found or existing.status <> 'pending' then
    raise exception 'Pending invitation not found' using errcode = 'P0002';
  end if;

  if not accept then
    update public.battles set status = 'declined' where id = existing.id;
    return null;
  end if;

  if exists (
    select 1 from public.attempts as a
    where a.user_id in (existing.challenger_id, existing.opponent_id)
      and a.status in ('running'::public.attempt_status, 'awaiting_confirmation'::public.attempt_status)
  ) then
    raise exception 'Resolve active timers before accepting' using errcode = '23505';
  end if;

  start_time := pg_catalog.clock_timestamp()
    + pg_catalog.make_interval(secs => 10 + pg_catalog.floor(pg_catalog.random() * 11)::integer);

  update public.battle_participants as bp
  set accepted_at = pg_catalog.clock_timestamp(),
      elo_before = br.elo,
      rank_before_name = rank.name,
      rank_before_image_path = rank.image_path
  from public.battle_ratings as br
  left join lateral public.battle_rank_for_elo(br.elo) as rank on true
  where bp.battle_id = existing.id
    and bp.user_id = current_user_id
    and br.user_id = current_user_id;

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
  update public.battles as b
  set status = 'cancelled'
  where b.id = $1
    and b.challenger_id = auth.uid()
    and b.status = 'pending';
  if not found then raise exception 'Pending battle not found' using errcode = 'P0002'; end if;
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
  first_player public.battle_participants%rowtype;
  second_player public.battle_participants%rowtype;
  first_expected numeric;
  first_score numeric;
  first_delta integer;
  first_after integer;
  second_after integer;
begin
  if current_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;

  select b.* into existing from public.battles as b
  where b.id = battle and current_user_id in (b.challenger_id, b.opponent_id)
  for update;
  if not found then raise exception 'Battle not found' using errcode = 'P0002'; end if;
  if existing.status not in ('countdown', 'active') or existing.starts_at is null then
    raise exception 'Battle is not running' using errcode = '22023';
  end if;

  stopped_at := pg_catalog.clock_timestamp();
  if stopped_at < existing.starts_at then
    raise exception 'Battle has not started' using errcode = '22023';
  end if;
  elapsed := pg_catalog.floor(extract(epoch from (stopped_at - existing.starts_at)) * 1000)::bigint;

  perform 1 from public.battle_participants as bp
  where bp.battle_id = existing.id and bp.user_id = current_user_id and bp.finished_at is null
  for update;
  if not found then raise exception 'Battle time already stopped' using errcode = '23505'; end if;

  insert into public.attempts (
    user_id, recorded_by, category_id, clan_id, started_at, stopped_at,
    elapsed_ms, status, confirmed_at
  ) values (
    current_user_id, current_user_id, existing.category_id, existing.clan_id, existing.starts_at, stopped_at,
    elapsed, 'approved'::public.attempt_status, stopped_at
  ) returning id into created_attempt;

  update public.battle_participants
  set finished_at = stopped_at, elapsed_ms = elapsed, attempt_id = created_attempt
  where battle_id = existing.id and user_id = current_user_id;
  update public.battles set status = 'active' where id = existing.id;

  select bp.* into first_player from public.battle_participants as bp
  where bp.battle_id = existing.id and bp.user_id = existing.challenger_id for update;
  select bp.* into second_player from public.battle_participants as bp
  where bp.battle_id = existing.id and bp.user_id = existing.opponent_id for update;

  if first_player.finished_at is null or second_player.finished_at is null then
    return elapsed;
  end if;

  perform 1 from public.battle_ratings as br
  where br.user_id in (existing.challenger_id, existing.opponent_id)
  order by br.user_id for update;

  first_expected := 1.0 / (1.0 + pg_catalog.power(10.0, (second_player.elo_before - first_player.elo_before) / 400.0));
  first_score := case
    when first_player.elapsed_ms < second_player.elapsed_ms then 1.0
    when first_player.elapsed_ms > second_player.elapsed_ms then 0.0
    else 0.5
  end;
  first_delta := pg_catalog.round(40 * (first_score - first_expected))::integer;
  if first_score <> 0.5 and first_delta = 0 then
    first_delta := case when first_score = 1.0 then 1 else -1 end;
  end if;

  select greatest(0, br.elo + first_delta) into first_after
  from public.battle_ratings as br where br.user_id = existing.challenger_id;
  select greatest(0, br.elo - first_delta) into second_after
  from public.battle_ratings as br where br.user_id = existing.opponent_id;

  update public.battle_ratings as br
  set elo = first_after,
      wins = wins + case when first_score = 1.0 then 1 else 0 end,
      losses = losses + case when first_score = 0.0 then 1 else 0 end,
      draws = draws + case when first_score = 0.5 then 1 else 0 end,
      updated_at = pg_catalog.clock_timestamp()
  where br.user_id = existing.challenger_id;

  update public.battle_ratings as br
  set elo = second_after,
      wins = wins + case when first_score = 0.0 then 1 else 0 end,
      losses = losses + case when first_score = 1.0 then 1 else 0 end,
      draws = draws + case when first_score = 0.5 then 1 else 0 end,
      updated_at = pg_catalog.clock_timestamp()
  where br.user_id = existing.opponent_id;

  with settled as (
    select
      bp.user_id,
      case when bp.user_id = existing.challenger_id then first_after else second_after end as next_elo
    from public.battle_participants as bp
    where bp.battle_id = existing.id
  ), ranked as (
    select settled.user_id, settled.next_elo, rank.name, rank.image_path
    from settled
    left join lateral public.battle_rank_for_elo(settled.next_elo) as rank on true
  )
  update public.battle_participants as bp
  set elo_after = ranked.next_elo,
      elo_change = ranked.next_elo - bp.elo_before,
      rank_after_name = ranked.name,
      rank_after_image_path = ranked.image_path
  from ranked
  where bp.battle_id = existing.id and bp.user_id = ranked.user_id;

  insert into public.battle_rating_events (battle_id, user_id, elo_before, elo_after, change)
  select bp.battle_id, bp.user_id, bp.elo_before, bp.elo_after, bp.elo_change
  from public.battle_participants as bp where bp.battle_id = existing.id;

  update public.battles
  set status = 'completed', completed_at = pg_catalog.clock_timestamp()
  where id = existing.id;

  return elapsed;
end;
$$;

create or replace function public.admin_reset_battle_elo()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare affected bigint;
begin
  if not public.is_admin() then raise exception 'Administrator required' using errcode = '42501'; end if;
  with reset_values as (
    select br.user_id, rank.min_elo
    from public.battle_ratings as br
    left join lateral public.battle_rank_for_elo(br.elo) as rank on true
  )
  update public.battle_ratings as br
  set elo = reset_values.min_elo, updated_at = pg_catalog.clock_timestamp()
  from reset_values
  where br.user_id = reset_values.user_id and reset_values.min_elo is not null;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function public.validate_battle_rank_range()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.battle_ranks as r
    where r.id <> new.id and int4range(r.min_elo, r.max_elo, '[]') && int4range(new.min_elo, new.max_elo, '[]')
  ) then
    raise exception 'Battle rank Elo ranges cannot overlap' using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger battle_ranks_validate_range
before insert or update of min_elo, max_elo on public.battle_ranks
for each row execute function public.validate_battle_rank_range();

alter table public.battle_ranks enable row level security;
alter table public.battle_ratings enable row level security;
alter table public.battles enable row level security;
alter table public.battle_participants enable row level security;
alter table public.battle_rating_events enable row level security;

create policy battle_ranks_authenticated_read on public.battle_ranks for select to authenticated using (true);
create policy battle_ranks_admin_manage on public.battle_ranks for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy battle_ratings_self_read on public.battle_ratings for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy battles_participant_read on public.battles for select to authenticated using ((select auth.uid()) in (challenger_id, opponent_id) or (select public.is_admin()));
create policy battle_participants_match_read on public.battle_participants for select to authenticated using (
  exists (select 1 from public.battles as b where b.id = battle_id and ((select auth.uid()) in (b.challenger_id, b.opponent_id) or (select public.is_admin())))
);
create policy battle_rating_events_self_read on public.battle_rating_events for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

revoke all on table public.battle_ranks, public.battle_ratings, public.battles, public.battle_participants, public.battle_rating_events from public, anon, authenticated;
grant select, insert, update, delete on table public.battle_ranks to authenticated;
grant select on table public.battle_ratings, public.battles, public.battle_participants, public.battle_rating_events to authenticated;
grant all on table public.battle_ranks, public.battle_ratings, public.battles, public.battle_participants, public.battle_rating_events to service_role;
grant usage, select on sequence public.battle_rating_events_id_seq to service_role;

revoke all on function public.battle_rank_for_elo(integer), public.get_battle_standing(uuid), public.get_battle_rank_labels(uuid[]), public.create_battle(uuid, uuid, uuid), public.respond_battle(uuid, boolean), public.cancel_battle(uuid), public.stop_battle(uuid), public.admin_reset_battle_elo() from public, anon, authenticated, service_role;
grant execute on function public.battle_rank_for_elo(integer), public.get_battle_standing(uuid), public.get_battle_rank_labels(uuid[]), public.create_battle(uuid, uuid, uuid), public.respond_battle(uuid, boolean), public.cancel_battle(uuid), public.stop_battle(uuid) to authenticated;
grant execute on function public.admin_reset_battle_elo() to authenticated;
grant execute on function public.battle_rank_for_elo(integer), public.get_battle_standing(uuid), public.get_battle_rank_labels(uuid[]), public.create_battle(uuid, uuid, uuid), public.respond_battle(uuid, boolean), public.cancel_battle(uuid), public.stop_battle(uuid), public.admin_reset_battle_elo() to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rank-media', 'rank-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy rank_media_admin_manage on storage.objects
for all to authenticated
using (bucket_id = 'rank-media' and (select public.is_admin()))
with check (bucket_id = 'rank-media' and (select public.is_admin()));

comment on table public.battle_ratings is 'Private current Elo and battle record for each user.';
comment on table public.battle_ranks is 'Administrator-defined 100-point Elo bands; changing bands never changes Elo.';
comment on table public.battles is 'Server-authoritative 1v1 invitations, shared starts, and completed outcomes.';
