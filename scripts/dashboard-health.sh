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
LOG_DIR="${DASHBOARD_LOG_DIR:-$WORKSPACE_ROOT/logs}"
LOG_FILE="${DASHBOARD_HEALTH_LOG_FILE:-$LOG_DIR/dashboard-health.log}"
SERVER_LOG_FILE="${DASHBOARD_SERVER_LOG_FILE:-$LOG_DIR/dashboard-server.log}"
PID_FILE="${DASHBOARD_PID_FILE:-$WORKSPACE_ROOT/.dashboard.pid}"
LEGACY_PID_FILE="${DASHBOARD_LEGACY_PID_FILE:-$REPO_ROOT/task-server.pid"

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

start_dashboard() {
    log "Starting dashboard server..."
    mkdir -p "$(dirname "$SERVER_LOG_FILE")" "$(dirname "$PID_FILE")" "$(dirname "$LEGACY_PID_FILE")"
    
    local pid=""
    
    # Use systemd-run to create a separate scope (survives gateway restarts)
    if command -v systemd-run >/dev/null 2>&1; then
        systemd-run --user --scope --unit=openclaw-dashboard \
            env PORT="$DASHBOARD_PORT" HOST="$HOST" OPENCLAW_WORKSPACE="$WORKSPACE_ROOT" \
            node "$DASHBOARD_SCRIPT" >> "$SERVER_LOG_FILE" 2>&1 < /dev/null &
        pid=$!
        log "Started with systemd-run (PID: $pid)"
    else
        # Fallback to setsid if systemd-run not available
        setsid env PORT="$DASHBOARD_PORT" HOST="$HOST" OPENCLAW_WORKSPACE="$WORKSPACE_ROOT" \
            node "$DASHBOARD_SCRIPT" >> "$SERVER_LOG_FILE" 2>&1 < /dev/null &
        pid=$!
        log "Started with setsid fallback (PID: $pid)"
    fi
    
    write_pid_files "$pid"
    sleep 2
    
    if check_health; then
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

    # Kill any process on the port
    local port_pid=$(ss -tlnp 2>/dev/null | grep ":$DASHBOARD_PORT " | grep -oP 'pid=\K[0-9]+')
    if [ -n "$port_pid" ]; then
        log "Killing orphan process on port $DASHBOARD_PORT (PID: $port_pid)"
        kill "$port_pid" 2>/dev/null
    fi
}

# Main health check logic
main() {
    mkdir -p "$(dirname "$LOG_FILE")"
    
    if ! is_running; then
        log "Dashboard not running on port $DASHBOARD_PORT"
        start_dashboard
        exit $?
    fi
    
    if ! check_health; then
        log "Dashboard not responding to health check"
        stop_dashboard
        start_dashboard
        exit $?
    fi
    
    # Healthy
    exit 0
}

# Handle command line arguments
case "${1:-check}" in
    check)
        main
        ;;
    start)
        mkdir -p "$(dirname "$LOG_FILE")"
        start_dashboard
        ;;
    stop)
        mkdir -p "$(dirname "$LOG_FILE")"
        stop_dashboard
        ;;
    status)
        if is_running && check_health; then
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
