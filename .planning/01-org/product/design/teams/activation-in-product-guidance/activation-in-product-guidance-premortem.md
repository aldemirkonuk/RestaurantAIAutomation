---
type: premortem
division: product
department: design
team: activation-in-product-guidance
status: provisional
metrics: [design.time_to_first_real_action_staff_min, design.role_default_coverage_pct, design.first_run_completion_rate_by_role]
updated: 2026-08-24
links: ["[[activation-in-product-guidance-charter]]", "[[activation-in-product-guidance-loops]]", "[[activation-in-product-guidance-directive]]", "[[design-premortem]]", "[[exploration-studio-charter]]", "[[ux-path-burn-down-charter]]", "[[analytics-bi-charter]]", "[[growth-charter]]", "[[red-team-charter]]", "[[AGENT_NATIVE_UI_DECISION]]"]
---

# Activation & In-Product Guidance — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. This team has failed. What happened?

The department's premortem line: *activation is designed for the owner demo, staff first-run
stays a tour that fires once per session and is skipped, and every new hire is trained
orally by a manager who resents the software — which is how a product stops spreading inside
an account.* Expanded into five mechanisms.

---

### M1 — It was built for the owner, because the owner is the only person who gives feedback

The owner sees the product in a sales context: motivated, unhurried, often with the founder
on the call. They say what they think. The staff member sees it mid-service, unmotivated,
handed a tablet by a manager who is annoyed the software exists. They say nothing; they just
do not use it.

Every feedback loop available points at the owner. So onboarding gets built for the owner,
`design.time_to_first_real_action_owner_min` looks excellent, and the number that recurs
forever — staff — is never separately known. Twelve months on, the product is loved by 11
owners and used by no line staff, which is the shape of a company that renews once and never
expands.

**Earliest observable signal.** The metric being reported as a **single averaged number**.
Not a bad number — an *averaged* one. Averaging hides staff behind owner, and it will be
proposed as a simplification by someone acting in good faith. The second signal: any
activation change whose acceptance criteria say "user" instead of naming a role.

**Counter-pressure.** Three numbers, published separately, **never averaged**, with staff
named as the one that matters — in the charter, before any work starts
([[activation-in-product-guidance-loops]] `L-ACT-1`). And a directive rule: an activation
change with no named role in its acceptance criteria is not accepted.

---

### M2 — The metric stayed unmeasurable, so judgement filled the vacuum

`design.time_to_first_real_action_staff_min` requires an event that does not exist. There is
no "real action" definition and no first-run event stream — `apps/mobile/src/guidance/analytics.ts`
exists but is native-only and unaggregated.

The failure is quiet: the team ships onboarding improvements that *feel* better, cannot show
that any of them worked, and after four quarters has a redesigned first-run and no evidence.
When a subsequent decision needs data, there is none, and the team's opinion is the only
input — which is exactly the state [[AGENT_NATIVE_UI_DECISION]] was written to argue against
in a different context.

**Earliest observable signal.** An onboarding change merged before the event definition
exists. That is the moment the team commits to being unable to evaluate itself, and it will
happen in week two because the change will be obviously good.

**Counter-pressure.** **The event definition is deliverable #1**, negotiated with
[[analytics-bi-charter]], and no first-run change ships before it. Uncomfortable, and the
alternative is a year of unfalsifiable work. `L-ACT-1` reports **unmeasured** every month
until the event lands — out loud, on the board. A loop honestly reporting *unmeasured* for
three months is working; a loop reporting nothing is the failure.

---

### M3 — Role defaults were deferred because their blocker was mis-recorded

Role-based defaults are the team's central deliverable —
[[AGENT_NATIVE_UI_DECISION]]:100-103 scoped them at *"a week, deterministically, with no
telemetry"*. The `/settings` roles matrix is deferred in the §O log
(`UX_PATHS_CATALOG.md:62`) on *"Backend/schema absent"*.

But the §O row lists a **block** of IDs without mapping item to ID, so the roles-matrix row
has **no identified ID at all**, and the division's own evidence pass mis-cited it as
`NEW-513` (which is 2FA, `:1234`). A dependency that cannot be pointed at cannot be
tracked, chased, or commissioned. It simply stays deferred, and each planning session
re-derives that it is blocked.

The deeper trap: **the settings *matrix* and the role *defaults* are not the same thing.**
A UI for editing role permissions needs backend and schema. Cutting the surface a staff
member sees by role needs neither — the review said *"deterministically, with no
telemetry"* precisely because it is a client-side default, not a permissions system.
Conflating them makes a week-sized deliverable inherit a quarter-sized blocker.

**Earliest observable signal.** The team's own board showing role defaults as "blocked on
backend" without a specific endpoint or table named. A blocker with no name is a wish
([[ux-path-burn-down-directive]]).

**Counter-pressure.** Split them explicitly, in writing, in the first week: **role defaults
(client-side, unblocked, ship now)** versus **the roles matrix (backend, deferred, owned by
[[ux-path-burn-down-charter]])**. And get the roles-matrix row a real ID via
[[ux-path-burn-down-charter]]'s reconciliation loop, so the dependency becomes addressable
rather than atmospheric.

---

### M4 — Sketch 051's winner was never executed, and guidance stayed one-shot

Sketch 051 resolved a real defect: the existing one-tour-per-session cap suppresses per-page
first-run guidance, and the named winner is *"B — first-visit overrides session cap"*. The
decision exists. The code does not.

If it stays that way, every new hire meets a tour that fires once, during service, gets
skipped, and never returns. Training reverts to oral transmission — and
[[AGENT_NATIVE_UI_DECISION]]:89-91 is explicit that oral training is the mechanism by which
the product spreads inside an account. Break it and the product stops spreading. That does
not show up as churn; it shows up as an account that never expands.

**Earliest observable signal.** Sketch 051 still marked resolved-and-unqueued at the second
[[exploration-studio-charter]] handoff review. It is already in that state today.

**Counter-pressure.** Execute the winner rather than re-exploring it. The question is
resolved; re-opening it is how a team spends a quarter agreeing with a decision that was
already made. This is the single cheapest item in the team's founding backlog and it should
be first for that reason alone.

---

### M5 — Cutting surface got vetoed one feature at a time

This team is the only one permitted to **remove** things from a user's view. Every removal
takes something away from a feature someone built, and each objection is individually
reasonable: *staff sometimes need reports*; *hiding it will generate support questions*;
*it took three weeks to build*.

Twelve months later nothing has been cut, `design.role_default_coverage_pct` is still 0, and
the enormous-surface problem [[AGENT_NATIVE_UI_DECISION]] identified — the steelman *for*
personalization — is unaddressed by either the rejected approach or the recommended one.
The company will have declined both fixes for the same problem.

**Earliest observable signal.** The first proposed cut that is downgraded to "collapsed by
default" or "moved lower" instead of removed. Softening is how a cut dies without anyone
rejecting it.

**Counter-pressure.** Role defaults are **deterministic and reversible**: a staff member can
always reach the full surface through an explicit, discoverable control. That makes each cut
cheap to argue for and cheap to undo — which is the whole reason the review specified
*deterministic* rather than adaptive. And the coverage metric is on the board from day one,
so a year of zero cuts is visible rather than assumed.

---

## Cross-cutting counter-pressure

- **Staff is the number.** If a board, a review, or a summary shows one activation number,
  it must be staff. Owner time-to-value is measured once per account; staff recurs forever
  because turnover recurs forever.
- **This team cannot evaluate itself without [[analytics-bi-charter]].** That dependency is
  named in the charter rather than discovered in month three, and it is the reason the first
  deliverable is an event definition.
- **The turnover constraint cuts both ways.** It argues for cutting surface (M5) *and*
  against moving controls ([[design-directive]]'s turnover rule). A role default that hides
  a control is fine; a redesign that moves one a trained user reaches for is not. The
  distinction is the team's core craft.
- **[[red-team-charter]] should attack M3 hardest.** "Blocked on backend" is the most
  comfortable status in this repo, and it is currently attached to the one deliverable that
  a business review scoped at a week.
