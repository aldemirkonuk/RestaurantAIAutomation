# 0215 — Money on /team is the owner's, and hours are worked hours

- **Status:** Locked (the founder's four picks, 2026-09-21). The design below
  applies them; the forks it could not settle are listed under "Open, for the
  founder" and are not decided here.
- **Date:** 2026-09-21
- **Decider:** Aldemir (founder) — four picks, quoted verbatim below
- **Keywords:** team, wage, hourly_wage, labor_cost, wage_visible, owner only,
  money rule, breaks, 4857 Art. 68, 45 hours, overtime review, copy week,
  re-price, paid leave, leave_type, time_off_requests, team_member_wage_changes,
  append-only, house currency, Intl, KVKK, labour page
- **Links:** [[0088-a-team-change-is-recorded-and-a-wage-is-not-invented]],
  [[0051-rebuilt-pages-show-live-data-only]], ADR 0117 (Q25, a house names its
  money), `supabase/migrations/20260921170200_a_wage_is_the_owners_and_every_change_is_kept.sql`,
  `apps/api-gateway/src/team/pay-rules.ts`,
  `apps/api-gateway/src/team/team-pay.spec.ts`,
  `apps/web/src/pages/team/next/TeamPay.test.tsx`

## The founder's words

Asked on 2026-09-21 after the labour-page judge's pass, verbatim:

| Question | Pick |
|---|---|
| Should we fix the six /team defects before building the labour page? | **"Fix /team first"** |
| Who may see wages and labour cost? | **"Owner only"** (managers see hours but not money) |
| Should Mudavym work out pay, or hand the month's hours to whoever runs payroll? | **"Hand hours over"** (no pay computed in Mudavym) |
| Should the page handle monthly salaries, not just hourly pay? | **"Monthly and hourly"** (the labour page builds pay types; not here) |

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
   is recorded.* Not taken here: it would invent a break the shift does not
   carry. It is a founder question (below).
2. **Subtract the breaks the shift carries.** Chosen.

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

## Consequences

- A manager can no longer read or set a colleague's pay, and the owner can
  answer "who changed this wage, when, from what" from the day this ships.
- The owner's figure now says what it covers: "Wages only, for the shifts on the
  schedule — not SGK, meals or bonuses", plus paid-leave days beside it.
- **Residuals, stated.** (a) `copyWeek` still does not copy `shift_breaks` (it
  never did), so a copied week is priced on its full span, which is what it
  holds. (b) No product path writes `shift_breaks`; a break written out of band
  after a shift was priced does not re-price it until the shift is next edited.
  (c) Shifts priced before this change were priced on their span; the live
  house held 0 shifts on 2026-09-02 (not re-measured). (d) The legacy desk
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
  sent only with the owner's money today.
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
   side are complete for the period, always labelled "wages only"; paid leave as
   cost with zero hours.
4. A month-end export of confirmed hours for whoever runs payroll — not a
   payslip, nothing shaped like one (4857 Art. 37).
5. Staff see their own planned and confirmed hours and their leave. No money.

Not in it: payroll, SGK, tax, payslips, tips, clock hardware, IBAN, a
declared-vs-actual split, labour cost by area.

## Open, for the founder

Not decided here; returned to the orchestrator as questions, not filed as OD
rows:

1. When a shift over 4 hours has no break on record, should Mudavym assume the
   Art. 68 minimum (15 min / 30 min / 1 h) or keep counting only what is
   recorded (today)?
2. How long is a person's wage record kept after they leave the roster (a wage
   claim can be brought for five years; KVKK asks for the minimum)?
3. May a manager still switch labour-cost tracking off or change the labour
   target (today they can), now that the cost is shown only to the owner?
4. Paid leave is counted in days beside the figure. Should the labour page price
   it (a daily rate for monthly staff, hours × rate for hourly), or keep it as
   days?
5. Who may mark approved leave paid or unpaid? As built, whoever approves it (a
   manager or an owner), and a staff member may state it on the request; the
   type is a classification of time, not a figure, but it decides what the
   owner's week says about cost. If it should be the owner's alone, it is a
   one-line gate in `reviewTimeOff`.

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

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-21 | — | Created from the founder's four picks and the labour-page judge's §3.0 |
| 2026-09-21 | Opus last call | The settings save still echoed `wage_visible` (fixed, test + mutation); the CLAIMS currency row's prose named every /team file while the per-server sales still print `$` (narrowed; residual (f)); the legacy Tonight pulse's called-out double count named as residual (d) |
