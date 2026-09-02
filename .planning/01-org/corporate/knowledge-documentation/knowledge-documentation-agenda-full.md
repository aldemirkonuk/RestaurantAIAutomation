---
type: agenda-full
division: corporate
department: knowledge-documentation
status: active
metrics: [corpus.duplicate_basename_count, graph.frontmatter_coverage_pct, graph.ambiguous_basename_count, standards.stale_claim_rate, standards.contract_self_compliance_pct, kd.docs_added_vs_retired_ratio]
updated: 2026-08-28
links: ["[[knowledge-documentation-charter]]", "[[knowledge-documentation-directive]]", "[[knowledge-documentation-premortem]]", "[[knowledge-documentation-agenda-board]]", "[[knowledge-documentation-loops]]", "[[knowledge-documentation-schedule]]", "[[knowledge-documentation-agent-stack]]", "[[knowledge-documentation-questions]]", "[[corpus-archive-agenda-full]]", "[[graph-retrieval-agenda-full]]", "[[standards-verification-agenda-full]]", "[[0039-activation-plan-of-record]]", "[[0038-cards-run-as-declared-scripts]]", "[[0032-vault-cleanup-cut-line]]", "[[decision-office-charter]]"]
---

# Knowledge & Documentation — Full Agenda

**Dated 2026-08-28.** Written under [ADR 0039](../../decisions/0039-activation-plan-of-record.md)
Track B. This replaces the 2026-08-24 forecast, which is superseded rather than amended:
its spine was OD-01, and OD-01 closed on 2026-08-27
([OD-01, `OPEN-DECISIONS.md:80`](../../decisions/OPEN-DECISIONS.md), ADR 0032).

## The one sentence

**This department can measure everything it adds and nothing it retires** — and it is
writing this agenda inside a wave that adds ~48 more documents. Every task below serves
one of two ends: closing the retirement half of the ledger, or keeping *this wave's own
growth* honest.

## What moved under this agenda since 2026-08-24

Verified on disk, 2026-08-28, before anything was scheduled — per the register-rot rule
(`CLAUDE.md` §0.1, and the standing "verify every OD before acting" memory).

| Then (2026-08-24 charter) | Now (measured 2026-08-28) | Consequence for this agenda |
|---|---|---|
| OD-01 open; restructure is the spine | **Resolved** by ADR 0032; vault 1,677 → 1,152 at cut, top level 35 → **6** | The old §Next-steps list is dead. Do not re-plan it |
| No `.obsidian/`; every board a dead query | `.planning/.obsidian/plugins/dataview` **committed** (7 plugins) | M2 did not close — it *moved*. See KD-11 |
| `.claude/skills/` does not exist (CORP-F7) | **Exists**, 4 committed skills, §3.3 gate at `.claude/skills/README.md:12-18` | CORP-F7 closed. None of the 4 are this department's. See KD-13 |
| `kd-ledger` is a designed card | **Runs** — `scripts/agents/run_card.py:314-330`, CI-smoked at `ci.yml:69` | The ledger has a body. It counts adds only. See KD-1 |
| `claim-auditor` is a designed card | **Runs** — `run_card.py:279-294`; 3/3 register guards PASS (`memory/…/2026-08-28-guard-run.md`) | Register scope works. Prose scope does not exist. See KD-8 |
| Corpus at 1,118 `.md` (charter §Metrics) | **1,198** `.md` under `.planning/`, 6 top-level | The charter number was wrong within 3 days and is wrong again. See KD-4 and F2 |

**The number that did not move: retirements measured by machine — still zero.** ADR 0032
retired ~525 + 108 files and every one of them lives in a hand-written markdown table
(`0032-vault-cleanup-cut-line.md` §Tombstone index). Nothing parses it.

---

## Track 1 — Automate the retire-to-write accounting

The §8.3 seed, and the department's only metric nobody else can own. `kd-ledger` already
measures the numerator; the denominator has no reader.

| ID | Task | Owner | Doneability | close_time | Evidence |
|---|---|---|---|---|---|
| **KD-1** | Teach `kd_ledger()` the retirement half: parse the ADR 0032 tombstone index (and any successor ADR's) into a cumulative retired count | department (`kd-ledger`) | `run_card.py --json` emits `added`, `retired`, and the ratio as **three** values; the run exits non-zero — never zero-as-unread — when the tombstone table cannot be parsed | 2026-09-11 | `run_card.py:314-330` emits `kd.planning_md_total`, `kd.top_level_md`, `kd.agent_stack_docs` — all additions. The card's own `emits` requires "`kd.docs_added_vs_retired_ratio` with both raw counts beside it, never the ratio alone" (`knowledge-documentation-agent-stack.md:46`); ADR 0020's unreadable≠zero rule |
| **KD-2** | Settle the ledger's **grain** — one period, named once | department | One grain appears in charter, `loops.md` L-KD-1, and the runner; the other two references are corrected in the same PR; a run prints `2026-Q3: +N / −M` | 2026-09-11 | Three grains exist today: "in the same change" (`knowledge-documentation-directive.md:61-63`), "per month" (`knowledge-documentation-charter.md:119-120`), "per quarter" (ADR 0039 §8.3 seed). A metric with three grains has none |
| **KD-3** | Publish the missing `doc.retired` event as a **guard**: a PR adding a `.md` under `.planning/` must carry a tombstone row or a named exemption | department + [[corpus-archive-charter]] | A synthetic PR adding one `.md` with neither exits 1; the guard exits **2** when it cannot read the tombstone index; proven against the pre-fix tree | 2026-09-25 | The card declares `topic: doc.retired — publisher: NONE (gap)` (`knowledge-documentation-agent-stack.md:104`). Premortem M3: "a rule with no mechanism is a rule that has already failed once here" (`knowledge-documentation-premortem.md:87-88`). Guard shape precedent: `ci.yml` "Decision register matches reality" |
| **KD-4** | **The growth-ratio board**: nothing on [[knowledge-documentation-agenda-board]] is hand-typed | department (`kd-ledger`) | Every counter carries a value **plus** the `path:line` or script that produced it, or the literal words "not measured"; a hand-entered number fails the board's own check | 2026-10-02 | The board's §Standing counters is headed "hand-entered until the jobs exist"; three of its numbers (1,118 total, 28 top-level, 38 duplicates) were already stale when written. Charter §Metrics forbids summing them; nothing forbids inventing them |

---

## Track 2 — Keep *this wave* honest

Wave 3 adds ~24 canvases + ~24 canvas READMEs and rewrites 48 agenda files. This
department is the only one chartered to say what that costs. All three tasks here are
measured against the wave, not forecast — and the measurement was taken **mid-wave**,
which is why the numbers below are a floor rather than a projection.

**The cost is already visible in three instruments.** Between the wave starting and this
paragraph: the staleness sweep went from one cliff to two (KD-5); `README.md` under
`.planning/` heads from 46 toward 70 (KD-6); and the loop watcher's fired-event count at
2026-10-24 went from **3 to 13**, six of them naming this unit, because agenda `close_time`
rows trip its retirement-trigger regex (KD-16). None of those three is a reason not to run
the wave. All three are reasons this department, not the wave, has to book the cost.

| ID | Task | Owner | Doneability | close_time | Evidence |
|---|---|---|---|---|---|
| **KD-5** | **Defuse the staleness cliff this wave splits in two.** Make the 60-day sweep per-unit and rolling instead of a date-group | department + [[standards-verification-charter]] | `python3 scripts/watch_loops.py --asof 2026-10-24` names the **units** whose agendas went stale, not a count; the files rewritten on 2026-08-28 do not register as a second cliff four days after the first | **2026-10-16** (deliberately before the fire date) | **Predicted, then verified the same day.** Before the wave: 200 agenda files, all `updated: 2026-08-24`; `watch_loops.py --asof 2026-10-24` printed one cliff — *"200 agendas share updated:2026-08-24 and go stale together"*. Mid-wave, re-run: **two** cliffs — **162 firing 2026-10-23** and **38 firing 2026-10-27** — and `stale_now` still 200. The cliff rule is `count >= 10` sharing one `updated:` value (`watch_loops.py:83-96`). The watcher's own docstring: *"A rule that condemns everything condemns nothing"* (`watch_loops.py:14`) |
| **KD-6** | **The 24 `README.md` this wave adds.** Settle the sketch-README naming rule and land `link-lint` | [[graph-retrieval-charter]] | `graph.ambiguous_basename_count` emitted from the CLI with no Obsidian running; a PR writing a bare `[[README]]` fails with **all** candidate paths printed | 2026-09-18 | Measured 2026-08-28: **46** files named `README.md` under `.planning/`, **41** of them in `sketches/`. Wave 3 takes that to **70** — a 52% rise in the exact metric premortem M5 names (`knowledge-documentation-premortem.md:116-136`), inside the wave that measures it. `engineering-charter.md:106` already writes an ambiguous `[[README]]` |
| **KD-7** | **Book the wave in the ledger.** Record wave 3's net document delta with both raw counts, and either name retirements or record an explicit ADR 0039 exemption | department (`kd-ledger`) | The 2026-Q3 ledger row states `+N / −M` for the wave and either lists retirement paths or says "exemption taken, ADR 0039" — **silence is a fail** | 2026-09-04 | The retire-to-write rule binds this department alone (`knowledge-documentation-directive.md:60-77`); this wave is the largest single addition since the founding 28 and the department is a participant in it, not an observer of it. Premortem M1 is exactly this shape |

---

## Track 3 — Verify it: from register scope to prose scope

`claim-auditor` runs and passes. What it passes is three *register* guards. The corpus is
prose, and `standards.stale_claim_rate` has never had a value.

| ID | Task | Owner | Doneability | close_time | Evidence |
|---|---|---|---|---|---|
| **KD-8** | **First value for `standards.stale_claim_rate`.** Weekly sample of N=30 numeric claims across the 6 top-level spine docs, each graded `verified` / `stale` / `unpinnable` with a `path:line` | [[standards-verification-charter]] | A rate is emitted **with its denominator and sampling frame**; the run refuses to emit a rate at all if any sample is unresolvable | 2026-09-25 | `run_card.py:279-294` wraps `check_decision_claims.sh`, `check_citation_pairing.py`, `build_agent_card_index.py --check` — all three PASS at register scope (`2026-08-28-guard-run.md`), and the team card grades itself *"PARTIAL — the method exists and runs at register scope; nothing applies it to prose"* (`standards-verification-agent-stack.md` §1). Premortem M4's earliest signal is **no value at 60 days**, i.e. **2026-10-23** |
| **KD-9** | **Pin the insight count.** One exact assertion; every quoting document corrected or tagged `UNPINNED` | [[standards-verification-charter]] | The number fails loudly on change; every in-corpus quote agrees or is tagged; the external-facing instance is **routed, not decided** here | 2026-10-09 | Quoted as **375**, **573**, **348** — the last one line after the first. The only assertion is `toBeGreaterThanOrEqual(200)` (`apps/api-gateway/src/analytics/insights/insight-catalog.spec.ts:10`), which all three pass. `YC_WEDGE_PLAN.md` carries one of them → directive escalation trigger 5 routes it to [[positioning-fundraise-readiness-charter]], not to us (`knowledge-documentation-directive.md:93-96`) |
| **KD-10** | **Contract self-compliance.** For every foundation document asserting a rule about frontmatter or filenames, evaluate that document against its own rule | [[standards-verification-charter]] + [[graph-retrieval-charter]] | `standards.contract_self_compliance_pct` has a value; both known cases either pass or the **contract is amended** — this loop amends contracts, it does not fix documents | 2026-10-23 | Baseline **0 of 2** (`knowledge-documentation-loops.md:98-99`): `ORG_STRUCTURE` §5 mandates frontmatter and carries none; `OBSIDIAN_VAULT` §3 mandates unique filenames against 46 `README.md`. Directive escalation trigger 4 routes a convention false-at-birth to [[red-team-charter]] as a decision defect |

---

## Track 4 — Find it and place it: make the mechanism headless

Every board query in this org renders in one person's Obsidian and in no agent's context.

| ID | Task | Owner | Doneability | close_time | Evidence |
|---|---|---|---|---|---|
| **KD-11** | **Materialize the boards.** A generator writes a `<!-- generated … -->` rows block under each `dataview` fence, with a run date | [[graph-retrieval-charter]] | Every `agenda-board.md` carries rows readable by `grep`; a `--check` mode fails when a committed block is stale; nothing requires Obsidian to be running | 2026-10-09 | The card's own gap row: *"the plugin is committed, but nothing materialises the queries to text outside Obsidian … a headless run of this agent would read empty boards"* (`knowledge-documentation-agent-stack.md:105`). Premortem M2 was written as "Dataview never got installed"; installing it did not close the failure, it relocated it |
| **KD-12** | `graph.frontmatter_coverage_pct` and `graph.link_resolution_rate` get CLI values, **split new-vs-legacy** | [[graph-retrieval-charter]] | Both values print from the CLI; the new-corpus and legacy-corpus numerators are separate, so org-generation docs cannot mask the old tree | 2026-09-18 | `graph-retrieval-agent-stack.md` §3 `graph-metrics`: every board number is hand-entered and the denominator has already moved. `graph.link_resolution_rate` is recorded as *unmeasurable* in the charter and the vault it needed now exists |
| **KD-13** | Land `corpus-census` in `.claude/skills/` through the §3.3 gate | [[corpus-archive-charter]] | Skill committed and gate-compliant; wraps a script emitting all four `corpus.*`; exits non-zero on any unreadable count; a past instance is cited, not invented | 2026-09-18 | Registry holds **4** skills (`fleet-census`, `harness-contract-audit`, `model-pin-census`, `registry-index-refresh`) and none is this department's. The past instance is now overwhelming: the charter's totals were re-derived by hand, went stale in 3 days, and are stale again today (1,118 → 1,090 → **1,198**) |
| **KD-14** | Ship the **placement guard** — `check_no_new_toplevel_planning_docs.sh` | [[corpus-archive-charter]] | A PR adding a `.planning/*.md` fails CI; the guard exits **2** when it cannot enumerate the directory | 2026-09-11 | Top level went 35 → 30 → **6** under ADR 0032, entirely by hand. `corpus-archive-agent-stack.md` §3: *"ADR 0032 brought it to 6; nothing stops the 7th."* Premortem M3 is the whole mechanism |
| **KD-15** | **Close DO-5**, which its own subject has already answered | [[corpus-archive-charter]] | DO-5 moves to Answered with the ADR 0032 tombstone row as the outcome; `open_questions` frontmatter updated in the same change | 2026-09-04 | `corpus-archive-questions.md:22` still lists DO-5 **Open** with an age-out of **2026-10-05**, against `md/DOCUMENTATION_INDEX.md` — a file ADR 0032 deleted on 2026-08-27. A findings register that outlives its subject is the failure this department exists to catch, and it is ours |
| **KD-16** | **Watcher precision.** Distinguish an *age-out or close_time date* from a *unit-existence trigger* | department + [[decision-office-charter]] | `watch_loops.py --asof 2026-10-24` classifies each dated event by **where** the date sits; the false unit-dissolution events are gone or reclassified; a `--self-test` fixture pins both classes and fails if either regresses | 2026-10-16 | **Self-demonstrated, measured today.** `watch_loops.py` matches `retire\|merge\|fold\|sunset…` anywhere on a line carrying a future date (`trigger_words`, ~:97-99). Two effects, both real: (a) it reports *"corpus-archive must judge whether it should still exist"* on 2026-10-05 — actually DO-5's age-out (`corpus-archive-questions.md:22`), whose subject file ADR 0032 deleted; (b) **writing this agenda took the 2026-10-24 fired-event count from 3 to 13**, of which **6** name this unit, purely because its `close_time` rows sit on lines containing the word "retire". A wave of ~24 such agendas makes the watcher unreadable, and the real 2026-11-24 triggers then pass silently inside the noise |

---

## Reach — graded, per §8.2.6

Ambition is the point; grading it is the honesty tax.

| ID | Reach | Grade |
|---|---|---|
| **R1** | **`corpus.json` — the corpus as one generated, queryable object** (files, frontmatter, links, numeric claims, tombstones), which every KD metric reads instead of walking the tree three times | **Aspiration pending KD-11/12/13.** The *shape* is not speculative — `cards.json`, `loops.json` and `00-index/atlas-graph.json` are three working precedents of exactly this pattern with `--check` gates. The *timing* is: an index over three producers that do not exist yet is a schema, not a mechanism. Propose the schema by 2026-10-30; build unscheduled |
| **R2** | **Retire-to-write becomes org-wide** (CORP-F8) | **Aspiration pending the founder.** The department's 2026-08-24 recommendation was department-only *until it could hold the rule itself*. The honest update: it has not held it. `.planning/` went 1,090 → 1,198 in one day with 0 machine-visible retirements. That is an argument against extending the rule and an argument for it, and the founder decides — see §Questions |
| **R3** | **A provenance-graded corpus** — every numeric claim in the spine carries a machine-checkable source, and `standards.stale_claim_rate` becomes a coverage number rather than a sample | **Aspiration.** KD-8 and KD-9 are the first two rungs of a long ladder; nothing beyond them is scheduled and nothing beyond them should be believed yet |

---

## Findings — recorded, not scheduled

Per §8.1: a task no card or loop can carry is a finding, not a task.

- **F1 — merge-conflict markers on disk in the retirement record.** Measured 2026-08-28 in
  the wave-3 worktree: `.planning/decisions/0032-vault-cleanup-cut-line.md` carries four
  nested `<<<<<<< HEAD` blocks across its §Tombstone index (lines ~81-95), and
  `.planning/07-reference/INDEX.md` carries three more. The tombstone index is the **only**
  record of what this org has retired, and in that tree it is unparseable — which is
  precisely what KD-1 must read. `check_citation_pairing.py --fix` is documented as
  refusing on a tree with conflict markers, but nothing **reports** them; no card claims
  "the tree is conflict-free". Route: [[standards-verification-charter]]'s questions file.
  **Stated honestly:** a worktree can hold conflicts that `main` does not — verify against
  `origin/main` before filing this as a corpus defect. Either way the durable half stands:
  the retirement ledger is a hand-maintained markdown table with no parser and no guard.
- **F2 — this department's own numbers move faster than its fastest loop.** 1,118
  (charter, 2026-08-24) → 1,090 (census, 2026-08-27) → **1,198** (disk, 2026-08-28). L-KD-2
  closes weekly. No cadence fixes a number that moves daily; only KD-4 does, by making the
  board incapable of holding a hand-typed value. Recorded so the temptation to "run the
  board more often" is refused in writing.
- **F3 — 5 loops running of 485** (`watch_loops.py`, 2026-08-28). All four KD loops are
  `proposed`. This agenda gives mechanisms to **L-KD-1** (KD-1/2/3) and **L-KD-2** (KD-4)
  only. **L-KD-3** and **L-KD-4** stay proposed, on purpose, and are named here so the gap
  is not silent — L-KD-3 gets its first measurement through KD-10, and L-KD-4 has no
  scheduled mechanism at all this quarter.

---

## Questions for the founder

1. **CORP-F8 — is retire-to-write org-wide, or department-only?** Department-only caps the
   auditor; org-wide caps 1,198 documents. The department's own record (R2) argues both
   ways and it cannot grade itself here.
2. **The ledger's grain (KD-2).** Per-change (the directive), per-month (the charter), or
   per-quarter (ADR 0039's seed)? One answer, and the other two get corrected.
3. **Does wave 3 take an exemption?** ~48 files land under ADR 0039 against a rule that
   says an addition names a retirement. Exemption granted by the ADR, or retirements owed
   (KD-7)? Recorded either way; the failure is booking it as neither.
4. **CORP-F6 — does [[standards-verification-charter]] belong to this department or to
   [[decision-office-charter]]?** Unchanged since 2026-08-24 and still un-self-answerable:
   a team inside this department is now grading a wave this department participated in.
5. **Sketch README naming (KD-6).** Keep `README.md` per sketch and fix `[[README]]` with
   link-lint, or rename to `<slug>-README.md` and pay a 41-file rename once? This is a
   *placement* decision ([[corpus-archive-charter]]) with a *graph* consequence
   ([[graph-retrieval-charter]]) — it needs one owner, not two.

## Locks this agenda respects

Nothing here touches the **deferred pricing model** or the **held brand/landing visuals**
(ADR 0039 §8.2.4, founder re-confirmed 2026-08-28). One adjacency, stated so it cannot be
mistaken for a breach: `brand-drift-scan` counts legacy branding **in documents**, which is
this department's; branding in **product surfaces** is [[media-brand-charter]]'s, and no
visual work is scheduled by, or implied by, this agenda.

## Superseded

The 2026-08-24 agenda's ten-step list is retired into this document. Steps 1 (commit
`.obsidian/`), 3 and 4 (the `md/`↔`md_files/` duplicates), 8 (placement rule — partly),
9 (OD-22 library, now `05-library/` at 26 entries) and 10 (OD-14) were executed or closed
under ADR 0032 and the wave-2 build; the rest are carried above with dates and evidence
they did not have. CORP-F7 is closed: `.claude/skills/` exists.
