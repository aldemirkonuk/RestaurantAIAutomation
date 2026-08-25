# Functionality Registry

**Purpose:** Canonical answer to “how tested is X?” — every surface maps to exactly one of 11 functionality groups.  
**Requirements:** TFND-01 (this file) · TFND-02 ([RUBRIC.md](./RUBRIC.md)) · TFND-03/04 (future [EXISTING-TEST-INVENTORY.md](./EXISTING-TEST-INVENTORY.md), [TESTING-SCORECARD.md](./TESTING-SCORECARD.md))  
**Operator catalog:** [.planning/UX_PATHS_CATALOG.md](../UX_PATHS_CATALOG.md) — status tags for manual pathway watchlist (Phase 43 fodder)  
**Locked groups:** CONTEXT D-09 / ROADMAP Testing Campaign seed — do not rename

How tested is X? → find the surface in Tables A–D → read its **Primary group** → open [RUBRIC.md](./RUBRIC.md) for T0–T4 maturity · scorecard for current score.

---

## 11 group definitions

Machine slugs (locked for inventory / checklists / scorecard):  
`1-identity | 2-catalog | 3-inventory | 4-pos | 5-procurement | 6-comms | 7-calendar | 8-analytics | 9-notifications | 10-ai | 11-platform`

| # | Slug | Group | Seed scope (D-09 / ROADMAP — verbatim) |
|---|------|-------|----------------------------------------|
| 1 | `1-identity` | Identity & Access | auth, registration, verification, invites, memberships/roles, orgs/chains/locations, profile, settings |
| 2 | `2-catalog` | Catalog & Extraction | wine library, submissions, menu import (scan/CSV/manual), extraction pipeline, enrichment, ontology, studio |
| 3 | `3-inventory` | Inventory Operations | stock, ledger, storage locations, counts/corrections, ghost inventory, shrinkage |
| 4 | `4-pos` | POS & Sales Ingestion | pos-hub adapters, webhooks, checks, wine detection, sale→stock pipeline |
| 5 | `5-procurement` | Procurement & Vendors | providers, vendor catalogue, order lifecycle, RFQ, recurring orders, invoice matching |
| 6 | `6-comms` | Communications & Email Intelligence | Gmail, triage, promos, provider conversations, drafts, digests, prospects |
| 7 | `7-calendar` | Calendar & Scheduling | events, recurrence, iCal, reminders, event-driven procurement signals |
| 8 | `8-analytics` | Analytics, Reports & Insights | dashboard KPIs, reports, insight catalog, analytic answers, exports |
| 9 | `9-notifications` | Notifications & Alerts | notification agent, SMS/email/push, websocket, one-tap actions, rate limits |
| 10 | `10-ai` | AI Assistants & Recommendations | sommelier, recommendations, Ask AI palette |
| 11 | `11-platform` | Platform & Agent Infrastructure | BaseAgent guarantees, sagas, DLQ, idempotency, health, observability, admin |

---

## Mapping rules

Collision rules (D-10 — primary-only; copy from RESEARCH Pattern 1 / PATTERNS):

1. Prefer user-facing workflow group for pages/routes.
2. Prefer write-domain group for Nest modules / DB tables.
3. Prefer group 11 for shared infra (`common/`, `database/`, idempotency, outbox, saga, DLQ, health, admin).
4. Prefer group 1 for auth/guards/org/team/profile/settings.
5. Mobile → map for completeness, mark **campaign-deferred**.
6. Cross-cuts: one primary + `also_touches:` note — never two primaries (D-10).

### `__tests__` attribution (not a 12th group)

| `__tests__` file | Owning module | Primary group |
|------------------|---------------|---------------|
| `calendar.service.spec.ts` | calendar | 7 |
| `dashboard.service.spec.ts` | dashboard | 8 |
| `events.controller.spec.ts` / `events.service.spec.ts` | events | 7 |
| `inventory-ledger.service.spec.ts` | inventory-ledger | 3 |
| `one-tap-actions.service.spec.ts` | one-tap-actions | 9 |

---

## Table A — Nest modules (`apps/api-gateway/src/`)

One row per top-level **directory** (H2 completeness). Specs = in-module `*.spec.ts` count; `__tests__` attribution noted separately. Inventory owns final truth for `passes?`.

| Module | Specs (count or unknown) | Primary group | also_touches |
|--------|--------------------------|---------------|--------------|
| `auth` | 1 | 1 Identity & Access | — |
| `organizations` | 0 | 1 Identity & Access | — |
| `restaurants` | 0 | 1 Identity & Access | — |
| `team` | 0 | 1 Identity & Access | — |
| `settings` | 0 | 1 Identity & Access | — |
| `user-preferences` | 0 | 1 Identity & Access | — |
| `restaurant-templates` | 0 | 1 Identity & Access | — |
| `wines` | 0 | 2 Catalog & Extraction | — |
| `menus` | 0 | 2 Catalog & Extraction | — |
| `inventory` | 1 | 3 Inventory Operations | — |
| `inventory-ledger` | 0 (+1 in `__tests__`) | 3 Inventory Operations | — |
| `storage-locations` | 0 | 3 Inventory Operations | — |
| `pos-hub` | 1 | 4 POS & Sales Ingestion | — |
| `toast` | 0 | 4 POS & Sales Ingestion | — |
| `procurement` | 9 (incl. documents/*) | 5 Procurement & Vendors | — |
| `providers` | 1 | 5 Procurement & Vendors | — |
| `vendor-catalogue` | 0 | 5 Procurement & Vendors | — |
| `contacts` | 0 | 5 Procurement & Vendors | also_touches: 6 |
| `communications` | 5 | 6 Communications & Email Intelligence | — |
| `conversations` | 0 | 6 Communications & Email Intelligence | — |
| `calendar` | 1 (+1 in `__tests__`) | 7 Calendar & Scheduling | — |
| `events` | 0 (+2 in `__tests__`) | 7 Calendar & Scheduling | — |
| `dashboard` | 1 (+1 in `__tests__`) | 8 Analytics, Reports & Insights | — |
| `reports` | 0 | 8 Analytics, Reports & Insights | — |
| `analytics` | 8 | 8 Analytics, Reports & Insights | — |
| `notifications` | 2 | 9 Notifications & Alerts | — |
| `one-tap-actions` | 0 (+1 in `__tests__`) | 9 Notifications & Alerts | — |
| `push` | 0 | 9 Notifications & Alerts | — |
| `websocket` | 0 | 9 Notifications & Alerts | also_touches: 11 |
| `mobile` | 0 | 9 Notifications & Alerts | campaign-deferred (D-02) |
| `ux-optimizer` | 0 | 10 AI Assistants & Recommendations | — |
| `common` | 5 | 11 Platform & Agent Infrastructure | — |
| `database` | 0 | 11 Platform & Agent Infrastructure | — |
| `__tests__` | 6 | Map each file to owning group; see inventory | — |

**Nest dir count:** 34 directories (including `__tests__`) — Table A data rows = 34.

---

## Table B — Web routes (`apps/web/src/App.tsx`)

Every `path=` from `App.tsx` Routes. Primary group is exactly one id/name per row.

| Route | Page / element | Primary group | also_touches | manual_pass |
|-------|----------------|---------------|--------------|-------------|
| `/login` | Login | 1 Identity & Access | — | yes |
| `/register` | Register | 1 Identity & Access | — | yes |
| `/verify-email` | VerifyEmail | 1 Identity & Access | — | yes |
| `/invite/:code` | InviteLanding | 1 Identity & Access | — | yes |
| `/no-access` | NoAccess | 1 Identity & Access | — | yes |
| `/get-started` | GetStarted | 1 Identity & Access | also_touches: 2 (menu import) | yes |
| `/onboarding` | Onboarding | 1 Identity & Access | — | yes |
| `/profile` | Profile | 1 Identity & Access | — | yes |
| `/settings` | Settings | 1 Identity & Access | — | yes |
| `/services` | Navigate → `/settings?tab=services` | 1 Identity & Access | — | yes |
| `/team` | TeamCommandPage | 1 Identity & Access | — | yes |
| `/help` | Help | 1 Identity & Access | — | yes |
| `/wines` | WineLibrary | 2 Catalog & Extraction | — | yes |
| `/studio` | Studio | 2 Catalog & Extraction | — | yes |
| `/studio/queue` | Studio queue | 2 Catalog & Extraction | — | yes |
| `/studio/certify` | Studio certify | 2 Catalog & Extraction | — | yes |
| `/inventory` | InventoryCommandPage | 3 Inventory Operations | — | yes (canonical) |
| `/inventory-legacy` | Inventory | 3 Inventory Operations | — | legacy |
| `/receiving/:orderId/door` | DoorReceipt | 5 Procurement & Vendors | also_touches: 3 | yes |
| `/receiving` | ReceivingHome | 5 Procurement & Vendors | also_touches: 3 | yes |
| `/orders` | Orders | 5 Procurement & Vendors | — | yes |
| `/providers` | Providers | 5 Procurement & Vendors | — | yes |
| `/promotions` | Promotions | 6 Communications & Email Intelligence | also_touches: 5 | yes |
| `/communications` | Communications | 6 Communications & Email Intelligence | — | yes |
| `/calendar` | CalendarModular | 7 Calendar & Scheduling | — | yes (canonical) |
| `/calendar-classic` | Calendar | 7 Calendar & Scheduling | — | legacy |
| `/` | Dashboard | 8 Analytics, Reports & Insights | — | yes |
| `/reports` | Reports | 8 Analytics, Reports & Insights | — | yes |
| `/documents-reports` | DocumentsPage | 8 Analytics, Reports & Insights | — | yes |
| `/recommendations/catalog` | InsightCatalog | 8 Analytics, Reports & Insights | — | yes |
| `/notifications` | Notifications | 9 Notifications & Alerts | — | yes |
| `/recommendations` | Recommendations | 10 AI Assistants & Recommendations | — | yes |
| `/sommelier` | SommelierAI | 10 AI Assistants & Recommendations | — | yes |
| `/wine-agent` | PlaceholderPage | 10 AI Assistants & Recommendations | — | yes |
| `/wineagent` | PlaceholderPage | 10 AI Assistants & Recommendations | — | yes |
| `/admin` | AdminPanel | 11 Platform & Agent Infrastructure | — | yes |
| `/admin/health` | AdminHealth | 11 Platform & Agent Infrastructure | — | yes |
| `/dev-sandbox` | DevSandbox | 11 Platform & Agent Infrastructure | — | yes |
| `*` | Navigate → `/` | 11 Platform & Agent Infrastructure | — | n/a (catch-all) |

### Orphan UI (not routed)

| Surface | Location | Primary group | manual_pass | Notes |
|---------|----------|---------------|-------------|-------|
| `RecurringOrders` | `RecurringOrders.tsx` (+ Vitest) | 5 Procurement & Vendors | orphan | **Not** a Phase 43 tick until routed |

### Canonical vs legacy/orphan for manual pass

- Prefer `/inventory` (command) over `/inventory-legacy` (`legacy`)
- Prefer `/calendar` (modular) over `/calendar-classic` (`legacy`)
- `RecurringOrders` = `orphan` — **not** a Phase 43 tick until routed

### Reserved future surface (Phase 38)

| Path | Page | Primary group | also_touches | Status |
|------|------|---------------|--------------|--------|
| `/sim` | (not in App.tsx yet) | 4 POS & Sales Ingestion | also_touches: 11 | planned — Phase 38 |

**Choice:** `/sim` (prefer) over `/admin/sim` — shorter operator URL for the sim control panel; primary group **4** (panel fires orders / POS simulation); `also_touches: 11` for ops/chaos controls. Do not invent UI here.

---

## Table C — Orchestrator agents (`services/agent-orchestrator/agents/`)

Row count must cover every `agents/*.py` file (including package `__init__.py`).

| Agent file | Primary group | also_touches |
|------------|---------------|--------------|
| `__init__.py` | 11 Platform & Agent Infrastructure | package init — not a scored agent surface |
| `menu_analyzer_agent.py` | 2 Catalog & Extraction | — |
| `visual_verification_agent.py` | 2 Catalog & Extraction | — |
| `inventory_engine.py` | 3 Inventory Operations | — |
| `ghost_inventory_agent.py` | 3 Inventory Operations | — |
| `shrinkage_detective_agent.py` | 3 Inventory Operations | — |
| `buffer_manager.py` | 3 Inventory Operations | — |
| `inequality_detector.py` | 3 Inventory Operations | — |
| `state_invariant_enforcer.py` | 3 Inventory Operations | — |
| `pos_integration_agent.py` | 4 POS & Sales Ingestion | — |
| `drift_agent.py` | 4 POS & Sales Ingestion | also_touches: 3 |
| `procurement_agent.py` | 5 Procurement & Vendors | — |
| `rfq_agent.py` | 5 Procurement & Vendors | — |
| `recurring_order_agent.py` | 5 Procurement & Vendors | — |
| `negotiation_playbook_agent.py` | 5 Procurement & Vendors | — |
| `auto_pilot_agent.py` | 5 Procurement & Vendors | — |
| `provider_communication_agent.py` | 5 Procurement & Vendors | — |
| `email_intel_agent.py` | 6 Communications & Email Intelligence | — |
| `email_parsing_agent.py` | 6 Communications & Email Intelligence | — |
| `provider_conversation_agent.py` | 6 Communications & Email Intelligence | — |
| `calendar_agent.py` | 7 Calendar & Scheduling | — |
| `reporting_agent.py` | 8 Analytics, Reports & Insights | — |
| `notification_agent.py` | 9 Notifications & Alerts | — |
| `sommelier_agent.py` | 10 AI Assistants & Recommendations | — |
| `compliance_agent.py` | 11 Platform & Agent Infrastructure | also_touches: 5 |

**Agent `.py` files on disk:** 25 (24 agents + `__init__.py`). Table C rows: 25.

`book_scraper_agent.py` and `dataset_creator_agent.py` were removed: neither was in
the orchestrator's class map, and the exchanges they subscribed to
(`enrichment.events`, `scan.events`, `training.events`) had no publishers anywhere in
the repo. Both capabilities remain live through `api/scan_routes.py` — `POST
/book-scrape` and the `/training-data/*` endpoints — which is where their surfaces are
scored (Table B), not here. `drift_agent.py` was missing from this table and is now
covered.

---

## Table D — DB domains (migration-derived)

**Source of truth:** `supabase/migrations/` (~152 unique `CREATE TABLE` names).  
**Anti-pattern:** Do **not** drive domain mapping from `packages/database/src/types/database.types.ts` (~8 public tables — incomplete generated types).

| DB domain | Example tables | Primary group |
|-----------|----------------|---------------|
| Identity / tenancy | `users`, `user_roles`, `user_restaurant_access`, `organizations`, `invite_*`, … | 1 Identity & Access |
| Catalog / wine / studio | `master_wine_library`, `menu_items`, `field_review_queue`, … | 2 Catalog & Extraction |
| Inventory | `restaurant_inventory`, `inventory_*`, `storage_locations`, `shrinkage_alerts` | 3 Inventory Operations |
| POS / sales | `sales_events`, `pos_webhook_logs`, `toast_item_mappings`, … | 4 POS & Sales Ingestion |
| Procurement / vendors | `providers`, `procurement_*`, `vendor_catalogue`, `rfq_requests`, `invoice_scans`, … | 5 Procurement & Vendors |
| Communications | `order_interactions`, `email_prospects`, `restaurant_inbound_addresses`, … | 6 Communications & Email Intelligence |
| Calendar | `calendar_*`, `events`, `custom_reminders` | 7 Calendar & Scheduling |
| Analytics / reports | `generated_reports`, `analytics_cache`, `budgets`, … | 8 Analytics, Reports & Insights |
| Notifications | `notifications`, `push_subscriptions`, `one_tap_actions`, … | 9 Notifications & Alerts |
| AI assistants | `sommelier_conversations`, recommendation tables | 10 AI Assistants & Recommendations |
| Platform | `idempotency_keys`, `outbox`, `saga_state`, `dead_letter_queue`, `decision_log`, … | 11 Platform & Agent Infrastructure |

---

## Contested surfaces

Suite ownership for Phases 39/40 = **registry primary group**. Do not dual-own or leave unowned. Inventory checklists may cross-link secondary groups only.

| Surface | Primary | also_touches | Suite owner (Phase 39/40) | Rationale |
|---------|---------|--------------|---------------------------|-----------|
| `/receiving/:orderId/door` | **5** Procurement & Vendors | 3 Inventory Operations | **primary (5)** | Receiving is order/vendor write workflow; stock updates are secondary |
| `contacts` Nest module | **5** Procurement & Vendors | 6 Communications | **primary (5)** | Vendor/contact write domain; email uses contacts as secondary |
| `compliance_agent` | **11** Platform & Agent Infrastructure | 5 Procurement | **primary (11)** | Cross-cutting compliance infra; procurement is secondary touch |

**Rule:** Phase 39/40 suite owner = registry primary group — do not dual-own or leave unowned.

---

## Manual pathway watchlist

Flag for Gaps / Phase 43 checklists — **not** product fixes. Cite [.planning/UX_PATHS_CATALOG.md](../UX_PATHS_CATALOG.md):

- **Auth:** Forgot password → non-existent route; Remember me unbound (`Login.tsx` / catalog §20)
- **Scanner:** GetStarted scan/CSV/manual live; Wine Library menu-scanner persistence still mocked (catalog §E)
- **Admin:** `/admin` settings localStorage-only; `/admin/health` live poll (catalog §18)
- **Dashboard:** dead Reorder / empty Top Wines / stub calendar quick action (catalog §3)
- **Shell:** decorative ⌘K historically noted — verify against shipped command palette before checklist writing

---

## Shared packages note (M4 light)

`packages/*` → primary **11 Platform & Agent Infrastructure** (or owning consumer group when a package is domain-specific) + `also_touches` as needed.  
**Today:** 0 package-level unit tests under `packages/*` — inventory will record this gap; do not invent coverage here.

---

## Coverage assertion

- [x] Every Nest top-level directory under `apps/api-gateway/src/` appears in Table A with exactly one primary group
- [x] Nest dir count == Table A data rows (34, excl. header)
- [x] Every `App.tsx` `path=` appears in Table B routed rows (39 `path=` entries including catch-all `*`)
- [x] Table B routed rows exclude reserved Phase 38 `/sim` and orphan `RecurringOrders` from the App.tsx equality count (those are documented adjacently)
- [x] Every `agents/*.py` file (25) has exactly one primary in Table C
- [x] Every DB domain bucket (11) has exactly one primary in Table D
- [x] No row assigns two primary groups (primary column is a single group id/name; secondaries use `also_touches` only)
- [x] Cross-link to [RUBRIC.md](./RUBRIC.md) for “how tested is X?” maturity scoring
