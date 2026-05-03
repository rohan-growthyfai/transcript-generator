#!/usr/bin/env bash
# Foreground runner for cloudflared Quick Tunnel.
# Captures the issued *.trycloudflare.com URL into ./current-url.txt as soon as it appears.
# launchd KeepAlive will respawn this if cloudflared exits — a new URL is then issued.
set -eu
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
PORT="${PORT:-5173}"
URL_FILE="$DIR/current-url.txt"
LOG="$DIR/logs/tunnel.log"
mkdir -p "$DIR/logs"

# Wait briefly for the server to be up before starting the tunnel.
for i in $(seq 1 60); do
  if /usr/bin/curl -fsS --max-time 1 "http://localhost:$PORT/api/health" > /dev/null 2>&1; then break; fi
  sleep 1
done

# Start cloudflared, tee output to log, watch for URL.
"$DIR/bin/cloudflared" tunnel --url "http://localhost:$PORT" --no-autoupdate 2>&1 \
  | while IFS= read -r line; do
      printf '%s\n' "$line" >> "$LOG"
      url=$(printf '%s' "$line" | /usr/bin/grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | head -1 || true)
      if [ -n "${url:-}" ]; then
        printf '%s\n' "$url" > "$URL_FILE"
      fi
    done
