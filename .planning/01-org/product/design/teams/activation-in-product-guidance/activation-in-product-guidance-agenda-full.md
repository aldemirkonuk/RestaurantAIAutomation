---
type: agenda-full
division: product
department: design
team: activation-in-product-guidance
status: provisional
metrics: [design.time_to_first_real_action_staff_min, design.role_default_coverage_pct, design.first_run_completion_rate_by_role]
updated: 2026-08-24
links: ["[[activation-in-product-guidance-charter]]", "[[activation-in-product-guidance-premortem]]", "[[activation-in-product-guidance-agenda-board]]", "[[activation-in-product-guidance-directive]]", "[[activation-in-product-guidance-loops]]", "[[activation-in-product-guidance-schedule]]", "[[design-agenda-full]]", "[[exploration-studio-charter]]", "[[ux-path-burn-down-charter]]", "[[analytics-bi-charter]]", "[[growth-charter]]", "[[AGENT_NATIVE_UI_DECISION]]", "[[UX_PATHS_CATALOG]]"]
---

# Activation & In-Product Guidance — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Make first-run work for the person who will meet it most often and complain least: **line
staff**. Three deliverables, in a deliberate order, none of which is an onboarding
redesign.

| # | Deliverable | Why it is in this position |
|---|---|---|
| 1 | **Define "a real action"**, and instrument time-to-first-real-action by role | Without it, every later change is unfalsifiable ([[activation-in-product-guidance-premortem]] M2) |
| 2 | **Role-based defaults** — owner / manager / staff, client-side, deterministic, reversible | The deliverable [[AGENT_NATIVE_UI_DECISION]]:100-103 scoped at *"a week"* and nobody owns |
| 3 | **Execute sketch 051's winner** — *first-visit overrides session cap* | Decided in a sketch, never built. Cheapest item in the backlog |

Everything else — flow redesigns, new checklists, richer tours — waits behind these.

## How

### 1. The event before the redesign

`design.time_to_first_real_action_staff_min` needs an event that does not exist. Define
"real action" with [[analytics-bi-charter]]: **the first non-onboarding mutation** — a
count submitted, a receipt matched, an order acted on. Not a page view, not a tour
completion, not a checklist tick. Those are things the product did to the user.

`apps/mobile/src/guidance/analytics.ts` already exists, native-only and unaggregated —
which means part of the instrumentation problem is *aggregation*, not *emission*, and that
is a cheaper start than it looks.

**No first-run change ships before this lands.** It will feel wrong in week two, when an
obviously-good improvement is available. Ship the event anyway.

### 2. Split the two things that got conflated

This is the highest-value untangling available to the team:

| | Role **defaults** | The roles **matrix** |
|---|---|---|
| What | Cut the surface a role sees, by default | A UI for editing role permissions |
| Where | Client-side | Backend + schema |
| Blocked? | **No** | Yes — §O log, `UX_PATHS_CATALOG.md:62`, *"Backend/schema absent"* |
| Scoped at | *"a week, deterministically, with no telemetry"* ([[AGENT_NATIVE_UI_DECISION]]:100-103) | Unscoped |
| Owner | This team, now | [[ux-path-burn-down-charter]], deferred |

They are currently treated as one blocked item. They are not the same thing, and the
conflation makes a week-sized deliverable inherit a quarter-sized blocker.

**Also:** the roles-matrix row has **no identified ID**. The §O log lists *"roles matrix"*
among its deferred items and gives a block of IDs (497–499, 501–504, 507–509, 513, 515–517)
without mapping item to ID; `NEW-513` is in fact *2FA enrollment and recovery codes*
(`:1234`). Getting that row a real ID via [[ux-path-burn-down-charter]]'s reconciliation
loop makes the dependency addressable instead of atmospheric.

### 3. Design for the tablet at 4pm, not the laptop at the demo

The constraint is written down ([[AGENT_NATIVE_UI_DECISION]]:87-95): turnover is permanent,
training is oral (*"hit the blue button on the right"*), and muscle memory during service is
a performance budget. Concretely, for this team:

- **Cuts are fine. Moves are not.** Hiding a control by role is a cut; relocating one a
  trained user reaches for breaks the oral-training sentence.
- **Reversible by design.** Every default surface has an explicit, discoverable way to the
  full product. That is what makes a cut cheap to argue for — and cheap to undo when the
  objection in premortem M5 arrives.
- **Per-page first-visit guidance beats a single tour.** Sketch 051 already reached this
  conclusion and named the fix.

### 4. Then, and only then, flow work

Sketch 050's winner (*"C — Hybrid — one-line why + triage table"*) is decided and unqueued.
It is real work and it is fourth, because it improves a flow whose outcome nobody can
currently measure.

## Why now

- **The prescription exists and is unowned.** A business review named the fix, scoped it at
  a week, and no department claimed it. That is the cheapest kind of gap to close.
- **Turnover makes this permanent, not seasonal.** First-run is not a launch project. Every
  quarter it is not owned, a cohort of new hires is trained orally by a manager who resents
  the software.
- **Two decisions are already made and idle** — sketch 050 and sketch 051, both with named
  winners, neither queued. Executing a resolved decision is the highest-return work
  available anywhere in the department.
- **The surface is live and well-linked.** `/get-started` has an in-degree of 2
  ([[PAGE_MAP]]:145) — among the twelve most-linked pages in the app. The problem is not
  reach; it is coherence.
- **Some instrumentation already exists on native.** `apps/mobile/src/guidance/analytics.ts`
  means the first metric is an aggregation problem more than a greenfield one.

## Next steps

- [ ] Define "a real action" with [[analytics-bi-charter]]; instrument by role. **Nothing
      else ships first**
- [ ] Publish the first three-way reading — owner / manager / staff — **never averaged**
- [ ] Split role **defaults** (client-side, unblocked) from the roles **matrix** (backend,
      deferred) in writing, on the board
- [ ] Get the roles-matrix row a real `NEW-` ID via [[ux-path-burn-down-charter]] — today it
      has none, and `NEW-513` is 2FA
- [ ] Ship staff role defaults: the smallest surface that lets a line staff member do their
      job, with an explicit route to the full product
- [ ] Execute sketch **051**'s winner — *first-visit overrides session cap*
- [ ] Queue sketch **050**'s winner (*C — Hybrid*) behind the above
- [ ] Aggregate `apps/mobile/src/guidance/analytics.ts` with web first-run events into one
      series
- [ ] Read the unindexed sketch **049** (`mobile-guidance-web-shell`) — it is directly
      relevant and the manifest does not know it exists

## Questions for the founder

1. **What is "a real action" for a staff member?** The whole metric hangs on this one
   definition. My proposal: the first non-onboarding mutation — a count submitted, a receipt
   matched. Confirm or correct it, because everything downstream inherits it.
2. **How much surface may staff lose by default?** The mandate is *cut the surface*. Cutting
   generates support questions in the short run and is the entire point in the long run.
   Name the appetite now, before the first objection arrives one feature at a time
   (premortem M5).
3. **Is a client-side role default acceptable without the permissions backend?** It is a
   **default**, not a security boundary — a staff member can still reach everything. If that
   distinction is not acceptable, this team is blocked on backend work and the *"a week"*
   scoping was wrong.
4. **Does activation belong in Design or in Product & Vision?** Its outcome is a business
   number rather than a design judgement, which is the strongest argument against it sitting
   here. The argument for: its named deliverable — *cut the surface* — is an
   interaction-design act. Choose deliberately rather than letting whoever picks up the work
   settle it.
5. **Who owns activation for a *restaurant*, not a user?** An 11-restaurant customer base
   means account-level activation may matter more than per-user. That boundary with
   [[growth-charter]] is currently unstated, and it decides whether this team's metric is a
   user metric or an account one.
