---
type: questions
division: product
department: guest-experience
team: guest-identity-consent
status: open
updated: 2026-08-24
open_questions: 1
links: ["[[guest-identity-consent-charter]]", "[[guest-identity-consent-agenda-full]]", "[[architecture-review-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]"]
---

# Guest Identity & Consent — Questions & Findings

> **Delivery point for advisory findings** ([ORG_STRUCTURE §3](../../../foundation/ORG_STRUCTURE.md)).
> Advisory is **findings-only**: nothing here blocks. The founder arbitrates.
> Also holds questions this unit cannot answer alone.

## Open

| ID | From | Raised | Question or finding | Next action | Age-out |
|---|---|---|---|---|---|
| DO-8 | decision-office | 2026-08-24 | The guest consent and erasure slice (`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql`) has **zero application call sites**: `guest_check_links`, `guest_link_identifier`, `guest_consents`, `guest_pepper`, `guest_identifier_pepper` and `guest_copresence_negatives` each return **0 hits** across `apps`, `services` and `packages`. `nf_b.subject_coverage` is therefore a structural zero, and every interaction passing meanwhile could have been an NF-B event and **cannot be backfilled**. | Ship one capture channel end to end (one restaurant, no new UI); report coverage as a structural zero with a named cause, never as a low number. | 2026-10-05 |

## Answered

| ID | From | Raised | Closed | Outcome |
|---|---|---|---|---|

---

## How this file works

**Who writes here.** Architecture Review, Red Team, and Decision Office write findings
against this unit. This unit writes its own unanswerable questions. Nobody else edits it.

**ID format.** `GUE-Q<n>` for this unit's own questions; advisory keeps its own
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
