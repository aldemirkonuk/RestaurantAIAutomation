---
type: questions
division: intelligence
department: analytics-bi
team: metric-contract-truth-assurance
status: open
updated: 2026-08-24
open_questions: 1
links: ["[[metric-contract-truth-assurance-charter]]", "[[metric-contract-truth-assurance-agenda-full]]", "[[architecture-review-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]"]
---

# Metric Contract & Truth Assurance — Questions & Findings

> **Delivery point for advisory findings** ([ORG_STRUCTURE §3](../../../foundation/ORG_STRUCTURE.md)).
> Advisory is **findings-only**: nothing here blocks. The founder arbitrates.
> Also holds questions this unit cannot answer alone.

## Open

| ID | From | Raised | Question or finding | Next action | Age-out |
|---|---|---|---|---|---|
| DO-4 | decision-office | 2026-08-24 | The insight-type count is published three ways and pinned by none. The shipped UI says **375** (`apps/web/src/pages/InsightCatalog.tsx:2`, plus `commands.ts:78,99` and the OpenAPI summary at `analytics.controller.ts:219`); the measured truth is **573** — `INSIGHT_CANDIDATES.length` executed against `apps/api-gateway/src/analytics/insights/insight-catalog.ts` on 2026-08-24; and the only test asserts `toBeGreaterThanOrEqual(200)` (`insight-catalog.spec.ts:10`), a band wide enough for all three numbers to drift without failing a build. | Pin the count in CI to the derived value, and publish `analytics.satisfiable_candidate_share` beside it wherever it appears — both numbers or neither. | 2026-10-05 |

## Answered

| ID | From | Raised | Closed | Outcome |
|---|---|---|---|---|

---

## How this file works

**Who writes here.** Architecture Review, Red Team, and Decision Office write findings
against this unit. This unit writes its own unanswerable questions. Nobody else edits it.

**ID format.** `MET-Q<n>` for this unit's own questions; advisory keeps its own
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
