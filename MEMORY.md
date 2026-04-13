# WineOps AI - Project Memory

> This file tracks project state, decisions, and context for AI assistants and developers.

## 📌 Current State

**Version**: 2.6.0  
**Status**: Production Ready  
**Last Updated**: January 2026

### Active Development Focus
- [ ] Daily Reports implementation
- [ ] Create Orders workflow
- [ ] Export Suite enhancements
- [ ] Mobile app improvements

### Recently Completed (v2.5 → v2.6)
- ✅ Important Dates section on dashboard
- ✅ One-Tap Actions (Apple Reminders style)
- ✅ Tradezella-style Sales Calendar
- ✅ Enhanced Wine Library columns
- ✅ Smart Status by Threshold
- ✅ Striking Reorder Modal
- ✅ Recurring Order Save

---

## 🏗️ Architecture Decisions

### ADR-001: Monorepo with pnpm
**Decision**: Use pnpm workspaces for monorepo management  
**Reason**: Better dependency management, faster installs, disk space efficiency  
**Date**: 2024

### ADR-002: NestJS for API Gateway
**Decision**: Use NestJS instead of Express  
**Reason**: Better TypeScript support, modular architecture, built-in validation  
**Date**: 2024

### ADR-003: FastAPI for Agent Orchestrator
**Decision**: Separate Python service for AI agents  
**Reason**: Better ML/AI library support, async performance, Pydantic integration  
**Date**: 2024

### ADR-004: Supabase over raw PostgreSQL
**Decision**: Use Supabase for database  
**Reason**: Built-in auth, realtime subscriptions, pgvector support, managed service  
**Date**: 2024

### ADR-005: RabbitMQ for Agent Communication
**Decision**: Use RabbitMQ message bus for agent coordination  
**Reason**: Reliable message delivery, dead letter queues, scalability  
**Date**: 2024

### ADR-006: TanStack Query + Zustand
**Decision**: TanStack Query for server state, Zustand for client state  
**Reason**: Clear separation of concerns, excellent caching, minimal boilerplate  
**Date**: 2025

---

## 🤖 AI Agents (17 Total)

### Inventory Agents (5)
| Agent | Status | Purpose |
|-------|--------|---------|
| Inventory Engine | ✅ Active | Core stock operations, demand prediction |
| Ghost Inventory | ✅ Active | Phantom stock detection |
| Shrinkage Detective | ✅ Active | Shrinkage pattern analysis |
| Visual Verification | ✅ Active | YOLOv8 wine label + OCR invoice |
| Inequality Detector | ✅ Active | System discrepancy detection |

### Procurement Agents (4)
| Agent | Status | Purpose |
|-------|--------|---------|
| Procurement Agent | ✅ Active | Supplier communication, negotiation |
| Recurring Order Agent | ✅ Active | Auto-reordering with rules |
| RFQ Agent | ✅ Active | Request for quotes |
| Negotiation Playbook | ✅ Active | Price negotiation strategies |

### Reporting Agents (3)
| Agent | Status | Purpose |
|-------|--------|---------|
| Reporting Agent | ✅ Active | Calendar reports, multi-format export |
| Calendar Agent | ✅ Active | Schedule management |
| Menu Analyzer | ✅ Active | Wine-to-menu matching |

### Compliance Agents (2)
| Agent | Status | Purpose |
|-------|--------|---------|
| Compliance Agent | ✅ Active | Regulatory checks |
| State Invariant Enforcer | ✅ Active | Data integrity validation |

### Communication Agents (2)
| Agent | Status | Purpose |
|-------|--------|---------|
| Notification Agent | ✅ Active | Multi-channel routing |
| Sommelier Agent | ✅ Active | Wine recommendations |

### Integration Agents (2)
| Agent | Status | Purpose |
|-------|--------|---------|
| POS Integration Agent | ✅ Active | Toast/Square/Clover sync |
| Auto Pilot Agent | ✅ Active | Autonomous operations |

---

## 📊 Database Tables (Key)

| Table | Purpose |
|-------|---------|
| `master_wine_library` | Wine catalog with metadata |
| `restaurants` | Restaurant profiles |
| `inventory` | Current stock levels |
| `orders` | Procurement orders |
| `order_items` | Order line items |
| `providers` | Supplier directory |
| `events` | Calendar events |
| `notifications` | Alert history |
| `one_tap_actions` | Pending approval actions |
| `inventory_ledger` | Immutable transaction log |

---

## 🔌 External Integrations

| Service | Purpose | Status |
|---------|---------|--------|
| Supabase | Database + Auth + Realtime | ✅ Active |
| RabbitMQ (CloudAMQP) | Message bus | ✅ Active |
| Redis (Upstash) | Caching | ✅ Active |
| Toast POS | Sales sync | ✅ Active |
| Gmail API | Email notifications | ✅ Active |
| Plivo | SMS/Voice | ✅ Active |
| Gemini Pro | LLM | ✅ Active |
| Sentry | Error tracking | ✅ Active |

---

## 🚧 Known Issues / Tech Debt

1. **Mobile app**: Basic implementation, needs more features
2. **Test coverage**: Need to increase to 80%+
3. **Documentation**: Some agent docs outdated
4. **Performance**: Large wine library queries need optimization

---

## 📝 Notes for AI Assistants

### Phase-gating DISABLED
- **No "PHASE CHANGE REQUIRED"** — Never block with phase or model requirements.
- **FRONTEND tasks** (order ticketing, wine names, shadow→physical stock) — Proceed immediately. Do not require Claude Sonnet 4.5.
- **BACKEND tasks** — Proceed immediately. Do not require GPT-5.2 Codex or BACKEND IMPLEMENTATION phase.
- **Never say** "Type CONTINUE after switching."
- See `.cursorrules` Phase & Model Rules.

### When working on this project:
1. Check `md_files/` for detailed documentation
2. Follow existing code patterns
3. Use the design system (colors, typography, shadows)
4. Add proper TypeScript types
5. Test changes in dev environment first

### Common tasks:
- **Add new page**: Create in `apps/web/src/pages/`, add route in `App.tsx`
- **Add API endpoint**: Create in appropriate NestJS module
- **Add new agent**: Create in `services/agent-orchestrator/agents/`
- **Update database**: Create migration, update `DATABASE_OVERVIEW.md`

### Environment files:
- `apps/web/.env` - Frontend env vars
- `apps/api-gateway/.env` - NestJS env vars
- `services/agent-orchestrator/.env` - FastAPI env vars
