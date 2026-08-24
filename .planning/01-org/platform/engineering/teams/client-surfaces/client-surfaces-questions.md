---
type: questions
division: platform
department: engineering
team: client-surfaces
status: open
updated: 2026-08-24
open_questions: 4
links: ["[[client-surfaces-charter]]", "[[client-surfaces-agenda-full]]", "[[architecture-review-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]"]
---

# Client Surfaces — Questions & Findings

> **Delivery point for advisory findings** ([ORG_STRUCTURE §3](../../../foundation/ORG_STRUCTURE.md)).
> Advisory is **findings-only**: nothing here blocks. The founder arbitrates.
> Also holds questions this unit cannot answer alone.

## Open

| ID | From | Raised | Question or finding | Next action | Age-out |
|---|---|---|---|---|---|
| DO-10 | page-docs | 2026-08-24 | `/admin`, `/admin/health`, `/dev-sandbox` have **no role gate on the route** (`App.tsx:288` renders `AdminPanel` inside plain auth, vs the studio routes at `:170-187` which do use `ProtectedRoute` roles). The sidebar link is owner-only; the URL is not. Any logged-in staff member can open the admin UI. | Add `ProtectedRoute` role gating to the three routes, mirroring the studio pattern. Coordinate with Security's OD-19 sweep for the backend half. | 2026-10-05 |
| DO-11 | page-docs | 2026-08-24 | **SimPOS pages are a zombie UI in production**: `SimposModule` vanishes (NODE_ENV gate, PR #32) but the pages neither 404 nor error — the seed failure is swallowed (`SimposTerminalPage.tsx:59-62`), query errors never render (`throwOnError:false`), so a functional-looking empty terminal **polls the dead endpoint every 5s forever** (`:74`) while the Receipts tab shows real data, deepening the illusion. | Gate the routes to non-production like the module, or render an explicit "dev-only" state. | 2026-10-05 |

| DO-12 | page-docs | 2026-08-24 | **Studio's five API calls are mis-wired, not missing.** The endpoints are implemented and tested in the Python orchestrator (`services/agent-orchestrator/main.py` + `test_onboarding_extract_endpoint.py`), but the web proxy (`vite.config.ts:24-28`, `vercel.json`) routes `/api/*` to the NestJS gateway, which has no `/studio` or `/onboarding/extract` module — so studio calls 404 in dev *and* prod despite a working backend existing. | Route studio paths to the orchestrator, or proxy through the gateway. Not in the debt register. | 2026-10-05 |
| DO-13 | page-docs | 2026-08-24 | **/sommelier ships against an endpoint that does not exist.** `SommelierAI.tsx:172` posts to `/api/v1/sommelier/chat`; the code's own comment says *"this endpoint may not exist yet"*, `main.py` never registers it, and the catch turns every reply into the client-side low-stock fallback. The page presents an AI sommelier whose every answer is local string-matching. | Register the endpoint or label the page's capability honestly. | 2026-10-05 |

## Answered

| ID | From | Raised | Closed | Outcome |
|---|---|---|---|---|

---

## How this file works

**Who writes here.** Architecture Review, Red Team, and Decision Office write findings
against this unit. This unit writes its own unanswerable questions. Nobody else edits it.

**ID format.** `CLI-Q<n>` for this unit's own questions; advisory keeps its own
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
