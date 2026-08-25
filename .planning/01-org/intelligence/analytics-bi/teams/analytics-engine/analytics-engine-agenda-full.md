---
type: agenda-full
division: intelligence
department: analytics-bi
team: analytics-engine
status: provisional
metrics: [analytics.satisfiable_candidate_share, analytics.candidate_type_count, analytics.engine_service_test_ratio, analytics.false_discovery_estimate]
updated: 2026-08-24
links: ["[[analytics-engine-charter]]", "[[analytics-engine-premortem]]", "[[analytics-engine-agenda-board]]", "[[analytics-engine-directive]]", "[[analytics-engine-loops]]", "[[analytics-engine-schedule]]", "[[analytics-bi-agenda-full]]", "[[data-charter]]", "[[insight-narrative-generation-charter]]", "[[metric-contract-truth-assurance-charter]]"]
---

# Analytics Engine — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Stop adding math. Measure what the existing math can actually reach, test the arithmetic
that decides whether the product speaks, and fix the two defects that are red **today**.

| Metric | State today (measured 2026-08-24) |
|---|---|
| `analytics.satisfiable_candidate_share` | **25.1%** (144 / 573, no POS). Consumption-only: 6.6% |
| `analytics.candidate_type_count` | **573** — tables 174 · efficiency 108 · sales 82 · staff 50 · risk 40 · inventory 34 · forecast 30 · purchasing 27 · goals 22 · basket 6 |
| `analytics.unclaimed_data_requirements` | **1** — `goals`, declared and claimed by nothing |
| `analytics.engine_service_test_ratio` | 149 cases / 3,679 engine lines · **0 spec files** / ~5,600 service lines |
| `analytics.false_discovery_estimate` | **unmeasured**, and the pipeline has no multiple-comparison correction |

## How

**Sequence: fix what is red → test what decides → measure reach → then, maybe, add math.**

### 1. Two defects that are red today (week one, no dependencies)

- **The unused `goals` requirement.** `insight-catalog.ts:38` declares `goals` as a
  `DataRequirement`; **zero** of 573 candidates claim it, because `goal_pace` is pinned to
  the `overall` dimension (`:520`) whose `requires` is empty (`:68`). Result:
  `availableCandidates()` reports 22 goal-pace types as computable for a restaurant with no
  `analytics_goals` rows. Fix the declaration, then add the spec case that would have caught
  it — every `DataRequirement` union member must be claimed by ≥1 candidate.
- **The untested significance path.** `pValue` and `chi2` appear in **zero** assertions
  across all 11 spec files, while `insight-generator.service.ts:872`
  (`lift > 1.3 && pValue < 0.1`) is the only significance gate in the product. The
  arithmetic at `association.ts:89-92` looks correct — χ²(1 df) two-sided as
  `2(1 − Φ(√χ²))`, which is the right identity and is documented as such at `:29` — but
  "looks correct" is not the standard this team exists to hold.

### 2. The first service-layer spec (weeks 1–3)

A fixture-driven spec for `insight-generator.service.ts`: a fixed synthetic bundle in, a
fixed set of insight keys and evidence values out. **No database required** — the engine is
pure and the bundle is a plain object, which is exactly the property
`insight-catalog.ts:14-17` was designed to give us. Start with the basket family end to
end.

### 3. Name the thresholds (weeks 2–3)

Five literals decide what the product says and none has a name or a test:
`insight-generator.service.ts:200` (`n / 14` support saturation), `:550` (`qtys.length < 5`),
`:867` (`transactions.length >= 10`), `:1017` (`nonZeroDays < 7`), `:1107` (`|z| >= 3`).
Plus the four magic numbers inside `scoreOf` (`:192-203`). Exporting them as named
constants with cases is what turns [[analytics-bi-premortem]] M3 from "someone lowers a
floor before a demo" into "someone has to change a test."

### 4. Measure the false-discovery rate (month one)

Run the generator against permuted data where no association exists by construction, and
count the surviving "significant" findings. That number is the false-discovery rate,
measured rather than argued. The technique has precedent in this repo:
`scripts/eval_merge_policies.py` tested the beverage identity key against **732,874 known
free-distinct pairs** and killed three designs, one of which committed 212 false merges
(`intelligence.md:115-118`). Ours is the statistical analogue.

### 5. Publish reach weekly, and route it to Data

`availableCandidates()` already computes it. The weekly reading names the blocking
requirement and its unlock size — `checks` 429 · `tables` 241 · `consumption` 127 ·
`inventory` 78 · `orders` 33 · `venue` 27. That table is a roadmap request to
[[data-charter]], not a status update.

## Why now

- **Reach is the department's honest headline and it has never been published.** 573 types
  sounds like capability; 144 computable types is the capability. Publishing the second
  number is what makes the first one credible — and
  `YC_WEDGE_PLAN.md:324-326` argues the unqualified 573 actively costs us.
- **Two defects are red at founding.** A team that starts by fixing what its own audit
  found is a different team from one that starts by adding a `DIMENSION`.
- **The dependency is external and large.** 74.9% of the catalogue is gated on `checks`.
  That is not a math problem, and the sooner it is stated as a number the sooner it becomes
  someone's roadmap item rather than this team's silent ceiling.
- **§44.11 is plannable now.** `v3.0-TECH-DEBT.md:326-330` — AI Eval Suites *"depends only
  on Phase 37, which is satisfied."* Unlike AB-3's §44.10, nothing blocks the analytic-answer
  golden sets, and this team's fixtures are the natural substrate for them.

## Next steps

- [ ] Fix the `goals` `DataRequirement` declaration; add the union-coverage spec case
- [ ] Backfill `pValue` / `chi2` assertions; hand-computed expected values only
- [ ] Write the first `insight-generator.service.spec.ts` — basket family end to end
- [ ] Export the five thresholds + four `scoreOf` constants as named, tested constants
- [ ] Build the permutation harness; publish `analytics.false_discovery_estimate`
- [ ] Publish weekly reach with the blocking-requirement table → [[data-charter]]
- [ ] Add the CI import guard on `engine/` **and** the headless count script (both, per
      [[analytics-engine-directive]] rule 1)
- [ ] Wire `availableCandidates()` in as an admission gate, not a query-time filter

## Questions for the founder

1. **Do we stop adding candidate types until reach exceeds 50%?** The team's premortem
   says yes and its metric agrees. But the catalogue is the most visible artifact this
   department has, and freezing it is a visible decision. Confirm the freeze, or set a
   different threshold.

2. **What is the acceptable false-discovery rate?** Once E3 measures it, someone has to say
   whether "one wrong insight in ten" is acceptable for a manager acting on a $400 purchase
   order. That is a product judgement, not an arithmetic one, and it sets our threshold.

3. **Does the `checks` dependency change the roadmap?** 429 of 573 types (74.9%) need a POS
   check feed. If POS integration is not near-term, then three quarters of this engine is
   dormant capability and the team should be smaller and the catalogue frozen — that is a
   real, defensible answer, and better than pretending otherwise.

4. **Is a corrected number a retraction?** If fixing the `goals` declaration changes a
   satisfiability figure already shown to a customer, [[analytics-bi-directive]] treats it
   as a claim retraction owned by AB-3, not a silent bug fix. Confirm that is the posture
   you want — it is slower and more honest.
