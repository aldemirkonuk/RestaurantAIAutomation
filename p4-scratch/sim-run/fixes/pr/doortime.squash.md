A door receipt queued offline used to be dated when it reached the server, so a
delivery received on Friday night and sent on Monday read as a Monday
delivery. The founder's ruling (C02, 2026-10-04, verbatim pick "72 h; older
needs a manager (Recommended)") is recorded as Locked in ADR 0286.

- resolveFactTime (apps/api-gateway/src/common/fact-time.ts) is the one rule:
  a sent time at most FACT_TIME_TRUST_HOURS = 72 old stands as the fact's
  time; an older one stands only for an owner or manager (back_dated). An
  older one from anyone else, a missing or unreadable one, or one more than
  five minutes ahead of the server is dated at the server's time; up to five
  minutes ahead is clock drift, dated at the receipt. It returns
  { at, basis, sentAt, reason }.
- The door (POST /procurement/receiving/orders/:id/door) applies it. The
  receipt event writes occurred_at for sent and back_dated, and leaves it to
  the database's now() for server. It always writes occurred_at_basis. The
  order's delivered_at follows the event, forward only. The stock movement
  receives the event's stored time through p_occurred_at. The response carries
  factTime.
- Migration a_door_receipt_says_which_clock_dated_it adds
  procurement_receipt_events.occurred_at_basis with CHECKs on its values. The
  72-hour rule is not a database constraint (the migration says why).
- The door screen says one quiet sentence when a receipt sent while it was
  open and the phone's time did not stand, or stood only as back-dated. A
  receipt that sends later from the offline queue is said by the bell
  (delivery-recorded producer).
- Not changed: markDelivered (it takes no sent time), pos-hub and
  apply_stock_movement. Open, each with a register entry and open CLAIMS rows:
  follow-up 1 (door-count countedAt, deliveries deliveredAt accept any time)
  and follow-up 8 (retroactive-order invoiceDate). These gaps exist on main
  already; this change does not widen them. Follow-up 5, the date control the
  founder picked 2026-10-07 13:51:58Z, is built in a later PR.

ADR 0090 three-role audit: BLOCK at f930e6958 (an as-of sentence in the ADR
still called that fork open); fixed in 12a1c6b6f; fresh full audit PASS at
3b0e69b8c (both reviewers APPROVE WITH NOTES, final HOLDS):
https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/612#issuecomment-6047657169
Not verified: a live PostgREST round trip of the +00:00 delivered_at filter,
deploy order (the migration must apply before the gateway; migrations apply
on merge), and a timezone-naive sentAt on a gateway not running in UTC.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
