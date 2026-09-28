# 0109 — A reminder is the house's job, not the browser's

- **Status:** proposed — built behind a flag, founder review open
- **Date:** 2026-09-03
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** calendar, reminders, cron, scheduled-jobs, quiet-hours, idempotency, multi-tenant, notifications, absence-reported-as-health, ADR-0022, ADR-0020
- **Links:** [[0022-scheduled-jobs-serve-opted-in-tenants]] (the per-tenant scheduler this runs under), [[0020-no-fabricated-answers]] (why the page reports the job's absence), `.planning/06-pages/calendar.md` §10 / §13.1 (the gap this closes), `apps/api-gateway/src/calendar/calendar-reminders.service.ts`, `supabase/migrations/20260903101500_calendar_reminders_have_a_ledger.sql`

## Context

`calendar_events` has carried three reminder columns since the production
baseline — `reminder_enabled`, `reminder_days_before`, `reminder_sent`
(`supabase/migrations/20260805000000_baseline_from_production.sql:2357-2360`),
plus `reminder_sent_at` at `:2360`. Two of them were written by the API
(`apps/api-gateway/src/calendar/calendar.service.ts:124-125`) and read by
nothing. The third, `reminder_sent`, was read exactly once — mapped into the
response at `calendar.service.ts:1118` — and **written nowhere** in `apps/` or
`services/`.

The only thing that has ever fired a calendar reminder is a browser poller:
`apps/web/src/lib/reminder-scheduler.ts` keeps a queue in `localStorage`
(`:9`, `:82`), `startReminderScheduler` drains it every 60 seconds (`:247-255`),
and on fire it raises a `Notification` and writes a durable row through
`POST /notifications` (`:176-200`). It is booted globally at
`apps/web/src/main.tsx:20`.

That is a promise no product can make. Three consequences, each measured rather
than assumed:

1. **A reminder set on the laptop does not exist on the phone.** The queue is
   per-origin, per-browser `localStorage`.
2. **Nothing fires with the tab closed.** The poller is an
   `setInterval` in the SPA.
3. **The page had to say so.** The rebuilt `/calendar` shipped on 2026-09-02
   with the label "Reminders — on this browser" and the sentence *"There is no
   server-side reminder job: the event row keeps a flag, and nothing reads it"*
   (`apps/web/src/pages/calendar/next/EventSheet.tsx:520,539` as of that
   commit). That was honest. calendar.md §13.1 already named the repair:
   *"A cron over `reminder_enabled`/`reminder_days_before` that writes through
   `persistForRestaurant` and stamps `reminder_sent`."*

The founder's instruction for this wave was that an honest em dash is no longer
the finish line. So the question is not *whether* to build the job — it is what
shape it takes, because a scheduled sender is one of the two or three places in
this product where getting it wrong is expensive in a way a page never is: a
double send is a message a person cannot unread, and a job that quietly stops is
indistinguishable from a calendar with nothing due.

## Options considered

1. **Flip a boolean: read `reminder_sent`, send, write `true`.** The obvious
   shape, and the one the column's name invites. Rejected on two counts, both
   structural rather than stylistic. *First*, it is a read-then-write race: two
   gateway instances (or one instance whose sweep overlaps its successor) both
   read `false` and both send. Railway runs the gateway as a process that can be
   replaced during a deploy, so overlapping sweeps are not hypothetical.
   *Second*, and worse, it cannot express a partial delivery. Quiet hours are a
   **per-user** preference (`notification_preferences.quiet_hours_*`,
   baseline:3916-3918) and `persistForRestaurant` writes one row per member
   (`apps/api-gateway/src/notifications/notifications.service.ts:608-728`), so
   one event routinely goes to three of five members now and two at 08:00. A
   single boolean flipped after serving three strands the other two silently —
   the exact absence-reported-as-health shape, written into a column named
   `reminder_sent`.

2. **A dedicated dispatch row per (event, person), with a UNIQUE index, claimed
   before the send.** *(Chosen.)* The index does the work a boolean cannot:
   `INSERT … ON CONFLICT DO NOTHING` is atomic, so exactly one sweep wins the
   right to send to that person for that event, for ever. Quiet hours become a
   per-person decision with no coordination problem, because deferring one
   member simply means not claiming their row this tick. Costs a table and a
   join; buys idempotency that does not depend on any code path being correct.

3. **Give the job a Redis lock instead.** Would prevent concurrent sweeps
   without a new table. Rejected: it prevents *overlap*, not *duplication* — a
   lock released before a crash, or a sweep that legitimately runs twice across a
   restart, still double-sends — and it makes correctness depend on a service
   the reminder path does not otherwise need. `_check_rate_limit` in the
   orchestrator already documents what that dependency degrades to: *"Falls back
   to always-allow when Redis is unavailable (fail open)"*
   (`services/agent-orchestrator/agents/notification_agent.py:1513-1520`). A
   fail-open lock on a sender is not a lock.

4. **Send from the existing `custom-reminders-check` cron.** There is already a
   15-minute per-tenant job in `communications/scheduled-tasks.service.ts:733`.
   Rejected: it reads `custom_reminders`, a different table with no UI anywhere
   in the web app and zero rows in production (calendar.md §10). Folding calendar
   events into it would tangle two unrelated schedules and put calendar logic in
   the communications module, where `/calendar`'s owner cannot maintain it.

5. **Keep the browser scheduler and only add a server fallback.** Rejected as
   the default because two senders for one event is a double-send by
   construction. What survives is narrower and stated on the row: the browser
   queue is retired for entries the rebuilt sheet writes, still drains what the
   **legacy** page queued, and the sheet cancels an entry's browser-queued copies
   whenever it saves that entry (`EventSheet.tsx` `clearBrowserQueue`). See
   Consequences for the residue this leaves.

6. **Do nothing.** Costs the founder a calendar whose reminders are a property of
   a browser tab, and leaves `reminder_sent` a column that certifies nothing.
   The page can say so honestly — it did — but honesty about a missing feature
   is not the feature.

## Decision

**The calendar reminder is a per-tenant cron under
`ScheduledTenantsService.runPerTenant`, and its idempotency is a UNIQUE database
index claimed before the send — not a boolean, not a lock.** The event's
`reminder_sent` becomes the roll-up it was always named for, and is written for
the first time; it is never the thing that prevents a second send.

Concretely, `apps/api-gateway/src/calendar/calendar-reminders.service.ts`:

- `@Cron("*/15 * * * *")` → `runPerTenant("calendar-reminders", …)`, so it
  serves only the restaurants ADR 0022 enumerates, one tenant's failure never
  costs another its run, and every run logs `SCHEDULED_JOB_SUMMARY`
  (`communications/scheduled-tenants.service.ts:166-207`).
- Due time is computed in the **restaurant's** timezone
  (`ScheduledTenant.timezone`, `scheduled-tenants.service.ts:18`), by
  `reminder-window.ts`. An all-day entry is due at 09:00 local — the hour the
  browser scheduler already used (`reminder-scheduler.ts:57`), kept so a house
  being reminded at 9 stays reminded at 9.
- Each intended member is claimed with an upsert into
  `calendar_reminder_dispatches` (`ignoreDuplicates`), then served in one
  `persistForRestaurant` call narrowed by `onlyUserIds`, then confirmed with
  `sent_at` + `outcome = 'sent'`.
- A member inside their quiet window is **deferred**, not dropped: no row is
  claimed, so the next sweep after the window closes serves exactly them.
- Every sweep opens and closes a `calendar_reminder_runs` row, which is what
  `GET /calendar/reminders/status` renders as *last run*, beside the next
  scheduled tick.

**The job is armed by its own env var, `CALENDAR_REMINDERS_ENABLED`, off by
default.** Not the page's Mudavym flag: a design flag decides what a page looks
like, and this path writes rows into every member's inbox and pushes them to
every member's phone. The allow-list shape (only `true` / `1`, trimmed and
lower-cased) is copied from `RECURRING_ORDER_REMINDERS_ENABLED`
(`apps/api-gateway/src/communications/recurring-order-reminder.ts:20-37`) for the
reason that file states: a deny-list turns every typo into a live sender, an
allow-list turns every typo into silence, and silence is the recoverable
failure. The whole sweep returns before it enumerates a tenant while the flag is
unset, and the status endpoint reports `armed: false` with the flag's name so
the page says "built but not switched on" rather than "nothing was due".

**Quiet hours are evaluated on the restaurant's clock, and that is a deliberate
divergence** from the orchestrator, whose `_is_quiet_hours` compares against
`datetime.now()` — the process's local time
(`services/agent-orchestrator/agents/notification_agent.py:1487-1512`). A
22:00–08:00 window that means "22:00 wherever the container happens to run" is
wrong for a house in Istanbul. Recorded in calendar.md §9 rather than silently
differing.

**Day granularity is accepted, not papered over.** `reminder_days_before` is an
`integer` (baseline:2358), so "15 minutes before" is not representable. The sheet
offers *On the day / 1 day / 2 days / 1 week* and says why, instead of offering
minutes and rounding them into a value the house never chose. The column that
would fix it is filed in calendar.md §13.

## Consequences

**What becomes easier**

- A reminder follows the person, not the machine: it lands in the inbox for
  every member and pushes to their phone, with the app closed.
- `reminder_sent` / `reminder_sent_at` finally mean something, so an operator can
  see which entries have been reminded — the sheet says so on the row.
- The page can make a claim about reminders that is checkable: it renders the
  job's last actual run, its next scheduled tick, and whether this restaurant is
  served at all.
- Onboarding a second restaurant to reminders is the same single INSERT that
  ADR 0022 already defined; there is no second opt-in mechanism to learn.

**What becomes harder, or is given up**

- **Claim-before-send trades a lost reminder for a double one.** A crash between
  the claim and the notification write loses that reminder. It is not silent:
  the row keeps `sent_at IS NULL` and `outcome IS NULL`, and the status endpoint
  reports those as *claimed and never confirmed* rather than counting them as
  sent. A funnel that returns "wrote nothing" is treated as a failure and the
  claim is **released**, so the next sweep retries.
- **A client-expanded recurring occurrence gets no reminder.** A series that was
  never materialised through `POST /calendar/recurrence/:ruleId/generate` is one
  row; the occurrences the page draws are expanded in the browser
  (`apps/web/src/lib/calendar/recurrence.ts`) and carry no id to key a dispatch
  on. Materialised occurrences are real rows and are reminded normally. Stated
  on the page, filed in §13.
- **The legacy calendar keeps its browser queue.** `main.tsx:20` still boots the
  poller, because `main.tsx` is shared and the shipping page must render
  byte-for-byte with the flag off. The residue: an entry created on the legacy
  page, never opened in the rebuilt sheet, whose reminder is due, can fire twice
  — once from that browser and once from the cron. The rebuilt sheet cancels an
  entry's browser-queued copies whenever it saves it, which closes the path for
  anything the redesign touches. Removing the boot is one line in `main.tsx`
  and belongs to whoever retires the legacy page.
- **No email.** The job writes the inbox row and the push. Mail needs a
  recipient policy of its own (`RecipientResolverService`, and the legacy-tenant
  carve-out at `communications/scheduled-tasks.service.ts:120-146`); the channel
  is rendered disabled with that reason rather than offered.
- **The cron is pinned to a fixed 15-minute step, not to a tenant's timezone.**
  Minute-step crons are zone-independent, so this is correct — but the general
  defect ADR 0022 records as OD-90 (every `@Cron` pinned to `America/New_York`)
  is untouched by this work.

**What the founder has to decide**

Arming it. Measured against production on 2026-09-03 through the local gateway:
`served: true, armed: false, pending: 0` for Meyhouse Palo Alto — it would be
served, nothing is armed, and no entry currently qualifies, so flipping the flag
sends nothing retroactively and begins serving entries created from then on.

**What would trigger revisiting this**

- A `calendar_reminder_runs` row whose `finished_at` is NULL, or a gap between
  consecutive `started_at` values larger than two intervals for a served tenant:
  the job is dying mid-sweep or not running. The page's *last run* line is the
  signal, and it is why the line exists.
- A non-zero `unconfirmed` count that does not return to zero: claims are being
  taken and not honoured.
- The founder asking for sub-day reminders — that is the `reminder_minutes_before`
  column, and it supersedes the day-granularity paragraph above.
- More than a handful of opted-in tenants, or a `truncated` run: the sequential
  sweep and the 500-row candidate cap are sized for the opt-in tenant count ADR
  0022 assumes, and both are surfaced rather than assumed.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-03 | — | **Numbered 0109 after 0106 was found taken.** `check_adr_numbers_unique.py` printed `next free: 0106`, and `origin/chore/dependabot-backlog-resolved` already carried `0106-every-dependabot-pr-resolved-by-measurement.md` — the guard reads REFS and my file was untracked, so it could not see the clash. The number was taken by sweeping every `refs/heads` and `refs/remotes` tree plus the untracked ADRs three peer builders had written into this shared worktree (0100, 0102, 0107, 0108). Cron OFF by default (`CALENDAR_REMINDERS_ENABLED`); page rendering behind `mudavym_design_calendar`; migration written, not applied. Verified: 90 gateway jest tests in `src/calendar`, 27 vitest in `pages/calendar/next`, `check_gateway_boots.sh` PASS, and `GET /calendar/reminders/status` 200 against the local gateway on :4000 (which, pointed at production where the two tables do not exist yet, correctly returned `ledgerReadable: false` rather than "never run"). |
