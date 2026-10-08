# 0319 — The vendors page as the founder walked it: staff read the book, the page speaks the house's words

- **Status:** Locked on the rulings quoted below (the founder's own answers, 2026-10-01 → 2026-10-08). Anything marked *(proposed)* is this session's synthesis and is not locked until he says so.
- **Date:** 2026-10-08
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** vendors, providers, walk-through, R7, staff read only, vendor-write-gate, usual currency, learned from their mail, tear-and-stub, URL state, all beverages
- **Links:** page doc `.planning/06-pages/providers.md` §14 (rows VEN-W1 … VEN-W38, one per item, with evidence and the founder's words); amends [[0104-every-incoming-document-renders-as-one-canonical-mudavym-document]] (usual-currency author); supersedes the vendor-terms role rationale of [[0088-a-team-change-is-recorded-and-a-wage-is-not-invented]] as cited in [[0116-a-threshold-stops-an-order-and-a-default-is-not-an-answer]]; applies [[0112-one-modal-policy-three-shapes-one-primitive]] (overlays), [[0160-the-founders-sketch-review-what-he-valued-and-what-each-page-becomes]] §6 (the URL holds it), [[0221-each-house-owns-its-vendors-now-a-shared-vendor-layer-comes-later-the-word-is-vendors]] ("vendors"); branch `fix/review-vendors`

## Context

The founder walked `/vendors` pass by pass (P1–P10 of `p4-scratch/PAGE-REVIEW-PROMPT.md`) between 2026-10-01 and 2026-10-08, on house YAREN through the review gateway, and was asked about every change with a sketch first. Each item is a row in `providers.md` §14 with its evidence (`file:line`, headless or pane run, request). This ADR records the rulings — the choices that were his — in one place, as the prompt requires one ADR per page. The plain approvals of wording and layout fixes are listed by row only; their detail lives in the rows.

## Rulings (the founder's words, verbatim)

1. **Staff read the vendor book; every change to it is a manager's or an owner's act** (VEN-W30). Fork asked on 2026-10-08 after a live run as Sim Staff reached every vendor write. Answer: *"Staff read only (Recommended)"*, then *"Approve (Recommended)"*. Built as `apps/api-gateway/src/providers/vendor-write-gate.ts` (`assertVendorWriter`, the same `resolveRestaurantRole` + `roleSatisfies` pair the usual-currency write already used), asked by the 16 write routes of `providers.controller.ts` / `provider-intelligence.controller.ts` and by `PUT /vendor-terms/:providerId`; a `null` role (not proven) is refused like staff. The page hides the writes for staff (`useCanChangeVendors.ts`) — a hidden button is not the rule, the gateway is.
   **This supersedes** the vendor-terms rationale *"record it, do not restrict it"* (ADR 0088, restated in ADR 0116 §Two as the deliberate opposite of the threshold rule): a cutoff told to whoever phones the vendor is now written down by a manager or an owner. `vendor-terms.controller.ts` header already says so.
2. **A vendor's usual currency may be written from its invoices** (VEN-W9 → VEN-W13). Founder: *"look at files and only if the conf is 100 percent write as that currency otherwise approved this option 1"*; the design (`VEN-W13.html`, five states) then *"Approve"*. The rule built at 278f4bdd6: at least 3 invoices from this vendor in this house whose own page printed the same code, none disagreeing, none changed by a manager → written, recorded as read from N invoices; a person's value always wins. **This amends ADR 0104**, which says `providers.usual_currency` is *"typed by a manager"*: it may now also be written by the invoice rule, with its source and count on the row. It still files nothing (ADR 0104's rule stands). Migration slug `a_vendors_usual_currency_can_be_written_from_its_invoices` — PGlite-built, **not applied**; production holds no `currencySeen` on any document (read-only, 2026-10-01), so nothing qualifies at merge and nothing is back-filled.
3. **The legacy intelligence panels are rebuilt as one section** (VEN-W12 → VEN-W14). *"Rebuild now"*, then *"Approve"*: "Learned from their mail" (`LearnedSection.tsx`) replaces the four legacy panels. **Confirm on a learned fact is owner and manager only** (VEN-W14b): *"Owner and manager (Recommended)"*. **The four outreach Actions** (VEN-W14a): *"Wire to the agent"* — each becomes a real drafted message for approval, in its own agent lane; the menu stays hidden until that lane lands (founder, 2026-10-01).
4. **Weekday names left in `regions_covered` are hidden on screen, never cleaned** (VEN-W8): *"Hide weekdays on screen (Recommended)"*. No row is written.
5. **Vendor-sheet dates are the house's own day, written out** (VEN-W23, fork answered A) and **the sheet's top facts and Terms are one answer** (VEN-W24, fork answered A: the house's value, else the record's value marked "from the vendor's record").
6. **The sheet's Email and Phone are buttons** (VEN-W32): *"I want you to chnage the Email part to be more striking looking, right now looks like an error to the user"*, then *"Approve, phone too"*.
7. **A vendor may sell more than wine** (VEN-W33): *"Approve (Recommended)"*; the menu match: *"Also file all-drinks lane"* → OD-227. "Supplies my menu" still matches wines only and says so on the page.
8. **The vendors globe** (VEN-W17), design only: *"rebuild vendors globe for global ditrbutors make it more technologic and interactive"*; *"default first nrrowed serch to given address make it more innovative using the globe more colorful, and I want to see their details as well make this globe appealing to the older generations and outide of tech users"*; v2 *"not like this either needs rework, now rthis is too beginner, with locations are off, basic coloring, needs something that renders well"*; v3 A *"map globe. great job exactly of how I wanted"*; markers *"maybe an emoji or basic drawing? otherwise glow dots"* → glow dots; geocode *"each geocode is written when they sign up, also owner can move pin"*. Build is its own lane (§13 item 8).
9. **Production leftovers of the P3 write test stay** (VEN-W18): *"Leave them"* — the "R7 review test vendor (2026-10-01)", A. Bommarito Wines and the all-null `restaurant_vendor_terms` row on YAREN.

## Approvals by row (no fork; the words were "Approve" or "Approve (Recommended)")

W1–W3, W5–W7, W10, W11, W15, W16 (plain words on cards and sheet); W4 (*"C: short + below (Recommended)"* — the usual-currency panel short and below the cards); W19–W22 (fixes found while walking, approved after the pane run); W25 (shared `useProviders` hook — SHARED, queued, not in this PR); W26–W29 (failures in the house's words, with a retry); W31 (server refusals in the house's words); W34 (no manager's act told to every reader; no shouting); W35 (a half-written vendor is held, ADR 0112 tear-and-stub); W36 (`?q=`, `?find=`, `?vendor=` hold the page, ADR 0160 §6); W37 (form inset); W38 (the coverage count reads once per load, keyed on house + book size).

## Options considered (for the one rule a reader could reverse: W30)

1. **Staff read only** — chosen. Every write behind one server gate; the person who phones the vendor tells a manager.
2. **Staff may record terms and contacts, not add or remove vendors** *(rejected by the founder's pick)* — keeps ADR 0088's "record it" for terms, at the cost of two role rules on one sheet.
3. **Leave it** — every signed-in role could add, edit and delete vendors, which the live staff run showed.

## Consequences

- Staff see the book, the sheets and the scorecard with no write control; a write they attempt by hand is a 403 that names who can.
- The usual currency has two authors (a person, or ≥3 agreeing invoices) and says which.
- What would reopen W30: a house where the person who phones vendors is staff and terms go unrecorded — the signal is terms rows ageing with `unknown` on vendors staff talk to.
- Not in this ADR: the all-drinks menu match (OD-227), the shared `useProviders` failure (W25, shared queue), white inputs and the paper tip band on charcoal (shared queue), the whole-register `/vendor-terms` read (tech debt, `providers.md` §13 item 0).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-08 | Opus 5.5 (R7, session 275d531b) | Created from `providers.md` §14; quotes copied from the rows, which were written at the moment of each answer |
