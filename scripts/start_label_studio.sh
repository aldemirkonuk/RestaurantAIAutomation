#!/bin/bash
# Quick Start Label Studio for Wine Menu Review
# ==============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LABEL_STUDIO_DIR="$PROJECT_ROOT/docker/label-studio"

echo "🍷 WineOps Label Studio Setup"
echo "=============================="
echo ""

# Check if Docker is available
if command -v docker &> /dev/null && command -v docker-compose &> /dev/null; then
    echo "✅ Docker detected"
    echo ""
    echo "Starting Label Studio with Docker..."
    cd "$LABEL_STUDIO_DIR"
    docker-compose up -d
    
    echo ""
    echo "⏳ Waiting for Label Studio to start..."
    sleep 5
    
    echo ""
    echo "✅ Label Studio is running!"
    echo ""
    echo "📍 Access at: http://localhost:8080"
    echo "👤 Username: admin@wineops.ai"
    echo "🔑 Password: wineops2026"
    echo ""
    echo "📊 View logs: cd docker/label-studio && docker-compose logs -f"
    echo "🛑 Stop: cd docker/label-studio && docker-compose down"
    
else
    echo "⚠️  Docker not found. Installing Label Studio standalone..."
    echo ""
    
    # Check Python
    if ! command -v python3 &> /dev/null; then
        echo "❌ Python 3 is required but not found."
        exit 1
    fi
    
    # Install label-studio
    echo "📦 Installing label-studio..."
    pip install label-studio
    
    echo ""
    echo "🚀 Starting Label Studio..."
    echo ""
    echo "📍 Access at: http://localhost:8080"
    echo "👤 Create your account on first visit"
    echo ""
    echo "🛑 Stop: Press Ctrl+C"
    echo ""
    
    # Start in foreground
    label-studio start --port 8080
fi
