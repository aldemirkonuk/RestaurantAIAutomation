# Phase 32 Research: Provider Outbound Communication Engine

**Researched:** 2026-05-14
**Domain:** Outbound email drafting pipeline, provider intelligence profiles, constraint enforcement, off-app invoice matching
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-32-01**: Order→Email trigger, 5-step flow, notification-first, never auto-email without approval (unless 3-gate auto-send)
- **D-32-02**: 4 email types — PRICE_INQUIRY, DEMAND_OFFER, PROMO_INQUIRY, WINE_INQUIRY
- **D-32-03**: Context window — flat ~6k tokens, progressive summarization, rolling summary + last 3 emails + negotiation_facts
- **D-32-04**: Hard Redis caps — 500 classify/day, 50 negotiation/day, 12 rounds max; 8k input token hard cap; freeze + notify on exceed
- **D-32-05**: 4-layer cost stack (idempotency → regex → subject-only Gemini → full body)
- **D-32-06**: Manager approval panel — Approve / Edit / Discard, reuses Orders.tsx modal pattern
- **D-32-07**: Auto-send gate — 3 conditions all required: paid tier + health ≥ 0.80 + manager pre-approved
- **D-32-08**: WineOps AI Disclaimer — non-removable, every AI-drafted outbound email
- **D-32-09**: 22-dimension provider intelligence (5 foundational + 17 dynamic), two JSONB columns on providers
- **D-32-10**: Intelligence build — manager fills foundational at onboarding, LLM auto-extracts dynamic after each conversation
- **D-32-11**: Discrete mode — Phase 24-05 _classify_message_sensitivity() handles PII [CRITICAL RESEARCH FINDING: NOT YET BUILT — see § Critical Gap 1]
- **D-32-12**: Soft inquiry email — "Ask AI for price" toggle in order modal
- **D-32-13**: SMS — future wave; preferred_channel column already exists on providers
- **D-32-14**: 20-constraint system — 12 Hard, 3 Annotating, 4 Soft (see CONTEXT.md for full list)
- **D-32-15**: Thread Orphan + Off-App Order + Invoice Matching — 3 scenarios; Jaro-Winkler + Levenshtein + SHA256
- **D-32-16**: Email-text invoice extraction via Haiku + regex fallback (NEW); image OCR already exists

### Claude's Discretion
(No discretion areas were identified in CONTEXT.md — all key decisions are locked.)

### Deferred Ideas (OUT OF SCOPE)
- SMS/text sending
- Auto-send for all providers (only gate exists)
- Full analytics dashboard
- Phrase/entity compression
- Paid-tier LLM communicator gate
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OUTBOUND-01 | Order created with provider → manager notification + silent AI draft | Order hook in `procurement.service.ts:createOrder()` via new RabbitMQ event `procurement.order.created` |
| OUTBOUND-02 | Manager draft panel: approve / edit / discard | Reuse `OrderApprovalModal.tsx` pattern + new `DraftEmailPanel.tsx` variant |
| OUTBOUND-03 | 4 email types derived from order context (PRICE_INQUIRY, DEMAND_OFFER, etc.) | New `ProviderCommunicationService` in agent-orchestrator |
| OUTBOUND-04 | Progressive summarization — flat ~6k token context, `negotiation_facts` auto-extract | `negotiation_facts` table ✅; `procurement_conversations` with `gmail_thread_id` ✅ |
| OUTBOUND-05 | Rate limits: 500 classify/day, 50 negotiation/day per restaurant (Redis) | `redis.asyncio` client already in database.py ✅ |
| OUTBOUND-06 | Auto-escalation after MAX_ROUNDS without resolution | Redis counter `negotiation_draft:{thread_id}:rounds` |
| OUTBOUND-07 | 20 constraints enforced; WineOps AI disclaimer on every draft | New constraint engine module |
| OUTBOUND-08 | Auto-send gate (3-condition) | `restaurant_feature_flags` table ✅; `providers.relationship_health_score` ✅ |
| PROVINT-01 | `providers.profile_foundational JSONB` + `providers.profile_dynamic JSONB` columns | Migration needed (columns DO NOT yet exist) |
| PROVINT-02 | Manager fills foundational profile (form in provider detail modal) | New `ProviderProfileForm.tsx` in frontend |
| PROVINT-03 | LLM auto-extracts dynamic fields after each conversation round | Extension of `ProviderCommunicationService._extract_dynamic_profile()` |
| PROVINT-04 | Unknown sender detection → "add to providers?" notification | `email_intel_agent.py` route extension |
| PROVINT-05 | Provider card: 3 intelligence badge pills | Extend `Providers.tsx` cards |
| PROVINT-06 | Full provider detail profile panel | Extend provider detail modal |
| TOKENBDGT-01 | Per-call token hard cap (8k input) | Enforced before Haiku/Gemini API call |
| TOKENBDGT-02 | 6k context window budget enforced | Slot allocation logic in `ProviderCommunicationService` |
| TOKENBDGT-03 | api_spend logging for all Phase 32 LLM calls | `SpendLogger` singleton ✅ exists |
| TOKENBDGT-04 | Rolling summary after every 2 rounds | Summarization call writes to `procurement_conversations.ai_summary` |
</phase_requirements>

---

## Summary

Phase 32 builds directly on the Phase 24 infrastructure. All foundational tables exist (`procurement_conversations`, `negotiation_facts`, `vendor_promotions`, `providers`, `notifications`). The key building blocks are in place: `EmailIntelAgent` with its classification pipeline, `ProviderConversationAgent` with its DB context injection, `model_clients.py` singletons, and the `notifications` table for in-app notifications via direct Supabase INSERT.

However, **six critical gaps must be addressed in Phase 32** that were either planned but not implemented in Phase 24, or are net-new requirements:
1. `_classify_message_sensitivity()` was never implemented (test stubs only — skipped).
2. `providers.profile_foundational` and `providers.profile_dynamic` columns do not exist.
3. The new `ProviderCommunicationService` (the outbound draft engine) is entirely new.
4. The manager draft approval panel needs a new frontend variant.
5. Fuzzy matching libraries (Jaro-Winkler, Levenshtein) are not installed.
6. `procurement_conversations` has no direct `restaurant_id` column — joins via `procurement_orders` FK only.

**Primary recommendation:** Build Phase 32 as a new `ProviderCommunicationService` Python class in agent-orchestrator (not an extension of `ProviderConversationAgent`). The `ProviderConversationAgent` is 2800 lines and focused on inbound intelligence; adding the outbound engine there would create an unmaintainable god-class. Instead, wire the new service as a new agent that subscribes to `procurement.order.created` routing key.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Order creation hook (trigger) | API / Backend (NestJS) | — | `procurement.service.ts:createOrder()` already owns order creation; add RabbitMQ publish here |
| Draft pre-computation | Agent Orchestrator (Python) | — | LLM calls belong in the Python tier; NestJS has no LLM SDK |
| Constraint enforcement (20 constraints) | Agent Orchestrator (Python) | — | Stateful constraint check before LLM call |
| Rate limit enforcement | Agent Orchestrator (Python) | Redis | Redis counters managed by the agent, not the HTTP layer |
| Manager approval panel UI | Frontend (React) | — | Approve/Edit/Discard decision is a manager UI action |
| Draft storage (pending approval) | Database (Supabase) | — | `procurement_conversations` with `status=PENDING_APPROVAL` |
| Notification delivery | Database (Supabase) | WebSocket (Bridge) | Agent inserts to `notifications` table; WebSocket bridge broadcasts |
| Provider intelligence profile | Database (Supabase) | Agent Orchestrator | JSONB stored on `providers`; LLM extraction happens in agent |
| Invoice text extraction | Agent Orchestrator (Python) | — | Haiku + regex; belongs in Python tier |
| Off-app order fuzzy matching | Agent Orchestrator (Python) | — | String similarity algorithms; Python has best library support |
| Auto-send gate evaluation | API / Backend (NestJS) | — | Gate check on the send endpoint; feature flag + health score query |

---

## Existing Infrastructure State

### 1. ProviderConversationAgent (Phase 24-05) — VERIFIED

**File:** `services/agent-orchestrator/agents/provider_conversation_agent.py` (~2800 lines)

**What exists:**
- Subscribes to: `conversation.events/conversation.inbound.email`, `conversation.events/conversation.inbound.sms`, `procurement.events/procurement.conversation_request`, `provider.events/provider.*`, `conversation.events/conversation.approved|rejected|modified`
- Key methods: `generate_draft()`, `_generate_response()`, `_extract_intelligence()`, `record_correction()`, `_get_db_context_for_prompt()`
- `_get_db_context_for_prompt(provider_id, restaurant_id)` fetches: last 3 `procurement_conversations`, open `procurement_orders`, `negotiation_facts` WHERE `commitment_type='AGREEMENT'`, `providers.close_relationship`
- `COMMITMENT_PATTERNS` — 8 regex patterns for purchase commitment safety
- `record_correction()` — manager learning loop via Supabase RPC `jsonb_array_append`
- `PROV_AGENT_LEVEL4_ENABLED=false` by default (canary rollout)
- Uses OLD `google.generativeai` SDK in `initialize()` (not model_clients.py singletons!)
- Uses `EmailComposerService` for formatting + sending via NestJS API Gateway

**⚠️ CRITICAL GAP: `_classify_message_sensitivity()` — NOT BUILT**

The CONTEXT.md states "Phase 24-05 `_classify_message_sensitivity()` handles PII" but this is INCORRECT. Investigation of `provider_conversation_agent.py` confirms **no method named `_classify_message_sensitivity` exists**. It appears only in Phase 24 test stub files as `pytest.mark.skip` placeholders. Phase 32 must implement discrete mode (C-08, C-21) from scratch. [VERIFIED: `grep -r "_classify_message_sensitivity" services/` → No matches found]

**What Phase 32 can reuse:**
- `COMMITMENT_PATTERNS` for C-02 guard
- `_get_db_context_for_prompt()` for rolling context injection
- `record_correction()` for manager learning loop
- `get_haiku_client()` / `get_gemini_client()` singletons from `model_clients.py`

### 2. procurement_conversations schema — VERIFIED

**Current columns (baseline + Phase 24 additions):**
```
id UUID PK
order_id UUID FK → procurement_orders(id) ON DELETE CASCADE
provider_id UUID FK → providers(id)
direction VARCHAR(20) DEFAULT 'OUTBOUND'
channel VARCHAR(50)
content TEXT
ai_summary TEXT
status VARCHAR(50) DEFAULT 'PENDING'
sent_at TIMESTAMPTZ
delivery_status VARCHAR(50)
time_to_approval_seconds INTEGER
created_at TIMESTAMPTZ

-- Added in Phase 24-01 (20260513100002):
gmail_thread_id TEXT
gmail_message_id TEXT
conversation_context JSONB DEFAULT '{"manager_instructions": [], "is_close_relationship": false, "relationship_posture": "standard", "disclosure_default": "send_as_is"}'
thread_id UUID
message_id TEXT
parent_message_id UUID FK → procurement_conversations(id)
email_headers JSONB
confidence_score DECIMAL(3,2)
```

**⚠️ CRITICAL NOTE: No `restaurant_id` column directly on this table.**
The table uses `order_id` FK to `procurement_orders.restaurant_id` for restaurant scoping. This means queries filtering by `restaurant_id` require a JOIN or subquery. For Phase 32 rate limit checks and multi-tenant filtering, this is a potential issue. Phase 32 migration should add `restaurant_id UUID` to `procurement_conversations` for direct filtering. [VERIFIED: `20260208024921_new-migration.sql` line 196-209 shows no `restaurant_id`; `20260304010000_missing_tables_consolidation.sql` line 180 tries to create index `idx_conversations_restaurant_date ON procurement_conversations(order_id, created_at DESC)` — confirming no direct `restaurant_id`]

**Missing columns needed for Phase 32 (migration required):**
- `outbound_email_type VARCHAR(20)` — PRICE_INQUIRY | DEMAND_OFFER | PROMO_INQUIRY | WINE_INQUIRY
- `round_count INTEGER DEFAULT 0` — tracks negotiation rounds for MAX_ROUNDS constraint
- `constraint_flags JSONB DEFAULT '{}'` — stores which constraints were triggered per message
- `disclaimer_appended BOOLEAN DEFAULT false` — audit trail for WineOps AI disclaimer
- `rolling_summary TEXT` — the progressive summarization rolling summary
- `restaurant_id UUID` — direct restaurant scoping (removes need for join)

### 3. providers table — VERIFIED

**Current columns (baseline + all migration additions):**
```
-- Baseline (20260208024921_new-migration.sql):
id UUID PK, restaurant_id UUID FK, name VARCHAR(255), contact_email VARCHAR(255),
contact_phone VARCHAR(50), contact_name VARCHAR(255), address TEXT,
specialties TEXT[], lead_time_days INTEGER, minimum_order DECIMAL(10,2),
payment_terms VARCHAR(100), rating DECIMAL(3,2), ai_personality_notes TEXT,
competitor_group VARCHAR(100), preferred_channel VARCHAR(50) DEFAULT 'email',
is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ

-- Added in 20260220120000:
last_contact_date TIMESTAMPTZ, last_contact_notes TEXT

-- Added in Phase 24-01 (20260513100003):
close_relationship BOOLEAN DEFAULT false
auto_reply_enabled BOOLEAN DEFAULT false
relationship_health_score DECIMAL(5,2)
agent_permissions JSONB DEFAULT '{"tier": 1, ...}'

-- Added in Phase 27 (20260509000002):
catalogue_vendor_id UUID FK → vendor_catalogue(id)
is_custom BOOLEAN NOT NULL DEFAULT TRUE
```

**⚠️ MISSING — Phase 32 migration required:**
- `profile_foundational JSONB DEFAULT '{}'` — 5 foundational intelligence dimensions (D-32-09)
- `profile_dynamic JSONB DEFAULT '{}'` — 17 dynamic intelligence dimensions (D-32-09)

[VERIFIED: Searched all migration files for `profile_foundational` → No matches. Column does not exist yet.]

### 4. negotiation_facts table — VERIFIED

**Created in Phase 24-01 via Supabase MCP (migration not in local files):**
```sql
-- Structure from 24-01-PLAN.md (Task 2 action):
id UUID PK
provider_id UUID FK → providers(id)
restaurant_id UUID
conversation_id UUID FK → procurement_conversations(id)
fact_field TEXT
fact_value TEXT
fact_type VARCHAR(50)
commitment_type VARCHAR(20) DEFAULT 'INDICATIVE'
  CHECK (commitment_type IN ('INDICATIVE', 'OFFER', 'COUNTER', 'AGREEMENT'))
confidence FLOAT
source_message TEXT
created_at TIMESTAMPTZ
superseded_by UUID FK → negotiation_facts(id)
```

The table is confirmed via `_get_db_context_for_prompt()` which queries it successfully:
```python
facts = self.database.supabase.table("negotiation_facts")
    .select("fact_field, fact_value")
    .eq("provider_id", provider_id)
    .eq("commitment_type", "AGREEMENT")
    .ilike("fact_field", "%payment%")
```

[VERIFIED: `provider_conversation_agent.py` lines 2737–2744 confirm table and columns exist in live DB]

### 5. OrderApprovalModal / Orders.tsx pattern — VERIFIED

**Files:**
- `apps/web/src/components/orders/OrderApprovalModal.tsx` — primary modal component
- `apps/web/src/components/orders/OrderGuardModal.tsx` — guard modal (separate)
- `apps/web/src/pages/Orders.tsx` — main orders page (~3000+ lines)
- `apps/web/src/pages/orders/` — split components (OrderSummary, OrderFilters, CreateOrderModal)

**Current `OrderApprovalModal` interface:**
```typescript
interface OrderApprovalData {
  orderId, wineName, quantity, providerName, proposedPrice, finalPrice,
  deliveryEstimate, conversationSummary, conversationId, timestamp,
  counterOffer?: CounterOffer  // optional counter-offer block
}
// Actions: onConfirm, onCancel, onEdit, onRequestMoreInfo, onClose
// Multi-provider pagination: totalResponses, currentIndex, onNext, onPrevious
```

**For Phase 32:** Current modal is styled for INBOUND order approval (provider's counter-offer). Phase 32 needs OUTBOUND draft approval (AI's draft email). The difference:
- Phase 32 panel title: "AI Draft Ready" not "ORDER APPROVAL"
- Phase 32 actions: **Approve / Edit / Discard** (not Confirm/Cancel/Edit/Ask-for-more)
- Phase 32 body: shows the full draft email text (not order quantity/price)
- Phase 32 inline editor: `<textarea>` to edit the draft before sending
- Constraint warning badges visible in panel
- WineOps AI Disclaimer section (read-only)

**Recommendation:** Create a new `DraftEmailApprovalPanel.tsx` component that reuses the same Framer Motion animation patterns, backdrop, and z-index conventions from `OrderApprovalModal.tsx`.

**"Ask AI price" toggle:** Referenced in CONTEXT.md (D-32-12). Found in `Orders.tsx` — the CreateOrderModal includes a `target_price_per_bottle IS NULL` path. The toggle is in the order creation flow. **D-32-12 is handled by the email type selection logic** (PRICE_INQUIRY when target_price_per_bottle is null), not a separate UI widget.

**Orders.tsx mutation pattern:**
```typescript
// Uses apiClient (axios) + React Query invalidation
const { mutateAsync: createOrder } = useMutation(...)
// State: useOrders() hook → React Query cache
// WebSocket: useRealtimeDispatch() for cross-page sync
```

### 6. Notification system — VERIFIED

**Architecture (from `RealtimeContext.tsx` docstring):**
```
Agent → Supabase INSERT to `notifications` table
     ↓
RabbitMqBridgeService subscribes via `notifications` table Supabase Realtime
     ↓ (re-emits via Socket.IO)
WebSocket Gateway → `user:{userId}` room emit
     ↓
Frontend: `Header.tsx` or notification panel subscribes
```

**`notifications` table schema:**
```sql
id UUID PK, restaurant_id UUID, user_id UUID, type VARCHAR(100) NOT NULL DEFAULT 'system',
title VARCHAR(500) NOT NULL, message TEXT NOT NULL, priority VARCHAR(20) DEFAULT 'medium',
status VARCHAR(20) DEFAULT 'unread', action_url TEXT, action_label VARCHAR(255),
metadata JSONB DEFAULT '{}', read_at TIMESTAMPTZ, archived_at TIMESTAMPTZ, created_at TIMESTAMPTZ
```

**Agent notification pattern (VERIFIED from `email_intel_agent.py` line 578):**
```python
self.database.supabase.table("notifications").insert({
    "restaurant_id": restaurant_id,
    "type": notification_type,       # e.g., "email_classified_promo"
    "title": title,
    "message": message,
    "priority": priority,            # "low" | "medium" | "high"
    "action_url": action_url,        # e.g., "/providers"
    "is_read": False,
    "metadata": metadata,            # optional dict
}).execute()
```

**Note:** Field is `status = 'unread'` in schema but agent inserts `is_read: False`. Verify field name. 
[ASSUMED: `is_read` may be an alias column or `status = 'unread'` is the canonical field. Check before implementing.]

**Phase 32 notification types to add:**
```python
"draft_ready"          # Step 1 — "Draft ready to send to [Provider] for order #1042"
"provider_replied"     # Step 3 — "[Provider] replied — let AI draft a response?"
"constraint_triggered" # C-01..C-22 hard constraint hit
"round_limit_reached"  # C-05 auto-escalation
"ghost_thread"         # C-23 no reply in 5 business days
"unknown_sender"       # D-32-10 unknown email from new domain
"off_app_invoice"      # D-32-15 invoice with no matching order
```

### 7. RabbitMQ routing keys — VERIFIED

**Active exchanges and routing keys:**
```
email.events (TOPIC)
  email.inbound.raw          ← EmailIntelAgent subscribes
  email.inbound.received     ← EmailParsingAgent subscribes (OPERATIONAL emails)
  email.outbound.sent        ← GmailWatchService publishes SENT messages (direction=outbound)

conversation.events (TOPIC)
  conversation.inbound.email   ← ProviderConversationAgent subscribes
  conversation.approved        ← ProviderConversationAgent subscribes
  conversation.rejected        ← ProviderConversationAgent subscribes
  conversation.modified        ← ProviderConversationAgent subscribes

procurement.events (TOPIC)
  procurement.conversation_request  ← ProviderConversationAgent subscribes

provider.events (TOPIC)
  provider.promo_check_requested    ← ProviderConversationAgent subscribes
  provider.profile_refresh_requested ← ProviderConversationAgent subscribes
  provider.created                   ← ProviderConversationAgent subscribes
```

**Phase 32 new routing keys needed:**
```
procurement.events
  procurement.order.created       ← NEW — published by NestJS on createOrder()
                                    ← Consumed by ProviderCommunicationAgent

provider.events
  provider.draft.ready            ← NEW — published by ProviderCommunicationAgent
                                    ← Consumed by NotificationAgent or direct DB insert

provider.events
  provider.draft.approved         ← NEW — published by NestJS on draft approve
  provider.draft.discarded        ← NEW — published by NestJS on draft discard
```

### 8. api_spend + spend_alert_state tables — VERIFIED

**`api_spend` columns:**
```
id UUID PK, provider VARCHAR(50), model VARCHAR(100),
input_tokens INTEGER, output_tokens INTEGER, cost_usd DECIMAL(10,6),
restaurant_id UUID (nullable), timestamp TIMESTAMPTZ
```

**`spend_alert_state` columns:**
```
id UUID PK, provider VARCHAR(50) UNIQUE, last_alert_month VARCHAR(7), updated_at TIMESTAMPTZ
```

Both tables exist. `SpendLogger` singleton in `services/spend_logger.py` handles writes. Phase 32 must call `SpendLogger.log()` for every Haiku and Gemini call.

[VERIFIED: `supabase/migrations/20260404000000_api_spend.sql`]

### 9. Redis key patterns — VERIFIED

**Existing patterns:**
```
gmail:watch:historyId              # GmailWatchService (NestJS CacheService)
gmail:watch:expiration             # GmailWatchService
digest:{restaurant_id}:{date}      # EmailIntelAgent promo digest (36h TTL)
email_intel:{message_id}           # EmailIntelAgent idempotency
prov_conv:{conversation_id}        # ProviderConversationAgent idempotency
```

**Phase 32 new keys:**
```
email_classify:{restaurant_id}:day     # cap 500 (reuses EmailIntelAgent pattern)
negotiation_draft:{restaurant_id}:day  # cap 50 (configurable)
negotiation_draft:{thread_id}:rounds   # cap HARD_ROUND_CAP (default 6, max 12)
draft_lock:{conversation_id}           # mutex — prevents duplicate drafts on same thread
provider_domain_cache:{domain}         # 48h — domain→typical_category (D-32-05 sender caching)
```

**Redis client pattern (VERIFIED from `database.py`):**
```python
import redis.asyncio as redis
# Connection:
self.redis = await redis.from_url(redis_url, encoding="utf-8", decode_responses=True)
# Usage:
await self.redis.incr(key)
await self.redis.expire(key, 86400)
val = await self.redis.get(key)
# Pipeline:
pipe = self.redis.pipeline()
pipe.incr(key); pipe.expire(key, 86400)
await pipe.execute()
```

The `redis.asyncio` client is available throughout agent-orchestrator via `self.database.redis`.

### 10. model_clients.py singletons — VERIFIED

```python
# Gemini Flash (synchronous API):
from services.model_clients import get_gemini_client
gemini = get_gemini_client()  # returns genai.Client (new google-genai SDK)
response = gemini.models.generate_content(
    model=settings.gemini_model,  # "gemini-2.0-flash" or "gemini-2.5-flash"
    contents=prompt,
    config=genai_types.GenerateContentConfig(response_mime_type="application/json", ...)
)
result = json.loads(response.text)

# Haiku (ASYNC):
from services.model_clients import get_haiku_client, get_haiku_semaphore
haiku = get_haiku_client()  # returns anthropic.AsyncAnthropic
semaphore = get_haiku_semaphore()  # must be inside running event loop
async with semaphore:
    response = await haiku.messages.create(
        model=settings.haiku_model,  # "claude-haiku-4-5-20251001"
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}]
    )
result = response.content[0].text
```

**⚠️ WARNING: `ProviderConversationAgent.initialize()` uses the OLD `google.generativeai` SDK** (line ~293: `import google.generativeai as genai; genai.configure(api_key=...)`). Phase 32's new `ProviderCommunicationService` must use `model_clients.py` singletons instead — consistent with EmailIntelAgent pattern.

### 11. EmailIntelAgent notification pattern — VERIFIED

The `_notify()` method (lines 550–580) inserts directly to Supabase `notifications` table. This is the canonical pattern for Phase 32:

```python
async def _notify(self, restaurant_id, notification_type, title, message,
                  priority="medium", action_url="/providers", metadata=None):
    insert_payload = {
        "restaurant_id": restaurant_id,
        "type": notification_type,
        "title": title,
        "message": message,
        "priority": priority,
        "action_url": action_url,
        "is_read": False,
    }
    if metadata:
        insert_payload["metadata"] = metadata
    self.database.supabase.table("notifications").insert(insert_payload).execute()
```

Phase 32 should copy this exact pattern. **Note:** The `is_read` field — the schema defines `status VARCHAR(20) DEFAULT 'unread'` but the agent inserts `is_read: False`. Likely both columns exist on the live table. Confirm with: `SELECT column_name FROM information_schema.columns WHERE table_name='notifications'`.

### 12. Gmail Watch SENT expansion (Phase 24-02) — VERIFIED

The Phase 24-02 plan was actually **Wave 0 test stubs**, not the Gmail Watch SENT implementation. However:

1. The `GmailWatchService` reads `GMAIL_WATCH_LABEL_IDS` env var (defaults to `['INBOX']`)
2. Phase 24 UAT prerequisite explicitly states: `GMAIL_WATCH_LABEL_IDS=INBOX,SENT`
3. EmailIntelAgent already handles SENT messages at line 87-89:
   ```python
   if payload.get("direction") == "outbound":
       await self._link_sent_email(payload)
   ```
4. The SENT expansion is controlled by the `GMAIL_WATCH_LABEL_IDS` environment variable — **no code change needed**, only Railway env var must include `SENT`.

[VERIFIED: `gmail-watch.service.ts` line 105-106 shows `labelIds` from `GMAIL_WATCH_LABEL_IDS` env var split by comma]

### 13. communication_templates table — VERIFIED

Exists from `supabase/migrations/20260220120000_provider_contacts_preferences_templates.sql`:
```sql
communication_templates (
  id UUID PK,
  restaurant_id UUID FK,
  name VARCHAR(255) NOT NULL,
  subject VARCHAR(500),
  body TEXT NOT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'email',  -- 'email' | 'sms'
  is_active BOOLEAN DEFAULT TRUE,
  created_at, updated_at TIMESTAMPTZ
)
```

Phase 32 can use this table to store per-restaurant email templates for each of the 4 outbound email types. Default system templates should be seeded.

### 14. order_interactions table — VERIFIED

```sql
order_interactions (
  id UUID PK,
  order_id UUID FK → procurement_orders(id),
  interaction_type VARCHAR(50),         -- 'invoice_received', 'barcode_scan', etc.
  channel VARCHAR(50),
  content TEXT,
  ai_summary TEXT,
  barcode_scanned VARCHAR(100),
  vintage_mismatch_detected BOOLEAN DEFAULT false,
  vintage_mismatch_details JSONB,
  recording_url TEXT, call_uuid VARCHAR(100), call_duration_seconds INTEGER,
  transcript TEXT, detected_intent VARCHAR(100), detected_sentiment VARCHAR(50),
  created_at TIMESTAMPTZ
)
```

Phase 32 (D-32-15 Scenario C) must INSERT to this table for `interaction_type='invoice_received'` when creating retroactive orders from off-app invoices.

### 15. provider_contacts table — VERIFIED

```sql
provider_contacts (
  id UUID PK,
  provider_id UUID FK → providers(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  role VARCHAR(100),
  is_primary BOOLEAN DEFAULT FALSE,
  created_at, updated_at TIMESTAMPTZ
)
```

Used for D-32-09 dimension 5 (primary decision-maker identity). The `is_primary` flag identifies the main contact.

### 16. Frontend stack — VERIFIED

**Pattern for Phase 32 frontend components:**
```typescript
// Zustand stores:
import { useUIStore, useRestaurantSettingsStore } from '../stores'

// React Query mutations (api client pattern):
import { apiClient } from '../services/api/client'
const mutation = useMutation({
  mutationFn: (data) => apiClient.post('/api/v1/procurement/orders', data),
  onSuccess: () => queryClient.invalidateQueries(['orders'])
})

// WebSocket for real-time:
import { useRealtimeDispatch } from '../contexts/RealtimeContext'
const dispatch = useRealtimeDispatch()

// Notification rendering:
// Header.tsx has notification bell — inserts to 'notifications' table
// bridge service picks up via Supabase Realtime change on notifications table
// and re-emits via WebSocket to frontend
```

**Phase 32 frontend scope:**
- `DraftEmailApprovalPanel.tsx` — new (reuses OrderApprovalModal animation patterns)
- `ProviderProfileForm.tsx` — new (foundational intelligence form in provider detail modal)
- Provider card badge pills (3 intelligence dimensions) — extend existing `Providers.tsx` TypeBadge system
- Order creation: wire `provider_id` assignment → trigger backend notification
- Inline email editor in approval panel

### 17. VisualVerificationAgent._compare_invoice_to_order() — VERIFIED

**File:** `services/agent-orchestrator/agents/visual_verification_agent.py`
**File:** `services/agent-orchestrator/services/invoice_ocr_service.py`

Existing capabilities:
- `_scan_invoice(image_data)` → EasyOCR → extracts wine_name, vintage, quantity, unit_price, total
- `_compare_invoice_to_order(order_id, extracted)` → compares against `procurement_orders` fields
- `_process_barcode_scan()` → barcode cross-reference
- `_store_verification_result(order_id, result)` → stores to `order_interactions`

**Requires `order_id`** to compare against. Off-app orders have no `order_id` until Scenario C creates a retroactive one.

**Phase 32 extension:** Add `_extract_invoice_from_email_text(email_body)` method that calls Haiku with extraction prompt. Output schema:
```json
{"vendor_name": "...", "invoice_number": "...", "invoice_date": "...",
 "line_items": [{"wine_name": "...", "vintage": 2019, "quantity": 6, "unit_price": 45.00}],
 "total": 270.00}
```
Fallback: regex patterns from existing `_parse_invoice_text()` in `invoice_ocr_service.py`.

### 18. Security/auth pattern — VERIFIED

```typescript
// NestJS route protection:
@UseGuards(JwtAuthGuard)  // from apps/api-gateway/src/auth/guards/jwt-auth.guard.ts
@Get('/:id')
async getOrder(@Request() req, @Param('id') id: string) {
  const { restaurantId, userId } = req.user;
  // All restaurant-scoped operations use req.user.restaurantId
}
```

JWT token contains: `{ userId, email, restaurantId, role }`. All agent-orchestrator routes additionally require `X-Admin-Key` header (internal calls from NestJS to Python FastAPI).

**Phase 32 new endpoints:**
- `POST /api/v1/procurement/orders/:id/approve-draft` — approve draft, trigger send
- `POST /api/v1/procurement/orders/:id/discard-draft` — discard without sending
- `PATCH /api/v1/procurement/orders/:id/draft` — edit draft content
- `POST /api/v1/providers/:id/retroactive-order` — Scenario C record creation
- `GET /api/v1/providers/:id/intelligence` — fetch profile_foundational + profile_dynamic
- `PATCH /api/v1/providers/:id/intelligence` — update foundational profile

---

## Files to Create/Modify

### agent-orchestrator (Python)

**NEW FILES:**
```
services/agent-orchestrator/agents/provider_communication_agent.py
  # NEW — ProviderCommunicationAgent: the outbound draft engine
  # Subscribes to: procurement.order.created, provider.draft.approved, provider.draft.discarded
  # Methods: _select_email_type(), _build_context_window(), _generate_draft(),
  #          _enforce_constraints(), _classify_message_sensitivity(),
  #          _extract_dynamic_profile(), _extract_invoice_text()

services/agent-orchestrator/services/constraint_engine.py
  # NEW — 20-constraint enforcement module
  # Methods: check_hard_constraints(), check_annotating_constraints(), check_soft_constraints()
  # Returns: ConstraintResult(blocked: bool, warnings: List[str], annotations: List[str])

services/agent-orchestrator/services/fuzzy_matcher.py
  # NEW — Jaro-Winkler + Levenshtein for off-app invoice matching
  # Methods: match_provider_name(), match_wine_name(), compute_match_score()
  # Requires: rapidfuzz library (pip install rapidfuzz)

services/agent-orchestrator/tests/test_provider_communication_agent.py
  # NEW — test stubs for Phase 32 behavioral contract

services/agent-orchestrator/tests/test_constraint_engine.py
  # NEW — unit tests for all 20 constraints
```

**MODIFIED FILES:**
```
services/agent-orchestrator/core/orchestrator.py
  # ADD: register "provider_communication_agent" in _register_agent_classes()

services/agent-orchestrator/config/settings.py
  # ADD: HARD_ROUND_CAP (default 6, max 12), NEGOTIATION_DRAFT_DAILY_CAP (default 50),
  #       EMAIL_CLASSIFY_DAILY_CAP (default 500), AUTO_SEND_HEALTH_THRESHOLD (default 0.80)

services/agent-orchestrator/agents/visual_verification_agent.py
  # ADD: _extract_invoice_from_email_text() method (Haiku + regex fallback)
  # ADD: off-app matching helpers used by ProviderCommunicationAgent

services/agent-orchestrator/requirements.txt
  # ADD: rapidfuzz>=3.0.0 (Jaro-Winkler + Levenshtein)
```

### api-gateway (NestJS/TypeScript)

**NEW FILES:**
```
apps/api-gateway/src/procurement/dto/approve-draft.dto.ts
  # NEW — AproveDraftDto: { modifiedContent?: string, managerNotes?: string }

apps/api-gateway/src/providers/dto/update-intelligence.dto.ts
  # NEW — UpdateIntelligenceDto: { profile_foundational?: object, profile_dynamic?: object }
```

**MODIFIED FILES:**
```
apps/api-gateway/src/procurement/procurement.service.ts
  # ADD: After createOrder() success → publish 'procurement.order.created' to RabbitMQ
  # ADD: approveDraft(orderId, restaurantId, dto) → update procurement_conversations status
  # ADD: discardDraft(orderId, restaurantId) → update procurement_conversations status
  # ADD: editDraft(orderId, restaurantId, newContent) → update procurement_conversations content

apps/api-gateway/src/procurement/procurement.controller.ts
  # ADD: POST /orders/:id/approve-draft
  # ADD: POST /orders/:id/discard-draft
  # ADD: PATCH /orders/:id/draft

apps/api-gateway/src/providers/providers.service.ts
  # ADD: getIntelligence(providerId, restaurantId) → fetch profile_foundational + profile_dynamic
  # ADD: updateIntelligence(providerId, restaurantId, dto) → update profile_foundational

apps/api-gateway/src/providers/providers.controller.ts
  # ADD: GET /providers/:id/intelligence
  # ADD: PATCH /providers/:id/intelligence

apps/api-gateway/src/providers/provider-intelligence.service.ts
  # ADD: getProfileSummary() → top 3 actionable badge pills for provider card

apps/api-gateway/src/procurement/procurement.module.ts
  # ADD: Import RabbitMQ publisher if needed

supabase/migrations/YYYYMMDD_phase32_schema.sql
  # ADD: providers.profile_foundational JSONB
  # ADD: providers.profile_dynamic JSONB
  # ADD: procurement_conversations.outbound_email_type VARCHAR(20)
  # ADD: procurement_conversations.round_count INTEGER DEFAULT 0
  # ADD: procurement_conversations.constraint_flags JSONB DEFAULT '{}'
  # ADD: procurement_conversations.disclaimer_appended BOOLEAN DEFAULT false
  # ADD: procurement_conversations.rolling_summary TEXT
  # ADD: procurement_conversations.restaurant_id UUID
  # SEED: communication_templates with 4 default outbound email types per system restaurant
```

### Frontend (React/TypeScript)

**NEW FILES:**
```
apps/web/src/components/orders/DraftEmailApprovalPanel.tsx
  # NEW — AI draft email review panel (Approve/Edit/Discard)
  # Reuses OrderApprovalModal animation patterns
  # Includes: inline textarea editor, constraint warning badges, disclaimer section

apps/web/src/components/providers/ProviderProfileForm.tsx
  # NEW — Foundational intelligence profile form (5 dimensions)
  # Embedded in provider detail modal

apps/web/src/hooks/queries/useDraftEmailQueries.ts
  # NEW — React Query hooks for draft approve/edit/discard mutations
```

**MODIFIED FILES:**
```
apps/web/src/pages/Providers.tsx
  # ADD: 3 intelligence badge pills on provider cards (response speed, specialty, relationship tier)
  # ADD: "Fill Profile" CTA when profile_foundational is empty
  # MODIFY: Provider detail modal to include ProviderProfileForm tab

apps/web/src/pages/Orders.tsx (or pages/orders/CreateOrderModal.tsx)
  # ADD: After order created with provider_id → listen for draft_ready notification
  # ADD: Open DraftEmailApprovalPanel when notification arrives
```

---

## Integration Points

### A. Order Creation → Draft Pre-computation Flow

```
NestJS: procurement.service.ts:createOrder()
  └─► INSERT procurement_orders (status=DRAFT, provider_id=X)
  └─► PUBLISH to RabbitMQ: procurement.events / procurement.order.created
        payload: { order_id, restaurant_id, provider_id, wine_name, quantity,
                   target_price_per_bottle, urgency }
          ↓
Python: ProviderCommunicationAgent.process_message()
  └─► _select_email_type(order) → PRICE_INQUIRY | DEMAND_OFFER | ...
  └─► _get_db_context_for_prompt(provider_id, restaurant_id)
  └─► _build_context_window() → 6k token budget
  └─► _enforce_constraints() → check hard blocks first
  └─► _generate_draft() → Haiku async call
  └─► INSERT procurement_conversations (direction=OUTBOUND, status=PENDING_APPROVAL,
                                         outbound_email_type, round_count=0,
                                         disclaimer_appended=true, constraint_flags)
  └─► INSERT notifications (type='draft_ready', restaurant_id, metadata={conversation_id, order_id})
          ↓
Frontend: Header notification bell → DraftEmailApprovalPanel opens
```

### B. Manager Approval → Email Send Flow

```
Frontend: DraftEmailApprovalPanel → Approve button
  └─► POST /api/v1/procurement/orders/:id/approve-draft
          ↓
NestJS: procurement.service.ts:approveDraft()
  └─► UPDATE procurement_conversations SET status='APPROVED', sent_at=NOW()
  └─► CALL GmailService.sendMessage(to=provider_email, subject, body=draft+disclaimer)
  └─► PUBLISH provider.events / provider.draft.approved
          ↓
Python: ProviderCommunicationAgent → log to decision_log, update agent_activity_logs
```

### C. Progressive Summarization Flow (every 2 rounds)

```
Python: ProviderCommunicationAgent._maybe_summarize()
  Triggered when round_count % 2 == 0 (after rounds 2, 4, 6...)
  └─► Haiku call: "Summarize conversation rounds N-1 and N"
  └─► UPDATE procurement_conversations SET rolling_summary=...
  └─► INSERT negotiation_facts (fact_field=price/qty/vintage, fact_value=...,
                                  commitment_type=INDICATIVE|OFFER|COUNTER|AGREEMENT)
```

### D. Provider Intelligence Auto-Extract Flow

```
After each conversation round completes:
Python: ProviderCommunicationAgent._extract_dynamic_profile()
  └─► Haiku: "Extract these dynamic provider fields from conversation..."
  └─► UPDATE providers SET profile_dynamic = profile_dynamic || new_fields::jsonb
        WHERE id = provider_id
```

### E. Off-App Invoice Matching (D-32-15 Scenario B/C)

```
EmailIntelAgent classifies email as OPERATIONAL + invoice signals detected
  └─► _extract_invoice_text(body) → Haiku extraction
  └─► FuzzyMatcher.match_against_orders(extracted, restaurant_id)
      → score > 0.80: notify "This invoice looks like order #1041"
      → score 0.50–0.80: notify "Could this be for order #1041?"
      → score < 0.50: notify "Unrecorded delivery — create retroactive order?"
          ↓
Manager confirms → POST /api/v1/providers/:id/retroactive-order
  └─► INSERT procurement_orders (status='delivered', source='retroactive')
  └─► INSERT procurement_conversations (direction='INBOUND', content=email_body)
  └─► INSERT order_interactions (interaction_type='invoice_received', content=raw_invoice)
```

---

## Risk Assessment

### Risk 1: `_classify_message_sensitivity()` NOT BUILT — CRITICAL

**Severity:** HIGH
**What:** CONTEXT.md D-32-11 states "Phase 24-05 `_classify_message_sensitivity()` already handles PII" but the method does not exist anywhere in the codebase. The Phase 24-02 test stub for this (in `test_sensitivity_detection.py`) is `pytest.mark.skip` only.
**Impact:** C-08 (SENSITIVE_SKIP) and C-21 (PII_PAYMENT_GUARD) cannot be implemented by reference — they must be built from scratch. Estimate: +3 hours.
**Mitigation:** Implement in `ProviderCommunicationAgent._classify_message_sensitivity(text)` using a lightweight regex pre-filter (SSN patterns, routing numbers, card numbers) + optional Haiku confirmation for edge cases. The PII detection logic is simple enough to regex-first.

### Risk 2: `procurement_conversations` lacks `restaurant_id` — HIGH

**Severity:** HIGH
**What:** The `procurement_conversations` table has no direct `restaurant_id` column. Rate limit checks (`email_classify:{restaurant_id}:day`) and multi-tenant notification filters require knowing the restaurant_id from a conversation row without a JOIN.
**Impact:** Every query that needs restaurant_id from a conversation must JOIN to `procurement_orders`. This is a performance and complexity issue.
**Mitigation:** Phase 32 migration MUST add `restaurant_id UUID` directly to `procurement_conversations` and backfill from the `procurement_orders` join. Add RLS policy on the column.

### Risk 3: ProviderConversationAgent uses OLD Gemini SDK — MEDIUM

**Severity:** MEDIUM  
**What:** `ProviderConversationAgent.initialize()` uses `import google.generativeai as genai; genai.configure(...)` (old SDK) while `model_clients.py` uses the new `google.genai` SDK. Both SDKs cannot safely coexist in the same process with different `configure()` calls.
**Impact:** Phase 32's `ProviderCommunicationAgent` must use `model_clients.py` singletons. However, `ProviderConversationAgent`'s old-SDK initialization could conflict if both agents run.
**Mitigation:** Phase 32 agent uses ONLY `model_clients.py` singletons (no `genai.configure()`). The existing `ProviderConversationAgent` issue should be tracked as a future refactor. Note: `ProviderConversationAgent` defaults to `mock_mode=True` so the old Gemini init may not actually run in production.

### Risk 4: Fuzzy matching libraries not installed — MEDIUM

**Severity:** MEDIUM
**What:** D-32-15 off-app invoice matching requires Jaro-Winkler (for provider names) and Levenshtein (for wine names) string similarity. Neither `thefuzz`, `rapidfuzz`, nor `jellyfish` is in `requirements.txt`. Python's stdlib has no fuzzy string matching.
**Impact:** D-32-15 Scenario B/C cannot be implemented without adding a new dependency.
**Mitigation:** Add `rapidfuzz>=3.0.0` to `requirements.txt`. `rapidfuzz` provides Jaro-Winkler and Levenshtein (C-extension, very fast, no GPL license issues). Confirm Railway Docker rebuild picks up new dependency.

### Risk 5: DraftEmailApprovalPanel vs existing OrderApprovalModal UX conflict — LOW

**Severity:** LOW
**What:** The existing `OrderApprovalModal` uses "ORDER APPROVAL" / "Confirm"/"Cancel" framing. Phase 32 needs "AI Draft Ready" / "Approve"/"Edit"/"Discard". Users could confuse the two if they look similar.
**Impact:** UX confusion, possible misuse (approving an AI draft vs confirming an order).
**Mitigation:** Differentiate via distinct header colors (current: black banner; Phase 32: deep blue or gold with AI icon), distinct action button copy ("Send Draft" not "Confirm"), and a clear "Draft Email" label. Reuse only animation and layout primitives from `OrderApprovalModal`.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest 7.x + pytest-asyncio |
| Config file | `services/agent-orchestrator/pytest.ini` or `pyproject.toml` |
| Quick run command | `pytest tests/test_constraint_engine.py tests/test_provider_communication_agent.py -x -v` |
| Full suite command | `pytest tests/ -v --tb=short` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command |
|--------|----------|-----------|-------------------|
| OUTBOUND-01 | Order created → draft inserted to procurement_conversations | integration | `pytest tests/test_provider_communication_agent.py::test_order_created_generates_draft -x` |
| OUTBOUND-02 | Approve → status=APPROVED; Discard → status=DISCARDED | integration | `pytest tests/test_provider_communication_agent.py::test_draft_approve_discard -x` |
| OUTBOUND-03 | PRICE_INQUIRY when target_price_per_bottle IS NULL | unit | `pytest tests/test_provider_communication_agent.py::test_email_type_selection -x` |
| OUTBOUND-04 | Context window ≤ 6000 tokens after slot allocation | unit | `pytest tests/test_provider_communication_agent.py::test_context_window_budget -x` |
| OUTBOUND-05 | 51st draft in a day → Redis cap → freeze notification | integration | `pytest tests/test_provider_communication_agent.py::test_daily_rate_limit -x` |
| OUTBOUND-07 | C-01 off-topic → draft blocked; WineOps disclaimer present | unit | `pytest tests/test_constraint_engine.py::test_hard_constraints -x` |
| OUTBOUND-07 | C-03 quantity cap → ask manager before draft | unit | `pytest tests/test_constraint_engine.py::test_quantity_cap -x` |
| PROVINT-01 | providers.profile_foundational + profile_dynamic columns exist | schema | Supabase MCP column check |
| PROVINT-03 | Dynamic profile updated after conversation | integration | `pytest tests/test_provider_communication_agent.py::test_dynamic_profile_extract -x` |
| TOKENBDGT-01 | 8001-token input → hard rejected before API call | unit | `pytest tests/test_provider_communication_agent.py::test_token_hard_cap -x` |
| OUTBOUND-07 (C-08/C-21) | PII detected → discrete mode, no logging | unit | `pytest tests/test_provider_communication_agent.py::test_pii_discrete_mode -x` |

### Wave 0 Gaps
- [ ] `tests/test_provider_communication_agent.py` — all Phase 32 behavioral contract tests
- [ ] `tests/test_constraint_engine.py` — unit tests for all 20 constraints
- [ ] `tests/test_fuzzy_matcher.py` — Jaro-Winkler / Levenshtein correctness
- [ ] `rapidfuzz` install: `pip install rapidfuzz>=3.0.0`

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | JWT guard already on all NestJS endpoints |
| V3 Session Management | No | Stateless JWT; Redis tracks rate limits only |
| V4 Access Control | Yes | RLS on `procurement_conversations`, `providers`; `restaurant_id` scoping on all queries |
| V5 Input Validation | Yes | Zod DTOs on new NestJS endpoints; Pydantic in Python; draft content length cap (180 words) |
| V6 Cryptography | No | SHA256 for invoice idempotency is one-way hash — no crypto key management |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| AI-generated commitment language sent to provider | Repudiation | `COMMITMENT_PATTERNS` regex check; `auto_send=False` on commitment language detected |
| PII in email body logged to DB | Information Disclosure | C-08/C-21 discrete mode — no body logging, no embedding, notification to DEV/ADMIN only |
| Rate limit bypass (multiple restaurant_ids) | Denial of Service | Redis keys scoped to `restaurant_id` from JWT; never from user-supplied payload |
| Off-topic LLM output (C-01 bypass) | Tampering | C-01 TOPIC_LOCK regex pre-check before draft is shown to manager |
| Duplicate draft on same order | Elevation of Privilege | `draft_lock:{conversation_id}` Redis mutex (SET NX PX 30000 pattern) |
| Manager approves draft with modified content | Repudiation | `log_decision()` on every approve/discard action; stores original draft + final content |
| Invoice fuzzy match false positive creates wrong retroactive order | Tampering | Score < 0.80 always requires explicit manager confirmation; no auto-create |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `notifications` table field is `is_read` (not `status`) per EmailIntelAgent insert | Notification pattern | Phase 32 notifications silently fail DB insert on wrong field name |
| A2 | `negotiation_facts.restaurant_id` column exists (referenced in plan but not verified in live schema) | negotiation_facts | Rate limit queries on this table may fail or return cross-restaurant results |
| A3 | `providers.relationship_health_score` column exists in live DB (was in Phase 24 plan, applied via MCP) | providers table | Auto-send gate D-32-07 cannot read health score |
| A4 | `ProviderConversationAgent` runs in `mock_mode=True` in production (making old SDK safe) | old SDK risk | If mock_mode=False, old SDK `genai.configure()` call runs alongside new SDK |
| A5 | `rapidfuzz` can be added to Railway Docker without conflict | fuzzy matching | D-32-15 invoice matching cannot be implemented without fallback |
| A6 | The `gmail-watch.service.ts` SENT expansion is active on Railway (GMAIL_WATCH_LABEL_IDS includes SENT) | Gmail Watch | EmailIntelAgent `_link_sent_email()` never fires if SENT not being watched |

---

## Sources

### Primary (HIGH confidence)
- Direct codebase reads — `email_intel_agent.py`, `provider_conversation_agent.py`, `model_clients.py`, `procurement.service.ts`, `notifications.service.ts`, `gmail-watch.service.ts`, `OrderApprovalModal.tsx`, `Providers.tsx`
- Migration files — `20260208024921_new-migration.sql`, `20260220120000_provider_contacts_preferences_templates.sql`, `20260220120100_notifications_crud.sql`, `20260404000000_api_spend.sql`, `20260304010000_missing_tables_consolidation.sql`
- Phase 24 SUMMARY files — `24-01-SUMMARY.md`, `24-05-SUMMARY.md`, `24-01-PLAN.md` (exact SQL schema)
- `RealtimeContext.tsx` architecture docstring

### Secondary (MEDIUM confidence)
- Phase 24 UAT prerequisites — `24-UAT.md` (confirms GMAIL_WATCH_LABEL_IDS=INBOX,SENT pattern)
- `database.py` Redis patterns (lines 458–1588)

### Tertiary (LOW confidence)
- Assumption A1 (`is_read` vs `status` field) — [ASSUMED] requires live DB verify
- negotiation_facts exact schema — derived from plan SQL, not confirmed from live DB

---

## Metadata

**Confidence breakdown:**
- Existing infrastructure state: HIGH — directly verified from codebase
- Schema gaps: HIGH — all migration files read, confirmed missing columns
- ProviderConversationAgent state: HIGH — directly read, confirmed _classify_message_sensitivity not implemented
- Fuzzy matching dependency gap: HIGH — grep confirms no rapidfuzz/thefuzz in requirements
- Critical Gap 1 (sensitivity detection): HIGH — verified absent
- Notification field name (is_read vs status): LOW — [ASSUMED]

**Research date:** 2026-05-14
**Valid until:** 2026-06-14 (stable codebase, 30-day window)

## RESEARCH COMPLETE

**Phase:** 32 - Provider Outbound Communication Engine  
**Confidence:** HIGH

### Key Findings
1. **`_classify_message_sensitivity()` is NOT built** — CONTEXT.md claim is wrong; implement from scratch in Phase 32 (C-08, C-21 compliance)
2. **`providers.profile_foundational` + `profile_dynamic` columns do NOT exist** — Phase 32 migration must add both JSONB columns
3. **`procurement_conversations` has no `restaurant_id`** — join-only via order_id FK; Phase 32 migration should add direct column for performance
4. **Fuzzy matching (`rapidfuzz`) not installed** — required for D-32-15 off-app invoice matching; add to requirements.txt
5. **New agent class recommended** — `ProviderCommunicationAgent` (separate from existing `ProviderConversationAgent`) to avoid god-class growth; old agent is 2800 lines and focused on inbound
6. **Notification pattern confirmed** — direct Supabase INSERT to `notifications` table (not HTTP to NestJS); `is_read: False` field name used by existing agents

### File Created
`.planning/phases/32-provider-outbound-communication-engine/32-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Existing infrastructure | HIGH | Direct code reads — all key files verified |
| Schema state | HIGH | All migration SQL read; gaps confirmed by grep |
| Phase 24 agent capabilities | HIGH | Provider conversation agent + email intel agent both read in full |
| Frontend integration | HIGH | Orders.tsx, OrderApprovalModal, RealtimeContext, Providers.tsx all read |
| New component design | MEDIUM | Based on codebase patterns; exact implementation details TBD by planner |

### Open Questions
1. **Is `notifications.is_read` or `notifications.status` the correct field?** EmailIntelAgent inserts `is_read: False` but schema shows `status VARCHAR(20) DEFAULT 'unread'`. Likely both exist (schema has both) — verify via Supabase MCP column check before implementing Phase 32.
2. **Is `providers.relationship_health_score` in live DB?** Was part of Phase 24-01 plan (applied via MCP). Verify via Supabase MCP before auto-send gate implementation.
3. **Is `ProviderConversationAgent` running in mock_mode in production?** The default is `mock_mode=True` from config.get. If so, old Gemini SDK risk is mitigated. Confirm via Railway env var `MOCK_MODE` setting.

### Ready for Planning
Research complete. Planner can now create PLAN.md files for Phase 32.
