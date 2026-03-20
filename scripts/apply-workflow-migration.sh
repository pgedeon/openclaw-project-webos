#!/bin/bash
# Apply workflow runs migration to the dashboard database

set -e

echo "🚀 Applying Workflow Runs Migration..."
echo ""

# Database connection details (same as task-server.js)
DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_NAME="${POSTGRES_DB:-openclaw_dashboard}"
DB_USER="${POSTGRES_USER:-openclaw}"
DB_PASSWORD="${POSTGRES_PASSWORD:-openclaw_password}"

# Migration file
MIGRATION_FILE="schema/migrations/001_add_workflow_runs.sql"

# Check if migration file exists
if [ ! -f "$MIGRATION_FILE" ]; then
    echo "❌ Migration file not found: $MIGRATION_FILE"
    exit 1
fi

echo "Database: $DB_NAME"
echo "Host: $DB_HOST:$DB_PORT"
echo "User: $DB_USER"
echo "Migration: $MIGRATION_FILE"
echo ""

# Check if psql is available
if ! command -v psql &> /dev/null; then
    echo "❌ psql not found. Please install PostgreSQL client."
    exit 1
fi

# Check database connection
echo "Testing database connection..."
if ! PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" &> /dev/null; then
    echo "❌ Cannot connect to database. Check your connection settings."
    echo ""
    echo "You may need to set environment variables:"
    echo "  export POSTGRES_HOST=localhost"
    echo "  export POSTGRES_PORT=5432"
    echo "  export POSTGRES_DB=openclaw_dashboard"
    echo "  export POSTGRES_USER=openclaw"
    echo "  export POSTGRES_PASSWORD=openclaw_password"
    exit 1
fi

echo "✅ Database connection successful"
echo ""

# Check if migration already applied
echo "Checking if migration already applied..."
if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "\d workflow_runs" &> /dev/null; then
    echo "⚠️  Table 'workflow_runs' already exists. Migration may have been applied."
    read -p "Do you want to proceed anyway? (y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Migration cancelled."
        exit 0
    fi
fi

# Apply migration
echo "Applying migration..."
echo ""

if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$MIGRATION_FILE"; then
    echo ""
    echo "✅ Migration applied successfully!"
    echo ""
    echo "New tables created:"
    echo "  - workflow_runs"
    echo "  - workflow_steps"
    echo "  - workflow_templates"
    echo ""
    echo "New views created:"
    echo "  - active_workflow_runs"
    echo "  - stuck_workflow_runs"
    echo ""
    echo "Default workflow templates inserted:"
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT name, display_name, category FROM workflow_templates ORDER BY name;"
    echo ""
    echo "Next steps:"
    echo "  1. Integrate workflow-runs-api.js into task-server.js"
    echo "  2. Restart the task server"
    echo "  3. Test the API endpoints"
else
    echo ""
    echo "❌ Migration failed!"
    exit 1
fi
