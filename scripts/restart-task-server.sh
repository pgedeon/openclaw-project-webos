#!/bin/bash
# Restart the Project Dashboard task-server
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_WORKSPACE_ROOT="$(cd "$REPO_ROOT/.." && pwd)"

cd "$REPO_ROOT"

PORT="${PORT:-3876}"
HOST="${HOST:-127.0.0.1}"
WORKSPACE_ROOT="${OPENCLAW_WORKSPACE:-$DEFAULT_WORKSPACE_ROOT}"
PID_FILE="${DASHBOARD_PID_FILE:-$WORKSPACE_ROOT/.dashboard.pid}"
LEGACY_PID_FILE="${DASHBOARD_LEGACY_PID_FILE:-$REPO_ROOT/task-server.pid}"
SERVER_LOG_FILE="${DASHBOARD_SERVER_LOG_FILE:-$WORKSPACE_ROOT/logs/dashboard-server.log}"

mkdir -p "$(dirname "$SERVER_LOG_FILE")"

write_pid_files() {
  printf '%s\n' "$1" > "$PID_FILE"
  if [ "$LEGACY_PID_FILE" != "$PID_FILE" ]; then
    printf '%s\n' "$1" > "$LEGACY_PID_FILE"
  fi
}

clear_pid_files() {
  rm -f "$PID_FILE"
  if [ "$LEGACY_PID_FILE" != "$PID_FILE" ]; then
    rm -f "$LEGACY_PID_FILE"
  fi
}

find_port_pid() {
  local pid=""

  if command -v lsof >/dev/null 2>&1; then
    pid="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  fi

  if [ -z "$pid" ] && command -v fuser >/dev/null 2>&1; then
    pid="$(fuser -n tcp "$PORT" 2>/dev/null | awk '{print $1}' || true)"
  fi

  if [ -z "$pid" ]; then
    pid="$(ss -tlnp 2>/dev/null | sed -nE "s/.*:$PORT .*pid=([0-9]+).*/\\1/p" | head -n 1 || true)"
  fi

  if [ -z "$pid" ]; then
    pid="$(ps -eo pid=,comm=,args= | awk '$2 == "node" && $0 ~ /task-server\\.js/ { print $1; exit }' || true)"
  fi

  if [ -n "$pid" ]; then
    echo "$pid"
  fi
}

stop_pid() {
  local pid="$1"
  local label="$2"

  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi

  echo "Stopping $label (PID $pid)..."
  kill "$pid" 2>/dev/null || true

  for _ in 1 2 3 4 5; do
    sleep 1
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  done

  echo "$label did not exit after SIGTERM; forcing shutdown."
  kill -9 "$pid" 2>/dev/null || true
  sleep 1
}

# Stop existing server if running
PRIMARY_PID=""
if [ -f "$PID_FILE" ]; then
  PRIMARY_PID="$(cat "$PID_FILE")"
  stop_pid "$PRIMARY_PID" "task server"
fi

LEGACY_PID=""
if [ -f "$LEGACY_PID_FILE" ]; then
  LEGACY_PID="$(cat "$LEGACY_PID_FILE")"
  if [ -n "$LEGACY_PID" ] && [ "$LEGACY_PID" != "$PRIMARY_PID" ]; then
    stop_pid "$LEGACY_PID" "legacy task server"
  fi
fi

clear_pid_files

PORT_PID="$(find_port_pid || true)"
if [ -n "${PORT_PID:-}" ]; then
  stop_pid "$PORT_PID" "orphan task server on port $PORT"
fi

REMAINING_PORT_PID="$(find_port_pid || true)"
if [ -n "${REMAINING_PORT_PID:-}" ]; then
  echo "Port $PORT is still in use after shutdown attempt."
  tail -n 20 "$SERVER_LOG_FILE" || true
  exit 1
fi

# Start server in its own systemd scope to avoid being killed with gateway
echo "Starting task server..."
if command -v systemd-run >/dev/null 2>&1; then
  # Use systemd-run to create a separate scope (survives gateway restarts)
  systemd-run --user --scope --unit=openclaw-dashboard \
    env \
    PORT="$PORT" \
    HOST="$HOST" \
    OPENCLAW_WORKSPACE="$WORKSPACE_ROOT" \
    STORAGE_TYPE="${STORAGE_TYPE:-postgres}" \
    POSTGRES_HOST="${POSTGRES_HOST:-localhost}" \
    POSTGRES_PORT="${POSTGRES_PORT:-5432}" \
    POSTGRES_DB="${POSTGRES_DB:-openclaw_dashboard}" \
    POSTGRES_USER="${POSTGRES_USER:-openclaw}" \
    POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-openclaw_password}" \
    node task-server.js >> "$SERVER_LOG_FILE" 2>&1 &
  PID=$!
else
  # Fallback to nohup if systemd-run not available
  nohup env \
    PORT="$PORT" \
    HOST="$HOST" \
    OPENCLAW_WORKSPACE="$WORKSPACE_ROOT" \
    STORAGE_TYPE="${STORAGE_TYPE:-postgres}" \
    POSTGRES_HOST="${POSTGRES_HOST:-localhost}" \
    POSTGRES_PORT="${POSTGRES_PORT:-5432}" \
    POSTGRES_DB="${POSTGRES_DB:-openclaw_dashboard}" \
    POSTGRES_USER="${POSTGRES_USER:-openclaw}" \
    POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-openclaw_password}" \
    node task-server.js > "$SERVER_LOG_FILE" 2>&1 &
  PID=$!
fi

write_pid_files "$PID"
sleep 2

if ! kill -0 "$PID" 2>/dev/null; then
  echo "Task server failed to stay up."
  if grep -Eq 'listen EPERM|Operation not permitted' "$SERVER_LOG_FILE" 2>/dev/null; then
    echo "Start failed due to local bind restrictions. If this shell is sandboxed, stop retrying and restart the dashboard from an unsandboxed OpenClaw session."
  fi
  tail -n 20 "$SERVER_LOG_FILE" || true
  clear_pid_files
  exit 1
fi

if ! curl -fsS --max-time 5 "http://$HOST:$PORT/api/health" >/dev/null 2>&1; then
  echo "Task server started (PID $PID) but health check failed."
  tail -n 20 "$SERVER_LOG_FILE" || true
  exit 1
fi

echo "Task server started with PID $PID"
echo "Dashboard: http://$HOST:$PORT/"
