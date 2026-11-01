# 0353 — A closed till check marks Paid; only a person ends a seating

- **Status:** Proposed (2026-10-31)
- **Date:** 2026-10-31
- **Decider:** The founder, for the rule: his pick *"Auto-Paid, never auto-leave (Recommended)"* (AskUserQuestion asked 2026-10-31T03:46:17Z, Q4). The seven conditions, what Paid does and the undo are the executor's design, made before the delegation. *Voids* is the executor's call under the founder's 2026-10-31T16:57:09Z delegation (OD-242 (OPEN-DECISIONS.md:329 on main)), not his pick; how far that delegation reaches is OD-242, open. A lock is his.
- **Keywords:** Paid, never auto-leave, undo, split bill, closed_at, voided, csv_import, booth_event, emitToHouseRoles
- **Links:** [ADR 0303](0303-tables-learned-from-the-pos.md) (Proposed; its trigger sets `table_id`); [ADR 0302](0302-booth-and-event-checks-keep-their-own-row.md) (booth checks); [ADR 0345](0345-floor-checker-is-ported-into-mudavym.md) § Decision (the port); [ADR 0346](0346-waiter-scores-and-rankings-ship-to-managers.md) § Decision › D3 (figures reach owners and managers only); OD-64; OD-243 (OPEN-DECISIONS.md:330 on main).

## Context

On 2026-10-30 EDT the founder picked the *"Paid tap"* feature, whose option text reads "Waiter taps 'Paid'; that table stops nagging, and managers see 'paid 12 min ago' to spot slow turnovers. A closed check from the till does it automatically later, once a real till feed exists (sim houses only today)." (AskUserQuestion asked 2026-10-31T03:41:53Z, Q1). Asked whether a closed check should also end the seating, he picked *"Auto-Paid, never auto-leave (Recommended)"* (AskUserQuestion asked 2026-10-31T03:46:17Z, Q4). The option text he saw, the executor's wording, reads "A closed check marks the table Paid (with one-tap undo for split bills); the waiter still taps Leave. Voided checks and backfills are ignored." So the undo and the ignored voids and backfills are the words of his pick. An earlier draft had glossed it as a one-tap undo with voids and backfills ignored; that gloss was the coordinator's summary, not his words.

The rule was first drafted inside the floor-builder record; splitting it out is the executor's call under the founder's 2026-10-31T16:57:09Z delegation, and his to veto.

## Options considered

His three options (AskUserQuestion asked 2026-10-31T03:46:17Z, Q4):

1. **Auto-Paid, never auto-leave.** A closed check marks the table Paid; the waiter still taps Leave. Picked.
2. **Auto-Paid and auto-leave.** A closed check also ends the seating after a grace period. Not picked.
3. **Neither, taps only.** The till never changes floor state; it only feeds the mismatch check. Not picked.

*Voids* names one rejected alternative.

## Decision

**A closed till check marks its seating Paid when all seven conditions below hold. Paid never ends a seating; only a person's Leave does.**

**Where it runs.** In the gateway, after a check's upsert succeeds in `PosHubService.ingest` (`apps/api-gateway/src/pos-hub/pos-hub.service.ts:1090-1096`). The upsert returns no row today, so the hook reads the stored `pos_checks` row: ADR 0303's trigger can change `table_id` after the gateway's in-memory resolve (`pos-hub.service.ts:1068`; trigger function at `supabase/migrations/20261222230000_tables_learned_from_the_pos.sql:249-325`). Its errors are logged and never fail, slow or refuse the ingest; when it fails, the seating is not marked and the waiter's Paid tap still works.

**The conditions.** Conditions 2 and 4 are the executor's reading of "voided checks" and "backfills" in the option text; conditions 1, 3, 5, 6 and 7 are the executor's design.

1. The stored `closed_at` is set (written at `pos-hub.service.ts:1076`).
2. `voided` is false (`supabase/migrations/20260824190000_pos_voided_and_consumption_idempotency.sql:23`; written at `pos-hub.service.ts:1086`).
3. `channel` is not `booth_event` (`supabase/migrations/20261223150000_a_check_carries_its_channel.sql:73`). Booth checks are not table service (ADR 0302).
4. The source is not `csv_import`. The import route passes that source (`apps/api-gateway/src/pos-hub/pos-hub.controller.ts:140-142`), and its description names it "the csv_import path for nightly exports and backfills" (`:133`).
5. `table_id` names a table with an open seating, or a table in an active merge. Hidden tables, unlinked words and the builder's tray tables have no seating, so never mark.
6. `closed_at` is at or after that seating's `seated_at`. This keeps an earlier party's check, or an import that slipped past condition 4, from marking a later party.
7. This (seating, check) pair has not marked before. A re-send of the same check after an undo does nothing; a second check at the same seating (the other half of a split bill) may mark it again.

**What Paid does.** The table stops nagging and stops counting as late, per the checker's design, "service obligations stop" (`EDGE_CASES.md:18`, checker repository at `5958689`). The seating stays open: only a person's Leave ends it. The word "Paid" goes to `restaurant:<id>`, which staff join. "Paid N min ago" is a figure, so it goes only to owners and managers, through `emitToHouseRoles` (`apps/api-gateway/src/websocket/websocket.gateway.ts:39-43`, `:663`, `:684`). pos-hub has no socket emit today; its only `emit()` is a logging callback (`pos-hub.service.ts:778-788`), so the build adds one.

**The undo.** One tap, by the table's waiter, whoever is covering, or an owner or manager, and it records who and when. The option text says only "one-tap undo for split bills", so who may undo is the executor's design. The late clock restarts from the moment of the undo, and the undo counts as no visit; that is the executor's design too.

### Voids

A void never marks Paid. A later void of the check that set Paid does not clear it either; a person undoes it. His pick carries the text "Voided checks and backfills are ignored." (AskUserQuestion asked 2026-10-31T03:46:17Z, Q4), so it was not asked again. Read as written, a void changes nothing on the floor. That reading is the executor's call under the founder's 2026-10-31T16:57:09Z delegation, not his pick. The delegation, verbatim: *"complete the full integration with ful SOTA and robust connections with the current mudavym structure and foundation. Do not ask me anything just complete it fully."* (his goal message, 2026-10-31T16:57:09Z).

Rejected: letting a later void clear Paid, because that makes a void act on the floor, which "ignored" rules out. The undo stays a person's tap.

## Consequences

**Retire-to-write (CLAUDE.md §4).** This file is the one decision record §5 requires. It retires no document, as ADRs 0249, 0265, 0273, 0287 and 0314 did. Whether retire-to-write binds a new ADR is OD-243 (OPEN-DECISIONS.md:330 on main), open.

- **Easier.** A paid table stops nagging without a tap; a split bill or a wrong mark is one tap to undo.
- **Harder.** The build adds the hook, its stored-row read, a record of each (seating, check) pair that marked, an undo record, and pos-hub's first socket emit.
- **Owed** by this record, with the code that builds it: the hook in `PosHubService.ingest` with the seven conditions and its stored-row read; a migration for condition 7's (seating, check) record; the undo record of who undid and when; the Paid word to `restaurant:<id>` and the "Paid N min ago" figure through `emitToHouseRoles`; and the one-tap Undo.
- **Reach today.** SimPOS is loaded only outside production (`apps/api-gateway/src/app.module.ts:114-117`); the first real POS is OD-64.
- **Revisit when** a production till's closed checks are measured, or he rules on *Voids* or OD-242.

## Not verified

- No code was run and no test exists; the hook, its migration and the emit are not built.
- Not queried: whether any production house's till posts closed checks with a table word during service.
- Gateway and migration cites re-read at `origin/main` `5e966c8b6` (`pos-hub.service.ts:778-788`, `:1068`, `:1076`, `:1086`, `:1090-1096`; `pos-hub.controller.ts:133`, `:140-142`; `websocket.gateway.ts:39-43`, `:663`, `:684`; `app.module.ts:114-117`; the three migration lines). The checker's `EDGE_CASES.md:18` is at its HEAD `5958689`, outside the repo.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-30 | the founder | Picked the rule (AskUserQuestion asked 2026-10-31T03:46:17Z, Q4). |
| 2026-10-31 | executor | Drafted the conditions, what Paid does and the undo (the executor's design). |
| 2026-10-31 | executor, fork fold | Put the option text he saw on record; conditions 2 and 4 stay the executor's reading. |
| 2026-10-31 | executor | *Voids*: a void neither marks nor clears Paid, the executor's call under the founder's 2026-10-31T16:57:09Z delegation. |
| 2026-10-31 | executor, restructure | Split out of the floor-builder record, the executor's call under the founder's 2026-10-31T16:57:09Z delegation. |
| 2026-11-01 | executor | R3 rewrite: no held-note cites; single decision record |
