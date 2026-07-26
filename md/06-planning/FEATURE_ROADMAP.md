# 🗺️ Mudavym — Complete Feature Roadmap

**Version:** 2.1 (Mudavym futures — beverages → bakery → kitchen)  
**Last Updated:** July 26, 2026  
**Status:** Active development + living futures (see [`.planning/FUTURES.md`](../../.planning/FUTURES.md))

---

## 🎯 EXECUTIVE SUMMARY

This roadmap covers Mudavym (evolving from WineOps AI): a full autonomous restaurant backend. Wine remains the first vertical and extraction quality bar. Expansion order is locked: **wine → full beverages → bakery → rest of kitchen**. Near-term delivery still follows the phased build below; product expansion detail lives in FUTURES.md and ROADMAP backlog 999.2–999.4.

**Total Timeline:** 14 weeks to full wine-platform baseline (excluding Sommelier AI / Mudavym expansion stages)  
**MVP Timeline:** 2 weeks  
**Critical Path Features:** Mobile App, Vintage Substitution Rules  
**Futures:** Full beverages + bakery MVP + kitchen — not scheduled until wine inventory trust is earned

---

## 📊 FEATURE PRIORITY MATRIX

```
┌─────────────────────────────────────────────────────────────┐
│  PRIORITY LEVELS                                            │
├─────────────────────────────────────────────────────────────┤
│  🔴 RIGHT NOW    - Add to current MVP (Week 1-2)           │
│  🟠 MUST         - Critical path features                   │
│  🟡 FUTURE NOW   - Phase 2-3 (Week 3-8)                    │
│  🟢 YES          - Standard phasing (Week 3-14)             │
│  🔵 FUTURE LATER - Not in immediate plans                   │
│  🟣 SOMMELIER AI - Separate project                         │
│  ⚪ WAY FUTURE   - Long-term vision                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔴 RIGHT NOW - MVP ADDITIONS (Week 1-2)

### Provider Communication Templates
**Priority:** IMMEDIATE  
**Timeline:** Week 2  
**Complexity:** Low-Medium

**Features:**
- Manager creates custom message templates
- Variable system: `{wine_name}`, `{quantity}`, `{last_price}`, `{provider_name}`
- Template categories: Order Request, Price Inquiry, Delivery Confirmation, Follow-up
- Version control with history
- Template preview before sending
- Default templates included

**Technical Requirements:**
```typescript
interface MessageTemplate {
  id: string;
  name: string;
  category: 'order' | 'inquiry' | 'confirmation' | 'followup';
  template_text: string;  // "Hi {provider_name}, I'd like to order {quantity} cases of {wine_name}..."
  variables: string[];    // ['provider_name', 'wine_name', 'quantity']
  version: number;
  is_active: boolean;
  created_by: string;
  created_at: timestamp;
}
```

**Database Table:**
```sql
CREATE TABLE message_templates (
  id UUID PRIMARY KEY,
  restaurant_id UUID REFERENCES restaurants(id),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50),
  template_text TEXT NOT NULL,
  variables JSONB,
  version INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**UI Components:**
- Template library page
- Template editor with variable picker
- Preview modal with sample data
- Version history viewer

---

## 🟠 MUST-HAVE FEATURES (Critical Path)

### 1. Mobile App (Native)
**Priority:** MUST  
**Timeline:** Week 5-8 (Phase 3)  
**Complexity:** High

**Platform:** React Native (iOS + Android)

**Core Features:**
- ✅ Real-time inventory view
- ✅ Push notifications (better than SMS)
- ✅ One-tap approvals
- ✅ Camera integration (wine label scanning)
- ✅ Offline mode (view cached data)
- ✅ Manual inventory adjustments
- ✅ Order status tracking
- ✅ Quick reports (daily snapshot)

**Technical Stack:**
- React Native 0.73+
- Expo for easier development
- React Native Firebase (push notifications)
- React Native Camera (label scanning)
- AsyncStorage (offline mode)
- WebSocket connection to API Gateway

**Development Phases:**
- Week 5: Project setup, authentication, basic navigation
- Week 6: Inventory views, WebSocket integration
- Week 7: Camera integration, offline mode
- Week 8: Push notifications, polish, testing

**Success Criteria:**
- Works offline for 24+ hours
- Push notification delivery >95%
- App loads in <2 seconds
- Camera can scan labels successfully

---

### 2. Vintage Substitution Rules
**Priority:** MUST  
**Timeline:** Week 2-3 (MVP → Phase 2)  
**Complexity:** Medium

**Features:**
- Manager defines substitution rules per wine
- Auto-suggest alternative vintages when primary unavailable
- Price adjustment logic
- Approval workflow for substitutions
- Provider communication about vintage changes

**Rules Engine:**
```typescript
interface SubstitutionRule {
  wine_id: string;
  primary_vintage: number;
  acceptable_vintages: number[];  // [2019, 2021]
  price_adjustment_percent: number;  // +10% for older, -5% for newer
  auto_approve: boolean;  // If true, skip manager approval
  notes: string;
}
```

**Use Cases:**
1. **Ordering:** "2020 Cabernet unavailable, suggest 2019 or 2021"
2. **Pricing:** "2019 is aged, suggest $5 markup"
3. **Inventory:** "Low on 2020, substitute with 2021 vintage"

**Database Table:**
```sql
CREATE TABLE vintage_substitution_rules (
  id UUID PRIMARY KEY,
  restaurant_id UUID REFERENCES restaurants(id),
  master_wine_id UUID REFERENCES master_wine_library(id),
  primary_vintage INTEGER,
  acceptable_vintages INTEGER[],
  price_adjustment_rules JSONB,
  auto_approve BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 🟡 FUTURE NOW - Active Roadmap (Phase 2-3)

### 1. Advanced Analytics
**Timeline:** Week 4-5 (Phase 2)  
**Complexity:** Medium

**Features:**
- **Sales by Server:** Leaderboard, performance tracking
- **Time-of-Day Trends:** Hourly breakdown, heatmap visualization
- **Table Turnover Correlation:** Wine sales vs table time
- **Customer Demographics:** If POS captures this data
- **Profitability Analysis:** Margin by wine, category, time period

**Visualizations:**
- Heatmap: Sales by day/hour (Tradezella-style)
- Line charts: Trends over time
- Bar charts: Top performers
- Scatter plots: Price vs velocity correlation

**Implementation:**
- Materialized views in PostgreSQL for performance
- Tremor charts for visualization
- Export to Excel/PDF with charts
- Scheduled report generation

---

### 2. Provider Performance Dashboard
**Timeline:** Week 3-4 (Phase 2)  
**Complexity:** Low-Medium

**Metrics Tracked:**
- On-time delivery rate (%)
- Average response time (hours)
- Price consistency score
- Order fulfillment rate
- Quality issues count
- Communication sentiment (AI-analyzed)

**Dashboard Features:**
- Provider comparison table
- Performance trends over time
- Reliability score calculation
- Alert for declining performance

**Database Enhancement:**
```sql
ALTER TABLE providers ADD COLUMN performance_metrics JSONB;

-- Structure:
{
  "on_time_delivery_rate": 0.95,
  "avg_response_time_hours": 4.2,
  "price_consistency_score": 0.88,
  "order_fulfillment_rate": 0.92,
  "quality_issues_count": 2,
  "last_calculated": "2026-01-07T10:00:00Z"
}
```

---

### 3. Customizable Dashboard
**Timeline:** Week 6-7 (Phase 3)  
**Complexity:** Medium

**Features:**
- Drag-and-drop widget system
- Widget library:
  - Inventory status cards
  - Low stock alerts
  - Sales charts
  - Financial summary
  - Provider status
  - Calendar events
  - Recent orders
- Save custom layouts per user
- Preset layouts (Executive, Operations, Finance)
- Export dashboard as PDF

**Technical:**
- React Grid Layout library
- Widget state management (Zustand)
- Layout persistence in database
- Responsive breakpoints

---

## 🟢 YES - Standard Phasing

### PHASE 2 (Week 3-6)

#### Smart Reorder Suggestions
**Week:** 4  
**Complexity:** Medium-High

**AI Calculation:**
```python
def calculate_optimal_reorder_quantity(wine_id):
    # Factors:
    velocity_7d = get_sales_velocity(wine_id, days=7)
    velocity_30d = get_sales_velocity(wine_id, days=30)
    upcoming_events = get_calendar_events(next_30_days)
    seasonal_factor = get_seasonal_multiplier(current_month)
    storage_capacity = get_available_storage()
    
    # Algorithm
    base_quantity = velocity_7d * 14  # 2-week supply
    event_adjustment = sum([e.expected_volume_increase for e in upcoming_events])
    seasonal_adjustment = base_quantity * seasonal_factor
    
    optimal = base_quantity + event_adjustment + seasonal_adjustment
    
    # Constraints
    optimal = min(optimal, storage_capacity)
    optimal = round_to_case_quantity(optimal)
    
    return {
        'quantity': optimal,
        'reasoning': "Based on 7-day velocity...",
        'confidence': 0.85
    }
```

---

#### Batch Operations
**Week:** 3  
**Complexity:** Medium

**Operations:**
1. **Bulk Inventory Adjustment**
   - Select 10+ wines
   - Apply same adjustment (add/subtract quantity)
   - Fat-finger guard applies to batch total

2. **Batch Reordering**
   - Select multiple wines from same provider
   - Single order with multiple items
   - Combined approval

3. **Bulk Price Updates**
   - Apply margin change to category
   - E.g., "Increase all reds by 10%"
   - Preview changes before applying

**UI Flow:**
- Checkbox selection in inventory table
- Batch action dropdown
- Preview modal showing all changes
- Single approval for entire batch

---

#### Multi-Provider Price Comparison
**Week:** 5  
**Complexity:** Medium

**Features:**
- Request quotes from 3+ providers simultaneously
- Side-by-side comparison table
- Historical price charts per provider
- Alert if provider prices diverging
- One-click order with best price

**Workflow:**
1. System detects low stock
2. AI sends quote requests to primary + 2 alternatives
3. Collect responses
4. Present comparison to manager
5. Manager selects best offer
6. System confirms order

---

#### Advanced Audit Features
**Week:** 5  
**Complexity:** Medium

**Features:**
- Download full audit trail (CSV/PDF/Excel/Sheets/Drive)
- Advanced filters:
  - Date range picker
  - User/actor filter
  - Action type filter
  - Entity type filter
- Suspicious activity detection (ML-based):
  - Unusual stock adjustments
  - Off-hours modifications
  - Repeated failed approvals
- ABC Compliance reports:
  - Inventory audits
  - Purchase logs
  - Tax documentation

**Export Formats:**
```typescript
interface AuditExportOptions {
  format: 'csv' | 'pdf' | 'excel' | 'sheets' | 'drive';
  date_range: { start: Date; end: Date };
  filters: {
    users?: string[];
    action_types?: string[];
    entity_types?: string[];
  };
  include_raw_data: boolean;
  compliance_template?: 'abc' | 'tax' | 'general';
}
```

---

#### Role-Based Access Control (RBAC)
**Week:** 3  
**Complexity:** Low-Medium

**Hierarchy:**
```
Owner = Manager (same permissions)
  ├─ Full access to all features
  ├─ Can add/remove users
  └─ Can modify system settings

Assistant Manager
  ├─ View all data
  ├─ Edit inventory
  ├─ Approve orders <$500
  └─ Cannot delete data

Staff
  ├─ View inventory
  ├─ Record waste/spoilage
  └─ Cannot edit or approve
```

**Implementation:**
- Row-level security in Supabase
- Permission checks in API Gateway
- UI elements hidden based on role
- Audit log tracks role changes

---

#### Data Export Controls
**Week:** 4  
**Complexity:** Low

**Features:**
- Manager can export:
  - Inventory (current snapshot)
  - Sales history
  - Financial reports
  - Provider data
- Audit trail of exports (who, what, when)
- Watermarked PDFs with restaurant info
- Rate limiting (max 10 exports/day)

---

#### Notification Preferences
**Week:** 2  
**Complexity:** Low

**Manager Controls:**
```typescript
interface NotificationPreferences {
  low_stock_alerts: {
    enabled: boolean;
    channels: ('sms' | 'email' | 'push')[];
    threshold_override?: number;
  };
  order_approvals: {
    enabled: boolean;
    channels: ('sms' | 'email' | 'push')[];
  };
  delivery_notifications: {
    enabled: boolean;
    channels: ('sms' | 'email' | 'push')[];
  };
  financial_reports: {
    enabled: boolean;
    channels: ('email' | 'dashboard')[];
  };
  quiet_hours: {
    enabled: boolean;
    start_time: string;  // "22:00"
    end_time: string;    // "07:00"
    emergency_override: boolean;  // Allow urgent alerts
  };
  alert_grouping: {
    enabled: boolean;
    window_minutes: number;  // Batch similar alerts
  };
}
```

---

#### Budget Management
**Week:** 5  
**Complexity:** Low-Medium

**Features:**
- Set monthly wine budget
- Track spend vs budget in real-time
- Alert at 75%, 90%, 100% of budget
- Category-level budgets:
  - Reds: $5,000/month
  - Whites: $3,000/month
  - Sparkling: $2,000/month
- Historical budget performance
- Forecast month-end spend

**Dashboard Widget:**
```
┌────────────────────────────────────┐
│ Wine Budget - January 2026         │
├────────────────────────────────────┤
│ Total: $8,450 / $10,000 (85%)     │
│ ████████████████░░░░               │
│                                    │
│ Reds:      $4,200 / $5,000        │
│ Whites:    $2,800 / $3,000        │
│ Sparkling: $1,450 / $2,000        │
│                                    │
│ Projected: $9,200 (92%)           │
│ ⚠️ On track to exceed budget       │
└────────────────────────────────────┘
```

---

#### Wine List Generator
**Week:** 6  
**Complexity:** Medium

**Features:**
- Auto-generate printable wine list from live inventory
- Customizable templates:
  - Classic elegant
  - Modern minimalist
  - Detailed with tasting notes
- Filter options:
  - Show only in-stock wines
  - Group by type/region
  - Include prices (yes/no)
- QR code menu generation
- Live preview
- Export formats: PDF, PNG, HTML
- Auto-update when stock changes

**Templates:**
```
Template 1: Classic
┌─────────────────────────────────┐
│     WINE LIST                   │
│                                 │
│ RED WINES                       │
│ Caymus Cabernet 2020........$85│
│ Opus One 2019..............$250│
│                                 │
│ WHITE WINES                     │
│ ...                             │
└─────────────────────────────────┘
```

---

#### Google Sheets Live Sync
**Week:** 6  
**Complexity:** Medium-High

**Phase 1: One-Way Export (Week 6)**
- Export inventory to Google Sheets
- Real-time updates (WebSocket → Sheets API)
- Formatted templates
- Auto-refresh every 5 minutes

**Phase 2: Two-Way Sync (Week 10)**
- Manager edits in Sheets → Updates WineOps
- Conflict resolution logic
- Change highlighting
- Yield-to-Human protocol applies

**Implementation:**
- Google Sheets API integration
- OAuth 2.0 authentication
- Real-time sync via Cloud Functions
- Conflict detection algorithm

---

#### Keyboard Shortcuts
**Week:** 2  
**Complexity:** Low

**Shortcuts:**
```
Global:
Ctrl/Cmd + K    - Command palette
Ctrl/Cmd + /    - Show all shortcuts
Ctrl/Cmd + S    - Save current page
Esc            - Close modal

Navigation:
Ctrl/Cmd + 1   - Dashboard
Ctrl/Cmd + 2   - Inventory
Ctrl/Cmd + 3   - Reports
Ctrl/Cmd + 4   - Calendar
Ctrl/Cmd + 5   - Procurement

Actions:
Ctrl/Cmd + N   - New order
Ctrl/Cmd + R   - Refresh data
Ctrl/Cmd + F   - Search inventory
Ctrl/Cmd + E   - Export current view
Ctrl/Cmd + P   - Print

Quick Approvals:
Y or A         - Approve (when approval modal open)
N or R         - Reject
```

**UI Element:**
- Help panel (? button)
- Keyboard shortcut overlay
- Search shortcuts

---

### PHASE 3 (Week 7-10)

#### Storage Location Tracking
**Week:** 9  
**Complexity:** Medium-High

**Features:**
- Assign storage location to each wine
- Location hierarchy:
  - Zone (Cellar A, Cellar B)
  - Section (North Wall, South Wall)
  - Shelf (1-10)
  - Position (A-Z)
- Visual map of wine cellar
- Search by location
- Route optimization for staff
- Move wine between locations
- Capacity planning

**Database Schema:**
```sql
CREATE TABLE storage_locations (
  id UUID PRIMARY KEY,
  restaurant_id UUID,
  zone VARCHAR(50),
  section VARCHAR(50),
  shelf VARCHAR(50),
  position VARCHAR(50),
  capacity_bottles INTEGER,
  current_occupancy INTEGER,
  temperature_zone VARCHAR(50),  -- 'cool', 'cellar', 'room_temp'
  notes TEXT
);

ALTER TABLE restaurant_inventory 
ADD COLUMN storage_location_id UUID REFERENCES storage_locations(id);
```

**UI:**
- Interactive cellar map (SVG or Canvas)
- Click location to see wines
- Drag-and-drop to move wines
- Color-coded by occupancy level

---

## 🔵 FUTURE LATER (Not Immediate Plans)

### Wine Pairing Engine
**Timeline:** TBD  
**Complexity:** High

**Deferred Because:**
- Requires menu item database
- Complex ML for pairing recommendations
- Lower priority than core operations

**Future Implementation:**
- Integrate with menu management
- ML model trained on pairing data
- Sommelier AI can handle this

---

### Predictive Forecasting
**Timeline:** After 6+ months of data  
**Complexity:** High

**Deferred Because:**
- Requires historical data (3+ months minimum)
- ML model training needed
- Smart Reorder Suggestions provide similar value faster

---

### Profit Margin Optimizer
**Timeline:** TBD  
**Complexity:** Medium-High

**Deferred Because:**
- Pricing is sensitive, needs careful rollout
- Requires market research data
- Manual margin management works for MVP

---

### Reservation System Integration
**Timeline:** TBD  
**Complexity:** High

**Deferred Because:**
- Niche use case (not all restaurants use OpenTable/Resy)
- Complex API integrations
- Can be added when specific customer requests

---

### Payment Processing Integration
**Timeline:** TBD  
**Complexity:** Medium

**Deferred Because:**
- Most restaurants don't sell wine retail
- POS already handles payments
- Only needed if online wine sales feature added

---

## 🟣 SOMMELIER AI (Separate Project)

**Timeline:** After WineOps core is stable (Week 15+)  
**Scope:** Wine education, customer recommendations, training

### Features:

#### Wine Knowledge Base
- Comprehensive wine encyclopedia
- Region guides
- Grape variety education
- Winemaking process explanations

#### Onboarding Wizard
- Interactive setup for new restaurants
- Guided tour of features
- Sample data for testing
- Best practices training

#### Wine Aging Tracker
- Track wines that improve with age
- Optimal drinking window alerts
- Suggest price increases for aged inventory
- Cellar management recommendations

#### Tasting Notes Management
- Staff add tasting notes
- Customer feedback integration
- Popular tasting term analysis
- Flavor profile matching

#### AR Wine Label Scanner
- Point phone at bottle → see info overlay
- 3D vineyard visualization
- Customer-facing feature
- Educational content

**Why Separate:**
- Different user base (staff + customers vs managers)
- Educational focus vs operational focus
- Can be monetized separately
- Different development timeline

---

## ⚪ WAY FUTURE LATER (Long-Term Vision)

### Natural Language Queries
**Timeline:** 12+ months  
**Complexity:** Very High

**Example:**
- Manager: "Show me Cabernet sales during dinner rush last week"
- AI interprets and generates report
- Voice input support

**Requirements:**
- Advanced NLP model
- Query understanding engine
- Historical data for context

---

### Anomaly Detection
**Timeline:** 12+ months  
**Complexity:** High

**ML-Based Detection:**
- Sudden spike in spoilage
- Server selling 10x normal volume
- Price changes not matching margins
- Fraud patterns

**Requirements:**
- ML model training
- Baseline behavior establishment
- False positive handling

---

### Sentiment Analysis on Provider Conversations
**Timeline:** 9+ months  
**Complexity:** Medium

**Features:**
- Track provider mood over time
- Detect relationship deterioration
- Suggest when to switch providers
- Communication coaching

**Requirements:**
- NLP sentiment model
- Conversation history (already logging)
- Relationship scoring algorithm

---

### Mudavym — Full Beverages → Bakery → Kitchen
**Timeline:** Post–wine inventory trust (not scheduled) — see [`.planning/FUTURES.md`](../../.planning/FUTURES.md)  
**Complexity:** High  
**Brand:** Mudavym (WineOps evolves into the autonomous restaurant backend)

**North star:** Full autonomous backend for restaurants. Expansion order locked: **wine → full beverages → bakery (first food) → rest of kitchen**.

**Stage 1 — Beverages**
- Taxonomy: `beverage` → wine (red/white/rosé/sparkling/…), beer, cocktail, hard alcohol (whiskey/vodka/gin/…), NA
- Every item extracted to finest features + photos (same depth bar as wine)
- Cocktail **Recipes** in inventory row detail: build sheet, linked SKUs, pour specs, method, garnish, cost roll-up

**Stage 2 — Bakery (food subsection)**
- Ingredients + pars/alerts, recipes/build sheets, finished goods + waste, POS sell-through
- Ship a **smaller MVP** first (manual recipes + waste + simple POS decrement); full BOM/spoilage intelligence later

**Stage 3 — Rest of kitchen** — only after bakery earns the model

**UX anchor:** Inventory command table (`RowExpansion` on `/inventory`); wine bottle rows unchanged for composed-recipe panels.

**Dependencies:** Catalog taxonomy (`domain` / `subsection` / `subtype`), Phase 2 lots/ledger for pour-through and recipe costing.

---

### Mudavym — Guest Profiles, Ratings & Points (Share/Recommend)
**Timeline:** Backlog 999.1 (not scheduled) — see [`.planning/FUTURES.md`](../../.planning/FUTURES.md) §7  
**Complexity:** High

**Vision:** A second profile type for the **customers who come to see these restaurants**, existing independently of any restaurant org. Beli-style dish and restaurant ratings, follows, and discovery — plus **points earned for sharing and recommending**, with a bonus when a share converts (recipient signs up or logs a verified visit).

**Points integrity (locked):**
- Append-only points ledger; balance derived — same source-of-truth discipline as inventory
- Provisional points confirm only on verified visit / verified conversion; unconfirmed points expire
- Anti-abuse: no self-referral, duplicate-device checks, rate limits, review quality gate
- Redemption launches as **status/tiers**; perks are opt-in and funded per restaurant

**Restaurant value:** consent-based, k-anonymized audience segments; advocacy signal feeds par levels, promotions, and menu experiments in the ops backend.

**UX anchors:** `UX_PATHS_CATALOG.md` §W (`NEW-652…NEW-666`) + §AB (`NEW-861…NEW-885`).

**Dependencies:** Guest identity separate from restaurant membership roles, verified-visit channel (reservation/POS/QR), consent + privacy controls.

---

### Mudavym — Ask AI Action Creation
**Timeline:** Backlog 999.5 (not scheduled) — see [`.planning/FUTURES.md`](../../.planning/FUTURES.md) §8  
**Complexity:** High

**Vision:** The **Ask AI** button becomes an action composer that eases app complexity as Mudavym grows. Natural-language intent → allowlisted typed action card → human confirm → execute via existing APIs (draft PO, vendor email draft, calendar event, inventory transfer/waste, recipe start, insight→Act, deep-link nav).

**Contract:** Ask → propose → confirm → execute. No silent stock/money/email mutations. Unify Reports Ask AI pill, Wine Agent FAB, and contextual “Ask about this page” behind one schema.

**UX anchors:** `UX_PATHS_CATALOG.md` §AC (`NEW-886…NEW-910`); overlaps Wine Agent `NEW-644…646` and `NEW-688`.

**Dependencies:** Command palette + `recommendation_actions` / OneTap plumbing; real retrieval+tools replacing current Reports mock answers.

---

## 📊 COMPLETE TIMELINE OVERVIEW

```
WEEKS 1-2: MVP
├─ Core Features (POS, Buffer, Inventory, Alerts)
├─ Manager Approval UI
├─ Provider Communication Templates ⭐ NEW
├─ Notification Preferences ⭐ NEW
├─ RBAC (basic) ⭐ NEW
└─ Keyboard Shortcuts ⭐ NEW

WEEKS 3-4: PHASE 2A
├─ Batch Operations
├─ Smart Reorder Suggestions
├─ Advanced Analytics ⭐ PRIORITY
├─ Provider Performance Dashboard ⭐ PRIORITY
├─ Multi-Provider Price Comparison
└─ Advanced Audit Features

WEEKS 5-6: PHASE 2B
├─ Budget Management
├─ Data Export Controls
├─ Wine List Generator
├─ Google Sheets Sync (one-way)
└─ Vintage Substitution Rules ⭐ MUST

WEEKS 7-8: PHASE 3A
├─ Mobile App Development ⭐ MUST
├─ Customizable Dashboard ⭐ PRIORITY
└─ Computer Vision (YOLOv8 + OCR)

WEEKS 9-10: PHASE 3B
├─ Storage Location Tracking
├─ Google Sheets Sync (two-way)
├─ QuickBooks/Xero Integration
└─ WhatsApp Business API

WEEKS 11-14: PHASE 4 (POLISH & SCALE)
├─ Multi-restaurant support
├─ Dark mode
├─ Multi-language
├─ Performance optimization
├─ Advanced reporting
└─ Self-improvement agent (full features)

WEEK 15+: SOMMELIER AI PROJECT
├─ Wine Knowledge Base
├─ Onboarding Wizard
├─ Wine Aging Tracker
├─ Tasting Notes
└─ AR Label Scanner
```

---

## 🎯 CRITICAL PATH ANALYSIS

**Must Complete Before Launch:**
1. ✅ MVP core features
2. ⭐ Provider Communication Templates
3. ⭐ Vintage Substitution Rules
4. ⭐ Mobile App (Native)

**High ROI Features (Priority):**
1. ⭐ Advanced Analytics
2. ⭐ Provider Performance Dashboard
3. ⭐ Customizable Dashboard
4. Smart Reorder Suggestions
5. Budget Management

**Dependencies:**
- Mobile App → Push notifications working → Notification Preferences
- Google Sheets Sync (two-way) → One-way working first
- Sommelier AI → WineOps core stable
- Anomaly Detection → 3+ months historical data

---

## 💰 COST IMPACT BY PHASE

### MVP (Week 1-2): $50-60/month
- Supabase Pro, CloudAMQP, Railway, Plivo

### Phase 2 (Week 3-6): $70-90/month
- +Google Sheets API usage
- +Increased SMS volume

### Phase 3 (Week 7-10): $100-130/month
- +WhatsApp Business API
- +Mobile app push notifications (Firebase)
- +Increased API usage

### Phase 4 (Week 11-14): $120-150/month
- +Multi-restaurant scaling
- +Additional compute resources

### Sommelier AI: +$30-50/month
- +Additional LLM costs for education features

---

## ✅ SUCCESS METRICS BY PHASE

### MVP Success:
- Manager can operate restaurant without Excel
- Zero stockouts during service
- <2 hours/week on wine ops
- 90%+ approval rate

### Phase 2 Success:
- 50% reduction in ordering time (batch operations)
- 20% cost savings (multi-provider comparison)
- 95%+ budget adherence

### Phase 3 Success:
- 80%+ mobile app adoption
- <5 second average response time
- 99%+ uptime

### Phase 4 Success:
- 10+ restaurants using platform
- <$100/month cost per restaurant
- Manager NPS >50

---

## 📋 FEATURE CHECKLIST

### MVP (Week 1-2)
- [x] POS Ingestion
- [x] Buffer Manager (30-min LIFO)
- [x] Inventory Engine
- [x] Low-Stock Alerts
- [x] Manager Approval UI
- [x] Manual Inventory Editor
- [ ] Provider Communication Templates ⭐ NEW
- [ ] Notification Preferences ⭐ NEW
- [ ] RBAC (Owner = Manager) ⭐ NEW
- [ ] Keyboard Shortcuts ⭐ NEW

### Phase 2 (Week 3-6)
- [ ] Batch Operations
- [ ] Smart Reorder Suggestions
- [ ] Advanced Analytics ⭐ PRIORITY
- [ ] Provider Performance Dashboard ⭐ PRIORITY
- [ ] Multi-Provider Price Comparison
- [ ] Advanced Audit Features
- [ ] Budget Management
- [ ] Wine List Generator
- [ ] Google Sheets Sync (one-way)
- [ ] Vintage Substitution Rules ⭐ MUST

### Phase 3 (Week 7-10)
- [ ] Mobile App (Native) ⭐ MUST
- [ ] Customizable Dashboard ⭐ PRIORITY
- [ ] Storage Location Tracking
- [ ] Computer Vision (YOLOv8 + OCR)
- [ ] Google Sheets Sync (two-way)

### Future Later
- [ ] Wine Pairing Engine
- [ ] Predictive Forecasting
- [ ] Profit Margin Optimizer
- [ ] Reservation Integration
- [ ] Payment Processing

### Sommelier AI (Separate)
- [ ] Wine Knowledge Base
- [ ] Onboarding Wizard
- [ ] Wine Aging Tracker
- [ ] Tasting Notes Management
- [ ] AR Label Scanner

### Way Future Later
- [ ] Natural Language Queries
- [ ] Anomaly Detection
- [ ] Sentiment Analysis

---

## 🚀 NEXT STEPS

1. ✅ Documentation complete
2. ⏳ Await approval to proceed with development
3. 🔨 Build MVP with new additions (Week 1-2)
4. 🧪 Test with pilot restaurant
5. 📈 Roll out Phase 2 features
6. 📱 Launch mobile app (Phase 3)
7. 🌟 Scale to 10+ restaurants (Phase 4)

---

**Document Owner:** Product & Engineering  
**Review Frequency:** Weekly during development  
**Last Major Update:** January 7, 2026 - Expanded scope based on stakeholder feedback

