---
type: charter
division: product
department: design
team: activation-in-product-guidance
status: partial
metrics: [design.time_to_first_real_action_staff_min, design.time_to_first_real_action_manager_min, design.time_to_first_real_action_owner_min, design.role_default_coverage_pct, design.first_run_completion_rate_by_role]
updated: 2026-08-24
links: ["[[activation-in-product-guidance-premortem]]", "[[activation-in-product-guidance-agenda-full]]", "[[activation-in-product-guidance-agenda-board]]", "[[activation-in-product-guidance-directive]]", "[[activation-in-product-guidance-loops]]", "[[activation-in-product-guidance-schedule]]", "[[design-charter]]", "[[ux-path-burn-down-charter]]", "[[exploration-studio-charter]]", "[[design-system-motion-substrate-charter]]", "[[AGENT_NATIVE_UI_DECISION]]", "[[PAGE_MAP]]", "[[UX_PATHS_CATALOG]]", "[[growth-charter]]", "[[analytics-bi-charter]]"]
---

# Activation & In-Product Guidance — Charter

Parent: **[[design-charter]]** (Product division). Siblings:
[[ux-path-burn-down-charter]], [[design-system-motion-substrate-charter]],
[[exploration-studio-charter]].

## Mandate

Own **first-run**: onboarding, the activation checklist, role-based defaults, and
in-product tours and tips — for **owner, manager, and staff separately**.

## Why distinct from its siblings

Two reasons, and both are structural rather than thematic.

**It is the only Design team with a numeric business outcome rather than a quality
judgement.** A user is activated or is not. The other three are measured on quality of
surface, substrate, or decisions; this one is measured on whether a human got to work.

**It has a mandate the other three explicitly do not: cutting surface.** That is not
invented here. The agent-native UI review rejected adaptive personalization and named the
alternative in the same breath — the surface is enormous and a new user drowns, *"but the
fix is to **cut the surface** with role-based defaults in a week, deterministically, with no
telemetry"* ([[AGENT_NATIVE_UI_DECISION]]:100-103). **That sentence is a team charter, and
nobody owns it.**

## The constraint that binds the whole department, stated here because this team lives in it

[[AGENT_NATIVE_UI_DECISION]]:87-95, in the founder's own business review:

- **High staff turnover** — you onboard someone new every few months, **forever**. First-run
  is not a launch project; it is a permanent surface.
- **Training is oral and physical** — *"hit the blue button on the right."* That sentence is
  the mechanism by which the product spreads inside an account, and it breaks under
  personalization.
- **Muscle memory during service is a real performance budget** — a somm doing receiving at
  4pm with a driver waiting does not read the screen; they tap a location.

**Design in this product is bound by turnover, not by taste.** Everything below follows.

## Boundaries

Owns outright:

- **The first-run routes** — `/onboarding`, `/get-started`, `/invite/:code`, `/help`,
  `/register` ([[PAGE_MAP]]).
- **`apps/web/src/components/onboarding/`** — 9 components: `GettingStartedPanel`,
  `MenuImportCard`, `MenuCsvUpload`, `MenuScanUpload`, `MenuManualEntry`,
  `MenuReviewScreen`, `StaffWelcome`, `ThresholdStep`, `OptionalTail`.
- **`apps/web/src/contexts/OnboardingContext.tsx`** — the first-run state machine.
- **`apps/mobile/src/guidance/`** — `GuidanceProvider`, `TipStrip`, `TourSheet`,
  `WineAgentFab`, `content.ts`, `analytics.ts`, `types.ts`.
- **Role-based defaults** — owner / manager / staff. Does not exist yet; this is the team's
  reason to exist.
- **§S Auth & Onboarding** — `NEW-589…NEW-608` (`UX_PATHS_CATALOG.md:1388`).

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Acquisition, trials, pricing pages, lifecycle email | [[growth-charter]] *(Commercial)* | They own getting an account created; we own what happens in the ten minutes after |
| Which paths ship on non-first-run surfaces | [[ux-path-burn-down-charter]] | We own §S and the role defaults; the rest of the 910 is theirs |
| Personalization, adaptive layout, per-user UI | Nobody — **rejected** | [[AGENT_NATIVE_UI_DECISION]]:78 is a *"don't build"* verdict. Cutting surface **deterministically by role** is the opposite of personalization and is what we do instead |
| The analytics events themselves | [[analytics-bi-charter]] | We define what "a real action" means; they own emission and storage |
| Tour animation primitives | [[design-system-motion-substrate-charter]] | We own when a tip fires; they own what it looks like when it moves |
| Help content as a knowledge base | [[knowledge-documentation-charter]] | In-product guidance is interaction. A docs site is documentation |

## Metrics it moves

**Primary: `design.time_to_first_real_action_*_min`** — account creation to first
non-onboarding mutation, **split by role, never averaged.**

**Staff is the number that matters.** Turnover makes it recur forever, while owner
time-to-value is measured once per account. Averaging the three hides staff behind owner,
which is [[activation-in-product-guidance-premortem]] M1 arriving as a reporting decision.

| Metric | Reading today |
|---|---|
| `design.time_to_first_real_action_staff_min` | **Unmeasured — and no event exists to compute it from** |
| `design.time_to_first_real_action_manager_min` | Unmeasured |
| `design.time_to_first_real_action_owner_min` | Unmeasured |
| `design.role_default_coverage_pct` | **0.** Role-based defaults do not exist |
| `design.first_run_completion_rate_by_role` | Unmeasured |

The honest consequence: **this team's first deliverable is an event definition, not an
onboarding redesign.** A first-run change with no before-number cannot be shown to have
worked, and activation is the area most prone to declaring victory on a demo.

**Neural-footprint tie.** The closest of any Design team, and still indirect. First-run is
where a human's first `stimulus → choice → outcome` sequence in this product happens, which
is the [[README]] §4.1 shape exactly. If NF ever emits, activation is where the operator's
trace begins. Nothing emits today ([[README]] §1, L4) — which is also why the primary metric
is unmeasured rather than merely unread.

## Evidence today

**PARTIAL — surfaces live, coherence missing.**

### What exists

- **Routes, and they are well-connected.** `/get-started` carries an **in-degree of 2**
  (from `/onboarding` and `/help` — [[PAGE_MAP]]:68-70, 145), putting activation among the
  twelve most-linked pages in the app. The surface exists; the coherence does not.
- **Web code.** `apps/web/src/components/onboarding/` (9 components, covering menu import by
  CSV, scan, and manual entry, plus a staff welcome and a threshold step) and
  `apps/web/src/contexts/OnboardingContext.tsx`.
- **Mobile code.** `apps/mobile/src/guidance/` with a provider, a tip strip, a tour sheet,
  an agent FAB, content, and its own `analytics.ts` — so *some* guidance instrumentation
  already exists on native and none of it is aggregated.
- **Sketches, unusually well-converged for this repo.** 001–004 (onboarding flow), 011
  (activation checklist), 048 (`interactive-guidance`), 049 (`mobile-guidance-web-shell`),
  **050** (`activation-flow` → winner *"C — Hybrid (one-line why + triage table)"*),
  **051** (`staff-firstrun-tutorial` → winner *"B — first-visit overrides session cap"*).
- **Paths.** §S `NEW-589…NEW-608` (`UX_PATHS_CATALOG.md:1388`).

### ⚠️ What is missing is the thing that was actually prescribed

**Role-based defaults do not exist.** The `/settings` roles matrix is deferred in the §O
row of the Deferred Decisions Log (`UX_PATHS_CATALOG.md:62`), blocked on *"Backend/schema
absent"*.

> **Correction to the division's evidence pass.** `product.md:606-607` cites this as
> *"`NEW-513`, §O log at :63"*. Checked this session: the §O row is at **`:62`** (`:63` is
> §G Recommendations), and **`NEW-513` is "2FA enrollment and recovery codes"**
> (`UX_PATHS_CATALOG.md:1234`), not the roles matrix. The §O row lists *"roles matrix"*
> among its deferred items and gives a **block** of IDs (497–499, 501–504, 507–509, 513,
> 515–517) without mapping item to ID — so **the roles-matrix row has no identified ID at
> all**. That is a small, real instance of the ledger drift
> [[ux-path-burn-down-charter]] exists to fix, and it lands on this team's most important
> dependency.

### Two known defects, both already diagnosed and neither fixed

1. **The one-tour-per-session cap.** Sketch 051 identified that the existing cap suppresses
   per-page first-run guidance and named the fix (*"B — first-visit overrides session
   cap"*). Decided. Not built.
2. **Staff first-run is a subset of owner first-run.** `StaffWelcome.tsx` exists, but there
   is no role-differentiated default surface behind it — the staff member lands in the same
   enormous product the owner does, minus a couple of steps.

## The mandate nobody has exercised

*Cut the surface.* This team is the only one in the department permitted to **remove**
things from a user's view — deterministically, by role, with no telemetry. That is the
opposite of the personalization [[AGENT_NATIVE_UI_DECISION]]:78 rejected, and it is the
alternative the same review recommended in the same paragraph. Nobody has done it, and it
was scoped at *"a week"*.
