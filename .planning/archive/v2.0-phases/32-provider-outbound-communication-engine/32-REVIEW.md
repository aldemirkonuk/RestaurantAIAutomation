---
phase: 32-provider-outbound-communication-engine
reviewed: 2026-05-14T16:00:00Z
depth: deep
files_reviewed: 10
files_reviewed_list:
  - services/agent-orchestrator/agents/provider_communication_agent.py
  - services/agent-orchestrator/services/constraint_engine.py
  - services/agent-orchestrator/services/fuzzy_matcher.py
  - services/agent-orchestrator/agents/visual_verification_agent.py
  - services/agent-orchestrator/agents/email_intel_agent.py
  - apps/api-gateway/src/procurement/procurement.service.ts
  - apps/api-gateway/src/procurement/procurement.controller.ts
  - apps/api-gateway/src/procurement/dto/approve-draft.dto.ts
  - apps/api-gateway/src/providers/provider-intelligence.service.ts
  - apps/web/src/components/orders/DraftEmailApprovalPanel.tsx
  - apps/web/src/hooks/queries/useDraftEmailQueries.ts
  - apps/web/src/pages/Orders.tsx
findings:
  critical: 2
  warning: 10
  info: 4
  total: 16
status: issues_found
---

# Phase 32: Code Review Report

**Reviewed:** 2026-05-14T16:00:00Z
**Depth:** deep
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Phase 32 delivers the outbound draft pipeline end-to-end: Python `ProviderCommunicationAgent`, `ConstraintEngine`, `FuzzyMatcher`, NestJS draft CRUD endpoints, and the `DraftEmailApprovalPanel` UI. The core architecture is sound — the 3-gate auto-send check fails closed, RLS tenant scoping is applied consistently in the new endpoints, and the `status='unread'` notification field is correctly used in all _newly written_ notification inserts.

Two blockers require fixes before this ships. One is a silent data-corruption bug in `EmailIntelAgent._notify()` (unchanged legacy method) that was found during cross-file analysis: it uses the old `is_read: False` field while the rest of the system now uses `status='unread'`. The second is an idempotency key construction bug in `ProviderCommunicationAgent.process_message` that causes every invoice-received event after the first to be silently dropped.

Ten warnings cover a TOCTOU race in the Redis rate limiter, dead pre-draft constraint code, brittle disclaimer parsing in the frontend, a regex that generates near-universal C-11 false positives, and several API correctness gaps. Four info items are clean-up noise.

---

## Critical Issues

### CR-01: `EmailIntelAgent._notify()` uses `is_read: False` — wrong column name

**File:** `services/agent-orchestrator/agents/email_intel_agent.py:596-597`

**Issue:** The general `_notify()` helper in `EmailIntelAgent` inserts `"is_read": False` into the `notifications` table. Plan 32-01 research confirmed the column is `status='unread'`. This means every OPERATIONAL and PROMO email classification notification is silently inserted without a valid `status` value (Supabase accepts unknown columns depending on schema strictness, but the row will never appear as unread in the UI). By contrast, the new `_notify_unknown_sender()` in the same file (added in Phase 32) correctly uses `"status": "unread"` — demonstrating the inconsistency.

`ProviderCommunicationAgent._notify()` is also correct. This is isolated to `EmailIntelAgent._notify()`.

**Fix:**
```python
# email_intel_agent.py, line 596-597 — replace is_read with status
insert_payload: Dict[str, Any] = {
    "restaurant_id": restaurant_id,
    "type": notification_type,
    "title": title,
    "message": message,
    "priority": priority,
    "action_url": action_url,
    "status": "unread",   # was: "is_read": False
}
```

---

### CR-02: Invoice-received idempotency key is the same for all invoice events — silent dedup drops all but the first

**File:** `services/agent-orchestrator/agents/provider_communication_agent.py:101-103`

**Issue:** `process_message` builds the idempotency key as:
```python
order_id   = payload.get("order_id", "")       # "" for invoice events
routing_key = payload.get("_routing_key", "")
idempotency_key = f"prov_comm:{order_id}:{routing_key}"
```

The `provider.invoice.received` payload published by `EmailIntelAgent` contains `restaurant_id`, `provider_id`, `email_body`, and `gmail_thread_id`, but **no `order_id`**. With `order_id=""`, all invoice events share the key `prov_comm::provider.invoice.received` (or `prov_comm::` if `_routing_key` is not injected). After the first invoice event is processed and `_mark_processed` is called, `_check_idempotency` returns `True` for every subsequent invoice event and the handler at line 117 is never reached. All off-app invoice matching stops working after the first email.

**Fix:** Include sufficient context to make invoice-event keys unique:
```python
if "invoice.received" in routing_key:
    # order_id is absent; key on restaurant+provider+thread instead
    thread_id = payload.get("gmail_thread_id", "")
    idempotency_key = (
        f"prov_comm:{restaurant_id}:{provider_id}:{thread_id}:{routing_key}"
    )
else:
    idempotency_key = f"prov_comm:{order_id}:{routing_key}"
```

Where `restaurant_id` and `provider_id` are read from the payload after extracting `order_id`.

---

## Warnings

### WR-01: Rate-limit check has a TOCTOU race — cap can be exceeded under concurrency

**File:** `services/agent-orchestrator/agents/provider_communication_agent.py:633-641`

**Issue:** The GET and INCR are separate non-atomic operations. Between the `GET` on line 633 and the `INCR` inside the pipeline on line 637, a concurrent request can also see `current < cap` and increment, exceeding the daily cap by the number of concurrent requests at the boundary.

```python
current = await self.redis.get(key)      # check
if current and int(current) >= cap:
    return True
pipe = self.redis.pipeline()
pipe.incr(key)                            # increment (not atomic with check)
pipe.expire(key, ttl_seconds)
await pipe.execute()
```

**Fix:** Use a Lua script for an atomic compare-and-increment:
```python
LUA_RATE_LIMIT = """
local cur = redis.call('GET', KEYS[1])
if cur and tonumber(cur) >= tonumber(ARGV[1]) then return -1 end
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
return n
"""
result = await self.redis.eval(LUA_RATE_LIMIT, 1, key, cap, ttl_seconds)
return result == -1  # -1 means cap exceeded
```

---

### WR-02: `VisualVerificationAgent` instantiated via `__new__()` — bypasses `__init__`, fragile

**File:** `services/agent-orchestrator/agents/provider_communication_agent.py:968-971`

**Issue:**
```python
vva = VisualVerificationAgent.__new__(VisualVerificationAgent)
vva.logger = self.logger
extracted = await vva._extract_invoice_from_email_text(email_body)
```

`__new__` skips `__init__`, so `vva` has no `message_bus`, `database`, `config`, `mock_mode`, `price_tolerance_percent`, or any other constructor-set attribute. `_extract_invoice_from_email_text` currently works because it only uses `self.logger`, module-level helpers, and calls `self._parse_invoice_text` (which is self-contained). However, any future change to `_extract_invoice_from_email_text` that uses an instance attribute (e.g., `self.settings` or `self.database`) will fail silently with an `AttributeError` that routes the message to DLQ.

Additionally, `vva.logger` is the `ProviderCommunicationAgent` logger, so all log output from the VVA method appears under the wrong agent name.

**Fix:** Extract `_extract_invoice_from_email_text` to a standalone module-level function, or instantiate properly and skip the heavy `initialize()` step:
```python
# Preferred: move to a module-level utility in visual_verification_agent.py
from agents.visual_verification_agent import extract_invoice_from_email_text
extracted = await extract_invoice_from_email_text(email_body, logger=self.logger)
```

---

### WR-03: Pre-draft `pre_check` constraint result is never evaluated — dead code hides logic gap

**File:** `services/agent-orchestrator/agents/provider_communication_agent.py:337-344`

**Issue:** The result of `pre_check = ce.check_hard_constraints(...)` at step 5 is computed but never evaluated. The blocking condition at line 455 only checks `post_check.blocked or word_check.blocked`. The pre-check's `.blocked` field is discarded, meaning any hard constraint violation detected on the order context _before_ draft generation (e.g., C-05 round limit, C-03 quantity cap) does not prevent the Haiku API call from being made.

For `order.created` with `round_count=0` this is currently harmless (C-05 can't fire at round 0, C-03 can't fire when `quantity == order_quantity`). But it signals missing guard intent and will become a real bug if pre-draft checks are extended.

**Fix:**
```python
pre_check = ce.check_hard_constraints(...)
if pre_check.blocked:
    await self._notify(
        restaurant_id=restaurant_id,
        notification_type="constraint_triggered",
        title=f"Draft blocked (pre-check): {', '.join(pre_check.triggered_hard)}",
        message="Order context violates hard constraints before drafting.",
        priority="high",
        action_url="/orders",
        metadata={"order_id": order_id, "constraints": pre_check.triggered_hard},
    )
    return
```

---

### WR-04: C-11 unit-ambiguity regex fires on virtually every draft — near-universal false positive

**File:** `services/agent-orchestrator/services/constraint_engine.py:188-193`

**Issue:**
```python
re.search(r'\b\d+\b(?!\s*(case|bottle|magnum|liter|ml|oz))', draft_text, re.IGNORECASE)
```

This negative lookahead only suppresses the match when a unit word follows _immediately_ (with optional whitespace). Any digit not directly followed by a unit is flagged. In a typical draft:

- `"$450 per bottle"` → `450` is matched (` per bottle` doesn't match `\s*bottle`) ✗
- `"2024 vintage"` → `2024` is matched ✗
- `"Order #ORD-2026-12345"` → digits matched ✗
- `"6 cases"` → not matched ✓ (correct)

Almost every real email draft triggers C-11, polluting the `constraint_warnings` displayed to the manager in `DraftEmailApprovalPanel` with noise, causing alert fatigue and eroding trust in the constraint system.

**Fix:** Restrict the check to stand-alone integers that look like quantities (e.g., preceded by "approximately", "around", "we need", "requesting", etc.) rather than any bare digit:
```python
# Only flag bare integers that appear to be quantities without explicit units
if unit_ambiguous or (
    draft_text and re.search(
        r'\b(?:approximately|around|about|requesting|need|send|provide)\s+(\d+)\b'
        r'(?!\s*(?:case|bottle|magnum|liter|ml|oz|cases|bottles))',
        draft_text, re.IGNORECASE
    )
):
```

---

### WR-05: Disclaimer parsing in Orders.tsx splits on `'\n\n—\n'` — brittle and likely wrong

**File:** `apps/web/src/pages/Orders.tsx:371`

**Issue:**
```typescript
disclaimer: draft.content?.split('\n\n—\n')?.[1]
  ?? 'Sent via WineOps AI — This message was generated with AI assistance.',
```

`ProviderCommunicationAgent` builds `full_draft = f"{draft_body}\n\n{disclaimer}"` (line 472). Unless `settings.wineops_disclaimer` begins with an em-dash `—` followed by a newline, the split will always fail and the UI will display the hardcoded fallback string — not the actual disclaimer. The two-part content is not stored in separate DB columns.

**Fix (short-term):** Add a sentinel delimiter when composing the draft in the agent:
```python
DISCLAIMER_SEPARATOR = "\n\n---DISCLAIMER---\n"
full_draft = f"{draft_body}{DISCLAIMER_SEPARATOR}{disclaimer}"
```
and split on that in the frontend:
```typescript
const parts = draft.content?.split('\n\n---DISCLAIMER---\n')
disclaimer: parts?.[1] ?? ''
```

**Fix (preferred):** Store `body` and `disclaimer` as separate columns in `procurement_conversations`.

---

### WR-06: `updateIntelligence` fully replaces `profile_foundational` — partial updates silently wipe fields

**File:** `apps/api-gateway/src/providers/provider-intelligence.service.ts:414-438`

**Issue:**
```typescript
if (dto.profile_foundational !== undefined) {
    updatePayload.profile_foundational = dto.profile_foundational;
}
```

The `ProviderProfileForm` PATCH sends only the fields the user has filled in. If a user changes only `specialty_categories`, the payload is `{ profile_foundational: { specialty_categories: "Burgundy" } }`. This replaces the entire JSONB column, wiping `primary_region`, `distribution_channel`, and all other existing fields.

The Python agent uses a correct merge pattern: `merged = {**current_dynamic, **new_fields}`.

**Fix:** Merge at the database or service layer:
```typescript
// Fetch existing, then merge before update
const { data: existing } = await this.databaseService.supabase
    .from('providers').select('profile_foundational')
    .eq('id', providerId).eq('restaurant_id', restaurantId).single();
updatePayload.profile_foundational = {
    ...(existing?.profile_foundational ?? {}),
    ...dto.profile_foundational,
};
```

---

### WR-07: `discardDraft` and `editDraft` return `{success: true}` on zero-row update — silent no-op

**File:** `apps/api-gateway/src/procurement/procurement.service.ts:732-776`

**Issue:** Both methods call Supabase `.update()` filtered by `status='PENDING_APPROVAL'`. If the draft was already approved, already discarded, or belongs to a different order, the Supabase UPDATE affects 0 rows. No error is thrown, and both methods return `{ success: true }`, misleading the caller.

**Fix:** Use `.select('id').single()` to detect the zero-row case:
```typescript
const { data, error } = await this.databaseService.supabase
    .from('procurement_conversations')
    .update({ status: 'DISCARDED' })
    .eq('restaurant_id', restaurantId)
    .eq('order_id', orderId)
    .eq('status', 'PENDING_APPROVAL')
    .select('id')
    .single();

if (error || !data) {
    throw new NotFoundException(`No pending draft found for order ${orderId}`);
}
```

---

### WR-08: `editDraft` with missing `modifiedContent` silently wipes draft to empty string

**File:** `apps/api-gateway/src/procurement/procurement.controller.ts:287-291`

**Issue:**
```typescript
return await this.procurementService.editDraft(
    user.restaurantId,
    orderId,
    dto.modifiedContent ?? '',  // ← empty string fallback
);
```

`ApproveDraftDto.modifiedContent` is optional. If the client sends `PATCH /orders/:id/draft` with an empty body (or omits `modifiedContent`), `dto.modifiedContent` is `undefined`, and `newContent` becomes `''`. The draft content is then set to an empty string.

**Fix:** Require `modifiedContent` for the edit endpoint or add a guard:
```typescript
if (!dto.modifiedContent) {
    throw new BadRequestException('modifiedContent is required for draft edit');
}
return await this.procurementService.editDraft(
    user.restaurantId, orderId, dto.modifiedContent,
);
```

---

### WR-09: `createRetroactiveOrder` inserts `procurement_orders` without `order_number`

**File:** `apps/api-gateway/src/providers/provider-intelligence.service.ts:468-480`

**Issue:** The retroactive order insert does not include an `order_number` field. `createOrder` in `procurement.service.ts` generates `order_number` via `generateOrderNumber()`. If `order_number` is `NOT NULL` in the schema (as `createOrder` always populates it), the retroactive insert will fail with a constraint violation at runtime.

**Fix:**
```typescript
// Reuse the same number format: ORD-{year}-{random5}
const orderNumber = `ORD-${new Date().getUTCFullYear()}-${Math.floor(Math.random()*100000).toString().padStart(5,'0')}`;
// Add to the insert payload:
{ order_number: orderNumber, ...existing_fields }
```

---

### WR-10: `constraint_flags.annotating` stores code strings — frontend shows codes as messages

**File:** `services/agent-orchestrator/agents/provider_communication_agent.py:448-452` / `apps/web/src/pages/Orders.tsx:372-374`

**Issue:** The `constraint_flags` dict stored to DB is:
```python
constraint_flags = {
    "hard": post_check.triggered_hard,        # e.g. ["C-02"]
    "annotating": annotating.triggered_annotating,  # e.g. ["C-09", "C-11"]
    "soft_warnings": annotating.annotations,  # e.g. [{"code":"C-09","message":"Last recorded price...","severity":"annotating"}]
    "is_sensitive": is_sensitive,
}
```

The rich annotation messages are stored under `soft_warnings`, but the frontend reads from `annotating` (the code-only list):
```typescript
constraintWarnings: (draft.constraint_flags?.annotating ?? []).map((c: string) => ({
    code: c,
    message: c,   // ← code used as message ("C-09" instead of "Last recorded price...")
    severity: 'annotating' as const,
})),
```

The `DraftEmailApprovalPanel` amber block shows `[C-09] C-09` instead of `[C-09] Last recorded price: $45 on 2026-01-15 — confirm current pricing.`

**Fix:** Read from `soft_warnings` instead:
```typescript
constraintWarnings: (draft.constraint_flags?.soft_warnings ?? []).map(
    (w: { code: string; message: string; severity: string }) => ({
        code: w.code,
        message: w.message,
        severity: w.severity as 'annotating' | 'soft',
    })
),
```

---

## Info

### IN-01: Rate limit uses rolling 24-hour window, not calendar day

**File:** `services/agent-orchestrator/agents/provider_communication_agent.py:296`

**Issue:** `rate_key = f"negotiation_draft:{restaurant_id}:day"` uses a static `:day` suffix with an 86400-second TTL. The "day" resets 24 hours after the _first_ draft of that day, not at midnight. A restaurant that uses its last draft at 11:30 PM won't be reset until 11:30 PM the next calendar day — they effectively lose part of their next day's quota. This is also a documentation gap: the error message says "Drafts frozen until tomorrow" but the actual freeze is until `now + 24h`.

If calendar-day semantics are required, key on the current UTC date:
```python
from datetime import date
rate_key = f"negotiation_draft:{restaurant_id}:{date.today().isoformat()}"
```
And adjust TTL accordingly (e.g., `48 * 3600` to ensure cross-midnight coverage).

---

### IN-02: `_extract_invoice_from_email_text` hardcodes model name instead of using `settings.haiku_model`

**File:** `services/agent-orchestrator/agents/visual_verification_agent.py:560`

**Issue:** `_HAIKU_MODEL = "claude-haiku-4-5-20251001"` is hardcoded in the method. All other Haiku usages in the codebase (both `ProviderCommunicationAgent` and `EmailIntelAgent`) use `self.settings.haiku_model`. This will diverge when the model is updated.

**Fix:** Pass the model name as a parameter or read from a singleton settings:
```python
from config.settings import Settings
_HAIKU_MODEL = Settings().haiku_model
```

---

### IN-03: `PII_PATTERNS` duplicated in `provider_communication_agent.py` and `constraint_engine.py`

**File:** `services/agent-orchestrator/agents/provider_communication_agent.py:39-47` / `services/agent-orchestrator/services/constraint_engine.py:28-36`

**Issue:** Both modules define nearly identical `PII_PATTERNS` lists. The agent uses pre-compiled `re.compile()` objects; the engine uses raw strings compiled at search time. A future pattern addition in one will silently diverge from the other.

**Fix:** Move `PII_PATTERNS` to `constraint_engine.py` (it already owns C-21) and import from there in `provider_communication_agent.py`.

---

### IN-04: `console.error` debug artifact in production `Orders.tsx`

**File:** `apps/web/src/pages/Orders.tsx:381`

**Issue:** `console.error('Failed to fetch pending draft:', err)` should be replaced with a user-visible toast or silent failure. Raw error objects can include stack traces and internal URLs that are visible in browser DevTools.

**Fix:**
```typescript
// Replace the console.error with a toast
import { toast } from 'sonner' // or whatever toast lib is in use
toast.error('Could not load draft — please refresh and try again.')
```

---

_Reviewed: 2026-05-14T16:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
