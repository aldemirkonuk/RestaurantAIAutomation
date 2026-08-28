---
type: agent-stack
division: intelligence
department: analytics-bi
team: metric-contract-truth-assurance
status: designed
updated: 2026-08-27
metrics: [analytics.kpi_ground_truth_agreement, analytics.metric_claim_divergence_count, analytics.registry_binding_share, analytics.silent_zero_paths, analytics.claims_without_provenance]
links: ["[[metric-contract-truth-assurance-charter]]", "[[metric-contract-truth-assurance-schedule]]", "[[metric-contract-truth-assurance-loops]]", "[[metric-contract-truth-assurance-directive]]", "[[metric-contract-truth-assurance-premortem]]", "[[0034-agent-stack-artifact]]", "[[0020-no-fabricated-answers]]", "[[0016-ledgers-must-express-unknown]]", "[[0025-citations-must-disagree-loudly]]", "[[analytics-bi-agent-stack]]", "[[analytics-engine-agent-stack]]", "[[insight-narrative-generation-agent-stack]]", "[[engineering-charter]]", "[[skills-charter]]"]
---

# Metric Contract & Truth Assurance — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The only stack in the department whose job is to say a shipped number is **wrong** —
> to both siblings, to Marketing, to Sales, and to the founder. Its pass condition is
> exact equality against a ledger, with no judgement in it; grading nondeterministic
> output is [[agent-evaluation-gates-charter]]'s and stays there
> (*"they share vocabulary, not work"*, `intelligence.md:464`). Mechanisms referenced
> only: harness → [[harness-runtime-charter]] (**OD-03 open**), mutation gate →
> [[action-safety-the-human-gate-charter]].

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `metric-contract-auditor` | Diff every published analytics figure against the value the code produces at runtime, prove each registry key binds to a computation, and restate the blocked ground-truth number with a date rather than letting it disappear | NEW |

## 2. Agent cards

```yaml
agent: metric-contract-auditor
unit: metric-contract-truth-assurance
triggers:
  - schedule: "weekly (divergence census, all-zero sweep)"    # mirrored in [[metric-contract-truth-assurance-schedule]]
  - schedule: "monthly (registry binding audit, ground-truth restatement, fixture truth run)"
  - schedule: "quarterly (definition reconciliation)"
  - topic: publication.pending                                 # publisher: NONE (gap — no deck, landing page or OpenAPI change announces itself; the gate is human-invoked, which is the exact objection the schedule raises against making it a skill)
consumes:
  - "metric-registry.ts — 547 lines, 33 keys, METRIC_BY_KEY :537-539, metricsForPersona/metricsForDomain :541-547"
  - "totalCandidateTypes from insight-generator.service.ts:41-45"        # publisher: [[analytics-engine-agent-stack|engine-reach-sentinel]]'s unit — the runtime truth value
  - published counts across apps/web, apps/mobile, OpenAPI description strings, .planning/*.md
  - "the 8 Promise.allSettled / ok() collapse sites across 5 files (:501, :113, :87, :265)"
  - "ANALYTICS_FEATURE_CATALOG.md ids + datasets/planning-exports/analytics-feature-catalog.json"
  - the shipped sentence list                                            # publisher: [[insight-narrative-generation-agent-stack|narrative-restraint-sentinel]]
  - the simulator ground-truth ledger                                    # publisher: NONE (gap — §44.7 SimPOS, v3.0-TECH-DEBT.md:309, owned by [[engineering-charter]], not shipped)
emits:
  - analytics.metric_claim_divergence_count + analytics.divergences_closed_structurally   # consumer: [[analytics-bi-agent-stack]] board
  - analytics.registry_binding_share, analytics.silent_zero_paths, analytics.claims_without_provenance
  - "analytics.kpi_ground_truth_agreement — a dated restatement while blocked"   # consumer: the founder, after 3 identical runs
  - analytics.fixture_agreement, reported under its own name and never as §44.10
  - "a 'this number is wrong' verdict"    # consumers: both sibling stacks, [[media-brand-charter|media-and-brand-charter]], [[strategy-fundraising-charter|strategy-and-fundraising-charter]] — veto per [[analytics-bi-directive]]
  - nf_a events (task_type: metric_claim_census)                          # consumer: [[ai-orchestration-agent-stack|aio-orchestrator]]
routing_class: mechanical      # grep, diff, resolve a symbol, compare to a hand-computed fixture — exact equality, no judged threshold anywhere
quality_bar: "exact equality against a ledger (charter §Non-goals). A divergence counts as closed only when it is closed **structurally** — runtime derivation or a CI assertion; a markdown edit does not close it ([[metric-contract-truth-assurance-premortem]] M2). While §44.7 is unshipped the fixture run is the substitute and is never renamed to §44.10"
autonomy:
  read: autonomous
  propose: autonomous          # register entries, divergence rows and CI assertions land as PRs
  mutate_stock_money_outbound: confirm    # constant; this agent has no such surface
memory: metric-contract-truth-assurance
escalates_to: "[[analytics-bi-charter]]"     # and directly to the founder on the third identical ground-truth restatement ([[metric-contract-truth-assurance-schedule]])
```

**The card's own hard rule:** the auditor never edits the number it audits — it files the
divergence with an owner and a close-time, and correcting it belongs to the author (*"we
audit authors; we do not become one"*). An auditor that patches the string it flagged makes
`kpi_ground_truth_agreement` self-reported, the defect class `v3.0-TECH-DEBT.md:127`
already names as live here.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `metric-claim-census` | T2 (dept) | Weekly, **and before any external publication** — deck, landing page, changelog, OpenAPI change, investor update | Every published count matches the value its code produces at runtime, or appears in the divergence register with an owner and a close-time; reports the open count **and** the share closed structurally | 2026-08-24: the product shipped *"Browse all 375 insight types"* while `INSIGHT_CANDIDATES.length` evaluated to **573**, with a third value (348) at `LLM_INSTRUCTION_PROMPTS.md:167`. Still live 2026-08-27 — and the citations have **moved**: `commands.ts:99` → `:84,105`, `analytics.controller.ts:219` → `:226` | NEW |
| `analytics-truth-check` | T2 (dept) | Any change under `apps/api-gateway/src/analytics/`, plus the monthly fixture run | Every touched key still matches its `metric-registry.ts` definition; every `engineFns` entry resolves to a function the service calls; no new path collapses a failed query into a zero without marking it `unavailable`; the fixture suite imports **no** code from `analytics/` to produce an expected value | `analytics.service.ts:57-66` records it in code: a column-name mismatch made PostgREST reject the query with 42703, `Promise.allSettled` + `data \|\| []` turned it into an empty inventory, and *"every metric downstream … silently reported 0/null for every restaurant."* Found by reading code, not by a test; the mechanism is live at 8 sites across 5 files | NEW |

Deliberately absent: `published-claim-guard` as separate tooling — a gate that can be
skipped by not invoking it ([[metric-contract-truth-assurance-schedule]], which
[[analytics-bi-schedule]] contradicts; the disagreement is recorded in
[[analytics-bi-agent-stack]] §3 and left open) — and anything grading nondeterministic
output, the first step to sharing a pass condition with
[[agent-evaluation-gates-charter]].

## 4. Memory

- **Procedural** — the §3 skills; candidates enter [[skill-harvesting-charter]]'s queue, §3.3 gate still applied.
- **Episodic** — nf_a `task_type: metric_claim_census` and `registry_binding_audit`.
  Needs `context.claim_key` and `context.closure_mode` (`structural` / `textual`) — the
  difference between a divergence closed by an assertion and one closed by editing a string
  is the difference between this team working and this team as theatre.
- **Semantic** — `memory/` beside this file, index
  `metric-contract-truth-assurance-MEMORY.md`, one fact per file with `source` /
  `confidence` / `last_verified`; every write a PR. Founding facts, all dated: the
  375/348/573 split and its mechanism (a `>= 200` lower bound); the 360-vs-460 count inside
  the semantic layer itself; the two-week "not built" label
  (`ANALYTICS_FEATURE_CATALOG.md:5-13`); and the *"dollars recovered means we asked"*
  contract (`YC_WEDGE_PLAN.md:31-33`) — the register's first entry, not an illustration of it.
- **Working** — this card, the MEMORY index, the claim register index, charter §Mandate.
  `metric-registry.ts` (547 lines) and `UX_PATHS_CATALOG.md` (154KB) are grep targets
  (CLAUDE.md §2).

**Consolidation** — monthly, mirrored in [[metric-contract-truth-assurance-schedule]]: diff
this month's census against last month's facts; **failures first** — a reopened divergence
becomes a fact naming the mechanism ("closed textually in PR N, reopened when the string was
re-edited"), never "count wrong again"; a citation that moved while its claim did not becomes
a fact about how the register cites (content match, not line number — the
[[0025-citations-must-disagree-loudly]] problem in miniature); expire facts unverified for 90
days; propose skill candidates. One PR. The ground-truth restatement reads identically until
SimPOS ships; the third identical run **escalates** and is never deleted — deleting it is how
[[metric-contract-truth-assurance-premortem]] M1 completes.

## 5. Async contract

Cross-unit interaction is loops ([[metric-contract-truth-assurance-loops]] — 5,
close_times weekly ×2 / monthly ×2 / per-event), NF-A events, vault PRs and skill
candidates. Never a synchronous call, and never a private word to an author. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `publication.pending` has no publisher | Nothing announces a deck, landing page or OpenAPI change. The pre-publication gate depends entirely on a human invoking it, and *"a weekly job cannot catch a deck written on a Tuesday"* ([[metric-contract-truth-assurance-loops]]:50) |
| The ground-truth ledger has no publisher | §44.7 (SimPOS, `v3.0-TECH-DEBT.md:309`) is [[engineering-charter]]'s and unshipped, so the primary metric has a producer only on paper. The dated restatement is the async substitute — a blocked dependency converted into a visible number |
| The veto is a doc row, not an event | [[analytics-bi-directive]] grants veto over external analytics claims; nothing routes a claim past this team automatically. A veto granted on paper and never exercised is [[metric-contract-truth-assurance-premortem]] M5 |
| No CI assertion pins any count | `insight-catalog.spec.ts:9-10` asserts only `>= 200`. **INTEL-F6** — which number is canonical and what assertion pins it — stays open; the answer must be a test, and this card does not choose it. **INTEL-F7** — whether `ANALYTICS_FEATURE_CATALOG.md` is a planning doc or a contract — likewise open |

## 6. Evidence today

- **EXISTS — the divergence, re-verified in this worktree 2026-08-27.**
  `apps/web/src/pages/InsightCatalog.tsx:2`, `apps/web/src/components/command/commands.ts:84,105`
  and `analytics.controller.ts:226` all publish **375** while `insight-catalog.spec.ts:9-10`
  asserts only `>= 200`. The three surfaces that say 375 are the three a customer can reach —
  and the prevention is already built and unused: `GET /analytics/insight-catalog` returns
  `totalCandidateTypes` derived at runtime (`insight-generator.service.ts:41-45`).
- **EXISTS — the semantic layer, unbound.** 33 definitions with `formula`, `theorem`,
  `engineFns`, `catalogIds` and `computed: true` on all 33; `METRIC_BY_KEY` (`:537-539`) is
  exported and used by nothing outside the file, and no `compute(metricKey)` dispatch exists
  anywhere. `analytics.registry_binding_share` = **0%**.
- **EXISTS — the silent-zero mechanism.** `analytics.service.ts:57-66` documents the
  incident; the collapse pattern is live at 8 sites across 5 files.
  [[0016-ledgers-must-express-unknown]] is the shape of the fix, and not this team's to build.
- **PARTIAL — the claim register.** It does not exist; building it is deliverable one, so
  `analytics.claims_without_provenance` is unmeasured rather than zero.
- **NEW — `metric-contract-auditor`, both skills, and everything in §4.** Both censuses so
  far were run by hand (2026-08-24, re-verified 2026-08-27) — the past instance the §3 rows
  rest on, not a running job.
