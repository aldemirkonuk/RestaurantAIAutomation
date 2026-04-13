# 🛠️ Development Setup Guide

**WineOps AI - Local Development Environment**

---

## 📋 Prerequisites

### Required Software
- **Node.js**: v24.4.1 (confirmed installed)
- **Python**: 3.11+ (confirmed installed)
- **Docker**: Latest version (confirmed installed)
- **Git**: Latest version
- **pnpm**: `npm install -g pnpm` (faster than npm)

### Required Accounts
- **Supabase**: Free tier account
- **CloudAMQP**: Free tier RabbitMQ
- **Plivo**: SMS service account
- **Toast POS**: Developer portal access (confirmed)
- **Google**: For Gemini Pro API access

---

## 🏗️ Project Structure

```
Restaurant AI Automation/
├── apps/
│   ├── web/                    # React frontend (Vite + TypeScript)
│   ├── api-gateway/            # NestJS API server (Node.js)
│   └── mobile/                 # React Native app (Phase 2)
│
├── services/
│   └── agent-orchestrator/     # FastAPI agent system (Python)
│
├── packages/
│   ├── ui/                     # Shared React components (shadcn/ui)
│   ├── database/               # Supabase client & types
│   ├── config/                 # Shared configs (ESLint, TypeScript)
│   └── utils/                  # Shared utilities
│
├── library/                    # Wine dataset (JSONL seed data)
│   └── restaurant_wine_dataset.jsonl
│
├── md_files/                   # Documentation & specs
│   ├── Blueprint
│   ├── SYSTEM_ARCHITECTURE.md
│   ├── DATABASE_SCHEMA.sql
│   ├── DEVELOPMENT_SETUP.md (this file)
│   ├── AGENT_PROTOCOLS.md
│   └── API_REFERENCE.md
│
├── scripts/                    # Development & deployment scripts
│   ├── setup-local.sh
│   ├── seed-database.py
│   ├── migrate.sh
│   └── docker-compose.yml
│
├── .github/
│   └── workflows/              # CI/CD pipelines
│       ├── test.yml
│       └── deploy.yml
│
├── turbo.json                  # Turborepo configuration
├── package.json                # Root package.json
├── pnpm-workspace.yaml         # pnpm workspace config
├── .env.example                # Example environment variables
└── README.md                   # Project README
```

---

## 🚀 Quick Start (5 Steps)

### Step 1: Clone & Install Dependencies

```bash
cd "/Users/aldemirkonuk/Desktop/Unicorn Projects - /Restaurant AI Automation"

# Install pnpm globally (if not installed)
npm install -g pnpm

# Install Node.js dependencies (all apps & packages)
pnpm install

# Install Python dependencies (agent orchestrator)
cd services/agent-orchestrator
python3 -m venv venv
source venv/bin/activate  # On Mac/Linux
pip install -r requirements.txt
```

### Step 2: Set Up Environment Variables

```bash
# Copy example env file
cp .env.example .env.local

# Edit with your credentials
nano .env.local  # or use your favorite editor
```

Required variables (see `.env.example` for full list):
```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# RabbitMQ (CloudAMQP)
RABBITMQ_URL=amqps://user:pass@rabbit.cloudamqp.com/vhost

# Gemini Pro
GOOGLE_API_KEY=your-gemini-api-key

# Plivo SMS
PLIVO_AUTH_ID=your-auth-id
PLIVO_AUTH_TOKEN=your-auth-token
PLIVO_PHONE_NUMBER=+1234567890

# Toast POS (Mock for MVP)
TOAST_API_KEY=your-toast-key
TOAST_WEBHOOK_SECRET=your-webhook-secret

# Frontend
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001
```

### Step 3: Start Supabase (Local) & RabbitMQ

**Option A: Use Docker Compose (Recommended)**
```bash
# Start all infrastructure services
docker-compose up -d

# Check status
docker-compose ps
```

**Option B: Use Cloud Services**
```bash
# Use Supabase cloud project (faster for MVP)
# Use CloudAMQP free tier
# No local Docker needed
```

### Step 4: Initialize Database

```bash
# Run migrations (creates all tables)
pnpm db:migrate

# Seed master wine library from JSONL
python3 scripts/seed-database.py \
  --file library/restaurant_wine_dataset.jsonl \
  --environment local

# Create test restaurant & manager
pnpm db:seed-test-data
```

### Step 5: Start Development Servers

```bash
# Start all services in parallel (Turborepo)
pnpm dev

# This starts:
# - Frontend (Vite):         http://localhost:5173
# - API Gateway (NestJS):    http://localhost:3001
# - Agent Orchestrator:      http://localhost:8000
# - Agent Orchestrator Docs: http://localhost:8000/docs
```

**Open your browser:**
- **Frontend**: http://localhost:5173
- **API Docs**: http://localhost:3001/api
- **Agent Docs**: http://localhost:8000/docs

---

## 🧪 Testing

### Run All Tests
```bash
pnpm test
```

### Run Specific Test Suites
```bash
# Frontend tests (Vitest)
pnpm test:web

# API Gateway tests (Jest)
pnpm test:api

# Agent tests (Pytest)
cd services/agent-orchestrator
pytest
```

### E2E Tests (Playwright)
```bash
# Requires all services running
pnpm test:e2e
```

### Coverage Report
```bash
pnpm test:coverage
```

---

## 🐛 Debugging

### VS Code Launch Configurations

Create `.vscode/launch.json`:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Frontend",
      "type": "chrome",
      "request": "launch",
      "url": "http://localhost:5173",
      "webRoot": "${workspaceFolder}/apps/web/src"
    },
    {
      "name": "Debug API Gateway",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["--filter", "api-gateway", "dev"],
      "cwd": "${workspaceFolder}/apps/api-gateway",
      "console": "integratedTerminal"
    },
    {
      "name": "Debug Python Agents",
      "type": "python",
      "request": "launch",
      "module": "uvicorn",
      "args": ["main:app", "--reload", "--host", "0.0.0.0", "--port", "8000"],
      "cwd": "${workspaceFolder}/services/agent-orchestrator",
      "justMyCode": false
    }
  ]
}
```

### Logs

```bash
# View all logs
pnpm logs

# View specific service logs
docker-compose logs -f rabbitmq
docker-compose logs -f postgres

# Agent logs (with colors)
cd services/agent-orchestrator
tail -f logs/agent-orchestrator.log | jq
```

---

## 📦 Key Dependencies

### Frontend (apps/web)
```json
{
  "react": "^18.2.0",
  "typescript": "^5.3.3",
  "vite": "^5.0.0",
  "tailwindcss": "^3.4.0",
  "@radix-ui/react-*": "latest",  // shadcn/ui primitives
  "@tremor/react": "^3.14.0",     // Charts
  "framer-motion": "^10.16.0",     // Animations
  "zustand": "^4.4.0",             // State management
  "@tanstack/react-query": "^5.0.0"  // Data fetching
}
```

### API Gateway (apps/api-gateway)
```json
{
  "@nestjs/core": "^10.3.0",
  "@nestjs/websockets": "^10.3.0",
  "@supabase/supabase-js": "^2.39.0",
  "amqplib": "^0.10.3",            // RabbitMQ client
  "ioredis": "^5.3.2",             // Redis cache
  "class-validator": "^0.14.0"
}
```

### Agent Orchestrator (services/agent-orchestrator)
```txt
fastapi==0.108.0
uvicorn[standard]==0.25.0
pydantic==2.5.0
pika==1.3.2                    # RabbitMQ client
supabase==2.3.0
google-generativeai==0.3.0     # Gemini Pro
sentence-transformers==2.3.0   # Local embeddings
easyocr==1.7.0                 # OCR (Phase 2)
torch==2.1.0                   # For embeddings
numpy==1.24.0
pandas==2.1.0
httpx==0.26.0                  # Async HTTP client
redis==5.0.0
celery==5.3.0                  # Background tasks
```

---

## 🔧 Common Commands

### Development
```bash
pnpm dev              # Start all services
pnpm build            # Build all apps
pnpm lint             # Lint all code
pnpm format           # Format with Prettier
pnpm typecheck        # TypeScript type checking
```

### Database
```bash
pnpm db:migrate       # Run migrations
pnpm db:rollback      # Rollback last migration
pnpm db:seed          # Seed test data
pnpm db:reset         # Reset entire database (careful!)
pnpm db:studio        # Open Supabase Studio
```

### Agents
```bash
pnpm agents:start     # Start agent orchestrator
pnpm agents:test      # Test all agents
pnpm agents:logs      # View agent logs
pnpm agents:health    # Check agent health
```

### Docker
```bash
pnpm docker:up        # Start Docker services
pnpm docker:down      # Stop Docker services
pnpm docker:logs      # View Docker logs
pnpm docker:clean     # Clean Docker volumes
```

---

## 🌐 Service Ports (Local Development)

| Service | Port | URL |
|---------|------|-----|
| **Frontend** | 5173 | http://localhost:5173 |
| **API Gateway** | 3001 | http://localhost:3001 |
| **Agent Orchestrator** | 8000 | http://localhost:8000 |
| **PostgreSQL** | 5432 | localhost:5432 |
| **RabbitMQ Management** | 15672 | http://localhost:15672 |
| **Redis** | 6379 | localhost:6379 |

---

## 🔐 Authentication Setup (Supabase)

### 1. Create Supabase Project
```bash
# Go to https://supabase.com
# Create new project: "wineops-ai-dev"
# Copy URL & keys to .env.local
```

### 2. Enable Auth Providers
- Enable Email/Password auth
- Enable Google OAuth (for SSO)
- Enable Microsoft OAuth (for SSO)

### 3. Set Auth Policies
```sql
-- Run in Supabase SQL Editor
-- Create user_restaurant_access table for RLS
CREATE TABLE user_restaurant_access (
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'manager',  -- 'owner', 'manager', 'staff'
    PRIMARY KEY (user_id, restaurant_id)
);
```

---

## 📊 Monitoring & Debugging Tools

### Supabase Studio
- URL: https://supabase.com/dashboard/project/YOUR_PROJECT_ID
- View tables, run queries, check logs

### RabbitMQ Management UI
- URL: http://localhost:15672 (local) or CloudAMQP dashboard
- Username: guest / Password: guest (local)
- View queues, exchanges, message rates

### Agent Performance Dashboard
- URL: http://localhost:8000/admin/dashboard
- View agent health, response times, error rates

---

## 🐳 Docker Compose Services

```yaml
# docker-compose.yml (simplified)
version: '3.8'

services:
  postgres:
    image: supabase/postgres:15.1.0.147
    ports:
      - "5432:5432"
    environment:
      POSTGRES_PASSWORD: postgres
    volumes:
      - postgres_data:/var/lib/postgresql/data

  rabbitmq:
    image: rabbitmq:3-management
    ports:
      - "5672:5672"   # AMQP
      - "15672:15672" # Management UI
    environment:
      RABBITMQ_DEFAULT_USER: guest
      RABBITMQ_DEFAULT_PASS: guest

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  postgres_data:
```

---

## 🚨 Troubleshooting

### Problem: Port already in use
```bash
# Find process using port
lsof -i :5173

# Kill process
kill -9 <PID>
```

### Problem: pnpm install fails
```bash
# Clear cache and retry
pnpm store prune
rm -rf node_modules
pnpm install
```

### Problem: Python dependencies conflict
```bash
# Recreate virtual environment
rm -rf venv
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### Problem: Database migration fails
```bash
# Reset database (CAREFUL - deletes all data)
pnpm db:reset

# Re-run migrations
pnpm db:migrate
```

### Problem: RabbitMQ connection refused
```bash
# Check if RabbitMQ is running
docker-compose ps rabbitmq

# Restart RabbitMQ
docker-compose restart rabbitmq

# View logs
docker-compose logs rabbitmq
```

---

## 🔄 Git Workflow

```bash
# Create feature branch
git checkout -b feature/buffer-manager-agent

# Make changes, commit often
git add .
git commit -m "feat: implement buffer manager LIFO logic"

# Push and create PR
git push origin feature/buffer-manager-agent

# After PR approved, merge to main
# CI/CD will auto-deploy to staging
```

---

## 📚 Additional Resources

- [Turborepo Docs](https://turbo.build/repo/docs)
- [Supabase Docs](https://supabase.com/docs)
- [FastAPI Docs](https://fastapi.tiangolo.com/)
- [NestJS Docs](https://docs.nestjs.com/)
- [shadcn/ui Docs](https://ui.shadcn.com/)
- [RabbitMQ Tutorials](https://www.rabbitmq.com/getstarted.html)

---

## ✅ Checklist: Ready to Develop

- [ ] Node.js v24+ installed
- [ ] Python 3.11+ installed
- [ ] Docker running
- [ ] pnpm installed globally
- [ ] Supabase account created
- [ ] CloudAMQP account created
- [ ] Environment variables configured
- [ ] Dependencies installed (`pnpm install`)
- [ ] Database migrated (`pnpm db:migrate`)
- [ ] Database seeded (`python3 scripts/seed-database.py`)
- [ ] All services start (`pnpm dev`)
- [ ] Frontend loads at http://localhost:5173
- [ ] API responds at http://localhost:3001/health
- [ ] Agents respond at http://localhost:8000/health

---

**Need Help?** Check the troubleshooting section above or review logs in `/logs/` directory.

**Next Steps:** Read `AGENT_PROTOCOLS.md` to understand agent communication patterns.

