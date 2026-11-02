# 0350 — Punches pre-fill what /team shows, not the hours payroll pays on, and a manager marks every shift

- **Status:** Proposed (2026-10-31)
- **Date:** 2026-10-31
- **Decider:** the founder's pick 10, *"Punches on /team"*, and pick 3, *"On-break handoff"* (› Context); every rule below that his option texts do not state is the executor's call under the founder's 2026-10-31T16:57:09Z delegation (OD-242 (OPEN-DECISIONS.md:329 on main)), not his pick, and a lock is his. It answers OD-235 with its narrow option and leaves it open.
- **Keywords:** punches, day-end sheet, confirmed hours, recorded_break_min, labor_cost, Art. 68
- **Links:** [ADR 0345](0345-floor-checker-is-ported-into-mudavym.md) (the port; its § Context holds the founder's picks); ADRs 0215 and 0218 (Locked; cited, not edited); ADR 0020. Open: OD-193, OD-235, OD-236, OD-243 (OPEN-DECISIONS.md:330 on main).

## Context

ADR 0215 plans a day-end sheet on which a manager marks each planned shift, "the attendance sheet (puantaj) without a clock" (`0215:1231-1233`), and a month-end export of those confirmed hours for whoever runs payroll (`:1239-1240`); Mudavym computes no pay and hands hours over (`:1223-1225`). The sheet is not built.

The founder's pick 10, *"Punches on /team"*, brings the clock. His option text (AskUserQuestion asked 2026-10-31T03:41:53Z, Q3): "One Clock-in button works the same from the floor phone and from My Shifts, and the /team week shows punched times beside planned ones. This is your 'interworkable with /team'. It amends ADR 0215; wages stay on planned hours." His pick 3, *"On-break handoff"* (Q1), says: "Waiter taps 'On break' and their tables and alerts pass to the cover until 'Back'. The manager can record the break on the shift in one tap."

What punches do to the sheet is OD-235. The fork was put to him (AskUserQuestion asked 2026-10-31T16:57:03Z, Q1) with two options: *"Pre-fill, manager confirms (Recommended)"* (each shift opens on its punched start and end; the manager confirms or corrects every shift) and *"Show beside only"* (punches appear next to planned times; the manager types every change by hand, as ADR 0215 describes today). The result was *"Tool permission request aborted"*: no option was picked, the (Recommended) one included. His goal message followed at 2026-10-31T16:57:09Z.

`labor_cost`, a `shifts` column, is priced on planned hours today: `priceShift` in `apps/api-gateway/src/team/pay-rules.ts` multiplies `workedHours`, the planned span less the counted break, by the person's hourly wage, and gives `null` with no wage on file; claim ADR-0345-WAGES-PRICED-ON-PLANNED-HOURS checks it. The counted break is `recorded_break_min` when set, else Art. 68's minimum, marked assumed (`breakCounted`).

## Decision

**Punches are shown beside the plan, on the /team week and on the day-end sheet, and pre-fill only two things: that display, and pick 3's break tap, the one path from a punch to `labor_cost`. The hours payroll pays on stay the planned hours as the manager marks them on ADR 0215's sheet: no punch pre-fills, changes or confirms them, save the break a manager confirms through pick 3's tap (› The tap).**

- **OD-235's answer is its narrow option, *"Show beside only"*.** The prompt got no pick; it is answered here only because of his 16:57:09Z goal message. It is taken with the one exception his pick 3 makes: the break a manager records in one tap (› The tap) is the break on record the sheet opens on. Whether punches pre-fill the confirmed hours is his (› Consequences). This answer is reversible: punches are kept as tapped (› Retention), so a later pre-fill can read every one.
- It keeps pick 10 on both readings of "wages stay on planned hours": as /team's `labor_cost`, which stays the planned span less the counted break (› No punch re-prices a shift), and as the hours payroll is handed, which stay the planned hours the manager marks.

Code paths are under `apps/api-gateway/src/` and migrations under `supabase/migrations/` unless another root is named.

### Where a punch is shown

- A punched time is its punch's instant on the house's clock, `houseFrame`'s: the house's zone, else its country's only zone (`common/house-frame.ts:212-228`; ADR 0215 item 26, `0215:809-811`), rounded to the nearest minute, a half minute up. A planned time is placed as `shiftWindow` places it (`notifications/producers/shift-window.ts:79-117`), past-midnight ends and clock-change nights included (`calendar/reminder-window.ts:69-80`).
- A punched span shown beside a plan follows /team's span rule: today the wall clock, `hoursBetween` (`team/pay-rules.ts:927-931`), later whatever OD-193 settles. Elapsed time is shown with it, and a span the clocks change inside shows both, flagged.
- Which planned shift a punch is shown beside is read when the view opens, by person and time. Only a plan row in a presence state, not open and not called out (`isPresenceState`, `shift-window.ts:68-71`), is matched. The punch's shift link, set once at the tap, only breaks ties, since a shift can change hands after it (a cover, `team/schedule.service.ts:930-947`; a new person, `:728`).
  - A punch is shown beside the person's planned shift whose window it overlaps the most; ties go to the shift its link names, then to the earlier planned start. An open punch is matched on its clock-in: the shift whose window holds it, else the person's next planned start within that shift's planned span after it.
  - A punch that overlaps no window is shown beside the shift of the punch before it in the same presence (a punch and the *Back*s that resume it, in turn), else of the one after, only when the time between it and that shift's planned window is no longer than the planned span.
  - Otherwise it is shown on its own, marked *punched, not planned*. It creates no /team shift, no sheet row and no hours, and prices nothing. A manager who wants that time handed to payroll adds the shift on /team, which /team prices as it prices any shift it creates, and marks it on the sheet. Every punch is like this in a house that plans no shifts.
- A view shows only a person's punches in that house. A forgotten clock-out, a punch with no clock-out, and a punch closed on *On break* with no *Back* are shown as they stand, flagged; none is closed or completed by a guess.
- With no house zone (`houseFrame` resolving none) or a failed read of the house, no punch is placed on the clock and none is matched: the view counts the punches waiting for a zone, and the tap is not offered. No person's device zone stands in for the house's.
  - Today that is the one real house: ADR 0149 records its `restaurants.timezone` NULL (`20260903170000_a_default_is_not_an_answer.sql:189`), and its country, US, keeps many zones (`0149:388-393`). Until an owner or manager sets Settings › Time zone (`settings/settings.controller.ts:378-389`), no punch there is placed beside a plan; for that house the keystroke is the founder's.
- A failed read of the punches shows the plan with the line that punches could not be read, never as *not punched*.

### A manager marks every shift

- The sheet, when ADR 0215's labour page builds it, opens each planned shift on its planned times and its break on record, as ADR 0215 plans it (`0215:1231-1233`). The row's punches, its closed *On break* / *Back* pairs and their sum are shown beside it, with the gap between plan and punch. The manager marks every shift *worked*, *changed* (start, end, break) or *no-show*, and types every change by hand.
- A break on record keeps its meaning on the sheet: NULL, 0 and n mean nothing recorded, no break taken, and n minutes (`20261201110100_a_shift_over_four_hours_has_a_break.sql:17-21`) (ADR 0215 item 10, `0215:345-355`). No punch fills it on the sheet; a break a manager recorded through pick 3's tap (› The tap) is already on record when the sheet opens.
- There is no bulk confirm, and nothing confirms itself. A punch that differs from the confirmed hours is kept as it was, beside them.

### No punch re-prices a shift

No punch re-prices `labor_cost` by itself; Clock in, *On break* and *Back* price nothing. The one path from a punch to it is pick 3's manager tap (› The tap).

- The tap records the minutes the manager confirms, and `updateShift` re-prices `labor_cost` in the same UPDATE (`schedule.service.ts:771`, `:812-841`), on the planned span less the minutes recorded (`laborCost`, `:603-625`). That keeps wages on planned hours, on the executor's reading (› Evidence).
- Otherwise only /team's own writes price a shift: creating, editing, covering and copying (`schedule.service.ts:699`, `:812-833`, `:1015-1061`, `:443-445`), and the removal split and hand-over (`pay-rules.ts:510-518`).

### The tap

- After *Back*, a manager records the break on the planned shift the punches are shown beside (› Where a punch is shown), through the existing `PATCH shifts/:shiftId` (`team/team.controller.ts:252-260`): `updateShift` (`schedule.service.ts:711`), which needs manager access (`:717-724`; `team.service.ts:227-238`).
- The field is the shift's whole break: `recorded_break_min` is one total per shift (`20261201110100:29-30`), and `updateShift` writes the minutes sent as its whole value (`schedule.service.ts:764-771`). It opens on the part of the shift's closed pairs inside the planned window, in whole minutes, the unit /team accepts (`:643-647`), so a second break adds to the first. When the break on record differs from that total, the tap shows both and says the one on record will be replaced. A corrected punch is read as its newest correction.
  - An open pair, a pair whose punches are shown beside different shifts, an in-window total of 0 and a punch shown on its own give no tap.
- Before the write, the tap shows each pair's times, the total, the minutes outside the window, the break on record and the total it will write. In a Turkish house, one whose `restaurants.country` resolves to `TR` (`resolveHouseCountry`, `organizations/house-state-country.ts:326`), it shows the planned shift's Art. 68 minimum (`art68MinimumBreak`, `pay-rules.ts:970-975`). Elsewhere, an unset country or a failed read included, it says the minutes are taken off /team's labour cost as unpaid break. The manager confirms in one tap or edits the minutes first, so it is never confirmed unread.
- It opens filled in every house. The break it records is also the break the sheet opens on, so once a manager marks the shift it reaches the hours payroll is handed (› A manager marks every shift). /team reads every recorded break as unpaid, Art. 68's reading, in every house (`pay-rules.ts:1013-1034`); US federal rules count a rest of about 20 minutes or less as hours worked (29 CFR 785.18). Per-house labour rules are owed, not changed here.
- The tap is offered again when the shift's planned times change after it, so a widened shift is not left pricing a clipped break.
- When /team refuses the write (a break as long as the planned shift, 400, `schedule.service.ts:642-647`; a removed person's kept shift, 404, `assertOnTheRoster`, `team.service.ts:494-516`), nothing is written and the tap says why. A failed write says it was not saved and is never retried by itself.
- A total under the minimum is recorded as taken, and /team names it "break under the legal minimum" (`0215:353-355`); recording the minimum instead would be an answer nobody gave (ADR 0020).
- A tapped break is a break on record like any other: Copy week carries it (`schedule.service.ts:421-437`; ADR 0215 item 11, `0215:370-372`). The waiter's own taps write nothing to /team.

### Retention

Every punch is kept on the terms of his pick for a leaver's floor figures, *"Keep, owners/managers only (Recommended)"* (AskUserQuestion asked 2026-10-31T16:54:31Z, Q2), whose option text reads: "Their history stays as it was, named, visible only to owners and managers, like their shifts on /team. Deleting or anonymising later waits on the retention answer ADR 0218 already sent to counsel."

- Owners and managers see a removed person's punches wherever punches are shown, save beside that person's kept shifts, which ADR 0215 item 22 shows the owner alone, in the former-staff history (`0215:599-617`; `listFormerStaff` asserts the owner, `team.service.ts:1892`).
- Nothing is deleted or anonymised until counsel answers ADR 0218's retention item (`0218:571-575`, which names only that ADR's house-log rows).
- A punch is not on ADR 0215 item 20's five-year clock, which names a removed person's shifts and leave requests (`0215:457-462`). A shift that job deletes leaves its punches with their times and person. Holding every punch to that pick is the executor's call under the founder's delegation (› Options considered).

### What the build owes

Each is what a lock of this record would owe, before or with the code it names.

- **A punch table.** Owed: a punch table linked to `public.shifts` by a nullable shift id, set once at the tap, keyed to the team member; append-only, a manager's correction a new audited row naming the punch it corrects; *On break* and *Back* stored as an out-and-in pair, a *Back* naming the break it resumes; one open punch per person per house; and a deleted shift setting the link to null, never deleting a punch. No file that prices a shift reads it. Its unpushed lane (`feat/a-shift-is-punched-and-food-is-up`) re-points its ADR 0345 cites and tap text here before it pushes.
- **One Clock in, on /team.** Owed: one clock-in and clock-out endpoint in the team module, called from My Shifts and from /floor/me, and a punched-hours lens beside the planned hours in the /team week, labelled "punched, not confirmed", showing hours, not money.
- **A punch notice.** Owed: beside every Clock in, on My Shifts and /floor/me (on the host OD-237 settles), a line, not a dialog, saying punches are kept and shown beside the planned hours, naming each use merged when it ships: the /team display and the sheet's, goal notices naming who was clocked in (pick 8, *"Goal notices name who worked"*), the alert chain's reads of who is working, the no-show and forgotten clock-out flags (pick 6, *"No-show + forgotten clock-out"*), and the recorded break. It asks for no tap.
- **The forgotten clock-out flag** names the punch it flags, so the views show it beside that punch.
- **The tap** ships on the /floor manager board, with tests for these rules, two closed pairs on one shift in a Turkish house among them.
- **ADR 0215 is not edited here.** Its bracket, that the sheet and the week show punches beside the plan and that no punch confirms hours, goes in its own PR for the founder's review.

## Options considered

Each rejection here is the executor's call under the founder's 2026-10-31T16:57:09Z delegation.

- **(B) Pre-fill, manager confirms:** the (Recommended) option at 16:57:03Z, which he did not pick. Punches would open the sheet's confirmed hours, so payroll's hours would start from the clock, not the plan. It reads pick 10's "wages stay on planned hours" against the hours payroll is handed, and changes ADR 0215's sheet further than his option text does. Not taken without his pick; it is OD-235's open path.
- **(C) Punches are the confirmed hours, a bulk confirm, or auto-approve on agreement:** a tap becomes what ADR 0215 hands payroll (`0215:1239-1240`), and a gamed tap reaches the export unseen.
- **A floor break that never writes `recorded_break_min`:** refuted by an adversary pass; it drops pick 3's tap.
- **A one-tap adopt of the punch on the sheet:** it lets an unread row confirm, which (B) without the mark would.
- **Pre-filling the break as 0:** it says "recorded as no break taken" (`20261201110100:20`), an answer nobody gave (ADR 0020).
- **Elapsed time alone:** OD-193's open path (b); a clock-change night would get two hour counts.
- **The manager's device zone:** a person's zone, not the house's clock.
- **Matching a punch with no bound:** a *Back* the next day would join a shift it is not part of.
- **The five-year clock for punches:** it ends a record before counsel answers, which his pick waits for.
- **Re-offering the tap whenever the record differs:** a deliberate edit is nagged forever.
- **Not carrying a tapped break in Copy week:** it changes Locked ADR 0215 item 11 (`0215:370-372`).
- **A Turkey-only tap, a US-law line:** the first drops pick 3 outside Turkey; the second ships a legal reading counsel has not read.

## Evidence

- Pick 10's option text says "the /team week shows punched times beside planned ones" and "It amends ADR 0215; wages stay on planned hours" (› Context). Reading "wages" as `labor_cost` is the executor's reading (`0215:1223-1225`); planned hours hold on that reading and on the payroll reading.
- The sheet and the clock are not built. No tracked file under `supabase/migrations` or `apps/api-gateway/src` names a confirmed-hours, attendance, puantaj or punch column (claim ADR-0350-NO-CLOCK-OR-SHEET-YET checks it), and the clock-in lines there say there is none (`notifications/producers/roster.ts:16`). So no figure changes today.
- The gamed tap: once check-ins are management evidence, staff tap from the pass or for each other, and the system produces "confident, false compliance data" (`.planning/01-org/product/product-vision/teams/service-floor/service-floor-premortem.md:49-52`).

## Consequences

**Retire-to-write (CLAUDE.md §4).** This file is the one decision record §5 requires. It retires no document, as ADR 0314 did. Whether retire-to-write binds a new ADR is OD-243 (OPEN-DECISIONS.md:330 on main), open.

- **Easier:** pick 10 and pick 3 ship without settling OD-235; payroll's hours keep ADR 0215's shape.
- **Harder:** the manager types every change the punches show, and worked time no plan held reaches payroll only once a manager adds its shift on /team.
- OD-235 stays open; this answer is marked on its register row. OD-237 stays open.

## Not verified

- **Law.** Turkish labour law (4857 Art. 68), KVKK and US 29 CFR 785.18. Counsel has read none; every country rule is the executor's reading of /team's code.
- **The research and adversary passes:** not re-run; kept outside the repo.
- **Not re-measured:** `shifts` empty in the one real house (`0218:40-41`); its `restaurants.timezone` NULL (ADR 0149; Settings may have set it since).
- **Open forks:** OD-235 (the confirmed hours), OD-193 (the span), OD-236 (the service day).
- **Unbuilt:** the punch table, the endpoint, the lens, the notice, the forgotten clock-out flag (undesigned) and the tap.
- **Clock-change placement:** probed with a node copy of main's `zonedWallTimeToInstant`, America/Los_Angeles only; not main's own test.
- **The punch-table lane** is unpushed and was not re-read against this narrowed text.
- **No test** yet for the clock-change, no-zone, outside-window and planned-span matching rules, or the tap.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-31 | fork-answer fold | OD-235 answered (B), shaped |
| 2026-10-31 | adversary pass | A floor break with no `recorded_break_min` write refuted |
| 2026-10-31 | judge, OD-235 | ADR 0215 bracket in its own PR; the tap the one path to `labor_cost` |
| 2026-10-31 | judge rounds 3-4, OD-235 | Pairs ahead of the record; an unplanned punch its own row; the punch notice |
| 2026-10-31 | judge rounds 5-6, OD-235 | Pairs pre-fill only in a Turkish house; punches kept until counsel answers |
| 2026-10-31 | restructure | Moved out of ADR 0345 |
| 2026-10-31 | decision judge, OD-235 | Span follows /team's (OD-193 open); the tap opens filled in every house |
| 2026-11-01 | executor | R3 rewrite: no held-note cites; single decision record |
| 2026-11-01 | executor | Narrowed to pick 10: punches pre-fill only the display and the tap; payroll's hours stay planned; OD-235 answered "Show beside only", open |
| 2026-11-01 | executor, adversary round 2 | OD-235 marked in the same PR; the tapped break reaching payroll's hours said |
