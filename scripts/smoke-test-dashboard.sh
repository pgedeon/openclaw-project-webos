#!/bin/bash
set -euo pipefail

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3876}"
BASE_URL="http://$HOST:$PORT"

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

health_json="$(curl -fsS --max-time 5 "$BASE_URL/api/health-status")"
health_status="$(printf '%s' "$health_json" | json_get status)"
echo "health_status=$health_status"

create_payload="$(printf '{"name":"%s","description":"%s"}' "$project_name" "$project_description")"
create_json="$(curl -fsS --max-time 10 -X POST -H "Content-Type: application/json" -d "$create_payload" "$BASE_URL/api/projects")"
project_id="$(printf '%s' "$create_json" | json_get id)"

if [ -z "$project_id" ] || [ "$project_id" = "null" ]; then
  echo "Missing project id in create response"
  exit 1
fi

echo "created_project_id=$project_id"

curl -fsS --max-time 5 "$BASE_URL/api/projects/$project_id" >/dev/null
echo "get_project=ok"

curl -fsS --max-time 5 "$BASE_URL/api/projects" >/dev/null
echo "list_projects=ok"

cleanup_result="skipped"
if curl -fsS --max-time 5 -X DELETE "$BASE_URL/api/projects/$project_id" >/dev/null; then
  cleanup_result="deleted"
fi
echo "cleanup=$cleanup_result"
echo "smoke_test=ok"
