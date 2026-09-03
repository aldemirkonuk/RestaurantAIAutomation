---
type: agenda-full
division: corporate
department: strategy-fundraising
status: active
metrics: [strategy.claim_to_evidence_coverage, strategy.citation_drift_rate, strategy.claim_overstatement_count, strategy.wedge_metric_instrumentation, strategy.diligence_pack_completeness]
updated: 2026-08-28
links: ["[[strategy-fundraising-charter]]", "[[strategy-fundraising-premortem]]", "[[strategy-fundraising-agenda-board]]", "[[strategy-fundraising-directive]]", "[[strategy-fundraising-loops]]", "[[strategy-fundraising-schedule]]", "[[strategy-fundraising-agent-stack]]", "[[strategy-fundraising-questions]]", "[[positioning-fundraise-readiness-charter]]", "[[positioning-fundraise-readiness-agenda-full]]", "[[positioning-fundraise-readiness-agent-stack]]", "[[positioning-fundraise-readiness-loops]]", "[[positioning-fundraise-readiness-schedule]]", "[[positioning-fundraise-readiness-directive]]", "[[0039-activation-plan-of-record]]", "[[0034-agent-stack-artifact]]", "[[0029-p3-plan-of-record]]", "[[OPEN-DECISIONS]]", "[[metric-contract-truth-assurance-charter]]", "[[design-partner-operations-charter]]", "[[narrative-collateral-charter]]", "[[editorial-gate-charter]]", "[[standards-verification-charter]]", "[[instruments-equity-charter]]", "[[legal-charter]]", "[[finance-pricing-charter]]", "[[skills-charter]]", "[[decision-office-charter]]", "[[red-team-charter]]", "[[ORG_STRUCTURE]]"]
---

# Strategy & Fundraising — Agenda · 2026-08-28

> First real agenda. Replaces the 2026-08-24 forecast under
> [[0039-activation-plan-of-record]] Track B. Covers **both units** — the department
> and its one team, [[positioning-fundraise-readiness-charter]] — because there is one
> cadence by charter, and two agendas would be the split this department declined.

> **The hard limits, restated before anything else**
> ([[strategy-fundraising-directive]] R8, [[strategy-fundraising-agent-stack]] header).
> Nothing here drafts an instrument or lays out a deck. Nothing here contacts an
> investor, sends, files, or represents the company. **Equity and the raise decision
> are the founder's, without exception** — [[instruments-equity-charter]] drafts the
> paper, the founder decides the terms (`corporate.md:505-506`). Pricing stays
> deferred; this agenda records the fork and never sets a number. Every deliverable
> below is a register row, a checker, a specification, a measured finding, or a hold.

## The frame — what changed under this department's feet since 2026-08-24

The 2026-08-24 charter said this department starts with **one inherited artifact it
must audit**: `.planning/YC_WEDGE_PLAN.md`, 406 lines, whose §6 "Verified sources"
(`:398-406`) was the only measurable thing it owned. The charter graded that sample at
**≈29% drift** — *"≥2 of the 7 sources have drifted or inverted."*

**That number was re-measured for this agenda, all seven sources, today.
It is 5 of 7 — 71%.** Every row below was read off disk on 2026-08-28 in this
worktree; the full table is Program 2.

Four other things moved, and each one changes what is schedulable:

| What the vault says | State on 2026-08-28 |
|---|---|
| `.claude/skills/` does not exist; the repo has **zero committed skills** ([[strategy-fundraising-schedule]] §Skills, [[positioning-fundraise-readiness-schedule]] §Skills) | **Stale.** It exists, with **4 committed skills**, first admitted 2026-08-28 through the §3.3 gate, each wrapping `scripts/agents/run_card.py` (`.claude/skills/README.md:6-9`). `citation-reverify` now has both a past instance *and* a worked admission path |
| The claim register is a four-column markdown table ([[positioning-fundraise-readiness-agenda-full]] §What) | **Superseded by a better mechanism that already runs.** `.planning/decisions/CLAIMS.jsonl` (112 lines) carries executable claims, and `scripts/check_decision_claims.sh` re-verifies every one of them in CI at `.github/workflows/ci.yml:196`, in strict mode: a claim that *cannot run* is a failure, not a skip, and a verify command may not suppress its own stderr. A register in that form is checked on every commit instead of on every send |
| OD-23 is *"$20k MRR in 30 days against **locked** $20–50/mo pricing"*, cited at `[[OPEN-DECISIONS]]:27` — the phrasing in all 14 documents of this vault | **Wrong on three counts, and the row moved.** OD-23 (`OPEN-DECISIONS.md:34`) now records: (a) **no ADR records any pricing**, so $20–50/mo is *open*, not locked; (b) its source document is **not in this repo** — it lives in a Cowork session, so the <10% rating cannot be checked here; (c) `PROJECT.md:73` reads **"No revenue pressure: Build right, not fast"**, which contradicts a 30-day revenue sprint |
| The 573-vs-375 insight-type contradiction **blocks publishing either figure** ([[strategy-fundraising-charter]] §Open forks) | **Settled.** OD-33 (`OPEN-DECISIONS.md:39`) fixed it at **573** on 2026-08-26 by transpiling `insight-catalog.ts` standalone. The block lifts — and the residual risk is now the opposite one: `apps/api-gateway/src/analytics/insights/insight-catalog.spec.ts:10` still asserts only `toBeGreaterThanOrEqual(200)`, so 348, 375 and 573 all pass and nothing would catch the next drift |

**Read together, those five rows are one argument.** This department's job is to stop
claims outrunning evidence, and in four days its own vault drifted at the baseline, at
the tooling, at the central fork's characterisation, and at a blocked claim that had
already unblocked. *A department that grades its own claims is the structure
[[ORG_STRUCTURE]] §3 was built to distrust* — the charter says so, and the last four
days are the proof.

So the agenda's spine is not "write a register." It is: **make the register something
a machine re-reads, in the repo, on every commit — so that the next four days of drift
announce themselves instead of being discovered by whoever reads a deck.** That is the
§8.3 seed taken literally: every claim carries a citation `claim-provenance-check` can
grade.

---

## Program 1 — The YC readiness register, executable

The seed asks for *"the YC readiness register with per-claim verification — every deck
claim carries a citation `claim-provenance-check` can grade"*. Two honest notes before
the tasks:

1. **`claim-provenance-check` does not exist and is not named in either unit's
   schedule.** The chartered checkers are `claim-register-entry`, `citation-reverify`,
   `verb-strength-check`, `wedge-reduction-check`, `evidence-type-mix`,
   `open-target-attribution`, `diligence-index-check`. This agenda adopts the ADR's
   name for the **runner** — the thing that grades a register row end to end — and
   builds it as the composition of the three that already have past instances. The
   name is new; the mechanism is not.
2. **This is claim work, not readiness work**, so R4 does not gate it. The register is
   the one artifact that is useful before a raise and required during one — the
   2026-08-24 forecast this file replaces said the same, and it is the one part of it
   that survived contact with a re-measurement. It costs an afternoon before the first
   artifact and a retrofit across twenty after.

### STR-1 · Register v1 — the schema is a JSONL row, not a table

- **Owner:** team `positioning-fundraise-readiness` · card `pfr-claim-gate` ·
  skill `claim-register-entry`
- **close_time:** **2026-09-04**, then **per-claim** (L-PFR-1) — the register is
  touched only as part of sending ([[positioning-fundraise-readiness-directive]] R1)
- **Doneability:** a file exists with one JSON object per line, and every row carries
  `id` · `claim` (verbatim, the verb that ships) · `audience` · `channel`
  (`written` | `spoken`) · `evidence_type` (`query` | `path:line+symbol` | `demo`) ·
  `verify` (a command, or the literal `NONE — human rubric` with the rubric named) ·
  `status` (`releasable` | `weaken` | `blocked` | `rejected`) · `verified` (a date
  **and** a result). Done when the twelve seed claims of STR-2 are all present,
  including the rejected and blocked ones, and `python3 -c "import json,sys;
  [json.loads(l) for l in open(...)]"` parses every line.
- **Why JSONL and not the four-column table the team charter specifies:** the table
  cannot be executed, and the department's whole thesis is that prose rots because
  nothing re-reads it. `.planning/decisions/CLAIMS.jsonl:1` states the same
  design in its own `_comment`. Adopting the proven shape means STR-3 is a
  configuration, not an invention.
- **Evidence:** [[positioning-fundraise-readiness-loops]] L-PFR-1;
  [[positioning-fundraise-readiness-agent-stack]] §3 (`claim-register-entry`, past
  instance); `.planning/decisions/CLAIMS.jsonl` (112 lines, the working form).

### STR-2 · The twelve seed claims, graded on entry — worst first

- **Owner:** team · card `pfr-claim-gate`
- **close_time:** **2026-09-04** (with STR-1; the schema is only proven by seeding it)
- **Doneability:** each of the twelve rows below exists with a grade and, where the
  grade is not `blocked`, a `verify` command that runs. Expected first reading, stated
  before starting so it is not read as failure: **4 releasable · 3 weaken · 2 blocked ·
  2 rejected · 1 constant** — one third of the company's existing claims do not survive
  their own evidence, and that is the honest baseline rather than a bad month.

| # | Claim | Source | Grade on entry (2026-08-28) |
|---|---|---|---|
| 1 | The wedge sentence | `YC_WEDGE_PLAN.md:312` | **constant** — positioning, not factual. Everything reduces to it (R5) |
| 2 | *"Dollars recovered"* as the headline number | `:315` | **weaken** — `:32` of the same document says it means *"we asked"* until an X12 812 lands; `:370` calls it *"half vanity and half unverifiable"* |
| 3 | Cost drift caught | `:370` | **rejected** — computable, not computed. Evidence would be a plan (R3) |
| 4 | Four-way match · credit ledger · X12 810/856/812 · two-stage receiving | `:340-348` ✅ rows | **releasable, evidence class wrong** — needs a demo, not a line number (STR-6) |
| 5 | Competitive read vs MarginEdge | `:328` | **releasable** — re-verify per send; competitor facts age fastest |
| 6 | 573 insight types | `:324` | **releasable — the block lifted.** OD-33 (`OPEN-DECISIONS.md:39`) settled it 2026-08-26. `verify` must assert the **exact** count; the repo's own test asserts only `>= 200` (`insight-catalog.spec.ts:10`) |
| 7 | 860-path UX catalogue | `:324` | **blocked** — travels in the same sentence as 573 and has had no equivalent measurement. One settled number does not settle its neighbour |
| 8 | *"ux-optimizer secured"* | `:340` | **releasable with scope attached** — accurate in the row's own words; see STR-8 for the mis-anchored version of this finding the vault carries |
| 9 | *"Security complete"* (the Track A heading) | `:188` | **weaken** — `### Track A — Security` is where the unscoped word lives. OD-19 (`OPEN-DECISIONS.md:33`) records 40 routes on five unguarded-by-omission controllers, most deliberate |
| 10 | *"$20k MRR in 30 days"* | OD-23 (`OPEN-DECISIONS.md:34`) | **blocked, and its blocker changed** — not "unresolved target" but "the target's price is unrecorded, its source is not in this repo, and `PROJECT.md:73` contradicts its urgency" |
| 11 | *"$20–50/mo pricing"* as a company fact | this vault, 14 documents | **rejected** — we have been calling it *locked* and no ADR records it. An unwritten choice is open (CLAUDE.md §0.1). See STR-9 |
| 12 | Any `nf_a.*` completion figure | [[strategy-fundraising-charter]] §Metrics | **weaken by default** — today's `success_rate` means *"the call returned"*; `scripts/check_task_types_are_graded.py` exists precisely because six of seven task types recorded a garbage response as success |

- **Evidence:** every source line above re-read 2026-08-28;
  [[positioning-fundraise-readiness-agenda-full]] §Step 1 (the seven-claim ancestor of
  this table); OD-33 (`OPEN-DECISIONS.md:39`); OD-19 (`OPEN-DECISIONS.md:33`).

### STR-3 · `claim-provenance-check` — the grader, in CI, inheriting strict mode

- **Owner:** department · card `strategy-warden` · new skill `claim-provenance-check`
- **close_time:** **2026-09-18**; then **per-commit** (CI) and **per-send** (L-STR-1)
- **Doneability:** a script reads the register and returns, per row, one of
  `holds` · `drifted to :N` · `inverted` · `gone` · `cannot-run`, and it inherits all
  four of `check_decision_claims.sh`'s strict-mode rules verbatim, because each one was
  bought with a real failure: **(a)** a claim whose command cannot run is a **failure**
  (exit 2), never a skip; **(b)** exit 126/127 or a cannot-run signature on stderr is a
  failure regardless of the exit code the claim reports; **(c)** a verify command may
  not contain `2>` — suppressing stderr is how the one broken claim certified itself;
  **(d)** malformed input is a hard failure, because silently skipping a line is how a
  claim stops being checked without anyone noticing. Done when the job runs green
  against a register that includes at least one deliberately-broken row in a fixture,
  and red when that row is unfixtured.
- **The bar this sets, stated plainly:** a diligence reader's question is *"is this
  still true?"* Today the honest answer is a date. After this task it is **a run**, and
  the run's failure mode is loud. That is the whole of the §8.3 seed.
- **Evidence:** `scripts/check_decision_claims.sh` (strict mode, ADR 0025 §5, locked
  2026-08-26) wired at `.github/workflows/ci.yml:196`;
  `scripts/check_citation_pairing.py` at `ci.yml:199` with its own `--self-test` at
  `ci.yml:202` — the self-test convention this task copies;
  [[strategy-fundraising-agent-stack]] §3 `citation-reverify` (the past instance that
  admits it through the §3.3 gate).

### STR-4 · The symbol rule, enforced at parse time

- **Owner:** team · feeds STR-3's acceptance criterion
- **close_time:** **2026-09-18** (it is STR-3's parse rule, not a separate run)
- **Doneability:** the register rejects a `path:line` evidence value that carries no
  symbol, at parse time, the way `check_citation_pairing.py` rejects an unanchored
  register locator. Done when a symbol-less row fails the run with a named reason.
- **Evidence — measured today, and it is the argument:** `YC_WEDGE_PLAN.md:401` cites
  `ReceivingWorkspace.tsx:233,265` for the invoice quantity and unit-price inputs. On
  2026-08-27 this vault recorded them at `:401,440`. On **2026-08-28** they read
  `:394` (`aria-label="Quantity invoiced"`, value bound at `:401`) and `:434`
  (`aria-label="Invoice unit price"`). Two records one day apart disagree by six lines
  — and a bare `path:line` **cannot tell you whether the file moved or the two sweeps
  anchored differently inside the same element.** That ambiguity is the defect. With
  the aria-label carried alongside, both readings resolve to the same element and the
  drift degrades into a search ([[positioning-fundraise-readiness-directive]] R3).

### STR-5 · Register the department's own vault as a claim surface

- **Owner:** department · card `strategy-warden`
- **close_time:** **2026-09-25**, then **quarterly** (the overstatement sweep already in
  [[strategy-fundraising-schedule]])
- **Doneability:** the 14 documents of this vault are swept for the recovery phrasing,
  the pricing phrasing, and any `nf_a` completion figure used as correctness; every hit
  is either qualified in place or entered as a register row with a grade. Done when the
  board's overstatement watch returns empty for a stated reason rather than by accident.
- **Evidence:** [[strategy-fundraising-agenda-board]] §Overstatement watch (the query
  exists); [[strategy-fundraising-schedule]] quarterly row; four of the twelve seed
  claims in STR-2 originate inside this vault, not outside it.

### STR-6 · **Reach** — the demo class: evidence that cannot drift

- **Owner:** team · with engineering for the recording surface
- **close_time:** **2026-10-02** — *may close as `BLOCKED` with a named holder*
- **Doneability:** claim #4 (four-way match, credit ledger, X12 parsers, two-stage
  receiving) carries a **recorded demo path** as its evidence, not a line number, and
  the register's `evidence_type` mix shows a non-zero `demo` share for the first time.
- **Why this is the reach item and graded as one:** the founding artifact is **100%
  `path:line` evidence with zero demos**, and that mix is what produced the drift rate
  in Program 2. A demo cannot silently drift. It is also the one task here that depends
  on something this department does not own — a demo needs a working path and someone
  to record it — so it is scheduled as a reach and will close as `BLOCKED` naming the
  holder if the surface is not there. Stating that now is cheaper than a slipped date.
- **Evidence:** [[positioning-fundraise-readiness-schedule]] `evidence-type-mix`
  (rising `path:line` share reported as a leading risk);
  [[positioning-fundraise-readiness-agenda-full]] Step 1 row 4;
  `apps/api-gateway/src/procurement/invoice-match.ts` — the one §6 source with no line
  anchor, and the only one that held unambiguously.

---

## Program 2 — The corrections this department owes itself

[[strategy-fundraising-directive]] R7 says the rule points **upward**. It points
**inward** first: every task here is this department finding its own claim wrong.

### STR-7 · Publish the re-measured drift baseline — 5 of 7, not 2 of 7

- **Owner:** department · card `strategy-warden` · skill `citation-reverify`
- **close_time:** **2026-09-04**, then **quarterly** (the founding-artifact
  re-verification already scheduled)
- **Doneability:** `strategy.citation_drift_rate` carries a dated per-source result —
  never a document-level date — and the corrected figure replaces ≈29% in
  [[strategy-fundraising-agenda-board]]. A correction ask for the other twelve
  documents is filed (STR-X1); **this agenda does not edit them**.
- **The measurement, 2026-08-28, all seven sources in `YC_WEDGE_PLAN.md:398-406`:**

| # | Source as cited | Result today |
|---|---|---|
| 1 | `procurement/invoice-match.ts` — no line anchor | **holds** — file present, claim unaffected by line movement. The only citation in §6 built to survive |
| 2 | `ReceivingWorkspace.tsx:233,265`; `:92` defaults `invoiceQty` | **drifted** — inputs at `:394` / `:434` by aria-label; `invoiceQty` initialises to `null` at `:168`, superseded by a deliberate design change whose in-file comment explains an empty invoice quantity is a real and common state |
| 3 | `InvoiceScannerModal.tsx:88,126` — posts to `/invoices/scan`; no `invoices` controller exists | **gone** — the file does not exist anywhere under `apps/`, and the repo has **zero** references to `invoices/scan`. Nearest survivor: `apps/web/src/components/wines/MenuScannerModal.tsx`. **Recorded by no previous sweep** |
| 4 | `scan-parser.service.ts:43–65` — Claude vision extraction pattern | **drifted** — file holds; `:43` is a comment terminator and `:65` is prompt text; the model call is `claude-haiku-4-5` at `:289` |
| 5 | `pos-hub.controller.ts:18,44` — `generic_webhook` ingress | **drifted** — `:18` is an express import and `:44` a comment; the `generic_webhook` bridge description is at `:76` |
| 6 | `procurement.controller.ts:33` — class-level `@UseGuards(JwtAuthGuard)` | **holds** — exact, to the line |
| 7 | `ux-optimizer/` — 0 `@UseGuards`, *"all re-confirmed 2026-07-27"* (`:406`) | **inverted** — `ux-optimizer.controller.ts:55` carries `@UseGuards(JwtAuthGuard)`. **And a second instance nobody had recorded:** the same inverted assertion appears again at `:194`, in the A1 finding row |

  **2 hold, 3 drifted, 1 gone, 1 inverted — 5 of 7, 71%.** The vault's ≈29% understates
  the department's own primary defect by a factor of 2.4, and the two worst classes
  (`gone`, and a duplicated inversion) were both invisible to a sample that stopped at
  two. **A partial sweep reported as a baseline is the same failure as
  `"all re-confirmed 2026-07-27"`, one level up.**
- **What I could not check, said plainly:** wave 3 runs no git commands, so I cannot
  attribute row 2's six-line difference to a file change versus a differently-anchored
  sweep. The register's symbol rule (STR-4) removes the question rather than answering
  it.
- **Evidence:** every row above re-read on disk 2026-08-28 in this worktree;
  [[strategy-fundraising-charter]] §Evidence (the ≈29% it replaces);
  [[positioning-fundraise-readiness-loops]] L-PFR-3 (*"a zero-drift reading on a
  document older than a month is a defect until proven otherwise"* — the same
  suspicion, applied to a low reading rather than a zero one).

### STR-8 · Correct our own overstatement finding — it is mis-anchored

- **Owner:** department · card `strategy-warden`
- **close_time:** **2026-09-04**
- **Doneability:** the vault's Track A finding is restated against the line that
  actually carries the unscoped word, and the register's claims #8 and #9 are graded
  separately. Done when no document in this tree grades `:340` as an overstatement.
- **Evidence — this is the department failing its own R1, verified today:** five
  documents in this vault assert that `YC_WEDGE_PLAN.md:339` labels Track **A**
  *"Security" ✅* and that the **label** overstates. On disk: the §4 sequence row is at
  `:340` and reads *"ux-optimizer secured **and** made genuinely live. Guarded,
  tenant-scoped, validated, mounted, tagged, evaluated nightly."* — scoped, accurate,
  and **not** an overstatement. The word *Security* is the section heading at `:188`
  (`### Track A — Security`). So the citation is off by one line **and** points at the
  wrong artifact: we filed a true finding against a false anchor.
- **Why it matters more than its size:** this is precisely M2's mechanism — a reader
  who checks one citation and finds it wrong discounts the rest — except the reader
  here would be checking *our* audit of somebody else's document. An audit with a bad
  anchor is worse than no audit, because it is quoted with confidence.

### STR-9 · Strike *"locked pricing"* from this vault's OD-23 language

- **Owner:** department · card `strategy-warden` · skill `open-target-attribution`
- **close_time:** **2026-09-11**, then **monthly** (L-STR-4, the unattributed-target
  sweep already scheduled)
- **Doneability:** no document in this tree describes $20–50/mo as *locked*; every
  occurrence of the revenue figure carries `OD-23 (OPEN-DECISIONS.md:34)` in the ADR
  0025 pair form (id **and** line, so a renumber and an insert each break the pair
  loudly). Done when the monthly sweep's `strategy.unattributed_target_citations`
  has a first real number for this vault.
- **Evidence:** OD-23 (`OPEN-DECISIONS.md:34`) — *"it called $20–50/mo **locked** —
  **no ADR records any pricing**; per CLAUDE.md §0.1 an unwritten choice is *open*, so
  the $20k math rests on an assumed price"*; the same row records the source document
  as absent from this repo and `PROJECT.md:73` (*"No revenue pressure: Build right, not
  fast"*) as contradicting the sprint. The register's own citation moved too: this
  vault cites `[[OPEN-DECISIONS]]:27`; the row is at `:32` — the ADR 0025 mechanism
  firing on the department that most needs it.
- **Lock respected:** this task **removes a false certainty about price**. It does not
  propose one. Pricing stays deferred and is [[finance-pricing-charter]]'s to hold.

### STR-10 · Retire the 375-vs-573 block; replace it with a command

- **Owner:** team · card `pfr-claim-gate`
- **close_time:** **2026-09-11**
- **Doneability:** register claim #6 moves from `blocked` to `releasable` carrying a
  `verify` that asserts the **exact** count, and the residual risk is recorded as a
  cross-unit ask rather than as a block we no longer have grounds for.
- **Evidence:** OD-33 (`OPEN-DECISIONS.md:39`) — settled at **573** on 2026-08-26,
  identical across repeated runs, with the per-category breakdown; and the residual:
  `apps/api-gateway/src/analytics/insights/insight-catalog.spec.ts:10` asserts
  `toBeGreaterThanOrEqual(200)`, so all four circulating values pass. **Knowing the
  number does not fix the test** — OD-33 says so itself, and the fix is Analytics'
  (STR-X2).
- **Note against our own record:** three documents in this vault still grade this claim
  `BLOCKED` on a contradiction settled two days before this agenda was written. A block
  that outlives its cause is an overstatement in the cautious direction, and R1 does not
  exempt it.

---

## Program 3 — Verb strength as running code

### STR-11 · The three canonical rewrites become test cases

- **Owner:** team · card `pfr-claim-gate` · skill `verb-strength-check`
- **close_time:** **2026-09-25**, then **per-claim** (L-PFR-2)
- **Doneability:** the checker's fixture contains the three rewrites already fixed in
  [[positioning-fundraise-readiness-loops]] L-PFR-2 — *"$X recovered"* → *"$X in
  billing discrepancies identified"* unless a credit landed; *"Security complete"* →
  *"ux-optimizer secured"*; *"$20k MRR"* → *"committed, not collected"* if OD-23
  resolves that way — plus a fourth added today: **any completion claim about the card
  layer**, since 36 of 102 cards are `mechanical` and only some are implemented. Done
  when each fixture input produces the fixed output and an unfixtured strong verb fails
  the run.
- **Evidence:** L-PFR-2's rewrite table (`:88-90` of
  [[positioning-fundraise-readiness-loops]]); `YC_WEDGE_PLAN.md:32` and `:370`;
  `.planning/00-index/cards.json` (102 cards; `routing_class` counts
  mechanical 36 / extraction 36 / judgment 30).
- **Weakening is the success state, rejection is the fallback**
  ([[positioning-fundraise-readiness-directive]] R7) — `strategy.weakened_claim_count`
  rising is the reading that says the gate is being used rather than routed around.

### STR-12 · Instrument one headline metric — the query, not the choice

- **Owner:** department, with [[metric-contract-truth-assurance-charter]]
- **close_time:** **2026-10-02** — the *specification*; the choice is the founder's (Q5)
- **Doneability:** one page states, for **both** candidates, exactly what query would
  make it real: for *dollars recovered*, the join that counts only X12 812 credit
  memos landed on a later invoice; for *cost drift caught*, the computation
  `YC_WEDGE_PLAN.md:361-364` calls computable-but-not-computed. Done when
  `strategy.wedge_metric_instrumentation` can move off **"slide, not query"** the day
  a query is written, without a further design step.
- **Why this is scheduled while the choice is open:** the department may not choose the
  headline, and it may not publish either while both are slides. What it *can* do is
  make the choice cost one implementation instead of one design-plus-implementation.
  **Neither metric is instrumented today, so the choice is still free — it stops being
  free the moment one enters an artifact.**
- **Evidence:** `YC_WEDGE_PLAN.md:315`, `:32`, `:370`; `corporate.md:446-448` (named,
  not instrumented as a company metric); [[strategy-fundraising-charter]] §Metrics.

### STR-13 · Spoken claims — the 24-hour rule needs a mechanism, not a promise

- **Owner:** team · card `pfr-claim-gate`
- **close_time:** **2026-09-18**, then **per external conversation**
- **Doneability:** a one-command way to add a `channel: spoken` row from a phone (a
  single append to the register with the four required fields), and a board line that
  reads the count. Done when the count exists and its **zero** is legible as a signal.
- **Evidence:** [[strategy-fundraising-directive]] R6 and
  [[positioning-fundraise-readiness-directive]] R6 (*a pitch is a publication with no
  artifact*); [[positioning-fundraise-readiness-agent-stack]] §5 — *"`claim.spoken_
  externally` has no mechanism at all… the 24-hour rule is the whole control, and its
  failure mode is silent"*; [[strategy-fundraising-premortem]] M5's sharper variant —
  *we policed the blog and not the pitch*.
- **The uncomfortable half, stated:** the strongest claims are always spoken first, and
  the founder is the most likely speaker. R7/R8 say this department flags those like
  any other. Q4 asks the founder to confirm that while it is cheap.

---

## Program 4 — Readiness, held exactly at R4's line

Everything in this program is **bounded by the split trigger** — a live term-sheet
conversation or the first instrument issued (`corporate.md:457-458`). Beyond a one-page
index, no diligence artifact is built before it fires. That ordering is
[[strategy-fundraising-directive]] R4, and inverting it is [[strategy-fundraising-premortem]]
M3 — the deferred second team growing inside the first one.

### STR-14 · The one-page diligence index — the only permitted readiness artifact

- **Owner:** team
- **close_time:** **2026-10-16**, then **quarterly**
- **Doneability:** one page, listing the **questions a diligence reader would ask**,
  each with a location and an owner. Most rows read *"does not exist yet"*, and that is
  the useful part. Completeness is measured against questions, never against a
  template's slots (L-PFR-5 enforces the denominator). Done when the page exists and
  contains **no artifact** — an index that starts producing its own contents has
  breached R4 on the day it does so.
- **Evidence:** [[positioning-fundraise-readiness-charter]] §Boundaries;
  [[positioning-fundraise-readiness-loops]] L-PFR-5 (*"a pack answering 40% of real
  questions beats one filling 100% of a template"*); `corporate.md:457-458`.

### STR-15 · The raise position, in writing, quarterly

- **Owner:** department → **founder decides**
- **close_time:** **2026-09-11**, then **quarterly** (2026-12-11, 2027-03-11)
- **Doneability:** one dated paragraph in [[strategy-fundraising-agenda-board]] saying
  *raise*, or *not yet and here is the trigger*. **"Not yet" is a valid answer and must
  be an answer.** Done when the paragraph exists with a date; **absence is itself the
  finding**, and the board's standing counter reads it.
- **What this department may and may not write:** it may state the position and its
  consequences. It may not name an instrument class as a decision, a cap, a price, or a
  term — those are the founder's and [[instruments-equity-charter]]'s
  (`corporate.md:505-506`).
- **Evidence:** [[strategy-fundraising-schedule]] quarterly row (*"Absence is itself the
  finding"*); [[strategy-fundraising-charter]] §Boundaries.

### STR-16 · Give `strategy.split_trigger_fired` a publisher it can actually have

- **Owner:** department · card `strategy-warden`
- **close_time:** **2026-09-25**, then **quarterly** (the team-shape review, L-STR-5)
- **Doneability:** the trigger stops being an event nothing emits and becomes **two
  dated fields the founder sets** — `first_term_sheet_conversation` and
  `first_instrument_issued`, both nullable, both in the board — plus
  `strategy.split_trigger_age_days` computed from the department's founding date. Done
  when the twelve-month not-needed condition can be read off the board without
  anybody remembering to check.
- **Evidence:** [[strategy-fundraising-agent-stack]] §5 — *"`strategy.split_trigger_
  fired` has no publisher… a term-sheet conversation is a founder event; nothing emits
  it"*; L-STR-5's **both-directions** design (firing splits the department; twelve
  months of not firing records the second half as *unneeded*, not *deferred*).
- **This is the anti-ratchet task.** The org names split triggers everywhere and merge
  or dissolve triggers almost nowhere. CORP-F3 closes either way, and this makes the
  either-way readable.

### STR-17 · **Reach** — the adversarial read: have somebody try to puncture the register

- **Owner:** department → [[red-team-charter]] (findings-only, ADVISORY)
- **close_time:** **2026-10-16** — *may close as `BLOCKED` with a named holder*
- **Doneability:** Red Team is asked, in writing, to pick claims at random from the
  register and try to break them the way a diligence reader would — check a citation,
  demand the query, test whether the verb survives its contract. Done when a written
  finding lands in [[strategy-fundraising-questions]] with a count of claims tested and
  a count broken. **A zero-broken result is reported as suspect**, on this department's
  own standing rule about clean sweeps.
- **Why it is a reach and graded as one:** advisory units are chartered, not staffed,
  and this department cannot conscript one. If nobody reads, it closes `BLOCKED` naming
  the holder — which is itself the finding that the org's only external auditor of
  claims is not running.
- **Evidence:** [[strategy-fundraising-charter]] §Boundaries — *"Red Team is the natural
  external auditor for this department specifically — a unit that grades its own claims
  is the structure [[ORG_STRUCTURE]] §3 was built to distrust"*;
  [[strategy-fundraising-schedule]] §Skills (a zero-drift sweep is a defect until proven
  otherwise). **The last four days of this vault's own drift are the argument for
  needing an auditor who is not us.**

---

## Findings — things no card and no loop can carry

Per [[0039-activation-plan-of-record]] §8.1: a task no card or loop can carry is
recorded here, not listed as work.

**F1 — the department's own agent cannot run its own checker.** `strategy-warden` is
`routing_class: extraction` and `pfr-claim-gate` is `judgment`
(`.planning/00-index/cards.json`), while `scripts/agents/run_card.py:375` executes only
cards whose `routing_class` is `mechanical`. So `claim-provenance-check` **cannot run as
a card today**, and wave 3 does not edit agent stacks. STR-3 is therefore built as a
script plus a CI job — the `check_decision_claims.sh` path — which is the honest shape
anyway: the grading is mechanical even though the *judgment* about a verb is not.
Recorded for the next agent-stack revision.

**F2 — both of this department's nf_a task types would fail the doneability gate
today.** `strategy_sweep` and `claim_check` have no consumer
([[strategy-fundraising-agent-stack]] §5, [[positioning-fundraise-readiness-agent-stack]]
§5) **and** no verdict basis better than `call_level_v0`. `scripts/check_task_types_are_
graded.py` requires an emitting task type to carry a verdict or appear as EXEMPT with a
reason — so emitting either one before STR-3 exists would be adding a row that records
"the call returned" as "the claim was checked". That is this department's own failure
mode wearing a metric. **Neither task type is scheduled to emit in this agenda.**

**F3 — L-STR-5's `strategy.agenda_content_diff_days` has no producer, and the watcher
cannot supply it.** `scripts/watch_loops.py:74` reads `frontmatter(p).get("updated")`
and nothing else, so it cannot distinguish a content change from a date bump — which is
exactly the disguise L-STR-5 names (*"a date-bumped agenda with no content change counts
as untouched, because for a department with no raise in flight that is the most likely
disguise for having stopped"*). Legal filed the same gap this wave; this department
**seconds it rather than filing a duplicate** (STR-X5).

**F4 — the register still has no publisher, and that has not moved.** Four claim-
producing units — [[narrative-collateral-charter]], [[editorial-gate-charter]],
[[design-partner-operations-charter]] and Growth's content engine — are chartered and
none is built, so `claim.proposed_outward` has no emitter. Until one exists, the gate
depends on being *invited*, and a claim that skips the invitation is invisible. What
changed today is only that the register now has somewhere to be **before** the first
publisher arrives.

**F5 — CORP-F1 / OD-17 got sharper again.** One team, **16** documents (14 + two
agent-stacks), one inherited artifact, and the inherited artifact is 71% drifted. The
ratio is the fork's live argument and this agenda does not resolve it.

---

## Cross-unit asks — each lands in that unit's `questions` file; none blocks

| ID | To | Ask | close_time |
|---|---|---|---|
| STR-X1 | [[standards-verification-charter]] | The ≈29% citation-drift baseline is quoted in 12 documents across this vault and is wrong (STR-7: 5 of 7, 71%). Corpus truth is yours; the outward half is ours. Correct or supersede | 42-day age-out |
| STR-X2 | [[metric-contract-truth-assurance-charter]] | Two asks, both from OD-33 (`OPEN-DECISIONS.md:39`) and STR-12: replace `insight-catalog.spec.ts:10`'s `>= 200` floor with an exact-count assertion, and give us the `dollars_recovered` contract the register's row 2 must bind to | 2026-09-25 |
| STR-X3 | [[skills-charter]] | Admit `claim-provenance-check` through the §3.3 gate — trigger, doneability, past instance (three, in STR-7), owning department. The registry is yours; we author and commission | 2026-09-18 |
| STR-X4 | [[red-team-charter]] | The adversarial read of the register (STR-17). Advisory is findings-only; nothing here blocks | 2026-10-16 |
| STR-X5 | [[decision-office-charter]] | Two: OD-23 (`OPEN-DECISIONS.md:34`) is reported monthly by name from today, and escalates at two consecutive unmoved months; and we second Legal's ask for a content hash beside `updated:` in `watch_loops.py` (F3) | 42-day age-out |
| STR-X6 | [[design-partner-operations-charter]] | Register row 2 publishes nothing stronger than you produce. Tell us the verified number's shape — credits watched landing — before the first artifact needs it | 42-day age-out |

---

## Close-time summary

| close_time | Tasks |
|---|---|
| 2026-09-04 | STR-1 · STR-2 · STR-7 · STR-8 |
| 2026-09-11 | STR-9 · STR-10 · STR-15 |
| 2026-09-18 | STR-3 · STR-4 · STR-13 |
| 2026-09-25 | STR-5 · STR-11 · STR-16 |
| 2026-10-02 | STR-6 *(reach — may close as BLOCKED)* · STR-12 |
| 2026-10-16 | STR-14 · STR-17 *(reach — may close as BLOCKED)* |
| Recurring | per-claim: STR-1, STR-11 · per-send: STR-3 · per-conversation: STR-13 · monthly: STR-9 · quarterly: STR-5, STR-7, STR-14, STR-15, STR-16 · per-commit: STR-3 (CI) |

**Nothing here is weekly, and that is still deliberate.** The register is empty, no
artifact is in flight, and a weekly reading of zero is the theatre [[ORG_STRUCTURE]] §4's
60-day rule marks as fiction. Both schedules refuse a weekly cadence and this agenda
does not smuggle one in through a task.

## What this agenda deliberately does not do

- **No deck, no data room, no cap table, no diligence pack.** R4 permits one page
  (STR-14) and nothing else before the split trigger. A second readiness artifact is
  M3's symptom, not its cause.
- **No instrument, no clause, no term.** Not a SAFE, not a board consent, not a stock
  purchase or advisor agreement. [[instruments-equity-charter]] drafts; **the founder
  decides terms**; this vault does neither (R8).
- **No investor contact, no send, no application.** The YC path is owned here; opening
  an application is a founder event with a decision in front of it, not a task.
- **No price, and no unlock assumed.** STR-9 removes a false *locked*; it proposes
  nothing in its place. Pricing stays deferred with [[finance-pricing-charter]].
- **No fork resolved.** OD-23 is reported, not answered (Q1). CORP-F3 is made readable,
  not closed (STR-16). CORP-F1 / OD-17 is recorded as sharper (F5).
- **No emitting of an ungraded task type** (F2), and **no skill committed without a past
  instance** — `wedge-reduction-check`, `evidence-type-mix` and `diligence-index-check`
  stay commissioned in the schedules and unbuilt here.

## Questions for the founder

1. **OD-23 — what is the target, now that its premises have changed?**
   OD-23 (`OPEN-DECISIONS.md:34`) records that no ADR sets a price, that the source
   document is not in this repo, and that `PROJECT.md:73` says *"No revenue pressure:
   Build right, not fast."* The original three options stand — hold $20k/30d, move to
   higher-ACV founder-led sales, or count committed rather than collected — but a fourth
   is now visible: **the target may simply be an artifact of a document we cannot read.**
   If the answer is *committed, not collected*, is that phrase acceptable as permanently
   attached language on every external use?
2. **CORP-F3 — confirm the one-team decision and its trigger?** STR-16 makes both
   directions readable. Confirm the trigger, or split now.
3. **Is the raise position "not yet"?** The department assumes so — no raise in flight,
   no deadline, no counterparty. If that assumption is wrong, Program 4 inverts and
   readiness stops being the last program on this page.
4. **When the founder's own claim outruns the evidence, does this department get to say
   so — including out loud, mid-pitch?** R7/R8 assume yes; STR-13 builds the mechanism
   that would make it routine. Worth confirming while it is cheap: the day it matters is
   the day it is expensive.
5. **Cost drift caught, or dollars recovered, as the headline?** `YC_WEDGE_PLAN.md:370`
   argues for the former against its own `:315`. STR-12 makes both one implementation
   away, so the choice is still free — and it stops being free the moment one enters an
   artifact.
6. **New — does the register go in the repo, next to `CLAIMS.jsonl`, and run in CI?**
   That is what makes STR-3 possible and what makes a diligence answer a *run* instead
   of a date. It also means the company's outward claims become a public-by-default file
   in a repository that may one day be shared. Say no and the register still works; it
   just goes back to being checked by whoever remembers.

Team-level working detail — the register's schema in operation, the five-question send
checklist, the seed backlog — is in [[positioning-fundraise-readiness-agenda-full]].
That document is unchanged by this wave; every task above names which unit runs it.
