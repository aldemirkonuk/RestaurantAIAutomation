# Phase 32: Provider Outbound Communication Engine — Validation Strategy

**Phase:** 32
**Slug:** 32-provider-outbound-communication-engine
**Date:** 2026-05-14

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest 7.x + pytest-asyncio |
| Config file | `services/agent-orchestrator/pytest.ini` (or `pyproject.toml`) |
| Quick run | `pytest tests/test_constraint_engine.py tests/test_provider_communication_agent.py tests/test_fuzzy_matcher.py -x -v` |
| Full suite | `pytest tests/ -v --tb=short` |
| TypeScript check | `cd apps/api-gateway && npx tsc --noEmit` |
| Frontend check | `cd apps/web && npx tsc --noEmit` |

---

## Dimension 1 — Functional Correctness

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command |
|--------|----------|-----------|-------------------|
| OUTBOUND-01 | Order created with provider_id → draft inserted to procurement_conversations with status=PENDING_APPROVAL | integration | `pytest tests/test_provider_communication_agent.py::test_order_created_generates_draft -x` |
| OUTBOUND-02 | Approve → status=APPROVED; Discard → status=DISCARDED | integration | `pytest tests/test_provider_communication_agent.py::test_draft_approve_discard -x` |
| OUTBOUND-03 | PRICE_INQUIRY when target_price_per_bottle IS NULL | unit | `pytest tests/test_provider_communication_agent.py::test_email_type_selection -x` |
| OUTBOUND-04 | Context window ≤ 6000 tokens after slot allocation | unit | `pytest tests/test_provider_communication_agent.py::test_context_window_budget -x` |
| OUTBOUND-05 | 51st draft in a day → Redis cap → freeze notification | integration | `pytest tests/test_provider_communication_agent.py::test_daily_rate_limit -x` |
| OUTBOUND-06 | After HARD_ROUND_CAP rounds → escalation notification | integration | `pytest tests/test_provider_communication_agent.py::test_round_cap_escalation -x` |
| OUTBOUND-07 | C-01 off-topic → draft blocked; WineOps disclaimer present in draft | unit | `pytest tests/test_constraint_engine.py::test_hard_constraints -x` |
| OUTBOUND-07 | C-03 quantity cap → manager ask before draft | unit | `pytest tests/test_constraint_engine.py::test_quantity_cap -x` |
| OUTBOUND-08 | Auto-send gate: health ≥ 0.80 + auto_reply_enabled + paid tier → auto-send without approval | integration | `pytest tests/test_provider_communication_agent.py::test_auto_send_gate -x` |
| PROVINT-01 | providers.profile_foundational + profile_dynamic columns exist in live DB | schema | `supabase db execute "SELECT column_name FROM information_schema.columns WHERE table_name='providers' AND column_name IN ('profile_foundational','profile_dynamic')"` |
| PROVINT-02 | Manager fills foundational profile → saved to providers.profile_foundational | e2e | PATCH /api/v1/providers/:id/intelligence → verify Supabase row |
| PROVINT-03 | Dynamic profile updated after conversation round | integration | `pytest tests/test_provider_communication_agent.py::test_dynamic_profile_extract -x` |
| PROVINT-04 | Unknown sender email → "add to providers?" notification fired | unit | `pytest tests/test_provider_communication_agent.py::test_unknown_sender_detection -x` |
| PROVINT-05 | IntelBadge pills render on provider card when profile_dynamic populated | visual | `grep -c "IntelBadge" apps/web/src/pages/Providers.tsx` → ≥ 2 |
| TOKENBDGT-01 | 8001-token input → hard rejected before Haiku API call | unit | `pytest tests/test_provider_communication_agent.py::test_token_hard_cap -x` |
| TOKENBDGT-02 | Token slot allocation: rolling_summary + last 3 messages + negotiation_facts ≤ 6000 tokens | unit | `pytest tests/test_provider_communication_agent.py::test_context_window_budget -x` |
| TOKENBDGT-03 | SpendLogger.log() called after every Haiku call | unit | `pytest tests/test_provider_communication_agent.py::test_spend_logger_called -x` |
| TOKENBDGT-04 | rolling_summary updated every 2 rounds via Haiku summarization | integration | `pytest tests/test_provider_communication_agent.py::test_rolling_summary -x` |

---

## Dimension 2 — Constraint System

| Constraint | Test |
|------------|------|
| C-01 TOPIC_LOCK | `pytest tests/test_constraint_engine.py::test_c01_topic_lock` |
| C-02 COMMITMENT_GUARD | `pytest tests/test_constraint_engine.py::test_c02_commitment_guard` |
| C-03 QUANTITY_CAP | `pytest tests/test_constraint_engine.py::test_c03_quantity_cap` |
| C-08 SENSITIVE_SKIP | `pytest tests/test_provider_communication_agent.py::test_pii_discrete_mode` |
| C-14 OUTSTANDING_INVOICE | `pytest tests/test_constraint_engine.py::test_c14_outstanding_invoice` |
| C-21 PII_PAYMENT_GUARD | `pytest tests/test_provider_communication_agent.py::test_pii_discrete_mode` |
| C-25 THREAD_ORPHAN_GUARD | `pytest tests/test_provider_communication_agent.py::test_thread_orphan_guard` |
| WineOps Disclaimer | `grep -c "WineOps AI" services/agent-orchestrator/agents/provider_communication_agent.py` → ≥ 1 |

---

## Dimension 3 — Schema Integrity

Run after `supabase db push`:

```bash
# Verify Phase 32 columns exist
supabase db execute "SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name IN ('providers', 'procurement_conversations')
  AND column_name IN ('profile_foundational','profile_dynamic','restaurant_id',
                      'outbound_email_type','round_count','constraint_flags',
                      'disclaimer_appended','rolling_summary')"
```

Expected: 8 rows returned.

---

## Dimension 4 — API Contract

```bash
# TS compilation — api-gateway
cd apps/api-gateway && npx tsc --noEmit 2>&1 | grep -c "error TS"
# Expected: 0

# TS compilation — frontend
cd apps/web && npx tsc --noEmit 2>&1 | grep -c "error TS"
# Expected: 0

# New endpoint files exist
ls apps/api-gateway/src/procurement/dto/approve-draft.dto.ts
ls apps/api-gateway/src/providers/dto/update-intelligence.dto.ts
ls apps/api-gateway/src/providers/provider-intelligence.service.ts
```

---

## Dimension 5 — Frontend Component Checks

```bash
grep -c "bg-indigo-900" apps/web/src/components/orders/DraftEmailApprovalPanel.tsx         # ≥ 2
grep -c "AI DRAFT READY" apps/web/src/components/orders/DraftEmailApprovalPanel.tsx         # 1
grep -c "role=\"dialog\"" apps/web/src/components/orders/DraftEmailApprovalPanel.tsx        # 1
grep -c "IntelBadge" apps/web/src/pages/Providers.tsx                                       # ≥ 2
grep -c "DraftEmailApprovalPanel" apps/web/src/pages/Orders.tsx                             # ≥ 2
grep -c "draft_ready" apps/web/src/pages/Orders.tsx                                         # ≥ 1
```

---

## Dimension 6 — Dependency Installation

```bash
# rapidfuzz installed
cd services/agent-orchestrator && python -c "import rapidfuzz; print(rapidfuzz.__version__)"
# Expected: version string (e.g. 3.x.x)

# fuzzy_matcher module importable
cd services/agent-orchestrator && python -c "from services.fuzzy_matcher import get_fuzzy_matcher; print('ok')"
```

---

## Dimension 7 — Integration Smoke Test (manual, no live email)

1. Create an order via API with `provider_id` set
2. Verify `procurement_conversations` row inserted with `status=PENDING_APPROVAL, direction=OUTBOUND`
3. Verify `notifications` row inserted with `type=draft_ready`
4. Call `POST /api/v1/procurement/orders/:id/approve-draft` → verify status changes to `APPROVED`
5. Call `POST /api/v1/procurement/orders/:id/discard-draft` → verify status changes to `DISCARDED`
6. PATCH `providers/:id/intelligence` with foundational profile → verify row updated in Supabase
7. Trigger off-app invoice flow: inbound email body with invoice → verify FuzzyMatcher scores against existing orders

---

## Wave 0 Gaps (test stubs to create)

- [ ] `tests/test_constraint_engine.py` — unit tests for all 20 constraints
- [ ] `tests/test_provider_communication_agent.py` — behavioral contract tests
- [ ] `tests/test_fuzzy_matcher.py` — Jaro-Winkler + Levenshtein correctness
- [ ] Schema verify command in CI

---

*Phase: 32-provider-outbound-communication-engine*
*Validation strategy created: 2026-05-14*
