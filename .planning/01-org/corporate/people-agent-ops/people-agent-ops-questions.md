---
type: questions
division: corporate
department: people-agent-ops
status: open
updated: 2026-08-24
open_questions: 1
links: ["[[people-agent-ops-charter]]", "[[people-agent-ops-agenda-full]]", "[[architecture-review-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]"]
---

# People & Agent Ops — Questions & Findings

> **Delivery point for advisory findings** ([ORG_STRUCTURE §3](../../../foundation/ORG_STRUCTURE.md)).
> Advisory is **findings-only**: nothing here blocks. The founder arbitrates.
> Also holds questions this unit cannot answer alone.

## Open

| ID | From | Raised | Question or finding | Next action | Age-out |
|---|---|---|---|---|---|
| DO-3 | decision-office | 2026-08-24 | Roster truth is a three-way disagreement between filesystem, orchestrator class map and `DEFAULT_AGENT_SPECS`. **3 agent modules are never registered** — `book_scraper_agent`, `dataset_creator_agent`, `recurring_order_agent` (the first two subclass `BaseAgent`; the third does not, so the metric is *unregistered modules*, not *unregistered `BaseAgent` subclasses*). And **4 registered agents have no `DEFAULT_AGENT_SPECS` entry** — `email_intel_agent`, `email_parsing_agent`, `provider_communication_agent`, `provider_conversation_agent` — so they silently resolve their spec from `{}` at `core/agent_registry.py:337` and inherit `ON_DEMAND` plus a 300 s idle timeout nobody chose. | Make the empty-dict fallback loud (fail the PR check); resolve each unregistered module to *registered* or *declared out of scope*. | 2026-10-05 |

## Answered

| ID | From | Raised | Closed | Outcome |
|---|---|---|---|---|

---

## How this file works

**Who writes here.** Architecture Review, Red Team, and Decision Office write findings
against this unit. This unit writes its own unanswerable questions. Nobody else edits it.

**ID format.** `PEO-Q<n>` for this unit's own questions; advisory keeps its own
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
