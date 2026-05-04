#!/usr/bin/env bash
# Watches current-url.txt and pushes the latest URL to GitHub so that
# the GitHub Pages redirect (https://rohan-growthyfai.github.io/transcript-generator/)
# always sends visitors to the current Cloudflare Quick Tunnel URL.
#
# Health-check uses DoH-resolved IP via curl --resolve, so a stale local DNS
# cache (a known macOS quirk with fresh trycloudflare subdomains) never blocks
# publishing.
set -eu
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Users/rohanmote/.local/bin:$PATH"

URL_FILE="$DIR/current-url.txt"
PUB_FILE="$DIR/docs/current-url.txt"

# Resolve a hostname to an IPv4 via Cloudflare DNS-over-HTTPS (bypasses local resolver).
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

# Check tunnel health using DoH-resolved IP. Returns 0 if healthy.
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

last_pushed=""
while true; do
  if [ -s "$URL_FILE" ]; then
    cur=$(/usr/bin/tr -d '\n\r ' < "$URL_FILE")
    if [ -n "$cur" ] && [ "$cur" != "$last_pushed" ]; then
      if healthy "$cur"; then
        printf '%s\n' "$cur" > "$PUB_FILE"
        if /Users/rohanmote/.local/bin/gh auth status > /dev/null 2>&1; then
          /usr/bin/git -C "$DIR" add docs/current-url.txt > /dev/null 2>&1 || true
          if ! /usr/bin/git -C "$DIR" diff --cached --quiet -- docs/current-url.txt 2>/dev/null; then
            /usr/bin/git -C "$DIR" \
              -c user.email=iamrohitmote@gmail.com -c user.name="Rohan" \
              commit -q -m "Update tunnel URL: $cur" -- docs/current-url.txt 2>/dev/null || true
            /usr/bin/git -C "$DIR" push -q origin main 2>/dev/null || true
            last_pushed="$cur"
          fi
        fi
      fi
    fi
  fi
  /bin/sleep 10
done
