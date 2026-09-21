---
sketch: 110
name: cellar-directions-2
question: "After 'rework' on the fourth-pass cellar book: structurally, what is the cellar page — the house's own list, an index with one record, or a drawn wall — and how does each stay honest for a whisky bar and an alcohol-free café?"
winner: null
tags: [cellar, wines, beer, whiskey, spirits, cocktails, non-alcoholic, soft-drinks, mudavym, directions, rework, adaptive-name, charcoal, adr-0112, adr-0115, adr-0138, sketch-only]
---

# Sketch 110 · Three directions for the Cellar, second pass

## Design question

The founder on the first rebuild (`MAKEOVER-VERDICTS.md:191-199`): *"I don't like the new
version. It's so much crowded and I don't like the way it looks"* — he liked the old page
*"where we could see everything"* — **"put more character into it."** The fourth-pass
book that followed (registers as cards, a register at full breadth, the `/inventory`
dropdown as the row's record, the floor as a strip, the whole cellar as one table — sketch
095, built in `apps/web/src/pages/cellar/next/`) came back from wave four as **rework**.
Sketch 092 drew the floor and the kind-facet; 095 merged them. Today's ask: sketch again,
and this time each direction has to be a different *idea* of what the page is, not a
third skin on the book.

Decided the same day, in the founder's words: *"when there is no alcohols in a restaurant
then it's already soft-drinks only, and some restaurants do not like non-alcoholic term"*
— so **`/soft-drinks` is the adaptive name of the non-alcoholic register for an
alcohol-free house.** One register, two names, no new classification. Every direction
here draws it that way, and every direction draws the consequence: a house with one
register has no parent above it — the page *is* the register, and it is called Soft drinks.
The ruling has a cost in today's code that the first draft of this README missed: the
product already carries `soft_drinks` as a **seventh register id**, and "one register, two
names" retires it. That is priced under *What each direction costs*, and the fork it opens
is question 10 below.

## The fixed points every direction keeps

- **The h1 is the name the founder already decided.** `houseNaming()`
  (`cellar-format.ts:196-225`, merged with 095): *The Cellar* when wine or spirits are on,
  *The Bar* for beer, cocktails and non-alcoholic only, and — under today's ruling — *Soft
  drinks* for an alcohol-free house where the code today says *Drinks*. Meyhouse, Kadıköy
  Meyhane and The Copper Still are all called The Cellar in all three files. **List,
  Gazetteer and Wall are the names of views**, never of the page; C's Wall is one half of
  its Wall/Ledger switch. The first draft of A and C renamed the page and is corrected.
- **Warm Charcoal is the ground** (ADR 0138, `mudavym.css:45-65`). 092 and 095 were
  drawn on paper before the ground was decided; these are the first cellar sketches on the
  ground the page will actually render on. Captions, notes, tile labels and source labels
  are set in `--ink-4` (6.4–7.4:1 on the three papers); `--ink-3` is kept for rules and
  the leader dots only, because it measures 4.43:1 on a hovered `paper-2` row.
- **"Keep the top info boxes"** — every direction carries five tiles and every tile says
  which table it was counted from and what it deliberately excludes (In the cellar is
  wines only, and says so). A café gets three counted and two dashes; a whisky bar's fifth
  tile is a nought — *0 off the list* — counted and drawn, because a nought is not a dash.
- **The registers are the house's own** (`restaurant_cellar_registers`, infer then confirm)
  and the page draws only those, in the house's own order — one order per house across all
  three files (Meyhouse: Wines · Beer · Spirits · Cocktails · Non-alcoholic).
- **The founder's named record shape** — the `/inventory` dropdown: a fact strip, then
  cards (`RowExpander.tsx`). A stays in place, B makes it the page, C puts it in a sheet.
- **The three overlays of sketch 102**, drawn open in each file: *Carry these bottles*
  (sheet), *Is this the bottle?* (panel), *Photograph the label* (panel). ADR 0112's shapes
  and `sheet.css`'s numbers; the close is a word, never an X. All three exist, unmerged —
  see costs.
- **The seven motion tokens only** (`motion.ts`): `tally` on the tiles — the sketches
  integrate the token's own spring, `springLinear(120, 26)`, the way `motion.ts:56-70`
  does, so the curve is the product's and not an approximation; an em dash never tallies —
  `settle` on the row, `tuck` on the sheet, `pour` then `stamp` on the one hold that spends
  money, `ink` on hover. `prefers-reduced-motion` collapses all of it.
- **Beer, whiskey, spirits, cocktails and non-alcoholic are catalogue-and-list only today.**
  `restaurant_inventory` keys on `master_wine_id`; ADR 0115 is *Proposed*, its migration
  `20260903171000` written and **not applied**. Each direction states this where the
  reader is looking — at the section head (A), in the record's standing line (B), in the
  drawing itself (C) — and never as a column of zeroes. A house whose registers are all
  catalogue-only (the café) has Carry, Photograph and Read a menu **refused with the
  gateway's sentence** in all three files, not offered.
- **The routes stay.** `/wines /beer /whiskey /cocktails /spirits /non-alcoholic
  /soft-drinks` all exist in `App.tsx:322-333`; every direction keeps them as entry points
  into one surface. What changes is what they open *at*.
- **Every headline frame is drawn with the invoice book populated, and says so.**
  `procurement_document_lines` holds 0 rows in the whole database (`wines.md:708`), so at
  ship Paid and Markup are a dash with their reason on every line; the *Partial* state in
  each file is that ship state. On every drawn line the five book marks agree with the
  paid figure: a line with a Paid has its invoice mark lit, a line without has it unlit and
  its record says why the dash is not a nought.

## The three directions

| | A · The List | B · The Gazetteer | C · The Wall |
|---|---|---|---|
| **The page is** | the house's own drinks list, typeset as a guest reads it, with the book's figures in the margin of every line | one index of every title (left) and one bottle's whole record (right); the house itself is the first entry | every bottle drawn as a spine filled to its depth; a register is a shelf; hollow where the cellar cannot count |
| **"See everything"** | literally: one page, every line, in list order | the index: every register in one scroll with running heads | 105 wines are 105 marks on one screen — 96 on the shelf, 9 on the off-list plank |
| **"Not crowded"** | a list line is one line; the ledger speaks in a quieter margin column | one bottle's depth at a time, at full width | a spine carries no text until pointed at |
| **"Character"** | the trade's own form: leaders, section heads, prices leading, Fraunces on the title | the gazetteer: running heads, a dictionary's keyboard rhythm, five books as five named cards | the drawing: a wine wall you can read from across the room |
| **The record opens** | in place, under the line (`settle`) — the founder's named pattern | it *is* the right pane; Space peeks (drawn, §1c), Enter promotes (sketch 103 · 2a) | in a side sheet, 440 (`tuck`) — one object; the Ledger view opens it in place |
| **Child routes** | anchors into sections of one page | groups of one index; `/beer` scrolls and filters | shelves of one wall |
| **One-register house** | one section; the page is called Soft drinks | one running head, no chips, the dash said once at the head; the house record says why | one shelf, every spine hollow, and a sentence saying why |
| **Whisky bar** | the truth at the head of the Whiskey section; six wines are the only lines with a depth bar; pour prices, not glass and bottle; markup refused (a pour over a bottle) | 148 dashes in the index, a whisky's record with two hatched cards and everything real drawn | 148 hollow spines above six filled ones — the gap is the picture |
| **Optimises for** | the owner reading their own list; printing it; the menu as the spine | the operator who knows what they are looking for; keyboard speed; one record with everything | glanceability; the manager walking the floor; stock depth as a shape |
| **Costs** | a list-ordered read (menu section order) or one read per register assembled client-side; the margin is columns that already exist | nothing new server-side: the index is the register reads, the record is `row-record`; a pane layout and keyboard model | nothing new server-side for wines (`stock_live`, `threshold_min`); the drawing; a Wall/Ledger switch |
| **Risk** | reads as "one flat register" if the margin gets loud; Paid is structurally an em dash today | drops the in-place row the founder named; a 332px index on a 13" laptop | decorative if the fills are not trusted; a café's wall is all outlines; hostile on the phone |

### A · The List — `direction-a.html`

The spine is `menu_items` — what the house lists and charges — in the house's own section
order, not the catalogue in alphabetical order. Each line: title in Fraunces, producer and
origin, leaders, the list's prices (named per register: glass and bottle, duble and şişe,
1 oz and 2 oz, each); then a rule, then the margin — a hairline depth bar with the par as
a tick (the foundation's own idea, `DESIGN-FOUNDATION.md:441`), on hand, paid, sold over
the nine days the till has lines for, markup. A line open in place carries the fact strip
and the cards; a beer line open shows Par and Order withheld, hatched, with the reason.
After the registers: *Off the list, in the cellar* (stock with no list line — the list is
written where the menu is; this page reads it) and *Not on any register* (house lines
nothing can hold — Boza, a fermented house line, and Nargile, a till line that is not a
drink — reported, not dropped). Markup is list over last paid and is refused, with its
reason, wherever the paid unit and the list unit are not the same serving: a pour over a
bottle cost (whiskey, gin), a cup over a pack (every non-alcoholic and every café line).
Visible pars fit the tile's figure — six of the thirteen drawn wine lines carry one,
of 11 in 96.

### B · The Gazetteer — `direction-b.html`

Left, 332px: a find field, register chips, then every title under running heads, the
cellar's figure on the right of each line or a dash where it cannot know, and the keyboard
legend at the foot. Right: the record as a page — crumb, title, a standing line that says
how many of the five books name it and what is *not* counted, the acts (Carry more; Hold
to order under par; Count into the cellar refused with the gateway's sentence), the fact
strip, **the five books as five cards** (lit where the book names it, "does not name it"
where it does not), then eight cards: what it costs and makes, live vs shadow, par and
reorder, velocity, when it sells (any hour — lunch drawn), the order ledger, quoted, and
where the facts come from. `/cellar` with nothing chosen is the house's own record.
**§1c draws the peek**: the cursor one line below the open record, Space pressed, a hover
card of Boğazkere beside the index while Öküzgözü stays the record — the non-modal class of
ADR 0112 F8 (no scrim, no trap, never the seal); Enter promotes it. Esc returns to the
house. A one-register house's index carries no per-line dashes: the running head says
*23 · not counted* once.

### C · The Wall — `direction-c.html`

A spine is 5×48 px: fill `seal` to `stock_live / 30`, a 1px `ink-1` tick at
`threshold_min` where the row records one. A counted spine is outlined in `ink-4`, so **a
count of nought is a visible empty outline**; a dashed `ink-3` outline is not counted at
all — the two are never drawn alike, and the legend says so. **The fills reproduce the
figures in the head**: the rows behind a counted shelf are generated to its stated numbers
(96 spines, 1,031 on hand, a par on 11, exactly 3 at or under it, 2 noughts; the off-list
plank's 9 spines carry the other 36, so the cellar holds 1,067) and the page checks the
drawing against the head at mount — a mismatch is a console error, and the render script
reports console errors. Shelves come in the house's order, spines grouped by the house's
own list sections (style is refused as a grouping for beer and whisky: 0 catalogue rows
carry it); a wide shelf wraps its groups into rows and never scrolls, except on the phone
where the frame says so. Cocktails are **not a shelf** — a cocktail is made, not kept —
and sit as a chip strip in the house's order. Pointing at a spine anchors a **hover card**
(ADR 0112 F8; it chooses nothing, so it is not a popover and is drawn at 280, not the
primitive's 320) — above a first-row spine, below a spine on a wrapped row, clamped inside
the rail; Enter opens the record as a side sheet, where the seal sits and nowhere else.
The sheet, the hover card and the phone sheet open **the same record** (Öküzgözü, 18 on
hand against a par of 12, so the hold is refused and says so). The Ledger switch is the
founder's existing table.

## Honesty traps each file draws

- **Missing is not zero** — every unknown is an em dash with its reason in the title; a
  count of nought and a dash are drawn differently (C makes this a rule of the drawing, and
  the whisky bar's *0 off the list* tile makes it a rule of the tiles).
- **Received is not paid** — every cost card: "Received at the door is a count, not a
  cost; Paid is read from the invoice book only." The invoice book holds 0 rows in the
  database today (`wines.md:708`): the headline frames are drawn with it populated and are
  labelled so; the *Partial* state says Paid is a dash on every line and why.
- **A figure is only as precise as its inputs** — markup is refused where the paid unit
  and the list unit differ (a cup over a pack, a pour over a bottle); runway divides by the
  nine days the till has lines for, never by thirty, and the column is labelled *sold ·
  9 d* for the same reason.
- **Promised credit is not recovered money** — the order ledger: "received 11 of 12 · 1
  short, credit asked, not recovered".
- **A draft is not sent; queued is not confirmed** — "received 12 · invoice not read"; no
  order line claims paid because the documents carry a status, never a payment date.
- **Generated text is not evidence** — the tasting note is marked *inferred from grape
  and region, not recorded about this bottle*; the label reader shows a confidence per
  field and names the three fields it did not read at all.
- **A figure opens to its sources** — every card names its table; every record ends with
  "where this bottle's facts come from".
- **A figure without a unit is not a price** — the catalogue's `price_reference` is
  `numeric(10,2)` with no currency column; drawn as `21 no currency`, never as `$21`.
- **A capped read is a floor, not a total** — "500 read (capped)" on the tile, the running
  head and the plank, in the Partial state where it belongs.
- **Absence reported as health, refused** — loading draws only the wine register; blank
  says blank; refused says refused; an unread register leaves the others standing; the
  house's record dark until migration `20260903120000` is words, never a column of noughts.
- **The catalogue's strangers stay behind Carry** — 272 whiskies and 356 spirits this
  house does not list are counted in a sentence, never drawn as the house's.
- **Locale is data** — `Intl` formats every figure: `₺1.450` / `₺612,00` / `2 Eyl 2026`
  against `$58` / `$19.40` / `Sep 2, 2026`; nothing is hand-typed.

## What each direction costs to build

Existing, used by all three: `GET /cellar/:rid/registers` (+`PUT`), `GET
/beverages/:rid/registers/:register` (the five-book house ledger over
`house_beverage_ledger`, migration `20260903120000`), `GET /beverages/:rid/row-record`
(the series), `GET /cocktails/:rid` (+ write), `GET /wines`, `POST /inventory/:rid/items`
(carry), `POST /procurement/orders` (the hold), the `inventory_change` socket
(`useCellarLive`). The record's cards already exist in `RowExpander.tsx`; the column
vocabulary and its measured fills in `cellar-columns.ts`; the naming rule in
`cellar-format.ts:195-290`.

**Two of the three overlays exist and are not on main; the third does not exist anywhere.**
The census (`scratchpad/census/routes-cellar-docs.md`, 2026-09-13) records *Is this the
bottle?* (`IsThisTheBottlePanel.tsx`, `IsThisTheBottle.test.tsx`, `readings.ts`) and the
*Carry these bottles* migration of `MenuScannerModal.tsx` as staged in Codex's page-ports
worktree — 60 overlay files, hashes verified, zero conflicts, and `git ls-tree origin/main`
confirms none of it has landed. Those two are priced against **landing** those files, not
building them. *Photograph the label* is different: the census calls it *target, i.e. not
started* (`routes-cellar-docs.md:58-59, 119-120`), neither overlay manifest names a file for
it, and a grep for "photograph" under that worktree's `pages/cellar/next`,
`components/wines` and `components/scanner` finds one code comment. It is priced below as a
**build**, over the camera surface the house already has (`components/scanner/CameraCapture.tsx`,
already used by `/get-started` and the orders scanner); sketch 102's owed / migrate / target
labels are otherwise history.

- **A** — one new read or one client-side assembly: the list in menu-section order across
  registers (`menu_items` section headers already feed the register inference). The margin
  is the existing spine columns. The in-place record is `RowExpander` unchanged. Print is
  CSS. Cheapest to build on what exists; the section anchors replace `category` routing.
  Landing the two staged overlays, plus building *Photograph the label* over
  `CameraCapture.tsx`.
- **B** — no new endpoint. A two-pane layout, an index built from the register reads, the
  record pane reusing `RowExpander`'s cards at full width, and a keyboard model (peek and
  promote per sketch 103). The house record is `Registers.tsx` re-homed. Medium. Same
  overlay cost as A: two landed, one built.
- **C** — no new endpoint for wines. An SVG shelf renderer (this sketch's `rows()` and
  `spines()` are ~60 lines), a hover card on hover/focus, the record in `Sheet` (the
  primitive exists), and a Wall/Ledger switch that keeps today's table. Grouping by the
  house's list sections needs the section on the wire. Medium, and the phone needs its own
  composition. Same overlay cost as A and B.

**The one change all three need in code — retiring the seventh register.** Today
`soft_drinks` is not a spelling of `non_alcoholic`; it is its own `RegisterId`, and the
ruling "one register, two names, no new classification" retires it. What that touches:

- `apps/web/src/App.tsx:332-333` — two routes mounting **two categories**,
  `CellarNext category="non_alcoholic"` and `category="soft_drinks"`; the second becomes
  the first with the adaptive title.
- `apps/web/src/pages/cellar/next/cellar-format.ts:138-146` (the union), `:154`
  (`REGISTER_ORDER`), `:164` (`REGISTER_TITLE`), `:186` (`REGISTER_ROUTE`) — the id leaves
  the vocabulary; `/soft-drinks` stays a route into `non_alcoholic`.
- `supabase/migrations/20260903092000_restaurant_cellar_registers.sql:53-66` — the
  `CHECK (register IN (...))` names `soft_drinks`; a new migration narrows the constraint
  and decides what happens to every inferred or confirmed `soft_drinks` row.
- `apps/api-gateway/src/cellar/cellar-registers.ts:20` (`REGISTER_IDS`), `:103`
  (`NAME_ONLY_REGISTERS`), `:218` (the soft-drinks label list), `:238-241` (`SUBSET_OF`:
  `soft_drinks ⊂ non_alcoholic`) — the inference vocabulary and the containment.
- `registerShapes.ts:125-130`, `RowExpander.tsx:161`, `cellar-columns.ts:670` — its own
  read (`GET /beverages/:rid/registers/soft_drinks`), shape, expander cards and columns.
- `houseNaming()` (`cellar-format.ts:225-280`) refuses "Soft drinks" as a parent name
  because it collides with a child; with the child gone the `Drinks` branch becomes: one
  register → the page is that register, titled by the register's adaptive name;
  `REGISTER_TITLE.non_alcoholic` reads "Soft drinks" whenever no alcohol register is on.

The retirement opens a fork nobody has decided (question 10); it belongs in
`OPEN-DECISIONS.md` and this sketch does not file it.

## Founder questions these three embody

1. **What is the cellar page for?** Reading the house's list (A), finding one bottle's
   whole record (B), or seeing stock depth at a glance (C)? The three optimise for three
   different people standing at the screen.
2. **Are `/wines /beer …` pages, or entry points into one surface?** All three say entry
   points; the built book says pages. That is the fork the "rework" verdict is really about.
3. **Is the record a row that opens (A), the page itself (B), or a sheet (C)?** He named
   the `/inventory` dropdown; B departs from it deliberately, C keeps it one switch away.
4. **For a one-register house, is there a parent at all?** Every direction says no; the
   built page says "Drinks" with five muted cards.
5. **Should the catalogue's strangers appear on the page?** None of these draw them; the
   built page's registers show 272 whiskies. His earlier words — "someone opening /whiskey
   wants the twelve bottles this house pours" — say no.
6. **Is a register that cannot be counted acceptable to ship, drawn hollow, until ADR 0115
   locks?** C makes that the most visible thing on a whisky bar's page. A and B say it in
   words. Which is the honesty he wants a customer to see?
7. **Which tiles survive when most registers cannot be counted?** All three keep five and
   let each say what it excludes; a café gets three counted and two dashes; a whisky bar's
   fifth is a nought, counted.
8. **Does the list print?** A is the only direction where "Print the list" is the page
   itself — the *publish the list to the guest* idea from `DESIGN-FOUNDATION.md:443`.
9. **Should the view's name replace the decided name in the h1?** All three now keep
   `houseNaming()`'s answer (The Cellar / The Bar / Soft drinks) and call List, Gazetteer
   and Wall views. The first draft of A and C put *The List* and *The Wall* in the h1 with
   the house header still saying *Cellar*. Choosing that would reverse a decision 095
   merged (`cellar-format.ts:196-225`) and needs its own ADR superseding it; the cost is
   the three surfaces that call `houseNamingFor()` and every sentence written about the
   page since 2026-08-30. The recommendation keeps the decided name.
10. **Retiring `soft_drinks`: what happens to a house that carries both rows today, to a
    house with a `soft_drinks` row and no `non_alcoholic` row, and does the subset
    inference (`SUBSET_OF`) stay as a label alias or go?** Three answers are possible —
    merge into `non_alcoholic` and drop; keep the row and stop reading it; keep the id as a
    hidden alias of the inference only — and each changes the migration in the cost
    section. Not decided; this sketch prices the merge-and-drop reading and says so.

## Recommendation

**A · The List, with C's depth bar in its margin (already drawn) and B's keyboard peek
(drawn in B §1c) grafted on.** The reasons, in order of weight:

- It answers all three verdict words at once without trading one for another: *see
  everything* is literal, *not crowded* is structural (one line per bottle, the ledger in
  a second voice), and *character* comes from the trade's own form rather than from chrome.
- It keeps the one pattern the founder named — the in-place row — and the top boxes, so
  it is a rework of the book's *spine* (menu, not catalogue) rather than a fourth pass on
  its skin.
- It resolves the routes question cheaply and reversibly (anchors), and the one-register
  house falls out of it with no special case: one section, one name.
- It is the cheapest of the three against the endpoints that exist, and its riskiest
  column (Paid) degrades honestly: the headline frame is drawn with the invoice book
  populated and labelled so, and the Partial frame — the state the product will actually
  ship in — is the same page with a dash and its reason on every line; nothing moves.

B is the better operator tool once a house has hundreds of titles and someone at a
keyboard; it should live on as the *peek* inside A. C is the most characterful and the
one that best fits the charcoal ground, and its fills are now trued to its figures; but
today four of five registers have no fills at all — a café would ship a wall of outlines.
It is the right page the day ADR 0115 lands and every shelf can fill; until then it is a
view, not the page.

## How to view

```
open .planning/sketches/110-cellar-directions-2/direction-a.html
open .planning/sketches/110-cellar-directions-2/direction-b.html
open .planning/sketches/110-cellar-directions-2/direction-c.html
```

Each renders from `file://` with no build. Each file: the page at desktop width for a US
house (Meyhouse · Palo Alto, USD), the same page in a Turkish house (Kadıköy Meyhane,
TRY, tr-TR), an alcohol-free café (Çınaraltı Kahve, Kadıköy) and a whisky bar (The Copper
Still, Portland — an excerpt: Whiskey and Wines drawn, the other registers as pills), five
states (loading · blank · refused · unread · partial), the overlays drawn open, and the
page on a 390 phone. Screenshots in `shots/` — `<name>-1440.png` and `<name>-390.png`.

**Capture.** Chrome's full-page capture stops at 16,384px and starts the image over, which
is why the first pass's three 390 renders were broken from that line down and the defects
below it went unread. The renders are now taken in clipped segments of at most 8,000px and
stitched (`render-seg.mjs` in this directory — `node render-seg.mjs <file.html> <out.png> <width> <height> [maxSeg]`, Playwright from the main checkout’s `apps/web`, PIL for the stitch); the 390 pages are
24–26,000px tall and captured whole. The script also reports console errors (C's shelf
self-check writes one if a drawing disagrees with its head), horizontal overflow and any
element whose text is clipped by an ellipsis — all zero on the six renders of 2026-09-17.

**The 2026-09-17 second pass** applied the critique in full and re-read every tile of all
six renders at 1x: the decided name restored as the h1 in A and C; the `soft_drinks`
retirement priced and its fork raised; every book mark trued to its paid figure and the
headline frames labelled as drawn with the invoice book populated; C's fills generated to
its stated figures and a nought outlined so it is seen; C's record sheet filled from the
same record as its hover card; the 390 captures stitched and their defects fixed (the
eyebrow now keeps clear of the Close link, the overlay stage grows to fit its panel, B's
books go to one column below 420); captions moved to `--ink-4`; markup refused where the
units differ and runway computed over the evidenced days; the whisky-bar rail wraps and
its hover card is clamped inside the rail; the hover card named as F8's class; B's source
table stacked so a table name never breaks mid-word; tile sets made consistent across
files; B's peek drawn; the café's write acts refused in A and C; the Carry caption
rewritten and the hatch made visible (it had been reset by `.card`'s background
shorthand); one register order per house; Boza and Nargile in place of Sahlep; `tally`
integrated from the token's own spring; A's header controls kept on the right; the
overlays' real status recorded. Fonts load from Google here; the product self-hosts
Fraunces, DM Sans and JetBrains Mono.

**The 2026-09-17 third pass** re-verified the second pass's own critique of itself
(`scratchpad/sketch-critic/110-cellar-directions-2.json`, 19 findings, 4 major and 15 minor)
against the files as they stand today, file:line by file:line, rather than trusting the
report. 18 of the 19 were already closed by work already on this branch before this pass
started — the "Is this the
bottle?" panel already matches the staged file's contract in all three (`direction-a.html:334,346`
closes "Not now", sends `POST /wines/submissions`); A's hold already lives in a 440 sheet off
the row, drawn mid-pour on Boğazkere (`direction-a.html:294-310`); the Sold tiles in all
three are already a computed sum of the drawn lines, re-derived here and checked against the
five register totals per house (US 5,640, TR 2,318, CAFE 3,695, BAR 2,409 — all confirmed);
A's whisky-bar caption and record already draw both refused controls; B's overlay panels
already sit in a `.two` grid, not `.three`; B's café already gets its own full-width frame
with nothing chosen; B's tiles already tally; C's hollow spines are already `--ink-4` at full
opacity, A's hollow depth bar was already dropped in favour of the plain em dash; C's phone
composition already draws the whisky bar's sideways-scrolling rail with no hover card on
touch; A's Carry sheet already cites `/items/bulk` (not `/items`) with a bottle count on
every ticked line; A's Wines section head already reads 1,031, not the off-list-inclusive
1,067. One finding was real and is fixed
now: the README priced *Photograph the label* as a **landing** alongside the two staged
overlays, when the census calls it *not started* — it is now priced as a **build** in the
cost paragraph and in each direction's line, matching what every file's own caption already
said.

Separately, against the founder's 2026-09-17 style bar for people-facing pages (simpler,
quieter honesty, no rationale printed as copy), five register-truth lines across A and C
still named a raw table or an unapplied migration inline in the page's own visible text
(`restaurant_inventory.master_wine_id`, "the change that would let it is written and not
applied", `stock_live`/`threshold_min` read off the drawing itself) — not caught by the
critic, since none of it is an ADR number. Rewritten to plain words; the fact stays ("not
turned on here"), the schema citation moves to the Sources list, which is where every other
file citation already lives. Left alone, deliberately: the per-card `.src` table-name badges
(`<h5>Par and reorder <span class="src">restaurant_inventory</span></h5>` and its kin) are
not rationale prose — "a figure opens to its sources" is a fixed point of this sketch, decided
before this pass, and removing the badges would remove that decided feature, not quiet it.

**Three more defects surfaced only by rendering and looking at the pixels**, not by reading
the markup — the kind the critique's own report could not have caught from source. At 390,
three `.kv` rows (A's *Vendor* and *At the last paid price* in the hold sheet, C's *Order* in
the record sheet) went silently off the right edge of their card, invisible because the
overlay stage clips with `overflow:hidden` — `document.documentElement.scrollWidth` stayed
inside the viewport so the render script's own overflow check missed it too. The cause:
`.num`'s shared `white-space:nowrap` (correct for a plain figure) was inherited by these
three composite explanatory values; fixed with an explicit `white-space:normal` on those
three spans, confirmed by computed-style diff (`scrollWidth` now equals `clientWidth` on all
of them) and by re-rendering. B's whisky record packed two units — the double and the ounce
— onto one `.kv` line (`$34 the double · $18 the ounce`) and wrapped its own label into three
single words at 1440; split into two rows, one unit each. No other `.kv` row in any of the
three files pairs a multi-word label with a long value, so this class of defect is now closed,
not just these instances.

**Capture, re-verified.** `node p4-scratch/render-sketch.mjs <file> <out.png> 1440 900 1 800`
and `... 390 844 1 800` (bands automatically above Chrome's 16,384px capture limit, stitched)
— all six renders after the fixes above: 0 console errors, 0 document-level horizontal
overflow, heights 1440 · 12,824 / 14,827 / 11,008px and 390 · 29,887 / 32,930 / 24,489px for
A / B / C. Every screenshot was read back in ~2,200–2,600px crops and the three fixed rows
re-inspected against the browser's own computed styles, not just eyeballed.

**Example data, not a tenant** — every name, figure and date is invented for the drawing.
The counts that are *measured* (0 rows in the invoice and quote books; 0 of 57 beer styles;
0 of 272 whisky ages; `bottle_size_ml` = 750 on every row; `price_reference` without a
currency) are the database's, cited at the foot of each file.

## Related

- `092-cellar-directions` (the floor; one register with a kind facet) and
  `095-cellar-merged` (the book as built) — the two passes this one follows.
- `099-modal-shapes` · `102-modal-census` · `103-overlay-experience` — the overlay shapes,
  the cellar's three overlays, and the peek/promote and detent behaviours borrowed here.
- ADR 0112 (overlays; F8 names the non-modal class) · ADR 0115 (the house item, Proposed)
  · ADR 0124 (a bottle's one identity) · ADR 0138 (the ground) ·
  `.planning/06-pages/wines.md` (the page note).
