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
        (challenger_best::numeric - case when recipient = challenger then handicap::numeric else 0 end)
        - (opponent_best::numeric - case when recipient <> challenger then handicap::numeric else 0 end)
      ) / greatest(1000.0, least(challenger_best, opponent_best) / 4.0)
    )
  )::integer);
$$;
