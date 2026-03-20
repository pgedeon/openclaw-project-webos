#!/bin/bash
# Test session binding workflow
API="http://localhost:3876"

echo "=== Testing Session Binding API ==="
echo ""

# 1. Create a workflow run with session
echo "1. Creating workflow run with session binding..."
RUN_RESPONSE=$(curl -s -X POST "$API/api/workflow-runs" \
  -H "Content-Type: application/json" \
  -d '{
    "workflow_type": "affiliate-article",
    "owner_agent_id": "test-agent",
    "input_payload": {"topic": "Test session binding"},
    "gateway_session_id": "test-session-001"
  }')

RUN_ID=$(echo "$RUN_RESPONSE" | jq -r '.id')
echo "   Created run: $RUN_ID"
echo ""

# 2. Check active sessions
echo "2. Checking active sessions..."
SESSIONS=$(curl -s "$API/api/sessions/active")
echo "$SESSIONS" | jq '.sessions[0]'
echo ""

# 3. Record heartbeat
echo "3. Recording session heartbeat..."
HEARTBEAT=$(curl -s -X POST "$API/api/sessions/test-session-001/heartbeat")
echo "   Updated runs: $(echo "$HEARTBEAT" | jq '.updated_runs')"
echo ""

# 4. Unbind session
echo "4. Unbinding session..."
UNBIND=$(curl -s -X POST "$API/api/workflow-runs/$RUN_ID/unbind-session")
echo "   Session active: $(echo "$UNBIND" | jq '.gateway_session_active')"
echo ""

# 5. Verify
echo "5. Verifying no active sessions..."
ACTIVE=$(curl -s "$API/api/sessions/active")
echo "   Active sessions: $(echo "$ACTIVE" | jq '.sessions | length')"
echo ""

echo "✅ Session binding test complete!"
