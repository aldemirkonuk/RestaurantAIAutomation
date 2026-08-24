---
type: premortem
division: intelligence
department: analytics-bi
team: analytics-engine
status: provisional
metrics: [analytics.satisfiable_candidate_share, analytics.candidate_type_count, analytics.engine_service_test_ratio]
updated: 2026-08-24
links: ["[[analytics-engine-charter]]", "[[analytics-engine-loops]]", "[[analytics-engine-directive]]", "[[analytics-bi-premortem]]", "[[insight-narrative-generation-charter]]", "[[metric-contract-truth-assurance-charter]]", "[[data-charter]]", "[[red-team-charter]]"]
---

# Analytics Engine — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. This team has failed. What happened?

### M1 — The catalogue grew faster than the data, and reach fell while the count rose

This is the premortem `intelligence.md:389-392` already wrote for this team: *"new math is
added faster than data arrives, so the catalogue grows while `satisfiable_candidate_share`
falls — an engine that is impressive in tests and silent in production."*

Twelve months on: `INSIGHT_CANDIDATES.length` is 700+. `satisfiable_candidate_share` is
below the **25.1%** it started at, because the new dimensions leaned on `checks` and
`tables` — the two requirements that already gate 429 (74.9%) and 241 (42.1%) of the
existing space. The explorer page lists hundreds of types that grey out for every live
restaurant. Adding math is pleasant, fast, testable, and entirely within this team's
control; getting a POS integration live is none of those things. So the team did the
pleasant thing for a year.

**Earliest observable signal.** The first pull request adding a `DIMENSION` or `MEASURE` to
`insight-catalog.ts` whose `DataRequirement` set is unsatisfied for **every** live
restaurant. Not the tenth — the first. It is mechanically detectable today:
`availableCandidates()` already computes the answer (`insight-catalog.ts:557-563`).

**What would have prevented it.** Turn the filter into a **gate**. `availableCandidates()`
runs at query time and never blocks anything; CI should refuse a new candidate family whose
requirements no live restaurant satisfies, and the exception path is an escalation to
[[data-charter]], not a merge. Paired with [[analytics-bi-directive]] rule 2: the count
never appears without the share beside it, so "we shipped 127 new types" cannot be reported
as progress on its own.

---

### M2 — The engine was tested and the pipeline was not, so correct functions produced wrong insights

The engine has **149 `it()` cases** over 131 exported functions. The service layer that
*calls* those functions — `insight-generator.service.ts` at 1,200 lines — has **zero spec
files**. Twelve months on, every unit test is green, and the reported insight for a
restaurant is wrong, because the bug is in the wiring: a window boundary at
`insight-generator.service.ts:211-212` (90 days for consumption, 180 for orders), a
`Promise.allSettled` branch silently swallowing a failed table read, an entity label
mismatched to its evidence.

The tell that this is the likeliest mechanism, not a hypothetical: **`pValue` and `chi2`
appear in zero assertions across all 11 spec files**, and `pValue < 0.1`
(`insight-generator.service.ts:872`) is the only significance gate anywhere in the
pipeline. The one number that decides whether the product speaks is the one number nothing
checks.

**Earliest observable signal.** A green CI run alongside a manually-verified insight that
does not reproduce when the same query is run by hand. Also, mechanically: any change to
`insight-generator.service.ts` merging with no spec file in the diff — which is, today,
every change to it.

**What would have prevented it.** A **fixture-driven** spec for the generator: a fixed
synthetic bundle in, a fixed set of insight keys and evidence values out. It needs no
database, because the engine is pure and the bundle is a plain object. Start with the
basket family end-to-end — transactions → contingency table → χ² → `pValue` → the
`> 1.3 / < 0.1` gate — because that is the shortest path from untested arithmetic to a
sentence in front of a customer.

---

### M3 — Thousands of simultaneous tests, one uncorrected threshold, and the insights were noise

573 candidate types multiply by live entities at runtime — every table, every waiter, every
wine — which the catalogue's own comment acknowledges puts "the effective space in the
thousands" (`insight-catalog.ts:542-546`). Against that, the pipeline's entire
significance discipline is `pValue < 0.1` on one family (`:872`) and `|z| >= 3` on
anomalies (`:1107`).

At p < 0.1 with thousands of comparisons per run, false discoveries are the *expected*
output, not the exception. Twelve months on, a manager has learned that the insight feed
is usually wrong, has stopped reading it, and the department's headline capability has
negative value: it costs attention and returns noise. Nobody detects this from inside,
because each individual computation is arithmetically flawless.

**Earliest observable signal.** `analytics.insight_acceptance_rate`
([[insight-narrative-generation-charter]]) falling while `analytics.candidate_type_count`
rises. Also, directly checkable today: run the generator twice on shuffled/permuted data
and count how many "significant" findings survive. Any that do are the false-discovery
rate, measured rather than argued.

**What would have prevented it.** A **family-wise discipline that is explicit and owned**:
either a Benjamini–Hochberg correction across the candidates evaluated in one run, or a
hard cap on findings-per-run with the threshold tightened until the cap binds. Both are
arithmetic, so both are ours. And the permutation check above becomes a scheduled job
([[analytics-engine-schedule]]) — it is the cheapest honest falsification available and it
needs no simulator, no POS feed, and no customer.

---

### M4 — The availability filter lied, because nothing tested the requirement declarations

`availableCandidates()` is the department's honesty mechanism: it is how
`satisfiable_candidate_share` gets computed and how [[data-charter]] gets told what to
build. It is only as truthful as the `requires` arrays feeding it — and **there is already
one wrong declaration in the file today**.

`insight-catalog.ts:38` declares `goals` as a `DataRequirement`. Twenty-two candidates
carry `comparator: "goal_pace"` and `category: "goals"`. **None of them declares
`requires: ["goals"]`**, because `goal_pace` is pinned to the `overall` dimension (`:520`)
whose `requires` is empty, and no measure supplies it. So `availableCandidates()` reports
22 goal-pace types as computable for a restaurant with no goals. Small today; the pattern
is not. Every future dimension inherits the same silent failure mode, and the metric the
whole department leans on quietly overstates reach.

**Earliest observable signal.** A `DataRequirement` union member with **zero** candidates
declaring it. That is a one-line check and it is red right now.

**What would have prevented it.** A spec case asserting that every member of the
`DataRequirement` union is claimed by at least one candidate, **and** that removing a
requirement from the available set removes the families that visibly depend on it — the
shape `insight-catalog.spec.ts:36-44` already uses for `checks`, generalised to all seven.

---

### M5 — Purity eroded one convenience at a time

The engine's single most valuable property is that it is pure: no NestJS, no database
(`insight-catalog.ts:14-17`, `engine/index.ts:1-18`). That is what makes it exhaustively
testable, reusable from cron jobs and scripts, and — critically — what makes the candidate
space *countable*, which is the precondition for
[[metric-contract-truth-assurance-charter]] doing any work at all.

Then a function needs a restaurant's timezone. Then one needs a feature flag. A
`DatabaseService` import lands in `engine/`, "just for this one". Within two quarters the
engine cannot be executed outside a Nest context, `INSIGHT_CANDIDATES.length` can no longer
be computed by a script, and the count that this whole department disagreed about becomes
genuinely unanswerable.

**Earliest observable signal.** The first `import` in `apps/api-gateway/src/analytics/engine/`
that is not from `./`-relative siblings. Trivially greppable, and it should be a CI check
on day one — the same shape as the existing `scripts/check_no_direct_stock_writes.sh:1-13`.

**What would have prevented it.** A CI guard on the engine's import graph, plus the
standing rule that anything needing I/O belongs in the service layer that calls the engine,
never inside it. Note the honest caveat that
[[engineering-premortem]] M4 raises about grep-shaped guards: this one is a grep, so it
gets an outcome-side twin — a scheduled job that executes `INSIGHT_CANDIDATES.length` from a
bare `ts-node` script with no Nest context. If that script stops working, purity is gone
regardless of what the grep says.

---

## Cross-cutting counter-pressure

- **This team's failures are all invisible from inside it.** M1, M3 and M4 each look like
  success locally (more types, more insights, higher reported reach). Every counter-pressure
  above is therefore an *external* reading:
  [[metric-contract-truth-assurance-charter]] audits M4's declarations,
  [[insight-narrative-generation-charter]]'s acceptance rate detects M3, and
  [[data-charter]] is the only unit that can close M1.
- **[[red-team-charter]] should attack M3 first** — it is the mechanism where the team is
  most likely to defend itself with correct arithmetic while being substantively wrong.
- **Anti-sprawl applies.** If nothing here has been revisited in 60 days it is fiction
  (foundation §3.3). The two checks that are red *today* — the unused `goals` requirement
  and the untested `pValue` path — are the ones to look at first.
