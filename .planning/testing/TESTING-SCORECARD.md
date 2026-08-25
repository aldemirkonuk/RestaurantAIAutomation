# Testing Scorecard (Baseline)

**Requirement:** TFND-04 · Decision D-17  
**Baseline date:** 2026-07-27  
**Purpose:** Living campaign scoreboard — holistic T-maturity per functionality group. Founders glance here first; agents deepen via inventory + registry.

**Legend:** [RUBRIC.md](./RUBRIC.md) (T0–T4 definitions + promote-past-T1 guard)  
**Evidence source:** [EXISTING-TEST-INVENTORY.md](./EXISTING-TEST-INVENTORY.md)  
**Group ownership:** [FUNCTIONALITY-REGISTRY.md](./FUNCTIONALITY-REGISTRY.md)  
**Operator UX traps:** [.planning/UX_PATHS_CATALOG.md](../UX_PATHS_CATALOG.md)

---

## Scoring rule

Score the **group** holistically across Nest / web / agent / DB surfaces that share that primary — never average tiers blindly, and never claim **T4** in this Phase 36 baseline (oracle / golden datasets are Phase 37+ / 42). **Agent Level ≠ automatic T-level** ([RUBRIC.md](./RUBRIC.md) mirror is explanatory only).

### T1 assignment protocol (C3)

- **T0** if inventory shows **zero** automated tests for the group.
- Clean **T1** only if ≥1 inventory path has `runs?=yes` **and** `passes?` ≠ `stale-suspect` **and** either: (a) loadable smoke documented this phase (`--listTests` / `pytest --collect-only` or equivalent in Evidence), **or** (b) `passes?=yes` with artifact.
- If `runs?=yes` but `passes?=unknown` (and not stale-suspect) without loadable-smoke proof → Score **`T1?`** (provisional) and Gaps **MUST** include exact phrase `CI green unverified`.
- **Exclude `passes?=stale-suspect` rows from T1-eligible evidence** (M1) — still listed in inventory, never cited as T1 proof.
- Do **not** assign T2+ unless inventory clearly documents contract/resilience suites with assertions — Phase 36 expectation is mostly T0 / T1 / T1?.
- **Forbidden:** any group Score cell equal to `T4`.
- **Promote past T1 only when `passes?=yes` or Gaps records an explicit waiver** (mirrors RUBRIC). Later phases must not promote while `passes?` remains unknown.

---

## Scorecard

| # | Group | Score | Evidence | Gaps | Next phase |
|---|-------|-------|----------|------|------------|
| 1 | Identity & Access | T1? | `auth-profile.spec.ts`; `Profile.test.tsx`; `Header.userMenu.test.tsx` (slug `1-identity`) | CI green unverified. Auth: dead forgot-password route + unbound remember-me on `/login` (UX catalog §20). | Phase 39 |
| 2 | Catalog & Extraction | T1? | `StudioIngestionBar.test.tsx`; `studio-flow.spec.ts`; `test_studio_e2e.py` (slug `2-catalog`) | CI green unverified. Wine Library scanner persistence mocked; GetStarted import triad is the real scanner journey (catalog §E). | Phase 39 |
| 3 | Inventory Operations | T1? | `inventory.service.spec.ts`; `inventory-ledger.service.spec.ts`; `test_inventory_engine_hardening.py` (slug `3-inventory`) | CI green unverified. `/inventory-legacy` retired 2026-08-26; `/inventory` (InventoryCommandPage) is the only inventory route, so the Phase 43 happy path has no fork to choose. | Phase 39 |
| 4 | POS & Sales Ingestion | T1? | `pos-adapters.spec.ts`; `test_pos_abstraction.py`; `wave_d_toast_pipeline.py` (slug `4-pos`) | CI green unverified. No Nest toast module specs; Wave D secrets/capability unverified. | Phase 39 |
| 5 | Procurement & Vendors | T1? | `procurement.service.spec.ts`; `ReceivingWorkspace.test.tsx`; `test_recurring_order_agent.py` (slug `5-procurement`) | CI green unverified. RecurringOrders Vitest exists but page unrouted (orphan). Receiving owned by 5 — inventory checklist cross-links only. | Phase 40 |
| 6 | Communications & Email Intelligence | T1? | `email-e2e.spec.ts`; `ConversationFilterBar.test.tsx`; `test_email_intel_agent.py` (slug `6-comms`) | CI green unverified. Wave E gmail pipeline capability-unverified without secrets. | Phase 40 |
| 7 | Calendar & Scheduling | T1? | `calendar.controller.spec.ts`; `calendar.service.spec.ts`; `wave_g_calendar.py` (slug `7-calendar`) | CI green unverified. `/calendar` is the only calendar (`/calendar-classic` retired 2026-08-26). | Phase 40 |
| 8 | Analytics, Reports & Insights | T1? | `dashboard.controller.spec.ts`; `insight-catalog.spec.ts`; `KPICard.test.tsx` (slug `8-analytics`) | CI green unverified. Dashboard: dead Reorder / empty Top Wines / stub calendar CTA (catalog §3). | Phase 41 |
| 9 | Notifications & Alerts | T1? | `notifications.controller.spec.ts`; `OneTapActionCenter.test.tsx`; `test_notification_agent_hardening.py` (slug `9-notifications`) | CI green unverified. Push/websocket Nest modules have 0 specs. | Phase 40 |
| 10 | AI Assistants & Recommendations | T0 | none | No automated tests for `10-ai` (ux-optimizer / sommelier / recommendations). | Phase 42 |
| 11 | Platform & Agent Infrastructure | T1? | `test_base_agent_infra.py`; `test_saga_outbox.py`; `smoke.spec.ts` (slug `11-platform`) — **not** `test_golden_path_e2e 2.py` (stale-suspect) | CI green unverified. Admin Panel `/admin` localStorage vs `/admin/health` live poll — Phase 43 verify honesty, not persistence. | Phase 43 |

### Consistency (inventory ↔ registry H1)

Sample of **10 Nest modules** — inventory `group` slug matches [FUNCTIONALITY-REGISTRY.md](./FUNCTIONALITY-REGISTRY.md) Table A primary (2026-07-27):

| Nest module | Registry primary | Inventory group (when specs exist) | Status |
|-------------|------------------|-------------------------------------|--------|
| `auth` | 1 Identity & Access | `1-identity` (`auth-profile.spec.ts`) | match |
| `wines` | 2 Catalog & Extraction | *(0 specs — no inventory row)* | match (absent) |
| `inventory` | 3 Inventory Operations | `3-inventory` | match |
| `pos-hub` | 4 POS & Sales Ingestion | `4-pos` | match |
| `procurement` | 5 Procurement & Vendors | `5-procurement` | match |
| `contacts` | 5 Procurement & Vendors | *(0 specs)* | match (absent) |
| `communications` | 6 Communications & Email Intelligence | `6-comms` | match |
| `calendar` | 7 Calendar & Scheduling | `7-calendar` | match |
| `analytics` | 8 Analytics, Reports & Insights | `8-analytics` | match |
| `common` | 11 Platform & Agent Infrastructure | `11-platform` | match |

No divergent inventory group cells found; no slug rewrite required this plan.

---

## CI / cloud E2E honesty (C1 + H5)

- **Do not treat TFND-05 as green CI.** Push CI on `main` fails Black formatting on `services/agent-orchestrator/api/studio_routes.py` as of **2026-07-27** (failing run id `30299009969` — Lint Python / Run Black). Until lint is green, downstream `test-python` / `test-typescript` results are not a trustworthy green signal.
- **Nightly `e2e-prod.yml`:** **secrets present? no as of 2026-07-27** (run `30240577056` env dump — empty `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD`, `RABBITMQ_URL`, `E2E_BASE_URL`, etc.; names only, never values). No durable `test-results/` wave XML observed → TFND-05 status = **schedule-present / capability-unverified** until one wave XML lands.
- This scorecard **does not claim** green push CI or healthy nightly E2E.
