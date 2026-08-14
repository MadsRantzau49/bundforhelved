#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.docker"

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "Docker Compose is not installed." >&2
  exit 1
fi

compose() {
  "${COMPOSE[@]}" --project-directory "$ROOT" --env-file "$ENV_FILE" -f "$ROOT/compose.yaml" "$@"
}

validate_compose() {
  local version major minor
  version="$("${COMPOSE[@]}" version --short 2>/dev/null)"
  version="${version#v}"
  IFS=. read -r major minor _ <<<"$version"
  if [[ ! "$major" =~ ^[0-9]+$ || ! "$minor" =~ ^[0-9]+$ ]] \
    || (( major < 2 )) \
    || (( major == 2 && minor < 20 )); then
    echo "Docker Compose 2.20 or newer is required (found ${version:-unknown})." >&2
    exit 1
  fi
}

prepare() {
  docker info >/dev/null
  validate_compose
  node "$ROOT/scripts/generate-docker-env.mjs"
}

env_value() {
  node --env-file="$ENV_FILE" -e 'process.stdout.write(process.env[process.argv[1]] || "")' "$1"
}

start_stack() {
  export NEXT_PUBLIC_APP_VERSION="docker-$(date +%s)"
  compose up --build --wait --wait-timeout 600
  echo
  echo "bund forhelved is running at http://localhost:3000"
  echo "Configured initial login: $(env_value BOOTSTRAP_ADMIN_USERNAME) / $(env_value BOOTSTRAP_ADMIN_PASSWORD)"
}

command="${1:-help}"
case "$command" in
  up)
    prepare
    start_stack
    ;;
  down)
    prepare
    compose down --remove-orphans
    ;;
  restart)
    prepare
    compose down --remove-orphans
    start_stack
    ;;
  status|ps)
    prepare
    compose ps
    ;;
  logs)
    prepare
    shift
    compose logs --follow --tail=200 "$@"
    ;;
  psql)
    prepare
    compose exec db psql -U postgres -d postgres
    ;;
  reset-admin)
    prepare
    compose run --rm --no-deps -e BOOTSTRAP_RESET_PASSWORD=true bootstrap
    ;;
  test)
    prepare
    node --env-file="$ENV_FILE" "$ROOT/scripts/smoke-test.mjs"
    ;;
  secrets)
    prepare
    echo "App URL:      http://localhost:3000"
    echo "Supabase URL: http://localhost:8000"
    echo "Initial admin: $(env_value BOOTSTRAP_ADMIN_USERNAME) / $(env_value BOOTSTRAP_ADMIN_PASSWORD)"
    echo "All generated service keys are stored in $ENV_FILE"
    ;;
  reset)
    prepare
    if [[ "${2:-}" != "--yes" ]]; then
      read -r -p "Delete the local database, avatars, containers, and generated keys? [y/N] " answer
      [[ "$answer" =~ ^[Yy]$ ]] || exit 0
    fi
    compose down --volumes --remove-orphans
    rm -f "$ENV_FILE" "$ROOT/docker/generated/kong.yml"
    echo "Local Docker data and keys were removed."
    ;;
  config)
    prepare
    compose config
    ;;
  help|*)
    cat <<'HELP'
Usage: ./scripts/docker.sh <command>

  up        Generate keys, build, and start everything
  down      Stop and remove containers while preserving data
  restart   Restart running services
  status    Show container health
  logs      Follow logs; optionally add a service name
  psql      Open a Postgres shell
  reset-admin  Apply BOOTSTRAP_ADMIN_PASSWORD to the existing admin
  test      Exercise app, Auth, timer, clans, and Storage
  secrets   Show local URLs and credential location
  reset     Delete all local data and generated keys
  config    Render and validate the Compose configuration
HELP
    ;;
esac
