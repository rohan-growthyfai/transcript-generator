#!/usr/bin/env bash
# Start the transcript generator locally and expose it via a Cloudflare Quick Tunnel.
# Usage: ./start.sh
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

PORT="${PORT:-5173}"
export YTDLP_PATH="${YTDLP_PATH:-$HOME/Library/Python/3.9/bin/yt-dlp}"

# install node deps if missing
[ -d node_modules ] || npm install --silent

# kill previous instances
pkill -f "node server.js" 2>/dev/null || true
pkill -f "cloudflared tunnel" 2>/dev/null || true
sleep 1

# start server in background
PORT="$PORT" nohup node server.js > /tmp/tg.log 2>&1 &
echo "server pid $! on :$PORT"

# start tunnel
"$DIR/bin/cloudflared" tunnel --url "http://localhost:$PORT" --no-autoupdate > /tmp/tg-tunnel.log 2>&1 &
echo "tunnel pid $!"

# Wait for URL
for i in {1..30}; do
  sleep 1
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/tg-tunnel.log | head -1 || true)
  [ -n "${URL:-}" ] && { echo "PUBLIC URL: $URL"; exit 0; }
done
echo "Tunnel did not produce a URL in time; see /tmp/tg-tunnel.log"
exit 1
