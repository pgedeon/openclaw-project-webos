#!/bin/bash
# Integrate workflow-runs-api.js into task-server.js

set -e

echo "🔧 Integrating Workflow Runs API into task-server.js..."
echo ""

TASK_SERVER="task-server.js"
BACKUP="task-server.js.backup-before-workflow-integration"

# Check if file exists
if [ ! -f "$TASK_SERVER" ]; then
    echo "❌ task-server.js not found"
    exit 1
fi

# Create backup
if [ ! -f "$BACKUP" ]; then
    cp "$TASK_SERVER" "$BACKUP"
    echo "✅ Backup created: $BACKUP"
fi

# Step 1: Add import after the http module
echo "Step 1: Adding workflow-runs-api import..."
sed -i '21 a\\nconst { createWorkflowRunsHandler } = require('\''./workflow-runs-api.js'\'');' "$TASK_SERVER"
echo "✅ Import added"

# Step 2: Add handler initialization after asanaStorage initialization
# Find the line with "console.log('✅ Asana PostgreSQL storage initialized');"
# and add the workflow handler init after the try-catch block
echo "Step 2: Adding workflow handler initialization..."

# Create a temporary file with the new code
cat > /tmp/workflow_init.txt << 'EOF'

  // Initialize workflow runs handler
  if (asanaStorage && asanaStorage.pool) {
    try {
      workflowRunsHandler = createWorkflowRunsHandler(asanaStorage.pool);
      console.log('✅ Workflow runs API handler initialized');
    } catch (err) {
      console.error('⚠️  Failed to initialize workflow runs handler:', err.message);
    }
  }
}

let workflowRunsHandler = null;

async function initAsanaStorage() {
EOF

# Replace the function signature and add initialization after it
sed -i '/^async function initAsanaStorage() {$/,/^}$/{ 
    /^}$/r /tmp/workflow_init.txt
}' "$TASK_SERVER"

echo "✅ Handler initialization added"

# Step 3: Add handler call in request handler
# Find a good place to add it - after parseJSONBody for POST/PATCH
echo "Step 3: Adding handler call in request handler..."

# Find the line after "body = await parseJSONBody(req);" and add handler call
sed -i '/body = await parseJSONBody(req);/a\
      \
      // Workflow runs API\
      if (workflowRunsHandler) {\
        const handled = await workflowRunsHandler(req, res, url, body);\
        if (handled) return;\
      }' "$TASK_SERVER"

echo "✅ Handler call added"

echo ""
echo "✅ Integration complete!"
echo ""
echo "Changes made:"
echo "  1. Added workflow-runs-api import"
echo "  2. Added handler initialization after asanaStorage"
echo "  3. Added handler call in request handler"
echo ""
echo "Next steps:"
echo "  1. Review the changes in task-server.js"
echo "  2. Restart the task server"
echo "  3. Run test-workflow-api.js"
