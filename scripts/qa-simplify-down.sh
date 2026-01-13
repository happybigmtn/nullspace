#!/bin/bash
set -euo pipefail

log() { printf "\033[1;31m[qa-simple-down]\033[0m %s\n" "$*"; }

log "Stopping website + localnet"

for pidfile in /tmp/qa-simple-website.pid /tmp/qa-simple-localnet.pid; do
  if [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile")
    kill "$pid" 2>/dev/null || true
    rm -f "$pidfile"
  fi
done

log "Done"
