---
type: schedule
division: commercial
department: sales
status: new
metrics: [sales.time_to_first_connection, sales.design_partner_touch_streak, sales.verified_dollars_recovered, sales.unprompted_sessions_7d]
updated: 2026-08-24
links: ["[[sales-charter]]", "[[sales-premortem]]", "[[sales-loops]]", "[[sales-directive]]", "[[sales-agenda-board]]", "[[design-partner-operations-schedule]]", "[[outbound-engine-schedule]]", "[[skills-charter]]", "[[skill-registry-authoring-charter]]", "[[decision-office-charter]]"]
---

# Sales — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| **Weekly (Mon)** | **Connection check** — is `DEP-06` ticked (`.planning/PROJECT.md:101`)? If no, this is the only item that goes on the board. | `sales.time_to_first_connection`; board reorder → [[sales-loops]] L1 |
| **Weekly (Fri)** | **Design partner touch** — a real contact that produced either an observed usage moment or a named blocker. "Checking in" does not count. | `sales.design_partner_touch_streak`, blocker list → L2 |
| **Weekly** | **Politeness read** — unprompted sessions in the last 7 days vs. sentiment. **Cannot run until [[analytics-bi-charter]] ships one event.** | `sales.unprompted_sessions_7d` → L3 · auto-escalates at 3 zero weeks |
| **Monthly** | **Credit reconciliation** — walk the design partner's newest invoices and mark each earlier credit request as *landed* or *still outstanding*. Timed to their billing cycle, not ours. | `sales.verified_dollars_recovered`, `sales.credit_landing_rate` → L4 |
| **Monthly** | **One stranger conversation** — a single call with someone who owes us no kindness. Runs even with the target list deferred; it is calibration, not pipeline. | Qualitative note → [[sales-premortem]] M1 counter-pressure |
| **Fortnightly** | **Outbound calibration** — **dormant.** Does not start until `verified_dollars_recovered > 0` **and** the list un-defers. | — → L5 |
| **Quarterly** | **Claim audit** — every public dollar figure traced back to the invoice its credit landed on. Anything untraceable is pulled, not footnoted. | Claim allowlist → [[media-brand-charter]], [[outbound-engine-charter]] |
| **One-off — 2026-09-24** | **DEP-06 hard checkpoint.** Unchecked ⇒ escalate as a scheduling failure. | Founder escalation |
| **One-off — 2026-11-24** | **Department review.** `DEP-06` unchecked **and** `verified_dollars_recovered == $0` ⇒ fold Sales into [[growth-charter]], delete 14 of 21 documents. | Decision → [[decision-office-charter]] |

**Anti-sprawl rule in force:** a scheduled job that produces no action for **3 runs** is
downgraded or deleted. Two jobs on this table are pre-marked as likely casualties — the
monthly stranger conversation (easy to skip, no external forcing function) and the
fortnightly outbound calibration (dormant, and dormant jobs are exactly how a dormant team
acquires the appearance of activity — [[sales-premortem]] M5). Both are named here so
their deletion is a scheduled outcome rather than an oversight.

## Skills owned

Skills live in `.claude/skills/`. **That directory does not exist yet**
([[skills-charter]] §Evidence today), so nothing below is registered — these are
*candidates* under the [[README]] §3.3 protocol, each with a trigger, a doneability
criterion, and a real past instance. No speculative skills.

| Candidate | Tier | Trigger | Doneability | Real past instance |
|---|---|---|---|---|
| `credit-memo-reconcile` | T2 | A new design-partner invoice arrives with prior credit requests outstanding | Every open request is marked landed or outstanding, with the invoice it landed on named | The `.planning/YC_WEDGE_PLAN.md:31-33` finding — "dollars recovered" meaning *"we asked"* — is the exact confusion this prevents |
| `claim-provenance-check` | T2 | Any draft containing a dollar figure about customer outcomes | Each figure traces to a landed credit, or is removed before the draft leaves review | [[sales-premortem]] M3; also the stale citations found in this very session (`YC_WEDGE_PLAN.md` "256 lines" vs 406; `:233,:265` vs `:400,:438`) — provenance rot is already happening in this repo |
| `design-partner-weekly` | T2 | Friday | A contact happened and produced a usage observation or a named blocker; streak incremented or broken honestly | No cadence exists today; the streak is 0 |
| `sending-identity-guard` | T3 | Any commit under a sales/outbound path | Fails if `GmailService` is reachable from an outbound module | [[sales-premortem]] M4. Built in the shape of the five existing `scripts/check_*.sh` guards — a grep is enough, and the failure it prevents is organisational |

**A note on the guard.** `sending-identity-guard` is the only one of the four that is
worth building *before* the department has a customer, because it is the only one whose
failure is irreversible. Deliverability lost is not recovered by noticing.

**What Sales deliberately does not own.** Any skill that writes prose about the customer
(that is [[media-brand-charter]]), computes the recovery number
([[analytics-bi-charter]]), or touches price ([[finance-pricing-charter]]). The T1 domain
skills around invoices and matching belong to Engineering and Data per [[README]] §3.2 —
Sales consumes their output and owns none of them.
