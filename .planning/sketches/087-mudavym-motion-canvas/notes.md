# 087 — Motion canvas

One surface dedicated to movement. Founder brief, 2026-08-27: *"create one canvas only
dedicated to motion, at least 50 different motion ideas or total of many motions to
explore."* **62 motions**, live, replayable, in five families.

## Families

| Prefix | Family | n | Covers |
|---|---|---|---|
| `ent` | Entrances & reveals | 12 | Staggered arrivals, skeleton→content, scroll reveal, empty→first row, FLIP into a grid, a late async row slotting into a sorted list without shoving, dense table painting by column, thumbnail resolving |
| `st` | State & feedback | 12 | Toggles, ticks, presses, **hold-to-approve landing the wax seal**, the undo window draining, a confirm that retreats, success as a rule under a total, an error that shows its working, optimistic actions where one confirms and one comes back |
| `num` | Numbers & data | 12 | Count-ups, odometers, delta flips, a figure correcting downward after a discrepancy, sparklines, bars, a stock level crossing par, gauges, cost drift showing its working, and an **em-dash unknown that never animates as a number** |
| `nav` | Navigation & structure | 12 | The `settle` row expand (0fr→1fr, chevron on the same token), show-the-working, tab indicator travel, the vendor drawer, modals, route change, accordion, condensing chrome, filtering where rows *leave* rather than repaint, sort where rows travel, shared-element master→detail, command palette |
| `srf` | Product surfaces | 14 | The founder's own list: media display, order bars, comms, mail, team, invitations |

The `srf` set is the one the founder named directly: invoice opening full-bleed, a
document page turning, a scan resolving from capture to a read document; a purchase
order advancing through its states, ordered-against-landed, order lines rebalancing
when one is short; the vendor thread opening and waiting; **the AI draft stopping at
the human** — the never-auto-send guardrail expressed as motion, not as a label;
an inbox row triaging itself, an attachment detaching into a record; a shift dropping
into a slot, a call-out opening a gap and a cover closing it; an invite code becoming
a person, and a pending invite expiring.

## How it works

- **Skin toggle.** Branded (Warm Charcoal ground + İznik seal + Fraunces) ↔ neutral
  greys, so movement can be judged with the brand argued for it and without. Every
  part is authored against a fixed variable set (`--m-bg`, `--m-accent`, …) and holds
  **no hard-coded colour**, which is what makes the toggle reach inside every demo.
- **Speed** from 0.2× to 2×, so a 240ms spring can actually be watched.
- **Family filter**, per-card **Replay**, hover-to-replay, and **Play all**.
- Every demo states its own curve — real spring numbers sampled into CSS `linear()`,
  or a named cubic-bezier with its duration.
- Reduced motion collapses every demo to its end state.

## Build

Five agents wrote five fragments against a shared contract
(`scratchpad/CONTRACT.md`): scoped class prefixes, variables-only colour, and a
`window.MUDAVYM_MOTIONS.push({id, name, family, purpose, spec, html, play})`
registration. `scratchpad/build_motion_canvas.py` concatenates them into the host
and checks the contract (fragment-only, no stray hex). The pipeline was proven with a
throwaway probe before the parts existed — registration, render, replay and the skin
toggle were all verified reaching inside a part.

## Declared honestly

- **62 motions registered, 62 cards rendered, 0 empty stages, 0 console errors** —
  measured in the assembled page, not assumed.
- The Browser pane stopped compositing frames partway through the check (five agents
  had been contending for it all session), so the **Entrances** family was seen
  rendered in full and the rest were verified through the DOM and computed styles
  rather than watched. Per-frame playback of every demo is therefore *asserted from
  parameters and structure, not filmed.*
- Each agent verified its own set in isolation before assembly. The **Entrances** set
  went further than the rest: blocked out of the shared pane entirely (the tab cap was
  held by siblings), it drove real headless Chrome over CDP instead — frame captures at
  t=0/320/600/1000/1600/2500 in both skins, and a genuine `prefers-reduced-motion`
  reload confirming every demo lands within 180ms. The **Numbers** set separately
  proved teardown is clean: ten rapid replays of its live demo leave exactly one
  interval running, zero after kill.
- **`color-mix()` has no fallback** — 45 uses across `ent`, `st`, `num` and `srf`.
  It has shipped in Chrome, Safari and Firefox since 2023, so this is a real gap only
  for genuinely old browsers. Left deliberately unpatched: writing 45 fallback
  declarations into a sketch is the gold-plating the "keep it as simple as possible"
  rule exists to prevent. If any of this motion is promoted into the product, that
  is the moment to add them — not before.
- **A process mistake worth recording, and its consequence.** The canvas was first
  assembled, published and committed the moment the five part files *existed* — but
  three agents were still working, and kept revising. The published build was
  therefore stale, and shipped without: the State set's replay fix (`st-04/05/06`
  stranded on a stale closure and only animated correctly on first play), the
  Product-surfaces `box-sizing` fix (all fourteen of its demos overflowed their cards
  by 22px), and its drag fix (a shift grabbed mid-flight jumped, because the drag read
  the block's target rather than its live matrix). All three are present in the
  rebuild. The assembly step also deleted an agent's test harness mid-verification;
  it recreated it and lost nothing.
  **The rule this earns:** the parts directory is agent-owned until every agent has
  *reported* — file existence is not completion, and neither is a harness being
  cleaned up (one agent deleted its harness and then worked for another thirty
  minutes). Assemble on the last completion notification, nothing earlier.
- One host-level defect found in the rebuild and fixed: the widest demo measured 303px
  inside a 278px stage and was clipping silently. The grid's minimum column went
  304px → 332px rather than editing an agent's part. Re-measured after: **62 cards,
  zero overflowing stages, no horizontal page scroll, no console errors.**


---

## Wave 2 — 55 motions derived from the codebase (2026-08-27)

Founder brief: *"analyze codebase and do it for all functionalities and possible
improvements."* Five agents each took a domain, read the real source and the page
notes' §1a Features / §9 Gaps, then built. **Every wave-2 motion carries a `source`** —
a `path:line` or the page note it answers — rendered on its card.

| Prefix | Family | n | Domain read |
|---|---|---|---|
| `prc` | Procurement & money | 11 | `Orders.tsx`, `useDraftEmailQueries.ts`, credits, documents, vendor-intel |
| `inv` | Inventory & receiving | 11 | inventory command tree, `doorOutbox.ts`, `spotCountOutbox.ts`, `sync-manager.ts` |
| `itl` | Intelligence & reporting | 11 | `Reports.tsx`, `Recommendations.tsx`, `InsightCatalog.tsx`, `notificationStack.ts`, `LogsTimelinePage.tsx` |
| `acc` | Access, team & setup | 11 | auth pages, `GetStarted.tsx`, team command tree, `Settings.tsx`, guidance |
| `sys` | System states | 11 | `useOnlineStatus`, the eight optimistic-mutation hooks, the empty/error/loading triplet, `uxSignals.ts` |

Ratio across the wave: roughly two thirds cover behaviour that ships, one third answer
a documented gap.

### Defects found in the codebase along the way — verified independently

These came out of the analysis rather than the design, and are worth acting on
regardless of which direction wins.

1. **Every stock event rewrites the row you are reading.**
   `apps/web/src/lib/websocket.tsx:489-491` blanket-invalidates the whole `inventory`,
   `dashboard` *and* `wines` query trees on every `stock:updated`. One bottle moving
   anywhere refetches and re-renders a row a manager is mid-way through reading.
   Motion answering it: `sys-08` holds the read row behind a rail with a `new: 34`
   badge and applies it on release.

2. **A dropped door receipt is indistinguishable from a delivered one.**
   `lib/doorOutbox.ts:113-118` gives up after 8 attempts or a permanent 4xx — a
   deliberate, well-argued decision ("a queue that never drains stops being watched")
   that *does* report the outcome as `{sent, failed}`. But `watchDoorOutbox:137-139`
   discards the result and `pages/receiving/DoorReceipt.tsx:70-71` only re-reads
   `pendingDoorCount`, so a discarded receipt and a successful send both simply
   decrement the badge. `lib/spotCountOutbox.ts:110-115` has the same shape.
   **The fix is small: surface `failed`.** Motion: `inv-09`.

3. **A docstring asserts a wiring that does not exist.**
   `hooks/useUxOverrides.ts:12` says *"Mounted once in DashboardLayout"*; the hook has
   **zero importers**, and 11 `data-ux-key` markers sit waiting for a reporter that
   never runs. The comment makes the gap invisible to the next reader. Motion:
   `sys-11` and `acc-11` render consent that cannot complete because nothing receives it.

4. **The insight catalogue headlines a flattering number.** Confirms OD-33 —
   `itl-07` counts 375 *down* to the 144 actually reachable while the track grows to
   the true 573.

5. **`collapseStackedNotifications` returns `foldedById`, and `Notifications.tsx:231`
   throws it away** — the "2 earlier duplicates grouped" string the library already
   writes is rendered only by the header bell. Motion: `itl-09`.

*(1, 2 and 3 were re-verified in the repository by hand, not taken on an agent's word;
one agent's count of 15 `data-ux-key` markers was wrong — it is 11.)*

### A build defect of mine, and the guard it earned

The assembly script's "fragment only" check did `if "<title" in body: re.sub(r"</?title[^>]*>", ...)`.
In `sys.html` that matched `for (var i=0;i<title.length;i++)`, and because `[^>]*`
crosses newlines it deleted every character up to the next `>` in the file — silently
corrupting a part's JavaScript in the built page. The check now matches only real
document tags and **refuses to build** rather than repairing anything: a blocked build
is recoverable, a silently mangled one is not. The id counter was also over-counting
(it matched `id:` inside demo data); it now counts only ids carrying the part's own
prefix.

**Assembled and verified:** 117 registered, 117 rendered, 0 duplicate ids, 55 sourced,
0 empty stages, 0 overflowing, 0 console errors, 0 non-ASCII characters in the built
page. Assembly ran only after all five agents reported — the rule earned last round.


---

## Wave 3 — signature ceremonies + the Shortlist (2026-08-29)

Founder review of the 117: nineteen motions marked as *"the direction where they're
going"* — **inv-02/04/08/11, prc-02/07/09, srf-03/08/13, nav-05/08, num-07/08/10/11,
st-04/09, ent-08** — plus two explicit asks: **signature motions**, above all *"when
it's approved, we show our logo as a stamp"*, and **one swipe-up-to-accept like
Robinhood** so the sketch can be read. Research of real products was required, not
optional.

**16 signature ceremonies** (`sig-01`–`sig-16`), family "Signature moments", built by
three agents plus the hero. Canvas now **133 motions in eleven families**.

### The find that unifies the brand

The Mudavym wordmark is already **a double rule and a full stop** — and in bookkeeping
a double rule under a figure means *the account is ruled off*: grand total, procedure
ended. A single rule is only a subtotal. Every ceremony descends from that one fact:

- `sig-02` presses that figure into wax as an Ottoman **mühür** — a seal pressed to
  *approve* documents. You only ever see what the die left, so the die must leave.
- `sig-03` is **the same die pressed dry** — a blind emboss — because fourteen bulk
  approvals must not land fourteen seals. Ceremony is rationed or it is worthless.
- `sig-06` draws the same two rules under the day, with no wax at all.
- `sig-09` re-aims the convention as **a claim of provability**: a null unit price
  leaves an em dash that never moves while everything around it does, the subtotal's
  rule stays *dashed*, and the landed total gets **no second stroke at all** until the
  price is read off the stored photo.

### `sig-01` — the hero, and how it answers both asks at once

150px of real thumb travel with progressive resistance `p(1 − 0.22p)`, committing at
68%. The ghost seal fades up *during* the drag so you see what you are about to commit
to; release early and it states what did not happen (*"Released at 42% — nothing
sent."*); on commit the wax lands on the stamp spring (500/26) with the M and double
rule pressed in as **shadow, not more wax**, so it reads as a die striking rather than
a sticker. It is really draggable, not a playback.

### Two builders disagreed, on the record

`sig-a` **refused** Robinhood's swipe on principle: on `/orders` a swipe is the same
gesture as scrolling the list it sits in. That is a fair objection, and `sig-01`
answers it the way Robinhood itself does — a dedicated grabbable pill with
`touch-action:none`, not a swipe on the row. Both can stand (**swipe the pill on a
phone, press the die on the desktop list**) but the founder should settle it before
this is built on.

### Research: what was borrowed, and what was refused

Borrowed — Ottoman *mühür* (approval, not decoration); letterpress craft from
Smashing's 2012 piece, so every mark is drawn twice at 0.8px offset because the effect
belongs to the paper; Duolingo's once-a-day streak rationing; Shazam's widening-search
narrative; Apple Photos' merge-rather-than-pick arbitration; Superhuman's
undo-over-confirmation (a real 10s window on `useCancelScheduledSend`); Figma's swap
heuristic *inverted*, so a template fills what it knows and refuses to invent the rest.

Refused, with the reason recorded in each `purpose` — Stripe/GitHub/Cobe's arc swarm
(*"we are global" is a marketing claim; a kitchen only cares who can reach it*), so
`sig-13` inverts the globe: **the restaurant is not a pin on the sphere, it is the
point the sphere turns toward**, territory law is the front hemisphere, and a vendor
that cannot reach you stays dark as it passes and ticks the *"4 can't reach you"*
counter the page already computes. Also refused: confetti for a settled credit (money
leaving a kitchen is not a win), and Wise's progressive disclosure for receipt maths —
an operator checking a short-ship needs the working as primary content, not folded.

### The Shortlist

`shortlist.html` — a second view over **the same parts**, so a motion can never drift
between the two surfaces. Hero at the top, then the sixteen ceremonies, then the
nineteen marked motions grouped by **the moment they belong to** rather than by
technique: *Committing to money* · *Stock, and the truth about it* · *Numbers that
refuse to flatter* · *Structure and arrival*.

### Verified

Canvas **133 registered / 133 rendered**; Shortlist **35 cards, 0 empty stages, 0
overflowing, no page scroll, no console errors, 0 non-ASCII** in either build.
Assembled only after all five agents reported.

Defects the agents found and fixed in their own work, worth knowing because they
recur: a stale-closure bug that made `sig-07`'s actions dead after the first play (the
same trap `st-04/05/06` hit); a demo auto-hold that restarted a hold the founder had
begun by hand (0/1 completions before the fix, 1/1 after); penny drift from rounding
three figures independently; and an honesty bug where $28 was written off but never
left Outstanding — caught by conserving Outstanding + Recovered + written-off at
exactly $1,204 across 219 sampled frames.

**Not verified:** real touch hardware and haptics; paint cost on a low-battery phone
(asserted from compositor-only properties, not profiled); the globe's animation-frame
cost alongside 132 sibling motions; and any browser other than Chrome.

| 087 | mudavym-motion-canvas | 133 motions on one surface &#8212; 55 codebase-derived, 16 signature ceremonies built on the wordmark's double rule, plus a curated Shortlist of the founder's picks | null | motion, canvas, signature, seal, swipe-to-approve, shortlist, codebase-derived, od-106 |

---

## Wave 4 — the founder's canvas ports (2026-08-30)

The founder uploaded his own Claude Design canvas (`.planning/Mudavym Motion
Canvas.dc.html`, 85 demos, 2026-08-29) and said it holds *some* of the motions he
really liked — so the canvas is curation (ADR 0044 §4). Its twelve **"unafraid"**
signatures, which existed nowhere in 087, are ported faithfully as `sig-17`–`sig-28`
(part `sig-d`), each `source`-stamped `founder canvas 2026-08-29 · "<name>"` plus the
repo code the moment maps to: The house knows you · The day seals itself · Mise en
place · Scrub the day · The ticket rises · The receipt tears · The room dims · The
case splits · Money has weight · The proof grows · The shift tide · The sign turns.

Canvas now **145 motions**; shortlist **47** (hero + 28 ceremonies + the 19 marks).
Verified: 47/47 cards, 0 empty, 0 overflow, 0 console errors; ports checked in
headless Chrome with real frame timing (`--virtual-time-budget` freezes WAAPI — a
useful discovery for future verification). Declared by the port agent: the two
pointer gestures (sig-20 scrub, sig-25 hold) were verified by code inspection, not
synthetic input.

Best two ports of the founder's intent, per the agent: **The day seals itself**
(sig-18 — the night's POs fold into one line and the stamp lands, grounded in the
insight scheduler's real-but-invisible daily sweep) and **Money has weight** (sig-25 —
$1,860 presses 4px deep against $212's 1.5px on the same `approveOrder` POST).

| 087 wave 4 | parts: sig-d | canvas 145 · shortlist 47 |


## The founder's curation, committed 2026-09-06

`founder-curation.dc.html` is the founder's own Claude Design export of this canvas (136 demos in ten families — Signatures: the unafraid set · Openings · Closings · Entrances & reveals · State & feedback · Numbers & data · Navigation & structure · Product surfaces · System states · Small acts). It was referenced as the curation since 2026-08-30 but never tracked; it is the record now. Parts stay the source for `index.html`; this file is a view the founder edited, not a build input.
