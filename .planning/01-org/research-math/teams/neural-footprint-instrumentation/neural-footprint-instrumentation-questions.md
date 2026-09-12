---
type: questions
division: research-math
department: research-math
team: neural-footprint-instrumentation
status: open
updated: 2026-08-24
open_questions: 1
links: ["[[neural-footprint-instrumentation-charter]]", "[[neural-footprint-instrumentation-agenda-full]]", "[[architecture-review-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]"]
---

# Neural Footprint Instrumentation — Questions & Findings

> **Delivery point for advisory findings** ([ORG_STRUCTURE §3](../../../foundation/ORG_STRUCTURE.md)).
> Advisory is **findings-only**: nothing here blocks. The founder arbitrates.
> Also holds questions this unit cannot answer alone.

## Open

| ID | From | Raised | Question or finding | Next action | Age-out |
|---|---|---|---|---|---|
| AR-4 | architecture-review | 2026-08-24 | **Corrected 2026-08-25 — closed by P1:** the NestJS side emits (`model-client.service.ts:413`) and `SpendLogger.log()` now takes `agent` + `correlation_id` (`spend_logger.py:269,276`), so the join exists. The pre-P1 statement follows. L4 emits nothing on the NestJS side and cannot be joined on the Python side. `SpendLogger.log()` takes `provider, model, input_tokens, output_tokens, cost_usd, restaurant_id` and **no `agent` parameter** (`services/agent-orchestrator/services/spend_logger.py:41-49`); `api_spend` has no `correlation_id`. `decision_log` (written at `core/base_agent.py:752-784`) carries `agent_name`, `reasoning`, `correlation_id` but no cost. No column connects reasoning to spend, so NF-A's founding question cannot be answered by a query. | Define the NF-A join key (blocked on OD-11). The cost-attribution half is [[inference-cost-charter]]'s — one finding, cross-linked. | 2026-10-05 |

## Answered

| ID | From | Raised | Closed | Outcome |
|---|---|---|---|---|

---

## How this file works

**Who writes here.** Architecture Review, Red Team, and Decision Office write findings
against this unit. This unit writes its own unanswerable questions. Nobody else edits it.

**ID format.** `NEU-Q<n>` for this unit's own questions; advisory keeps its own
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
