---
type: questions
division: platform
department: engineering
team: schema-migrations
status: open
updated: 2026-08-24
open_questions: 2
links: ["[[schema-migrations-charter]]", "[[schema-migrations-agenda-full]]", "[[architecture-review-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]"]
---

# Schema & Migrations — Questions & Findings

> **Delivery point for advisory findings** ([ORG_STRUCTURE §3](../../../foundation/ORG_STRUCTURE.md)).
> Advisory is **findings-only**: nothing here blocks. The founder arbitrates.
> Also holds questions this unit cannot answer alone.

## Open

| ID | From | Raised | Question or finding | Next action | Age-out |
|---|---|---|---|---|---|
| AR-1 | architecture-review | 2026-08-24 | `generated_reports` has RLS enabled (`baseline:14383`) and zero policies while the browser queries it directly (`useReportQueries.ts:26,37`) — returns `[]` silently. Layer inversion + silent failure (OD-45). | Add RLS policy or route through the gateway. | 2026-10-05 |
| AR-6 | architecture-review | 2026-08-24 | `scripts/check_schema_parity.sh:6-12` is the **only** mechanism in the repo that closes a layer-boundary loop automatically, and it records what an unpoliced boundary cost last time: 27 tables, 403 columns and 13 functions existed only because DDL had been applied by hand — including `calculate_sales_velocity` and `resolve_sku_to_inventory`, business logic with no source anywhere. Graded Sev-3 because it is fixed; filed as precedent and template. | Adopt its shape — rebuild from source of truth, diff against reality, exit non-zero — for every new boundary check. | 2026-10-05 |

## Answered

| ID | From | Raised | Closed | Outcome |
|---|---|---|---|---|

---

## How this file works

**Who writes here.** Architecture Review, Red Team, and Decision Office write findings
against this unit. This unit writes its own unanswerable questions. Nobody else edits it.

**ID format.** `SCH-Q<n>` for this unit's own questions; advisory keeps its own
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
