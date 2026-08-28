---
type: agent-stack
division: corporate
department: strategy-fundraising
team: positioning-fundraise-readiness
status: designed
updated: 2026-08-27
metrics: [strategy.claim_to_evidence_coverage, strategy.citation_drift_rate, strategy.claim_overstatement_count, strategy.wedge_metric_instrumentation, strategy.diligence_pack_completeness]
links: ["[[positioning-fundraise-readiness-charter]]", "[[positioning-fundraise-readiness-schedule]]", "[[positioning-fundraise-readiness-loops]]", "[[positioning-fundraise-readiness-directive]]", "[[positioning-fundraise-readiness-premortem]]", "[[0034-agent-stack-artifact]]", "[[strategy-fundraising-agent-stack]]", "[[skills-charter]]", "[[instruments-equity-charter]]", "[[narrative-collateral-charter]]", "[[metric-contract-truth-assurance-charter]]"]
---

# Positioning & Fundraise Readiness — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This team owns the claim, not the paper and not the craft, so its agent is a **recorder and a
> checker and nothing else**: a team whose job is to stop claims outrunning evidence must not
> own a tool that produces claims ([[positioning-fundraise-readiness-directive]] R5). Mechanisms
> referenced, not restated: harness → [[harness-runtime-charter]] (**OD-03 open**), model →
> [[model-routing-inference-economics-charter]], mutation gate →
> [[action-safety-the-human-gate-charter]], skills → [[skills-charter]].

**The hard limit, inherited from [[strategy-fundraising-agent-stack]] and restated because this
is the unit that touches outward material.** This agent never speaks to an investor, sends,
files, or represents the company; never authors an outward artifact (R5 —
[[narrative-collateral-charter]] does); never drafts a SAFE, board consent, stock purchase or
advisor agreement ([[instruments-equity-charter]] drafts, **the founder decides terms** —
`corporate.md:505-506`); never decides to raise. Its strongest action is to **hold a send**.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `pfr-claim-gate` | Record every outward claim verbatim with its audience, evidence and verification result, re-verify the citations at the moment of sending, and return hold / weaken / flag / release — never the artifact itself | NEW |

One row. Recorder and checker are the same loop closed at the same moment (L-PFR-1 and L-PFR-2
both close per-claim); splitting them would let the register be current while the gate is dead
— [[positioning-fundraise-readiness-premortem]] P1 exactly.

## 2. Agent cards

```yaml
agent: pfr-claim-gate
unit: positioning-fundraise-readiness
triggers:
  - topic: claim.proposed_outward     # publishers intended: narrative-collateral, editorial-gate, design-partner-operations, growth, sales (L-PFR-1 inputs_from) — none emits today (gap)
  - topic: claim.spoken_externally    # publisher: the founder, by hand within 24h (R6) — no mechanism exists; zero rows after an active month is a signal, not restraint
  - schedule: "monthly — citation drift sweep (L-PFR-3); wedge reduction (L-PFR-4); evidence-type mix"     # [[positioning-fundraise-readiness-schedule]]
  - schedule: "quarterly — competitive-read refresh; readiness-vs-claim balance (L-PFR-5); diligence index refresh"
consumes:
  - "the claim register — publisher: this agent itself; it does not exist yet (charter §Metrics)"
  - "metric contracts — publisher: [[metric-contract-truth-assurance-charter]] (chartered, not built); verified recovery numbers — publisher: [[design-partner-operations-charter]] S1, credits watched landing (chartered, not built)"
  - "`.planning/YC_WEDGE_PLAN.md` §6 and every `path:line` in the register — publisher: the repo"
  - "quarterly drift list — publisher: [[strategy-fundraising-agent-stack|strategy-warden]]"
emits:
  - "register rows and recorded rejections → consumer: [[positioning-fundraise-readiness-agenda-board]]"
  - "hold / weaken / flag / release verdicts → consumers: [[narrative-collateral-charter]], [[editorial-gate-charter]], [[design-partner-operations-charter]] (chartered, none built — gap)"
  - "strategy.citation_drift_rate, .claim_to_evidence_coverage, .claim_overstatement_count → the board, and the department's monthly line"
  - "nf_a events (task_type: claim_check) — consumer: NONE (gap, see §5)"
routing_class: judgment      # the weakest verb the evidence supports is a judgment call, not a lookup
quality_bar: "the five-question send checklist returns one of hold / weaken / flag / release with a reason; every citation returns holds / drifted to :N / inverted / gone — **silence fails the run**; zero drift across a document older than a month is a defect until proven otherwise ([[positioning-fundraise-readiness-schedule]]). NONE (gap) — ADR 0017 defines no verdict basis for claim checks"
autonomy:
  read: autonomous
  propose: autonomous        # register rows, holds and weakenings land as PRs; a release is a recommendation, never a send
  mutate_stock_money_outbound: confirm    # constant — and this agent has no outbound surface: the send is a human act, every time
memory: positioning-fundraise-readiness
escalates_to: "[[strategy-fundraising-charter]]"
```

**The card's two hard rules.** (1) It weakens wherever weakening is possible and blocks only
when it is not (R7) — a gate that only ever blocks gets routed around. (2) The rule points
**upward**: a claim originating with the founder is flagged like any other (R8); P5 treats
*"we policed the blog and not the pitch"* as predicted, not unlucky.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `claim-register-entry` | T2 | Any claim about to go outward, written or spoken | A row whose `evidence` field is a query id, `path:line` + symbol, or a demo path — prose fails the run | The **573** insight-type figure entered the YC narrative at `YC_WEDGE_PLAN.md:324` while the corpus also claimed 375; the register would have entered it `BLOCKED`. Checkable: the dispute was staged as OD-33 and **settled at 573 on 2026-08-26** by transpiling `insight-catalog.ts` standalone (`OPEN-DECISIONS.md:37`) — the block would have lifted on a measurement, which is the state machine working | NEW |
| `citation-reverify` | T2 | Every send; the monthly sweep (L-PFR-3) | Every citation returns `holds` / `drifted to :N` / `inverted` / `gone`; silence is a failure | Re-verified 2026-08-27: (a) the 375 source is now a **retired stub** at `.planning/07-reference/LLM_INSTRUCTION_PROMPTS.md:28-38`, which states in its own words that anchors `:19,51,56,166` point at retired text — a `gone`, plus a moved path; (b) `YC_WEDGE_PLAN.md:406` still asserts ux-optimizer has 0 `@UseGuards` *"all re-confirmed 2026-07-27"* while `ux-optimizer.controller.ts:55` carries `@UseGuards(JwtAuthGuard)` — and this team's charter cites that line as `:404` and the contradicting Track A row as `:339`, now `:406` and `:340` | NEW |
| `verb-strength-check` | T2 | Any draft outward artifact | Every money or completion verb matched against its contract; `recovered` with no landed credit is a hard flag | `YC_WEDGE_PLAN.md:315` names *dollars recovered* as **the** metric while `:31-33` of the same document says it means *"we asked"* until an 812 lands, and `:369-373` calls it *"half vanity and half unverifiable"*. All three lines re-read 2026-08-27 and hold at those numbers — the contradiction is live, in the one artifact this team inherited | NEW |

`wedge-reduction-check` and `evidence-type-mix` are named in
[[positioning-fundraise-readiness-schedule]] and **absent here on purpose**: the schedule itself
labels both as having no past instance, and README §3.3 deletes such a row rather than keeping
it as an aspiration. `diligence-index-check` stays dormant behind the split trigger (R4). All
three remain commissioned in the schedule; none is this agent's skill until it has fired once.

Consumed, owned elsewhere: the registry and envelope ([[skills-charter]]); the metric
definitions the verb check grades against ([[metric-contract-truth-assurance-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; consolidation emits candidates into
  [[skill-harvesting-charter]]'s queue, still through the §3.3 gate.
- **Episodic** — nf_a `task_type: claim_check`, `context` keys `claim_id`, `audience`,
  `channel` (`written` | `spoken`), `evidence_type`, `verification_result`. The register is the
  canonical record; nf_a carries the *checking* — which is what makes a rejection count stuck at
  zero while claims ship legible over time (L-PFR-1).
- **Semantic** — `memory/` beside this file, index
  `positioning-fundraise-readiness-MEMORY.md`. First facts already dated: *the founding artifact
  is 100% `path:line` evidence with zero demos, and that mix produced a ≈29% drift rate*
  (charter §Evidence), and *a citation re-confirmed by a monthly sweep inverted anyway* (§3,
  2026-08-27). Frontmatter per ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, charter §Boundaries, and the register rows for the
  claim in hand. `YC_WEDGE_PLAN.md` is a **retrieval target by `path:line`**, never preloaded —
  reading 406 lines to check one citation is the habit CLAUDE.md §2 forbids.

**Consolidation** — monthly, riding the L-PFR-3 drift sweep already in
[[positioning-fundraise-readiness-schedule]]: read the month's `claim_check` slice; write one
fact per durable finding, **failures first** — each drifted or inverted citation becomes a fact
naming the mechanism (*"a periodic sweep stamped a date instead of a result"*, P2), never
*"drift rose"*; expire facts unverified 90 days; propose skill candidates. One PR, "no delta"
stated aloud. **P1's exception applies here too:** a quiet month with nothing sent is a correct
"no delta", one in which artifacts shipped is a finding — so the run reads the send log
alongside `git log --stat`. **Gap:** no schedule row mirrors this cadence yet.

## 5. Async contract

Loops in [[positioning-fundraise-readiness-loops]] (all five carry a `close_time`; two close
per-event), nf_a events, vault PRs, skill candidates — never a synchronous call, never an
outward message. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `claim.proposed_outward` has no publisher | The five producing units are chartered, not built; today a claim arrives as a draft or a conversation. Until one emits, the gate depends on being *invited*, and a claim that skips the invitation is invisible — P1's mechanism |
| `claim.spoken_externally` has no mechanism at all | R6 makes a pitch a publication, but only a human can log it. The 24-hour rule is the whole control, and its failure mode is silent |
| Verdict consumers do not exist yet | `hold`/`weaken` verdicts have no unit to land on until [[narrative-collateral-charter]] and [[editorial-gate-charter]] are running; recorded rather than assumed, per `core/orchestrator.py:198-206` |
| `nf_a` `claim_check` has no consumer | [[ai-orchestration-agent-stack\|aio-orchestrator]] rolls up `aio-*` families only |

## 6. Evidence today

- **NEW — `pfr-claim-gate` and all three skills.** `.claude/skills/` does not exist; the repo has
  zero committed skills ([[README|foundation-README]] §3.1). Every past instance in §3 was
  performed by hand — the 2026-08-24 generation and the 2026-08-27 re-verification.
- **PARTIAL — the material, and only the material.** `.planning/YC_WEDGE_PLAN.md` (406 lines) is
  real and opinionated, and is also the team's first defect report (charter §Evidence).
- **NEW — the register, the send checklist, the diligence index, and everything in §4.**
- **One charter line is already stale, reported here and not resolved here.** The charter calls
  the 375-vs-573 contradiction live; **OD-33 settled it at 573 on 2026-08-26**
  (OD-33, `OPEN-DECISIONS.md:37`) and the 375 source is now a retired stub.
  CORP-F3, CORP-F1/OD-17, OD-23 and OD-14 remain open and untouched by any card above.
