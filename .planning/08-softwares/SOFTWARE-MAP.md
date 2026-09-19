---
type: moc
title: Software Map
updated: 2026-09-03
links: ["[[SOFTWARE-CONTRACT]]", "[[PAGES-MAP]]", "[[ORG-MAP]]", "[[HOME]]", "[[0052-software-catalog-layer]]", "[[0049-ecosystem-division-layer]]"]
---

# Software Map — the small softwares inside the one entity

> **Mudavym is one entity holding many small softwares** ([ADR 0001](../decisions/0001-mudavym-single-entity.md)).
> This is the catalog of those softwares: what a restaurant actually gets, one note each,
> smallest capability first. It is the **product** layer — distinct from *who builds it*
> ([[ORG-MAP]], 100 teams), *what renders it* ([[PAGES-MAP]], 47 screens), and *how the
> ecosystem is divided* ([ECOSYSTEM-PLAN §3a](../04-specs/ECOSYSTEM-PLAN.md), 8 divisions).

```
division (8, ADR 0049)  →  software (this layer)  →  page (47, PAGES-MAP)  →  component
                                    ↓
                           owner_unit (team, ORG-MAP)
```

Contract: [[SOFTWARE-CONTRACT]] · Decision: [ADR 0052](../decisions/0052-software-catalog-layer.md)

<!-- ROSTER:BEGIN — generated from note frontmatter; regenerate rather than hand-edit -->
## The roster — 26 small softwares

| Software | Division | Status | Tier | Screens | Gateway modules | Agents | Owner |
|---|---|---|---|---|---|---|---|
| **[[calendar\|Calendar]]** | Restaurant | `partial` | core | [[06-pages/calendar\|calendar]] | `calendar`, `events` | 1 | [[messaging-delivery-charter\|messaging-delivery]] |
| **[[dashboard-home\|Dashboard Home]]** | Restaurant | `partial` | core | [[06-pages/dashboard\|dashboard]] | `dashboard` | — | **unowned — gap** |
| **[[inventory-command\|Inventory Command]]** | Restaurant | `partial` | core | [[06-pages/inventory\|inventory]] | `inventory`, `inventory-ledger`, `storage-locations` | 4 | [[inventory-ledger-charter\|inventory-ledger]] |
| **[[notifications\|Notifications]]** | Restaurant | `partial` | core | [[06-pages/notifications\|notifications]] | `notifications`, `push` | 1 | [[messaging-delivery-charter\|messaging-delivery]] |
| **[[orders\|Orders]]** | Restaurant | `partial` | core | [[06-pages/orders\|orders]] | `procurement` | 2 | [[procurement-vendor-network-charter\|procurement-vendor-network]] |
| **[[receipts-invoice-match\|Receipts & Invoice Match]]** | Restaurant | `partial` | core | [[06-pages/receipts\|receipts]], [[06-pages/documents-reports\|documents-reports]] | `procurement` | 1 | [[procurement-vendor-network-charter\|procurement-vendor-network]] |
| **[[receiving\|Receiving]]** | Restaurant | `partial` | core | [[06-pages/receiving\|receiving]], [[06-pages/receiving-door\|receiving-door]] | `procurement` | 1 | [[procurement-vendor-network-charter\|procurement-vendor-network]] |
| **[[recurring-orders\|Recurring Orders]]** | Restaurant | `backend-only` | core | *backend-only* | `procurement` | 2 | [[procurement-vendor-network-charter\|procurement-vendor-network]] |
| **[[communications-hub\|Communications Hub]]** | Vendor | `hollow` | core | [[06-pages/communications\|communications]] | `communications`, `conversations` | 3 | [[messaging-delivery-charter\|messaging-delivery]] |
| **[[global-vendor-search\|Global Vendor Search]]** | Vendor | `partial` | core | [[06-pages/providers\|providers]], [[06-pages/distributors\|distributors]] | `distributor-discovery` | — | [[supply-discovery-charter\|supply-discovery]] |
| **[[promotions\|Promotions]]** | Vendor | `partial` | core | [[06-pages/promotions\|promotions]] | `providers`, `common/orchestrator` | — | **unowned — gap** |
| **[[vendor-directory\|Vendor Directory & Intel]]** | Vendor | `partial` | core | [[06-pages/providers\|providers]] | `providers`, `vendor-catalogue` | 2 | [[procurement-vendor-network-charter\|procurement-vendor-network]] |
| **[[vendor-portal\|Vendor Portal]]** | Vendor | `hollow` | public | [[06-pages/vendor-public-page\|vendor-public-page]] | `vendor-portal` | — | **unowned — gap** |
| **[[vendor-price-compare\|Vendor Price Compare]]** | Vendor | `hollow` | plus | [[06-pages/vendor-prices\|vendor-prices]] | `vendor-intel`, `wines` | — | [[supply-discovery-charter\|supply-discovery]] |
| **[[pos-bridge\|POS Bridge]]** | POS | `backend-only` | internal | *backend-only* | `pos-hub`, `toast` | 1 | [[pos-bridge-charter\|pos-bridge]] |
| **[[simpos\|SimPOS]]** | POS | `partial` | internal | [[06-pages/simpos-terminal\|simpos-terminal]], [[06-pages/simpos-order-log\|simpos-order-log]], [[06-pages/simpos-scenarios\|simpos-scenarios]] | `simpos` | — | [[pos-bridge-charter\|pos-bridge]] |
| **[[wine-library-sommelier\|Wine Library & Sommelier]]** | Sommelier | `hollow` | core | [[06-pages/wines\|wines]], [[06-pages/sommelier\|sommelier]] | `wines` | 2 | **unowned — gap** |
| **[[wine-studio\|Wine Studio]]** | Sommelier | `partial` | internal | [[06-pages/studio\|studio]], [[06-pages/studio-queue\|studio-queue]], [[06-pages/studio-certify\|studio-certify]], [[06-pages/studio-invite-redeem\|studio-invite-redeem]] | `common-orchestrator` | — | **unowned — gap** |
| **[[recommendations\|Recommendations]]** | Intelligence/Analytics | `partial` | plus | [[06-pages/recommendations\|recommendations]], [[06-pages/recommendations-catalog\|recommendations-catalog]] | `analytics`, `one-tap-actions`, `ux-optimizer` | — | [[insight-narrative-generation-charter\|insight-narrative-generation]] |
| **[[reports-analytics\|Reports & Analytics]]** | Intelligence/Analytics | `partial` | plus | [[06-pages/reports\|reports]], [[06-pages/logs\|logs]] | `analytics`, `reports`, `logs` | 2 | **unowned — gap** |
| **[[admin-health\|Admin & Health]]** | Platform/Admin | `partial` | internal | [[06-pages/admin\|admin]], [[06-pages/admin-health\|admin-health]], [[06-pages/dev-sandbox\|dev-sandbox]] | `health`, `database`, `logs` | 1 | [[observability-telemetry-plumbing-charter\|observability-telemetry-plumbing]] |
| **[[app-shell-support\|App Shell & Support]]** | Platform/Admin | `partial` | core | [[06-pages/help\|help]], [[06-pages/privacy\|privacy]], [[06-pages/credits\|credits]] | — | — | **unowned — gap** |
| **[[auth-onboarding\|Auth & Onboarding]]** | Platform/Admin | `partial` | core | [[06-pages/login\|login]], [[06-pages/register\|register]], [[06-pages/forgot-password\|forgot-password]], [[06-pages/reset-password\|reset-password]], [[06-pages/verify-email\|verify-email]], [[06-pages/invite-landing\|invite-landing]], [[06-pages/no-access\|no-access]], [[06-pages/get-started\|get-started]], [[06-pages/onboarding\|onboarding]], [[06-pages/profile\|profile]] | `auth`, `restaurants` | — | [[platform-api-charter\|platform-api]] |
| **[[mudavym-mcp\|Mudavym MCP Server]]** | Platform/Admin | `planned` | internal | *backend-only* | — | — | **unowned — gap** |
| **[[settings-integrations\|Settings & Integrations]]** | Platform/Admin | `partial` | core | [[06-pages/settings\|settings]], [[06-pages/services\|services]], [[06-pages/authorize-integration\|authorize-integration]] | `settings`, `integrations`, `user-preferences`, `restaurant-templates` | — | [[platform-api-charter\|platform-api]] |
| **[[team-command\|Team Command]]** | Platform/Admin | `live` | core | [[06-pages/team\|team]] | `team`, `organizations` | — | [[platform-api-charter\|platform-api]] |

*47 of 47 route notes are claimed by a software above.*
<!-- ROSTER:END -->

## Live index (Dataview)

```dataview
TABLE WITHOUT ID
  file.link AS Software,
  division AS Division,
  status AS Status,
  tier AS Tier,
  length(pages) AS Screens,
  owner_unit AS Owner
FROM "08-softwares"
WHERE type = "software"
SORT division ASC, file.name ASC
```

## Gaps

Softwares with no resolvable owning team, and pages whose ownership is contested, are
listed here rather than silently assigned. A row here is a finding, not a formatting
failure — the same convention the agent-stack layer uses.

<!-- GAPS:BEGIN — generated -->
| Software | Gap |
|---|---|
| [[dashboard-home\|Dashboard Home]] | No charter claims `src/dashboard/` or `Dashboard.tsx`. Three teams own slices and each disclaims the rest; the only mentions in 100 charters are stale guard-backlog rows |
| [[promotions\|Promotions]] | Has no gateway module of its own — served by `providers` plus `common/orchestrator`, a 7,256-LOC module no charter owns |
| [[vendor-portal\|Vendor Portal]] | Ownership **contested**: `procurement-vendor-network` vs `supplier-distributor-network`, on an unratified proposed line; PROD-F2 still open |
| [[wine-library-sommelier\|Wine Library & Sommelier]] | Four units hold a slice each — catalogue-identity, agent-fleet, corpora-enrichment, taste-fingerprint — and every one disclaims the product |
| [[wine-studio\|Wine Studio]] | Backed by proxy controllers inside `common/orchestrator/`, which no charter owns; the Studio product itself is unclaimed |
| [[reports-analytics\|Reports & Analytics]] | Four charters own four pieces and each disclaims the others; `reports` is claimed by no charter at all |
| [[mudavym-mcp\|Mudavym MCP Server]] | No charter in `01-org/` mentions MCP, model context, or `mcp-connections` (grepped 2026-09-03, zero matches). It is **documented, not built** — the owning team is one of the forks the ADR in its §8 must settle, so it is recorded rather than assigned |
| [[app-shell-support\|App Shell & Support]] | **By design, not a defect** — a shell/legal/support surface, not a product. Listed so the pages are visibly accounted for |
<!-- GAPS:END -->

## Findings this catalog surfaced

Rolling 47 screens up into 25 products forced a re-read of the evidence behind each page
note's §10 verdict. Five findings came out of that, all verified in-tree on 2026-09-01 and
none of them fixed here — this layer documents, it does not repair.

1. **A batch of `hollow` / `broken` page verdicts are stale.** Commit `58113e26` wrote the
   46 page dossiers *and* fixed much of what they indict, in the same PR; the notes were
   never revised afterwards. Dashboard's fake one-tap approve and cost-as-revenue mislabel,
   Reports' `generateMockAnswer`, both recommendations pages' unauthenticated `fetch`, and
   `/receiving`'s three defects are all fixed in-tree. Their notes still say otherwise.
   This is the layer's most consequential finding: **the honesty mechanism itself went stale**.
2. **Ownership is genuinely unresolved for 8 of 26 products** (see gaps above — re-measured
   2026-09-19, `grep -c 'unowned — gap' SOFTWARE-MAP.md` → 8; this finding previously said 6,
   which undercounted). The pattern
   is consistent and worth naming: charters were written per *module*, so every product that
   spans modules has four teams owning a slice and disclaiming the whole.
3. **`common/orchestrator/` is where unowned product logic accumulates** — 7,256 LOC, 8
   controllers across 8 unrelated prefixes, no charter. It backs Promotions, Wine Studio, and
   the inbound half of Communications. An infra-named module holding three products' spines.
4. **Two documented-as-dormant things are live, and several live-looking things are dormant.**
   `provider_promotions` is written on every provider-matched inbound plus a 09:00 cron
   (four docs still call it dormant); meanwhile `reporting_agent` (935 lines) and
   `calendar_agent` have zero publishers on every routing key.
5. **Declared-but-uncalled wiring is common.** `contacts` (8 routes) has zero callers in
   `apps/`; the `reports` module's 10 endpoints have no web caller; `one-tap-actions` and
   `ux-optimizer` are called from neither recommendations page.

Corrections that belong to other layers — the OD-31 register row, the
`unguarded_money_moving_routes` charter metric, and four ADR 0049 §3a mapping fixes — were
routed to their owners rather than made here.

## Models & shared services — capacity and coverage, measured 2026-09-19

Infra-layer models/services with no single owning software (per [[SOFTWARE-CONTRACT]] §9).
A model or service that serves one software's slug is documented in that note instead —
see `insight-generator` and `forecasting-engine` in [[reports-analytics]], `wine-intelligence`
and `document-extraction-ocr` in [[wine-library-sommelier]] / [[receipts-invoice-match]] /
[[inventory-command]], and `recommendations-actions-ux-optimizer` in [[recommendations]].

### model-client-router (service)

**Capacity.** Routes calls to `claude-haiku-4-5(-20251001)` / `claude-sonnet-5` /
`claude-opus-4-8` via `api.anthropic.com`, with cost-aware routing logic
(`model-routing.ts:36-151`).

**Coverage.** `model-routing.spec.ts`, `first-attempt-spend-gate.spec.ts`.

**Runs in production.** Confirmed live via **9** call sites (re-measured 2026-09-19:
`grep -rl "modelClient\." apps/api-gateway/src` → 9 files, not the 6+ an earlier pass
counted): `ux-optimizer/ux-optimizer.service.ts`, `vendor-intel/vendor-page-extractor.service.ts`,
`common/orchestrator/inbound-responder.service.ts`, `procurement/documents/document-extractor.service.ts`,
`inventory/photo-count.service.ts`, `menus/parsers/scan-parser.service.ts`, `ask-ai/ask-ai.service.ts`,
`analytics/consultants.service.ts`, `analytics/goals.service.ts`. Cost logging to `api_spend`
is **not** connected from this layer — 0 TypeScript writers found.

**Promised vs. built.** The router itself matches its design; the spend-tracking half of the
promise (`api_spend`) is not wired from Node. The extra 3-4 call sites this correction adds
are also missing `api_spend` logging and eval coverage, which argues for tightening this
finding, not softening it.

**Gaps.** No golden-set/eval harness for any caller; `api_spend` has been silent 25 days
(last row 2026-08-24, measured against a 2026-09-18 "today").

*Evidence:* `model-client.service.ts:7,23,29,36-37`; `grep -rl api_spend apps/api-gateway/src`
→ none; `grep -rl "modelClient\." apps/api-gateway/src` → 9 (command re-run 2026-09-19).

### agent-orchestrator (service)

**Capacity.** Async/circuit-breaker/message-bus agent framework (`BaseAgent`); 24 concrete
agents for procurement, compliance, inventory, communications, and more.

**Coverage.** 107 test files under `tests/`, but 15 of 24 agents have no name-matching test
file (a naming heuristic — could be hiding integration-style coverage, not independently
verified).

**Runs in production.** No evidence found: `agent_activity_logs` — the table purpose-built
to record every agent run — has **0 rows, all time**.

**Promised vs. built.** "25 autonomous agents" is promised; only 5 of 24 call an LLM (the
rest are rule-based), and zero rows of any agent's activity exist in production's own log
table.

**Gaps.** Cannot confirm the service is invoked in production at all against this database;
15 agents lack a dedicated test file.

*Evidence:* `ls services/agent-orchestrator/agents/*.py` → 25 (24 agents + `__init__.py`);
`grep -rl anthropic .../agents/*.py` → 5 files; SQL `select count(*) from agent_activity_logs`
→ 0.

### self-evolution (service)

**Capacity.** Designed for passive feedback collection plus a disabled-by-default learning
engine, A/B testing, and a meta-agent.

**Coverage.** No test files found under `services/self-evolution/`.

**Runs in production.** `agent_evolution_log` has 0 rows, ever; not referenced by any other
service or config in the repo outside its own directory.

**Promised vs. built.** Its own docstring calls it "the brain that makes WineOps AI learn and
improve"; it appears fully inert in this codebase snapshot.

**Gaps.** The entire learning loop is disabled; unclear whether the service is deployed
anywhere at all.

*Evidence:* `services/self-evolution/main.py:1-13` (docstring); SQL `select count(*) from
agent_evolution_log` → 0; `grep -rl self.evolution` repo-wide → only its own directory.

## How to read a maturity verdict

Rolled up from the page notes' §10 and sharpened at the software level:

- **live** — does what it claims, end to end
- **partial** — works, but a named capability is absent
- **hollow** — renders, but the data or action behind it is fake, mocked, or never persists
- **broken** — a primary path fails today
- **backend-only** — no user surface by design; the note names its consumer
- **planned** — documented, not built

`hollow` is the load-bearing one: a software that looks finished and lies is worse than
one that is obviously unfinished, and this repo has shipped several.

## Rules of this layer

1. **Every page is assigned.** All 47 route notes carry a `softwares:` list; nothing falls
   into an "Unassigned" bucket.
2. **N:M with pages.** `providers` hosts two softwares behind its `?tab=`.
3. **Owners are resolved, never guessed.** Ambiguity becomes a gap row above.
4. **It nests under the divisions**, it does not compete with them.
5. **Links into this layer are path-qualified** — six software slugs share a basename with
   a page note, so write `[[08-softwares/orders|Orders]]` from outside the folder.
