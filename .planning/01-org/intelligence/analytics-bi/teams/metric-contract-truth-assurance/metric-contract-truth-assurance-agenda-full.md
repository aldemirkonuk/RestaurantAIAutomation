---
type: agenda-full
division: intelligence
department: analytics-bi
team: metric-contract-truth-assurance
status: provisional
metrics: [analytics.metric_claim_divergence_count, analytics.kpi_ground_truth_agreement, analytics.registry_binding_share, analytics.silent_zero_paths, analytics.claims_without_provenance]
updated: 2026-08-24
links: ["[[metric-contract-truth-assurance-charter]]", "[[metric-contract-truth-assurance-premortem]]", "[[metric-contract-truth-assurance-agenda-board]]", "[[metric-contract-truth-assurance-directive]]", "[[metric-contract-truth-assurance-loops]]", "[[metric-contract-truth-assurance-schedule]]", "[[analytics-bi-agenda-full]]", "[[analytics-engine-charter]]", "[[insight-narrative-generation-charter]]", "[[engineering-charter]]", "[[decision-office-charter]]"]
---

# Metric Contract & Truth Assurance — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Make it structurally impossible for this product to publish two different values for the
same quantity — starting with the one it is publishing right now, to customers.

| Metric | State today (verified 2026-08-24) |
|---|---|
| `analytics.metric_claim_divergence_count` | **≥ 2**, both live, both public |
| `analytics.divergences_closed_structurally` | **0 of 0** |
| `analytics.registry_binding_share` | **0%** of 33 keys, all of which declare `computed: true` |
| `analytics.silent_zero_paths` | **8** `allSettled` sites across 5 files |
| `analytics.claims_without_provenance` | **unmeasured** — the register does not exist |
| `analytics.kpi_ground_truth_agreement` | **0%**, blocked on §44.7 |

## How

**Sequence: census → assert → bind → escalate.** The first three need nothing from anyone
else; the fourth is the only part that waits.

### 1. The census, week one (T1)

Every place the product states a count about itself, diffed against what the code produces.
The current census, complete:

**Insight types — three published values, one true one.**

| Value | Published at | Reachable by |
|---|---|---|
| **375** | `apps/web/src/pages/InsightCatalog.tsx:2` · `apps/web/src/components/command/commands.ts:78,99` · `apps/api-gateway/src/analytics/analytics.controller.ts:219` | **a customer** |
| **375** | `LLM_INSTRUCTION_PROMPTS.md:51,166` · `UX_PATHS_CATALOG.md:1543,1564,1566,1593,1598` | internal |
| **348** | `LLM_INSTRUCTION_PROMPTS.md:167` — *"never invent a 348th type"* | internal |
| **573** ✅ | `AGENT_NATIVE_UI_DECISION.md:64,100,105` · `YC_WEDGE_PLAN.md:280,324` · `UX_PATHS_CATALOG.md:1844` | a YC partner |

`UX_PATHS_CATALOG.md` publishes both 375 (`:1564`) and 573 (`:1844`). The three files a
customer can reach all say the wrong one; the documents used to raise money say the right
one.

**Features — 460 or 360, depending which line you read.**
`ANALYTICS_FEATURE_CATALOG.md:5` says 460. Its own tier table (`:931-936`) sums
92 + 170 + 98 = 360, because Batch 6 (361–460) was appended untiered.
`metric-registry.ts:8` calls it *"the 360 features."* The JSON export carries 460 under
`"status": "planned"` while the header says PARTLY BUILT.

### 2. Close them structurally, not by editing (weeks 1–3)

- `apps/web/src/pages/InsightCatalog.tsx` reads its count from
  `GET /analytics/insight-catalog`, which **already returns `totalCandidateTypes` derived at
  runtime** (`insight-generator.service.ts:41-45`). The endpoint that prevents this defect
  exists and is not used for the number printed above it.
- `insight-catalog.spec.ts:9-10` moves from `>= 200` to an **exact** assertion. That single
  lower bound is why 149 passing tests were compatible with 348, 375 and 573 simultaneously.
- The OpenAPI summary at `analytics.controller.ts:219` stops hardcoding a number.
- Tier Batch 6, or delete the tier table. A summary that sums to a different total than its
  own document is worse than no summary.

### 3. Bind the registry (weeks 2–6, T3)

33 keys, each with a `formula`, a `theorem`, an `engineFns` list, and `computed: true`.
`METRIC_BY_KEY` (`:537-539`) is used by nothing outside the file. There is no
`compute(metricKey)` dispatch anywhere — the registry is filtered and served
(`analytics.service.ts:36-46`) and never consulted when a number is produced. The registry's
own docstring concedes the gap: *"Adding a metric here + a compute branch in the service"*
(`:13-14`) — two edits, nothing binding them.

Make `engineFns` an import that fails to compile on a rename. Derive `computed` from the
binding.

### 4. Sweep for silent zeros (week one, cheap; T4)

`analytics.service.ts:57-66` records this already happening: a column mismatch, PostgREST
rejecting the whole query with 42703, `allSettled` + `data || []` collapsing it to empty —
*"every metric downstream … silently reported 0/null for every restaurant."* The mechanism
is live at 8 sites across 5 files.

The detection is one query: flag any restaurant whose entire computed metric set is
zero/null across a refresh cycle. Nearly impossible from real data; near-certain from a
failed query.

### 5. Stand up the register, and use the veto once (weeks 1–4, T5)

Entry #1 is written for us: `YC_WEDGE_PLAN.md:31-33` — *"dollars recovered"* means **we
asked**. A register with entries but no rejections is a filing cabinet.

### 6. Escalate §44.7, monthly, dated (T2)

Publish 0% unchanged with the blocker named. Never substitute a proxy. Three consecutive
unchanged restatements go to the founder.

## Why now

- **The wrong number is on the customer's screen today.** Not in a plan — in
  `commands.ts:99` and `InsightCatalog.tsx:2`, shipped.
- **The founder's priority is precisely this.** *"Show people that we have the right
  metrics."* A product that miscounts its own metrics by 198 has an obvious first question
  to answer.
- **The defect class has two documented instances.** The catalogue header wrong for two
  weeks (`ANALYTICS_FEATURE_CATALOG.md:5-13`) and every inventory metric silently zero
  (`analytics.service.ts:57-66`). Two independent instances of one pattern is systemic — the
  same argument `intelligence.md:234-237` uses for SEC-1.
- **Nothing in step 1–5 waits on anyone.** That matters more than it sounds: this team's
  headline metric is blocked, and a team with no moving number does not survive
  ([[analytics-bi-premortem]] M1).

## Next steps

- [ ] Publish the divergence census with the table above — week one
- [ ] Replace `>= 200` with an exact assertion in `insight-catalog.spec.ts`
- [ ] Make `InsightCatalog.tsx` and the command palette read the count from the API
- [ ] Fix or remove the OpenAPI "Browse All 375 Types" summary (`analytics.controller.ts:219`)
- [ ] Reconcile 460 vs 360; tier Batch 6 or delete the tier table
- [ ] Bind all 33 registry keys to a tested computation; derive `computed`
- [ ] Ship the all-zero sweep; design the `value | null | unavailable` third state
- [ ] Stand up the claim register; entry #1 = the "we asked ≠ we received" contract
- [ ] Countersign [[insight-narrative-generation-charter]]'s impressions↔actions join
      **before** any acceptance rate is published
- [ ] Escalate §44.7 monthly, dated, to [[decision-office-charter]]
- [ ] Open **INTEL-F6** and **INTEL-F7** in `OPEN-DECISIONS.md`

## Questions for the founder

1. **Which count is canonical — and will you accept the answer being a test?** 573 is what
   the code produces today. Reconciling to it is one afternoon. Keeping it reconciled
   requires an exact CI assertion that will fail on the next legitimate `MEASURE` addition —
   by design. Confirm that a failing build on a *correct* change is acceptable, because that
   is what "one number, one source" costs.

2. **Is `ANALYTICS_FEATURE_CATALOG.md` a plan or a contract?** `metric-registry.ts:53` binds
   metrics to its `catalogIds`, which makes it a contract. Its header, its untiered Batch 6,
   and its `"status": "planned"` export make it a plan. It cannot be both, and code currently
   depends on the wrong reading.

3. **Do we hold a real veto over external analytics claims?** [[analytics-bi-directive]] says
   yes. In practice that means this team can tell you a figure in a deck is false, and the
   figure does not ship. It is a genuine constraint on you and needs an explicit yes —
   otherwise [[metric-contract-truth-assurance-premortem]] M5 is the outcome by default.

4. **§44.7 SimPOS — scheduled, or not?** `analytics.kpi_ground_truth_agreement` is 0% until
   it ships, and §44.10 is the register's *"stated #1 eval priority"*
   (`v3.0-TECH-DEBT.md:322-325`). If SimPOS has no date, say so and we will publish
   "permanently unmeasurable" rather than "pending" — the second is a slower lie.

5. **What happens when a corrected number embarrasses a past claim?**
   [[metric-contract-truth-assurance-directive]] rule 8 treats a wrong shipped number as a
   claim retraction generating a decision record. That is deliberately more visible than a
   quiet patch. Confirm you want the visible version.
