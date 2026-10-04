#!/usr/bin/env bash
# Randomly SIGKILLs worker containers (and optionally the API) while a load test runs.
# Usage: bash scripts/chaos.sh [--api]
set -u

KILL_API=false
[[ "${1:-}" == "--api" ]] && KILL_API=true

log() { echo "[$(date '+%H:%M:%S')] $*"; }
pick() { local ids=("$@"); echo "${ids[$((RANDOM % ${#ids[@]}))]}"; }

trap 'log "chaos stopped"; exit 0' INT TERM

while true; do
  sleep $((20 + RANDOM % 41))

  service=worker
  if $KILL_API && (( RANDOM % 4 == 0 )); then service=api; fi

  ids=($(docker compose ps -q "$service"))
  if (( ${#ids[@]} == 0 )); then log "no running $service container"; continue; fi

  target=$(pick "${ids[@]}")
  log "SIGKILL $service ${target:0:12}"
  docker kill -s KILL "$target" > /dev/null
  sleep 3
  log "restarting $service ${target:0:12}"
  docker start "$target" > /dev/null
done
