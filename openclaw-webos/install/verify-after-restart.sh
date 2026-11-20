#!/bin/bash
# Post-restart verification for openclaw-webos install (card 6add2b28).
# Runs detached so it survives the gateway restart that it triggers.
set -u
LOG=/root/.openclaw/workspace/dashboard/openclaw-webos/install/verify-2026-11-19.log
: > "$LOG"
say() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG"; }

say "=== pre-restart: plugin discovery ==="
timeout 120 openclaw plugins list 2>&1 | grep -i -A3 "openclaw-webos" >> "$LOG" || say "plugins list grep failed"

say "=== restarting openclaw-gateway.service ==="
systemctl restart openclaw-gateway.service
say "restart exit=$?"

for i in $(seq 1 60); do
  if curl -sk -o /dev/null -w '%{http_code}' --max-time 3 https://127.0.0.1:18789/openclaw/ 2>/dev/null | grep -qE '^(200|302|401)$'; then
    say "gateway HTTP up after ${i}s"
    break
  fi
  sleep 1
done

say "=== journal: plugin load lines ==="
journalctl -u openclaw-gateway.service --since "-3 min" --no-pager 2>/dev/null \
  | grep -iE "openclaw-webos|ERR_MODULE_NOT_FOUND|plugin.*(loaded|failed)" | tail -40 >> "$LOG"

say "=== journal: any module errors ==="
journalctl -u openclaw-gateway.service --since "-3 min" --no-pager 2>/dev/null \
  | grep -iE "ERR_MODULE_NOT_FOUND|Cannot find module|SyntaxError" | tail -20 >> "$LOG"

say "=== plugins list after restart ==="
timeout 120 openclaw plugins list 2>&1 | grep -i -A3 "openclaw-webos" >> "$LOG" || say "post plugins list grep failed"

say "=== control-ui tab projection (hello/controlUiTabs) ==="
timeout 60 openclaw plugins inspect openclaw-webos 2>&1 | head -60 >> "$LOG"

say "=== HTTP: /openclaw/ and /openclaw/desktop ==="
for p in /openclaw/ /openclaw/desktop; do
  code=$(curl -sk -o /tmp/webos-body-$(echo "$p" | tr '/' '_') -w '%{http_code}' --max-time 5 "https://127.0.0.1:18789$p")
  size=$(wc -c < /tmp/webos-body-$(echo "$p" | tr '/' '_'))
  say "GET $p -> $code (${size} bytes)"
done
say "byte-equality of /openclaw/ vs /openclaw/desktop bodies (expected equal):"
cmp -s /tmp/webos-body-_openclaw_ /tmp/webos-body-_openclaw_desktop && say "IDENTICAL (expected)" || say "DIFFERENT"

say "=== control-ui plugin catalog (revision + entryUrl) ==="
timeout 90 openclaw gateway call plugins.controlUi.list --json > /tmp/webos-catalog.json 2>>"$LOG"
python3 - <<'PYEOF' >> "$LOG" 2>&1
import json
c=json.load(open('/tmp/webos-catalog.json'))
for p in c.get('plugins',[]):
    print(p['pluginId'], p['revision'], p['entryUrl'])
print('diagnostics:', c.get('diagnostics'))
PYEOF

say "=== plugin asset route reachable (bearer auth) ==="
PW=$(python3 -c "import json;print(json.load(open('/root/.openclaw/openclaw.json'))['gateway']['auth']['password'])")
ENTRY=$(python3 -c "import json;c=json.load(open('/tmp/webos-catalog.json'));print([p['entryUrl'] for p in c['plugins'] if p['pluginId']=='openclaw-webos'][0])" 2>/dev/null)
say "entryUrl=$ENTRY"
if [ -n "$ENTRY" ]; then
  code=$(curl -sk -H "Authorization: Bearer $PW" -o /tmp/webos-asset.js -w '%{http_code}' --max-time 5 "https://127.0.0.1:18789$ENTRY")
  say "GET plugin entry asset -> $code ($(wc -c < /tmp/webos-asset.js) bytes)"
  head -c 200 /tmp/webos-asset.js >> "$LOG"; echo >> "$LOG"
fi

say "=== control-ui tab projection ==="
timeout 60 openclaw gateway call plugins.uiDescriptors --json 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('generation', d.get('generation'))
for t in d.get('controlUiTabs',[]): print('tab', t['pluginId'], t['id'], t.get('slug'))
" >> "$LOG" 2>&1

say "=== DONE ==="
