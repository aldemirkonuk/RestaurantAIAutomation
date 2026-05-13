# Phase 24: Provider Communication Pipeline + Email Intelligence — Research

**Researched:** 2026-05-13
**Domain:** AI agent email pipeline · RabbitMQ routing · Supabase schema · APScheduler cron · React accordion UI
**Confidence:** HIGH (all critical claims verified against live codebase; model_clients.py ASSUMED recreated)

---

## Summary

Phase 24 layers a new EmailIntelAgent triage layer on top of the existing Gmail→RabbitMQ→EmailParsingAgent pipeline, upgrades ProviderConversationAgent to Level 4, and adds deal intelligence features (urgency scoring, promo↔calendar linking, cross-vendor price comparison) with frontend cards on the dashboard and Providers page.

**CRITICAL FINDING — Actual Plan Execution Status:** SUMMARY files exist for Plans 24-02 and 24-03, but their referenced commits do NOT exist in git and their output files are NOT on disk. **All five plans (24-01 through 24-05) need to be executed.** The migration files for Plan 24-01 are absent, `model_clients.py` is absent, and the 7 test stub files are absent. This affects the plan executor: every plan must check its own prerequisites before starting.

Research also surfaces **five critical infrastructure bugs** that must be resolved before Plans 24-04/24-05 can run without silent failures: the routing key conflict, the `email.events` exchange missing from `message_bus.py`, the `fetchNewMessages` INBOX-only labelId filter, missing columns on `vendor_promotions`, and missing digest toggle columns on `notification_preferences`.

**Primary recommendation:** Plans 24-01 through 24-05 must all be executed. The new Plans 24-06, 24-07, and 24-08 should follow. Infrastructure bug fixes from the previous RESEARCH.md analysis (routing key conflict, exchange declaration, labelId filter) must be folded into Plan 24-02 (Gmail Watch expansion), not left for a separate premortem plan.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01**: All inbound Gmail goes through EmailIntelAgent first. No pre-filtering. `email.events` → `email.inbound.received` routing key.
- **D-02**: `GMAIL_WATCH_LABEL_IDS` expands to `INBOX,SENT`. Direction detected via `labelIds` (INBOX = inbound, SENT = outbound).
- **D-03**: After classification, EmailIntelAgent creates in-app notification via `NotificationsService.createNotification()`. NOISE = silent.
- **D-04**: Digest sender is Python-side `DigestCronJob`. Reads Redis `digest:{restaurant_id}:{date}`. Haiku natural language. Sends via `EmailClient` SMTP at 8am restaurant local timezone. Skip if empty.
- **D-05**: Digest has three toggleable sections: promo deals, stalled threads, procurement gaps.
- **D-06**: Digest header includes Gmail Watch status.
- **D-07**: `providers.auto_reply_enabled BOOLEAN DEFAULT false`. Trusted → auto-send. Others → `pending_approval`.
- **D-08**: One-tap approval in notification center. Draft card shows Approve / Edit / Reject.
- **D-09**: Edit opens conversation composer pre-filled. "Why this reply?" shows `decision_log` reasoning, collapsed by default.
- **D-10**: `To:` field locked to provider email. CC/BCC tracked. Mismatch logged as anomaly, not new conversation.
- **D-11**: Abandoned draft stays `pending_approval`. Reminder after 2h. Auto-discard at 48h.
- **D-12**: Manager learning loop — log original vs. edited diff in `decision_log`. Haiku extracts preference → `conversation_context.manager_instructions[]`.
- **D-13**: Three frontend surfaces: Dashboard compact cards, Providers page full relationship view, Documents Deal Brief.
- **D-14**: Dashboard deal interaction: expandable inline card (not a modal). Accordion-style.
- **D-15**: 3 sketch variants before implementation. User selects.
- **D-16**: Deal Urgency Score (1–10): `menu_fit_score × (1 - stock_level/target_stock) × calendar_proximity_factor`. Stored in `vendor_promotions.urgency_score`.
- **D-17**: PROMO↔Calendar auto-link: EmailIntelAgent queries `calendar_events` for next-30-day events. Store in `vendor_promotions.linked_event_ids[]`.
- **D-18**: Cross-vendor price intelligence: query for last purchase price of same wine type. Show delta in deal card and Deal Brief.
- **D-19**: Composer context injection: last 3 interactions + open orders + credit terms + active promos injected into Haiku prompt.

### Claude's Discretion
- RabbitMQ exchange topology: topic exchange `email.events`
- Redis digest key TTL: 36 hours
- Haiku concurrency semaphore: max 5 concurrent LLM calls
- `dedup_hash` scope: `vendor_email + product_name + date`
- Deal Brief document structure and formatting
- Digest email HTML template wrapper

### Deferred Ideas (OUT OF SCOPE)
- Negotiation momentum bar → Phase 31
- Sentiment sparkline → Phase 31
- Smart reply templates → Phase 31
- Manager review UI for learned instructions → Phase 31
- Mobile push notifications → future
- Provider health score with analytics formula → future
</user_constraints>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Gmail webhook receipt | API Gateway (NestJS) | — | Pub/Sub push endpoint in communications.controller.ts |
| Email triage / classification | Agent Orchestrator (Python) | — | EmailIntelAgent: LLM classification is async, CPU/IO intensive |
| PROMO extraction + dedup | Agent Orchestrator (Python) | — | Stateful: dedup hash check against Supabase |
| Menu fit analysis | Agent Orchestrator (Python) | — | LLM call + DB query |
| Deal urgency score computation | Agent Orchestrator (Python) | — | Formula requires stock + calendar data; computed on PROMO arrival |
| Redis digest accumulation | Agent Orchestrator (Python) | — | EmailIntelAgent writes; DigestCronJob reads |
| Digest cron + SMTP send | Agent Orchestrator (Python) | — | DigestCronJob scheduled via APScheduler (existing pattern) |
| In-app notification creation | API Gateway (NestJS) | — | NotificationsService.createNotification() with WebSocket push |
| Draft approval flow | API Gateway (NestJS) | — | ConversationsController.approve() already wired |
| Gmail Watch management | API Gateway (NestJS) | — | GmailWatchService owns watch lifecycle |
| Dashboard + Providers UI | Frontend (React) | — | New cards in Dashboard.tsx and Providers.tsx |
| Deal Brief document | Frontend (React) | — | MeetingMemoPrompt.tsx pattern |
| PROMO chip in EventModal | Frontend (React) | — | EventModal.tsx reads vendor_promotions.linked_event_ids[] |

---

## Plan Execution Status (Pre-Research Audit)

> **Finding:** All five plans need execution. SUMMARY files for Plans 24-02 and 24-03 are ghost documents — commits referenced don't exist in git, output files don't exist on disk.

| Plan | Description | Executed? | Evidence |
|------|-------------|-----------|----------|
| 24-01 | DB migrations (vendor_promotions, conversation_embeddings, etc.) | **NO** | Migration files 20260415000002/3 absent. No SUMMARY.md. |
| 24-02 | Wave 0 test stubs (7 pytest files) | **SUMMARY EXISTS but NOT on disk** | SUMMARY.md references commits b7c63c0/1e939ae — NOT in git log. test_email_intel_agent.py absent from disk. Must re-execute. |
| 24-03 | model_clients.py (GeminiFlashClient, HaikuClient) | **SUMMARY EXISTS but NOT on disk** | SUMMARY.md references `feat(24-03)` commit — NOT in git log. `services/agent-orchestrator/services/model_clients.py` absent. Must re-execute. |
| 24-04 | EmailIntelAgent skeleton | **NO** | No SUMMARY.md. email_intel_agent.py absent. |
| 24-05 | ProviderConversationAgent Level 4 hardening | **NO** | No SUMMARY.md. No level-4 changes in agent file. |

**Action for planner:** All plans 24-01 through 24-05 must be executed in order. Each must verify its own prereqs. No plan should assume prior plans succeeded.

---

## Architecture Open Questions — Answered

### Q1: Gmail Watch Pub/Sub Message Payload + SENT Detection

**Answer [VERIFIED: gmail-watch.service.ts]:**

The `GmailWatchService.fetchNewMessages()` method at line 170 currently:
1. Calls `gmail.users.history.list()` with `historyTypes: ['messageAdded']` and **hardcoded `labelId: 'INBOX'`** (line 177)
2. Fetches the full message via `gmail.users.messages.get()` with `format: 'full'`
3. The full message includes `data.labelIds: string[]` — e.g., `["INBOX", "UNREAD"]` for inbound or `["SENT"]` for outbound

**The bug:** The `labelId: 'INBOX'` filter in `history.list()` means SENT messages are silently excluded even after `GMAIL_WATCH_LABEL_IDS` is updated. The Pub/Sub notification arrives, but `history.list()` returns no results for SENT messages.

**Fix for Plan 24-02 (Gap 3):** Remove the `labelId` filter from `history.list()`. Post-fetch, inspect `fullMessage.data.labelIds` to determine direction:
```typescript
// In fetchNewMessages() — remove labelId param from history.list()
const historyResponse = await this.gmail.users.history.list({
  userId: 'me',
  startHistoryId: sinceHistoryId,
  historyTypes: ['messageAdded'],
  // NO labelId filter — detect direction from message.labelIds
});
// Then when processing each message:
const labelIds: string[] = fullMessage.data.labelIds || [];
const direction = labelIds.includes('SENT') && !labelIds.includes('INBOX') ? 'outbound' : 'inbound';
// Publish all messages to EmailIntelAgent; EmailIntelAgent dispatches based on direction
```

### Q2: RabbitMQ Exchange Topology

**Answer [VERIFIED: core/message_bus.py]:**

The `message_bus.py` declares exchanges in `_declare_exchanges()`. Exchange type is **TOPIC** (using `ExchangeType.TOPIC`). **Current exchange list does NOT include `email.events`** — it must be added in Plan 24-01 (Infrastructure) or Plan 24-02.

Existing routing key format: `{domain}.{event_type}` (e.g., `email.inbound.received`).

**Critical Gap 2:** `email.events` exchange is missing from `message_bus.py`. Without it, any publish to this exchange silently fails.

**Gap 1 — Routing Key Conflict:** Both `EmailParsingAgent` and `EmailIntelAgent` would subscribe to `email.events / email.inbound.received`. BaseAgent creates a separate queue per agent (`f"queue.{self.agent_name}.{routing_key.replace('.', '_')}"`), so BOTH would receive every message. EmailIntelAgent must subscribe to `email.inbound.raw` (new key), and `communications.controller.ts` must publish to `email.inbound.raw` instead of `email.inbound.received`.

### Q3: vendor_promotions Table Schema

**Answer [VERIFIED: Plan 24-01-PLAN.md + existing RESEARCH.md analysis]:**

The Plan 24-01 SQL creates these columns:
```
id, provider_id, restaurant_id, detected_from_conversation_id, detected_from_email_subject,
product_name, grape_variety, region, discount_pct, discount_fixed, valid_from, valid_until,
promo_description, conditions, min_quantity, menu_fit, menu_fit_detail, dedup_hash,
status, created_at, updated_at
```

**MISSING for Plans 24-06/24-07 (need additional migration in Plan 24-01 or a new migration):**
```sql
urgency_score DECIMAL(4,2) DEFAULT NULL     -- D-16: urgency score 1-10
linked_event_ids UUID[] DEFAULT '{}'        -- D-17: calendar event links
last_comparison_price DECIMAL(10,2) DEFAULT NULL   -- D-18: cross-vendor price
price_source_inventory_id UUID              -- D-18: reference to restaurant_inventory
snoozed_until TIMESTAMPTZ DEFAULT NULL      -- UI: snooze action on deal card
```

### Q4: calendar_events Wine-Variety Columns

**Answer [VERIFIED: multiple migrations + DATABASE_SCHEMA.sql]:**

`calendar_events` schema columns (from Phase 30 migrations):
```
id, restaurant_id, provider_id, order_id, title, description, event_type, event_date,
event_date_end, all_day, event_time, event_time_end, source, ai_confidence,
detected_from_conversation_id, status, reminder_enabled, reminder_days_before,
reminder_sent, reminder_sent_at, created_by, created_at, updated_at
```

**NO `wine_requirements`, `wines_needed`, or `wine_variety` column exists.** PROMO↔Calendar matching (D-17) must use:
1. `event_type IN ('tasting', 'tasting_event', 'high_volume_expected')` — structural match
2. Optional text search in `description` for grape variety name

### Q5: order_items Table

**Answer [VERIFIED: supabase/migrations/20260304010000_missing_tables_consolidation.sql]:**

```sql
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id VARCHAR(100) NOT NULL,   -- NOT UUID — cannot join to procurement_orders
    wine_id VARCHAR(50) NOT NULL,     -- NOT UUID — cannot join to master_wine_library
    wine_name VARCHAR(255) NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    ...
);
```

**Key finding for D-18:** `order_items.wine_id` is VARCHAR(50), not UUID — cannot reliably join to `master_wine_library`. Use `restaurant_inventory.last_purchase_price` instead, joined via `master_wine_library.grape_variety` → `restaurant_inventory.master_wine_id`. This is a verified superior data source for cross-vendor price comparison.

### Q6: ProviderConversationAgent Current Haiku Prompt Template

**Answer [VERIFIED: provider_conversation_agent.py lines 75–103, 1630–1665]:**

The current `RESPONSE_SYSTEM_PROMPT` (line 75) injects:
- `{provider_digital_twin_summary}` — full digital twin JSONB blob (truncated to 2000 chars)
- `{style_profile}` — communication style profile JSON
- `{last_5_messages}` — **from in-memory session only** (not from `procurement_conversations` DB table)
- `{top_5_relevant_memories}` — semantic search results from `conversation_embeddings`
- `{intent_description}` — JSON of the current intent
- `{active_promos}` — from in-memory session, not DB query

**What D-19 requires (3 fields to add):**
1. `{last_3_db_interactions}` — last 3 rows from `procurement_conversations` WHERE `provider_id = X AND restaurant_id = Y ORDER BY created_at DESC LIMIT 3` — persisted, survives session restart
2. `{open_orders}` — `procurement_orders` WHERE `provider_id = X AND status IN ('pending','approved','ordered','negotiating')`
3. `{credit_terms}` — `negotiation_facts` WHERE `commitment_type = 'AGREEMENT' AND fact_field ILIKE '%payment%'` → fallback to `providers.notes`

**Current LLM:** `self.llm_client` is `google.generativeai.GenerativeModel` (OLD SDK, line 273) — called via `generate_content()` not `aio.models.generate_content()`. Plan 24-05 may optionally migrate to async HaikuClient from model_clients.py, but the CONTEXT.md doesn't mandate it. The simpler approach is to add the 3 DB context fields to the existing prompt while keeping the current Gemini model.

**Injection point:** `_generate_response()` method at line ~1625, around line 1645 where `RESPONSE_SYSTEM_PROMPT.format(...)` is called.

### Q7: notification_preferences Table — Digest Toggle Columns

**Answer [VERIFIED: migrations 20260208024921 + 20260220120100]:**

Current `notification_preferences` columns:
```sql
id, user_id, low_stock_channels[], order_channels[], report_channels[],
quiet_hours_enabled, quiet_hours_start, quiet_hours_end,
email_enabled, push_enabled, sms_enabled, categories JSONB, push_subscription JSONB,
created_at, updated_at
```

**No digest-specific columns exist.** Must be added via migration in Plan 24-01 (or a dedicated migration in Plan 24-06):
```sql
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS digest_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS digest_promos_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS digest_stalled_threads_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS digest_procurement_gaps_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS digest_send_hour INTEGER DEFAULT 8;  -- 0-23, local hour
```

---

## Standard Stack

### Core (verified against live codebase)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| aio_pika | existing | RabbitMQ async client | Used in message_bus.py |
| google-genai | ≥1.0.0 (AI-SPEC locked) | Gemini Flash LLM (NEW SDK) | AI-SPEC mandates `from google import genai`; NOT `google-generativeai` |
| anthropic | ≥0.50.0 (AI-SPEC locked) | Haiku LLM | `anthropic.AsyncAnthropic` for async BaseAgent context |
| redis (aioredis) | existing | Digest accumulation, idempotency | Used in BaseAgent |
| supabase-py | existing | All DB writes | Standard across agents |
| apscheduler | 3.10.4 | DigestCronJob cron scheduling | Already in requirements.txt; pattern in demo/weekly_report_scheduler.py |
| pytest / pytest-asyncio | existing | Test infrastructure | Standard across agents |
| pydantic | existing | EmailClassification, PromoDetails schemas | BaseAgent already uses it |

[VERIFIED: requirements.txt grep for apscheduler 3.10.4]

### Frontend

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React + TypeScript | existing | Dashboard.tsx, Providers.tsx | Project standard |
| Tailwind CSS | existing | All new card styling | Project standard |
| framer-motion | existing | Accordion animation, card entrance | Used in Dashboard.tsx, Providers.tsx |
| lucide-react | existing | Icons (Bell, ChevronDown, Tag, Mail) | Used in EventModal, Providers, Dashboard |
| sonner | existing | Toast notifications | Used in Dashboard.tsx |

### APScheduler DigestCronJob Pattern (existing in codebase)

```python
# Source: services/agent-orchestrator/demo/weekly_report_scheduler.py (VERIFIED pattern)
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from zoneinfo import ZoneInfo

class DigestCronJob:
    def __init__(self, supabase, redis, haiku_client):
        self.scheduler: Optional[AsyncIOScheduler] = None

    async def start(self):
        self.scheduler = AsyncIOScheduler()
        # Schedule per-restaurant at their local 8am
        # Simpler: run every hour, check if any restaurant is at local 8am
        self.scheduler.add_job(
            self._check_and_send_digests,
            CronTrigger(minute=0),  # Top of every hour
        )
        self.scheduler.start()

    async def _check_and_send_digests(self):
        """Check all restaurants; send digest for any where local time is 8am."""
        restaurants = await self._get_digest_enabled_restaurants()
        for r in restaurants:
            tz = ZoneInfo(r.get("timezone", "America/Los_Angeles"))
            local_hour = datetime.now(tz).hour
            if local_hour == 8:
                await self._send_digest(r["id"], tz)
```

---

## Architecture Patterns

### System Architecture Diagram

```
Gmail Inbox/Sent (watched via Pub/Sub)
      │
      ▼ Pub/Sub push
NestJS communications.controller.ts
      │
      │ publishEvent('email.events', 'email.inbound.raw', {..., labelIds, gmail_thread_id})
      │  ← NOTE: must change from 'email.inbound.received' to 'email.inbound.raw' (Gap 1)
      ▼
RabbitMQ: email.events exchange (TOPIC) ← must declare in message_bus.py (Gap 2)
      │
      ├──▶ EmailIntelAgent queue (subscribes: email.inbound.raw)
      │         │
      │         ├── direction=outbound → _link_sent_email() → return
      │         │
      │         ├── NOISE → silent discard
      │         │
      │         ├── PROMO ──▶ vendor_promotions (INSERT with dedup_hash)
      │         │          ──▶ urgency_score computation (D-16)
      │         │          ──▶ calendar_events query → linked_event_ids (D-17)
      │         │          ──▶ restaurant_inventory → last_comparison_price (D-18)
      │         │          ──▶ Redis digest:{restaurant_id}:{date} (LPUSH, 36h TTL)
      │         │          ──▶ NestJS notification HTTP → NotificationsService
      │         │
      │         └── OPERATIONAL ──▶ republish to 'email.inbound.received'
      │
      └──▶ EmailParsingAgent queue (subscribes: email.inbound.received)  ← unchanged
                └──▶ procurement_conversations (INSERT)
                └──▶ ProcurementAgent (route)

Redis digest:{restaurant_id}:{date} (36h TTL)
      │ (DigestCronJob checks hourly, sends at local 8am)
      ▼
HaikuClient → natural language paragraph (Haiku 4.5, max_tokens=512)
      │
EmailClient SMTP → manager inbox (via settings.gmail_user/password)

ProviderConversationAgent
      │
      ├── D-19: inject last 3 DB interactions + open orders + credit terms
      │   into RESPONSE_SYSTEM_PROMPT via _build_context_for_prompt()
      │
      └── Approved reply → GmailService.sendEmail() (via api-gateway)
```

### Recommended Project Structure

```
services/agent-orchestrator/
├── core/
│   └── message_bus.py        # ADD: email.events + agent.events exchange declarations
├── agents/
│   ├── email_intel_agent.py   # NEW (Plan 24-04) — subscribes email.inbound.raw
│   └── provider_conversation_agent.py  # MODIFY (Plan 24-05) — D-19 context injection
├── services/
│   ├── model_clients.py       # NEW/RECREATE (Plan 24-03)
│   └── menu_fit_analyzer.py   # NEW (Plan 24-04) — optional, can be inline
├── cron/
│   └── digest_cron_job.py     # NEW (Plan 24-06) — APScheduler pattern
└── models/
    └── email_intel.py         # NEW (Plan 24-04) — Pydantic schemas per AI-SPEC §4b

apps/api-gateway/src/communications/
└── gmail-watch.service.ts     # MODIFY (Plan 24-02) — remove labelId INBOX filter

.planning/sketches/
└── 024-deal-card/
    └── index.html             # NEW (Plan 24-08) — 3 variant accordion cards
```

### Pattern: BaseAgent Level 4 Wire-Up

```python
# Source: services/agent-orchestrator/core/base_agent.py (verified)
# _check_idempotency, _send_to_dlq, log_decision methods exist in BaseAgent
async def process_message(self, routing_key: str, payload: dict) -> None:
    message_id = payload.get("gmail_message_id") or payload.get("message_id", "")
    if await self._check_idempotency(f"email_intel:{message_id}"):
        return
    try:
        await self._route_message(routing_key, payload)
        await self._mark_processed(f"email_intel:{message_id}", {"status": "ok"})
    except Exception as e:
        await self._send_to_dlq(payload, str(e), routing_key)
        raise
```

### Pattern: NotificationsService.createNotification() — Cross-Service Call

```typescript
// Source: apps/api-gateway/src/notifications/notifications.service.ts (verified)
// Signature: createNotification({ userId, restaurantId, type, title, message, priority, actionUrl, metadata })
// EmailIntelAgent (Python) CANNOT call this directly — must publish RabbitMQ event
// NestJS orchestrator subscribes → calls createNotification()
// OR: EmailIntelAgent calls Supabase directly to INSERT into notifications table
// (same effect — NotificationsService WebSocket push fires on frontend read)
await notificationsService.createNotification({
  userId: managerId,
  restaurantId: restaurantId,
  type: 'email_classified_promo',
  title: '🏷️ Deal: Barolo 20% off from PlumpJack',
  message: 'PROMO classified — review deal',
  priority: 'medium',
  actionUrl: '/providers',
  metadata: { promo_id: promoId, provider_id: providerId },
});
```

### Pattern: Redis Digest Accumulation

```python
# Source: design verified against BaseAgent Redis usage patterns
today = date.today().isoformat()
digest_key = f"digest:{restaurant_id}:{today}"
item = json.dumps({"vendor": vendor_name, "product": product_name,
                   "discount_pct": discount_pct, "urgency_score": urgency_score})
pipe = redis.pipeline()
pipe.lpush(digest_key, item)
pipe.expire(digest_key, 36 * 3600)  # 36h TTL, refreshed on each write
await pipe.execute()
```

---

## Plan 24-01: DB Migrations — What Needs to Be Built

NOT executed. Migration files `20260415000002` and `20260415000003` do not exist.

**Tables to create:**
1. `conversation_embeddings` — vector(768) with HNSW index
2. `vendor_promotions` — with ALL needed columns including urgency_score, linked_event_ids, last_comparison_price, snoozed_until
3. `provider_conversation_sessions` — session lifecycle tracking

**Column additions:**
- `providers.close_relationship BOOLEAN DEFAULT false`
- `providers.auto_reply_enabled BOOLEAN DEFAULT false` ← MUST be false
- `procurement_conversations.gmail_thread_id TEXT`
- `procurement_conversations.conversation_context JSONB`
- `negotiation_facts.commitment_type` with INDICATIVE/OFFER/COUNTER/AGREEMENT constraint
- `notification_preferences` digest toggle columns (see Q7)

**Key constraint:** `auto_reply_enabled DEFAULT false` is non-negotiable (premortem risk R-10).

---

## Plan 24-02: Gmail Watch Expansion — What Needs to Be Built

NOT executed (SUMMARY file is ghost).

**Changes needed:**
1. Update `GMAIL_WATCH_LABEL_IDS` env var support: already supported in `startWatch()` via `this.configService.get('GMAIL_WATCH_LABEL_IDS')?.split(',') || ['INBOX']` — only env var change needed on Railway
2. **Fix `fetchNewMessages` labelId filter** (Gap 3): remove `labelId: 'INBOX'` from `history.list()` call at line 177
3. Add direction detection from `fullMessage.data.labelIds`
4. Update `publishEvent` routing key from `email.inbound.received` to `email.inbound.raw` (Gap 1)
5. Add `gmail_thread_id: msg.threadId` to the publish payload

**Wave 0:** Recreate 7 pytest stub files from Plan 24-02 SUMMARY (they're documented, just missing from disk).

---

## Plan 24-03: model_clients.py — What Needs to Be Built

NOT on disk (SUMMARY file is ghost). Must recreate per AI-SPEC §3.

**File: `services/agent-orchestrator/services/model_clients.py`**

```python
# Per AI-SPEC §3 — use NEW google-genai SDK, NOT google-generativeai
from google import genai
from google.genai import types as genai_types
import anthropic
from config.settings import Settings

_gemini_client: genai.Client | None = None
_haiku_client: anthropic.AsyncAnthropic | None = None

def get_gemini_client() -> genai.Client:
    global _gemini_client
    if _gemini_client is None:
        settings = Settings()
        _gemini_client = genai.Client(api_key=settings.google_api_key)
    return _gemini_client

def get_haiku_client() -> anthropic.AsyncAnthropic:
    global _haiku_client
    if _haiku_client is None:
        settings = Settings()
        _haiku_client = anthropic.AsyncAnthropic(api_key=settings.claude_api_key)
    return _haiku_client
```

**Settings.py additions needed:**
```python
claude_api_key: str = Field(default="", env="CLAUDE_API_KEY")
gemini_model: str = Field(default="gemini-2.0-flash", env="GEMINI_MODEL")
haiku_model: str = Field(default="claude-haiku-4-5-20251001", env="HAIKU_MODEL")
```

---

## Plan 24-04: EmailIntelAgent — What Needs to Be Built

NOT executed. Full implementation per AI-SPEC §4.

**File: `services/agent-orchestrator/agents/email_intel_agent.py`**

Key implementation points (full code in AI-SPEC §4):
- Subscribes to `("email.events", "email.inbound.raw")` — NOT `email.inbound.received`
- `haiku_semaphore = asyncio.Semaphore(5)` created in `initialize()`, not `__init__`
- Email age check: skip if `received_at` > 18h old before Redis LPUSH
- Redis LPUSH + EXPIRE in pipeline (atomic, no TTL race)
- dedup_hash: `SHA256(vendor_email + product_name + date)`
- OPERATIONAL → republish to `email.inbound.received` with `__intel_bypass: True`
- Notification: publish to `notification.events / notification.email_classified` → NestJS picks up

---

## Plan 24-05: ProviderConversationAgent Level 4 — What Needs to Be Built

NOT executed. Surgical additions to existing 2519-line agent.

**D-19 Context Injection (new method `_get_db_context_for_prompt()`):**
```python
async def _get_db_context_for_prompt(self, provider_id: str, restaurant_id: str) -> dict:
    """Fetch last 3 DB interactions, open orders, credit terms."""
    # Last 3 interactions from procurement_conversations (persisted, survives session restart)
    convs = (self.database.supabase.table("procurement_conversations")
             .select("direction, message_text, created_at")
             .eq("provider_id", provider_id).eq("restaurant_id", restaurant_id)
             .order("created_at", desc=True).limit(3).execute())
    # Open orders
    orders = (self.database.supabase.table("procurement_orders")
              .select("wine_name, quantity, status, notes")
              .eq("provider_id", provider_id)
              .in_("status", ["pending", "approved", "ordered", "negotiating"])
              .execute())
    # Credit terms from negotiation_facts (commitment_type='AGREEMENT', fact_field ILIKE '%payment%')
    # Falls back to providers.notes
    return {"last_3_interactions": convs.data or [],
            "open_orders": orders.data or [],
            "credit_terms": credit_terms_str}
```

**Other Level 4 additions:**
- `_check_idempotency()` + `_send_to_dlq()` wrapping in `process_message()`
- `log_decision()` call in `_generate_response()` before sending
- Sensitivity detection: reuse `SensitivityDetector` from existing codebase
- `close_relationship` mode: check `providers.close_relationship` → adjust tone
- `manager_instructions[]` read-in from `conversation_context` JSONB
- Learning loop: log diff of original vs. edited draft → Haiku preference extraction
- `PROV_AGENT_LEVEL4_ENABLED` feature flag in settings.py (canary rollout)

---

## Plan 24-06: DigestCronJob + Frontend Cards — Architecture

### DigestCronJob (Python)

**File: `services/agent-orchestrator/cron/digest_cron_job.py`**

Using APScheduler (apscheduler==3.10.4 in requirements.txt, pattern from `demo/weekly_report_scheduler.py`):
- `AsyncIOScheduler` + `CronTrigger(minute=0)` — runs hourly, checks restaurant TZ
- For each restaurant where `digest_enabled=true` and local time is 8am: sends digest
- Sections: (a) promo deals sorted by urgency_score DESC, (b) stalled threads >24h, (c) procurement gaps (events in 7 days where wine stock < threshold)
- Digest header: Gmail Watch status from Redis `gmail:watch:expiration` key
- Skip entirely if all sections are empty
- Send via `EmailClient` SMTP (existing `services/email_client.py`)

**Redis key access:**
```python
from zoneinfo import ZoneInfo

digest_key = f"digest:{restaurant_id}:{today}"
watch_expiry = await redis.get("gmail:watch:expiration")  # from GmailWatchService
items = await redis.lrange(digest_key, 0, -1)
items_sorted = sorted([json.loads(i) for i in items], key=lambda x: x.get("urgency_score", 0), reverse=True)
```

### Dashboard Frontend Cards

**Placement:** New section in `Dashboard.tsx` after the calendar widget (line ~737 based on existing grid structure).

**Layout pattern** (matching existing Dashboard cards):
```tsx
// Matches existing: bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden
<motion.div variants={itemVariants} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
  <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
    <div className="flex items-center gap-2">
      <Mail className="w-4 h-4 text-[#8b1a2f]" />
      <h2 className="font-semibold text-gray-900">Provider Comms</h2>
    </div>
    <span className="text-xs font-medium px-2 py-0.5 bg-red-50 text-red-700 rounded-full">
      {unansweredCount} unanswered
    </span>
  </div>
  {/* compact timeline row per provider: green <24h, yellow 1-3d, red >3d */}
</motion.div>
```

**Expandable Deals Card** (accordion inline — NOT modal per D-14):
```tsx
<AnimatePresence>
  {isExpanded && (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      className="overflow-hidden"
    >
      {/* Haiku analysis paragraph + 4 pill actions */}
    </motion.div>
  )}
</AnimatePresence>
```

### Providers Page Full Relationship View

Existing Providers.tsx already has `ProviderIntelligencePanel` (line 914) — extend it with:
- Conversation history tab (last N messages from `procurement_conversations`)
- Promo history tab (all `vendor_promotions` for this provider)
- Last contact + response rate stats
- `auto_reply_enabled` toggle (alongside existing UI, no new route needed)

### Deal Brief Documents

Follows `MeetingMemoPrompt.tsx` pattern exactly:
- New doc type: `'deal_brief'` (add to `DOC_TYPE` enum)
- Auto-triggered when PROMO notification is created (same pattern as post-event memo prompt)
- Fields: product name, vendor, discount %, urgency score, cross-vendor price delta, recommended action
- Uses same slide-in modal UI pattern with `AnimatePresence`

---

## Plan 24-07: Creative Value Features — Implementation Map

### D-16: Deal Urgency Score

**Input tables:** `vendor_promotions` (menu_fit) + `restaurant_inventory` (stock_live, threshold_min) + `calendar_events` (nearest linked event_date)

**Formula:**
```python
def compute_urgency_score(menu_fit: str, stock_live: int, threshold_min: int, event_date) -> float:
    fit_map = {"STRONG_FIT": 1.0, "PARTIAL_FIT": 0.6, "NO_FIT": 0.0, "PENDING": 0.3}
    fit_score = fit_map.get(menu_fit, 0.3)
    target = max(threshold_min, 1)
    stock_factor = max(0.0, 1.0 - (stock_live / (target * 2)))
    if event_date:
        days = (event_date - date.today()).days
        prox = 1.0 if days <= 3 else (0.8 if days <= 7 else (0.5 if days <= 14 else (0.2 if days <= 30 else 0.1)))
    else:
        prox = 0.1
    return round(min(10.0, fit_score * stock_factor * prox * 10), 1)
```

**Trigger:** After PROMO extraction in EmailIntelAgent, before `vendor_promotions` INSERT.

### D-17: PROMO↔Calendar Auto-Link

**NO wine_requirements column in calendar_events** — must use event_type + description text search.

```python
WINE_EVENT_TYPES = ['tasting', 'tasting_event', 'high_volume_expected']

async def find_linked_events(restaurant_id, grape_variety, region, supabase):
    cutoff = (date.today() + timedelta(days=30)).isoformat()
    result = (supabase.table("calendar_events")
              .select("id, event_type, description, title, event_date")
              .eq("restaurant_id", restaurant_id).eq("status", "approved")
              .gte("event_date", date.today().isoformat()).lte("event_date", cutoff)
              .execute())
    linked = []
    search_terms = [t.lower() for t in [grape_variety, region] if t]
    for ev in (result.data or []):
        if ev["event_type"] in WINE_EVENT_TYPES:
            linked.append(ev["id"])
        elif search_terms:
            text = ((ev.get("description") or "") + " " + (ev.get("title") or "")).lower()
            if any(term in text for term in search_terms):
                linked.append(ev["id"])
    return linked
```

**Frontend (EventModal.tsx):** Query `vendor_promotions WHERE linked_event_ids @> ARRAY[event_id::uuid]` → show "📬 Deal available" chip in event detail section.

### D-18: Cross-Vendor Price Intelligence

**Source:** `restaurant_inventory.last_purchase_price` (NOT `order_items` — VARCHAR wine_id blocks join).

```python
async def get_last_purchase_price(restaurant_id, grape_variety, supabase) -> float | None:
    if not grape_variety:
        return None
    result = (supabase.table("restaurant_inventory")
              .select("last_purchase_price, master_wine_library!inner(grape_variety)")
              .eq("restaurant_id", restaurant_id)
              .not_.is_("last_purchase_price", "null")
              .order("updated_at", desc=True).limit(10).execute())
    for row in (result.data or []):
        mwl = row.get("master_wine_library") or {}
        if grape_variety.lower() in (mwl.get("grape_variety") or "").lower():
            return row.get("last_purchase_price")
    return None
```

### D-19: Composer Context Injection

Injection point: `provider_conversation_agent.py` line ~1645, `RESPONSE_SYSTEM_PROMPT.format(...)`.

New fields to add to `RESPONSE_SYSTEM_PROMPT`:
```python
RESPONSE_SYSTEM_PROMPT = """...
RECENT CONVERSATION HISTORY (from database, last 3 messages):
{last_3_db_interactions}

OPEN ORDERS FOR THIS PROVIDER:
{open_orders}

PROVIDER CREDIT TERMS:
{credit_terms}
...
```

Credit terms source: `negotiation_facts WHERE commitment_type='AGREEMENT' AND fact_field ILIKE '%payment%'` → fallback: `providers.notes`.

---

## Plan 24-08: Premortem Risk Documentation + UI Sketches

### Premortem Risks — Current Mitigation Status

| # | Risk | Status | What's Built | What's Missing |
|---|------|--------|-------------|----------------|
| R-01 | Routing key conflict (double processing) | **NOT MITIGATED** | Nothing | Change `publishEvent` to `email.inbound.raw`; fix EmailIntelAgent subscription |
| R-02 | `email.events` not in message_bus.py | **NOT MITIGATED** | Nothing | Add exchange declaration in Plan 24-01 or 24-02 |
| R-03 | `fetchNewMessages` blocks SENT | **NOT MITIGATED** | Nothing | Remove `labelId: 'INBOX'` from history.list() |
| R-04 | `vendor_promotions` missing urgency/linked_event_ids columns | **NOT MITIGATED** | Nothing | Add to Plan 24-01 migration |
| R-05 | `notification_preferences` missing digest columns | **NOT MITIGATED** | Nothing | Add to Plan 24-01 migration |
| R-06 | Stale RabbitMQ backlog | **NOT MITIGATED** | Nothing | 18h age check in EmailIntelAgent |
| R-07 | Redis TTL race (LPUSH then EXPIRE) | **NOT MITIGATED** | Nothing | Use pipeline in EmailIntelAgent |
| R-08 | Redis 36h vs 48h TTL mismatch | **NOT MITIGATED** | Nothing | Enforce 36h in Plan 24-04 |
| R-09 | Haiku flood without semaphore | **NOT MITIGATED** | Nothing | `asyncio.Semaphore(5)` in EmailIntelAgent.initialize() |
| R-10 | `auto_reply_enabled DEFAULT true` | **NOT MITIGATED** | Nothing | Must be `DEFAULT false` in Plan 24-01 migration |
| R-11 | ProviderConversationAgent regression | **NOT MITIGATED** | Nothing | `PROV_AGENT_LEVEL4_ENABLED` flag in Plan 24-05 |
| R-12 | Watch renewal silent failure | **PARTIALLY MITIGATED** | GmailWatchService auto-renews every 6 days | DigestCronJob must read `WATCH_EXPIRY_KEY` from Redis and include in header |
| R-13 | UCC contract formation via auto-reply | **NOT MITIGATED** | Nothing | Commitment language regex block before auto-send (per AI-SPEC §6) |
| R-14 | Thread cross-contamination (gmail_thread_id collision on forwarded emails) | **NOT MITIGATED** | Nothing | Validate `gmail_thread_id` uniqueness per restaurant; flag anomaly if collision |
| R-15 | Manager learning loop poisoning | **NOT MITIGATED** | Nothing | Validate correction diffs are sanity-checked before extracting `manager_instructions` |

**Recommendation for Plan 24-08:** This plan should be a **documentation + code guard plan** that:
1. Writes a premortem doc in `.planning/phases/24-.../24-PREMORTEM.md`
2. Implements R-13 (commitment language guard) as a regex check in ProviderConversationAgent
3. Ensures all other risks are addressed by their respective plans (R-01 through R-12 are in Plans 24-01 through 24-07)

### UI Sketches — 3 Variants

**File:** `.planning/sketches/024-deal-card/index.html`

**Design language (from verified source files):**

From Dashboard.tsx:
- Card wrapper: `bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden`
- Animation: `framer-motion` `motion.div` with fade+y slide variants
- Status colors: green = `text-green-600 bg-green-50`, yellow = `text-yellow-600 bg-yellow-50`, red = `text-red-600 bg-red-50`
- Wine accent: `text-[#8b1a2f]` or Tailwind `wine-600` (custom color)
- Grid: `grid grid-cols-1 lg:grid-cols-3 gap-6`
- `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4` for stat row

From EventModal.tsx (verified):
- Label strip colors: `#901d42` (wine red), `#10B981` (green), `#8B5CF6` (purple)
- Label bg colors: `#fdf4f5`, `#f0fdf4`, `#f5f3ff`
- Icon + text chips with pill shape
- `ChevronDown` / `ChevronUp` for expand/collapse (lucide-react)
- Inline `<Tag />` icons for deal labels

From MeetingMemoPrompt.tsx (verified):
- Slide-in panel: `motion.div` with backdrop `fixed inset-0`
- Section headers: `text-sm font-medium text-gray-700`
- "Why this reply?" pattern: collapsed by default, `ChevronDown` → expand
- Note save button: wine-red accent `bg-[#901d42] text-white`
- `AnimatePresence` for mount/unmount

From Providers.tsx (verified):
- `ProviderIntelligencePanel` — existing slide-in panel for provider details
- `TypeBadge` — dot + label pill pattern

**Variant A — Minimal Pill Row** (dashboard-first, space-efficient):
- Collapsed: single row `flex items-center` with vendor pill, product, discount badge, urgency dot (green/yellow/red), expiry text, ▼ chevron
- Expanded: grey inline panel `bg-gray-50 rounded-b-lg p-4` with Haiku paragraph + 4 pill buttons

**Variant B — Card-with-Preview** (content-first, info-dense):
- Collapsed: card with first sentence of Haiku analysis, urgency progress bar, expiry countdown
- Expanded: full analysis + action pills + `vs. last price: $18 → $14.40` comparison line

**Variant C — Timeline-Integrated** (calendar-aware):
- Collapsed: deal row with linked event chip (`🗓 June 3 tasting • 14d`)
- Expanded: event proximity indicator + full analysis + action pills

**Quick action pill states:**
| Pill | Action | API call |
|------|--------|---------|
| 📧 Reply to Vendor | Slide-in conversation composer | PATCH vendor_promotions status = 'actioned' |
| ✓ Note it | Toast confirmation | PATCH vendor_promotions status = 'actioned' |
| ⏰ Snooze 3d | PATCH snoozed_until = now+3d | PATCH vendor_promotions snoozed_until |
| ✗ Dismiss | PATCH status = 'suppressed' | PATCH vendor_promotions status = 'suppressed' |

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Email classification | Custom regex rules | Gemini Flash LLM (AI-SPEC §3) | Rule maintenance; LLM handles edge cases |
| Digest scheduling | Custom cron daemon | APScheduler `AsyncIOScheduler` (existing) | Already in requirements.txt; pattern in demo/ |
| SMTP sending | Raw socket | `EmailClient` (Python existing) + GmailService (NestJS) | OAuth2 + SMTP fallback already built |
| Promo dedup | Time-windowed counter | SHA256 hash + Supabase dedup_hash query | Collision-safe; Plan 24-04 design |
| Urgency score | ML model | Simple formula: `menu_fit × stock_factor × calendar_prox` | D-16 locks formula; interpretable |
| TZ-aware 8am | Manual UTC math | `zoneinfo.ZoneInfo` (stdlib Python 3.9+) | Clean, DST-aware |

---

## Database Schema Findings

### vendor_promotions — full column list (Plan 24-01 target)
```sql
-- From Plan 24-01-PLAN.md (must verify after execution):
id, provider_id, restaurant_id, detected_from_conversation_id, detected_from_email_subject,
product_name, grape_variety, region, discount_pct, discount_fixed, valid_from, valid_until,
promo_description, conditions, min_quantity, menu_fit, menu_fit_detail, dedup_hash,
status, created_at, updated_at
-- MUST be added (missing from Plan 24-01 original schema):
urgency_score DECIMAL(4,2), linked_event_ids UUID[], last_comparison_price DECIMAL(10,2),
price_source_inventory_id UUID, snoozed_until TIMESTAMPTZ
```

### calendar_events — no wine columns
```
id, restaurant_id, provider_id, order_id, title, description, event_type, event_date,
event_date_end, all_day, event_time, event_time_end, source, ai_confidence,
detected_from_conversation_id, status, reminder_enabled, reminder_days_before,
reminder_sent, reminder_sent_at, created_by, created_at, updated_at
```
**No wine_requirements column. PROMO↔Calendar match uses event_type + description text.**

### order_items — not suitable for D-18 joins
```sql
order_id VARCHAR(100), wine_id VARCHAR(50), wine_name VARCHAR(255),
unit_price DECIMAL(10,2), total_price DECIMAL(10,2), quantity INTEGER
```
**wine_id is VARCHAR(50), not UUID — use restaurant_inventory.last_purchase_price instead.**

### restaurant_inventory — correct source for D-18
```sql
stock_live INTEGER, threshold_min INTEGER, last_purchase_price DECIMAL(10,2),
master_wine_id UUID REFERENCES master_wine_library(id)
```

### notification_preferences — missing digest columns (see Q7)
Current: `user_id, low_stock_channels[], order_channels[], report_channels[], quiet_hours_*, email_enabled, push_enabled, sms_enabled, categories JSONB, push_subscription JSONB`
Missing: `digest_enabled, digest_promos_enabled, digest_stalled_threads_enabled, digest_procurement_gaps_enabled, digest_send_hour`

### providers — credit terms
No `credit_terms` column. Use `negotiation_facts WHERE commitment_type='AGREEMENT' AND fact_field ILIKE '%payment%'` → fallback `providers.notes`.

---

## Common Pitfalls

### Pitfall 1: Both Agents on Same Routing Key
Both EmailIntelAgent and EmailParsingAgent subscribe to `email.inbound.received` → duplicate processing. **Fix:** EmailIntelAgent subscribes to `email.inbound.raw`, receives all raw Gmail events. Re-publishes OPERATIONAL to `email.inbound.received`. [VERIFIED: Gap 1]

### Pitfall 2: email.events Exchange Not Declared
`message_bus.py` exchange list does NOT include `email.events`. Publish silently fails. **Fix:** Add `("email.events", ExchangeType.TOPIC, True)` in `_declare_exchanges()`. [VERIFIED: Gap 2]

### Pitfall 3: fetchNewMessages INBOX Filter Blocks SENT
`history.list()` `labelId: 'INBOX'` silently excludes all SENT messages. **Fix:** Remove filter; detect direction from `fullMessage.labelIds`. [VERIFIED: Gap 3]

### Pitfall 4: Semaphore Created in __init__
`asyncio.Semaphore(5)` MUST be created in `initialize()` (inside running event loop), not `__init__`. Creating it at class instantiation time fails silently or raises `RuntimeError`. [CITED: AI-SPEC §3 pitfall 4]

### Pitfall 5: auto_reply_enabled DEFAULT true
If migration uses `DEFAULT true`, all existing providers immediately get auto-send enabled. **Must be `DEFAULT false`.** [VERIFIED: premortem R-10]

### Pitfall 6: Redis Digest TTL Race
EXPIRE runs before LPUSH confirms → partial key with wrong TTL. **Fix:** Use `pipeline()` — `lpush` then `expire` atomically.

### Pitfall 7: Stale Email in Digest
RabbitMQ backlog after restart delivers old emails to EmailIntelAgent. Skip LPUSH for emails where `received_at` > 18h old.

---

## Environment Availability

| Dependency | Required By | Available | Version | Notes |
|------------|------------|-----------|---------|-------|
| RabbitMQ | All agents | ✓ | existing | All agents use it |
| Redis (Upstash) | Digest, idempotency | ✓ | existing | BaseAgent uses it |
| Supabase (pgvector) | conversation_embeddings | ✓ | existing | Already in migrations |
| google-genai | EmailIntelAgent | ✗ (needs install) | ≥1.0.0 | Must `pip install "google-genai>=1.0.0"` |
| anthropic | EmailIntelAgent, DigestCronJob | requires verify | ≥0.50.0 | Check if already installed |
| APScheduler | DigestCronJob | ✓ | 3.10.4 | In requirements.txt |
| zoneinfo | DigestCronJob | ✓ | stdlib | Python 3.9+ standard library |
| model_clients.py | Plans 24-04, 24-05 | ✗ (missing) | Plan 24-03 | Must recreate per AI-SPEC §3 |

**Missing dependencies with no fallback:** `model_clients.py` (Plan 24-03 must run first), `google-genai` package (must install).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest + pytest-asyncio (existing) |
| Config file | `services/agent-orchestrator/pytest.ini` or `setup.cfg` (verify) |
| Quick run command | `cd services/agent-orchestrator && pytest tests/ -q` |
| Import check | `python3 -c "from agents.email_intel_agent import EmailIntelAgent"` |

### Phase Requirements → Test Map

| Decision | Behavior | Test File | Type |
|----------|----------|-----------|------|
| D-01 routing | `email.inbound.raw` → EmailIntelAgent | test_email_intel_agent.py | unit |
| D-16 urgency | score 1–10, formula correct | test_email_intel_agent.py | unit |
| D-17 calendar link | linked_event_ids populated | test_email_intel_agent.py | unit |
| D-18 price comparison | last_comparison_price set | test_email_intel_agent.py | unit |
| R-06 stale email | >18h old → skipped | test_email_intel_agent.py | unit |
| R-09 semaphore | max 5 concurrent | test_email_intel_agent.py | integration |
| D-04 digest timezone | 8am local TZ check | test_digest_cron_job.py (new) | unit |
| R-10 auto_reply_enabled | DEFAULT false | DB migration test | smoke |

### Wave 0 Gaps

- [ ] Recreate 7 test stubs from Plan 24-02 SUMMARY (already documented, just missing from disk)
- [ ] `services/agent-orchestrator/tests/test_digest_cron_job.py` — new stubs for Plan 24-06
- [ ] Verify `model_clients.py` import works after Plan 24-03 execution

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | OAuth2 handled by existing GmailService |
| V4 Access Control | yes | `restaurant_id` scoping on ALL DB writes (mandatory) |
| V5 Input Validation | yes | Email body truncated to 8192 chars; JSON mode enforced |
| V6 Cryptography | no | Redis uses TLS via Upstash |
| V10 Malicious Code | yes | Prompt injection mitigation via JSON mode + output parsing |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Email body prompt injection | Tampering | Truncate body to 8192 chars; JSON mode; validate via Pydantic |
| Duplicate promo via Pub/Sub | Denial of Service | 7-day dedup_hash suppression; idempotency check |
| UCC contract formation via auto-reply | Repudiation | Commitment language regex block before auto-send (AI-SPEC §6 guardrail) |
| Auto-reply to wrong recipient | Spoofing | `To:` field locked to provider.primary_contact.email; mismatch logged as anomaly |
| Sensitive personal content in vector store | Information Disclosure | Sensitivity detection before embedding; `[SENSITIVE]` placeholder |
| Redis key exposure | Information Disclosure | Key scoped per restaurant_id; Upstash TLS enforced |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Plan 24-01 migration correctly applies all columns (including urgency_score, linked_event_ids) | DB Schema | Plans 24-06/07 fail on write — re-run migration |
| A2 | `negotiation_facts` table has `fact_field`, `fact_value`, `commitment_type` columns | D-19 Credit Terms | Fallback to providers.notes only |
| A3 | `master_wine_library.grape_variety` column exists for D-18 join | D-18 Cross-vendor price | Price intelligence unavailable; show "no comparison" |
| A4 | `restaurants.timezone` column exists (default 'America/Los_Angeles') | DigestCronJob | Falls back to UTC |
| A5 | `google-genai>=1.0.0` installs without conflict alongside existing `google-generativeai` | Plan 24-03 | Module name collision; requires explicit version pinning |

---

## Open Questions

1. **Does `google-genai` coexist with `google-generativeai` in requirements.txt?**
   - What we know: `email_parsing_agent.py` uses `google-generativeai` (old SDK). `model_clients.py` must use `google-genai` (new SDK).
   - What's unclear: Whether both can coexist without conflict.
   - Recommendation: Pin `google-genai==1.33.0` explicitly; remove old `google-generativeai` from requirements or keep both under separate imports.

2. **How does EmailIntelAgent (Python) call NestJS NotificationsService?**
   - What we know: EmailIntelAgent is Python; NotificationsService is NestJS.
   - What's unclear: Does it call via HTTP or publish a RabbitMQ event?
   - Recommendation: Direct Supabase INSERT to `notifications` table (same tables NotificationsService writes to) — simpler than HTTP or additional RabbitMQ event; WebSocket push fires on frontend subscription.

3. **Where does DigestCronJob start in the agent-orchestrator lifecycle?**
   - What we know: APScheduler pattern exists in `demo/weekly_report_scheduler.py`.
   - What's unclear: Is DigestCronJob a standalone process or started from `orchestrator.py`?
   - Recommendation: Add `DigestCronJob` startup in `core/orchestrator.py` alongside other agent initializations.

4. **Should Plan 24-08 (Premortem) be documentation-only or include code guards?**
   - Recommendation: Include the commitment language regex guard (R-13) as a code change. All other risks (R-01 through R-12) should be referenced to their respective implementation plans.

---

## Sources

### Primary (HIGH confidence — verified against live codebase)
- `apps/api-gateway/src/communications/gmail-watch.service.ts` — fetchNewMessages, labelId filter (line 177)
- `apps/api-gateway/src/notifications/notifications.service.ts` — createNotification() signature
- `services/agent-orchestrator/core/base_agent.py` — queue naming, lifecycle
- `services/agent-orchestrator/core/message_bus.py` — exchange declarations (email.events absent)
- `services/agent-orchestrator/agents/email_parsing_agent.py` — subscription routing key, gmail_thread_id handling
- `services/agent-orchestrator/agents/provider_conversation_agent.py` — RESPONSE_SYSTEM_PROMPT (line 75), _generate_response (line 1645)
- `services/agent-orchestrator/requirements.txt` — apscheduler==3.10.4, celery==5.3.6
- `services/agent-orchestrator/demo/weekly_report_scheduler.py` — APScheduler pattern
- `supabase/migrations/20260208024921_new-migration.sql` — notification_preferences base schema
- `supabase/migrations/20260220120100_notifications_crud.sql` — notification_preferences extensions
- `supabase/migrations/20260304010000_missing_tables_consolidation.sql` — order_items schema
- `apps/web/src/pages/Dashboard.tsx` — card patterns, grid structure, framer-motion usage
- `apps/web/src/pages/Providers.tsx` — ProviderIntelligencePanel, TypeBadge, view modes
- `apps/web/src/pages/calendar/EventModal.tsx` — label colors, chip patterns, collapse/expand
- `apps/web/src/pages/calendar/MeetingMemoPrompt.tsx` — Deal Brief pattern, doc type picker
- `.planning/phases/24-.../24-01-PLAN.md` — vendor_promotions schema (missing urgency_score)
- `.planning/phases/24-.../24-02-SUMMARY.md` — test stubs documented (files not on disk)
- `.planning/phases/24-.../24-03-SUMMARY 2.md` — model_clients.py documented (file not on disk)
- Git log — confirms zero Phase 24 implementation commits in current repo

### Cited
- AI-SPEC Phase 24 §3-6 — framework selection, code patterns, pitfalls, guardrails, evaluation strategy

---

## Metadata

**Confidence breakdown:**
- Routing conflict / exchange infrastructure gaps: HIGH — verified against live code
- Database schema: HIGH — read actual SQL files and plan artifacts
- Plan execution status: HIGH — confirmed by git log (no implementation commits) and filesystem (files absent)
- Creative feature implementation: HIGH — derived from locked decisions + verified schema
- model_clients.py pattern: MEDIUM — file absent, pattern from SUMMARY + AI-SPEC
- Sketch design language: HIGH — read actual component files

**Research date:** 2026-05-13
**Valid until:** 2026-06-13
