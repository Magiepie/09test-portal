#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"

for pid_file in data/server.pid data/portal.pid; do
  [[ -f "$pid_file" ]] || continue
  pid="$(cat "$pid_file")"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    echo "Stopped process $pid."
  fi
  rm -f "$pid_file"
done
