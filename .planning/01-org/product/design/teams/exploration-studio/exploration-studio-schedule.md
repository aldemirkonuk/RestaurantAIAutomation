---
type: schedule
division: product
department: design
team: exploration-studio
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[exploration-studio-charter]]", "[[exploration-studio-loops]]", "[[exploration-studio-agenda-board]]", "[[design-schedule]]", "[[skills-charter]]", "[[ux-path-burn-down-charter]]", "[[design-system-motion-substrate-charter]]", "[[decision-office-charter]]"]
---

# Exploration Studio — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| On sketch creation | **ID allocation from the manifest** — row before directory | Prevents the `038`/`048` duplicate class permanently |
| Biweekly | **Convergence review** (`L-EXP-1`) — every row null at its second close-time is resolved: winner or withdrawal | `design.resolved_question_rate`, `design.open_null_winner_count`, `design.questions_withdrawn` |
| Biweekly | **Manifest sweep** (`L-EXP-2`) — bidirectional: directories without rows, rows without directories, duplicate IDs | `design.sketch_index_completeness`, `design.orphan_sketch_dirs`, `design.phantom_manifest_rows` |
| Biweekly | **Handoff review** (`L-EXP-3`) — every winner has a receiving team and a queue item, or it is not closed | `design.winners_unqueued`, `design.handoff_age_days` |
| Biweekly | **Motion drain** (`L-EXP-4`, time-boxed) — 043–046 resolved or escalated | `design.motion_specs_with_winner` (**0 of 4**) |
| Biweekly | Options-floor check — median options per sketch ≥ 3 | `design.options_per_sketch_median` |
| Monthly | WIP-limit relaxation log — every relaxation, with its reason | Pattern visible even when each instance is defensible |
| Quarterly | Freeze audit — commits modifying an already-resolved sketch | Violation list; there is no legitimate reason for one |
| Quarterly | Staleness sweep — this team's artifacts, 60 days ([[README]] §3.3, §6) | Archive or revision |

**Everything here is biweekly on purpose.** Weekly punishes exploration that is legitimately
mid-flight; monthly is slow enough for the null count to grow before anyone looks — which is
the documented history of this corpus (28 nulls accumulated with nobody scheduled to notice).

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion.

**Honest state: `.claude/skills/` does not exist in this repository.** The only project
skill on disk is `.agents/skills/railway-config/SKILL.md` ([[README]] §3.1). This team owns
**zero skills today**.

There is a user-level `gsd-sketch` command that produced much of this corpus, but it is GSD
tooling rather than a project skill ([[README]] §3.1 makes the distinction), and it
generates sketches — it does not converge them. **The gap is convergence, not generation,
and that is exactly the wrong way round for a corpus at 28 nulls.**

| Proposed skill | Trigger | Doneability criteria | Real past instance |
|---|---|---|---|
| `sketch-manifest-sweep` | Biweekly, and on any new sketch directory | Every directory has a row and every row a directory; duplicates impossible | **10 orphan directories** (005, 011–015, 017–019, 049) and **phantom row 039** |
| `sketch-converge` | Biweekly, on rows null at their second close-time | Each row resolves to a winner or an explicit withdrawal; no row carries null past two cycles | **28 of 43 rows null** — two-thirds of all exploration in the repo |
| `sketch-handoff` | On naming a winner | Manifest row carries a receiving team and a queue item | **050, 051, 048, 042, 033** — decided, handed to nobody |
| `sketch-freeze-check` | Quarterly, plus per-commit | No commit modifies a resolved sketch | Two rows marked IMPLEMENTED are one lookup from being read as documentation |
| `sketch-id-allocate` | On sketch creation | Next ID issued by the manifest; collision impossible | **`038`** and **`048`** each used twice on disk |

**Nothing in this table exists yet.** Each is tied to a job above so a skill is created
against a close-time. Registry governance sits with [[skills-charter]] (Applied AI).

### The one job this team should be judged on first

`sketch-converge`. Generation is already solved — 53 directories, 51 HTML sketches, 97 files
of it. Convergence is the missing half, and it is the half that determines whether any of
that work reaches a user. The current conversion is **2 of 53**.

### Anti-sprawl note specific to this team

This is the department's most sprawl-prone unit by construction: its output is *supposed* to
be discarded, which makes accumulation invisible until someone counts. The anti-sprawl rule
here is therefore **numeric and biweekly** rather than annual — the WIP limit, the
two-close-time rule, and a withdrawal count that is expected to be **greater than zero**. A
studio that has never withdrawn a question is not disciplined; it is storing its indecision
in a column called `Winner`.
