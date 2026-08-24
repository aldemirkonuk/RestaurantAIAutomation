---
type: charter
division: intelligence
department: analytics-bi
status: exists
metrics: [analytics.satisfiable_candidate_share, analytics.insight_acceptance_rate, analytics.kpi_ground_truth_agreement, analytics.metric_claim_divergence_count, analytics.engine_service_test_ratio]
updated: 2026-08-24
links: ["[[analytics-bi-premortem]]", "[[analytics-bi-agenda-full]]", "[[analytics-bi-agenda-board]]", "[[analytics-bi-directive]]", "[[analytics-bi-loops]]", "[[analytics-bi-schedule]]", "[[analytics-engine-charter]]", "[[insight-narrative-generation-charter]]", "[[metric-contract-truth-assurance-charter]]", "[[ORG_STRUCTURE]]", "[[intelligence]]", "[[data-charter]]", "[[guest-experience-charter]]", "[[agent-evaluation-gates-charter]]", "[[security-charter]]"]
---

# Analytics & BI — Charter

Parent division: **Intelligence** ([[ORG_STRUCTURE]] §2). Siblings in-division:
Research & Math, Security.

## Mandate

Analytics & BI is accountable for **the number being right, being worth reading, and
meaning the same thing everywhere it appears**. The founder's stated priority is that
*"the most important part of the website is to create and show analytics and show people
that we have the right metrics"* — so this department does not merely compute; it owns
the claim. Every figure this product puts in front of a restaurant manager, a prospect,
or a YC partner is this department's liability: the arithmetic behind it
([[analytics-engine-charter]]), the sentence wrapped around it
([[insight-narrative-generation-charter]]), and the definition it is supposed to satisfy
([[metric-contract-truth-assurance-charter]]).

The department's non-obvious job is the third one. The engine already works. What has
already failed, repeatedly and in public, is the *contract*: the same quantity is
published as two different numbers in the same repository, and one of those numbers is
on the customer's screen right now.

## Boundaries

Owns outright:

- **`apps/api-gateway/src/analytics/`** — 39 TypeScript files, **11,748 lines**, the
  single largest module in the gateway.
- **The pure engine** — `engine/` (12 modules, 3,679 non-spec lines) plus its
  1,680 lines of spec carrying **149 `it()` cases** across 11 spec files.
- **The compositional candidate space** — `insights/insight-catalog.ts` and the
  `DIMENSION × MEASURE × COMPARATOR` cross-product it enumerates.
- **The semantic layer** — `metric-registry.ts` (547 lines, **33 metric keys**, every
  one flagged `computed: true`), served publicly at `GET /analytics/metrics`.
- **The narrative layer** — `insights/insight-verbalizer.ts` (templates only, "every
  number in a sentence comes straight from the math", `:1-11`), the toggle-gated
  consultant layer, and the recommendation act/dismiss/snooze/done/pin loop.
- **Every published claim about analytics**, including counts printed in the UI, in the
  OpenAPI descriptions, and in fundraising documents.

Three teams, which are three different questions asked of the same number:

| Team | The question it owns | Primary metric |
|---|---|---|
| [[analytics-engine-charter]] | *Is the arithmetic right?* | `analytics.satisfiable_candidate_share` |
| [[insight-narrative-generation-charter]] | *Is it worth saying?* | `analytics.insight_acceptance_rate` |
| [[metric-contract-truth-assurance-charter]] | *Does it mean the same thing everywhere?* | `analytics.kpi_ground_truth_agreement` |

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Whether the number *can be computed* — corpora, POS traffic, pipelines, L0 substrate | [[data-charter]] *(Platform)* | Data makes rows exist; we decide whether the figure derived from them is correct, useful, and consistently named |
| How the number *renders* — charts, layout, colour, the dashboard itself | [[design-charter]] *(Product)* + [[client-surfaces-charter]] *(Platform)* | Rejected explicitly as an A&BI team (`intelligence.md:506`). We own what it means, not how it looks |
| Guest taste fingerprints, personalization, NF-B applied | [[guest-experience-charter]] *(Product)* | We consume NF-B **in aggregate**; we do not own the guest (`intelligence.md:490`) |
| Grading **nondeterministic** model output — golden sets, judges, threshold pass conditions | [[agent-evaluation-gates-charter]] *(RM-2)* | RM-2 grades judgement; [[metric-contract-truth-assurance-charter]] grades arithmetic against a ledger with no judgement involved (`intelligence.md:460-464`) |
| Closing the 39 unguarded routes on `analytics.controller.ts` | [[security-charter]] + [[platform-api-charter]] | We are the **victim** of OD-20, not its owner. We own escalating it and refusing to demo behind it |
| Harness choice, retry policy, model routing for the consultant call | [[harness-model-routing-charter|harness-and-model-routing-charter]] *(RM-1)* | `consultants.service.ts:159` is one of RM-1's seven raw-`fetch` callsites. We own the prompt and the evidence pack; RM-1 owns the wire |

## Metrics it moves

Five numbers, deliberately not summed. Three are team primaries; two are department-level
health readings that no single team can move alone.

| Metric | Baseline **today**, measured this session |
|---|---|
| `analytics.satisfiable_candidate_share` | **25.1%** — `availableCandidates()` returns 144 of 573 types for a restaurant with consumption + orders + inventory and no POS feed. Consumption-only: **38 / 573 = 6.6%** |
| `analytics.insight_acceptance_rate` | **Computable but never computed.** Both sides exist: `recommendation_impressions` (denominator) and `recommendation_actions` (numerator). No query joins them |
| `analytics.kpi_ground_truth_agreement` | **0%, honestly so.** Unmeasurable until `v3.0-TECH-DEBT.md:309` (§44.7, SimPOS) lands. Publishing the 0 is the point |
| `analytics.metric_claim_divergence_count` | **≥ 2 live divergences** — insight-type count (375 vs 573) and feature count (460 vs 360). See *Evidence* below |
| `analytics.engine_service_test_ratio` | **149 cases over 3,679 engine lines; 0 cases over ~5,600 service lines.** The tested half is not the half that ships numbers to the screen |

Neural-footprint tie:

- **NF-B** — `checks`- and `tables`-dependent candidates are the guest-side half of the
  space. `insight-catalog.spec.ts:36-44` already asserts the with-POS space is strictly
  larger, so `satisfiable_candidate_share` is also a direct readout of NF-B substrate
  arrival.
- **NF-A** — `analytics.controller.ts` is the surface behind OD-20's denial-of-wallet
  exposure; every consultant call is `nf_a.*` spend that is currently unattributable
  because the NestJS side emits no cost events (`intelligence.md:165-167`).
- **NF has no home for our strongest signal.** The manager who dismisses a
  recommendation is neither `agent` nor `guest` nor `bio` (foundation §4.4). Raised as
  **INTEL-F3**; owned by [[insight-narrative-generation-charter]].

## Evidence today

**EXISTS — the most existing code of the three Intelligence departments, and the most
existing *contradiction*.**

### The engine is real (EXISTS)

- `apps/api-gateway/src/analytics/engine/` — `finance.ts` (512), `statistics.ts` (477),
  `vendor-price-consensus.ts` (454), `pricing-agility.ts` (398), `inventory-science.ts`
  (371), `forecasting.ts` (284), `risk.ts` (260), `cost-basis.ts` (253), `regression.ts`
  (222), `comparisons.ts` (214), `association.ts` (109), `linalg.ts` (82).
- Purity is a stated design constraint, not an accident:
  `insight-catalog.ts:14-17` — "pure data + pure functions (no NestJS/DB) so the
  candidate space is testable and countable."
- `engine/index.ts:1-18` documents the same intent at the barrel.

### The candidate space enumerates **573** types today (EXISTS, and measured)

Executed `INSIGHT_CANDIDATES.length` against
`apps/api-gateway/src/analytics/insights/insight-catalog.ts` on 2026-08-24:

```
TOTAL 573
tables 174 · efficiency 108 · sales 82 · staff 50 · risk 40
inventory 34 · forecast 30 · purchasing 27 · goals 22 · basket 6
```

### The contract has already failed, and is failing right now (PARTIAL)

The **same quantity is published as two different numbers**, and the wrong one is the
one a customer sees:

| Says **375** | Says **573** |
|---|---|
| `apps/web/src/pages/InsightCatalog.tsx:2` — the explorer page header | `.planning/AGENT_NATIVE_UI_DECISION.md:64,100,105` |
| `apps/web/src/components/command/commands.ts:99` — command palette, *"Browse all 375 insight types"* | `.planning/YC_WEDGE_PLAN.md:280,324` |
| `apps/api-gateway/src/analytics/analytics.controller.ts:219` — the shipped OpenAPI summary | `.planning/UX_PATHS_CATALOG.md:1844` |
| `.planning/LLM_INSTRUCTION_PROMPTS.md:51,166` | `.planning/foundation/teams/corporate.md:435,448` |
| `.planning/UX_PATHS_CATALOG.md:1543,1564,1566,1593,1598` | |

`UX_PATHS_CATALOG.md` contains **both** numbers: `:1564` says 375, `:1844` says 573.
`LLM_INSTRUCTION_PROMPTS.md:167` introduces a **third**: *"never invent a 348th type."*

**The only machine-checked assertion about the size of the space is a lower bound:**
`insight-catalog.spec.ts:9-10` asserts `>= 200`. Nothing in CI pins the actual count, which
is exactly why five documents and three source files drifted apart without failing a
build.

A second, independent divergence: `metric-registry.ts:8` calls the catalogue *"the 360
features"*, while `ANALYTICS_FEATURE_CATALOG.md:5` says **460** — and that file's own
tier table (`:931-936`, 92 / 170 / 98) still sums to **360**, because Batch 6 (361–460)
was never tiered. Its machine-readable export
(`.planning/analytics-feature-catalog.json`) carries 460 features under
`"status": "planned"` while the markdown header says PARTLY BUILT.

### The precedent this department was founded on (EXISTS)

`ANALYTICS_FEATURE_CATALOG.md:5-13` records the failure verbatim: the header read
*"Planning only — not built"* for **two weeks** after the engine landed in `cebdc17` on
2026-07-21 — *"a shipped engine sat behind a 'not built' label."* The file's own
instruction is this department's charter: *"the header was wrong once already."*

### Truth-in-claims is commercial, not cosmetic (EXISTS)

`YC_WEDGE_PLAN.md:31-33` fixes a contract this department must enforce outward:
*"dollars recovered"* means **we asked**, not we received — verified recovery requires
watching the credit memo arrive. Publishing the stronger claim would be false, and it is
the kind of claim a metrics-led pitch reaches for under pressure.

### The statistical posture is already decided, and it is ours to hold (EXISTS)

`AGENT_NATIVE_UI_DECISION.md:332-337`: detecting a 10% relative lift on a 50% baseline
needs ~800 conversions per arm; one restaurant produces 20–50 task completions/day.
*"You cannot prove any of these changes helps — not one, not ever, at this scale."* The
prescribed output states are `kept_unproven` / `insufficient_data` rather than a
fabricated `improved`. And `:191-192`: *"At 11 restaurants the honest verdict on nearly
every change is 'we cannot tell.' A system that says so is more valuable than one that
guesses."*

This department owns `insufficient_data` as a **first-class published state**, not as an
apology. The seed already exists in code: `insight-verbalizer.ts` returns `null` on
insufficient evidence, and `insight-catalog.spec.ts:94-101` tests that it does.

### The known open wounds

- **OD-20 is live.** `analytics.controller.ts` carries **39 routes, zero `@UseGuards`,
  zero `@Public`**. Anonymous callers can `PUT /analytics/consultants/:id/toggle`
  (`:516`) then `POST /analytics/consult/:id` (`:531`), reaching
  `consultants.service.ts:159` with `claude-opus-4-8` at `max_tokens: 4096`
  (foundation README:41-49). Not ours to fix; ours to escalate weekly and refuse to
  demo behind.
- **~5,600 lines of service code carry zero tests** — `insight-generator.service.ts`
  (1,200), `analytics.controller.ts` (837), `metric-registry.ts` (547),
  `advanced-analytics.service.ts` (526), `analytics.service.ts` (515),
  `table-analytics.service.ts` (496), `recommendations.service.ts` (417),
  `goals.service.ts` (375), `recommendation-actions.service.ts` (308),
  `consultants.service.ts` (217), `insight-scheduler.service.ts` (183).
- **`analytics.kpi_ground_truth_agreement` is blocked on someone else.**
  `v3.0-TECH-DEBT.md:322-325` marks §44.10 *"Stated #1 eval priority"* and it depends on
  §44.7 (SimPOS, `:309`), which is Engineering's.

## Team-count finding

Three teams is **right**, and this is the department in the division where that is
least in doubt. The three are not a grid: AB-1 is rewarded for computing more, AB-2 for
saying less, and AB-3 exists to tell both of them a shipped number is wrong. Merging any
pair collapses a real tension:

- **AB-1 + AB-2** resolves toward volume — 573 types and a dashboard nobody reads.
- **AB-2 + AB-3** lets the author of the sentence grade the sentence.
- **AB-1 + AB-3** makes `kpi_ground_truth_agreement` self-reported, the same defect
  `v3.0-TECH-DEBT.md:127` names as a live class ("hollow features that report success").

The honest caveat: **AB-3 has the least code and the most work.** Its primary metric is
0% and blocked. It is nevertheless the team this department exists for — see
[[analytics-bi-premortem]] M1.

## Open forks touching this department

- **INTEL-F3** (`intelligence.md:519`) — NF has no `subject_type` for the restaurant operator.
  Blocks `analytics.insight_acceptance_rate` from having a home in the footprint.
- **OD-20** — analytics spend exposure. Open and urgent (foundation README:341).
- **New, raised here (INTEL-F6):** which number is canonical for the insight-type count, and
  what CI assertion pins it? Answer must be a test, not a decision. See
  [[metric-contract-truth-assurance-charter]].
- **New, raised here (INTEL-F7):** does `ANALYTICS_FEATURE_CATALOG.md` remain a planning
  document, or become a contract? Today it is cited as authority
  (`metric-registry.ts:53` binds metrics to `catalogIds`) while carrying an untiered
  100-feature batch and a `"status": "planned"` export.
