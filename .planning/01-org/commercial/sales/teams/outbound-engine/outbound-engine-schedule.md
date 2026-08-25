---
type: schedule
division: commercial
department: sales
team: outbound-engine
status: new
metrics: [sales.sending_identity_isolated, sales.claim_provenance_rate, sales.complaint_rate, sales.suppression_integrity, sales.qualified_conversation_rate]
updated: 2026-08-24
links: ["[[outbound-engine-charter]]", "[[outbound-engine-premortem]]", "[[outbound-engine-loops]]", "[[outbound-engine-directive]]", "[[outbound-engine-agenda-board]]", "[[sales-schedule]]", "[[design-partner-operations-charter]]", "[[compliance-privacy-charter]]", "[[reliability-sre-charter]]", "[[skills-charter]]"]
---

# Outbound Engine — Schedule & Skills

> **A dormant team's schedule should be short.** Everything below that is not marked
> *dormant* is design work with nothing to send. If this table grows while the entry
> trigger is unmet, that growth is the symptom ([[sales-premortem]] M5).

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| **Per-commit** | **Identity guard** — no outbound-path module may reach `GmailService` (`gmail.service.ts:76-78`). CI check in the shape of `scripts/check_no_direct_stock_writes.sh`. | `sales.sending_identity_isolated` → L1 |
| **Monthly** | **Entry-trigger check** — has [[design-partner-operations-charter]] produced a **landed** credit? Has the founder un-deferred the list? Both no ⇒ the team stays dormant and the check is the whole month's output. | Trigger state → [[outbound-engine-agenda-board]] |
| **Quarterly** | **Claim provenance audit** — every assertion in live copy traced to its evidence; untraceable claims **pulled, not footnoted**. Trivial while the allowlist is empty, which is the point. | `claim_provenance_rate` → L2 |
| **Daily** | **Volume safety** — complaint rate, bounce rate, reputation. Above threshold ⇒ volume to zero automatically. **DORMANT.** | `complaint_rate` → L4 |
| **Weekly** | **Suppression integrity** — worst-case stop-request latency, not the average. **DORMANT.** | `suppression_integrity` → L3 |
| **Fortnightly** | **Qualification calibration** — rubric vs cohort; `qualified_conversation_rate > 60%` escalates **upward**. **DORMANT.** | `qualified_conversation_rate` → L5 |
| **One-off — this quarter** | **Design block** — write the guard, decide (do not purchase) the sending identity, draft suppression, freeze the rubric, create the empty allowlist, file the legal-basis question with [[compliance-privacy-charter]], add the outbound-reputation note to the procurement runbook with [[reliability-sre-charter]]. | 4 documents + 1 CI guard |
| **One-off — 2026-11-24** | **Survival review** — no landed credit ⇒ this team is the half of Sales that folds into [[growth-charter]]. Pre-agreed, not a judgement call. | Decision |

**Anti-sprawl rule in force:** a scheduled job producing no action for **3 runs** is
downgraded or deleted. Applied honestly, that rule points at this team harder than at any
other in the department: **the three dormant jobs will produce nothing for three runs by
design.** They are exempt only because they are marked dormant and carry an explicit
trigger. The moment one of them starts producing output while the trigger is unmet, it is
not a working loop — it is the team manufacturing activity, and it should be deleted rather
than celebrated.

The **monthly entry-trigger check** is deliberately the only recurring job with any content
while dormant. It exists so that "deferred" does not silently become "abandoned", and so
the dormancy is re-decided every month rather than drifted into.

## Skills owned

Skills live in `.claude/skills/` — **which does not exist yet** ([[skills-charter]]).
Candidates only, each with a trigger, a doneability criterion, and a real past instance per
[[README]] §3.3. No speculative skills — a rule that bites hardest here, since this team
has no operations to harvest from.

| Candidate | Tier | Trigger | Doneability | Real past instance |
|---|---|---|---|---|
| `sending-identity-guard` | T3 | Any commit touching a sales/outbound path | Fails if `GmailService` is reachable from an outbound module | The single shared transactional identity is real and load-bearing today (`gmail.service.ts:76-78`; `communications.controller.ts:1028-1031`); the repo already runs five grep-grade guards of exactly this shape |
| `claim-provenance-check` | T2 | Any draft containing a customer-outcome claim | Each assertion traces to verified evidence, or is removed before the draft leaves review | `.planning/YC_WEDGE_PLAN.md:31-33` — "dollars recovered" meaning *"we asked"*. Also: the stale citations found in this session (`:233,:265` → `:400,:438`; "256 lines" → 406) prove provenance rot is already occurring in this repo |
| `suppression-honour-check` | T3 | Any stop request | Sender domain suppressed **per-domain** within 24h and the sequence stop path confirms | Not yet — **gated.** Do not author until sending exists; a skill with nothing to fire on is the sprawl [[skills-charter]] exists to prevent |

**Two of three are authorable today. The third deliberately is not**, and saying so is the
point: this team could easily fill a skills registry with plausible outbound procedures it
has never run. The §3.3 rule — *cite a real past instance, no speculative skills* — is the
thing standing between a dormant team and a skill library full of fiction.

**Not owned here.** Copy craft ([[media-brand-charter]]), the legal basis
([[compliance-privacy-charter]]), the recovery number
([[design-partner-operations-charter]] / [[analytics-bi-charter]]), and anything touching
the target list — which does not exist and is not this team's to create.
