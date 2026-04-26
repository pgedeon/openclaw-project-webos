#!/bin/bash
# Cron Health Check — scans recent log files for errors
# Run every 30 minutes from crontab
# Output: /root/.openclaw/workspace/logs/cron-health.json

LOGDIR="/root/.openclaw/workspace/logs"
OUTFILE="$LOGDIR/cron-health.json"
SINCE=$(date -d '30 minutes ago' '+%Y-%m-%d %H:%M' 2>/dev/null || date -v-30M '+%Y-%m-%d %H:%M')

ERRORS=0
WARNINGS=0
DETAILS="[]"

# Check each cron log for recent errors
for log in "$LOGDIR"/*.log; do
    name=$(basename "$log" .log)
    # Count errors in last 50 lines
    errs=$(tail -50 "$log" 2>/dev/null | grep -ci 'error\|failed\|fatal' || true)
    if [ "$errs" -gt 0 ]; then
        ERRORS=$((ERRORS + errs))
        last_err=$(tail -50 "$log" 2>/dev/null | grep -i 'error\|failed\|fatal' | tail -1 | head -c 200)
        # Append to details JSON array
        DETAILS=$(echo "$DETAILS" | python3 -c "
import sys, json
d = json.loads(sys.stdin.read())
d.append({'name': '$name', 'errors': $errs, 'last_error': '''$last_err'''})
print(json.dumps(d))
" 2>/dev/null || echo "$DETAILS")
    fi
done

# Write health report
python3 -c "
import json, datetime
health = {
    'timestamp': datetime.datetime.now().isoformat(),
    'status': 'error' if $ERRORS > 5 else ('warning' if $ERRORS > 0 else 'ok'),
    'total_errors': $ERRORS,
    'details': json.loads('''$DETAILS''')
}
print(json.dumps(health))
" > "$OUTFILE" 2>/dev/null

echo "Cron health check: $(cat $OUTFILE 2>/dev/null | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["status"])' 2>/dev/null || echo 'unknown')"
