---
sketch: 112
name: vendor-prices-directions
question: "ADR 0144 §3 made /vendor-prices the price register with identity as a drawer. What does that register look like — and which of the six open sub-questions (F04) does each shape answer for you?"
winner: null
tags: [vendor-prices, price-register, mudavym, directions, ladder, desk, paper-trail, identity-drawer, currency, comparison-class, adr-0144, adr-0117, adr-0124, adr-0126, sketch-only]
---

# Sketch 112 · /vendor-prices — three directions

## Design question

ADR 0144 §3 (locked 2026-09-12) says what the page **is**: *the price register — pick a bottle,
see every vendor's observed price side by side with source provenance and 7/30/90-day trend
chips, record a manually observed price; the identity decisions log is a panel opened from a
row, not a co-equal tab.* It does not say what the register looks like, and fork F04
(`scratchpad/census/forks.md:209-260`) lists six sub-questions no record answers. One further
rule is drawn in every direction here as settled: **a vendor-intel identity row records the
deciding house; the decider's name and Undo appear only inside that house; other houses see the
outcome without the name.** It was decided by the founder on **2026-09-17**, in the brief that
commissioned this sketch — not on 2026-09-12 with ADR 0144. **No record in `.planning/decisions/`
carries it yet** (`grep -ri 'deciding house' .planning/decisions/` finds nothing on
`feat/mudavym-finish`); the ADR row is pending, so read it as *decided and drawn, not yet
recorded* — the drawings would not change if it were recorded, and they would have to if it were
reversed.

The three directions are three different ideas of what a price register is, not three skins:

| | A · The Ladder | B · The Desk | C · The Paper Trail |
|---|---|---|---|
| The register is… | one comparison table for one bottle | the house's own price list, opened into lanes | the papers themselves, in time order |
| Enters on… | a library search + "newest below the earlier mean" (drops only) | the list of bottles the house has been priced on | a search over every beverage identity |
| The figure it leads with | a consensus **per class** (quoted / public), never across | **last landed** (receipt-verified) beside the lowest admitted quote, per lane | **no consensus at all** — the last landed rule on a chart, and the points |
| Identity drawer opens from | a row (the sighting sheet, drawer beneath) | the bottle head (one sheet for the bottle) | a margin note beside every paper |

## How to view

```
open .planning/sketches/112-vendor-prices-directions/direction-a.html
open .planning/sketches/112-vendor-prices-directions/direction-b.html
open .planning/sketches/112-vendor-prices-directions/direction-c.html
```

Each file renders from `file://`, no server. Section 1 is the page at desktop width for a
USD house (Harbor & Vine, Brooklyn), a **manager** signed in (Ayşe Demir — the drawers and log
lines name her role, so the undo/confirm rules read unambiguously); in A, section **1b** is the
same page with **staff** signed in (Marco Ortiz), drawn in full; section 2 the same register for a TRY house (Meyhane
Kalamış, Kadıköy) with one row quoted in EUR, which is where currency stops being a
formatting question; section 3 the overlays drawn open (sheet · panel · popover, ADR 0112, at
the product's numbers — sheet `width:100%; max-width:440px`, panel `top:10vh`, `min(620px,
100% − 32px)`, radius 14, popover width 320 / radius 14, `sheet.css:107-153`, `Sheet.tsx:282`);
section 4 the states (empty ×2, loading, refused, error + partial); section 5 the same markup
in a 390 px container **plus the two overlays at phone shape** — the sheet full-width, the
record panel as a bottom-anchored sheet with a grabber and detents (sketch 103). Screenshots
in `shots/` — `direction-{a,b,c}-1440.png` whole, and the 390 renders in 4000 px chunks,
`direction-{a,b,c}-390-p1.png` … (see the render check). Endpoint and file citations sit in
the grey `sk-note` captions **outside** the product frames; nothing inside a frame is a sketch
annotation, so the founder can read every sentence in a frame as proposed copy.

**Fonts.** The sketch loads Fraunces, DM Sans and JetBrains Mono from Google Fonts so it
renders standalone. What the product does today: `index.html` carries the sans and the mono,
and `vp-format.ts:20-33` (`ensureFraunces`) injects **one Google Fonts link** for Fraunces at
runtime — it does not self-host the face. Whether the product should self-host is not settled
by that file, and this sketch does not decide it.

**Example data, not a tenant** — every vendor, price, person and date is invented for the
drawing. The one Skurnik receipt R-1187, PO-2291 and Q-77120 are props.

---

## Direction A — The Ladder (`direction-a.html`)

**Idea.** The literal reading of 0144 §3. One table, bottle-first. Every sighting is a rung;
its **comparison class is a badge on the row**, and consensus, outlier tests and ranking run
only **within a class** — so "Quoted to this house $30.20" and "Public pages $40.49" are two
figures that never average, drawn as two cards above one table with a dashed rule between the
class groups. Admitted rows are ranked by per-750 within their class, struck rows last. The
seal sits on the **true lowest admitted quote — $28.50, Empire's rep, "on 3 cases"** — with
its condition printed on the same line, and the sentence beside it says *lowest quoted,
before terms* and names the lowest **written** quote ($29.80, Winebow, min 12 btl, Thursday
cutoff) so the seal cannot pretend to be a "best price" badge (DESIGN-FOUNDATION §6,
`/vendor-prices` row: refuse best-price badges — they ignore minimums, delivery days and
relationship). A number with a condition is still a number; the page prints the condition.

What is drawn: the masthead's standing line from `identity/status` + `price-index/status` +
`shop-sweep/status` (never "0 prices" alone); the picker with its scope stated in words
(*wine library, 14,203 bottles; beer and spirits are not here yet*); **"Newest below the earlier
mean"** (`below-average`) rendered **before** a bottle is picked, titled for what the route
returns — it ranks only products whose newest sighting is **below** the mean of the earlier
ones (`price-below-average.ts:245-260`; the route summary at `vendor-intel.controller.ts:106`),
so the box lists **drops only** and its footer names every skip bucket the engine has
(`BelowAverageSkips`, `:182-192`): *3 listed · 25 not below · 11 fewer than 5 earlier · 1 in two
currencies · 1 could not be put per 750 = 41*. Tempier is named among the "not below" —
its newest admitted row is Empire's feed at $31.90, above its earlier mean of $30.30 — and the
rule is printed as the engine holds it: `minObservations` counts the **earlier** sightings, so
"at least 5 earlier sightings", not "5 of 7". The chips are a different rule (a window's
consensus against the prior window's) and the box says so; both need 5. Every figure is derived
from the drawn rows and the working is an HTML comment beside it (the seven sightings in the
30-day window, the earlier mean, the prior-window consensus behind −3.1%); the bottle head as
the ADR 0124 identity key with its markers; 7/30/90 chips where the 7-day chip **refuses**
("not enough — 2 of 5 sightings": 13 Sep and 15 Sep); the class card titled **"To this house —
own paper and quotes"** with the sentence *own paper sits inside this class*, because the engine
files a verified invoice under `quoted` (`price-below-average.ts:90-97`) and a badge reading
"quoted" on an e-Fatura is a mislabel without that sentence; **four** source types agree — rep
message, quote, invoice, feed — and the card says the blend caps that at three
(`vendor-price-consensus.ts:349`: `min(1, 4/3)`); the ladder head that says *8 rows · the latest
row per vendor and source · the chips count every sighting (19 in 90 days)*; the ladder with
per-row currency, source + tier, class badge, as-quoted with pack, per-750, seen, terms with
their provenance (`vendor-terms`: *stated by the house* / *inferred from 14 receipts, 0.82* /
*unknown*), and **B's "landed" badge grafted onto the Skurnik rung** so the founder sees the
combined label on one row; an outlier row kept and struck with its MAD reason at readable
contrast; an **unrecognised `source_type` (`posted_wholesale`) rendered verbatim** in a class of
its own, compared with nothing; the engine's `notes[]` as a first-class "How this was
calculated" register with the confidence formula printed so 0.88 cannot read as a probability;
the posted-list/index register **separate and dashed** (ADR 0126); the identity decisions card
(three decisions: the Winebow line, 13 Sep 14:04, two minutes after the quote was recorded; the
GTIN link by another house; the Skurnik receipt line, 4 Sep, the first naming); and, opened
from the Winebow rung, the sighting sheet with **the identity decisions on this row** beneath
it, a pending candidate included — and its Paper row reading **"No paper attached"**, because
a hand-recorded quote carries no document today and the record panel is drawn with an
*optional, empty* Paper field rather than a link the flow never created.

**Section 1b — the staff page, drawn.** The critique was right that A's staff answer (fork 4,
option a) was claimed and never shown. It now is: the same page with Marco Ortiz (staff) signed
in. The standing line says what is withheld and why; the picker is the same; where the chips,
class figures and ladder stood there is **one sentence** (*The ladder and its figures are owner
and manager*) with the server's `403 · Forbidden resource` kept verbatim; the bottle head keeps
**"the decision and its log"** — the link staff arrive by, from `/cellar` or a document — and
below it the identity decisions card (Undo replaced by *undo is owner and manager*) and a
**Waiting for a person** card with this bottle's one proposal and the house's 14 waiting lines,
each with *Decide ›*. Recording a price is not drawn for staff because the route is owner/manager
(`vendor-intel.controller.ts:133-140`, class guard `:38`).

**Optimises for:** the founder's one question in 0144 §3 answered on one screen, and the
smallest distance from the built engine — `ladderRows`, `currenciesOf`, `legendFor` in the
unmerged `vp-ladder.ts` shape this table.

**Costs to build.**
- Existing: `GET /vendor-intel/compare` (`vendor-intel.controller.ts:49`; the `observations[]`
  array is already on the wire, `vendor-comparison.service.ts:569-583`, and the web type drops it,
  `vendorIntel.ts:46-61`); `GET /vendor-intel/below-average` (`:103`); `GET /vendor-intel/identity/status`
  (`:364`), `/candidates/decide` (`:489`), `/decisions/undo` (`:533`);
  `GET /vendor-terms` (`vendor-terms.controller.ts:44`); `GET /providers/:id/usual-currency`
  (`providers.controller.ts:298`); `GET /price-index/:state` (`price-index.controller.ts:288`);
  `GET /commodity-index/me` (`commodity.controller.ts:104`); `GET /wines`
  (`wines.controller.ts:41`), `GET /wines/:wineId/similar` (`:82`).
- Missing — **four reads or fields**, counting the drawer A draws:
  1. the **compare response extension** — per sighting `id`, `currency`, `trust_tier`, the stored
     `is_outlier/outlier_reason/outlier_basis`, `identity_id`, `provider_id`, own-paper-or-market,
     plus `capped/complete` and per-window sample counts (DIGEST missing #1);
  2. **`POST /vendor-intel/observations` gaining a `currency` field** (today it stamps USD,
     `vendor-comparison.service.ts:363`);
  3. **`GET /vendor-intel/identity/decisions?identityId=`** — the sheet's drawer and 1b's card
     are *decisions on this bottle*; the route exists and is staff-readable
     (`vendor-intel.controller.ts:572-586`, `@Roles("owner","manager","staff")`) but takes only
     `limit`, and the service filters by house only (`identity.service.ts:933-966`:
     `restaurant_id.is.null,restaurant_id.eq.<house>`); DIGEST missing #2. The same read serves
     the staff page, so 1b costs nothing beyond this item and the next;
  4. **`identity/candidates` by identity** — the drawer's pending line; today the route takes only
     `limit` (`vendor-intel.controller.ts:460-481`, `identity.pending(restaurantId, capped)`).
  The within-class consensus is a one-line change in the engine: run `vendorPriceConsensus` per
  `comparisonClass` (`price-below-average.ts:80-100` already draws the line) instead of once.
  The **landed/agreed badge is free**: `own-paper-sighting.ts:57-70` writes `receipt_verified` →
  `invoice`/tier 1 and `order_confirmed` → `quote`/tier 2, and `source_ref` carries the source
  word (`:350`), so the badge is a prefix test on a field the compare extension already returns.
- **Not in A's base, costed under the recommendation:** the line-level document link (fork 6,
  option a). Own-paper rows carry only `raw.orderId` and `source_ref "<source>:<orderId>"`
  (`own-paper-sighting.ts:350-404`) — no document id, no line id — and a hand-recorded row has
  no document at all. A's base therefore links **the order and its receipt row** for own paper
  and prints **"No paper attached"** for hand-recorded rows; the record panel's Paper field is
  drawn empty and optional.
- Client: the four unmerged modules on `feat/mudavym-new-pages`
  (`apps/web/src/pages/vendor-prices/next/{vp-format,vp-ladder,vp-provenance,useVendorPricesNextData}.ts`)
  carry the formatting, the join, the legend cut and the provenance sentences; `SOURCE_META`
  there names a real writer per source, which is what the rung's tier label reads from.

**Honesty traps handled** (dossier numbering): 1 currency — a hand-typed price takes the
vendor's usual currency where stated, else the field is required; a bottle in two currencies
draws one ladder per currency and no figure across (section 2). 2 unknown source — printed
verbatim, own class, "listed, not hidden". 3 pack — the panel cannot submit an unstated unit.
4 legend — there is no legend; the rows are the legend, and the working names the counts.
5 confidence — the blend is printed as a sentence and a formula, never a bare percent.
6 refusal — the staff state names the reason and keeps the server's own sentence. 7 vendor
free text — the panel writes a provider row, never a string. Added: a conditional quote is the
lowest number *and* carries its condition on the seal line — never the number alone; a
hand-recorded row with no paper **says so** on its sheet instead of linking a paper the flow
never created; a rise is **counted, never listed**, in the below-average box, because the route
cannot return one; own paper is named as sitting inside the "quoted" class so the badge cannot
mislabel an invoice.

## Direction B — The Desk (`direction-b.html`)

**Idea.** The register is not one bottle, it is **what the house pays** — so the page opens on
the house's own price list: every bottle that has been priced *to this house* (fork 3, option
c), with last landed, movement and count per row, filterable by *moved this week · two
currencies · never on own paper*; the list scrolls inside the desk, all 41 in it. The chosen
bottle opens on the right in **three lanes by comparison class** — Own paper · Quoted to this
house · Public pages (fork 1, option b) — each with its own figure and its own rule, a dashed
hairline between them, and the sentence *"no figure is drawn across lanes"*. The lane badges
say what is in the lane in words (*invoices · orders* / *quotes · feeds · messages* /
*shelves*); the ADR 0117 class letters live in their tooltips, because class A appears in two
lanes and a letter on the badge said less than the words. Own-paper rungs wear **landed**
(receipt verified) or **agreed** (order confirmed, dashed) — the only ADR 0054 behaviour that
is built (`own-paper-sighting.ts` writes `receipt_verified:` / `order_confirmed:` refs;
`vp-provenance.ts` `orderIdOf` reads them) and nothing else from that Proposed record is
assumed. The quoted lane's seal is on **$28.50, Empire's rep, "on 3 cases"** — ranked within
the lane, struck last — and its rule says the seal marks the lowest admitted number, not the
best deal, and names the lowest written quote and its minimum.

Two minimums, each stated once and never borrowed: the **list's** movement is the desk's own
rule, **two-way** (newest admitted quote vs the mean of the earlier admitted quotes in 30 days,
**at least 5**, the same rule the "Moved this week" popover prints) — it is *not*
`below-average`, which returns drops only, and it is part of the new aggregate costed below;
Tempier prints **+5.3%** ($31.90 against a $30.30 mean, n 6 admitted of 7 — the working is an
HTML comment), which agrees with "Before you order" (5.6% above last landed) instead of
contradicting it; the popover's counts reconcile with the filters (*passed 3 · skipped 38 =
24 no sighting within 7 days + 13 fewer than 5 + 1 two currencies*, and "Two currencies 1" is
Vietti); a **rung's** trend is **per vendor** (fork 5, option b) — a vendor
against its own previous row, so a vendor with one row prints "no previous to compare".
"Before you order" is a sentence over *newest admitted quote vs last landed*, both per 750,
nothing converted.

**Optimises for:** the buyer's question rather than the analyst's — *what am I paying, what
moved, what would I pay instead, and what does it cost me in minimums* — and the coupling
0144 §4 names: `/promotions` reads this register for landed cost, and the desk's left list is
that read made visible.

**Costs to build.**
- Missing — **five reads or fields**, plus one change to another page and one new client
  function:
  1–2. the compare extension and the `currency` field, as A;
  3. a **"bottles with sightings" list** for this house — last landed per 750, lowest quote,
     movement, currency count — which no endpoint returns (`below-average` gives movement only
     for bottles that passed its rule; `GET /vendor-intel/observations`, the vendorBook route the
     unmerged hook cites, is per vendor). That is the DIGEST's
     `GET /vendor-intel/register/bottles?q=` with a different shape: an aggregate per identity over
     the whole register, not a search;
  4–5. **decisions by identity** and **candidates by identity** — the sheet opened from the
     bottle head draws the bottle's decisions and its waiting queue, which need the same two
     identity-keyed reads as A's drawer.
  - The staff refusal sends staff to *"the identity log, in the cellar"* — **a change to
    `/cellar`** (a place for the log there) that no record costs; it is B's answer to fork 4 and
    it is not free.
  - **A first price on a near-empty register.** B's picker is the house's sighted bottles only
    (fork 3c), so the desk's empty state would have nowhere to record a first price against.
    The Record panel's bottle field is therefore drawn as *the desk's list first, then the wine
    library* (`GET /wines`, `wines.controller.ts:41`, built) — client work, no new read, but
    it is the state B actually opens on in production and it was uncosted before.
  - **The phone fold.** At 390 the list folds to the chosen row plus "Show all 41 ›" so the
    lanes start on the first screen instead of after ~1,700 px of list; picking from the
    unfolded list folds it again. Client-only.
  - **"Before you order" is a new function, not `beforeYouOrder()`.** The real function
    (`vp-ladder.ts:120-139` on `origin/feat/mudavym-new-pages`) compares the newest admitted
    sighting with the **pooled consensus** — a figure this desk never draws. B's sentence
    compares with **last landed**; the desk drawing prints that rule and says so.
- The lanes need no new consensus — each lane is a filter over `observations[]` — but the
  seal on "lowest before terms" needs `vendor-terms` joined per provider id, which needs the
  provider row on the row (`provider_id: null` on every hand-typed row today; it rides in the
  compare extension). Per-vendor trend is client-side from the extended `observations[]`.
- Document link (fork 6, option c): the own-paper rung links to the **receipt row**, which
  exists (`/receipts`), so no new join.

**Honesty traps handled:** 1 currency — the house's reporting currency as a **stated,
confirmable default** (fork 2, option b; the Turkish panel shows it changed to EUR and the row
recording *"currency confirmed by Deniz A."*); a second currency splits the lane and the list
row prints no trend. 2 — the posted list is in no lane, with the sentence saying why. 3, 6, 7
as A. 5 — no confidence figure exists on this page at all. Added: *agreed is not paid* (hollow
badge, "the receipt will say what landed"); *received is not verified invoice cost* (the
receipts strip says "landed" is the check, not the delivery); *never on own paper* printed
where a lesser page would print $0 or the lowest quote; a conditional quote wears its
condition on the seal line.

**What it costs the reader:** three lanes are three empties on a bottle with one row, and the
page is owner/manager only with the identity log sent to the cellar (fork 4, option b) — a
staff member has nothing here.

## Direction C — The Paper Trail (`direction-c.html`)

**Idea.** §6's exponential idea for this page, taken literally: *provenance clickable through
to the source sentence*. A price is a line on a paper, so the register **is the papers**,
newest first: the receipt line with its neighbours and the bottle's line highlighted; the
quote line the same way; the rep's message **as pasted, in quotation**; the public page's
captured sentence with its anchor and parse confidence; the told-to-us row struck, with
*"No paper. Nothing to open."* Every entry links to the **document line** (fork 6, option a)
and carries the identity decision as a **margin note** — the decider's name and Undo when
this house decided, "decided by another house — outcome shared, the person is not" when it
did not (the public register's decisions included). Above the trail, a strip chart of the same
points against a dashed **last landed** rule; agreed orders hollow, public pages hollow, the
struck row as a cross — **17 marks, one per paper on the trail, and the popover's counts are
counts of marks drawn**: 3 landed, 1 agreed, 11 quoted admitted, 1 public, 1 struck; the
filters say the same (own paper 4 · quoted 12, the struck one among them · public 1). There
is **no consensus figure anywhere**, and **the seal is on no figure and no mark** — quoted
points are filled circles in ink, told apart by shape; the seal is kept for links, the
highlighted line and Confirm. The chips print the admitted quoted-class change with **both
counts** (*6 quoted vs 3 in the prior 30*) and **no minimum** (fork 5, option c) — but a change
needs a base, so the 7-day chip, with two points and nothing admitted in the prior seven,
prints *no base · read the points* instead of a percentage.

**What a proposal is.** The scope line says nothing is pooled with a library bottle until a
person confirms the link, and the drawing keeps that: a page or a line the assistant has only
*proposed* (Wine.com's capture at title-match 0.95; a Skurnik 6-pack line at 0.81) sits in a
**"Waiting to be named" band** under the trail — on no chart, in no chip, in no count — with
*Confirm › · It is something else ›* and the margin saying *nobody has decided* (ADR 0113: the
assistant proposes, a person decides). The picker searches **every beverage identity** (fork 3,
option b), provisional ones included, which is what makes a Turkish house's rakı and beer
reachable. On the phone the chart keeps one scale (900 px for the 900 viewBox, so axis text
stays 11 px), scrolls sideways and **opens on today** — the last thirty days are the first
screen; paper excerpts stay at 11 px and scroll inside their card.

**Optimises for:** a figure that can always be opened to what produced it, and the page never
making a claim the paper did not — the strongest possible reading of the honesty rules, and
the one no competitor can copy because none holds the papers.

**Costs to build.** The most of the three — **eight reads, fields or variants:**
1. the compare extension (as A);
2. **`GET /vendor-intel/compare?identityId=`** (DIGEST missing #3 — today keys on `master_wine_id` /
   `signature_hash`, `vendor-comparison.service.ts:177-193`);
3. a **beverage identity search** (missing #4);
4–5. **decisions by identity** (missing #2 — the log filters by house only,
   `identity.service.ts:933-966`) and **candidates by identity** for the margin notes and the
   waiting band;
6. **a line-level document link, which does not exist — and it is more than a join.** Own-paper
   rows carry only `raw.orderId` and `source_ref "<source>:<orderId>"`
   (`own-paper-sighting.ts:350-404`), no document id and no line id; `CanonicalDocumentPage.tsx`
   carries no `master_wine_id` (adversary verdict, DIGEST). So the inline excerpts need
   **(a)** a `document_id` + line reference on the observation, **(b)** both own-paper writers
   changed to record it — receipt verification and order confirmation — and **(c)** an
   **attach-a-paper step** in Record a price (a document upload plus `document_id` on
   `POST /vendor-intel/observations`), since a hand-recorded quote has no document otherwise.
   C's sheet is drawn for a quote that *was* attached ("the quote attached as a PDF and parsed
   to 6 lines"), the panel says which sources ask for a paper, and a row with none says *No
   paper. Nothing to open.*;
7. **currency required with no default** on the writer (fork 2, option a) — the smallest change
   to `POST /vendor-intel/observations` and the largest to the person: every hand-typed price asks;
8. **a staff-readable compare variant with the figures withheld** — `compare` is owner/manager
   today, and C's staff state lists the papers with *$ withheld* and the identity margin live;
   that read does not exist and the drawing does not pretend it does.
- The chart is client-side over `observations[]` once extended; the "14 lines waiting" count is
  `identity/candidates` with `complete` (`vendor-intel.controller.ts:477-481`).

**Honesty traps handled:** 1 — required, no default, the button waits. 3, 6, 7 as A.
5 — no confidence figure. 4 — the legend counts marks drawn, and the count equals the trail.
**Not drawn (a gap in C, said plainly):** trap 2, an unrecognised `source_type`; it would print
its raw value in the entry's eyebrow and fall in no filter, but no such entry is on the trail.
Added: *generated text is not evidence* — a proposed name is a band, not a row on the trail;
the rep's number is never shown without the words around it, and the entry says *a number
with a condition is not a price*; *a change with no base is refused, not rounded*; *a draft is
not sent* and *promised credit is not recovered money* do not arise on this page and are not
claimed. Staff see the trail with **figures withheld** and the identity margin live — a fourth
answer to fork 4 that none of F04's three options names, costed above.

---

## The founder questions each direction embodies

| Fork (F04) | A · Ladder | B · Desk | C · Trail | Forks' own recommendation |
|---|---|---|---|---|
| 1 · Pooled or by class | **(a)** class badge per row, consensus within a class | **(b)** separate lanes, no cross-class figure | pooled *drawing*, no pooled *figure* — a variant of (c) with the number removed | (a) |
| 2 · Currency of a hand-typed price | **(c)** vendor's usual where stated, else required; one ladder per currency | **(b)** house reporting currency as a confirmable default | **(a)** required, no default | (c) |
| 3 · "Pick a bottle" | **(a)** wine library, stated on the page | **(c)** only the house's own sighted bottles | **(b)** every beverage identity (new endpoint) | (a) |
| 4 · Staff and the identity log | **(a)** drawn in 1b: the ladder and figures refused in one sentence, the decisions card and the waiting queue live, reached from the bottle head | **(c)+(b)** owner/manager only; the log lives in the cellar (a `/cellar` change) | **new:** the trail with figures withheld, identity margin live (a staff read) | (a) |
| 5 · Trend chips | **(a)** product consensus per class, **N = 5** on the chips and on the below-average box alike (earlier sightings, there), count printed, refuses below | **(b)** per vendor on a rung (a previous row or no trend); the list's rule N = 5 | **(c)** no minimum, both counts printed, chart beside it; refused only when there is no base | (a), N = 5 |
| 6 · Which document links in | **(b)** one link per paper — the order and its receipt for own paper; "No paper attached" for a hand-recorded row unless the attach step is built | **(c)** the receipts row | **(a)** the canonical document line, which needs two writer changes and an attach step | (a) |

Three further questions the drawings raise, which no fork lists:

- **May the seal mark "lowest before terms" at all?** §6 refuses best-price badges. A and B
  give the seal to the **lowest admitted quote with its condition on the same line** ($28.50
  "on 3 cases"; ₺620 "on 6 koli") and name the lowest *written* quote beside it; **C gives it
  to no figure and no mark** — only to links, the highlighted line and Confirm. If the answer
  is no, A and B lose one accent and nothing else; a second option is a rule that excludes
  conditional quotes from the seal, which the drawings do not take because it hides the
  cheapest number a rep actually offered.
- **Is "landed vs agreed" a label this page may print while ADR 0054 is Proposed?** B and C
  print it from `own-paper-sighting.ts`'s built `receipt_verified:` / `order_confirmed:` refs
  only. If that is too much, the badge collapses to "invoice" / "confirmed order" — the source
  words — with no loss of rows.
- **Does the system get a price-movement colour pair?** `mudavym.css` defines none, nothing in
  `apps/web/src` uses one, and DESIGN-FOUNDATION chose the seal free of ok/warn/alert hues. All
  three drawings therefore print movement as **a sign and a word in ink** (*−3.1% down*), and
  "required" and "struck" are a word and a stronger rule, not a hue. If the founder wants a
  rise/fall pair it is a new token pair and a decision, not a sketch's call.

## Recommendation

**Build A as the spine, with B's landed/agreed badge on own-paper rungs (free), and take C's
line-level link with the inline excerpt as a second step, not part of the first build.** The
previous draft of this recommendation called the line link "a column joined onto a row the page
already holds" and broke the A-versus-B tie on it; that was understated, and the honest count
below no longer ties. Reasons, in order of weight:

1. **A is what 0144 §3 says, and it is what the unmerged code already shapes.** `vp-ladder.ts`
   (`ladderRows`, `currenciesOf`, `legendFor`) and `vp-provenance.ts` (`provenanceOf`, with a
   `link`/`unlinked` sentence per source kind) are A's table and A's sheet. The honest counts:
   - **A's base needs four** reads or fields (compare extension, currency on the writer,
     decisions by identity, candidates by identity) — and the staff page (1b) and the landed
     badge ride on those for nothing.
   - **The graft is not one join.** It needs a `document_id` + line reference on the
     observation, **two writer changes** (receipt verification and order confirmation,
     `own-paper-sighting.ts:350-404` carries only `raw.orderId`), and an **attach-a-paper step**
     in Record a price (an upload plus `document_id` on `POST /vendor-intel/observations`) —
     otherwise a hand-recorded quote can never have the link the sheet would show. Call it three
     items: A-with-graft is **seven**.
   - **B needs five** (the four above, minus the drawer's two but plus the sighted-bottles
     aggregate and the same two identity reads), **plus** a change to `/cellar`, a new client
     function for "Before you order", and a library search inside the record panel for a first
     price (`GET /wines`, built — client work).
   - **C needs eight**, three of them new surfaces (identity-keyed compare, identity search, a
     staff-readable compare with figures withheld).
   So on count, **A's base (4) is the cheapest by a clear margin, and A-with-graft (7) is dearer
   than B (5 + three client/page changes).** The count therefore says: ship A's base with fork 6
   at (b) — the order and its receipt row for own paper, "No paper attached" for hand-recorded
   rows — and make the line link a costed second step. What still separates A from B at equal
   cost is *what* the extra work is: B's fifth read is a new aggregate over the whole register
   and its refusal path changes another page; A's second step is confined to the two writers
   and one panel, and every row it does not reach already says so honestly.
2. **The register is near-empty in production** — inherited from ADR 0117's measurement, not
   re-measured here — and the three directions degrade very differently. A's empty state is one
   honest sentence and a "newest below the earlier mean" box that says what it scanned. B's is a blank list beside
   three empty lanes. C's is an empty chart above an empty trail. The founder's verdict was
   *"more functional"* over an empty page; the direction that is still a page when it is empty
   wins that brief.
3. **B and C each answer a different question well, and both questions have another home.**
   B's list is `/promotions`' comparison basis made visible (0144 §4 couples them) — it should
   return as A's below-average strip grown into a two-way list, once the sighted-bottles read exists. C's
   chart is the right shape for the `/notifications` market box (`MarketPricePanel`), where
   movement is the point; on the register the papers matter more than the curve, which is why
   C's best part — the excerpt and the line link — is the graft, not the page. C's **waiting
   band** is worth keeping in mind for A too: A's drawer lists a pending candidate as a row of
   the log; C's band keeps it off every count. If the founder prefers C's stricter reading, A's
   drawer should adopt it.
4. **On the forks, A's set is the recommended set** (1a · 2c · 3a · 4a · 5a with N = 5),
   with fork 6 at **(b)** in the first build and moving to **(a)** only when the second step —
   the two writer changes and the attach step — is built and costed on its own.

What this recommendation does **not** settle: fork 2 is a founder call that changes the
writer (`POST /vendor-intel/observations`) either way; whether the seal may sit on "lowest
before terms" is a §6 question the founder has not answered; the movement colour pair is open;
and whether the second step (fork 6a) is worth its two writer changes is the founder's call, not
the sketch's — the drawings show what the page says with and without it.

## Motion, all from `lib/mudavym/motion.ts`

`settle` (320 ms, house curve) for the working's expand and the row/rung hover state;
`ink` (160 ms) for chips, filter buttons and the class badge fills; `tuck` (300 ms) for the
sheet and the bottom sheet's detents; `turn` (420 ms) for "How this was calculated" and C's
"Turn the page"; `tally` (840 ms, overdamped) for the class figures and the chips when a
window changes — never on first paint, never from an em dash. `stamp` is reserved: it fires
only when an identity is confirmed (the one append-only, sealed act here), never on recording
a price, which is a plain submit. `prefers-reduced-motion` renders every transition at its end
state; the sketch does this with one media query, the product with `animate()`'s reduced path.

## Shortcuts taken, said plainly

- The overlays are drawn open, not wired; nothing in these files calls anything. The phone
  bottom sheet is drawn at its upper detent (88 %) with the lower detent marked; no drag.
- Only the **charcoal ground** is captured (ADR 0138 D1). The dossier asks for both grounds;
  paper appears only where a paper excerpt is a sheet by decision (ADR 0104 D9), and captions
  on it use `--ink-4` (OD-112 / F18).
- Every count and sentence in the standing lines is invented; the endpoints they cite are
  real, the numbers are not. C's chart coordinates are computed from its own invented dates
  and prices (the formula is a comment in the SVG) so every mark is a paper the trail lists.
- C's trap-2 row is not drawn (see above).
- The `-390-p*.png` chunks render the **whole sketch file** at a 390 viewport, so the
  sketch's own wrapper padding narrows the section-1 product frame to ~314 px; section 5's
  phones inside the `-1440.png` are the truer 390 rendering.
- A's 1b is drawn at desktop width only; at 390 it stacks by the same container query as
  section 1 (visible in `direction-a-390-p2/p3.png`) and no separate phone frame is drawn for it.
- The identity-house rule is drawn as decided (2026-09-17, founder, in the brief) with no ADR
  row yet — see the design question above.

## Render check, 2026-09-17 (third pass, after the second critique)

`p4-scratch/render-sketch.mjs` at 1440×900 full page, and a chunked renderer
(`scratchpad/render-chunks.mjs`, same Playwright, `clip` in 4000 px pieces) at 390×844 —
Chrome's capture silently corrupts any PNG taller than 16384 px. Measured this pass:

| file | 1440 full height | 390 full height | 390 chunks | console errors | horizontal overflow |
|---|---|---|---|---|---|
| direction-a.html | 11933 px | 22303 px | 6 | 0 | none |
| direction-b.html | 7960 px | 15425 px | 4 | 0 | none |
| direction-c.html | 12504 px | 21571 px | 6 | 0 | none |

Every 1440 shot was cut into 1800 px slices and read; every 390 chunk was read whole. Found and
fixed in this pass, before the numbers above: A's new 1b frame carried an inline
`grid-template-columns` that beat the container query and overflowed at 390 (removed); A's class
badge wrapped onto two lines at phone width (`white-space: nowrap`); B's bottle head still said
"Named 12 Sep" against its own drawer's 4 Sep first naming. Checked and holding: B's per-vendor
sentences now wrap inside their rung and never cross the lane divider; C's "last landed" dash
sample sits clear of its label on both charts and the window brackets sit below the axis labels
("bugün" no longer touches one); C's phone excerpts open on the price column with a shaded left
edge; B's phone list folds to the chosen row.

Second pass (kept for the record) — defects found then and fixed:

- A's seal line: a `<b>` inside an `inline-flex` span became its own flex item and "on 3
  cases" stacked as a column — the sentence is now one flex item and wraps as prose.
- B's desktop list left an empty block above its footnote — the aside is bound to the lanes'
  height (`height:0; min-height:100%`), the list scrolls inside it, and the movement line
  shares the price's grid rows; `.pct` no longer wraps its word.
- C's "last landed" label sat on the late-August marks and was clipped at the phone's left
  edge — it now sits top-right with a dash sample; the TRY chart gained its window labels.
- Section-3 popover frames carried fixed heights that either clipped or left ~200 px of empty
  paper — min-heights and measured padding.
- At 390 every chart, desktop section included, opens scrolled to today; B's receipt-row
  illustration keeps its cells on one line and scrolls.

## Fourth pass, 2026-09-17 — a critique checked against source, not re-applied blind

A design-critic pass (`sketch-critic/112-vendor-prices-directions.json`, 16 findings — 4 major,
12 minor) was handed to this session to apply. Every finding was checked against the file on
disk before touching anything, per CLAUDE.md §5b (verify a claim before acting on it) — and all
16 already match the fix the critic itself proposed. None required a further edit:

- **Major 1** (A's staff view claimed, never drawn): section 1b (`direction-a.html:612-686`) *is*
  drawn — the refusal (`:643-647`), then the identity-decisions card and the waiting queue
  (`:660-683`), reached from the bottle head's "the decision and its log". Rendered and read at
  1440 (`crop-1b.png`, this pass): both cards sit directly under the refused ladder, in reading
  order, full contrast on charcoal.
- **Major 2 & 3** (the below-average box shown as two-way movement; Tempier's sign contradicting
  its own rows): the box is titled "Newest below the earlier mean" (`:433-434`), lists drops
  only, and its footer already names Tempier in the `notBelow` bucket at "$31.90 … above its
  earlier mean of $30.30" (`:440`). B's list prints Tempier `+5.3%` (`direction-b.html:214,305`)
  agreeing with "Before you order"'s "5.6% above" (`:371`) — the two numbers no longer disagree
  because they are two different, both-labelled rules.
- **Major 4** (recommendation's "a column joined onto a row" understating the document-link
  cost): the current recommendation (`README.md:386-434`, this file) already says so in its own
  words — "that was understated, and the honest count below no longer ties" — and counts A's base
  at 4, A-with-graft at 7, B at 5 plus three page/client changes, C at 8.
- **Minors 5–16**: `.pct.none` is `white-space: normal` (`direction-b.html:71`); A's class card
  reads "Four source types agree … the blend caps that at three" (`direction-a.html:467`); the
  class label is "To this house — own paper and quotes" with the own-paper sentence in the body
  (`:465`); C's Line-2 decision is dated 13 Sep 14:04, two minutes *after* the 14:02 recording,
  not before (`direction-c.html:521`); C's popover says "16 marks drawn of the 17 papers …
  Public pages is hidden" (`:563`); its tick fill is `var(--ink-2)`, commented "the tick is ink,
  not seal" (`:275-277`); both charts' "last landed" labels sit clear of the marks and the 7-day
  bracket sits under the axis labels (verified visually this pass, `crop-chart1.png` /
  `crop-chart2.png`); the phone excerpt for the Skurnik 6-pack line opens pre-scrolled
  (`scrollLeft:91`) with `186.00` on screen (verified visually, `crop-excerpt.png`); A's
  `.vp-btn` already carries `white-space: nowrap` (`direction-a.html:78`); B's Record-a-price
  bottle field falls back to a wine-library search when the bottle is not on the desk
  (`direction-b.html:455,463`); B's phone list folds to the chosen row plus "Show all 41"
  (`:514,519`); every endpoint/file citation lives in a `.sk-note` outside the `.mudavym` frames,
  none inside product copy; every frame reads "manager signed in (Ayşe Demir)", never "owner";
  and this file's identity-house-rule paragraph (above, "Design question") already carries the
  2026-09-17 date and "no ADR row yet" caveat the critic asked for.

Read against `stat`, the critic JSON (`sketch-critic/...json`, mtime 13:01:39) postdates these
three files (mtime 08:30–08:38) by over four hours with no edit in between — so its 16 findings
describe a state this third pass had already fixed, not a regression. Nothing in the files
changed in this pass; the verification itself — line citations plus two rendered crops — is the
record, so the next session does not have to re-derive it. No ADR-0149 conflict found on this
page: no theme toggle, no `WineAgentFab`, no `/sommelier` reference, no support-address string —
none of those rows apply to a vendor-prices register.

## Every claim is cited

Endpoints and lines are as read on `feat/mudavym-finish` and, for the four unmerged modules,
`origin/feat/mudavym-new-pages` on 2026-09-16 and re-checked 2026-09-17 (`beforeYouOrder`
at `vp-ladder.ts:120-139`, `ensureFraunces` at `vp-format.ts:20-33`, `decisions()` at
`identity.service.ts:933-966`, `identityCandidates` at `vendor-intel.controller.ts:460-481`,
`identityDecisions` at `:572-586` (staff-readable, `limit` only), the class guard at `:38`,
`identity/status` under it at `:361-364`, `recordObservation` at `:133-140`, `below-average`
at `:103-131` (`minObservations` clamped 2–50, default 3; the summary at `:106` says "below
the mean of the earlier sightings"), `priceBelowAverage` at `price-below-average.ts:245-260`
with `BelowAverageSkips` at `:182-192` (`noProductKey · unnormalisable · thinHistory ·
mixedCurrency · notBelow · unrecognisedClass`) and outliers excluded by the caller (`:29`),
`distinctSources` at `vendor-price-consensus.ts:349`, the own-paper writer's `source_ref` and
`raw.orderId` at `own-paper-sighting.ts:350-404` with its source map at `:57-70`,
`wines.controller.ts:41/:82`, `sheet.css:107-153`, `Sheet.tsx:282`); forks from
`scratchpad/census/forks.md` F03, F04, F16; the missing-endpoint list from
`p4-scratch/wave/DIGEST.md` §vendor-prices with its adversary verdicts; the founder's words
from `MAKEOVER-VERDICTS.md:134-137` (*KEEP+ / more functional*) and ADR 0144 §3. Nothing here
is imported by the app.
