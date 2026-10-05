## Delivery events written before ADR 0284 stay stale until the founder answers its fork 1 — OPEN — 2026-10-03

Filed from lane `events` (branch `fix/delivery-events-follow-the-order`, F-152 / A-034, register cluster C16). Migration `a_delivery_event_follows_its_order` keeps every delivery event in step with its order **from the moment it is applied**. It holds no backfill, on purpose: whether and how to repair the old rows is ADR 0284 fork 1, and the recommendation there is a follow-up PR whose body shows a read-only dry-run count and sample.

**What stays wrong until then.** Every delivery event written before the migration keeps whatever it had. On Tuzlu Rüzgar that is the 534 October events measured `pending` on 9 October at 10:00 on 2026-10-03, while all 87 of their orders that were read had already `COMPLETED`. Other houses were not measured; any event written before the migration for an order that has since arrived or been cancelled has the same shape. The trigger does fix an old event as soon as its order moves again (a status change or a `delivered_at` correction), but an order that is already `COMPLETED` has no further move to make.

**Measured residuals of the fix itself (named in ADR 0284 Consequences).**
- A calendar failure inside the trigger is a Postgres `WARNING` in the database log, not the gateway's `logger.error`. The order write stands; the event does not follow, and only the database log says so.
- A later edit of `expected_delivery_date` on an open order does not move its pending event. Only status and `delivered_at` moves are followed.
- The dashboard's week panel draws no event status (`apps/web/src/pages/dashboard/next/RailPanels.tsx:76-87`), so a cancelled delivery still reads as coming there. The calendar list read defaults to 100 rows (`apps/api-gateway/src/calendar/calendar.service.ts:275`); AW12 (the month read pulls every full row) is untouched.
