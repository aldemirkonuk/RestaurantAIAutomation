---
type: schedule
division: commercial
department: sales
team: design-partner-operations
status: partial
metrics: [sales.time_to_first_connection, sales.design_partner_touch_streak, sales.verified_dollars_recovered, sales.unprompted_sessions_7d, sales.blocker_age_max]
updated: 2026-08-24
links: ["[[design-partner-operations-charter]]", "[[design-partner-operations-premortem]]", "[[design-partner-operations-loops]]", "[[design-partner-operations-directive]]", "[[design-partner-operations-agenda-board]]", "[[sales-schedule]]", "[[skills-charter]]", "[[analytics-bi-charter]]", "[[media-brand-charter]]"]
---

# Design Partner Operations — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| **Weekly (Mon)** | **Connection check** — `DEP-06` ticked (`.planning/PROJECT.md:101`)? If no, clear the board and put the visit on the calendar. | `sales.time_to_first_connection` → L1 |
| **Weekly (Fri)** | **The touch** — one contact that produced an observed usage moment or a named blocker. Logged with what was asked, what was seen, what it produced. | `design_partner_touch_streak`, contact log → L2 |
| **Weekly** | **Blocker sweep** — every open blocker, its age, its owner. Anything past 14 days escalates. | `sales.blocker_age_max` → L2 |
| **Weekly** | **Politeness read** — unprompted sessions vs the week's sentiment note, side by side. **Cannot run until [[analytics-bi-charter]] ships the event.** Auto-escalates at 3 zero weeks. | `unprompted_sessions_7d` → L3 |
| **Weekly** | **Patience ledger** — count substantive asks on the account from *any* unit; queue the excess. | `dpo.asks_per_week` → L6 |
| **Weekly (post-connection)** | **Receiving discipline** — sessions per delivery, blank-invoice rate (`ReceivingWorkspace.tsx:397-398`). | `invoice_fields_blank_rate` → L5 |
| **Monthly** | **Credit reconciliation** — walk the newest invoices, mark each prior request *landed* or *outstanding*, update both counters separately. Timed to the distributor's billing cycle. | `verified_dollars_recovered`, `credit_landing_rate` → L4 |
| **Monthly (first month only)** | **Manual invoice entry** — the founder types the design partner's invoices, not the kitchen. Explicitly unscalable, explicitly right for one account. | Match inputs for `overbilled_vs_ship` |
| **Quarterly** | **Relationship health review** — is this still a favour, or is it usage? Answered from L3 and L6, not from feeling. | Written verdict → [[sales-charter]] |
| **One-off — 2026-09-24** | **DEP-06 checkpoint** — unchecked ⇒ escalate as a scheduling failure. | Founder escalation |

**Anti-sprawl rule in force:** a scheduled job producing no action for **3 runs** is
downgraded or deleted. Pre-named likely casualties: the **patience ledger** (it produces
nothing while there is only one asking unit — correct outcome is to merge it into the
weekly touch, not to keep an empty ritual) and the **manual invoice entry** job, which is
*designed* to die after month one and should be deleted rather than quietly extended.

The **connection check** is the opposite case: it is a job that must remain loud until it
succeeds, then be deleted the same day. A weekly check on a box that is already ticked is
exactly the kind of dead ceremony the rule exists to kill.

## Skills owned

Skills live in `.claude/skills/` — **which does not exist yet** ([[skills-charter]]).
Candidates only, each with a trigger, a doneability criterion, and a real past instance per
[[README]] §3.3. No speculative skills.

| Candidate | Tier | Trigger | Doneability | Real past instance |
|---|---|---|---|---|
| `design-partner-weekly` | T2 | Friday | Contact logged with a usage observation or a named blocker; streak incremented or honestly broken | No cadence exists; streak is 0. The job it replaces is the one most likely to decay into "checking in" |
| `credit-memo-reconcile` | T2 | A new design-partner invoice arrives with prior requests outstanding | Every open request marked landed or outstanding, with the invoice it landed on named; both counters updated separately | `.planning/YC_WEDGE_PLAN.md:31-33` — the *"we asked"* vs *recovered* confusion this exists to prevent |
| `toast-connection-verify` | T3 | After any Toast credential change | One live `getSalesData` call returns real data for `TOAST_RESTAURANT_GUID`; otherwise fail loudly | `DEP-06` has been open long enough that "configured" and "working" must not be allowed to mean the same thing (`.planning/PROJECT.md:101`; `env.example:49-56`) |
| `blocker-age-sweep` | T3 | Weekly | Every open blocker has an age and an owner; anything past 14 days is escalated, not renewed | The blocker queue does not exist; ages are currently unknowable |

**Why `toast-connection-verify` is worth a skill rather than a note.** The failure it
guards is silent: credentials that are set but wrong produce an empty dashboard rather than
an error, and an empty dashboard is indistinguishable from a restaurant that is not busy.
A verification that must return *real rows for the real GUID* is the only honest definition
of connected.

**Not owned here.** Anything that writes prose about the customer
([[media-brand-charter]]), computes the recovery number ([[analytics-bi-charter]]), or
parses invoices (Engineering / Data, T1 per [[README]] §3.2). This team consumes those
outputs and owns none of them.
