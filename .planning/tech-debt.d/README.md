# tech-debt.d/ — new defect-register entries, one file per branch

[ADR 0240](../decisions/0240-register-entries-are-fragments.md), locked 2026-09-29.

**This README is the index; the directory listing is the entry list.** A file
here is an *entry* of the defect register, not a new document (the founder's
answer, 2026-09-29), so it names nothing to retire and gets no index row.

**The defect register is now `../v3.0-TECH-DEBT.md` plus this folder.** Search
both: `grep -rn <term> .planning/v3.0-TECH-DEBT.md .planning/tech-debt.d/`.

## The rule

- `../v3.0-TECH-DEBT.md` is **frozen**. Its last section is `## FROZEN — …` and
  `scripts/check_decision_claims.sh` pins its line count (`DEBT_FROZEN_LINES`).
  A heading after the FROZEN section, a line added anywhere (a "**Fix.**"
  paragraph inside a legacy entry included), or a line removed fails the build
  with **exit 7**. 127 line citations in 70 files point into that file; the pin
  is what keeps them true.
- A legacy entry is **closed in place** by striking its heading
  (`~~OPEN~~ CLOSED on … — <date>`), which keeps the line count. A closing note
  longer than that goes in a fragment here that cites the legacy entry as
  `v3.0-TECH-DEBT.md:<line>` together with its heading text.
- A **new** entry goes here, in the register's heading format:
  `## <title> — STATUS — <date>`. A fragment may hold several entries, but only
  from one branch.

## Naming

- `<YYYY-MM-DD>-<branch-slug>.md`, so a plain `ls` lists the register in date
  order. The date is the day the entry is filed and must be a real date.
- `<branch-slug>` = the branch name, lowercased, with every character outside
  `[a-z0-9.-]` (so every `/` and `_`) turned into `-`, repeats collapsed, and no
  leading `-` or `.`. `fix/devtruth-tab-crash` filed on 2026-09-29 →
  `2026-09-29-fix-devtruth-tab-crash.md`.
- If that name is already on `main`, add `-2` (then `-3`) before `.md`.

## What fails the build (exit 2)

- any file other than this README not named `<YYYY-MM-DD>-<slug>.md`;
- a subdirectory;
- a fragment with no `## ` entry heading.

`scripts/check_od_ids_exist.py` walks these files like any other planning
markdown, so an OD id a fragment cites must be a real one.

## Citing an entry

Cite a new entry as `tech-debt.d/<file>.md:<n>`. A fragment has one author, so
the line does not drift.
