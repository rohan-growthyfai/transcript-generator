#!/usr/bin/env bash
# Foreground runner for cloudflared Quick Tunnel.
# Captures the issued *.trycloudflare.com URL into ./current-url.txt as soon as it appears.
# Self-heals: if the tunnel can't serve traffic for ~4 minutes, exits non-zero so launchd
# respawns it with a fresh quick tunnel.
#
# Health check uses DoH-resolved IP via curl --resolve to bypass macOS local DNS quirks
# with brand-new trycloudflare subdomains.
set -eu
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
PORT="${PORT:-5173}"
URL_FILE="$DIR/current-url.txt"
LOG="$DIR/logs/tunnel.log"
mkdir -p "$DIR/logs"
: > "$LOG"
: > "$URL_FILE"

# DoH resolver via Cloudflare 1.1.1.1
doh_resolve() {
  local host="$1"
  /usr/bin/curl -fsS --max-time 6 \
    -H 'accept: application/dns-json' \
    "https://1.1.1.1/dns-query?name=$host&type=A" 2>/dev/null \
    | /usr/bin/python3 -c "
import json,sys
try:
  d = json.load(sys.stdin)
  for a in (d.get('Answer') or []):
    if a.get('type') == 1:
      print(a['data']); break
except Exception:
  pass
" 2>/dev/null
}

healthy() {
  local url="$1"
  local host="${url#https://}"
  host="${host%%/*}"
  local ip
  ip="$(doh_resolve "$host")"
  [ -z "${ip:-}" ] && return 1
  /usr/bin/curl -fsS --max-time 10 \
    --resolve "${host}:443:${ip}" \
    "${url}/api/health" > /dev/null 2>&1
}

# Wait briefly for the local server to come up
for i in $(seq 1 60); do
  if /usr/bin/curl -fsS --max-time 1 "http://localhost:$PORT/api/health" > /dev/null 2>&1; then break; fi
  /bin/sleep 1
done

# Start cloudflared in the background.
"$DIR/bin/cloudflared" tunnel --url "http://localhost:$PORT" --no-autoupdate >> "$LOG" 2>&1 &
CFD_PID=$!
trap 'kill -TERM $CFD_PID 2>/dev/null || true; wait $CFD_PID 2>/dev/null || true' EXIT TERM INT

last_ok=$(/bin/date +%s)
url=""
while kill -0 "$CFD_PID" 2>/dev/null; do
  /bin/sleep 5
  newurl=$(/usr/bin/grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | tail -1 || true)
  if [ -n "${newurl:-}" ] && [ "$newurl" != "$url" ]; then
    url="$newurl"
    printf '%s\n' "$url" > "$URL_FILE"
    last_ok=$(/bin/date +%s)
  fi
  if [ -n "$url" ]; then
    if healthy "$url"; then
      last_ok=$(/bin/date +%s)
    else
      now=$(/bin/date +%s)
      if [ $((now - last_ok)) -gt 240 ]; then
        echo "[watchdog] tunnel unhealthy for >240s — restarting cloudflared" >> "$LOG"
        kill -TERM "$CFD_PID" 2>/dev/null || true
        wait "$CFD_PID" 2>/dev/null || true
        : > "$URL_FILE"
        exit 1
      fi
    fi
  fi
done
exit 1
