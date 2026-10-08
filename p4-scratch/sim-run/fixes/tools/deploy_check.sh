#!/usr/bin/env bash
# deploy_check.sh <web-needle|-> : prints gateway commit/bootedAt and whether mudavym.com's
# JS chunks contain <web-needle> (fixed string). Pass - to skip the web check.
needle="$1"
curl -s --max-time 20 https://wineopsapi-gateway-production.up.railway.app/api/v1/health/live | python3 -c 'import json,sys; j=json.load(sys.stdin); print("gateway", j.get("commit") or j.get("version"), j.get("bootedAt"))' 2>/dev/null || echo "gateway: no answer"
[ "$needle" = "-" ] && exit 0
d=$(mktemp -d); curl -s --max-time 20 https://mudavym.com/ -o $d/index.html
entry=$(grep -o '/assets/index-[A-Za-z0-9_-]*\.js' $d/index.html | head -1); echo "entry $entry"
curl -s --max-time 30 "https://mudavym.com$entry" -o $d/entry.js
chunks=$(grep -o 'assets/[A-Za-z0-9_.-]*\.js' $d/entry.js | sort -u)
hit=""; grep -qF -- "$needle" $d/entry.js && hit="$entry"
for c in $chunks; do curl -s --max-time 30 "https://mudavym.com/$c" -o $d/c.js; grep -qF -- "$needle" $d/c.js && hit="$hit $c"; done
[ -n "$hit" ] && echo "WEB HAS needle in:$hit" || echo "WEB LACKS needle ($(echo $chunks | wc -w) chunks scanned)"
