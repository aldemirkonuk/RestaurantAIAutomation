# 0271 — /logs reads back from a day the reader names

- **Status:** Proposed 2026-10-03 (fix lane `logs`, branch `fix/logs-jump-to-a-date`). Founder review pending. Two forks are left open below; neither blocks this change.
- **Date:** 2026-10-03
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** logs, timeline, jump to a date, date control, before cursor, inclusive cursor, day boundary, ?date=, A-039, AW06, A-056, lg-turn
- **Links:** [[0086-a-count-confesses-what-it-could-not-count]] (the jumped view claims no exact count and never says the house is empty), [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]] rows 36 and 38 (/logs is live for every house; technical pages may be dense), [[0218-an-alert-finds-its-area-first-a-lead-acts-on-cards-only-and-away-is-dates]] round 4 (the Away withholding lives in the gateway and is untouched), [[0207-a-vendor-is-scored-on-what-it-did-from-the-houses-own-records]] question 6 (the house's local midnight, the likely answer to fork 1), `.planning/06-pages/logs.md`, `apps/web/src/pages/logs/next/MOTIONS.md`, `.planning/tech-debt.d/2026-10-03-fix-logs-jump-to-a-date.md`

## Context

/logs is a newest-first feed walked one cursor page at a time. Its only way back in time was **Read older entries** (`apps/web/src/pages/logs/next/LogsNext.tsx:553` at 8c673db4b). The hook never seeded the cursor: `initialPageParam: null` and a query key with no start point (`useLogsNextData.ts:131,142`). Yet the gateway already takes any ISO `before`: `logs.controller.ts:65` reads it, `logs-timeline.service.ts:150` parses it, `:560-568` normalises it to UTC `Z` and answers 400 to garbage, and `:578-584` applies it as an inclusive `<=` OR `is.null`.

On the owner-quarter sim (Tuzlu Rüzgar, 2026-10-03, read-only), reaching 22 July from the default view took at least 28 presses, past 2,401 newer till checks. That figure is a model lower bound from that walk (findings AW06 and A-039, `p4-scratch/sim-run/fixes/briefs/logs.md`). This lane made no production calls and did not re-measure it. The register chips do not help: they sieve rows already loaded (`LogsNext.tsx:650`).

## Options considered

1. **Seed the existing cursor from a named day (chosen).** Web only. One bounded request of 100 rows, read through the indexes the gateway already uses (`idx_pos_checks_restaurant_opened`, `idx_inv_txn_restaurant_date`).
2. **The house DayStrip as the selector.** Each day would need a record state (anything here or not), which means a server-side aggregate this web-only lane cannot add. A month strip is also a poor way to reach a day months back.
3. **Read on change instead of on submit.** A native date field fires a change for every intermediate value while a year is typed, and each change would be a read.
4. **Seed the end at 23:59:59.999.** That silently drops a row stamped in the last millisecond. The service header's rule is that a dropped row costs the truth.
5. **Filter rows newer than the day out of the web page.** That hides real rows. A row past the boundary keeps its own day heading instead.
6. **Drop the date when entering a thread.** The reader then loses the day they came from.
7. **A forward walk ("Read newer entries").** It needs an `after` cursor on the gateway, which is fork 2.
8. **Do nothing.** A day months back stays dozens of presses away.

## Decision

The reader names a day, and the feed reads back from the end of that day by seeding the gateway's existing inclusive `before` cursor.

- **The boundary.** The seed is the start of the NEXT day, as ISO-8601 (`parseDay` in `lg-format.ts`). The cursor is inclusive, so nothing on the chosen day drops. A row stamped exactly at the next midnight is read too, and shows under its own heading.
- **The zone.** The day ends where the day headings end it: the same local calendar `dayKeyOf` uses. `lg-format.test.ts` pins the pair: `dayKeyOf(end − 1ms)` is the day and `dayKeyOf(end)` is the next day. If either side moves to another clock without the other, that test fails. Which clock is right is fork 1, and it is not chosen here. Measured outside the suite's New York pin on 2026-10-03: every day of 2026 holds the pair in nine zones, including Havana and Beirut, which change their clocks at midnight.
- **Strict parsing.** Only `YYYY-MM-DD` that survives a calendar round trip is read. `2026-02-30`, `2026-7-22` and a value with spaces around it are refused.
- **The address.** `?date=YYYY-MM-DD`, the name /calendar already uses (`CalendarNext.tsx:282`). The URL is the one source of truth, as it already is for the thread, so the back button undoes a jump.
- **A thread reads whole.** A date never cuts a thread short, so "Ruled off" stays true. The date stays in the address, so leaving the thread returns the reader to the day they jumped from.
- **The form.** A native `<input type="date">` with `max` set to today, labelled *Read back from a day*. It reads on submit only, never on change. The key map already ignores a focused input, so typing `j` in the field moves nothing.
- **Honesty for a jumped reading (ADR 0086).** Every register count carries `≥`, because entries after the day are unread. The foot says *Showing N entries back from the end of <day>*, or *All N entries up to the end of <day> are on the page; entries after it are not read here*, and never *All N entries the registers hold*. The empty state says *Nothing is recorded on or before <day>*, and never *hold nothing for this house yet*. A quiet band names the reading and carries **Back to the newest**. A `?date=` the page cannot read is said in words (`role=status`), and the feed starts at the newest entry. That mirrors the gateway's own `parseCursor` rule.
- **Motion.** `lg-turn` keys on the reading (a thread, or the feed plus its day). The page turns when a jumped reading lands and again on Back to the newest, but never on arrival.

## Open forks (not decided here)

1. **Which clock defines "a day" on /logs:** the viewer's browser zone (the headings today, `lg-format.ts:162-169`), or the house's `restaurants.timezone` with the viewer's zone as a fallback (ADR 0207 question 6)? This is finding A-056, owned by the `tz` lane (`p4-scratch/sim-run/fixes/briefs/tz.md:46`). The jump follows the headings by construction, and the invariant test enforces it.
2. **Should /logs also walk forward after a jump?** That needs an `after` cursor on `GET /logs/timeline`, plus its own ADR and PR. Until then, a reader names a later day or uses Back to the newest, and the page says that entries after the day are not read.

## Consequences

- A day months back is one request instead of dozens of presses, and the jump is a link that can be shared.
- The jumped view is honest about its edge: every count is a floor, and no sentence claims the registers are exhausted.
- **Given up:** reading forward from a jumped day, and per-register depth (roadmap 5b). Both are gateway changes.
- **Recorded alongside, not fixed:** `pos_checks` is windowed and ordered on `opened_at` (`logs-timeline.service.ts:225`) but dated by `closed_at || opened_at` (`:232`). A jumped day can therefore open with checks that closed after it, shown truthfully under their own heading. Filed OPEN in `tech-debt.d/2026-10-03-fix-logs-jump-to-a-date.md`, for a gateway lane.
- **Revisit when** fork 1 is ruled (the headings and the jump move together), or when a gateway `after` cursor lands.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-03 | — | Created (fix lane `logs`, Proposed) |
