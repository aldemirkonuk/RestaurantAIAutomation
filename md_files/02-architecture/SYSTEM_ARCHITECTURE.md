# 🏗️ WineOps AI - Complete System Architecture

**Version:** 1.0.0  
**Last Updated:** January 7, 2026  
**Status:** MVP Development Phase

---

## 🎯 EXECUTIVE SUMMARY

WineOps AI is a multi-agent autonomous restaurant wine operations system that handles:
- Real-time inventory tracking via POS integration
- Intelligent low-stock detection with buffered alerting
- AI-powered supplier communication & negotiation
- Visual verification (wine labels & invoices)
- Financial reporting & analytics
- Human-in-the-loop approval workflows

**Core Principle:** Physical reality > Digital records. Human approval required for all critical operations.

---

## 📊 HIGH-LEVEL ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────┐
│                      MANAGER INTERFACES                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │   Web App    │  │  Mobile App  │  │  SMS/Email   │         │
│  │   (React)    │  │   (React)    │  │  (Plivo)     │         │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘         │
└─────────┼──────────────────┼──────────────────┼─────────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API GATEWAY LAYER                           │
│                    (NestJS - Node.js)                            │
│  - Real-time WebSocket server                                    │
│  - Manager approval endpoints                                    │
│  - Authentication & authorization                                │
│  - POS webhook handlers (Toast API)                             │
└─────────┬───────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│              MESSAGE QUEUE (RabbitMQ - CloudAMQP)               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  pos.events  │  │ stock.alerts │  │ procurement  │         │
│  │   Exchange   │  │   Exchange   │  │   Exchange   │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
└─────────┬───────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                   AGENT ORCHESTRATION LAYER                      │
│                      (FastAPI - Python)                          │
│                                                                   │
│  ┌────────────────────┐      ┌────────────────────┐            │
│  │  Central           │◀────▶│  Agent Registry    │            │
│  │  Orchestrator      │      │  & Health Monitor  │            │
│  └────────┬───────────┘      └────────────────────┘            │
│           │                                                      │
│           ├─────────┬─────────┬─────────┬─────────┬────────┐  │
│           ▼         ▼         ▼         ▼         ▼        ▼  │
│  ┌─────────────┐ ┌────────┐ ┌────────┐ ┌───────┐ ┌──────┐   │
│  │POS Ingestion│ │Buffer  │ │Inventory│ │Procure│ │Report│   │
│  │   Agent     │ │Manager │ │ Engine  │ │  AI   │ │ Agent│   │
│  └─────────────┘ └────────┘ └────────┘ └───────┘ └──────┘   │
│                                                                   │
│  ┌─────────────┐ ┌────────┐ ┌────────┐ ┌───────┐ ┌──────┐   │
│  │ Notification│ │Inequality│ │Visual │ │Calendar│ │Self- │   │
│  │   Agent     │ │Detector│ │Verify │ │ Agent │ │Improve│   │
│  └─────────────┘ └────────┘ └────────┘ └───────┘ └──────┘   │
└─────────┬───────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                   DATA & INTELLIGENCE LAYER                      │
│                    (Supabase - PostgreSQL)                       │
│                                                                   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────┐  │
│  │ Master Wine      │  │ Restaurant       │  │  Providers  │  │
│  │ Library          │  │ Inventory        │  │  Database   │  │
│  │ (Global Catalog) │  │ (Live Stock)     │  │             │  │
│  └──────────────────┘  └──────────────────┘  └─────────────┘  │
│                                                                   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────┐  │
│  │ Sales Events     │  │ Negotiations     │  │  Reports    │  │
│  │ (POS History)    │  │ & Conversations  │  │  & Logs     │  │
│  └──────────────────┘  └──────────────────┘  └─────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │        Vector Store (pgvector)                            │  │
│  │  - Wine embeddings (tasting notes, flavor profiles)      │  │
│  │  - Similarity search for recommendations                 │  │
│  └──────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EXTERNAL INTEGRATIONS                         │
│                                                                   │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐           │
│  │ Toast   │  │  Plivo  │  │ Gemini  │  │SendGrid │           │
│  │  POS    │  │  SMS    │  │  Pro    │  │  Email  │           │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘           │
│                                                                   │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐           │
│  │WhatsApp │  │ EasyOCR │  │ YOLOv8  │  │QuickBks │           │
│  │Business │  │(Phase 2)│  │(Phase 2)│  │(Phase 2)│           │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘           │
└───────────────────────────────────────────────────────────────────┘
```

---

## 🤖 MULTI-AGENT ORCHESTRATION MAP

### **Agent Communication Flow**

```
┌──────────────────────────────────────────────────────────────────┐
│                    CENTRAL ORCHESTRATOR                          │
│  - Routes messages between agents                                │
│  - Maintains agent health status                                 │
│  - Handles agent failures & retries                             │
│  - Enforces human-in-the-loop checkpoints                       │
└────────┬─────────────────────────────────────────────────────────┘
         │
         ├─────► RabbitMQ Message Bus
         │       - Exchanges: pos, stock, procurement, reports
         │       - Dead Letter Queues for failures
         │       - Priority queues for emergency orders
         │
         └─────► Agent Registry
                 - Agent status (active/idle/error)
                 - Performance metrics
                 - Load balancing

┌──────────────────────────────────────────────────────────────────┐
│ AGENT TYPES & COMMUNICATION PATTERNS                             │
└──────────────────────────────────────────────────────────────────┘

1. POS INGESTION AGENT
   ├─ Listens: Toast webhook events
   ├─ Publishes: pos.sale.completed, pos.void, pos.refund
   └─ Handoff: → Buffer Manager Agent

2. BUFFER MANAGER AGENT (30-min LIFO)
   ├─ Listens: pos.sale.completed
   ├─ Buffers: All sales events for 30 minutes
   ├─ Evaluates: Final stock state at buffer end
   ├─ Publishes: stock.evaluated, stock.threshold.breached
   └─ Handoff: → Inventory Engine Agent

3. INVENTORY ENGINE AGENT
   ├─ Listens: stock.evaluated, manual.adjustment
   ├─ Validates: Stock levels, inequality detection
   ├─ Updates: restaurant_inventory table
   ├─ Publishes: inventory.updated, inequality.detected
   └─ Handoffs:
      ├─→ Inequality Detector (if negative stock)
      └─→ Procurement Agent (if stock < threshold)

4. INEQUALITY DETECTOR AGENT
   ├─ Listens: inequality.detected
   ├─ Analyzes: Sales vs recorded stock discrepancies
   ├─ Suggests: One-tap corrections (+X bottles/cases)
   ├─ Publishes: inequality.alert, correction.suggested
   └─ Handoff: → Notification Agent → Manager UI

5. PROCUREMENT AGENT (AI Negotiator)
   ├─ Listens: stock.threshold.breached
   ├─ Checks: No active IN_TRANSIT order
   ├─ Retrieves: Provider info (primary → alternatives)
   ├─ Composes: Professional order messages (Gemini Pro)
   ├─ Sends: SMS/WhatsApp/Email to provider
   ├─ Parses: Provider responses
   ├─ Publishes: procurement.quote.received, procurement.approval.needed
   └─ Handoff: → Notification Agent → Manager Approval UI

6. NOTIFICATION AGENT
   ├─ Listens: *.alert, *.approval.needed
   ├─ Formats: Messages per channel (SMS/Email/Push)
   ├─ Sends: Via Plivo (SMS), SendGrid (Email)
   ├─ Tracks: Notification delivery status
   └─ Publishes: notification.sent, notification.failed

7. REPORTING AGENT
   ├─ Listens: report.schedule.triggered
   ├─ Queries: Sales, inventory, financial data
   ├─ Generates: Daily/Weekly/Monthly reports
   ├─ Enriches: AI insights (optional, Gemini)
   ├─ Exports: PDF, Excel, CSV, Google Drive, Google Sheets
   ├─ Features: Custom templates, watermarking, audit trail
   └─ Publishes: report.generated

8. CALENDAR AGENT
   ├─ Listens: procurement.conversation, manual.event.created
   ├─ Analyzes: Conversations for important dates (Gemini)
   ├─ Detects: Birthdays, holidays, unavailability
   ├─ Creates: Calendar events with reminders
   └─ Publishes: calendar.event.created, reminder.triggered

9. VISUAL VERIFICATION AGENT (Phase 2)
   ├─ Listens: delivery.image.uploaded
   ├─ Processes: YOLOv8 (label detection), EasyOCR (invoice)
   ├─ Validates: Price, quantity, wine ID
   └─ Publishes: verification.completed, verification.mismatch

10. SELF-IMPROVEMENT AGENT (Observer Mode - MVP)
    ├─ Listens: ALL agent messages (passive)
    ├─ Tracks: Response times, error rates, approval rates
    ├─ Detects: Edge cases, repeated failures
    ├─ Generates: Weekly performance report
    └─ Publishes: improvement.suggestion (to developer only)
```

### **Peer-to-Peer Communication (Same Cycle)**

Some agents can communicate directly within the same workflow:

```
Visual Verification Agent ←→ Inequality Detector
  (Both analyze delivery discrepancies)

Procurement Agent ←→ Calendar Agent
  (Check provider availability before contacting)

Buffer Manager ←→ Inventory Engine
  (Real-time stock validation during buffer evaluation)
```

---

## 🗄️ DATABASE SCHEMA OVERVIEW

### **Table Relationships**

```
master_wine_library (Global Catalog)
  ↓ 1:N
restaurant_inventory (Live Stock per Restaurant)
  ↓ 1:N
sales_events (POS History)

providers (Supplier Database)
  ↓ 1:N
restaurant_providers (Link Table: Restaurant ↔ Provider)
  ↓ 1:N
procurement_orders (Order History)
  ↓ 1:N
procurement_conversations (AI Negotiation Logs)

manager_report_profiles (Report Configuration)
  ↓ 1:N
generated_reports (Report History)

calendar_events (Important Dates)
  ↓ N:1
providers (Many events per provider)
```

**Full schema details in: `DATABASE_SCHEMA.sql`**

---

## 🔄 CRITICAL WORKFLOWS

### **Workflow 1: Stock Depletion → Reorder**

```
1. POS records sale (4 bottles Malbec sold)
   └─→ Toast webhook → POS Ingestion Agent

2. Sale enters 30-minute buffer
   └─→ Buffer Manager collects all sales
   └─→ Ignores intermediate states (stock: 5→4→3→2)

3. Buffer window ends (30 min elapsed)
   └─→ Buffer Manager evaluates FINAL state: stock = 2
   └─→ Checks threshold: threshold_min = 3
   └─→ Result: 2 < 3 → THRESHOLD BREACHED

4. Publishes stock.threshold.breached
   └─→ Procurement Agent receives event

5. Procurement Agent checks:
   ├─ Is there an active IN_TRANSIT order? NO
   ├─ Get primary provider from providers table
   └─ Compose order message (Gemini Pro)

6. Sends message to provider (Plivo SMS)
   └─→ "Hi John, I'd like to order 2 cases of Malbec 2020 
        at $45/case. Please confirm availability."

7. Provider responds (SMS received)
   └─→ Procurement Agent parses response
   └─→ Provider says: "Can do. Price is $50/case now."

8. Price deviation detected: $50 vs $45 (11% increase)
   └─→ Publishes: procurement.approval.needed

9. Notification Agent sends to manager:
   └─→ SMS: "John confirms 2 cases Malbec at $50/case 
            (was $45). Approve? [Yes] [No] [Counter]"

10. Manager taps [Yes] in approval UI
    └─→ Order confirmed, status → IN_TRANSIT
    └─→ Expected delivery date calculated (provider.lead_time_days)
    └─→ Calendar event created automatically

11. Delivery arrives (3 days later)
    └─→ Manager taps [RECEIVED] in app
    └─→ Inventory updated: stock = 2 + 24 = 26
    └─→ Order status → COMPLETED
```

### **Workflow 2: Inequality Detection → Correction**

```
1. POS records sale: 2 bottles sold
2. Current DB stock: 1 bottle
3. Inequality: 1 - 2 = -1 (NEGATIVE STOCK)
4. Inequality Detector triggers alert:
   └─→ "Sales exceed recorded stock. Did you make a 
        manual purchase?"
5. Manager receives notification with one-tap corrections:
   ├─ [+12 bottles (1 case)]
   ├─ [+24 bottles (2 cases)]
   └─ [Custom amount]
6. Manager taps [+12 bottles]
7. Inventory updated: shadow_stock += 12
8. Prompts: "Add to procurement log?"
   ├─ [Yes - I bought this] → Creates manual purchase record
   └─ [No - This was a gift/promo]
```

### **Workflow 3: Manual Edit → Automation Pause**

```
1. Database Watcher Agent detects write lock on inventory table
2. Identifies: Manager opened Excel/Sheet for manual edit
3. Orchestrator broadcasts: "PAUSE_ALL_WRITES"
4. All agents stop inventory updates for 30 seconds
5. Manager receives SMS: "Human edit detected—automation paused."
6. Manager completes edit, saves file
7. Watcher detects lock released
8. Orchestrator resumes: "RESUME_WRITES"
9. Agents sync latest data, continue operations
```

---

## 🎨 FRONTEND ARCHITECTURE

### **React Component Hierarchy**

```
App
├─ AuthProvider (Supabase Auth)
├─ ThemeProvider (Dark/Light mode)
└─ DashboardLayout
    ├─ Sidebar (Navigation)
    ├─ TopBar (Notifications, Profile)
    └─ MainContent
        ├─ InventoryView (Primary)
        │   ├─ WeeklyStockMap (Tradezella-style heatmap)
        │   ├─ InventoryTable (Sortable, filterable)
        │   ├─ LowStockBadges (Real-time alerts)
        │   └─ ManualEditModal (Fat-finger guard)
        │
        ├─ ReportsView
        │   ├─ FinancialCharts (Tremor: Donut, Line, Bar)
        │   ├─ TimeWindowSelector (Custom date ranges)
        │   ├─ ExportButtons (PDF, Excel, CSV)
        │   └─ AIInsightsPanel (Optional summary)
        │
        ├─ CalendarView
        │   ├─ MonthCalendar (Event markers)
        │   ├─ UpcomingEventsList (Next 7 days)
        │   ├─ AIDetectedEvents (Pending review)
        │   └─ ManualEventCreator
        │
        ├─ ProcurementView
        │   ├─ ActiveOrdersTable (IN_TRANSIT status)
        │   ├─ ConversationHistory (AI ↔ Provider)
        │   ├─ ApprovalQueue (Pending manager approval)
        │   └─ ProviderDirectory (Contact info, ratings)
        │
        └─ AuditLogView (Deep diagnostic view)
            ├─ AgentActivityLog (Performance metrics)
            ├─ SystemHealthMonitor (Agent status)
            └─ EdgeCaseReporter (Self-improvement data)
```

### **Design System**

```css
/* Color Palette */
--powder-white: #FDFCFB;
--powder-white-secondary: #FAFAFA;
--tinted-red-bg: #FFF5F5;
--tinted-red: #DC2626;
--tinted-green-bg: #F0FDF4;
--tinted-green: #16A34A;
--tinted-yellow-bg: #FFFBEB;
--tinted-yellow: #D97706;

/* Glassmorphism */
.glass-card {
  background: rgba(253, 252, 251, 0.7);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
}

/* Typography */
font-family: 'Robinhood Phonic', -apple-system, sans-serif;
```

---

## 🔐 SECURITY & COMPLIANCE

### **Authentication Flow**
1. Supabase Auth (SSO: Google, Microsoft)
2. JWT tokens (access + refresh)
3. Row-level security per restaurant
4. Role-based access: Owner/Manager = equal, Staff = read-only

### **Data Retention**
| Data Type | Retention | Storage |
|-----------|-----------|---------|
| Agent reasoning logs | 30-90 days | PostgreSQL (hot) |
| System error logs | 1 year | PostgreSQL |
| POS access logs | 1 year | PostgreSQL |
| Sales receipts | 7 years | S3 (cold) |
| Inventory records | 7 years | PostgreSQL + S3 |

### **Audit Trail**
- All agent actions logged with timestamps
- Manager approvals/rejections tracked
- Full conversation transcripts (AI ↔ Provider)
- Immutable audit log (append-only)

---

## 📡 API ENDPOINTS (NestJS Gateway)

### **Manager Approval Endpoints**
```
POST   /api/approvals/order           - Approve/reject order
POST   /api/approvals/price           - Approve price change
POST   /api/approvals/vintage         - Approve vintage substitution
POST   /api/approvals/correction      - Approve inequality correction
```

### **Inventory Management**
```
GET    /api/inventory                 - Get live inventory
POST   /api/inventory/manual-adjust   - Manual stock adjustment
POST   /api/inventory/received        - Mark delivery received
GET    /api/inventory/alerts          - Get low-stock alerts
```

### **Reporting**
```
GET    /api/reports/daily             - Daily snapshot
GET    /api/reports/weekly            - Weekly digest
GET    /api/reports/custom            - Custom time window
POST   /api/reports/export            - Generate PDF/Excel
```

### **WebSocket Events**
```
ws://api/live
  - stock.updated
  - alert.triggered
  - approval.pending
  - delivery.eta
  - agent.status
```

---

## 🚀 DEPLOYMENT ARCHITECTURE

### **Production Stack**

```
┌─────────────────────────────────────────────────────────┐
│ FRONTEND (Vercel)                                       │
│ - React app (Vite build)                                │
│ - CDN: Global edge network                              │
│ - SSL: Auto-managed                                     │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ API GATEWAY (Fly.io)                                    │
│ - NestJS server (Node.js)                               │
│ - WebSocket support                                     │
│ - Auto-scaling: 1-3 instances                           │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ AGENT LAYER (Railway.app)                               │
│ - FastAPI server (Python)                               │
│ - Background workers (Celery-like)                      │
│ - Auto-scaling: 1-2 instances                           │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ MESSAGE QUEUE (CloudAMQP)                               │
│ - RabbitMQ managed service                              │
│ - Plan: Little Lemur ($9/month)                         │
│ - Persistent messages, dead-letter queues              │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ DATABASE (Supabase)                                     │
│ - PostgreSQL + pgvector                                 │
│ - Real-time subscriptions                               │
│ - Plan: Pro ($25/month)                                 │
│ - Backups: Daily automatic                              │
└─────────────────────────────────────────────────────────┘

Total MVP Cost: ~$40-60/month
```

### **CI/CD Pipeline**

```yaml
# GitHub Actions Workflow

on: [push, pull_request]

jobs:
  test:
    - Lint (ESLint, Ruff)
    - Type check (TypeScript, mypy)
    - Unit tests (Vitest, Pytest)
    - Coverage report (80% threshold)
  
  build:
    - Frontend: Vite build
    - Backend: Docker images
  
  deploy-staging:
    - Deploy to staging environment
    - Run E2E tests (Playwright)
    - Feature flag validation
  
  deploy-production:
    - Manual approval required
    - Gradual rollout (10% → 50% → 100%)
    - Automated rollback on error rate > 1%
```

---

## 📊 MONITORING & OBSERVABILITY

### **Tools**
- **Error Tracking:** Sentry (Python + JavaScript)
- **Logging:** LogTail (centralized logs)
- **Uptime:** Better Uptime (status page)
- **Analytics:** PostHog (open-source, self-hosted option)
- **Agent Metrics:** Custom Prometheus + Grafana (Phase 2)

### **Key Metrics**
```
Business Metrics:
- Stockouts prevented
- Average reorder time
- Manager approval rate
- Cost savings (vs manual)

Technical Metrics:
- Agent response time (p50, p95, p99)
- Message queue depth
- Database query performance
- WebSocket connection health
- API error rate
```

---

## 🎯 FEATURE FLAGS

All features controlled via environment variables and database config:

```typescript
// Feature flag system
export const FEATURES = {
  // Core (MVP)
  POS_INGESTION: true,
  BUFFER_MANAGER: true,
  INEQUALITY_DETECTION: true,
  MANUAL_INVENTORY_EDIT: true,
  LOW_STOCK_ALERTS: true,
  
  // Procurement (MVP = Alert Only)
  AUTO_PROCUREMENT: false,        // MVP: Manager initiates
  SUPPLIER_NEGOTIATION: false,    // MVP: Manual messaging
  EMERGENCY_PROCUREMENT: true,    // Override buffer
  
  // Advanced (Phase 2)
  VISUAL_VERIFICATION: false,     // YOLOv8 + OCR
  AI_REPORT_INSIGHTS: false,      // Gemini summaries
  PROVIDER_LEARNING: false,       // Response pattern detection
  SOMMELIER_AI: false,            // Wine recommendations
  
  // Integrations (Phase 2)
  GOOGLE_CALENDAR_SYNC: false,
  WHATSAPP_BUSINESS: false,
  QUICKBOOKS_SYNC: false,
  VOICE_CALLS: false,
  
  // UI (Phase 2)
  DARK_MODE: false,               // MVP: Light only
  DRAG_DROP_WIDGETS: false,
  MULTI_LANGUAGE: false,
  
  // Safety (Always On)
  FAT_FINGER_GUARD: true,
  MANUAL_OVERRIDE: true,
  AUDIT_LOGGING: true,
  YIELD_TO_HUMAN: true
};
```

---

## 📅 MVP DEVELOPMENT ROADMAP

### **Week 1: Foundation (Jan 8-12)**

**Day 1-2: Database & Infrastructure**
- Set up Supabase project
- Create all database tables
- Configure row-level security
- Set up CloudAMQP (RabbitMQ)
- Initialize monorepo (Turborepo)

**Day 3-4: Agent Orchestrator**
- Build central orchestrator (FastAPI)
- Implement RabbitMQ connection
- Create agent registry system
- Build health monitoring

**Day 5: API Gateway**
- Set up NestJS project
- Create authentication endpoints
- Build WebSocket server
- Set up Toast webhook receiver

### **Week 2: Core Features (Jan 13-19)**

**Day 6-7: Buffer Manager + Inventory Engine**
- Implement 30-min LIFO buffer logic
- Build inventory update engine
- Create inequality detector
- Test with mocked POS data

**Day 8-9: Frontend Shell**
- React app setup (Vite + TypeScript)
- Glassmorphism design system
- Dashboard layout (sidebar + tabs)
- Inventory table component

**Day 10: Manager Approval UI**
- One-tap approval buttons
- Real-time notification display
- Manual inventory editor
- Fat-finger guard validation

**Day 11: Notification System**
- Plivo SMS integration
- Email templates
- Alert batching logic
- Delivery tracking

**Day 12-13: Calendar & Testing**
- Basic calendar UI
- Manual event creation
- End-to-end workflow tests
- Bug fixes

**Day 14: Deployment**
- Deploy to staging (Railway + Vercel)
- Load testing
- Documentation finalization
- Demo preparation

---

## 🔮 POST-MVP ROADMAP (Phase 2-4)

### **Phase 2 (Weeks 3-6): Intelligence Layer**
- YOLOv8 wine label recognition
- EasyOCR invoice scanning
- AI procurement negotiation (full auto)
- Provider learning & pattern detection
- Advanced reporting with AI insights

### **Phase 3 (Weeks 7-10): Integrations**
- QuickBooks/Xero accounting sync
- Google Calendar two-way sync
- WhatsApp Business API
- Voice calling (Twilio)
- Multi-restaurant support

### **Phase 4 (Weeks 11-14): Scale & Polish**
- Mobile app (React Native)
- Dark mode
- Multi-language support
- Advanced analytics dashboard
- Self-improvement agent (full features)

---

## 📚 ADDITIONAL DOCUMENTATION

See also:
- `DATABASE_SCHEMA.sql` - Complete database structure
- `AGENT_PROTOCOLS.md` - Detailed agent communication specs
- `API_REFERENCE.md` - Full API documentation
- `DEPLOYMENT_GUIDE.md` - Production deployment steps
- `DEVELOPMENT_SETUP.md` - Local development environment
- `TESTING_STRATEGY.md` - Test coverage & E2E scenarios

---

**Document Owner:** AI Development Team  
**Stakeholders:** Restaurant Operations, Development, Product  
**Review Cycle:** Weekly during MVP, Monthly post-launch

