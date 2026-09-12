# 0060 — A window is a floor, an unknown is not a zero, and a refusal is not an outage

- **Status:** Proposed
- **Date:** 2026-09-01
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** windowed count, floor, greater-or-equal, em dash, measured zero, 403, forbidden, unit_type, bottles, tenant scope, outbox, receiving, honesty
- **Links:** [[0051-rebuilt-pages-show-live-data-only]], [[0054-order-capture-and-unit-arithmetic]], [[0020-no-fabricated-answers]], [[0016-ledgers-must-express-unknown]], `.planning/06-pages/receiving.md`

## Context

The rebuilt `/receiving` was measured against ADR 0051 the day after 0051 was
locked. It is the most careful page in the repo on several axes — a thrown
IndexedDB read renders as "unknown, not zero"
(`RcOutboxRail.tsx:179-182`), a pin audits its own inference and calls the name
"the queue's best candidate, not a certainty" (`:127-132`), a dash→number
transition deliberately does not animate because knowledge arriving is not a
value changing (`RcTally.tsx:40-41`) — and it still shipped ten defects of
exactly the kind 0051 exists to forbid. That combination is the finding: care
applied per-component does not compose into a page-level guarantee.

Measured, with the lines that carried each:

- **Wrong unit on the page's most consequential number.**
  `useReceivingNextData.ts:111` set `bottles: num(o.quantity)` and
  `RcStaffLane.tsx:135` rendered it as *"{n} bottles expected"*. But
  `procurement_orders.quantity` is denominated in `unit_type`
  (`bottle|case|keg|pack|split_case|each|liter`), so a five-**case** order told
  the person about to count bottles at the door that five bottles were expected.
  `mapOrderRow` already emitted both `unitType` and `bottlesTotal`
  (`procurement.service.ts:1913-1914`) — the correct number was in the payload,
  unused. This is [ADR 0054](0054-order-capture-and-unit-arithmetic.md)'s
  arithmetic, fixed in the gateway and reintroduced one layer up.
- **Not one `≥` on the page**, against six server-side windows: the staff count
  (`RcStaffLane.tsx:181`, a 25-row page per status), the lane counts and
  at-risk total (`RcManagerQueue.tsx:91,390`, `.limit(100)`), the uncounted
  strip (`:121`, `.limit(500)`), and every owner figure
  (`credits.controller.ts:137`, `.limit(5000)` with **no `.order()`**). The
  staff case is the sharpest: `listOrders` returns an exact `total` and
  `hasMore` (`procurement.service.ts:853,860`) and the hook destructured only
  `data?.orders` — the number 0051 asks for was thrown away at the door.
- **A measured `$0` and an unknown deliberately merged.**
  `RcManagerQueue.tsx:261,314` rendered `dollarsAtRisk > 0 ? money : EM`, so a
  real zero printed as an em dash — while `:313` printed `openClaims` as a
  literal `0`. One row could read `$— · 0 open claims`.
- **The shrinkage safety net went silent exactly when its query failed.**
  `useReceivingNextData.ts:250` set `unverified: []` whenever the query did not
  answer and `RcManagerQueue.tsx:403` rendered the strip only when non-empty, so
  a failure rendered as "nothing uncounted" — the most expensive possible
  false reassurance on this page.
- **"Not permitted" was not a state anywhere.** No branch distinguished 403
  from 500, and two of the three renderings never printed the message at all.
- **An offline non-attempt rendered as a clean sync.** `doorOutbox.ts:94`
  returns `{sent:0, failed:0}` without attempting anything when
  `navigator.onLine` is false; the hook stamped it with `new Date()` and the
  rail printed `last sync 14:32 · sent 0 · failed 0` two lines under its own
  header reading *"offline — holding"*.
- **The outbox was not tenant-scoped.** One global `localStorage` key
  (`:373`), so on a shared door tablet a receipt dropped under restaurant A
  rendered as a `role="alert"` under restaurant B, naming that receipt and its
  order-id prefix.
- Plus: `vendor` was always null (`:107` reads `providerName`, which
  `mapOrderRow` never emits), the credited-list query had no error branch at
  all, the `/receipts` hand-off dropped the order id its sibling passed, and
  `settlementRate` — settled ÷ all resolved claims — sat as the hint under the
  figure "They refused", implying a population it does not describe.

Ten defects, but not ten mistakes. Three shapes: *a window rendered as a
total*, *an unknown rendered as a zero or an empty list*, and *a refusal
rendered as an outage*. 0051 named the first two as clauses; it did not say who
enforces them, so each component re-decided.

## Options considered

1. **Fix the ten and move on.** Cheapest. Leaves the next rebuilt page to
   rediscover the same three shapes, which is precisely the history 0051 was
   written to end — 0020 stated the principle in 2026 and it recurred anyway
   because a principle without an enforcer is a suggestion.
2. **Fix the ten and add a guard that proves the full rule.** A guard that
   traces a `.limit()` in a NestJS service through HTTP, a `queryFn`, a
   `useMemo` and into JSX. This is what the rule literally says, and it is not
   decidable: interprocedural dataflow across two languages and a network hop.
   Building it would produce something that looks authoritative and is wrong,
   which is worse than nothing — a green tick over an unexamined surface is how
   six windowed figures shipped in the first place.
3. **Fix the ten, and guard the narrowest set of *checkable* claims, with the
   boundary stated in the guard itself.** Less coverage than (2) pretends to
   have, more than (1) has. Costs a register the page must maintain.
4. **Do nothing.** Production keeps telling a receiver that five cases are five
   bottles.

## Decision

**Option 3.** The three shapes become one binding rule for rebuilt pages, and
`scripts/check_windowed_figures.py` holds the checkable part of it in CI.

The rule, extending ADR 0051:

- **A figure derived from a capped query renders as a floor (`≥ n`)** — and
  when the server offers an exact count instead (`total`, `hasMore`), the page
  uses it and needs no marker. A fetch that sends a `limit` may not discard its
  own cardinality.
- **A page never re-derives an arithmetic the gateway owns.** Where the server
  computed `bottlesTotal`, the view model uses it; where it did not, the page
  renders the em dash plus the ordered quantity *in its own unit* and never
  guesses a pack size.
- **A measured zero and an absent figure are distinguishable in the markup.**
  `num()` returns null-or-number; the formatter decides. No `x > 0 ? … : EM`.
- **A "did not answer" state is `null`, never `[]`.** A safety net that renders
  nothing when its query fails is worse than no safety net, because it is
  reassuring.
- **403 is its own state, and the message is printed.** A refusal names the
  permission, drops the retry that cannot help, and — where a person is
  standing at a door — still sends them to the paper record.

The reasoning that carried it over (2): the guard's honesty is the point of the
guard. Its header states, in full, that it does not trace a value from a
`.limit()` to a JSX node and cannot; it holds five things instead — declared
caps still match the queries they cite, every declared window is consumed and
its renderers carry floor markers, no measured zero is folded into an unknown,
the unknown-capable fields keep their `| null`, and no capped fetch discards
its `total`/`hasMore`. It exits **2** when an anchor moved, which blocks exactly
like a violation. Proven against the pre-fix tree: exit 1 naming
`RcManagerQueue.tsx:261` and `:314`, exit 0 after.

Two sub-decisions taken deliberately rather than defaulted, recorded because
either could reasonably have gone the other way:

- **The pre-scoping outbox key is adopted, not discarded and not re-attributed.**
  Discarding silently loses a pinned drop, which *is* the inv-09 defect the rail
  exists to fix. Re-attributing claims another restaurant's receipt as this
  one's — the leak being closed, performed once by hand. So the pins are adopted
  by the first restaurant to open the page, stamped `tenantUnknown`, rendered
  saying the restaurant was never recorded, and the legacy key is removed so
  they do not fan out to every tenant.
- **`openClaims` renders as a floor unconditionally.** The server links credits
  with `.limit(200)`, unordered, capped per *restaurant* rather than per order
  (`receiving.service.ts:384`), so the client cannot observe whether the window
  was full. `≥0` is a weaker and truer claim than `0`: it says "none inside the
  window", which is what was actually measured.

## Consequences

- **Easier:** the three shapes have one name and one command. A page audit asks
  "does it have a window register, and does CI hold it?" instead of re-reading
  every figure.
- **Harder:** the page must maintain `SERVER_WINDOWS`, a register of caps cited
  to the gateway queries that impose them. When a server cap changes, CI fails
  until the register and the prose quoting it both move. That is the intended
  cost — the alternative is floor prose that names a cap the server stopped
  using, which reads exactly like a measurement.
- **Given up:** the guard does not prove a floor marker sits on the *right*
  figure, does not read any other page, and cannot see a cap imposed by a
  PostgREST default or a view. Stated in its header and here rather than
  implied by a green tick.
- **Deliberately not fixed here, and still live:** `mapOrderRow`
  (`procurement.service.ts:1906-1928`) maps `providerId` and never a provider
  *name*, so the door still cannot see which distributor is standing in front of
  it. The client half is written and inert until the field lands. Likewise the
  door outbox queue (`lib/doorOutbox.ts`) stamps no restaurant id, so the queued
  list — as opposed to the pinned drops, which are fixed — remains untenanted.
  Both files are owned by unmerged branches; both are marked TODO in code.
- **Revisit when:** a second rebuilt page needs the same register. At two, the
  register moves out of the page and the guard takes a list of pages instead of
  one hard-coded path.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-01 | — | Created from the ten-defect measurement of the rebuilt /receiving |
