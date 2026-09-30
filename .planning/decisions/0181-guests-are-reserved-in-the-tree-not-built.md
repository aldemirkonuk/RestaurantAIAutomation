# 0181 — Guests, reservations and waitlist are reserved in the tree, not built

- **Status:** Locked (founder, 2026-09-20). "Name it in plan. I need this scope too, do not build, reserve their places in the sw, make sure to identify it well." Nothing is built.
- **Date:** 2026-09-20
- **Decider:** Aldemir (founder). Decisions are locked by the founder, never by an agent.
- **Keywords:** guests, reservations, waitlist, covers, guest profile, U10, one-tap, guest.*, nav slot
- **Links:** [[0178-phase-0-then-phase-1-no-parallel-pitch]] (Phase 3 domain). [[0175-one-tap-from-the-notification-is-staged]] (class SA default). [[0112-one-modal-policy-three-shapes-one-primitive]] (a guest send is a send). Brief: [`../07-reference/ENDPOINT-UNIVERSE-PLAN.md`](../07-reference/ENDPOINT-UNIVERSE-PLAN.md). CLAIMS `ADR-0181-GUEST-PREFIXES-UNBUILT` (resolved — must keep holding).

## Context

The endpoint-universe brief's scope included guests, reservations and waitlist. Completeness (S8) found **no universe file at all** for them. An earlier reading treated that as "out". The founder corrected it: the domain is in scope, it must be named and identified, places must be reserved in the software, and it must **not** be built yet.

This is a second product sitting beside procurement, cellar and communications. Building it from the six parts that never catalogued it would invent the guest product in the gaps.

Verified at `79dfea023` / this tree: no `apps/web` route `guests` or `reservations`, no gateway `GuestsController`, no migration `create table` for `reservations`, `waitlist_entries` or `guest_profiles`. The names are free. Org-side guest-identity charters exist under `.planning/01-org/product/guest-experience/`; they are not a product surface.

## Options considered

1. **Out of the plan.** Cheap. **Rejected by the founder:** "I need this scope too."
2. **Build it now, in this lane.** **Rejected by the founder:** "do not build." The six parts have no U10; a build would be a second product invented without a catalogue.
3. **Name it, identify it, reserve places in the tree, do not build.** Chosen.
4. **Ship a dark nav item and empty routes this PR.** Looks like a reservation. **Rejected here:** an unpublished route and a dark nav are product. This ADR reserves the *names*. The first brick (dark nav, unpublished prefix) is a later Phase 3 PR after U10, not a controller.

## Decision

**The guest domain is in the product map. It is identified below. Places in the software are reserved by name. No controller, no migration, no message, no OpenTable scrape, until U10 exists and the founder says build.**

**U10 catalogue (research, owed before any code)** covers at least:

- Book / modify / cancel a table.
- Waitlist, covers, seating chart, turn time.
- Guest profile, no-show, deposit.
- Guest messaging (SMS / WhatsApp / email), including "your table is ready" and a review-request after a visit.
- POS cover-count as a signal, not as a clock.
- One-tap classes for `guest.seat_now`, `guest.bump_waitlist`, `guest.cancel_booking`.

**Names reserved, not to be used by anything else:**

- Nav slot `Guests` (when it exists: dark until built).
- Route prefixes `/guests` and `/reservations`, unpublished until built.
- Tables `reservations`, `waitlist_entries`, `covers`, `guest_profiles`.
- One-tap act ids `guest.*`, listed as class **SA** (money-adjacent: a deposit, a table that could have been walked) or **N**, and **not implemented**. A free-text guest send is a send (0112). A templated "your table is ready" is a send-window vs seal fork, locked later.

**Build vs integrate** (OpenTable / Resy / a reservation platform as system of record, Mudavym for the seal and the guest-facing message) is **not decided**. The brief leans integrate-for-the-book, ours-for-the-message. That fork waits on U10.

`collection_routes.py` `POST /opentable` is an unmounted scrape. ADR 0179 deletes it with the rest of that HTTP surface. It is not a guest product.

## Consequences

- **Easier.** A later session cannot quietly take `/reservations` for a cellar filter or a `covers` table for a wine-case count.
- **Harder.** Phase 3 cannot start this domain without U10. That is the point.
- **Revisit when** U10 exists, or a food-heavy / reservations-first tenant arrives with a named integrate-or-build fork.

## Open

Not decided here, and not added to `OPEN-DECISIONS.md`.

- Integrate a reservation platform vs build the book.
- Whether "your table is ready" is a send-window or a seal.
- NF-B guest identity (ADR 0037) vs a house-only profile with no consumer app.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-20 | Aldemir (founder) | Name it, reserve places in the SW, identify it well, do not build |
| 2026-09-20 | Cursor Grok 4.6 | Recorded; prefixes and table names verified unused in this tree |
