---
type: charter
division: intelligence
department: analytics-bi
team: metric-contract-truth-assurance
status: partial
metrics: [analytics.kpi_ground_truth_agreement, analytics.metric_claim_divergence_count, analytics.registry_binding_share, analytics.silent_zero_paths, analytics.claims_without_provenance]
updated: 2026-08-24
links: ["[[metric-contract-truth-assurance-premortem]]", "[[metric-contract-truth-assurance-agenda-full]]", "[[metric-contract-truth-assurance-agenda-board]]", "[[metric-contract-truth-assurance-directive]]", "[[metric-contract-truth-assurance-loops]]", "[[metric-contract-truth-assurance-schedule]]", "[[analytics-bi-charter]]", "[[analytics-engine-charter]]", "[[insight-narrative-generation-charter]]", "[[agent-evaluation-gates-charter]]", "[[engineering-charter]]", "[[media-brand-charter|media-and-brand-charter]]", "[[strategy-fundraising-charter|strategy-and-fundraising-charter]]", "[[decision-office-charter]]", "[[intelligence]]"]
---

# Metric Contract & Truth Assurance — Charter

Department: **Analytics & BI** ([[analytics-bi-charter]]) · Division: **Intelligence**.
Siblings: [[analytics-engine-charter]], [[insight-narrative-generation-charter]].

**The question this team owns: *does this number mean the same thing everywhere?***

## Mandate

Own the semantic layer — **one definition per metric** — and prove the shipped product
computes each one exactly, against ground truth. This is the only team in the department
whose job is to say a shipped number is **wrong**, and it must be able to say that to both
siblings, to Marketing, to Sales, and to the founder. Same independence argument
[[ORG_STRUCTURE]] §3 uses to place Red Team outside the line, applied one department over
(`intelligence.md:443-444`).

The team's scope deliberately extends past the codebase to **every published claim**. A
metric that is arithmetically perfect inside `engine/` and stated wrongly on a landing page
has failed in exactly the way this team exists to prevent — and that has already happened,
twice, in ways that are still true today.

## Boundaries

Owns outright:

- **`metric-registry.ts`** (547 lines, **33 metric keys**, `METRIC_BY_KEY` at `:537-539`,
  `metricsForPersona` / `metricsForDomain` at `:541-547`) — the nearest thing this product
  has to a single definition source, and the payload of `GET /analytics/metrics`.
- **The claim register** — every externally published analytics figure, its `path:line`
  provenance, and its strongest *defensible* phrasing. Does not exist yet; building it is
  deliverable one.
- **The CI assertion layer for counts and definitions.** Not documentation edits —
  assertions. A divergence closed by editing a markdown file will reopen.
- **`analytics.kpi_ground_truth_agreement`** — `v3.0-TECH-DEBT.md:322-325` (§44.10,
  *"Stated #1 eval priority"*).
- **Veto over external analytics claims** ([[analytics-bi-directive]]).

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Producing the number | [[analytics-engine-charter]] | We audit authors; we do not become one |
| Producing the sentence | [[insight-narrative-generation-charter]] | We audit their sentences too, and can call one false |
| Grading **nondeterministic** model output — golden sets, LLM judges, threshold pass conditions | [[agent-evaluation-gates-charter]] *(RM-2)* | **Stated explicitly** (`intelligence.md:460-464`): RM-2 grades judgement, we grade arithmetic. Exact equality against a ledger, no judgement involved. *"They share vocabulary, not work."* |
| Building SimPOS (§44.7) | [[engineering-charter]] | Our baseline is 0% until they ship it. We own the dated escalation, not the build |
| Whether a metric is *useful* | [[insight-narrative-generation-charter]] | A metric can be perfectly defined and worthless |
| Writing the marketing copy | [[media-brand-charter|media-and-brand-charter]] / [[strategy-fundraising-charter|strategy-and-fundraising-charter]] | They write it; we can say a figure in it is false |

## Metrics it moves

### Primary — `analytics.kpi_ground_truth_agreement`

Share of shipped KPIs matching the simulator ledger **exactly**.
**Baseline 0%, and honestly so** — unmeasurable until §44.7 lands
(`v3.0-TECH-DEBT.md:309`). *"Publishing the 0 is the point: it converts a blocked
dependency into a visible number"* (`intelligence.md:466-469`).

### Day-one metric — `analytics.metric_claim_divergence_count`

Because a team whose only number is blocked loses to teams whose numbers move
([[analytics-bi-premortem]] M1), this team carries a second primary that needs **no
simulator, no POS feed, and no other unit**: a census of every place the product publishes
a count, and how many distinct values that count has.

**Baseline ≥ 2, measured 2026-08-24.**

### Secondary

- **`analytics.registry_binding_share`** — share of the 33 registry keys bound to a
  verified computation. **Baseline 0%** (see Evidence).
- **`analytics.silent_zero_paths`** — code paths where a failed query is indistinguishable
  from a true zero. **Baseline: 8 sites across 5 files.**
- **`analytics.claims_without_provenance`** — externally published analytics figures with no
  `path:line`. **Baseline: unmeasured; the register does not exist.**

## Evidence today

**PARTIAL — and the register calls it the top priority.**

### Divergence 1 — the insight-type count, live on the customer's screen

The true value, computed from `insight-catalog.ts` on 2026-08-24, is **573**.

| Value | Where it is published |
|---|---|
| **375** | `apps/web/src/pages/InsightCatalog.tsx:2` · `apps/web/src/components/command/commands.ts:78,99` *("Browse all 375 insight types")* · `apps/api-gateway/src/analytics/analytics.controller.ts:219` *(shipped OpenAPI summary)* · `LLM_INSTRUCTION_PROMPTS.md:51,166` · `UX_PATHS_CATALOG.md:1543,1564,1566,1593,1598` |
| **348** | `LLM_INSTRUCTION_PROMPTS.md:167` — *"never invent a 348th type"* |
| **573** ✅ | `AGENT_NATIVE_UI_DECISION.md:64,100,105` · `YC_WEDGE_PLAN.md:280,324` · `UX_PATHS_CATALOG.md:1844` · `foundation/teams/corporate.md:435,448` |

`UX_PATHS_CATALOG.md` publishes **both** values — 375 at `:1564`, 573 at `:1844`, in the
same file. The three source files that say 375 are the three a *customer* can reach.

**Why it drifted, mechanically:** the only machine-checked assertion about the size of the
space is a **lower bound** — `insight-catalog.spec.ts:9-10` asserts `>= 200`. Nothing pins
the count, so 149 passing test cases were compatible with every value above.

**Why it did not have to drift:** `GET /analytics/insight-catalog` already returns
`totalCandidateTypes` derived at runtime (`insight-generator.service.ts:41-45`). The
endpoint that would have prevented this exists, and the page printing the wrong number
above it does not call it for that number.

### Divergence 2 — the feature count, in the semantic layer itself

`metric-registry.ts:8` describes itself as *"the machine-readable bridge between
`.planning/ANALYTICS_FEATURE_CATALOG.md` (the 360 features)"*. That file says **460**
(`:5`). Its own priority-tier table (`:931-936`) sums 92 + 170 + 98 = **360**, because
Batch 6 (361–460, one hundred seating-density features) was appended without tiers. Its
machine-readable export, `.planning/analytics-feature-catalog.json`, carries 460 features
under `"status": "planned"` while the markdown header says PARTLY BUILT.

So the same document is 360 features to the code, 460 to itself, planned to its export, and
partly built to its header.

### Precedent 1 — the label and the thing diverged for two weeks

`ANALYTICS_FEATURE_CATALOG.md:5-13`, verbatim: the header read *"Planning only — not
built"* until 2026-08-04, though the insight engine landed in `cebdc17` on **2026-07-21** —
*"a shipped engine sat behind a 'not built' label for two weeks."* The file's own
instruction is this charter: *"the header was wrong once already."*

### Precedent 2 — a wrong number actually shipped, and the mechanism is still live

`analytics.service.ts:57-66` records the incident in code. A column-name mismatch made
PostgREST reject the whole query with 42703, and `Promise.allSettled` + `data || []` turned
that rejection into an empty inventory — so *"every metric downstream (inventory value,
COGS ratio, turnover, GMROI, reorder science) **silently reported 0/null for every
restaurant**."*

The graceful-degradation posture is deliberate and defensible
(`insight-generator.service.ts:20-21`: *"a missing table just removes its candidate
families"*). But it means **the output cannot distinguish "computed, and it is zero" from
"the query failed, so it is zero."** That mechanism is live at **8 `Promise.allSettled`
sites across 5 files** — `analytics.service.ts`, `advanced-analytics.service.ts`,
`recommendations.service.ts`, `consultants.service.ts`,
`insights/insight-generator.service.ts` — each with an `ok()` helper collapsing failure to
empty (`:501`, `:113`, `:87`, `:265` respectively).

Two independent, documented instances of one defect class is the definition of systemic —
the same argument `intelligence.md:234-237` makes for SEC-1.

### The semantic layer is declarative and unbound — `analytics.registry_binding_share` = 0%

`metric-registry.ts` carries 33 metric definitions, each with a `formula` string, a
`theorem` lineage, an `engineFns` list, `catalogIds`, and **`computed: true` on all 33**.

- `METRIC_BY_KEY` (`:537-539`) is exported and **used by nothing** outside the file.
- There is **no key-based dispatch anywhere** — no `compute(metricKey)`. The registry is
  filtered and served (`analytics.service.ts:36-46` → `GET /analytics/metrics`) and never
  consulted when a number is produced.
- So `engineFns` is an unverified claim, `formula` is an unverified claim, and
  `computed: true` is a self-declaration nothing checks.

The registry's own docstring is honest about this: *"Adding a metric here + a compute branch
in the service is how the catalog gets built out incrementally"* (`:12-14`) — two separate
edits, with nothing binding them.

### The blocked dependency

`v3.0-TECH-DEBT.md:322-325` marks §44.10 the *"Stated #1 eval priority"* — assert every
dashboard KPI, report and analytic answer **exactly** against the simulator's ground-truth
ledger — and it depends on §44.7 (SimPOS, `:309`), which is *"critical path"* and owned by
Engineering. That dependency is this team's single most important escalation.

### Truth-in-claims is commercial

`YC_WEDGE_PLAN.md:31-33`: *"Until an 812 lands on a later invoice, 'dollars recovered'
means 'we asked.' Verified recovery requires watching the credit arrive, which requires
modelling the document it arrives on."* Publishing the stronger claim would be false. This
contract is the claim register's first entry, not an illustration of it.

## Team-count note, stated honestly

This team has **the least code and the most work**, and its headline metric is 0% and
blocked. That is a real risk of it being staffed last and quietly dropped
([[analytics-bi-premortem]] M1) — which is why the day-one divergence census exists as a
second primary. If this team does not exist, the department is two authors and no auditor,
and the 375-on-the-screen defect is nobody's job.
