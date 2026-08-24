---
type: division-teams
division: technology
status: proposed
date: 2026-08-24
departments: [engineering, ai-orchestration, skills, data, reliability-sre]
team_count: 25
links: ["[[ORG_STRUCTURE]]", "[[README]]", "[[ENDPOINTS]]", "[[EXTERNAL_CONNECTIONS]]", "[[PAGE_MAP]]"]
keywords: [teams, technology, engineering, ai-orchestration, skills, data, sre, nf-a, premortem]
---

# Technology — team layer

> **Status: PROPOSED.** Divisions and departments are LOCKED ([[ORG_STRUCTURE]] §2).
> The team layer below is not. Per CLAUDE.md §0.1 nothing here is decided until it is
> written in `.planning/decisions/`; every fork this document opens is listed in §7.

---

## 0. Method — the bar a team had to clear

Four tests. A candidate that failed any one was merged into a sibling or dropped:

1. **Distinct failure mode.** Two teams that fail the same way are one team.
2. **Distinct evidence.** There is code, a directory, a workflow, a migration, or a
   script that this team would own *today*. Purely aspirational teams are marked NEW
   and must carry an entry trigger.
3. **Cannot grade itself.** Where a producer and its judge were candidates, they were
   split — the same argument [[ORG_STRUCTURE]] §3 uses for the advisory layer.
4. **Not symmetry.** No department got a team because a sibling department had one.
   Skills (§4) and Reliability/SRE (§6) are each explicitly *under*-teamed as a result.

**Evidence status legend:** **EXISTS** — the work is running and has an artifact.
**PARTIAL** — an artifact exists but is a stub, a single script, or covers a fraction
of the mandate. **NEW** — no artifact; the team is a proposal.

**Two corrections surfaced while gathering evidence** (both cheap to fix, neither is
this document's job): `apps/web` is a **Vite SPA with `react-router-dom`**
(`apps/web/package.json:8,55,94`), not Next.js as CLAUDE.md §1 states; and 5 of the
26 agents in `services/agent-orchestrator/agents/` are declared stubs whose
`process_message()` only logs (`auto_pilot`, `compliance`, `ghost_inventory`,
`negotiation_playbook`, `shrinkage_detective`). Fleet size is **21 live, 5 stub** —
not 26 — and that distinction matters to §3.2's metric.

---

## 1. Summary

| Department | Teams | Under-teamed on purpose? |
|---|---|---|
| **Engineering** | 8 | No — 448 endpoints / 44 controllers / 51 routes / 62 migrations justify the count |
| **AI Orchestration** | 5 | No |
| **Skills** | 3 (one gated) | **Yes** — one real artifact exists today; see §4.0 |
| **Data** | 5 | No — L0 is the named blocker ([[README]] §1) |
| **Reliability/SRE** | 4 | **Yes** — a separate Incident Command team would be fiction at this scale; see §6.0 |
| **Total** | **25** | |

---

## 2. Engineering — 8 teams

**Department scope after siblings take their cut:** L1 domain core, L2 module
softwares, L6 surfaces, and the shared schema. L3 goes to AI Orchestration, L0 to
Data, and everything about *running* it to Reliability/SRE.

The eight teams below are eight **distinct ways the product can be wrong**: wrong
product identity, wrong stock number, wrong money, undelivered message, unusable
screen, broken third-party contract, unauthenticated request, drifted database. That
enumeration — not a grid — is where the count came from.

---

### 2.1 Catalogue & Identity `[[eng-catalogue-identity]]`

**Mandate.** Own what a beverage/dish *is*: match keys, duplicate detection, merge and
un-merge, producer normalization, and the guest identity slice.

**Distinct from siblings because** a false merge is *silent, global and unrecoverable*
— unlike every other Engineering failure, it cannot be rolled back by reverting a
deploy. No other team's errors have that shape.

**Evidence — EXISTS, and heavily.**
- `supabase/migrations/20260817070000_beverages_table.sql`, `…20260817060000_beverage_kind_classification.sql`, `…20260818030000_sensory_columns_generated.sql`
- Match-key and duplicate machinery: `…20260812000000_backfill_wine_match_keys.sql`, `…20260813000000_wine_match_word_similarity.sql`, `…20260813150000_find_library_duplicates.sql`, `…20260818010000_beverage_duplicates_near_key.sql`
- Merge safety: `…20260813030000_merge_library_wines.sql`, `…20260817120000_nondestructive_merge.sql`, `…20260818020000_merge_undo_honesty.sql`
- Guest identity: `supabase/migrations/20260819000000_guest_identity_minimal_slice.sql`; guard `scripts/check_no_guest_name_matching.sh`
- Runtime: `services/agent-orchestrator/services/wine_matcher.py`, `producer_normalization.py`, `ontology_normalization.py`
- Parity guards: `scripts/check_beverage_identity_parity.py`, `scripts/check_display_name_parity.py`
- Design corpus: `.planning/BEVERAGE_CATALOGUE_ARCHITECTURE.md`, `.planning/DISH_IDENTITY_DESIGN.md`

**Primary metric.** **False-merge count against the labelled identity set — target
zero, never traded against false splits.** The asymmetry is already written into
`scripts/eval_merge_policies.py:5-13`: "These two errors are not symmetric and must
never be summed into one score."

**Premortem.** Someone ships a fuzzy-threshold matcher because it improves an
aggregate score, the aggregate hides a handful of false merges, and by the time a
sommelier notices, months of NF-B guest signal is attributed to the wrong wine.

---

### 2.2 Inventory & Ledger `[[eng-inventory-ledger]]`

**Mandate.** Lots as the single source of truth for stock; every mutation flows
through `apply_stock_movement`, and `stock_live`/`shadow_stock` remain projections.

**Distinct from siblings because** its failure is a *number that is quietly wrong*
rather than an operation that errors. The dual-bookkeeping root cause is documented
and the fix is architectural, not a bug queue.

**Evidence — EXISTS.**
- `apps/api-gateway/src/inventory/` (18 endpoints), `apps/api-gateway/src/inventory-ledger/` (8), `apps/api-gateway/src/storage-locations/` (8)
- `apps/api-gateway/src/inventory-ledger/LEDGER_V1_DEPRECATED.md` — the deprecation is already written down
- CI guard `scripts/check_no_direct_stock_writes.sh:1-13`, wired into `.github/workflows/ci.yml`
- `supabase/migrations/20260805130000_extend_apply_stock_movement.sql`, `…20260805131000_stock_race_and_pour_idempotency.sql`
- `.planning/INVENTORY_SOTA_PLAN.md`, `.planning/INVENTORY_ADD_REMOVE_SCENARIOS.md`
- `services/agent-orchestrator/services/inventory_count_service.py`, `agents/inventory_engine.py`

**Primary metric.** **Projection divergence: rows where `stock_live` ≠ sum of lots,
sampled daily.** Target zero; any non-zero is a P1 because it is undetectable from the UI.

**Premortem.** The guard is a `grep`, by its own admission (`check_no_direct_stock_writes.sh:10`).
A future write path that constructs the table name dynamically — or lives in a Postgres
function rather than TypeScript — passes CI and desyncs silently, exactly as the
receiving-service bug did.

---

### 2.3 Procurement & Vendor Network `[[eng-procurement-vendor-network]]`

**Mandate.** Orders, RFQs, receiving, credits, recurring orders, vendor catalogues,
price observations, and the distributor graph.

**Distinct from siblings because** this is the only Engineering team whose defects
**move money to third parties**. It also owns the largest single endpoint cluster in
the gateway (~97 routes) and the only outward-facing portal.

**Evidence — EXISTS.**
- `procurement/procurement` (26), `procurement/documents` (6), `procurement/documents/credits` (3), `procurement/receiving` (3), `procurement/recurring-orders` (6 — **all unguarded**, [[ENDPOINTS]]:428)
- `providers/providers` (29), `providers/provider-intelligence` (17), `vendor-catalogue` (4), `vendor-intel` (4), `vendor-portal` (2), `distributor-discovery` (3)
- `supabase/migrations/20260805154027_vendor_price_observations.sql`, `…20260805155901_vendor_portal.sql`, `…20260811010000_vendor_catalogue_match.sql`, `…20260807001452_search_distributors_rpc.sql`
- `services/agent-orchestrator/agents/procurement_agent.py`, `rfq_agent.py`, `recurring_order_agent.py`

**Primary metric.** **Order-to-delivery reconciliation rate** — ordered lines that
resolve to a received lot at the agreed price, without human repair.

**Premortem.** The `recurring-orders` controller stays unguarded because it is "internal,"
`TenantGuard` passes unauthenticated requests through by design
(`apps/api-gateway/src/common/tenant/tenant.guard.ts:38-46`), and a scripted caller
places real orders against a real vendor.

---

### 2.4 Messaging & Delivery `[[eng-messaging-delivery]]`

**Mandate.** The transport half of every conversation: threading, inbound routing,
notification batching and deduplication, push, websocket, calendar invites, contacts.
It owns *whether a message arrives exactly once*; it does not own what the message says.

**Distinct from siblings because** its failure mode is duplication and silence — a
digest sent forty times, or a low-stock alert nobody received — which no functional
test catches. It is distinct from AI Orchestration's drafting: the AI writes, this
team delivers, and one team owning both means "we sent it" gets confused with "we
meant to send it."

**Evidence — EXISTS.**
- `notifications` (24 endpoints, **all unguarded**), `communications` (18, **all unguarded**), `conversations` (12), `contacts` (8, **all unguarded**), `calendar` (19), `events` (3), plus `push/` and `websocket/` modules
- `apps/api-gateway/src/common/orchestrator/rabbitmq-bridge.service.ts:35` — the TS↔Python message bridge, incl. `handleInboundEmail` at `:528`
- `apps/api-gateway/src/common/orchestrator/inbound-address.service.ts`, `email-triage.ts`, `priority.ts`, `sender-reputation.service.ts`
- `services/agent-orchestrator/agents/buffer_manager.py` — 30-minute LIFO anti-spam window
- `.planning/CONVERSATION_THREADING_PLAN.md`, `.planning/INBOUND_EMAIL_INTELLIGENCE_PLAN.md`

**Primary metric.** **Duplicate-delivery rate and drop rate per channel** (email, push,
in-app, websocket), measured against `notification_id` rather than user reports.

**Premortem.** Batching logic lives partly in an in-memory buffer
(`buffer_manager.py`) and partly in the persist funnel; a Railway restart during
service hours drops one and double-sends the other, and the founder finds out from
a restaurant, not a metric.

---

### 2.5 Client Surfaces `[[eng-client-surfaces]]`

**Mandate.** `apps/web` (Vite SPA, 51 routes), `apps/mobile` (Expo Router), and the
shared `packages/ui` component layer. Implementation quality, route reachability,
accessibility, bundle health.

**Distinct from siblings because** it owns the only artifacts a human looks at, and
its correctness criterion is *comprehension*, not data integrity. **Deliberately one
team, not two** — `apps/mobile/app/` is roughly eight route files; splitting web and
mobile now would create a mobile team with no load.

**Distinct from Design (Product division)** because Design decides what the screen
should be; this team owns whether the built screen matches, renders, and performs.

**Evidence — EXISTS.**
- `apps/web/src/pages/` — 40 page components + 11 sub-route directories; `.planning/foundation/PAGE_MAP.md` records the navigation graph
- `apps/mobile/app/` — `(tabs)`, `wine-agent.tsx`, `get-started.tsx`, `lock.tsx`, …
- `packages/ui/src/components/{charts,layout,notifications,primitives}`; `apps/web/src/stories/` (4 Storybook stories — thin)
- 34 web test files; `.planning/UX_PATHS_CATALOG.md` (154KB burn-down corpus)

**Primary metric.** **Reachable-route ratio** — routes with at least one inbound
in-app link. [[README]] §0 records **24 routes with no inbound link and 13 route
components untraceable**; that is the opening baseline.

**Premortem.** The 760-path UX catalogue becomes the team's whole identity, it burns
down paths on pages nobody reaches, and the 24 orphan routes are still orphaned a
year later because burning down a list feels like progress.

---

### 2.6 Platform & API `[[eng-platform-api]]`

**Mandate.** The request path itself: authn/authz, tenancy, idempotency, caching,
rate limiting, crypto, OpenAPI surface, and NestJS module wiring.

**Distinct from siblings because** it owns cross-cutting concerns *no domain team can
own* — the 137 unguarded endpoints are not any one domain's bug, they are the absence
of a platform-level default. Note the split with Security (Intelligence division):
Security **finds and classifies** the gap; this team **builds the mechanism** (a
global guard, a CI check) that makes the class impossible.

**Evidence — EXISTS.**
- `apps/api-gateway/src/common/{tenant,idempotency,rate-limit,cache,crypto,error-tracking}/`
- `apps/api-gateway/src/common/tenant/tenant.guard.ts:38-46` — returns `true` with no authenticated user, by design; the reason auth is per-controller opt-in
- `apps/api-gateway/src/auth/` (28 endpoints), `team/` (33), `organizations/` (8), `restaurants/members` (6), `settings/` (4), `user-preferences/` (2)
- `apps/api-gateway/src/openapi.ts`, `app.module.ts`; 64 `.spec.ts` files

**Primary metric.** **Endpoints protected by default** — share of the 448 routes whose
protection comes from a global mechanism rather than a remembered decorator. Today
that number is **0%**: all protection is opt-in.

**Premortem.** A global guard is added with a `@Public()` escape hatch, the webhook
modules legitimately need it, `@Public()` becomes the copy-paste default for anything
that 401s in local dev, and the team declares the problem solved while the count of
reachable-unauthenticated routes is unchanged.

---

### 2.7 Integration Engineering — the wire `[[eng-integration-wire]]`

**Mandate.** Every code path that speaks someone else's protocol: Toast, SimPOS,
POS Hub, vendor portal webhooks, Gmail/Calendar/Microsoft OAuth, Square and
Lightspeed groundwork, Apify/Yelp/Serper scrapers.

**Distinct from siblings because** it is the only Engineering team whose contract is
**owned by a third party and can change without notice**. It is also where the
legitimately-public routes live, so its correctness criterion is *signature
verification*, not `JwtAuthGuard`.

**Distinct from Partnerships & Integrations (Product division)**: Partnerships owns
the relationship and the decision to integrate; this team owns the wire and the
breakage.

**Evidence — EXISTS / PARTIAL.**
- EXISTS: `apps/api-gateway/src/toast/` (10 routes, unguarded), `simpos/` (11, unguarded), `pos-hub/` (10, unguarded), `vendor-portal/` (2, unguarded), `common/orchestrator/inbound-email.controller.ts` (1, unguarded) — **≈51 legitimately-public routes**
- EXISTS: `services/agent-orchestrator/adapters/toast_adapter.py`, `core/pos_provider.py`, `services/toast_api_client.py`, `services/serper_client.py`, `services/plivo_client.py`
- EXISTS: `apps/api-gateway/src/integrations/integrations-oauth` (5), `apps/api-gateway/src/calendar/`
- PARTIAL: Square/Lightspeed appear only as referenced hosts ([[EXTERNAL_CONNECTIONS]]:11) — groundwork, not an adapter
- ⚠️ `abc123.ngrok.io` and `your-domain.com` still appear in source paths ([[EXTERNAL_CONNECTIONS]]:13,21)

**Primary metric.** **Verified-signature coverage on public routes** — of the ~51
intentionally-public endpoints, the share that verify an HMAC. `POS_HUB_WEBHOOK_SECRET`
(8 refs) and `TOAST_WEBHOOK_SECRET` (2 refs) suggest partial coverage; the exact
number is unmeasured and measuring it is this team's first task.

**Premortem.** Toast ships a breaking webhook payload change on a Friday, the failure
surfaces as "inventory looks stale" rather than an error, and nobody notices for a
week because a webhook that stops arriving produces no signal at all.

---

### 2.8 Schema & Migrations `[[eng-schema-migrations]]`

**Mandate.** The DDL: 62 migrations, generated types in `packages/database`, RLS
policies, Postgres functions, and the rule that production shape comes only from the repo.

**Distinct from siblings because** a migration is the one artifact class that **cannot
be reverted by reverting a commit**. It also has the best-documented incident in the
whole repo, which is the strongest possible argument for a named owner.

**Evidence — EXISTS.**
- `supabase/migrations/` — 62 files; baseline `20260805000000_baseline_from_production.sql`
- `scripts/check_schema_parity.sh:6-11` records the incident verbatim: production carried **27 tables, 403 columns and 13 functions created by no migration**; `restaurant_inventory` alone had 37 such columns; `calculate_sales_velocity` and `resolve_sku_to_inventory` were business logic with no source in the repo
- `packages/database/src/types/database.types.ts` and siblings (generated)
- `scripts/concat_migrations.py`, `scripts/run_migration.sh`, `.planning/SCHEMA_DRIFT_INVENTORY.txt`

**Primary metric.** **Days since last hand-applied DDL reached production** — i.e. the
schema-parity job's green streak.

**Premortem.** A production incident is fixed with a live `ALTER` at 2am — correctly,
because the alternative was downtime — the parity job goes red, red becomes normal,
and the team is back to 2026-08-05 with a red badge instead of no badge.

> **Ownership seam.** This team *authors* DDL; `[[sre-state-integrity]]` (§6.4) *runs
> and owns the gate* (`.github/workflows/schema-parity.yml`). Author and auditor are
> deliberately not the same team (§0 test 3).

---

## 3. AI Orchestration — 5 teams

**Department scope.** L3 in [[README]] §1: `BaseAgent`, orchestration, routing,
task-doneability. In practice `services/agent-orchestrator/core/` (6,375 lines across
11 modules), 26 agent modules (21 live / 5 stub), and the 8 gateway files that call a
model directly.

---

### 3.1 Harness & Runtime `[[aio-harness-runtime]]`

**Mandate.** The substrate every agent runs on: `BaseAgent` lifecycle, the registry
and lazy-proxy tiers, message bus, connection pooling, saga/compensation, feature flags.

**Distinct from siblings because** it owns the **contract**, not any agent's behavior.
A harness bug degrades all 21 agents identically; an agent bug degrades one.

**Evidence — EXISTS, and it is the most mature L3 asset in the repo.**
- `services/agent-orchestrator/core/base_agent.py` (1,053 lines): lifecycle `start/stop/pause/resume/restart` (`:348-436`), `_process_with_retry` (`:543`), idempotency (`:704`), DLQ (`:791`), sagas (`:823-905`), event append (`:944`), health (`:985-1035`)
- `core/agent_registry.py`: `AgentTier` (`:27`), `LazyAgentProxy` (`:162`), `AgentRegistry` (`:299`), `get_startup_order` (`:401`)
- `core/orchestrator.py`: `_build_feature_flags` (`:101`), `pause_all_writes` (`:537`), `emergency_flush_buffer` (`:582`)
- `core/message_bus.py`: `CircuitBreaker` (`:188`), DLQ declaration (`:524`)
- `core/connection_pool.py`, `core/outbox_publisher.py`; 80 pytest files

**Primary metric.** **NF-A `retries` and DLQ depth per agent-hour** — the harness is
healthy when retries are rare and the dead-letter queue is empty. Both fields are
already in the NF-A schema ([[README]] §4.2).

**Premortem.** The harness choice fork (OD-03) stays open for another six months, so
this team keeps hardening a bespoke `BaseAgent` that a framework decision later throws
away — a year of work spent on the layer most likely to be replaced.

---

### 3.2 Agent Fleet `[[aio-agent-fleet]]`

**Mandate.** The agents themselves — behavior, prompts, subscriptions, per-agent
doneability. Owns whether `email_parsing_agent` actually parses email.

**Distinct from siblings because** it owns *behavior*, where Harness owns *mechanism*.
Concretely: Harness cares that a retry happened; Fleet cares that the retry was needed.

**Evidence — EXISTS (21) / PARTIAL (5).**
- Live: `email_intel_agent.py`, `email_parsing_agent.py`, `procurement_agent.py`, `provider_conversation_agent.py`, `rfq_agent.py`, `recurring_order_agent.py`, `menu_analyzer_agent.py`, `sommelier_agent.py`, `pos_integration_agent.py`, `inventory_engine.py`, `notification_agent.py`, `reporting_agent.py`, `calendar_agent.py`, `book_scraper_agent.py`, `dataset_creator_agent.py`, `visual_verification_agent.py`, `drift_agent.py`, `inequality_detector.py`, `state_invariant_enforcer.py`, `buffer_manager.py`, `provider_communication_agent.py`
- **Declared stubs** whose `process_message()` only logs: `auto_pilot_agent.py`, `compliance_agent.py`, `ghost_inventory_agent.py`, `negotiation_playbook_agent.py`, `shrinkage_detective_agent.py`

**Primary metric.** **NF-A `task_success_rate` per agent, with stub agents reported
separately and never averaged into the fleet figure.** A stub that logs and returns
would otherwise post a perfect success rate.

**Premortem.** The five stubs are counted as capability in a deck or a roadmap because
they are registered and "healthy"; a customer commitment is made against
`compliance_agent`, and the gap is discovered at demo time.

> **Co-ownership, stated deliberately.** `state_invariant_enforcer`, `drift_agent`,
> `inequality_detector` (+ the `ghost_inventory` / `shrinkage_detective` stubs) are
> *guardian* agents. Fleet owns their code; `[[sre-state-integrity]]` (§6.4) owns
> their findings and their alert thresholds.

---

### 3.3 Model Routing & Inference Economics `[[aio-model-routing]]`

**Mandate.** Which model runs which task at what cost: client construction, concurrency
limits, retry/timeout policy, token accounting, and the routing policy itself.

**Distinct from siblings because** cost and model choice are **cross-cutting** — no
individual agent can own the decision, and Harness owns delivery mechanics rather than
economics. This is also the team [[README]] §0 finding 5 names: Anthropic and Gemini
are called over **raw HTTP, not their SDKs**, so retry, timeout and cost accounting are
hand-rolled at 8+ independent call sites.

**Evidence — EXISTS, but fragmented, which is the point.**
- `services/agent-orchestrator/services/model_clients.py:52,73,93` — `get_gemini_client`, `get_haiku_client`, `get_haiku_semaphore`
- `services/agent-orchestrator/services/spend_logger.py:32,71` — single insertion point into `api_spend`; table defined at `supabase/migrations/20260805000000_baseline_from_production.sql:2231`
- `services/agent-orchestrator/jobs/spend_tasks.py`, `jobs/haiku_tasks.py`
- `scripts/benchmark_haiku_vs_sonnet.py` — an existing model-substitution study
- **Fragmentation evidence:** independent model call sites in `apps/api-gateway/src/{ux-optimizer,vendor-intel,common/orchestrator,procurement/documents,inventory,menus,analytics}/…` — 8 files, none routed through `model_clients.py`

**Primary metric.** **NF-A `cost_per_task` by task type**, plus the share of model calls
that pass through a single routed client. That share is currently well under 100% and
is the team's first measurable target.

**Premortem.** Routing is optimized on price alone, a cheaper model is silently
substituted for invoice extraction, quality degrades below the threshold nobody was
measuring, and the savings are wiped out by the repair work — the exact scenario
`benchmark_haiku_vs_sonnet.py` was written to prevent, run once and never again.

---

### 3.4 Agent Evaluation & Gates `[[aio-evaluation-gates]]`

**Mandate.** **Run and enforce** doneability: gold sets, regression benchmarks, CI eval
gates, confidence scoring, and the shadow-vs-live comparison discipline.

**Distinct from siblings because** an agent team that grades its own agents is exactly
the arrangement [[ORG_STRUCTURE]] §3 rejects for Red Team. It is distinct from
`[[aio-model-routing]]` because routing picks the cheapest model that *passes*; this
team defines what passing means in operation.

**Boundary — stated because it is the sharpest seam in the whole division.**
Research & Math (**Intelligence** division) owns the *methodology and the NF-A metric
definition* ([[README]] §2.2). This team owns *running the gates in CI and production*.
Methodology vs. operations. If that line proves unworkable, the fix is to merge this
team into Research & Math — not to duplicate it. **Fork OD-21 (§7).**

**Evidence — EXISTS, scattered across `scripts/` with no owner.**
- `scripts/eval_merge_policies.py`, `scripts/eval_guest_merge_policies.py`, `scripts/build_merge_eval_set.py` — with a CI gate already declared (`eval_merge_policies.py:9-13`)
- `scripts/benchmark_haiku_vs_sonnet.py`, `scripts/claude_vision_benchmark.py`, `datasets/scripts/eval_model.py`, `datasets/ocr_benchmark_results.json`, `datasets/OCR_CONFIDENCE_REPORT.md`
- `services/agent-orchestrator/services/active_learning_service.py:1-17` — "200 gold-standard documents for regression testing"
- `services/quality_scorer.py`, `services/field_confidence.py`, `services/ontology_validation_service.py`
- `.github/workflows/e2e-prod.yml:9` explicitly reserves a separate weekly AI eval workflow (D-25) — **NEW, not yet built**

**Primary metric.** **NF-A `doneability verdict` coverage** — share of agent tasks that
emit a machine-checkable verdict rather than a log line. Today: near zero outside the
merge-policy gate.

**Premortem.** Evals are built for the tasks that are easy to score (extraction against
a gold set) and never for the ones that matter commercially (was this vendor reply a
*good* reply), so the dashboard is green while the product's judgment is unmeasured.

---

### 3.5 Action Safety & the Human Gate `[[aio-action-safety]]`

**Mandate.** The boundary between propose and execute: the `ask → propose → confirm →
execute` action schema, the typed allowlist, per-action autonomy tiers, and the
guarantee that stock, money and outbound email are never mutated without a human tap.

**Distinct from siblings because** every sibling asks "did it work"; this team asks
"was it allowed to run at all". Folding it into Harness would put the same team in
charge of executing actions and of deciding whether execution is permitted.

**Evidence — EXISTS as a pattern, NEW as a single enforced schema.**
- EXISTS: `apps/api-gateway/src/one-tap-actions/` — 8 endpoints; `one-tap-actions.service.ts:230` `executeAction`, with `executed_at`/`executed_by` audit columns (`:245-246`) and an `action_executed` event (`:267`)
- EXISTS: tiered autonomy already implemented in `services/agent-orchestrator/agents/drift_agent.py:11-16` — safe findings auto-heal into proposals; **"Money / stock → `drift_findings` … never auto-applied"**
- EXISTS: `services/agent-orchestrator/services/governance.py:20` `GovernanceTier`, `:227` `compute_overall_confidence`
- EXISTS: vendor-reply AI drafts but never auto-sends (project memory: *autonomous-email-replies*)
- EXISTS: `apps/api-gateway/src/ux-optimizer/` — self-learning UX optimizer, human-gated, never auto-applies
- **NEW:** the *single* action schema behind all entry points ([[README]] §5.1, `.planning/FUTURES.md` §8.1). Today the guarantee is upheld by four independent conventions, not one mechanism.

**Primary metric.** **Unconfirmed-mutation count — target hard zero.** Any agent-initiated
write to stock, money, or an outbound channel without a recorded human confirmation is
a reportable incident, not a bug.

**Premortem.** "Human-gated" degrades into a confirmation dialog the founder clicks
through fifty times a day; approval becomes reflex; the gate is architecturally present
and behaviorally absent — and the audit trail says a human approved it.

---

## 4. Skills — 3 teams (one gated)

### 4.0 ⚠️ This is the department where fewer teams is correct

The repo contains **exactly one project skill**: `.agents/skills/railway-config/SKILL.md`.
Root `SKILLS.md` is a prose reasoning protocol, still branded "WineOps AI"
([[README]] §3.1, OD-14). There is no registry, no lifecycle job, no `.claude/skills/`
directory.

[[README]] §3.2 offers a four-tier taxonomy (T1 domain / T2 department / T3 operational
/ T4 meta). **Tiers are not teams.** Building four teams to mirror four tiers would be
the tidy grid this exercise is supposed to avoid, and §3.2 already assigns tier
*content* to the owning department — Engineering owns `wine-enrichment`, Data owns
`menu-extraction`. So Skills owns **the contract and the lifecycle, not the content**,
and that is a two-team job with a conditional third.

---

### 4.1 Skill Registry & Authoring `[[skl-registry-authoring]]`

**Mandate.** The `SKILL.md` contract, the §3.3 creation protocol (trigger · doneability ·
real past instance · owning department), description quality, and the registry index.

**Distinct from siblings because** it optimizes for *creation and discoverability*.
Discoverability is a real engineering problem here: a skill is only invoked if its
`description` says *when to use this*, so description quality is a measurable artifact,
not a style preference.

**Evidence — PARTIAL.** `.agents/skills/railway-config/SKILL.md` is the sole instance
and therefore the de-facto template. Root `SKILLS.md` exists and needs retiring or
rewriting (OD-14).

**Primary metric.** **Protocol compliance: share of committed skills citing a real past
instance where they would have helped** (§3.3 rule 3). This is the anti-speculation gate;
today the denominator is 1.

**Premortem.** The protocol is treated as paperwork, "a real past instance" becomes a
sentence written after the fact to satisfy the checklist, and the registry fills with
plausible-sounding skills that have never fired.

---

### 4.2 Skill Lifecycle & Anti-Sprawl `[[skl-lifecycle]]`

**Mandate.** The 30-day staleness review, deprecation, deletion, and the weekly
skill-health job ([[README]] §6).

**Distinct from siblings because** — and this is the entire justification — **authoring
optimizes for creation and lifecycle optimizes for deletion.** A team that owns both
never deletes anything. [[README]] §3.3 names sprawl as *the* failure mode of "create
skills constantly"; the counter-pressure has to be someone's job title.

**Evidence — NEW.** No staleness review, no firing telemetry, no scheduled job exists.
The rule is written ([[README]] §3.3) and unimplemented. The nearest working analogue is
`.github/workflows/schema-parity.yml` — a scheduled job that fails loudly on drift.

**Primary metric.** **Skills deleted or deprecated per quarter.** A quarter with zero
deletions and non-zero additions is a failing quarter, not a healthy one.

**Premortem.** Firing telemetry is never wired up, so "has this skill fired in 30 days"
is unanswerable, so nothing is ever deleted, so the anti-sprawl rule becomes a comment
in a README — the precise fate of most anti-sprawl rules.

---

### 4.3 Skill Harvesting `[[skl-harvesting]]` — **GATED / NEW**

**Mandate.** Mine work that already happened for procedures that *should be* skills —
the opposite direction from authoring-on-demand.

**Distinct from siblings because** harvesting starts from evidence and produces a
candidate; authoring starts from a request and produces an artifact. The distinction is
real but only pays off at volume.

**Evidence that the raw material exists — EXISTS.** `scripts/` holds ~60 de-facto
unowned procedures that behave like skills without being skills: four `check_*.sh` CI
guards, and three fully-built CLIs — `scripts/docgen/` (compose · degrade · truth ·
backtest · render), `scripts/synth/` (recipes · oracle · personas · snapshots ·
teardown), `scripts/simulate/` (bridge · payloads · detection · mappings). Each is a
codified procedure with a trigger and a success criterion — i.e. a skill missing its
`SKILL.md`.

**Entry trigger — do not staff before this fires.** *The registry holds ≥ 15 skills, or
§4.1's protocol-compliance metric has been green for two consecutive quarters.* Until
then, harvesting is a recurring task inside `[[skl-registry-authoring]]`. If the team
count must be cut, **cut this one first.**

**Primary metric.** **Harvested-skill firing rate** — harvested skills that fire within
30 days of registration. Harvesting from real past work should beat on-demand authoring
on this metric; if it does not, the team has no reason to exist.

**Premortem.** It is staffed early, "harvests" all 60 scripts into `SKILL.md` wrappers
in a single sprint, and hands `[[skl-lifecycle]]` 60 stale skills on day one — sprawl
delivered by the team meant to prevent it.

---

## 5. Data — 5 teams

**Department scope.** L0: corpora, sales metrics, synthetic generators, POS traffic —
**the named blocker** ([[README]] §1). Five teams is the highest justified count outside
Engineering, and it is justified by the fact that the four *sources* of L0 data carry
fundamentally different truth guarantees.

That is the organizing idea: **scraped/enriched** (probabilistic), **annotated**
(human-verified), **synthetic** (true by construction), **observed POS** (true but
unowned and unrepeatable). Confusing any two of them corrupts every downstream eval.

---

### 5.1 Corpora & Enrichment `[[dat-corpora-enrichment]]`

**Mandate.** Coverage and depth of the wine, beverage, food and producer corpora, and
the machine enrichment pipeline that fills them.

**Distinct from siblings because** it produces **probabilistic facts at scale** —
machine-generated, confidence-scored, never an oracle.

**Evidence — EXISTS, and actively running.**
- `scripts/enrich_wines.py`, `scripts/enrich_wines_insession.py`, `scripts/load_enriched_wines.py`, `scripts/build_wine_only_enrichment_input.py`
- `services/agent-orchestrator/services/haiku_enrichment_service.py`, `wine_research_service.py`, `wine_book_scraper.py`, `critic_score_service.py`, `web_verification_service.py`, `auction_wine_service.py`
- `services/agent-orchestrator/data/master_wine_library_seed.json`; `datasets/{wine_labels,wine_menus,wine_invoices,menu_corpus,scraped}/`
- Demand-driven prioritization: `supabase/migrations/20260813170000_enrichment_demand_priority.sql`
- `.planning/PRODUCER_REPUTATION_PLAN.md`, `.planning/MENU_EXTRACTION_SCALE_PLAN.md`
- Live progress in git history: `ef19b81 data(a10): enrich 79 more wines in-session (144/1,448)`, `f7e0ea1 data(producer-reputation): reach 100% coverage on the menu corpus`
- Adjacent and deliberately *not* its own team: `scripts/populate_embeddings.py` (one script) sits inside this team until retrieval work justifies otherwise

**Primary metric.** **Corpus coverage against demand-weighted denominator** — the share
of wines actually appearing on customer menus that are enriched, not the share of the
library. `enrichment_demand_priority` already encodes this distinction; 144/1,448 is
the wrong ratio to optimize.

**Premortem.** Coverage is chased on the full library because the number moves faster
there, the demand-weighted figure stagnates, and the L0 blocker is declared solved while
the wines on real menus are still thin.

---

### 5.2 Annotation & Ground Truth `[[dat-annotation-ground-truth]]`

**Mandate.** Human-verified truth: labelling operations, inter-annotator agreement, the
gold sets, and the assembly of training sets from them.

**Distinct from siblings because** it produces **the oracle**. §5.1 produces machine
guesses at scale; this team produces small, expensive, human-verified truth — and the two
must never be mixed, because enrichment output used as its own eval set makes every
accuracy number meaningless.

**Evidence — EXISTS.**
- `datasets/annotation_tasks/` (`pdfs.json`, `pilot_test.json`, `pilot_test_v2.json`, `screenshots.json`), `datasets/annotated/{invoices,menus}/`, `datasets/annotation_inbox/`
- `scripts/prepare_annotation_tasks.py`, `scripts/start_label_studio.sh`, `scripts/test_label_studio.sh`, `docker/label-studio/docker-compose.yml`
- `datasets/scripts/auto_annotate_subfields.py`, `convert_labels.py`
- Training-set assembly: `scripts/build_finetune_dataset.py`, `services/agent-orchestrator/services/training_data_store.py`, `services/dataset_ingestion_service.py`
- Correction loop: `services/active_learning_service.py:14-17` — dev-review corrections → accuracy tracker → rule learner → benchmark validation

**Boundary.** This team assembles training sets. **Model training itself**
(`services/agent-orchestrator/training/train_{invoice,label,menu}_scanner.py`) belongs
to Research & Math in the **Intelligence** division, not here.

**Primary metric.** **Gold-set size and freshness per task type** — annotated examples,
and days since the newest one. A gold set that stops growing stops detecting drift.

**Premortem.** Label Studio is stood up, one pilot round is annotated, the founder's
time gets pulled elsewhere, and every accuracy claim for the next year rests on
`pilot_test_v2.json` — a set that predates three model changes.

---

### 5.3 Synthetic Generation & Simulation `[[dat-synthetic-simulation]]`

**Mandate.** Data that is **true by construction**: synthetic restaurants, invoices,
menus, personas, and simulated POS traffic — each generated alongside its own ground truth.

**Distinct from siblings because** the truth guarantee is categorically different. §5.1
guesses, §5.2 verifies by hand, this team *knows* — because it wrote the answer key first.
That makes it the only source that can produce unlimited eval data, and the only one that
can be systematically unrepresentative.

**Evidence — EXISTS, and unusually complete.**
- `scripts/synth/` — `recipes.py`, `oracle.py`, `auth_personas.py`, `seed.py`, `snapshots.py`, `write_set.py`, `teardown.py`, `ids.py`
- `scripts/docgen/` — `compose.py`, `degrade.py` (realistic scan artefacts), `truth.py` (the answer key), `backtest.py`, `houses.py`, `render.py`, `templates/`, `fixtures/`
- `scripts/simulate/` — `bridge.py`, `payloads.py`, `detection.py`, `mappings.py`, `service.py`
- `datasets/sim/{archetypes,documents,menus}` + `manifest.json`; `scripts/e2e_crawl_harness.py`, `scripts/e2e_restaurants.json`
- Product-side counterpart: `apps/api-gateway/src/simpos/` (11 routes) and `supabase/migrations/20260805134000_simpos_schema.sql`; namespace guard `sim-` slug prefix (decision C31, cited in `agents/drift_agent.py:4-6`)
- `.planning/SYNTHETIC_DATA_AND_DOCS_PLAN.md`

**Primary metric.** **Backtest fidelity** — agreement between model performance on
synthetic documents and on the real annotated gold set. Synthetic data whose scores do
not track reality is worse than none, because it manufactures confidence.

**Premortem.** `degrade.py` models the noise we imagined (blur, skew, compression) rather
than the noise restaurants actually produce (a photo of a laminated menu under a heat
lamp, half-covered by a thumb); scanners score 95% on synthetic and 60% in the field.

---

### 5.4 POS & Operational Telemetry Ingest `[[dat-pos-telemetry-ingest]]`

**Mandate.** Real operational traffic as an L0 asset: POS checks, tables, sales velocity,
line-item resolution, and the review queues for what does not resolve.

**Distinct from siblings because** it is **the only data source whose schema the company
does not own and cannot re-run.** A missed webhook is a permanently missing Tuesday.

**Distinct from `[[eng-integration-wire]]`** (§2.7) on a crisp line: Integration owns
*"the webhook verified, returned 200, and nothing was dropped."* This team owns *"the
check lines resolved to real catalogue items and velocity is computable."* Delivery vs.
fitness. A payload can be perfectly delivered and useless.

**Evidence — EXISTS / PARTIAL.**
- EXISTS: `supabase/migrations/20260805133000_pos_unresolved_lines_and_review_queues.sql`, `…20260805132000_counting_catalog_and_correlation_columns.sql`
- EXISTS: `apps/api-gateway/src/pos-hub/` (10 routes), `toast/` (10), `simpos/` (11); `services/agent-orchestrator/agents/pos_integration_agent.py`, `adapters/toast_adapter.py`
- EXISTS: POS-agnostic `pos_checks`/`tables` schema behind the analytics engine (project memory: *analytics-engine*)
- EXISTS: `apps/api-gateway/src/analytics/` (39 routes, **all unguarded**) consumes this substrate
- PARTIAL: sales metrics are named as thin in [[README]] §1 — the pipes exist, the corpus does not

**Primary metric.** **Line-resolution rate** — POS check lines that resolve to a
catalogue item without human repair — reported *per restaurant*, since one badly-mapped
account can hide behind a healthy fleet average.

**Premortem.** Ingest is measured by rows landed rather than rows resolved; the unresolved
queue grows unattended; six months of sales data turns out to be unjoinable to the
catalogue, and the analytics engine's baselines were fitted on the resolvable half.

---

### 5.5 Substrate Quality & Coverage `[[dat-substrate-quality]]`

**Mandate.** Measure the substrate rather than produce it: confidence scoring, governance
tiers, quarantine of under-identified rows, and the daily data-substrate progress report
([[README]] §6).

**Distinct from siblings because** §§5.1–5.4 are **producers**, and a producer that grades
its own output is §0 test 3's failure. Distinct from `[[aio-evaluation-gates]]` (§3.4) on
subject: that team grades **agent tasks**, this one grades **data rows**.

**Evidence — EXISTS.**
- `supabase/migrations/20260813100000_library_data_quality_check.sql`, `…20260813130000_data_quality_confidence.sql`, `…20260814000000_data_quality_rescale.sql`
- `…20260817030000_under_identified_quarantine.sql`, `…20260813120000_wine_repair_log.sql`
- `services/agent-orchestrator/services/governance.py:20` `GovernanceTier`, `:53` `check_layer_1_cap`, `:107` `assign_governance_tier`, `:227` `compute_overall_confidence`
- `services/quality_scorer.py`, `services/field_confidence.py`, `services/ontology_validation_service.py`
- `datasets/OCR_CONFIDENCE_REPORT.md`

**Primary metric.** **Quarantine rate and its trend** — rows too under-identified to
publish, as a share of intake. Falling quarantine with rising volume is real progress;
falling quarantine because the threshold moved is not.

**Premortem.** Confidence thresholds are relaxed to unblock a coverage milestone —
defensibly, once — and the quality dashboard stays green while the substrate quietly
degrades, because the metric and the knob are held by the same hand.

---

## 6. Reliability / SRE — 4 teams

### 6.0 ⚠️ Deliberately under-teamed

Two candidates were rejected outright, and saying so is part of the design:

- **Incident Response / On-Call — rejected.** A dedicated incident team for a solo
  founder plus an agent fleet is org cosplay. Incident command folds into
  `[[sre-observability]]`, whose metrics are what would page anyone in the first place.
- **Infrastructure Cost — rejected.** Inference cost belongs to `[[aio-model-routing]]`
  (§3.3); platform cost is three vendors (Railway, Vercel, Supabase) on flat plans. Not
  a team until there is a bill worth a headcount.

**Named gap, not a team.** Backup/restore is `scripts/backup_db.sh` and
`scripts/restore_db.sh` — two shell scripts with **no evidence of a tested restore**.
Assigned to `[[sre-release-engineering]]` (restore is the terminal rollback), and its
first task is to prove a restore works. It is flagged here so it cannot be lost.

---

### 6.1 Observability & Telemetry Plumbing `[[sre-observability]]`

**Mandate.** Whether a signal exists at all: metrics, traces, error capture, log
timelines, health surfaces — and the emission path NF-A will ride on.

**Distinct from siblings because** it owns *whether the number exists*, never *what the
number says*. It is also **the hard prerequisite for L4**: NF-A cannot be emitted by
departments that have no emission path, which is why this team sits upstream of most of
[[README]] §4.

**Evidence — EXISTS.**
- `services/agent-orchestrator/core/observability.py:86` `MetricsCollector` (Prometheus), `:267` `TracingManager` (OTel), `:341` `instrument_fastapi`, `:53-84` no-op fallbacks
- `services/agent-orchestrator/core/base_agent.py:77` `AgentMetrics` — p95, success rate, uptime, error recording (`:104-156`)
- `base_agent.py:743` `log_decision` → the `decision_log` table at `supabase/migrations/20260805000000_baseline_from_production.sql:2687`. **This is the closest existing thing to an NF-A event and should be treated as the migration target, not replaced blind.**
- `apps/api-gateway/src/common/error-tracking/`, Sentry in both api-gateway and web ([[EXTERNAL_CONNECTIONS]]:34)
- `apps/api-gateway/src/logs/` (1 route), `apps/web/src/pages/LogsTimelinePage.tsx`, `AdminHealth.tsx`, `common/orchestrator/health-proxy.controller.ts` (4 routes), `scripts/health-check.sh`

**Primary metric.** **NF-A emission coverage** — share of agent tasks producing a
complete event (task type · model · tokens · latency · retries · tool calls ·
doneability · cost, per [[README]] §4.2). `decision_log` and `api_spend` today cover
parts of that tuple from two different writers and cannot be joined per task.

**Premortem.** `observability.py` silently degrades to `NoopMetric` (`:53`) when the
Prometheus client is absent — a good production choice that makes "no metrics" and
"metrics are zero" indistinguishable. A deploy loses the dependency, dashboards read
zero, and zero looks like calm.

---

### 6.2 Release Engineering `[[sre-release-engineering]]`

**Mandate.** The path from commit to production and back: the five CI/CD workflows,
deploy audit, rollback, environment/secret hygiene across 80 env vars, and — per §6.0 —
a *tested* database restore.

**Distinct from siblings because** it owns **reversibility**. Every other SRE team asks
whether the system is healthy; this team asks whether we can put it back.

**Evidence — EXISTS.**
- `.github/workflows/ci.yml` (lint/type-check TS + Python, three shell guards, unit + integration + local Playwright), `codeql.yml`, `deploy.yml`, `e2e-prod.yml`, `schema-parity.yml`
- `deploy.yml:1-27` — gated on CI success, `deploy-audit` / `rollback-guide` modes, `rollback_target_sha` input, concurrency group with `cancel-in-progress: false`
- `services/agent-orchestrator/railway.toml`, `vercel.json`, `apps/web/vercel.json`, `docker-compose.yml` + `.override.yml`
- 80 env vars across ~6 surfaces ([[EXTERNAL_CONNECTIONS]]:39-80), including `DEV_AUTH_BYPASS` / `DEV_AUTH_BYPASS_EMAIL` / `DEV_AUTH_BYPASS_SECRET`
- ⚠️ `ci.yml:8` states plainly: *"Do NOT treat TFND-05 as green CI — Black debt on studio_routes.py may keep main red"*

**Primary metric.** **Time-to-revert** — measured, from decision to healthy production.
`rollback-guide` currently *prints steps*; an unexercised procedure has no measured value.

**Premortem.** `main` is red for a known, harmless reason (`ci.yml:8`), red becomes the
normal colour, and the first genuinely broken build ships because nobody reads a signal
that has been failing for months. **Red CI that is tolerated is worse than no CI**, and
this workflow already documents its own tolerance.

---

### 6.3 Runtime Resilience `[[sre-runtime-resilience]]`

**Mandate.** Behavior under partial failure: circuit breakers, dead-letter queues, retry
and backoff policy, idempotency, rate limiting, connection pooling, saga compensation,
and backpressure.

**Distinct from siblings because** its failures are **invisible to green CI and to
uptime checks**. Every dependency can be reporting healthy while a poison message
retries forever and a queue backs up behind it.

**Evidence — EXISTS, and the mechanisms are already built.**
- `core/message_bus.py:161-284` — `CircuitState`, `CircuitBreakerConfig`, `CircuitBreaker`, `CircuitOpenError`; `:296` `MessageBusMetrics`; `:524-533` dead-letter exchange and queue
- `core/base_agent.py:543` `_process_with_retry`, `:704` `_check_idempotency`, `:720` `_mark_processed`, `:791` `_send_to_dlq`, `:823-905` saga start/advance/complete/compensate
- `core/connection_pool.py` (409 lines), `core/outbox_publisher.py` (transactional outbox)
- `apps/api-gateway/src/common/{idempotency,rate-limit,cache}/`; `rabbitmq-bridge.service.ts:68` `connectWithRetry`
- `core/orchestrator.py:537` `pause_all_writes`, `:582` `emergency_flush_buffer` — a manual kill switch already exists
- `agents/buffer_manager.py` — 30-minute LIFO backpressure window

**Primary metric.** **Dead-letter queue depth and age of oldest message.** A DLQ with an
old message is a customer-visible failure that has not been noticed yet.

**Premortem.** Nothing consumes `queue.dead_letters`. Retries and circuit breakers work
exactly as designed, failures land in the DLQ, and the DLQ is a well-engineered place
where problems go to be forgotten — the system reports healthy precisely *because* the
resilience machinery is working.

---

### 6.4 State Integrity & Invariants `[[sre-state-integrity]]`

**Mandate.** Detect silent corruption: distributed-state invariants, schema drift,
tenant leakage, POS↔inventory divergence — and own the gates that enforce them.

**Distinct from siblings because** it detects the failures that **never page anyone**.
Resilience handles things that break loudly; this team handles things that are wrong quietly.

**Evidence — EXISTS, unusually strong for a proposed team.**
- `agents/state_invariant_enforcer.py:1-30` — sync-loop detection, double-write detection, **tenant leakage detection**, LLM-output review signals
- `agents/drift_agent.py:1-19` — snapshot-hash catalog↔mapping drift, tiered autonomy, every run and finding writes a `decision_log` row
- `agents/inequality_detector.py:1-10` — POS/inventory mismatch: fat-finger, fraud, system error
- Stubs it should own but cannot yet: `agents/ghost_inventory_agent.py`, `agents/shrinkage_detective_agent.py`
- Gates: `.github/workflows/schema-parity.yml` (incl. daily cron, `:26-28`), `scripts/check_schema_parity.sh`, `scripts/check_no_direct_stock_writes.sh`, `scripts/check_no_direct_type_attributes_access.sh`, `scripts/check_no_raw_guest_channels.sh`, `scripts/check_no_guest_name_matching.sh`
- `.planning/SCHEMA_DRIFT_INVENTORY.txt`

**Primary metric.** **Mean time to detection for silent corruption** — from a violating
write to a raised finding. Schema drift is currently ≤24h (daily cron); tenant leakage
and stock divergence are unmeasured.

**Premortem.** Findings accumulate in `drift_findings` with status `open` — correctly,
since money and stock are never auto-applied (`drift_agent.py:11-16`) — nobody owns the
queue, and "open findings" becomes a number that only goes up. The detector works
perfectly and changes nothing.

---

## 7. Forks this document opens

To be added to `.planning/decisions/OPEN-DECISIONS.md` (CLAUDE.md §0.1 — none of these
are decided here):

| ID | Fork |
|---|---|
| OD-19 | **25 teams for one division.** Is the team layer chartered at this granularity, or only for departments whose scope demonstrably exceeds one owner (Engineering, Data)? |
| OD-20 | **Engineering at 8.** Are Schema & Migrations (§2.8) and Messaging & Delivery (§2.4) teams, or functions inside Platform & API? Each has independent evidence; each is also a plausible merge. |
| OD-21 | **The evaluation seam.** Does `[[aio-evaluation-gates]]` (§3.4, operations) coexist with Research & Math (methodology, [[README]] §2.2), or is it one team in the Intelligence division? Duplication here is worse than either answer. |
| OD-22 | **Skills at 3 vs 2.** `[[skl-harvesting]]` carries an explicit entry trigger (§4.3). Chartered now with the trigger, or not chartered until it fires? |
| OD-23 | **Does the team layer get the 7-artifact anatomy?** [[ORG_STRUCTURE]] §4 costs ≈168 documents for 24 units. Applying it to 25 teams adds ≈175 more. Proposal: teams get **3** artifacts (charter · premortem · loops), not 7. This is the single largest upkeep decision in the chapter. |
| OD-24 | **Guardian-agent co-ownership.** §3.2 gives Agent Fleet the code and §6.4 the findings. Workable, or does one team own guardian agents end to end? |

---

## 8. Cross-department seams — stated so they are not rediscovered

Seven boundaries this document draws deliberately. Each is a place where two teams could
plausibly claim the same work; naming them now is cheaper than arbitrating later.

| Seam | Left | Right | The line |
|---|---|---|---|
| Webhook health vs. data fitness | `[[eng-integration-wire]]` | `[[dat-pos-telemetry-ingest]]` | Delivered correctly vs. usable as L0 |
| DDL authorship vs. drift gate | `[[eng-schema-migrations]]` | `[[sre-state-integrity]]` | Author ≠ auditor (§0 test 3) |
| Draft vs. deliver | AI Orchestration | `[[eng-messaging-delivery]]` | What it says vs. that it arrives once |
| Grading agents vs. grading rows | `[[aio-evaluation-gates]]` | `[[dat-substrate-quality]]` | Task outcome vs. data row |
| Method vs. operations | Research & Math *(Intelligence)* | `[[aio-evaluation-gates]]` | Defines doneability vs. enforces it — **fork OD-21** |
| Find vs. fix the class | Security *(Intelligence)* | `[[eng-platform-api]]` | Classifies the 137 unguarded routes vs. builds the mechanism |
| Intent vs. implementation | Design *(Product)* | `[[eng-client-surfaces]]` | What the screen should be vs. what shipped |
