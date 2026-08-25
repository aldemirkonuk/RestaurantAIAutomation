---
type: premortem
division: platform
department: data
team: pos-operational-telemetry-ingest
status: provisional
metrics: [pos.line_resolution_rate, pos.worst_restaurant_resolution_rate, pos.unresolved_queue_depth, sales.density, pos.provider_schema_drift_findings]
updated: 2026-08-24
links: ["[[pos-operational-telemetry-ingest-charter]]", "[[pos-operational-telemetry-ingest-loops]]", "[[pos-operational-telemetry-ingest-directive]]", "[[data-premortem]]", "[[integration-engineering-charter]]", "[[catalogue-identity-charter]]", "[[analytics-bi-charter]]", "[[red-team-charter]]", "[[technology]]"]
---

# POS & Operational Telemetry Ingest — Premortem

> Written at founding, before success is assumed.

The team doc gives one line (`technology.md:677-681`): *ingest is measured by rows landed
rather than rows resolved; the unresolved queue grows unattended; six months of sales data
turns out to be unjoinable to the catalogue, and the analytics engine's baselines were fitted
on the resolvable half.*

That is M1. Four more follow. This team's failures share a property no sibling's do: **they
are unrecoverable.** A missed or unjoinable Tuesday cannot be re-run.

---

## M1 — Rows landed became the metric, and the unresolved queue grew unattended

`pos_unresolved_lines` exists because some check lines never match a catalogue item
(`…20260805133000_pos_unresolved_lines_and_review_queues.sql:12`). The table was created; no
name was attached to draining it. Ingest volume is easy, satisfying and automatic to measure —
webhooks arrive, rows land, the counter goes up.

Six months later the queue holds tens of thousands of lines. `apps/api-gateway/src/analytics/`
(39 routes) has been computing baselines the whole time on whatever *did* resolve. Nobody
knows which half that was, and the biased half is not random: unresolved lines cluster on
unusual items — new listings, specials, high-end bottles, anything typed by hand at the
terminal. The analytics engine has therefore been modelling the restaurant's *ordinary*
business and calling it the business.

**Earliest observable signal.** `pos.unresolved_queue_depth` and ingest volume **rising
together** across two close-times. Either rising alone is ambiguous; both rising is the tell.
Cheaper still: the queue having no named owner on day one, which is observable today.

**Counter-pressure.** The primary metric is **resolution rate, not rows ingested**
([[pos-operational-telemetry-ingest-charter]]) — a definition that makes volume-without-fitness
literally unreportable as progress. `unresolved-queue-drain` has a named owner and a weekly
close-time ([[pos-operational-telemetry-ingest-loops]] loop 1). And
[[analytics-bi-charter]] must declare the resolution rate underlying any baseline it
publishes: an insight computed on 62% of lines is a different object from one computed on 98%,
and the consumer should be told which one it has.

---

## M2 — The fleet average looked healthy and one restaurant was dark

Eleven restaurants, ten of which resolve at 97%, one at 30% because its catalogue was mapped
badly at onboarding. The fleet mean reads 91%. Nothing alarms. The tenth restaurant is
receiving analytics, recommendations and low-stock alerts computed on a third of its
business, and it is the customer most likely to churn while everyone believes the platform is
working.

The mechanism is not that anyone chose a bad metric. It is that a mean is the default, and
per-restaurant reporting is extra work that nobody misses until a customer leaves.

**Earliest observable signal.** Any restaurant more than 20 points below the fleet median for
two consecutive close-times. Structurally: the first dashboard that reports a fleet-level
resolution rate without a minimum beside it.

**Counter-pressure.** The metric is **defined** as per-restaurant — minimum and distribution,
never mean ([[pos-operational-telemetry-ingest-charter]], and the same rule at
[[data-directive]]). Onboarding does not complete until a new restaurant's first-week
resolution rate is measured and above a threshold. A badly-mapped account is cheap to fix in
week one and expensive to detect in month six, and this is the only counter-pressure here
that is genuinely preventive rather than detective.

---

## M3 — Toast changed its schema, and the loss was silent and permanent

There is one provider adapter (`adapters/toast_adapter.py`, `apps/api-gateway/src/toast/`).
A third party ships a change: a field renamed, an enum extended, a modifier restructured,
a nullable that is now populated. The webhook still returns 200 — that is
[[integration-engineering-charter]]'s domain and it is *fine*. The payload is delivered
perfectly and parsed into something subtly wrong: modifiers dropped, a category collapsed,
voids counted as sales.

Rows land. Resolution rate barely moves, because the lines still match *something*. The
corruption is in the semantics, and by the time anyone notices, the affected weeks cannot be
re-fetched, because this is the source that cannot be re-run.

**Earliest observable signal.** A **distributional break**, not an error: mean line count per
check, modifier rate, category mix, void rate, or average check value stepping on a specific
date. `drift_findings` exists for exactly this
(`…20260805133000_pos_unresolved_lines_and_review_queues.sql:82`) and this is what it should be
watching.

**Counter-pressure.** Per-provider **shape monitoring, daily** — distributions rather than
uptime, with a step-change alarm on a named date
([[pos-operational-telemetry-ingest-loops]] loop 3). Raw payloads retained for a stated window
so a re-parse is possible even when a re-fetch is not: **the raw payload is the only artifact
that makes a semantic error recoverable**, and retention is therefore a data decision, not a
storage decision. Schema-change monitoring is shared with
[[integration-engineering-charter]] — they see the contract change, we see the meaning change,
and neither sees both.

---

## M4 — The sales corpus stayed thin, and everything above it was fitted on sand

Sales metrics are graded PARTIAL today: the pipes exist, the corpus does not ([[README]] §1).
Nothing about that is dramatic — it resolves quietly by the corpus never becoming dense
enough to support what is being built on it. The analytics engine keeps shipping insights.
Baselines get fitted on a handful of weeks from a handful of restaurants. Confidence intervals
are either absent or ignored.

This compounds outward: `enrichment_demand_priority`'s `demand_score` is computed from
restaurant inventory and sales (`…20260813170000_enrichment_demand_priority.sql:80-95`). Thin
or biased sales data means the *enrichment queue itself* is mis-ordered — and
[[corpora-enrichment-charter]] would still be reporting a correct-looking demand-weighted
coverage number, computed on a demand signal that is wrong. [[data-premortem]] M1 re-entering
through the back door, wearing the right metric's name.

**Earliest observable signal.** `sales.density` unmeasured — the *absence* of the number is
the signal, and it is absent today. Then: any published insight whose underlying window is
below a stated minimum, and any `demand_score` computed on a restaurant whose resolution rate
is below threshold.

**Counter-pressure.** `sales.density` is one of the department's three mandatory L0 numbers
([[data-loops]] loop 1) — it cannot be omitted from a report. Insights below a density floor
are labelled or withheld, which is a decision for the founder rather than this team
([[data-agenda-full]] Q3). And `demand_score` excludes restaurants below a resolution
threshold, so a bad account cannot silently mis-order the enrichment queue for everyone.

---

## M5 — The seam with Integration was re-litigated during the incident

The line is drawn: they own *delivered correctly*, we own *usable as L0*
(`technology.md:859`). At 9pm, when a restaurant reports missing sales, that line is
beautifully clear on paper and completely unhelpful, because nobody yet knows which side the
fault is on — and finding out *is* the work. Both teams investigate the same thing, or worse,
each waits briefly for the other. The boundary that was supposed to prevent duplicated
ownership produces delayed ownership instead.

**Earliest observable signal.** The first incident whose write-up contains a paragraph
arguing about which team it belonged to. Also: any `questions.md` entry naming both units and
answered by neither within one close-time.

**Counter-pressure.** The seam gets a **triage rule that resolves before diagnosis, not
after**: an ingest incident is owned by whoever can answer *"did the payload arrive intact?"*
first — Integration by default, because that question is upstream and cheap. Ownership
transfers to this team the moment the payload is confirmed intact, and the transfer is
recorded. Neither team is allowed to hold an incident jointly: **a seam with two owners has
none.**

---

## Cross-cutting

- **Unrecoverability is what makes this team different.** M1, M3 and M4 all produce permanent
  losses. That is the argument for detective controls running *daily* here where weekly is
  fine elsewhere.
- **M4 leaks upward into a sibling's metric.** A thin or biased sales corpus corrupts
  `demand_score` and therefore [[corpora-enrichment-charter]]'s primary number, which will
  still look correct. Cross-team metric dependencies are recorded in
  [[pos-operational-telemetry-ingest-loops]] for that reason.
- **[[red-team-charter]]** attacks the seam design (M5) and the density-floor decision (M4).
- **60-day rule** ([[README]] §3.3): un-revisited, this document is fiction.
