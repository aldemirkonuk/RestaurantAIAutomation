---
type: agenda-board
division: product
department: design
team: activation-in-product-guidance
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[activation-in-product-guidance-charter]]", "[[activation-in-product-guidance-agenda-full]]", "[[activation-in-product-guidance-loops]]", "[[activation-in-product-guidance-schedule]]", "[[activation-in-product-guidance-premortem]]", "[[design-agenda-board]]"]
---

# Activation & In-Product Guidance — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/product/design"
WHERE team = this.team
SORT type ASC
```

## Where this team sits in Design

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Unit,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/product/design"
WHERE type = "charter"
SORT team ASC
```

## Stale — 60 days is finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "01-org/product/design"
WHERE team = this.team AND date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops without a close-time

```dataview
LIST
FROM "01-org/product/design"
WHERE team = this.team AND type = "loops" AND !contains(file.content, "close_time")
```

## Standing counters

**Three rows, never one.** An averaged activation number hides staff behind owner, which is
[[activation-in-product-guidance-premortem]] M1 arriving as a reporting decision. Staff is
listed first because staff is the number that matters — turnover makes it recur forever.

- [ ] `design.time_to_first_real_action_staff_min` — **unmeasured, and no event exists to
      compute it from**
- [ ] `design.time_to_first_real_action_manager_min` — **unmeasured**
- [ ] `design.time_to_first_real_action_owner_min` — **unmeasured**
- [ ] `design.first_run_completion_rate_by_role` — **unmeasured**
- [ ] `design.role_default_coverage_pct` — **0.** Role-based defaults do not exist
- [ ] `design.surface_items_cut_by_role` — **0.** A year of zero here is premortem M5
- [ ] `design.guidance_events_aggregated` — **native only**.
      `apps/mobile/src/guidance/analytics.ts` exists; web first-run is not aggregated with it

## Decided-and-idle (the cheapest work available anywhere in Design)

- [ ] **Sketch 051** — winner *"B — first-visit overrides session cap"*. A known defect with
      a named fix and no code. **Execute, do not re-explore**
- [ ] **Sketch 050** — winner *"C — Hybrid (one-line why + triage table)"*. Decided,
      unqueued. Fourth in line, behind the metric
- [ ] **Sketch 049** `mobile-guidance-web-shell` — directly relevant and **not in the
      manifest at all**. Read it

## The split that must be made in writing

- [ ] **Role defaults** — client-side, deterministic, reversible, **unblocked**, scoped at
      *"a week"* ([[AGENT_NATIVE_UI_DECISION]]:100-103) → **this team, now**
- [ ] **Roles matrix** — backend + schema, deferred in the §O log
      (`UX_PATHS_CATALOG.md:62`, *"Backend/schema absent"*) → [[ux-path-burn-down-charter]]
- [ ] ⚠️ The roles-matrix row has **no identified `NEW-` ID**. The §O row lists a block of
      IDs without mapping item to ID; `NEW-513` is *2FA enrollment and recovery codes*
      (`:1234`). A dependency nobody can point at cannot be chased

## Open, blocking, named

- [ ] **What is "a real action" for a staff member?** The metric hangs on one definition
- [ ] **How much surface may staff lose by default?** Name the appetite before the first
      objection arrives
- [ ] **Is a client-side role default acceptable without the permissions backend?** It is a
      default, not a security boundary
- [ ] **Design or Product & Vision?** This team's outcome is a business number
- [ ] **User activation or account activation?** Boundary with [[growth-charter]], unstated
