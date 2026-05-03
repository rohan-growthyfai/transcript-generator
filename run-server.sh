#!/usr/bin/env bash
# Foreground runner for the node server. Used by launchd KeepAlive.
set -eu
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export PORT="${PORT:-5173}"
export YTDLP_PATH="${YTDLP_PATH:-$HOME/Library/Python/3.9/bin/yt-dlp}"
[ -d node_modules ] || /usr/local/bin/npm install --silent
exec /usr/local/bin/node "$DIR/server.js"
