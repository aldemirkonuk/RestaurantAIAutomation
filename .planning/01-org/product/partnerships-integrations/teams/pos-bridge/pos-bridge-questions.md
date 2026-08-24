---
type: questions
division: product
department: partnerships-integrations
team: pos-bridge
status: open
updated: 2026-08-24
open_questions: 6
links: ["[[pos-bridge-charter]]", "[[pos-bridge-agenda-full]]", "[[architecture-review-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]", "[[POS-BRIDGE-AUDIT]]"]
---

# POS Bridge — Questions & Findings

> **Delivery point for advisory findings** ([ORG_STRUCTURE §3](../../../foundation/ORG_STRUCTURE.md)).
> Advisory is **findings-only**: nothing here blocks. The founder arbitrates.
> Also holds questions this unit cannot answer alone.

## Open

> Full evidence for POS-Q1..Q6: [POS-BRIDGE-AUDIT](../../../../../04-specs/POS-BRIDGE-AUDIT.md).

| ID | From | Raised | Question or finding | Next action | Age-out |
|---|---|---|---|---|---|
| POS-Q1 | pos-bridge | 2026-08-24 | 🔴 **`sale_unit` is never written — every glass pour depletes a bottle.** The column exists on `pos_item_mappings`; `loadItemMappings` selects it (`pos-hub.service.ts:247`), `resolveWine` returns it (`:291`), `applyStockEffects` uses it (`:371`). But `upsertItemMapping` — the only writer, used by both auto-map and human approve — omits it from the row (`:514-527`). **All 92 production mapping rows have `sale_unit = null`**, so `:371`'s `?? "bottle"` fires every time. Already wrong, not unbuilt. | Add `sale_unit` to `upsertItemMapping`'s row, the mapping DTO, and the approve UI. No decision needed — this is a defect. | 2026-10-05 |
| POS-Q2 | pos-bridge | 2026-08-24 | 🔴 **`voided` is never persisted — voided checks count as revenue forever.** It is in `CanonicalCheck` (`pos-types.ts:29-32`) and drives stock reversal (`pos-hub.service.ts:379-412`), but is absent from the persisted row (`:186-201`) and from `pos_checks` in production. Three readers sum `total` with no filter: `goals.service.ts:323-327`, `insight-generator.service.ts:239-245`, `table-analytics.service.ts:146`. This is `pi.canonical_shape_drift` with a name. | One column + one line in the upsert + one filter in each of three readers. No decision needed. | 2026-10-05 |
| POS-Q3 | pos-bridge | 2026-08-24 | **`csv_import` does not import CSV.** It is `genericAdapter` under another key (`pos-adapters.ts:206`) behind a JSON-only endpoint (`pos-hub.controller.ts:101`); no parser, no `FileInterceptor` anywhere in the module. Yet the registry lists it `status: "available"`, `apiStyle: "file"` (`:42-51`) and routes `akinsoft_wolvox` through it (`:309`). It is the only ingestion path the 13 pull-only providers were ever going to use, and it is the premortem's own M1 answer. | Build the parser, or change the registry status and stop offering it. | 2026-10-05 |
| POS-Q4 | pos-bridge | 2026-08-24 | **There is no pull path at all.** 13 of 27 providers declare `webhooks: false`. The gateway runs 15+ `@Cron` jobs; **none calls a POS**, and no cursor/watermark is stored anywhere. The only route for these providers is a human or external script posting canonical JSON with a bearer token. Structural, not a missing adapter. | Blocked on the connection model (OD-A draft). Do not start adapters first. | 2026-10-05 |
| POS-Q5 | pos-bridge | 2026-08-24 | **Toast — the only production-configured POS (10/10 restaurants) — never writes `pos_checks`.** Three paths exist and none produces a canonical check: `ToastService` writes stock RPCs and `events` directly (`toast.service.ts:452-542`); the Python agent writes only `pos_webhook_logs`, **a table that does not exist in production**; and `toastAdapter` at `/pos-hub/webhook/toast/:restaurantId` is called by nothing. | Decide whether Toast migrates onto the canonical path or the bridge thesis carries an exception. Co-owned with Engineering. | 2026-10-05 |
| POS-Q6 | pos-bridge | 2026-08-24 | **`capabilities` is documentation, not negotiation.** No server code reads it — analytics derives availability from observed row counts (`insight-generator.service.ts:289-298`) instead. So "Square cannot report tables" and "you have not mapped tables yet" are indistinguishable. Separately, partial capability inside a *present* source yields plausible wrong numbers: `checkinDensity` (`table-analytics.service.ts:175`) and `seatUtilization` (`:179-181`) coalesce null covers to **0** where `revenuePerCover` (`:178`) correctly returns null. | Fix the null-vs-zero half regardless (3 lines). The wiring half is a fork — OD-C draft. | 2026-10-05 |

## Answered

| ID | From | Raised | Closed | Outcome |
|---|---|---|---|---|

---

## How this file works

**Who writes here.** Architecture Review, Red Team, and Decision Office write findings
against this unit. This unit writes its own unanswerable questions. Nobody else edits it.

**ID format.** `POS-Q<n>` for this unit's own questions; advisory keeps its own
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
