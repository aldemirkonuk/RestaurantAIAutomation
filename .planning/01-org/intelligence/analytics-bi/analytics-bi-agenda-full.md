---
type: agenda-full
division: intelligence
department: analytics-bi
status: active
metrics: [analytics.metric_claim_divergence_count, analytics.satisfiable_candidate_share, analytics.insight_acceptance_rate, analytics.kpi_ground_truth_agreement, analytics.engine_service_test_ratio]
updated: 2026-08-28
links: ["[[analytics-bi-charter]]", "[[analytics-bi-premortem]]", "[[analytics-bi-agenda-board]]", "[[analytics-bi-directive]]", "[[analytics-bi-loops]]", "[[analytics-bi-schedule]]", "[[analytics-bi-agent-stack]]", "[[analytics-bi-questions]]", "[[analytics-engine-charter]]", "[[insight-narrative-generation-charter]]", "[[metric-contract-truth-assurance-charter]]", "[[0039-activation-plan-of-record]]", "[[0020-no-fabricated-answers]]", "[[0016-ledgers-must-express-unknown]]", "[[0032-vault-cleanup-cut-line]]", "[[0034-agent-stack-artifact]]", "[[decision-office-charter]]", "[[strategy-fundraising-charter]]", "[[data-charter]]", "[[security-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[ux-path-burn-down-charter]]", "[[engineering-charter]]", "[[ORG_STRUCTURE]]"]
---

# Analytics & BI — Full Agenda

> **Agenda of 2026-08-28** (ADR 0039 Track B). Written by this department against its
> own charter, cards and loops. Every task below names a **doneability**, a
> **close_time**, and the **evidence** that makes it real. Where a line is aspiration
> rather than work, it says so in §6 and nowhere else.

## 0. The shape of this agenda in one paragraph

This department's product is **a number that means the same thing everywhere it appears.**
It has never shipped that product, and — measured this session — **28 loops in other
units name Analytics & BI or one of its teams as `inputs_from`** while this department
publishes nothing any of them can read (`.planning/00-index/loops.json`, counted
2026-08-28; 25 more send outputs *to* us). That asymmetry, not the engine, is the
department's actual condition: the arithmetic is 11,748 lines deep and the contract layer
is a set of markdown files. So the agenda has one spine — **the metric-contract truth
board, published, with named consumers** — and three programs feeding it: close the
375-vs-573 story *structurally*, extend the one real grounding instrument this department
already owns, and turn four unmeasured numbers into measured ones. Ambition here is not a
bigger catalogue; it is **being the unit the rest of the org can cite.**

## 1. What changed since the 2026-08-24 charter — measured 2026-08-28

Recorded here, not back-edited into the charter (§8.4: charters are not this doc's to edit).

| Charter said | Reads today | Evidence |
|---|---|---|
| OD-20 live, 39 unguarded routes | **Closed** | `analytics.controller.ts:51`, class-level `@UseGuards(JwtAuthGuard)` |
| The insight count is contested | **Settled at 573** (OD-33, 2026-08-26) — but *only in the register*; nothing in code or CI knows | OD-33, `OPEN-DECISIONS.md:40`; `insight-catalog.spec.ts:9-10` still asserts `>= 200` |
| Nest emits no cost events | **Emits them** since P1 | `common/model-client/model-client.service.ts:413`; consultant path `consultants.service.ts:174` |
| 0 spec cases beside the services | **23** | `consultant-grounding.spec.ts` (13) + `pos-revenue.spec.ts` (10). Engine + catalogue: 149 |
| 375 published in 3 code sites | **5** | + `insight-generator.service.ts:55`, the same file whose `getCatalogSummary()` returns the true count |
| `registry_coverage_share` unstated | **33 keys bind 69 distinct `catalogIds`, max id 352** — zero bindings into Batch 6 (361–460) | `metric-registry.ts`, extracted 2026-08-28 |
| — | **`metric-registry.ts:8` points at a file that no longer exists** — `.planning/ANALYTICS_FEATURE_CATALOG.md`; ADR 0032 moved it to `07-reference/` | `ls` both paths, 2026-08-28 |
| Charter's `UX_PATHS_CATALOG.md` line anchors (`:1543,1564,1566,1593`) | **Drifted** — the assertive `375` lines are now `:1548,1550,1569,1571,1583,1598,1603` | grep, 2026-08-28 |

**The pattern in that table is the department's whole thesis.** Six of eight rows are a
label that stopped matching its thing, and not one of them failed a build.

## 2. Programme A — the metric-contract truth board *(the spine)*

**Why it is the spine.** 28 external loops declare a dependency on this department's
output. `str-verb-strength`, `pfr-verb-strength`, `oe-claim-provenance` and
`claim-falsification` (`loops.json`) are all `per-event` or `fortnightly` and all wait on
a claim register that does not exist. A board nobody can read is a private opinion; ADR
0020's rule — *a surface with no data says so, it never invents one* — is the quality bar
on every row of it.

| # | Task | Owner | Doneability | close_time | Evidence it stands on |
|---|---|---|---|---|---|
| **A1** | **Publish the truth board as a real artifact** — the five department numbers, each with its denominator, none summed, plus a dated `not computed` where that is the truth | Department (`abi-orchestrator`) | A consumer in another unit can cite one row by `path:line` without asking us; every row carries a value or the literal words *not computed*; no roll-up number exists anywhere on it | **2026-09-04** | Card `abi-orchestrator` emits *"[[analytics-bi-agenda-board]] — five numbers, never summed"*; the card's hard rule forbids the roll-up (`analytics-bi-agent-stack.md:61-64`) |
| **A2** | **Name the 28 consumers on the board** — each external loop that declares us `inputs_from`, with the row it actually needs and its close_time | Department | Every one of the 28 maps to a board row or to a **gap row** saying we do not produce it; no consumer is silently unserved | **2026-09-11** | `.planning/00-index/loops.json`, counted 2026-08-28: 28 in, 25 out |
| **A3** | **Stand up the claim register** — three columns per ADR-0025 discipline: the claim, the `path:line` that computes it, the weakest defensible verb | AB-3 | First 10 rows exist and the **`"we asked ≠ we received"`** contract is entry #1, not an example | **2026-09-11** | `YC_WEDGE_PLAN.md:31-33`; premortem M5; loop `truth-published-claim-provenance` (per-event) |
| **A4** | **Make the register machine-gradeable** — a `scripts/check_*` guard in the CI pattern this repo already uses, exiting **2** when it cannot check what it claims to | AB-3 | The guard fails on the pre-fix tree and passes after A5/B1; exit-2 path is proven, not asserted | **2026-09-25** | `.github/workflows/ci.yml:189-210` (5 register guards); `:162` — *"Exit 2 means the guard could not check what it claims to"* |
| **A5** | **Monthly ground-truth restatement, published at 0%** with `v3.0-TECH-DEBT.md:309` (§44.7 SimPOS) named | AB-3 | A dated line exists every month; **three identical restatements escalate to the founder** rather than repeating a fourth time | **monthly, first 2026-09-25** | Loop `analytics-ground-truth-agreement` (`status: blocked`); `analytics-bi-schedule.md:22` anti-sprawl rule |

**A1's hardest constraint is a refusal.** The board must stay five numbers with five
denominators. The moment someone asks for "department health at a glance", the answer is
no — `kpi_ground_truth_agreement` is 0% and blocked, and any average hides exactly the
number the department exists to publish (premortem M1, M5).

## 3. Programme B — the 375-vs-573 reconciliation, closed structurally

**OD-33 settled the count at 573 on 2026-08-26** (OD-33, `OPEN-DECISIONS.md:40`). Two years of
this department's premortem hangs on what happens next: *a divergence closed by editing a
markdown file will reopen* (`metric-contract-truth-assurance` premortem M2; the two-week
"not built" header at `ANALYTICS_FEATURE_CATALOG.md:5-13` is the precedent).

**The census, measured 2026-08-28.** Three buckets, deliberately not summed:

- **Assertive, ours, 5 code sites** — `apps/web/src/components/command/commands.ts:84`
  and `:105`; `apps/web/src/pages/InsightCatalog.tsx:2`;
  `apps/api-gateway/src/analytics/analytics.controller.ts:226`;
  `apps/api-gateway/src/analytics/insights/insight-generator.service.ts:55`.
- **Assertive, not ours, 7 lines in one file** —
  `.planning/07-reference/UX_PATHS_CATALOG.md:1548,1550,1569,1571,1583,1598,1603` (§Z
  states *"**375** valid DIMENSION × MEASURE × COMPARATOR candidate types"* as fact).
- **Stale-as-unresolved, 10 rows in 3 other units** — the Decision Office still files it
  as an open contradiction (`decision-office-charter.md:77,276`, `-directive.md:109`,
  `-loops.md:275`, `-agenda-board.md:136`), Strategy still says it *"blocks publishing
  either"* (`strategy-fundraising-charter.md:247,265`, `-directive.md:76`), and
  `foundation/teams/corporate.md:207,448` repeats it. **The number is settled; their
  status rows are not.**

And a fourth bucket that must **not** be touched: **citational uses** — OD-33, `OPEN-DECISIONS.md:40`,
`04-specs/REGISTER-AUDIT-2026-08-26.md:524`, `decisions/evidence/0025-citation-rot.md:93-98`,
`07-reference/LLM_INSTRUCTION_PROMPTS.md:33`, `03-scenarios/TIER-MAP.md:122`,
`03-scenarios/S15-owner-opens-the-weekly-insight-digest.md:87,90,100,144`,
`UX_PATHS_CATALOG.md:1856`. These *record* that 375 was published. Editing them would
delete the audit trail — the exact move ADR 0025 exists to prevent.

| # | Task | Owner | Doneability | close_time | Evidence |
|---|---|---|---|---|---|
| **B1** | **Replace the floor assertion with an exact one** — `INSIGHT_CANDIDATES.length === 573` *and* the per-category vector (tables 174 · efficiency 108 · sales 82 · staff 50 · risk 40 · inventory 34 · forecast 30 · purchasing 27 · goals 22 · basket 6) | AB-1 | A single added candidate turns CI red. Verified by adding one locally and watching it fail | **2026-09-04** | `insight-catalog.spec.ts:9-10` asserts only `>= 200`, so 348/375/573/200 all pass (OD-33, `OPEN-DECISIONS.md:40`) |
| **B2** | **Derive the number at runtime in all 5 code sites** — the endpoint already returns it | AB-3 + AB-1 | No literal insight-count survives in `apps/web` or the OpenAPI strings; the palette label is computed | **2026-09-11** | `getCatalogSummary()` returns `totalCandidateTypes` (`insight-generator.service.ts:44-46`); `GET /analytics/insight-catalog` is live |
| **B3** | **Never ship the count without its satisfiable share** — the runtime payload carries both, so a caller cannot print one alone | AB-1 | The API response makes the bare count unavailable: `{ total, satisfiable, blockingRequirements[] }` or nothing | **2026-09-25** | Directive rule 2 (*"Both numbers or neither"*); `availableCandidates()` exists at `insight-catalog.ts:557-563` |
| **B4** | **File the two cross-unit asks** — one note into `decision-office-questions`, one into `strategy-fundraising-questions`: *OD-33 is settled; your rows still read unresolved.* One into `ux-path-burn-down-questions` for §Z's 7 lines | AB-3 | Three notes exist with the `path:line` lists above; **we do not edit their files** | **2026-09-04** | GENERATION_BRIEF §8.4 — *"a cross-unit need is an agenda task addressed to that unit's questions file"* |
| **B5** | **Close the feature-count divergence the same way** — `metric-registry.ts:8` says *"the 360 features"*, `ANALYTICS_FEATURE_CATALOG.md:5` says 460, its own tier table (`:931-936`) sums to 360, and the JSON export carries 460 as `"status": "planned"` | AB-3 | One number, derived or asserted; **and** the registry's dead doc pointer repaired to `07-reference/` | **2026-10-09** | Measured 2026-08-28: `.planning/ANALYTICS_FEATURE_CATALOG.md` does not exist (ADR 0032 moved it) |
| **B6** | **Publish `analytics.registry_binding_share` with its real denominator** — 33 keys bind **69 distinct** catalog ids, max **352**, none in 361–460 | AB-3 | The share is published as a fraction with the numerator *and* the untiered Batch-6 hole named, not as a percentage alone | **2026-09-25** | Extracted from `metric-registry.ts`, 2026-08-28; loop `truth-registry-binding` (monthly) |

**B is finished when the story cannot be retold.** The test is not "the docs say 573"; it
is *a contributor who types 375 into any of those surfaces gets a red build.*

## 4. Programme C — consultant grounding, extended along the axis that is actually weak

`GROUNDING_BASIS = "grounding_v1"` exists (`common/model-client/verdict-bases.ts:67`),
`checkGrounding()` is real (`analytics/consultant-grounding.ts`), it has 13 spec cases,
and it runs on every consult (`consultants.service.ts:231`). This is the strongest
instrument the department owns. **Extending it does not mean resolving deeper paths** —
the root-only check is deliberate, because HARD RULE 6 tells the model to cite what was
*missing* when evidence is thin, and full resolution would punish the honest answer
(`consultant-grounding.ts:19-33`). The weak axis is a different one.

| # | Task | Owner | Doneability | close_time | Evidence |
|---|---|---|---|---|---|
| **C1** | **Ground against *supplied and non-null*, not merely *keyed*** — `Object.keys(evidence)` (`consultants.service.ts:230`) returns all four categories even when a fetch rejected, because the pack is built from `Promise.allSettled` + an `ok()` that collapses failure to `null` (`:118-138`). A claim citing `risk.*` on a call where `getRiskProfile` threw is currently graded **grounded against nothing.** | AB-2 | A spec case proves a null-valued category no longer counts as supplied, and the verdict evidence records `null_categories` by name | **2026-09-11** | Read at HEAD 2026-08-28. Same defect class as ADR 0016 (*ledgers must express unknown*) and the `silent_zero_paths` metric the AB-3 card already carries |
| **C2** | **Widen the evidence pack from 4 categories to what the engine can actually supply** — the pack is `financial · risk · inventoryScience · templateInsights`; the engine has 12 modules including `forecasting`, `pricing-agility`, `vendor-price-consensus`, `cost-basis`, `association` | AB-2 + AB-1 | Each added category ships **with** a spec case and its own null-guard from C1; a category the restaurant cannot support is *absent and named*, never an empty object | **2026-10-09** | `consultants.service.ts:118-138` vs `analytics/engine/` (12 modules, 3,679 non-spec lines) |
| **C3** | **Report `unknown_evidence_roots` on the board, not only in the verdict row** — the check already collects them | AB-2 → AB-3 | A weekly count of model-invented evidence roots appears on the truth board with its denominator (consult calls that week) | **2026-09-25** | `consultant-grounding.ts` `GroundingResult.unknownRoots`; `consultantVerdict()` already writes it into verdict evidence |
| **C4** | **Consultant enablement expiry** — every `analytics_insight_prefs` row with `category='consultants', enabled=true`, its age, its named human, its expiry | AB-2 | An unowned row is switched off inside one close-time; default is OFF, so reverting needs no permission | **weekly, first 2026-09-04** | `consultants.service.ts:11,18` (absent row ⇒ disabled); premortem M4; loop `narrative-consultant-expiry` |
| **C5** | **Ask RM-3/RM-1 for a basis the deterministic path can carry** — the 573-type template path emits **no NF row at all**, so it is invisible to `check_task_types_are_graded.py` (39 emit / 27 graded / 12 exempt / 0 ungraded, run 2026-08-28) and ungradeable by construction | AB-2 | A note in `neural-footprint-instrumentation-questions` proposing a *provenance* instrument (every number in a shipped sentence traces to a computed field) — **theirs to design, not ours to invent** | **2026-09-11** | `verdict-bases.ts` is `common/model-client/`, RM-1/RM-3 territory per charter §Non-goals; `insight-verbalizer.ts` is templates-only |

**One honest caveat on C.** `GROUNDING_BASIS` has a second consumer —
`ux-optimizer.service.ts:320,338`. Any semantic change to what "grounded" means is a
two-consumer change and gets raised before it is made, not after.

## 5. Programme D — turn four unmeasured numbers into measured ones

The department's own metric list is mostly *unmeasured*, which makes every other programme
unfalsifiable. Nothing here needs a decision from anyone.

| # | Task | Owner | Doneability | close_time | Evidence |
|---|---|---|---|---|---|
| **D1** | **Join impressions ⋈ actions** — both tables exist and no query joins them | AB-2 | `analytics.insight_acceptance_rate` **and** `analytics.top_rank_ignore_rate` are published with their denominators and an `insufficient_data` flag until volume supports them | **fortnightly, first 2026-09-11** | `supabase/migrations/20260817000000_recommendation_impressions.sql:16-42` (`position` is `not null check (position > 0)`); `recommendation_actions` in the production baseline `:4908` |
| **D2** | **Re-read satisfiable share with the POS bridge live** — the charter's 25.1% is a no-POS conditional; the bridge is built and proven (1.4% → 67.4%) | AB-1 | One reading per live restaurant, each with the **blocking `DataRequirement` ranked by unlock size** — a data request to [[data-charter]], never a new `engine/*.ts` | **weekly, first 2026-09-04** | Charter §Metrics correction 2026-08-25; `POS-BRIDGE-AUDIT` §A.1; loop `analytics-candidate-reach` |
| **D3** | **Name the five support floors and test them** — `insight-generator.service.ts:200, 550, 867, 1017, 1107` are bare literals in a 1,205-line file with no spec | AB-2 | Each is an exported constant with a spec case; lowering one is a reviewed diff, not a one-character change at line 1017 | **2026-09-25** | Premortem M3 — *"the likeliest mechanism in this document"*; loop `narrative-support-floor-integrity` (per-pr) |
| **D4** | **First spec file for the pipeline that ships numbers to the screen** — `insight-generator.service.ts` | AB-1 + AB-2 | `analytics.engine_service_test_ratio` moves off *inverted*: the file that turns math into sentences a manager acts on has cases | **2026-10-09** | 149 engine/catalogue cases vs 23 service-adjacent (measured 2026-08-28); loop `analytics-test-coverage-inversion` (monthly) |
| **D5** | **The satisfiability gate becomes a gate** — no candidate type enters `INSIGHT_CANDIDATES` whose `DataRequirement` set is unsatisfied for **every** live restaurant | AB-1 | The **first** such PR is refused, not the tenth; and the guard reports `unclaimed_data_requirements` (`goals` is declared at `insight-catalog.ts:38` and claimed by nothing) | **2026-10-30** | Directive rule 1; premortem M2; loop `engine-requirement-integrity` (per-pr) |

## 6. Reach items — ambition, graded honestly

These are the department reaching past its current instruments. Each is graded, and none
of them is scheduled as if the grade were already earned.

| Reach | What it would be | Grade today |
|---|---|---|
| **The public metric contract** — `GET /analytics/metrics` becomes a *versioned* contract: 33 keys with formula, provenance and a `computed`/`not computed` state a caller can trust | The strongest possible expression of the founder's *"show people we have the right metrics"* — the honest inverse of a bigger catalogue | **Buildable, unscheduled.** The registry and the route exist (`metric-registry.ts:537-547`). Versioning it is a contract decision this department should not take alone — raise as **INTEL-F7's** concrete form |
| **The counterfactual ledger** — record, per served recommendation, what the engine *would* have said under the previous thresholds | Would make D3 measurable rather than merely safe | **Aspiration pending a decision.** It needs storage nobody has agreed to and touches RM-2's grading boundary. Not scheduled |
| **Insight → purchase-order attribution** — the premortem's own test: *"nobody can name an insight that changed a purchase order"* | The single most valuable number this department could publish | **Aspiration, blocked upstream.** Requires the operator disposition home that **INTEL-F3** does not have (`subject_type` is `agent`/`guest`/`bio`). Carried as a question, not a task |
| **`insufficient_data` as a designed surface**, not a fallback | An empty feed that states why it is empty, per ADR 0020 | **Buildable; needs a founder yes** — see §8 Q2. The code already returns `null` (`insight-verbalizer.ts`, `insight-catalog.spec.ts:94-101`); the render is [[design-charter]]'s |

## 7. Findings — things no card or loop can carry

Per §8.1: a task no card or loop can carry is a **finding**, not a task.

1. **`analytics.claim_published` has no publisher.** Nothing emits when a deck, a landing
   page or an OpenAPI string ships a figure (`analytics-bi-agent-stack.md:115`). The
   weekly census plus a human-invoked gate is the entire coverage, and *"a weekly job
   cannot catch a deck written on a Tuesday."* A4's guard narrows this; it does not close it.
2. **Escalation to the Decision Office is a doc edit with no notification.** Their schedule
   must poll `analytics-bi-questions`. B4 is the first live test of whether that works.
3. **The department has one agent and three teams with opposed incentives.** That is
   deliberate (charter §Team-count finding), but it means `abi-orchestrator` cannot
   arbitrate — every conflict in this agenda resolves at AB-3 (definition) or the founder
   (priority), never at the department agent.
4. **Two skills, not six.** `metric-claim-census` and `insight-candidate-reach` ship first
   (`analytics-bi-schedule.md:48-54`). Programme B is `metric-claim-census`'s first real
   firing; D2 is `insight-candidate-reach`'s. The other four stay held — six skills created
   at once against a repo-wide total near zero would fail the 30-day unfired-review test.

## 8. Locks respected, explicitly

- **Pricing model is deferred.** Nothing in this agenda produces a price, a unit-economics
  input framed as pricing, or a metric whose only consumer would be a pricing decision.
  Cost-per-consult is Finance's to consume from Track A2 when it lands; we do not
  pre-stage it.
- **Brand/landing visuals are held.** A3's claim register governs *wording and provenance*
  of analytics claims. It commissions no visual, no landing copy, and no deck. When the
  hold lifts, the register is the prerequisite that already exists — that is the whole
  point of doing it now.
- **No open fork is resolved here.** INTEL-F3, INTEL-F6 and INTEL-F7 are carried, not
  closed; §9 asks them.

## 9. Questions for the founder

1. **Which number do we stand behind publicly — 573, or the satisfiable subset?** The
   honest headline is *"573 insight types, of which N are computable on your data today."*
   The impressive one is *"573 insight types."* `YC_WEDGE_PLAN.md:324-326` argues the
   impressive one reads as **no wedge**. B3 makes the honest form the only one the API can
   emit — that is a product change, so it needs your call before 2026-09-25.
2. **Is `insufficient_data` allowed on the customer's screen?** The corpus says yes
   (`AGENT_NATIVE_UI_DECISION.md:191-192`), the code already does it, ADR 0020 makes it
   the standing rule. Confirm explicitly, because premortem M3 says the pressure to lower
   the floor arrives during a demo and D3 is the only thing standing in front of it.
3. **Does AB-3 hold a real veto over external analytics claims?** The directive grants
   one. It means AB-3 can tell Marketing, Growth and you that a sentence is false. This is
   a genuine constraint on you, so it needs an explicit yes.
4. **§44.7 SimPOS — scheduled, or aspiration?** If it is not on a roadmap with a date,
   `analytics.kpi_ground_truth_agreement` is permanently 0% and A5 should say *permanently*
   on the board rather than carry it as pending for three more months.
5. **INTEL-F3 — where does operator preference live?** A manager acting on a
   recommendation is neither `agent`, `guest` nor `bio`. It is the strongest human signal
   the product collects and it has no home in the neural footprint. Add `operator` to
   `subject_type`, or route it outside NF?

*(The 2026-08-24 question about demoing behind OD-20 is withdrawn: OD-20 is closed at
`analytics.controller.ts:51`. Recorded rather than deleted, per §1.)*
