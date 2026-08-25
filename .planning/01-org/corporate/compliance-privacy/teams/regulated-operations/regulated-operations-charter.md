---
type: charter
division: corporate
department: compliance-privacy
team: regulated-operations
status: new
metrics: [regops.trigger_check_freshness, regops.jurisdiction_count, regops.deadline_miss_count, regops.excise_reconciliation_variance]
updated: 2026-08-24
links: ["[[regulated-operations-premortem]]", "[[regulated-operations-directive]]", "[[regulated-operations-loops]]", "[[regulated-operations-schedule]]", "[[regulated-operations-agenda-full]]", "[[regulated-operations-agenda-board]]", "[[compliance-privacy-charter]]", "[[regulatory-posture-charter]]", "[[privacy-engineering-charter]]", "[[legal-charter]]", "[[commercial-workforce-agreements-charter]]", "[[agent-fleet-charter]]", "[[inventory-ledger-charter]]", "[[supplier-distributor-network-charter]]", "[[product-vision-charter]]", "[[decision-office-charter]]", "[[corporate]]"]
---

# Regulated Operations — Charter

> ## ⏸ TRIGGER-GATED — NOT STAFFED AT v0
>
> **This team does not exist as an operating function.** It is a named track with an
> explicit entry trigger, a dormant charter, and a quarterly five-minute check that
> is the only recurring work it owns. Nothing below describes capability. `status: new`
> is the honest grade and it should not be softened by the length of this document.

## Entry trigger

The team staffs when **either** of these fires:

1. **First customer in a jurisdiction where we hold or touch a licence** — where the
   platform's operation implicates an alcohol licence, ours or theirs, in a way that
   creates a reporting or record-keeping duty on us.
2. **The first time excise reporting appears in a signed MSA** — the moment a
   contract obliges us to produce, compute, or file anything excise-related.

Either fire staffs the team. Neither is a judgement call at check time: both are
events with a date and a document, which is deliberate — a trigger that requires
interpretation is a trigger that never fires
([[regulated-operations-premortem]] M1).

**Who checks, and how often:** [[compliance-privacy-schedule]] owns a quarterly
trigger check. That single recurring job is the entire counter-pressure against this
charter becoming decorative, and it is why a dormant team gets a `schedule.md` at all.

## Mandate (dormant)

Regulated Operations owns the beverage platform's **operational** regulatory
exposure: alcohol licensing, excise tax computation and filing, three-tier
distribution constraints, regulatory deadlines and their evidence trail — the
compliance obligations that attach to *moving and selling alcohol*, as distinct from
the compliance obligations that attach to *holding personal data*.

## Why it is named but not staffed

A wine and beverage platform touching real inventory has genuine excise and licensing
exposure. The repo already reserves the work with a declared stub. But folding it into
[[regulatory-posture-charter]] would make that team's mandate incoherent: **GDPR and
excise tax share a word and nothing else.** Not a regulator, not a subject, not a
control surface, not a failure mode, not a body of expertise. A single team spanning
both would define its own boundary as "things that sound legal", which is not a
boundary.

So it is preserved as a named track with an explicit entry trigger — exactly the
pattern the founder already accepted for NF-C in [[README]] §4.3: *"preserved as
ambition, not carried as dead weight."*

**The alternative that was rejected:** deleting the team and re-creating it when the
trigger fires. Rejected because the trigger fires *during* a deal or a market entry,
which is the worst moment to discover the scope has no owner, and because the stub in
the codebase already implies the work exists — a named-and-dormant track is more
honest than an unnamed one with a stub agent sitting in the fleet.

## Boundaries (on activation)

Would own outright:

- **Licence inventory** — which licences we hold, which our customers hold, which of
  their obligations touch our data or our actions.
- **Excise computation and filing** — the tables, rates, jurisdictions, and the
  reconciliation between what inventory says moved and what was reported.
- **Regulatory deadlines** — the calendar, the evidence, and the proof of filing.
- **Three-tier constraint enforcement** — which is *already partially implemented*
  and currently unowned: `services/agent-orchestrator/services/constraint_engine.py`
  carries a `THREE_TIER_PATTERNS` block (C-19 `THREE_TIER_COMPLIANCE`, `:38-41`)
  blocking phrases such as *"direct-from-winery"* in outbound drafts. That control
  exists, runs today, and has no charter behind it. On activation it comes here.
- **The `compliance_agent` stub** and any successor — implementing it, or deleting it.

## Explicit non-goals

| Not ours | Whose | The line |
|---|---|---|
| **Privacy law — GDPR, CCPA, DPAs, subprocessors** | [[regulatory-posture-charter]] | The reason this team exists as a separate track. Shares a word, nothing else. |
| **Privacy controls, consent, erasure, PII** | [[privacy-engineering-charter]] | Different subject entirely. |
| **Drafting the licence application or the MSA clause** | [[commercial-workforce-agreements-charter]] / [[legal-charter]] | Legal drafts instruments; we own the obligation and the filing. Same split as CORP-F2. |
| **Inventory truth — what moved, how much, when** | [[inventory-ledger-charter]] | Excise reporting *consumes* the ledger. If we compute our own movement numbers there will be two answers and the tax authority will pick one. |
| **Supplier and distributor relationships** | [[supplier-distributor-network-charter]] | They manage the relationship; we own what the three-tier rules forbid saying and doing. |
| **Agent implementation and the fleet** | [[agent-fleet-charter]] | If `compliance_agent` is ever implemented, they own the runtime; we own its obligations. |

## Metrics it moves (all dormant)

| Metric | Definition | Today |
|---|---|---|
| `regops.trigger_check_freshness` | **The only live metric.** Days since the entry trigger was last checked. | **never checked** |
| `regops.jurisdiction_count` | Jurisdictions where we hold or touch a licence | **0** |
| `regops.deadline_miss_count` | Filing deadlines missed. Target hard 0. | 0 over an empty set |
| `regops.excise_reconciliation_variance` | Difference between ledger-reported movement and excise-reported movement | undefined |

**Only the first is measurable and only the first matters right now.** A dormant team
whose trigger-check freshness is unbounded is not gated; it is forgotten, and those
are indistinguishable from outside.

## Evidence today

**Stub only.** Everything below is a reservation of work, not work.

### The declared stub

`services/agent-orchestrator/agents/compliance_agent.py`:

- `IS_STUB = True` (`:16`), with the reasoning in the file (`:11-15`): declaring it
  means *"the orchestrator refuses to start it rather than running an agent that
  consumes events and produces nothing, which reads identically to a working one from
  every dashboard and health check."*
- Subscribes to `compliance.deadline.created` and `compliance.report.requested`
  (`:24-27`) — the event vocabulary is reserved even though nothing serves it.
- `process_message()` logs the routing key and payload keys, then two TODOs (`:40-41`):
  *"Insert compliance_deadlines"* and *"Generate compliance_reports and
  excise_tax_records"*.
- `services/agent-orchestrator/core/orchestrator.py:245-250` enforces the refusal —
  an enabled stub fails loudly at boot: *"Failing loudly at boot is the only version
  of this that cannot be mistaken for working."*

**That refusal is the single most valuable thing this team inherits**, and it is a
pattern worth carrying into the team's own governance: a dormant function that *looks*
active is worse than an absent one. The same argument applies to a charter — which is
why this document opens with a banner rather than a mandate.

### The one control that already runs, unowned

`services/agent-orchestrator/services/constraint_engine.py:38-41` — `THREE_TIER_PATTERNS`
under constraint **C-19 `THREE_TIER_COMPLIANCE`**, matching phrases like
*"direct-from-winery"* in outbound provider communications. It executes on every
draft, today, in the same engine as the C-21 PII guard.

**This is a live regulatory-operations control with no charter behind it.** It is
enforced by [[privacy-engineering-charter]]'s neighbour code and owned by nobody. On
activation it belongs here; until then it should be noted in
[[regulatory-posture-charter]]'s register as *an operating control with no owner*,
because an unowned control is a control nobody will notice breaking.

### What does not exist

No `compliance_deadlines` table. No `compliance_reports`. No `excise_tax_records`.
No licence inventory. No jurisdiction list. No filing calendar. The event names exist;
nothing produces or consumes them.

## Open forks touching this team

- **CORP-F4** ([[corporate]] §7) — **Is Regulated Operations Corporate's at all**, or
  does it belong to Product once a licensing feature exists? Answering it now costs
  nothing; answering it after the trigger fires means a re-org during a deadline. This
  charter takes no position beyond noting that the argument for Product is real: if
  excise ever becomes a *feature* rather than an *obligation*, the team follows the
  feature.
- **What happens to `compliance_agent`** if the trigger never fires. A stub that is
  correctly declared and permanently dormant is still inventory. The
  30-day/3-run anti-sprawl logic ([[README]] §6) has no equivalent for a stub agent,
  and it probably should.
