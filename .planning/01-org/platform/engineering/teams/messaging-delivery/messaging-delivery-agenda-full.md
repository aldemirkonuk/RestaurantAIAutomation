---
type: agenda-full
division: platform
department: engineering
team: messaging-delivery
status: provisional
metrics: [messaging.duplicate_delivery_rate, messaging.drop_rate]
updated: 2026-08-24
links: ["[[messaging-delivery-charter]]", "[[messaging-delivery-premortem]]", "[[messaging-delivery-agenda-board]]", "[[messaging-delivery-loops]]", "[[engineering-agenda-full]]", "[[sre-runtime-resilience]]", "[[ai-orchestration-charter]]", "[[INBOUND_EMAIL_INTELLIGENCE_PLAN]]"]
---

# Messaging & Delivery — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Build the ledger that makes "exactly once" checkable, then make the transport survive a
restart. In order:

1. **A `notification_id`-keyed delivery ledger**, with ids minted at **intent** rather
   than at send. This is the one design decision that determines whether drop rate is ever
   measurable (premortem M2).
2. **Durable batching.** `buffer_manager.py`'s 30-minute LIFO window becomes an
   optimisation over persisted state, not the only copy (M1).
3. **Per-channel delivery states** — accepted / delivered / acknowledged — so "delivered"
   stops meaning "handed to the provider" (M3).
4. **Alerts on unauthenticated writes** to `notifications/**`, `communications/**`,
   `contacts/**` — 50 unguarded endpoints that send messages and read contact lists (M5).

Phase 0 of `.planning/INBOUND_EMAIL_INTELLIGENCE_PLAN.md` has shipped — triage signals,
shadow classification, durable notifications, a conservative reply gate. The durable-
notification work there is the closest existing thing to this ledger and is the natural
foundation rather than a parallel effort.

## How

**Mint the id at intent, not at send.** Everything follows from this. If a row is created
when we attempt delivery, a message that was never attempted has no row, and drops are
invisible by construction. If a row is created when the system decides a human should
learn something, drop rate is a trivial query.

**Per channel, never aggregated.** Email drops and websocket drops have unrelated causes;
one averaged number hides both. Four columns.

**Idempotency keys derived from the originating event.** The same seam
[[inventory-ledger-charter]] raises (its premortem M4): keys minted per hop make a retry at
hop one indistinguishable from a new event at hop two. This team is on the **right** of
that seam for stock movements — accountable for the objection — and on the **left** for
notification delivery.

**Restart is a first-class event.** Every restart emits a reconciliation record: buffered,
flushed, redelivered, dropped. [[sre-runtime-resilience]] owns *why* the process restarted;
this team owns whether the message survived it.

## Why now

- The failure is **seasonal and imminent**: the premortem's scenario is a restart during
  service hours. Service hours happen every evening.
- **Batching state is split today** between an in-memory buffer
  (`buffer_manager.py`) and the persist funnel. That split is the mechanism, and it exists
  now, not in a forecast.
- **50 unguarded endpoints** send messages and read contacts. This is the second-largest
  consequence cluster after procurement, and unlike procurement it can exfiltrate a
  restaurant's contact list silently.
- The threading plan and inbound-email plan are both written. Transport correctness is the
  missing floor underneath them.

## Next steps

- [ ] Mint `notification_id` at intent; back-reference every channel attempt to it (M2)
- [ ] Publish first per-channel `duplicate_delivery_rate` and `drop_rate` readings
- [ ] Make buffer state durable; emit a restart reconciliation record (M1)
- [ ] Split delivery states into accepted / delivered / acknowledged per channel (M3)
- [ ] Log threading decisions with their reason; forbid subject-similarity alone (M4)
- [ ] Alert on unauthenticated writes to `notifications/**`, `communications/**`,
      `contacts/**`; get them into the first guard tranche (M5)
- [ ] Prune stale push tokens on an evidence rule, not on provider error alone
- [ ] Agree cross-hop idempotency derivation with [[inventory-ledger-charter]] and
      [[integration-engineering-charter]] — one seam, one close-time

## Questions for the founder

1. **Is a dropped alert worse than a duplicated one?** The team's design trades between
   them (at-least-once vs at-most-once). For low-stock alerts, duplication seems clearly
   preferable. Is that true for *every* notification class, or does something — a vendor
   email, say — invert it?
2. **Where does "acknowledged" come from for email?** Open tracking is a privacy and
   deliverability decision, not just a technical one. Without it, email drop rate is
   measurable only as far as the provider's accept. Acceptable, or do we want tracking?
3. **OD-20 — is this a team or a function inside [[platform-api-charter]]?**
   (`technology.md:844`). Chartered here at team level; the fork is open.
4. **How long may a batch hold a message?** The LIFO window is 30 minutes. That is a
   product decision with a transport implementation, and it currently lives only in code.
5. **Contacts exfiltration — what is the disclosure posture?** If the unguarded `contacts`
   endpoints were read, would we know, and would we tell? [[compliance-charter]] should
   answer before, not after.
