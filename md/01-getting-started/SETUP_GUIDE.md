# 🚀 WineOps AI - Complete Setup Guide

## ✅ You Have All Credentials - Let's Get Running!

This guide will take you from credentials to a fully running system in **30 minutes**.

---

## 📋 Pre-Flight Checklist

Before starting, verify you have:

- [x] ✅ **Supabase** - Project created, credentials ready
- [x] ✅ **Google Gemini Pro** - API key obtained
- [x] ✅ **Docker Desktop** - Installed and running
- [x] ✅ **Python 3.11+** - Installed
- [x] ✅ **Node.js 20+** - Installed
- [x] ✅ **PNPM** - Installed (`npm install -g pnpm`)

---

## 🎯 Step 1: Configure Environment Variables (5 minutes)

### Create `.env` in Project Root

```bash
cd "/Users/aldemirkonuk/Desktop/Unicorn Projects - /Restaurant AI Automation"

# Create .env file
cat > .env << 'EOF'
# Database
SUPABASE_URL=https://exzueerziesmczwlhomd.supabase.co
SUPABASE_PROJECT_ID=exzueerziesmczwlhomd
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4enVlZXJ6aWVzbWN6d2xob21kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5MDYwMzQsImV4cCI6MjA4MzQ4MjAzNH0.OrNlKx09PdqKBNmc20rz9nUJ8893TMxQk_UARP5-mJU
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4enVlZXJ6aWVzbWN6d2xob21kIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzkwNjAzNCwiZXhwIjoyMDgzNDgyMDM0fQ.NAIyKPFr7-Ini6lTPUYqkvvy2rWNk44O7ppJmkS9Vcw

# AI/ML
GOOGLE_API_KEY=AIzaSyDAUUOM_UsuDoU19WwiONuUatg5ribdpYY
LLM_PRIMARY_MODEL=gemini-pro
LLM_TEMPERATURE=0.7

# Infrastructure
RABBITMQ_URL=amqp://guest:guest@localhost:5672/
REDIS_URL=redis://localhost:6379

# Communication
PLIVO_AUTH_ID=
PLIVO_AUTH_TOKEN=
PLIVO_PHONE_NUMBER=
MOCK_SMS=true

GMAIL_USER=wineops.ai@gmail.com
GMAIL_APP_PASSWORD=Ata14112010@99
MOCK_EMAIL=false

# POS Integration
TOAST_API_URL=https://ws-api.toasttab.com
TOAST_CLIENT_ID=LFtKsTzs65YJcSObjDEunu0BZQTeuiK1
TOAST_CLIENT_SECRET=2PwOGn7eGUkPnJrqqu9seYC-8csnPxhvEnnClxFjiKkHDwjjph9ua2pS3TFgHPxA
TOAST_RESTAURANT_GUID=e5d6d489-25fa-4082-9cad-3e9e74225517

# Monitoring
SENTRY_DSN=https://bf411aff828fee8ebb4912ee374ce079@o4510677969010688.ingest.us.sentry.io/4510677993127936

# Settings
ENVIRONMENT=development
DEBUG=true
BUFFER_WINDOW_MINUTES=30
DEFAULT_THRESHOLD_MIN=5

# URLs
FRONTEND_URL=http://localhost:3000
API_GATEWAY_URL=http://localhost:4000
AGENT_ORCHESTRATOR_URL=http://localhost:8000
EOF

echo "✅ Created .env file"
```

### Copy to All Services

```bash
# Copy to FastAPI
cp .env services/agent-orchestrator/.env

# Copy to NestJS
cp .env apps/api-gateway/.env

# Copy to React
cp .env apps/web/.env.local

echo "✅ Copied environment files to all services"
```

---

## 🐳 Step 2: Start Infrastructure (2 minutes)

```bash
# Start Docker services
docker-compose up -d

# Wait a few seconds for services to start
sleep 5

# Verify services are running
docker ps

# You should see:
# - wineops-postgres (PostgreSQL)
# - wineops-rabbitmq (RabbitMQ)
# - wineops-redis (Redis)
```

**Access Points:**
- 🐰 RabbitMQ Management: http://localhost:15672 (guest/guest)
- 🔴 Redis: localhost:6379
- 🐘 PostgreSQL: localhost:5432

---

## 🗄️ Step 3: Setup Supabase Database (5 minutes)

### Option A: Using Supabase Dashboard (Recommended)

1. Go to https://supabase.com/dashboard/project/exzueerziesmczwlhomd
2. Click **SQL Editor** in left sidebar
3. Click **New Query**
4. Copy entire contents of `md_files/02-architecture/DATABASE_SCHEMA.sql`
5. Paste and click **Run**
6. Wait 30-60 seconds for all tables to be created

### Option B: Using Command Line

```bash
# Install supabase CLI (if not installed)
brew install supabase/tap/supabase

# Login
supabase login

# Link to your project
supabase link --project-ref exzueerziesmczwlhomd

# Run migrations
supabase db push

# Or run the SQL file directly
psql "postgresql://postgres:[YOUR_PASSWORD]@db.exzueerziesmczwlhomd.supabase.co:5432/postgres" < md_files/02-architecture/DATABASE_SCHEMA.sql
```

**Verify:**
- Go to Supabase → Table Editor
- You should see 24 tables created

---

## 🌱 Step 4: Seed Database with Initial Data (3 minutes)

```bash
# Navigate to scripts folder
cd scripts

# Install dependencies
pip3 install -r requirements.txt

# Run seed script
python3 seed_database.py

# Expected output:
# ✅ Loaded 200 wines from dataset
# ✅ Seeded 200 wines to master_wine_library
# ✅ Created restaurant: Meyhouse Palo Alto
# ✅ Created 2 managers
# ✅ Created 3 wine providers
# ✅ Created 50 inventory items
# ✅ DATABASE SEEDING COMPLETE!
```

**What was created:**
- 📚 200 wines in master library (from robust `wineops_basic_v1.jsonl` dataset)
- 🏪 1 demo restaurant (Meyhouse Palo Alto)
- 👤 2 test managers
- 🚚 3+ wine providers (extracted from dataset)
- 📦 50 inventory items

**Dataset Features:**
- ✅ Rich sensory profiles (primary/secondary/tertiary aromas)
- ✅ Detailed wine structure (body, sweetness, acidity, tannins)
- ✅ Quality signals (producer tier, vintage quality, ratings)
- ✅ Provider information (contact details, specialties, lead times)
- ✅ Ready for vector embeddings (AI-powered wine search)

---

## 🐍 Step 5: Start FastAPI Agent Orchestrator (5 minutes)

Open **Terminal 1**:

```bash
cd "/Users/aldemirkonuk/Desktop/Unicorn Projects - /Restaurant AI Automation/services/agent-orchestrator"

# Create virtual environment
python3 -m venv venv

# Activate it
source venv/bin/activate

# Install dependencies (this may take 2-3 minutes)
pip install -r requirements.txt

# Start the server
python3 main.py
```

**Expected output:**
```
🤖 Initializing agent: buffer_manager
✓ Buffer Manager initialized
🤖 Initializing agent: inventory_engine
✓ Inventory Engine initialized
... (all 7 agents)
✅ Started 7 agents successfully

╔══════════════════════════════════════╗
║   WineOps AI - Agent Orchestrator    ║
║   Running on http://localhost:8000    ║
╚══════════════════════════════════════╝
```

**Test it:**
- Open http://localhost:8000/docs
- Try `/api/v1/health` endpoint
- Should return: `{"status": "healthy"}`

---

## 🌐 Step 6: Start NestJS API Gateway (3 minutes)

Open **Terminal 2**:

```bash
cd "/Users/aldemirkonuk/Desktop/Unicorn Projects - /Restaurant AI Automation/apps/api-gateway"

# Install dependencies (first time only, ~1 minute)
pnpm install

# Start development server
pnpm run start:dev
```

**Expected output:**
```
[Nest] INFO  [NestFactory] Starting Nest application...
[Nest] INFO  [InstanceLoader] WebsocketModule dependencies initialized
✅ Supabase client initialized
✅ WebSocket gateway initialized

╔══════════════════════════════════════════════════════╗
║   🍷 WineOps AI - API Gateway                         ║
║   🚀 Server running on http://localhost:4000          ║
║   📚 Swagger docs: http://localhost:4000/api/docs     ║
║   🔌 WebSocket: ws://localhost:4000                   ║
╚══════════════════════════════════════════════════════╝
```

**Test it:**
- Open http://localhost:4000/api/docs
- Try `/api/v1/inventory/:restaurantId/summary`
- Should return inventory statistics

---

## ⚛️ Step 7: Start React Frontend (3 minutes)

Open **Terminal 3**:

```bash
cd "/Users/aldemirkonuk/Desktop/Unicorn Projects - /Restaurant AI Automation/apps/web"

# Install dependencies (first time only, ~1 minute)
pnpm install

# Start development server
pnpm run dev
```

**Expected output:**
```
VITE v5.0.11  ready in 1234 ms

➜  Local:   http://localhost:3000/
➜  Network: use --host to expose
➜  press h to show help
```

**Access the Dashboard:**
- Open http://localhost:3000
- You should see the beautiful glassmorphism dashboard! 🎨
- Check the "🟢 Connected" badge in top-right
- Open browser console (F12) to see WebSocket connection logs

**Access Admin Panel:**
- Go to http://localhost:3000/admin
- Configure settings, monitor agents, manage integrations

---

## ✅ Step 8: Verify Everything Works (5 minutes)

### Test Checklist

- [ ] **Dashboard** http://localhost:3000
  - [ ] Stats cards showing data
  - [ ] "🟢 Connected" badge visible
  - [ ] Charts rendering
  - [ ] Low stock alerts visible

- [ ] **Admin Panel** http://localhost:3000/admin
  - [ ] All 7 agents showing "active" status
  - [ ] System status all green
  - [ ] Settings can be changed

- [ ] **FastAPI Docs** http://localhost:8000/docs
  - [ ] Health check returns healthy
  - [ ] Metrics show agent stats
  - [ ] Agent health shows all active

- [ ] **NestJS Swagger** http://localhost:4000/api/docs
  - [ ] Inventory endpoints work
  - [ ] Can get restaurant summary

- [ ] **RabbitMQ** http://localhost:15672
  - [ ] Login with guest/guest
  - [ ] See 7+ queues created
  - [ ] Message flow visible

- [ ] **Browser Console**
  - [ ] "✅ WebSocket connected" message
  - [ ] No errors
  - [ ] Real-time events logging

---

## 🎉 Success! Your System is Running!

### Quick Links

| Service | URL | Credentials |
|---------|-----|-------------|
| **Dashboard** | http://localhost:3000 | N/A |
| **Admin Panel** | http://localhost:3000/admin | N/A |
| **FastAPI Docs** | http://localhost:8000/docs | N/A |
| **NestJS Swagger** | http://localhost:4000/api/docs | N/A |
| **RabbitMQ** | http://localhost:15672 | guest/guest |
| **Supabase** | https://supabase.com/dashboard | Your credentials |

### Test Accounts

| Email | Role | Use Case |
|-------|------|----------|
| manager@meyhouse-pa.com | Manager | Daily operations |
| owner@meyhouse-pa.com | Owner | Full access |

---

## 🧪 Testing End-to-End Flow

### Test 1: Simulate a Wine Sale

```bash
# In Terminal 1 (FastAPI), watch the logs

# In a new terminal, simulate a sale
curl -X POST http://localhost:8000/api/v1/test/simulate-sale \
  -H "Content-Type: application/json" \
  -d '{
    "inventory_id": "<get_from_database>",
    "quantity": 2
  }'
```

**What should happen:**
1. ✅ Buffer Manager receives sale event
2. ✅ Sale added to 30-minute buffer
3. ✅ After buffer expires, Inventory Engine updates stock
4. ✅ If low stock, alert published
5. ✅ Dashboard updates in real-time (watch the screen!)
6. ✅ Toast notification appears

### Test 2: Trigger Low Stock Alert

```bash
# Go to Admin Panel → General Settings
# Change "Default Low Stock Threshold" to 15
# Save settings

# Watch the Dashboard
# Low stock items should appear in the alerts section
```

### Test 3: Create Manual Order

```bash
# In Dashboard, click "Reorder" on a low stock item
# Watch the logs in Terminal 1 (FastAPI)
# Procurement Agent should create an order
```

---

## 🛠️ Troubleshooting

### Issue: Can't connect to Supabase
**Solution:**
```bash
# Verify credentials in .env
cat .env | grep SUPABASE

# Test connection
curl "https://exzueerziesmczwlhomd.supabase.co/rest/v1/" \
  -H "apikey: YOUR_ANON_KEY"
```

### Issue: RabbitMQ not starting
**Solution:**
```bash
# Restart Docker
docker-compose down
docker-compose up -d

# Check logs
docker logs wineops-rabbitmq
```

### Issue: Frontend not connecting to WebSocket
**Solution:**
```bash
# Check NestJS is running on port 4000
curl http://localhost:4000/api/docs

# Check browser console for errors
# Ensure CORS is configured correctly
```

### Issue: Seed script fails
**Solution:**
```bash
# Check wine dataset path (looks for wineops_basic_v1.jsonl first)
ls "library/wineops_basic_v1.jsonl"

# Fallback dataset
ls "../Wine Agent (WinerAge)/database/library/restaurant_wine_dataset.jsonl"

# Verify Supabase credentials
echo $SUPABASE_SERVICE_ROLE_KEY

# Run with verbose output
python3 seed_database.py -v
```

---

## 🎯 Next Steps

Now that everything is running:

1. **Explore the Dashboard** - Familiarize yourself with the UI
2. **Check Admin Panel** - Configure settings to your needs
3. **Review Agent Metrics** - See how agents are performing
4. **Test Real-Time Updates** - Trigger events and watch updates
5. **Customize** - Modify colors, thresholds, etc.

### Production Deployment

When ready for production:
1. Follow [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) (coming soon)
2. Deploy FastAPI to Railway
3. Deploy NestJS to Fly.io
4. Deploy React to Vercel
5. Use CloudAMQP for RabbitMQ
6. Use Upstash for Redis

---

## 📚 Additional Resources

- [DATASET_INFO.md](../07-data/DATASET_INFO.md) - Wine dataset documentation & features
- [SYSTEM_ARCHITECTURE.md](../02-architecture/SYSTEM_ARCHITECTURE.md) - Architecture details
- [DATABASE_SCHEMA.sql](../02-architecture/DATABASE_SCHEMA.sql) - Database structure (24 tables)
- [AGENT_PROTOCOLS.md](../02-architecture/AGENT_PROTOCOLS.md) - Agent communication protocols
- [FEATURE_ROADMAP.md](../06-planning/FEATURE_ROADMAP.md) - 14-week development timeline
- [PROJECT_STATUS.md](../04-updates-builds/PROJECT_STATUS.md) - Current project status
- [ROOT_README.md](../03-packages/ROOT_README.md) - Project overview & documentation

---

## 🆘 Need Help?

1. Check troubleshooting section above
2. Review logs in each terminal
3. Check Docker logs: `docker-compose logs -f`
4. Verify credentials in `.env` files
5. Ensure all ports are available (3000, 4000, 8000)

---

## 📝 Quick Command Reference

### Start Everything (After Initial Setup)

```bash
# Terminal 1: Infrastructure
docker-compose up -d

# Terminal 2: FastAPI
cd services/agent-orchestrator && source venv/bin/activate && python3 main.py

# Terminal 3: NestJS
cd apps/api-gateway && pnpm run start:dev

# Terminal 4: React
cd apps/web && pnpm run dev
```

### Stop Everything

```bash
# Stop all services
docker-compose down

# Kill processes on specific ports (if needed)
lsof -ti:3000 | xargs kill -9  # React
lsof -ti:4000 | xargs kill -9  # NestJS
lsof -ti:8000 | xargs kill -9  # FastAPI
```

### Check Service Status

```bash
# Docker services
docker ps

# Check ports
lsof -i :3000,4000,8000,5432,5672,6379

# Check logs
docker-compose logs -f          # All services
docker logs wineops-rabbitmq    # RabbitMQ only
docker logs wineops-redis       # Redis only
```

### Database Operations

```bash
# Re-seed database (WARNING: Clears existing data)
cd scripts && python3 seed_database.py

# Backup database
pg_dump "postgresql://postgres:[PASSWORD]@db.exzueerziesmczwlhomd.supabase.co:5432/postgres" > backup.sql

# Check table counts
psql "postgresql://..." -c "SELECT COUNT(*) FROM master_wine_library;"
```

---

## 🔄 Common Workflows

### Adding a New Wine

```bash
# Option 1: Add to dataset
echo '{"WINE_ID": "WINE_201", "name": "New Wine", ...}' >> library/wineops_basic_v1.jsonl

# Option 2: Add via Supabase Dashboard
# Go to Supabase → Table Editor → master_wine_library → Insert Row

# Option 3: Add via API (future)
curl -X POST http://localhost:8000/api/v1/wines ...
```

### Updating Environment Variables

```bash
# 1. Edit root .env file
nano .env

# 2. Copy to all services
cp .env services/agent-orchestrator/.env
cp .env apps/api-gateway/.env
cp .env apps/web/.env.local

# 3. Restart services for changes to take effect
```

### Checking Agent Status

```bash
# Via API
curl http://localhost:8000/api/v1/agents/health | jq

# Via Admin Panel
# Open http://localhost:3000/admin → Agents tab

# Check logs
tail -f services/agent-orchestrator/logs/agent.log
```

### Resetting the System

```bash
# Complete reset (WARNING: Deletes all data)
docker-compose down -v           # Stop and remove volumes
rm -rf services/agent-orchestrator/venv  # Remove Python venv
rm -rf apps/*/node_modules       # Remove Node modules

# Re-run setup from Step 1
```

---

## ⚡ Performance Tips

### Frontend Optimization

```bash
# Build for production (optimized)
cd apps/web && pnpm run build

# Preview production build
pnpm run preview

# Analyze bundle size
pnpm run build -- --report
```

### Backend Optimization

```python
# FastAPI: Enable Redis caching
# In services/agent-orchestrator/.env
REDIS_URL=redis://localhost:6379  # Enable caching

# Increase worker processes
uvicorn main:app --workers 4
```

### Database Optimization

```sql
-- Create indexes for frequently queried fields
CREATE INDEX idx_inventory_restaurant ON restaurant_inventory(restaurant_id);
CREATE INDEX idx_inventory_stock ON restaurant_inventory(stock_live);

-- Analyze query performance
EXPLAIN ANALYZE SELECT * FROM restaurant_inventory WHERE stock_live < threshold_min;
```

---

## 🎓 Development Tips

### Hot Reload

All services support hot reload:
- **FastAPI**: Automatic with `uvicorn main:app --reload`
- **NestJS**: Built-in with `pnpm run start:dev`
- **React**: Vite HMR (Hot Module Replacement)

### Debugging

```bash
# FastAPI: Enable debug logging
export DEBUG=true
export LOG_LEVEL=DEBUG

# NestJS: Debug mode
pnpm run start:debug

# React: Open DevTools
# Press F12 in browser
# Check Console, Network, React DevTools tabs
```

### Testing

```bash
# FastAPI tests
cd services/agent-orchestrator
pytest tests/ -v

# NestJS tests
cd apps/api-gateway
pnpm run test

# React tests
cd apps/web
pnpm run test
```

### Code Quality

```bash
# Format Python code
cd services/agent-orchestrator
black . && ruff check --fix .

# Format TypeScript code
cd apps/api-gateway
pnpm run format

# Format React code
cd apps/web
pnpm run lint --fix
```

---

## 📊 Monitoring & Logs

### Agent Logs

```bash
# Real-time agent logs
tail -f services/agent-orchestrator/logs/agent.log

# Filter by agent
grep "buffer_manager" services/agent-orchestrator/logs/agent.log

# Check error rate
grep "ERROR" services/agent-orchestrator/logs/agent.log | wc -l
```

### System Metrics

```bash
# Agent performance metrics
curl http://localhost:8000/api/v1/metrics | jq

# RabbitMQ metrics
curl -u guest:guest http://localhost:15672/api/overview | jq

# Database connections
# Check in Supabase Dashboard → Database → Connections
```

### Sentry (Error Tracking)

```bash
# View errors
# Go to: https://sentry.io/organizations/.../issues/

# Test Sentry integration
curl -X POST http://localhost:8000/api/v1/test/sentry-error
```

---

## 🔐 Security Checklist

Before deploying to production:

- [ ] Rotate all API keys and secrets
- [ ] Use environment-specific credentials (dev/staging/prod)
- [ ] Enable SSL/TLS for all connections
- [ ] Set up firewall rules (only allow necessary ports)
- [ ] Enable Supabase Row Level Security (RLS)
- [ ] Configure CORS properly (restrict origins)
- [ ] Set up API rate limiting
- [ ] Enable 2FA on all service accounts
- [ ] Audit log monitoring alerts
- [ ] Regular security updates (dependencies)

---

## 🎯 Success Metrics

Your system is running successfully when:

✅ **All 7 agents are active** (check Admin Panel)  
✅ **WebSocket connected** (green badge on dashboard)  
✅ **RabbitMQ has 7+ queues** (check management UI)  
✅ **Redis is caching** (check hit rate in metrics)  
✅ **Database has 200 wines** (check Supabase)  
✅ **Real-time updates work** (test with threshold changes)  
✅ **No errors in logs** (check all terminal windows)  
✅ **Dashboard loads in < 2 seconds** (performance)  

---

## 🚀 What's Next?

Now that your system is running, you can:

1. **🎨 Customize the UI**
   - Modify colors in `apps/web/tailwind.config.js`
   - Update components in `apps/web/src/components/`
   - Add new pages to `apps/web/src/pages/`

2. **🤖 Enhance Agents**
   - Modify agent logic in `services/agent-orchestrator/agents/`
   - Add new agents following `BaseAgent` pattern
   - Customize thresholds and rules

3. **📊 Add Features**
   - Implement authentication (JWT + Supabase Auth)
   - Add more charts and reports
   - Build mobile app (React Native)
   - Integrate more POS systems

4. **🚢 Deploy to Production**
   - Railway (FastAPI)
   - Fly.io (NestJS)  
   - Vercel (React)
   - CloudAMQP (RabbitMQ)
   - Upstash (Redis)

5. **📈 Scale Up**
   - Add more restaurants
   - Implement multi-tenancy
   - Set up load balancing
   - Enable geographic distribution

---

## 💡 Pro Tips

1. **Use Admin Panel** - It's your control center for everything
2. **Watch the Logs** - Agent logs tell you exactly what's happening
3. **Test with Real Data** - Import your actual wine list
4. **Customize Thresholds** - Each wine can have different min stock
5. **Monitor Performance** - Check metrics endpoint regularly
6. **Backup Database** - Before making major changes
7. **Use Feature Flags** - Enable/disable features without code changes
8. **Document Changes** - Keep track of customizations
9. **Stay Updated** - Check for dependency updates monthly
10. **Have Fun!** - You built something amazing! 🎉

---

## 📞 Support & Community

- **Documentation**: All guides in `md_files/` folder
- **Issues**: Check logs first, then troubleshooting section
- **Updates**: Watch for new features in FEATURE_ROADMAP.md
- **Contributions**: Follow code style guides

---

**🎉 Congratulations! You're now running WineOps AI!** 🍷

**Built with ❤️ and ⚡**  
*Focused on Perfection and Performance*

---

*Last Updated: 2026-01-08*  
*Version: 1.0.0 (MVP)*

