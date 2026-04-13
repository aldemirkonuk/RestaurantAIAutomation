# WineOps AI - Complete Program Schema

**Version**: 2.6.0 (Production Ready)  
**Last Updated**: January 2026  
**Project**: Restaurant Wine Inventory & Procurement Automation

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Technology Stack](#technology-stack)
3. [System Architecture](#system-architecture)
4. [Frontend Layer](#frontend-layer)
5. [API Gateway Layer](#api-gateway-layer)
6. [Agent Orchestrator Layer](#agent-orchestrator-layer)
7. [Data Layer](#data-layer)
8. [External Integrations](#external-integrations)
9. [Authentication & Security](#authentication--security)
10. [Real-Time Event System](#real-time-event-system)

---

## Executive Summary

WineOps AI is a comprehensive restaurant wine inventory and procurement automation platform combining:

- **Intelligent Automation**: 17 AI agents for inventory, procurement, compliance, reporting
- **Real-Time Sync**: WebSocket + Supabase Realtime for cross-page synchronization
- **POS Integration**: Toast POS integration for sales data and menu sync
- **Human-in-the-Loop**: AI recommendations with human approval workflows
- **Multi-Channel Comms**: Email (Gmail), SMS/Voice (Plivo)

### Key Metrics

| Metric | Value |
|--------|-------|
| Frontend Pages | 16 |
| API Modules | 21 |
| API Endpoints | 60+ |
| AI Agents | 17 |
| Database Tables | 30+ |
| External Integrations | 4 |

---

## Technology Stack

### Frontend
| Technology | Purpose |
|------------|---------|
| React 18 + TypeScript | UI Framework |
| Tailwind CSS | Styling |
| Framer Motion | Animations |
| Lucide React | Icons |
| Recharts | Charts |

### API Gateway
| Technology | Purpose |
|------------|---------|
| NestJS + TypeScript | Backend Framework |
| Passport JWT | Authentication |
| Socket.io | WebSockets |
| Swagger | API Docs |

### Agent Orchestrator
| Technology | Purpose |
|------------|---------|
| FastAPI + Python | API Framework |
| Celery | Background Tasks |
| RabbitMQ | Message Queue |
| OpenAI/Anthropic | LLM Integration |

### Data Layer
| Technology | Purpose |
|------------|---------|
| Supabase PostgreSQL | Database + Auth + Realtime |
| Redis | Caching |

### External Services
| Service | Purpose |
|---------|---------|
| Toast POS | Restaurant POS |
| Plivo | SMS/Voice |
| Gmail API | Email |
| Sentry | Monitoring |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND LAYER                          │
│  React 18 + TypeScript | 16 Pages | Tailwind + Framer Motion   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API GATEWAY LAYER                          │
│  NestJS | 21 Modules | 60+ Endpoints | WebSocket Gateway        │
│  Guards: JWT, Roles, Tenant, RateLimit                          │
└─────────────────────────────────────────────────────────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
┌───────────────────┐  ┌───────────────┐  ┌───────────────────────┐
│ AGENT ORCHESTRATOR│  │  DATA LAYER   │  │  EXTERNAL SERVICES    │
│ FastAPI + Python  │  │  Supabase     │  │  Toast POS            │
│ 17 AI Agents      │  │  PostgreSQL   │  │  Plivo SMS/Voice      │
│ Celery Workers    │  │  Redis Cache  │  │  Gmail API            │
│ RabbitMQ          │  │  30+ Tables   │  │  Sentry               │
└───────────────────┘  └───────────────┘  └───────────────────────┘
```

---

## Frontend Layer

### Pages (16 Total)

| Page | Route | Description |
|------|-------|-------------|
| Dashboard | `/` | Metrics, alerts, quick actions |
| Inventory | `/inventory` | Wine inventory management |
| Wine Library | `/wine-library` | Master wine catalog |
| Orders | `/orders` | Procurement orders |
| Calendar | `/calendar` | Deliveries, events |
| Reports | `/reports` | Financial/inventory reports |
| Notifications | `/notifications` | Alert center, one-tap actions |
| Communications | `/communications` | Email/SMS templates |
| Documents | `/documents` | Invoices, documents |
| Providers | `/providers` | Supplier directory |
| Recurring Orders | `/recurring-orders` | Auto-reorder rules |
| Sommelier AI | `/sommelier` | AI recommendations |
| Admin Panel | `/admin` | Administration |
| Login | `/login` | Authentication |
| Register | `/register` | Registration |
| Onboarding | `/onboarding` | Setup wizard |

### Key Contexts

| Context | Purpose |
|---------|---------|
| RealtimeContext | Supabase subscriptions, cross-page sync |
| ThemeContext | Light/dark mode |
| AuthContext | User authentication state |
| ToastContext | Notification toasts |

---

## API Gateway Layer

### Modules (21 Total)

| Module | Path | Purpose |
|--------|------|---------|
| AuthModule | `/api/v1/auth` | Authentication & JWT |
| DashboardModule | `/dashboard` | Aggregated data |
| InventoryModule | `/inventory` | Inventory CRUD |
| ProcurementModule | `/api/v1/procurement` | Orders |
| ReportsModule | `/api/v1/reports` | Reports |
| ToastModule | `/toast` | POS integration |
| EventsModule | `/events` | Event ingestion |
| CalendarModule | `/calendar` | Calendar events |
| InventoryLedgerModule | `/inventory-ledger` | Transactions |
| ProvidersModule | `/api/v1/providers` | Suppliers |
| ConversationsModule | `/api/v1/conversations` | AI approval |
| CommunicationsModule | `/communications` | Email/SMS |
| NotificationsModule | `/api/v1/notifications` | Alerts |
| OneTapActionsModule | `/one-tap-actions` | Quick actions |

### Authentication

- **JWT Strategy**: Bearer token validation
- **Guards**: JwtAuthGuard, RolesGuard, TenantGuard, RateLimitGuard
- **Tokens**: Access (15min), Refresh (7 days)
- **Roles**: owner, manager, staff

---

## Agent Orchestrator Layer

### Agents (17 Total)

| Agent | Category | Purpose |
|-------|----------|---------|
| InventoryEngineAgent | Inventory | Core operations |
| GhostInventoryAgent | Inventory | Phantom stock detection |
| ShrinkageDetectiveAgent | Inventory | Shrinkage patterns |
| VisualVerificationAgent | Inventory | Photo verification |
| InequalityDetectorAgent | Inventory | Discrepancy detection |
| ProcurementAgent | Procurement | Order recommendations |
| RecurringOrderAgent | Procurement | Auto-reordering |
| RFQAgent | Procurement | Request for quotes |
| NegotiationPlaybookAgent | Procurement | Price negotiation |
| ReportingAgent | Reporting | Report generation |
| CalendarAgent | Reporting | Schedule management |
| MenuAnalyzerAgent | Reporting | Menu optimization |
| ComplianceAgent | Compliance | Regulatory compliance |
| StateInvariantEnforcerAgent | Compliance | Data integrity |
| NotificationAgent | Communication | Alert routing |
| SommelierAgent | Communication | Wine recommendations |
| POSIntegrationAgent | Integration | Toast sync |
| AutoPilotAgent | Integration | Autonomous ops |

### Services

| Service | Purpose |
|---------|---------|
| TemplateEngine | Email/report templates |
| EmailClient | Gmail API |
| PlivoClient | SMS |
| PlivoVoiceClient | Voice calls |
| ToastAPIClient | Toast POS |
| InvoiceOCRService | Invoice scanning |

---

## Data Layer

### Core Tables

| Table | Purpose |
|-------|---------|
| users | User accounts |
| restaurants | Restaurant entities |
| user_restaurant_access | Multi-tenant access |
| master_wine_library | Global wine catalog |
| restaurant_inventory | Per-restaurant stock |
| inventory_transactions | Stock ledger |

### Procurement Tables

| Table | Purpose |
|-------|---------|
| providers | Wine suppliers |
| procurement_orders | Purchase orders |
| procurement_order_items | Order line items |
| recurring_orders | Auto-reorder rules |

### Event System Tables

| Table | Purpose |
|-------|---------|
| events | Main event log |
| event_dead_letters | Failed events (DLQ) |
| event_replay_jobs | Replay tracking |
| event_schema_registry | Schema versions |

### Integration Tables

| Table | Purpose |
|-------|---------|
| calendar_events | Scheduled events |
| recurrence_rules | Recurring patterns |
| notifications | User notifications |
| email_templates | Email templates |
| conversations | AI conversations |

---

## External Integrations

### Toast POS
- Menu sync and caching
- Sales data retrieval
- Webhook processing (HMAC verified)
- Item mapping to inventory

### Plivo Communications
- SMS alerts (low stock, delivery)
- Voice calls (urgent alerts)
- Two-way messaging

### Gmail API
- Template-based emails
- Report delivery
- Provider communications

### Sentry
- Error monitoring
- Performance tracking
- Alert notifications

---

## Authentication & Security

### JWT Token Structure
```json
{
  "sub": "user_id",
  "email": "user@example.com",
  "role": "owner|manager|staff",
  "restaurantId": "uuid",
  "iat": 1234567890,
  "exp": 1234568790
}
```

### Security Layers
1. HTTPS transport
2. JWT authentication
3. Role-based authorization
4. Tenant isolation (RLS)
5. Rate limiting
6. Input validation
7. Audit logging

---

## Real-Time Event System

### Event Types
| Type | Description |
|------|-------------|
| inventory_change | Stock updates |
| order_change | Order status |
| calendar_event | Schedule changes |
| dashboard_update | Metric updates |
| wine_update | Catalog changes |
| notification_sent | Alerts |

### Event Flow
1. Frontend action triggers POST /events
2. API validates and inserts with idempotency
3. Supabase Realtime broadcasts to subscribers
4. All connected clients receive update
5. Failed events go to Dead Letter Queue

---

## File Structure

```
Restaurant AI Automation/
├── apps/
│   ├── api-gateway/        # NestJS (21 modules)
│   ├── web/                # React (16 pages)
│   └── mobile/             # React Native
├── services/
│   ├── agent-orchestrator/ # Python (17 agents)
│   └── database/           # Migrations
├── packages/
│   └── ui/                 # Shared components
├── Supabase_SQL_Files/     # Database schema
└── md_files/               # Documentation
```

---

**Document Version**: 1.0  
**Created**: January 2026
