# Round 4 adversarial QA: Notifications, Calendar, Promotions, Recommendations

Read from `origin/main` (git archive extract at `/private/tmp/claude-501/x4/`, paths below are repo-relative under `apps/api-gateway/src/`). No repo edits, no servers, no mail/SMS, no production. Judge: a busy GM.

## Method and limits (read first)

- Traced code for 22 scenarios. Four were reproduced by running the real pure functions (`node --experimental-strip-types`): promo extraction (t1), firing-day key (t2), DST/quiet hours (t3). Scripts in `/private/tmp/claude-501/x4/t1.ts`, `t2.ts`, `t3.ts`.
- Jest on the partial extract: 7 suites pass (141 tests: `reminder-window`, `zoned-time`, `calendar-occurrences`, `ical-feed`, `calendar-query.dto`, `low-stock-digest-clock`, `promo-extract`). 13 suites could not load (the extract lacks sibling modules and `supabase/migrations`), including 1 test that needs the migrations folder. These are harness gaps, not product failures. Nothing I report below depends on those suites.
- The four `.planning/08-softwares/*.md` docs are dated 2026-09-01 and are stale against main (for example Promotions now has its own module, dismiss/restore endpoints and grading). I judged code, not docs.
- Not verified: the web UI (no web tree read), so any "the UI says X" point is marked as unverified.

## Counts

BLOCKER 0, BUG 11, HARM 4, SMOOTH 5 (things that hold up), IMPROVE 8.

---

## HARM (a GM acts on something false)

### H1. A wine's alcohol percentage becomes "14.5% off" and can raise a loud alert
`common/orchestrator/promo-extract.ts:220-224` takes the first `N%` in the mail as the discount. Any vendor mail that mentions ABV and has one promo word is stored as a discount.
Repro (ran it): subject "New arrivals from Barolo", body "Our 2019 Barolo 14.5% ABV is just arrived. Stock limited." returns `new_vintage`, `discount_pct: 14.5`, summary "new vintage: 14.5% off".
Effect: `promotion-extractor.service.ts:89-96` scores savings from that number, so the offer can reach the "interrupt" bucket and toast owners and managers (`:158-171`). `offer-grade.ts:427-428` then grades it against real prices as "14.5% off". A wine list newsletter is the most common vendor mail there is.

### H2. "$15 off per case" is subtracted from a per-bottle price, offering wine at $0
`promotions/offer-grade.ts:454`: `price = max(0, baseline.price - discount.amount)`. The extractor records the number and not the unit (the file's own header at `:151-152` says so). A baseline of $12 per bottle with "$15 off per case" gives an offered price of $0.00 and a large "worth" (`:728`). The reverse (per-bottle amount, case baseline) understates it.
Repro: t1 shows `Market 12 cases of Rioja at $15 off per case` extracts `amt: 15` with no unit.

### H3. A promo that ended yesterday is stored as valid for another year
`promo-extract.ts:140-143` and `:154-158` roll any past month/day to next year. Repro (now = 2026-11-07): "Offer ends Nov 6" gives `valid_until 2027-11-06`; "Valid through November 6" the same. A forwarded or late-read vendor mail reads as live for 364 days, and it dedups future real offers (see B7).
Related (same function): with no "valid until" cue, `:133` and `:147` scan the whole mail. "Market 12 cases" parses as March 12 (`mar` prefix, `until: 2027-03-12` in t1), "margin 5" as March 5, "ships monday" as next Monday (`until 2026-11-09`). `:181-183` does the same for weekday names.

### H4. A dismissed or "done" recommendation card comes back the same evening for US houses
`analytics/insights/suppression.ts:261-271` builds the "fire:day / fire:week" key from `getUTC*`. Cards without a subject (for example `stockout_imminent`, `analytics/recommendations.service.ts:497`, which names no subject) are keyed by that UTC day (`withFiring`, `:288`).
Repro (t2): dismissed at 18:30 New York (23:30Z) keys to `fire:day:2026-11-07`; at 19:05 local it is `fire:day:2026-11-08`, so the key no longer matches and the card returns mid-service. Weekly cards do the same: Sunday 8pm local rolls into the next ISO week. For Antalya (UTC+3) the rollover is 03:00 local, which is harmless; US houses are the exposed ones.
Also: because these cards have no subject, "done" on "Barolo about to stock out" hides a different wine's stockout card for the rest of that day or week.

---

## BUG

### B1. Quiet hours, push opt-out and category toggles do not govern the main alert funnel
`notifications/notifications.service.ts:805-827` pushes to every member's phone at any priority above "low" and reads no preference. `push/expo-push.service.ts:126-158` selects devices by user id only. Quiet hours are enforced in only two places: the recommendation digest (`analytics/digest/recommendation-digest.service.ts:339`) and calendar reminders (`calendar/calendar-reminders.service.ts:287`). `git grep push_enabled` finds it read only in `communications/recipient-resolver.service.ts`.
Scenario: GM sets quiet hours 22:00-08:00 and push off for "inventory". A medium-priority supplier or stock notice still buzzes the phone at 2am. The preferences page promises per channel and category control (`notifications.md` section 1). The inbox row is always written, which is fine; the push is the problem.

### B2. One member's setting decides the whole house's low-stock alerts, and "off" cannot be had
`notifications/low-stock-alerts.service.ts:1245-1252`: `enabled`, `instantFirstAlert`, `criticalImmediate` are `some(...)` across members, and the digest time is the earliest member's. A GM who switches low-stock off is overridden by any member whose row says on. A line cook who sets the digest to 03:00 moves the whole house's digest to 03:00 (the doc comment at `:1190-1195` states the OR semantics, so it is deliberate, but a per-person setting with a house-wide effect is a trap). I did not read the web copy; if the settings page does not say "this affects everyone" it is misleading.

### B3. "Delete all read" erases read history in every restaurant the user belongs to
`notifications/notifications.service.ts:1122-1135` filters `user_id` and `status=read` only; the controller call `notifications.controller.ts:543-549` passes no house. Contrast `markAllAsRead` (`:1029`), which is house-scoped. An owner of two venues cleaning up venue A wipes venue B's read alerts, with no undo.

### B4. Reminders never re-fire after an event is moved or its lead time changed
`calendar/calendar-reminders.service.ts:491-540` stamps `calendar_events.reminder_sent = true` and keeps one dispatch row per (event, user) (`claim`, `onConflict calendar_event_id,user_id`, `ignoreDuplicates`). Nothing in `calendar/calendar.service.ts` (grep: only `:43` and `:1169` mention `reminder_sent`) and no migration trigger clears either when the date, time or `reminder_days_before` changes.
Repro by reading: delivery on the 20th, reminder sent on the 19th, vendor moves it to the 28th, GM drags the event. The 28th gets no reminder. This is the common case for "delivery rescheduled".

### B5. Multi-day events disappear from months they extend into
`calendar/calendar.service.ts:300-306` filters only `start_date >= startDate` and `start_date <= endDate`. "Winter closure Dec 28 to Jan 3", viewed as January, is not returned (unless the caller passes `includeEarlierSeries`, which only widens recurring rows, `:296-299`). I could not read the web client to see whether it pads the window; the API as written cannot return it.

### B6. A failed repeat rule silently makes a weekly event a one-off
`calendar/calendar.service.ts:151-166`: when the recurrence insert fails the code resets `is_recurring` and still returns 201 with no `recurrenceRule` and no error. The GM believes "every Tuesday produce delivery" exists; one Tuesday does. Also not transactional (event row first, rule second).

### B7. Late or repeated vendor mail interacts badly with dedup, and the 09:00 digest has no multi-instance guard
(a) `promotion-extractor.service.ts:54-61` dedups on `is_active` plus `signature`, but `signature` includes `valid_until` (`promo-extract.ts:the sig array`) which H3 corrupts, and expired or dismissed rows are still `is_active`. Nothing in the tree deactivates a past `end_date`, so a stale row blocks the vendor's next real send of the same terms. (I did not find a sweeper in the files read.)
(b) `:189` `@Cron(EVERY_DAY_AT_9AM)` has no `timeZone` (server clock, not the house's) and no lock or per-day marker. Two gateway instances, or a restart exactly at 09:00, send two digests; `persistManagerNotification` is called with no dedupe key (`:242-257`). Contrast the low-stock digest, which has a DB fence (`low-stock-alerts.service.ts:34-40`) and the recommendation digest, which has an idempotency token. The digest also does not filter `dismissed_at`, `end_date` or past offers (`:193-200`).

### B8. Turkish vendor mail is dropped without a trace
Repro (t1): "Tüm şaraplarda %20 indirim, 30 Kasım'a kadar geçerli" returns `null`. `promo-extract.ts:221` requires the digit before `%` (Turkish writes `%20`), `TYPE_RULES` (`:54-95`) and `looksPromotional` (`email-triage.ts:206`) are English. For the Antalya house every local supplier offer vanishes; the caller returns `reason: "no promo terms extracted"` only to a logger. `:218` `toLowerCase()` also mangles `İ`.

### B9. Event times are not validated
`calendar/dto/calendar.dto.ts:166-173` `eventTime` and `eventTimeEnd` are bare `@IsString()`; title is `@IsString()` with no `MinLength` or `MaxLength` (`:138`). "25:99" or "" is accepted. `reminder-window.ts:129-139` then treats an unreadable time as the 09:00 all-day slot, so a timed delivery gets a wrong-hour reminder. `eventDateEnd < eventDate` is not checked in create; `calendar-occurrences.ts` would reject the whole window for it (`end_date < start_date` returns `incomplete`).

### B10. Digest/dedupe check in the notification funnel is check-then-insert
`notifications.service.ts:709-725` selects for the same `group_key` inside the window, then inserts. Two concurrent producers can both pass. Low-stock is protected by its own fence; other producers using `dedupeWithinMinutes` (`:363`) are not. Low probability; real on a restart.

### B11. Silent 1000-row ceiling in the low-stock sweep
`notifications/low-stock-alerts.service.ts:1173-1176` reads `v_low_stock_items` for every restaurant with `.select("*")` and no paging. PostgREST's default cap truncates silently at about 1000 rows; houses sorted past it get no edge alerts, no error. Fine today with few houses; it fails quietly as the customer count grows. Same pattern: `getNotificationHistory` (`:1138-1160`) has no limit and no paging (365 days, same cap), and `matchApplicableWines` reads `.limit(500)` of the house's wines (`promotion-extractor.service.ts:291`), so a cellar over 500 labels gets a wrong "relevance" score.

---

## IMPROVE

1. 200 unread: `getUnreadNotifications` (`notifications.service.ts:925`) defaults to 50 while `getUnreadCount` is exact. A page that shows the list and the badge will disagree (50 vs 200). Send `hasMore`/`total` with the unread list.
2. `updatePreferences` replaces `categories` wholesale (`:1291`). A partial body (only `{ai:false}`) drops the other four keys. Merge instead.
3. `BulkIdsDto` (`dto/notifications.dto.ts:225-231`) has no `ArrayMaxSize`; a few thousand ids make an oversized `.in()` URL.
4. A delivery can be scheduled on a day the house is recorded closed; `calendar.service.ts:createEvent` never consults `day-record.service.ts`. There is also no notion of a vendor holiday. A one-line warning on create would cover the "vendor holiday" scenario.
5. `completed` events still remind (`calendar-reminders.service.ts:265` skips only cancelled/dismissed). A delivery already ticked off still pings the day before. The 500-candidate cap (`:588`) is ordered oldest-first, and entries that only "expired" keep `reminder_sent=false`, so stale rows can crowd the window of busy houses.
6. `providerId` and `orderId` on event create are not checked to belong to the house (`calendar.service.ts:118-119`); the FK check turns a foreign UUID into an existence oracle through the error text.
7. Snooze has no upper bound (`insights/item-state.ts:131-138`): snoozing to year 9999 bypasses the "dismissal needs a reason" rule.
8. Promo "applicable wines" match is a plain substring of a 4-character name (`promotion-extractor.service.ts:293-297`): "Brut" matches "brutal", and accents ("Rose" vs "Rosé") do not fold. It includes inactive wines.
   Also: stored `action_url` values written before the sanitiser are not rewritten, and `notifications/safe-action-path.ts:23-24` says the web sinks do not use it yet (tracked in tech debt). Until they do, a legacy `javascript:` URL in an old row is still a click away.

## SMOOTH (checked and holds)

- Digest sent twice: low-stock digest is fenced once per house-day (`low-stock-alerts.service.ts:34-40`) and due on every tick after the local hour until midnight, so a down gateway catches up. The recommendation digest builds a per-person idempotency token (`analytics/digest/digest-schedule.ts`) and is OFF unless `DIGEST_SEND_ENABLED` is set.
- Calendar reminder double-send: dispatch rows are claimed before sending and released on failure (`calendar-reminders.service.ts:355-420`). Reminders for already-started events are expired, not sent late (`:280-300`).
- DST and timezones (t3): spring-forward 02:30 resolves deterministically, the repeated fall-back hour resolves to the first occurrence, overnight quiet window 22:00-08:00 reads correctly at 07:30 local, and an unreadable zone falls back to UTC rather than throwing. Recurrence expansion is date-only (`calendar-occurrences.ts`), so DST cannot shift an occurrence.
- Cross-house leaks: notification reads and writes are scoped to the token's house and user; a foreign id returns 404 (`notifications.service.ts` markAsRead and friends); promotions are owner/manager only and house-scoped (`promotions.controller.ts:62-64`); dismissal is house-wide and records who (`promotions.service.ts` dismiss).
- Dismissed then re-created: a dismissed key holds until restored; "Not now" is a personal one-day snooze; "Already handled" is recorded as done with no negative signal; a snooze with no future instant is refused (`recommendation-actions.service.ts:431-434`). The snooze-returns-early scenario is correct except where H4 applies.

## Scenario table

| # | Scenario | Result |
|---|---|---|
| 1 | Digest sent twice | low-stock and recommendation: held. Promo 09:00 digest: B7b |
| 2 | Quiet hours across timezones / DST | digest and reminders correct; main push ignores them (B1) |
| 3 | Snoozed recommendation returns early | correct by instant; per-firing keys return early for US houses (H4) |
| 4 | Dismissed then re-created | holds; subjectless cards hide other items (H4 note) |
| 5 | Two promos overlapping | no overlap logic; each is graded on its own; dedup by signature only (B7a) |
| 6 | Promo ending at midnight | `promotions.service.ts:274-276` uses the UTC date, so a US house sees "passed" on the evening of the last day (from 7-8pm local). Antalya sees "open" until 03:00 the next day. Same file `offerState` `:339-342` |
| 7 | Price below cost / zero price | grading can give $0.00 offered (H2) |
| 8 | Event on vendor holiday / closed day | no check (IMPROVE 4) |
| 9 | Notification for a deleted item | low-stock view excludes `deleted_at` and inactive rows (baseline view definition); stored rows keep their `action_url`, so the link can point at a deleted item (not verified in web) |
| 10 | 200 unread | list capped at 50, count exact (IMPROVE 1) |
| 11 | Per-role visibility | promos owner/manager only; promo toasts go to owner/manager rooms only; notifications per user |
| 12 | Turkish text | inbound promo mail dropped (B8); outbound copy is English-only (not verified for i18n in web) |
| 13 | Empty states | promotions read returns empty arrays with ledger counts; reminders with zero members close the run with `considered=0` (`calendar-reminders.service.ts:196-205`); not checked on the web |
| 14 | Event rescheduled after reminder | no re-fire (B4) |
| 15 | Multi-day event across month edge | missing (B5) |
| 16 | Weekly rule fails to save | silent one-off (B6) |
| 17 | Delete all read with two venues | wipes both (B3) |
| 18 | Staff turns low-stock off, GM leaves it on, and the reverse | OR semantics (B2) |
| 19 | Vendor mail with ABV percent | false discount (H1) |
| 20 | Late-read "ends Nov 6" mail | stored as valid until 2027 (H3) |
| 21 | Monthly event on the 31st | resolver skips months without a 31st (`calendar-occurrences.ts` monthly branch); expected by the RFC, but a GM may want "last day". Not run |
| 22 | Preferences partial update | categories replaced (IMPROVE 2) |
