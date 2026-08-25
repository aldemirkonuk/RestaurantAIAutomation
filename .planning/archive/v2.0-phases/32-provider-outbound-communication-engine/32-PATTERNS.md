# Phase 32: Provider Outbound Communication Engine — Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** 19 new/modified files
**Analogs found:** 17 / 19

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `agents/provider_communication_agent.py` | agent | event-driven | `agents/email_intel_agent.py` | exact |
| `services/constraint_engine.py` | service/utility | transform | `agents/email_intel_agent.py` (COMMITMENT_PATTERNS) + `services/spend_logger.py` (singleton) | role-match |
| `services/fuzzy_matcher.py` | service/utility | transform | `services/spend_logger.py` (singleton shape) | partial-match |
| `agents/visual_verification_agent.py` (MODIFY) | agent | transform | `agents/email_intel_agent.py::_extract_promo()` (Haiku pattern) | exact |
| `core/orchestrator.py` (MODIFY) | config | — | existing `_register_agent_classes()` block | exact |
| `config/settings.py` (MODIFY) | config | — | existing Phase 24 settings block | exact |
| `core/message_bus.py` (MODIFY) | config | — | existing exchange declaration in `_setup_exchanges()` | exact |
| `supabase/migrations/YYYYMMDD_phase32_schema.sql` | migration | CRUD | `20260509000002_providers_catalogue_link.sql` | exact |
| `procurement/dto/approve-draft.dto.ts` | DTO | — | `procurement/dto/procurement.dto.ts` | role-match |
| `providers/dto/update-intelligence.dto.ts` | DTO | — | `providers/dto/providers.dto.ts` | role-match |
| `procurement/procurement.service.ts` (MODIFY) | service | CRUD | existing `approveOrder()` + `publishEvent()` | exact |
| `procurement/procurement.controller.ts` (MODIFY) | controller | request-response | existing `approveOrder()` endpoint | exact |
| `providers/providers.service.ts` (MODIFY) | service | CRUD | existing `updateProvider()` | exact |
| `providers/providers.controller.ts` (MODIFY) | controller | request-response | existing providers controller | exact |
| `providers/provider-intelligence.service.ts` (NEW) | service | CRUD | `providers/providers.service.ts` | role-match |
| `components/orders/DraftEmailApprovalPanel.tsx` | component | request-response | `components/orders/OrderApprovalModal.tsx` | exact |
| `components/providers/ProviderProfileForm.tsx` | component | CRUD | `components/orders/OrderApprovalModal.tsx` (modal shape) | partial-match |
| `hooks/queries/useDraftEmailQueries.ts` | hook | CRUD (mutations) | `hooks/queries/useOrderQueries.ts` | exact |
| `pages/Providers.tsx` (MODIFY) | component | — | existing `TypeBadge` in `Providers.tsx` | exact |

---

## Pattern Assignments

### `agents/provider_communication_agent.py` (agent, event-driven)

**Analog:** `services/agent-orchestrator/agents/email_intel_agent.py`

**Imports pattern** (lines 16–30):
```python
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from typing import Any, Dict, List, Optional, Tuple

from config.settings import Settings
from core.base_agent import BaseAgent
from services.model_clients import get_gemini_client, get_haiku_client, get_haiku_semaphore
from services.spend_logger import get_spend_logger

logger = logging.getLogger(__name__)
```

**Class + `__init__` pattern** (lines 36–54):
```python
class ProviderCommunicationAgent(BaseAgent):
    """
    Outbound draft engine — Phase 32.
    Subscribes to procurement.order.created and generates AI email drafts.
    """

    def __init__(self, message_bus, database, redis_client=None):
        super().__init__(
            agent_name="provider_communication_agent",
            message_bus=message_bus,
            database=database,
            config={},
        )
        self.redis = redis_client
        self.haiku_semaphore: Optional[Any] = None
        self._settings: Optional[Settings] = None

    @property
    def settings(self) -> Settings:
        if self._settings is None:
            self._settings = Settings()
        return self._settings
```

**Routing key subscription pattern** (lines 62–64):
```python
def get_subscribed_routing_keys(self) -> List[Tuple[str, str]]:
    return [
        ("procurement.events", "procurement.order.created"),
        ("provider.events", "provider.draft.approved"),
        ("provider.events", "provider.draft.discarded"),
    ]
```

**`initialize()` pattern** (lines 66–69):
```python
async def initialize(self) -> None:
    # Semaphore must be created inside running event loop (AI-SPEC §3 pitfall 4)
    self.haiku_semaphore = get_haiku_semaphore()
    self.logger.info("ProviderCommunicationAgent initialized")
```

**`process_message()` entry point + idempotency + DLQ** (lines 75–104):
```python
async def process_message(self, message: Dict[str, Any]) -> None:
    payload = message
    order_id = payload.get("order_id", "")
    idempotency_key = f"prov_comm:{order_id}"

    if await self._check_idempotency(idempotency_key):
        self.logger.debug(f"Skipping duplicate order event: {order_id}")
        return

    try:
        routing_key = payload.get("_routing_key", "")
        if "order.created" in routing_key:
            await self._handle_order_created(payload)
        elif "draft.approved" in routing_key:
            await self._handle_draft_approved(payload)
        elif "draft.discarded" in routing_key:
            await self._handle_draft_discarded(payload)
        await self._mark_processed(idempotency_key, {"status": "ok"})
    except Exception as e:
        self.logger.error(f"ProviderCommunicationAgent processing failed: {e}")
        await self._send_to_dlq(
            message=payload,
            error=str(e),
            retry_count=0,
            original_exchange="procurement.events",
            original_routing_key="procurement.order.created",
        )
        raise
```

**Haiku async call pattern** (from `email_intel_agent._extract_promo()`, lines 324–347):
```python
async def _generate_draft(self, context: str, email_type: str) -> str:
    haiku = get_haiku_client()
    async with self.haiku_semaphore:
        response = await haiku.messages.create(
            model=self.settings.haiku_model,
            max_tokens=512,
            messages=[{"role": "user", "content": context}],
        )
    raw = response.content[0].text if response.content else ""
    # Strip markdown code fences if present
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return raw.strip()
```

**Redis rate-limit counter pattern** (from `database.py` Redis section):
```python
async def _check_and_increment_rate_limit(
    self, key: str, cap: int, ttl_seconds: int = 86400
) -> bool:
    """Returns True if cap exceeded (block), False if under cap (allow)."""
    current = await self.redis.get(key)
    if current and int(current) >= cap:
        return True   # blocked
    pipe = self.redis.pipeline()
    pipe.incr(key)
    pipe.expire(key, ttl_seconds)
    await pipe.execute()
    return False
```

**Redis mutex lock pattern** (draft_lock to prevent duplicate drafts):
```python
async def _acquire_draft_lock(self, conversation_id: str) -> bool:
    """SET NX PX 30000 pattern — returns True if lock acquired."""
    key = f"draft_lock:{conversation_id}"
    result = await self.redis.set(key, "1", nx=True, px=30_000)
    return result is not None
```

**`_notify()` pattern** (lines 550–580 in `email_intel_agent.py` — copy verbatim):
```python
async def _notify(
    self,
    restaurant_id: str,
    notification_type: str,
    title: str,
    message: str,
    priority: str = "medium",
    action_url: str = "/orders",
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    if not restaurant_id:
        return
    try:
        insert_payload: Dict[str, Any] = {
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
    except Exception as e:
        self.logger.warning(f"Notification insert failed (non-critical): {e}")
```

**`log_decision()` call pattern** (from `email_intel_agent._triage_inbound()`, lines 118–125):
```python
await self.log_decision(
    decision_type="outbound_draft_generated",
    inputs={"order_id": order_id, "email_type": email_type, "provider_id": provider_id},
    output={"draft_preview": draft[:200], "constraint_flags": constraint_flags},
    reasoning=f"Email type {email_type} selected; {len(constraint_flags)} constraints triggered",
    confidence=confidence_score,
    restaurant_id=restaurant_id or None,
)
```

**Supabase INSERT pattern for `procurement_conversations`**:
```python
self.database.supabase.table("procurement_conversations").insert({
    "order_id": order_id,
    "provider_id": provider_id,
    "restaurant_id": restaurant_id,
    "direction": "OUTBOUND",
    "channel": "email",
    "content": draft_with_disclaimer,
    "status": "PENDING_APPROVAL",
    "outbound_email_type": email_type,       # PRICE_INQUIRY | DEMAND_OFFER | PROMO_INQUIRY | WINE_INQUIRY
    "round_count": 0,
    "disclaimer_appended": True,
    "constraint_flags": constraint_flags,    # JSONB dict of triggered constraints
    "rolling_summary": None,
}).execute()
```

**SpendLogger call pattern** (after every Haiku/Gemini call):
```python
from services.spend_logger import get_spend_logger
spend_logger = get_spend_logger()
spend_logger.log(
    provider="anthropic",
    model=self.settings.haiku_model,
    input_tokens=input_tokens,
    output_tokens=output_tokens,
    cost_usd=cost_usd,
    restaurant_id=restaurant_id,
)
```

---

### `services/constraint_engine.py` (service/utility, transform)

**Analog:** `agents/email_intel_agent.py` (COMMITMENT_PATTERNS regex structure) + `services/spend_logger.py` (singleton shape)

**Module-level constants pattern** (copy COMMITMENT_PATTERNS style from `provider_conversation_agent.py`):
```python
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

# Hard constraint regex patterns (C-01, C-02, C-03, C-16, C-19, C-20)
TOPIC_LOCK_PATTERNS = [
    r'\b(invoice|delivery|payment|wine|bottle|case|vintage|varietal|appellation)\b',
]
COMMITMENT_PATTERNS = [     # copied from provider_conversation_agent.py
    r'\b(agree|commit|confirm|purchase|buy|order|proceed|close|accept|finalize)\b.*\b(deal|offer|price|quantity|terms)\b',
    r'\bwe will\b.*\b(buy|purchase|take|order)\b',
    r'\b(confirmed?|accepted?|agreed?)\b.*\b(price|quantity|terms|offer)\b',
]
PII_PATTERNS = [
    r'\b\d{3}-\d{2}-\d{4}\b',            # SSN
    r'\b\d{9}\b',                          # routing number
    r'\b4[0-9]{12}(?:[0-9]{3})?\b',        # Visa card
]
THREE_TIER_PATTERNS = [
    r'\b(direct[- ]from[- ]winery|off[- ]invoice|bypass[- ]distributor|kickback)\b',
]
```

**Singleton pattern** (copy from `spend_logger.py` lines 82–90):
```python
_constraint_engine: Optional["ConstraintEngine"] = None

def get_constraint_engine() -> "ConstraintEngine":
    global _constraint_engine
    if _constraint_engine is None:
        _constraint_engine = ConstraintEngine()
    return _constraint_engine
```

**Return type pattern** (dataclass result object):
```python
@dataclass
class ConstraintResult:
    blocked: bool = False
    warnings: List[str] = field(default_factory=list)
    annotations: List[Dict] = field(default_factory=list)
    triggered_hard: List[str] = field(default_factory=list)
    triggered_annotating: List[str] = field(default_factory=list)
    is_sensitive: bool = False
```

---

### `services/fuzzy_matcher.py` (service/utility, transform)

**Analog:** `services/spend_logger.py` (singleton shape only); no functional analog exists

**Singleton + rapidfuzz pattern**:
```python
from rapidfuzz import fuzz, distance
from typing import Dict, Optional, Tuple

class FuzzyMatcher:
    """
    Jaro-Winkler for provider names (tolerates punctuation drift).
    Levenshtein for wine names (tolerates vintage year inclusion).
    """
    PROVIDER_THRESHOLD = 0.80
    WINE_THRESHOLD = 0.70

    def match_provider_name(self, candidate: str, known_name: str) -> float:
        return fuzz.token_sort_ratio(candidate.lower(), known_name.lower()) / 100.0

    def match_wine_name(self, candidate: str, known_name: str) -> float:
        return fuzz.token_set_ratio(candidate.lower(), known_name.lower()) / 100.0

    def compute_match_score(
        self,
        provider_score: float,
        wine_score: float,
        qty_within_30pct: bool,
        date_within_45d: bool,
    ) -> float:
        """Composite score: provider(30%) + wine(40%) + qty(15%) + date(15%)"""
        return (
            provider_score * 0.30
            + wine_score * 0.40
            + (0.15 if qty_within_30pct else 0.0)
            + (0.15 if date_within_45d else 0.0)
        )


_fuzzy_matcher: Optional[FuzzyMatcher] = None

def get_fuzzy_matcher() -> FuzzyMatcher:
    global _fuzzy_matcher
    if _fuzzy_matcher is None:
        _fuzzy_matcher = FuzzyMatcher()
    return _fuzzy_matcher
```

---

### `agents/visual_verification_agent.py` (MODIFY — add `_extract_invoice_from_email_text()`)

**Analog:** `agents/email_intel_agent.py::_extract_promo()` (lines 324–347) — same Haiku async extraction pattern

**New method to add** (insert after `_parse_invoice_text()` at line ~538):
```python
async def _extract_invoice_from_email_text(
    self, email_body: str
) -> Dict[str, Any]:
    """
    Extract structured invoice data from email body text using Haiku.
    Phase 32: D-32-15 Scenario B — email-embedded invoices have no image.
    Falls back to _parse_invoice_text() regex if Haiku fails.
    """
    haiku = get_haiku_client()
    prompt = (
        'Extract invoice fields from this email. Return ONLY valid JSON:\n'
        '{"vendor_name": "...", "invoice_number": "...", "invoice_date": "YYYY-MM-DD",\n'
        ' "line_items": [{"wine_name": "...", "vintage": 2019, "quantity": 6, "unit_price": 45.00}],\n'
        ' "total": 270.00}\n\n'
        f'Email body:\n{email_body[:4000]}'
    )
    try:
        from services.model_clients import get_haiku_client as _get_haiku
        haiku = _get_haiku()
        response = await haiku.messages.create(
            model=self.settings.haiku_model if hasattr(self, '_settings') else "claude-haiku-4-5-20251001",
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text if response.content else "{}"
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw.strip())
    except Exception as e:
        self.logger.warning(f"Haiku invoice extraction failed, falling back to regex: {e}")
        return self._parse_invoice_text(email_body)
```

**Note:** `_parse_invoice_text()` already exists at line 491. The Haiku pattern imports `get_haiku_client` from `services.model_clients` — NOT the old `google.generativeai` pattern used by `ProviderConversationAgent`.

---

### `core/orchestrator.py` (MODIFY — add agent registration)

**Analog:** `core/orchestrator.py` lines 130–157 — `_register_agent_classes()` block

**Import addition** (after line 28 existing import block):
```python
from agents.provider_communication_agent import ProviderCommunicationAgent
```

**Agent registration addition** (inside `_register_agent_classes()` dict at line 132):
```python
self.agent_classes = {
    # ... existing agents ...
    "provider_conversation_agent": ProviderConversationAgent,
    
    # Phase 32: Outbound draft engine
    "provider_communication_agent": ProviderCommunicationAgent,   # ADD THIS LINE
}
```

---

### `config/settings.py` (MODIFY — add Phase 32 constants)

**Analog:** `config/settings.py` lines 146–153 — Phase 24 block pattern

**Settings addition** (add after line 153, the `prov_agent_level4_enabled` line):
```python
# Phase 32: Provider Outbound Communication Engine rate limits
self.hard_round_cap: int = int(os.getenv("HARD_ROUND_CAP", "6"))          # max rounds per thread (absolute max 12)
self.max_round_cap: int = int(os.getenv("MAX_ROUND_CAP", "12"))            # absolute ceiling
self.negotiation_draft_daily_cap: int = int(os.getenv("NEGOTIATION_DRAFT_DAILY_CAP", "50"))
self.email_classify_daily_cap: int = int(os.getenv("EMAIL_CLASSIFY_DAILY_CAP", "500"))
self.auto_send_health_threshold: float = float(os.getenv("AUTO_SEND_HEALTH_THRESHOLD", "0.80"))
self.draft_token_budget: int = int(os.getenv("DRAFT_TOKEN_BUDGET", "6000"))
self.draft_input_token_hard_cap: int = int(os.getenv("DRAFT_INPUT_TOKEN_HARD_CAP", "8000"))
self.wineops_disclaimer: str = "—\nThis message was drafted by WineOps AI on behalf of {restaurant_name}."
```

---

### `supabase/migrations/YYYYMMDD_phase32_schema.sql` (NEW migration)

**Analog:** `supabase/migrations/20260509000002_providers_catalogue_link.sql` — exact ALTER TABLE + index pattern

**Full migration pattern** (copy the file's style exactly):
```sql
-- Phase 32: Provider Outbound Communication Engine schema additions

-- 1. Provider intelligence columns (D-32-09)
ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS profile_foundational JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS profile_dynamic      JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_providers_profile_foundational ON providers
  USING gin(profile_foundational)
  WHERE profile_foundational != '{}';

-- 2. procurement_conversations additions (RESEARCH.md gaps)
ALTER TABLE procurement_conversations
  ADD COLUMN IF NOT EXISTS restaurant_id       UUID REFERENCES restaurants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS outbound_email_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS round_count         INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS constraint_flags    JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS disclaimer_appended BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS rolling_summary     TEXT;

-- Backfill restaurant_id from procurement_orders join
UPDATE procurement_conversations pc
SET restaurant_id = po.restaurant_id
FROM procurement_orders po
WHERE pc.order_id = po.id
  AND pc.restaurant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conv_restaurant_id ON procurement_conversations(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_conv_status_restaurant ON procurement_conversations(restaurant_id, status)
  WHERE status = 'PENDING_APPROVAL';

-- Add constraint for outbound_email_type
ALTER TABLE procurement_conversations
  ADD CONSTRAINT chk_outbound_email_type CHECK (
    outbound_email_type IS NULL OR
    outbound_email_type IN ('PRICE_INQUIRY','DEMAND_OFFER','PROMO_INQUIRY','WINE_INQUIRY')
  );
```

---

### `procurement/procurement.service.ts` (MODIFY — add RabbitMQ publish + draft CRUD)

**Analog:** `procurement.service.ts` lines 316–382 — `approveOrder()` + `orchestratorService.publishEvent()` pattern

**RabbitMQ publish on `createOrder()` — addition after line 158** (after `emitOrderChangeEvent`):
```typescript
// Phase 32: Trigger silent AI draft pre-computation when provider_id is set
if (dto.providerId && this.orchestratorService) {
  try {
    await this.orchestratorService.publishEvent(
      'procurement.events',
      'procurement.order.created',
      {
        order_id: order.id,
        restaurant_id: restaurantId,
        provider_id: dto.providerId,
        wine_name: order.wineName || '',
        quantity: order.quantity,
        target_price_per_bottle: dto.quotedPrice ?? null,
        urgency: dto.isEmergency ? 'urgent' : 'normal',
      },
    );
    this.logger.log(`Draft pre-computation triggered for order ${order.id}`);
  } catch (err: any) {
    this.logger.error(`Failed to publish procurement.order.created: ${err?.message}`);
    // Non-fatal — order still created successfully
  }
}
```

**New service method pattern — `approveDraft()`** (copy `approveOrder()` structure, lines 316–382):
```typescript
async approveDraft(
  restaurantId: string,
  orderId: string,
  dto: ApproveDraftDto,
): Promise<{ conversationId: string; sentAt: string }> {
  const { data, error } = await this.databaseService.supabase
    .from('procurement_conversations')
    .update({
      status: 'APPROVED',
      sent_at: new Date().toISOString(),
      content: dto.modifiedContent ?? undefined,
    })
    .eq('restaurant_id', restaurantId)
    .eq('order_id', orderId)
    .eq('status', 'PENDING_APPROVAL')
    .select('id, sent_at')
    .single();

  if (error) {
    this.logger.error('Failed to approve draft', { restaurantId, orderId, error: error.message });
    throw error;
  }

  // Publish approval event so Python agent logs decision + sends email
  if (this.orchestratorService) {
    await this.orchestratorService.publishEvent(
      'provider.events',
      'provider.draft.approved',
      {
        conversation_id: data.id,
        order_id: orderId,
        restaurant_id: restaurantId,
        modified_content: dto.modifiedContent ?? null,
        manager_notes: dto.managerNotes ?? null,
      },
    );
  }

  return { conversationId: data.id, sentAt: data.sent_at };
}
```

---

### `procurement/procurement.controller.ts` (MODIFY — add draft endpoints)

**Analog:** `procurement.controller.ts` lines 188–207 — `approveOrder()` endpoint pattern (exact copy)

**New endpoint pattern:**
```typescript
@Post('orders/:id/approve-draft')
@ApiOperation({ summary: 'Approve AI email draft and send to provider' })
@ApiResponse({ status: 200 })
async approveDraft(
  @Param('id') orderId: string,
  @Body() dto: ApproveDraftDto,
  @CurrentUser() user: { userId: string; restaurantId: string },
): Promise<{ conversationId: string; sentAt: string }> {
  try {
    return await this.procurementService.approveDraft(
      user.restaurantId,
      orderId,
      dto,
    );
  } catch (error) {
    throw new HttpException(
      error.message || 'Failed to approve draft',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

@Post('orders/:id/discard-draft')
@ApiOperation({ summary: 'Discard AI email draft without sending' })
@ApiResponse({ status: 200 })
async discardDraft(
  @Param('id') orderId: string,
  @CurrentUser() user: { userId: string; restaurantId: string },
): Promise<{ success: boolean }> {
  try {
    return await this.procurementService.discardDraft(user.restaurantId, orderId);
  } catch (error) {
    throw new HttpException(
      error.message || 'Failed to discard draft',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

@Patch('orders/:id/draft')
@ApiOperation({ summary: 'Update AI email draft content before approval' })
@ApiResponse({ status: 200 })
async editDraft(
  @Param('id') orderId: string,
  @Body() dto: ApproveDraftDto,
  @CurrentUser() user: { userId: string; restaurantId: string },
): Promise<{ success: boolean }> {
  try {
    return await this.procurementService.editDraft(user.restaurantId, orderId, dto.modifiedContent!);
  } catch (error) {
    throw new HttpException(
      error.message || 'Failed to edit draft',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
```

---

### `providers/providers.service.ts` (MODIFY — add intelligence CRUD)

**Analog:** `providers.service.ts` lines 195–258 — `updateProvider()` Supabase update pattern

**New method pattern:**
```typescript
async getIntelligence(
  providerId: string,
  restaurantId: string,
): Promise<{ profile_foundational: Record<string, any>; profile_dynamic: Record<string, any> }> {
  const { data, error } = await this.databaseService.supabase
    .from('providers')
    .select('profile_foundational, profile_dynamic')
    .eq('id', providerId)
    .eq('restaurant_id', restaurantId)
    .single();

  if (error) {
    this.logger.error('Failed to fetch provider intelligence', { providerId, error: error.message });
    throw error;
  }

  return {
    profile_foundational: data.profile_foundational ?? {},
    profile_dynamic: data.profile_dynamic ?? {},
  };
}

async updateIntelligence(
  providerId: string,
  restaurantId: string,
  dto: UpdateIntelligenceDto,
): Promise<{ success: boolean }> {
  const updatePayload: Record<string, any> = {};
  if (dto.profile_foundational !== undefined) {
    updatePayload.profile_foundational = dto.profile_foundational;
  }
  if (dto.profile_dynamic !== undefined) {
    updatePayload.profile_dynamic = dto.profile_dynamic;
  }

  const { error } = await this.databaseService.supabase
    .from('providers')
    .update(updatePayload)
    .eq('id', providerId)
    .eq('restaurant_id', restaurantId);

  if (error) {
    this.logger.error('Failed to update provider intelligence', { providerId, error: error.message });
    throw error;
  }

  return { success: true };
}
```

---

### `components/orders/DraftEmailApprovalPanel.tsx` (NEW component)

**Analog:** `apps/web/src/components/orders/OrderApprovalModal.tsx` — exact animation, backdrop, and z-index pattern

**Imports + interface pattern** (copy from `OrderApprovalModal.tsx` lines 1–48):
```typescript
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, XCircle, Edit2, X, AlertTriangle } from 'lucide-react'

interface ConstraintWarning {
  code: string         // e.g. "C-09", "C-14"
  message: string      // display message
  severity: 'annotating' | 'soft'
}

interface DraftEmailData {
  conversationId: string
  orderId: string
  wineName: string
  providerName: string
  providerEmail: string
  emailType: 'PRICE_INQUIRY' | 'DEMAND_OFFER' | 'PROMO_INQUIRY' | 'WINE_INQUIRY'
  draftContent: string
  disclaimer: string    // WineOps AI disclaimer — read-only
  constraintWarnings: ConstraintWarning[]
  roundCount: number
  timestamp: string
}

interface DraftEmailApprovalPanelProps {
  isOpen: boolean
  draftData: DraftEmailData | null
  onApprove: (modifiedContent?: string) => void
  onDiscard: () => void
  onClose: () => void
  isSubmitting?: boolean
}
```

**AnimatePresence + backdrop pattern** (copy from `OrderApprovalModal.tsx` lines 87–138):
```typescript
return (
  <AnimatePresence>
    {isOpen && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border-2 border-indigo-900 overflow-hidden"
        >
          {/* Deep-blue header to distinguish from ORDER APPROVAL (black) */}
          <div className="bg-indigo-900 px-6 py-5 border-b-2 border-white">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-black text-white uppercase tracking-wider">
                ✦ AI DRAFT READY
              </h2>
              <button onClick={onClose} className="text-white hover:text-gray-300">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
```

**Action buttons pattern** (copy 2-grid layout from `OrderApprovalModal.tsx` lines 222–264):
```typescript
{/* Primary Actions */}
<div className="grid grid-cols-2 gap-3">
  <button
    onClick={() => onApprove(editedContent !== draftData.draftContent ? editedContent : undefined)}
    disabled={isSubmitting}
    className="h-16 bg-green-500 hover:bg-green-600 text-white font-bold text-base rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
  >
    <CheckCircle className="w-5 h-5" />
    Send Draft
  </button>
  <button
    onClick={onDiscard}
    disabled={isSubmitting}
    className="h-16 bg-red-500 hover:bg-red-600 text-white font-bold text-base rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
  >
    <XCircle className="w-5 h-5" />
    Discard
  </button>
</div>

{/* Inline editor toggle */}
<button
  onClick={() => setIsEditing(!isEditing)}
  className="w-full h-11 bg-gray-700 hover:bg-gray-800 text-white font-medium text-sm rounded-xl transition-all flex items-center justify-center gap-1.5"
>
  <Edit2 className="w-3.5 h-3.5" />
  {isEditing ? 'Preview' : 'Edit Draft'}
</button>
```

**WineOps AI Disclaimer section** (non-removable, read-only):
```typescript
{/* Disclaimer — non-removable per D-32-08 */}
<div className="bg-gray-100 rounded-lg border border-gray-300 p-3 mt-3">
  <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wide mb-1">
    Auto-appended disclaimer
  </p>
  <p className="text-xs text-gray-600 italic whitespace-pre-line">
    {draftData.disclaimer}
  </p>
</div>
```

---

### `hooks/queries/useDraftEmailQueries.ts` (NEW hook file)

**Analog:** `hooks/queries/useOrderQueries.ts` — exact TanStack Query mutation pattern

**Imports + query keys + mutation pattern** (copy from `useOrderQueries.ts` lines 1–16, 103–116):
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../lib/query-keys'
import { apiClient } from '../../services/api/client'
import { useAuth } from '../../contexts/AuthContext'

// ---------------------------------------------------------------------------
// Query keys for drafts
// ---------------------------------------------------------------------------

export const draftKeys = {
  all: ['drafts'] as const,
  pending: (restaurantId: string) => [...draftKeys.all, 'pending', restaurantId] as const,
  byOrder: (orderId: string) => [...draftKeys.all, 'order', orderId] as const,
}

// ---------------------------------------------------------------------------
// Mutation: Approve draft
// ---------------------------------------------------------------------------

export function useApproveDraft() {
  const { activeRestaurantId } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orderId, modifiedContent }: { orderId: string; modifiedContent?: string }) => {
      if (!activeRestaurantId) throw new Error('No restaurant selected')
      return apiClient.post(`/api/v1/procurement/orders/${orderId}/approve-draft`, {
        modifiedContent,
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
      queryClient.invalidateQueries({ queryKey: draftKeys.all })
    },
  })
}

// ---------------------------------------------------------------------------
// Mutation: Discard draft
// ---------------------------------------------------------------------------

export function useDiscardDraft() {
  const { activeRestaurantId } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (orderId: string) => {
      if (!activeRestaurantId) throw new Error('No restaurant selected')
      return apiClient.post(`/api/v1/procurement/orders/${orderId}/discard-draft`)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: draftKeys.all })
    },
  })
}

// ---------------------------------------------------------------------------
// Mutation: Edit draft content
// ---------------------------------------------------------------------------

export function useEditDraft() {
  const { activeRestaurantId } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ orderId, content }: { orderId: string; content: string }) => {
      if (!activeRestaurantId) throw new Error('No restaurant selected')
      return apiClient.patch(`/api/v1/procurement/orders/${orderId}/draft`, { modifiedContent: content })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: draftKeys.all })
    },
  })
}
```

---

### `pages/Providers.tsx` (MODIFY — add intelligence badge pills)

**Analog:** `Providers.tsx` lines 46–60 — `TypeBadge` component (exact copy, different values)

**New `IntelBadge` component** (copy `TypeBadge` pattern from lines 47–59):
```typescript
// Intelligence badge pills (Phase 32 D-32-09 — top 3 actionable dimensions)
function IntelBadge({ dimension }: { dimension: { key: string; label: string; value: string } }) {
  const cfg =
    dimension.key === 'response_speed'  ? { dot: 'bg-green-500',   bg: 'bg-green-50',   text: 'text-green-700'  } :
    dimension.key === 'negotiation'     ? { dot: 'bg-amber-500',   bg: 'bg-amber-50',   text: 'text-amber-700'  } :
    dimension.key === 'relationship'    ? { dot: 'bg-rose-500',    bg: 'bg-rose-50',    text: 'text-rose-700'   } :
                                          { dot: 'bg-gray-400',    bg: 'bg-gray-50',    text: 'text-gray-600'   }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
      {dimension.label}: {dimension.value}
    </span>
  )
}
```

**Badge pills rendering** (insert into the provider card's info section, after existing `TypeBadge`):
```typescript
{/* Intelligence pills — show only if profile_dynamic has data */}
{provider.profile_dynamic && Object.keys(provider.profile_dynamic).length > 0 && (
  <div className="flex flex-wrap gap-1.5 mt-1.5">
    {getTopIntelDimensions(provider.profile_dynamic).map((dim) => (
      <IntelBadge key={dim.key} dimension={dim} />
    ))}
  </div>
)}
```

---

## Shared Patterns

### Authentication (JWT Guard)
**Source:** `apps/api-gateway/src/auth/guards/jwt-auth.guard.ts`
**Apply to:** All new NestJS controller endpoints

```typescript
@UseGuards(JwtAuthGuard)
@Controller('procurement')
export class ProcurementController {
  // JWT token contains: { userId, email, restaurantId, role }
  // All restaurant-scoped operations use req.user.restaurantId
  @CurrentUser() user: { userId: string; restaurantId: string }
}
```

### Error Handling (NestJS)
**Source:** `apps/api-gateway/src/procurement/procurement.controller.ts` lines 47–57
**Apply to:** All new NestJS controller methods

```typescript
try {
  return await this.service.someMethod(user.restaurantId, ...);
} catch (error) {
  if (error instanceof ForbiddenException) throw error;   // preserve 403
  throw new HttpException(
    error.message || 'Operation failed',
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}
```

### Error Handling (Python Agents)
**Source:** `agents/email_intel_agent.py` lines 92–104
**Apply to:** `ProviderCommunicationAgent.process_message()`

```python
try:
    await self._handle_order_created(payload)
    await self._mark_processed(idempotency_key, {"status": "ok"})
except Exception as e:
    self.logger.error(f"ProviderCommunicationAgent failed: {e}")
    await self._send_to_dlq(
        message=payload, error=str(e), retry_count=0,
        original_exchange="procurement.events",
        original_routing_key="procurement.order.created",
    )
    raise
```

### Supabase Query Pattern (Python)
**Source:** `agents/email_intel_agent.py` lines 225–236
**Apply to:** All new Python Supabase queries

```python
try:
    result = (
        self.database.supabase.table("procurement_conversations")
        .select("id, content, round_count, rolling_summary")
        .eq("order_id", order_id)
        .eq("status", "PENDING_APPROVAL")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if result.data:
        ...
except Exception as e:
    self.logger.warning(f"Query failed (proceeding): {e}")
```

### Supabase UPDATE Pattern (NestJS)
**Source:** `apps/api-gateway/src/providers/providers.service.ts` lines 216–230
**Apply to:** All new NestJS service update methods

```typescript
const { data, error } = await this.databaseService.supabase
  .from('table_name')
  .update(updatePayload)
  .eq('id', id)
  .eq('restaurant_id', restaurantId)   // ALWAYS scope to restaurant
  .select('*')
  .single();

if (error) {
  this.logger.error('Failed to update', { id, error: error.message });
  throw error;
}
```

### Redis Pipeline Pattern (Python)
**Source:** `agents/email_intel_agent.py` lines 296–299 + `core/database.py`
**Apply to:** `ProviderCommunicationAgent` rate limit checks

```python
pipe = self.redis.pipeline()
pipe.lpush(key, item)
pipe.expire(key, 36 * 3600)   # TTL in seconds
await pipe.execute()

# Increment + expire in one pipeline:
pipe = self.redis.pipeline()
pipe.incr(counter_key)
pipe.expire(counter_key, 86400)   # 24h TTL
await pipe.execute()
```

### SpendLogger Call Pattern
**Source:** `services/agent-orchestrator/services/spend_logger.py` lines 40–79
**Apply to:** Every Haiku and Gemini API call in `ProviderCommunicationAgent` and `ConstraintEngine`

```python
from services.spend_logger import get_spend_logger
spend_logger = get_spend_logger()
spend_logger.log(
    provider="anthropic",          # "anthropic" or "google"
    model=self.settings.haiku_model,
    input_tokens=input_tokens,
    output_tokens=output_tokens,
    cost_usd=cost_usd,
    restaurant_id=restaurant_id,
)
```

### `log_decision()` Pattern
**Source:** `core/base_agent.py` lines 707–729
**Apply to:** Every AI decision in `ProviderCommunicationAgent` (draft selection, constraint check, profile extract)

```python
await self.log_decision(
    decision_type="outbound_draft_generated",   # snake_case verb
    inputs={"order_id": ..., "provider_id": ...},
    output={"email_type": ..., "constraint_flags": ...},
    reasoning="Reason for decision",
    confidence=0.95,
    restaurant_id=restaurant_id,
)
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `components/providers/ProviderProfileForm.tsx` | component | CRUD form | No existing multi-field profile form components in the frontend; closest is modal layout from `OrderApprovalModal.tsx` but the content is entirely new (5 foundational dimensions: specialty categories, region, channel, business type, decision-maker) |

---

## Metadata

**Analog search scope:** `services/agent-orchestrator/agents/`, `services/agent-orchestrator/core/`, `services/agent-orchestrator/services/`, `apps/api-gateway/src/procurement/`, `apps/api-gateway/src/providers/`, `apps/web/src/components/orders/`, `apps/web/src/hooks/queries/`, `supabase/migrations/`
**Files scanned:** 47 source files read (full or targeted)
**Pattern extraction date:** 2026-05-14
