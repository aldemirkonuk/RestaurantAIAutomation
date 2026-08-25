---
type: questions
division: commercial
department: media-brand
team: brand-identity
status: open
updated: 2026-08-24
open_questions: 1
links: ["[[brand-identity-charter]]", "[[brand-identity-agenda-full]]", "[[architecture-review-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]"]
---

# Brand Identity — Questions & Findings

> **Delivery point for advisory findings** ([ORG_STRUCTURE §3](../../../foundation/ORG_STRUCTURE.md)).
> Advisory is **findings-only**: nothing here blocks. The founder arbitrates.
> Also holds questions this unit cannot answer alone.

## Open

| ID | From | Raised | Question or finding | Next action | Age-out |
|---|---|---|---|---|---|
| DO-6 | decision-office | 2026-08-24 | The legacy `WineOps` name still ships at **OS level**, where no domain scan can see it: the installed mobile app name (`apps/mobile/app.json:3`), the Face ID system prompt (`apps/mobile/app/lock.tsx:31` and `app.json:20`), the Android notification channel (`apps/mobile/src/lib/push.ts:32`), the web push title (`apps/web/public/sw.js:67`), and the iCal `PRODID` transmitted into every subscribed calendar client (`apps/api-gateway/src/calendar/calendar.service.ts:1204`). Re-measured on this branch: **336 lines across 178 tracked files** under `apps packages services supabase scripts` (975 lines / 508 files repo-wide). Baseline of 351/193 was taken on `feat/beverage-catalogue-wine-identity`. | Tier-1 OS surfaces to zero, then a CI guard — a cleanup without a guard re-grows, which is why the count has only ever gone up. | 2026-10-05 |

## Answered

| ID | From | Raised | Closed | Outcome |
|---|---|---|---|---|

---

## How this file works

**Who writes here.** Architecture Review, Red Team, and Decision Office write findings
against this unit. This unit writes its own unanswerable questions. Nobody else edits it.

**ID format.** `BRA-Q<n>` for this unit's own questions; advisory keeps its own
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
