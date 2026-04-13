#!/bin/bash

# WineOps AI - Start All Services Script
# This script starts all backend and frontend services

set -e

echo "🍷 Starting WineOps AI Services..."
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Docker is not running. Please start Docker Desktop first.${NC}"
    echo -e "${YELLOW}   Docker services (PostgreSQL, RabbitMQ, Redis) will not start.${NC}"
    echo ""
    read -p "Continue without Docker? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo -e "${GREEN}✓ Docker is running${NC}"
    echo "Starting Docker services..."
    docker-compose up -d
    echo ""
fi

# Start API Gateway (NestJS)
echo -e "${GREEN}Starting API Gateway (NestJS)...${NC}"
cd apps/api-gateway
pnpm install --silent
pnpm start:dev &
API_GATEWAY_PID=$!
echo "API Gateway started (PID: $API_GATEWAY_PID)"
cd ../..
echo ""

# Wait a bit for API Gateway to start
sleep 3

# Start Agent Orchestrator (FastAPI)
echo -e "${GREEN}Starting Agent Orchestrator (FastAPI)...${NC}"
cd services/agent-orchestrator

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment and install dependencies
source venv/bin/activate
pip install -q -r requirements.txt

# Start FastAPI server
uvicorn main:app --reload --host 0.0.0.0 --port 8000 &
ORCHESTRATOR_PID=$!
echo "Agent Orchestrator started (PID: $ORCHESTRATOR_PID)"
cd ../..
echo ""

# Wait a bit for orchestrator to start
sleep 3

# Start Frontend (React/Vite)
echo -e "${GREEN}Starting Frontend (React/Vite)...${NC}"
cd apps/web
pnpm install --silent
pnpm dev &
FRONTEND_PID=$!
echo "Frontend started (PID: $FRONTEND_PID)"
cd ../..
echo ""

echo -e "${GREEN}✓ All services started!${NC}"
echo ""
echo "Services:"
echo "  - API Gateway:     http://localhost:4000"
echo "  - Agent Orchestrator: http://localhost:8000"
echo "  - Frontend:        http://localhost:3000"
echo "  - Docker Services:"
echo "    - PostgreSQL:    localhost:5432"
echo "    - RabbitMQ UI:   http://localhost:15672"
echo "    - Redis:         localhost:6379"
echo "    - pgAdmin:       http://localhost:5050"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for user interrupt
trap "echo ''; echo 'Stopping services...'; kill $API_GATEWAY_PID $ORCHESTRATOR_PID $FRONTEND_PID 2>/dev/null; exit" INT
wait
