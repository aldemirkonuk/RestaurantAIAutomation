---
type: premortem
division: commercial
department: finance-pricing
team: inference-cost
status: provisional
metrics: [fin.spend_reconciliation_variance_pct, fin.spend_attribution_coverage_pct, fin.metered_invocation_coverage_pct, nf_a.cost_per_completed_task, fin.monthly_provider_spend_vs_cap_pct]
updated: 2026-08-24
links: ["[[inference-cost-charter]]", "[[inference-cost-loops]]", "[[inference-cost-directive]]", "[[inference-cost-agenda-full]]", "[[finance-pricing-premortem]]", "[[neural-footprint-instrumentation-charter]]", "[[harness-model-routing-charter]]", "[[agent-evaluation-gates-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]"]
---

# Inference Cost — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. This team has failed. What happened?

Five mechanisms, most likely first. Note that none of them is "we could not build the
instrumentation." The instrumentation is easy. Every mechanism below is a way of ending
up with a number that is confidently wrong.

---

### M1 — The silent meter: a logging failure read as a cheap month

`SpendLogger.log()` is designed never to raise. `spend_logger.py:82-84` catches every
exception and emits `logger.warning(f"SpendLogger.log() failed (non-fatal): {exc}")`, and
the module header at `:7-8` states the contract: *a spend logging failure must not
interrupt the extraction pipeline*. That is correct engineering — a spend logger that can
take down invoice extraction is worse than no spend logger.

It is also a reporting hazard, and the hazard has a second, sharper edge that is easy to
miss: **the alarm reads the same table as the meter.** The hourly cap check sums
`cost_usd` directly out of `api_spend` (`spend_tasks.py:34-58`). A rotated Supabase key,
a schema mismatch, a network partition — any of these stops rows arriving. Spend appears
to fall. The cap check agrees, and goes quiet. One failure disables both the measurement
and the mechanism that was supposed to notice the measurement was wrong.

Twelve months on: F1 has reported a falling cost per task for two quarters, the Anthropic
invoice has been climbing throughout, and nobody reconciled the two — because
reconciliation was never anyone's job.

**Earliest observable signal.** A calendar month whose `api_spend` **row count** falls
while commits touching enrichment, extraction or agent runs keep landing. A cheaper month
nobody made cheaper. Operationally: `fin.hours_since_last_spend_row` exceeding one working
day with Celery beat green.

**Counter-pressure.** Two, both cheap, both in [[inference-cost-loops]]:

1. **L-IC-2 fires on absence.** The existing cap check can only trip on a *large* sum; it
   is structurally incapable of tripping on an *empty* one. Absence needs a detector of
   its own, and it must not read `api_spend` as its only liveness signal — it correlates
   row age against pipeline activity.
2. **L-IC-1 reconciles monthly against the provider console.**
   `fin.spend_reconciliation_variance_pct` is the number this whole failure mode is
   invisible without. Nobody else wants it. That is why the charter names it as the
   metric F1 alone owns.

---

### M2 — The `agent` column was added and the callsites never were

The first assignment lands: `SpendLogger.log()` gains an `agent` parameter and
`api_spend` gains an `agent` column. Because the module must never raise, the parameter
ships as `Optional[str] = None` — the safe choice, matching `restaurant_id`'s existing
shape at `:48`. Three of the sixteen callsites are updated in the same PR. The other
thirteen are "next sprint."

Six months later `fin.spend_attribution_coverage_pct` sits at 19% and the cost-per-agent
dashboard renders beautifully — over the three agents that pass the parameter. Those three
happen to be the cheap ones. The routing recommendation that goes to
[[harness-model-routing-charter]] is derived from a fifth of the spend and reads as
authoritative.

**Earliest observable signal.** `fin.spend_attribution_coverage_pct` above 0% and **flat
below 100% for two consecutive close-times**. A partially-adopted parameter is a worse
state than an unadopted one, because it produces a number.

**Counter-pressure.** Make the adoption **mechanical, not disciplinary**:

- Ship the parameter and update all 16 callsites in **one change**. Sixteen is small;
  this is a one-sitting job and it never gets easier.
- Push the constraint into the type system where possible: a required keyword argument
  makes a missed callsite a test-time failure rather than a silent `None`. That trades
  against the never-raise contract (`spend_logger.py:7-8`) and is therefore a founder
  decision, not F1's — see [[inference-cost-directive]] and
  [[inference-cost-agenda-full]] Q3.
- If the parameter stays optional, the column is **`NOT NULL DEFAULT 'unattributed'`**, so
  a missing agent is a visible row rather than an absent one. A null reads as "no data";
  `unattributed` reads as "we did not instrument this", which is the true statement.
- Report coverage **beside** every cost-per-agent figure, always
  ([[inference-cost-directive]]'s grade rule).

---

### M3 — F1 built a second footprint and RM-3's contract landed on top of it

Cost per task needs task identity, latency, retries and a doneability verdict — four of
the eight NF-A fields (`foundation README §4.2`), and **all four belong to**
[[neural-footprint-instrumentation-charter]]. OD-11, the column-level contract, is open
([[OPEN-DECISIONS]]:20) and will not close quickly.

F1 is impatient and correct to be: its first assignment is blocked on exactly these
fields. So it adds `agent`, `task_type`, `latency_ms`, `retry_count` and eventually
`verdict` to `api_spend` — a table it owns, so no permission is needed. Six weeks later
RM-3's NF event table ships. Now two cost ledgers exist, they disagree on the retry
convention, and neither is retired because both have consumers. This is precisely the
failure RM-3's own premortem predicts: *five private footprints and no appetite to
migrate* (`.planning/foundation/teams/intelligence.md:178-181`).

**Earliest observable signal.** Any migration touching `api_spend` merged without an RM-3
sign-off. Or, earlier: the first F1 document naming a column that is not on the eight-field
NF-A list.

**Counter-pressure.** A written, narrow bridge:

- F1 adds **exactly two** columns alone — `agent` and `task_type` — because they are the
  minimum to make the primary metric derivable, and they are money-view attribution rather
  than telemetry.
- Latency, retries and verdict come **from RM-3's spine by join**, never by column. If the
  spine is not ready, the metric reports *unmeasured* — which is the honest state and is a
  publishable grade under [[inference-cost-directive]].
- The bridge columns carry a **retirement condition in the migration comment itself**,
  tied to OD-11 closing. A retirement condition in a planning document is a retirement
  condition nobody will find.

---

### M4 — The cost-efficiency mandate was met by a model that failed more

The founder's goal is explicit: reduce inference cost by routing to cheaper models where
they suffice. Haiku replaces Sonnet on extraction. Cost per API call drops 60% and F1
reports it. What is not reported, because F1 cannot see it, is that the cheaper model's
outputs fail [[agent-evaluation-gates-charter]]'s verdict more often, each failure is
retried two or three times, and **cost per completed task rose**. The mandate was
satisfied against the wrong denominator, and the company got more expensive while its
finance team reported savings.

**Earliest observable signal.** Cost per API call falling and total call volume rising in
the same window — the arithmetic signature of retries — with no corresponding change in
completed-task volume.

**Counter-pressure.** The denominator rule, stated in the charter and enforced in
[[inference-cost-directive]]: the published metric is cost per **completed** task, where
completed means a passing verdict from RM-2. `cost_per_api_call` may never appear in any
artifact without `cost_per_completed_task` beside it. This is not a stylistic preference —
it is the only thing that stops the cost-efficiency mandate from inverting. RM-1's own
metric definition already says the same thing (`intelligence.md:96-98`), and the two teams
agreeing on the denominator is what makes the routing loop trustworthy.

---

### M5 — The caps were raised every time they tripped, until they meant nothing

`spend_tasks.py:24-27` alerts at **$40** Anthropic / **$16** Google, 80% of $50 / $20 hard
caps, against a `~$10-20/month` deployment budget (`.planning/PROJECT.md:136`). These
numbers were chosen when the denominator was one design partner who is **not yet
connected** (`DEP-06` unchecked, `PROJECT.md:101`).

Real load arrives. The cap trips mid-month, an extraction pipeline stalls, and the fix
takes four minutes: raise the threshold. It happens again. By the third raise the cap is
tracking spend rather than constraining it, the alert has been muted in the mail client,
and the company has no ceiling — which it discovers on an invoice.

**Earliest observable signal.** The **first** cap raise that is not accompanied by a
written cost-per-restaurant-month figure. Also: any month where `spend_alert_state`
records a breach and the following month's threshold is higher.

**Counter-pressure.** L-IC-3 / L-FIN-5's rule: **a cap raise requires a cost-to-serve
figure as its justification**, supplied by [[unit-economics-pricing-charter]]. This is the
one mechanism that makes the dormant sibling's single number load-bearing rather than
decorative, and it turns a four-minute reflex into a decision with an owner. A raise
without that figure escalates to [[decision-office-charter]].

---

## Cross-cutting counter-pressure

- **Every mechanism above produces a wrong number, not a missing one.** That is why
  [[inference-cost-directive]]'s three grades — MEASURED / LEDGER-ONLY / UNMEASURED —
  attach to figures rather than to intentions. A figure that cannot state how it was
  obtained does not leave the team.
- **The sibling premortem covers what fails between the teams.**
  [[finance-pricing-premortem]] D1 (credibility laundering) and D3 (the pricing anchor)
  are not restated here.
- **Advisory is findings-only** ([[ORG_STRUCTURE]] §3). [[red-team-charter]] should attack
  M2's required-versus-optional trade and M3's bridge-column scope; both are decisions,
  which is its remit.
- **Anti-sprawl applies to this document.** Nothing revisited in 60 days is fiction
  (`foundation README §3.3, §6`).
