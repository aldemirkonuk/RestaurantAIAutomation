# 0215 — Money on /team is the owner's, and hours are worked hours

- **Status:** Locked (the founder's four picks, 2026-09-21, his answer the same
  day to the five forks this record first left open, "Take all five", and his
  answers 2026-09-22, round 6y, to the five questions round 2 in turn left
  open — see "Answered, 2026-09-22 (round 6y)"). All five of "Open, for the
  founder"'s questions are answered; the round-3 last call returned two new
  ones, listed there and not decided here. **[2026-09-25: the founder answered
  the three questions round 3 returned (round 4, item 19) — see "Answered,
  2026-09-25 (round 4)" and Decision items 21–23. One new question is returned
  there: a switched-on manager setting their OWN wage.]** **[2026-09-25, round
  5 (item 32): answered — such a manager MAY set their own wage, and the owner
  is told. See "Answered, 2026-09-25 (round 5)" and item 21's bracket.]** **[2026-09-27,
  ADR 0090 audit of 25e55b2c: one new question returned, not decided here —
  may a switched-on manager set an OWNER's wage ("Open, for the founder"
  question 7, residual (o)).]** **[2026-09-27, founder item 71 (round 13):
  question 7 answered, verbatim: "if owner taking money, manager can't see it" — an owner's wage and
  shift cost are invisible to managers, pay access or not, and only an owner
  sets an owner's wage. See "Answered, 2026-09-27 (item 71)" and item 24.
  Nothing from this record is open for the founder except OD-165 (question 6)
  and the literal "and off" of item 16.]** **[2026-09-27, ADR 0090 audit of
  #440 at `78125580a`: one more question returned, not decided here — does a
  former owner's pay stay the owners' once another owner changes their role
  to manager ("Open, for the founder" question 8, residual (t)). Item 24
  holds for a current owner membership only.]** **[2026-09-28, founder item 80: question 8
  answered, verbatim: "Hide owner-period pay (Recommended)" — a former owner's shifts dated inside
  their owner period stay the owners', per row and in the week total; from
  the demotion on their pay is a manager's. Built as item 25; see
  "Answered, 2026-09-28 (item 80)". Nothing from this record is open for the
  founder except OD-165 (question 6) and the literal "and off" of item 16.]** **[2026-09-28, founder item 93 (OD-181): a removed person's shifts that have not started yet go back to the open pool — "back to the open pool absolutely". Built as item 26; the replacement step he asked to be brainstormed is a fork in `.planning/06-pages/team.md` §15, not built.]** **[2026-09-28, founder: the replacement is "'Replace with' picker", checks "refuse overlap warn rest but owner has a say to change it into warn all four to allow double booking". Built as item 27.]**
- **Date:** 2026-09-21 (round 2 answers 2026-09-21; round 6y answers
  2026-09-22; round 4 answers 2026-09-25)
- **Decider:** Aldemir (founder) — four picks and one answer to five forks
  (2026-09-21), and five more answers (2026-09-22, round 6y), quoted verbatim
  below
- **Keywords:** team, wage, hourly_wage, labor_cost, wage_visible, owner only,
  money rule, breaks, 4857 Art. 68, assumed break, recorded_break_min, 45 hours,
  overtime review, copy week, re-price, paid leave, leave_type,
  time_off_requests, team_member_wage_changes, append-only, retention, five
  years, team_member_departures, purge_expired_wage_records,
  purge_expired_shift_and_leave_records, labour settings, owner only
  switch-off, house currency, Intl, KVKK, labour page, shifts outlive removal,
  leave outlive removal, member_id foreign key dropped
- **Links:** [[0088-a-team-change-is-recorded-and-a-wage-is-not-invented]],
  [[0051-rebuilt-pages-show-live-data-only]], ADR 0117 (Q25, a house names its
  money), `supabase/migrations/20261201110000_a_wage_is_the_owners_and_every_change_is_kept.sql`,
  `supabase/migrations/20261201110100_a_shift_over_four_hours_has_a_break.sql`,
  `supabase/migrations/20261201110110_a_wage_record_is_kept_five_years_after_leaving.sql`,
  `supabase/migrations/20261201110200_a_persons_shifts_and_leave_outlive_their_removal.sql`,
  `supabase/migrations/20261201110210_a_removed_persons_credentials_are_kept_their_availability_is_not.sql`,
  `supabase/migrations/20261201110220_an_owner_may_let_a_manager_see_and_set_pay.sql`
  (both added 2026-09-25, round 4),
  **[Renumbered 2026-09-25, merging `origin/main` 059169a5 into #440: the four files were `20260921170200`, `20260921170900`, `20260921170910` and `20260922013000`, all below main's newest `20260922231300`, which ADR 0212's `check_migration_order.py` refuses. Moved by `git mv` to `20260925180000`, `…180100`, `…180110`, `…180200`, same order, content unchanged except the version numbers they cite; every citation in this ADR, CLAIMS and the code was rewritten to the new numbers. No main migration after `20260921170200` touches `team_members`, `shifts`, `leave_requests` or `team_member_*`, so the later apply position changes nothing they depend on.]**
  **[Renumbered again 2026-09-26, merging `origin/main` into #440 for the merge train (train/pr-440): all six files (the four above plus the two round-4 files, `…180210` and `…180220`) were `20260925180000`/`…180100`/`…180110`/`…180200`/`…180210`/`…180220`, behind main's newest `20260926120000` (#471, sessions-follow-membership). Moved by `git mv` to `20260927150000`/`…150100`/`…150110`/`…150200`/`…150210`/`…150220` (same relative spacing, chosen past every version any other open PR branch claimed at the time), same order, content unchanged except the version numbers they cite; every citation in this ADR, CLAIMS and the code was rewritten to the new numbers. Re-verified with `check_migration_order.py` and `check_decision_claims.sh` on the merged tree.]**
  **[Corrected 2026-09-26, ADR 0090 audit of 583184b7: the previous bracket's "every citation" claim was false — `git grep 20260925180 -- supabase/migrations` found eight surviving references to the retired `…180xxx` numbers inside the renamed files' own header comments and one `COMMENT ON FUNCTION` string (`20260929030110` lines 9, 34, 207; `20260929030200` lines 22, 29, 39; `20260929030210` lines 15, 21), none of them in this ADR or CLAIMS. All eight are now rewritten to the `20260927150xxx` numbers in place; `git grep 20260925180 -- supabase/migrations` returns nothing as of this bracket.]**
  **[Amended 2026-09-27, ADR 0090 audit of #440 at c093e731: both brackets above are one renumber behind. The 2026-09-27 merge (changelog row of that date) moved all six files again, `20260927150xxx` → `20260928120xxx`, and its citation sweep had rewritten the first number of the list in the bracket above (`20260927150000`, restored here) while leaving the `…150xxx` shorthand after it. The files ship as the six `20260928120xxx` names listed at the top of this section; the eight citations the previous bracket names cite `20260928120xxx` today, and `CLAIMS.jsonl` row `ADR-0215-NO-STALE-180XXX-MIGRATION-CITATIONS` now greps for both retired prefixes: `git grep -e 20260925180 -e 20260927150 -- supabase/migrations` returns nothing.]**
  **[Renumbered a fourth time, 2026-09-27 (round 2), merge-train update of PR #440: the branch was behind `origin/main` (new ceiling `20260930100100`, #441's Away migration), which `check_migration_versions_unique.py` also flagged as a direct version collision with open PR #479's `20260929030000_user_passkeys.sql`. Moved by `git mv` to `20260930110000`/`…110100`/`…110110`/`…110200`/`…110210`/`…110220`, same relative spacing, past both ceilings. Every live citation (the file paths above, the Decision-section prose, `OPEN-DECISIONS.md`, `README.md`'s index row, `CLAIMS.jsonl`, and the six `apps/api-gateway/src/team/*.ts`/`*.spec.ts` files) rewritten with the old→new pairs; the changelog rows and rename brackets ABOVE this one, which narrate what earlier rounds renamed FROM and TO, were left citing the numbers true at the time they describe — sweeping them forward would misstate which round did which rename, the exact defect the 2026-09-27 (round 1) bracket above corrected once already. `CLAIMS.jsonl` row `ADR-0215-NO-STALE-180XXX-MIGRATION-CITATIONS` amended again: verify now greps three retired prefixes (`20260925180`, `20260927150`, `20260929030`), not two. `git grep 20260929030 -- supabase/migrations` returns nothing as of this bracket.]**
  **[Corrected 2026-09-27, ADR 0090 audit of #440 at 25e55b2c: the bracket above is the FIFTH renumber, not the fourth. Between the c093e731 bracket and it, commit `84debc021` (merging #477's `20260929020000`) moved the six files `20260928120xxx` → `20260929030xxx` and swept citations without a bracket here — which is why the 583184b7 correction bracket above now reads `20260929030110`/`…030200`/`…030210` for files that were `20260927150xxx` when it was written. `CLAIMS.jsonl` `ADR-0215-NO-STALE-180XXX-MIGRATION-CITATIONS` now also greps the retired `20260928120` prefix.]**
  **[Renumbered a sixth time, 2026-09-27, same fix round (merge of `origin/main` 922150404, #483, whose `20261001000000_a_briefing_names_who_marked_it.sql` put the six files behind main's newest again — `check_migration_order.py` refused all six): moved by `git mv` `20260930110xxx` → `20261021110000`/`…110100`/`…110110`/`…110200`/`…110210`/`…110220`, past every version an open PR branch claimed at the time (highest `20261020000100`), same order and spacing, content unchanged except the versions they cite. Every live citation (the Links list above, the Decision/Consequences/Evidence prose, the gateway team files, `CLAIMS.jsonl`, `OPEN-DECISIONS.md`, `README.md`'s index row, the three migrations' own comments) rewritten; the two brackets above and the changelog rows that narrate the fifth renumber keep the numbers true when they were written. `ADR-0215-NO-STALE-180XXX-MIGRATION-CITATIONS` greps the retired `20260930110` prefix too.]**
  **[Renumbered a seventh time, 2026-09-27, founder item 71 round (merge of `origin/main` ef8ecdf30, #435, whose ADR 0207 migrations run up to `20261021150000` — `check_migration_order.py` put the six files behind it again): moved by `git mv` `20261021110xxx` → `20261101100000`/`…100100`/`…100110`/`…100200`/`…100210`/`…100220`, past every version an open PR branch claimed at the time (highest `20261031174623`, `fix/ical-token-minted-on-act`), same order and spacing, content unchanged except the versions they cite. Every live citation rewritten; the sixth-renumber bracket above and the changelog rows keep the numbers true when they were written. `ADR-0215-NO-STALE-180XXX-MIGRATION-CITATIONS` greps the retired `20261021110` prefix too.]**
  **[Renumbered an eighth time, 2026-09-27, merge-train update of PR #440: merging `origin/main` (fa16fbfb6, #473, `20261022000000_mudavym_design_vendor_prices.sql`) brought the branch's ceiling back down, but `check_migration_versions_unique.py` then flagged `20261101100000`/`…100100`/`…100200` as direct version collisions with open PR #436 (`feat/finish-action-integrity`)'s queued migrations at those same three versions. Moved by `git mv` `20261101100xxx` → `20261101110000`/`…110100`/`…110110`/`…110200`/`…110210`/`…110220`, past PR #436's newest (`20261101101700`), same order and spacing, content unchanged except the versions they cite. Every live citation (the Links list above, the Decision/Consequences/Evidence prose, the gateway team files, `CLAIMS.jsonl`, `OPEN-DECISIONS.md`, `README.md`'s index row, the three migrations' own comments) rewritten; the seven brackets above and the changelog rows that narrate earlier renumbers keep the numbers true when they were written. `ADR-0215-NO-STALE-180XXX-MIGRATION-CITATIONS` greps the retired `20261101100` prefix too.]**
  **[Renumbered a ninth time, 2026-09-27, merge-train update of PR #440 (round 4): `origin/main` gained `20261102110000_a_low_stock_digest_is_fenced_once_a_house_day.sql` (#488), putting the branch's six migrations behind main's newest again — `check_migration_order.py` refused all six. Moved by `git mv` `20261101110xxx` → `20261103110000`/`…110100`/`…110110`/`…110200`/`…110210`/`…110220`, past main's new ceiling, same order and spacing, content unchanged except the versions they cite. Every live citation (the Links list above, the Decision/Consequences/Evidence prose, the gateway team files, `CLAIMS.jsonl`, `OPEN-DECISIONS.md`, `README.md`'s index row, the three migrations' own comments) rewritten; the eight brackets above and the changelog rows that narrate earlier renumbers keep the numbers true when they were written. `ADR-0215-NO-STALE-180XXX-MIGRATION-CITATIONS` greps the retired `20261101110` prefix too.]**
  **[Renumbered a tenth time, 2026-09-27, merge-train update of PR #440 (round 5): `origin/main` gained `20261115000000_a_price_names_its_paper_and_its_messenger.sql` (bc7121ccf, #482), putting the branch's six migrations behind main's newest again — `check_migration_order.py` refused all six. Moved by `git mv` `20261103110xxx` → `20261116000000`/`…000100`/`…000110`/`…000200`/`…000210`/`…000220`, past main's new ceiling, same order and spacing, content unchanged except the versions they cite. Every live citation (the Links list above, the Decision/Consequences/Evidence prose, the gateway team files, `CLAIMS.jsonl`, `OPEN-DECISIONS.md`, `README.md`'s index row, the three migrations' own comments) rewritten; the nine brackets above and the changelog rows that narrate earlier renumbers keep the numbers true when they were written. `ADR-0215-NO-STALE-180XXX-MIGRATION-CITATIONS` greps the retired `20261103110` prefix too.]**
  **[Renumbered an eleventh time, 2026-09-28, merge-train update of PR #440: `origin/main` gained `20261116101700_a_stale_name_ask_closes_by_itself.sql` (#436, fd73d0920), putting the branch's six migrations behind main's newest again — `check_migration_order.py` refused all six. Moved by `git mv` `20261116000000`… → `20261116110000`/`…110100`/`…110110`/`…110200`/`…110210`/`…110220`, past main's new ceiling, same order and spacing, content unchanged except the versions they cite. Every live citation (the Links list above, the Decision/Consequences/Evidence prose, the gateway team files, `CLAIMS.jsonl`, `OPEN-DECISIONS.md`, `README.md`'s index row, the three migrations' own comments) rewritten; the ten brackets above and the changelog rows that narrate earlier renumbers keep the numbers true when they were written. `ADR-0215-NO-STALE-180XXX-MIGRATION-CITATIONS` greps the retired `20261116000` prefix too.]**
  **[Renumbered a twelfth time, 2026-09-28, merge-train update of PR #440: `origin/main` gained a passkeys/sign-in migration (#479) past the branch's six, and the open-PR ceiling moved further still to PR #480's `the_door_record_is_append_only` migration — `check_migration_order.py` refused all six again. Moved by `git mv`, same order and spacing, content unchanged except the versions they cite, to versions past both ceilings (mechanical numbers assigned at this merge step, per the founder's 2026-09-27 migrations-numbered-at-merge rule — cited here by slug, not by version): `a_wage_is_the_owners_and_every_change_is_kept`, `a_shift_over_four_hours_has_a_break`, `a_wage_record_is_kept_five_years_after_leaving`, `a_persons_shifts_and_leave_outlive_their_removal`, `a_removed_persons_credentials_are_kept_their_availability_is_not`, `an_owner_may_let_a_manager_see_and_set_pay`. Every live citation (the Links list above, the Decision/Consequences/Evidence prose, the gateway team files, `CLAIMS.jsonl`, `OPEN-DECISIONS.md`, `README.md`'s index row, the three migrations' own comments) rewritten; the eleven brackets above and the changelog rows that narrate earlier renumbers keep the numbers true when they were written. `ADR-0215-NO-STALE-180XXX-MIGRATION-CITATIONS` greps the retired `20261116110` prefix too.]**
  `apps/api-gateway/src/team/pay-rules.ts`,
  `apps/api-gateway/src/team/wage-record-retention.service.ts`,
  `apps/api-gateway/src/team/team-pay.spec.ts`,
  `apps/web/src/pages/team/next/TeamPay.test.tsx`,
  `apps/web/src/pages/team/next/TeamBreaks.test.tsx`,
  `apps/api-gateway/src/team/team-pay-round4.spec.ts`,
  `apps/web/src/pages/team/next/TeamPayRound4.test.tsx`,
  `apps/web/src/pages/team/next/FormerStaff.tsx`,
  `p4-scratch/pglite-probe/teamfix-r3-shifts-and-leave-outlive-removal.mjs`

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
`shifts.recorded_break_min` (migration `20261201110100`) is written in the same
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
manager sees hours.** And the week's hours are worked hours. **[2026-09-25,
founder round 4 item 19, "Pay visibility only (Recommended)": the owner may
switch an individual manager's pay access on; that manager then sees the
money and sets a colleague's wage (never their own), with their other rights
unchanged. Default off, so every manager stays as the 2026-09-21 pick left
them until an owner acts. Item 21.]** **[2026-09-25, founder round 5 item 32:
"never their own" is withdrawn — a switched-on manager may set their own wage,
and every active owner is notified; item 21's bracket.]** **[2026-09-27,
founder item 71, verbatim: "if owner taking money, manager can't see it": an OWNER's pay is the
owners' alone — a switched-on manager sees every wage and shift cost except
an owner's, and cannot set an owner's wage. Item 24.]**

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
    changes no figure). **[Corrected 2026-09-22, round 6y: the "over 4 hours"
    gate is removed.** Open question 2, below, asked whether a shift of 4
    hours or less should also assume the Art. 68(a) 15-minute minimum; the
    founder answered "Yes, follow Art. 68 (Recommended)". `ASSUME_BREAK_OVER_MIN`
    is deleted from both `pay-rules.ts` and its `tm-format.ts` mirror; the
    assumption now applies from the shortest shift up, still keyed on the work
    the break leaves (item 18, below). Tests at the 4h00/4h01 and 7h30/7h31
    boundaries the founder named: `team-pay.spec.ts` (B1) and
    `TeamBreaks.test.tsx`.]**
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
    is kept (a question below, **answered 2026-09-22 round 6y as built — item
    19**). A person already off the roster when this ships is timed from the
    day it ships, so the error is on the side of keeping. **[Broadened
    2026-09-22, round 6y — item 20, below: the same five-year clock and the
    same deletion job now also cover the person's SHIFTS and LEAVE REQUESTS,
    not the wage record alone (question 5, below, "Keep them 5 years
    (Recommended)").]**
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

And, from the founder's five answers 2026-09-22 (round 6y) to the five
questions round 2 left open (see "Answered, 2026-09-22 (round 6y)" below):

16. **A manager may switch labour-cost tracking back ON; only the owner may
    switch it OFF (unchanged).** Founder pick: "Yes, on and off (Recommended)"
    — as built (open question 1): `labourSettingsMayChange` already returned
    `trackingOn: true` for a manager and `trackingOff: false`, and
    `labourSettingsRefusal` already refused only a manager's attempt to switch
    OFF or change the target. No code changed; this closes the question the
    record left open. `mayChange` on `getSettings`/`updateSettings` is the
    test: `{trackingOff: false, trackingOn: true, target: false}` for a
    manager, all `true` for the owner (`team-pay.spec.ts`, S1, "tells each
    viewer what they may change"). **[Reading, recorded 2026-09-22 at the
    round-3 last call: the question put was "May a manager switch labour-cost
    tracking back ON?", and the orchestrator relayed this pick as "as built,
    record" — a manager switches it on, only the owner switches it off (item
    13). Read literally, "on and off" could instead mean a manager may also
    switch it OFF, which would reverse item 13, a pick of 2026-09-21. That
    reading is returned to the founder to confirm, not built.]** **[2026-09-25,
    round 4 item 19: the question put to the founder was "what does turning a
    manager 'on/off' mean?", and he picked "Pay visibility only (Recommended)"
    — "The switch decides whether that manager can see and edit pay; their
    other rights are unchanged." Built as item 21: a per-manager pay switch.
    Read against this item: "their other rights are unchanged" leaves the
    labour settings exactly as items 13 and 16 have them (a manager switches
    tracking ON, only the owner switches it OFF or changes the target); a
    switched-on manager gets no labour-settings right from it
    (`team-pay-round4.spec.ts` PA, "the other manager rights are unchanged").
    The question as asked did not name the labour-tracking switch, so if the
    founder meant the literal "and off" of item 16, that is still his to say —
    reported as a candidate open decision, not filed.]**
17. *(Item 10, above, carries the Art. 68-at-any-length correction — no
    separate item here to avoid saying it twice.)*
18. **The Art. 68 minimum is measured on the work the break leaves, not the
    shift's span (unchanged) — named for the labour lawyer's review.** Founder
    pick: "On work time (Recommended)" — as built (open question 3): the
    Options section's "Which minimum an unrecorded shift assumes" already
    chose "the least statutory break the shift's remaining work allows"
    (`art68MinimumBreak`), over the span reading it rejected. No code changed.
    The founder's pick closes the question but does not itself resolve the
    open legal reading (no court decision was checked, tahanci.av.tr's
    commentary was not verified against one) — flagged here, verbatim, for
    the labour lawyer's review before this basis is relied on in a dispute:
    the rule as built is **Art. 68's break, keyed on working time, is the
    least of 15/30/60 minutes that the shift's WORKED time (span minus that
    break) still satisfies** (`pay-rules.ts:art68MinimumBreak`,
    `art68BreakForWork`).
19. **"Leaves the roster" stays read as removal only; an inactive person's
    wage record, shifts and leave are all still kept while they remain on the
    roster (unchanged).** Founder pick: "Only removal counts (Recommended)" —
    as built (open question 4): `team_member_departure_recorded()` fires only
    on a `team_members` row being removed (`AFTER DELETE`), never on an
    `is_active`/status change. No code changed.
20. **A removed person's shifts and leave requests are kept, not deleted the
    same second, and end with the wage record: the same five-year clock, the
    same nightly job.** Founder, verbatim: "removing a person must no longer
    delete their shifts and leave requests straight away; they are kept and
    end with the wage record (same five-year clock, same deletion job)" (open
    question 5, "Keep them 5 years (Recommended)"). Migration
    `20261201110200`:
    - `shifts.member_id` and `time_off_requests.member_id` drop their foreign
      key to `team_members` (the same reason `team_member_wage_changes.member_id`
      already carries none: a row that must outlive its person's removal
      cannot be pinned to a row the removal deletes). The columns and their
      values are unchanged; new writes are still checked against the live
      roster in the gateway (`assertMemberInRestaurant`), the same as every
      other actor reference in this schema.
    - `team_member_departure_recorded()` now stamps a departure when the
      removed person has a wage record, a shift OR a leave request — not a
      wage record alone.
    - `purge_expired_shift_and_leave_records()` (service_role only, SECURITY
      INVOKER) deletes shifts and leave requests whose person's departure is
      more than five years old; `WageRecordRetentionService` calls it
      **first**, then `purge_expired_wage_records()` (updated: its own
      departure cleanup now waits on shifts and leave too, not the wage
      record alone) — see the file header of
      `wage-record-retention.service.ts` for why the order matters: running
      the wage purge first is provably safe on its own (it re-checks shifts
      and leave before clearing a departure) but running shifts-and-leave
      first is what lets a single nightly run clear a departure whose only
      remaining row was, until that same run, a shift or a leave request.
      `tmd_guard()` (the departures table's own DELETE guard) gained the
      identical check, so a direct DELETE outside the purge is refused on the
      same terms.
    - RLS is unchanged: `shifts` and `time_off_requests` have RLS on and no
      policy, and no grant to `anon`/`authenticated` since
      `20260825210000_od72_revoke_client_grants.sql` revoked client grants
      schema-wide (the baseline dump carries no grants, so it cannot show
      this; the migration's DO block asserts it). **[Corrected 2026-09-22 at
      the round-3 last call: this bullet first said neither table "has ever
      carried" a grant to them; until OD-72 both did, like 203 of 206 public
      tables.]** Every read and write goes through the gateway's
      service-role client, gated by role in code.
    - **Kept, not shown** (added at the round-3 last call). With the foreign
      keys gone, a removed person's rows would otherwise have entered the
      working week: their NEXT week read as covered and costed by someone who
      will not come (the grid, drawn by roster row, showed no shift for
      them), "Copy last week" wrote them into every new week, replacing a
      week deleted their kept shifts in it, and a pending leave request of
      theirs waited in the manager's list. So the gateway reads a removed
      person's rows as it did before this change, when a removal deleted
      them: `onTheRoster` (`pay-rules.ts`) drops a row whose `member_id`
      names nobody on the live roster (an open shift stays), applied to
      `getWeek`'s shifts (and so its coverage, hours and cost) and approved
      leave, to `copyWeek`'s source week and to the rows a replaced week
      deletes (now by id), and to a manager's `listTimeOff`.
      `TeamService.rosterMemberIds` raises on a failed read, never an empty
      roster. The kept rows are therefore a record, like the wage record,
      which no page reads: "readable only by owners/managers" holds because
      nobody reads them through the product at all. Whether a PAST week
      should show a removed person's hours, and what a removed person's
      unworked FUTURE shifts should become, are returned to the founder —
      not decided here. **[2026-09-25, round 4 item 19: answered, "Owner-only
      history (Recommended)" — "Hidden from the team views; the owner can open
      a 'former staff' history for pay and legal records." So no team view
      (past week included) shows them, and the owner reads them in the
      former-staff history — item 22. A removed person's unworked future
      shifts are kept and shown there like any other kept shift; nothing
      reassigns them.]** **[2026-09-28, founder item 93: superseded for the unstarted ones — they go back to the open pool at removal (item 26); the started and past ones stay kept as above.]** **[2026-09-27, ADR 0090 audit of #440 at
      `ea4cc38d0`: "no page reads" them held for the week, copy and leave
      lists above but not for the by-id routes — a removed person's kept
      shift could still be edited, called out, offered, assigned or deleted
      by its id, and a kept leave request reviewed. Those routes now answer
      404 for it, for everyone (`TeamService.assertOnTheRoster`; item 24's
      second correction bracket).]** `team-pay.spec.ts` K1, 10 of 10 targeted mutations
      killed; CLAIMS row
      `ADR-0215-TEAM-A-REMOVED-PERSONS-KEPT-ROWS-ARE-NOT-IN-THE-WEEK`.
    - Additive and idempotent: two constraints dropped (`IF EXISTS`,
      re-dropping a no-op), three functions replaced/added
      (`CREATE OR REPLACE`), no row written or deleted by the migration
      itself.

21. **A manager's pay switch (round 4, 2026-09-25).** Founder pick: "Pay
    visibility only (Recommended)" — "The switch decides whether that manager
    can see and edit pay; their other rights are unchanged."
    `user_restaurant_access.team_pay_access` (migration `20261201110220`,
    `BOOLEAN NOT NULL DEFAULT false`) is the switch, per manager, per house,
    on the membership row that already decides the role here — so it goes
    when the membership goes. `seesMoney` takes a viewer: the owner always; a
    manager only when the switch is literally `true`; staff never, whatever
    the column says. Every money path listed in item 2 follows it (the week,
    shift writes, cover, callout, roster, and `week.money`). A switched-on
    manager may set a colleague's wage (`wageWriteRefusal`), and each write
    still names its writer in the same statement; **their own wage stays
    refused** — the 2026-09-21 rule refused it "their own included", the
    round-4 answer did not address it, and a raise someone gives themselves
    is the one write the switch should not open unasked (returned, below).
    **[2026-09-25, founder round 5 item 32, recorded as: "a manager with pay
    access MAY set their own wage, with a notification to the owner (and
    visible in the report/audit trail)". The refusal above is removed, not
    narrowed. `wageWriteRefusal(viewer)` now refuses only a writer who does
    not see money. `updateMember` reads the target row first
    (`readOwnRow`: whose it is, and the old figure). When a non-owner who sees
    money moves the figure on their OWN row (`ownWageTellsTheOwner`),
    `recordOwnWageChange` (`team/own-wage-notice.ts`) does two things:
    (a) it files a `team_member_own_wage_set` row in `system_audit_log` with a
    subject and NO figures, because the team trail it feeds is readable by
    everyone in the house and a wage there would hand it to people the money
    rule withholds it from; (b) it sends one in-app notification to every
    ACTIVE owner, carrying the old and new figure in the house currency. The
    figures stay where they always were, in `team_member_wage_changes`, which
    the trigger writes in the same statement with `changed_by` and
    `changed_by_role = manager`. Settings-audit reads the new action back, and
    /team's trail lists it as "set their own wage (an owner was told)". The
    page offers the manager their own wage field, with a note saying the owner
    is told. The save answers `ownWage: { audited, ownersNotified,
    ownersFound }`. When no owner was told (the owners could not be read, or
    the notice was refused), the sheet stays open and says so; the wage stays
    saved. An owner setting their own wage tells nobody, and a save that does
    not move the figure tells nobody. Rejected: keep the refusal (the round-4
    build); allow it with no notice; hold the new wage until an owner
    approves it. The founder's answer names a notice, not an approval, so the
    last would add a pending state nobody asked for. Pinned in
    `team-pay-round4.spec.ts` (R5) and CLAIMS
    `ADR-0215-R5-A-MANAGERS-OWN-WAGE-TELLS-THE-OWNER`.]**
    Only the owner writes the switch (`PATCH …/members/:memberId/pay-access`,
    `setPayAccess`): the target must be an ACTIVE MANAGER of the house by
    membership (an owner sees pay already, staff never do, a roster row with
    no account has no membership), every change is a `team_pay_access_changed`
    row in `system_audit_log` with from/to, the manager is told, and a save
    that moves nothing records nothing. The switch is read APART from the
    membership read (`managerPayAccess`, `payAccessByUser`): until the
    migration applies the column does not exist, and folding it into
    `assertAccess` would have locked every owner and manager out of /team for
    the deploy window; an unread switch answers OFF (money withheld, never
    shown on a guess) and the owner's roster says it could not be read. No
    client can write it: `user_restaurant_access` has RLS with SELECT
    policies only, and the migration asserts anon/authenticated hold no
    write grant. The web offers the switch on a manager's row to the owner
    only ("Sees and sets pay"), and never offers a manager their own wage
    field. Rejected: a whole-account on/off (the founder's other option);
    a house-wide flag (that was `wage_visible`, retired in item 3 because a
    single flag cannot tell one manager from another); a separate grants
    table (one more table to keep in step with membership, for a boolean the
    membership row can carry).
22. **The owner's former-staff history (round 4, 2026-09-25).** Founder pick:
    "Owner-only history (Recommended)" — "Hidden from the team views; the
    owner can open a 'former staff' history for pay and legal records."
    `GET /restaurants/:rid/team/former-staff` (`listFormerStaff`, owner
    only) returns one entry per recorded departure: the kept shifts (worked
    hours on item 10's rule, cost, called-out marked), leave (dates, status,
    type — the free-text `reason` is never read), wage changes and
    credentials, with "kept until" (removal + five years). The NAME comes
    from the removal's own audit row (`team_member_removed`,
    `changes.display_name`, written by `deleteMember` since ADR 0088); the
    departure row holds no name on purpose (KVKK: the minimum,
    `20261201110110`), so none was added — a missing audit row reads "Name not
    recorded". A total is `null` when any worked shift had no cost on file,
    never a partial. Every read binds its error: a failed read is a 500 in
    words, never an empty list that would read as "nobody has left". The team
    views are unchanged (item 20's `onTheRoster`); credentials join them
    (item 23). The web opens it from "How this desk is configured" (owner
    only) in a sheet with reading / failed / empty / list states. Rejected:
    "Shown, marked former" and "Never shown" (the founder's other options).
23. **Credentials are kept, availability is not (round 4, 2026-09-25).**
    Founder pick: "Credentials yes, availability no (Recommended)" —
    "Certificates can matter for audits; availability has no value once
    someone leaves." Migration `20261201110210` drops
    `team_certifications_member_id_fkey`; a departure is stamped for a
    person with a credential; `purge_expired_credential_records()` (SECURITY
    INVOKER, service_role only) deletes a departed person's credentials past
    five years; `purge_expired_wage_records()`'s departure cleanup and
    `tmd_guard()` wait for credentials too; the nightly job runs the
    credential purge first (then shifts-and-leave, then wages) and stops on
    its failure. `listCertifications` leaves a removed person's credentials
    out of every team view, the owner's included — they are in the
    former-staff history. **Availability:** `team_availability_member_id_fkey`
    stays `ON DELETE CASCADE`, so a removal still deletes it the same second —
    which already is "availability no". Nothing was deleted to get there, and
    nothing needs stopping: the cascade has always taken it, so no retained
    availability row of a removed person can exist (the migration asserts the
    cascade is still in place). ADR 0149's never-delete rule is therefore
    not engaged — there were no retained rows to stop retaining. A kept
    credential's `doc_url` document is not touched (no path ever deleted it).
24. **An owner's pay is the owners' (2026-09-27, founder item 71).** His
    answer to question 7, verbatim: "if owner taking money, manager can't see it". Read
    as the founder-answers record states it: an owner's wage is invisible to
    managers — not shown, not settable, even with pay access; only owners
    see and set an owner's wage (stronger than the offered "(a) refuse it",
    which covered the write alone). Built, per row, in `pay-rules.ts`:
    `seesMoneyOf(viewer, memberId)` is the owner always; for a manager with
    pay access, every row EXCEPT an owner's; an open shift (no person) is
    nobody's wage. The viewer carries `ownerMembers` — the roster ids whose
    account holds an owner membership of the house, active or not — read by
    `TeamService.assertAccess` only for a switched-on manager; if either
    read fails, that manager's pay access is off for the request (withheld,
    never guessed). Every read path that carries pay goes through it:
    `listMembers` and every member reply (`createMember`, `updateMember`)
    via `memberForViewer`; `getWeek` and every shift reply (`createShift`,
    `updateShift`, `assignCover`, `reportCallout`) via `shiftForViewer` —
    an owner's shift loses `labor_cost`, because cost over worked hours IS
    the wage. A withheld row carries `pay_withheld: "owner"` so the page
    says whose it is rather than "no wage on file" / "not priced". The
    week's labour block leaves an owner's shifts out of a manager's
    `totalCost`, `pricedShifts` and `unpricedShifts` (with every other cost
    beside it, a total holding the owner's would give it back by
    subtraction) and says how many in `ownerShiftsLeftOut`; hours are not
    money, so the owner's hours still count. **The write:**
    `wageWriteRefusal(viewer, targetMemberId)` now reads the TARGET row —
    a non-owner writing an owner's row, or a row whose owner-ness is not
    known, is refused in words ("Only an owner can set or change an owner's
    pay. Nothing was saved.") before any read of the row or any write; a
    new row (`createMember`) is nobody's yet. A manager may still edit an
    owner's other details. Already owner-only and unchanged: the
    former-staff history and its `team_member_wage_changes` rows
    (`listFormerStaff`), the own-wage notice (sent to owners only, and only
    about a manager's own row), the audit trail's `team_member_own_wage_set`
    row (no figures). No other gateway, orchestrator or mobile path reads
    `hourly_wage` or `labor_cost` (`git grep`, 2026-09-27), and the client
    grants on these tables were revoked schema-wide (OD-72), so the gateway
    is the only door. Web: the roster names an owner's wage "the owner's",
    the member sheet offers no wage field on an owner's row to a manager
    (and the legacy desk's editor neither), the week grid's labour lens shows
    an owner's shift as hours, the shift sheet names the cost as the
    owner's, and the labour block says "Leaves out the owner's N shift(s)".
    Rejected: withholding a switched-on manager's whole week total whenever
    an owner works a shift (it would undo item 21 for every house whose
    owner is on the schedule); keeping the owner's cost in the total (the
    owner's figure by subtraction). No migration: the rule is applied where
    a response is built, like every other money rule here.
    **[Corrected 2026-09-27, ADR 0090 audit of #440 at `ccd69c4e`: "an open
    shift (no person) is nobody's wage" held in `seesMoneyOf` but not in the
    figure it was handed. `updateShift` priced with `dto.memberId ??
    cur.member_id`, and `??` falls through an explicit `null`, so a
    switched-on manager who sent `{memberId: null}` on an owner's shift got
    it back open, priced at the owner's wage, unmasked (the audit reproduced
    it; the global `ValidationPipe`, `whitelist` + `forbidNonWhitelisted` +
    `transform` in `main.ts`, lets that `null` through, now pinned by a
    spec) — cost over worked hours is the owner's wage. Fixed two ways:
    `updateShift` prices the person the shift will HAVE (`null` for an
    unassign), and `shiftForViewer` says a stored cost on an open shift as
    `null` for every viewer, so a row the old fall-through already wrote is
    not passed on (whether production holds any was not measured). Every
    other writer already priced an open shift as `null` (`createShift`,
    `copyWeek`, `reportCallout`'s new open shift). R6 gains three cases;
    CLAIMS `ADR-0215-R6-AN-UNASSIGNED-SHIFT-CARRIES-NO-ONES-WAGE`.]**
    **[Corrected 2026-09-27, ADR 0090 audit of #440 at `ea4cc38d0`: "every
    read path that carries pay goes through it" held for the rows of people
    still on the roster, not for a REMOVED owner's kept shift. `deleteMember`
    deletes a removed co-owner's access row and roster row (it is a removal,
    not a deactivation); item 20 keeps their shifts; `ownerMemberIds` is a
    live read and so no longer names the gone roster row; `seesMoneyOf` then
    read the kept shift as a colleague's. The by-id shift routes checked no
    roster, so a switched-on manager's note-only `PATCH` of that shift
    answered with its stored `labor_cost` beside its hours — the owner's wage
    (reproduced end to end through the real `deleteMember`: 300 over an
    8-hour shift) — and any manager could `DELETE` a record item 20 keeps five
    years. Fixed by applying round 4 item 19's answer ("Hidden from the team
    views; the owner can open a 'former staff' history") to the by-id routes:
    `TeamService.assertOnTheRoster` answers 404 for a row whose `member_id`
    names nobody on the live roster (an open row passes; a failed roster read
    raises, never passes), called by `updateShift`, `deleteShift`,
    `reportCallout`, `offerCover`, `assignCover` and `reviewTimeOff` before
    any write, for a manager AND an owner — the kept row is history, read in
    the former-staff history and ended only by the retention job. The
    owner-set reads themselves are unchanged: the gate keeps a removed
    person's row from ever reaching `seesMoneyOf` through these routes.
    `deleteShift` now reads the shift first; a missing shift is 404 and a
    failed read or delete is 500, where both used to be answered as done.
    Residual (s). CLAIMS
    `ADR-0215-R6-A-REMOVED-PERSONS-KEPT-ROW-IS-NOT-REACHABLE-BY-ID`.]**
    **[Corrected 2026-09-27, ADR 0090 audit of #440 at `78125580a`: "an
    owner's wage is invisible to managers" holds for a person whose
    membership here is an owner's NOW (active or not), not for one who WAS
    an owner. `restaurants/members.service.ts` `updateMemberRole`
    (`:186-258`, untouched by this PR) lets any owner change ANOTHER owner's
    role in place to manager — only the last owner's self-demotion is
    refused (`:236-249`) — and `ownerMemberIds` (`team.service.ts:163-195`)
    reads `role = 'owner'` live, so from that moment the former owner's
    roster row is a colleague's: a pay-access manager is shown their
    `hourly_wage` and the stored `labor_cost` of every shift priced while
    they owned the house, per row and inside the week total. Reproduced
    through the real `updateMemberRole` (wage 40 and a 300 shift shown; the
    total 637.5 where it was 337.5). NOT changed in code: which part of a
    former owner's pay stays the owners' (the owner-period shifts, the
    wage, both, or neither — they are a manager now) is not decided by item
    71's words, which name an owner, nor by OD-165, which is a manager's own
    pay-access switch. Returned as "Open, for the founder" question 8;
    residual (t); pinned as built. CLAIMS
    `ADR-0215-R6-AN-OWNERS-PAY-IS-THE-OWNERS` narrowed in place.]**
    **[2026-09-28, founder item 80: the correction above is answered —
    "Hide owner-period pay (Recommended)". A former owner's owner-period shift is withheld
    from a manager as a current owner's is; item 25.]**
25. **A former owner's owner-period pay stays the owners' (founder item 80,
    2026-09-28, ADR 0215 question 8 / residual (t)), verbatim: "Hide owner-period pay (Recommended)".**
    When one owner changes another owner's role in place
    (`restaurants/members.service.ts` `updateMemberRole`), the shifts dated
    inside that person's owner period stay masked from managers exactly like
    a current owner's: no `labor_cost` on the row (it carries
    `pay_withheld: "owner"` instead), and none in the week total, whose
    `ownerShiftsLeftOut` counts them. From the demotion on, their pay is a
    manager's like any other. How it is built:
    - **The owner period is read from the record the role change already
      files**: `system_audit_log` rows with `action = 'member_role_changed'`
      and `changes.role.from/to` (`recordAccessChange`, ADR 0088), read by
      `TeamService.formerOwnerPeriodsOf` for a switched-on manager's viewer
      and turned into days by `pay-rules.ts` `formerOwnerPeriods`: a change
      TO owner opens a period on its day, a change FROM owner closes it on
      its day (inclusive — they were an owner for part of it); with no
      opening change on the record the period runs from before the record
      (an owner from the start). Only people who are not an owner now get
      periods; a current owner's every figure is already the owners'.
    - **The day is the house's**: the instant is read on
      `restaurants.timezone` when it names a zone this server resolves. With
      none stated (the real tenant's today) or an unreadable one, the day is
      taken at its widest on the side that withholds — a period starts on its
      day at UTC-12 and ends on its day at UTC+14 (`houseDay`) — so a shift
      the day after a demotion may stay withheld; it is never shown early.
    - **One test, every pay read**: `seesShiftMoneyOf(viewer, memberId,
      shiftDate)` is `seesMoneyOf` plus the period, used by `shiftForViewer`
      (the `getWeek` rows and every by-id shift reply: `createShift`,
      `updateShift`, `reportCallout`, `assignCover`) and by `computeLabor`'s
      manager total. A former owner's shift with no readable date is
      withheld. An unreadable audit or roster read turns the manager's pay
      access off for the request, as an unreadable owner set does (item 24).
    - **The wage**: the roster's `hourly_wage` is not dated, and from the
      demotion on it is a manager's (path (a), as put to the founder: "their
      wage from the change on is a manager's like any other, and an owner
      re-sets it"), so `memberForViewer` and `wageWriteRefusal` still use
      `seesMoneyOf` and a pay-access manager sees and may set it. Until an
      owner re-sets it, the figure shown is the one set while they owned the
      house — path (a)'s stated cost, not a new leak. The wage HISTORY
      (`team_member_wage_changes`) has one reader, the former-staff history,
      which is owner-gated (`listFormerStaff`), so no manager reads an
      owner-period wage change.
    - **Not seen**: a demotion whose audit row failed to write
      (`recordAccessChange` logs it and the change stands) or one made
      outside the gateway; that person reads as never having been an owner.
      Residual (t)'s remainder, stated, not guarded.
    CLAIMS `ADR-0215-R7-A-FORMER-OWNERS-OWNER-PERIOD-PAY-IS-THE-OWNERS`.
26. **A removed person's unstarted shifts go back to the open pool
    (founder item 93, 2026-09-28, OD-181), verbatim: "back to the open pool
    absolutely".** It answers the fork the preserved wt-labor snapshot
    (`4d299b231`, round 6z "Past shown, future open") and item 20's round-4
    bracket ("nothing reassigns them") left unreconciled; the snapshot's own
    items 21–23 are not carried (their numbers collide with, and two of them
    contradict, items 21–23 above). How it is built
    (`TeamService.openUnstartedShiftsOf`, called by `deleteMember`):
    - **Which shifts**: the person's rows in this house not yet started by
      the house's clock — dated after today, or today with a start time
      still ahead (`pay-rules.ts` `shiftNotYetStarted`). A started, past or
      unparseable one stays theirs, kept (item 20) and read in the
      former-staff history (item 22). A call-out stays too: its slot is
      already in the pool as the cover shift `reportCallout` opened, so
      opening it would double the slot (the snapshot opened it; not carried).
    - **Whose clock**: `common/house-frame.ts` `houseFrame` on
      `restaurants.timezone`/`country` (the house's zone, else its country's
      only zone). With no zone, the clock is read at UTC+14
      (`houseWallClock`), so only a shift unstarted in every zone opens —
      the house-frame rule, not ADR 0116's UTC fallback, because this is a
      write that clears a cost and a wrong "future" loses history, while a
      wrong "past" only leaves a hidden slot for the manager to refill.
    - **The write**: `member_id` null, `state`/`shift_type` `open`,
      `labor_cost` null (the cover-shift shape). The receipt carries
      `shiftsOpened`; the `team_member_removed` audit row carries
      `changes.shifts_opened`.
    - **Order and failure**: after every refusal (owners manage owners, the
      last owner) and before the first membership write (the calendar-link
      stop for a person with an account; the roster delete for one
      without), so a refused removal opens nothing and a failed open removes
      nobody. A failed `restaurants` read, shifts read or shifts write is a
      500 in words; nothing is guessed. Not atomic: if a LATER step fails
      (calendar stop, `users` clear, access delete, roster delete), the
      shifts are already open and the person is still listed; a retry opens
      nothing more and finishes the removal.
    - **The dialog** (`RosterSheet.tsx`) says the unstarted shifts go back
      to the open pool; `/help#replace-team-member` (`hp-faq.ts`) gives
      today's replace procedure (add, move, then remove).
    `team-pay.spec.ts` K2, 10 cases (9 fail on `origin/main` `0d7af2975`;
    the owner refusal is a control), 10 of 10 service and pay-rules mutations killed;
    CLAIMS `ADR-0215-R8-A-REMOVED-PERSONS-UNSTARTED-SHIFTS-GO-TO-THE-OPEN-POOL`
    (14 of 14 anchor mutants fail it).
    **[2026-09-28, founder answer on PR #502, verbatim: "handle it sota, it
    also has to take care of yhat exact edge case where it opens midahift
    then everything changes accordingly".** The lane's reading, stated on
    the PR: (1) "sota" = resolve the house's real zone before guessing, the
    way mature scheduling tools do, and only with no source at all apply a
    conservative rule and say so; (2) a removal WHILE a shift of theirs is
    in progress splits it at the removal minute on the house clock, and
    every figure derived from the shift follows. What was built, superseding
    the "Whose clock", "The write" and "Which shifts" bullets above where
    they differ:
    - **Whose clock** (`pay-rules.ts` `removalClock`): the house's own
      `restaurants.timezone` (the location row — `createLocation` writes a
      `restaurants` row, and at sign-up it is the browser's zone, else none,
      item 62), else its country's only zone (`houseFrame`), else **the
      remover's device zone**, which the web now sends as `?deviceZone=`
      and the gateway checks exactly as sign-up checks a browser's
      (`resolveSignUpTimezone`: an IANA name `Intl` resolves, never a bare
      offset), else none. Researched: 7shifts, Deputy and Homebase each set
      the zone on the LOCATION and 7shifts says it "affects all schedule
      times and labor reports"; Deputy shows each location's schedule in
      its zone "regardless of the time zone for the scheduling manager" and
      the mobile app defaults to the DEVICE zone; When I Work defaults a
      workplace's zone to "the Admin's location when the workplace account
      is created" and lets a schedule follow the zone 75% of its users set
      in their profiles; the Google Calendar API reads a zoneless event time
      in the calendar's default zone; RFC 5545 reads a zoneless ("floating")
      time in whoever reads it. So location zone first, then a person's
      local zone. **Rejected sources, measured:** the owner's profile — the
      only per-person zone column is `manager_preferences.report_timezone`,
      which no product path writes (the one writer is
      `services/agent-orchestrator/demo/weekly_report_scheduler.py:127`,
      writing the very `America/Los_Angeles` default migration
      20260904190000 removed), keyed on `manager_id` with no foreign key;
      `users` has no zone column; ADR 0116's UTC fallback — a claim about a
      fact nobody holds, and here it would cut paid hours at a guessed
      minute. **With no source at all:** a shift unstarted at UTC+14 opens,
      one ended at UTC-12 is kept, anything between is kept whole and NAMED
      (`shiftsUnjudged`, `changes.shifts_unjudged`), never cut; the web says
      so before the sheet closes, and also says when the device's clock was
      the one used (`RosterSheet.tsx`).
    - **Which shifts** (`planLeavingShifts`): start minute now or later —
      OPEN whole (a shift starting this very minute had no minute worked);
      end minute now or earlier — kept; in between — SPLIT. The read now
      reaches the day before the house's earliest "today"
      (`leavingShiftsFrom`), so an overnight shift that began yesterday is
      found. A call-out and an open row are left alone, as before.
    - **The split**: the worked part keeps the row, `end_time` = the
      removal minute, its break and `labor_cost` recomputed for the shorter
      span at the person's wage (read before any write; a failed read
      refuses). The rest is a NEW open shift — same `role` and `note`
      (`shifts` has no area column: baseline:5378 and every later
      migration), nobody on it, `labor_cost` null, `shift_type`/`state`
      open; cut after midnight it is dated the next day and takes that
      week's `schedules` row. Spans are wall-clock minutes, as every hour
      rule counts them (`hoursBetween`), so the two parts add up to the
      shift on a DST night too.
    - **Breaks**: a planned `shift_breaks` row has a place on the clock, so
      each part gets the minutes that fall inside it, written as a recorded
      number (a row whose start does not parse counts as after the cut —
      never lowering the worked pay); a recorded `0` stays `0` in both; any
      other recorded number says how long, not when, so each part gets
      `null` — the Art. 68 minimum for its own length, shown as ASSUMED
      (round 6y) — and the audit keeps the old number
      (`changes.shifts_split[].was_break_min`, `was_end`). A part too short
      to hold that minimum (a stint "started but under a minimum length",
      e.g. ten minutes) had no break: `0`, so ten minutes are paid as ten.
    - **All or none**: every write is one call to
      `release_leaving_shifts` (migration 20261201130000, SECURITY INVOKER,
      service role only), one transaction that re-checks each row is still
      as read (person, date, times, state) and that each cut adds up, and
      raises otherwise, so nothing half-lands; the gateway then refuses
      ("nobody was removed") before its first membership write — the
      ordering above is unchanged. Rejected: two or three PostgREST writes
      (a failure between them lands half a removal); one multi-row upsert
      (atomic, but rewrites whole rows from the read and loses a concurrent
      edit).
    - **Everything follows**: the week (`getWeek`) and its labour, the
      former-staff history, the calendar feeds and the roster notices all
      read the stored rows, and the stored cost equals `priceShift` on the
      stored worked row (asserted), so no reader recomputes anything
      different. The week keeps hiding the removed person's worked part
      (item 20; whether a past week should show it stays the founder's
      question) and shows the rest as open.
    `team-pay.spec.ts` K3, 25 cases (all fail on the branch head
    `c2bad0f0e`, the pre-change merge) and 4 re-cut K2 cases; 22 of 22
    service/pay-rules mutants killed;
    `supabase/tests/20261201130000_a_removal_mid_shift_splits_the_shift_test.sql`
    fails without the migration and passes with it, 12 of 12 SQL mutants
    killed (run on a stand-in schema, not a full migrated database). CLAIMS
    `ADR-0215-R9-A-REMOVAL-MID-SHIFT-SPLITS-THE-SHIFT`. Forks it found, not
    decided: OD-190 (a very short rest), OD-191 (paging for cover now),
    OD-192 (the device zone), OD-193 (DST hours are wall-clock).]**
27. **"Replace with" — a leaving person's shifts can go to someone named
    (founder, 2026-09-28, answering `.planning/06-pages/team.md` §15).**
    **[2026-09-28, the founder's answers, verbatim — Replacement: "'Replace
    with' picker"; Picker checks: "refuse overlap warn rest but owner has a
    say to change it into warn all four to allow double booking".** The
    lane's reading: option (b) of §15 — on the remove dialog, the remover
    picks someone already on this house's roster, and the leaving person's
    upcoming shifts (and the rest of one cut now, item 26) go to them instead
    of the open pool; whatever is not handed over still opens. "Refuse
    overlap" = a shift that overlaps one the chosen person already has is
    REFUSED; "warn rest" = the other three checks WARN; "owner has a say ...
    warn all four" = an owner-only house setting turns the overlap into a
    warning too, which allows double booking. What was built:
    - **The four checks** (`pay-rules.ts` `handoverChecks`), chosen from what
      the code records, default level in brackets:
      1. `overlap` [REFUSE; WARN when the owner allows double booking] — the
         chosen person has another shift (not open, not a call-out) whose
         wall-clock span overlaps it, overnight shifts wrapping; handed-over
         shifts are checked against each other too; touching ends do not
         overlap.
      2. `time_off` [WARN] — an APPROVED `time_off_requests` row of theirs
         covers its date (pending and rejected do not count).
      3. `role` [WARN] — the shift names a `role` that their `position` and
         `skills` do not list (case and spaces aside); a shift with no role
         is not checked.
      4. `weekly_hours` [WARN] — with it, their worked hours in its
         Monday-week pass `WEEKLY_REVIEW_HOURS` (45, 4857 Art. 63; the same
         review line the week's labour uses, item H2); 45 exactly is not over.
      **Not checks, measured:** `team_availability` (baseline:5594) — a table
      no route reads or writes (no gateway or web code names it; migration
      20261201110210 only keeps it cascading on a removal), so a check on it
      would never fire; a rest-between-shifts rule — none exists
      anywhere in the code; `house_away` / Away (ADR 0218) — a hold on
      MESSAGES, not a scheduling state. Filed as OD-194 and OD-195.
    - **Where the owner's setting lives:** a new column
      `team_settings.allow_double_booking boolean NOT NULL DEFAULT false`
      (migration 20261202120000). `team_settings` is this house's team-rule
      row and every rule on it is one typed column (`labor_tracking_enabled`,
      `labor_target_pct`) read and written by `getSettings`/`updateSettings`
      and recorded in `team_labour_settings_changed`; there is no settings
      JSON on it to put a key in. **Rejected:** `restaurants.settings` jsonb
      (the house profile's bag, not /team's, no owner-only write rule, and a
      key there is invisible to the migration guards); a per-person flag (the
      founder named one owner say for the house). Owner only, either way
      (`doubleBookingRefusal`; a manager's write is a 403 before anything is
      saved), recorded like the labour settings, returned as `false` for a
      house that never set it, and offered as "Allow double booking" in
      Settings → Team (`TeamLaborSettings.tsx`) only to the owner
      (`mayChange.doubleBooking`).
    - **Server-side, the page only shows.** `GET
      /restaurants/:rid/team/members/:memberId/handover?to=` (owner or
      manager; both people must be on this house's roster, another house's
      person is a 404) returns the leaving person's upcoming shifts as the
      removal would plan them and, with `to`, each shift's checks — no wage
      or cost. `DELETE .../members/:memberId?replaceWith=&handOver=&accept=`
      re-plans and re-runs every check at the write: a REFUSE stops the whole
      removal (409 with `refused`), and every WARN whose code is not in
      `accept` stops it too (409 with `unaccepted`) — so a warning that
      appeared after the page looked is never accepted unseen. `handOver`
      names shifts by the leaving shift's id; one that is not an upcoming
      shift of theirs (someone else's, a past one, a stale id) is a 400; the
      chosen person must not be the person leaving (400) and must be on this
      roster (404, `.eq("restaurant_id", …)` on the read); an unknown
      `accept` code or a `replaceWith` without shifts is a 400. A failed read
      of the chosen person's shifts, leave or the setting refuses — never
      "no clash". Handed-over shifts are re-priced at the NEW person's wage
      (`priceShift`); the receipt (`shiftsHandedOver`, `handedTo`) carries no
      money; the audit row adds `shifts_handed_to`, `shifts_handed_over
      [{id, row, part}]` and `shifts_warnings_accepted` (only codes that were
      raised and accepted).
    - **All or none, and the database checks too:** one call to
      `hand_over_leaving_shifts` (migration 20261202120000, SECURITY
      INVOKER, service role only) runs `release_leaving_shifts` for what
      opens and what is cut, then moves each named unstarted shift to the new
      person whole (re-checked as read, keeping its `state`/`shift_type`) and
      each named rest (the row step one inserted, given the cut shift's
      `state`/`shift_type`), and raises — changing nothing — if the new
      person is not on this house's roster, is the leaving person, or ends up
      overlapping another of their shifts while the house's
      `allow_double_booking` is off OR the remover did not accept the
      overlap. It reads the setting and the other shifts in the transaction
      that writes, so a shift added to them after the gateway's check is
      still caught. The removal without a picker still calls
      `release_leaving_shifts` exactly as item 26 built it.
    - **The dialog** (`RosterSheet.tsx` `ReplaceWithPicker`): "Their upcoming
      shifts go to" — the open pool (default) or anyone else on the roster
      (`TeamNext.tsx` passes the roster). Choosing someone loads the checks;
      every shift that may go is ticked, a refused one cannot be ticked and
      says it goes to the open pool, warnings are shown under their shift and
      "Remove and hand over N shifts" stays disabled until "I have read the
      warnings above …" is ticked; unticking a shift leaves it for the pool.
      A 409 is shown in the gateway's own words. The FAQ
      (`/help#replace-team-member`, `hp-faq.ts`) now gives this procedure
      instead of moving each shift by hand.
    - **Researched (web search, 2026-09-28; the help-centre pages were
      reached through search results only — direct fetches of
      kb.7shifts.com, help.deputy.com and help.wheniwork.com were blocked by
      this environment's egress proxy):** 7shifts has no hand-over at
      termination — after deactivating, "you must manually manage any
      remaining shifts" and future shifts stay on the schedule until deleted
      or reassigned ([How to deactivate an employee](https://kb.7shifts.com/hc/en-us/articles/4417505066515-How-to-Make-an-Employee-Inactive),
      [Reassign Shifts on the Schedule](https://kb.7shifts.com/hc/en-us/articles/33962078614419-Reassign-Shifts-on-the-Schedule));
      Deputy will not archive a person until their shifts are removed from
      the schedule ([Archiving and unarchiving team members](https://help.deputy.com/hc/en-au/articles/4764904256143-Archiving-and-unarchiving-team-members)),
      and its picker lets a manager "override the 'Not Recommended' warning
      for all factors ... EXCEPT OVERLAPPING" — the founder's default,
      exactly ([Ensure a team member is recommended for a shift](https://help.deputy.com/hc/en-au/articles/4688700112015-Ensure-a-team-member-is-recommended-for-a-shift));
      When I Work flags "Scheduling Concerns" on a shift — an overlapping
      scheduled shift, a broken scheduling rule, time off, an unavailability
      preference — and still lets a person be scheduled past their max hours
      ([Identifying Scheduling Conflicts](https://help.wheniwork.com/articles/identifying-scheduling-conflicts/),
      [Max Hours Enforcement Reference](https://help.wheniwork.com/articles/max-hours-enforcement-reference/));
      Homebase names availability, double-booking and time-off conflicts and
      overtime alerts ([Schedule Conflicts](https://www.joinhomebase.com/glossary/schedule-conflicts)).
      So a one-step hand-over at removal is beyond what the four offer, and
      "overlap blocks, the rest warn" is Deputy's rule.
    - **Rejected here:** the picker adding a NEW person inline (§15 (b)
      mentioned it; the founder's answer names the picker, and adding stays
      on Team, before the removal, as the FAQ says); a per-shift choice of
      person (one person per removal; unticked shifts go to the pool, and a
      second person can take them from there); accepting warnings by a single
      "force" flag (a warning that appears after the page looked would be
      accepted unseen).
    `team-pay.spec.ts` K4, 24 cases (all 24 fail on the branch head
    `8dd9bfeaf` — measured by running the new spec against that head's four
    gateway files — together with the re-cut `mayChange` case in S1); 21 of
    21 service/pay-rules/controller mutants killed (one survived at first —
    `getSettings` dropping the `false` default for a row saved before the
    column — and a case was added that kills it);
    `supabase/tests/20261202120000_a_leaving_persons_shifts_can_go_to_someone_named_test.sql`
    fails without the migration (no function) and passes with it, 6 of 6 SQL
    mutants killed (a stand-in schema of the five tables it reads, as item
    26's test was run — not a full migrated database); `TeamPayRound4.test.tsx`
    "Replace with" block, 5 cases, all fail on `8dd9bfeaf`'s
    `RosterSheet.tsx` and `team.ts`. CLAIMS
    `ADR-0215-R10-REPLACE-WITH-HANDS-SHIFTS-TO-SOMEONE-NAMED` and
    `ADR-0215-R11-DOUBLE-BOOKING-IS-THE-OWNERS-SWITCH`; R8 and R9's anchors
    re-cut for the reshaped `releaseShiftsOf` call (same behaviour). Forks
    it found, not decided: OD-194 (availability as a check), OD-195 (a
    rest-between-shifts rule), OD-196 (telling the person who was handed the
    shifts).]**

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
  sent only with the owner's money today. **[2026-10-04, ADR 0294: (f) is
  closed. `PerformanceCard.tsx` prints these figures in the house's currency
  through `tm-format`, and the performance route now sends the house's
  currency and country with them, to whoever may read the card; a currency
  code is not pay. `PerformancePanel.tsx` went with `pages/team/command/`
  (ADR 0149 cutover). Both rows left the baseline.]** (g) The gateway now names
  `shifts.recorded_break_min` in its shift reads: served before migration
  `20261201110100` has applied, those reads fail and answer a 500 in words,
  not a wrong figure. (h) Only the redesigned shift sheet has the break field;
  the legacy desk (`pages/team/command/**`) saves shifts without one, which
  leaves a recorded break as it was. (i) The retention job runs in every
  gateway instance; the purge is idempotent, so two instances delete nothing
  twice. (j) ~~Found at the round-2 last call, not changed here: removing a
  person still deletes their shifts, leave requests, availability and
  credentials the same second (baseline foreign keys `shifts_member_id_fkey`,
  `time_off_requests_member_id_fkey` and others, `ON DELETE CASCADE`,
  `20260805000000_baseline_from_production.sql:13502`, `:13654`), so the
  wage record kept five years outlives the hours it priced. Keeping those is
  a founder question (below), not a default.~~ **[Resolved 2026-09-22, round
  6y, item 20: shifts and leave requests are no longer taken by the removal —
  the two foreign keys named above are dropped, and both are kept on the same
  five-year clock as the wage record.** Availability and credentials are
  UNCHANGED by item 20 (the founder's pick, verbatim, named shifts and leave
  requests only): a removal still deletes those two the same second. That is
  a residual of item 20, not a decision — restated so it is not mistaken for
  one.] **[Resolved 2026-09-25, round 4 item 19, "Credentials yes,
  availability no (Recommended)": credentials are now kept on the same clock
  (`team_certifications_member_id_fkey` dropped, migration
  `20261201110210`); availability still cascades, on purpose — item 23.]** (k) A departure is stamped once
  (`ON CONFLICT DO NOTHING`): a roster row removed, re-inserted under the SAME
  id and removed again would keep the first date. No product path re-inserts
  an id (every insert takes a generated one), so this is noted, not guarded.
  (l) Found at the round-3 last call, not changed: with no foreign key, a
  shift or leave request written in the instant between `createShift`'s
  (or `createTimeOff`'s) roster check and a concurrent removal is kept under
  an id nobody holds; if that person had nothing else at the removal, no
  departure was stamped for them and nothing times that row's five years. A
  race of one request's width, noted, not guarded. (m) `rosterAt`
  (`notifications/producers/roster.ts`), which names who the schedule had on
  shift at an instant, still reads every shift: a removed person's kept
  shift at that instant is named with the em dash its "member row is gone"
  case already renders, where before this change it was absent. (n) **Found
  2026-09-26, ADR 0090 audit of 583184b7:** `restaurants/members.service.ts`
  `updateMemberRole` writes only `{ role: newRole }`; `team_pay_access` is
  otherwise cleared only by `deleteMember`, so a manager demoted to staff and
  later re-promoted silently regains their prior pay access with no new
  `team_pay_access_changed` row and no fresh owner decision. Owner-gated and
  house-scoped throughout — not a cross-house or auth hole. Filed as
  [OD-165](OPEN-DECISIONS.md), not decided here.
  (o) ~~**Found 2026-09-27, ADR 0090 audit of 25e55b2c:** a manager whose pay
  access is on may set an OWNER's wage. `wageWriteRefusal(viewer)`
  (`pay-rules.ts`) looks only at the writer, never at whose row it is, and
  `ensureRosterFromAccess` gives an owner a `team_members` row like anyone
  else's; `ownWageTellsTheOwner(viewer, targetIsSelf)` is false on a row that
  is not the writer's own, so the owner is not told — the only trace is the
  `team_member_wage_changes` row naming the manager. Round 4 item 19 ("see
  and edit pay") and round 5 item 32 (a manager's OWN wage) do not name an
  owner's row, and ADR 0218's "only an owner sets or ends an owner's" Away is
  a separate answer about a separate field, so it is not borrowed here.
  Pinned as built by `team-pay-round4.spec.ts` R6 (both directions); returned
  as "Open, for the founder" question 7, not decided here.~~ **[Resolved
  2026-09-27, founder item 71, verbatim: "if owner taking money, manager can't see it" — built as
  item 24; R6 is flipped to the answer.]** (p) An owner's roster row is made
  from their membership by `ensureRosterFromAccess`, which runs before
  `autoLinkByEmail` on every roster read, so an account-less row a manager
  created with an owner's email cannot become that owner's second row
  (`uq_team_members_user`). Only if that backfill's insert failed (it logs a
  warning and goes on) could such a row — its wage set by the manager, and
  recorded as theirs — be linked to the owner; noted, not guarded. (q) The
  legacy desk's Tonight pulse (`ManagerShiftDesk.tsx`) shows its em dash
  (unknown) to a switched-on manager on a night an owner works, and the CSV
  export leaves an owner's shift cost blank for them; neither shows the
  figure. (r) A switched-on manager's week total is the total of the shifts
  that are not an owner's, and the page says so; their labour-target
  comparison (if one is drawn) is against that total. (s) **Found
  2026-09-27, ADR 0090 audit of `ea4cc38d0`:** the by-id gate
  (`assertOnTheRoster`) reads the roster once, between reading the row and
  writing it; a removal landing inside that window is written through, as
  in (l). A race of one request's width, noted, not guarded. `rosterAt`
  (residual (m)) names people, not money, and is unchanged. (t) **Found
  2026-09-27, ADR 0090 audit of `78125580a`:** an owner whose role here is
  changed in place to manager by another owner (`updateMemberRole`) drops
  out of `ownerMemberIds` at once, so a pay-access manager is then shown
  their wage and the stored cost of the shifts priced while they owned the
  house (cost over worked hours is that wage). No audit signal says pay
  visibility changed; the role change itself is recorded
  (`member_role_changed`, from `owner` to `manager`). Pinned as built by
  `team-pay-owner-rows.spec.ts`, `describe("residual (t), pinned as built —
  an owner demoted to manager in place")`, 3 cases through the real
  `updateMemberRole`; returned as "Open, for the founder" question 8, not
  decided here. **[Answered 2026-09-28, founder item 80, verbatim: "Hide owner-period pay (Recommended)".
  Built as item 25: the owner-period shifts are withheld per row and in the
  total, the wage is a manager's from the demotion on. What remains of (t):
  a demotion with no `member_role_changed` row (its audit write failed, or
  it was made outside the gateway) is not seen, and until an owner re-sets
  the wage, the wage shown is the one set while they owned the house.]**
  **[2026-09-27, ADR 0090 audit of `56940e7d5`: the role-change read had no
  count, limit or range, so a PostgREST `max-rows` cap could return it short
  with no error and a dropped middle demotion would end an owner period
  early (less withheld, not more). `formerOwnerPeriodsOf` now asks for an
  exact count in the same request and treats a short read as an unreadable
  one: pay is withheld from the switched-on manager altogether.
  `team-pay-owner-rows.spec.ts`, "the role changes read SHORT (a row cap)",
  over the stub's new per-table `rowCap`; CLAIMS
  `ADR-0215-R7-A-SHORT-ROLE-CHANGE-READ-WITHHOLDS`. A house whose role
  changes outgrow the cap reads as withheld until the read is paged, which
  is not built.]** (u) **Found 2026-09-27, ADR 0090 audit of `56940e7d5`,
  fixed the same day:** item 20's kept shifts reached a reader outside
  /team that no line of this ADR named. The personal calendar feed
  (`calendar/calendar-links.service.ts` `readShifts`, `feed-scope.ts`
  `selectShifts`) served every shift from 31 days back, with no upper date
  bound, to an owner's or manager's "all" link; a removed person's kept
  shift rendered as "Someone — shift · <role>", which reads as a live
  shift, for as long as the row is kept. No money reached a feed (it
  selects no cost or wage). `readShifts` now passes its shifts through
  `onTheRoster` against the house's live roster, the rule `getWeek` reads
  by, so the feed shows what it did before the foreign keys were dropped;
  an open shift is still served. `calendar-links.service.spec.ts`, OWNER
  and MANAGER cases, both killed by admitting the removed id; CLAIMS
  `ADR-0215-R7-A-REMOVED-PERSONS-KEPT-SHIFT-IS-NOT-IN-A-CALENDAR-FEED`. The
  census of readers of `shifts` and `time_off_requests` at this head
  (`grep -rlE` for `.from("shifts")` / `.from("time_off_requests")` and SQL
  `FROM`/`JOIN` over `apps`, `services`, `supabase/functions`): the calendar
  feed, `team/schedule.service.ts`, `team/team.service.ts` and
  `notifications/producers/roster.ts`; the last is residual (m), unchanged.
  No migration function reads either table outside this ADR's own two.
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

**All five, answered 2026-09-22 (round 6y) — see "Answered, 2026-09-22 (round
6y)" below and Decision items 16–20. Kept here, struck through, so the record
shows what was asked and that nothing was silently dropped (CLAUDE.md §5b):**

1. ~~May a manager switch labour-cost tracking back ON? The pick names only
   switching it off. As built, yes (whoever may save the settings).~~ **Answered:
   "Yes, on and off (Recommended)" — as built (item 16); no code change.**
2. ~~Should a shift of 4 hours or less also assume the Art. 68 (a) minimum of 15
   minutes? The pick names shifts over 4 hours. As built, no.~~ **Answered:
   "Yes, follow Art. 68 (Recommended)" — built (item 10, corrected).**
3. ~~Is the Art. 68 minimum measured on the work the break leaves (as built: an
   8-hour shift is 7.5 hours of work and a 30-minute break) or on the span
   (an 8-hour shift would assume 60 minutes)? The statute keys it on the work
   and says a break is not working time; no court decision was checked.~~
   **Answered: "On work time (Recommended)" — as built (item 18); no code
   change; flagged for the labour lawyer's review.**
4. ~~Does "leaves the roster" include being marked inactive? As built, only the
   removal of the person's roster row starts the five years, so an inactive
   person's wage record is kept for as long as they stay on the roster.~~
   **Answered: "Only removal counts (Recommended)" — as built (item 19); no
   code change.**
5. ~~Removing a person deletes their shifts and leave requests at once
   (residual (j)), so after a removal the kept wage record has no hours
   beside it. Should the shifts and leave of a person who left be kept for
   the same five years, or is the wage record alone what the pick meant?
   As built, only the wage record is kept.~~ **Answered: "Keep them 5 years
   (Recommended)" — built (item 20): the same five-year clock, the same job,
   migration `20261201110200`.**

Nothing from rounds 1 and 2 is open. The round-3 last call (2026-09-22)
returned two new questions to the orchestrator, not filed as OD rows and not
decided here: whether "Yes, on and off" means a manager may also switch
tracking OFF (item 16's reading note), and how a removed person's kept rows
should appear, if at all — their hours on a past week, their unworked future
shifts (item 20, "Kept, not shown"). **[2026-09-25: the founder answered three
questions on these (round 4, item 19) — see "Answered, 2026-09-25 (round 4)"
below and items 21–23. Returned by that round, not decided: whether a
switched-on manager may set their OWN wage (built: refused), and — only if
the founder meant it — the literal "and off" of item 16.]** **[2026-09-25,
round 5 item 32: the own-wage question is answered — allowed, owner notified
(item 21's bracket). The literal "and off" of item 16 is still his.]**

6. **[Added 2026-09-26, ADR 0090 audit of 583184b7, filed as
   [OD-165](OPEN-DECISIONS.md).]** Should `team_pay_access` reset when a
   manager is demoted to staff, or stay sticky through a demote-then-re-promote
   round trip? As built: sticky — `updateMemberRole` never touches the
   column, so a re-promotion silently restores the prior grant with no fresh
   owner decision and no new audit row. Not answered by item 21 (the initial
   grant) or item 32/round-5 (a manager's own-wage write), which cover a
   different moment.

7. ~~**[Added 2026-09-27, ADR 0090 audit of 25e55b2c; residual (o).]** May a
   manager whose pay access is on set an OWNER's wage, and if so, is the
   owner told? As built: yes, and nobody is told (the change row names the
   manager). The paths: **(a)** refuse it — an owner's wage is set only by an
   owner, the shape ADR 0218 gave an owner's Away; **(b)** allow it and tell
   the owners, the notice round 5 item 32 gives a manager's own wage;
   **(c)** keep it as built. Recommended to the founder: (a). Not filed as an
   OD row: the orchestrator returns it to him directly, as rounds 3–5 were.~~
   **[Answered 2026-09-27, founder item 71 (round 13), verbatim: "if owner taking money, manager can't see it" — stronger than (a): an owner's wage is invisible
   to managers, not shown and not settable, even with pay access; only
   owners see and set an owner's wage. Built as item 24. See "Answered,
   2026-09-27 (item 71)".]**

8. ~~**[Added 2026-09-27, ADR 0090 audit of #440 at `78125580a`; residual
   (t).]** When one owner changes another owner's role to manager, does the
   former owner's pay stay the owners'? As built: no — from that moment a
   pay-access manager sees their wage and the stored cost of every shift
   they worked as an owner (item 24's correction bracket). The paths:
   **(a)** the owner-period stays the owners' — a shift dated while they
   were an owner keeps its cost withheld from managers, read from the
   `member_role_changed` audit rows; their wage from the change on is a
   manager's like any other, and an owner re-sets it; **(b)** once an owner,
   always the owners' — every wage and cost of anyone who ever held an
   owner membership here stays withheld from managers; **(c)** refuse the
   change — an owner may step down themselves but not demote another owner
   (a change outside /team, to the members screen); **(d)** keep it as
   built — a manager's pay is a manager's, whatever they were. Cost:
   (a) is the narrowest true reading of "if owner taking money" but needs
   a dated owner-period read on every pay reply; (b) is one widening of
   `ownerMemberIds` but hides a working manager's pay for good; (c) is the
   smallest change and closes the path, but takes a power owners have
   today; (d) is no work and leaves the leak. Recommended to the founder:
   (a). Not filed as an OD row, as question 7 was not.~~
   **[Answered 2026-09-28, founder item 80, verbatim: "Hide owner-period pay (Recommended)"
   — path (a). Built as item 25. See "Answered, 2026-09-28 (item 80)".]**

## Answered, 2026-09-22 (round 6y)

The five questions round 2 (above) returned; the founder answered each,
verbatim, per-item picks relayed as options with a recommended default (his
words quoted where the brief carried more than the option label):

| # | Question | Pick |
|---|---|---|
| 1 | May a manager switch labour-cost tracking back ON? | **"Yes, on and off (Recommended)"** — as built, as relayed: item 16 (its reading note returns the literal "and off" to the founder) |
| 2 | Should a shift of 4 hours or less also assume the Art. 68(a) 15-minute minimum? | **"Yes, follow Art. 68 (Recommended)"** — item 10 |
| 3 | Is the Art. 68 minimum measured on the work the break leaves, or the span? | **"On work time (Recommended)"** — as built: item 18 |
| 4 | Does "leaves the roster" include being marked inactive? | **"Only removal counts (Recommended)"** — as built: item 19 |
| 5 | Should a removed person's shifts and leave be kept the same five years as their wage record? | **"Keep them 5 years (Recommended)"**, and verbatim: "removing a person must no longer delete their shifts and leave requests straight away; they are kept and end with the wage record (same five-year clock, same deletion job)" — item 20 |

Three of the five (1, 3, 4) matched what round 2 had already built and needed
no code change — they close the question the record left open, nothing more.
One (2) removed a length gate already narrow by construction (`art68MinimumBreak`
itself was never gated; only the caller's `span > ASSUME_BREAK_OVER_MIN` check
was). One (5) was the substantial change: two foreign keys dropped, one
trigger function broadened, one new purge function, one existing purge
function's departure cleanup broadened, one service reordered to call both,
in that order, for the reason given in item 20 and the file header of
`wage-record-retention.service.ts`.

## Answered, 2026-09-25 (round 4)

The three questions round 3 returned, put to the founder on 2026-09-25 (the
web-rebuild goal's round 4, item 19), each with a recommended option; he took
all three. Verbatim question, option label and option description:

| # | Question (as put) | Pick |
|---|---|---|
| 1 | "Team pay/hours (#440) returned three questions. First: what does turning a manager 'on/off' mean?" | **"Pay visibility only (Recommended)"** — "The switch decides whether that manager can see and edit pay; their other rights are unchanged." — item 21 |
| 2 | "#440: a removed person's kept rows (shifts, leave, kept five years): how should they appear?" | **"Owner-only history (Recommended)"** — "Hidden from the team views; the owner can open a 'former staff' history for pay and legal records." — item 22 |
| 3 | "#440: should a removed person's availability and credentials (certificates etc.) also be kept like shifts and leave?" | **"Credentials yes, availability no (Recommended)"** — "Certificates can matter for audits; availability has no value once someone leaves." — item 23 |

**How question 1 relates to what round 3 returned.** Round 3 returned the
literal reading of item 16's "Yes, on and off" — may a manager switch labour
TRACKING off? — but the question put asked what turning a MANAGER on/off
means, and the answer is a per-manager pay switch. Both are built consistently
(item 16's bracket): the pay switch is item 21, and "their other rights are
unchanged" keeps the labour-settings rights of items 13 and 16 as they are. If
the founder meant the tracking switch's "and off", that remains his.

**Returned by this round (not decided here):** may a manager whose pay access
is on set their OWN wage? The answer said "see and edit pay"; the 2026-09-21
rule refused a manager's wage write "their own included". Built: refused
(`wageWriteRefusal`), in words, and the web never offers it. **[Answered in
round 5, below.]**

## Answered, 2026-09-25 (round 5)

The one question round 4 returned, put to the founder on 2026-09-25 (the
web-rebuild goal's round 5, item 32). The exact option label was not kept in
the record. His answer is quoted as the session's founder-answers record holds
it: **"#440 own wage: manager with pay access MAY set own wage, with a
notification to the owner (and visible in the report/audit trail)."** Built as
item 21's round-5 bracket. Rejected: keeping the round-4 refusal; allowing it
silently; making the new wage wait for an owner's approval.

## Answered, 2026-09-27 (item 71)

Question 7 (residual (o)), put to the founder on 2026-09-27 (the web-rebuild
goal's round 13, item 71) with the three paths above and (a) recommended. His
answer, verbatim: **"if owner taking money, manager can't see it"**. The founder-answers record
reads it as: an owner's wage is invisible to managers (not shown, not
settable, even with pay access); only owners see and set an owner's wage —
stronger than the offered "Refuse it", which named the write alone. Built as
item 24. Rejected by the answer: (b) allowing it with the owners told; (c)
keeping it as built.

## Answered, 2026-09-28 (item 80)

Question 8 (residual (t)), put to the founder with the four paths above and
(a) recommended. His pick, verbatim: **"Hide owner-period pay (Recommended)"** — path
(a). The founder-answers record reads it as: shifts dated inside the owner
period (from `member_role_changed` audit rows) stay masked from managers;
wage from the demotion onward is treated like any manager's. Built as item
25. Rejected by the pick: (b) once an owner, always the owners'; (c)
refusing one owner's demotion of another; (d) keeping it as built.

## Evidence

- **Item 71 (2026-09-27).** Gateway `team-pay-round4.spec.ts` R6 rewritten
  from "pinned as built" to the answer, 12 cases (the per-row rule and the
  target-reading refusal; a switched-on and a switched-off manager refused
  the owner's wage with nothing written, nobody told, no trail row; an owner
  setting it; a manager editing an owner's other details with no wage in the
  reply; the roster; an inactive owner membership; the week with the owner's
  shift left out of the total and counted in hours; an unpriced owner shift
  not making a manager's total unknown; the four shift writers; owner rows
  unreadable; the former-staff history). `jest src/team` 242 of 242 (10
  files). 8 of 8 gateway mutations killed (owner rows ignored; unknown owner
  rows shown; the write's target check dropped; the total keeping owner
  shifts; unreadable owner rows keeping pay; owner rows limited to active
  memberships; `updateMember` passing no target; the withheld marker
  dropped). Web `TeamPay.test.tsx` +6 cases; `vitest src/pages/team` 136 of
  136 (9 files); 5 of 5 web mutations killed (wage field offered on an
  owner's row; the roster fact, the grid chip and the shift sheet ignoring
  the marker; the left-out line dropped). Not run: a browser pass.

- **Item 71, the owner set end to end (2026-09-27).** **[2026-09-27, ADR 0090
  security review of PR #440 at `42c43d1bf`, which named the gap: the R6 cases
  above build the viewer by hand or replace `ownerMemberIds` with a function
  returning `null`, so the reads that decide whose pay is an owner's were
  tested only incidentally. Founder item 71, verbatim: "if owner taking money,
  manager can't see it".]** New `apps/api-gateway/src/team/team-pay-owner-rows.spec.ts`,
  15 cases, drives `listMembers`, `updateMember`, `getWeek`, `createShift` and
  `listFormerStaff` through the real `assertAccess` and `ownerMemberIds` over
  the stub's filtered tables: a real owner row (an owner membership linked to
  a roster row), a manager whose `team_pay_access` is on, and a person who
  owns another house but is staff here. It pins the two reads' filters (this
  house, `role = owner`, no `is_active`; then this house's rows of those
  owners only), the list, the per-person replies (/team has no GET for one
  person: the member save, a shift written onto the owner and the week), the
  wage history (the owner-only former-staff history, the only reader of
  `team_member_wage_changes`), and each read failing at the database — not
  by replacing the method — withholding all pay from the manager and writing
  no wage. `jest src/team` 260 of 260 (11 files). 8 of 8 mutations killed
  (the `role` filter dropped; the house filter dropped on either read; either
  error branch answering an empty set; active owners only; an unread set
  keeping pay access; the set holding account ids instead of roster ids). A
  control run of the same 8 against the 245 cases that existed before this
  file: 4 survived (both house filters and both error branches). CLAIMS
  `ADR-0215-R6-THE-OWNER-SET-IS-READ-AND-PINNED-END-TO-END`, its verify
  mutated 4 ways and failing each. Not changed: residual (p), an owner's
  roster row with no linked account, is still invisible to both reads.
  **[2026-09-27, ADR 0090 audit of PR #440 at `ea4cc38d0`: these 15 cases
  drove the read surfaces with an INACTIVE owner membership (the row still
  exists), never a REMOVED owner, and none of the by-id shift routes, which
  is where the leak was (item 24's second correction bracket). Closed in the
  same file, `describe("item 71 + item 20 — a removed owner's kept shift is
  not reachable by id")`, 8 cases: the other owner removes the owner through
  the real `deleteMember` (both rows deleted, the shift and a leave request
  kept), then a pay-access manager's note-only `PATCH`, `DELETE`, call-out,
  offer and assign, the remaining owner's `PATCH` and `DELETE`, and a review
  of the kept leave request all answer 404 with no write, no push and no
  notification; a colleague's live shift is still patched (with its cost),
  assigned and deleted; `deleteShift` says a missing shift (404) and a failed
  read or delete (500); an unreadable roster refuses. `jest src/team` 268 of
  268 (11 files). 11 of 11 mutations killed: each of the six call sites
  removed alone, the helper passing every row, ignoring the roster, or
  passing on a failed roster read, the delete's error swallowed, and a
  missing shift deleted as done. With the `updateShift` call removed, the
  first case's reply is the kept row with `labor_cost: 300`. CLAIMS
  `ADR-0215-R6-A-REMOVED-PERSONS-KEPT-ROW-IS-NOT-REACHABLE-BY-ID`, its verify
  mutated 9 ways and failing each. The same audit's minor finding:
  `team_member_wage_recorded()` (migration `20261201110000`) now pins
  `SET search_path = ''` (its body already named every object by schema);
  PGlite full corpus 251 of 251, the pin read back from `pg_proc`, the
  trigger still records an insert and an update run under a foreign
  `search_path`, and the probe fails with the pin removed
  (`p4-scratch/pglite-probe/PR440-r3-wage-trigger-search-path.mjs`). Not
  run: a browser pass; `check_definer_functions_closed.py` (needs a DB URL;
  the function is not SECURITY DEFINER in any case).]**

- **Round 4 (2026-09-25).** Gateway `team-pay-round4.spec.ts` 29 cases (PA
  pay switch 13, FS former-staff history 12, CR credentials 4) and R1 in
  `team-pay.spec.ts` extended to the credential purge (+2 cases); `jest
  src/team` 171 of 171 (8 files). 17 targeted gateway mutations each fail at
  least one case (switch ignored; every manager sees pay; self-wage allowed;
  staff switch honoured; switch read for staff; former staff not owner-only;
  leave `reason` read; leave `reason` returned; credentials not filtered;
  switch on a non-manager; a no-op audited; a switch read failure thrown;
  a failed shifts read swallowed; a manager switching pay; own row not
  checked; the credential purge's error ignored; `getWeek` ignoring the
  switch — one, "leave `reason` read", survived the first pass and was killed
  by asserting the select's columns). Web `TeamPayRound4.test.tsx` 9 cases,
  `vitest src/pages/team` 103 of 103 (8 files); 6 of 6 web mutations killed.
  SQL: a PGlite build of all 223 migrations (superuser, stub vector/postgis,
  no Supabase platform — not a local-stack measurement), 12 checks: a
  removed person's credential kept and availability gone, a departure stamped
  for a credential-only person, nothing purged inside five years, an aged
  departure not deletable and not cleared while a credential remains, the
  credential purged then the departure cleared past five years, a live
  person's credential untouched, the purge service_role only, the pay column
  NOT NULL default false, no client write grant on `user_restaurant_access`.
  Control (build stopped before `20261201110210`): 3 failures, as it must.
  Two SQL mutations (the credential clause removed from `tmd_guard`, and from
  the wage purge's departure cleanup) each fail the probe. Probe:
  `scratchpad/w2ct440/probe.mjs` of session 6c6d8b93 (not committed; the
  p4-scratch harness it imports is not in the repo either).

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

Round 3 (round 6y, the founder's five answers 2026-09-22), measured 2026-09-22
on the index tree (`wt-labor`, lane team3):

- Gateway: `team-pay.spec.ts`, 66 of 66 (re-measured, this file alone); the
  full `apps/api-gateway/src/team` suite, 135 of 135 (7 files). R1's rewrite
  (the two-purge ordering) adds 8 cases in place of the previous 6, covering:
  the call order itself; the short-circuit that skips the wage purge entirely
  when the shifts-and-leave purge fails; each purge's own "answered without
  its counts" guard, separately; a thrown call; null counts from either
  purge; and the scheduled run calling both, in order. **3 of 3 targeted
  mutations of the new service code killed** (the two RPC names swapped
  everywhere, so the order is effectively reversed; the short-circuit
  removed, so a failed shifts-and-leave purge no longer stops the wage purge
  from running; the shifts-and-leave purge's count validation removed) —
  `wage-record-retention.service.ts` mutated in place, snapshotted first
  (memory: unstaged-file-mutation-snapshot-first), restored and diffed
  identical after each run.
- Web: `TeamBreaks.test.tsx`, 15 of 15 (unchanged count; B1's cases were
  already built for this round in an earlier pass of this same session — the
  4h00/4h01/7h30/7h31 boundaries the founder named are in it, keyed on work
  time per item 18). The full `apps/web/src/pages/team` + `.../components/team`
  suites: 105 of 105 (9 files).
- SQL: `p4-scratch/pglite-probe/teamfix-r3-shifts-and-leave-outlive-removal.mjs`,
  the full corpus (195 migrations, then this one) on PGlite, **31 checks
  pass**: the pre-migration cascade defect reproduced first (so the fixture
  proves what the migration fixes, not an assumption); both FKs dropped,
  structurally; a person with a shift only, a leave request only, or all
  three (wage + shift + leave) keeps every one of them on removal; the
  departure is stamped for all three cases, not the wage-bearing case alone;
  `tmd_guard` refuses a DELETE while ANY of the three remain, tested in
  isolation from the purge (a departure past five years with NO wage row at
  all, while a shift is still live, is still refused — this is the case the
  round-2 guard would have wrongly accepted); the shifts-and-leave purge
  deletes exactly the due rows and nothing not due; running the wage purge
  BEFORE the shifts-and-leave purge on a fresh due person still correctly
  leaves the departure (the "wrong order" case is safe on its own; the
  service's order is what makes ONE nightly run finish the job, not a
  correctness requirement of either function alone); a second run of both
  finds nothing; a person still on the roster is never touched, whatever a
  departure row says; only `service_role` may run the new purge, and it is
  `SECURITY INVOKER`; RLS and grants on `shifts`/`time_off_requests` are
  unchanged (no policy on either, and no grant to `anon`/`authenticated`
  since OD-72, `20260825210000`; **[corrected at the last call: this line
  first said neither "ever had" one]**);
  a restaurant deletion's effect on shifts is confirmed unchanged by this
  migration (neither table has ever carried a foreign key to `restaurants`,
  before or after). **8 of 8 targeted mutations of the migration killed**
  (each FK drop reverted separately; the departure trigger's shift-OR-leave
  clause narrowed; the shifts purge's still-on-roster exclusion removed; the
  new purge function explicitly granted to `anon`; the new purge function
  made `SECURITY DEFINER`; the wage purge's departure cleanup reverted to its
  round-2 form dropping the shifts/leave check; `tmd_guard` reverted the same
  way) — migrations mutated in a 2.7 MB scratch copy
  (`TEAMFIX_R3_MIGDIR`, not a repo copy), never the tree itself; restored and
  diffed identical after the run; scratch copy deleted after.
- Register: the `AN-UNRECORDED-BREAK-IS-ASSUMED` row was rewritten (item 10's
  correction) rather than left to read as still gated on 4 hours; its verify
  now asserts `ASSUME_BREAK_OVER_MIN` is ABSENT from both files, not merely
  that a stale threshold constant still equals 240. No new CLAIMS row for
  items 16, 18, 19 (no code changed by them — nothing to check that the
  existing rows don't already); a new row,
  `ADR-0215-TEAM-A-PERSONS-SHIFTS-AND-LEAVE-OUTLIVE-THEIR-REMOVAL`, covers
  item 20 (static, python over source; see CLAIMS.jsonl). **Found and fixed
  this round:** both of those two rows' `verify` fields, as an earlier,
  interrupted pass of this session had written them, embedded REAL newline
  bytes (JSON `\n`) to format the Python source across multiple lines.
  `scripts/check_decision_claims.sh` builds its own claim list as one row per
  physical line; a `verify` string containing a real newline silently split
  into several garbage "rows" downstream — both claims showed as REGRESSED,
  and each fragment of their Python source printed as a separate spurious
  STALE entry (35 of them). Running the checker (not just each claim's
  command standalone) is what caught this — a lesson in `CLAIMS
  conflict resolution`/`static verify` memory terms: **the checker's own
  parser is part of what "static and mutation-tested" has to survive, not
  only the command's own exit code.** Fixed by joining the Python source onto
  one physical line with `;` (the search strings' own `\n` — matching real
  newlines INSIDE the target source files — are untouched: JSON `\\n`, a
  Python-level escape, not a raw byte). Full run after the fix: **415 of 415
  claims hold**, 0 regressed, 0 stale.
- Not run, round 3: `check_migration_ledger.py` and
  `check_definer_functions_closed.py` answer CANNOT CHECK without a database
  URL (this session has none); the gateway was not booted, so the reordered
  nightly job was not seen to fire in production shape — the PGlite probe and
  the mutation-tested service unit tests are what stand in for it. No browser
  pass. **[Corrected at the last call: this line first said the round
  "changed no page a person looks at". It did: the shift sheet's break line
  and the grid's "break assumed" flag now reach shifts of 4 hours or less.
  Both are covered in jsdom by `TeamBreaks.test.tsx`, not seen in a
  browser.]**

Round 3 Opus last call, 2026-09-22, on the index tree (`wt-labor`):

- Gateway: `team-pay.spec.ts` 71 of 71 (66 + K1's 5); the full
  `apps/api-gateway/src/team` suite 140 of 140 (7 files). K1 held by **10 of
  10 targeted mutations killed** (each `onTheRoster` call site removed in
  turn, the replace-week delete put back on a date range, the roster read's
  error swallowed, the helper made to keep everyone and to drop open
  shifts, and the copy's wage-read refusal, which C1 now fails on its own:
  the roster read ahead of it made C1's forced `team_members` error land on
  the wrong read, so C1 fails the wage read alone by its column).
- SQL: the round-3 PGlite probe re-run, 31 of 31; plus a boundary probe
  (scratchpad, `team3-lastcall-boundary.mjs`, full corpus 196 of 196): a
  departure one day short of five years keeps that person's shift and leave,
  one at five years and a minute has both deleted, the wage purge then
  clears only the due departure, and a removal keeps a kept shift's own
  `shift_breaks` rows (they cascade from `shifts`, not from `team_members`).
- The new CLAIMS row fails against each of 7 mutants of its anchors, run in
  a scratch copy of the three files, never the tree.
- **Residual (t), pinned as built (2026-09-27, ADR 0090 audit of
  `78125580a`).** `team-pay-owner-rows.spec.ts` gains 3 cases driving the
  real `MembersService.updateMemberRole` (the other owner demotes the owner
  to manager), then the real `listMembers` and `getWeek`: the former owner's
  wage (40) is shown to a pay-access manager unmarked, their owner-period
  shift carries its cost (300) and the total holds it (637.5, no
  `ownerShiftsLeftOut`), and a manager without pay access still sees no
  wage. 2 of 2 mutations fail it (refusing a demotion of another owner:
  3 cases; the owner set widened to managers: 2 cases). `jest src/team
  src/restaurants` 346 of 346 (14 files); `tsc --noEmit` clean;
  `check_decision_claims.sh` PASS. Not run: a browser pass. **[Superseded 2026-09-28 by
  item 80: the three pinned-as-built cases are replaced by the answer's;
  next bullet.]**
- **Item 80 (2026-09-28).** `team-pay-owner-rows.spec.ts` `describe("item
  80 — an owner demoted to manager in place ...")`, 10 cases through the
  real `MembersService.updateMemberRole` (its own `member_role_changed` row
  is the one read; only that row's time is pinned, 12:00 UTC on 09-08, so
  the week straddles it), then the real `getWeek`, `listMembers`,
  `updateShift` and `listFormerStaff`: with the house on Europe/Istanbul the
  09-07 and 09-08 shifts are withheld and marked the owner's, 09-09 and
  09-10 carry 300; the manager's total is 937.5 with `ownerShiftsLeftOut:
  2`, the owner's 1537.5 with 0; the roster wage (40) is shown unmarked;
  the note-only `PATCH` reply of an owner-period shift has no cost, a later
  one's has; with no zone stated 09-09 stays withheld too (637.5, 3 left
  out); demoted, made an owner again and demoted again gives two periods
  with the manager days between shown; an unreadable audit read shows the
  manager no pay at all; a switched-off manager sees none; the former-staff
  history refuses a switched-on manager. Plus 5 cases on the pure rule
  (`formerOwnerPeriods`, `houseDay`, `seesShiftMoneyOf`). 9 of 9 mutations
  fail them (the total ignoring the date: 3; the row ignoring the period:
  5; the periods dropped from the viewer: 5; the demotion day outside: 5;
  unknown periods failing open: 1; an unreadable audit read failing open:
  1; no zone read as UTC: 2; a re-promotion not opening a period: 2; an
  undated shift shown: 1). `jest src/team src/restaurants` 358 of 358 (14
  files); `tsc --noEmit` clean; `check_decision_claims.sh` PASS, the new
  CLAIMS row's verify failing each of 12 anchor mutants and the re-pointed
  item-71 row's each of 11. Confirmed on the same head: the by-id gate
  (`assertOnTheRoster` on `updateShift`, `deleteShift`, `reportCallout`,
  `offerCover`, `assignCover` and `reviewTimeOff`) and the
  `team_member_wage_recorded()` `search_path` pin. Not run: a browser pass;
  a PGlite pass (no SQL changed).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-21 | — | Created from the founder's four picks and the labour-page judge's §3.0 |
| 2026-09-21 | Opus last call | The settings save still echoed `wage_visible` (fixed, test + mutation); the CLAIMS currency row's prose named every /team file while the per-server sales still print `$` (narrowed; residual (f)); the legacy Tonight pulse's called-out double count named as residual (d) |
| 2026-09-21 | Round 2 build (founder: "Take all five") | Items 10–15 built; four questions returned (switching tracking on, shifts of 4 h or less, span vs work for the minimum, inactive as leaving); the HOURS claim row had gone red on the moved `workedHours` line and was re-pointed; two migration mutants survived the first probe and were killed by two added checks |
| 2026-09-21 | Round 2 Opus last call | The sheet's under-minimum warning said "60 minutes for this shift" on an 8-hour shift whose minimum it also said was 30; it now names the minimum owed for the work the typed break leaves (fixed, test + killed mutation). The ADR's "safer side" sentence read as if the chosen break were the larger one (reworded). `assignCover`'s price read (`recomputeCostForMember`, whose select this round had widened) swallowed its error and wrote the cover as unpriced, which also made residual (g) untrue for that path (fixed: a 500 in words, nothing assigned; test + killed mutation). Found and recorded, not changed: a removal still cascades a person's shifts and leave (residual (j), question 5), and a departure is stamped once (residual (k)). Re-run: `team-pay.spec.ts` 63 of 63, one new mutation (an empty `shift_breaks` embed read as a recorded 0) killed by 4 cases, the PGlite probe ALL PASS |
| 2026-09-22 | Round 3 build (founder round 6y, five answers, verbatim in "Answered, 2026-09-22") | Items 16–20 built or recorded; the "Open, for the founder" section's five questions are all struck, answered. Item 10 corrected in place (the "over 4 hours" gate removed; `ASSUME_BREAK_OVER_MIN` deleted from `pay-rules.ts` and its `tm-format.ts` mirror; boundary tests at 4h00/4h01/7h30/7h31 the founder named). Item 20 is the substantial change: `shifts.member_id` and `time_off_requests.member_id` drop their foreign key to `team_members` (migration `20260929030200`); `team_member_departure_recorded()` broadened to shifts and leave, not wage records alone; a new `purge_expired_shift_and_leave_records()` (service_role only, SECURITY INVOKER); `purge_expired_wage_records()`'s departure cleanup broadened the same way; `tmd_guard()` broadened identically; `WageRecordRetentionService` reordered to call the new purge first, then the wage purge, with a short-circuit on the first's failure (this was the one piece left unfinished from an earlier, interrupted pass of this session — found via `grep purge_expired_shift_and_leave_records apps/**/*.ts` turning up only the migration and comments, never a call site). Residual (j) struck (resolved), not deleted. New PGlite probe `teamfix-r3-shifts-and-leave-outlive-removal.mjs`, 31 checks, reproduces the pre-migration cascade defect first, then proves the fix and isolates the broadened `tmd_guard` from the purge functions (a departure with no wage row at all, past five years, with a live shift, refused). 8 of 8 migration mutations and 3 of 3 service mutations killed. Full `/team` suites re-measured: gateway 135 of 135 (7 files), web 105 of 105 (9 files). |
| 2026-09-22 | Round 3 Opus last call | Item 20 dropped the foreign keys but nothing read the week any differently, so a removed person's kept rows entered it: their next week counted as covered and costed, "Copy last week" wrote them into new weeks, replacing a week deleted their kept shifts, and a pending leave request waited in the manager's list. Fixed as "kept, not shown" (`onTheRoster`; K1, 10 of 10 mutations killed; new CLAIMS row), the week reading as it did before the change; how kept rows should appear is returned to the founder. Records corrected in place: "never had a grant" (OD-72 revoked them), the retention job's header said the other order could clear a departure on live rows (it cannot; the order finishes the job in one night) and that "the tables refuse" an early delete of shifts and leave (no guard on them; the purge's clause is the rule), the Answered table's question 1 carried an "(and off)" the question never had, and "changed no page a person looks at". Returned: the literal reading of "on and off". Residuals (l) and (m) added. |
| 2026-09-25 | W2-fix-cellar-team lane (founder round 4 item 19, three answers, verbatim in "Answered, 2026-09-25 (round 4)") | Items 21–23 built: the per-manager pay switch (`team_pay_access`, migration `20260929030220`; `seesMoney`/`wageWriteRefusal` take a viewer; owner-only `setPayAccess`, audited and notified; read apart from the membership read for the deploy window), the owner-only former-staff history (`listFormerStaff`, names from the removal's audit row, no name column added), and credentials kept / availability not (migration `20260929030210`; credential purge first in the nightly job; `listCertifications` filtered). Brackets added to Status, the Decision lead, item 16, item 20, residual (j) and "Open, for the founder". Two CLAIMS rows re-pointed with dated brackets (MONEY-IS-THE-OWNERS, A-WAGE-IS-WRITTEN-BY-AN-OWNER-AND-KEPT: their `role === "owner"` / `assertMayWriteWage(role)` literals are gone by design) and three added (R4-*), each mutation-tested. Returned: a switched-on manager's own wage; the literal "and off" of item 16 if meant. Not run: a browser pass; `check_migration_ledger` / definer end-state checks (need a DB URL). |
| 2026-09-25 | W3-credits-team lane (founder round 5 item 32) | The own-wage refusal is replaced: a switched-on manager may set their own wage, every active owner gets an in-app notice with the figures, and the house-wide trail gets a figure-free `team_member_own_wage_set` row (item 21's round-5 bracket; "Answered, 2026-09-25 (round 5)"). CLAIMS `ADR-0215-TEAM-A-WAGE-IS-WRITTEN-BY-AN-OWNER-AND-KEPT` is re-pointed with a dated bracket, and `ADR-0215-R5-A-MANAGERS-OWN-WAGE-TELLS-THE-OWNER` is added. Both fail against the pre-change files. |
| 2026-09-26 | Fix round 2 of 2, ADR 0090 audit of `a4efc8b7`, BLOCKed (`80c08050` touched the gate-owned `.github/workflows/ci.yml`, no recorded founder word for that specific edit) | **Fixed by repointing OD-165's row instead of asking for sign-off.** `80c08050`'s citation `--fix` (repointing 181 citations across 94 files, including `ci.yml:687`'s hard-coded `OD-88 (OPEN-DECISIONS.md:58)` example) was needed only because `450459c8b` had inserted OD-165's row *above* OD-88, shifting OD-88 and everything after it down one line. Reverted `80c08050` in full, then re-inserted OD-165's row immediately *after* OD-88's own row instead of before it — same content, same section, nothing renumbered as "resolved." That keeps OD-88 at its original `OPEN-DECISIONS.md:58`, so `ci.yml`'s citation needs no edit at all (`git diff origin/main -- .github/workflows/ci.yml` is now empty) and the gate-owned-path question is moot rather than answered either way. Re-ran `check_citation_pairing.py --fix` for the (smaller, only-non-gate-owned) set of files whose citations land after OD-88 and do still shift: 63 files repointed, all under `.planning/`, none gate-owned. Verified clean: `check_citation_pairing.py` PASS (181/181, 2 skipped); `check_decision_claims.sh` PASS (558/558); `check_od_ids_exist.py` PASS; `check_migration_order.py` / `check_migration_versions_unique.py` OK; `grep 20260925180 -- supabase/migrations` still empty; gateway `jest src/team src/settings-audit` 194/194. OD-165 itself (content, severity, "founder call" framing) is unchanged — only its row's position in the register moved. |
| 2026-09-27 | Merge `origin/main` (29ba4e820, three PRs: #470/#485/#394) into the fix | `origin/main` had gained a migration (`20260928000000`, #394's alert-column PR) newer than this branch's six, which `check_migration_order.py` correctly refuses (production would apply them out of the order a fresh `db reset` runs them in). Renumbered all six by `git mv`, same relative spacing, same content: `20260927150000/…150100/…150110/…150200/…150210/…150220` → `20260929030000/…120100/…120110/…120200/…120210/…120220`, past the new ceiling. Every citation (this ADR, `OPEN-DECISIONS.md`, `CLAIMS.jsonl`, and the six `apps/api-gateway/src/team/*.ts`/`*.spec.ts` files that name a migration in a comment) rewritten with the old→new pairs, verified with `git grep` (zero old-number hits left). `CLAIMS.jsonl`'s merge conflict (this branch's ADR-0215-* rows vs `main`'s ADR-0083-*/ADR-0160-* and one open TD row) resolved as a union, both sides kept, no id collision. `README.md`'s only conflict was this ADR's own index row versus unrelated rows added by `main` — both kept, no gate-owned-path concern (the founder's standing rule already excuses an index-row-only README change). Re-verified after the merge: `check_migration_order.py` / `check_migration_versions_unique.py` OK; `check_citation_pairing.py` PASS (183/183); `check_decision_claims.sh` PASS (567/567); `check_od_ids_exist.py` PASS; `git diff origin/main -- .github/workflows/ci.yml` (and every other `_GATE_OWNED_PATHS` entry) still empty; gateway `jest src/team src/settings-audit` 194/194. |
| 2026-09-27 | ADR 0090 audit of #440 at c093e731 (BLOCK, fix round 1 of 2) | Three records lagged the code. `README.md`'s index row for this ADR still said wages were owner-only and "Only an owner writes a wage": a dated `[Amended]` bracket now states the round-4 switch (`team_pay_access`, `20260929030220`, owner-set; `seesMoney`/`wageWriteRefusal`) and round 5's own-wage write with the owner told (`ownWageTellsTheOwner`) — an index-row-only README change, founder item 59. `CLAIMS.jsonl` `ADR-0215-NO-STALE-180XXX-MIGRATION-CITATIONS` bracketed for the third renumber, and its verify now greps both retired prefixes (`20260925180`, `20260927150`) — mutation-tested: a planted `20260927150110` and a planted `20260925180110` comment in `20260929030110` each fail it, the clean tree passes. This file's second renumber bracket had its first number rewritten by the third renumber's sweep (read `20260929030000`/`…150100`); restored to `20260927150000`, with a dated bracket after the correction bracket. PR body's five "ship as `150xxx`" lines rewritten to `120xxx`. No code changed. Re-verified: `check_decision_claims.sh` 567/567, `check_citation_pairing.py`, `check_od_ids_exist.py`, `check_migration_order.py`, `check_migration_versions_unique.py` all pass; `git grep -e 20260925180 -e 20260927150 -- supabase/migrations` empty. |
| 2026-09-27 | Merge-train update of PR #440 (round 2), CLAUDE.md-directed sync to `origin/main` | Branch was 8 commits behind `origin/main` and DIRTY. Merged `origin/main`; conflicts in `CLAIMS.jsonl` (disjoint ids, union, both sides kept — no `(id, verify)` duplicates), `apps/api-gateway/src/team/access-audit.ts` and `team.module.ts` (both additive: ADR 0215's pay-access action/service beside ADR 0218's area/away actions/services — unioned), and four `apps/web/src/pages/team/next/*.tsx` files (ADR 0215's owner-only wage column beside ADR 0218's Areas card and Away marker on the same rows — unioned; `RosterSheet.tsx`'s `MemberDetail`/`RosterSheet` now take `moneyVisible`, `money` AND `house`, replacing `origin/main`'s superseded local `money()` formatter with this branch's house-currency-aware `fmtMoneyExact`, since fixing that formatter is this PR's own point). `check_migration_versions_unique.py` then failed twice: `origin/main` had moved past this branch's six migrations (new ceiling `20260930100100`, #441's Away migration) AND collided directly with open PR #479's `20260929030000_user_passkeys.sql`. Renumbered a fourth time (bracket above, Links section) to `20260930110xxx`; every live citation swept, the historical rename brackets and changelog rows above left citing the numbers true when they were written — sweeping those forward was exactly the round-1 bracket's corrected mistake, not repeated here. `CLAIMS.jsonl`'s `ADR-0215-NO-STALE-180XXX-MIGRATION-CITATIONS` amended to grep a third retired prefix (`20260929030`). |
| 2026-09-27 | ADR 0090 audit of #440 at 25e55b2c (BLOCK, fix round 1 of 2) | Two of the three blocking findings fixed, one returned. (1) A switched-on manager may set an OWNER's wage and nobody is told (`wageWriteRefusal` never reads the target; `ownWageTellsTheOwner` is false off the writer's own row): not decided by round 4 item 19 or round 5 item 32, so recorded as residual (o) and "Open, for the founder" question 7 with three paths, and NOT changed in code. (2) The path had no test: `team-pay-round4.spec.ts` R6 pins it as built in both directions — widening `ownWageTellsTheOwner` past the writer's own row fails the first case, dropping `wageWriteRefusal`'s `seesMoney` check fails the second. (3) The PR body still named `20260928120xxx` as the shipped files: rewritten to the shipped names with a dated bracket; the unbracketed `84debc021` renumber (`20260928120xxx` → `20260929030xxx`) is now named in a correction bracket under Links, and `ADR-0215-NO-STALE-180XXX-MIGRATION-CITATIONS` greps `20260928120` too (mutation: a planted `-- 20260928120110` line fails it). (4) `origin/main` had moved again (#483, `20261001000000`): merged (CLAIMS conflict unioned, disjoint ids) and the six files renumbered a sixth time to `20261021110xxx` (bracket under Links). |
| 2026-09-27 | Founder item 71 (round 13) build | Question 7 answered, verbatim: "if owner taking money, manager can't see it". Built as item 24: `seesMoneyOf` per row, `ownerMembers` on a switched-on manager's viewer (unreadable = pay off), `wageWriteRefusal(viewer, targetMemberId)` reads the target, an owner's shift left out of a manager's total with `ownerShiftsLeftOut`, `pay_withheld: "owner"` on withheld rows, and the web's roster, member sheet, grid, shift sheet, labour block and legacy editor. Residual (o) struck, resolved; (p)–(r) added. R6 flipped. `origin/main` (#435, `20261021150000`) merged; the six migrations renumbered a seventh time to `20261101100xxx` (bracket under Links). |
| 2026-09-27 | Merge-train update of PR #440 (round 3), CLAUDE.md-directed sync to `origin/main` | Branch was one commit behind `origin/main` (#473, `20261022000000_mudavym_design_vendor_prices.sql`), which is why CI's "Fresh database equals remote" showed `mudavym_design_vendor_prices` as apparently hand-applied DDL — production had it from #473, this branch's build did not. Merged `origin/main`; the only conflict was `CLAIMS.jsonl` (two disjoint-id blocks from this branch's ADR-0215 renumber row and `main`'s PR-473-OWN-PAPER-* rows, adjacent lines only — union, both kept, no `(id, verify)` collision). `check_migration_versions_unique.py` then failed: `origin/main` no longer held a newer migration than this branch's six, but open PR #436 (`feat/finish-action-integrity`) had independently claimed `20261101100000`/`…100100`/`…100200` for its own migrations. Renumbered an eighth time (bracket above, Links section) to `20261101110xxx`, past PR #436's newest (`20261101101700`); every live citation swept (this ADR's Links list and body prose, `CLAIMS.jsonl`, `OPEN-DECISIONS.md`, `README.md`'s index row, the seven `apps/api-gateway/src/team/*.ts`/`*.spec.ts` files, and the three migrations' own cross-referencing comments), the eight historical rename brackets and changelog rows above left citing the numbers true when they were written. `CLAIMS.jsonl`'s `ADR-0215-NO-STALE-180XXX-MIGRATION-CITATIONS` amended to grep a seventh retired prefix (`20261101100`). |
| 2026-09-27 | ADR 0090 audit of #440 at ccd69c4e (BLOCK, fix round 1 of 2) | (1) A switched-on manager could read an owner's wage by unassigning the owner's shift: `updateShift`'s `dto.memberId ?? cur.member_id` priced the now-open shift at the owner's wage and `seesMoneyOf(viewer, null)` passed it on. Fixed in `updateShift` (prices the person the shift will have) and in `shiftForViewer` (a stored cost on an open shift is said as `null`), correction bracket under item 24. (2) No test covered it: `team-pay-round4.spec.ts` R6 +3 cases (the unassign, with and without a time change, and the week after it; a stale open-shift cost; the global `ValidationPipe` letting the `null` through, which closes the reviewer's open question). Each code half mutated back alone and killed by its own case; new CLAIMS row mutated both ways. (3) The PR body still listed `20261101100xxx` as the shipped files after the eighth renumber: rewritten to `20261101110xxx` with a dated bracket. |
| 2026-09-27 | Merge-train update of PR #440 (round 4), CLAUDE.md-directed sync to `origin/main` | Branch fell one commit behind `origin/main` again (#488, `20261102110000_a_low_stock_digest_is_fenced_once_a_house_day.sql`) while CI ran on the item-71 unassign fix; `check_migration_order.py` refused the six migrations again. Merged `origin/main` in a worktree (no conflicts outside `CLAIMS.jsonl`, which took the disjoint #488 rows cleanly — no `(id, verify)` duplicates, verified by set-compare). Renumbered a ninth time (bracket above, Links section) to `20261103110xxx`, past main's new ceiling; every live citation swept (this ADR's Links list and body prose, `CLAIMS.jsonl`, `OPEN-DECISIONS.md`, `README.md`'s index row, the eleven `apps/api-gateway/src/team/*.ts`/`*.spec.ts` files, and the three migrations' own cross-referencing comments), the nine historical rename brackets and changelog rows above left citing the numbers true when they were written. `CLAIMS.jsonl`'s `ADR-0215-NO-STALE-180XXX-MIGRATION-CITATIONS` amended to grep an eighth retired prefix (`20261101110`). `check_migration_order.py`, `check_migration_versions_unique.py` and `check_decision_claims.sh` (645/645) re-run clean on the merged tree; `jest src/team` 245/245 unaffected (renumber touches only version strings). |
| 2026-09-27 | Merge-train update of PR #440 (round 5), CLAUDE.md-directed sync to `origin/main` | Branch fell one commit behind `origin/main` again (#482, `bc7121ccf`, `20261115000000_a_price_names_its_paper_and_its_messenger.sql`) while the required checks settled on the round-4 head; `check_migration_order.py` refused the six migrations again. Merged `origin/main` in the same worktree (one conflict, `CLAIMS.jsonl`: this branch's `ADR-0215-NO-STALE-180XXX-MIGRATION-CITATIONS` row versus `main`'s disjoint `ADR-0160-112-FORK-6A-*`/`PR-482-*` rows — union, both kept, no `(id, verify)` duplicate; verified by set-compare and a full-file `(id, verify)` Counter). Renumbered a tenth time (bracket above, Links section) to `20261116000xxx`, past main's new ceiling; every live citation swept (this ADR's Links list and body prose, `CLAIMS.jsonl`, `OPEN-DECISIONS.md`, `README.md`'s index row, the seven `apps/api-gateway/src/team/*.ts`/`*.spec.ts` files, and the three migrations' own cross-referencing comments), the nine historical rename brackets and changelog rows above left citing the numbers true when they were written. `CLAIMS.jsonl`'s `ADR-0215-NO-STALE-180XXX-MIGRATION-CITATIONS` amended to grep a ninth retired prefix (`20261103110`). `check_migration_order.py`, `check_migration_versions_unique.py`, `check_citation_pairing.py` and `check_decision_claims.sh` re-run clean on the merged tree; `apps/web` vitest team suites + `mudavym-ground.test.ts` 206/206, gateway `jest src/team` 245/245, unaffected (renumber touches only version strings). |
| 2026-09-27 | ADR 0090 audit of #440 at 42c43d1bf (BLOCK; train 7) | Both reviewers confirmed the item-71 wage masking correct and fail-closed; the BLOCK was the PR body alone (it still named the ninth renumber's `20261103110xxx` files as shipped, and carried branch-sync sentences that went stale on the next merge). The body was rewritten to the current state with the six `20261116000xxx` files named once and no branch-sync statement. The security reviewer's gap (no end-to-end test of `ownerMemberIds`) closed with `team-pay-owner-rows.spec.ts` (Evidence, "the owner set end to end"): 15 cases, 8 of 8 mutations killed, 4 of which the earlier 245 cases let through. Nothing was merged or renumbered in this round: `main`'s newest migration, `20261115000000`, sorts before all six. |
| 2026-09-27 | ADR 0090 audit of #440 at ea4cc38d0 (BLOCK, fix round 1 of 2) | Both reviewers found the same leak: a co-owner REMOVED by `deleteMember` keeps their shifts (item 20), `ownerMemberIds` (a live read) no longer names their gone roster row, and the by-id shift routes checked no roster, so a pay-access manager's note-only `PATCH` answered with the owner's stored cost beside the hours (the wage), and any manager could `DELETE` a record kept five years. Fixed by round 4 item 19's own answer (a removed person's kept rows are owner-only history, hidden from the team views): `TeamService.assertOnTheRoster`, 404 for a kept row on `updateShift`, `deleteShift`, `reportCallout`, `offerCover`, `assignCover` and `reviewTimeOff`, for managers and owners alike; `deleteShift` reads first and says a missing shift or a failed read/delete. Correction brackets on item 24, item 20 and the item-71 evidence (whose "end to end" covered an inactive owner, never a removed one); residual (s) added. 8 new cases through the real `deleteMember`, 11 of 11 mutations killed, `jest src/team` 268/268; new CLAIMS row mutated 9 ways; the owner-set CLAIMS row bracketed. Minor finding fixed too: the wage trigger pins `search_path` (PGlite probe, mutation-checked). |
| 2026-09-27 | ADR 0090 audit of #440 at 78125580a (BLOCK, fix round 2 of 2) | Both reviewers found an undisclosed path around item 24: one owner changes another owner's role to manager in place (`updateMemberRole`), `ownerMemberIds` reads the current role, and a pay-access manager is shown the former owner's wage and owner-period shift costs, per row and in the week total. Not fixed in code: which part of a former owner's pay stays the owners' is the founder's call (question 8, four paths, (a) recommended). Recorded: residual (t), item 24 correction bracket, Status bracket, CLAIMS `ADR-0215-R6-AN-OWNERS-PAY-IS-THE-OWNERS` narrowed; 3 cases pin it as built through the real `updateMemberRole`, 2 of 2 mutations fail them; `jest src/team src/restaurants` 346/346. |
| 2026-09-28 | Founder item 80; built on #440 (Opus builder) | Question 8 answered, verbatim: "Hide owner-period pay (Recommended)". Built as item 25: `formerOwnerPeriods` from the house's `member_role_changed` rows, `seesShiftMoneyOf` on every shift reply and the manager total, fail-closed on an unreadable read, the wage a manager's from the demotion on. 15 cases, 9 of 9 mutations killed; `jest src/team src/restaurants` 358/358; new CLAIMS row `ADR-0215-R7-A-FORMER-OWNERS-OWNER-PERIOD-PAY-IS-THE-OWNERS` (12 of 12 anchor mutants fail it); the item-71 row re-pointed. |
| 2026-09-27 | ADR 0090 audit of #440 at 56940e7d5 (BLOCK, fix round 1 of 2) | Security review BLOCKed on a cross-surface effect of item 20 that this ADR never named: the personal calendar feed's "all" scope served a removed person's kept shift, past or future, as "Someone — shift". Fixed in `readShifts` (`onTheRoster` against the live roster; residual (u); two cases, both killed by the mutation; CLAIMS row). The unbounded `member_role_changed` read of residual (t) now counts exactly and withholds on a short read (one case over a new stub `rowCap`; both mutations killed; CLAIMS row). The migration that drops the foreign keys said the kept rows were a record "which no page reads"; a dated bracket there now names the calendar feed (fixed) and `rosterAt` (residual (m)). `jest src/team src/restaurants src/calendar`: 27 of 27 suites, 638 of 638 tests; `check_decision_claims.sh` PASS. |
| 2026-09-28 | Merge-train update of PR #440, CLAUDE.md-directed sync to `origin/main` | PR #436 (`feat/finish-action-integrity`) landed on `origin/main` at `fd73d0920` while this PR's required checks were settling, gaining `20261116101700_a_stale_name_ask_closes_by_itself.sql` and putting the branch's six migrations behind main's newest again; `mergeStateStatus` went DIRTY/CONFLICTING. Merged `origin/main` in worktree `wt-train-440` (branch `train/pr-440`): four conflicts, all disjoint appends kept both sides (`DELIVERY-AUDIT.md` two blocks of unrelated dated measurement bullets, `.planning/06-pages/team.md` this PR's numbered §14 beside an unrelated unnumbered Codex-execution note, `.planning/decisions/README.md` this ADR's index row beside ADR 0192's amendment row — the founder's standing rule already excuses an index-row-only README change), and one substantive conflict in `apps/web/src/pages/team/next/TeamNext.tsx` (both branches added `Overlay` union members and imports; unioned — `former`/`areas`/`export`/`rules`/`sales`, `areas` deduped, both `FormerStaffSheet` and `SendGrantsSection` imports kept). `CLAIMS.jsonl` merged clean with no `(id, verify)` duplicates (710 checked, 710 holding). Renumbered an eleventh time (bracket above, Links section) to `20261116110xxx`, past main's new ceiling; every live citation swept (this ADR's Links list and body prose, `CLAIMS.jsonl`, `OPEN-DECISIONS.md`, `README.md`'s index row, the nine `apps/api-gateway/src/team/*.ts`/`*.spec.ts` files, and the three migrations' own cross-referencing comments), the ten historical rename brackets and changelog rows above left citing the numbers true when they were written. `check_migration_order.py` and `check_migration_versions_unique.py` re-run clean on the merged tree; `check_decision_claims.sh` PASS (710/710). |
| 2026-09-28 | Merge-train update of PR #440, CLAUDE.md-directed sync to `origin/main` | `origin/main` gained PR #479 (passkeys/sign-in) past the branch's six migrations, and the widest open-PR ceiling moved further still to PR #480's door-record migration; `check_migration_order.py` refused all six again. Merged `origin/main` in worktree `wt-train-440` (branch `train/pr-440`): two conflicts, both disjoint-id appends kept both sides (`CLAIMS.jsonl` — this branch's five `ADR-0215-R6`/`ADR-0215-R7` rows beside `main`'s seven `ADR-0229-FORK-*` rows; `.planning/v3.0-TECH-DEBT.md` — this PR's new "owner-period pay" section beside `main`'s update closing the unrelated verification-link/invite-membership section, adjacent `##` headers only). Renumbered a twelfth time (bracket above, Links section), past both ceilings; every live citation swept (this ADR's Links list and body prose, `CLAIMS.jsonl`, `OPEN-DECISIONS.md`, `README.md`'s index row, the team files, and the three migrations' own cross-referencing comments), the eleven historical rename brackets and changelog rows above left citing the numbers true when they were written. Per the founder's 2026-09-27 migrations-numbered-at-merge rule, this row and the new bracket cite the six migrations by slug, not by version. `check_migration_order.py` and `check_migration_versions_unique.py` re-run clean on the merged tree; `check_decision_claims.sh` re-run on the merged tree. |
| 2026-09-28 | Founder item 93 (lane fix/team-removed-shifts-open-pool) | Item 26 built from the preserved wt-labor snapshot `4d299b231`'s `shiftsOpened` logic and K2 tests, re-cut to main's `deleteMember`: the house's clock (not the UTC day), a call-out kept, the open before the first membership write. Status and item-20 brackets; OD-181 filed resolved; the replacement step brainstormed in `06-pages/team.md` §15 (a fork, not built); FAQ entry and remove-dialog copy. Gateway `jest src/team src/restaurants src/calendar src/auth` 1091/1091; web `vitest src/pages/help src/pages/team` 266/266. |
