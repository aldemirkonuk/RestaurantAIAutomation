# 🎯 Next Steps After Migration - Step by Step

**Status:** ✅ Migration Complete  
**Next:** Test & Start Agents

---

## Step 1: Verify Environment Configuration (5 minutes)

### 1.1 Check `.env` File

Navigate to the agent orchestrator directory and verify your `.env` file has all required variables:

```bash
cd "Restaurant AI Automation/services/agent-orchestrator"
cat .env
```

**Required Variables:**
```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Message Queue
RABBITMQ_URL=amqp://guest:guest@localhost:5672/
REDIS_URL=redis://localhost:6379

# AI/LLM (for new agents)
GOOGLE_API_KEY=your-google-api-key  # For Gemini Pro

# Optional (for voice calling)
PLIVO_AUTH_ID=your-plivo-auth-id
PLIVO_AUTH_TOKEN=your-plivo-auth-token
PLIVO_PHONE_NUMBER=+1234567890

# Environment
ENVIRONMENT=development
DEBUG=true
MOCK_LLM=true  # Start with mock mode for testing
```

### 1.2 Install Dependencies

Make sure all Python dependencies are installed:

```bash
cd "Restaurant AI Automation/services/agent-orchestrator"

# Activate virtual environment (if exists)
source venv/bin/activate  # macOS/Linux
# venv\Scripts\activate   # Windows

# Install/update dependencies
pip install -r requirements.txt
```

**New dependencies added:**
- `easyocr==1.7.1` - OCR for invoice scanning
- `ultralytics==8.1.0` - YOLOv8 for wine label detection
- `pytz==2024.1` - Timezone support

---

## Step 2: Start Infrastructure Services (2 minutes)

### 2.1 Start Docker Services

```bash
cd "Restaurant AI Automation"

# Start RabbitMQ and Redis
docker-compose up -d

# Verify services are running
docker ps
```

**Expected Services:**
- ✅ RabbitMQ (port 15672)
- ✅ Redis (port 6379)

---

## Step 3: Test Repository Methods (10 minutes)

### 3.1 Create Test Script

Create a simple test script to verify repositories work:

```bash
cd "Restaurant AI Automation/services/agent-orchestrator"
```

Create file: `test_repositories.py`

```python
"""
Quick test script to verify new repositories work
"""
import asyncio
from core.database import DatabaseClient
from config.settings import get_settings

async def test_repositories():
    settings = get_settings()
    
    # Initialize database client
    db = DatabaseClient(
        supabase_url=settings.supabase_url,
        supabase_key=settings.supabase_service_role_key,
        redis_url=settings.redis_url,
    )
    
    await db.connect()
    print("✅ Database connected")
    
    # Test OrderInteractionRepository
    if db.order_interactions:
        print("✅ OrderInteractionRepository initialized")
    
    # Test ManagerPreferencesRepository
    if db.manager_preferences:
        print("✅ ManagerPreferencesRepository initialized")
    
    # Test UnitConversionRepository
    if db.unit_conversions:
        print("✅ UnitConversionRepository initialized")
    
    # Test RFQRepository
    if db.rfq_requests:
        print("✅ RFQRepository initialized")
    
    # Test MasterWineLibraryRepository
    if db.wine_library:
        print("✅ MasterWineLibraryRepository initialized")
    
    # Test health check
    health = await db.health_check()
    print(f"✅ Database health: {health}")
    
    await db.disconnect()
    print("✅ All repositories verified!")

if __name__ == "__main__":
    asyncio.run(test_repositories())
```

### 3.2 Run Test

```bash
python test_repositories.py
```

**Expected Output:**
```
✅ Database connected
✅ OrderInteractionRepository initialized
✅ ManagerPreferencesRepository initialized
✅ UnitConversionRepository initialized
✅ RFQRepository initialized
✅ MasterWineLibraryRepository initialized
✅ Database health: {'status': 'healthy', ...}
✅ All repositories verified!
```

---

## Step 4: Start Agent Orchestrator (5 minutes)

### 4.1 Start the Service

```bash
cd "Restaurant AI Automation/services/agent-orchestrator"

# Make sure virtual environment is activated
source venv/bin/activate  # macOS/Linux

# Start with uvicorn (recommended)
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# OR use Python directly
python main.py
```

### 4.2 Verify Startup

Watch the logs for successful agent initialization:

**Expected Log Output:**
```
🚀 Starting WineOps AI Agent Orchestrator...
✅ Connected to RabbitMQ
🔌 Initializing database connections...
✅ Supabase client initialized
✅ Redis connected
✅ All repositories initialized (including Phase 2)
✅ Agent Orchestrator initialized successfully
🚀 Starting all agents...
✓ Started agent: buffer_manager
✓ Started agent: inventory_engine
✓ Started agent: inequality_detector
✓ Started agent: notification_agent
✓ Started agent: procurement_agent
✓ Started agent: calendar_agent
✓ Started agent: reporting_agent
✓ Started agent: sommelier_agent
✓ Started agent: visual_verification_agent
✓ Started agent: menu_analyzer_agent
✓ Started agent: rfq_agent
✅ Started 11 agents successfully
🎯 WineOps AI Agent Orchestrator is READY!
```

### 4.3 Check Health Endpoint

Open in browser or use curl:

```bash
# Health check
curl http://localhost:8000/health

# Agent health
curl http://localhost:8000/health/agents
```

**Expected Response:**
```json
{
  "status": "healthy",
  "service": "agent-orchestrator",
  "components": {
    "rabbitmq": {"status": "connected"},
    "agents": {
      "system_healthy": true,
      "total_agents": 11,
      "active_agents": 11
    }
  }
}
```

---

## Step 5: Test New Agents in Mock Mode (15 minutes)

### 5.1 Test Visual Verification Agent

The agent should be running. Check logs for:
```
✓ Visual Verification Agent initialized
```

**Test via API (if endpoint exists) or check logs when delivery events are published.**

### 5.2 Test Sommelier Agent

Check logs for:
```
✓ Sommelier Agent initialized
```

**Test wine query:**
- Agent subscribes to `sommelier.wine_query` events
- Can be triggered via message bus

### 5.3 Test Menu Analyzer Agent

Check logs for:
```
✓ Menu Analyzer Agent initialized
```

**Test menu scan:**
- Agent subscribes to `menu.scan_request` events
- Can process menu images via message bus

### 5.4 Test RFQ Agent

Check logs for:
```
✓ RFQ Agent initialized
```

**Test RFQ flow:**
- Agent subscribes to `stock.threshold.breached`
- Will automatically initiate RFQ when low stock detected

### 5.5 Test Procurement Agent Voice Integration

Check logs for:
```
✓ Plivo Voice client initialized
✓ Procurement Agent initialized
```

**Verify voice client is available:**
- Should see "Plivo Voice client initialized" in logs
- Or "⚠️ Plivo credentials not configured" if not set up

---

## Step 6: Verify All Agents Are Running (2 minutes)

### 6.1 Check Agent Status

Visit: http://localhost:8000/health/agents

**Expected:** All 11 agents should show:
- `status: "active"`
- `healthy: true`

### 6.2 Check Agent Metrics

Visit: http://localhost:8000/admin/metrics

**Expected:** See metrics for all agents including:
- Messages processed
- Success rates
- Processing times

---

## Step 7: Test End-to-End Flow (Optional - 20 minutes)

### 7.1 Test Low Stock → RFQ Flow

1. **Simulate low stock event** (via message bus or API)
2. **Verify RFQ Agent responds:**
   - Creates RFQ request
   - Sends messages to vendors
   - Logs: "RFQ initiated: [wine_name] x[quantity] to [N] vendors"

### 7.2 Test Menu Scan Flow

1. **Send menu scan request** (via message bus)
2. **Verify Menu Analyzer Agent:**
   - Processes image
   - Detects wines
   - Enriches via LLM
   - Adds to master library

### 7.3 Test Visual Verification Flow

1. **Send delivery photo/invoice** (via message bus)
2. **Verify Visual Verification Agent:**
   - Detects wine labels (YOLOv8)
   - Scans invoice (OCR)
   - Compares prices/quantities
   - Flags mismatches

---

## Troubleshooting

### Issue: "Module not found" errors

**Solution:**
```bash
pip install -r requirements.txt
```

### Issue: "Supabase connection failed"

**Solution:**
- Check `.env` file has correct `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
- Verify Supabase project is active
- Check network connectivity

### Issue: "RabbitMQ connection failed"

**Solution:**
```bash
# Check Docker is running
docker ps

# Restart RabbitMQ
docker-compose restart rabbitmq
```

### Issue: "Agent failed to start"

**Solution:**
- Check logs for specific error
- Verify all dependencies installed
- Check `.env` configuration
- Try starting in mock mode first (`MOCK_LLM=true`)

### Issue: "YOLOv8/EasyOCR not available"

**Solution:**
- These are optional - agents will run in degraded mode
- Install if needed: `pip install ultralytics easyocr`
- Or keep `mock_mode=true` for testing

---

## ✅ Success Checklist

- [ ] All repositories initialized without errors
- [ ] All 11 agents started successfully
- [ ] Health endpoint returns `"status": "healthy"`
- [ ] Agent health shows all agents active
- [ ] No critical errors in logs
- [ ] Can access Swagger docs at http://localhost:8000/docs

---

## Next: Production Readiness

Once testing is complete:

1. **Disable Mock Mode:**
   - Set `MOCK_LLM=false` in `.env`
   - Set `MOCK_SMS=false`
   - Set `MOCK_POS=false`

2. **Configure Real Credentials:**
   - Add Plivo credentials for voice calling
   - Add Google API key for Gemini Pro
   - Configure email/SMS providers

3. **Deploy to Production:**
   - Follow deployment guide
   - Set up monitoring
   - Configure alerts

---

## Quick Reference

**Service URLs:**
- API: http://localhost:8000
- Swagger Docs: http://localhost:8000/docs
- Health: http://localhost:8000/health
- Agent Health: http://localhost:8000/health/agents
- Metrics: http://localhost:8000/admin/metrics

**Logs Location:**
- `services/agent-orchestrator/logs/agent-orchestrator.log`

**Configuration:**
- `.env` file in `services/agent-orchestrator/`

