# 🚀 Quick Guide: Run Schema Migration

## Option 1: Supabase Dashboard (Recommended - 5 minutes)

### Step-by-Step:

1. **Open Supabase Dashboard**
   - Go to: https://supabase.com/dashboard
   - Select your project (ID: `exzueerziesmczwlhomd`)

2. **Open SQL Editor**
   - Click **SQL Editor** in the left sidebar
   - Click **New Query** button (top right)

3. **Copy Migration Script**
   - Generate the file (once): `python3 scripts/concat_migrations.py`
   - Open file: `md_files/02-architecture/FULL_MIGRATIONS.sql`
   - Copy **ALL** contents (Cmd/Ctrl + A, then Cmd/Ctrl + C)

4. **Paste & Run**
   - Paste into SQL Editor (Cmd/Ctrl + V)
   - Click **Run** button (or press Cmd/Ctrl + Enter)
   - Wait 30-60 seconds for execution

5. **Verify Success**
   - You should see: "Success. No rows returned"
   - Check for any errors in the output

### ✅ Verification Queries

After running, verify tables were created:

```sql
-- Check new tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('order_interactions', 'manager_preferences', 'unit_conversions', 'rfq_requests');

-- Check new columns added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'restaurant_inventory' 
AND column_name IN ('is_optional_tracking', 'target_price', 'max_price', 'current_volume_ml', 'unit_type', 'is_generic_bucket', 'velocity_weight', 'sku');

SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'procurement_orders' 
AND column_name IN ('state_machine_state', 'is_recurring', 'cron_schedule', 'total_estimated_cost', 'final_confirmed_cost', 'negotiation_attempts', 'last_negotiation_at', 'is_offline_sync');
```

---

## Option 2: Using Helper Script

Run the helper script:

```bash
cd "Restaurant AI Automation"
./scripts/run_migration.sh
```

This will:
- Show you the migration file location
- Give you options to view/copy the file
- Display step-by-step instructions

---

## Option 3: Supabase CLI (If Installed)

If you have Supabase CLI installed:

```bash
# Link to your project (if not already linked)
supabase link --project-ref exzueerziesmczwlhomd

# Run migration
supabase db push --file md_files/02-architecture/FULL_MIGRATIONS.sql
```

---

## What This Migration Adds

This file applies **all versioned migrations** from `services/database/migrations` in order. It is the single source of truth for the database schema.

---

## Troubleshooting

### Error: "function update_updated_at_column() does not exist"

If you get this error, you need to create the trigger function first:

```sql
-- Create the trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

Then re-run the migration.

### Error: "relation already exists"

The migration uses `IF NOT EXISTS` so it's safe to re-run. If you see this, the table/column already exists - that's fine!

### Error: "permission denied"

Make sure you're using the **Service Role Key** or have admin access to the database.

---

## Next Steps After Migration

1. ✅ Verify all tables/columns were created (use verification queries above)
2. ✅ Test repository methods in your code
3. ✅ Start the agent orchestrator (agents will use new repositories)
4. ✅ Test new agents in mock mode

---

## Need Help?

- Check: `md_files/05-guides-setup/SUPABASE_INTEGRATION.md`
- Migration file: `md_files/02-architecture/FULL_MIGRATIONS.sql`
- Summary: `md_files/04-updates-builds/FOUNDATION_PHASE2_COMPLETE.md`

