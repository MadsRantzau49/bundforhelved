#!/usr/bin/env bash
set -euo pipefail

psql -v ON_ERROR_STOP=1 <<'SQL'
create table if not exists public.app_schema_migrations (
  name text primary key,
  checksum text,
  applied_at timestamptz not null default clock_timestamp()
);
alter table public.app_schema_migrations add column if not exists checksum text;
revoke all on table public.app_schema_migrations from public, anon, authenticated;
SQL

for migration in /migrations/*.sql; do
  name="$(basename "$migration")"
  [[ "$name" =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "Invalid migration filename: $name" >&2; exit 1; }
  read -r checksum _ < <(sha256sum "$migration")
  applied_checksum="$(psql -v ON_ERROR_STOP=1 -tAc "select coalesce(checksum, '__legacy__') from public.app_schema_migrations where name = '$name'")"

  if [[ "$applied_checksum" == "__legacy__" ]]; then
    echo "Recording checksum for legacy migration $name"
    psql -v ON_ERROR_STOP=1 -c "update public.app_schema_migrations set checksum = '$checksum' where name = '$name'"
    applied_checksum="$checksum"
  fi

  if [[ -n "$applied_checksum" && "$applied_checksum" != "$checksum" ]]; then
    echo "Applied migration changed: $name. Add a new migration or reset local Docker data." >&2
    exit 1
  fi

  if [[ -z "$applied_checksum" ]]; then
    echo "Applying $name"
    psql -v ON_ERROR_STOP=1 --single-transaction \
      -f "$migration" \
      -c "insert into public.app_schema_migrations (name, checksum) values ('$name', '$checksum')"
  fi
done

psql -v ON_ERROR_STOP=1 -c "alter table public.app_schema_migrations alter column checksum set not null"
psql -v ON_ERROR_STOP=1 -c "notify pgrst, 'reload schema'"
echo "Database migrations are current."
