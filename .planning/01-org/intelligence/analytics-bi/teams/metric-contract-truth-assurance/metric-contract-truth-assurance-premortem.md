---
type: premortem
division: intelligence
department: analytics-bi
team: metric-contract-truth-assurance
status: provisional
metrics: [analytics.kpi_ground_truth_agreement, analytics.metric_claim_divergence_count, analytics.registry_binding_share, analytics.silent_zero_paths]
updated: 2026-08-24
links: ["[[metric-contract-truth-assurance-charter]]", "[[metric-contract-truth-assurance-loops]]", "[[metric-contract-truth-assurance-directive]]", "[[analytics-bi-premortem]]", "[[analytics-engine-charter]]", "[[insight-narrative-generation-charter]]", "[[engineering-charter]]", "[[agent-evaluation-gates-charter]]", "[[decision-office-charter]]", "[[red-team-charter]]"]
---

# Metric Contract & Truth Assurance — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. This team has failed. What happened?

### M1 — SimPOS slipped, and "truth assurance" degraded into self-consistency

This is the premortem `intelligence.md:471-475` already wrote for this team, and it remains
the most likely mechanism: *"SimPOS (§44.7) slips, so 'truth assurance' degrades into
self-consistency checks — the engine agreeing with itself — and the register's #1 eval
priority is quietly reported as done."*

The sequence is comfortable, which is what makes it dangerous. §44.10 needs a ground-truth
ledger (`v3.0-TECH-DEBT.md:322-325`). §44.7 is *"critical path"* and owned by Engineering
(`:309`). Quarter one, the team writes definitions. Quarter two, it writes checks that
compare `analytics.service.ts`'s number to `engine/`'s number. They agree — of course they
do, one calls the other. A green board appears. `analytics.kpi_ground_truth_agreement` gets
reported as high. **Nothing external has verified anything.**

**Earliest observable signal.** Any check in this team's suite whose "expected" value is
produced by code inside `apps/api-gateway/src/analytics/`. The first one. A truth suite that
imports the thing it grades is a determinism test with a misleading name.

**What would have prevented it.** Two mechanisms, both structural:

1. **The 0% is published monthly, unchanged, with its blocker dated**
   (`intelligence.md:466-469`). It is not allowed to be replaced by a proxy. Three
   consecutive unchanged restatements escalate to the founder via
   [[decision-office-charter]] — SimPOS is either scheduled or the metric is permanently
   unmeasurable, and both answers are publishable.
2. **A ground-truth source that is not the product.** Hand-computed expected values over a
   small fixed fixture — 20 checks, 5 wines, 3 tables, arithmetic done on paper — proves
   more about correctness than a thousand self-consistent rows, and it exists this
   afternoon. It is not §44.10, and it must never be *called* §44.10.

---

### M2 — The team fixed the documents instead of the mechanism, and the counts drifted again

The divergence census is easy and satisfying: 375 in three shipping files, 573 in the
planning corpus, 348 at `LLM_INSTRUCTION_PROMPTS.md:167`. A morning of find-and-replace
makes them all agree. `analytics.metric_claim_divergence_count` goes to zero. The board is
green.

Six months later a new `MEASURE` lands, `INSIGHT_CANDIDATES.length` becomes 611, and every
one of those files is wrong again — because **nothing changed the reason they drifted**.
`insight-catalog.spec.ts:9-10` still asserts only `>= 200`. `InsightCatalog.tsx` still
hardcodes a number instead of calling `GET /analytics/insight-catalog`, whose
`totalCandidateTypes` (`insight-generator.service.ts:41-45`) is derived at runtime and has
been correct the whole time.

**Earliest observable signal.** A divergence closed by a commit that touches only `.md`,
`.tsx` string literals, or OpenAPI description strings — with no test and no runtime
derivation in the diff.

**What would have prevented it.** A standing rule with no exceptions
([[metric-contract-truth-assurance-directive]] rule 2): **a divergence closes as a runtime
derivation or a CI assertion, never as an edit.** The census reports two numbers — how many
divergences exist, and how many of the closed ones closed *structurally*. The second number
is the real one.

---

### M3 — The registry became a brochure and everyone believed it

`metric-registry.ts` holds 33 definitions, each with a `formula`, a `theorem` lineage, an
`engineFns` list, and **`computed: true`**. It is served publicly at `GET /analytics/metrics`
so *"the frontend can render a formula library and the AI layer can discover which
quantitative tools exist"* (`:11-13`).

**Nothing binds any of it to a computation.** `METRIC_BY_KEY` (`:537-539`) is used by nothing
outside the file. There is no `compute(metricKey)` dispatch anywhere. The registry's own
docstring describes the binding as two separate manual edits: *"Adding a metric here + a
compute branch in the service"* (`:13-14`).

So twelve months on, `gmroi`'s registry formula says one thing, `inventory-science.ts`
computes another, a customer reads the formula library, and the number beside it does not
follow from the formula above it. Nobody detects it, because the registry is *served* and
never *executed*. And the consultant layer is worse off than the customer: it was explicitly
built to *"discover which quantitative tools exist"* from this file.

**Earliest observable signal.** A registry entry whose `engineFns` names a function that no
longer exists, or that the service does not call. A one-line check today, and it is
untested — `analytics.registry_binding_share` is **0%**.

**What would have prevented it.** Every registry key is bound to a **named engine function
and a test that calls it**. `engineFns` stops being a documentation string and becomes an
import that fails to compile when the function is renamed. `computed: true` is derived from
the binding, never hand-set.

---

### M4 — A silent zero shipped again, because the failure and the answer look identical

`analytics.service.ts:57-66` records this happening once already: a column-name mismatch,
PostgREST rejecting the whole query with 42703, `Promise.allSettled` + `data || []`
collapsing it to an empty inventory — *"so every metric downstream (inventory value, COGS
ratio, turnover, GMROI, reorder science) silently reported 0/null for every restaurant."*

The degradation posture is deliberate and defensible: *"a missing table just removes its
candidate families"* (`insight-generator.service.ts:20-21`). But it means **the output has
no way to distinguish "computed, and it is zero" from "the query failed, so it is zero."**
The mechanism is live at **8 `allSettled` sites across 5 files** (`analytics.service.ts`,
`advanced-analytics.service.ts:501`, `recommendations.service.ts:87`,
`consultants.service.ts:113`, `insight-generator.service.ts:265`).

Twelve months on, a schema change lands. A restaurant's dashboard reads $0 inventory value
for three weeks. It looks like a quiet restaurant. It gets noticed when a manager says
something offhand, not by a test — exactly as it happened the first time.

**Earliest observable signal.** Any restaurant whose computed metric set is *entirely*
zero/null for more than one refresh cycle. That pattern is nearly impossible from real data
and near-certain from a failed query. It is a query away and nothing runs it.

**What would have prevented it.** A **third state**. Every computed metric carries
`value | null | unavailable`, and `unavailable` propagates to the UI as
`insufficient_data` — the same rendered state
[[insight-narrative-generation-charter]] already owns. Plus the all-zero sweep as a
scheduled job. The counter-pressure is not "stop degrading gracefully"; it is "never let
degradation be invisible."

---

### M5 — The veto was granted on paper and never exercised

[[analytics-bi-directive]] gives this team a veto over external analytics claims, including
against Marketing, Sales, and the founder. Veto power that has never been used once in
twelve months is not evidence of a clean record; it is evidence of a team that decided not
to spend its credibility.

The specific claim it will fail on is already written down. `YC_WEDGE_PLAN.md:31-33`:
*"dollars recovered"* means **we asked**, not we received. In a fundraising conversation the
stronger sentence is the one that lands, and the person who has to say "no, we can only
claim we asked" is a team with no revenue attached to its name. The department's own
premortem calls this the equilibrium it should expect
([[analytics-bi-premortem]] M5).

**Earliest observable signal.** The first external artifact containing an analytics figure
with no register entry. Also: any use of *recovered*, *saved*, or *found* in a dollar claim
where the underlying event is a **drafted email** rather than a **received credit memo**.

**What would have prevented it.** The register is a **pre-publication gate, not a
post-publication audit** — a claim without a `path:line` and a defensible verb does not
ship, so the veto is exercised by process rather than by confrontation. And
`analytics.claims_without_provenance` is on the board, so a quarter with zero register
entries reads as a *failure to audit* rather than a clean quarter.

---

## Cross-cutting counter-pressure

- **This team's structural weakness is that its primary metric is blocked by someone else.**
  Every mechanism above exploits that. The single most important design decision in this
  charter is the **day-one census metric** that depends on nothing —
  `analytics.metric_claim_divergence_count`, baseline ≥ 2 — so the team has a number that
  moves in week one.
- **Boundary discipline with RM-2 is a real failure mode, not a courtesy.**
  `intelligence.md:460-464` separates *"nondeterministic model output, golden sets, judged
  thresholds"* (RM-2) from *"deterministic arithmetic, exact equality, no judgement"* (us).
  Under M1's pressure, the tempting move is to borrow RM-2's judged-threshold technique and
  call an approximate match a pass. **Our pass condition is exact equality. There is no
  threshold.**
- **[[red-team-charter]] should attack M5** — an unused veto is precisely the kind of
  decision an independent function is meant to notice, and it is the one this team cannot
  police from inside.
- **[[decision-office-charter]] owns the §44.7 escalation close-time.** Without a dated
  escalation, M1 has no forcing function.
- **Anti-sprawl.** 60 days without revisiting makes this fiction (foundation §3.3). Start by
  checking whether the 375 on `apps/web/src/components/command/commands.ts:99` is still
  there.
