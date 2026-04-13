#!/bin/bash
# Test Label Studio Connection
# =============================

set -e

LABEL_STUDIO_URL="${LABEL_STUDIO_URL:-http://localhost:8080}"

echo "🧪 Testing Label Studio Connection"
echo "===================================="
echo ""
echo "URL: $LABEL_STUDIO_URL"
echo ""

# Check if Label Studio is running
echo "1️⃣  Checking if Label Studio is accessible..."
if curl -s -f "$LABEL_STUDIO_URL/health" > /dev/null 2>&1; then
    echo "   ✅ Label Studio is running!"
else
    echo "   ❌ Label Studio is not accessible at $LABEL_STUDIO_URL"
    echo ""
    echo "   To start Label Studio:"
    echo "   - Docker: cd docker/label-studio && docker-compose up -d"
    echo "   - Standalone: label-studio start --port 8080"
    exit 1
fi

echo ""
echo "2️⃣  Checking version..."
VERSION=$(curl -s "$LABEL_STUDIO_URL/version" 2>/dev/null || echo "unknown")
echo "   Version: $VERSION"

echo ""
echo "3️⃣  Access Information:"
echo "   URL: $LABEL_STUDIO_URL"
echo "   Username: admin@wineops.ai"
echo "   Password: wineops2026"

echo ""
echo "✅ Label Studio is ready!"
echo ""
echo "Next steps:"
echo "1. Open $LABEL_STUDIO_URL in your browser"
echo "2. Log in with the credentials above"
echo "3. Create a new project: 'Wine Menu Extraction Review'"
echo "4. Configure labeling interface using docker/label-studio/wine_menu_config.xml"
echo "5. Start reviewing extractions!"
