---
sketch: 113
name: promotions-directions
question: "What is the striking number on /promotions measured against, and what shape lets a buyer act on it in seconds?"
winner: null
tags: [promotions, offers, price-register, landed-cost, vendors, provenance, roles, adr-0144, adr-0054, adr-0124]
---

# Sketch 113 · /promotions — three directions for the money page

## Design question

ADR 0144 §4 settled the job: `/promotions` is **the money page** — an offer is shown
against what the house actually pays, so the page says *"12% under your last landed
cost, on a bottle you bought 40 of last quarter"* instead of relaying the vendor's
claim. Dismissal becomes a house-wide act. Leading with senders was rejected.

What it did not settle is F05's four sub-questions
(`scratchpad/census/forks.md:258-291`, DIGEST `promotions` "Open forks"):

1. **What the headline number is measured against** — last landed cost, best price
   from another vendor, or both; and what is printed when only an agreed
   (`order_confirmed`) price exists (ADR 0054 rule 6: agreed is not landed).
2. **What happens to Trusted senders and Prospects** — secondary sections below the
   offers, or moved to `/communications`.
3. **Who may see graded offers**, which now reveal what the house paid — owner and
   manager only (ADR 0124:356-360), any member, or members see offers with prices and
   verdicts withheld from staff.
4. **The window and count behind "you bought N"** — calendar quarter, trailing 90
   days, or trailing N printed; counted from accepted invoice quantity in stated units
   (never `procurement.service.ts:1549`'s `quantity ?? 1`).

Each direction below is a genuinely different page, and each takes a different
answer to those four forks on purpose, so the founder is choosing a *shape and a
policy together*, not three skins of one layout.

## The fact that settles most of fork 1 before the founder reaches it

The only grader that exists is `offer-grade.ts` on `feat/mudavym-new-pages`. Its
`offeredFrom()` (`offer-grade.ts:238-277`) works the offered price out by applying
the mail's discount to **this vendor's own last price to the house** — `baseline` is
`mostRecent(fromVendor)` (`:303-307`) — and its `derivation` string says so:
*"12% off 14.20 per bottle, this vendor's last price to you"*. The offer itself
carries only `percent`, `amount`, `currency` and `freeShipping` (`:64-69`; the
`discount_value` record is `{percent, amount}` at `promotions.service.ts:167-171`).
There is no stated price on the wire anywhere.

So **"against landed" always equals the vendor's claim.** −12.0% is the mail's "12%
off"; −6.4% is $20 off $312; −10.0% is the mail's 10%. A percentage taken off the
house's own price comes back out as that percentage, and if the vendor's list is
above what the house pays, the real discount is *smaller* than the claim. Multiplying
that figure by volume — "money on the table" — is the claim multiplied by volume. A
"Beats landed" chip would match every graded line by definition, so it cannot be a
filter, and the first draft's was wrong to draw one.

A price measured against landed cost only carries information when (a) the offer
states an **actual price** rather than a percentage or amount off — a field the
extractor does not write and the grader does not read today — or (b) the house's
last landed price came from a **different vendor** — which is exactly the grader's
`bestElsewhere` (`:332-376`), the lowest other vendor's line in the same unit and
money, and its `deltaPct` and verdict words (`beats · matches · above ·
no_elsewhere`). That comparison is the only figure on the page the mail could not
have told the house. The first draft printed the claim in the biggest type on the
page — which is the relaying ADR 0144 §4 rejects — and painted Fords Gin as a teal
−8.0% win when it costs more than the house pays Winebow. **All three directions are
redrawn on one rule: the big figure is always the comparison with the lowest other
vendor; the vendor's percentage on the house's own price is printed as the claim,
never as the grade; and when no other vendor has charged the house for the bottle
the figure is a word.**

A second consequence: the grader's `no_baseline` case (`:303-313`) — the house buys
the bottle from another vendor but never from the offering vendor — returns only a
`reference` line and *no* offered price, because a percentage off nothing is
nothing. That is the typical case for a stranger or a new vendor pitching a bottle
the house already buys, and each direction now draws it (T. Edward Wines · Tempier
Bandol: *"no price from T. Edward to take 10% from — you pay Skurnik $312.00 a
case"*).

## How to view

```
open .planning/sketches/113-promotions-directions/direction-a.html
open .planning/sketches/113-promotions-directions/direction-b.html
open .planning/sketches/113-promotions-directions/direction-c.html
```

Each file renders from `file://` at 1440 with no server and holds, in order: the
desktop page for a US house (Müdavim Brooklyn, USD, en-US); the same page for a
Turkish house (Sim Meyhane Kadıköy, TRY, tr-TR) — **locale formatting on an English
UI**: currency, number and date formats follow the house's locale, every interface
word stays English, and only the vendors' own words are Turkish; a strip of the
states the page must hold; every overlay it opens, drawn open; and a 390 mobile
rendering. At 390 the desktop sections are cropped out (section 5 is the phone
rendering) and the overlays stack as blocks so nothing is clipped. Screenshots are
in `shots/`.

The ground is Warm Charcoal throughout — the decided `.mudavym` ground (ADR 0138,
`apps/web/src/styles/mudavym.css:45-46`); paper is the declared exception and is not
used here. Fonts load from Google in the sketch, and the product does too today
(`Sheet.tsx:72-81`, `pages/dashboard/next/fonts.ts` both request Fraunces from
`fonts.googleapis.com`); ADR 0149 row 9 commits every page to self-host its faces
before the public-door cutover, so the sketch's Google request will stop matching
production once that lands.

## The forks, as each direction answers them

| Fork | A · The Register | B · The Docket of Worth | C · The Slate |
|---|---|---|---|
| 1 · headline basis | **Verdict against the lowest other vendor** in a column named *Verdict* (never *Against landed*); the claim — the vendor's % on the house's own price — sits in the *Offered* column labelled "the claim"; when there is no other vendor the verdict is a word. One rule for every row, including Fords (+4.2% above Winebow, the claim beneath) | **Same basis for the number** (−4.6% under Winebow at 112px); the claim is a line under it; the worth is `(lowest other − offered) × last quarter's quantity` and is withheld when there is no other vendor | **Best elsewhere**, as before: the matrix makes "elsewhere" the natural read, so the figure inside the offer cell is against the lowest *other* vendor; the claim is the small line in the cell |
| agreed-only prices | Graded only if another vendor's line exists; labelled "agreed, never checked against an invoice"; chip `agreed` in the warn colour | Labelled, and **excluded from the worth** with the reason printed | Dotted underline on the cell; "never landed" in the offer cell |
| 2 · senders and prospects | **Secondary sections below the offers** (F05 2a): a trust ledger whose columns are `sender_reputation`'s own, and Strangers with capture-reason chips; both acts drawn open in 4c | **Moved to /communications** (2b): one "Who is writing" line with counts and a link | Moved to /communications (2b) — the page is prices |
| 3 · who sees the grade | **Any member sees offers; staff see no prices or verdicts** (3c) — the read returns `null` with `reason: "role"`, the withheld slot carries a sentence, nothing priced reaches the browser | **Any member** (3b) — no withheld state at all; the states strip says what that costs against ADR 0124:356-360 | **Owner and manager only** (3a) — the whole page refuses with one sentence, like `/vendor-intel` |
| 4 · "bought N" | **Trailing N, chosen and printed** (4c): a `30 · 90 · 180` selector, default 90, from accepted invoices in the unit each line states | **Last calendar quarter (Apr–Jun), printed** (4a) — ADR 0144's own phrasing | **Trailing 90 days, fixed and printed** (4b) for volume; **540 days printed** for prices (the grader's own `LEDGER_WINDOW_DAYS`) |
| undated offers | Kept as an undated offer, graded, labelled "no end date" | Same, with the question named on the card | **Filed as a price, not an offer** — DESIGN-FOUNDATION.md:453 taken literally: a dashed cell, uncounted, unhighlighted |
| the one striking thing | The verdict column in Fraunces with a *spread rule* under it — three ticks on one line: landed, offered, lowest other | The verdict at 112px on a hero card and **the worth against the other vendor's price at the house's own rate**, labelled an estimate | A cell that moved: the offer highlighted inside the house's whole price picture for that bottle, including a cell in a column where the vendor has never charged the house |

## Direction A — The Register (`direction-a.html`)

**Idea.** The page is the house's price book with the offers written into it. Each
offer is a group row (vendor, offer name, the vendor's claim in italics, the mail it
came from); each bottle it names is a line; the columns are what the house last paid
this vendor, what the claim comes to on that price, the **verdict** against the
lowest other vendor, that vendor's line, how much the house bought over a chosen
window, and when the offer ends. A line expands in place (`settle`) into the working:
what you paid and the row that proves it; what the offered figure is *and is not*;
and the verdict — elsewhere.

**Optimises.** Scanning many offers and many bottles at once; every figure sitting
beside its source; the unit and money of every comparison stated on the row. It reads
like `/cellar` and `/reports`, so a manager who knows the product knows this page.

**Counts.** The standing line and the chips count the same things and say which:
*seven offers from six vendors, naming eight bottle lines* — Skurnik is two offers
(one discount per offer, offer-grade.ts:64-75: the case deal and the Gut Oggau
line are drawn as separate groups), so it is counted once as a vendor and twice
as an offer. The first six chips count lines (2 under another vendor · 1 above ·
3 no other vendor · 1 not from this vendor · 1 never bought = 8); a second row of
chips counts offer-level states (1 not a price · 2 with a code · 1 passed · 2 put
away). The Turkish register: two offers, three lines (1 under Bahçe · 2 no other
vendor, one of those agreed-only).

**Costs to build.**
- `GET /promotions` — **does not exist on main** (DIGEST "Missing endpoints"). The
  unmerged read on `feat/mudavym-new-pages`
  (`apps/api-gateway/src/promotions/promotions.service.ts`, `offer-grade.ts`) carries
  almost everything this direction draws: the verdict word, `baseline`, `offered`
  with its `derivation`, `bestElsewhere`, `deltaPct`, `reference` for `no_baseline`,
  `market`, `skipped[]` with reasons, and the ledger summary with its window. It
  **does not** carry a purchase quantity — "bought 40 · 90 d · 6 invoices" is a new
  aggregate over accepted invoice lines, grouped by unit, over a window the client
  chooses (4c needs the window on the request).
- `POST /promotions/:id/dismiss` and `/restore` — missing on main; ADR 0144 §4 records
  the house-wide act and migration
  `20260911160000_an_offer_dismissed_is_dismissed_for_the_house.sql` — on
  `feat/mudavym-new-pages` only, not on `main` — assumes the column.
- Trusted senders and Strangers reuse today's endpoints
  (`usePromotionsQueries.ts:45,55,97-139`). The ledger's columns are the real ones —
  `trusted, suspended, suspended_reason, injection_signals, spam_signals,
  completed_orders, updated_at` (`sender-reputation.service.ts:180`) — so the state
  cell reads "suspended · updated 30 Aug", never a count of quarantines the row does
  not hold. The refutation's finding stands: those reads return `200 []` on a
  database error (`sender-reputation.service.ts:176-187`,
  `prospects.service.ts:270-283` — both `list()` methods `catch { return []; }`), so
  the honest error state drawn here needs the service to throw.
- The trust toggle and "Add as a vendor" are drawn open in 4c: trust is a hold
  (`HoldToApprove`) writing `sender_reputation.trusted`; add-vendor is a plain create
  from the sender's header fields that trusts nothing.
- "Draft an order from this offer" is `POST /procurement/orders`
  (`procurement.controller.ts:113`), which exists. "Open the mail" is
  `GET /conversations/:id` (`conversations.controller.ts:351`), which exists **but is
  not tenant-scoped** — it must be before the link ships.
- Per-field role withholding needs the page to know the caller's role; `RolesGuard`
  gates whole routes, so the read must return prices, volumes and verdicts as `null`
  with `reason: "role"` for staff — nothing priced reaches the browser, and nothing
  is hidden by CSS.

**Honesty traps it handles.** The claim is never the grade. Never bought is a
verdict word, and its Bought cell is a dash with "no invoice line matched this
name", never a 0. "Cannot be graded" for a vendor who has never charged the house
for the bottle, with the house's reference line printed as a reference, not a
comparison. Agreed is not landed (chip + sentence). Case ≠ bottle and EUR ≠ TRY are
printed as the reason a cell is a dash. The vendor's list price is never the
baseline. Extraction confidence is not shown beside money. "Passed" offers stay
readable for 30 days and are not counted. A read that failed is its own screen,
distinct from a quiet lane (the lane proves it is alive with the time of its last
read at its opaque `r-<token>@` address, `inbound-address.service.ts:9`). Put-away is
house-wide, names who and when, and the undo bar appears only after the server
returns the changed row. A draft is not an order: the panel says nothing is sent and
the seal stays on Orders.

## Direction B — The Docket of Worth (`direction-b.html`)

**Idea.** One card per offer, ranked by what taking it would be worth to this house
against the lowest other vendor it already buys the bottle from. The top offer is a
hero card with the verdict at 112px — *−4.6% under the lowest other vendor you use,
Winebow $13.10* — the claim in a line beneath it, and beside it the worth: *"about
$31 against Winebow's price — if you buy Château de Sours at last quarter's rate (52
bottles, 8 invoices) from Empire at $12.50 instead of Winebow at $13.10."* Fords Gin
is a +4.2% loss card with a negative worth. Offers with no other vendor carry a word
and "worth —"; offers that cannot be graded go to a separate row in the vendor's
words.

**Optimises.** A manager deciding in seconds between the bar and the office. The
number is the page; the working is one sheet away. It is the most striking of the
three, and the one whose number is now defensible.

**Counts.** *Seven offers from six vendors, eight bottle lines*: 2 worth money
against another vendor · 1 costs more than the book · 3 no other vendor · 1 cannot
be graded · 1 never bought; the Winebow condition names no bottle and is not among
the eight. Turkish: two offers, three lines (1 worth money · 2 no other vendor, one
agreed-only).

**Costs to build.** Everything A needs, plus:
- **The worth figure is new arithmetic**: `(bestElsewhere − offered) × quantity in the
  window`, per line, only where `bestElsewhere` exists. It should be computed
  server-side inside `GET /promotions` with its basis on the wire (window, quantity,
  the other vendor's line, which lines were excluded and why), so the page cannot
  invent it and a reader can re-check it. It is still a projection — so it is labelled
  an estimate everywhere, rounded like one (`about ₺2.100`, never `₺2.112,00`),
  withheld when there is no other vendor or the window has no purchases ("worth —"),
  and never counts up on arrival (`tally` is for a figure the page can prove; the
  worth appears at its value).
- A calendar-quarter window needs the quarter boundary on the wire, not in the browser.
- Ranking by worth falls back to ends-soonest when the worth is withheld or the ledger
  is empty, and the rank strip says which.
- Fork 3(b) — any member — needs nothing to build, which is its whole appeal; it also
  contradicts ADR 0124:356-360's lean, so choosing it means an addendum to that ADR.

**Honesty traps it handles.** All of A's, and: the worth is an estimate against
another vendor's price at the house's own rate, not a saving; every exclusion from
the worth prints its reason (Whispering Angel: agreed only and no other vendor; Villa
Antinori: the only other line is EUR); "worth —" when no other vendor exists or the
quarter has no purchases; the Fords card says it is cheaper than this vendor *and*
dearer than the house's book, in the same card, in the loss colour.

## Direction C — The Slate (`direction-c.html`)

**Idea.** One matrix: every bottle an open offer names down the side; every vendor who
has ever charged the house for it across the top. A cell is a price with its date and
source. An offer is a cell that moved — highlighted, with the offered price over the
struck landed one and the delta against the lowest *other* vendor in the row. The
lowest other cell carries a ring; agreed-only cells carry a dotted underline; a cell in
another unit or money says so instead of a number. An offer from a vendor who has
never charged the house for the bottle is a highlighted cell in an otherwise empty
column reading "cannot be graded". An undated offer is **filed as a price** — a dashed,
unhighlighted, uncounted cell — because DESIGN-FOUNDATION.md:453 says an offer with no
end date is not an offer. A plain cell opens its line in a popover; an offer cell opens
the offer as a sheet, which carries the claim and the code — the cell itself holds only
the verdict, the figure and one short line (against whom, when it ends); five lines of
reasoning in a 118px column was the cell losing to its own footnotes, fixed in this
revision. "Whole slate" turns the page into the house's full price picture even when
nothing is on offer. Fork 1 is drawn as a choice too (section 1b), on the one bottle
(Miraval) where the three bases actually disagree — it is not on the main slate, so the
comparison is drawn on its own rather than added as a sixth row.

**Optimises.** The buying decision as a comparison — *who should I buy this from now* —
which is what DESIGN-FOUNDATION §6 names as the thing no competitor can do
("12% off list, but 4% above what you paid Vendor B in March"), and the negotiation
posture ADR 0124 gates.

**Counts.** *Four bottles carry four offers from four vendors, drawn as five offer
cells* — Empire's rosé close-out prices two of your bottles (Château de Sours and
Whispering Angel), so it is one offer occupying two cells, not two offers. 1 cell
under the lowest other · 1 above · 2 no other vendor · 1 cannot be graded; one undated
price filed and not counted. Turkish: two bottles carry one offer from one vendor,
drawn as two offer cells (Kavaklıdere's campaign prices both); one undated price filed.

**Costs to build.** The biggest of the three.
- The grader computes **one** `bestElsewhere` and **one** `market` per wine
  (`offer-grade.ts:332-376`); the slate needs **every vendor's last line per bottle**,
  same unit and money, plus the vendor column set. That is a new house-scoped
  cross-vendor read. `GET /providers/intelligence/compare`
  (`provider-intelligence.controller.ts:337`) exists on the subject and is **unscoped**
  (refutation P4) — it cannot be reused as it stands.
- Role gate is a page gate: `RolesGuard` `@Roles("owner","manager")` on the read, as on
  `/vendor-intel` (`vendor-intel.controller.ts:37-38`) — the cheapest of the three
  role answers to build, and the strictest.
- Filing undated offers as prices needs the service to stop reporting them in the
  `undated` state as offers and the page to draw them from the price read instead.
- A sparse slate (a young house, one vendor per bottle) reads as a page of dashes; the
  partial state drawn here says so at the top rather than leaving the reader to infer
  it.
- The matrix does not survive 390px as a matrix; the mobile rendering turns each bottle
  into a card with the vendors as rows, and the popover/sheet become a bottom sheet with
  detents (ADR 0112 F9), same as A and B.
- The offer's code with its copy act, the "with a code" filter and export with its Code
  column are the legacy page's acts (ADR 0112 F4) and are kept here as elsewhere; C had
  drawn none of the three at the census pass, now fixed.

**Honesty traps it handles.** All of A's, and: the market column is context only and
never the verdict; a euro sighting sits in the market column of a lira slate unconverted;
"no other line in cases" is a verdict word in the offer cell; the refusal is a page
with a sentence and no control, never an empty slate; an undated price is not an offer.

## What all three share

- **The standing line speaks only provable facts, and says what it counts** —
  offers and bottle lines are counted separately and named ("seven offers · eight
  bottle lines"; C: "four offers · five offer cells", since one offer can price more
  than one bottle), verdict counts are counts of lines, and every chip total matches
  the rows drawn. Never a saved figure. `GET /providers/promotions/savings` is not
  on any page: it selects columns the table does not have and 500s (refutation P1),
  and nothing writes `savings_realized`.
- **Four states per read**, each with its own words: loading (skeleton at real row
  height), empty-and-listening (with the time of the lane's last read), read failed
  (with the route and the status, and a retry), and role-withheld or refused (a
  sentence, never a blank, never a blur). Partial states are drawn for each
  direction's own weakness: A's ledger-empty, B's no-rate, C's sparse slate.
- **The `no_baseline` row** in each: a vendor who has never charged the house for
  the bottle cannot have a percentage taken off anything; the house's own line from
  the other vendor is printed as a reference.
- **Overlays under ADR 0112**: the offer is a Sheet (440, `tuck`); the row's or card's
  menu is a Popover at the primitive's default 320 (`Sheet.tsx:204`, `ink`); the ask —
  "Draft an order from this offer" — is a Panel (620, `settle`) with `HoldToApprove`
  (`pour`, landing on `stamp`). The seal never sits in a popover. The panel says a
  draft is not an order and nothing is sent.
- **Motion** is the seven tokens of `lib/mudavym/motion.ts`, plus one non-token
  precedent the sketches keep on purpose: the skeleton sheen (1.9 s,
  `cubic-bezier(.45,0,.55,1)`) is the dashboard's `skel-sheen`
  (`dashboard-next.css:44`) and the reports page's `rp-sheen` (`reports MOTIONS.md:38`,
  which names it "not a `motion.ts` token"), kept identical so "in flight" looks the
  same everywhere; recommendations and profile deliberately use none, and the builder
  may choose that instead. Every file collapses to no animation under
  `prefers-reduced-motion`.
- **Two colours the palette has no word for.** The verdict "above" and the state
  "agreed / undated / suspended" need a loss and a warn colour on charcoal. The
  legacy page uses raw Tailwind emerald/red/amber (`Promotions.tsx:478-500`), which has
  no charcoal column. The sketches propose `--loss #D98C7A` and `--warn #D9A15B` as
  `.mudavym` tokens; the builder must add them to `mudavym.css` with a paper pair
  (ADR 0042 ships both grounds) rather than inline them. Text on `--seal-tint` fills
  uses `--ink-4` (`#ABA294`), not `--ink-3`, which measures about 4.1:1 there.
- **Provenance chips are real columns**: `invoice` = `receipt_verified`, `agreed` =
  `order_confirmed` (ADR 0054 rule 6), `mail · date` = `source_conversation_id`.
  Nothing on any page is a joined string standing in for a row.

## Founder questions these embody

1. **Is the verdict against the lowest other vendor the headline, always?** All three
   now say yes, because it is the only figure the mail did not carry
   (`offer-grade.ts:238-277`, `:332-376`). The alternative — landed as the headline
   *only when the mail states an actual price*, with the claimed % printed as the
   claim otherwise — is honest too, but the extractor writes no stated price today
   (`discount_value` is `{percent, amount}`), so it would be a headline for a row that
   cannot yet exist. If the founder wants it, the build adds a `price` key to the
   extraction and a `stated` derivation to the grader first.
2. **Is a projected worth figure allowed on the page at all?** B's whole striking
   quality rests on it. It is now `(lowest other − offered) × quantity`, labelled an
   estimate and withheld without another vendor — but it is still a figure the ledger
   has not confirmed. If the answer is no, B collapses into A with bigger type.
3. **Do senders and strangers stay on this page?** A keeps them as secondary sections
   and gets a security act (trust, a hold) and a vendor-creating act (a plain create)
   on the money page, both drawn in 4c; B and C move them and become single-purpose.
   `/communications` is not yet rebuilt (F05 notes the coupling).
4. **Per-field withholding, any member, or a page gate?** A withholds prices per field
   for staff (a role-aware read returning `null` with a reason); B lets any member see
   the docket and names the ADR 0124 addendum that implies; C refuses the page with one
   guard. All three of F05's options are drawn.
5. **Quarter, fixed 90, or chosen N?** ADR 0144's sentence says "last quarter" (B); the
   dossier proposes 90 (C, fixed); A gives the buyer a printed `30 · 90 · 180`
   selector. All three print the window they use — the fork is which one, not
   whether to say it.
6. **Is an offer with no end date an offer?** DESIGN-FOUNDATION.md:453 says *"an offer
   with no end date is not an offer"*; the unmerged service reports an `undated`
   state and grades it. A and B keep undated offers on the table, labelled; C files
   them as prices. The tension is real and unrecorded — it needs a sentence in the
   ADR either way.
7. **How does fork 1 depend on sketch 112 / F04?** ADR 0144's consequence
   (`0144-*.md:130-132`) couples the two pages: the offer comparison is only as honest
   as the register's landed cost. Two of F04's sub-questions reach into 113 directly:
   F04-1 (quoted vs public-site *class*) decides what `bestElsewhere` may be drawn
   from — the grader already keeps `open_market` sightings as context and never the
   verdict (`offer-grade.ts:360-365`), which is F04's 1(a) applied here, and must stay
   so; and F04-2 (currency of a hand-typed price, stamped USD today at
   `vendor-comparison.service.ts:363`) would poison a lira house's "lowest other" if
   the register does not fix it first. 113 does not propose a `/vendor-prices` shape:
   sketch 112 recommends its ladder (A) for that page and names `/promotions` as the
   register's consumer (`112-vendor-prices-directions/README.md:227-256`).

## Recommendation

**Build A, with the verdict-against-elsewhere rule it now draws, and take B's hero
as its opening for the top offer — as the verdict, never the claim, and without the
worth line until a rule for projected figures exists.**

- The first draft recommended the same graft with B's 112px number, and that number
  was the vendor's own claim. The re-argument is the paragraph above: the grader
  derives the offered price from this vendor's own last price
  (`offer-grade.ts:238-277`), so offered-vs-landed carries nothing the mail did not,
  and printing it at 112px is the relaying ADR 0144 §4 rejects. The only figure that
  survives that test is `deltaPct` against `bestElsewhere` (`:332-376`). Every
  direction is redrawn on it; the recommendation is the same shape with a different
  number in it.
- A is the only direction whose every figure is already on the wire of the unmerged
  read (`promotions.service.ts` + `offer-grade.ts`) plus one aggregate (quantity in
  the window, by unit); B adds a projected figure that ADR 0020 will need a rule for,
  and C adds a cross-vendor read that does not exist and whose only existing neighbour
  is unscoped.
- A answers the four forks in the way the sources lean: the comparison with another
  vendor as the verdict, with the claim and landed printed beneath (ADR 0144 §4 and
  DESIGN-FOUNDATION §6 both name the "4% above what you paid Vendor B" figure as the
  point); a printed, chosen window, counted from accepted invoice lines in stated
  units; members see offers, staff see no prices (ADR 0124's rule applied per field,
  so staff can still see that an offer exists and who it is from); senders and
  strangers stay as secondary sections, which keeps the page's two existing security
  acts where they are and does not couple the build to an unbuilt `/communications`.
- What A lacks is the one thing the founder asked for — *"more striking"*
  (`MAKEOVER-VERDICTS.md:138-139`). B's hero card is that thing, and it is grafted
  and drawn — section 1c: the register's first group opens as B's hero — the
  verdict at 112px (*−4.6% under Winebow*), the claim in the line beneath, the
  register continuing below — with the worth line **omitted** until a rule for
  projected figures exists. The hero rule is stated where it is drawn: the open
  offer whose best graded line has the largest "beats" by `deltaPct`, ties to the
  soonest-ending; when no line beats another vendor the register opens plain and
  says so. That gives one striking figure without a projection and without
  relaying a claim.
- "Beats landed" cannot be a filter or a count anywhere; A's chips count verdicts
  against another vendor, no-other-vendor, not-from-this-vendor and never-bought,
  and say whether they count lines or offers.
- C is not proposed for `/vendor-prices`. Sketch 112 already recommends its ladder for
  that page and treats `/promotions` as the register's consumer; C's slate is the
  right *reference drawing* for what that consumer would look like if the founder
  ever wants the whole price picture on this page, and its filed-price rule for
  undated offers is the one part of C the ADR should take regardless.

## Shortcuts stated

- No endpoint was called; every "exists / missing / unscoped" claim is read from the
  dossier (`p4-scratch/ux/promotions.md`), its refutation
  (`promotions-endpoint-reality-refutation.md`), the DIGEST section, and the unmerged
  branch's source via `git show feat/mudavym-new-pages:…`. The refutation itself did
  not call the gateway.
- The worth figure (B) and the per-vendor matrix (C) are drawn as they *would* look;
  neither is computed by anything on main or on the unmerged branch.
- Turkish formatting follows `Intl` for `tr-TR` (`₺1.245,00`, `−%10,0`,
  `16.09.2026`) but was not rendered through the product's formatter. The Turkish
  sections show locale formatting on an English UI; translation is not drawn.
- The sketches carry no `data-ux-key` attributes; the dossier's §5 signals are a build
  concern, not a drawing concern.
- Dates were checked with `date -j`: 16 September 2026 is a Wednesday, so "through
  Friday" ends 18 September.
- Every `file:line` above was re-checked against the `feat/mudavym-finish` worktree
  (and the unmerged branch, via `git show`) on 2026-09-17.
- **2026-09-17 revision.** A design-critic pass found 15 defects (5 major, 10 minor)
  across the three files and this README; all are fixed — Skurnik's two offers are
  drawn as two offers everywhere and every standing line's counts now match the rows
  drawn (including in this README, which had gone stale against an earlier fix to A
  and B); fork 1 is now drawn as a choice in all three directions, not just prose;
  every phone rendering draws every counted row; the Whispering Angel / Yeni Rakı
  agreed-price contradiction (an "agreed, never invoiced" baseline shown beside
  accepted-invoice counts) is fixed in C, where it still stood; the legacy code +
  copy act, the "with a code" filter and export are drawn in C (A and B already had
  them); the draft-order panel is a plain create in all three, not a `HoldToApprove`,
  and its phone layout stacks one bottle per block instead of scrolling a table off
  the right edge; C's offer cells are cut to a verdict, a figure and one short line,
  with the claim moved into the sheet. One rendering bug turned up in the course of
  this pass and is fixed: B's hero card's three-column "lines" list inherited
  `flex-wrap:wrap` from the non-hero card rule while overriding `flex-direction` to
  `column`, which made the third line's note wrap into a spurious fourth column and
  overlap the next line instead of sitting beneath its own line — `flex-wrap:nowrap`
  now pins it. C's `.st` rule was also missing the `min-width:0` A and B already had,
  which let a nested mini-table force the mobile states grid wider than the viewport;
  fixed. All six screenshots were regenerated and read back after every structural
  change; none overflow horizontally and none banded (tallest is A at 11,078px).
  After the defect fixes, all three directions were also simplified to the founder's
  people-facing style bar (Wave Four / The Arrival / sketch 104C: fewer words, one
  primary act, quiet honesty states, rationale out of the frame) where that did not
  conflict with the honesty-trap provenance the page exists to prove — the deepest,
  most technical layer (the expanded "working" panel in A, the offer sheet in all
  three) was left dense on purpose, since founder question 7's own recommendation
  praises A's register density as reading "like `/cellar` and `/reports`," and
  because the per-line provenance (what was paid, from whom, on what invoice) is the
  page's honesty mechanism, not a verbosity problem the style bar is aimed at.

## Files

- `direction-a.html` — The Register.
- `direction-b.html` — The Docket of Worth.
- `direction-c.html` — The Slate.
- `shots/direction-{a,b,c}-1440.png`, `shots/direction-{a,b,c}-390.png` — full-page
  renders via `p4-scratch/render-sketch.mjs`; zero console errors, no horizontal
  overflow at either width.

**Example data, not a tenant** — Müdavim Brooklyn, Sim Meyhane Kadıköy, their vendors,
figures, senders and dates are invented for the drawing; the repo and product facts are
not. No file under `apps/` was changed by this sketch.
