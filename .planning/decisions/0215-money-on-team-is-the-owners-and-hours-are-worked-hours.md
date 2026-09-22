# 0215 — Money on /team is the owner's, and hours are worked hours

- **Status:** Locked (the founder's four picks, 2026-09-21, and his answer the
  same day to the five forks this record first left open: "Take all five"). The
  design below applies them; what is still unsettled is listed under "Open, for
  the founder" and is not decided here.
- **Date:** 2026-09-21
- **Decider:** Aldemir (founder) — four picks and one answer to five forks,
  quoted verbatim below
- **Keywords:** team, wage, hourly_wage, labor_cost, wage_visible, owner only,
  money rule, breaks, 4857 Art. 68, assumed break, recorded_break_min, 45 hours,
  overtime review, copy week, re-price, paid leave, leave_type,
  time_off_requests, team_member_wage_changes, append-only, retention, five
  years, team_member_departures, purge_expired_wage_records, labour settings,
  owner only switch-off, house currency, Intl, KVKK, labour page
- **Links:** [[0088-a-team-change-is-recorded-and-a-wage-is-not-invented]],
  [[0051-rebuilt-pages-show-live-data-only]], ADR 0117 (Q25, a house names its
  money), `supabase/migrations/20260921170200_a_wage_is_the_owners_and_every_change_is_kept.sql`,
  `supabase/migrations/20260921170900_a_shift_over_four_hours_has_a_break.sql`,
  `supabase/migrations/20260921170910_a_wage_record_is_kept_five_years_after_leaving.sql`,
  `apps/api-gateway/src/team/pay-rules.ts`,
  `apps/api-gateway/src/team/wage-record-retention.service.ts`,
  `apps/api-gateway/src/team/team-pay.spec.ts`,
  `apps/web/src/pages/team/next/TeamPay.test.tsx`,
  `apps/web/src/pages/team/next/TeamBreaks.test.tsx`

## The founder's words

Asked on 2026-09-21 after the labour-page judge's pass, verbatim:

| Question | Pick |
|---|---|
| Should we fix the six /team defects before building the labour page? | **"Fix /team first"** |
| Who may see wages and labour cost? | **"Owner only"** (managers see hours but not money) |
| Should Mudavym work out pay, or hand the month's hours to whoever runs payroll? | **"Hand hours over"** (no pay computed in Mudavym) |
| Should the page handle monthly salaries, not just hourly pay? | **"Monthly and hourly"** (the labour page builds pay types; not here) |

Asked later on 2026-09-21 the five questions this record first left open (they
are kept, answered, under "Answered, 2026-09-21" below), he picked, verbatim:
**"Take all five"**. The five options he took, as the orchestrator relayed them
(the options' wording, not his):

1. A shift over 4 h with no break recorded assumes the Labour Law 4857 Art. 68
   minimum (15 min up to 4 h, 30 min over 4 h up to 7.5 h, 60 min over 7.5 h),
   shown as "assumed break", editable by whoever edits the shift.
2. A person's wage-change history is kept 5 years after they leave the roster,
   then deleted.
3. Only the owner can switch labour-cost tracking off or change the labour
   target.
4. Paid leave stays as days, not priced.
5. Whoever approves leave marks it paid or unpaid, and staff may state it on
   their own request.

## Context

The labour-page judge (session scratch `q921/labor-judge.md`, §2.6 and §3.0,
read at `origin/main` 9cfc4e96d) found that `/team` could not carry a labour
figure honestly, and that one of its defects was a privacy leak, not a number:

1. **Dollars.** `apps/web/src/pages/team/next/tm-format.ts:24-28` formatted
   every labour figure as `Intl.NumberFormat('en-US', { currency: 'USD' })`. A
   house in Türkiye read its labour cost as `$`. Tracked nowhere.
2. **The wage leak.** `team_settings.wage_visible` blanked `hourly_wage` only in
   `listMembers` (`team.service.ts:156,211`). `getWeek`
   (`schedule.service.ts:90-133`) returned every shift's `labor_cost` to any
   manager, and `labor_cost / (end - start)` is the wage, to the cent. The flag
   also had no role in it, so switching it off hid wages from the owner too.
   The shift writers (`createShift`, `updateShift`, `reportCallout`) returned
   `labor_cost` to managers as well; only `assignCover` stripped it, and only
   for staff.
3. **Unrecorded wage writes.** `updateMember` was manager-gated
   (`team.service.ts:403`) and overwrote `hourly_wage` in place (`:417`): a
   manager could set anyone's wage, their own included, and no row anywhere said
   who, when, or what it was before.
4. **Breaks counted as work.** `hoursBetween` (`schedule.service.ts:29-33`) was
   end minus start, and it was the only input to cost, to the week's hours and
   to the over-the-week flag. Labour Law 4857 Art. 68: a break is not working
   time. Five 10-hour shifts with a one-hour break are 45 worked hours; they
   counted as 50.
5. **A copied week kept the old cost.** `copyWeek` wrote `labor_cost:
   s.labor_cost` (`schedule.service.ts:292`), so a week copied after a raise —
   every January minimum-wage rise — kept last year's cost.
6. **Paid leave read as free.** `time_off_requests` has dates, a status and a
   free-text reason, and no paid/unpaid type. A person on annual leave (paid,
   4857 Art. 53) has no shift, so the week read their holiday as zero cost.
7. **The 40-hour rule.** `computeLabor` flagged `h > 40`
   (`schedule.service.ts:872`), the US FLSA week, and the page said "Over 40h
   before publish" (`TeamNext.tsx:562`), "Crosses 40h" and "OT risk"
   (`ManagerShiftDesk.tsx:194,221,658,699,805`), `WeekGrid.tsx:147,160,328`. The
   Turkish week is 45 hours (Art. 63), and whether an hour over it is overtime
   pay depends on averaging agreements, part-time contracts and the worker's
   written consent, none of which Mudavym holds.

Two more were found while fixing these, same file, same figure:

8. **A called-out shift was paid twice.** `reportCallout` marks the shift
   `callout` and keeps its `labor_cost`; the cover shift is then priced too, so
   the week's total and the caller's hours counted a slot that nobody in it
   worked.
9. **A failed week read was an empty week.** `getWeek` destructured only `data`
   from the shifts read, so a failed read returned zero hours and, for the
   owner, a complete zero cost.

Production shape, not re-measured today (this session has no database
access): on 2026-09-02 the live house held 0 shifts, 0 schedules and 0
`team_settings` rows, and its 11 roster rows were 8 owners and 3 managers
(ADR 0088). None of the defects above has produced a wrong figure in
production yet. That is the reason to fix them before the labour page reads
from them, not a reason to wait.

## Options considered

**Who sees money.**
1. *Keep `wage_visible`, extend it to `labor_cost`.* Rejected: it is a house-wide
   switch, not a viewer's right. Off, it hides wages from the owner; on, it shows
   them to every manager. Neither is the founder's rule.
2. *A per-role setting the house can change.* Rejected: the founder chose a rule,
   "Owner only", not a setting; a setting is a second place the rule can be
   wrong.
3. **A role, applied where each response is built.** Chosen. One test,
   `seesMoney(role) = role === "owner"` in `pay-rules.ts`, used by every
   response that carries money. "Sees labour cost" and "sees wages" are one
   permission, because a cost next to a visible schedule is a wage (judge §2.6).

**How a wage change is recorded.**
1. *Two gateway writes (update the wage, then insert a history row).* Rejected:
   not atomic. Either order leaves a window where the wage moved and the record
   did not, or the record names a change that failed.
2. *An RPC that does both.* Considered. Atomic, but a wage written by any other
   path (a script, the SQL editor, a future writer) leaves no row.
3. **A trigger on `team_members`, with the writer named in the same statement.**
   Chosen. The gateway sets `wage_changed_by` beside `hourly_wage`; a `BEFORE`
   trigger writes the `team_member_wage_changes` row (who, their role then, when,
   old, new, the house currency then) and clears the parameter, so it is `NULL`
   at rest. One statement: they commit or fail together. A writer that does not
   name itself is recorded as not recorded, never as the previous writer.

**Breaks.**
1. *Assume the legal minimum (15 min / 30 min / 1 h by shift length) when none
   is recorded.* First not taken: it would invent a break the shift does not
   carry, so it went to the founder. **He took it ("Take all five", option 1),
   with the assumption shown as assumed and the real break recordable** — see
   the second half of the Decision.
2. **Subtract the breaks the shift carries.** Chosen, and kept: a recorded
   break always wins over the assumption.

**Which minimum an unrecorded shift assumes.** The statute text, read
2026-09-21 on a mirror of 4857 (`app.e-uyar.com`, Madde 68; `mevzuat.gov.tr`
refused this session's fetch with a TLS certificate error): (a) *"Dört saat veya
daha kısa süreli işlerde onbeş dakika"*, (b) over four hours up to and
including seven and a half, half an hour, (c) over seven and a half, one hour;
the breaks *"en az"* (minimums); and, last, the breaks are not counted as
working time. The founder's thresholds match it. The fork is what "the length
of the work" is measured on:
1. *The shift's span.* Rejected: an 8-hour shift would assume 60 minutes and
   count 7 hours, although 7.5 hours of work owes only 30 (item b). It also
   counts the break as part of the work that sets the break, which the last
   sentence of Art. 68 rules out. Labour-law commentary found by a web search
   the same day (tahanci.av.tr) sets the break on the actual working time, not
   the time between the start and the end; that reading was not checked
   against a court decision, so it is also returned as a question.
2. **The least statutory break the shift's remaining work allows** (chosen,
   `art68MinimumBreak`): the first of 15, 30, 60 that is at least what Art. 68
   owes for the span minus that break. A 4h01m–4h15m shift assumes 15, up to 8h
   assumes 30, longer assumes 60. It is also the error on the safer side for
   this figure: the span reading's larger assumed break (60 on an 8-hour
   shift) would count fewer hours and less cost, so it would understate both.
   The choice among the three statutory values only (not, say, 31 minutes on
   an 8h01m shift, which would also comply) is this record's reading: it makes
   an 8h01m shift count fewer worked hours than an 8h00m one (7h01m vs 7h30m),
   the step the tiers of Art. 68 carry either way.
3. *Also assume 15 minutes on a shift of 4 hours or less (item a).* Not built:
   the pick names shifts over 4 hours only. Returned as a question.
4. *Assume 1.5 hours on a day over 11 hours* (reported by the same search as
   the Yargıtay's practice on long days; not verified against a decision). Not
   built: it is not the statutory minimum the pick names.

**Where a recorded break lives.** `shift_breaks` (baseline) holds planned
breaks with a start time and a cover; no product path writes it. A new nullable
`shifts.recorded_break_min` (migration `20260921170900`) is written in the same
UPDATE as the re-priced cost, so the record and the price commit or fail
together: `NULL` nothing recorded (assumed if over 4 hours), `0` recorded as no
break taken, `n` minutes. Rejected: writing `shift_breaks` rows (a second
statement, and a planned-break shape nobody fills in); a boolean "break taken"
(it cannot say how long).

**How long a wage record is kept, and how it is deleted.**
1. *A foreign key from the record to `team_members` with `ON DELETE
   CASCADE`.* Rejected: removing a person would take their pay record the same
   second, which is the opposite of the pick.
2. *A job in the gateway that works out who is due and deletes them.*
   Rejected as the only guard: a bug in it could delete early.
3. **The rule in the database, called by a nightly job** (chosen). When a
   person with a wage record is removed from the roster, a trigger writes a
   `team_member_departures` row stamped by the database (a writer cannot
   backdate it). The append-only guard gains exactly one exception: a row whose
   person left more than `wage_record_retention()` (5 years) ago and is not on
   the roster now. `purge_expired_wage_records()` (SECURITY INVOKER,
   service_role only) deletes those rows and then their departures; the gateway
   calls it at 03:23 nightly (`WageRecordRetentionService`, `@nestjs/schedule`,
   the scheduler the other gateway jobs use). A bug in the job can fail to
   delete; it cannot delete early, because the table refuses.

**Who may switch labour-cost tracking off or change the target.** A per-role
setting (rejected, as for money) versus **a rule in code, `labourSettingsRefusal`
(owner only), refused before any write, and every change the save makes
recorded in `system_audit_log`** (chosen). Switching tracking ON is not named in
the pick: it stays with whoever may save the settings, and is returned as a
question rather than decided.

**Leave type.**
1. *A kind of leave (annual, sick, unpaid, …).* Rejected: "sick" is health data,
   a KVKK special category, and nothing here needs it.
2. **Paid / unpaid / unknown, default unknown.** Chosen: the minimum that stops
   paid leave reading as free, and `unknown` is the honest state of every
   existing row.

**The over-the-week flag.** Priced at 1.5x (rejected: Mudavym cannot know
whether an hour is overtime pay) versus **a review at 45 worked hours, no
price** (chosen, the judge's §2.2 revision).

Doing nothing would have left a manager able to read and set every colleague's
wage, and the labour page built on a figure that is wrong in both directions.

## Decision

**Money on /team — wages, a shift's cost, and every total derived from them — is
returned to the owner only, by role, on every endpoint that carries it. A
manager sees hours.** And the week's hours are worked hours.

What changed, each with a test that fails on `origin/main` 9cfc4e96d:

1. **House currency.** `fmtMoneyWhole` / `fmtMoneyExact` (`tm-format.ts`) print
   in the house's currency, which the gateway now sends with the money
   (`week.money`, owner only), in the house's locale, derived by `Intl` from its
   country (`Intl.Locale('und-TR').maximize()` is `tr-Latn-TR`). No currency is
   "currency not recorded", never a symbol. The legacy desk's two `$` literals
   and the export's cost column (header now names the currency) go the same way.
2. **The money rule.** `getWeek`, `createShift`, `updateShift`, `assignCover`,
   `reportCallout` remove `labor_cost` for anyone but the owner; `listMembers`,
   `createMember`, `updateMember` remove `hourly_wage`. The key is removed, not
   nulled, because `null` already means "no wage on file". A manager's labour
   block carries hours, break hours and the 45-hour review, and no cost, no
   priced/unpriced counts, no cost target and no leave split. The web shows a
   manager "Wages and labour cost are shown to the owner only", no wage field,
   and an export with no cost column. Swept: `grep labor_cost|hourly_wage|wage`
   across `apps/api-gateway/src`, `apps/web/src`, `apps/mobile/src`; the only
   other readers are `notifications/producers/roster.ts` (no money columns) and
   the mobile week query (renders no labour field).
3. **The flag.** `team_settings.wage_visible` is retired: the gateway no longer
   reads it, no longer returns it (`getSettings` and the settings save both
   answer `moneyVisibleTo: "owner"` instead), and refuses a write to it with a 400 in words rather than
   letting the whitelist pipe drop it silently. The column stays (migrations here
   only add) with a comment saying it is retired. The settings switch "Show
   hourly wages" is gone.
4. **Wage writes.** Only an owner may set or change a wage — a manager is
   refused with a 403 before any write, their own wage included; a manager may
   still add a person without a wage and edit everything else. Every change is a
   row in `team_member_wage_changes` (append-only: UPDATE, DELETE and TRUNCATE
   refused except the referential actions of its own foreign keys; RLS on;
   anon/authenticated revoked). `changed_by` references `public.users(user_id)`,
   the id the JWT carries, never `auth.users`.
5. **Breaks.** `workedHours = span − Σ shift_breaks.duration_min` everywhere a
   figure is made: cost on every re-price, the week's hours, the per-person
   hours, the review flag, the grid, the roster, the export's "Hours worked".
6. **Copy re-prices.** `copyWeek` prices the copy from the wage on file at copy
   time. It reads the wages before deleting anything; a failed read copies
   nothing and deletes nothing.
7. **Leave.** `time_off_requests.leave_type` (`unknown` | `paid` | `unpaid`,
   default `unknown`). The reviewer sets it on approval ("Approve as paid" /
   "Approve as unpaid"; an approved row of unknown type can be marked later).
   The owner's week says how many approved paid-leave days fall in it, beside the
   figure and not in it: a day of leave has no hours on file, and pricing monthly
   pay is the labour page's work. Leave is read from dates alone — `reason` is
   never selected.
8. **The review line.** Over 45 worked hours a person is named "to review before
   publishing", never priced. The key stays `overtime` because two clients read
   it; it no longer means overtime pay. It is computed whether cost tracking is
   on or off, because it is hours.
9. **Called-out shifts** are out of hours, cost and the review. **A failed week
   read** is a 500, not an empty week.

And, from the founder's "Take all five" (the same day), each with a test and a
killed mutation:

10. **An assumed break.** A shift over 4 hours with no break on record is
    counted with the Art. 68 minimum (`breakCounted`, `pay-rules.ts`, mirrored
    in `tm-format.ts`): in its cost on every re-price, the week's hours, each
    person's hours, the 45-hour review, the grid, the roster and the export. It
    is always said as assumed: the week carries `assumedBreakHours` and
    `assumedBreakShifts` and the page says "N shifts have no break recorded, so
    each is counted with the legal minimum break (assumed, …)", to owner and
    manager alike (it is hours); a shift's detail says "30 min · assumed"; the
    compliance lens names "break assumed · not recorded", and a RECORDED break
    shorter than the law asks for as "break under the legal minimum" (it
    changes no figure).
11. **Whoever edits the shift records the real one.** `createShift` and
    `updateShift` take `breakMinutes` (whole minutes, `0` = no break taken,
    `null` on an update clears the record back to the assumption, omitted
    leaves it). A break as long as the shift is refused in words (400) before
    anything is written, and so are new times that the break on record no
    longer fits. The shift sheet has the field, says live which minimum an
    empty field assumes, and says when a typed break is under it. A copied
    week carries each source shift's break on record (planned `shift_breaks`
    minutes included) and nothing on record stays nothing on record, and so
    does the grid's "Duplicate onto the same day"; a call-out's cover slot
    keeps the slot's break on record, and assigning a cover prices it on that
    break (a failed read of the shift is a 500 in words and assigns nothing;
    it used to write the cover as unpriced).
12. **The wage record is kept five years after its person leaves the roster,
    then deleted** — by the database's rule and a nightly call (Options,
    above). "Leaves the roster" is read as the `team_members` row being
    removed; a person marked inactive is still on the roster, and their record
    is kept (a question below). A person already off the roster when this ships
    is timed from the day it ships, so the error is on the side of keeping.
13. **Only the owner switches labour-cost tracking off or changes the labour
    target.** A manager's save that does either is a 403 in words before any
    write; the settings reply carries `mayChange` and the settings page locks
    what would be refused and says why. Every change a save makes (field, from,
    to, the saver's role) is a `team_labour_settings_changed` row in
    `system_audit_log`, and the reply's `audited` says whether the row was
    written; a save that moved nothing records nothing. A failed read of the
    current settings saves nothing.
14. **Paid leave stays as days, not priced** (item 7, unchanged; the labour
    page's plan below is corrected to match).
15. **Leave type** (item 7, unchanged, now the founder's rule): whoever
    approves marks it paid or unpaid; a staff member may state it on their own
    request (My Shifts: "Paid or unpaid?", default "Leave it to my manager"),
    and the approver's word replaces theirs. Staff cannot state it for someone
    else or review their own.

## Consequences

- A manager can no longer read or set a colleague's pay, and the owner can
  answer "who changed this wage, when, from what" from the day this ships.
- The owner's figure now says what it covers: "Wages only, for the shifts on the
  schedule — not SGK, meals or bonuses", plus paid-leave days beside it.
- **Residuals, stated.** (a) `copyWeek` does not copy `shift_breaks` rows (it
  never did); since item 11 it carries their minutes as the copy's recorded
  break. (b) No product path writes `shift_breaks`; a break written there, or
  into `recorded_break_min`, out of band after a shift was priced does not
  re-price it until the shift is next edited. (c) Shifts priced before this
  change were priced on their span, and before item 10 without an assumed
  break: the week's hours are counted live, but a stored `labor_cost` is not,
  so on such a shift the owner's cost and the hours disagree until the shift is
  next edited or its week is copied. Nothing re-prices stored rows in bulk (it
  would be a production write). The live house held 0 shifts on 2026-09-02 (not
  re-measured). (d) The legacy desk
  (`pages/team/command/**`) was aligned (45 hours, worked hours, owner-only
  money, house currency) but not redesigned; its Tonight pulse
  (`ManagerShiftDesk.tsx:473-478`, `:569`) still counts a called-out shift
  beside its cover, in the owner's cost and in everyone's hours, where the
  gateway's week no longer does (item 9). (e) Test fixtures still carry an
  old `wage_visible` key in settings payloads; nothing reads it. (f) The
  per-server SALES figures on /team (`PerformanceCard.tsx:79-80`,
  `PerformancePanel.tsx:217-218`) still print a literal `$`. They are sales,
  not pay, so this rule does not govern who sees them, and they stay on the
  money-currency baseline (4 sites) for a follow-up; the house currency is
  sent only with the owner's money today. (g) The gateway now names
  `shifts.recorded_break_min` in its shift reads: served before migration
  `20260921170900` has applied, those reads fail and answer a 500 in words,
  not a wrong figure. (h) Only the redesigned shift sheet has the break field;
  the legacy desk (`pages/team/command/**`) saves shifts without one, which
  leaves a recorded break as it was. (i) The retention job runs in every
  gateway instance; the purge is idempotent, so two instances delete nothing
  twice. (j) Found at the round-2 last call, not changed here: removing a
  person still deletes their shifts, leave requests, availability and
  credentials the same second (baseline foreign keys `shifts_member_id_fkey`,
  `time_off_requests_member_id_fkey` and others, `ON DELETE CASCADE`,
  `20260805000000_baseline_from_production.sql:13502`, `:13654`), so the
  wage record kept five years outlives the hours it priced. Keeping those is
  a founder question (below), not a default. (k) A departure is stamped once
  (`ON CONFLICT DO NOTHING`): a roster row removed, re-inserted under the SAME
  id and removed again would keep the first date. No product path re-inserts
  an id (every insert takes a generated one), so this is noted, not guarded.
- **Revisit when** the labour page lands (it will own pay basis and confirmed
  hours), or if a second role is ever meant to see pay.

## Next: the labour page

Built on this, not before it. The design is the judge's §3.1, with the
founder's picks applied: **hours, handed over; no pay computed in Mudavym**
("Hand hours over"), and **monthly and hourly pay types** ("Monthly and hourly"):

1. A pay basis per person — monthly or hourly (and daily/extra if the founder
   wants it) — with an amount in the house currency and an effective-from date:
   history, not overwrite. `team_member_wage_changes` is the first half of that
   history.
2. Confirmed hours: at the end of a day a manager marks each planned shift
   worked, changed (start, end, break) or no-show; append-only. That is the
   attendance sheet (puantaj) without a clock.
3. The owner's view: planned vs confirmed hours; hours over 45, the 11-hour day
   and the 270-hour year; wage cost only when both the wage side and the sales
   side are complete for the period, always labelled "wages only"; paid leave
   as days beside the figure, not priced (founder 2026-09-21, "Take all five",
   option 4 — this plan first said "as cost with zero hours").
4. A month-end export of confirmed hours for whoever runs payroll — not a
   payslip, nothing shaped like one (4857 Art. 37).
5. Staff see their own planned and confirmed hours and their leave. No money.

Not in it: payroll, SGK, tax, payslips, tips, clock hardware, IBAN, a
declared-vs-actual split, labour cost by area.

## Answered, 2026-09-21

The five questions this record first returned, kept as asked; the founder
answered all five with "Take all five" (quoted above), and Decision items
10–15 build the answers:

1. When a shift over 4 hours has no break on record, should Mudavym assume the
   Art. 68 minimum (15 min / 30 min / 1 h) or keep counting only what is
   recorded? — **Assume it, shown as assumed, editable** (items 10, 11).
2. How long is a person's wage record kept after they leave the roster (a wage
   claim can be brought for five years; KVKK asks for the minimum)? — **Five
   years, then deleted** (item 12).
3. May a manager still switch labour-cost tracking off or change the labour
   target, now that the cost is shown only to the owner? — **No: the owner
   only** (item 13).
4. Paid leave is counted in days beside the figure. Should the labour page price
   it, or keep it as days? — **Days, not priced** (item 14).
5. Who may mark approved leave paid or unpaid? — **Whoever approves it; staff
   may state it on their own request** (item 15).

## Open, for the founder

Not decided here; returned to the orchestrator as questions, not filed as OD
rows:

1. May a manager switch labour-cost tracking back ON? The pick names only
   switching it off. As built, yes (whoever may save the settings).
2. Should a shift of 4 hours or less also assume the Art. 68 (a) minimum of 15
   minutes? The pick names shifts over 4 hours. As built, no.
3. Is the Art. 68 minimum measured on the work the break leaves (as built: an
   8-hour shift is 7.5 hours of work and a 30-minute break) or on the span
   (an 8-hour shift would assume 60 minutes)? The statute keys it on the work
   and says a break is not working time; no court decision was checked.
4. Does "leaves the roster" include being marked inactive? As built, only the
   removal of the person's roster row starts the five years, so an inactive
   person's wage record is kept for as long as they stay on the roster.
5. Removing a person deletes their shifts and leave requests at once
   (residual (j)), so after a removal the kept wage record has no hours
   beside it. Should the shifts and leave of a person who left be kept for
   the same five years, or is the wage record alone what the pick meant?
   As built, only the wage record is kept.

## Evidence

- Gateway: `apps/api-gateway/src/team/team-pay.spec.ts`, 34 cases; 27 fail
  against `origin/main` 9cfc4e96d (re-measured at last call, with `origin/main`'s
  `team.service.ts`, `schedule.service.ts` and `team.dto.ts` swapped in), the
  rest are controls and the pure rules.
  22 of 22 mutations of the new rules killed (seesMoney, both viewer strips,
  both wage gates, both `wage_changed_by` writes, 45 → 40, breaks ignored,
  callout counted, copy keeps old cost, copy wage-read error swallowed, leave
  read selects `*`, the retired write accepted, the flag returned, the shifts
  read error swallowed, re-price without breaks, the manager block carrying
  cost, the leave read error reading as none, the review type ignored, two shift
  replies unstripped); at last call, the settings save handing the retired flag
  back (killed) and the week's shifts unstripped (killed). The /team suites
  pass (103 of 103 with this file, measured 2026-09-21 at last call).
- Web: `apps/web/src/pages/team/next/TeamPay.test.tsx`, 16 cases, 16 of 16 fail
  against `origin/main`; 10 of 10 mutations killed. Team and settings suites:
  167 of 167 pass.
- SQL: `p4-scratch/pglite-probe/teamfix-wage-record.mjs`, full corpus (193
  migrations) on PGlite, 27 checks pass, including idempotent re-apply, the
  append-only refusals, the actor FK nulling and the house cascade through the
  guard; 10 of 10 mutations of the migration killed. Fidelity: PGlite runs as
  superuser with no Supabase platform.
- Register: four `ADR-0215-TEAM-*` rows in `CLAIMS.jsonl`, static (python over
  source). Each holds on this tree, each fails on `origin/main`, and 29 of 29
  single-check mutations (every present string removed, every absent string
  re-introduced, one at a time) fail their row.
- Not run: `check_migration_ledger.py` and `check_definer_functions_closed.py`
  answer CANNOT CHECK without a database URL, and this session has no database
  access. The migration's two functions are plain trigger functions, not
  `SECURITY DEFINER`. No browser pass was made; the page is covered by the
  component tests above.

Round 2 ("Take all five", items 10–15), measured 2026-09-21 on the index tree
(`p4-scratch/verify_index.sh`, every check exit 0):

- Gateway: `team-pay.spec.ts` now 63 cases (B1, S1, L3, R1 added; one more
  B1 case at the last call); the /team suites 132 of 132 (re-measured at the
  last call). The round-2 cases were not counted against 48df6d91b one
  by one: the file imports rules that tree lacks, so it does not compile
  there. They are held instead by **42 of 42 killed mutations**: the 4 h line
  (239, `>=`), each Art. 68 boundary (`<` for `<=` twice, 60 → 45), the
  minimum keyed on the span, the recorded and the planned break each ignored,
  the assumption unflagged or of zero minutes, worked hours without the break;
  a break as long as the shift accepted, create and update not storing or not
  pricing the break, a break change not re-pricing, the re-price forgetting the
  break on record, the update's read error swallowed, new times the kept break
  no longer fits accepted (twice), the copy and the cover slot dropping the
  break, the copy ignoring planned breaks, the assumed counters inverted or
  unsummed; the settings rule passing a manager, either refusal removed,
  switching on refused, the refusal not thrown, the settings read error
  swallowed, a no-op save audited, the audit's action or role lost, an
  unchanged field recorded, `mayChange` offered to staff or always true; the
  purge's name, null counts read as 0, the RPC error swallowed, the `@Cron`
  removed, the scheduled run doing nothing.
- Web: `TeamBreaks.test.tsx`, 15 cases; the team and settings suites 182 of
  182 (12 files, re-measured at the last call). **23 of 23 killed mutations**
  (the mirrored rule, the break's words, the sheet's send, clear, validation
  and warnings, the week's assumed line and its hook mapping, the settings
  locks, the leave type sent, the grid's two compliance flags, its Break fact,
  and its duplicate dropping the break or sending nothing as a value; and, at
  the last call, the under-minimum warning naming a minimum "for this shift"
  that the shift does not have).
- SQL: `p4-scratch/pglite-probe/teamfix-r2-break-and-retention.mjs`, the full
  corpus (193 migrations, then these two) on PGlite, 34 checks pass on the
  index tree: both apply and re-apply as no-ops; the break column is nullable
  with no default and the CHECK refuses -1 and 1440; the backfill times a
  person already gone from now; a removal writes a departure only with a wage
  record; a supplied `left_at` is ignored; a departure is never edited,
  truncated or deleted inside five years (with or without a wage record left);
  nothing of a person still on the roster is deleted; the purge deletes exactly
  the rows past five years (five years less a day: nothing; exactly five:
  deleted), then their departures, and a second run finds nothing; only
  service_role may run it, and it is SECURITY INVOKER; RLS on and grants
  revoked, re-applied; a house deletion takes its records and writes no
  departure at any point, in either cascade order. **16 of 16 migration
  mutations killed**; two survived the first probe (a young departure with no
  wage record, and the cascade order) and the probe gained the two checks that
  kill them.
- Register: the HOURS row's verify followed the moved `workedHours` line (it
  failed on this tree until then), and three rows were added:
  `ADR-0215-TEAM-AN-UNRECORDED-BREAK-IS-ASSUMED`,
  `ADR-0215-TEAM-A-WAGE-RECORD-IS-KEPT-FIVE-YEARS`,
  `ADR-0215-TEAM-LABOUR-SETTINGS-ARE-THE-OWNERS`. 414 of 414 claims hold; each
  of the four fails on `origin/main` 9cfc4e96d and on 48df6d91b; 36 of 36
  single-check mutations fail their row.
- The statute: 4857 Art. 68 read on the `app.e-uyar.com` mirror (quoted under
  Options); `mevzuat.gov.tr` refused the fetch (TLS certificate). No court
  decision was read.
- Not run, round 2: the two database-URL guards above (CANNOT CHECK, exit 2);
  no browser pass; the gateway was not booted, so the nightly job was not seen
  to fire (its `@Cron` registration is asserted by a test, the purge by the
  probe).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-21 | — | Created from the founder's four picks and the labour-page judge's §3.0 |
| 2026-09-21 | Opus last call | The settings save still echoed `wage_visible` (fixed, test + mutation); the CLAIMS currency row's prose named every /team file while the per-server sales still print `$` (narrowed; residual (f)); the legacy Tonight pulse's called-out double count named as residual (d) |
| 2026-09-21 | Round 2 build (founder: "Take all five") | Items 10–15 built; four questions returned (switching tracking on, shifts of 4 h or less, span vs work for the minimum, inactive as leaving); the HOURS claim row had gone red on the moved `workedHours` line and was re-pointed; two migration mutants survived the first probe and were killed by two added checks |
| 2026-09-21 | Round 2 Opus last call | The sheet's under-minimum warning said "60 minutes for this shift" on an 8-hour shift whose minimum it also said was 30; it now names the minimum owed for the work the typed break leaves (fixed, test + killed mutation). The ADR's "safer side" sentence read as if the chosen break were the larger one (reworded). `assignCover`'s price read (`recomputeCostForMember`, whose select this round had widened) swallowed its error and wrote the cover as unpriced, which also made residual (g) untrue for that path (fixed: a 500 in words, nothing assigned; test + killed mutation). Found and recorded, not changed: a removal still cascades a person's shifts and leave (residual (j), question 5), and a departure is stamped once (residual (k)). Re-run: `team-pay.spec.ts` 63 of 63, one new mutation (an empty `shift_breaks` embed read as a recorded 0) killed by 4 cases, the PGlite probe ALL PASS |
