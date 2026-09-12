#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
env_file=${ENV_FILE:-/etc/bot-platform/bots/telegram-service-bot.env}

docker compose --env-file "$env_file" -f "$repo_dir/compose.production.yaml" ps
docker compose --env-file "$env_file" -f "$repo_dir/compose.production.yaml" logs --tail=100 bot
