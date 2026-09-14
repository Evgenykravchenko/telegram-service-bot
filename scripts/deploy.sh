#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
env_file=${ENV_FILE:-/etc/bot-platform/bots/telegram-service-bot.env}

if [ ! -r "$env_file" ]; then
  echo "Environment file is not readable: $env_file" >&2
  exit 1
fi

compose() {
  docker compose --env-file "$env_file" -f "$repo_dir/compose.production.yaml" "$@"
}

compose config --quiet
docker_config_dir=$(mktemp -d)
trap 'rm -rf "$docker_config_dir"' EXIT HUP INT TERM
docker --config "$docker_config_dir" compose \
  --env-file "$env_file" \
  -f "$repo_dir/compose.production.yaml" \
  pull bot

compose up -d --no-build --remove-orphans bot
compose ps

container_id=$(compose ps -q bot)
if [ -z "$container_id" ]; then
  echo "Bot container was not created" >&2
  exit 1
fi

attempt=1
while [ "$attempt" -le 18 ]; do
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")
  case "$health" in
    healthy)
      echo "Bot is healthy"
      exit 0
      ;;
    unhealthy | exited | dead)
      echo "Bot failed to become healthy (state: $health)" >&2
      compose logs --tail 80 bot >&2
      exit 1
      ;;
  esac
  sleep 5
  attempt=$((attempt + 1))
done

echo "Bot healthcheck timed out" >&2
compose logs --tail 80 bot >&2
exit 1
