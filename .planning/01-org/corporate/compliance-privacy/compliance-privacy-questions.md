---
type: questions
division: corporate
department: compliance-privacy
status: open
updated: 2026-08-24
open_questions: 2
links: ["[[compliance-privacy-charter]]", "[[compliance-privacy-agenda-full]]", "[[architecture-review-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]"]
---

# Compliance & Privacy — Questions & Findings

> **Delivery point for advisory findings** ([ORG_STRUCTURE §3](../../../foundation/ORG_STRUCTURE.md)).
> Advisory is **findings-only**: nothing here blocks. The founder arbitrates.
> Also holds questions this unit cannot answer alone.

## Open

| ID | From | Raised | Question or finding | Next action | Age-out |
|---|---|---|---|---|---|
| RT-2 | red-team | 2026-08-24 | `0006-neural-footprint-architecture.md:50` locks the research store as *append-only, deliberately wide, never migrated*. NF-B is guest behaviour — personal data, carrying an erasure right that *never migrated* cannot satisfy. The ADR asserts none of the three things that would make it complete (NF-B never enters the store / erasure honoured without mutating a row / anonymised at write time) and its Consequences section mentions erasure **zero times**. Not in the register. | Register the fork, paired with OD-11 — the two cannot be decided independently. Spans [[research-math-charter]] and [[data-charter]]. | 2026-10-05 |
| DO-7 | decision-office | 2026-08-24 | `apps/web/src/pages/Privacy.tsx:31` tells every reader the product *sets no tracking or advertising cookies* and needs no consent banner *because there is nothing to consent to*, while **cookie consent sits as a technical-SEO checklist item handed to Growth** (`growth-charter.md:91,94`; `growth-premortem.md:99-102`). Whichever ships second silently falsifies the other, and the page is the public promise. | Bind them: any tracking, cookie or telemetry change edits `Privacy.tsx` in the same PR. Checklist item is owned by [[growth-charter]]. | 2026-10-05 |

## Answered

| ID | From | Raised | Closed | Outcome |
|---|---|---|---|---|

---

## How this file works

**Who writes here.** Architecture Review, Red Team, and Decision Office write findings
against this unit. This unit writes its own unanswerable questions. Nobody else edits it.

**ID format.** `COM-Q<n>` for this unit's own questions; advisory keeps its own
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
