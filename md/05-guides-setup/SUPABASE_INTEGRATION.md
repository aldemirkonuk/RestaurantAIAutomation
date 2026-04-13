# 🔌 Supabase Integration Guide

Complete guide for setting up and using Supabase in WineOps AI.

---

## 📋 Prerequisites

- ✅ Supabase account created
- ✅ Project created: `exzueerziesmczwlhomd`
- ✅ Credentials obtained (URL, Anon Key, Service Role Key)
- ✅ Database schema ready: `md_files/02-architecture/DATABASE_SCHEMA.sql`

---

## 🚀 Quick Setup (5 Minutes)

### Step 1: Create Database Schema

1. Go to your Supabase project: https://supabase.com/dashboard/project/exzueerziesmczwlhomd
2. Click **SQL Editor** in the left sidebar
3. Click **New Query**
4. Copy the entire contents of `md_files/02-architecture/DATABASE_SCHEMA.sql`
5. Paste into the SQL Editor
6. Click **Run** (or press Cmd/Ctrl + Enter)
7. Wait 30-60 seconds for all tables to be created

**Verify Tables:**
- Go to **Table Editor** in the left sidebar
- You should see 24+ tables created
- Check for tables like: `master_wine_library`, `restaurant_inventory`, `procurement_orders`, etc.

### Step 2: Enable Extensions

The schema should automatically enable extensions, but verify:

```sql
-- Check enabled extensions
SELECT * FROM pg_extension;

-- If vector extension is missing, enable it:
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

### Step 3: Enable Realtime (Optional but Recommended)

1. Go to **Database** → **Replication** in Supabase dashboard
2. Enable Realtime for these tables:
   - `restaurant_inventory`
   - `procurement_orders`
   - `notifications`
   - `sales_events`

**Using SQL:**
```sql
-- Enable Realtime for key tables
ALTER PUBLICATION supabase_realtime ADD TABLE restaurant_inventory;
ALTER PUBLICATION supabase_realtime ADD TABLE procurement_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE sales_events;
```

### Step 4: Configure Environment Variables

Environment variables are already configured in:
- `.env` (root)
- `apps/web/.env.local` (React frontend)
- `apps/api-gateway/.env` (NestJS)
- `services/agent-orchestrator/.env` (FastAPI)

**Verify they're set:**
```bash
# Check root .env
cat .env | grep SUPABASE

# Check React frontend
cat apps/web/.env.local | grep VITE_SUPABASE

# Check NestJS
cat apps/api-gateway/.env | grep SUPABASE

# Check FastAPI
cat services/agent-orchestrator/.env | grep SUPABASE
```

---

## 🔐 Security: Row Level Security (RLS)

### Enable RLS on Tables

```sql
-- Enable RLS on sensitive tables
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE managers ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Example RLS policy (adjust based on your auth requirements)
-- Managers can only see their own restaurant's data
CREATE POLICY "Managers can view their restaurant's inventory"
  ON restaurant_inventory
  FOR SELECT
  USING (
    restaurant_id IN (
      SELECT restaurant_id 
      FROM managers 
      WHERE user_id = auth.uid()
    )
  );
```

**For Development:**
- You can disable RLS temporarily: `ALTER TABLE restaurant_inventory DISABLE ROW LEVEL SECURITY;`
- Use Service Role Key for backend services (bypasses RLS)
- Use Anon Key for frontend (respects RLS)

---

## 🏗️ Architecture Overview

### Frontend (React) → Supabase
- **Client**: `apps/web/src/lib/supabase.ts`
- **Key**: Anon Key (public, safe for browser)
- **Purpose**: Direct database queries, real-time subscriptions
- **Used For**: Inventory, orders, wine library, dashboard stats

### API Gateway (NestJS) → Supabase
- **Service**: `apps/api-gateway/src/database/database.service.ts`
- **Key**: Service Role Key (server-side only, bypasses RLS)
- **Purpose**: Backend operations, admin queries
- **Used For**: Auth, server-side data operations

### Agent Orchestrator (FastAPI) → Supabase
- **Client**: `services/agent-orchestrator/core/database.py`
- **Key**: Service Role Key (server-side only)
- **Purpose**: Agent operations, batch processing
- **Used For**: Inventory updates, order processing, notifications

---

## 📦 Package Integration

### React Frontend

**Installation:**
```bash
cd apps/web
pnpm install @supabase/supabase-js
```

**Usage:**
```typescript
import { supabase } from '@/lib/supabase'

// Get wines
const wines = await getWines({ search: 'Cabernet', limit: 20 })

// Get inventory
const inventory = await getInventory(restaurantId, { lowStockOnly: true })

// Real-time subscription
const subscription = subscribeToInventoryChanges(restaurantId, (payload) => {
  console.log('Inventory changed:', payload)
})
```

### NestJS API Gateway

**Installation:**
```bash
cd apps/api-gateway
pnpm install @supabase/supabase-js
```

**Usage:**
```typescript
import { DatabaseService } from './database/database.service'

// Inject service
constructor(private databaseService: DatabaseService) {}

// Use in controller
const inventory = await this.databaseService.getRestaurantInventory(restaurantId)
```

### FastAPI Agent Orchestrator

**Installation:**
```bash
cd services/agent-orchestrator
pip install supabase==2.3.4
```

**Usage:**
```python
from core.database import DatabaseClient

# Initialize client
db = DatabaseClient(
    supabase_url=settings.SUPABASE_URL,
    supabase_key=settings.SUPABASE_SERVICE_ROLE_KEY
)

# Use repositories
inventory = db.inventory.get_low_stock_items(restaurant_id)
```

---

## 🔍 Testing Connection

### Test from Frontend (Browser Console)

```javascript
// In browser console on localhost:3000
import { supabase } from './lib/supabase'

// Test connection
const { data, error } = await supabase
  .from('master_wine_library')
  .select('count')
  .limit(1)

console.log('Connection:', error ? 'Failed' : 'Success', data)
```

### Test from NestJS

```bash
cd apps/api-gateway
pnpm run start:dev

# Check logs for: "✅ Supabase client initialized"
```

### Test from FastAPI

```bash
cd services/agent-orchestrator
source venv/bin/activate
python3 main.py

# Check logs for: "✅ Supabase client initialized"
# Or visit: http://localhost:8000/api/v1/health
```

### Test Database Schema

```sql
-- In Supabase SQL Editor
-- Check table counts
SELECT 
  schemaname,
  tablename,
  (SELECT COUNT(*) FROM pg_stat_user_tables WHERE relname = tablename) as row_count
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- Check specific tables
SELECT COUNT(*) FROM master_wine_library;
SELECT COUNT(*) FROM restaurant_inventory;
SELECT COUNT(*) FROM procurement_orders;
```

---

## 📊 Database Types Generation (TypeScript)

### Option 1: Supabase CLI (Recommended)

```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link to your project
supabase link --project-ref exzueerziesmczwlhomd

# Generate types
supabase gen types typescript --linked > packages/database/src/types/database.types.ts
```

### Option 2: Manual Types

Types are already defined in:
- `apps/web/src/lib/supabase.ts` - Frontend types
- `packages/database/src/types/database.types.ts` - Shared types

---

## 🔄 Real-time Subscriptions

### Frontend Real-time Example

```typescript
import { subscribeToInventoryChanges } from '@/lib/supabase'

// Subscribe to inventory changes
useEffect(() => {
  const subscription = subscribeToInventoryChanges(restaurantId, (payload) => {
    if (payload.eventType === 'UPDATE') {
      // Update local state
      setInventory(prev => prev.map(item => 
        item.inventory_id === payload.new.inventory_id 
          ? payload.new 
          : item
      ))
    }
  })

  return () => {
    subscription.unsubscribe()
  }
}, [restaurantId])
```

### Enable Realtime on Specific Columns

```sql
-- Enable Realtime for specific columns only (more efficient)
ALTER PUBLICATION supabase_realtime ADD TABLE restaurant_inventory (
  inventory_id, restaurant_id, stock_live, stock_shadow, updated_at
);
```

---

## 🛠️ Troubleshooting

### Issue: "Supabase client not initialized"

**Solution:**
1. Check environment variables are set correctly
2. Restart the service/application
3. Check logs for initialization errors

### Issue: "Invalid API key"

**Solution:**
1. Verify keys in Supabase dashboard: **Project Settings** → **API**
2. Check `.env` files have correct keys
3. Ensure no extra spaces or quotes around keys

### Issue: "Table does not exist"

**Solution:**
1. Run the schema SQL in Supabase SQL Editor
2. Check table names match exactly (case-sensitive)
3. Verify you're using the correct database/schema

### Issue: "RLS policy violation"

**Solution:**
1. For development: Disable RLS temporarily
2. For production: Create proper RLS policies
3. For backend: Use Service Role Key (bypasses RLS)

### Issue: "Realtime not working"

**Solution:**
1. Enable Realtime in Supabase dashboard: **Database** → **Replication**
2. Check table is in the replication publication
3. Verify WebSocket connection is allowed (not blocked by firewall)

### Issue: "Connection timeout"

**Solution:**
1. Check Supabase project is not paused (free tier pauses after inactivity)
2. Verify network connectivity
3. Check firewall allows connections to `*.supabase.co`

---

## 📚 Additional Resources

- **Supabase Dashboard**: https://supabase.com/dashboard/project/exzueerziesmczwlhomd
- **Supabase Docs**: https://supabase.com/docs
- **Database Schema**: `md_files/02-architecture/DATABASE_SCHEMA.sql`
- **Credentials**: `md_files/05-guides-setup/CREDENTIALS_CHECKLIST.md`
- **Setup Guide**: `md_files/01-getting-started/SETUP_GUIDE.md`

---

## ✅ Verification Checklist

- [ ] Database schema created (24+ tables)
- [ ] Extensions enabled (uuid-ossp, vector, pg_trgm)
- [ ] Environment variables configured for all services
- [ ] Frontend can connect (check browser console)
- [ ] NestJS can connect (check startup logs)
- [ ] FastAPI can connect (check startup logs)
- [ ] Realtime enabled for key tables
- [ ] RLS policies created (or disabled for development)
- [ ] TypeScript types generated (optional but recommended)
- [ ] Test queries work from all services

---

## 🎯 Next Steps

1. **Seed Database**: Run `scripts/seed_database.py` to populate initial data
2. **Test Queries**: Verify CRUD operations work from all services
3. **Enable RLS**: Set up Row Level Security policies for production
4. **Monitor**: Check Supabase dashboard for usage and performance
5. **Backup**: Set up automated backups in Supabase dashboard

---

**🎉 Your Supabase integration is complete!**

For questions or issues, check the troubleshooting section above or refer to the Supabase documentation.

