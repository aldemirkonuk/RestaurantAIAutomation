---
type: agent-stack
division: intelligence
department: analytics-bi
team: analytics-engine
status: designed
updated: 2026-08-27
metrics: [analytics.satisfiable_candidate_share, analytics.candidate_type_count, analytics.engine_service_test_ratio, nf_b.checks_dependent_candidate_share]
links: ["[[analytics-engine-charter]]", "[[analytics-engine-schedule]]", "[[analytics-engine-loops]]", "[[analytics-engine-directive]]", "[[analytics-engine-premortem]]", "[[0034-agent-stack-artifact]]", "[[analytics-bi-agent-stack]]", "[[metric-contract-truth-assurance-agent-stack]]", "[[insight-narrative-generation-agent-stack]]", "[[data-charter]]", "[[skills-charter]]"]
---

# Analytics Engine (Decision Science) — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This team owns the most existing code in the Intelligence division and the most
> constrained mandate to add to it: its directive **gates** catalogue growth rather than
> accelerating it. So the agent measures reach, guards purity and requirement integrity,
> and is forbidden from writing arithmetic. Mechanisms are referenced only: harness →
> [[harness-runtime-charter]] (**OD-03 open**), model choice →
> [[model-routing-inference-economics-charter]], mutation gate →
> [[action-safety-the-human-gate-charter]].

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `engine-reach-sentinel` | Keep four numbers true — satisfiable share, candidate count, foreign imports into `engine/`, and the false-discovery estimate — and hand the blocking `DataRequirement` to Data rather than closing the gap with more math | NEW |

## 2. Agent cards

```yaml
agent: engine-reach-sentinel
unit: analytics-engine
triggers:
  - schedule: "weekly (reach reading + headless count)"    # mirrored in [[analytics-engine-schedule]]
  - schedule: "monthly (permutation falsification, coverage reading)"
  - topic: pr.touches_engine_or_catalog                     # publisher: NONE (gap — no CI job watches these paths; the purity guard and admission check are designed, not built)
consumes:
  - "apps/api-gateway/src/analytics/engine/ — 12 modules, 3,679 non-spec lines, 131 exported fns"
  - "insights/insight-catalog.ts:279,388,503-540,547,557 — validity matrices, buildCandidates(), INSIGHT_CANDIDATES, availableCandidates()"
  - "the 10 engine specs + insight-catalog.spec.ts (1,680 lines, 149 it() cases)"
  - per-restaurant DataRequirement availability                # publisher: [[data-charter]] (their ingestion state), read off the restaurant's own rows today
  - "[[POS-BRIDGE-AUDIT]] §A.1 — the with-POS reading (66 checks: 8/573 → 386/573)"
emits:
  - analytics.satisfiable_candidate_share + the blocking-requirement table ranked by unlock size   # consumer: [[data-charter]], as a data request
  - analytics.candidate_type_count from a headless ts-node run    # consumer: [[metric-contract-truth-assurance-agent-stack|metric-contract-auditor]], as the runtime truth value for its census
  - analytics.false_discovery_estimate                            # consumer: [[insight-narrative-generation-agent-stack|narrative-restraint-sentinel]] — the arithmetic is ours, the presentation consequence is theirs
  - analytics.engine_foreign_imports, analytics.unclaimed_data_requirements   # consumer: [[analytics-bi-agent-stack]] board
  - nf_a events (task_type: engine_reach_audit)                   # consumer: [[ai-orchestration-agent-stack|aio-orchestrator]]
routing_class: mechanical      # execute availableCandidates(), count, grep imports, shuffle and re-run — no judgement anywhere in the loop
quality_bar: "the count is reproducible headlessly — a bare ts-node run with no Nest context on the same commit yields the same INSIGHT_CANDIDATES.length — and no share ships without its denominator and the blocking DataRequirement named ([[analytics-bi-directive]] rule 2)"
autonomy:
  read: autonomous
  propose: autonomous          # readings and admission verdicts land as PRs
  mutate_stock_money_outbound: confirm    # constant; this agent has no such surface
memory: analytics-engine
escalates_to: "[[analytics-bi-charter]]"
```

**The card's own hard rule:** `engine-reach-sentinel` never adds a candidate type, a
`MEASURE`, or an engine function. *"Add a new insight type"* is deliberately not a skill
([[analytics-engine-schedule]]) — a tool that makes catalogue growth cheaper makes
[[analytics-engine-premortem]] M1 more likely, which is a rising count over a falling
share.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `insight-candidate-reach` | T2 (dept) | Weekly; any PR touching `insight-catalog.ts` | Total types, satisfiable share per live restaurant, blocking-requirement table by unlock size; fails loudly if a `DataRequirement` union member is claimed by zero candidates | 2026-08-24: nobody had computed the share; executing `availableCandidates()` gave 144/573 (25.1%) with no POS feed, and exposed that `goals` (`insight-catalog.ts:38`) is declared and claimed by nothing — so 22 `goal_pace` types report satisfiable for a restaurant with zero `analytics_goals` rows | NEW |
| `engine-arithmetic-guard` | T3 | Any diff under `analytics/engine/`, or to a threshold constant in `insight-generator.service.ts` | Every touched exported function has a spec case with a **hand-computed** expected value; no new statistical gate merges without a test of its p-value path; no foreign import entered `engine/` | `pValue` and `chi2` appear in **zero assertions across all 11 spec files**, while `insight-generator.service.ts:872` uses `p.lift > 1.3 && p.pValue < 0.1` to decide whether the product speaks. 149 cases passed around the gap because nothing was looking for it | NEW |

Consumed, owned elsewhere: the envelope ([[skills-charter]]); the claim census
([[metric-contract-truth-assurance-agent-stack]] — it diffs *our* count against what the
product publishes, and we do not audit ourselves).

## 4. Memory

- **Procedural** — the §3 skills; candidates enter [[skill-harvesting-charter]]'s queue
  and still face the §3.3 gate.
- **Episodic** — nf_a `task_type: engine_reach_audit`, and `engine_admission_check` for
  the per-PR verdicts. Needs `context.restaurant_id` (a share is meaningless unattributed)
  and `context.blocking_requirement`, so "which requirement blocked most types this month"
  is one filter rather than a re-derivation.
- **Semantic** — `memory/` beside this file, index `analytics-engine-MEMORY.md`, one fact
  per file with `source` / `confidence` / `last_verified`. Its first three files are
  already known and dated: the 25.1% no-POS reading, the unclaimed `goals` requirement,
  and the untested `pValue` path that gates a published claim. Every write is a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics, and the
  catalogue's two validity matrices by line range. The 1,200-line
  `insight-generator.service.ts` and the 12 engine modules are grep targets, never
  preloaded (CLAUDE.md §2).

**Consolidation** — monthly, mirrored in [[analytics-engine-schedule]]: diff this month's
reach reading against last month's facts; **failures first** — a share that fell while the
count rose becomes a fact naming the mechanism (*which* requirement, *which* new family),
never "reach dipped"; a permutation run whose survivors exceed the nominal rate becomes a
fact about the threshold, not the data; expire facts unverified for 90 days; propose skill
candidates. One PR, and "no delta" stated when true — a flat 25.1% for three months **is**
the finding ([[analytics-engine-schedule]] §Anti-sprawl).

## 5. Async contract

Cross-unit interaction is loops ([[analytics-engine-loops]] — 5, close_times weekly /
per-pr ×2 / monthly ×2), NF-A events, vault PRs and skill candidates. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `pr.touches_engine_or_catalog` has no publisher | Two of the five loops close "per-pr" and nothing in CI watches `engine/` or `insight-catalog.ts` today. Until built, the weekly reading bounds the blind spot at 7 days and the admission check is a human reading a diff |
| The data request to [[data-charter]] is a doc row, not an event | Acceptable async path, but nothing notifies; a blocking requirement that nobody picks up looks identical to one nobody can close. The escalation rule, not the job, is what survives three flat readings |
| `analytics.candidate_type_count` has a consumer but no contract | AB-3's census needs the runtime value; the headless script that produces it does not exist yet (`analytics.headless_count_script_status` is a metric precisely because of that) |
| Nothing pins the count in CI | `insight-catalog.spec.ts:9-10` asserts only `>= 200` — a lower bound compatible with 375, 573 and 348 alike. Which number is canonical and what assertion pins it is **INTEL-F6**, open; this card does not pick |

## 6. Evidence today

- **EXISTS — the whole substrate this agent would read.** `analytics/engine/`:
  `finance.ts` (512), `statistics.ts` (477), `vendor-price-consensus.ts` (454),
  `pricing-agility.ts` (398), `inventory-science.ts` (371), `forecasting.ts` (284),
  `risk.ts` (260), `cost-basis.ts` (253), `regression.ts` (222), `comparisons.ts` (214),
  `association.ts` (109), `linalg.ts` (82) — 10 spec files verified present in the worktree
  2026-08-27, plus `insight-catalog.spec.ts`. The purity constraint it defends is stated in
  the files themselves (`insight-catalog.ts:14-17`, `engine/index.ts:1-18`), and the
  handoff to Data is already implemented (`availableCandidates()`, `:557`) — the reach
  reading is a call, not a build.
- **PARTIAL — the arithmetic under the gate.** `association.ts:89-92` computes the χ²(1 df)
  p-value correctly and is documented at `:29`; the chain that decides whether the product
  speaks has one tested link (`normalCdf`, `statistics.spec.ts:87-89`) and no end-to-end
  case.
- **PARTIAL — the coverage inversion.** The charter's "0 spec files over ~5,600 service
  lines" has moved: `analytics/consultant-grounding.spec.ts` (13 cases) and
  `analytics/pos-revenue.spec.ts` (10 cases) now exist. Smaller inversion, same shape.
- **NEW — the sentinel, both skills, and everything in §4.** The 2026-08-24 measurement
  session did all of this by hand once; that is the past instance, not a running job.
