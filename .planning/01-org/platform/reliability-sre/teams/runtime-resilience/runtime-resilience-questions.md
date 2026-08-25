---
type: questions
division: platform
department: reliability-sre
team: runtime-resilience
status: open
updated: 2026-08-24
open_questions: 1
links: ["[[runtime-resilience-charter]]", "[[runtime-resilience-agenda-full]]", "[[architecture-review-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]"]
---

# Runtime Resilience — Questions & Findings

> **Delivery point for advisory findings** ([ORG_STRUCTURE §3](../../../foundation/ORG_STRUCTURE.md)).
> Advisory is **findings-only**: nothing here blocks. The founder arbitrates.
> Also holds questions this unit cannot answer alone.

## Open

| ID | From | Raised | Question or finding | Next action | Age-out |
|---|---|---|---|---|---|
| DO-2 | decision-office | 2026-08-24 | `queue.dead_letters` is declared durable, bound to `dlx.main` and stored in `self.queues` (`services/agent-orchestrator/core/message_bus.py:505-535`), and `metrics.messages_dead_lettered` is incremented at `:771,817,824,830` — but **nothing anywhere consumes it**; the only two references to the queue name in the repo are its own declaration and registration. A queue with a counter and no reader records failure without surfacing it. | Give the DLQ a consumer, and emit depth **and oldest-message age**; decide whether replay is human-gated like money and stock (`drift_agent.py:11-16`). | 2026-10-05 |

## Answered

| ID | From | Raised | Closed | Outcome |
|---|---|---|---|---|

---

## How this file works

**Who writes here.** Architecture Review, Red Team, and Decision Office write findings
against this unit. This unit writes its own unanswerable questions. Nobody else edits it.

**ID format.** `RUN-Q<n>` for this unit's own questions; advisory keeps its own
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
