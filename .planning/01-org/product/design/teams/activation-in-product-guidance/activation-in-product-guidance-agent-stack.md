---
type: agent-stack
division: product
department: design
team: activation-in-product-guidance
status: designed
updated: 2026-08-27
metrics: [design.time_to_first_real_action_staff_min, design.time_to_first_real_action_manager_min, design.time_to_first_real_action_owner_min, design.role_default_coverage_pct, design.first_run_completion_rate_by_role]
links: ["[[activation-in-product-guidance-charter]]", "[[activation-in-product-guidance-schedule]]", "[[activation-in-product-guidance-loops]]", "[[activation-in-product-guidance-premortem]]", "[[0034-agent-stack-artifact]]", "[[design-agent-stack]]", "[[skills-charter]]", "[[ux-path-burn-down-agent-stack]]", "[[analytics-bi-charter]]", "[[AGENT_NATIVE_UI_DECISION]]"]
---

# Activation & In-Product Guidance — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This team's first deliverable is **an event definition, not an onboarding redesign**
> ([[activation-in-product-guidance-charter]] §Metrics), so its agent's first output is the
> word *unmeasured* with the missing event named. It is also the card most likely to drift
> into a closed decision: *"cut the surface, by role"* and *"adapt the surface, per user"*
> look adjacent and are opposite ([[activation-in-product-guidance-schedule]]).

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `first-run-auditor` | Publish the three role-split activation readings — **never averaged** — or say *unmeasured* and name the missing event, and check every "blocked on backend" claim against a real endpoint or table | NEW |

One row. The design work (role defaults, guidance policy) is human; what has never been done
is the **reading**, and the reading is what makes any of that work falsifiable.

## 2. Agent cards

```yaml
agent: first-run-auditor
unit: activation-in-product-guidance
triggers:
  - schedule: "monthly — cohort read, cut register, guidance efficacy, blocker truth check"   # [[activation-in-product-guidance-schedule]]
  - topic: pr.opened            # publisher: .github/workflows/ci.yml:14 (pull_request) — EXISTS; filtered to the first-run surfaces below
  - topic: activation.real_action    # publisher: NONE (gap — the event does not exist; see §5, and L-ACT-1 cannot close without it)
consumes:
  - "apps/web/src/components/onboarding/ (9 components) and apps/web/src/contexts/OnboardingContext.tsx — the first-run state machine"
  - "apps/mobile/src/guidance/ — GuidanceProvider, TipStrip, TourSheet, WineAgentFab, content.ts, analytics.ts (native-only, unaggregated)"
  - "§S Auth & Onboarding rows NEW-589…NEW-608 (UX_PATHS_CATALOG.md:1388) and the §O deferral row at :62"
  - "reconciled ledger verdicts from [[ux-path-burn-down-agent-stack]] — including whether the roles-matrix row has an ID yet"
emits:
  - "three role-split readings (owner / manager / staff) or an explicit *unmeasured* naming the missing event — never one averaged number"
  - "design.role_default_coverage_pct (0 today), design.role_matrix_row_has_id (false today), design.tour_skip_rate, design.first_visit_guidance_coverage → [[design-agent-stack]] board rollup"
  - "per-PR flags: an activation change whose acceptance criteria say *user* instead of a named role; a first-run control that was relocated or renamed rather than hidden"
  - nf_a events (task_type: activation_read)
routing_class: extraction      # read cohorts, resolve claims, flag diffs; the class covers flagging only, never verdicts
quality_bar: "three readings produced or an explicit *unmeasured* with the missing event named ([[activation-in-product-guidance-schedule]]); averaging the three is a defect, not a formatting choice — it is premortem M1 arriving as a reporting decision. NONE (gap) — ADR 0017 has no verdict grader for a cohort read"
autonomy:
  read: autonomous
  propose: autonomous          # readings and flags land as PRs and board rows
  mutate_stock_money_outbound: confirm    # constant
memory: activation-in-product-guidance
escalates_to: "[[design-charter]]"
```

**Three hard rules.** (1) **No personalization, no adaptive layout, no per-user learning, and
no path that leads to `UX_OPTIMIZER_ENABLED`** — [[AGENT_NATIVE_UI_DECISION]]:78 is a closed
*"don't build"* verdict, and this is the team most likely to reach it by accident.
(2) Cut-versus-move is **flagged, never decided**: the agent surfaces a renamed or relocated
control as a diff and a human rules, because *"hit the blue button on the right"*
(`:89-91`) is an oral-training fact no agent can verify. (3) The quarterly **new-hire shadow**
is human-only and never summarized by this agent — it captures the tablet-at-4pm reality an
event stream cannot see, and compressing it is how that reality is lost.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `activation-event-check` | T2 | Per PR touching first-run surfaces | The real-action event fires and is attributable to a role, or the PR is flagged as unmeasurable | **`apps/mobile/src/guidance/analytics.ts` exists native-only and unaggregated** (verified on disk this session) — half a product's worth of first-run signal, invisible to any reading | NEW |
| `first-run-role-trace` | T2 | Monthly cohort read | Three role-split readings produced, or an explicit *unmeasured* with the missing event named | **Sketch 051 `staff-firstrun-tutorial`** — the one-tour-per-session cap identified as a defect, winner named (*"B — first-visit overrides session cap"*), never executed and its effect never measured | NEW |
| `blocked-claim-verify` | T2 | Monthly, and on any new deferral | Every *"blocked on backend"* claim names an endpoint or a table, or is reported unverifiable | **The roles-matrix deferral (`UX_PATHS_CATALOG.md:62`) has no identified ID**, and the ID cited for it division-wide — `NEW-513` — is 2FA enrollment (`:1234`); found in the 2026-08-24 charter pass | NEW |

Two rows on [[activation-in-product-guidance-schedule]] are deliberately **not** here.
`role-default-audit` and `cut-move-lint` cite an absence and a principle respectively — role
defaults have never existed to audit, and no move has been recorded — so under README §3.3
rule 3 they stay scheduled jobs. The first hand-run of either becomes its instance.

Consumed, owned elsewhere: the skill envelope and registry ([[skills-charter]]); event
emission and storage ([[analytics-bi-charter]]) — this team defines what *a real action* is,
it does not emit it.

## 4. Memory

- **Procedural** — the three §3 skills; candidates via [[skill-harvesting-charter]]'s queue,
  still through the §3.3 gate.
- **Episodic** — nf_a `task_type: activation_read`. Needs **`context.role`**
  (owner / manager / staff) as a required jsonb key: a role-blind event makes the primary
  metric uncomputable and quietly re-averages the three numbers, which is the failure this
  card exists to prevent. `context.surface` (web / native) separates the two guidance stacks.
- **Semantic** — `memory/` beside this file, `activation-in-product-guidance-MEMORY.md` as
  index, one fact per file with `source` / `confidence` / `last_verified`. Founding facts:
  role-based defaults do not exist though the review scoped them at *"a week"*; the
  one-tour-per-session cap is a decided-but-unbuilt defect (sketch 051); the roles-matrix row
  has no ID; native guidance analytics are unaggregated. Every write is a PR.
- **Working** — this card, the MEMORY index, charter §Mandate, and the §S row range. The
  onboarding components and `OnboardingContext.tsx` are retrieval targets by `path:line`.

**Consolidation** — monthly, immediately after the cohort read in
[[activation-in-product-guidance-schedule]]: read the month's activation events, or record
that there were none; **failures first** — a month reported *unmeasured* becomes a fact naming
the mechanism (*"no event distinguishes a first real action from an onboarding step"*) and its
age, so the gap accrues visibly instead of being re-noticed each month; every reversed cut
becomes a fact about that cut, by role; expire facts unverified 90 days; propose skill
candidates. One PR; "no delta" stated when true.

## 5. Async contract

Interaction is loops ([[activation-in-product-guidance-loops]]), NF-A events, and vault PRs.
Gap rows — the first is this team's blocking one:

| Gap | Why it is a gap |
|---|---|
| `activation.real_action` has no publisher | The event does not exist and no agreement with [[analytics-bi-charter]] has been made. Every primary metric is uncomputable until it does, so L-ACT-1 and L-DSN-4 report **unmeasured** monthly, out loud. A loop that says unmeasured honestly is working; one that reports nothing is the failure |
| Native guidance telemetry is a half-stream | `apps/mobile/src/guidance/analytics.ts` publishes on native only and nothing aggregates it with web — so even the signal that exists cannot produce a role-split reading |
| `design.cut_reversal_rate` has no producing event | The cut register needs a reversal signal that does not exist; until then the register is a human-maintained list and says so |
| The roles-matrix dependency is a ledger row with no ID | Resolved through [[ux-path-burn-down-agent-stack]]'s reconciliation, not by this team editing the catalogue — its most important dependency is literally an instance of the drift the sibling team was created to fix |

## 6. Evidence today

- **PARTIAL — surfaces live, coherence missing.** Routes `/onboarding`, `/get-started`,
  `/invite/:code`, `/help`, `/register`, with `/get-started` at in-degree 2
  ([[PAGE_MAP]]:68-70,145); 9 onboarding components plus `OnboardingContext.tsx`;
  `apps/mobile/src/guidance/` with its own `analytics.ts` (re-verified on disk this session).
- **EXISTS — the decisions, unbuilt.** Sketches 050 (*"C — Hybrid"*) and 051 (*"B — first-visit
  overrides session cap"*) both converged; neither was executed.
- **NEW — role-based defaults.** `design.role_default_coverage_pct` is **0**: the thing
  [[AGENT_NATIVE_UI_DECISION]]:100-103 prescribed and scoped at *"a week"* has not been
  started, and this is the only team permitted to remove things from a user's view.
- **NEW — the agent, all three skills, every §4 layer**, and **every metric**: none of the five
  has a first reading, and the primary one has no event to compute it from.
