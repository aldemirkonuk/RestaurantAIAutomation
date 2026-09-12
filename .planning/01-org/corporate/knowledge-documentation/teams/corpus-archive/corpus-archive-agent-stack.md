---
type: agent-stack
division: corporate
department: knowledge-documentation
team: corpus-archive
status: designed
updated: 2026-08-27
metrics: [corpus.duplicate_basename_count, corpus.ambiguous_duplicate_count, corpus.top_level_planning_docs, corpus.orphan_doc_count]
links: ["[[corpus-archive-charter]]", "[[corpus-archive-schedule]]", "[[corpus-archive-loops]]", "[[corpus-archive-directive]]", "[[0034-agent-stack-artifact]]", "[[0032-vault-cleanup-cut-line]]", "[[knowledge-documentation-agent-stack]]", "[[graph-retrieval-charter]]"]
---

# Corpus & Archive — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This team's mandate includes deletion, which makes its card the most constrained in the
> department: **the agent counts and proposes; it never removes a file.** Under
> [[0032-vault-cleanup-cut-line]] a retirement is a PR carrying a tombstone row and a
> recovery commit, and under [[corpus-archive-directive]] gitignored content is archived
> rather than deleted, because git is not an undo there.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `corpus-warden` | Re-derive the four `corpus.*` counts from disk every day so no board number survives on prose alone, and stage every retirement as a tombstoned PR | NEW |

## 2. Agent cards

```yaml
agent: corpus-warden
unit: corpus-archive
triggers:
  - schedule: "daily — corpus census"                        # mirrored in [[corpus-archive-schedule]]
  - schedule: "weekly — duplicate burn-down + placement drift (L-CA-1, L-CA-2)"
  - schedule: "quarterly — OD-01 deferral check"
  - topic: doc.moved                                          # publisher: NONE (gap — a relocation is seen only by PR review; the move-integrity check is unbuilt)
consumes:
  - "`.planning/**/*.md` on disk — 1,090 files, 6 at top level (measured 2026-08-27)"
  - "`git check-ignore` output — the residue that review never sees ([[corpus-archive-charter]] §Evidence)"
  - "[[0032-vault-cleanup-cut-line]] §Tombstone index — which paths were retired, and at which commit"
  - "rename requests from [[graph-retrieval-charter]] (L-GR-2 outputs_to corpus-archive)"
emits:
  - "the four `corpus.*` values to [[corpus-archive-agenda-board]] and the department rollup ([[knowledge-documentation-agent-stack|kd-ledger]])"
  - "retirement proposals as PRs, each carrying a tombstone row and a recovery commit (ADR 0032)"
  - "one escalation per diverged pair, diff attached, to `OPEN-DECISIONS.md` ([[corpus-archive-directive]])"
routing_class: mechanical      # cmp, find, check-ignore, counting — the directive makes byte-identical a script's call and everything else a human's
quality_bar: "the census is reproducible: a rerun on the same commit yields the same four counts, and any count it cannot read is emitted as unreadable rather than as zero (ADR 0020). `corpus.ambiguous_duplicate_count` may not fall without a recorded per-pair decision ([[corpus-archive-directive]] rule 1). NONE (gap) for a formal verdict basis — this department emits nothing to the NF-A spine"
autonomy:
  read: autonomous
  propose: autonomous          # censuses, escalations, and retirement PRs
  mutate_stock_money_outbound: confirm   # constant
memory: corpus-archive
escalates_to: "[[knowledge-documentation-charter]]"   # diverged pairs and OD-01's target shape go on to the founder via OPEN-DECISIONS
```

**The card's own hard rule:** `corpus-warden` never deletes and never renames. Deletion is
a tombstoned PR a human merges; renaming is a request to nobody-but-itself only in
appearance — filename uniqueness is [[graph-retrieval-charter]]'s constraint and the path
is this team's, so a rename crosses a seam and travels as a request. An agent that picks
the newest mtime as a tiebreak is [[corpus-archive-premortem]] M2 in one line of code.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `corpus-census` | T2 | Daily, and before any dedupe or retirement PR | Emits all four `corpus.*` values; exits non-zero if any is unreadable | The 38/35/3 split was re-derived by hand for the charter (`corpus-archive-charter.md:84-90`), and the charter's own totals went stale in three days — it says 1,118 `.md` and 28 top-level; disk on 2026-08-27 says 1,090 and 6 | NEW |
| `doc-placement-check` | T2 | Any PR touching `.planning/**` | Fails on a new top-level `.md`; passes with a named subdirectory | `.planning/` reached 28 top-level docs (~1.2 MB) despite `CLAUDE.md` §3 (`corpus-archive-schedule.md:46`). ADR 0032 brought it to 6; nothing stops the 7th | NEW |
| `dedupe-safe` | T2 | Manual, over any candidate duplicate set | Deletes **only** `cmp`-identical pairs, as a PR with a tombstone row; refuses on any diff and prints it | Three diverged pairs sat inside a 38-pair set that looked uniformly deletable, and one (`README.md`) was not a duplicate at all — different categories, same basename (`corpus-archive-charter.md:86-90`) | NEW |
| `library-entry` | T2 | Adding an OD-22 resource to `.planning/05-library/` | Entry carries `category`, `url`, `status`, `verified`, and a decision link where adoption is a real fork | The library shipped and the shape held by hand: `05-library/anydoc.md:6-8` carries `status: candidate`, `decision: OD-06`, `verified: 2026-08-24` across 26 entries — one unguarded hand is what keeps entry 27 honest | NEW |

Consumed, owned elsewhere: link resolution and ambiguity ([[graph-retrieval-schedule]]),
entry freshness ([[standards-verification-schedule]]), registry governance
([[skills-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue,
  still through the §3.3 gate now written at `.claude/skills/README.md:12-18`.
- **Episodic** — **no NF-A path today**, stated rather than assumed: this department emits
  nothing to the spine (department charter §Metrics), and a new task type
  (`corpus_census`) would immediately face `scripts/check_task_types_are_graded.py`
  (`.github/workflows/ci.yml:179`) demanding a verdict basis or a named exemption. Until
  then the episodic layer is the daily census output series plus ADR 0032's tombstone rows.
- **Semantic** — `memory/` beside this file, `corpus-archive-MEMORY.md` as index. The
  founding facts are already known and would be its first files: the three diverged pairs
  and why each is hard (source: charter §Evidence, 2026-08-24); the delete-plus-tombstone
  rule and its recovery-commit form (source: ADR 0032, 2026-08-27); the gitignored-is-
  archived exception (source: [[corpus-archive-directive]] rule 2). Provenance frontmatter
  per ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate, and the directive's decision
  graph. Large planning documents are grep targets, never preloaded (`CLAUDE.md` §2).

**Consolidation** — monthly: diff today's census against last month's facts; a count that
moved without a recorded decision becomes a fact naming the mechanism, not the delta;
a retirement whose tombstone row is missing a recovery commit is a red finding and goes
first; expire facts unverified for 90 days; propose skill candidates. One PR; "no delta"
stated when true.

## 5. Async contract

Cross-unit interaction is loops ([[corpus-archive-loops]]), vault PRs, and escalations to
`OPEN-DECISIONS.md`. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `doc.moved` / `doc.added` have no publisher | Nothing emits on a create or a relocate; the daily census bounds the blind spot at 24 hours, and the per-PR move-integrity check that would close it is unbuilt |
| `corpus.orphan_doc_count` has a named publisher that does not publish | It depends on [[graph-retrieval-charter]] shipping link resolution first — the charter states the dependency rather than papering over it, and until then this metric is emitted as "not measurable", never as 0 |
| Rename requests arrive as prose, not events | L-GR-2 lists `outputs_to: corpus-archive`, but the transport is a vault PR nobody is notified of; the weekly placement-drift job is the poll |

## 6. Evidence today

- **EXISTS — most of what this agent was chartered to fix, already executed by hand.**
  ADR 0032 deleted `md/` and `md_files/` outright (both absent from the tree on 2026-08-27),
  took `.planning/*.md` from 28 to **6**, and built the tombstone index that makes each
  deletion recoverable (`0032-vault-cleanup-cut-line.md:66-101`). `.planning/05-library/`
  exists at 26 entries.
- **PARTIAL — the counting.** Every number on [[corpus-archive-agenda-board]] is still
  hand-entered from a one-off pass ([[corpus-archive-schedule]] §Recurring work), and the
  charter's own figures were already wrong three days after it was written. Nothing daily
  runs.
- **NEW — the agent and all four skills.** `.claude/skills/` now exists
  (`.claude/skills/README.md`) and holds zero committed skills.
