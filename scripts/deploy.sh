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
