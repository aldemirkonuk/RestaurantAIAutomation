---
type: premortem
division: intelligence
department: analytics-bi
status: provisional
metrics: [analytics.kpi_ground_truth_agreement, analytics.insight_acceptance_rate, analytics.satisfiable_candidate_share, analytics.metric_claim_divergence_count]
updated: 2026-08-24
links: ["[[analytics-bi-charter]]", "[[analytics-bi-loops]]", "[[analytics-bi-directive]]", "[[analytics-engine-premortem]]", "[[insight-narrative-generation-premortem]]", "[[metric-contract-truth-assurance-premortem]]", "[[red-team-charter]]", "[[decision-office-charter]]", "[[data-charter]]", "[[security-charter]]"]
---

# Analytics & BI — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. Analytics & BI has failed. What happened?

### M1 — AB-3 was staffed last, so the department became two authors and no auditor

The engine existed on day one. The insights existed on day one. `metric-registry.ts`
existed. What did **not** exist was a single assertion that any published number matched
its definition — and AB-3's primary metric started at **0%**, blocked on somebody else's
phase (`v3.0-TECH-DEBT.md:322-325` → `:309`). A team whose number cannot move for two
quarters loses to teams whose numbers can. AB-1 and AB-2 shipped; AB-3 wrote a document.

By the time the department noticed, the divergence had grown rather than shrunk: the
insight-type count was published as 375 in the UI and 573 in the fundraising deck, a
prospect asked which was true, and the answer required someone to run the code.

**Earliest observable signal.** Two close-times pass with
`analytics.metric_claim_divergence_count` unpublished while
`analytics.satisfiable_candidate_share` gets a weekly reading. Concretely: a board
([[analytics-bi-agenda-board]]) where the AB-3 row is the only one with no number in it.

**What would have prevented it.** AB-3 gets a metric that is **measurable on day one**
and does not wait on SimPOS: `analytics.metric_claim_divergence_count` — a census of
every place the product publishes a count, and how many distinct values that count has.
It is countable this afternoon (baseline ≥ 2, with sources listed in
[[analytics-bi-charter]]), it needs no simulator, and it is a real audit. The blocked
metric (`kpi_ground_truth_agreement`) is published *alongside* it at 0% with its blocker
named, per `intelligence.md:466-469` — *"publishing the 0 is the point."*
[[decision-office-charter]] holds the escalation to Engineering on a named close-time so
"blocked" cannot decay into "not our fault."

---

### M2 — The department optimised for surface area, and the surface area was the diagnosis

`AGENT_NATIVE_UI_DECISION.md:105-108` already wrote this failure down before the
department existed: *"the 573-insight engine and the dark UX optimizer are the same
failure mode — combinatorially impressive systems built without a paying customer pulling
on them."* And `YC_WEDGE_PLAN.md:324-326` says a partner reads that breadth as **no
wedge**.

Twelve months on, the catalogue is at 700 types. `satisfiable_candidate_share` is *lower*
than the 25.1% it started at, because new dimensions needed POS data nobody had. Nobody
can name an insight that changed a purchase order. The department's flagship artifact is
a picker page listing types the product cannot compute.

**Earliest observable signal.** A pull request adding a new `DIMENSION` or `MEASURE` to
`insight-catalog.ts` whose `DataRequirement` set is not satisfiable for any live
restaurant. Not the tenth — the **first**. Second signal: three consecutive close-times
where `INSIGHT_CANDIDATES.length` rises and `analytics.insight_acceptance_rate` does not.

**What would have prevented it.** A hard rule in [[analytics-bi-directive]]: **no
candidate type enters the catalogue whose `DataRequirement` set is unsatisfied for every
live restaurant.** The mechanism already exists — `availableCandidates()`
(`insight-catalog.ts:557-563`) — it simply is not used as a gate. And the two numbers are
published on the same row of the board: catalogue size **never** appears without
`satisfiable_candidate_share` next to it. A count with no denominator is marketing.

---

### M3 — `insufficient_data` was designed, then quietly stopped being emitted

The correct posture is already written down: at this scale *"the honest verdict on nearly
every change is 'we cannot tell'"* (`AGENT_NATIVE_UI_DECISION.md:191-192`), and the
prescribed states are `kept_unproven` / `insufficient_data` rather than a fabricated
`improved` (`:332-337`). The verbalizer already returns `null` rather than a sentence
when evidence is thin (`insight-catalog.spec.ts:94-101`).

Then a demo happened. A restaurant with three weeks of data showed an empty insight feed.
The fix was to lower the support floor — `scoreOf`'s support term already saturates at
`n = 14` (`insight-generator.service.ts:200`) and it is a single constant. The feed filled
up. Every sentence in it was computed from four data points. The manager acted on one,
it was noise, and the product lost the only thing it was selling: that the metrics are
right.

**Earliest observable signal.** A commit that changes a minimum-support constant in
`insight-generator.service.ts` — `n / 14` at `:200`, `nonZeroDays < 7` at `:1017`,
`qtys.length < 5` at `:550`, `transactions.length >= 10` at `:867`, `|z| >= 3` at `:1107`
— without an accompanying change to a spec file. Any of them. There is no spec file
covering that service today, which is precisely why this is the likeliest mechanism in
this document.

**What would have prevented it.** Every support floor is a **named, tested constant**,
not a literal buried at line 1017. `insufficient_data` is a rendered UI state owned by
[[insight-narrative-generation-charter]] — an empty feed that *says why it is empty* is a
feature, and it is the honest version of the founder's "show people we have the right
metrics." Lowering a floor requires a changed test, which requires a reviewer, which is
the whole point.

---

### M4 — The consultant layer was switched on for a demo and never switched back

`consultants.service.ts:7-24` is well designed: default OFF, toggle-gated per restaurant,
four personas, *"the prompt forbids inventing numbers"*, every claim citing the evidence
pack, sitting **on top of** the deterministic math rather than replacing it.

It demos beautifully. Someone flips the toggle for a pitch. The toggle is per-restaurant
and there is no expiry. Six weeks later the evidence-pack constraint is loosened "for
richer answers", the model hallucinates a margin figure in front of a customer, and the
credibility cost exceeds everything the deterministic engine earned. The compounding
factor: `PUT /analytics/consultants/:restaurantId/toggle`
(`analytics.controller.ts:516`) is one of 39 unguarded routes, so **anyone on the
internet can flip it too** — OD-20, live today. *Corrected 2026-08-25: OD-20 is
RESOLVED (`analytics.controller.ts:51`), so this compounding factor is gone; the
hallucinated-margin failure below stands on its own.*

**Earliest observable signal.** An `analytics_insight_prefs` row with
`category = 'consultants'` and `enabled = true` that has been true for longer than one
close-time without an owner named. Also: any diff to the system prompt in
`consultants.service.ts` that removes or weakens the "do not contradict the evidence
pack" instruction.

**What would have prevented it.** Toggles expire. A consultant enablement carries a
**named human and an expiry date**, and the department's weekly job
([[analytics-bi-schedule]]) lists every enabled row with its age. Separately: no claim
produced by the consultant layer is ever quoted outside the product without a
deterministic number behind it — the `YC_WEDGE_PLAN.md:31-33` "we asked ≠ we received"
rule generalised. And [[security-charter]] carries OD-20 with a close-time; this
department refuses to demo the consultant layer while the toggle route is unguarded.

---

### M5 — "Show people we have the right metrics" became "show people many metrics"

The founder's priority is that the analytics **sell the product**. Under pressure that
sentence has two readings, and the department picks the wrong one: it publishes the
biggest number it can defend — 573 types, 460 features, 33 registry metrics — instead of
the truest claim it can prove. Then `YC_WEDGE_PLAN.md:31-33`'s distinction collapses:
*"dollars recovered"* stops meaning *we asked* and starts meaning *we recovered*, because
the stronger sentence is the one that closes.

That is not a slip. It is the predictable equilibrium of a department whose mandate is
"the metrics narrative that sells the product" and whose auditor (M1) is the team with
no number.

**Earliest observable signal.** The first external artifact — deck, landing page,
changelog — containing an analytics figure that has no `path:line` provenance in
[[metric-contract-truth-assurance-charter]]'s register. Also: any use of "recovered",
"saved", or "found" in a dollar claim where the underlying event is a *drafted email*
rather than a *received credit*.

**What would have prevented it.** Every externally published analytics claim passes
through one register with three columns: the claim, the code path that computes it, and
the strongest defensible phrasing. AB-3 owns the register and has the right to say a
sentence is false to Marketing and to the founder — the same independence argument
`intelligence.md:443-444` makes for AB-3 against its siblings. The `"we asked"` contract
is the register's first entry, not an example of it.

---

## Cross-cutting counter-pressure

- **The pattern to beat is documented, not hypothetical.** `ANALYTICS_FEATURE_CATALOG.md:5-13`
  records a shipped engine sitting behind a "not built" label for two weeks. Every
  mechanism above is a variant of the same defect: **the label and the thing diverged, and
  nothing in CI noticed.** The department's single most important mechanism is therefore
  a CI assertion, not a document.
- **Advisory is findings-only** ([[ORG_STRUCTURE]] §3). [[red-team-charter]] should attack
  M5 first — it is the mechanism with a commercial incentive behind it, which makes it
  the one this department is least able to police from inside.
- **[[decision-office-charter]] owns the close-times** on the two dependencies this
  department does not control: SimPOS (§44.7, blocking AB-3) and OD-20 (blocking honest
  demos of AB-2's consultant layer).
- **Anti-sprawl applies here too.** If nothing in this document has been revisited in 60
  days it is fiction (foundation §3.3, §6) — and the first thing to check is whether
  `analytics.metric_claim_divergence_count` is still ≥ 2.
