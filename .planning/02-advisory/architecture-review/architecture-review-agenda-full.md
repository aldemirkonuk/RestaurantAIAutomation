---
type: agenda-full
division: advisory
department: architecture-review
status: active
metrics: [arch.layer_violations_open, arch.finding_age_days_max, arch.findings_closed_by_decision_ratio, arch.duplicated_invariants, arch.diverged_invariant_count, arch.direct_provider_callsites, arch.layer_bypass_callsites, arch.vacuous_pass_guards]
updated: 2026-08-28
links: ["[[architecture-review-charter]]", "[[architecture-review-premortem]]", "[[architecture-review-agenda-board]]", "[[architecture-review-directive]]", "[[architecture-review-loops]]", "[[architecture-review-schedule]]", "[[architecture-review-agent-stack]]", "[[architecture-review-questions]]", "[[decision-office-charter]]", "[[red-team-charter]]", "[[security-charter]]", "[[engineering-charter]]", "[[client-surfaces-charter]]", "[[platform-api-charter]]", "[[schema-migrations-charter]]", "[[messaging-delivery-charter]]", "[[research-math-charter]]", "[[harness-model-routing-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[evaluation-doneability-charter]]", "[[model-routing-inference-economics-charter]]", "[[ai-orchestration-charter]]", "[[harness-runtime-charter]]", "[[agent-evaluation-gates-charter]]", "[[agent-fleet-charter]]", "[[product-vision-charter]]", "[[0039-activation-plan-of-record]]", "[[0038-cards-run-as-declared-scripts]]", "[[0036-cost-routing-two-plans-in-harmony]]", "[[0035-wave2-seam-reconciliation]]", "[[0034-agent-stack-artifact]]", "[[0017-doneability-verdicts-are-sidecar-claims]]", "[[0007-org-structure]]", "[[ORG_STRUCTURE]]", "[[README]]", "[[ENDPOINTS]]", "[[PAGE_MAP]]"]
---

# Architecture Review — Full Agenda

**Dated 2026-08-28.** First real agenda; replaces the 2026-08-24 forecast.
Authored under [ADR 0039](../../decisions/0039-activation-plan-of-record.md) Track B,
[`GENERATION_BRIEF.md`](../../foundation/GENERATION_BRIEF.md) §8.

> **This function's founding backlog cleared itself, and that is the finding.**
> Seven findings were raised on 2026-08-24 as the evidence that a review function was
> needed. Re-measured against the tree today: **six of the seven have closed or
> materially moved — and not one of them closed because a finding was written.** P1 and
> OD-41 did it. `arch.findings_closed_by_decision_ratio` still has a **denominator of
> zero**. A review function whose backlog is fixed by other people's line work before it
> has raised a single finding has learned something real about itself, and this agenda
> says it out loud in §0 rather than opening a sweep on stale findings —
> [[architecture-review-premortem]] #1 is exactly the habit of publishing on schedule
> regardless of whether the content is still true.
>
> The agenda that follows is therefore **not** "publish the seven." It is one dated
> adversarial pass (§2), one standing findings program aimed at a defect class that did
> *not* exist on 2026-08-24 (§3), and the function's own two open questions carried to a
> date instead of a sentiment (§4).

---

## 0. Re-grade — the seven founding findings, measured 2026-08-28

Every row below was re-verified against the working tree this session. No figure is
carried forward from the charter without a re-measurement.

| ID | 2026-08-24 | Measured 2026-08-28 | Evidence |
|---|---|---|---|
| **AR-0** | Sev-1 · findings have nowhere to land; `questions.md` exists in 0 of 99 units | **CLOSED.** `find .planning -name "*-questions.md"` → **100**, one per unit, carrying the 42-day escalation rule | `architecture-review-questions.md:38-41`; created by `scripts/build_questions_files.py` under OD-41 |
| **AR-1** | Sev-1 · L6→L0 bypass: **2 files, 5 statements** | **HALVED, still live: 1 file, 3 statements.** `useSommelierQueries.ts:25-26` (select), `:42-43` (upsert), `:56` (delete). The `generated_reports` half went through the gateway | `apps/web/src/hooks/queries/useReportQueries.ts:13` records the move; `apps/web/src/services/api/reports.ts:90` is now a `GET /reports` client |
| **AR-2** | Sev-1 · one legal guardrail, two runtimes, **already diverged** (19 TS / 8 Py) | **CLOSED BY FIX, with a ratchet.** Python now imports a *generated* module whose canon is the TS file; drift fails CI | `services/agent-orchestrator/agents/provider_conversation_agent.py:125-133`; `scripts/sync_commitment_patterns.py`; CI job `commitment-guardrail-sync`, `.github/workflows/ci.yml:87-103` |
| **AR-3** | Sev-2 · 7 hand-rolled provider callsites; 1 retries; 3 no timeout | **CLOSED BY CONSOLIDATION.** Exactly **one** provider endpoint constant remains in the gateway, at the boundary itself, and a blocking guard stops a new one | `apps/api-gateway/src/common/model-client/model-client.service.ts:7`; guard `model-call-ledger`, `.github/workflows/ci.yml:120` |
| **AR-4** | Sev-1 · L4 unjoinable | **CLOSED 2026-08-25 (P1)** — already recorded in the charter | `model-client.service.ts:413`; `spend_logger.py:269,276,406` |
| **AR-5** | Sev-1 · tenant isolation is a per-controller convention | **MOVED, NOT CLOSED.** `tenant.guard.ts` still returns `true` with no user, but now as a documented backstop: the comparison moved into `assertTenantMatch`, run by `JwtAuthGuard` right after authentication. The invariant is enforced at the auth stage instead of per controller — and **nothing counts endpoints**, so no present figure is asserted | `apps/api-gateway/src/common/tenant/tenant.guard.ts:34-58`; OD-19 stays open |
| **AR-6** | Sev-3 · schema-drift precedent, fixed, retained as the template | **UNCHANGED as a finding — and vindicated as a template.** The shape it named has been copied **20 more times**: `scripts/check_*` is now **21 guards** | `scripts/check_schema_parity.sh:6-11`; `ls scripts/check_*` |

### 0.1 What the re-grade actually says

Three readings, and the third is the one that sets §4.

1. **The detection was right.** Every closed finding closed in the direction the finding
   named — one guardrail source of truth, one provider boundary, one report path through
   the gateway. Nothing was argued down on design grounds
   ([[architecture-review-premortem]] #4 has not fired).
2. **Detection was not the constraint.** All six closed without a finding being raised,
   read, or aged. `arch.findings_closed_by_decision_ratio` = **0/0**. The founding
   argument for this function — *"a layer violation is structurally invisible to the
   department that commits it"* ([[architecture-review-charter]] §Mandate) — survived
   contact with reality *and* was routed around by a milestone that fixed the same seven
   things for its own reasons.
3. **So the merge trigger's premise has changed and must be restated before its date.**
   The 2026-11-24 question was *"do findings convert?"* The honest question now is
   *"does this function detect anything the guard layer and a well-run milestone do
   not?"* §3.1 is this agenda's answer-in-the-form-of-a-test, and §4.2 carries the date.

**One number the re-grade adds, and it is a new class.** The repo grew a **guard layer**
between 2026-08-05 and today — 21 shell/Python guards plus inline CI steps, all built on
AR-6's template. Nothing reviews the guards. The census subject in §3.1 is therefore the
enforcement layer itself, which is the first review subject in this unit's history that
did not exist when the unit was chartered.

---

## 1. What this agenda is

Findings only. **This unit owns no line work, writes no code, and fixes nothing** —
[[architecture-review-charter]] §Non-goals, OD-16 locked in
[ADR 0007](../../decisions/0007-org-structure.md). Every output below lands in a
`<slug>-questions.md`, in a findings section of this unit's own docs, or as an
`OPEN-DECISIONS.md` row filed through [[decision-office-charter]]. Nothing here proposes
a commit outside `.planning/`, and no task blocks or gates anyone.

| # | Program | The question it closes | Close-time spine |
|---|---|---|---|
| **§2** | **The adversarial pass on Track A1's bake-off protocol** | *Is the bake-off capable of producing a result worth locking an ADR on — before it runs?* | Pre-registered today; pass closes before the first scored run |
| **§3** | **The standing findings program** | *Is one rule enforced the same way in every place it is enforced?* — applied to the guard layer, to the seam lines ADRs 0035/0036 drew, and to the layer map that still does not exist | Fortnightly, 1st and 15th |
| **§4** | **This function's own two open questions** | *What is the review scope, and does this function survive its own merge trigger?* | 2026-09-01 and 2026-11-24 |

**Locks respected.** Nothing here touches the pricing model (deferred) or brand/landing
visuals (held). This unit has no surface near either.

---

## 2. Program A — the adversarial pass on the bake-off protocol *(Track A1)*

[ADR 0039](../../decisions/0039-activation-plan-of-record.md) Track A1 assigns this pass
to [[architecture-review-charter]] by name, and the sequencing is the whole point: **the
pass happens before the bake-off runs, not after it reports.** A protocol reviewed after
a scored run is reviewed by someone who already knows who won.

The protocol is being drafted now at `scripts/bakeoff/` on a separate branch. It is **not
in this worktree and this pass has not read it.**

### 2.1 The pre-registration — this section is the instrument

**AR-A1.0 · Publish the axes before the protocol is readable.**
This agenda, dated 2026-08-28 and committed before `scripts/bakeoff/` exists on any
branch this unit can read, *is* the pre-registration. The five axes in §2.2 are fixed
here. An axis added after reading the protocol must be marked `added-after-reading` in
the pass, with its reason.

- **Doneability:** the pass document cites this section by date and lists any
  post-hoc axis separately. A pass with no such list, and no statement that there were
  none, is not done.
- **Close-time:** closed on publication of this file — 2026-08-28.
- **Evidence:** ADR 0039 Track A1 row (*"[[architecture-review-charter]] adversarial
  pass"*); [[architecture-review-directive]] §Decision rights — severity and finding
  content are this unit's, published in advance, never per-incident.
- **Why it is worth the ceremony:** [[architecture-review-premortem]] #4 is this function
  being faithfully right about the wrong rule. The symmetric risk on a one-shot review is
  being faithfully right about the wrong protocol *because the protocol taught it what to
  look for*. Pre-registration is the only cheap defence.

### 2.2 The five axes

Each axis below is checked against the protocol, and each closes with either a written
finding or an explicit **"checked, clean"** line. Silence on an axis is a failed pass.

**AR-A1.1 · Workload validity — can the scored set say what "done" means?**
ADR 0039 A1 names the workloads: *"scoring candidates against `cards.json` (102 declared
specs = the workloads)."* Counted from the index this session:

| Fact | Value | Source |
|---|---|---|
| declared cards | **102** across 100 units | `.planning/00-index/cards.json` (`card_count`) |
| cards whose `quality_bar` contains `NONE (gap)` | **58** | same, counted 2026-08-28 |
| cards that actually execute | **8** | `scripts/agents/run_card.py:333-342` (`IMPLEMENTED`) |
| routing mix | 36 mechanical · 36 extraction · 30 judgment | `cards.json` `routing_class_counts` |

**The finding this axis exists to make available:** a bake-off scored over a workload set
in which **57% of the workloads have no verdict basis** is measuring completion, not
capability — and the candidate that finishes fastest wins a race nobody defined. This
unit's own card is in the 58 (`quality_bar: … NONE (gap)`), which is why the point is
made as a measurement and not as an accusation.

- **Doneability:** the protocol names its scored subset with a count, and each scored
  card has a stated verdict basis, or the pass writes a Sev-1 to
  [[harness-runtime-charter]]'s questions file naming the gap and its size.
- **Close-time:** within **3 days** of `scripts/bakeoff/` landing on a readable branch;
  hard stop — **before the first scored run**.

**AR-A1.2 · Rigged axes — which candidate wins each axis by construction?**
Every scoring dimension is read for a priori advantage. Three named suspects, from the
record rather than from imagination:

- an axis phrased around fitting the existing saga/DLQ/RabbitMQ model scores the in-house
  option 1.0 *by definition*, because that is what `core/` already is;
- "harness overhead" measured without the messaging surface OD-52 says `base_agent.py`
  actually is — *"zero LLM integration … it is RabbitMQ/saga/DLQ infrastructure"*
  (OD-52, `OPEN-DECISIONS.md:40`) — prices two candidates on different substrates;
- weights chosen or revised after a pilot run.

- **Doneability:** every axis carries one line naming which candidate it favours before
  any data, and why that is acceptable. An axis with no such line is a finding; a
  weighting revised after a run is a Sev-1.
- **Close-time:** same pass, before the first scored run.

**AR-A1.3 · Candidate-set completeness — what is not on the list?**
OD-03 names three candidates (`OPEN-DECISIONS.md:40`); OD-52 reframes the question to
*"which reasoning layer sits ON our messaging infra"* (`:40`). Under the reframe the
candidate set is a different set, and the **null candidate** — no separate harness, a
reasoning loop behind the `common/model-client` boundary that already exists and is
already guarded — is a candidate whose absence would itself be the finding.

- **This axis names gaps and never picks.** Choosing is [[harness-runtime-charter]]'s
  and the founder's; GENERATION_BRIEF §8.4 forbids resolving an open fork in a unit doc,
  and [[architecture-review-charter]] §Non-goals says the same in its own words.
- **Doneability:** the protocol either includes the null candidate or states in writing
  why it is excluded. Either closes the axis; neither being present is the finding.
- **Close-time:** same pass.

**AR-A1.4 · Integration costs hidden by enthusiasm.**
The axis this function is uniquely placed to run, because integration cost is a *layer*
cost and the team measuring a harness is not the team that pays it. Three that are
countable today:

| Cost | Why a harness-authored protocol is unlikely to price it | Evidence |
|---|---|---|
| **The spend-ledger guard** | Any candidate that calls a provider through its own client either routes through the accepted paths or grows a debt list the guard declares **shrink-only**. Breaking a blocking guard is part of a candidate's price | `scripts/check_model_calls_logged.sh:20-35` (`NEVER VACUOUS`, exit 2); CI job `model-call-ledger`, `.github/workflows/ci.yml:120` |
| **The `core/` diet** | ADR 0039: *"Nothing in Track A may extend `core/` while A1 runs."* A candidate whose adoption path is a `core/` extension **cannot be piloted under the plan running the bake-off** — the constraint has to be in the protocol or the winner is unadoptable for the duration | ADR 0039 §Track A internal order |
| **Fleet migration** | 24 modules on disk, 23 registered, 5 refused at boot as stubs. Migration cost is per module, not per benchmark, and a benchmark suite does not surface it | fleet census consumed per ADR 0035 §3; `services/agent-orchestrator/core/orchestrator.py:245` |

- **Doneability:** each of the three appears in the protocol as a priced line or as an
  explicit out-of-scope statement. Any that appears as neither is written up.
- **Close-time:** same pass.

**AR-A1.5 · Who grades the run?**
[ADR 0036](../../decisions/0036-cost-routing-two-plans-in-harmony.md) put the line at
**methodology (RM-1) / operation (aio)** and made both charters' non-goals binding;
ADR 0039 A1 says *"RM-1 supplies methodology."* If the protocol is authored **and** graded
by the team that operates the harness, ADR 0036's line is broken on its first exercise —
and that is a finding against **the seam**, not against the protocol or its authors.
It is also the direct link to §3.2.

- **Doneability:** the protocol names the grader and the grading basis; if the grader is
  the author, one finding goes to [[research-math-charter]] and one line to
  [[decision-office-charter]] noting ADR 0036's failure test has fired once.
- **Close-time:** same pass.

### 2.3 The two follow-ups, so the pass is not a one-shot

**AR-A1.6 · One revision round.** The revised protocol is re-read once against the same
five axes. *Doneability:* every §2.2 finding is marked resolved / accepted-in-writing /
still-open, with no re-argument of the original. *Close-time:* **7 days** after the
revision lands.

**AR-A1.7 · The post-run read, before OD-03 is marked Resolved.** The scored run is read
once, against the axes only: did an axis flagged as rigged move the result? *Doneability:*
one paragraph, filed to [[decision-office-charter]] **before** OD-03's row is flipped —
after would be commentary. *Close-time:* within **3 days** of the scored run publishing.

> **What this pass is not.** It does not pick a candidate, score anything, gate the run,
> or require anyone's agreement to proceed. Findings-only is locked
> ([[architecture-review-directive]] §Decision rights). If A1's owners run the bake-off
> the day after receiving a Sev-1 from this pass, that is entirely within their rights and
> the finding simply starts ageing.

---

## 3. Program B — the standing findings program

Three subjects, all on the fortnightly spine in [[architecture-review-schedule]] (sweeps
on the 1st and the 15th; 42 days = three sweeps = escalation).

### 3.1 AR-B1 · The guard census — one rule, 21 enforcement points

**The invariant:** *a guard that cannot check what it claims to check must fail, not
pass.* It is written down, precisely, in one place:
`scripts/check_model_calls_logged.sh:20-35` — *"Exit 2 = the guard could not check what it
claims to check … every 'found nothing' path here is a FAILURE, not a pass."* It is the
same claim [[architecture-review-premortem]]'s closing paragraph makes about this whole
function: a green signal from a system that is not measuring the right thing is worse
than no signal.

**The census, measured 2026-08-28.** 21 guards under `scripts/check_*`; **9 contain an
`exit 2` / `sys.exit(2)` path, 12 do not.**

| Has an explicit cannot-check exit | Does not |
|---|---|
| `check_decision_claims.sh` · `check_gateway_boots.sh` · `check_model_calls_logged.sh` · `check_schema_parity.sh` · `check_citation_pairing.py` · `check_migrations_single_home.py` · `check_new_tables_are_locked_down.py` · `check_queried_tables_exist.py` · `check_task_types_are_graded.py` | `check_db_reachable.sh` · `check_no_direct_stock_writes.sh` · `check_no_direct_type_attributes_access.sh` · `check_no_guest_name_matching.sh` · `check_no_raw_guest_channels.sh` · `check_beverage_identity_parity.py` · `check_beverage_kind_regression.py` · `check_display_name_parity.py` · `check_log_sanitizer_usage.py` · `check_no_vendored_deps.py` · `check_od_ids_exist.py` · `check_test_scripts_are_real.py` |

**12 is not 12 defects, and the census must not pretend otherwise.** Some of the twelve
have no unable-to-check state at all — a pure pattern-absence guard over a fixed path may
genuinely have nothing to be vacuous about. Deciding which is which is the human half,
and it is exactly the judgement [[architecture-review-agent-stack]] §2 keeps *outside*
`arch-census-scout`'s card.

- **Doneability:** all 21 carry exactly one of three labels — *has an exit-2 path* /
  *cannot fail-to-check, with the reason* / **can fail to check and passes green** — and
  the third list is published with `path:line`, one finding per owning unit, never one
  bulk complaint. A census that produces a percentage instead of a named list has failed
  ([[architecture-review-loops]] loop-invariant-census: *"a COUNT WITH NAMES, never a
  percentage"*).
- **Close-time:** sweep 1 — **2026-09-01**. Escalation at three sweeps: **2026-10-13**.
- **Evidence:** the counts above; AR-6's template line
  (`check_schema_parity.sh:6-11`); the rule text at `check_model_calls_logged.sh:20-35`.
- **New metric it defines:** `arch.vacuous_pass_guards` — guards that can pass without
  checking. Baseline unknown until the census runs, which is the honest state to publish.
- **Scope note, stated so the census cannot quietly grow:** subject is the 21
  `scripts/check_*` guards **plus** the inline `run:` steps in `.github/workflows/ci.yml`
  that assert something without invoking one of the 21. Anything else is next quarter's.

**AR-B2 · The severity-ladder amendment this census implies — REACH, needs a decision.**
Propose that *a check which can pass without checking is Sev-1 regardless of which layer
it sits in*, because it converts unknown risk into false assurance. This is an amendment
to [[architecture-review-directive]] §The severity ladder, proposed here and decided by
the founder — this unit may propose the rule it owns and may not change it silently
([[architecture-review-charter]] §Boundaries). *Doneability:* a founder answer, either
way, recorded. *Close-time:* raised **2026-09-01**, answer sought by **2026-10-13**.
**Aspiration pending a decision — it is on this page as a proposal, not a practice.**

### 3.2 AR-B3 · The seam-line watch — two ADRs wrote failure tests and named no one to run them

[ADR 0035](../../decisions/0035-wave2-seam-reconciliation.md) resolved seven wave-2 seams
to *one owner per question* and claims in its Consequences that *"no doc still states the
conflict as open."*
[ADR 0036](../../decisions/0036-cost-routing-two-plans-in-harmony.md) drew
methodology/operation and wrote an explicit failure test: *"the same benchmark defined
twice, or a routing rule shipped that RM-1's methodology cannot account for, twice
running"* — with the escalation **merge, never duplicate**.

Neither ADR names anyone to run its test. A seam line nobody re-reads is exactly the
`duplicated_invariants` shape this unit already counts, one layer up: the invariant is
*"this question has one owner"* and the enforcement points are the charters, cards, and
loops that were amended to say so.

> **This is verification, not re-litigation.** ADR 0036 §Options explicitly **rejected**
> *"route to Architecture Review first"* for deciding the fork, and it was right to —
> a findings pass would have re-derived what P1 proved. Checking whether a locked line
> still holds in the documents that carry it is the opposite move, and it is the one
> thing an outside-the-line function is for.

- **Doneability:** (a) each of ADR 0035's eight items gets a *verified* or *contradicted*
  line naming the `path:line` that carries its resolution — ADR 0035's own Consequences
  sentence is the claim under test; (b) ADR 0036's failure test gets one stated observable
  and a named reader, or its absence is filed to [[decision-office-charter]] as a finding
  against the ADR rather than against either team.
- **Close-time:** ADR 0035's eight — sweep 2, **2026-09-15**. ADR 0036's test — standing,
  first read **2026-11-28** (quarterly, with `loop-layer-stack-review`).
- **Evidence:** ADR 0035 §Consequences; ADR 0036 §Options 1 and §Consequences;
  [[architecture-review-charter]] §Boundaries — *the invariant census*.

### 3.3 AR-B4 · The directory→layer map — still the blocker, now named in this unit's own card

Carried unchanged from the 2026-08-24 agenda's Step 1, and it has since become a
machine-readable gap: this unit's card declares
`"[[README|foundation-README]] §1 — the L0–L6 rule; **no directory→layer map exists
(gap)**"` and the trigger `topic: commit.touches_layer_boundary` with
`publisher: NONE` (`.planning/00-index/cards.json`, `architecture-review`). Without the
map, *"is this a violation"* has no mechanical answer and `arch-census-scout` has nothing
to be reproducible about.

- **Where it lands, because retire-to-write applies here too:** as a proposed **amendment
  to [[README]] §1** — one added column on the existing seven-row table — drafted inline
  in `architecture-review-questions.md` and carried to `OPEN-DECISIONS.md` by
  [[decision-office-charter]]. **No new top-level document** (CLAUDE.md §4).
- **Doneability:** every top-level directory under `apps/`, `services/`, `packages/`,
  `supabase/`, `scripts/` carries exactly one layer **or** appears on a published
  unassigned list with its reason. The known-hard cases are named as ambiguities rather
  than resolved by fiat: the gateway is L1, L2 **and** L6 depending on the file, and L4 is
  now a *boundary* (`common/model-client`) rather than a directory.
- **Close-time:** draft at sweep 1, **2026-09-01**. The *ownership* of the answer is a
  founder question (§5.3) and does not block the draft.
- **Evidence:** `cards.json` gap row above; [[README]] §1's seven-row table;
  [[architecture-review-agent-stack]] §5 gap table.

### 3.4 AR-B5 · The two live remnants — re-check, do not re-publish

AR-1 (3 statements, one file) and AR-5 (the endpoint count nobody has recounted) are the
only founding findings still open. They are **re-checked** at each sweep and are **not**
re-published as new findings — re-publishing a stale backlog to make a sweep look
productive is [[architecture-review-premortem]] #1 in its cheapest form.

- **Doneability:** AR-1 — the three statements are named with current `path:line` and
  either closed or aged; AR-5 — this unit asserts **no** endpoint figure and instead
  states that OD-19 owns the recount ([[security-charter]]), one finding cross-linked,
  never two ([[architecture-review-charter]] §The overlap that will actually bite).
- **Close-time:** sweep 1, **2026-09-01**, then every sweep until closed.
- **Evidence:** `useSommelierQueries.ts:25-26,42-43,56`; `tenant.guard.ts:34-58`;
  OD-19 open at `OPEN-DECISIONS.md`.

---

## 4. Program C — this function's own two questions, on dates

### 4.1 AR-C1 · The scope contradiction, filed rather than fixed

[[architecture-review-charter]] §Mandate says this function *"reviews all of Platform,
Applied AI, and Product"* and quotes [[ORG_STRUCTURE]] §3 as reading *"All of Technology +
Product."* **§3 today reads "All divisions"**, with a dated 2026-08-24 correction note
attached. Two documents disagree about this function's scope, and the disagreement is
load-bearing: under the charter's wording, Research & Math, Intelligence, Commercial and
Corporate are outside the review surface; under §3's, they are inside and the surface is
100 units.

[[architecture-review-agent-stack]] §5 already routes this to
[[decision-office-charter]]'s contradiction register and resolves nothing. This agenda
does the same, deliberately: wave-3 rules forbid touching a charter
(GENERATION_BRIEF §8.4), and a review function that quietly re-scopes itself in an agenda
is doing the thing it exists to catch.

- **Doneability:** one row in `decision-office-questions.md` carrying **both** citations
  and both readings, plus §5.1 below. Closed when the founder answers, either way.
- **Close-time:** filed sweep 1, **2026-09-01**; escalates as a binary at **2026-10-13**.
- **Evidence:** `foundation/ORG_STRUCTURE.md` §3 row for Architecture Review;
  [[architecture-review-charter]] §Mandate warning block;
  [[architecture-review-agent-stack]] §5 gap 3.
- **Made visible, not resolved:** [[architecture-review-agenda-board]] now carries **two**
  review-surface queries side by side — the charter's three divisions and §3's all — so
  the size of the disagreement is a thing you can look at rather than a paragraph.

### 4.2 AR-C2 · The merge trigger, with its premise restated

[[architecture-review-premortem]] #1(c): *if at 2026-11-24 fewer than half of raised
findings have closed by decision, Architecture Review merges into
[[decision-office-charter]] rather than continuing.* §0.1 changes what that test is
measuring. The original premise was *findings do not convert*. The measured premise is
*six of seven converted with no finding involved* — so the live question is whether
detection adds anything to a working guard layer.

- **Doneability:** on **2026-11-24** this function publishes
  `arch.findings_closed_by_decision_ratio` with a **denominator of at least 5** — five
  findings actually raised into `<slug>-questions.md` files with dates — **or** files its
  own merge escalation. A denominator under 5 is a merge case on its face: a detection
  function that could not find five things worth writing in three months has answered the
  question.
- **Close-time:** **2026-11-24**, fixed. Not moveable by this function
  ([[architecture-review-directive]] — *"a discretionary clock is not a clock"*).
- **Evidence:** premortem #1(c); the 0/0 ratio in §0.1; OD-24 and OD-26 as the symmetric
  precedents.

---

## 5. Seams — what leaves this unit, and to whom

Every row is a finding addressed to another unit's questions file. None is an assignment,
and none of them is written twice ([[architecture-review-charter]] §The overlap that will
actually bite).

| To | What | When |
|---|---|---|
| [[harness-runtime-charter]] · [[ai-orchestration-charter]] | The §2.2 pass, all five axes | Before the first scored run |
| [[research-math-charter]] | §2.2 axis 5 only, if the grader is the author — ADR 0036's line, one exercise in | With the pass |
| [[schema-migrations-charter]] · [[engineering-charter]] · [[security-charter]] · [[compliance-privacy-charter]] | The §3.1 guard census, split per guard owner — one finding per guard, never one bulk list | 2026-09-01 |
| [[decision-office-charter]] | The §4.1 scope contradiction; the §3.3 README §1 amendment; every 42-day escalation | 2026-09-01 onward |
| [[client-surfaces-charter]] | AR-1's three remaining statements | Each sweep until closed |
| [[red-team-charter]] | This agenda itself, as the attack surface the premortem invites: *at day 60, what changed in the repo because any of this was written?* | 2026-10-27 |

**One ask, addressed rather than acted on.** `arch-census-scout` is declared
`routing_class: mechanical` and every one of its seven counts is a grep — yet it is not in
`run_card.py`'s `IMPLEMENTED` set (8 of 102, `scripts/agents/run_card.py:333-342`). This
unit **cannot and will not** write it: a patch against `scripts/` violates its first
non-goal, and build capacity here would create an incentive to review what it wants to
build ([[architecture-review-agent-stack]] §2, hard rule 1). The ask, with the count
definitions attached, goes to the card layer's owners.

---

## 6. Findings no card and no loop can carry

Per GENERATION_BRIEF §8.1: a task no card or loop can carry is a finding, not a task.
These three are recorded here and are **not** scheduled.

1. **`commit.touches_layer_boundary` has no publisher and cannot get one until AR-B4
   lands.** The card declares the trigger; nothing fires it. Until the layer map exists,
   the fortnightly sweep is the entire blind-spot bound — 14 days.
2. **A finding landing in another unit's `questions.md` notifies nobody.** The file exists
   (OD-41, 100 of 100); nothing pushes. The Dataview on `open_questions > 0` only fires
   for someone already in the vault. Every close-time in §2–§4 assumes a reader who has
   not been told they have mail.
3. **This unit's own card reads `quality_bar: … NONE (gap)`** — ADR 0017 has no verdict
   basis for an architecture census. So the function that is about to grade a bake-off's
   verdict basis (§2.2 axis 1) does not have one for its own output. Stated because it is
   true and because [[red-team-charter]] would otherwise have to find it.

---

## 7. Questions for the founder

1. **Scope — which document is right?** [[ORG_STRUCTURE]] §3 says **"All divisions"**;
   [[architecture-review-charter]] §Mandate says **"Platform, Applied AI, and Product."**
   One of them has to be amended. *"All divisions"* is 100 units and ~76 teams reviewed by
   a function with no build capacity and a fortnightly cadence
   ([[architecture-review-premortem]] #5 is Product falling off a shorter list than that).
   *"Platform + Applied AI + Product"* leaves L4's methodology owner outside the mandate.
   **This function's position: §3 is right in principle and unaffordable in practice —
   the honest form is "all divisions, reviewed on a published rotation, with the rotation
   itself reported as a coverage number."** It is the founder's call either way.
2. **Is the 42-day escalation adopted?** Unchanged from 2026-08-24 and still unanswered.
   Without it, findings-only has no failure mode anyone notices. Every close-time in §3
   and §4 assumes it.
3. **Who owns the answer to the directory→layer map (§3.3)?**
   [[engineering-charter]] is the natural owner, but the map is the interface between this
   function and every reviewed unit, and an interface owned by the reviewed party is not
   an interface.
4. **Is the merge trigger binding at the restated premise (§4.2)?** The 0/0 ratio makes
   the original test unanswerable in its own terms. A denominator of 5 raised findings by
   2026-11-24 is this function's proposed replacement test, and it is proposed as binding.
5. **Is "a check that can pass without checking" Sev-1 (§3.1, AR-B2)?** It is a change to
   the severity ladder this function owns and may not make silently.
6. **AR-1 — fix, or accept in writing?** Three statements in one file
   (`useSommelierQueries.ts:25-26,42-43,56`) reaching Postgres from the browser while the
   `generated_reports` sibling has already moved behind the gateway. A written *"accept —
   owner [[client-surfaces-charter]], revisit 2027-02-01"* closes it and counts as a
   success ([[architecture-review-directive]] §The clock). Two of the seven founding
   findings closing by acceptance would give §4.2 a denominator honestly.
