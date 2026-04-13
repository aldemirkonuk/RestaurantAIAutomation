#!/bin/bash

# Quick status check for Agent Orchestrator

echo "🔍 Checking Agent Orchestrator Status"
echo "======================================"
echo ""

# Check if server is running
if curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo "✅ Server is running on http://localhost:8000"
    echo ""
    echo "📊 Health Status:"
    curl -s http://localhost:8000/health | python3 -m json.tool 2>/dev/null || curl -s http://localhost:8000/health
    echo ""
    echo "🤖 Agent Status:"
    curl -s http://localhost:8000/health/agents | python3 -m json.tool 2>/dev/null || curl -s http://localhost:8000/health/agents
    echo ""
    echo "📚 API Docs: http://localhost:8000/docs"
else
    echo "❌ Server is not running"
    echo ""
    echo "To start the server:"
    echo "  cd services/agent-orchestrator"
    echo "  source venv/bin/activate"
    echo "  uvicorn main:app --reload --host 0.0.0.0 --port 8000"
fi

