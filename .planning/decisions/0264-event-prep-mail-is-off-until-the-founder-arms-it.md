# 0264 — Event-prep mail is off until the founder arms it

- **Status:** Proposed 2026-10-02 — built, OFF by default. Not locked. The authority is the founder's 2026-10-02 staffing answer, relayed by the lane coordinator: of the "3 urgent now" lanes he opened, the account and operational mail lane's first job is the "F-154 flag before Oct 7 08:00 ET". That answer staffs the flag and sets its deadline. His 2026-10-02 answer on the job's future, "Guest events only (Recommended)", also set this PR's scope: the deadline PR is flag-only and OFF by default (see "Answered" below). The parse, the guard's placement and the wording below are this lane's build, awaiting his lock.
- **Date:** 2026-10-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent. Written by the mail lane, a session; the founder has not yet reviewed this record.
- **Keywords:** event-prep-check, EVENT_PREP_REMINDERS_ENABLED, arming flag, off by default, shared Gmail sender, calendar_events, deliveries, per-run cap, sendEventPrepReminders, eventPrepArmed, F-154, F-152, F-136
- **Links:** [[0131-the-new-house-goes-live-dark-then-one-house-at-a-time]] (Stream C lists the gateway switches the founder sets himself; this record adds one beside them and leaves 0131's text as it is) · [[0022-scheduled-jobs-serve-opted-in-tenants]] (which houses a scheduled job serves) · [[0174-email-is-a-paper-sheet-and-the-house-signs-it]] (D4, the sender) · [[0109-a-reminder-is-the-houses-job-not-the-browsers]] (`CALENDAR_REMINDERS_ENABLED`) · code `apps/api-gateway/src/communications/event-prep-reminder.ts`, `ScheduledTasksService.sendEventPrepReminders` and `eventPrepArmed` · spec `apps/api-gateway/src/communications/event-prep-reminder.spec.ts` · claim `claims.d/fix-event-prep-mail-arming-f154.jsonl:1` · branch `fix/event-prep-mail-arming-f154`

## Context

The F-numbers are findings of the owner-quarter simulation. They are kept in its
ledger outside the repo (`p4-scratch/sim-ledger.md`), so each is restated here in
one line and this record does not depend on that file:

- **F-154.** `event-prep-check` (`@Cron("0 8 * * *")`, America/New_York, every day)
  had no arming flag. For each house it serves it read every `calendar_events` row
  dated two days out, with no `event_type` filter and no per-run cap, and sent one
  event-prep email per row to the managers and staff who take calendar reminders.
- **F-152.** A delivery is a `calendar_events` row. Procurement's
  `createCalendarEventForOrder` writes one per order, titled `Delivery: <order number>`.
  So a house with N deliveries due in two days got N "Event Prep - Delivery: …" mails
  (the subject is built in `GmailService.sendEventPrepReminder`).
- **F-136.** The gateway's outbound mail goes out through one shared Gmail account.
  On 2026-10-02 about 500 purchase-order letters in one day hit its user-rate limit,
  and every house's verification, invite and reset mail stopped with them.

Which houses the job serves: `ScheduledTenantsService.list()` returns
`DEFAULT_RESTAURANT_ID` plus every house with an enabled `scheduled_communications`
row in `restaurant_feature_flags` (ADR 0022). The owner-quarter sim house holds about
500 delivery rows dated 2026-10-09. The sim ledger's correction at about 00:05Z on
2026-10-03 read its reminder status as `served:false`, so the 2026-10-07 run would not
reach it. That reading was not re-measured for this record. Adding one opt-in row
would change it.

## Options considered

1. **Ship only the arming flag, OFF by default.** The job returns before it reads or
   sends unless the founder arms it. It records no answer to any open question, and
   one variable undoes it.
2. **Ship an entry-type filter and a per-run cap now, with interim values.** The
   entry types were answered on 2026-10-02 (guest events only), but the cap size was
   not, and an interim size would record a founder call before he has made it
   (CLAUDE.md §0.1). His answer also made the deadline PR flag-only. With the flag off
   the filter would change nothing anyway; it lands in the next PR.
3. **Retire the job.** The founder's 2026-10-02 answer keeps it for guest events, so
   this is rejected by that answer. A flag is also undone by one variable; a deletion
   needs a code change and a deploy.
4. **A per-house flag row instead of an environment variable.** Every job-arming
   switch beside it is one global environment allow-list:
   `RECURRING_ORDER_REMINDERS_ENABLED`, `CALENDAR_REMINDERS_ENABLED`,
   `DIGEST_SEND_ENABLED`. Per-house opt-in already exists as the
   `scheduled_communications` row; a second per-house row would be a second opt-in
   for the same thing.
5. **Do nothing.** The 2026-10-07 08:00 ET run mails every calendar row two days out,
   deliveries included, for every house the job serves, through the shared sender.
   One opt-in row stands between that and about 500 sends in one run.

## Decision

Option 1. `ScheduledTasksService.sendEventPrepReminders` returns before
`runPerTenant` and before any read unless `EVENT_PREP_REMINDERS_ENABLED` arms it. When
it is unarmed it logs one line and sends nothing. The flag and its parse live in
`communications/event-prep-reminder.ts`. The parse is the same allow-list as
`RECURRING_ORDER_REMINDERS_ENABLED`: only `true` or `1`, trimmed and lower-cased, arm
it. Any other value, a typo included, reads as off, so a typo means silence, not a
live mailer. `eventPrepArmed` reads `ConfigService` first and `process.env` second,
like `recurringRemindersArmed`. The method `triggerEventPrepReminders` calls
`sendEventPrepReminders`, so it hits the same guard; nothing outside the spec calls it
today.

**What deploying this stops.** This removes a behaviour as well as closing a risk.
`DEFAULT_RESTAURANT_ID` is always served, so before this change the job ran for that
house every morning, mailing its managers and staff. For the legacy house, recipients
resolve with `allowDefaultFallback`, so `MANAGER_EMAIL` stands in. From the first
deploy the job stops for that house too, until the variable is set. The same variable
restores it. **Not measured:** how many calendar rows that house has two days out on
a given day, and whether the variable is already set on Railway. No session holds
Railway credentials.

**To arm it, the founder sets on Railway (gateway service):**
`EVENT_PREP_REMINDERS_ENABLED=true`. `1` also arms it.

## Answered — 2026-10-02, the founder via AskUserQuestion

"Guest events only (Recommended)". Recorded by the lane coordinator the same day:

- An event is a guest event: `tasting`, `private_event`, `wine_dinner`, `corporate`
  and `custom`. Never deliveries or orders.
- The job is capped per house, and it honours each entry's `reminder_enabled`.
- The cap size and the recipients get asked when the job is armed.
- The deadline PR (this one) is flag-only, OFF by default.

The filter, the `reminder_enabled` check and the cap are built in the next PR. This
PR implements none of them and contradicts none of them.

## Open — what arming still needs

These are the founder's questions that remain open. None of them is defaulted here.

1. The cap's size, per house.
2. Who receives the mail. Today it goes to managers and staff under the
   `calendar_reminders` preference.
3. When this job moves to the sender ADR 0174 D4 already locked
   (`notifications@mudavym.com`), off the shared Gmail account, so one house's volume
   cannot silence another's account mail. D4 is not reopened here. What is open is
   the build: when event-prep mail is sent from it.

**No OPEN-DECISIONS row is filed for these in this PR.** A new fork goes at the top of
Open, and ADR 0025's pairing guard (`scripts/check_citation_pairing.py`) then needs
every register citation below it repointed. Measured at this branch on 2026-10-02 by
inserting one probe row at the top of Open and running that guard (then restoring the
file): 220 citations across 110 files disagree. That cost is not put on a deadline PR
whose behaviour these questions do not change while the flag is off. The lane coordinator or the founder
decides whether to file them. Until then this section is their record.

## Consequences

- The job cannot send by accident. Arming is one variable, and so is disarming.
- Arming before the next PR lands brings F-154 back unchanged. The guest-events
  filter, `reminder_enabled` and the cap land in that PR; the cap size and the
  recipients are asked when he arms it; the sender move follows its own answer.
- Revisit when the founder answers any of the three open questions, or when a
  house's event-prep mail is missed and someone asks why.

**Exposure: the other outbound jobs in `scheduled-tasks.service.ts`, read at this
branch and not changed here.** Each row is found with `grep -n 'name: "<job>"'`. Every
job runs through `runPerTenant`, so it serves only `DEFAULT_RESTAURANT_ID` plus
opted-in houses.

| Job (cron) | Arming flag | Other gate | Per-run bound, per house |
|---|---|---|---|
| `daily-sms-summary` (09:00) | none | manager phones (legacy house: `MANAGER_PHONE`) | one SMS per manager phone, not per row |
| `weekly-email-report` (Mon 08:00) | none | `reports` category mode | one report email to the manager list |
| `recurring-order-reminder` (08:00) | `RECURRING_ORDER_REMINDERS_ENABLED` | `orders` category mode; refuses undescribable rows | one email per schedule due, unbounded |
| `delivery-eta-notification` (17:00) | **none** | `orders` category mode | **one email per in-flight order due tomorrow, no `.limit`**, the same per-row shape as F-154 |
| `inventory-audit-reminder` (Mon 07:00) | none | recipients under `calendar_reminders` | one reminder email to the recipient list |
| `event-prep-check` (08:00) | `EVENT_PREP_REMINDERS_ENABLED` (this record) | recipients under `calendar_reminders` | one email per calendar row, unbounded |
| `custom-reminders-check` (every 15 min) | none | active rows due now; recipients from the row or its roles | `.limit(20)` rows, at most one email each |

Outside that file, the `CALENDAR_REMINDERS_ENABLED` sweep
(`CalendarRemindersService`, the `calendar_events` read under `CANDIDATE_CAP`) also has
**no `event_type` filter**. It filters on `reminder_enabled = true` and
`reminder_sent = false`. `reminder_enabled` defaults to true in the baseline schema,
and procurement writes it true, so delivery rows qualify. That sweep sends no mail
(inbox and push only). It is capped at `CANDIDATE_CAP = 500` rows per house per run,
every 15 minutes. That matters before Stream C's `CALENDAR_REMINDERS_ENABLED=true` is
ever set on a house with hundreds of delivery rows.

**Retire-to-write (CLAUDE.md §4).** This branch first wrote this record as an
amendment inside ADR 0131. It moved here because 0131 is Locked by the founder, and a
session does not amend a Locked record. 0131 is unchanged on `main`. This file is the
one record §5 requires, and it retires no document.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-02 | mail lane (session), on the founder's staffing answer | Created as an amendment to ADR 0131 (commit `10e603430`) |
| 2026-10-02 | lane review of commit `10e603430` | Moved out of ADR 0131 into this Proposed record. Authority restated as the staffing answer; the default house's loss of the job and the D4 sender question stated plainly; line numbers replaced by symbol and job names |
| 2026-10-03 | PR audit gate (ADR 0090) at `8cd2ead37`, BLOCK on the record | Code held. The founder's 2026-10-02 "Guest events only" answer was recorded as open here; now under "Answered". Entry types and a per-house cap are decided; cap size, recipients and the D4 sender move stay open. The manual trigger is noted as having no caller |
