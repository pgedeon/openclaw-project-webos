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
DASHBOARD_SYSTEMD_UNIT="${DASHBOARD_SYSTEMD_UNIT:-openclaw-dashboard}"
FS_PORT="${FILESYSTEM_API_PORT:-3880}"
FS_HOST="${FILESYSTEM_API_HOST:-127.0.0.1}"
FS_PID_FILE="${FILESYSTEM_API_PID_FILE:-$WORKSPACE_ROOT/.filesystem-api.pid}"
FS_SERVER_LOG_FILE="${FILESYSTEM_API_LOG_FILE:-$WORKSPACE_ROOT/logs/filesystem-api.log}"
FS_SERVER_SCRIPT="${FILESYSTEM_API_SCRIPT:-$REPO_ROOT/filesystem-api-server.mjs}"
FS_HEALTH_PATH="${FILESYSTEM_API_HEALTH_PATH:-/api/fs/file?path=AGENTS.md}"
FILESYSTEM_SYSTEMD_UNIT="${FILESYSTEM_SYSTEMD_UNIT:-openclaw-filesystem-api}"

mkdir -p "$(dirname "$SERVER_LOG_FILE")"
mkdir -p "$(dirname "$FS_SERVER_LOG_FILE")"

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

stop_systemd_unit() {
  local unit_base="$1"
  if ! command -v systemctl >/dev/null 2>&1; then
    return 0
  fi

  systemctl --user stop "${unit_base}.service" "${unit_base}.scope" >/dev/null 2>&1 || true
  systemctl --user reset-failed "${unit_base}.service" "${unit_base}.scope" >/dev/null 2>&1 || true
}

get_systemd_main_pid() {
  local unit_base="$1"
  local pid=""

  if ! command -v systemctl >/dev/null 2>&1; then
    return 0
  fi

  pid="$(systemctl --user show --property=MainPID --value "${unit_base}.service" 2>/dev/null | tr -d '[:space:]' || true)"
  if [ -n "$pid" ] && [ "$pid" != "0" ]; then
    echo "$pid"
  fi
}

find_port_pid() {
  local port="${1:-$PORT}"
  local pattern="${2:-task-server\\.js}"
  local pid=""

  if command -v lsof >/dev/null 2>&1; then
    pid="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  fi

  if [ -z "$pid" ] && command -v fuser >/dev/null 2>&1; then
    pid="$(fuser -n tcp "$port" 2>/dev/null | awk '{print $1}' || true)"
  fi

  if [ -z "$pid" ]; then
    pid="$(ss -tlnp 2>/dev/null | sed -nE "s/.*:$port .*pid=([0-9]+).*/\\1/p" | head -n 1 || true)"
  fi

  if [ -z "$pid" ]; then
    pid="$(ps -eo pid=,comm=,args= | awk -v pattern="$pattern" '$2 == "node" && $0 ~ pattern { print $1; exit }' || true)"
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
stop_systemd_unit "$DASHBOARD_SYSTEMD_UNIT"

PORT_PID="$(find_port_pid "$PORT" 'task-server\\.js' || true)"
if [ -n "${PORT_PID:-}" ]; then
  stop_pid "$PORT_PID" "orphan task server on port $PORT"
fi

REMAINING_PORT_PID="$(find_port_pid "$PORT" 'task-server\\.js' || true)"
if [ -n "${REMAINING_PORT_PID:-}" ]; then
  echo "Port $PORT is still in use after shutdown attempt."
  tail -n 20 "$SERVER_LOG_FILE" || true
  exit 1
fi

if [ -f "$FS_PID_FILE" ]; then
  FS_PID="$(cat "$FS_PID_FILE")"
  stop_pid "$FS_PID" "filesystem API"
fi
rm -f "$FS_PID_FILE"
stop_systemd_unit "$FILESYSTEM_SYSTEMD_UNIT"

FS_PORT_PID="$(find_port_pid "$FS_PORT" 'filesystem-api-server\\.mjs' || true)"
if [ -n "${FS_PORT_PID:-}" ]; then
  stop_pid "$FS_PORT_PID" "orphan filesystem API on port $FS_PORT"
fi

REMAINING_FS_PORT_PID="$(find_port_pid "$FS_PORT" 'filesystem-api-server\\.mjs' || true)"
if [ -n "${REMAINING_FS_PORT_PID:-}" ]; then
  echo "Port $FS_PORT is still in use after shutdown attempt."
  tail -n 20 "$FS_SERVER_LOG_FILE" || true
  exit 1
fi

# Start server in its own systemd scope to avoid being killed with gateway
echo "Starting task server..."
if command -v systemd-run >/dev/null 2>&1; then
  systemd-run --user \
    --unit="$DASHBOARD_SYSTEMD_UNIT" \
    --collect \
    --property="WorkingDirectory=$REPO_ROOT" \
    --property="StandardOutput=append:$SERVER_LOG_FILE" \
    --property="StandardError=append:$SERVER_LOG_FILE" \
    --setenv=PORT="$PORT" \
    --setenv=HOST="$HOST" \
    --setenv=OPENCLAW_WORKSPACE="$WORKSPACE_ROOT" \
    --setenv=STORAGE_TYPE="${STORAGE_TYPE:-postgres}" \
    --setenv=POSTGRES_HOST="${POSTGRES_HOST:-localhost}" \
    --setenv=POSTGRES_PORT="${POSTGRES_PORT:-5432}" \
    --setenv=POSTGRES_DB="${POSTGRES_DB:-openclaw_dashboard}" \
    --setenv=POSTGRES_USER="${POSTGRES_USER:-openclaw}" \
    --setenv=POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-openclaw_password}" \
    node task-server.js >/dev/null
  PID="$(get_systemd_main_pid "$DASHBOARD_SYSTEMD_UNIT" || true)"
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

if [ -n "${PID:-}" ]; then
  write_pid_files "$PID"
fi
sleep 2

if [ -n "${PID:-}" ] && ! kill -0 "$PID" 2>/dev/null; then
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

ACTUAL_PID="$(find_port_pid "$PORT" 'task-server\\.js' || true)"
if [ -n "${ACTUAL_PID:-}" ]; then
  write_pid_files "$ACTUAL_PID"
  PID="$ACTUAL_PID"
fi

echo "Starting filesystem API server..."
if command -v systemd-run >/dev/null 2>&1; then
  systemd-run --user \
    --unit="$FILESYSTEM_SYSTEMD_UNIT" \
    --collect \
    --property="WorkingDirectory=$REPO_ROOT" \
    --property="StandardOutput=append:$FS_SERVER_LOG_FILE" \
    --property="StandardError=append:$FS_SERVER_LOG_FILE" \
    --setenv=OPENCLAW_FS_ROOT="${OPENCLAW_FS_ROOT:-/root/.openclaw}" \
    --setenv=FILESYSTEM_API_PORT="$FS_PORT" \
    node "$FS_SERVER_SCRIPT" >/dev/null
  FS_PID="$(get_systemd_main_pid "$FILESYSTEM_SYSTEMD_UNIT" || true)"
else
  nohup env \
    OPENCLAW_FS_ROOT="${OPENCLAW_FS_ROOT:-/root/.openclaw}" \
    FILESYSTEM_API_PORT="$FS_PORT" \
    node "$FS_SERVER_SCRIPT" > "$FS_SERVER_LOG_FILE" 2>&1 &
  FS_PID=$!
fi

if [ -n "${FS_PID:-}" ]; then
  printf '%s\n' "$FS_PID" > "$FS_PID_FILE"
fi
sleep 2

if [ -n "${FS_PID:-}" ] && ! kill -0 "$FS_PID" 2>/dev/null; then
  echo "Filesystem API server failed to stay up."
  if grep -Eq 'listen EPERM|Operation not permitted' "$FS_SERVER_LOG_FILE" 2>/dev/null; then
    echo "Start failed due to local bind restrictions. If this shell is sandboxed, stop retrying and restart the dashboard from an unsandboxed OpenClaw session."
  fi
  tail -n 20 "$FS_SERVER_LOG_FILE" || true
  rm -f "$FS_PID_FILE"
  exit 1
fi

if ! curl -fsS --max-time 5 "http://$FS_HOST:$FS_PORT$FS_HEALTH_PATH" >/dev/null 2>&1; then
  echo "Filesystem API server started (PID $FS_PID) but health check failed."
  tail -n 20 "$FS_SERVER_LOG_FILE" || true
  exit 1
fi

ACTUAL_FS_PID="$(find_port_pid "$FS_PORT" 'filesystem-api-server\\.mjs' || true)"
if [ -n "${ACTUAL_FS_PID:-}" ]; then
  printf '%s\n' "$ACTUAL_FS_PID" > "$FS_PID_FILE"
  FS_PID="$ACTUAL_FS_PID"
fi

echo "Task server started with PID $PID"
echo "Filesystem API started with PID $FS_PID"
echo "Dashboard: http://$HOST:$PORT/"
