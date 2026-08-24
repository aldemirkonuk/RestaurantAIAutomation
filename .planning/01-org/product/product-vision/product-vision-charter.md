---
type: charter
division: product
department: product-vision
status: partial
metrics: [inbound.proposal_accept_without_edit_rate, inbound.false_accept_count, floor.kitchen_ready_to_waiter_p95_seconds, floor.misroute_rate, supply.sku_dual_price_coverage_pct, supply.price_freshness_p50_days, surface.unowned_surface_count, askai.confirm_without_edit_rate, askai.refusal_correctness, nf_a.doneability_verdict]
updated: 2026-08-24
links: ["[[product-vision-premortem]]", "[[product-vision-agenda-full]]", "[[product-vision-agenda-board]]", "[[product-vision-directive]]", "[[product-vision-loops]]", "[[product-vision-schedule]]", "[[ORG_STRUCTURE]]", "[[product]]", "[[inbound-understanding-charter]]", "[[service-floor-charter]]", "[[supply-discovery-charter]]", "[[surface-portfolio-charter]]", "[[ask-ai-charter]]", "[[guest-experience-charter]]", "[[design-charter]]", "[[partnerships-integrations-charter]]", "[[PAGE_MAP]]", "[[ENDPOINTS]]", "[[FUTURES]]", "[[AGENT_NATIVE_UI_DECISION]]"]
---

# Product & Vision — Charter

Parent division: **Product** ([[ORG_STRUCTURE]] §2). Siblings in-division: [[design-charter]],
[[partnerships-integrations-charter]]. Sub-layer reporting here: [[guest-experience-charter]].

## Mandate

Product & Vision is accountable for **what the software is** — the definition, boundary,
and doneability criteria of every named module; the route inventory those modules surface
through; and the single action schema every AI entry point must speak. It answers three
questions no other department is allowed to answer for it: *does this module exist as a
distinct thing*, *should this page exist at all*, and *what is an AI permitted to do on a
human's behalf without asking*. It does not build the modules, design their screens, or
sign the counterparties they depend on.

## Boundaries

Structured as **five teams grouped by module shape, not one-per-module**
(`.planning/foundation/teams/product.md:58-64`). Shape is what determines the failure mode,
the latency budget, and the guardrail pattern — three watchers that all run
*arrive → understand → propose → human approves* are one team's problem; a module that must
reach a named waiter within seconds of a plate hitting the pass is a different problem
wearing the same word "module".

| Team | Shape it owns | Modules |
|---|---|---|
| [[inbound-understanding-charter]] | Async, adversarial input → probabilistic extraction → human-gated proposal | Email Watcher · Order Watcher · Invoice/Receipt Understanding |
| [[service-floor-charter]] | Real-time, person-routed, no undo | Floor Checker |
| [[supply-discovery-charter]] | Outbound crawl → external corpus → supply graph | Vendor Finder |
| [[surface-portfolio-charter]] | The route inventory as a portfolio | 51 web routes |
| [[ask-ai-charter]] | One typed, allowlisted action schema | `ask → propose → confirm → execute` |

Owned outright:

- **Module definition and doneability criteria** for the five named modules of the vision
  (foundation [[README]]:78, L2).
- **The route inventory** — which of the 51 web routes should exist, which module owns each,
  and which get killed, merged, or made reachable.
- **The action schema and refusal policy** behind every AI entry point ([[FUTURES]] §8.1).
- **Two scan findings assigned here by name:** the POS-bridge audit
  (foundation [[README]]:51-54) and the 24 unlinked routes (foundation [[README]]:65).
- **The daily open-decision digest** (foundation [[README]] §6) — as a scheduled job, not a
  team. See [[product-vision-schedule]] and the rejection of a "Decision & Roadmap Ops" team
  at `teams/product.md:819`.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| What is *on* a page and how it behaves | [[design-charter]] | We decide **whether a page should exist**; Design decides what is on it |
| The 910-path UX catalogue as an execution ledger | [[ux-path-burn-down-charter]] | We own route-level portfolio calls; they own path-level burn-down |
| Building the modules | [[engineering-charter]] *(Platform)* | We define the contract; Engineering ships the code |
| POS adapters, canonical check pipeline | [[pos-bridge-charter]] *(Partnerships)* | [[service-floor-charter]] consumes `CanonicalCheck`; it does not author normalizers |
| Vendor **relationships**, portal, terms | [[supplier-distributor-network-charter]] *(Partnerships)* | [[supply-discovery-charter]] ships software that *finds* vendors; they *sign* them |
| Webhook signature verification, credential lifecycle | [[connector-platform-trust-charter]] *(Partnerships)* | Inbound understanding trusts a payload only if that team verified it |
| The guest as a user — identity, taste, consumer app, monetization | [[guest-experience-charter]] | Sub-layer, separate charter, NF-B metrics |
| The agent harness executing an Ask AI action | [[ai-orchestration-charter]] *(Applied AI)* | We own the schema and the refusal policy; they own the runtime |
| Grading agent task outcomes | [[agent-evaluation-gates-charter]] | Task success ≠ product definition being right |

**One non-goal is a settled decision, not a preference.** [[AGENT_NATIVE_UI_DECISION]] §3
reached a **"don't build"** verdict on the agent-native UI rewrite. *AI-native* in this
department means the [[ask-ai-charter]] action composer plus agents behind existing
surfaces — **not** a chat-surface rewrite, and not adaptive per-user layout. Superseding
that verdict requires its own ADR, not a charter written around it
(foundation [[README]]:237-253).

## Metrics it moves

The department does not roll five team metrics into one number; the failure modes are not
commensurable. A wrong invoice extraction and an unreachable route do not sum. The
department metric is the **set** — five numbers, each paired with a hard gate, on one board
([[product-vision-agenda-board]]).

| Metric | Paired gate | State today |
|---|---|---|
| `inbound.proposal_accept_without_edit_rate` | `inbound.false_accept_count` (accepted then later corrected) | Unmeasured |
| `floor.kitchen_ready_to_waiter_p95_seconds` | `floor.misroute_rate` — target **0** during service | Unmeasurable; input columns are null |
| `supply.sku_dual_price_coverage_pct` | `supply.price_freshness_p50_days` | Unmeasured |
| `surface.unowned_surface_count` | — | **Measured: 24 + 13** |
| `askai.confirm_without_edit_rate` | `askai.refusal_correctness` | Unmeasured; composer does not exist |

**Neural-footprint tie.** Every one of these is an NF-A event shape
(`stimulus → internal_state → choice → outcome`, foundation [[README]] §4.4): a proposal is
a stimulus, an accept-without-edit is a choice, a later correction is the outcome. The
department is the largest single producer of `nf_a.doneability_verdict` rows once L4 emits
anything — it emits nothing today (foundation [[README]]:80).

## Evidence today

**PARTIAL as a department** — 1 EXISTS, 3 PARTIAL, 1 NEW. Grades are per team and are
transcribed from `.planning/foundation/teams/product.md` §1, where every `path:line` was
read or grepped against the working tree.

| Team | Grade | Anchor evidence |
|---|---|---|
| [[surface-portfolio-charter]] | **EXISTS** | 51 routes, 39 nav edges ([[PAGE_MAP]]:5); 24 with no inbound link (:104-132); 13 untraceable (:151-167) |
| [[inbound-understanding-charter]] | **PARTIAL** | `apps/api-gateway/src/communications/gmail-watch.service.ts`; `procurement/documents/` (17 files incl. `line-matcher.ts`, `credit-ledger.ts`, `x12/`); `one-tap-actions/` |
| [[supply-discovery-charter]] | **PARTIAL** | `distributor-discovery/` (8 files, 3 specs); `vendor-intel/` (10 files incl. `wine-identity.ts`) |
| [[ask-ai-charter]] | **PARTIAL** | Contract written ([[FUTURES]]:203-245); 25 paths specified (`UX_PATHS_CATALOG.md:1803-1830`); entry points live but divergent |
| [[service-floor-charter]] | **NEW** | Named at foundation [[README]]:65 as L2 "unbuilt". No `floor-checker` module, service, or route exists anywhere in `apps/`, `services/`, `supabase/` |

**Two corrections carried forward from this session's verification pass:**

1. `teams/product.md:226` cites the Reports AI entry point as
   `apps/web/src/components/command/`. It is not there. `AICommandPalette` **and**
   `AICommandPill` both live in
   `apps/web/src/components/reports/organisms/AICommandPalette.tsx` (`:191` for the pill),
   used only at `apps/web/src/pages/Reports.tsx:29,959`.
   `apps/web/src/components/command/` is a *different* surface — the deterministic §A
   command palette (`CommandPalette.tsx`, `CommandProvider.tsx`, `commands.ts`,
   `recents-store.ts`). Ask AI therefore has **four** divergent entry points plus one
   adjacent deterministic palette, not three. [[ask-ai-charter]] owns fixing that count.
2. `/wine-agent` and `/wineagent` are confirmed live duplicates, both rendering the same
   inline placeholder: `apps/web/src/App.tsx:293-294`, with `PlaceholderPage` defined at
   `:349`. `/sommelier` renders `SommelierAI` at `:292`. Route count verified at **51**.

**There is no `ask-ai` module in `apps/api-gateway/src/`** (44 directories listed; none is
an assistant/ask/composer module), and [[ENDPOINTS]] contains no ask/assistant route. The
action composer is a contract with no server behind it.

## Open forks touching this department

`teams/product.md` §6 proposed five forks and numbered them **OD-20 … OD-24**. ⚠️ **Those
IDs were already taken** in `.planning/decisions/OPEN-DECISIONS.md`: OD-20 is the urgent
analytics-spend exposure (:24), OD-21 Obsidian workflow (:25), OD-22 tooling library (:26),
OD-23 the $20k-MRR target (:27). ✅ [[decision-office-charter]] renumbered them into the
`PROD-Fn` namespace ([[FORK-REGISTRY]]); cite the new IDs.

| Fork | Question |
|---|---|
| **PROD-F1** | Product division team layer — 17 teams as proposed, or the reduced set at `teams/product.md:840-848`? |
| **PROD-F2** | **Vendor Finder boundary** — does supply discovery sit here ([[supply-discovery-charter]]) or merge into [[supplier-distributor-network-charter]]? Named the highest duplication risk in the division (`:828`) |
| **PROD-F5** | **Design's commissioning authority** — can [[ux-path-burn-down-charter]] commission the endpoints its deferred paths are blocked on, or only report blocked? Affects [[surface-portfolio-charter]]'s throughput directly |
| — | The OD-number collision above: **resolved** by [[FORK-REGISTRY]] |
