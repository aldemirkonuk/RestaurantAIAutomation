---
type: questions
division: platform
department: engineering
team: platform-api
status: open
updated: 2026-08-24
open_questions: 1
links: ["[[platform-api-charter]]", "[[platform-api-agenda-full]]", "[[architecture-review-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]"]
---

# Platform & API — Questions & Findings

> **Delivery point for advisory findings** ([ORG_STRUCTURE §3](../../../foundation/ORG_STRUCTURE.md)).
> Advisory is **findings-only**: nothing here blocks. The founder arbitrates.
> Also holds questions this unit cannot answer alone.

## Open

| ID | From | Raised | Question or finding | Next action | Age-out |
|---|---|---|---|---|---|
| AR-5 | architecture-review | 2026-08-24 | The tenant invariant is per-controller convention, not architecture: `apps/api-gateway/src/common/tenant/tenant.guard.ts:38-46` returns `true` when there is no authenticated user (deliberately, with a logged warning), so isolation holds only where a second, independent decorator was remembered. [[ENDPOINTS]] measures the result: 137 of 448 endpoints carry no `JwtAuthGuard`; minus 32 webhook routes and 11 explicit `@Public()`, **94 are unguarded by omission**. Endpoint 449 will be unguarded by default. | Make the invariant structural (deny-by-default at the boundary). Exploitability and endpoint triage are [[security-charter]]'s under OD-19/OD-20. | 2026-10-05 |

## Answered

| ID | From | Raised | Closed | Outcome |
|---|---|---|---|---|

---

## How this file works

**Who writes here.** Architecture Review, Red Team, and Decision Office write findings
against this unit. This unit writes its own unanswerable questions. Nobody else edits it.

**ID format.** `PLA-Q<n>` for this unit's own questions; advisory keeps its own
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
