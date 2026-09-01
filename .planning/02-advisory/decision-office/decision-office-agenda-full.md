---
type: agenda-full
division: advisory
department: decision-office
status: active
metrics: [decisions.open_count, decisions.unowned_count, decisions.median_age_days, decisions.close_rate_per_week, decisions.decided_here_count, decisions.namespace_collisions, decisions.unfiled_fork_count, triggers.dated_unwatched_count, triggers.fired_but_unactioned_count, loops.undefined_close_time_count, corpus.contradiction_count, corpus.stale_citation_count]
updated: 2026-08-28
links: ["[[decision-office-charter]]", "[[decision-office-premortem]]", "[[decision-office-agenda-board]]", "[[decision-office-directive]]", "[[decision-office-loops]]", "[[decision-office-schedule]]", "[[decision-office-agent-stack]]", "[[decision-office-questions]]", "[[FORK-REGISTRY]]", "[[ORG_STRUCTURE]]", "[[OPEN-DECISIONS]]", "[[OBSIDIAN_VAULT]]", "[[LOOP-MAP]]", "[[0002-documentation-first-operating-mode]]", "[[0007-org-structure]]", "[[0025-citations-must-disagree-loudly]]", "[[0034-agent-stack-artifact]]", "[[0035-wave2-seam-reconciliation]]", "[[0036-cost-routing-two-plans-in-harmony]]", "[[0037-nfb-erasure-is-crypto-shredding]]", "[[0038-cards-run-as-declared-scripts]]", "[[0039-activation-plan-of-record]]", "[[README|foundation-README]]", "[[red-team-charter]]", "[[architecture-review-charter]]", "[[standards-verification-charter]]", "[[knowledge-documentation-charter]]", "[[skills-charter]]", "[[analytics-bi-charter]]", "[[legal-charter]]", "[[sales-charter]]"]
---

# Decision Office — Agenda · 2026-08-28

> First real agenda. Replaces the 2026-08-24 forecast under
> [[0039-activation-plan-of-record]] Track B.

> **This office decides nothing** ([[decision-office-charter]] §Authority; OD-16,
> Resolved). Every task below ends in a *finding*, a *register row*, a *proposal*, or
> an *escalation* — never in an answer. `decisions.decided_here_count` has a permanent
> target of **0**, and two tasks here exist specifically to make that number checkable.
> Where a fork looks obvious, the agenda says so and still refuses it
> ([[decision-office-directive]], node T).

## The frame

The 2026-08-24 charter graded this function **NEW with a full inbox**. Four days and
six ADRs later the inbox is the same shape and the *substrate* has changed underneath
it. Everything in this table was measured on 2026-08-28 in this worktree.

| What the unit's own documents say | State on 2026-08-28 |
|---|---|
| Register: 35 open rows, no owner, no date | **39 open · 72 resolved.** The `## Open` header is still the same four columns — **39 of 39 unowned and undated**, so `decisions.median_age_days` is still undefined. Severity: 13 of 39 carry a 🔴/🟠/🟡 band, 26 carry none |
| "Nothing watches the dated triggers" | **Stale — a watcher exists.** `scripts/watch_loops.py` runs in CI (`.github/workflows/loop-watcher.yml:36`) and reports 5 dated events inside 30 days. Its *staleness* arm is sound; its *trigger* arm is not (DO-13) |
| "`00-index/LOOP-MAP.md` does not exist"; "none of the 396 loop blocks is queryable" | **Stale.** Both indexes exist; `00-index/loops.json` holds **485** loops — 438 `proposed`, 29 `blocked`, 9 `dormant`, 4 `gated`, 3 `active`, 2 `running`. `loops.undefined_close_time_count` reads **0** |
| "The register has no instrument" | **Four now exist**, and CI runs all four (`ci.yml:196-205`). Two are **red today** (DO-3) |
| Skills: registry empty, 4 candidates eligible, 0 written | `.claude/skills/` holds **4 committed skills** — `fleet-census`, `harness-contract-audit`, `model-pin-census`, `registry-index-refresh`. **None is this office's** (DO-15) |
| Fork registry reconciled (OD-30/42, Resolved) | Reconciled and **already drifting**: its citation index is dated 2026-08-24 (`FORK-REGISTRY.md:165`) and TECH-F3 has moved from *26 citations in 17 files* to **54 occurrences in 30 files** |

**What that changes about the plan.** The 2026-08-24 agenda's top three steps were
metadata work nobody could argue with. They are still right and they are no longer the
whole job: the office now has running instruments it did not write, two of which are
failing, and a locked plan of record ([[0039-activation-plan-of-record]]) whose A5 item
depends on a fork this office has been carrying open since day one. The spine below is
therefore **cadence first, then the two carried forks, then verifying that six ADRs in
five days actually landed where they say they landed.**

---

## Program 1 — The burn-down cadence, with instruments

The weekly pass ADR 0002 asked for and nobody has ever run. It is not a report about
the register; it is the register's ageing clock, and it ships whether or not anything
moved ([[decision-office-premortem]] M2).

### DO-1 · The register gains the three columns it has never had

- **Owner:** this office · card `decision-register-clerk` ([[decision-office-agent-stack]] §2)
- **close_time:** **2026-09-04**, then re-checked every weekly pass
- **Doneability:** the `## Open` table header carries **owner · filed_date · severity**
  alongside the existing four; 39 of 39 rows carry all three; `decisions.median_age_days`
  returns a number for the first time. Done when the number exists, not when the columns do.
- **Why this is not deciding:** owner here means *the unit that must produce what
  unblocks the row* — never the decider ([[decision-office-directive]] §Decision rights).
  Assigning it changes no row's meaning. The bright line is untouched: no cited ID is
  reassigned.
- **Evidence:** the `## Open` table header carries four columns today; 39 open rows
  counted 2026-08-28; [[0002-documentation-first-operating-mode]] §Consequences names
  "grows faster than it drains" as its own revisit condition and it has never been computed.
- **Guard obligation:** the edit adds rows to no table and shifts no line anchors, but
  both register guards run before and after regardless — the register-row/citation
  coupling is locked by [[0025-citations-must-disagree-loudly]].

### DO-2 · Digest #1, oldest first, and then every week

- **Owner:** this office · escalates to founder
- **close_time:** **2026-09-04**, then **weekly**; a missed week is itself a digest line
- **Doneability:** one page that leads with the **oldest** open row (not the most
  tractable — M4), carries `open_count · intake_rate · close_rate_per_week ·
  median_age_days` on one line, names every row still missing a DO-1 field, and ships
  on an unchanged register.
- **Evidence:** [[decision-office-schedule]] weekly rows L1/L2; the charter's measured
  7:1 fill-to-drain ratio; today's ratio is unmeasurable for the same reason it was then.
- **Grade:** this is the cheapest task on the page and the one whose absence explains
  every other number here.

### DO-3 · The guard panel — four register guards, exit codes in the digest

- **Owner:** this office (reads) · [[standards-verification-charter]] (owns `claim-auditor`)
- **close_time:** **2026-09-04**, then weekly with the digest
- **Doneability:** the digest carries one line per guard with its exit code and headline
  count, and a red guard is named in the digest's first paragraph rather than a footer.
- **Evidence — run 2026-08-28 in this worktree, all four:**

| Guard | Exit | What it said |
|---|---|---|
| `scripts/check_decision_claims.sh` | **0** | 111 executable claims checked, 111 holding |
| `scripts/check_citation_pairing.py` | **1** | 125 register citations vs 107 rows · **12 UNANCHORED** · **1 DISAGREEING** (re-run minutes later: 157 · 14 · 2 — the wave was still landing) |
| `scripts/check_od_ids_exist.py` | **1** | 1,215 documents vs 106 rows · **2 ids name nothing**, 7 references, all in `04-specs/REGISTER-AUDIT-2026-08-26.md` |
| `scripts/build_agent_card_index.py --check` | (card's third guard) | 100 units / 102 cards contract check |

- **The finding this produces on day one:** **two of the four are red**, and the one
  DISAGREEING citation is a sibling wave-3 agenda. `finance-pricing-agenda-full.md:103`
  anchors its OD-23 reference at register line **122**, which holds OD-48's row; the
  pair that agrees is OD-23 (`OPEN-DECISIONS.md:32`).
  The second red guard is older and entirely internal: **two register ids that no longer
  exist** are still cited seven times, every one of them inside
  `04-specs/REGISTER-AUDIT-2026-08-26.md` (`:58`, `:69`, `:71`, `:566`, `:593`, `:600`).
  Both were absorbed into surviving rows and the audit document was never chased. Naming
  the dead ids here would add two more references, so this agenda cites the *file* and
  leaves the ids to the digest — which is the same discipline it asks of everyone else.
- **Routed, not fixed:** `claim-auditor` runs **three** guards
  (`scripts/agents/run_card.py:279-294`) while CI's `decision-claims` job runs **four**
  (`.github/workflows/ci.yml:196-205`) — `check_od_ids_exist.py` is missing from the
  card. That is another unit's card; the finding goes to
  `standards-verification-questions.md`, and this office does not edit it.

### DO-4 · Wave-3 conformance sweep — the wave that writes agendas is minting bad citations

- **Owner:** this office · findings to each unit's `questions.md`
- **close_time:** **2026-09-11** (one pass after the wave lands), then absorbed by DO-2
- **Doneability:** every wave-3 agenda is graded on three mechanical tests — (a) each
  register citation carries an id **and** a line that agree, (b) no task schedules work
  past the two standing locks (pricing deferred; brand/landing visuals held —
  [[0039-activation-plan-of-record]] re-confirmed 2026-08-28), (c) each task states a
  doneability and a close_time. One row per agenda, pass or the specific line that fails.
- **Evidence, measured 2026-08-28 while the wave was still landing:** **every one** of
  the guard's flagged sites is a wave-3 agenda file — `media-brand-agenda-full.md` ×4
  plus its board, `design-agenda-full.md` ×2, `analytics-bi-agenda-full.md` ×2,
  `finance-pricing-agenda-full.md` ×2, `architecture-review-agenda-full.md` ×2,
  `ai-orchestration-agenda-full.md`, `knowledge-documentation-agenda-full.md`,
  `strategy-fundraising-agenda-board.md`. **The count rose from 13 to 16 between two
  runs minutes apart** as more of the wave landed; the trend is the finding, not the
  integer. A wave writing 48 documents against a guard nobody told it about is exactly
  the contradiction class [[decision-office-loops]] L5 exists for.
- **This agenda holds itself to the same test:** it was run against
  `check_citation_pairing.py` before it shipped and contributes **0** flagged sites.
  An office reporting this defect while committing it would have no standing to report
  anything.
- **Restraint:** the sweep reports the failing line and the correct anchor. It does not
  edit another unit's agenda, and it takes no position on whether a lock *should* hold.

---

## Program 2 — Carry OD-25 and TECH-F3 to closure

Two forks this office has held since its first hour. "Carry to closure" means **put each
in front of the founder with the evidence and the options, and keep re-raising with an
age attached** — it does not mean answer them. Both are the founder's, and one of them
now looks obvious, which is the more dangerous of the two.

### DO-5 · OD-25 — the evidence pack, and a register defect found while building it

- **Owner:** this office · decider: founder
- **close_time:** **2026-09-04** for the pack; re-raise weekly; third consecutive
  re-raise goes to founder **and** [[red-team-charter]] ([[decision-office-schedule]] L2)
- **Doneability:** one page carrying both sources verbatim with today's `path:line`, the
  two (now three) candidate owners, what each costs, and **no recommendation** — a
  finding containing the word *should* is an escalation trigger in its own right
  ([[decision-office-directive]] §Escalation trigger 5). Closed when the founder rules
  or explicitly defers **with a new date**; silence is not an outcome (M5).
- **Evidence, re-verified 2026-08-28:** `foundation/README.md:269` still assigns
  *"Weekly · Skill health — what fired, what went stale"* to **Research & Math**;
  `foundation/teams/technology.md:498` still routes the same job through **Skills**.
  OD-25 (`OPEN-DECISIONS.md:33`) records that the 2026-08-24 call fixed the *principle*
  and not the department, and that neither source document was amended.
- **The complication that makes this urgent rather than tidy:**
  [[0039-activation-plan-of-record]] Track A4 assigns *"`nf_a.skill_id` + a weekly runner
  cron"* to **RM-3 nf-instrumentation + SRE**. A locked plan of record has now put a
  weekly skill-health mechanism in a third place. The fork did not get easier; it got a
  new claimant, and this office reports that rather than reconciling it.
- **Register defect found in the same pass — filed, not fixed:** **OD-25 appears in both
  tables.** It is open at OD-25 (`OPEN-DECISIONS.md:33`).
  It is also resolved at OD-25 (`OPEN-DECISIONS.md:33`).
  One identifier, two states, and the only such row in the file. No guard catches it:
  `check_od_ids_exist.py` checks that an id resolves, `check_citation_pairing.py` checks
  that an id and a line agree, and neither asks whether one id appears twice.
  **This is a real past instance for a `register-table-integrity` check**, which is
  exactly what [[README|foundation-README]] §3.3 rule 3 demands before a skill may be
  written — see DO-15.

### DO-6 · TECH-F3 — re-measure it, then file it as a proposal

- **Owner:** this office (registrar) · decider: founder, with
  [[architecture-review-charter]] sighted
- **close_time:** **2026-09-11**, time-boxed to two close-times and then abandoned
  rather than extended (M4)
- **Doneability:** (a) `FORK-REGISTRY.md`'s citation index regenerated and **dated**, so
  its counts stop being 2026-08-24 numbers; (b) one proposal row for the canonical
  register carrying the fork, its citation count, and the two options — filed under
  §5.1's existing recommendation, not applied.
- **Evidence:** `FORK-REGISTRY.md:64` defines TECH-F3 (*does `aio-evaluation-gates`
  coexist with Research & Math, or is it one team?*); `:200` records **26 citations in
  17 files**; `:649` already proposes filing it. **Re-measured 2026-08-28: 54
  occurrences across 30 files** under `01-org/` + `02-advisory/` + `foundation/`. The
  index is stale by thirteen files and four days — which is the same rot the office
  reports in everyone else's citations.
- **Consequence worth stating plainly:** [[0039-activation-plan-of-record]] A5 ships the
  first judgment rubric with *"the TECH-F3 line kept"*. A locked plan is now executing
  across an undecided seam. That is not an argument for deciding it here; it is the
  argument for a date.

### DO-7 · The restraint clause — ADR 0036's precedent is reported, never applied

- **Owner:** this office · audited by [[red-team-charter]] at L6
- **close_time:** **2026-09-11** (it is DO-6's acceptance criterion, not a separate run)
- **Doneability:** the TECH-F3 pack states, in one line, that
  [[0036-cost-routing-two-plans-in-harmony]] settled the *routing* seam by a named
  principle — methodology and operation run as two plans in harmony; if the line fails,
  merge, never duplicate — and that ADR 0036's own text (`:24`) says it draws *"the same
  line TECH-F3 draws for evaluation, one seam over"*. The pack **asks whether the
  principle transfers**. It does not answer, and the word *should* does not appear.
- **Why this task exists at all:** this is the most sympathetic possible door into
  [[decision-office-premortem]] M3. A locked ADR, a sibling seam, an identical shape, a
  team blocked on it, and nobody would object. The directive's node T draws exactly this
  edge (`G ⇢ T`, *"one side is obviously right, so routing it is the same as resolving
  it"*). Writing the refusal down before the pressure is real is the whole method.
- **Evidence:** `0036-cost-routing-two-plans-in-harmony.md:24,47`;
  OD-29 (`OPEN-DECISIONS.md:35`); [[decision-office-directive]] §Tie-break rule.

### DO-8 · The re-raise ladder, with dates on it

- **Owner:** this office
- **close_time:** ladder armed **2026-09-04**; each rung is one weekly digest
- **Doneability:** OD-25 and TECH-F3 each carry a filed date, an owner, an age, and a
  named next re-raise date. Age past two close-times ⇒ the digest leads with it; third
  consecutive re-raise ⇒ founder **and** red-team, together
  ([[decision-office-directive]] escalation trigger 4, [[decision-office-loops]] L2).
- **Evidence:** M5 — *"reporting only to a non-responder is not reporting"*. Both forks
  have now survived six ADRs without being re-raised once, which is the failure this rung
  exists to make visible.
- **Reach, graded:** this only works if the digest is actually read. If two consecutive
  ladders produce no terminal state, the honest finding is that escalation-by-document
  does not work here, and *that* becomes a founder question — not a third ladder.

---

## Program 3 — Verify that ADRs 0034–0039 landed where they say they landed

Six ADRs in five days, most resolving *seams* — a seam is resolved in the ADR and
**executed** in other units' documents. Nothing has re-read those documents. This is the
office's contradiction register pointed at its own log.

### DO-9 · The seam verification table

- **Owner:** this office · findings to each amended unit's `questions.md`
- **close_time:** **2026-09-11**; then **per-ADR** — any future ADR claiming amendments
  elsewhere gets a row within one weekly pass
- **Doneability:** one table, one row per resolution declared by ADRs **0034–0039**,
  each row citing the amended `path:line` and grading it
  **says-what-the-ADR-says** / **amended-but-diverges** / **not-amended**. A row that
  cannot be graded from disk says so; it never defaults to pass.
- **Evidence — the claim under test:** `0035-wave2-seam-reconciliation.md`
  §Consequences asserts *"the affected agent-stack, schedule, loops, and charter lines
  were amended the same day with `ADR 0035` cites, so no doc still states the conflict as
  open."* 25 files under `01-org/` + `02-advisory/` + `00-index/` cite `0035` today.
- **Row 1, already graded — `amended-but-diverges`.** ADR 0035 item 5 assigned the NF-B
  erasability loop an owner. `privacy-engineering-loops.md:193` carries it correctly.
  `00-index/loops.json` carries that loop's `owner` as the **whole line including its
  YAML comment** — `privacy-engineering  # assigned 2026-08-27, founder via ADR 0035
  (was UNASSIGNED — escalated); sync loops.json on next regeneration`. Measured: it is
  **the only one of 485 loop records with a comment in a field**, and it is the exact
  field the ADR changed. Any consumer filtering `owner == "privacy-engineering"` misses
  it, and any grep for `UNASSIGNED` in the index still hits. The seam resolution landed
  in the prose and not in the index that machines read.
- **Restraint:** `scripts/build_loop_index.py` is engineering's. The office files the
  finding and the reproduction; it does not patch the parser.

### DO-10 · An ADR header that names the wrong register row — the uncaught half

- **Owner:** this office (files) · the ADR's author / founder (corrects)
- **close_time:** **2026-09-04** to file; the correction ages out at **42 days**
  ([[decision-office-questions]] escalation rule)
- **Doneability:** a finding naming the file, the line, the row it names, the row it
  means, and the guard arm that cannot see it. Closed when filed and dated — **not**
  when corrected, because correcting it is not this office's.
- **Evidence, verified 2026-08-28:**
  `0023-email-verification-is-enforced.md:12` reads *"Status: Proposed — closes
  [OD-106](OPEN-DECISIONS.md)"*, and repeats it at `:16`. But today
  OD-106 (`OPEN-DECISIONS.md:64`) is **Design foundation direction**, still open.
  The row that ADR actually closed is
  OD-79 (`OPEN-DECISIONS.md:96`) — *"Resolved 2026-08-26 — enforced"*.
  `0025-citations-must-disagree-loudly.md:385-388` records this exact
  renumber — OD-79 was refiled as OD-106 — and says `check_od_ids_exist.py` *"blocks the
  names-nothing half and says in its own docstring that it cannot catch
  names-the-wrong-thing."* **This is the names-the-wrong-thing half, live, in a
  decision record, four days after the ADR that predicted it.**
- **What it earns:** a second real past instance for the `register-table-integrity`
  candidate in DO-15, and a concrete answer to "what would a fourth guard arm check?" —
  an id-only citation inside `decisions/` whose target row's subject does not match the
  citing ADR's title. Proposed, costed, **not written here**.

### DO-11 · Intake — the staged forks nobody filed

- **Owner:** this office (registrar) · founder for the ones that are decisions
- **close_time:** **2026-09-11**; per-event thereafter (L3)
- **Doneability:** every staged fork resolves to exactly one of: a canonical register
  row, a `FORK-REGISTRY` row with a disposition, or an explicit *"not a decision"* note.
  Nothing is silently dropped and no cited ID is reassigned.
- **Evidence:** `FORK-REGISTRY.md:125` acknowledges the `RT-Fn` namespace and points at
  `red-team-agenda-full.md:296-301` — but **none of RT-F1…RT-F6 has a row or a
  disposition anywhere.** Meanwhile two of the six have moved underneath the registry:
  RT-F1 (NF-B erasability) is largely answered by
  [[0037-nfb-erasure-is-crypto-shredding]], Locked 2026-08-28, with NF-B still HELD; and
  RT-F3 (symmetric merge triggers) is a restatement of
  OD-26 (`OPEN-DECISIONS.md:34`).
  That row absorbed a second duplicate of itself on the same grounds in August.
- **Method rule this pass adopts:** dedupe against the ADR log **first**, then against
  the register. The 2026-08-24 sweep deduped against the register only, which is how
  ≥19 staged forks and six red-team forks all stayed staged while three of them quietly
  got answered.
- **Grade — reach:** the intake is only as good as the dedupe, and the dedupe is
  judgment. This ships as a proposal with its reasoning visible per fork, never as a
  bulk renumbering.

---

## Program 4 — The calendar, corrected

The charter said six dated triggers and one cliff, all unwatched. There is now a watcher
in CI, and it is wrong in a specific and fixable way.

### DO-12 · Two staleness cliffs, four days apart

- **Owner:** this office · the owning unit answers each flagged agenda
- **close_time:** dry run in the week of **2026-10-16**; the cliffs fire **2026-10-23**
  and **2026-10-27**
- **Doneability:** both dates on the calendar with their counts, a dry run that produces
  the actual list before the date, and a stated expectation — a sweep that flags 160
  documents at once is ignored unless it is expected.
- **Evidence, measured 2026-08-28 (`watch_loops.py --asof`):** `2026-10-23` — **160**
  agendas sharing `updated: 2026-08-24`; `2026-10-27` — **40** agendas sharing
  `updated: 2026-08-28`. The charter predicted **one** cliff of 194. Wave 3 split it:
  department agendas were rewritten today, team agendas were not. Counts move as the
  wave finishes; **the split is the finding, not the integers.**
- **Known blind spot, restated rather than solved:** `watch_loops.py:74` reads the
  `updated:` field, so a date-only bump defeats the 60-day rule — the dodge
  [[legal-charter]] already caught and this office adopted. Measuring the clock from
  content rather than from a date field is a corpus-wide format change:
  [[architecture-review-charter]] and the founder, filed not fixed.

### DO-13 · The trigger detector cannot tell a task from a retirement

- **Owner:** this office (files) · engineering owns `scripts/`
- **close_time:** **2026-09-11**; re-raised weekly until a terminal state
- **Doneability:** a finding carrying (a) the detector's rule, (b) a dated sample of its
  output with each hit graded true/false, and (c) one proposal — that a dated trigger be
  **declared** in frontmatter rather than **grepped** from prose. Closed when the
  proposal is in front of the founder; not when a script changes.
- **Evidence, run 2026-08-28:** `watch_loops.py:97-113` classifies as a retirement
  trigger *any line containing* `merge|retire|collapse|fold|disband|sunset|dissolution`
  *near any date from September onward*. Today it reports **five** events inside 30 days, the
  nearest in **7 days** — *"2026-09-04, 3 units must judge whether they should still
  exist"*. The three lines behind that date are ordinary wave-3 **task rows**:
  `knowledge-documentation-agenda-full.md:77`, `security-agenda-full.md:202`,
  `finance-pricing-agenda-full.md:80`. Meanwhile the real cluster — **8 units on
  2026-11-24**, plus 3 on 2026-11-22 — sits outside the 30-day horizon and is invisible.
- **Reproduced while writing this page, twice.** The first draft of this agenda and its
  board **manufactured two new false triggers** — one on 2026-09-01 for this office and
  one for [[architecture-review-charter]] — purely by *describing the detector's word
  list next to a date*. Both were reworded before shipping, and re-running the watcher
  confirmed they were gone. A rule you cannot write about without triggering is not a
  rule, and that is a stronger argument than any sample.
- **The sharpest instance, and it is ours:** `02-advisory/decision-office` is itself
  named in the watcher's 2026-10-23 and 2026-11-22 unit lists — because
  `decision-office-charter.md:259-263`, `decision-office-loops.md:137-140` and the board
  *catalogue other units' triggers*. **The office's register of triggers is
  indistinguishable, to the only instrument that watches triggers, from having them.**
  That is the argument for declaration over grep, and it costs nothing to state.
- **Independently corroborated, and routed back to us the same day.**
  [[red-team-charter]]'s agenda — which landed while this one was being written — files
  the same two facts as **F-W1** (the 60-day rule now fires as two mass events) and
  **F-W2** (*"dated-trigger events went 0 → 6, 18 unit-slots, all false, and the genuine
  November signal now sits under 35 line-hits"*), names this office as the loop owner for
  both, and asks for **a dated row in `decision-office-questions.md`**. Two advisory
  functions measuring the same instrument independently and agreeing is the strongest
  evidence on this page. **Accepting the two inbound rows is DO-12/DO-13's first
  deliverable**, due with them on 2026-09-11.
- **Grade — reach with a named holder:** this may close as `BLOCKED` if the format
  change lands behind the loop-block question that has been open since 2026-08-24. The
  finding is still worth filing on its own.

---

## Program 5 — Restraint, made checkable

The failure that ends this function is not slowness. It is helpfulness.

### DO-14 · The three restraint counters, reported weekly whether or not they move

- **Owner:** this office reports · [[red-team-charter]] audits (L6 is **not ours**)
- **close_time:** weekly from **2026-09-04**; the authority audit is **quarterly** and
  owned elsewhere
- **Doneability:** every digest carries `decided_here_count` (target **0**, permanently),
  `intake_returned_count` (target **0**, not "low"), and a grep of this office's own
  findings for the word *should* — with the count printed even when it is zero, because
  a number that appears only when it changes cannot embarrass anyone (M2).
- **Open, and escalated rather than assumed — re-checked late on 2026-08-28:**
  [[red-team-charter]]'s agenda landed during this session (`status: active`,
  `updated: 2026-08-28`) with eleven tasks, and **none of them is the authority audit.**
  `decision-office-authority-audit` is the one loop in this unit whose `owner` reads
  `red-team`, and it appears **zero times** in either of red-team's two new agenda files.
  So L6 is now *unclaimed by an active agenda* rather than *pending a provisional one* —
  a worse state, not a better one. This office cannot audit its own authority creep and
  will not try. Filed as a gap, not staffed.
- **Evidence:** [[decision-office-loops]] L6 (`owner: red-team`);
  [[decision-office-premortem]] M3; [[decision-office-charter]] §Authority.

### DO-15 · This office's own §3.3 gate — four eligible candidates, zero written

- **Owner:** this office proposes · [[skills-charter]] confirms tiers
- **close_time:** **2026-09-28** (monthly), reviewed against the four skills that now exist
- **Doneability:** each candidate either becomes a `SKILL.md` with a cited past instance,
  or is written down as ineligible with the reason. The office that reports on everyone
  else's §3.3 compliance takes no exception for itself.
- **Evidence:** `.claude/skills/` holds four committed skills as of 2026-08-28 —
  `fleet-census`, `harness-contract-audit`, `model-pin-census`,
  `registry-index-refresh` — each wrapping `scripts/agents/run_card.py`
  ([[0038-cards-run-as-declared-scripts]]). None belongs to this office, and the pattern
  they establish is exactly what `fork-id-collision-scan`, `register-triage-digest`,
  `dated-trigger-calendar` and `loop-close-time-audit` were declared as
  ([[decision-office-agent-stack]] §3, all four **NEW**).
- **Two status changes this agenda records:**
  `loop-close-time-audit`'s stated blocker is **closed** — `00-index/loops.json` exists
  and `loops.undefined_close_time_count` reads 0. `register-table-integrity` is a **new**
  candidate that now clears rule 3 on two instances found today (DO-5's dual-listed
  OD-25; DO-10's ADR header naming the wrong row) — proposed, not written.
- **Reach, graded honestly:** `decision-register-clerk` is declared
  `routing_class: mechanical` and is **not** in `run_card.py`'s `IMPLEMENTED` map
  (`:333-341`, 8 of 36 mechanical cards). Implementing it would make the weekly digest a
  script rather than a session. That is a real ask on whoever owns `scripts/agents/`,
  filed as a question — **aspiration pending someone else's capacity**, not a scheduled
  task.

---

## Questions for the founder

Each is a fork this office cannot answer ([[decision-office-directive]] §Decision
rights). Filed, not assumed. The first two are the ones this agenda was asked to carry.

1. **OD-25 — Research & Math, Skills, or the Track A4 pair?** Two foundation documents
   still name two owners (`foundation/README.md:269` vs
   `foundation/teams/technology.md:498`), and [[0039-activation-plan-of-record]] A4 has
   now put a weekly skill-health mechanism with **RM-3 + SRE**. Three candidates, one
   job. The 2026-08-24 call fixed the principle and not the department, and the row is
   open at OD-25 (`OPEN-DECISIONS.md:33`) while its twin sits resolved
   at OD-25 (`OPEN-DECISIONS.md:33`). One pick closes both.
2. **TECH-F3 — does ADR 0036's principle transfer to the evaluation seam?**
   [[0036-cost-routing-two-plans-in-harmony]] settled the routing seam as *methodology
   and operation, two plans in harmony; if the line fails, merge, never duplicate*, and
   says at `:24` that it is *"the same line TECH-F3 draws for evaluation."* **This office
   will not apply that principle**, however obviously it fits — applying a precedent is
   deciding. A yes closes 54 citations across 30 files; a no is equally closeable.
   [[0039-activation-plan-of-record]] A5 is already executing across this seam.
3. **Should a dated trigger be declared rather than written in prose?** The only
   instrument watching triggers currently reads any sentence containing *merge*, *fold*
   or *retire* near a future date — which today makes three wave-3 task rows look like
   three units facing dissolution in seven days, and makes this office's *catalogue* of
   other units' triggers look like its own. A frontmatter field would fix it and it is a
   corpus-wide format change, so it is not ours.
4. **Who owns L6, the authority audit of this office?** [[red-team-charter]]'s agenda is
   still provisional. The one external check on the failure mode this function is most
   likely to hit is currently unstaffed, and this office is the wrong unit to fix that.
5. **CORP-F6 — does `standards-verification` reparent under this office?** Declined in
   writing (charter §One offer this office must decline). Declining is ours; accepting is
   not. Still needs a founder yes or no to close either way. A **second** such offer
   would mean the boundary is being tested rather than misunderstood.
6. **OD-26 — merge triggers org-wide?** Re-measured 2026-08-27 at **23 split triggers vs
   6 merge/retirement** at OD-26 (`OPEN-DECISIONS.md:34`) — the asymmetry widened while
   the row sat open. The register calls this *"likely a Decision Office standing rule."*
   **This office declines to write it as one**: a standing rule authored by its own
   enforcer has no independent author.
