---
type: agenda-full
division: product
department: design
status: active
metrics: [design.paths_closed_per_month, design.deferred_unblocker_ratio, design.token_source_count, design.resolved_question_rate, design.time_to_first_real_action_staff_min, design.ledger_drift_days]
updated: 2026-08-28
links: ["[[design-charter]]", "[[design-premortem]]", "[[design-agenda-board]]", "[[design-directive]]", "[[design-loops]]", "[[design-schedule]]", "[[design-agent-stack]]", "[[design-questions]]", "[[ux-path-burn-down-charter]]", "[[design-system-motion-substrate-charter]]", "[[exploration-studio-charter]]", "[[activation-in-product-guidance-charter]]", "[[0039-activation-plan-of-record]]", "[[0038-cards-run-as-declared-scripts]]", "[[0034-agent-stack-artifact]]", "[[0025-citations-must-disagree-loudly]]", "[[DESIGN-FOUNDATION]]", "[[media-brand-charter]]", "[[brand-identity-charter]]", "[[analytics-bi-charter]]", "[[decision-office-charter]]", "[[product]]", "[[ORG_STRUCTURE]]", "[[UX_PATHS_CATALOG]]", "[[AGENT_NATIVE_UI_DECISION]]", "[[PAGES-MAP]]", "[[FORK-REGISTRY]]"]
---

# Design — Full Agenda

**Dated 2026-08-28.** Wave 3 under [[0039-activation-plan-of-record]] Track B. This
replaces the 2026-08-24 forecast, which was honest and provisional; this one is dated,
owned, and has close-times. Every row below names **how you would know it is done** and
**by when it should have moved**. A row that could not answer both is not here — it is in
§6 as a finding.

---

## 0. The locks, stated before the work — not after

These bind hardest in this department, so they go first.

| Lock | Source | What this agenda does instead |
|---|---|---|
| **Brand / landing visuals: HELD** until *"structure + brand exist"* | `decisions/README.md:81` (Vision capture §13/§14.5, 2026-08-24); re-confirmed by the founder 2026-08-28 ([[0039-activation-plan-of-record]]) | Does the **structure half** the hold's own sentence names as its prerequisite, and writes the unlock case (D6). **Commissions no visual**: no landing sketch, no mock, no Blender asset, no wordmark work |
| **OD-106 design foundation: deferred, documentation only** | `decisions/OPEN-DECISIONS.md:67`; [[DESIGN-FOUNDATION]] §0 (*"no sketches, tokens or builds until the founder reopens it"*) | Ships the **co-design pack** (D2), not the direction. Picks no primary, changes no token, produces no side-by-side mock — the mock stays *offered*, per §0's own wording |
| **Agent-native UI / the UX optimizer: do not build** | [[AGENT_NATIVE_UI_DECISION]]:78 | Counts it monthly and keeps it dark (D4). `design.ux_optimizer_rows` correct value **0** |
| **No summed "design velocity"** | [[design-directive]], opposed-metrics rule | Five metrics reported as a **set**, forever |

The voice seam is also a boundary, not a preference: **[[brand-identity-charter]] owns the
voice guide** (`brand-identity-charter:27-29`, and its own non-goal line — *"M1 owns the
wordmark on `AuthShell.tsx`; Design owns the form beneath it"*, `:148-149`). Design does
**not** write that guide. D1 builds the **product-language corpus underneath it** — the
in-product strings a user touches after they buy — and hands it over as evidence, never as
prose.

---

## 1. The clock — why every close-time here is before 2026-10-27

`scripts/watch_loops.py:11-13` records a dated rule: **all 198 agenda files share
`updated: 2026-08-24` and hit the 60-day staleness rule simultaneously on 2026-10-23** —
*"a rule that condemns everything condemns nothing."* Re-dating this file to 2026-08-28
moves its own condemnation to **2026-10-27**. That is not a formality. It is the outer
close-time on everything below: a task that has not moved by 2026-10-27 is fiction by the
department's own rule, and the watcher will say so without being asked.

---

## 2. Corrections carried into this agenda (re-verified on disk 2026-08-28)

The charter is four days old and five of its citations have already moved. Per
[[0025-citations-must-disagree-loudly]], they are corrected here rather than repeated.

| Claim as written | Measured 2026-08-28 | Consequence |
|---|---|---|
| Catalogue: 1,867 lines / 157,641 bytes ([[design-charter]]) | **1,872 lines / 158,311 bytes**; **910 unique `NEW-` IDs** — the count holds | The denominator is stable; the file is not. Quarterly denominator audit stays real work |
| §X accessibility at `UX_PATHS_CATALOG.md:1493` ([[design-charter]], [[design-schedule]]) | **`:1498`** — `## X. Accessibility, i18n, and system UX (NEW-667 … NEW-676)` | Two artifacts cite a stale anchor. T2.2 fixes both while it works there |
| `UX_OPTIMIZER_ENABLED` default at `ux-optimizer.service.ts:69` ([[design-charter]]) | **`:78`** ([[design-agent-stack]] already carried this) | The charter line is stale; the stack line is right |
| *"`.claude/skills/` does not exist"* ([[design-schedule]]) | **Exists with 4 committed skills** — `fleet-census`, `harness-contract-audit`, `model-pin-census`, `registry-index-refresh` — **none of them Design's** | `optimizer-dark-check` can be authored as a real registry entry today (D4), not a proposal |
| *"Ship one enforcement (lint or CI) from §X before the first Storybook page"* (2026-08-24 agenda) | **Already shipped — by someone else.** `jsx-a11y/label-has-associated-control` is `'error'` in the `apps/web` override (`.eslintrc.cjs:49`) with a **47-file ratchet allowlist** between the `OD-105-ALLOWLIST-START/END` markers (`:58-106`) | Design's next enforcement is a *different* §X rule, and the 47-file allowlist is a Design burn-down number **no charter currently counts** (T2.2) |
| `packages/ui` — *"0 of ~11"* primitives documented | **16 `.tsx`, 0 `.stories.tsx`** (`apps/web/src/components/ui/`: 26 `.tsx`, 5 stories) | Denominator corrected before the ratio is reported |
| The Seating Density drift ([[design-premortem]] M1) | **Still unrepaired.** `UX_PATHS_CATALOG.md:49` still says the widget *"does not exist yet"*; `:1013` still says it shipped; `SeatingDensityPanel.tsx` is on disk at **31,709 bytes** (grew from 31,233) | The drift has now survived the document that diagnosed it. `design.ledger_drift_days` ≥ **32** (2026-07-27 → today), and that is a floor, not a reading |

---

## 3. The agenda

Legend: **Doneability** = the observable that closes the row. **Close** = the date it must
have moved by. **Evidence** = the line that makes it real, per [[GENERATION_BRIEF]] §3.3.

### D — Department (`design-board-steward`)

| ID | Task | Doneability | Close | Evidence |
|---|---|---|---|---|
| **D1** | **The product-language corpus and the in-product voice foundation.** Inventory every user-visible string class in `apps/web/src` — empty, error, loading, confirm, human-gate, role-addressed — and write the house honesty idioms as *testable rules with an on-disk counterexample each*: em-dash for unknown never a pass; *"No comparable data"* never 0%; unpriced sorts last; an error never rendered as an empty state | A corpus file exists under `01-org/product/design/`, each rule paired with a named violating file; **[[brand-identity-charter]] can cite it** as the product half of its voice guide, and a row is filed in `media-brand-questions.md` handing it over. **Design writes no outward prose** | **2026-09-25** | [[DESIGN-FOUNDATION]] §2 names the idioms as house style and records the live defect (*"on `/logs` and SimPOS an error renders as an empty state"*); brand slice measured today: **94 `WineOps` occurrences across 56 files** in `apps/web/src` + `apps/mobile/src`; boundary at `brand-identity-charter:148-149` |
| **D2** | **The OD-106 co-design preparation pack.** One founder session must be able to close *direction (A/B/C)* and *primary* without further research. Pack = the divergence inventory per archetype, the cost and reversibility of each direction, the migration size behind `token_source_count: 2→1`, and the exact question set | The pack answers all three still-open rows of [[DESIGN-FOUNDATION]] §0 with a cost and a reversibility note, and a session is on the founder's queue. **No direction chosen, no primary picked, no mock produced** — the side-by-side stays *offered* | **2026-10-09** | OD-106, `OPEN-DECISIONS.md:67` (*"One founder session on direction (A/B/C) and the primary"*); [[DESIGN-FOUNDATION]] §0 decision-state table; two burgundies re-verified today — `tailwind.config.js:31` `#9E4249` vs `sketches/themes/default.css:6` `#CD2D5B` |
| **D3** | **First board rollup — five metrics as a set.** Every row carries a measured value or the word *unmeasured* with the missing event named | [[design-agenda-board]] shows five values or five honest *unmeasured*s; **no sum, no average** appears anywhere on it | **2026-09-11**, then monthly | `design-agent-stack` `quality_bar`; [[design-directive]] opposed-metrics rule |
| **D4** | **`optimizer-dark-check` becomes registry skill #5.** The registry is real now (4 skills, none Design's) — so this stops being a proposal | The skill exists in `.claude/skills/`, passes the §3.3 gate, publishes four row counts + the flag value, and escalates any non-zero the same day | **2026-09-18** | `.claude/skills/` measured today = README + 4 skills; flag at `ux-optimizer.service.ts:78`; [[design-agent-stack]] §3 |
| **D5** | **Escalate PROD-F5 (commissioning authority) on its first instance, not its tenth.** The first deferred row whose only blocker is an endpoint goes to `OPEN-DECISIONS.md` with the row ID attached | A dated OD row exists carrying one named `NEW-` ID as its instance, and `design.blocked_on_endpoint_count` has a first reading beside it | **2026-09-18** | [[design-directive]] escalation trigger 1; [[FORK-REGISTRY]] PROD-F5; the metric is emitted with no committed consumer ([[design-agent-stack]] §5) |
| **D6** | **Write the unlock case for the visuals hold — and act on none of it.** The hold's own sentence names its prerequisite: *"until structure + brand exist."* Grade each half met/unmet with evidence | A dated memo names both prerequisites, marks each met or unmet with a citation, and **recommends no build**. It is an input to a founder decision, not a request for one | **2026-10-09** | `decisions/README.md:81`; structure-half inputs are D1, D2, T2.3; brand half belongs to [[brand-identity-charter]], not here |

### T1 — [[ux-path-burn-down-charter]] · a catalogue row

| ID | Task | Doneability | Close | Evidence |
|---|---|---|---|---|
| **T1.1** | **Repair `:49`, then sweep all of `:10-67` against the repo.** Publish the stale-row count as the department's founding baseline | One verdict per deferred row — *still-blocked / now-unblocked / **uncheckable*** — zero silent skips; `design.ledger_drift_days` gets its first real reading | **2026-09-04** | `UX_PATHS_CATALOG.md:49` vs `:1013` vs `SeatingDensityPanel.tsx` (31,709 B, on disk); the log's own rule at `:15`; [[design-premortem]] M1 |
| **T1.2** | **The service-route register.** Decide, in writing, which of the 47 routes a staff member touches *during service*, from [[PAGES-MAP]] in-degree plus role — the denominator L-DSN-5 currently lacks | A published register naming each route in/out of the service set with its basis; `design.paths_closed_on_service_routes` becomes computable and appears **beside** the headline count, never merged into it | **2026-09-25** | [[design-loops]] close-time table: L-DSN-5 *"Partly — service-route set undefined"*; [[design-premortem]] M2; [[AGENT_NATIVE_UI_DECISION]]:87-95; 47 routes in [[PAGES-MAP]] |
| **T1.3** | **Implement `ux-ledger-reconciler` as a declared script.** Design's card is `routing_class: mechanical` and **is not in `IMPLEMENTED`** — the dict is at `scripts/agents/run_card.py:333`, 8 entries, none Design's | `python3 scripts/agents/run_card.py ux-ledger-reconciler` runs, is reproducible on the same commit, and reports every `:10-67` cell as resolved or *uncheckable*. **M1's counter-pressure becomes a script rather than a habit** | **2026-10-09** | [[0038-cards-run-as-declared-scripts]]; `run_card.py:333-341` (8 implemented: fleet-census, harness-sentinel, spend-sentinel, registry-clerk, staleness-reaper, claim-auditor, gate-runner, kd-ledger); [[design-premortem]] M1 counter-pressure (*"a **script, not a habit**"*) |
| **T1.4** | **Ask for the missing ledger state.** There is no *"will not build"* status in a 910-row ledger; without one the catalogue is a commitment by default | Either the state exists in the log's legend, or a founder answer is recorded in `OPEN-DECISIONS.md` (question 2 below) | **2026-10-09** | §7 Q2; [[design-charter]] decision-rights row (*"Can a row be closed 'will not build'?"* sits with the founder) |

### T2 — [[design-system-motion-substrate-charter]] · a primitive others reuse

| ID | Task | Doneability | Close | Evidence |
|---|---|---|---|---|
| **T2.1** | **Implement `substrate-census` as a declared script** (mechanical, undeclared-in-`IMPLEMENTED` like T1.3) | A rerun on the same commit yields the same counts; each of the 10 §X rules reported **enforced-in-CI or unenforced-with-a-named-owner**, never omitted | **2026-10-09** | `substrate-census` card `quality_bar`; `run_card.py:333`; measured baseline today: 26/5 in `apps/web/src/components/ui/`, **16/0** in `packages/ui/src` |
| **T2.2** | **Adopt the a11y ratchet Design does not currently count, and add the next rule.** `design.a11y_allowlist_files` starts at **47**; convert one more §X row from prose to CI. Fix the `:1493`→`:1498` anchor in charter and schedule while here | The metric appears on the board with a dated starting value and a **fix-a-file-delete-a-line, never-add-a-line** rule restated; one additional §X rule fails a probe file in CI | **2026-09-25** | `.eslintrc.cjs:49` (`'error'`), `:58-106` (47 files between the OD-105 markers); §X at `UX_PATHS_CATALOG.md:1498` |
| **T2.3** | **Define `system_composition_pct` — the denominator, before the ratio.** What *"composed from the system"* means in a codebase with two token sources and page-local monoliths | A written definition with a worked example on one real page, and a first reading. Until it exists the metric is reported **undefined**, never 0 | **2026-09-25** | [[design-loops]] L-DSN-3 *"Partly — composition % undefined"*; [[design-premortem]] M4 (the museum failure); [[DESIGN-FOUNDATION]] §1 monoliths (Orders 3,614 lines) |
| **T2.4** | **Publish the token-divergence diff as a fact — and pick nothing.** Every value where `tailwind.config.js` and `sketches/themes/default.css` disagree, listed | A dated diff exists and feeds D2's pack. **No token changed, no primary chosen** — OD-106 is document-only | **2026-09-18** | `tailwind.config.js:31,44,84,170` `#9E4249` vs `themes/default.css:6-10`; OD-106, `OPEN-DECISIONS.md:67` |

### T3 — [[exploration-studio-charter]] · a design question

| ID | Task | Doneability | Close | Evidence |
|---|---|---|---|---|
| **T3.1** | **Bidirectional MANIFEST closure — including this wave.** 43 rows, 53 directories on disk, 10 unindexed (005, 011–015, 017–019, 049), duplicate IDs `038`/`048` used twice each, row `039` pointing at nothing — **plus the ~24 canvases wave 3 is adding right now** | Every directory has a row and every row a directory, or the exception is listed by name; the wave-3 cohort is registered as a distinct cohort so it cannot be mistaken for unresolved exploration | **2026-09-11** | Counted today: 43 rows, **28 `Winner: null`**, 53 sketch directories; `sketch-manifest-steward` `quality_bar`; [[0039-activation-plan-of-record]] Track B (one canvas per department) |
| **T3.2** | **Set N — the WIP limit — and publish it.** It has never been set; 28 questions are open | A number is published in [[exploration-studio-directive]] with its basis, and the next new question is refused or admitted **by that number** | **2026-09-11** | `exploration-studio-directive:68` (*"No new question while more than **N** are open"* — N unset); department decision right at `:63` |
| **T3.3** | **Withdraw the abandoned questions.** A row null for two close-times resolves as *"no winner — question withdrawn"*, which counts as convergence | The 28 nulls are each resolved or explicitly re-admitted with a named owner; `design.resolved_question_rate` moves for the first time | **2026-09-25** | [[design-directive]] unresolved-question rule; [[design-premortem]] M3 (*"the studio became a gallery"*) |
| **T3.4** | **Implement `sketch-manifest-steward` as a declared script** — the third of Design's three mechanical cards | The bidirectional sweep runs from `run_card.py`, emits the orphan/phantom/duplicate diff as a PR, and never edits the corpus silently | **2026-10-09** | `run_card.py:333`; `sketch-manifest-steward` declared gap: `sketch.directory_added` has **no publisher** (*"gsd-sketch generates directories, it does not announce them"*) |
| **T3.5** | **Stand up the sketch program — canvas-driven.** A design question becomes a canvas, MANIFEST-registered at birth, with a named receiving team and a close-time. **The wave-3 canvas cohort (incl. `062`) is cohort #1** and is measured for conversion, not admired | The program is one page in [[exploration-studio-charter]]'s directive; cohort #1 has a conversion reading — how many canvases produced a decision a receiving team acted on — at its second close-time | **2026-10-23** | Today's conversion baseline: `design.winner_shipped_conversion` = **2 of 53** (038 → `/inventory`; 052 → `scripts/docgen/templates/wineops_document.html`); [[design-premortem]] M3's mechanism is *count climbs, resolution does not* |

### T4 — [[activation-in-product-guidance-charter]] · a new user

| ID | Task | Doneability | Close | Evidence |
|---|---|---|---|---|
| **T4.1** | **Define the "real action" event with [[analytics-bi-charter]].** L-DSN-4 cannot close without it and reports *unmeasured* every month until it does | A written event definition agreed by both units, with the role dimension (`owner`/`manager`/`staff`) in it from the start. **Not an onboarding redesign** | **2026-09-25** | [[design-loops]] L-DSN-4 *"**No** — event does not exist"*; `first-run-auditor` declared gap: `activation.real_action` publisher **NONE** |
| **T4.2** | **Execute sketch 051's winner instead of re-exploring it.** The cap is at a known line: `apps/mobile/src/guidance/GuidanceProvider.tsx:186` suppresses per-page first-run guidance once one offer has been made on a different page | The first-visit case overrides the session cap at that line, and a staff first-run on two pages shows two tutorials in a trace | **2026-09-18** | MANIFEST row 051 winner *"B — first-visit overrides session cap"*, decided and unbuilt; `GuidanceProvider.tsx:179,186`; [[design-premortem]] M5 |
| **T4.3** | **Role-based defaults, spec first.** The one deliverable [[AGENT_NATIVE_UI_DECISION]]:102 named and nobody owns — *"cut the surface with role-based defaults in a week, deterministically, with no telemetry"* | A spec naming, per role, which surfaces are hidden by default; `design.role_default_coverage_pct` leaves **0**; `NEW-513` (`/settings` role matrix) either gets an unblocking path or a named blocker | **2026-10-23** | `role_default_coverage_pct` = 0 today; `NEW-513` deferred at `UX_PATHS_CATALOG.md:63`; 9 components in `apps/web/src/components/onboarding/` |
| **T4.4** | **First activation read, split three ways or honestly unmeasured** | Three readings, or one explicit *unmeasured* naming the missing event. **Averaging the three is a defect, not a formatting choice** | **2026-09-11**, then monthly | `first-run-auditor` `quality_bar`; [[design-loops]] L-DSN-4 |

---

## 4. Reach, graded honestly

The founder asked for ambition. Three of the rows above are reaches, and each is graded
here rather than presented as settled:

- **T1.3 / T2.1 / T3.4 — implementing three mechanical cards.** This is the single largest
  lever in the department: it converts [[design-premortem]] M1's promise (*"a script, not a
  habit"*) into code, and it is the only way L-DSN-1/2/3 close on the cadences they claim.
  **The reach:** `scripts/agents/run_card.py` is a shared file — Design authors the three
  functions, Engineering reviews the PR. If that seam is refused, all three degrade to
  hand-run checklists and the loops close at human reliability, which is the reliability
  that produced `:49`. Graded: **high confidence the work is right, open on the seam.**
- **T1.2 — the service-route register.** It requires deciding what "during service" means
  with no telemetry to appeal to. It will be wrong at the edges and is still worth more
  than the undefined denominator it replaces. Graded: **defensible, revisable, and the
  only counter-pressure M2 has.**
- **T4.3 — role-based defaults.** Written as a spec, not a build, because the build touches
  controls trained staff reach for and the turnover rule puts the burden of proof on the
  change ([[design-directive]]). Graded: **aspiration pending §7 Q1 and Q4** — if
  Activation moves to Product & Vision, this row moves with it.

---

## 5. Seeds deliberately not taken

Named, with the reason, so the omissions are decisions rather than gaps:

1. **Writing "the brand voice guide."** Owned by [[brand-identity-charter]] (`:27-29`).
   Design supplies the product-language corpus (D1) as evidence and files a handoff row.
   The 2026-08-24 charter calls this *"the department's sharpest boundary"*; a shared owner
   here means launch deadlines outrank an accessibility defect every quarter, forever.
2. **A side-by-side burgundy mock for the OD-106 pack.** It is the natural next artifact and
   it is a **visual**. OD-106, `OPEN-DECISIONS.md:67` says documentation only; the mock stays
   *offered*, un-made, until the founder reopens the workstream.
3. **Any landing, marketing, or Blender artifact.** `decisions/README.md:81`. Held.
4. **Reading "sketch program" as *more sketches*.** The corpus has 28 unresolved questions
   and 10 unindexed directories; adding volume to it is [[design-premortem]] M3 executing
   itself. The program is convergence and governance (T3.1–T3.5), and its first act is
   absorbing the 24 canvases this very wave is creating.
5. **Advancing, seeding, or "evaluating" the UX optimizer.** [[AGENT_NATIVE_UI_DECISION]]:78
   is a closed verdict; reversing it is a supersede-ADR, not an agenda item.
6. **A combined design-velocity number to make this agenda legible.** Forbidden by
   [[design-directive]], and the temptation is highest exactly when a board has five
   unmeasured rows.

---

## 6. Findings — things no card or loop can carry

Per [[GENERATION_BRIEF]] §8.1.2, these are recorded rather than listed as tasks. Each is
addressed by name and belongs in [[design-questions]] or the receiving unit's questions file.

| Finding | Why it is not a task | Addressed to |
|---|---|---|
| **The department's own card cannot run.** `design-board-steward` is `routing_class: extraction`, and [[0038-cards-run-as-declared-scripts]] keeps judgment/extraction cards designed — *running them would fabricate*. So D3's rollup is a human PR indefinitely | No card can carry it; automating it would violate the ADR | [[decision-office-charter]] |
| `loop.close_time_breached` has **no publisher** — nothing measures loop age | The weekly/monthly schedules bound the blind spot at one cycle; closing it needs an org-wide mechanism | [[decision-office-charter]] |
| `design.time_to_first_real_action_*` has **no producing event** | T4.1 negotiates the definition; emitting it is not Design's code | [[analytics-bi-charter]] |
| `design.blocked_on_endpoint_count` is emitted with **no committed consumer** while PROD-F5 is open | Publishing it monthly is the point — it makes the cost of the open fork visible instead of absorbed | Founder, via D5 |
| **The 47-file a11y allowlist has no owning metric in any charter.** It is a real, ratcheting, CI-enforced backlog that Design inherited without noticing | T2.2 adopts it; the finding is that a guard shipped with no department counting it | [[design-charter]], next revision |
| `sketch.directory_added` has **no publisher** — `gsd-sketch` creates directories silently. This wave adds ~24 at once | Mechanism gap, not a work item | [[exploration-studio-charter]] |

---

## 7. Questions for the founder

1. **Can the burn-down team commission the endpoints its rows are blocked on, or only
   report blocked?** (PROD-F5.) Unchanged and still the highest-stakes question here: it
   decides whether the department's largest team functions or spends a year writing the
   word *blocked*. D5 escalates the first concrete instance rather than arguing it in the
   abstract.
2. **Is the 910-row catalogue a commitment or an inventory?** If it is an inventory, the
   ledger needs a **"will not build"** state it does not have today, and closing a row
   becomes an honest outcome instead of an omission (T1.4).
3. **Does the design system get a migration budget, or only a documentation budget?**
   `token_source_count` goes 2 → 1 only by changing `apps/mobile`. Without a budget the
   metric is decorative and should be **removed from the board rather than reported** —
   [[design-directive]] escalation trigger 3 fires at the end of the quarter either way.
4. **Four teams or three?** Activation's outcome is a business number; its named
   deliverable is an interaction-design act. T4.3's owner depends on the answer. State it
   rather than letting whoever picks up the work settle it.
5. **Confirm the optimizer stays dark** — or say plainly that
   [[AGENT_NATIVE_UI_DECISION]]:78 should be revisited, which is a supersede-ADR and should
   not happen quietly inside this department.
6. **New, and cheap to answer:** when OD-106 reopens, does the co-design session start from
   D2's pack, or do you want the archetype map re-cut first? The pack is being built either
   way; the answer only changes what is in front of you on the day.
