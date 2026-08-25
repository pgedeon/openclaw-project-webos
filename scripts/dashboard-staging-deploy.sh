#!/usr/bin/env bash
# dashboard-staging-deploy.sh — idempotent one-command deploy of this repo to the
# WebOS dashboard staging slot on the LAN dev machine (DEPLOY-POLICY.md Amendment 10).
#
# Staging slot (provisioned 2026-08-24):
#   host    : ssh dev (192.168.0.81, user pgedeon, key auth)
#   port    : 8120
#   URL     : http://192.168.0.81:8120/
#   webroot : ~/www/staging/openclaw-dashboard/
#   server  : ~/openclaw-dashboard-staging-server.js (launcher; loads webroot/.env,
#             then requires webroot/task-server.js)
#   keepalive: per-minute cron curl-or-restart on dev (same pattern as other slots)
#
# The script NEVER writes DASHBOARD_AUTH_TOKEN — the secret is provisioned once in
# webroot/.env and only verified here. Re-running is safe (rsync --delete protects
# .env via exclusion).
#
# Usage:
#   scripts/dashboard-staging-deploy.sh              # full deploy + verify
#   scripts/dashboard-staging-deploy.sh --skip-deps  # skip npm install on dev
#
# Env overrides:
#   DEV_HOST (default "dev"), DEV_ADDR (default "192.168.0.81"),
#   STAGING_PORT (default 8120)

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_HOST="${DEV_HOST:-dev}"
DEV_ADDR="${DEV_ADDR:-192.168.0.81}"
STAGING_PORT="${STAGING_PORT:-8120}"
WEBROOT="www/staging/openclaw-dashboard"
LAUNCHER="/home/pgedeon/openclaw-dashboard-staging-server.js"
LOGFILE="/home/pgedeon/openclaw-dashboard-staging.log"
SKIP_DEPS=0
[[ "${1:-}" == "--skip-deps" ]] && SKIP_DEPS=1

say() { printf '\n=== %s ===\n' "$*"; }

[[ -f "$REPO_DIR/task-server.js" ]] || { echo "FATAL: run from repo checkout (task-server.js not found at $REPO_DIR)" >&2; exit 1; }

say "1/6 rsync repo -> dev:$WEBROOT"
rsync -az --delete -e ssh \
  --exclude node_modules \
  --exclude .git \
  --exclude screenshots \
  --exclude test-results \
  --exclude playwright-report \
  --exclude data \
  --exclude .codex \
  --exclude .github \
  --exclude dist \
  --exclude .env \
  "$REPO_DIR/" "$DEV_HOST:$WEBROOT/"

say "2/6 workspace layout (UI symlink) + secrets check"
ssh "$DEV_HOST" "set -e
  cd ~/$WEBROOT
  mkdir -p workspace
  ln -sfn /home/pgedeon/$WEBROOT workspace/dashboard
  [[ -f workspace/tasks.md ]] || touch workspace/tasks.md
  grep -q '^DASHBOARD_AUTH_TOKEN=..' .env || {
    echo 'FATAL: webroot/.env missing or DASHBOARD_AUTH_TOKEN empty.' >&2
    echo 'Provision it once: PORT=$STAGING_PORT, HOST=0.0.0.0, STORAGE_TYPE=json_snapshot,' >&2
    echo 'DASHBOARD_AUTH_TOKEN=<fresh random>, OPENCLAW_WORKSPACE=/home/pgedeon/$WEBROOT/workspace' >&2
    exit 1
  }
  echo '.env OK'"

say "3/6 ensure launcher ($LAUNCHER)"
ssh "$DEV_HOST" "cat > $LAUNCHER <<'LAUNCHER_EOF'
#!/usr/bin/env node
// OpenClaw dashboard staging launcher — serves ~/www/staging/openclaw-dashboard on :$STAGING_PORT
// Loads .env from webroot, then starts task-server.js (Node API+UI server).
// LAN-only staging. Auth via DASHBOARD_AUTH_TOKEN (Bearer) on all /api/* except /api/health.
const fs = require(\"fs\");
const path = require(\"path\");
const ROOT = \"/home/pgedeon/$WEBROOT\";
const envPath = path.join(ROOT, \".env\");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, \"utf8\").split(/\\r?\\n/)) {
    const m = line.match(/^\\s*([A-Za-z0-9_]+)\\s*=\\s*(.*)\\s*\$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^[\"\\x27]|[\"\\x27]\$/g, \"\");
    }
  }
}
process.chdir(ROOT);
process.env.PORT = process.env.PORT || \"$STAGING_PORT\";
process.env.HOST = process.env.HOST || \"0.0.0.0\";
require(path.join(ROOT, \"task-server.js\"));
LAUNCHER_EOF
chmod +x $LAUNCHER"

if [[ $SKIP_DEPS -eq 0 ]]; then
  say "4/6 npm install --omit=dev (prod deps only, Chromium download skipped)"
  ssh "$DEV_HOST" "cd ~/$WEBROOT && PUPPETEER_SKIP_DOWNLOAD=true PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true npm install --omit=dev --no-audit --no-fund"
else
  say "4/6 skipped (--skip-deps)"
fi

say "5/6 restart staging server (SIGTERM+wait, detached successor, health gate)"
# Robust restart, all inside ONE ssh session (no gap for the per-minute keepalive
# cron to race into):
#   1. SIGTERM the old instance by PID and WAIT until it is gone (escalate to
#      SIGKILL after 10s) — never a blind sleep. Candidate PIDs from pgrep -f are
#      filtered to comm=node so the remote shell's own cmdline (which necessarily
#      contains the unbracketed launcher path in the nohup line below) can never
#      match-and-self-kill the session.
#   2. Start the successor fully detached from this SSH session (setsid + nohup +
#      stdin </dev/null, own appended log) so sshd teardown cannot take it down.
#   3. Gate on the health endpoint BEFORE the session closes: if the successor
#      never turns healthy the deploy FAILS HERE with the log tail printed, instead
#      of leaving staging dark while the script reports success.
# Re-runs stay safe: the stop step is pid-targeted and waits for actual exit.
ssh "$DEV_HOST" "set -e
  PAT='openclaw-dashboard-staging-serve[r]'
  OLD=''
  for p in \$(pgrep -f \"\$PAT\" || true); do
    if [[ \"\$(ps -o comm= -p \$p 2>/dev/null)\" == node ]]; then
      OLD=\"\$OLD \$p\"
    fi
  done
  if [[ -n \$OLD ]]; then
    echo \"stopping old instance(s):\$OLD\"
    kill \$OLD 2>/dev/null || true
    for i in \$(seq 1 20); do
      ALIVE=0
      for p in \$OLD; do
        if kill -0 \$p 2>/dev/null; then ALIVE=1; fi
      done
      if [[ \$ALIVE == 0 ]]; then break; fi
      sleep 0.5
    done
    ALIVE=0
    for p in \$OLD; do
      if kill -0 \$p 2>/dev/null; then ALIVE=1; fi
    done
    if [[ \$ALIVE == 1 ]]; then
      echo 'old instance ignored SIGTERM — escalating to SIGKILL' >&2
      kill -KILL \$OLD 2>/dev/null || true
      sleep 1
    fi
  fi
  nohup setsid node $LAUNCHER >> $LOGFILE 2>&1 < /dev/null &
  for i in \$(seq 1 30); do
    BODY=\$(curl -sf http://127.0.0.1:$STAGING_PORT/api/health 2>/dev/null || true)
    case \"\$BODY\" in *json_snapshot*) echo \"successor healthy (iteration \$i)\"; exit 0;; esac
    sleep 1
  done
  echo 'FATAL: successor never became healthy — last 20 log lines:' >&2
  tail -20 $LOGFILE >&2
  exit 1
"

say "6/6 health verification from $(hostname)"
HEALTH_OK=0
for i in $(seq 1 15); do
  BODY="$(curl -sf "http://$DEV_ADDR:$STAGING_PORT/api/health" 2>/dev/null || true)"
  if echo "$BODY" | grep -q '"storage_type":"json_snapshot"'; then
    HEALTH_OK=1
    break
  fi
  sleep 2
done
if [[ $HEALTH_OK -ne 1 ]]; then
  echo "FATAL: health check failed after 30s — see $LOGFILE on $DEV_HOST" >&2
  exit 1
fi

echo "$BODY"
UNAUTH_CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://$DEV_ADDR:$STAGING_PORT/api/tasks")"
TITLE="$(curl -s "http://$DEV_ADDR:$STAGING_PORT/" | grep -o '<title>[^<]*</title>' || true)"
NOINDEX="$(curl -sI "http://$DEV_ADDR:$STAGING_PORT/" | grep -i x-robots-tag || true)"

echo
echo "Staging URL : http://$DEV_ADDR:$STAGING_PORT/"
echo "Index       : ${TITLE:-<missing>}"
echo "Noindex     : ${NOINDEX:-<missing>}"
echo "Unauth /api/tasks : HTTP $UNAUTH_CODE (expect 401)"
[[ "$UNAUTH_CODE" == "401" ]] || { echo "FATAL: unauthenticated API did not return 401" >&2; exit 1; }
echo "Deploy complete."
