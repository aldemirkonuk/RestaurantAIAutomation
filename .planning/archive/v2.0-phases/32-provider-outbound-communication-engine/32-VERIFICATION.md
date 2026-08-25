---
phase: 32-provider-outbound-communication-engine
verified: 2026-05-14T16:00:00Z
status: human_needed
score: 44/45 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Run all Phase 32 test suites"
    expected: "pytest tests/test_constraint_engine.py tests/test_fuzzy_matcher.py tests/test_provider_communication_agent.py tests/test_intelligence_pipeline.py — all pass with 0 failures"
    why_human: "Cannot execute pytest in this environment without a running Python virtualenv with all deps installed"
  - test: "Confirm Supabase migration was pushed"
    expected: "SELECT column_name FROM information_schema.columns WHERE table_name='providers' AND column_name IN ('profile_foundational','profile_dynamic') returns 2 rows; procurement_conversations returns 6 new columns"
    why_human: "Cannot query live DB from this context; migration file exists but push confirmation requires MCP or supabase CLI"
  - test: "End-to-end draft flow: create order with provider → draft appears in Orders page"
    expected: "Creating a procurement order with a provider_id set causes a 'draft_ready' notification to appear and auto-opens DraftEmailApprovalPanel with the AI-generated email"
    why_human: "Requires live app with running agent-orchestrator, RabbitMQ, and Supabase realtime subscription"
  - test: "DraftEmailApprovalPanel visual render"
    expected: "Panel shows indigo-900 header ('✦ AI DRAFT READY'), 2-column Send Draft (green) / Discard (red) grid, amber constraint warnings block, read-only WineOps AI disclaimer, inline edit toggle"
    why_human: "Cannot render React components in this environment; visual compliance requires browser"
  - test: "notification field name consistency — 'status' vs 'is_read'"
    expected: "Confirm which column exists on notifications table. provider_communication_agent._notify uses 'status': 'unread' while email_intel_agent._notify_unknown_sender uses 'is_read': False — one will silently fail. Run: SELECT column_name FROM information_schema.columns WHERE table_name='notifications'"
    why_human: "Requires DB access to determine which column exists; one of the two agents has the wrong field name"
---

# Phase 32: Provider Outbound Communication Engine — Verification Report

**Phase Goal:** Outbound half of the provider communication loop. Order creation silently pre-generates an AI email draft and notifies the manager. Manager approves/edits/discards. Progressive summarization keeps LLM context flat at ~6k tokens. Provider intelligence profiles (22 dimensions) built automatically from conversation history.

**Verified:** 2026-05-14T16:00:00Z
**Status:** HUMAN_NEEDED — automated checks pass; 5 items require human/runtime verification
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (across all 7 plans)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | providers table has `profile_foundational` + `profile_dynamic` JSONB columns | ✓ VERIFIED | `20260514000000_phase32_schema.sql` — 4 occurrences; GIN indexes created |
| 2 | `procurement_conversations` gains 6 new columns (restaurant_id, outbound_email_type, round_count, constraint_flags, disclaimer_appended, rolling_summary) | ✓ VERIFIED | Migration SQL has all 6 `ADD COLUMN IF NOT EXISTS` |
| 3 | `rapidfuzz>=3.0.0` in requirements.txt | ✓ VERIFIED | `rapidfuzz>=3.6.0` present (satisfies >=3.0.0) |
| 4 | `settings.py` has all 8 Phase 32 constants | ✓ VERIFIED | `hard_round_cap, max_round_cap, negotiation_draft_daily_cap, email_classify_daily_cap, auto_send_health_threshold, draft_token_budget, draft_input_token_hard_cap, wineops_disclaimer` all present |
| 5 | ConstraintEngine blocks C-01 (off-topic), C-02 (commitment), C-08/C-21 (PII), C-19 (three-tier) | ✓ VERIFIED | `constraint_engine.py` — all 4 hard constraint patterns + `is_sensitive` flag implemented |
| 6 | ConstraintEngine annotating: C-09, C-14, C-15 add warnings without blocking | ✓ VERIFIED | `check_annotating_constraints()` — 8 matches including C-09, C-14 |
| 7 | FuzzyMatcher.compute_match_score() returns float 0–1 (composite formula) | ✓ VERIFIED | `fuzzy_matcher.py` — formula: provider×0.30 + wine×0.40 + qty×0.15 + date×0.15 |
| 8 | FuzzyMatcher.match_wine_name() uses token_set_ratio (vintage-tolerant) | ✓ VERIFIED | `fuzz.token_set_ratio` in `match_wine_name()` |
| 9 | Module-level singletons get_constraint_engine() + get_fuzzy_matcher() | ✓ VERIFIED | Both modules have `_singleton = None` + lazy init pattern |
| 10 | Order with provider_id triggers ProviderCommunicationAgent via `procurement.order.created` | ✓ VERIFIED | `procurement.service.ts` — `if (dto.providerId && this.orchestratorService)` publishes event |
| 11 | Agent inserts `procurement_conversations` row with direction=OUTBOUND, status=PENDING_APPROVAL (or AUTO_SENT), outbound_email_type, disclaimer_appended=True | ✓ VERIFIED | Lines 484-496 in `provider_communication_agent.py` — all fields present |
| 12 | Agent inserts notifications with type=draft_ready + metadata.conversation_id + metadata.order_id | ✓ VERIFIED | `_notify(..., notification_type="draft_ready", ..., metadata={"conversation_id": ..., "order_id": ...})` at line 528 |
| 13 | Daily rate limit: 51st draft returns blocked (Redis `negotiation_draft:{restaurant_id}:day` counter) | ✓ VERIFIED | `rate_key = f"negotiation_draft:{restaurant_id}:day"` at line 296; cap checked before Haiku call |
| 14 | 8001-token input → hard rejected before Haiku call | ✓ VERIFIED | `if estimated_tokens > self.settings.draft_input_token_hard_cap:` → notification + early return |
| 15 | PII in email body → discrete mode, no body logging, is_sensitive=True | ✓ VERIFIED | `_classify_message_sensitivity()` uses 7 PII_PATTERNS; ConstraintEngine.is_sensitive flag |
| 16 | `draft_lock:{order_id}` mutex prevents duplicate drafts | ✓ VERIFIED | `lock_key = f"draft_lock:{order_id}"` + `SET NX PX 30000`  ⚠ Plan says `{conversation_id}` but implementation uses `{order_id}` — acceptable: conversation_id doesn't exist at lock time |
| 17 | SpendLogger.log() called after every Haiku call | ✓ VERIFIED | 3 separate call sites in `provider_communication_agent.py`; 1 in `visual_verification_agent.py` |
| 18 | ProviderCommunicationAgent registered in orchestrator._register_agent_classes() | ✓ VERIFIED | `orchestrator.py` — import + `"provider_communication_agent": ProviderCommunicationAgent` |
| 19 | createOrder() publishes `procurement.order.created` to RabbitMQ when provider_id is set | ✓ VERIFIED | Non-fatal publish inside `if (dto.providerId && this.orchestratorService)` guard |
| 20 | POST `/approve-draft` updates status=APPROVED + publishes `provider.draft.approved` | ✓ VERIFIED | `approveDraft()` + `publishEvent('provider.events', 'provider.draft.approved', ...)` |
| 21 | POST `/discard-draft` updates status=DISCARDED + publishes `provider.draft.discarded` | ✓ VERIFIED | `discardDraft()` + `publishEvent(..., 'provider.draft.discarded', ...)` |
| 22 | PATCH `/orders/:id/draft` updates content without changing status | ✓ VERIFIED | `editDraft()` only sets `{ content: newContent }` — no status field in update |
| 23 | GET `/providers/:id/intelligence` returns profile_foundational + profile_dynamic | ✓ VERIFIED | `providers.controller.ts` → `providersService.getIntelligence()` → Supabase select |
| 24 | PATCH `/providers/:id/intelligence` updates profile_foundational | ✓ VERIFIED | `updateIntelligence()` in `providers.service.ts` |
| 25 | POST `/providers/:id/retroactive-order` creates order status=delivered + source=retroactive | ✓ VERIFIED | `provider-intelligence.service.ts:477-478` — `status: 'delivered', source: 'retroactive'` |
| 26 | All new endpoints require @UseGuards(JwtAuthGuard) scoped to req.user.restaurantId | ✓ VERIFIED | 6 JwtAuthGuard decorators in `procurement.controller.ts`; providers controller similarly guarded |
| 27 | `useDraftEmailQueries.ts` exports useGetPendingDraft, useApproveDraft, useDiscardDraft, useEditDraft | ✓ VERIFIED | 4 named exports confirmed |
| 28 | DraftEmailApprovalPanel has `bg-indigo-900` header (distinct from ORDER APPROVAL `bg-black`) | ✓ VERIFIED | 2 occurrences of `bg-indigo-900` in component |
| 29 | Panel shows draft body + inline textarea toggle + amber constraint warnings + read-only disclaimer | ✓ VERIFIED | `isEditing` state, `bg-amber-50` block, `aria-label="Non-removable WineOps AI disclaimer"` |
| 30 | Send Draft = `bg-green-500`; Discard = `bg-red-500`; Edit Draft toggle = `bg-gray-700` | ✓ VERIFIED | All 3 button classes present in component |
| 31 | role=dialog + aria-labelledby + Escape key close | ✓ VERIFIED | `role="dialog"`, `aria-labelledby="draft-panel-title"`, `if (e.key === 'Escape') onClose()` |
| 32 | ProviderProfileForm has 10 fields | ✓ VERIFIED | 51 field-name references (specialty_categories, primary_region, distribution_channel, business_type, decision_maker_name, preferred_communication_style, typical_response_days, net_payment_terms, ships_on_days, notes) |
| 33 | ProviderProfileForm PATCHes `/providers/:id/intelligence` with profile_foundational + toast | ✓ VERIFIED | `apiClient.patch(...)`, `toast.success('Intelligence profile saved')` using sonner |
| 34 | `_extract_invoice_from_email_text()` calls Haiku + returns structured JSON | ✓ VERIFIED | Added to `visual_verification_agent.py` — Haiku call + JSON parse |
| 35 | `_extract_invoice_from_email_text()` falls back to `_parse_invoice_text()` on Haiku failure | ✓ VERIFIED | `except ... exc: return self._parse_invoice_text(email_body)` |
| 36 | `_extract_dynamic_profile()` calls Haiku + UPDATEs `providers.profile_dynamic` via JSONB merge | ✓ VERIFIED | Python dict merge (`{**current_dynamic, **new_fields}`) → Supabase update at line 775 |
| 37 | `_maybe_summarize()` runs after every 2 rounds: UPDATE rolling_summary + INSERT negotiation_facts | ✓ VERIFIED | `if round_count <= 0 or round_count % 2 != 0: return` gate; both DB operations at lines 877/909 |
| 38 | Context window after `_maybe_summarize` stays ≤ 6000 tokens | ? UNCERTAIN | Architecture enforces this via `_build_context_window()` budget design (line 160–167); `_maybe_summarize` caps conversation input to 4000 chars. No runtime token counter in `_maybe_summarize`. Architectural guarantee, not a hard code guard. |
| 39 | `_handle_invoice_match()` uses FuzzyMatcher score, notifies with auto_suggest / possible_match / no_match | ✓ VERIFIED | `fm.best_order_match(...)` + three-branch notification per `match_class` |
| 40 | `_detect_unknown_sender()` + `_notify_unknown_sender()` wired in EmailIntelAgent inbound flow | ✓ VERIFIED | 4 occurrences; `is_unknown = await self._detect_unknown_sender(...)` in `process_message` |
| 41 | Providers.tsx IntelBadge pills shown when profile_dynamic is populated | ✓ VERIFIED | `{provider.profile_dynamic && Object.keys(provider.profile_dynamic).length > 0 && (...)` at line 591 |
| 42 | Providers.tsx "Fill intelligence profile" CTA when profile_foundational is empty | ✓ VERIFIED | `{(!provider.profile_foundational || Object.keys(provider.profile_foundational).length === 0) && (...)` at line 598 |
| 43 | ProviderProfileForm overlay opens on CTA click | ✓ VERIFIED | `profileFormProviderId` state + `setProfileFormProviderId(provider.id)` + overlay JSX at line 982 |
| 44 | Orders.tsx listens for draft_ready notifications + opens DraftEmailApprovalPanel | ✓ VERIFIED | `window.addEventListener('notification_sent', handleNotification)` filtering `payload.type !== 'draft_ready'` at line 351; fetches draft from API |
| 45 | Approve/discard in DraftEmailApprovalPanel calls useApproveDraft/useDiscardDraft | ✓ VERIFIED | `approveDraftMutation.mutateAsync(...)` / `discardDraftMutation.mutateAsync(...)` wired to panel props at line 3155 |

**Score: 44/45 truths verified** (1 uncertain: #38 context window token guarantee)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260514000000_phase32_schema.sql` | Phase 32 schema additions | ✓ VERIFIED | 2001 bytes; profile_foundational, profile_dynamic, 6 procurement_conversations columns, outbound_email_type CHECK constraint |
| `services/agent-orchestrator/requirements.txt` | rapidfuzz dependency | ✓ VERIFIED | `rapidfuzz>=3.6.0` |
| `services/agent-orchestrator/config/settings.py` | 8 Phase 32 runtime constants | ✓ VERIFIED | All 8 constants with correct env var names and defaults |
| `services/agent-orchestrator/services/constraint_engine.py` | 20-constraint enforcement engine | ✓ VERIFIED | 12193 bytes; ConstraintResult, check_hard_constraints, check_annotating_constraints, check_soft_constraints, check_length_cap, singleton |
| `services/agent-orchestrator/services/fuzzy_matcher.py` | Jaro-Winkler + Levenshtein matching | ✓ VERIFIED | 5409 bytes; FuzzyMatcher, compute_match_score, classify_match, best_order_match, singleton |
| `services/agent-orchestrator/tests/test_constraint_engine.py` | Unit tests for hard constraints | ✓ VERIFIED | 13 test functions covering C-01, C-02, C-21, C-19, C-03, C-05, C-06, C-09, C-14 |
| `services/agent-orchestrator/tests/test_fuzzy_matcher.py` | Unit tests for fuzzy matching | ✓ VERIFIED | 11 test functions |
| `services/agent-orchestrator/agents/provider_communication_agent.py` | Outbound draft engine | ✓ VERIFIED | 1083 lines; all required methods present |
| `services/agent-orchestrator/core/orchestrator.py` | Agent registration | ✓ VERIFIED | Import + dict entry for `provider_communication_agent` |
| `services/agent-orchestrator/tests/test_provider_communication_agent.py` | Behavioral contract tests | ✓ VERIFIED | 13 test functions including auto-send gate tests |
| `apps/api-gateway/src/procurement/dto/approve-draft.dto.ts` | ApproveDraftDto | ✓ VERIFIED | `modifiedContent`, `managerNotes` fields with validators |
| `apps/api-gateway/src/providers/dto/update-intelligence.dto.ts` | UpdateIntelligenceDto | ✓ VERIFIED | `profile_foundational`, `profile_dynamic` JSONB fields |
| `apps/api-gateway/src/providers/dto/retroactive-order.dto.ts` | RetroactiveOrderDto | ✓ VERIFIED | `wineName`, `quantity`, `finalConfirmedCost`, `invoiceDate`, `invoiceNumber`, `rawInvoiceContent` |
| `apps/api-gateway/src/procurement/procurement.service.ts` | Draft CRUD + RabbitMQ publish | ✓ VERIFIED | 9 matches: createOrder publish, approveDraft, discardDraft, editDraft, getPendingDraft |
| `apps/api-gateway/src/procurement/procurement.controller.ts` | 4 new draft endpoints | ✓ VERIFIED | POST approve-draft, POST discard-draft, PATCH draft, GET draft — all JwtAuthGuard |
| `apps/api-gateway/src/providers/provider-intelligence.service.ts` | Badge + retroactive order service | ✓ VERIFIED | 9 method matches: getIntelligence, updateIntelligence, getProfileSummary, createRetroactiveOrder |
| `apps/api-gateway/src/providers/providers.controller.ts` | 4 new intelligence endpoints | ✓ VERIFIED | GET/PATCH intelligence, GET intelligence/summary, POST retroactive-order |
| `apps/web/src/hooks/queries/useDraftEmailQueries.ts` | 4 React Query hooks | ✓ VERIFIED | useGetPendingDraft, useApproveDraft, useDiscardDraft, useEditDraft |
| `apps/web/src/components/orders/DraftEmailApprovalPanel.tsx` | AI draft review modal | ✓ VERIFIED | bg-indigo-900 header, role=dialog, Escape key, aria-labelledby, amber warnings, disclaimer |
| `apps/web/src/components/providers/ProviderProfileForm.tsx` | 10-field intelligence profile form | ✓ VERIFIED | All 10 fields, PATCH handler, sonner toast |
| `apps/web/src/pages/Providers.tsx` (modified) | IntelBadge + ProviderProfileForm wiring | ✓ VERIFIED | IntelBadge, getTopIntelDimensions, Fill profile CTA, overlay |
| `apps/web/src/pages/Orders.tsx` (modified) | draft_ready listener + panel wiring | ✓ VERIFIED | notification_sent event listener, apiClient draft fetch, DraftEmailApprovalPanel render |
| `services/agent-orchestrator/agents/visual_verification_agent.py` (modified) | Email-text invoice extraction | ✓ VERIFIED | `_extract_invoice_from_email_text()` after `_parse_invoice_text()` with fallback |
| `services/agent-orchestrator/agents/email_intel_agent.py` (modified) | Unknown sender detection | ✓ VERIFIED | `_detect_unknown_sender()` + `_notify_unknown_sender()` wired into process_message |
| `services/agent-orchestrator/tests/test_intelligence_pipeline.py` | Intelligence pipeline tests | ✓ VERIFIED | 13 test functions |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `procurement.service.ts:createOrder()` | RabbitMQ `procurement.events` | `orchestratorService.publishEvent()` | ✓ WIRED | `'procurement.order.created'` published when `dto.providerId` set |
| `provider_communication_agent` | `procurement_conversations` table | `supabase.table('procurement_conversations').insert()` | ✓ WIRED | direction=OUTBOUND, status dynamic (PENDING_APPROVAL or AUTO_SENT) |
| `provider_communication_agent` | `notifications` table | `_notify()` → Supabase insert | ✓ WIRED | type=draft_ready; **⚠ uses `status='unread'`** |
| `provider_communication_agent` | `constraint_engine.py` | `from services.constraint_engine import get_constraint_engine` | ✓ WIRED | Used in both pre-draft and post-draft checks |
| `provider_communication_agent` | `fuzzy_matcher.py` | `from services.fuzzy_matcher import get_fuzzy_matcher` | ✓ WIRED | Used in `_handle_invoice_match()` |
| `DraftEmailApprovalPanel` | `/api/v1/procurement/orders/:id/approve-draft` | `useApproveDraft` mutation | ✓ WIRED | `approveDraftMutation.mutateAsync(...)` at Orders.tsx line 3157 |
| `ProviderProfileForm` | `/api/v1/providers/:id/intelligence` | `apiClient.patch` | ✓ WIRED | `PATCH` with `{ profile_foundational: formValues }` |
| `Orders.tsx notification listener` | `DraftEmailApprovalPanel` | `draft_ready` type check + `setIsDraftPanelOpen(true)` | ✓ WIRED | `notification_sent` DOM event → API fetch → state set → panel opens |
| `provider_communication_agent._maybe_summarize()` | `negotiation_facts` table | `supabase.table('negotiation_facts').insert()` | ✓ WIRED | LINE 909; commitment_type whitelist validated |
| `provider_communication_agent._extract_dynamic_profile()` | `providers.profile_dynamic` | Supabase update after Python dict merge | ✓ WIRED | `{**current_dynamic, **new_fields}` merge → update |
| `visual_verification_agent._extract_invoice_from_email_text()` | `FuzzyMatcher` | called by `_handle_invoice_match` in `ProviderCommunicationAgent` | ✓ WIRED | Invoice extraction feeds into `best_order_match()` |
| `email_intel_agent._notify_unknown_sender()` | `notifications` table | Supabase insert | ⚠ PARTIAL | Uses `"is_read": False` — **inconsistent with `provider_communication_agent._notify()` which uses `"status": "unread"`** |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `DraftEmailApprovalPanel.tsx` | `draftPanelData` | `apiClient.get('/procurement/orders/:id/draft')` on `draft_ready` event | Yes — fetches from DB via NestJS → Supabase | ✓ FLOWING |
| `Providers.tsx IntelBadge` | `provider.profile_dynamic` | `useProviders()` → GET /providers → Supabase `select('*')` (includes new JSONB columns) | Yes — select('*') returns all columns | ✓ FLOWING |
| `ProviderProfileForm.tsx` | `formValues` | `initialValues` prop from parent (profile_foundational from GET intelligence endpoint) | Yes — passed from intelligence API call | ✓ FLOWING |
| `provider_communication_agent` draft | `draft_json` | Haiku API response parsed from JSON | Real AI generation; fallback to template on failure | ✓ FLOWING |
| `_maybe_summarize` rolling_summary | `summary` | Haiku API response; stored to `procurement_conversations.rolling_summary` | Real AI summarization | ✓ FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| ConstraintEngine singleton import | `python -c "from services.constraint_engine import get_constraint_engine; ce=get_constraint_engine(); print('OK')"` | Expected: OK (not run — no live env) | ? SKIP |
| FuzzyMatcher composite score | `python -c "from services.fuzzy_matcher import get_fuzzy_matcher; fm=get_fuzzy_matcher(); print(fm.compute_match_score(0.9, 0.85, True, True))"` | Expected: ≥ 0.80 | ? SKIP |
| ProviderCommunicationAgent import | `python -c "from agents.provider_communication_agent import ProviderCommunicationAgent; print('OK')"` | Expected: OK (not run — no live env) | ? SKIP |
| Test suite pass | `pytest tests/test_constraint_engine.py tests/test_fuzzy_matcher.py tests/test_provider_communication_agent.py tests/test_intelligence_pipeline.py -v` | Expected: 50+ tests PASSED | ? SKIP (human verification) |

Step 7b: SKIPPED (no live Python runtime with deps installed in this environment)

---

### Requirements Coverage

| Requirement ID | Plan(s) | Description | Status | Evidence |
|---------------|---------|-------------|--------|---------|
| OUTBOUND-01 | 32-03, 32-04 | Order → AI draft trigger pipeline | ✓ SATISFIED | createOrder publishes event → agent generates draft |
| OUTBOUND-02 | 32-04, 32-05, 32-07 | Manager draft approval UI | ✓ SATISFIED | DraftEmailApprovalPanel + approve/discard endpoints + Orders.tsx wiring |
| OUTBOUND-03 | 32-03 | Email type taxonomy (4 types) | ✓ SATISFIED | `_select_email_type()` — PRICE_INQUIRY, DEMAND_OFFER, PROMO_INQUIRY, WINE_INQUIRY |
| OUTBOUND-04 | 32-06 | Progressive summarization | ✓ SATISFIED | `_maybe_summarize()` every 2 rounds with rolling_summary + negotiation_facts |
| OUTBOUND-05 | 32-01, 32-03 | Rate limits + Redis caps | ✓ SATISFIED | Redis counters + settings constants |
| OUTBOUND-06 | 32-03 | Constraint system (20 constraints) | ✓ SATISFIED | ConstraintEngine + pre/post draft checks |
| OUTBOUND-07 | 32-02 | ConstraintEngine + FuzzyMatcher services | ✓ SATISFIED | Both modules with tests |
| OUTBOUND-08 | 32-03, 32-04 | Auto-send 3-gate | ✓ SATISFIED | `_check_auto_send_gate()` — feature flag + health ≥ 0.80 + auto_reply_enabled |
| PROVINT-01 | 32-01 | Provider intelligence JSONB schema | ✓ SATISFIED | `profile_foundational` + `profile_dynamic` in migration |
| PROVINT-02 | 32-04, 32-05 | Intelligence CRUD endpoints + form | ✓ SATISFIED | GET/PATCH intelligence + ProviderProfileForm |
| PROVINT-03 | 32-06 | Dynamic profile auto-extraction | ✓ SATISFIED | `_extract_dynamic_profile()` Haiku + JSONB merge |
| PROVINT-04 | 32-06 | Unknown sender detection | ✓ SATISFIED | `_detect_unknown_sender()` + `_notify_unknown_sender()` in EmailIntelAgent |
| PROVINT-05 | 32-07 | Intelligence badge pills on provider card | ✓ SATISFIED | IntelBadge + getTopIntelDimensions in Providers.tsx |
| TOKENBDGT-01 | 32-03 | 8k input token hard cap | ✓ SATISFIED | `estimated_tokens > draft_input_token_hard_cap` gate |
| TOKENBDGT-02 | 32-03 | 6k flat context window | ✓ SATISFIED | `_build_context_window()` budget architecture (uncertain: no runtime guard) |
| TOKENBDGT-03 | 32-03, 32-06 | SpendLogger for every Haiku call | ✓ SATISFIED | 4 call sites across 2 files |
| TOKENBDGT-04 | 32-06 | Progressive summarization after 2 rounds | ✓ SATISFIED | `_maybe_summarize()` with round_count % 2 gate |

**⚠ NOTE:** REQUIREMENTS.md does not contain OUTBOUND-*, PROVINT-*, or TOKENBDGT-* IDs. These are phase-internal requirement IDs defined only in PLAN.md frontmatter — traceability to the global requirements document is missing.

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `agents/email_intel_agent.py` line 597 | `"is_read": False` notification insert | ⚠ WARNING | Inconsistent with `provider_communication_agent._notify()` which uses `"status": "unread"`. One will fail silently at runtime depending on actual notifications table schema. Requires DB schema confirmation. |
| Plan 32-03 must-have vs impl | draft_lock uses `{order_id}` not `{conversation_id}` | ℹ INFO | Acceptable deviation — `conversation_id` doesn't exist at lock acquisition time. `{order_id}` achieves the same deduplication goal. |
| Phase 32 requirements | OUTBOUND-*, PROVINT-*, TOKENBDGT-* missing from REQUIREMENTS.md | ⚠ WARNING | Traceability gap — phase requirements not registered in global requirements document. No blocking impact to functionality. |

---

### Human Verification Required

#### 1. All Phase 32 Test Suites Pass

**Test:** `cd services/agent-orchestrator && python -m pytest tests/test_constraint_engine.py tests/test_fuzzy_matcher.py tests/test_provider_communication_agent.py tests/test_intelligence_pipeline.py -v 2>&1 | tail -20`

**Expected:** 50+ tests PASSED, 0 failures, exit code 0

**Why human:** Cannot execute pytest without a running Python environment with all dependencies (anthropic, rapidfuzz, etc.) installed.

---

#### 2. Supabase Migration Confirmed Pushed

**Test:** Via Supabase MCP or CLI:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'providers'
  AND column_name IN ('profile_foundational', 'profile_dynamic')
ORDER BY column_name;
-- Expected: 2 rows

SELECT column_name FROM information_schema.columns
WHERE table_name = 'procurement_conversations'
  AND column_name IN ('restaurant_id', 'outbound_email_type', 'round_count',
                      'constraint_flags', 'disclaimer_appended', 'rolling_summary')
ORDER BY column_name;
-- Expected: 6 rows
```

**Expected:** Both queries return the expected row counts.

**Why human:** Cannot query live Supabase DB from this context. Migration file exists but push confirmation requires MCP/CLI access.

---

#### 3. Notification Field Name — `status` vs `is_read`

**Test:** Via Supabase MCP:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'notifications' AND table_schema = 'public'
ORDER BY ordinal_position;
```

**Expected:** Confirms whether the column is `status VARCHAR` or `is_read BOOLEAN` (or both). Then fix the inconsistency:
- `provider_communication_agent._notify()` uses `"status": "unread"`
- `email_intel_agent._notify_unknown_sender()` uses `"is_read": False`

One of these will silently fail at runtime if only one column exists.

**Why human:** Requires DB introspection; impacts silent notification failure.

---

#### 4. End-to-End Draft Flow

**Test:**
1. In the web app, create a new procurement order with a provider assigned
2. Observe that a "Draft ready" notification appears in the notification center
3. Verify that clicking the notification or navigating to Orders page opens DraftEmailApprovalPanel
4. Verify the panel shows the AI-generated email content, constraint warnings (if any), and the WineOps AI disclaimer
5. Click "Send Draft" → verify status changes to APPROVED

**Expected:** Full cycle completes without errors; email draft appears in panel within ~10s.

**Why human:** Requires running app (agent-orchestrator + NestJS + React) with RabbitMQ and Supabase realtime subscription active.

---

#### 5. DraftEmailApprovalPanel Visual Render

**Test:** Navigate to Orders page → trigger a draft_ready notification → observe the panel:
- Header background is **indigo-900** (distinct from order approval's black)
- "✦ AI DRAFT READY" title visible
- Send Draft button is green, Discard button is red
- Edit Draft toggle switches to inline textarea
- Amber block appears if any constraint warnings are present
- WineOps disclaimer section has "Auto-appended disclaimer (required)" label

**Why human:** Cannot render React components programmatically in this environment.

---

### Gaps Summary

No functional gaps were found in automated verification. All 44 must-have truths are VERIFIED or have UNCERTAIN status for architectural claims.

**One structural warning** requires human resolution before proceeding to any phase that adds new notification-inserting agents: the `"status" vs "is_read"` inconsistency between `provider_communication_agent` and `email_intel_agent` must be resolved against the actual notifications table schema.

---

_Verified: 2026-05-14T16:00:00Z_
_Verifier: Claude (gsd-verifier)_
