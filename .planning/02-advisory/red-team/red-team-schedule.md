---
type: schedule
division: advisory
department: red-team
status: provisional
metrics: [rt.finding_return_hours, rt.locked_decision_challenge_rate, rt.reaffirmation_rate, rt.finding_actionability, rt.undeclared_decision_count, rt.self_selected_target_share]
updated: 2026-08-24
links: ["[[red-team-charter]]", "[[red-team-premortem]]", "[[red-team-directive]]", "[[red-team-loops]]", "[[red-team-agenda-board]]", "[[red-team-agenda-full]]", "[[decision-office-charter]]", "[[architecture-review-charter]]", "[[security-charter]]", "[[skills-charter]]", "[[README|foundation-README]]", "[[ORG_STRUCTURE]]"]
---

# Red Team — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| **Per lock** | **New-lock attack** — any `decisions/NNNN-*.md` reaching `Locked` is attacked inside **7 days of the lock date** (L-RT-1) | Verdict + a review-trail row on the target ADR; `rt.locked_decision_challenge_rate` |
| **Per finding** | **Return leg** — verdict → owner's `questions.md` within **72h** (L-RT-2) | `rt.finding_return_hours`, `rt.finding_actionability` |
| **Per finding** | **Format gate** — named owner + exactly one next action, or the finding is rejected inside this function ([[red-team-directive]] R4) | Rejected-finding count (an internal number, deliberately not published as a virtue) |
| Weekly | **Target selection** — score the four channels, fill O1/O2/O3 reserved slots first, respect the 7-finding cap | The cycle's target list; `rt.self_selected_target_share` |
| Weekly | **Cap check** — open findings ≤ 7. Over the cap, selection does not run | Hold notice in [[red-team-agenda-board]] |
| **Monthly** | **Undeclared-decision sweep** (L-RT-3) — decision-shaped prose with no ADR/OD id; locally staged fork IDs that never reached the register | `rt.undeclared_decision_count`; registration requests to [[decision-office-charter]] |
| Monthly | **Aged-finding check** — median `rt.open_finding_age_days`; anything at 30 days converts (L-RT-6) | `OPEN-DECISIONS.md` rows via [[decision-office-charter]] |
| Quarterly | **Premortem-vs-reality re-read** (L-RT-4) — a *sample*, not a sweep | Findings on premortems whose signals were never looked at |
| Quarterly | **Self-audit** (L-RT-5) — `rt.reaffirmation_rate` × `rt.finding_actionability` reported as a pair, to the **founder**, not to Red Team | Politeness/noise reading; keep-or-fold recommendation at the second run |
| Quarterly | **Staleness sweep** of this directory — 60 days untouched is finished or fiction. **Date-only diffs count as untouched** (`git log --stat`) | Archive, rewrite, or trigger the merge condition |

**Cadences deliberately absent.**

- **No daily job.** Nothing here has a daily failure mode. A daily decision-review would
  produce nothing in three runs and be deleted by the org's own anti-sprawl rule
  (foundation README §6) — after having trained everyone to ignore it first.
- **No weekly sweep of the full corpus.** 536 documents and rising; a weekly full sweep is
  unrunnable and would quietly become a partial sweep that reports as a full one. Monthly,
  scoped, and honest about being scoped.
- **No standing "review every PR" job.** That is [[architecture-review-charter]] and
  [[security-charter]] territory, and taking it would be [[red-team-premortem]] M5.

**Anti-sprawl, applied to this table.** A scheduled job producing no action for **3
consecutive runs** is downgraded or deleted (foundation README §6). Two entries are already
at risk and are named rather than hidden:

- The **weekly cap check** produces nothing while there are fewer than 7 open findings —
  which is every week until the function is busy. It should be folded into target selection
  rather than listed separately once that is observed.
- The **monthly undeclared-decision sweep** has ≥9 known seeds today (`OD-C1`–`OD-C8`, plus
  the unregistered NF-B erasure question). If runs 2 and 3 surface nothing new, the sweep
  becomes quarterly rather than being kept as decoration.

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion.

**Two honest statements before the table.**

1. **The repo has zero committed skills.** `.claude/skills/` contains exactly one tracked
   file — `README.md`. `git ls-files` returns **no** `SKILL.md` anywhere; the only one on
   disk is `.agents/skills/railway-config/SKILL.md`, which is gitignored at
   `.gitignore:100` as CLI-installed vendor tooling (foundation README §3.1). Everything
   below is a **name**, not an asset.
2. **Every skill this function proposes is a *reader* or a *checker*. None generates a
   finding.** This is a structural choice, not a caution. A skill that drafts objections is
   an objection machine with a cron entry — [[red-team-premortem]] M1 with tooling — and
   the judgement in the reconstruction step ([[red-team-directive]] phase 2) is precisely
   the part that must not be automated, because it is the part the function exists for.
   Skills find *targets* and check *format*; a human or a reasoning agent runs the attack.

| Proposed skill | Shape | Fires on | Why it is not a generator |
|---|---|---|---|
| `undeclared-decision-sweep` | **Reader** — surfaces decision-shaped prose with no ADR/OD id, and local fork IDs absent from the register | Monthly (L-RT-3) | Finds candidates. Deciding whether a paragraph *is* a decision is the judgement call |
| `decision-index-reconcile` | **Checker** — diffs `decisions/README.md` against `OPEN-DECISIONS.md` and the ADR files | Monthly; any ADR change | T6 exists because nothing does this. Pure arithmetic, safe to automate |
| `finding-format-gate` | **Checker** — rejects any finding lacking a named owner or carrying ≠1 next action | Per finding | Enforces [[red-team-directive]] R4. It refuses; it never writes |
| `finding-return-clock` | **Recorder** — timestamps verdict → `questions.md` delivery | Per finding | `rt.finding_return_hours`. Measuring the leg we control |
| `assumption-extract` | **Reader** — pulls the *what-would-have-to-be-true* candidates from a decision document | Per attack, **before** the evidence is opened | Produces a list to interrogate. If it ever ranks or judges them, it has become the attacker and must be cut |
| `premortem-signal-check` | **Checker** — for each premortem mechanism, is the named earliest-observable signal actually measurable today? | Quarterly (L-RT-4) | The most mechanical part of premortem review, and the part most likely to be skipped |
| `split-merge-trigger-audit` | **Checker** — charters naming a split trigger without a merge or retirement trigger | Quarterly | Makes RT-F3 enforceable if adopted. Currently **15 vs 3** |
| `ratchet-metric-pair` | **Recorder** — emits `rt.reaffirmation_rate` beside `rt.finding_actionability`, never separately | Quarterly (L-RT-5) | Reporting one without the other is the lie [[red-team-premortem]] M2 tells |

**Skill-creation protocol** (foundation README §3.3) — every one of the above must, before
being committed: name its trigger, name its doneability criteria (feeds NF-A), **cite a
real past instance where it would have helped**, and declare its owner. Three already
have that citation and three do not:

| Skill | Real past instance |
|---|---|
| `undeclared-decision-sweep` | `OD-C1`–`OD-C8` staged in Corporate documents, none in the register; `OD-C5` cited 38× |
| `decision-index-reconcile` | `decisions/README.md:45` says *"8 items"* against 23; `:29` says *"5 divisions, 20 departments"* against ADR 0007's 6 / 19 |
| `split-merge-trigger-audit` | OD-26 measured 11 split / 3 merge; a re-measurement hours later read **15 / 3** |
| `finding-format-gate`, `finding-return-clock`, `assumption-extract`, `premortem-signal-check`, `ratchet-metric-pair` | **None.** No finding has ever been filed. These four fail §3.3 today and must not be built until the function has run at least one real attack cycle |

That last row is the protocol working. Five of eight proposed skills are **not yet
buildable** by the org's own rule, and the honest thing is to say so rather than to
manufacture a justification.

## Dependencies this function does not own

| Dependency | Owner | State |
|---|---|---|
| `questions.md` as a real file convention | [[ORG_STRUCTURE]] §3 defines it; every unit instantiates its own | **Zero exist.** The first finding creates the first one |
| The open-fork register and its IDs | [[decision-office-charter]] | Exists; drifting (T6) |
| Loop close-time tracking across the org | [[decision-office-charter]] | Proposed |
| NF-A emission for `nf_a.doneability_verdict` | [[neural-footprint-instrumentation-charter]] | *Corrected 2026-08-25:* emission shipped in P1; the open dependency is now **verdict coverage** for this task type ([[0017-doneability-verdicts-are-sidecar-claims]]) |
| `.claude/skills/` as a working skill layer | [[skills-charter]] | One `README.md`. See OD-24 and [[red-team-agenda-full]] T5 |
