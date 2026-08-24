---
type: agenda-full
division: intelligence
department: analytics-bi
status: provisional
metrics: [analytics.metric_claim_divergence_count, analytics.satisfiable_candidate_share, analytics.insight_acceptance_rate, analytics.kpi_ground_truth_agreement]
updated: 2026-08-24
links: ["[[analytics-bi-charter]]", "[[analytics-bi-premortem]]", "[[analytics-bi-agenda-board]]", "[[analytics-bi-directive]]", "[[analytics-bi-loops]]", "[[analytics-bi-schedule]]", "[[analytics-engine-charter]]", "[[insight-narrative-generation-charter]]", "[[metric-contract-truth-assurance-charter]]", "[[intelligence]]", "[[ORG_STRUCTURE]]", "[[data-charter]]", "[[security-charter]]"]
---

# Analytics & BI — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Take a department that already has **11,748 lines of working code** and give it the one
thing it has never had: **a number that is guaranteed to mean the same thing everywhere it
appears.** Then get four of the five department metrics from *unmeasured* to *measured*
before trying to move any of them.

| Metric | State today (measured 2026-08-24) |
|---|---|
| `analytics.satisfiable_candidate_share` | **Measured: 25.1%** — 144 of 573 types without a POS feed; 6.6% with consumption only |
| `analytics.metric_claim_divergence_count` | **Measurable today, never measured.** Baseline ≥ 2 |
| `analytics.insight_acceptance_rate` | **Both halves in the schema, never joined.** `recommendation_impressions` + `recommendation_actions` |
| `analytics.engine_service_test_ratio` | **Measured: inverted.** 149 cases over the engine, 0 spec files over ~5,600 service lines |
| `analytics.kpi_ground_truth_agreement` | **0%, blocked** on §44.7 SimPOS (`v3.0-TECH-DEBT.md:309`) |

The unusual shape of this department: it is the only one in Intelligence where the code
is far ahead of the contract. Research & Math has a harness with no evaluation; Security
has defects with no team. Analytics & BI has a **working engine that publishes a number
about itself which is wrong on the customer's screen right now**.

## How

**Sequence: reconcile → assert → measure → move.** Not "build more."

### 1. Reconcile the counts (week one, AB-3, no dependencies)

The insight-type count is published as **375** in three places that ship to users or
customers —

- `apps/web/src/pages/InsightCatalog.tsx:2` (the explorer page users open)
- `apps/web/src/components/command/commands.ts:99` (*"Browse all 375 insight types"* in
  the command palette)
- `apps/api-gateway/src/analytics/analytics.controller.ts:219` (the OpenAPI summary)

— and as **573** in the documents used to explain the company
(`AGENT_NATIVE_UI_DECISION.md:64,100,105`; `YC_WEDGE_PLAN.md:280,324`). The true value,
computed from `insight-catalog.ts` on 2026-08-24, is **573**. A third value, 348, appears
at `LLM_INSTRUCTION_PROMPTS.md:167`. `UX_PATHS_CATALOG.md` contains both 375 (`:1564`) and
573 (`:1844`).

The fix is **not** a find-and-replace. It is:

- the UI reads the count from `GET /analytics/insight-catalog`, which already returns
  `totalCandidateTypes` (`insight-generator.service.ts:41-45`) — the endpoint exists and
  is not being used for the number printed above it;
- a CI assertion that pins the count exactly, replacing `>= 200`
  (`insight-catalog.spec.ts:9-10`);
- a claim register entry so the next divergence is caught by a test rather than by a
  prospect.

### 2. Add the assertion layer before adding anything else (weeks 1–3)

Three assertions, in priority order:

1. **Exact-count assertion** on `INSIGHT_CANDIDATES.length` and on
   `METRIC_REGISTRY.length` (33 today). A count that no test pins is a count that drifts.
2. **Named support constants.** The five thresholds in `insight-generator.service.ts`
   (`:200`, `:550`, `:867`, `:1017`, `:1107`) become exported constants with spec cases,
   so lowering one is a reviewed change. This is the direct counter-pressure to
   [[analytics-bi-premortem]] M3.
3. **First spec file for the service layer.** ~5,600 lines currently have none.
   `insight-generator.service.ts` (1,200 lines) is the correct first target, because it is
   the file that turns math into sentences a manager acts on.

### 3. Join the two halves of the acceptance loop (weeks 2–4, AB-2)

`recommendation_impressions` was shipped *deliberately* as the guard against a recommender
trained on conversions alone (migration `20260817000000`, and
`recommendations.service.ts:373-382`). It is written fire-and-forget on every
`getRecommendations()` call. `recommendation_actions` records dispositions. **No query
joins them.** One query produces `analytics.insight_acceptance_rate` and
`analytics.top_rank_ignore_rate` — the second is the more informative:
*"a top-ranked, ignored one is informative"* (migration comment).

### 4. Publish the 0% (ongoing, AB-3)

`analytics.kpi_ground_truth_agreement` stays at **0%** with `v3.0-TECH-DEBT.md:309`
(§44.7 SimPOS) named as the blocker, every month, until it ships. Per
`intelligence.md:466-469`, publishing the 0 is the point: it converts a blocked
dependency into a visible number and makes the escalation dated rather than hoped for.

## Why now

- **The founder's stated priority is this department.** *"The most important part of the
  website is to create and show analytics and show people that we have the right
  metrics."* Right now the product shows a number about its own analytics that is wrong by
  198.
- **The precedent already happened.** `ANALYTICS_FEATURE_CATALOG.md:5-13` records a
  shipped engine sitting behind a *"Planning only — not built"* header for **two weeks**.
  The file's own instruction — *"the header was wrong once already"* — is a request for
  this department.
- **The commercial risk is asymmetric.** `YC_WEDGE_PLAN.md:324-326` says a partner reads
  573 insight types as *no wedge*. A wrong count on top of that is worse than either
  problem alone: it invites the question *"what else is off?"* about the one part of the
  product the founder wants to lead with.
- **One dependency is closable now and one is not.** §44.11 (AI Eval Suites) *"depends
  only on Phase 37, which is satisfied — plannable in parallel"* (`v3.0-TECH-DEBT.md:326-330`),
  while §44.10 waits on SimPOS. The department should take the plannable one and escalate
  the other rather than treating both as blocked.

## Next steps

- [ ] Reconcile the insight-type count to a single runtime-derived source; replace the
      `>= 200` assertion with an exact one — [[metric-contract-truth-assurance-charter]]
- [ ] Publish `analytics.metric_claim_divergence_count` with its census table — day one,
      no dependencies — [[metric-contract-truth-assurance-loops]]
- [ ] Reconcile `metric-registry.ts:8` ("the 360 features") against
      `ANALYTICS_FEATURE_CATALOG.md:5` (460) and tier Batch 6 (361–460), which is untiered
      at `:931-936`
- [ ] Extract the five support thresholds into named, tested constants —
      [[insight-narrative-generation-charter]]
- [ ] Write the first service-layer spec (`insight-generator.service.ts`) —
      [[analytics-engine-charter]] + [[insight-narrative-generation-charter]] jointly
- [ ] Run the impressions ↔ actions join; publish acceptance and top-rank-ignore rates
      with an `insufficient_data` flag until volume supports them
- [ ] Turn `availableCandidates()` into a **gate** on new candidate types —
      [[analytics-bi-directive]] rule 1
- [ ] Stand up the consultant-enablement expiry list; no enabled row without a named owner
- [ ] Escalate §44.7 (SimPOS) and OD-20 into `OPEN-DECISIONS.md` with close-times —
      [[decision-office-charter]]
- [ ] Open **INTEL-F6** (which count is canonical, and what test pins it) and **INTEL-F7** (is
      `ANALYTICS_FEATURE_CATALOG.md` a plan or a contract?)

## Questions for the founder

1. **Which number do we stand behind publicly — 573, or the satisfiable subset?** The
   honest headline today is *"573 insight types, of which 144 are computable without a POS
   integration."* The impressive headline is *"573 insight types."*
   `YC_WEDGE_PLAN.md:324-326` argues the impressive one actively hurts. This department
   recommends the honest one and needs the call, because it changes the deck.

2. **Is `insufficient_data` allowed on the customer's screen?** The corpus already says it
   should be (`AGENT_NATIVE_UI_DECISION.md:191-192`, `:332-337`) and the code already does
   it (`insight-verbalizer.ts` returns `null`). But an empty insight feed in a demo is
   uncomfortable. Confirm that an honest empty state beats a filled one, because
   [[analytics-bi-premortem]] M3 says the pressure to lower the floor arrives during a demo.

3. **Does AB-3 hold a real veto over external analytics claims?** [[analytics-bi-directive]]
   grants it one. That means AB-3 can tell Marketing, Growth, and the founder that a
   sentence in a deck is false. Independence is worthless if it stops at the department
   boundary — but this is a genuine constraint on you, so it needs saying yes to explicitly.

4. **§44.7 SimPOS — is it scheduled or is it aspiration?** `v3.0-TECH-DEBT.md:322-325`
   calls §44.10 the *"stated #1 eval priority"* and it is blocked on §44.7. If SimPOS is
   not on a roadmap with a date, AB-3's primary metric is permanently 0% and the department
   should say so on the board rather than carry it as pending.

5. **OD-20 — do we demo the consultant layer before the routes are guarded?**
   `analytics.controller.ts:516` (toggle) and `:531` (consult, `claude-opus-4-8`,
   `max_tokens: 4096`) are unguarded. The department's position is: no. Confirm, or accept
   the spend exposure explicitly.

6. **INTEL-F3 — where does operator preference live?** A manager acting on a recommendation is
   neither `agent`, `guest`, nor `bio` (foundation §4.4). This is the strongest human
   signal the product collects and it currently has no home in the neural footprint.
   Add `operator` to `subject_type`, or route it outside NF?
