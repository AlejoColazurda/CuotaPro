#!/bin/bash
set -e

# RLS Integration Test Runner
# Runs pgTAP tests against a local Supabase instance

echo "=== CuotaPro RLS Integration Tests ==="

# Check if supabase CLI is available
if ! command -v supabase &> /dev/null; then
    echo "Error: supabase CLI not found"
    exit 1
fi

# Start Supabase local (if not already running)
echo "Starting Supabase local..."
supabase start || true

# Wait for database to be ready
echo "Waiting for database..."
sleep 5

# Get database connection string
DB_URL=$(supabase status --output json 2>/dev/null | grep -o '"DB_URL":"[^"]*"' | cut -d'"' -f4 || echo "postgresql://postgres:postgres@127.0.0.1:54322/postgres")

if [ -z "$DB_URL" ]; then
    DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
fi

echo "Database URL: ${DB_URL%@*}@***"

# Apply migrations
echo "Applying migrations..."
supabase db reset --debug 2>&1 | head -50

# Run pgTAP tests
echo "Running RLS tests..."
TEST_EXIT=0

for test_file in tests/rls/*.sql; do
    echo ""
    echo "=== Running: $test_file ==="
    if PGPASSWORD=postgres psql "$DB_URL" -f "$test_file" 2>&1; then
        echo "✓ $test_file passed"
    else
        echo "✗ $test_file failed"
        TEST_EXIT=1
    fi
done

# Stop Supabase
echo ""
echo "Stopping Supabase..."
supabase stop --no-backup 2>/dev/null || true

if [ $TEST_EXIT -eq 0 ]; then
    echo ""
    echo "=== All RLS tests passed! ==="
    exit 0
else
    echo ""
    echo "=== Some RLS tests failed ==="
    exit 1
fi
