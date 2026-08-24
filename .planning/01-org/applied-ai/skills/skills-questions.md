---
type: questions
division: applied-ai
department: skills
status: open
updated: 2026-08-24
open_questions: 1
links: ["[[skills-charter]]", "[[skills-agenda-full]]", "[[architecture-review-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]"]
---

# Skills — Questions & Findings

> **Delivery point for advisory findings** ([ORG_STRUCTURE §3](../../../foundation/ORG_STRUCTURE.md)).
> Advisory is **findings-only**: nothing here blocks. The founder arbitrates.
> Also holds questions this unit cannot answer alone.

## Open

| ID | From | Raised | Question or finding | Next action | Age-out |
|---|---|---|---|---|---|
| RT-4 | red-team | 2026-08-24 | `.planning/01-org/applied-ai/skills/` holds **32 markdown files** (28 when first counted) while `git ls-files` returns **zero** `SKILL.md` in the repository. The only `SKILL.md` on disk is `.agents/skills/railway-config/SKILL.md`, gitignored wholesale at `.gitignore:100` as CLI-installed vendor tooling — so the department's de-facto template is borrowed from a vendor CLI. The generator's own self-retirement trigger (fewer than 5 committed firing skills by 2026-11-24 → collapse into AI Orchestration) is unadopted. | Founder yes/no on OD-24. Adopting it is the cheapest available test of whether the anti-sprawl rules are real; a reasoned no closes it either way. | 2026-10-05 |

## Answered

| ID | From | Raised | Closed | Outcome |
|---|---|---|---|---|

---

## How this file works

**Who writes here.** Architecture Review, Red Team, and Decision Office write findings
against this unit. This unit writes its own unanswerable questions. Nobody else edits it.

**ID format.** `SKI-Q<n>` for this unit's own questions; advisory keeps its own
prefix (`AR-`, `RT-`, `DO-`) so provenance survives a copy-paste.

**Escalation.** A finding still Open after **42 days** must resolve to a binary — fix it,
or accept it in writing with a named owner and a date. *Accepting is an honourable close.*
Anything implying a decision also gets a row in
[`OPEN-DECISIONS.md`](../../../decisions/OPEN-DECISIONS.md); this file is not a decision log.

**Why this file exists.** The advisory layer was specified with `questions.md` as its
delivery target and then built without one — so all three functions were inert on arrival
(OD-41). Created 2026-08-24 by `scripts/build_questions_files.py`.

```dataview
TABLE open_questions, updated
FROM "01-org" OR "02-advisory"
WHERE type = "questions" AND open_questions > 0
SORT open_questions DESC
```
