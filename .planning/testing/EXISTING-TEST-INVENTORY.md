# Existing Test Inventory

**Requirement:** TFND-03 · Decision D-05 (keep tests as-is — catalog only)  
**Baseline date:** 2026-07-27  
**Related:** [FUNCTIONALITY-REGISTRY.md](./FUNCTIONALITY-REGISTRY.md) · [TESTING-SCORECARD.md](./TESTING-SCORECARD.md) · [RUBRIC.md](./RUBRIC.md) · [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) · [`.github/workflows/e2e-prod.yml`](../../.github/workflows/e2e-prod.yml)

---

## Methodology

- **Humans:** start with [TESTING-SCORECARD.md](./TESTING-SCORECARD.md) — this inventory is completeness evidence for agents/CI, not the founder homepage.
- **`runs?=yes`** only if a named CI job invokes that runner on push ([`ci.yml`](../../.github/workflows/ci.yml): `test-typescript`, `test-python`, `test-e2e`) or schedule ([`e2e-prod.yml`](../../.github/workflows/e2e-prod.yml): `e2e-prod`).
- **`passes?` default `unknown`** unless this phase has a green local run artifact. **Never claim CI green** from file presence alone.
- **Do not treat TFND-05 as green CI (H5).** As of 2026-07-27, push CI fails Black on `services/agent-orchestrator/api/studio_routes.py` (recent failing run `30299009969`). Lint gates `test-python` / `test-typescript` — test jobs are not trustworthy until lint is green.
- **Layer inference:** path + `pytest.ini` markers (`unit`, `integration`, `e2e`, `prod_e2e`). Nest/Vitest default `unit` unless path/name clearly integration (`*.e2e.spec.ts`, reports integration folders). `wave_*.py` → `prod_e2e` + `ci_job=e2e-prod`. Local Playwright → `e2e` + `test-e2e`. `prod-smoke.spec.ts` notes Wave F / `e2e-prod`.
- **`test-e2e` (local Playwright on push) ≠ `e2e-prod` (nightly/cloud waves).** Do not conflate them.
- **T1-eligible evidence excludes `passes?=stale-suspect`** (C3/M1). Rows remain inventoried; scorecard must not count them toward T1.
- **Group column** uses locked N-shortname slugs only, matching [FUNCTIONALITY-REGISTRY.md](./FUNCTIONALITY-REGISTRY.md) primaries (H1).

---

## Summary counts

| Runner | Files |
|--------|------:|
| jest | 41 |
| vitest | 30 |
| playwright | 4 |
| pytest | 67 |
| **Total** | **142** |

| Group slug | Rows | T1-eligible (`runs?=yes` ∧ not stale-suspect) |
|------------|-----:|----------------------------------------------:|
| `1-identity` | 4 | 4 |
| `2-catalog` | 31 | 31 |
| `3-inventory` | 6 | 6 |
| `4-pos` | 6 | 6 |
| `5-procurement` | 16 | 16 |
| `6-comms` | 13 | 13 |
| `7-calendar` | 5 | 5 |
| `8-analytics` | 25 | 25 |
| `9-notifications` | 6 | 6 |
| `10-ai` | 0 | 0 |
| `11-platform` | 30 | 29 |

- **stale-suspect rows:** 1 (excluded from T1-eligible)  
- **T1-eligible row total:** 141  
- **Corpus floors (2026-07-27 find):** api-gateway `*.spec.ts`=41 · web `src` Vitest=30 · `e2e/*.spec.ts`=4 · orch `test_*.py`+`wave_*.py`=67

---

## Full inventory table

| group | path | runner | layer | ci_job | runs? | passes? | notes |
|-------|------|--------|-------|--------|-------|---------|-------|
| 7-calendar | apps/api-gateway/src/__tests__/calendar.service.spec.ts | jest | unit | test-typescript | yes | unknown | from __tests__ attribution |
| 8-analytics | apps/api-gateway/src/__tests__/dashboard.service.spec.ts | jest | unit | test-typescript | yes | unknown | from __tests__ attribution |
| 7-calendar | apps/api-gateway/src/__tests__/events.controller.spec.ts | jest | unit | test-typescript | yes | unknown | from __tests__ attribution |
| 7-calendar | apps/api-gateway/src/__tests__/events.service.spec.ts | jest | unit | test-typescript | yes | unknown | from __tests__ attribution |
| 3-inventory | apps/api-gateway/src/__tests__/inventory-ledger.service.spec.ts | jest | unit | test-typescript | yes | unknown | from __tests__ attribution |
| 9-notifications | apps/api-gateway/src/__tests__/one-tap-actions.service.spec.ts | jest | unit | test-typescript | yes | unknown | from __tests__ attribution |
| 8-analytics | apps/api-gateway/src/analytics/engine/association-comparisons.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 8-analytics | apps/api-gateway/src/analytics/engine/finance.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 8-analytics | apps/api-gateway/src/analytics/engine/forecasting.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 8-analytics | apps/api-gateway/src/analytics/engine/inventory-science.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 8-analytics | apps/api-gateway/src/analytics/engine/regression.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 8-analytics | apps/api-gateway/src/analytics/engine/risk.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 8-analytics | apps/api-gateway/src/analytics/engine/statistics.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 8-analytics | apps/api-gateway/src/analytics/insights/insight-catalog.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 1-identity | apps/api-gateway/src/auth/auth-profile.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 7-calendar | apps/api-gateway/src/calendar/calendar.controller.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 11-platform | apps/api-gateway/src/common/orchestrator/commercial-terms.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 11-platform | apps/api-gateway/src/common/orchestrator/email-triage.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 11-platform | apps/api-gateway/src/common/orchestrator/inbound-responder.service.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 11-platform | apps/api-gateway/src/common/orchestrator/priority.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 11-platform | apps/api-gateway/src/common/orchestrator/promo-extract.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 6-comms | apps/api-gateway/src/communications/tests/email-convo-flow.e2e.spec.ts | jest | integration | test-typescript | yes | unknown | Nest *.e2e.spec.ts under communications/tests |
| 6-comms | apps/api-gateway/src/communications/tests/email-e2e.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 6-comms | apps/api-gateway/src/communications/tests/notification-flow.e2e.spec.ts | jest | integration | test-typescript | yes | unknown | Nest *.e2e.spec.ts under communications/tests |
| 6-comms | apps/api-gateway/src/communications/tests/procurement-email.e2e.spec.ts | jest | integration | test-typescript | yes | unknown | Nest *.e2e.spec.ts under communications/tests |
| 6-comms | apps/api-gateway/src/communications/tests/register-verification-email.e2e.spec.ts | jest | integration | test-typescript | yes | unknown | Nest *.e2e.spec.ts under communications/tests |
| 8-analytics | apps/api-gateway/src/dashboard/dashboard.controller.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 3-inventory | apps/api-gateway/src/inventory/inventory.service.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 9-notifications | apps/api-gateway/src/notifications/low-stock-alerts.service.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 9-notifications | apps/api-gateway/src/notifications/notifications.controller.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 4-pos | apps/api-gateway/src/pos-hub/pos-adapters.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 5-procurement | apps/api-gateway/src/procurement/documents/credit-ledger.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 5-procurement | apps/api-gateway/src/procurement/documents/document-extractor.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 5-procurement | apps/api-gateway/src/procurement/documents/document-types.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 5-procurement | apps/api-gateway/src/procurement/documents/line-matcher.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 5-procurement | apps/api-gateway/src/procurement/documents/x12/x12.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 5-procurement | apps/api-gateway/src/procurement/invoice-match.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 5-procurement | apps/api-gateway/src/procurement/procurement.service.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 5-procurement | apps/api-gateway/src/procurement/receiving.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 5-procurement | apps/api-gateway/src/procurement/tests/conversation-summary.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 5-procurement | apps/api-gateway/src/providers/providers.controller.spec.ts | jest | unit | test-typescript | yes | unknown |  |
| 11-platform | apps/web/src/__tests__/components/ErrorBoundary.test.tsx | vitest | unit | test-typescript | yes | unknown | shared UI/platform |
| 3-inventory | apps/web/src/__tests__/inventory/deleteInventoryItem.test.ts | vitest | unit | test-typescript | yes | unknown |  |
| 3-inventory | apps/web/src/__tests__/inventory/handleRemoveFromInventory.test.ts | vitest | unit | test-typescript | yes | unknown |  |
| 5-procurement | apps/web/src/__tests__/pages/RecurringOrders.deps.test.tsx | vitest | unit | test-typescript | yes | unknown | orphan UI RecurringOrders — not routed (registry) |
| 6-comms | apps/web/src/components/communications/ConversationFilterBar.test.tsx | vitest | unit | test-typescript | yes | unknown |  |
| 8-analytics | apps/web/src/components/layout/Header.test.tsx | vitest | unit | test-typescript | yes | unknown |  |
| 8-analytics | apps/web/src/components/layout/Header.userMenu.test.tsx | vitest | unit | test-typescript | yes | unknown |  |
| 9-notifications | apps/web/src/components/notifications/OneTapActionCenter.test.tsx | vitest | unit | test-typescript | yes | unknown |  |
| 6-comms | apps/web/src/components/orders/__tests__/CommsThreadDrawer.test.tsx | vitest | unit | test-typescript | yes | unknown |  |
| 6-comms | apps/web/src/components/orders/__tests__/DraftEmailApprovalPanel.test.tsx | vitest | unit | test-typescript | yes | unknown |  |
| 8-analytics | apps/web/src/components/reports/__tests__/atoms/MetricDisplay.test.tsx | vitest | unit | test-typescript | yes | unknown |  |
| 8-analytics | apps/web/src/components/reports/__tests__/atoms/TrendIndicator.test.tsx | vitest | unit | test-typescript | yes | unknown |  |
| 8-analytics | apps/web/src/components/reports/__tests__/atoms/WineTypeBar.test.tsx | vitest | unit | test-typescript | yes | unknown |  |
| 8-analytics | apps/web/src/components/reports/__tests__/integration/LayoutDiffer.test.tsx | vitest | integration | test-typescript | yes | unknown |  |
| 8-analytics | apps/web/src/components/reports/__tests__/integration/LayoutPersistence.test.tsx | vitest | integration | test-typescript | yes | unknown |  |
| 8-analytics | apps/web/src/components/reports/__tests__/molecules/KPICard.test.tsx | vitest | unit | test-typescript | yes | unknown |  |
| 8-analytics | apps/web/src/components/reports/__tests__/preview/PreviewOverlay.test.tsx | vitest | unit | test-typescript | yes | unknown |  |
| 2-catalog | apps/web/src/components/studio/StudioFieldCell.test.tsx | vitest | unit | test-typescript | yes | unknown |  |
| 2-catalog | apps/web/src/components/studio/StudioIngestionBar.test.tsx | vitest | unit | test-typescript | yes | unknown |  |
| 11-platform | apps/web/src/components/ui/empty-state.test.tsx | vitest | unit | test-typescript | yes | unknown | shared UI/platform |
| 11-platform | apps/web/src/components/ui/loading-skeleton.test.tsx | vitest | unit | test-typescript | yes | unknown | shared UI/platform |
| 11-platform | apps/web/src/contexts/ThemeContext.test.tsx | vitest | unit | test-typescript | yes | unknown | shared UI/platform |
| 6-comms | apps/web/src/hooks/queries/useDraftEmailQueries.test.ts | vitest | unit | test-typescript | yes | unknown |  |
| 6-comms | apps/web/src/lib/conversationFilters.test.ts | vitest | unit | test-typescript | yes | unknown |  |
| 6-comms | apps/web/src/lib/conversationGrouping.test.ts | vitest | unit | test-typescript | yes | unknown |  |
| 5-procurement | apps/web/src/lib/invoiceMatch.test.ts | vitest | unit | test-typescript | yes | unknown |  |
| 1-identity | apps/web/src/lib/phone.test.ts | vitest | unit | test-typescript | yes | unknown |  |
| 1-identity | apps/web/src/lib/userProfileSchema.test.ts | vitest | unit | test-typescript | yes | unknown |  |
| 1-identity | apps/web/src/pages/Profile.test.tsx | vitest | unit | test-typescript | yes | unknown |  |
| 5-procurement | apps/web/src/pages/inventory/command/ReceivingWorkspace.test.tsx | vitest | unit | test-typescript | yes | unknown | receiving workspace; registry primary 5 |
| 11-platform | apps/web/e2e/navigation.spec.ts | playwright | e2e | test-e2e | yes | unknown | local Playwright smoke |
| 11-platform | apps/web/e2e/prod-smoke.spec.ts | playwright | prod_e2e | e2e-prod | yes | unknown | Wave F / also invoked via e2e-prod schedule; secrets often empty |
| 11-platform | apps/web/e2e/smoke.spec.ts | playwright | e2e | test-e2e | yes | unknown | local Playwright smoke |
| 2-catalog | apps/web/e2e/studio-flow.spec.ts | playwright | e2e | test-e2e | yes | unknown | local Playwright; test-e2e ≠ e2e-prod |
| 11-platform | services/agent-orchestrator/tests/e2e/test_api_endpoints.py | pytest | e2e | test-python | yes | unknown | orchestrator e2e suite under tests/e2e/ |
| 11-platform | services/agent-orchestrator/tests/e2e/test_error_resilience.py | pytest | e2e | test-python | yes | unknown | orchestrator e2e suite under tests/e2e/ |
| 2-catalog | services/agent-orchestrator/tests/e2e/test_extraction_pipeline.py | pytest | e2e | test-python | yes | unknown | pytest mark e2e path; local test-python (not e2e-prod) |
| 11-platform | services/agent-orchestrator/tests/e2e/test_health.py | pytest | e2e | test-python | yes | unknown | orchestrator e2e suite under tests/e2e/ |
| 2-catalog | services/agent-orchestrator/tests/e2e/test_promotion_path.py | pytest | e2e | test-python | yes | unknown | pytest mark e2e path; local test-python (not e2e-prod) |
| 2-catalog | services/agent-orchestrator/tests/e2e/test_studio_pipeline.py | pytest | e2e | test-python | yes | unknown | pytest mark e2e path; local test-python (not e2e-prod) |
| 11-platform | services/agent-orchestrator/tests/e2e/wave_a_api_contracts.py | pytest | prod_e2e | e2e-prod | yes | unknown | wave_*.py → prod_e2e + e2e-prod |
| 11-platform | services/agent-orchestrator/tests/e2e/wave_b_agent_health.py | pytest | prod_e2e | e2e-prod | yes | unknown | wave_*.py → prod_e2e + e2e-prod |
| 11-platform | services/agent-orchestrator/tests/e2e/wave_c_agent_triggers.py | pytest | prod_e2e | e2e-prod | yes | unknown | wave_*.py → prod_e2e + e2e-prod |
| 4-pos | services/agent-orchestrator/tests/e2e/wave_d_toast_pipeline.py | pytest | prod_e2e | e2e-prod | yes | unknown | Toast pipeline wave |
| 6-comms | services/agent-orchestrator/tests/e2e/wave_e_gmail_pipeline.py | pytest | prod_e2e | e2e-prod | yes | unknown | Gmail pipeline wave |
| 7-calendar | services/agent-orchestrator/tests/e2e/wave_g_calendar.py | pytest | prod_e2e | e2e-prod | yes | unknown | calendar wave |
| 8-analytics | services/agent-orchestrator/tests/test_analytics_routes.py | pytest | unit | test-python | yes | unknown |  |
| 2-catalog | services/agent-orchestrator/tests/test_auction_wine_service.py | pytest | unit | test-python | yes | unknown |  |
| 11-platform | services/agent-orchestrator/tests/test_base_agent_infra.py | pytest | unit | test-python | yes | unknown |  |
| 11-platform | services/agent-orchestrator/tests/test_chaos_e2e.py | pytest | e2e | test-python | yes | unknown |  |
| 2-catalog | services/agent-orchestrator/tests/test_claude_vision_extractor.py | pytest | unit | test-python | yes | unknown |  |
| 11-platform | services/agent-orchestrator/tests/test_constraint_engine.py | pytest | unit | test-python | yes | unknown |  |
| 11-platform | services/agent-orchestrator/tests/test_cors.py | pytest | unit | test-python | yes | unknown |  |
| 11-platform | services/agent-orchestrator/tests/test_cost_guardrails.py | pytest | unit | test-python | yes | unknown |  |
| 2-catalog | services/agent-orchestrator/tests/test_critic_score_service.py | pytest | unit | test-python | yes | unknown |  |
| 2-catalog | services/agent-orchestrator/tests/test_dataset_ingestion.py | pytest | unit | test-python | yes | unknown |  |
| 2-catalog | services/agent-orchestrator/tests/test_dataset_ingestion_service.py | pytest | unit | test-python | yes | unknown |  |
| 6-comms | services/agent-orchestrator/tests/test_email_intel_agent.py | pytest | unit | test-python | yes | unknown |  |
| 2-catalog | services/agent-orchestrator/tests/test_field_confidence.py | pytest | unit | test-python | yes | unknown |  |
| 2-catalog | services/agent-orchestrator/tests/test_fuzzy_matcher.py | pytest | unit | test-python | yes | unknown |  |
| 2-catalog | services/agent-orchestrator/tests/test_gemini_flash_crawler.py | pytest | unit | test-python | yes | unknown |  |
| 11-platform | services/agent-orchestrator/tests/test_golden_path_e2e 2.py | pytest | unknown | test-python | yes | stale-suspect | duplicate filename with space — not T1-eligible |
| 11-platform | services/agent-orchestrator/tests/test_golden_path_e2e.py | pytest | e2e | test-python | yes | unknown |  |
| 2-catalog | services/agent-orchestrator/tests/test_haiku_enrichment_service.py | pytest | unit | test-python | yes | unknown |  |
| 2-catalog | services/agent-orchestrator/tests/test_haiku_tasks.py | pytest | unit | test-python | yes | unknown |  |
| 11-platform | services/agent-orchestrator/tests/test_health_routes.py | pytest | unit | test-python | yes | unknown |  |
| 2-catalog | services/agent-orchestrator/tests/test_image_menu.py | pytest | unit | test-python | yes | unknown |  |
| 2-catalog | services/agent-orchestrator/tests/test_intelligence_pipeline.py | pytest | unit | test-python | yes | unknown |  |
| 3-inventory | services/agent-orchestrator/tests/test_inventory_engine_bugs.py | pytest | unit | test-python | yes | unknown | hardening/bugs suite |
| 3-inventory | services/agent-orchestrator/tests/test_inventory_engine_hardening.py | pytest | unit | test-python | yes | unknown | hardening/bugs suite |
| 5-procurement | services/agent-orchestrator/tests/test_invoice_ocr_service.py | pytest | unit | test-python | yes | unknown |  |
| 2-catalog | services/agent-orchestrator/tests/test_menu_diff_service.py | pytest | unit | test-python | yes | unknown |  |
| 9-notifications | services/agent-orchestrator/tests/test_notification_agent_bugs.py | pytest | unit | test-python | yes | unknown | hardening/bugs suite |
| 9-notifications | services/agent-orchestrator/tests/test_notification_agent_hardening.py | pytest | unit | test-python | yes | unknown | hardening/bugs suite |
| 2-catalog | services/agent-orchestrator/tests/test_onboarding_extract_endpoint.py | pytest | unit | test-python | yes | unknown |  |
| 2-catalog | services/agent-orchestrator/tests/test_ontology_tasks.py | pytest | unit | test-python | yes | unknown |  |
| 2-catalog | services/agent-orchestrator/tests/test_ontology_validation.py | pytest | unit | test-python | yes | unknown |  |
| 11-platform | services/agent-orchestrator/tests/test_override_service.py | pytest | unit | test-python | yes | unknown |  |
| 4-pos | services/agent-orchestrator/tests/test_pos_abstraction.py | pytest | unit | test-python | yes | unknown |  |
| 4-pos | services/agent-orchestrator/tests/test_pos_integration_bugs.py | pytest | unit | test-python | yes | unknown | hardening/bugs suite |
| 4-pos | services/agent-orchestrator/tests/test_pos_integration_hardening.py | pytest | unit | test-python | yes | unknown | hardening/bugs suite |
| 2-catalog | services/agent-orchestrator/tests/test_producer_normalizer.py | pytest | unit | test-python | yes | unknown |  |
| 5-procurement | services/agent-orchestrator/tests/test_provider_communication_agent.py | pytest | unit | test-python | yes | unknown |  |
| 2-catalog | services/agent-orchestrator/tests/test_quality_routes.py | pytest | unit | test-python | yes | unknown |  |
| 2-catalog | services/agent-orchestrator/tests/test_recrawl_tasks.py | pytest | unit | test-python | yes | unknown |  |
| 5-procurement | services/agent-orchestrator/tests/test_recurring_order_agent.py | pytest | unit | test-python | yes | unknown |  |
| 8-analytics | services/agent-orchestrator/tests/test_reporting_agent_bugs.py | pytest | unit | test-python | yes | unknown | hardening/bugs suite |
| 8-analytics | services/agent-orchestrator/tests/test_reporting_agent_hardening.py | pytest | unit | test-python | yes | unknown | hardening/bugs suite |
| 2-catalog | services/agent-orchestrator/tests/test_research_agent_e2e.py | pytest | e2e | test-python | yes | unknown |  |
| 2-catalog | services/agent-orchestrator/tests/test_research_agent_helpers.py | pytest | unit | test-python | yes | unknown |  |
| 11-platform | services/agent-orchestrator/tests/test_saga_outbox.py | pytest | unit | test-python | yes | unknown |  |
| 8-analytics | services/agent-orchestrator/tests/test_score_tasks.py | pytest | unit | test-python | yes | unknown |  |
| 11-platform | services/agent-orchestrator/tests/test_sentry_init.py | pytest | unit | test-python | yes | unknown |  |
| 11-platform | services/agent-orchestrator/tests/test_spend_logger.py | pytest | unit | test-python | yes | unknown |  |
| 2-catalog | services/agent-orchestrator/tests/test_studio_e2e.py | pytest | e2e | test-python | yes | unknown |  |
| 2-catalog | services/agent-orchestrator/tests/test_studio_routes.py | pytest | unit | test-python | yes | unknown |  |
| 8-analytics | services/agent-orchestrator/tests/test_temporal_analytics.py | pytest | unit | test-python | yes | unknown |  |
| 4-pos | services/agent-orchestrator/tests/test_toast_api_client.py | pytest | unit | test-python | yes | unknown |  |
| 8-analytics | services/agent-orchestrator/tests/test_trend_tasks.py | pytest | unit | test-python | yes | unknown |  |
| 2-catalog | services/agent-orchestrator/tests/test_web_verification.py | pytest | unit | test-python | yes | unknown |  |
| 2-catalog | services/agent-orchestrator/tests/test_yolo_preview.py | pytest | unit | test-python | yes | unknown |  |

---

## Known anomalies

- **Duplicate filename** `services/agent-orchestrator/tests/test_golden_path_e2e 2.py` → `passes?=stale-suspect` (not T1-eligible). Canonical sibling: `test_golden_path_e2e.py`.
- **Unrouted Vitest:** `apps/web/src/__tests__/pages/RecurringOrders.deps.test.tsx` → group `5-procurement` (orphan UI; registry Manual pathway — not a Phase 43 tick until routed).
- **Nest modules with 0 specs** (from registry Table A / RESEARCH — not inventory rows): `organizations`, `restaurants`, `team`, `settings`, `user-preferences`, `restaurant-templates`, `wines`, `menus`, `storage-locations`, `toast`, `vendor-catalogue`, `contacts`, `conversations`, `reports`, `push`, `websocket`, `mobile`, `ux-optimizer`, `database`, plus module dirs whose only coverage is via `__tests__` attribution (`inventory-ledger`, `events`, `one-tap-actions`).
- **`packages/*` tests:** 0 found.
- **Mobile tests:** stub / campaign-deferred (registry `mobile` → group 9, D-02).
- **CI honesty:** Black debt on `studio_routes.py` blocks green push CI; TFND-05 annotations ≠ proof of green CI. Nightly `e2e-prod` often runs with empty secrets (`SUPABASE_URL`, `E2E_TEST_*`, etc.) — capability-unverified until wave XML lands.

