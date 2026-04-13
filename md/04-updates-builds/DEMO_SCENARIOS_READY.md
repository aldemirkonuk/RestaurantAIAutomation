# 🎬 Demo Scenarios Ready

**Date:** January 15, 2026  
**Status:** COMPLETE

---

## ✅ What Was Created

### 1. 📦 Demo Ordering Scenario
**File:** `services/agent-orchestrator/demo/demo_ordering_scenario.py`

Full procurement workflow simulation:

```
Low Stock (th=4, cur=3) 
    ↓
📱 Manager Push Notification
    ↓
👤 Manager Approves (price, quantity, vendor)
    ↓
🤖 AI Sends Email + SMS to Vendor
    ↓
📨 Vendor Responds with Offer
    ↓
🧠 AI Summarizes Conversation
    ↓
👤 Manager Final Approval (pending → approved)
    ↓
🤖 AI Confirms Order with Vendor
    ↓
📦 Order Status: ORDERED
    ↓
🚚 Delivery Arrives
    ↓
🔍 Invoice Verification (OCR)
    ↓
✅ Everything Matches
    ↓
👤 Manager Finalizes
    ↓
📊 Inventory Updated (3 → 15)
    ↓
💰 Financial Reports Updated
```

**Run:**
```bash
cd "Restaurant AI Automation/services/agent-orchestrator"
source venv/bin/activate
python demo/demo_ordering_scenario.py
```

---

### 2. 📅 Weekly Report Scheduler
**File:** `services/agent-orchestrator/demo/weekly_report_scheduler.py`

Schedules weekly reports for Monday 9 AM:
- Sales summary (7-day)
- Financial overview
- Orders review
- Inventory status
- Low stock alerts

**Run:**
```bash
# Run reports immediately (test)
python demo/weekly_report_scheduler.py --now

# Run as scheduler daemon (production)
python demo/weekly_report_scheduler.py --schedule
```

---

### 3. 📊 Inventory Sync from Supabase
**File:** `services/agent-orchestrator/scripts/sync_inventory_from_supabase.py`

Ensures inventory numbers match Supabase:
- Single source of truth (Supabase)
- No manual editing required
- Real-time sync capability
- Cache updates for performance

**Run:**
```bash
# Single sync
python scripts/sync_inventory_from_supabase.py --once

# Periodic sync (every 5 minutes)
python scripts/sync_inventory_from_supabase.py --watch

# Filter by restaurant
python scripts/sync_inventory_from_supabase.py --once --restaurant <uuid>
```

---

### 4. 🍷 Master Wine Library Dataset
**Files:**
- `services/agent-orchestrator/data/master_wine_library_seed.json`
- `services/agent-orchestrator/scripts/seed_master_wine_library.py`

Foundation for wine intelligence:
- **20 curated wines** (expandable)
- **14 grape varieties** with characteristics
- **14 wine regions** with specialties
- **Food pairing matrix**
- **Barcode mappings**

**Seed the database:**
```bash
# Add wines to Supabase
python scripts/seed_master_wine_library.py

# Clear and reseed
python scripts/seed_master_wine_library.py --clear
```

---

## 📁 File Structure

```
services/agent-orchestrator/
├── demo/
│   ├── __init__.py
│   ├── demo_ordering_scenario.py      # Full procurement demo
│   └── weekly_report_scheduler.py     # Monday 9 AM reports
├── data/
│   ├── __init__.py
│   └── master_wine_library_seed.json  # Wine database seed
└── scripts/
    ├── seed_master_wine_library.py    # Seed wines to Supabase
    └── sync_inventory_from_supabase.py # Inventory sync
```

---

## 🚀 Quick Start

### Run the Full Demo

```bash
cd "Restaurant AI Automation/services/agent-orchestrator"
source venv/bin/activate

# 1. Seed the wine library first
python scripts/seed_master_wine_library.py

# 2. Sync inventory
python scripts/sync_inventory_from_supabase.py --once

# 3. Run the demo scenario
python demo/demo_ordering_scenario.py
```

### Expected Output

```
🎬 WINEOPS AI - DEMO ORDERING SCENARIO
============================================================

📊 STEP 1: Low Stock Detection
   Wine: Château Demo Reserve 2019
   Current Stock: 3 bottles
   Threshold: 4 bottles
   Status: ⚠️ BELOW THRESHOLD

📱 STEP 2: Manager Push Notification
   📲 Push Notification Sent:
   Title: ⚠️ Low Stock Alert
   Body: Château Demo Reserve 2019 is running low (3/4 bottles)

👤 STEP 3: Manager Approves Order
   📝 Manager's Order Configuration:
   Quantity: 12 bottles
   Target Price: $24.00/bottle
   ...

🤖 STEP 4: AI Contacts Vendor
   📧 Email Sent to: orders@demowine.com
   📱 SMS Sent to: +1987654321

📨 STEP 5: Vendor Responds
   Vendor confirmed availability, offered $25.50/bottle

🧠 STEP 6: AI Summarizes Conversation
   🤖 AI Recommendation: APPROVE - Price is within max budget

✅ STEP 7: Manager Final Approval
   Order status: PENDING → APPROVED

... (continues through all 13 steps)

🎉 DEMO SCENARIO COMPLETED SUCCESSFULLY!
   Inventory: 3 → 15 bottles
   Status: COMPLETED ✅
```

---

## 🍷 Wine Data Hierarchy - Your Biggest Power

```
┌─────────────────────────────────────────────────────────────────┐
│  MASTER WINE LIBRARY (Global - Every Wine in the World)        │
│  • Open for all restaurants                                     │
│  • No exclusions - comprehensive wine database                  │
│  • QR code generation (already implemented)                     │
│  • AI enrichment via Sommelier Agent                           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  WINE LIBRARY (Restaurant-Specific Selections)                  │
│  • Manager curated selections                                   │
│  • Specialized for each restaurant's style                      │
│  • Linked to Master Wine Library                               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  INVENTORY (Physical Stock + Menu Items)                        │
│  • Actual bottles on hand                                       │
│  • Threshold management                                         │
│  • Procurement triggers                                         │
└─────────────────────────────────────────────────────────────────┘
```

The seed dataset includes:

### Wine Categories
- **Red:** Cabernet Sauvignon, Merlot, Pinot Noir, Malbec, Nebbiolo
- **White:** Chardonnay, Sauvignon Blanc, Riesling
- **Sparkling:** Champagne, Prosecco
- **Rosé:** Provence styles
- **Dessert:** Port, Sauternes

### Included Wines
1. Château Margaux 2015 (Bordeaux)
2. Opus One 2019 (Napa Valley)
3. Sassicaia 2018 (Tuscany)
4. Dom Pérignon 2012 (Champagne)
5. Cloudy Bay Sauvignon Blanc 2023 (Marlborough)
6. Penfolds Grange 2017 (South Australia)
7. Whispering Angel Rosé 2023 (Provence)
8. Château d'Yquem 2017 (Sauternes)
9. Tignanello 2019 (Tuscany)
10. Veuve Clicquot Brut NV (Champagne)
11. Caymus Cabernet Sauvignon 2020 (Napa)
12. Barolo Monfortino 2015 (Piedmont)
13. Puligny-Montrachet 2020 (Burgundy)
14. Catena Zapata Malbec 2019 (Mendoza)
15. Don Melchor 2018 (Chile)
16. Dr. Loosen Riesling 2021 (Mosel)
17. Taylor's Vintage Port 2017 (Douro)
18. Krug Grande Cuvée NV (Champagne)
19. Silver Oak Cabernet 2018 (Alexander Valley)
20. Château Mouton Rothschild 2016 (Pauillac)

### Features for Each Wine
- Name, Producer, Region, Country
- Grape varieties
- Vintage
- Wine type
- Alcohol content
- Tasting notes
- Food pairings
- Price range
- Rating
- Barcode (for scanning)

### Expansion Plan
The seed is designed to be expanded with:
- More wines (target: 1000+)
- API enrichment (Wine-Searcher, Vivino)
- User contributions
- Sommelier Agent auto-enrichment

---

## 🔗 Integration Points

### Frontend Integration
```javascript
// Subscribe to inventory updates
socket.on('inventory.synced', (data) => {
  updateInventoryDisplay(data.items);
});

// Subscribe to low stock alerts
socket.on('stock.threshold.breached', (data) => {
  showLowStockAlert(data);
});
```

### API Endpoints
```
GET  /api/v1/inventory                    # Get all inventory
GET  /api/v1/inventory/:id                # Get single item
POST /api/v1/inventory/sync               # Trigger sync
GET  /api/v1/wines                        # Get wine library
GET  /api/v1/wines/search?q=cabernet      # Search wines
```

---

## 📊 Database Tables Used

1. **restaurant_inventory** - Stock levels
2. **master_wine_library** - Wine database
3. **procurement_orders** - Order tracking
4. **order_interactions** - Communication logs
5. **manager_preferences** - Notification settings
6. **providers** - Vendor information

---

## ✅ Success Checklist

- [x] Demo ordering scenario created
- [x] Weekly report scheduler created
- [x] Inventory sync service created
- [x] Master wine library seed data created
- [x] Seeder script created
- [x] All files tested for syntax errors

---

## 🎯 Next Steps

1. **Run the demo** to see the full workflow
2. **Seed the wine library** to populate your database
3. **Sync inventory** to ensure data consistency
4. **Schedule weekly reports** for Monday 9 AM
5. **Expand the wine library** with more wines

---

## 📚 Related Documentation

- Agent Status: `md_files/04-updates-builds/AGENTS_STARTED_SUCCESSFULLY.md`
- Migration Guide: `md_files/02-architecture/RUN_MIGRATION_GUIDE.md`
- Next Steps: `md_files/02-architecture/NEXT_STEPS_AFTER_MIGRATION.md`

