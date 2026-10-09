# 0321 — A repeat order keeps its day of the month, and 31 means the last day

- **Status:** Proposed. Decided by the coordinator under the founder delegation of 2026-10-07 (20:04:10Z, *"Do not ask me questions, I allow and approve for you to decide on your own…"*, quoted in full in [[0317-only-an-owner-or-manager-rules-a-day-out]]). This is the coordinator's call, not the founder's pick; he can overrule any part of it, and a lock is his.
- **Date:** 2026-10-09
- **Decider:** the coordinator, under the delegation above. Built by sim wave 6 lane `recurrence-month-end` (`fix/sim-recurrence-month-end` 35a75f203) and wave 7 lane `recurrence-last-day` (`fix/sim-recurrence-last-day` b71df9df3, stacked on it). Both branches are **local only, not merged** at the date of this record.
- **Keywords:** recurrence, repeat order, monthly, quarterly, recurrence_anchor_day, recurrence_anchored_on, month end, last day of the month, clamp, carry forward, snapToMonthDay, nextOccurrenceOn, addMonths, generateDueRecurrences, houseToday, F-307
- **Links:** [[0296-a-sale-belongs-to-the-houses-day]] (`common/house-day`); [[0304-a-house-zone-comes-from-its-address]] (a house's date is read on its own clock); [[0125-an-order-changes-state-through-a-sealed-transition]] (rule plus start, snapped onto the anchor); `supabase/migrations/20260905235800_an_order_that_repeats_says_so_on_itself.sql:192-215` (the 28 cap); OD-92 (the crons ignore each house's time zone, open; the decision note and sim ledger cite it as OD-90, which is the resolved SSRF entry); sim ledger S44/S45 (`p4-scratch/sim-ledger.md`, outside the repo)

## Context

Code cites are at `origin/main` c587469bf unless a branch is named.

An owner who sets a monthly order "from the 31st" lost that day after the first February. Three defects, all re-verified before the fix (F-307):

1. **Carry-forward.** `order-recurrence.ts` `addMonths` clamps (31 Jan + 1 month = 28 Feb), and `nextOccurrenceOn` stepped from the PREVIOUS occurrence. An unanchored monthly series started 31 Jan ran 31 Jan, 28 Feb, 28 Mar, 28 Apr: the 31st was gone for good. An anchored series re-snaps to its anchor each step, but the anchor could only be 1..28, so it could never mean "the last day".
2. **A sheet sentence that was never true.** The anchor picker said a long anchor is "clamped to the last day of a short one". An anchor of 1..28 never clamps.
3. **The generator ran on the UTC date.** `generateDueRecurrences` minted against `today(now)` in UTC at the 08:15 UTC run, so a house west of UTC−8:15 (Honolulu, Alaska) got tomorrow's order today.

The hard fact that shaped the first lane: the CHECK `procurement_orders_recurrence_anchor_day_check` admits `BETWEEN 1 AND 28` for monthly and quarterly (`20260905235800_…:205-215`), because "a monthly rule anchored on 31 is a February that never happens" (`:195-197`). No ADR rules on the month-day anchor or on month end (grep of `.planning/decisions/` for recurrence with anchor / month-end / last day / clamp: nothing).

## Options considered

1. **A — a "last day of the month" anchor value.** One anchor value means month end. Needs the CHECK widened, so a migration.
2. **B — allow 29..31 and clamp each month from the anchor.** Also a migration. Bare 29/30 anchors are the "date that moves twice a year" the original comment warned of, and neither says "last day" in words.
3. **C — keep the cap at 28 and change nothing.** Leaves the carry-forward: an owner who starts on the 31st silently becomes "the 28th" for ever after February.
4. **D — clamp every step from the series' own day, never from the previous occurrence.** For an anchored series that is the anchor; for an unanchored one it is the day of `recurrence_anchored_on`, the start date the owner chose, which every stored series already carries. No migration.
5. **Guess intent from the previous date** ("was it a month end?"). 28 Feb is both "the 28th" and "the last day"; guessing is how the 31st got lost.

## Decision

**Every monthly or quarterly step is clamped on its own month from the series' own day (D), and the anchor admits 1..31, where 31 means the last day of the month (A, in the shape B's range allows).**

- **D, built first** (`fix/sim-recurrence-month-end`): `nextOccurrenceOn(…, anchoredOn)` reads the series' day from the anchor, else from `recurrence_anchored_on`, and clamps it per month through `snapToMonthDay`. "Monthly from 31 Jan" is 31 Jan, 28 Feb, 31 Mar, 30 Apr, 31 May. A series already stored on a carried 28th finds its way back on its next step. The sheet's preview does the same arithmetic and says what a short month does; the untrue "clamped" sentence is gone.
- **The anchor widens to 1..31** (`fix/sim-recurrence-last-day`, migration `20261231200000_an_order_can_repeat_on_the_last_day.sql`, cited by slug: the version is assigned at merge). It drops and re-adds only that one constraint, same name and COALESCE shape, weekday branch untouched, so every row the old CHECK accepted the new one accepts. 31 is the last day; 29 and 30 take a shorter month's last day; each month clamps from the anchor, so nothing is carried from a clamped February and the date does not "move twice a year". The gateway's `anchorRangeFor` / `validateAnchorDay` and the DTO cap move to 31.
- **The owner sees words, not 31.** The sheet offers "Last day of the month" as a named choice (it sends 31); its preview reads "On the last day of every month." or "On the 30th, or the last day of a shorter month."; the ledger row reads "on the last day", never "on the 31st".
- **A due series is minted on its house's date.** The generator holds each due series until its HOUSE's date (`houseToday(zone)`, one zone read per house per run) reaches the due date. A house with no zone, or whose zone cannot be read, falls back to the UTC date, as set and resume already do. The cron stays one 08:15 UTC run.

What carried it: D is the only option that keeps the owner's day inside the old schema and repairs series already stored; "last day" is what an owner means at month end, so it is offered as words, and 31 is the value that reads naturally and clamps through the same function.

## Consequences

- An owner can order on the last day of every month, and a series started on the 29th–31st keeps its day after a short month.
- **Stated cost:** a house west of UTC−8:15 has its order raised on the right date but late in that day (Honolulu: 22:15 local). A per-house cron would fix it; that is OD-92, not this record.
- The legacy `recurring_orders.frequency_day` cap (`recurring-order.dto.ts`) is a different table and stays at 28.
- Widening the generator's query window is not needed: at 08:15Z no zone (max UTC+14, 22:15 the same date) is ahead of the UTC date, so `lte(UTC date)` is already a superset; the per-house filter only holds rows back.
- Revisit if an owner asks for "the last weekday of the month" or "the second Tuesday": those are rules this anchor cannot say, and they would be a new field, not a wider range.

### Rejected

- **C, keep 28 and do nothing else** — the carry-forward stays.
- **B as bare numbers only** — 29/30 without "last day" in words is a date an owner cannot read off the sheet.
- **Guessing intent from the previous date** — ambiguous at 28 Feb by construction.
- **Per-house cron schedules** — OD-92 territory, out of lane.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-09 | sim wave 6 audit (wf_820f143f-0bf) | `fix/sim-recurrence-month-end` 35a75f203 PASS first round |
| 2026-10-09 | sim wave 7 audit (wf_cfea932c-1c8) | `fix/sim-recurrence-last-day` b71df9df3 PASS first round; `supabase/tests/…_an_order_can_repeat_on_the_last_day_test.sql` passes with the migration and fails without it (pgtest2 lane) |
| 2026-10-09 | — | Created from the coordinator's decision note `p4-scratch/sim-run/bulletproof/wave6/recurrence-month-end-decision.md` (outside the repo) |
