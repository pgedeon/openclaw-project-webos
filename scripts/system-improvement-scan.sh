#!/usr/bin/env bash
# system-improvement-scan.sh
#
# Periodic system improvement scan.
# Creates a workflow run for the main agent to:
#   1. Scan current system state
#   2. Identify improvement opportunities
#   3. Create approval-gated child runs for operator review
#
# Cron: Run 1x daily at 08:00
#   0 8 * * * /path/to/scripts/system-improvement-scan.sh

set -euo pipefail

DASHBOARD_API="${DASHBOARD_API_BASE:-http://127.0.0.1:3876}"
LOG_DIR="/tmp/openclaw-logs"
LOG_FILE="$LOG_DIR/system-improvement-scan.log"

mkdir -p "$LOG_DIR"

log() { echo "[$(date -Iseconds)] $*" >> "$LOG_FILE"; }

# Check if a scan is already active (no more than 1 concurrent)
ACTIVE=$(curl -sfS "$DASHBOARD_API/api/workflow-runs/active?template=system-improvement-scan&limit=1" 2>/dev/null \
  | python3 -c "import sys,json; r=json.load(sys.stdin); runs=r.get('workflow_runs',r) if isinstance(r,dict) else r; print(len(runs) if runs else 0)" 2>/dev/null \
  || echo "0")

if [ "$ACTIVE" -gt 0 ]; then
  log "SKIP: Scan already active"
  exit 0
fi

# Check if we ran in the last 20 hours (avoid double-runs)
RECENT=$(curl -sfS "$DASHBOARD_API/api/workflow-runs?template=system-improvement-scan&status=completed&limit=1" 2>/dev/null \
  | python3 -c "
import sys, json
from datetime import datetime, timedelta
r = json.load(sys.stdin)
runs = r.get('workflow_runs', r) if isinstance(r, dict) else r
if not runs:
    print('0')
    exit()
last = runs[0].get('finished_at') or runs[0].get('updated_at')
if last:
    dt = datetime.fromisoformat(last.replace('Z','+00:00'))
    age = (datetime.now(dt.tzinfo) - dt).total_seconds()
    print('1' if age < 72000 else '0')
else:
    print('0')
" 2>/dev/null || echo "0")

if [ "$RECENT" = "1" ]; then
  log "SKIP: Completed scan less than 20 hours ago"
  exit 0
fi

# Create the workflow run
RESULT=$(curl -sfS -X POST "$DASHBOARD_API/api/workflow-runs" \
  -H "Content-Type: application/json" \
  -d '{
    "workflow_type": "system-improvement-scan",
    "title": "System Improvement Scan",
    "input": {
      "scan_areas": [
        "artifact_contracts",
        "workflow_health",
        "cron_health",
        "site_health",
        "template_coverage",
        "approval_gaps"
      ],
      "max_suggestions": 10
    },
    "priority": "medium",
    "auto_start": true
  }' 2>&1)

RUN_ID=$(echo "$RESULT" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('id','unknown'))" 2>/dev/null)

if [ "$RUN_ID" = "unknown" ] || [ -z "$RUN_ID" ]; then
  log "FAIL: Could not create workflow run: $RESULT"
  exit 1
fi

log "CREATED: System improvement scan run $RUN_ID"
