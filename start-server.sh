#!/bin/bash
# Dashboard Task Server Startup Script
set -euo pipefail

export STORAGE_TYPE="${STORAGE_TYPE:-postgres}"
export POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
export POSTGRES_PORT="${POSTGRES_PORT:-5432}"
export POSTGRES_DB="${POSTGRES_DB:-openclaw_dashboard}"
export POSTGRES_USER="${POSTGRES_USER:-openclaw}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-openclaw_password}"
export PORT="${PORT:-3876}"
export HOST="${HOST:-127.0.0.1}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Starting Dashboard Task Server..."
echo "Database: $POSTGRES_DB"
echo "User: $POSTGRES_USER"
echo "Port: $PORT"

exec "$SCRIPT_DIR/scripts/restart-task-server.sh"
