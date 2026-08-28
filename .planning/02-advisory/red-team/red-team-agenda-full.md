---
type: agenda-full
division: advisory
department: red-team
status: active
metrics: [rt.finding_return_hours, rt.locked_decision_challenge_rate, rt.reaffirmation_rate, rt.finding_actionability, rt.open_finding_age_days, rt.undeclared_decision_count, rt.self_selected_target_share, nf_a.doneability_verdict]
updated: 2026-08-28
links: ["[[red-team-charter]]", "[[red-team-premortem]]", "[[red-team-directive]]", "[[red-team-loops]]", "[[red-team-schedule]]", "[[red-team-agent-stack]]", "[[red-team-questions]]", "[[red-team-agenda-board]]", "[[decision-office-charter]]", "[[architecture-review-charter]]", "[[security-charter]]", "[[compliance-privacy-charter]]", "[[research-math-charter]]", "[[skills-charter]]", "[[knowledge-documentation-charter]]", "[[exploration-studio-charter]]", "[[ai-orchestration-charter]]", "[[0039-activation-plan-of-record]]", "[[0037-nfb-erasure-is-crypto-shredding]]", "[[0034-agent-stack-artifact]]", "[[0029-p3-plan-of-record]]", "[[0007-org-structure]]", "[[0006-neural-footprint-architecture]]", "[[0001-mudavym-single-entity]]", "[[ORG_STRUCTURE]]"]
---

# Red Team — Full Agenda

**Dated 2026-08-28.** Written under [ADR 0039](../../decisions/0039-activation-plan-of-record.md)
Track B. This supersedes the 2026-08-24 forecast rather than amending it: that file was
written against 7 locked ADRs, 23 open forks and zero `questions.md` files, and every one
of those numbers is now wrong (§What moved).

Advisory sits **outside the line**, **findings-only, locked** ([[ORG_STRUCTURE]] §3, OD-16).
Nothing on this page instructs another unit. Every row below produces **a written argument
with one next action attached**, delivered into somebody's `questions.md`, and the receiving
unit is free to decline in writing — which is a close, and a good one.

## The one sentence

The wave that produced this agenda is itself the highest-scoring target on the queue —
ADR 0039 was locked **today**, its 7-day window is open **now**, and this function was
asked to premortem the wave from inside it — so the premortem is item zero, it is
**done**, and it is measured rather than imagined.

## What moved since 2026-08-24

Re-measured on disk 2026-08-28 before anything was scheduled (`CLAUDE.md` §0.1; the
register-rot rule). The charter, premortem, loops and schedule are **not edited by this
wave** — the corrections live here.

| Charter / loops said (2026-08-24) | Measured 2026-08-28 | Consequence for this agenda |
|---|---|---|
| 7 locked ADRs | **39 ADR files, 29 Locked** — and **four locked today** (0036, 0037, 0038, 0039), three on 2026-08-27 (0032, 0033, 0035) | `rt.locked_decision_challenge_rate` is **0 of 29**, and **seven** decisions are inside the O1 cheap window right now. The window is the agenda |
| 23 open forks | **39** open rows in `OPEN-DECISIONS.md` (IDs now run past OD-110) | O2's backlog nearly doubled while nothing was attacked |
| C3: **82** referral lines across **67** units | **436** lines across **99** unit directories | The referral channel grew **5.3×** against **0** findings filed. [[red-team-premortem]] M4's gauge, moving |
| *"No `questions.md` exists anywhere in the corpus"* | **100** `questions.md` files, one per unit (OD-41, `scripts/build_questions_files.py`) | L-RT-2's delivery target exists. The return leg is now runnable, so "unmeasurable" stops being an excuse |
| *"`.claude/skills/` contains exactly one tracked file"* | **4 committed skills** + `README.md` carrying the §3.3 gate | The §3.3 protocol is enforced by a file now, not by a paragraph |
| OD-20 / PR #31 open and unmerged — M3 running live | OD-20 **Resolved**; the guard is on the controller | The founding anecdote closed. The failure class did not — see W1 |
| *"the 7-finding cap is vacuous rather than binding"* ([[red-team-agent-stack]] §5) | **It binds this cycle** — §Cap arithmetic spends all seven slots | First time the charter's WIP limit does real work |

---

## RT-0 · Premortem of wave 3 — **COMPLETE, 2026-08-28**

The §8.3 seed, run as a premortem and written into the agenda as its first finished item.
The question: *how does an ambitious-agenda wave fail?* Twenty of the twenty-four sibling
agendas were on disk in this worktree while this was written, so every mechanism below is
**measured from inside the wave**, not forecast. Method for each: a counterfactual scan
(corpus with vs. without files carrying `updated: 2026-08-28`), or a direct count.

Grades: **LIVE** = happening now, on disk. **LATENT** = the mechanism is real, the signal
has not crossed. **REJECTED** = looked for it, did not find it, say so.

### W1 · The staleness rule fires as a mass event, and a rule that condemns everything condemns nothing — **LIVE**

`watch_loops.py` exists because 198 agendas generated in one burst share
`updated: 2026-08-24` and all hit the 60-day rule on 2026-10-23; its own docstring calls
this *"A rule that condemns everything condemns nothing"* (`scripts/watch_loops.py:12`).
Wave 3 does not remove that cliff. It **splits** it: the 200 agenda files now read **154 at
2026-08-24** and **46 at 2026-08-28** (23 of 24 units on disk; at completion, ~152 and
~48). The detector fires at `count >= 10` (`watch_loops.py:87`), so **both** clear it, and
the org gets two mass condemnations four days apart — 2026-10-23 and 2026-10-27.

Measured: `python3 scripts/watch_loops.py --asof 2026-09-28` already prints both cliff
lines, one per date. Nothing about the wave removed the failure the watcher was built for;
it added a second instance of it, on a fresher date, in a directory whose agendas were
rewritten specifically to be current.

**Earliest observable signal.** 2026-09-27 — the first day the 2026-10-27 cliff enters the
30-day horizon (`HORIZON_DAYS`, `watch_loops.py:35`) and appears in the watcher's
*Approaching* block beside the older one. Cheaper still, and available now: the count of
distinct `updated:` dates across the 200 agenda files. It is **2**.

**Counter-pressure.** Not a date bump — [[red-team-schedule]] already grades a date-only
diff as untouched. The wave supplies its own better instrument and nobody has wired it:
**all 20 wave-3 agendas carry a `close_time` earlier than their own staleness date**
(measured; earliest dates run 2026-09-04 → 2026-09-30). A per-unit check — *did this unit's
first promised `close_time` pass with no content diff?* — fires **staggered**, at each
unit's own promise, weeks before 60 days, and cannot be defeated by a burst-generated
date. That is a proposal, and it goes to the loop owner as **F-W1**, not into this page as
an instruction.

### W2 · The watcher goes deaf: agenda prose is now two-thirds of its dated-trigger signal — **LIVE**

`watch_loops.py:98` flags any line matching `merge|retire|collapse|fold|disband|sunset|
dissolution` that also carries any date from September 2026 onward, and reports it as
*"N units must judge whether they should still exist."* Agenda `close_time` rows trip it
constantly. *(That sentence is written without a literal date on purpose — quoting the
regex beside one is enough to fire it, which is the mechanism demonstrating itself.)*

Counterfactual, run today over `01-org` + `02-advisory`:

| Corpus | Distinct dated-trigger dates | Events inside the 30-day horizon | Unit-slots named |
|---|---|---|---|
| **Without** files dated 2026-08-28 | 4 | **0** | **0** |
| **With** them, at 20 units | 21 | 5 | 16 |
| **With** them, at 23 units — three landed while this was being written | 22 | **6** | **18** |

The third row is not padding. The measurement **moved while it was being taken**, which is
the same shape as this unit's founding T4 finding, where two greps minutes apart disagreed
about the split/merge asymmetry. The rate is the reading: roughly **one false event per
four agendas**, and four of the twenty-four are still to land.

Every one of the five is false. Spot-checked at source: `analytics-bi-agenda-full.md:126`
(*"an `ok()` that **collapses** failure to `null`"*), `engineering-agenda-full.md:147`
(`identity.false_**merge**_count`), `design-agenda-full.md:90` (*"never **merged** into
it"*), `security-agenda-full.md:202` (*"either **merged** or deferred in writing"*),
`knowledge-documentation-agenda-full.md:77`. None is a unit-existence rule; all are task
rows. [[knowledge-documentation-charter]] measured the same effect independently and
scheduled the classification fix as KD-16 (`knowledge-documentation-agenda-full.md:105`) —
writing one agenda took its 2026-10-24 fired-event count from **3 to 13**.

**Why this is Red Team's problem and not only a tooling bug.** The real dated trigger in
the corpus is 2026-11-24, when seven units judge whether they should still exist —
**including this one** (`watch_loops.py:14-16`; [[red-team-charter]] §Entry and exit
triggers). That date now carries **35** line-hits, most of them prose. The one event that
was designed to be loud is being delivered inside noise it did not create.

**Earliest observable signal.** A watcher run whose *"must judge whether they should still
exist"* list names a unit whose charter contains no dated existence rule. True as of
2026-08-28, five times over.

**Counter-pressure, two halves.** KD-16 owns the classifier; duplicating it would be
[[red-team-premortem]] M4 in reverse. What this function owns is **its own emission**: no
future date shares a line with a trigger word in this directory *unless the date is
genuinely an existence rule*. This agenda keeps **exactly one** such line by design — the
2026-11-24 row in §Track 4 — so the watcher reports Red Team once, correctly. The rest of
the finding, that the 2026-11-24 signal is being drowned before it fires, goes out as
**F-W2**.

### W3 · Ambition outruns evidence past the §3.3 discipline — **LATENT, with the numbers stated honestly**

The temptation the founder's brief creates directly: *creative, innovative, ambitious*
against foundation README §3.3's *"cite a real past instance. No speculative skills"* and
§8.2.3's evidence rule. Measured over the 379 task-shaped rows in the 20 wave-3 agendas:

| Reading | Count | Share |
|---|---|---|
| Rows with **no evidence token of any kind** (no backtick, wikilink, OD or ADR id) | 15 | **4%** |
| Rows with **no strict `file:line` citation** | 238 | **63%** |

**The honest reading is the first number, not the second.** 4% is a corpus holding the
line, and a red team that led with 63% would be manufacturing an objection —
[[red-team-premortem]] M1, in this function's own first output. The method's limit is
stated with it: evidence often sits in a preceding paragraph or a separate column, and a
per-row regex cannot see it. So: **LATENT**, and it is not upgraded without a hand-audit.

**Earliest observable signal.** Not the citation rate. It is **circular evidence** — a
wave-3 task whose support is another wave-3 agenda written the same day. **15** rows
already reference a sibling agenda file inside a task row. A wave can bootstrap its own
justification in a single day, and the corpus would read as heavily cited while resting on
nothing outside itself.

**Counter-pressure.** The one this function can apply without touching another unit's
file: the **L-RT-4 premortem-vs-reality re-read** (quarterly, a sample) becomes an
agenda-vs-reality re-read for its first run, sampling wave-3 rows and asking only *did the
cited evidence exist outside this wave?* Scheduled as **RT-7**.

### W4 · The wave feeds the queue that eats the function — **LIVE**

[[red-team-premortem]] M4: the referral queue becomes the function. The wave moved M4's
denominator hard — C3 went from **82 lines / 67 units** to **436 / 99** — while the
numerator, findings filed, stayed at zero. `rt.self_selected_target_share` is still **0%**
and its floor is 60%.

Three wave-3 referrals arrived with dates attached, which is a unit setting this function's
calendar: `security-agenda-full.md:201` (hand over 40 verdicts, *"which is most likely
wrong"*), `skills-agenda-full.md:163` and `skills-agenda-board.md:81` (the zero-deletion
trip-wire escalates here). Both are legitimate C3 traffic and both enter the same scoring
funnel with no privileged lane ([[red-team-directive]] R2) — **neither is in cycle 1**, and
that is the rule working rather than a slight.

The fourth is different and is a finding: `compliance-privacy-agenda-full.md:411` asks
whether guest-data-use widenings should *route through* Red Team. They should not.
Ethics and agent-autonomy limits were considered and **not adopted** as advisory
(`0007-org-structure.md:40`); [[red-team-charter]] §Explicit non-goals places that scope in
the line, with [[compliance-privacy-charter]]. Answering the question by quietly accepting
the work would be scope drift arriving as a favour. Returned as **F-W4**.

**Earliest observable signal.** The one already visible: a cycle whose target list is
composed only of inbound items. Cycle 1 below is 5 self-selected of 7.

### W5 · The canvases are unreachable, and the precedent for that is already on disk — **LIVE**

Twenty agenda canvases were produced today. Each agent was told, correctly, not to edit
`sketches/MANIFEST.md`; the orchestrating session adds the rows. Measured now:

- **73** sketch directories, **43** MANIFEST rows, **30 directories with no row at all**.
- **20** of those 30 are wave-3 canvases (`053`–`072`).
- **10 are not**: `005`, `011`–`015`, `017`–`019`, `049`. Those pre-date this wave.

That last line is the finding. *"Someone adds the manifest row afterwards"* is not a risk —
it is a **procedure that has already failed ten times** in this repo, before anyone
depended on it. And `MANIFEST.md` carries `winner: null` in **28 of 43** rows: a sketch
whose design question was never answered is the resting state here, not the exception.
[[exploration-studio-charter]] calls the manifest *"the decision record"*, which is exactly
why an unindexed canvas is worse than no canvas.

**Earliest observable signal.** Available the moment the wave commits: `ls sketches/ | wc -l`
against the manifest row count. Any gap is the mechanism, and it needs no judgement to read.

**Counter-pressure.** Report the row in the final summary (every agent was asked to), and
file **F-W5** to the manifest's owner naming the ten prior orphans — because the fix that
matters is not this wave's twenty rows, it is that the gap is machine-checkable and nothing
checks it.

### W6 · The wave re-anchors the line-based citations pointing into it — **LIVE, and self-caused**

Not in the seed list; found by writing this file. ADR 0025 is locked on exactly this
mechanism (one inserted register row re-anchors every citation below it). A rewrite is the
same event, larger: **11 line-anchored citations from 9 files already point into documents
rewritten today**, and this rewrite adds at least one more —
`02-advisory/decision-office/FORK-REGISTRY.md:125` cites
`red-team-agenda-full.md:296-301` as the home of `RT-F1`…`RT-F6`. Those IDs are unchanged
and still live in one section below; the **line anchor** is now wrong.

**Earliest observable signal.** A `file.md:NN` citation whose target file has a later
`updated:` date than the citing file. Eleven such pairs exist today, and the check is
mechanical.

**Counter-pressure.** Section-anchored citation for cross-file references into agendas
(the IDs are stable; the lines are not), and the finding goes to the register's owner as
**F-W6** — deferred to cycle 2 by the cap, see below, rather than filed and forgotten.

### What this premortem cannot prevent

**It is a wave-3 document.** It shares every mechanism it names: it is dated 2026-08-28
and joins the second cliff (W1); it is prose in a directory the trigger regex reads (W2);
half its citations point at files written today (W3's circular-evidence signal); it names
a canvas that has no manifest row (W5). Naming that is not absolution. The disconfirming
observation is specific and dated: **if, at the 2026-10-27 cliff, this directory shows no
content diff since 2026-08-28, this premortem was decoration** — and the merge condition
in [[red-team-charter]] is the standing consequence, not a new one invented here.

### Seeds examined and rejected

| Candidate mechanism | Verdict |
|---|---|
| *"Wave-3 agendas will schedule other units' work"* | **REJECTED as stated.** Looked for it; the wave routes cross-unit needs to `questions.md` files as the brief requires. The attempted count of "rows owned by another unit" was **discarded, not published** — the task tables have different column orders and the measurement was reading doneability text as owners. A red team that ships a number from a broken script has no standing to grade anyone else's evidence. The real version of this mechanism is W4, which is measurable |
| *"Twenty-four agendas in one day is too much output to review"* | **REJECTED.** No observable was found that distinguishes it from W1 and W5, which are the same worry with instruments attached. An unfalsifiable mechanism is not a premortem entry ([[red-team-directive]], the `UNFALSIFIABLE` path) |
| *"The agendas will contradict each other"* | **NOT RUN — stated as a gap.** It needs a cross-agenda claim diff and `check_decision_claims.sh` covers the register, not agenda prose. Recorded here rather than asserted either way |

---

## Cap arithmetic — why this agenda is short

[[red-team-charter]] §The attack budget: **at most 7 open findings at any time**. This is
the first cycle in which the cap binds, so it is spent explicitly rather than discovered:

| Slot | Finding | Channel / override |
|---|---|---|
| 1 | **RT-1** — ADR 0039 verdict | C1 + O3 (founder-locked, mandatory) |
| 2 | **RT-2** — ADR 0037 verdict | C1 + O3 |
| 3 | **F-W1** — staleness fires as a mass event | C4 (from RT-0) |
| 4 | **F-W2** — dated-trigger noise drowns 2026-11-24 | C4 (from RT-0) |
| 5 | **F-W5** — canvas orphaning, ten prior instances | C4 (from RT-0) |
| 6 | **F-W4** — ethics scope is not ours | C3, answered rather than accepted |
| 7 | **RT-6** — O2 reserved slot, oldest unattacked fork | C2 + O2 |

Seven. **F-W6 and every wave-3 referral wait for a close** — including two that arrived
with dates on them. Deferring them is the scoring rule doing its job under a cap
([[red-team-premortem]] M1); doing them all would be the objection machine's first day.

---

## Track 1 — The two locks inside their 7-day window

O1: every decision reaching `Locked` is attacked within 7 days of the lock date. Four
locked on 2026-08-28 and three on 2026-08-27. Both rows below are **founder-locked**, which
satisfies O3 and is the point ([[red-team-directive]] R8).

| ID | Task | Returns to | Doneability | close_time | Evidence |
|---|---|---|---|---|---|
| **RT-1** | **Attack ADR 0039 — the plan of record that commissioned this page.** Reconstruct *what would have to be true* for "every department writes its own agenda, in one wave" to beat a staged wave, **before** opening the wave's output; then grade it against RT-0's six measurements | founder + [[decision-office-charter]] (review-trail row) | A verdict of *stands · stands-with-condition · weakened · broken* with the conditions written **before** the evidence was read, and a review-trail row on `0039-activation-plan-of-record.md`. A verdict of *stands* is only a close if the argument that failed is in that row ([[red-team-directive]] R6) | **2026-09-04** (7 days from the 2026-08-28 lock) | ADR 0039 §Decision and §Consequences — it names *"canvas sprawl risk"* and the staleness watcher as its own two risks; W5 and W1 measure both. `red-team-charter.md` O1 |
| **RT-2** | **Attack ADR 0037 — NF-B erasure is crypto-shredding.** This is founding target T1 arriving as a decision. The reconstruction to run blind: *for a locked design to be load-bearing while the thing it designs is HELD with zero callers, what must be true?* Then the key question — ADR 0037 needs keys that are **stored**, and the only key precedent in the tree is **derived** (`guest_pepper()` HMACs a per-restaurant key from one vault master secret, `supabase/migrations/20260819000000_guest_identity_minimal_slice.sql:338,405`), which cannot be destroyed per subject | [[compliance-privacy-charter]] + [[research-math-charter]] + founder | A verdict plus a review-trail row on `0037-…md`, and the finding states plainly whether a design locked ahead of activation binds an implementer or will simply be re-made at activation. **The mechanism half belongs to Compliance and is theirs** — this finding does not restate their task, it attacks the lock's reasoning | **2026-09-04** | `decisions/0037-nfb-erasure-is-crypto-shredding.md:1-30` (Locked 2026-08-28; *"NF-B itself stays HELD"*); ADR 0029 NF-B HELD; the derivation trap as found by [[compliance-privacy-charter]]'s canvas today; T1/RT-F1 in the superseded 2026-08-24 agenda |
| **RT-3** | **The backlog sweep, recorded as a backlog sweep.** 29 ADRs are Locked and 0 attacked; 22 are outside their window and cannot be un-missed. Sweep them for *decisions that changed shape after locking*, and publish `rt.locked_decision_challenge_rate` as **two numbers** — in-window and backlog — never as one percentage | [[decision-office-charter]] | A dated table: every Locked ADR with in-window / backlog / attacked. A single blended "100%" is a failed publication ([[red-team-loops]] L-RT-1) | **2026-09-18** | `decisions/` — 39 files, 29 Locked, measured 2026-08-28; L-RT-1 *"the first run of this loop is a backlog sweep rather than a live firing"* |

## Track 2 — Return RT-0's findings (the first real firing of L-RT-2)

Four findings, four owners, 72 hours each ([[red-team-loops]] L-RT-2). This is the first
time the return leg has anywhere to land: **100 `questions.md` files now exist.** Format
gate applies to every one — a named owner and **exactly one** next action, or it does not
leave this function ([[red-team-directive]] R4).

| ID | Finding | Returns to | Doneability | close_time | Evidence |
|---|---|---|---|---|---|
| **F-W1** | The 60-day rule fires as two mass events (2026-10-23, 2026-10-27) and cannot be defeated by content-free edits either. **One next action:** evaluate a per-unit check — *first promised `close_time` passed with no content diff* — which fires staggered and earlier | [[decision-office-charter]] (loop owner; `watch_loops.py:17`) | A dated row in `decision-office-questions.md` with the two cliff dates, the counterfactual table, and the single proposal. Accepted, or declined **in writing** — both close it | **2026-09-04** (72h from RT-0's verdict) | `watch_loops.py:12,34-35,87`; `--asof 2026-09-28` output; the 154/46 date split across 200 agenda files |
| **F-W2** | Dated-trigger events went **0 → 6** (18 unit-slots) in the 30-day horizon, all false, and the genuine 2026-11-24 signal now sits under 35 line-hits. **One next action:** until KD-16 lands, read the watcher's dated-trigger block as *unclassified*, and say so where the number is published | [[decision-office-charter]], with [[knowledge-documentation-charter]] named as the fix's owner so it is not double-assigned | A row in `decision-office-questions.md` carrying the counterfactual and naming KD-16 as the existing fix. **If it reads as a second copy of KD-16, it is rejected by this function before it ships** | **2026-09-04** | `watch_loops.py:98`; counterfactual scan; `knowledge-documentation-agenda-full.md:105`; `analytics-bi-agenda-full.md:126`; `engineering-agenda-full.md:147` |
| **F-W5** | 30 of 73 sketch directories have no manifest row, and **10 of them pre-date this wave** — the deferred-row procedure has already failed ten times. **One next action:** make the gap machine-checkable (directory count vs. row count), so it is a reading rather than a memory | [[exploration-studio-charter]] (owns `MANIFEST.md` as *"the decision record"*) | A row in `exploration-studio-questions.md` listing the ten pre-wave orphans by number, with the single proposal. Declining is a close | **2026-09-04** | `sketches/` — 73 dirs, 43 rows, 28 `winner: null`; `exploration-studio-charter.md:44` |
| **F-W4** | Guest-data-use widenings should **not** route through Red Team: ethics scope was considered and not adopted as advisory. **One next action:** name the owner of the ethics question inside the line, so the question stops being open by default | [[compliance-privacy-charter]] | A row in `compliance-privacy-questions.md` quoting `0007-org-structure.md:40` and [[red-team-charter]] §Explicit non-goals, and naming the boundary rather than negotiating it | **2026-09-04** | `compliance-privacy-agenda-full.md:411`; `0007-org-structure.md:40`; [[red-team-premortem]] M5 |

## Track 3 — The standing decision-attack program

Two decisions will be made in the next six weeks that this function exists for. Neither is
attacked here — both are **pre-registered**, which is the only way an attack on a
conclusion can be trusted after the conclusion arrives.

| ID | Task | Returns to | Doneability | close_time | Evidence |
|---|---|---|---|---|---|
| **RT-4** | **Pre-register the OD-03 premortem, before the run reports.** Write — and file — *what a wrong-but-convincing bake-off result looks like* **before** AIO-4 executes: which arm wins for a reason that is not the reason claimed, how OD-52's category error (a message bus scored against reasoning harnesses) survives inside a scoring rubric rather than being resolved by it, and what an unrunnable arm recorded as a low score would look like from outside. **[[architecture-review-charter]] owns the protocol pass (AIO-3) and this does not duplicate it** — that is a design review before the run; this is a premortem of the *resolution* | [[ai-orchestration-charter]] + [[decision-office-charter]] | A dated, timestamped premortem sitting in `ai-orchestration-questions.md` **before** the run starts, naming at least three failure shapes with an observable each. Filed after the result exists, it is worthless and this function should say so rather than file it | **2026-09-18** (AIO-4 runs 2026-09-25) | `ai-orchestration-agenda-full.md:63-67` (AIO-1…AIO-5, run 2026-09-25, resolving ADR 2026-10-02); `OPEN-DECISIONS.md:26` (OD-03), `:40` (OD-52) |
| **RT-5** | **The O1 attack on OD-03's resolving ADR**, inside 7 days of its lock, graded against RT-4's pre-registration: which predicted failure shape shows up, and does the ADR argue the rejected arms or merely list them | founder + [[decision-office-charter]] | A verdict and a review-trail row on the resolving ADR, plus a line stating which pre-registered shape occurred. **Reach item — contingent, see §Reach** | within **7 days of that ADR's lock** (expected on or about **2026-10-09**) | ADR 0039 Track A1 done-condition; `red-team-charter.md` O1 |
| **RT-6** | **O2 reserved slot — OD-04, the external model roster.** Oldest open fork never attacked (OD-03 is spoken for by RT-4). Attack the framing, not the roster: what has to be true for a model-roster decision to be separable from the harness decision underneath it | [[decision-office-charter]] + founder | A verdict in `decision-office-questions.md`. If the honest answer is *"this cannot be decided before OD-03"*, that **is** the finding and it closes the row for this cycle | **2026-09-25** | `OPEN-DECISIONS.md` OD-04, census re-measured 2026-08-26; [[red-team-charter]] O2 — *"an item nobody will attack is an item nobody will resolve"* |
| **RT-7** | **L-RT-4's first run, aimed at this wave.** Sample 20 wave-3 task rows and ask one question: *did the cited evidence exist outside this wave?* This is W3's disconfirming test, and it is deliberately a sample — 100 units cannot be re-read quarterly by anyone | each sampled unit's `questions.md`; the aggregate to the founder | A published sample with a per-row yes/no and the sampling rule stated in advance. A pass is as reportable as a fail — a clean sample closes W3 rather than leaving it open forever | **2026-10-16** | [[red-team-loops]] L-RT-4; foundation README §3.3; the 15 rows citing a sibling agenda, measured 2026-08-28 |
| **RT-8** | **The NF-B activation premortem — docs only, and the lock holds.** NF-B is HELD (ADR 0029) with zero callers; ADR 0037 designs its erasure. Premortem the **activation decision**, not the activation: what would have to be true for a design locked while HELD to still be correct when a caller exists, and what the first erasure request would find. Nothing here schedules activation, proposes unholding it, or assumes it | [[compliance-privacy-charter]] + [[research-math-charter]] + founder | A premortem with 3–5 mechanisms, each with an earliest observable signal and a counter-pressure, in `compliance-privacy-questions.md`. **A single sentence anywhere in it that reads as a plan to activate is a defect and the document is rewritten** | **2026-10-30** | ADR 0037 (*"activation, whenever it comes, does not improvise it"*); ADR 0029 NF-B HELD; ADR 0039 §8.2.4 locks re-confirmed 2026-08-28 |

## Track 4 — This function attacks itself

| ID | Task | Returns to | Doneability | close_time | Evidence |
|---|---|---|---|---|---|
| **RT-9** | **The first L-RT-3 undeclared-decision sweep**, now that a delivery target exists. Known seeds: the `OD-Cx` staging class (`FORK-REGISTRY.md` now maps the locally-minted namespaces — check whether that closed the class or only renamed it), and wave 3's own prose. Seeds are not the expected total | [[decision-office-charter]] | A list where every hit is registered **or** explicitly dismissed. A hit that is neither means the sweep did not run. `rt.undeclared_decision_count` gets a first real value | **2026-09-30** | [[red-team-loops]] L-RT-3; `02-advisory/decision-office/FORK-REGISTRY.md` (closes OD-30, OD-42) |
| **RT-10** | **RT-F6 — attack the 7-finding cap, now that it binds.** The charter asserts with zero evidence that a scored queue with a cap produces signal rather than noise. Cycle 1 spent all seven slots and deferred F-W6 plus two dated referrals; that deferral list is the first evidence the claim has ever had | founder ([[red-team-directive]] E5 — self-review is not review) | A verdict on the cap with the cycle-1 deferral list attached, and a number: is 7 right, or is the honest answer a different one? *"7 is fine"* with the deferral list beside it is an acceptable and recorded outcome | **2026-10-16** | [[red-team-premortem]] §The failure this premortem cannot prevent; §Cap arithmetic above |
| **RT-11** | **Pre-register this function's own 2026-11-24 self-judgment.** [[red-team-charter]]'s exit condition is evaluated at the second quarterly self-audit and its criteria — fewer than 6 findings, actionability below 80%, or a 100% reaffirmation rate — must be computable **before** the date, by someone who does not yet know the answer. Define the three numbers and where each is read from | founder + [[decision-office-charter]] | A one-page definition of the three readings and their sources, filed before 2026-10-31. Deciding the criteria on the day is deciding them with the result in hand, which is the same defect this function attacks elsewhere. *This row is the one line in this directory that deliberately trips the watcher's dated-trigger scan — the date is a genuine existence rule, see W2* | **2026-10-31** | [[red-team-charter]] §Entry and exit triggers; [[red-team-loops]] L-RT-5; `watch_loops.py:14-16` |

---

**The one line in this directory that the watcher's dated-trigger scan should read.** Red
Team's merge condition falls due 2026-11-24.

That sentence is the whole self-emission budget: one line, one date, one genuine
existence rule, so `watch_loops.py` names this unit exactly once and correctly. Every other
date in this directory sits on a line the trigger regex cannot reach, which took two edits
and two re-runs to achieve — the entire cost of the discipline **F-W2** asks of everyone
else. Verified 2026-08-28: one dated-trigger line in `02-advisory/red-team/`, and zero
red-team events inside the watcher's 30-day horizon.

## Reach items, graded

§8.2.6 asks for ambition and honest grading of it. Three rows are **reach**, and the grade
is stated on each rather than implied.

| Row | Grade | Why, and what it waits on |
|---|---|---|
| **RT-5** | **Aspiration pending a decision that has not been made.** It attacks an ADR that does not exist yet, and its close_time is expressed relative to a lock date that is itself contingent on AIO-4 running. `ai-orchestration-agenda-full.md:193-195` already flags that AIO-4 may slip. If it slips, RT-5 slips with it and **is not re-scoped into something easier** | Waits on: OD-03's resolving ADR |
| **RT-8** | **Reach.** Premortem of an activation nobody has scheduled, for a metric with zero callers. Justified because ADR 0037 exists precisely to be ready before the caller does; not justified if it drifts one sentence toward planning the activation | Waits on: nothing — but the lock does the constraining |
| **RT-7** | **Reach on method.** A sampled re-read is the first time L-RT-4 runs at all, and a bad sampling rule would produce a number that looks like a measurement. The rule is published before the sample for that reason | Waits on: nothing |

Everything in Tracks 1, 2 and 4 is **committed**: each has a named owner, a file that
exists today, and a doneability a stranger could grade.

## Forks staged here — `RT-F#`, explicitly not OD IDs

[[red-team-directive]] R7: locally staged forks carry a non-OD prefix and live in one
section. `02-advisory/decision-office/FORK-REGISTRY.md:125` maps this namespace and cites
this section by **line number** — that anchor is stale as of this rewrite (W6); the **IDs
below are unchanged**.

| ID | Proposed fork | State on 2026-08-28 |
|---|---|---|
| **RT-F1** | NF-B erasability vs. the append-only research store | **Answered by ADR 0037**, locked 2026-08-28. Struck as a fork; it is now RT-2's target |
| **RT-F2** | What number makes ADR 0007 falsifiable — at what count of stale units does the structure get trimmed | Open. W1's per-unit check would supply the *observation* this fork has always lacked |
| **RT-F3** | Symmetric trigger rule — a charter naming a split trigger names a companion condition in the same document | Open |
| **RT-F4** | Generate `decisions/README.md` rather than maintain it | Open; the index has moved since T6 was written and needs re-measuring before it is re-asserted |
| **RT-F5** | Locally staged forks carry a non-OD prefix and a single staging section | **Largely landed** — `FORK-REGISTRY.md` implements it and closes OD-30/OD-42. RT-9 checks whether the class closed or only got renamed |
| **RT-F6** | Is the 7-finding cap right | Open, and now testable — RT-10 |

## Locks this agenda respects

- **The pricing model stays deferred** and **brand/landing visuals stay held** (founder
  re-confirmed 2026-08-28, ADR 0039 §Track B). Nothing here touches either, and nothing
  here assumes an unlock.
- **NF-B stays HELD** (ADR 0029). RT-8 premortems the activation *decision* and is
  documentation only.
- **No open fork is resolved by this page.** OD-03, OD-04 and every `RT-F` row stay open;
  findings-only means this function cannot close them and does not pretend to.
- **No other unit's file is edited by this wave**, and no row here schedules another unit's
  work. Cross-unit needs are findings, addressed to that unit's `questions.md`.

## What this agenda deliberately does not do

- **No security testing.** M5's detector runs against this directory in
  [[red-team-agenda-board]] and is expected to stay empty. Code `path:line` appears above
  only as **evidence** — the subject of every row is a decision.
- **No second copy of KD-16, AIO-3, or Compliance's crypto-shredding mechanism work.**
  Where another unit already owns the fix, the finding names them and stops.
- **No estimate presented as a reading.** `rt.finding_return_hours` still has no
  instrument; `nf_a.doneability_verdict` has no basis for this task type. Both are stated
  as dependencies in [[red-team-agent-stack]] §5 and neither is reported as a number here.

## Questions for the founder

1. **Is this function permitted to attack decisions you personally locked?** RT-1 and RT-2
   both are, and [[red-team-directive]] R8 makes it mandatory. Unchanged from 2026-08-24
   and still unanswered — and it is now load-bearing rather than hypothetical, because the
   first two rows of this agenda are your two most recent locks.
2. **RT-F2, restated with an instrument.** W1 found the observation the fork was missing:
   a unit whose own first promised `close_time` passes with no content change. Does that
   count as the number that makes ADR 0007 falsifiable, or do you want a different one?
3. **The wave's canvases.** 30 of 73 sketch directories have no manifest row and ten of
   those failures pre-date this wave. Should the manifest gap be a machine check, or is an
   unindexed sketch acceptable by design?
4. **The 2026-11-24 self-judgment (RT-11).** Do you want the three criteria defined now,
   before anyone knows how this function performs, or defined on the day?
