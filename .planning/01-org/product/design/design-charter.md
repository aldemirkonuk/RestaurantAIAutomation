---
type: charter
division: product
department: design
status: exists
metrics: [design.paths_closed_per_month, design.deferred_unblocker_ratio, design.token_source_count, design.resolved_question_rate, design.time_to_first_real_action_staff_min]
updated: 2026-08-24
links: ["[[design-premortem]]", "[[design-agenda-full]]", "[[design-agenda-board]]", "[[design-directive]]", "[[design-loops]]", "[[design-schedule]]", "[[ux-path-burn-down-charter]]", "[[design-system-motion-substrate-charter]]", "[[exploration-studio-charter]]", "[[activation-in-product-guidance-charter]]", "[[ORG_STRUCTURE]]", "[[product]]", "[[UX_PATHS_CATALOG]]", "[[AGENT_NATIVE_UI_DECISION]]", "[[PAGE_MAP]]", "[[media-brand-charter]]", "[[product-vision-charter]]", "[[engineering-charter]]"]
---

# Design — Charter

Parent division: **Product** ([[ORG_STRUCTURE]] §2, row 31). Siblings in-division:
Product & Vision (+ Guest Experience sub-layer), Partnerships & Integrations.

## Mandate

Design is accountable for **what a person touches and how it behaves** — the interaction,
the surface, the substrate the surface is built from, and the first ten minutes in which a
new staff member either becomes a user or does not. It owns the two largest bodies of
already-existing, currently ownerless work in the repository: a **910-path UX catalogue**
and a **53-directory sketch corpus**. Neither is assigned to any department in
[[README]] §2.2. This department exists because both are real, both are drifting, and
drift in an unowned ledger is invisible until someone greps.

The department's operating claim is narrow and defensible: *design in this product is
bound by staff turnover, not by taste*. [[AGENT_NATIVE_UI_DECISION]]:87-95 states the
constraint in the founder's own review — onboarding happens every few months forever,
training is oral and physical (*"hit the blue button on the right"*), and muscle memory
during service is a real performance budget. Every decision below is downstream of that.

## Boundaries

Owns outright:

- **The UX path ledger** — `.planning/UX_PATHS_CATALOG.md`: 1,867 lines, 157,641 bytes,
  **910 unique `NEW-` IDs** (`NEW-001…NEW-910`) across **29 lettered sections**, counted
  this session. Definition, priority, acceptance criteria, and the deferred/unblocked-by
  record. *Not* the build — see non-goals.
- **The exploration corpus** — `.planning/sketches/`: 53 sketch directories, 51 HTML
  sketches, 97 files, plus `themes/default.css` and `MANIFEST.md`.
- **The shared substrate** — `packages/ui/src/`, `apps/web/src/components/ui/`,
  `apps/mobile/src/design/tokens.ts`, and the motion language specified in sketches
  043–046.
- **First-run** — `/onboarding`, `/get-started`, `/invite/:code`, `/help`, `/register`,
  `apps/web/src/components/onboarding/`, `apps/web/src/contexts/OnboardingContext.tsx`,
  `apps/mobile/src/guidance/`.
- **Accessibility as a standard** — §X `NEW-667…NEW-676` (`UX_PATHS_CATALOG.md:1493`) is
  written and owned here, enforced by [[design-system-motion-substrate-charter]], burned
  down by [[ux-path-burn-down-charter]]. It is a standard, not a team (see non-goals).

Structured as **four teams, which are four different success criteria** — convergent
delivery, reusable substrate, divergent exploration, and a numeric activation outcome.
Two of them are deliberately opposed, and that opposition is the reason they are separate:

| Team | Unit of work | Success looks like |
|---|---|---|
| [[ux-path-burn-down-charter]] | A catalogue row | The row exists in the product, or carries a named unblocker |
| [[design-system-motion-substrate-charter]] | A primitive other teams reuse | New surface composes from tokens rather than bespoke code |
| [[exploration-studio-charter]] | A design question | The question is resolved and a winner is named. **Most output is correctly discarded** |
| [[activation-in-product-guidance-charter]] | A new user | A staff member reaches a real action, by role |

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Outward creative — decks, social, campaigns, and the `wineops.ai` → Mudavym brand migration | [[media-brand-charter]] *(Commercial)* | **This is the department's sharpest boundary.** Media & Brand owns what a prospect sees before they buy; Design owns what a user touches after. They share a visual language and nothing else. A shared owner means launch-deck deadlines outrank an accessibility defect every single quarter, forever |
| Whether a page should exist at all | [[surface-portfolio-charter]] *(Product & Vision)* | They decide **whether**; we decide **what is on it and how it behaves**. Not invented here — [[README]]:50-52 assigns the 24-unlinked-route finding to Product & Vision by name |
| Building the endpoints deferred paths are blocked on | [[engineering-charter]] | We own the path's definition, priority, and acceptance criteria. **This seam is an open fork** — see below |
| The ~70 §AA rows blocked on data with no table — reservations, weather, labor, turn-time, per-seat pours, forecasts (`UX_PATHS_CATALOG.md:64`) | [[data-charter]] *(Platform)* | A Data dependency wearing a design costume. Design keeps the rows written and the unblocker named; it does not model the schema |
| The 573-insight generator's content | [[analytics-bi-charter]] | We design how an insight is read and acted on; they decide what an insight is |
| **Advancing the self-learning UX optimizer** | Nobody — **it stays dark** | See below. This is a considered-and-rejected team, not an oversight |
| Accessibility as a separate function | Nobody — it is a **standard**, not a team | §X is 10 well-specified paths. A standalone a11y team at this scale becomes the department that is overruled by every deadline. Enforced by 3.2, burned down by 3.1 |

### Considered and rejected: a Self-Learning UX Optimizer team

`apps/api-gateway/src/ux-optimizer/` exists — controller, module, service, DTOs — and its
four tables (`ux_proposals`, `ux_overrides`, `ux_learnings`, plus the optimizer table) are
in `supabase/migrations/20260805000000_baseline_from_production.sql` with **zero rows**.
It is dark by construction: `ux-optimizer.service.ts:69` defaults `UX_OPTIMIZER_ENABLED`
to `"false"`, and `ux-optimizer.module.ts:14` says so in a comment.

[[AGENT_NATIVE_UI_DECISION]]:78 reached a **"don't build"** verdict, with a business
argument (`:87-95`) and a statistical one. **Staffing a team here would relitigate a
closed decision by hiring rather than by superseding ADR.** That is the wrong instrument.
Design's mandate on the optimizer is exactly one thing: **keep it dark, and notice if it
turns on.** `design.ux_optimizer_rows` appears on [[design-agenda-board]] as a standing
counter whose correct value is 0. If the founder wants the verdict revisited, that is a
supersede-ADR, and it does not arrive through this charter.

## Metrics it moves

Four numbers, one per team, deliberately **not summed** — the same non-commensurability
argument [[engineering-charter]] makes. A resolved design question and a burned-down path
do not add.

| Metric | Reading today |
|---|---|
| `design.paths_closed_per_month` | ~90–100 of 910 closed to date; **no monthly rate ever measured** |
| `design.deferred_unblocker_ratio` | Deferred rows carrying a named unblocker ÷ all deferred. Unusually high — the point is to **protect** it, not raise it |
| `design.token_source_count` | **2** (`apps/web` CSS/Tailwind layer + `apps/mobile/src/design/tokens.ts`). Target: **1** |
| `design.resolved_question_rate` | **15 of 43** indexed sketches have a named winner; **43 of 53** directories are indexed at all |
| `design.time_to_first_real_action_staff_min` | **Unmeasured.** Staff is the number that matters — turnover makes it recur forever |

Secondary, and the one that predicts decay fastest: **`design.ledger_drift_days`** — days
the Deferred Decisions Log has disagreed with the shipped state of the product. Today that
number is **non-zero and unknown** (see Evidence).

**Neural-footprint tie, stated honestly.** Design does not emit `nf_a.*` or `nf_b.*` today
— nothing does ([[README]] §1, L4 "emits nothing yet"). Two ties are real rather than
decorative: (1) guest-facing surface *is* the NF-B stimulus field — a dish or wine
exposure event is only as good as the screen that produced it, so surface design decides
what `nf_b.stimulus` can even mean; (2) the human-gate pattern — one-tap approve, never
auto-send — is the UI where an agent's proposal becomes an accepted or rejected outcome,
i.e. where `nf_a.outcome` gets its human verdict. Design owns that gate's shape.

## Evidence today

**EXISTS — the largest ownerless body of work in the repository, and it is drifting.**

### The contradiction that justifies this department

The Deferred Decisions Log at `UX_PATHS_CATALOG.md:49` still says the §AA rows
(`NEW-761…860`) are blocked because *"the Reports 'Seating Density' widget these rows
reference does not exist yet"*.

It does exist. `UX_PATHS_CATALOG.md:1013` announces
*"Seating Density widget (`SeatingDensityPanel`) — unblocks NEW-761–860"*, and the file is
on disk: `apps/web/src/components/reports/organisms/SeatingDensityPanel.tsx`, 31,233
bytes, last modified 2026-07-27. The log's own instruction at `:15` is
**"Update both places when a deferred item ships."** It was not followed.

This is the single best argument for [[ux-path-burn-down-charter]]'s existence: a 910-row
ledger with no owner contradicts *itself*, and the contradiction was invisible until
someone grepped for it.

### The rest, graded

- **EXISTS — catalogue.** 910 unique IDs, 29 sections, 24 "Shipped" mentions. Its reading
  rule at `:70` is *"Given I am on page X, When I <trigger>, Then <outcome>"* — which
  makes the catalogue the E2E test spine as well as a backlog. A Deferred Decisions Log at
  `:10-67` where every row already carries *why deferred* **and** *unblocked by*: the
  rarest artifact in this repo, a backlog that knows its own dependencies.
- **EXISTS — sketches, visibly stalling.** 43 manifest rows; **28 carry `Winner: null`**
  (006, 007, 016, 020–026, 028–032, 034–041, 043–047). **10 directories are not in the
  manifest at all** (005, 011, 012, 013, 014, 015, 017, 018, 019, 049). And — found this
  session, not previously recorded — **manifest row `039 staff-performance-sidebar`
  (`MANIFEST.md:46`) has no directory on disk.** The index drifts in *both* directions.
  Duplicate IDs `038` and `048` are each used twice on disk.
- **PARTIAL — substrate.** `apps/web/src/components/ui/` holds 26 `.tsx` files: **5
  `.stories.tsx`**, 3 `.test.tsx`, **18 undocumented primitives**. `packages/ui/src/` —
  the *shared* workspace package, with `primitives/`, `layout/`, `charts/`,
  `notifications/` — has **zero stories**. `apps/mobile` has **zero stories** and a second
  token source at `apps/mobile/src/design/tokens.ts`. Two token sources and no shared
  documentation is the substrate problem in one line.
- **PARTIAL — activation.** The surfaces are live and well-linked: `/get-started` carries
  an in-degree of 2 ([[PAGE_MAP]]:145), among the twelve most-linked pages in the app.
  `apps/web/src/components/onboarding/` has 9 components;
  `apps/mobile/src/guidance/` has `GuidanceProvider`, `TipStrip`, `TourSheet`,
  `WineAgentFab`, `content.ts`, `analytics.ts`. Sketches 050 and 051 both converged
  (*"C — Hybrid"*, *"B — first-visit overrides session cap"*). **But role-based defaults —
  the thing [[AGENT_NATIVE_UI_DECISION]]:102 actually prescribed — do not exist**, and
  `NEW-513` (the `/settings` role matrix) is deferred at `UX_PATHS_CATALOG.md:63`.
- **NEW — measurement, all of it.** Not one of the five primary metrics has a first
  reading. Design's first artifact per team is a **number**, not a redesign.

### Two corrections this charter carries

1. **The catalogue is 910 paths, not 760.** [[engineering-premortem]] M5 and the
   founder's working notes both describe it as *"a 154KB, 760-path corpus"*. The byte
   count is right (157,641 ≈ 154 KiB); the path count is **910**, counted this session by
   unique `NEW-` ID. The corpus grew and the secondhand number did not. Design owns the
   count from here.
2. **`apps/web` is a Vite SPA with `react-router-dom`** (`apps/web/package.json:8,55,94`),
   not Next.js. Design specs must not assume file-system routing, server components, or
   `next/image`. [[client-surfaces-charter]] owns correcting CLAUDE.md §1; Design owns not
   repeating the error in a spec.

## Open forks touching this department

- **Design's commissioning authority** (**PROD-F5**; product.md §6, proposed as "OD-24"). Most deferred
  paths are blocked on **endpoints**, not on design. Can [[ux-path-burn-down-charter]]
  commission the endpoints it is blocked on, or only report *blocked*? A burn-down team
  that cannot commission will report "blocked" for a year. **This is the fork that
  determines whether the department's largest team can function.**
- **Product division team layer** (**PROD-F1**; product.md §6, proposed as "OD-20") — 17 teams as
  proposed, or the reduced set in §5.3? Design is 4 of the 17.
- ✅ **ID collision resolved by [[decision-office-charter]].** `product.md:858-862`
  proposed IDs OD-20 through OD-24, but `decisions/OPEN-DECISIONS.md:24-27` already
  assigns OD-20 (analytics spend), OD-21 (Obsidian workflow), OD-22 (tooling library),
  OD-23 (\$20k MRR) — four of the five were taken. The forks above now carry
  **PROD-F1…PROD-F5** ([[FORK-REGISTRY]]) and should be cited by ID.
