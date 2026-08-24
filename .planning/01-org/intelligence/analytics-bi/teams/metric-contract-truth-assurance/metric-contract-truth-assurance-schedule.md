---
type: schedule
division: intelligence
department: analytics-bi
team: metric-contract-truth-assurance
status: provisional
metrics: [analytics.metric_claim_divergence_count, analytics.registry_binding_share, analytics.silent_zero_paths, analytics.claims_without_provenance, analytics.kpi_ground_truth_agreement]
updated: 2026-08-24
links: ["[[metric-contract-truth-assurance-charter]]", "[[metric-contract-truth-assurance-loops]]", "[[metric-contract-truth-assurance-directive]]", "[[analytics-bi-schedule]]", "[[decision-office-charter]]", "[[media-and-brand-charter]]", "[[engineering-charter]]"]
---

# Metric Contract & Truth Assurance — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| **Before every external publication** | **Claim provenance gate** — no analytics figure ships without a `path:line` and its weakest defensible verb | blocks the publication; `analytics.register_entries_added` |
| Weekly | **Divergence census** — grep every published count across `apps/web`, `apps/mobile`, OpenAPI description strings and `.planning/*.md`; diff each against what the code produces at runtime | `analytics.metric_claim_divergence_count`, `analytics.divergences_closed_structurally` |
| Weekly | **All-zero sweep** — flag any restaurant whose entire computed metric set is zero/null across a refresh cycle | `analytics.all_zero_restaurant_sweeps` |
| Monthly | **Registry binding audit** — every key's `engineFns` resolves to a function the service actually calls; `computed` derived, never hand-set | `analytics.registry_binding_share` |
| Monthly | **Ground-truth restatement** — an agreement percentage, or a **dated** restatement that §44.7 has not shipped. Three consecutive unchanged restatements escalate to the founder | `analytics.kpi_ground_truth_agreement` |
| Monthly | **Fixture truth run** — hand-computed expected values over a small fixed fixture (20 checks · 5 wines · 3 tables), arithmetic done on paper. Reported under its own name, **never** as §44.10 | `analytics.fixture_agreement` |
| Quarterly | **Definition reconciliation** — `metric-registry.ts` keys vs `ANALYTICS_FEATURE_CATALOG.md` ids vs what ships | `analytics.registry_coverage_share` |

**Anti-sprawl, applied carefully.** A job with no action for 3 consecutive runs is
downgraded or deleted (foundation §6). Two jobs here are *designed* to produce "no action"
and must not be deleted for it:

- The **monthly ground-truth restatement** will emit the same sentence until SimPOS ships.
  After 3 identical runs it does not get deleted — it gets **escalated** to a founder
  decision ([[metric-contract-truth-assurance-directive]] escalation trigger). Deleting it
  is how [[metric-contract-truth-assurance-premortem]] M1 completes.
- The **claim provenance gate** is a gate, not a report. Its output is often "nothing was
  published this week." Its failure mode is the opposite: a month with **zero register
  entries and publications having happened** is a failure to audit, and that is what gets
  escalated.

## Skills owned

Skills live in `.claude/skills/`. **None exist yet.** Two proposed, per the §3.3 protocol.
Deliberately two — the repo has one project skill today (foundation §3.1), and a skill
unfired for 30 days is reviewed for deletion.

### `metric-claim-census` — T2 (department)

- **Trigger.** Weekly, and **before any external publication** — deck, landing page,
  changelog, OpenAPI change, or investor update.
- **Doneability.** Every published count matches the value its code produces at runtime, or
  appears in the divergence register with an owner and a close-time. Reports both the open
  count **and** the share closed structurally (runtime derivation or CI assertion), because
  a divergence closed by editing a string will reopen.
- **Real past instance.** On 2026-08-24 the product shipped *"Browse all 375 insight types"*
  in `apps/web/src/components/command/commands.ts:99` and
  `apps/web/src/pages/InsightCatalog.tsx:2`, and *"Browse All 375 Types"* in the OpenAPI
  summary at `analytics.controller.ts:219`, while `INSIGHT_CANDIDATES.length` evaluated to
  **573**. A third value, 348, sat at `LLM_INSTRUCTION_PROMPTS.md:167`. All 149 engine test
  cases passed, because `insight-catalog.spec.ts:9-10` asserts only `>= 200`.
- **Owning department.** Analytics & BI. **Scheduled:** yes, weekly + pre-publication.

### `analytics-truth-check` — T2 (department)

- **Trigger.** Any change under `apps/api-gateway/src/analytics/`, and on the monthly
  fixture run.
- **Doneability.** Every touched metric key still matches its `metric-registry.ts`
  definition; every registry `engineFns` entry resolves to a function the service calls; no
  new code path collapses a failed query into a zero without marking it `unavailable`; the
  suite imports **no** code from `apps/api-gateway/src/analytics/` to produce an expected
  value.
- **Real past instance.** `analytics.service.ts:57-66` — a column-name mismatch caused
  PostgREST to reject the whole query with 42703, `Promise.allSettled` + `data || []` turned
  it into an empty inventory, and *"every metric downstream (inventory value, COGS ratio,
  turnover, GMROI, reorder science) silently reported 0/null for every restaurant."* Found
  by reading code, not by a test. The mechanism is still live at 8 sites across 5 files.
- **Owning department.** Analytics & BI. **Scheduled:** event-triggered on diff, plus
  monthly.

## Deliberately not a skill

- **`published-claim-guard` as separate tooling.** It is a *gate in the publication
  process*, not a procedure an agent runs on a schedule. Making it a skill would let it be
  skipped by not invoking it.
- **Anything that grades nondeterministic model output.** That is
  [[agent-evaluation-gates-charter]]'s golden-set tooling (RM-2). *"They share vocabulary,
  not work"* (`intelligence.md:464`), and a shared skill would be the first step to sharing
  the pass condition — ours is exact equality, theirs is a judged threshold.
