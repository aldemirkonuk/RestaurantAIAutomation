---
type: schedule
division: corporate
department: knowledge-documentation
team: corpus-archive
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[corpus-archive-charter]]", "[[corpus-archive-loops]]", "[[corpus-archive-agenda-board]]", "[[knowledge-documentation-schedule]]", "[[graph-retrieval-schedule]]", "[[skills-charter]]"]
---

# Corpus & Archive — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Per PR | **Placement guard** — `scripts/check_no_new_toplevel_planning_docs.sh`; fails any PR adding a `.planning/*.md` at top level ([`CLAUDE.md`](../../../../../CLAUDE.md) §3) | Pass/fail; `corpus.top_level_planning_docs` |
| Per PR | **Move-integrity check** — any PR relocating a `.md` must rewrite inbound relative references in the same diff | Count of orphaned relative links introduced |
| Daily | **Corpus census** — `.md` counts per tree; `md/` ∩ `md_files/` basenames; `cmp` over the intersection | `corpus.duplicate_basename_count`, `corpus.ambiguous_duplicate_count`, `corpus.bytes_duplicated` |
| Weekly | **Duplicate burn-down** — L-CA-1 | Two numbers; commit-shape check |
| Weekly | **Placement drift** — L-CA-2 | New docs created outside the placement rule, by unit |
| Monthly | **Archive integrity** — L-CA-3 | Archived docs missing `superseded_by`; manifest gaps |
| Monthly | **Untracked-residue sweep** — what is on disk, gitignored, and larger than 1 MB | Report only; deletion requires the [[corpus-archive-directive]] gate |
| Quarterly | **OD-01 deferral check** — has "for now" ([[OBSIDIAN_VAULT]] §5 F2) passed 90 days without a target shape? | Escalation to the founder |

**The daily census is the load-bearing job.** Every number in
[[corpus-archive-agenda-board]] is currently hand-entered from a one-off verification pass,
which means it is already at risk of becoming the thing this department exists to prevent —
a confidently stated figure nobody re-checks. Turning it into `scripts/corpus_census.py` is
step 1 of [[corpus-archive-agenda-full]] for exactly that reason.

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion.

⚠️ **That directory does not exist yet** — the repo's only project skill is
`.agents/skills/railway-config/SKILL.md`. Staged as **CORP-F7**; see
[[knowledge-documentation-schedule]]. Repeating the sentence without the caveat would be
the exact defect [[standards-verification-charter]] audits.

| Proposed skill | Trigger | Doneability criterion | Real past instance |
|---|---|---|---|
| `corpus-census` | Daily, and before any dedupe commit | Emits all four `corpus.*` values and exits non-zero if any is unreadable | The 38/35/3 split had to be re-derived by hand for [[corpus-archive-charter]]; it should have been one command |
| `doc-placement-check` | Per PR touching `.planning/**` | Fails on a new top-level `.md`; passes with a named subdirectory | `.planning/` reached 28 top-level docs (~1.2 MB) despite `CLAUDE.md` §3 |
| `dedupe-safe` | Manual, on the `md/` ∩ `md_files/` set | Deletes **only** `cmp`-identical pairs; refuses on any diff and prints it | Three diverged pairs — including one that is not a duplicate at all — sit inside a set that looks uniformly deletable |
| `library-entry` | Adding an OD-22 resource | Entry carries `category`, `url`, `status`, `verified`, and a decision link if adoption is a real fork | AnyDoc is already **OD-06**; a library entry that silently reads as "adopted" would contradict an open decision |

Each names a trigger, a doneability criterion, and a past instance where it would have
helped — the protocol at [[README|foundation-README]] §3.3. **None is built.** Registry governance
belongs to [[skills-charter]] (Applied AI); this team authors, it does not govern.
