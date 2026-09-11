#!/bin/bash
set -euo pipefail

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3876}"
BASE_URL="http://$HOST:$PORT"
FS_CANARY_PATH="${FS_CANARY_PATH:-AGENTS.md}"

# Auth: task-server requires a Bearer token on all /api/* routes (except
# /api/health and /api/auth/self) when DASHBOARD_AUTH_TOKEN is set in the
# server environment. Mirror that contract: send the header when this side
# has a token, plain otherwise (dev servers may run token-less). Array form
# keeps the header a single argv word even when the token contains spaces.
AUTH_ARGS=()
if [ -n "${DASHBOARD_AUTH_TOKEN:-}" ]; then
  AUTH_ARGS=(-H "Authorization: Bearer $DASHBOARD_AUTH_TOKEN")
fi

json_get() {
  local key="$1"
  python3 -c '
import json
import sys

key = sys.argv[1]
data = json.load(sys.stdin)
value = data.get(key, "")
if isinstance(value, (dict, list)):
    print(json.dumps(value))
else:
    print(value)
' "$key"
}

timestamp="$(date +%s)"
project_name="Dashboard Smoke Test ${timestamp}"
project_description="Smoke test created at ${timestamp}"

health_json="$(curl -fsS --max-time 5 "${AUTH_ARGS[@]}" "$BASE_URL/api/health-status")"
health_status="$(printf '%s' "$health_json" | json_get status)"
echo "health_status=$health_status"

fs_read_json="$(curl -fsS --max-time 5 "${AUTH_ARGS[@]}" "$BASE_URL/api/fs/file?path=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$FS_CANARY_PATH")")"
fs_read_name="$(printf '%s' "$fs_read_json" | json_get name)"
if [ -z "$fs_read_name" ] || [ "$fs_read_name" = "null" ]; then
  echo "Filesystem API smoke test failed for $FS_CANARY_PATH"
  exit 1
fi
echo "filesystem_read=$fs_read_name"

create_payload="$(printf '{"name":"%s","description":"%s"}' "$project_name" "$project_description")"
create_json="$(curl -fsS --max-time 10 "${AUTH_ARGS[@]}" -X POST -H "Content-Type: application/json" -d "$create_payload" "$BASE_URL/api/projects")"
project_id="$(printf '%s' "$create_json" | json_get id)"

if [ -z "$project_id" ] || [ "$project_id" = "null" ]; then
  echo "Missing project id in create response"
  exit 1
fi

echo "created_project_id=$project_id"

curl -fsS --max-time 5 "${AUTH_ARGS[@]}" "$BASE_URL/api/projects/$project_id" >/dev/null
echo "get_project=ok"

curl -fsS --max-time 5 "${AUTH_ARGS[@]}" "$BASE_URL/api/projects" >/dev/null
echo "list_projects=ok"

# Schema-drift canaries: the two endpoints that silently 500'd for days on
# staging (2026-08-29 incident — missing migrations made listAllTasks filter
# on t.deleted_at and /api/spaces query a nonexistent workspaces table).
# Both must be HTTP 200 with a JSON body; a 500 here means schema drift.
curl -fsS --max-time 10 "${AUTH_ARGS[@]}" "$BASE_URL/api/tasks/all?limit=1" >/dev/null
echo "tasks_all=ok"

curl -fsS --max-time 10 "${AUTH_ARGS[@]}" "$BASE_URL/api/spaces" >/dev/null
echo "spaces=ok"

cleanup_result="skipped"
if curl -fsS --max-time 5 "${AUTH_ARGS[@]}" -X DELETE "$BASE_URL/api/projects/$project_id" >/dev/null; then
  cleanup_result="deleted"
fi
echo "cleanup=$cleanup_result"
echo "smoke_test=ok"
