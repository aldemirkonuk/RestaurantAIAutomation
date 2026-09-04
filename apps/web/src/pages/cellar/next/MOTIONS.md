# CellarNext — motions, canonical

Five motions, every one a token from `src/lib/mudavym/motion.ts`. The founder's
verdict on this page was *"so much crowded"*, so the ration is tight: a cellar
book is read, not watched. Nothing on the parent or on any register moves that
is not in this table.

| id | token | curve · ms | fires |
|---|---|---|---|
| `cl-stand-settle` | `settle` | HOUSE `cubic-bezier(.16,1,.3,1)` · 320ms | the reading stand opening above the register when a bottle is chosen, and closing when it is dismissed — CSS `grid-template-rows: 0fr → 1fr` on `.cl-stand`. This is the row-expand "settle" the founder singled out by name on board 053. |
| `cl-leaf-turn` | `turn` | `cubic-bezier(.32,.72,0,1)` · 420ms | the stand's *contents* when a different bottle is chosen while it is already open — opacity 0.2→1 plus a 4px rise, run through `animate()`. The page turns; the stand does not re-open. Deliberately slower than `settle`, per the token's own note. |
| `cl-ink` | `ink` | HOUSE · 160ms | every micro-state: register-card, shelf-card, row, chip, field, register switch, and button hover/focus. Border warms to `--seal-ring`, ground lifts one paper step. Nothing translates, nothing scales, nothing moves more than 0px. |
| `cl-tally` | `tally` | sampled overdamped spring (stiffness 120 / damping 26, `linear(…)`) · 840ms | every figure on the parent surface — three on the wine register card, two on each catalogue register card, four in "In the building tonight" — on first arrival. Driven off `springs.tally.samples`, so the curve on screen IS the token. **An em dash never tallies**: `Tally` renders `null` instantly and returns before the rAF loop starts. |
| `cl-hold-pour` / `cl-seal-stamp` | `pour`, `stamp` (inside `HoldToApprove`) | `linear` · 620ms, then the stamp spring (500/26, ~11% overshoot) · 360ms | the only ceremony on the page: holding to send a real purchase order to a vendor. The seal appears here and nowhere else. An early release retreats on `tuck` and says what did not happen. |

## The one disclosed exception — framer-motion

`WineRegister.tsx` lazily imports `components/wines/MenuScannerModal`, shipped
legacy code that carries its own motion library: `MenuScannerModal.tsx:1` and
`MenuScannerTab.tsx:2` both `import { motion } from 'framer-motion'`, and both
live outside this page's owned paths. There is no lighter path inside this
directory — rendering the tab in a Mudavym dialog would not drop the dependency,
because the tab imports it too — so removing it means rebuilding the scanner
(page note §13.8). It is code-split, so it reaches neither the first paint nor
the bundle until an operator opens the scanner, and **none of its animations are
in the table above**: the scanner's motion is the legacy component's own, is not
tuned here, and is not claimed as house motion.

## Deliberate non-motions

- **The register does not stagger in.** 500 titles arriving one after another
  is exactly the busyness the verdict rejected. The table paints at once.
- **Switching register (Register ↔ Shelf) does not cross-fade,** and neither
  does navigating between `/cellar`, `/wines`, `/beer`… — a book does not
  animate when you put your thumb in a different section.
- **Unknowns do not animate and do not shimmer.** An em dash appears instantly
  and stays. A skeleton would say "in flight"; a dash says "unknown"; on this
  page the market-price column is *permanently* unknown, so it must never look
  like it is loading.
- **A register that appears or disappears does not animate.** Since 2026-09-03
  the parent draws only the registers this house carries, so the set changes
  when the house changes its answer in Settings. That change is a fact about the
  business, not an event on screen: the card is there on the next paint or it is
  not. Animating it would make a correction look like a transaction.
- **The "add the menu or the items" ask never interrupts.** It is a persistent
  inline notice with no entrance motion and no modal — deliberately, per the
  menu research's premortem M1 (an interrupting warning becomes noise inside a
  month and gets clicked through unread, which is precisely how the legacy
  "Reorder" alert on this page died). `NeedsItemsNotice` carries a
  `variant: 'inline' | 'interrupt'` prop so the founder can raise its weight
  without it ever becoming a dialog.
- **The soft-drinks register has no motion at all.** It is a static statement
  that no column in the schema separates a cola from a kombucha. Motion there
  would suggest work in progress on screen when there is none.
- **Reduced motion**: `.cl-stand`, `.cl-ink`, `.cl-register` and `.cl-bottle`
  drop their transitions in CSS; `cl-leaf-turn` collapses to its end state
  through `animate()`'s reduced-motion branch; `Tally` sets the final figure
  directly without a frame loop; `HoldToApprove` becomes a two-step confirm.

## Third pass, 2026-09-03 — the registers that are not wines

**No new tokens, and no new motion.** The six non-wine registers gained a full
register surface (search, six sifts, ten sortable columns, a reading stand
carrying the house's own record) and every motion on it is one already in the
table above:

| where | id | token |
|---|---|---|
| `CatalogueRegister` opening a bottle's record above the table | `cl-stand-settle` | `settle` |
| its contents changing when another bottle is chosen | `cl-leaf-turn` | `turn` |
| `CocktailRegister` opening a cocktail's leaf and its recipe | `cl-stand-settle` | `settle` |
| every row, sift, mark, field and button on both | `cl-ink` | `ink` |

That the richest surface on the page added zero motions is the ration working,
not an omission.

### New deliberate non-motions

- **The record strip does not animate.** Five marks per row, one per book that
  names the bottle. They are ink on paper and they appear with the row. A mark
  that faded in would read as a fact arriving; it is a fact that was already
  there.
- **Nothing tallies in a register.** `Tally` stays on the parent's cards and
  tiles. A register row's "paid" and "sold" are figures of record about one
  bottle, and counting up to £618.40 in front of the reader makes a ledger
  entry look like a live meter.
- **Retiring a cocktail does not carry the seal, and does not animate.** It is
  the only destructive act on the page, and the house ceremony is rationed to
  one act — the hold that sends a real purchase order to a vendor. So this is
  the same die pressed dry: the button becomes "Take it off — confirm" in place,
  on `cl-ink`, and reverts on blur. No wax, no wind-up, no dialog.
- **The disabled "Count into the cellar" control never pulses, shakes or
  explains itself on hover.** It is disabled because OD-113 is undecided, and
  the reason sits beside it in permanent text. Motion there would suggest the
  button is *waiting* for something the reader could do.
- **A loose match is marked in words, not in colour or movement.** "matched
  loosely" under the row name, and the full sentence on the stand. A warning
  tint would make a weaker join look like an error, which it is not.

---

## Fourth pass, 2026-09-03 — the columns, the gestures, and the live path

### Motions added: one

| id | token | curve / ms | fires |
|---|---|---|---|
| `cl-live-ink` | `ink` | house micro curve, 160ms | a row of the wine register whose stock a live socket event just moved. Background steps to `--seal-tint` and back. **Nothing translates**, so a row that changes under the reader's eye never pushes the rows below it. |

`cl-stand-settle` is reused, unchanged, by the expanded row (the record fades in
on `settle` when a row opens) and by the series panel; `cl-leaf-turn` still
fires when a *different* row is opened while one is already open.

### The measured latency, in two halves — and why it is reported in two halves

A page that calls itself realtime and does not say what it timed is claiming,
not reporting. Neither half below is a guess.

| leg | what was measured | how | result |
|---|---|---|---|
| transport | browser ⇄ the real gateway on `:4000`, socket.io namespace `/ws` | 12 `ping` → `heartbeat` round trips over a real websocket with a minted session, 2026-09-03 | connect **17 ms**; `subscribe:restaurant` ack **1 ms**; RTT **min 0.49 ms · p50 0.81 ms · p95 1.79 ms** |
| apply | the event landing in the tab → the frame that showed it | 18 dispatches through `useCellarLive`, timed from `performance.now()` at receipt to a `requestAnimationFrame` callback after the React commit | **min 3 ms · p50 5 ms · p95 6 ms** |

Two honest limits on those figures, stated rather than buried:

1. The transport leg is **localhost**. It is the real gateway, the real
   namespace and a real socket, but it is not a real network, and the founder
   should read it as "the gateway adds ~1 ms", not "a phone in the dining room
   sees 1 ms".
2. The apply leg is **jsdom**, so the `requestAnimationFrame` callback follows
   the React commit but there is no compositor behind it. It is the work this
   page does, not the pixel.

What is NOT measured, and cannot be from here: the *end to end* leg, because
nothing emits `stock:updated` without the RabbitMQ bridge
(`common/orchestrator/rabbitmq-bridge.service.ts:333`), which is not running
against this worktree. That number is a gap, and it is filed as one.

### What actually changed, and why the old path felt slow

The socket was already delivering the new figure —
`WebsocketGateway.emitStockUpdate` sends `stock_before` and `stock_after`
(`websocket.gateway.ts:358-367`) — and the browser was throwing it away:
`useInventory` answers the event by INVALIDATING the query
(`hooks/queries/useInventoryQueries.ts:59-65`), so the row only moved after a
whole extra HTTP round trip. The socket was saving the polling interval and
nothing else. `useCellarLive` now writes the carried figure into the cached row
on arrival and lets the read reconcile behind a row that is already correct.

### New deliberate non-motions

- **The expanded row does not slide the rows below it.** It is a real table row
  appearing, and the browser reflows. A height animation on a row that contains
  seven cards is a compositor stall on every open, and the founder's own praise
  of `/inventory`'s dropdown was about what it *shows*, not how it arrives.
- **The column menu does not animate in.** It is a menu; it must be under the
  pointer on the frame it opens, and 160 ms of fade is 160 ms of a menu that is
  there but not yet legible.
- **The series graph does not draw itself.** A stroke that animates from left to
  right implies the data is arriving over time. It arrived in one read.
- **A withheld card does not pulse or shimmer.** It is hatched and static. It is
  not loading; there is nothing coming.
- **A live row flashes once and stops.** No repeat, no glow, no badge that
  persists. The figure changed; the reader has been told; the page goes quiet
  again — which is the same rule `/notifications` follows when an item is
  handled.
