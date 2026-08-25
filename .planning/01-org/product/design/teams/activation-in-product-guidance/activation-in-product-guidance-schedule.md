---
type: schedule
division: product
department: design
team: activation-in-product-guidance
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[activation-in-product-guidance-charter]]", "[[activation-in-product-guidance-loops]]", "[[activation-in-product-guidance-agenda-board]]", "[[design-schedule]]", "[[skills-charter]]", "[[analytics-bi-charter]]", "[[ux-path-burn-down-charter]]", "[[exploration-studio-charter]]", "[[AGENT_NATIVE_UI_DECISION]]"]
---

# Activation & In-Product Guidance — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Per PR | **Role-named acceptance criteria** check — an activation change must name owner, manager, or staff. *"User"* is not a role | Pass/fail; guards premortem M1 |
| Per PR | **Cut-versus-move** review — hiding a control by role is a cut (allowed); relocating or renaming one a trained user reaches for is a move (rejected) | Violation list |
| Monthly | **Activation cohort read** (`L-ACT-1`) — three numbers, **never averaged**, staff first | `design.time_to_first_real_action_*_min`; reports **unmeasured** until the event exists |
| Monthly | **Cut register** (`L-ACT-2`) — what was cut by role, how often users reversed it, support questions after | `design.surface_items_cut_by_role`, `design.cut_reversal_rate` |
| Monthly | **Guidance efficacy** (`L-ACT-3`) — tip completion, tour skip rate, first-visit coverage | `design.tour_skip_rate`, `design.first_visit_guidance_coverage` |
| Monthly | **Blocker truth check** (`L-ACT-4`) — is anything still recorded as "blocked on backend" that is client-side? Does the roles-matrix row have an ID yet? | `design.role_matrix_row_has_id` (**false** today) |
| Quarterly | New-hire shadow — watch one line staff member's actual first shift with the product | Qualitative; the only input that reaches the tablet-at-4pm reality |
| Quarterly | Staleness sweep — this team's artifacts, 60 days ([[README]] §3.3, §6) | Archive or revision |

The **new-hire shadow** is the only qualitative item scheduled anywhere in this department,
and it is here because [[AGENT_NATIVE_UI_DECISION]]:87-95 says the binding constraints are
physical: a tablet, mid-service, oral training, muscle memory. None of that is visible in an
event stream. Owner feedback arrives unprompted and continuously; staff feedback arrives
only if someone goes and looks.

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion.

**Honest state: `.claude/skills/` does not exist in this repository.** The only project
skill on disk is `.agents/skills/railway-config/SKILL.md` ([[README]] §3.1). This team owns
**zero skills today**.

| Proposed skill | Trigger | Doneability criteria | Real past instance |
|---|---|---|---|
| `first-run-role-trace` | Monthly cohort read | Three role-split readings produced, or an explicit *unmeasured* with the missing event named | **Sketch 051** — the one-tour-per-session cap identified, winner named, never executed, effect never measured |
| `role-default-audit` | Monthly, and on any navigation change | Every surface item classified as shown/hidden per role, with a reversal route verified | **Role-based defaults do not exist**, though a business review scoped them at *"a week"* |
| `activation-event-check` | Per PR touching first-run | The real-action event fires and is attributable to a role | `apps/mobile/src/guidance/analytics.ts` exists **native-only and unaggregated** — half a product's worth of signal, invisible |
| `cut-move-lint` | Per PR | Flags renamed/relocated controls in first-run surfaces | *"Hit the blue button on the right"* ([[AGENT_NATIVE_UI_DECISION]]:89-91) is the training mechanism a move silently breaks |
| `blocked-claim-verify` | Monthly | Every "blocked on backend" claim names an endpoint or table | The roles-matrix deferral (`UX_PATHS_CATALOG.md:62`) has **no identified ID**; `NEW-513` is 2FA (`:1234`) |

**Nothing in this table exists yet.** Each is tied to a job above so a skill is created
against a close-time rather than a job invented to justify a skill. Registry governance sits
with [[skills-charter]] (Applied AI).

### The one job this team should be judged on first

`activation-event-check`. Everything else this team could do is unfalsifiable without it.
[[activation-in-product-guidance-premortem]] M2 is the failure where the team ships a year
of improvements that feel better and cannot be shown to have worked — and that failure is
entirely prevented by one event definition negotiated with [[analytics-bi-charter]] in the
first week.

### A note on what this team must not build

No personalization, no adaptive layout, no per-user learning, and no path that leads to
`UX_OPTIMIZER_ENABLED`. [[AGENT_NATIVE_UI_DECISION]]:78 is a closed *"don't build"* verdict,
and this team is the one most likely to arrive at it by accident — because *"cut the
surface, by role"* and *"adapt the surface, per user"* look adjacent and are opposite. One
is decided by a human once and is inspectable; the other is decided by a model continuously
and is not.
