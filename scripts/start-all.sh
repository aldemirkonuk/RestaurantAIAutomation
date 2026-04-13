#!/bin/bash

echo "🍷 Starting WineOps AI Services..."

# Start Docker containers
echo "📦 Starting Docker containers..."
docker-compose up -d

# Wait for containers to be ready
echo "⏳ Waiting for containers to initialize..."
sleep 10

# Start API Gateway (in background)
echo "🚀 Starting API Gateway..."
cd apps/api-gateway && npm run start:dev &

# Start Agent Orchestrator (in background)
echo "🤖 Starting Agent Orchestrator..."
cd ../../services/agent-orchestrator && python -m uvicorn main:app --reload --port 8000 &

# Start Frontend
echo "🎨 Starting Frontend..."
cd ../../apps/web && npm run dev

echo "✅ All services started!"
echo "Frontend: http://localhost:3000"
echo "API Gateway: http://localhost:4000"
echo "Agent Orchestrator: http://localhost:8000"
