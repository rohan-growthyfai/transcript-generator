#!/usr/bin/env bash
# Watches current-url.txt and pushes the latest URL to GitHub so that
# the GitHub Pages redirect (https://rohan-growthyfai.github.io/transcript-generator/)
# always sends visitors to the current Cloudflare Quick Tunnel URL.
set -eu
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Users/rohanmote/.local/bin:$PATH"

URL_FILE="$DIR/current-url.txt"
PUB_FILE="$DIR/docs/current-url.txt"

last_pushed=""
while true; do
  if [ -s "$URL_FILE" ]; then
    cur=$(tr -d '\n\r ' < "$URL_FILE")
    if [ -n "$cur" ] && [ "$cur" != "$last_pushed" ]; then
      # Verify the tunnel is actually serving before publishing
      if /usr/bin/curl -fsS --max-time 8 "$cur/api/health" > /dev/null 2>&1; then
        printf '%s\n' "$cur" > "$PUB_FILE"
        if /Users/rohanmote/.local/bin/gh auth status > /dev/null 2>&1; then
          /usr/bin/git -C "$DIR" add docs/current-url.txt > /dev/null 2>&1 || true
          if ! /usr/bin/git -C "$DIR" diff --cached --quiet -- docs/current-url.txt 2>/dev/null; then
            /usr/bin/git -C "$DIR" -c user.email=iamrohitmote@gmail.com -c user.name="Rohan" \
              commit -q -m "Update tunnel URL: $cur" -- docs/current-url.txt 2>/dev/null || true
            /usr/bin/git -C "$DIR" push -q origin main 2>/dev/null || true
            last_pushed="$cur"
          fi
        fi
      fi
    fi
  fi
  sleep 15
done
