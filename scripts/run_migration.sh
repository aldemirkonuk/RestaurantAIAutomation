#!/bin/bash

# ============================================================================
# Run Supabase Migration Script
# ============================================================================
# This script helps you run the FULL_MIGRATIONS.sql in Supabase
#
# Usage:
#   ./scripts/run_migration.sh
#
# Or manually:
#   1. Open Supabase Dashboard → SQL Editor
#   2. Copy contents of md/02-architecture/FULL_MIGRATIONS.sql
#   3. Paste and Run
# ============================================================================

echo "🚀 Supabase Migration Helper"
echo "=============================="
echo ""
echo "This script will help you run the migration in Supabase."
echo ""
echo "📋 Steps:"
echo "1. Open your Supabase project dashboard"
echo "2. Go to SQL Editor (left sidebar)"
echo "3. Click 'New Query'"
echo "4. Copy the migration script"
echo "5. Paste and click 'Run'"
echo ""
echo "📁 Migration file location:"
echo "   md/02-architecture/FULL_MIGRATIONS.sql"
echo ""

# Check if migration file exists
MIGRATION_FILE="md/02-architecture/FULL_MIGRATIONS.sql"

if [ ! -f "$MIGRATION_FILE" ]; then
    echo "ℹ️ Migration file not found. Generating from migrations..."
    python3 scripts/concat_migrations.py
fi

if [ ! -f "$MIGRATION_FILE" ]; then
    echo "❌ Error: Migration file not found at $MIGRATION_FILE"
    exit 1
fi

echo "✅ Migration file found!"
echo ""
echo "Would you like to:"
echo "  [1] Open the migration file in your editor"
echo "  [2] Display the migration file contents"
echo "  [3] Copy migration file path to clipboard (macOS)"
echo "  [4] Just show instructions"
echo ""
read -p "Choose option (1-4): " choice

case $choice in
    1)
        # Open in default editor
        if command -v code &> /dev/null; then
            code "$MIGRATION_FILE"
        elif command -v nano &> /dev/null; then
            nano "$MIGRATION_FILE"
        else
            open "$MIGRATION_FILE"
        fi
        ;;
    2)
        echo ""
        echo "📄 Migration Script Contents:"
        echo "=============================="
        cat "$MIGRATION_FILE"
        ;;
    3)
        if [[ "$OSTYPE" == "darwin"* ]]; then
            echo "$(pwd)/$MIGRATION_FILE" | pbcopy
            echo "✅ File path copied to clipboard!"
        else
            echo "❌ Clipboard copy only works on macOS"
        fi
        ;;
    4)
        echo ""
        echo "📖 Manual Instructions:"
        echo "======================"
        echo ""
        echo "1. Go to: https://supabase.com/dashboard"
        echo "2. Select your project"
        echo "3. Click 'SQL Editor' in the left sidebar"
        echo "4. Click 'New Query' button"
echo "5. Copy the entire contents of: $MIGRATION_FILE"
        echo "6. Paste into the SQL Editor"
        echo "7. Click 'Run' button (or press Cmd/Ctrl + Enter)"
        echo "8. Wait for execution to complete (30-60 seconds)"
        echo ""
        echo "✅ Verification:"
        echo "After running, verify tables were created:"
        echo ""
        echo "SELECT table_name FROM information_schema.tables"
        echo "WHERE table_schema = 'public'"
        echo "AND table_name IN ('order_interactions', 'manager_preferences', 'unit_conversions', 'rfq_requests');"
        ;;
    *)
        echo "Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "✨ Done! Follow the steps above to run the migration in Supabase."

