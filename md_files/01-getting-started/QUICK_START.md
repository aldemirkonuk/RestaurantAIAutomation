# 🚀 Quick Start Guide - WineOps AI

## Prerequisites

Before starting, ensure you have:

- ✅ **Python 3.11+** - For FastAPI agent orchestrator
- ✅ **Node.js 20+** - For NestJS & React
- ✅ **PNPM 8.15+** - Package manager (`npm install -g pnpm`)
- ✅ **Docker Desktop** - For local infrastructure

---

## 🐳 Step 1: Start Local Infrastructure

```bash
# Navigate to project root
cd "/Users/aldemirkonuk/Desktop/Unicorn Projects - /Restaurant AI Automation"

# Start all infrastructure services
docker-compose up -d

# Verify services are running
docker ps
```

**Services Started:**
- 🐰 **RabbitMQ** - http://localhost:15672 (username: `guest`, password: `guest`)
- 🔴 **Redis** - localhost:6379
- 🐘 **PostgreSQL** - localhost:5432

---

## 🐍 Step 2: Start FastAPI Agent Orchestrator

```bash
# Navigate to agent orchestrator
cd services/agent-orchestrator

# Create virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate  # macOS/Linux
# venv\Scripts\activate   # Windows

# Install all dependencies
pip install -r requirements.txt

# Copy environment template
cp ../../.env.example .env

# Edit .env with your credentials (use nano, vim, or your editor)
# Required:
#   - SUPABASE_URL
#   - SUPABASE_SERVICE_ROLE_KEY
#   - RABBITMQ_URL
#   - REDIS_URL
#   - GOOGLE_API_KEY (for Gemini Pro)

# Start the server
python3 main.py

# Or with hot reload:
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Agent Orchestrator Running:**
- 📡 API: http://localhost:8000
- 📚 Swagger Docs: http://localhost:8000/docs
- 🔧 Metrics: http://localhost:8000/api/v1/metrics
- ❤️ Health: http://localhost:8000/api/v1/health

**7 Autonomous Agents Started:**
1. ✅ Buffer Manager (30-min LIFO buffer)
2. ✅ Inventory Engine (stock management)
3. ✅ Inequality Detector (anomaly detection)
4. ✅ Procurement Agent (AI negotiations)
5. ✅ Notification Agent (SMS/Email/Push)
6. ✅ Calendar Agent (important dates)
7. ✅ Reporting Agent (analytics)

---

## 🌐 Step 3: Start NestJS API Gateway

Open a **new terminal window**:

```bash
# Navigate to API gateway
cd apps/api-gateway

# Install dependencies
pnpm install

# Copy environment template
cp ../../.env.example .env

# Edit .env with your credentials
# Required:
#   - SUPABASE_URL
#   - SUPABASE_SERVICE_ROLE_KEY
#   - FRONTEND_URL (http://localhost:3000)

# Start development server
pnpm run start:dev
```

**API Gateway Running:**
- 📡 REST API: http://localhost:4000/api/v1
- 📚 Swagger Docs: http://localhost:4000/api/docs
- 🔌 WebSocket: ws://localhost:4000/ws

---

## ⚛️ Step 4: Start React Frontend

Open **another new terminal window**:

```bash
# Navigate to frontend
cd apps/web

# Install dependencies
pnpm install

# Copy environment template (if needed)
cp ../../.env.example .env.local

# Edit .env.local with configuration
# Default values should work for local development

# Start development server
pnpm run dev
```

**Frontend Running:**
- 🎨 Dashboard: http://localhost:3000
- 🔥 Hot Module Replacement enabled
- ⚡ Vite dev server

---

## ✅ Step 5: Verify Everything Works

### Check All Services

1. **Frontend Dashboard** (http://localhost:3000)
   - Should show beautiful glassmorphism UI
   - Check connection status indicator (top right)
   - Should see "🟢 Connected" badge

2. **FastAPI Docs** (http://localhost:8000/docs)
   - Browse available endpoints
   - Test `/api/v1/health` endpoint
   - Check `/api/v1/metrics` for agent stats

3. **NestJS Swagger** (http://localhost:4000/api/docs)
   - Browse REST API documentation
   - Test inventory endpoints

4. **RabbitMQ Management** (http://localhost:15672)
   - Login with `guest` / `guest`
   - Check exchanges and queues
   - Should see 7+ queues created

### Test Real-Time Updates

1. Open browser DevTools (F12)
2. Go to Console tab
3. Watch for WebSocket connection logs:
   ```
   ✅ WebSocket connected
   WebSocket connection successful: {...}
   ```
4. Any stock updates will show as toast notifications

---

## 🎯 Common Commands

### All Services (from root)

```bash
# Install all dependencies
pnpm install

# Build all services
pnpm run build

# Type checking
pnpm run type-check

# Linting
pnpm run lint
```

### FastAPI (agent-orchestrator)

```bash
cd services/agent-orchestrator

# Hot reload development
uvicorn main:app --reload

# Run tests
pytest

# Format code
black . && ruff check --fix .

# Type checking
mypy .
```

### NestJS (api-gateway)

```bash
cd apps/api-gateway

# Development
pnpm run start:dev

# Production build
pnpm run build
pnpm run start:prod

# Testing
pnpm run test
pnpm run test:e2e

# Format
pnpm run format
```

### React (web)

```bash
cd apps/web

# Development
pnpm run dev

# Production build
pnpm run build
pnpm run preview

# Type checking
pnpm run type-check

# Linting
pnpm run lint
```

---

## 🐛 Troubleshooting

### Port Already in Use

```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9

# Kill process on port 4000
lsof -ti:4000 | xargs kill -9

# Kill process on port 8000
lsof -ti:8000 | xargs kill -9
```

### Docker Services Not Starting

```bash
# Stop all containers
docker-compose down

# Remove volumes (⚠️ deletes data)
docker-compose down -v

# Rebuild and start
docker-compose up -d --build

# Check logs
docker-compose logs -f
```

### Python Virtual Environment Issues

```bash
# Deactivate current venv
deactivate

# Remove and recreate
rm -rf venv
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### PNPM Install Failures

```bash
# Clear PNPM cache
pnpm store prune

# Remove node_modules
rm -rf node_modules pnpm-lock.yaml

# Reinstall
pnpm install
```

### WebSocket Connection Failed

1. Ensure NestJS API Gateway is running on port 4000
2. Check CORS configuration in `apps/api-gateway/src/main.ts`
3. Verify `FRONTEND_URL` in `.env` matches your frontend URL
4. Check browser console for detailed error messages

### RabbitMQ Connection Failed

1. Verify Docker container is running: `docker ps | grep rabbitmq`
2. Check RabbitMQ logs: `docker logs <container_id>`
3. Verify `RABBITMQ_URL` in `.env` is correct
4. Try accessing management UI: http://localhost:15672

---

## 📊 Health Check Endpoints

### FastAPI Agent Orchestrator

```bash
# Health check
curl http://localhost:8000/api/v1/health

# Agent metrics
curl http://localhost:8000/api/v1/metrics

# Agent health status
curl http://localhost:8000/api/v1/agents/health
```

### NestJS API Gateway

```bash
# Get inventory summary
curl http://localhost:4000/api/v1/inventory/demo-restaurant/summary

# Get low stock items
curl http://localhost:4000/api/v1/inventory/demo-restaurant/low-stock
```

---

## 🎨 Development Tips

### Frontend Development

1. **Hot Module Replacement** works automatically - save files to see changes instantly
2. **TailwindCSS** classes update in real-time
3. Use **React DevTools** extension for component inspection
4. **React Query DevTools** shows cache status (auto-enabled in dev)

### Backend Development

1. **FastAPI auto-reload** triggers on file save
2. **NestJS hot reload** enabled with `--watch` flag
3. Use **Swagger UI** for API testing
4. Check **RabbitMQ Management** to monitor message flow

### Debugging

**Frontend:**
```javascript
// Add to any component
console.log('Component state:', state)

// WebSocket events
socket.on('*', (event, data) => {
  console.log('WebSocket event:', event, data)
})
```

**Backend (Python):**
```python
# Add to any agent
self.logger.debug(f"Processing message: {message}")

# Performance timing
import time
start = time.time()
# ... code ...
self.logger.info(f"Execution time: {time.time() - start:.2f}s")
```

**Backend (NestJS):**
```typescript
// Add to any service
this.logger.log('Processing request:', data)

// WebSocket debugging
this.logger.debug(`Connected clients: ${this.connectedClients.size}`)
```

---

## 📚 Next Steps

Once everything is running:

1. ✅ **Explore the Dashboard** - Check out the glassmorphism UI
2. ✅ **Review API Docs** - Familiarize with endpoints
3. ✅ **Monitor Agents** - Check agent health and metrics
4. ✅ **Test Real-Time** - Watch WebSocket events in console
5. ✅ **Customize** - Modify colors, thresholds, etc.

### Recommended Reading

- 📄 [BUILD_SUMMARY.md](../04-updates-builds/BUILD_SUMMARY.md) - Comprehensive build overview
- 📄 [SYSTEM_ARCHITECTURE.md](../02-architecture/SYSTEM_ARCHITECTURE.md) - System design
- 📄 [DATABASE_SCHEMA.sql](../02-architecture/DATABASE_SCHEMA.sql) - Database structure
- 📄 [AGENT_PROTOCOLS.md](../02-architecture/AGENT_PROTOCOLS.md) - Agent communication
- 📄 [FEATURE_ROADMAP.md](../06-planning/FEATURE_ROADMAP.md) - Future features

---

## 🆘 Need Help?

1. Check [BUILD_SUMMARY.md](../04-updates-builds/BUILD_SUMMARY.md) for component details
2. Review [SYSTEM_ARCHITECTURE.md](../02-architecture/SYSTEM_ARCHITECTURE.md) for design
3. Check Docker logs: `docker-compose logs -f`
4. Check application logs in terminal windows
5. Open browser DevTools Console for frontend errors

---

**🎉 Happy Coding!**

Built with ❤️ and ⚡ - Focused on Perfection and Performance

