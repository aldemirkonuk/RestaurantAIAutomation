---
type: questions
division: commercial
department: growth
team: technical-seo-ai-answer-surface
status: open
updated: 2026-08-24
open_questions: 1
links: ["[[technical-seo-ai-answer-surface-charter]]", "[[technical-seo-ai-answer-surface-agenda-full]]", "[[architecture-review-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]"]
---

# Technical SEO & AI Answer Surface — Questions & Findings

> **Delivery point for advisory findings** ([ORG_STRUCTURE §3](../../../foundation/ORG_STRUCTURE.md)).
> Advisory is **findings-only**: nothing here blocks. The founder arbitrates.
> Also holds questions this unit cannot answer alone.

## Open

| ID | From | Raised | Question or finding | Next action | Age-out |
|---|---|---|---|---|---|
| DO-9 | decision-office | 2026-08-24 | `vercel.json:12-15` rewrites every path that is not `/api/…` or `/assets/…` to `/index.html`, so the CDN returns **HTTP 200 for every nonexistent URL** — the status is decided *above* the router and the SPA's own 404 at `apps/web/src/App.tsx:302` never gets to set one. `seo.soft_404_rate` baseline is 100%, and it has been live and unreported. | Decide the 404 mechanism above the router (the change is to `vercel.json`, not `apps/web`). Page copy and CTA are [[conversion-funnel-charter]]'s half — neither team can ship it alone. | 2026-10-05 |

## Answered

| ID | From | Raised | Closed | Outcome |
|---|---|---|---|---|

---

## How this file works

**Who writes here.** Architecture Review, Red Team, and Decision Office write findings
against this unit. This unit writes its own unanswerable questions. Nobody else edits it.

**ID format.** `TEC-Q<n>` for this unit's own questions; advisory keeps its own
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
