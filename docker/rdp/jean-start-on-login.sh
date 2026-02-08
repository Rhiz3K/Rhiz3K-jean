#!/usr/bin/env bash

set -euo pipefail

if [ "${AUTO_START_JEAN:-1}" != "1" ]; then
  exit 0
fi

LOCK_FILE="/tmp/jean-dev.lock"

if command -v flock >/dev/null 2>&1; then
  flock -n "$LOCK_FILE" bash -lc '
  set -euo pipefail

  if pgrep -f "npm run tauri:dev" >/dev/null 2>&1; then
    exit 0
  fi

  if [ ! -d /workspace ]; then
    exit 1
  fi

  cd /workspace

  if [ ! -x node_modules/.bin/vite ]; then
    xfce4-terminal \
      --title="Jean Dev (install)" \
      --hold \
      --working-directory=/workspace \
      --command bash -lc "npm install"
  fi

  xfce4-terminal \
    --title="Jean Dev" \
    --hold \
    --working-directory=/workspace \
    --command bash -lc "npm run tauri:dev:rdp"
'
  exit 0
fi

# Fallback without flock: best-effort single-run per container boot
if [ -e "$LOCK_FILE" ]; then
  exit 0
fi

: > "$LOCK_FILE"

bash -lc '
  set -euo pipefail

  if pgrep -f "npm run tauri:dev" >/dev/null 2>&1; then
    exit 0
  fi

  if [ ! -d /workspace ]; then
    exit 1
  fi

  cd /workspace

  if [ ! -x node_modules/.bin/vite ]; then
    xfce4-terminal \
      --title="Jean Dev (install)" \
      --hold \
      --working-directory=/workspace \
      --command bash -lc "npm install"
  fi

  xfce4-terminal \
    --title="Jean Dev" \
    --hold \
    --working-directory=/workspace \
    --command bash -lc "npm run tauri:dev:rdp"
'
