---
type: agent-stack
division: corporate
department: knowledge-documentation
status: designed
updated: 2026-08-27
metrics: [corpus.duplicate_basename_count, corpus.ambiguous_duplicate_count, graph.frontmatter_coverage_pct, graph.link_resolution_rate, standards.stale_claim_rate, kd.docs_added_vs_retired_ratio]
links: ["[[knowledge-documentation-charter]]", "[[knowledge-documentation-schedule]]", "[[knowledge-documentation-loops]]", "[[knowledge-documentation-agenda-board]]", "[[0034-agent-stack-artifact]]", "[[0032-vault-cleanup-cut-line]]", "[[0025-citations-must-disagree-loudly]]", "[[skills-charter]]", "[[decision-office-charter]]"]
---

# Knowledge & Documentation — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This department's subject matter is this chapter, so this card is itself a row in the
> corpus it grades — there is no outside auditor ([[knowledge-documentation-charter]]
> §The unusual thing). The department agent therefore does **not** do team work: it keeps
> one honest ledger of what the three teams measure, and the one number nobody else owns.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `kd-ledger` | Publish the three team metric **sets** without ever summing them, and keep `kd.docs_added_vs_retired_ratio` true against what was actually added and actually retired | NEW |

One row deliberately. *Where it lives*, *can it be found*, and *is it still true* have three
team owners and three independent metrics; a department agent that answered any of them
would be the fourth answer to a question that already has one.

## 2. Agent cards

```yaml
agent: kd-ledger
unit: knowledge-documentation
triggers:
  - schedule: "weekly — three-number board (L-KD-2)"        # mirrored in [[knowledge-documentation-schedule]]
  - schedule: "monthly — retire-to-write ledger (L-KD-1)"   # same
  - topic: doc.retired                                       # publisher: NONE (gap — a retirement is an ADR table row today, not an event)
consumes:
  - the three team agenda-boards (Dataview output; the plugin is committed at `.planning/.obsidian/plugins/dataview`)
  - "[[0032-vault-cleanup-cut-line]] §Tombstone index — the retirement side of the ratio"
  - "`.planning/00-index/UNIT-MANIFEST.json` — the denominator of units that owe a board"
  - git history over `.planning/**/*.md` — the addition side of the ratio
emits:
  - "[[knowledge-documentation-agenda-board]] refresh — three metric SETS, never a sum (charter §Metrics)"
  - "correction handoffs aged past their close_time → [[decision-office-charter]] (L-KD-4)"
  - "`kd.docs_added_vs_retired_ratio` with both raw counts beside it, never the ratio alone"
routing_class: extraction        # reading boards, counting files, differencing a ledger
quality_bar: "no summed number ever — a duplicate and a stale claim are not commensurable (charter §Metrics); every row carries a value or the words 'not measured' (ADR 0020). NONE (gap) for a formal verdict basis: this department emits nothing to the NF-A spine and claiming otherwise is the defect [[standards-verification-charter]] exists to catch"
autonomy:
  read: autonomous
  propose: autonomous            # board edits and escalations land as PRs
  mutate_stock_money_outbound: confirm   # constant; this agent has no such surface
memory: knowledge-documentation
escalates_to: "[[decision-office-charter]]"   # corrections that age, and CORP-F6 (whether 2.3 belongs here at all) — raised, not resolved
```

**Open forks this card must not close:** OD-01's remaining tail, and **CORP-F6** — whether
[[standards-verification-charter]] can credibly grade its own department's artifacts
(`corporate.md:512-515`). The card is written so that moving that team out later changes
one `consumes` line, not the design.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `retire-to-write-ledger` | T2 | Monthly, and on any PR that deletes a `.md` | Emits added, retired, and the ratio as three numbers; every retirement matches a tombstone row with a recovery commit, or the run fails | ADR 0032's tombstone index was assembled by hand in one session (`0032-vault-cleanup-cut-line.md:66-101`, 2026-08-27) while the department metric stood at ∞ — 28 added, 0 retired (charter §Metrics) | NEW |
| `correction-handoff-age` | T2 | Weekly (L-KD-4), on anything this department raised against another unit | Every open correction carries an age and a named owner; anything past 30 days is filed to the Decision Office in the same run | The OD-21/OD-08 register contradiction was raised in this charter on 2026-08-24 and closed only when the register itself caught up — nothing watched the gap (`knowledge-documentation-charter.md:155-164`) | NEW |

Consumed, owned elsewhere: the census and placement skills ([[corpus-archive-schedule]]),
the graph skills ([[graph-retrieval-schedule]]), the verification skills
([[standards-verification-schedule]]); registry governance ([[skills-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates from consolidation go to
  [[skill-harvesting-charter]]'s queue and still face the §3.3 gate.
- **Episodic** — **none today, stated rather than assumed.** This department emits nothing
  to the NF-A spine (charter §Metrics). If it ever registers a task type
  (`kd_board_rollup`, `kd_retirement_ledger`), `scripts/check_task_types_are_graded.py`
  — CI at `.github/workflows/ci.yml:179` — requires a verdict basis better than
  `call_level_v0` or a named exemption. Until then the episodic layer is the git history of
  board refreshes plus ADR 0032's tombstone rows: both already durable, both already diffable.
- **Semantic** — `memory/` beside this file, `knowledge-documentation-MEMORY.md` as index.
  One fact per file with `source` (a PR, a dated measurement, an ADR row), `confidence`,
  `last_verified`. The first fact is already known: the charter says 1,118 `.md` and 28
  top-level; disk on 2026-08-27 says **1,090** and **6**. Every write is a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics. Team charters
  and the 07-reference corpus are retrieval targets by `path:line`, never preloaded
  (`CLAUDE.md` §2).

**Consolidation** — monthly, mirrored in [[knowledge-documentation-schedule]] (L-KD-1):
read the month's board refreshes and retirements; write one fact per durable finding,
failures first — a board number that moved without anyone re-deriving it becomes a fact
naming the mechanism ("hand-entered, never re-read"), not "the count changed"; expire facts
unverified for 90 days; emit skill candidates. One PR; "no delta" is stated, never silence.

## 5. Async contract

Cross-unit interaction is loops ([[knowledge-documentation-loops]]), vault PRs, and skill
candidates only — no NF-A path exists here yet. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `doc.retired` has no publisher | Retirement is an ADR table row (ADR 0032 §Tombstone index), not an event. The monthly ledger bounds the blind spot at one month |
| Board rows arrive as rendered Dataview, not as values | The plugin is committed, but nothing materialises the queries to text outside Obsidian — [[graph-retrieval-schedule]] owns that daily job and it is not built, so a headless run of this agent would read empty boards |
| Escalation to the Decision Office is a doc edit | Acceptable async path, but nothing notifies; their schedule must poll [[knowledge-documentation-agenda-full]] §Questions |

## 6. Evidence today

- **EXISTS — the substrate this agent would read.** 1,090 `.md` under `.planning/`, **6**
  top-level, measured 2026-08-27; `.planning/.obsidian/` committed with `dataview` and
  `templater-obsidian`; `.planning/00-index/` (HOME, ORG-MAP, LOOP-MAP, DECISION-INDEX,
  `UNIT-MANIFEST.json`); `.planning/05-library/` at 26 entries.
- **EXISTS — the retirement half of the department metric.** ADR 0032 locks delete +
  tombstone with a recovery commit per path; `md/` and `md_files/` are gone from the tree.
- **PARTIAL — the department's own numbers.** They exist as prose in the charter and were
  wrong within three days. Nothing re-derives them, which is precisely `kd-ledger`'s job.
- **NEW — the agent and both skills.** CORP-F7 has since closed the other way:
  `.claude/skills/` **now exists** with the §3.3 gate written into
  `.claude/skills/README.md:12-18`, and holds **zero committed skills**
  (`.agents/skills/railway-config/SKILL.md` is gitignored at `.gitignore:100`). The
  directory the 99 schedules asserted is real; nothing has been put in it.
