#!/bin/bash
# Dashboard Health Monitor
# Checks if the project dashboard is running and restarts if needed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_WORKSPACE_ROOT="$(cd "$REPO_ROOT/.." && pwd)"

DASHBOARD_PORT="${PORT:-3876}"
HOST="${HOST:-127.0.0.1}"
WORKSPACE_ROOT="${OPENCLAW_WORKSPACE:-$DEFAULT_WORKSPACE_ROOT}"
DASHBOARD_SCRIPT="${DASHBOARD_SCRIPT:-$REPO_ROOT/task-server.js}"
API_HEALTH_PATH="${DASHBOARD_HEALTH_PATH:-/api/health}"
DASHBOARD_HEALTH_URL="${DASHBOARD_HEALTH_URL:-http://$HOST:$DASHBOARD_PORT$API_HEALTH_PATH}"
FILESYSTEM_API_PORT="${FILESYSTEM_API_PORT:-3880}"
FILESYSTEM_API_HOST="${FILESYSTEM_API_HOST:-127.0.0.1}"
FILESYSTEM_API_HEALTH_PATH="${FILESYSTEM_API_HEALTH_PATH:-/api/fs/file?path=AGENTS.md}"
FILESYSTEM_API_HEALTH_URL="${FILESYSTEM_API_HEALTH_URL:-http://$FILESYSTEM_API_HOST:$FILESYSTEM_API_PORT$FILESYSTEM_API_HEALTH_PATH}"
FILESYSTEM_API_PID_FILE="${FILESYSTEM_API_PID_FILE:-$WORKSPACE_ROOT/.filesystem-api.pid}"
LOG_DIR="${DASHBOARD_LOG_DIR:-$WORKSPACE_ROOT/logs}"
LOG_FILE="${DASHBOARD_HEALTH_LOG_FILE:-$LOG_DIR/dashboard-health.log}"
SERVER_LOG_FILE="${DASHBOARD_SERVER_LOG_FILE:-$LOG_DIR/dashboard-server.log}"
PID_FILE="${DASHBOARD_PID_FILE:-$WORKSPACE_ROOT/.dashboard.pid}"
LEGACY_PID_FILE="${DASHBOARD_LEGACY_PID_FILE:-$REPO_ROOT/task-server.pid}"
RESTART_SCRIPT="${DASHBOARD_RESTART_SCRIPT:-$REPO_ROOT/scripts/restart-task-server.sh}"
DASHBOARD_SYSTEMD_UNIT="${DASHBOARD_SYSTEMD_UNIT:-openclaw-dashboard}"
FILESYSTEM_SYSTEMD_UNIT="${FILESYSTEM_SYSTEMD_UNIT:-openclaw-filesystem-api}"

log() {
    echo "[$(date -Iseconds)] $1" >> "$LOG_FILE"
}

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
    local port="${1:-$DASHBOARD_PORT}"
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
        pid="$(ps -eo pid=,comm=,args= | awk '$2 == "node" { print $1 " " $0 }' | awk -v port=":$port" '$0 ~ port { print $1; exit }' || true)"
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

    log "Stopping $label (PID: $pid)..."
    kill "$pid" 2>/dev/null || true

    for _ in 1 2 3 4 5; do
        sleep 1
        if ! kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
    done

    log "$label did not exit after SIGTERM; forcing shutdown"
    kill -9 "$pid" 2>/dev/null || true
    sleep 1
}

is_running() {
    # Check if port is listening
    if ss -tlnp 2>/dev/null | grep -q ":$DASHBOARD_PORT "; then
        return 0
    fi
    return 1
}

check_health() {
    # Try to connect to the dashboard
    if curl -fsS --max-time 5 "$DASHBOARD_HEALTH_URL" > /dev/null 2>&1; then
        return 0
    fi
    return 1
}

check_filesystem_health() {
    if curl -fsS --max-time 5 "$FILESYSTEM_API_HEALTH_URL" > /dev/null 2>&1; then
        return 0
    fi
    return 1
}

start_dashboard() {
    log "Starting dashboard server..."
    mkdir -p "$(dirname "$SERVER_LOG_FILE")" "$(dirname "$PID_FILE")" "$(dirname "$LEGACY_PID_FILE")"
    
    local pid=""
    
    # Use systemd-run to create a separate scope (survives gateway restarts)
    if command -v systemd-run >/dev/null 2>&1; then
        systemd-run --user \
            --unit="$DASHBOARD_SYSTEMD_UNIT" \
            --collect \
            --property="WorkingDirectory=$REPO_ROOT" \
            --property="StandardOutput=append:$SERVER_LOG_FILE" \
            --property="StandardError=append:$SERVER_LOG_FILE" \
            --setenv=PORT="$DASHBOARD_PORT" \
            --setenv=HOST="$HOST" \
            --setenv=OPENCLAW_WORKSPACE="$WORKSPACE_ROOT" \
            node "$DASHBOARD_SCRIPT" >/dev/null
        pid="$(get_systemd_main_pid "$DASHBOARD_SYSTEMD_UNIT" || true)"
        log "Started with systemd-run service (PID: ${pid:-unknown})"
    else
        # Fallback to setsid if systemd-run not available
        setsid env PORT="$DASHBOARD_PORT" HOST="$HOST" OPENCLAW_WORKSPACE="$WORKSPACE_ROOT" \
            node "$DASHBOARD_SCRIPT" >> "$SERVER_LOG_FILE" 2>&1 < /dev/null &
        pid=$!
        log "Started with setsid fallback (PID: $pid)"
    fi
    
    if [ -n "$pid" ]; then
        write_pid_files "$pid"
    fi
    sleep 2
    
    if check_health; then
        local actual_pid
        actual_pid="$(find_port_pid || true)"
        if [ -n "$actual_pid" ]; then
            write_pid_files "$actual_pid"
            pid="$actual_pid"
        fi
        log "Dashboard started successfully (PID: $pid)"
        return 0
    else
        log "ERROR: Failed to start dashboard"
        clear_pid_files
        return 1
    fi
}

stop_dashboard() {
    local primary_pid=""
    local legacy_pid=""

    if [ -f "$PID_FILE" ]; then
        primary_pid="$(cat "$PID_FILE")"
        if [ -n "$primary_pid" ]; then
            stop_pid "$primary_pid" "dashboard"
        fi
    fi

    if [ -f "$LEGACY_PID_FILE" ]; then
        legacy_pid="$(cat "$LEGACY_PID_FILE")"
        if [ -n "$legacy_pid" ] && [ "$legacy_pid" != "$primary_pid" ]; then
            stop_pid "$legacy_pid" "legacy dashboard"
        fi
    fi

    clear_pid_files
    stop_systemd_unit "$DASHBOARD_SYSTEMD_UNIT"

    # Kill any process on the port
    local port_pid
    port_pid="$(find_port_pid "$DASHBOARD_PORT" || true)"
    if [ -n "$port_pid" ]; then
        log "Killing orphan process on port $DASHBOARD_PORT (PID: $port_pid)"
        kill "$port_pid" 2>/dev/null
    fi

    local filesystem_pid=""
    if [ -f "$FILESYSTEM_API_PID_FILE" ]; then
        filesystem_pid="$(cat "$FILESYSTEM_API_PID_FILE")"
        if [ -n "$filesystem_pid" ]; then
            stop_pid "$filesystem_pid" "filesystem API"
        fi
    fi
    rm -f "$FILESYSTEM_API_PID_FILE"
    stop_systemd_unit "$FILESYSTEM_SYSTEMD_UNIT"

    local filesystem_port_pid
    filesystem_port_pid="$(find_port_pid "$FILESYSTEM_API_PORT" || true)"
    if [ -n "$filesystem_port_pid" ]; then
        log "Killing orphan filesystem API on port $FILESYSTEM_API_PORT (PID: $filesystem_port_pid)"
        kill "$filesystem_port_pid" 2>/dev/null
    fi
}

# Main health check logic
main() {
    mkdir -p "$(dirname "$LOG_FILE")"
    
    if ! is_running; then
        log "Dashboard not running on port $DASHBOARD_PORT"
        bash "$RESTART_SCRIPT"
        exit $?
    fi
    
    if ! check_health; then
        log "Dashboard not responding to health check"
        bash "$RESTART_SCRIPT"
        exit $?
    fi

    if ! check_filesystem_health; then
        log "Filesystem API not responding to health check"
        bash "$RESTART_SCRIPT"
        exit $?
    fi
    
    # Healthy
    echo "$(date -Iseconds) dashboard-health OK"
    exit 0
}

# Handle command line arguments
case "${1:-check}" in
    check)
        main
        echo "$(date -Iseconds) dashboard-health check completed"
        ;;
    start)
        mkdir -p "$(dirname "$LOG_FILE")"
        bash "$RESTART_SCRIPT"
        ;;
    stop)
        mkdir -p "$(dirname "$LOG_FILE")"
        stop_dashboard
        ;;
    status)
        if is_running && check_health && check_filesystem_health; then
            echo "Dashboard is healthy"
            exit 0
        else
            echo "Dashboard is down"
            exit 1
        fi
        ;;
    *)
        echo "Usage: $0 {check|start|stop|status}"
        exit 1
        ;;
esac
