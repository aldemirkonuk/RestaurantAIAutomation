---
sketch: 107
name: receiving-structure
question: "The founder kept the idea of /receiving and rejected the execution — what structure does the desk need, now that a verdict is an append-only record?"
winner: null
tags: [receiving, delivery, verdict, append-only, ledger, spine, grid, clocks, b-plus, adr-0070, adr-0103, adr-0104, adr-0112, adr-0138, directions, mudavym]
---

# Sketch 107 · Three structures for the receiving desk, and the composed one

## Design question

The founder's verdict on the rebuilt `/receiving` was **REWORK — idea kept, execution
insufficient**: *"I really like the idea, but it needs way more improvement… we need to
add more things, more structure into this."* (`06-pages/MAKEOVER-VERDICTS.md:102-105`;
census `routes-ops.md` `/receiving` row: `needs_sketch: true`, size XL). The idea that is
kept is *one event, three renderings by role* — staff see which delivery to receive with
no prices, managers see what needs a decision, owners see money that actually came back.

Decided 2026-09-16, and every direction here is built on it: **a receiving verdict —
accepted · short · refused · damaged — is an append-only record.** Every change is a new
row with who and when; the current state is derived; the history is visible. This closes
the P14 fork the page note left open (`06-pages/receiving.md` §14e.3: *"whether a verdict is
a record or a column"*) in favour of the record. **How the current state is derived is
written once, below (§"The derivation rule"), and every screen in this folder draws that
rule and no other.**

Three directions are genuinely different desks — chronology, matrix, deadline queue — not
three skins of one layout. A fourth file, **B+**, draws the composition the recommendation
argues for, so the founder approves a screen rather than a sentence — including the
**owner rendering** (section 1b), because the kept idea is three renderings and a
recommendation that drew two would have dropped one without saying so. All of them show the
same line's append-only ledger (Doluca Antik Kırmızı 2021 on PO-2417: v1 accepted 2 cases ·
v2 short 1 case → v3 accepted 1 case, takes all of v2 → v4 damaged 2 bottles, takes 2 of v3)
so the founder can compare how each structure carries the record.

Revised 2026-09-17 after review: seventeen findings applied — the owner rendering drawn in
B+, the gate claim corrected against `delivery.service.ts`, the money-at-risk floor given its
real reason, ledger rows stripped of re-multiplied units, the derivation rule extended to
unordered lines and over-delivery, phones given full verdict words and an ordered column, the
append picker drawn empty, callouts moved off the product, one fixture enforced across files,
the D13 question and the holder-row question made explicit (founder questions 7 and 8).

## How to view

```
open .planning/sketches/107-receiving-structure/direction-a.html
open .planning/sketches/107-receiving-structure/direction-b.html
open .planning/sketches/107-receiving-structure/direction-c.html
open .planning/sketches/107-receiving-structure/direction-b-plus.html
```

Self-contained, render from `file://`. Each file shows: the manager's desk at 1440 with
realistic data (Meyhouse, Palo Alto in USD / Vanilla Kaleiçi, Antalya in TRY), the overlay
the page opens drawn open, a strip of four states (empty · loading · refused · partial),
the staff rendering at 390, and the manager's main overlay in its phone form — ADR 0112 F9's
bottom sheet with detents peek · half · full. B+ adds the owner rendering (section 1b), the
derived box for an unordered line and an over-delivery (section 2b), and the grid at about
1100 px with the column-hiding rule applied (section 3). Screenshots in `shots/`, rendered
with `p4-scratch/render-sketch.mjs` at 1440 and 390 — zero console errors, no horizontal
overflow on any of the eight renders (re-checked 2026-09-17). At 390 the desk sections are
hidden and a note says so. The sketch's own annotations sit **under** each stage as a notes
strip, never over a cell — a callout that covers product content hides what it points at.

Fonts load from Google Fonts in the sketch; the product self-hosts them (Fraunces is
injected per page today — `pages/dashboard/next/fonts.ts`). The ground is Warm Charcoal
by decision (ADR 0138); the one paper surface is the vendor's document (ADR 0104 D9), and
in B and B+ the *on paper* cells carry `data-ground="paper"` so the light tokens actually
resolve there — the document on the light ground, everything the house measured on
charcoal. Motion is the seven tokens of `lib/mudavym/motion.ts` and nothing else — the
sketch carries the same spring sampler so tuck, stamp and tally run on the product's own
curves, `prefers-reduced-motion` collapses every duration to zero, and **the loading
skeleton bars are static**: a pulse would be an eighth motion, so there is none.

## The derivation rule

This is the rule the decision needs and the screens draw. It replaces "latest row per
line", which cannot draw any of these desks (a refusal beside an acceptance would vanish;
a damaged portion would double-count).

- **Each row is a portion of the line in one verdict**: one verdict word, one quantity,
  one unit — the unit the person counted in, never defaulted. `qty` is always *the units in
  that verdict*, never the count received: **accepted** = units kept and sound; **short** =
  units the vendor did not deliver; **refused** = units sent back on the truck;
  **damaged** = units kept but unsaleable, a claim owed.
- **A row may take from an earlier row.** `supersedes` names the row, `supersedes_qty`
  says how much of it (default: all). The named row is never edited or deleted; it is drawn
  struck through and kept.
- **Current state = per verdict, the sum of quantities in rows carrying that verdict, minus
  what later rows took from them.** Units are compared once through the order's pack size
  (`5 cases × 12 = 60 bottles`, stated where the pack size is the order's).
- **The invariant the view checks:** the current portions add up to the ordered quantity;
  a remainder is *not counted*, never zero; a line with no rows is *no verdict*.
- **When there is no order** (an unordered delivery, D5; or a line on the vendor's paper
  only), "ordered" is undefined, so **the basis is the counted quantity, or the on-paper
  quantity if nobody counted** — the house's own measurement outranks the vendor's paper,
  and the paper is the basis only in its absence. The invariant compares current portions
  to that basis; a count appended later becomes v1 and moves the basis from the paper to the
  count. Drawn: A line 6 (Efes Pilsen, billed 1 case = 24 btl, not counted → *not counted 24
  = basis*) and B+ section 2b (Ancyra, on the e-İrsaliye only).
- **Over-delivery** — more arrives than was ordered — is a portion **beyond the order**,
  flagged on the row (`beyond_order boolean NOT NULL DEFAULT false`, the person's statement,
  never derived), in either verdict a person can give it: *refused* (sent back) or
  *accepted* (kept — a manager's gate, D6, and an answer owed until a priced document bills
  it or the vendor writes that it will not). The invariant then compares to
  **max(ordered, counted)**: portions within the order add up to ordered, portions beyond it
  add up to counted − ordered, and the two are never summed into one word. Drawn: B+
  section 2b (Sevilen 900 Fümé Blanc, PO-2228 line 2: ordered 4 koli, 5 arrived, v2 *refused
  1 koli · beyond the order*; accepted 24 + refused-beyond 6 = 30 = max(24, 30)).

Drawn on the Doluca line (3 cases = 18 bottles ordered):

| row | who · where · when | verdict | qty | takes from |
|---|---|---|---|---|
| v1 | Deniz K. · door · 14:12 | accepted | 2 cases = 12 btl | — |
| v2 | Deniz K. · door · 14:12 | short | 1 case = 6 btl | — |
| v3 | Deniz K. · door · 14:19 | accepted | 1 case = 6 btl | all of v2 |
| v4 | Hasan A. · desk · 16:40 | damaged | 2 btl | 2 btl of v3 |

Current: **accepted 12 + 6 − 2 = 16 btl · damaged 2 btl · short 6 − 6 = 0 · 16 + 2 = 18 =
ordered.** The Pendore line in B (2 koli ordered): refused 1 koli (v1) + accepted 1 koli
(v2), neither takes from the other → accepted 6 + refused 6 = 12 = ordered. The Yakut
line in B: v2 restates v1's 48 bottles with the substitution mark and takes all of v1 →
accepted 48, substitution unanswered. The derived box on every screen prints this
arithmetic, not only its result.

## The four directions

### A — The Spine (`direction-a.html`)

**Idea.** The delivery is the spine: eight stations across the whole desk — ordered ·
acknowledged · door · paper · verdicts · agreed · verified · paid (ADR 0103 D1; the
founder's praised five-station orders spine, extended). Beneath it, **the record**: time
runs down, and every count, reading, proposal, clock and verdict is a mark on one rail, by
name. A verdict that changes is a new mark that names the mark it takes from; the old mark
stays, struck through, with a bracket reading *one line · four entries · the current state
is derived from all four*. The lines sit beside the record with their derived state and an
entry count; a line opens inline or in the **line sheet** (440 px, one object), where a new
entry is appended — never edited — and **the append is held** (hold to append), because a
ledger row keeps the seal before (ADR 0112 F10). Sending the drafted credit request is the
sheet's second seal.

**Optimises.** Narrative and audit. "What happened, when, by whom" is the page's native
question, and history needs no extra view because history *is* the view. Best for an
owner reading back a dispute six months later, and for the accountant ADR 0104 called the
product's reader.

**Costs.** Chrome before the verdict — the manager scrolls a record to find the two
lines holding the gate. Eight stations at 1440 leave ~140 px each; at 1100 px the spine
must fold.

### B — The Grid (`direction-b.html`)

**Idea.** One delivery at a time, line by line. Each row carries the **four numbers**
the domain is about — ordered · at the door · on paper · the difference in words — then
the **verdict** (derived, with its entry count) and the **answer the house still owes**
(A11: a difference must be answered by an accepted proposal or an explicit acceptance with
a reason). The *on paper* column is drawn **on paper** — `data-ground="paper"` on the cell,
the vendor's document literally on the light ground — so count and paper cannot be
confused. Pressing a row turns it open on its own ledger (v1, v2 with who/when/evidence)
beside a note on what answering means. Deliveries are tabs across the top, worst first,
with *answers owed* as the count. **The gate this desk needs is wider than the one
`agree()` runs today.** As drawn it holds on an unanswered difference (A11), on an ordered
line nobody counted (A6, printed as *not comparable*, never as an answer owed), and on a
dispatch note as much as on an invoice. Today's code does none of the last two and only
half of the first: `scanAgainstTheOrder` compares only `door_count` and `invoice` documents
(`canonical/delivery.service.ts:1682`), so an e-İrsaliye (`despatch_advice`) is never
compared and line 5 (Ancyra, on paper only) would not be a recorded difference;
`gradePairing` flags only unmatched *document* lines (`:1844`), so an ordered line nobody
counted (line 4) holds nothing; and `not_comparable` "legitimately leaves nothing to answer"
(`:1239`, `:1261`). For this fixture `agree()` today would hold on lines 2 and 3 only. The
three changes are in the cost row, and the screen is drawn for the gate after them.
The overlay is the **centred panel** (620 px, a question): *Take Yakut 2021 in place of
2022, as dispatched?* — one sentence says what it asks and what it writes, a reason is
required, and the seal is held because it is a decision the house is bound by (D6). It is
named *as dispatched*, not *as billed*, because an e-İrsaliye bills nothing (founder
question 6).

**Optimises.** Speed of reconciliation and the A11 gate. Differences are the page; the
gate sentence names the unanswered lines and the *Agree* control is held with the reason
printed. The Turkish case is drawn honestly: an e-İrsaliye carries no money, so the paper
column shows quantities with `price —`, and the footer states money at risk only *at the
agreed price* with its provenance, never as a claim.

**Costs.** The delivery's chronology is a rail, not the page — reading "who did what
when" across lines means opening rows one by one. A grid with eight columns is dense at
1440 and needs a column-hiding rule below ~1200 px (drawn in B+, section 3).

### C — The Clocks (`direction-c.html`)

**Idea.** Every open delivery is on a clock and the clocks are data (`delivery_timers`:
door correction, response window, invoice issuance, objection window, payment; states
open · nudged 50 % · escalated 80 % · blocked · fired). The desk is a **queue in lanes by
clock state** — driver still here · due · nudged and escalated · blocked (the clock cannot
be computed; it asks) · lapsed (what the law deemed). Each delivery is a card with a
**ruler**: how much of its shortest window is gone, notches where the house nudges and
escalates, and the sentence for the end of the window — *the law deems acceptance*, *EFT
debits*, *asks a YMM*. **An open-ended window has no ruler fill**: the driver-here card
draws a dashed track that fades out, an origin tick, and the elapsed minutes as a number —
no proportion is invented for a window that ends at a signature. Owner and deputy are on
every card (D9: no unowned backlog). The delivery opens in a **side sheet** (its clocks,
documents, lines, the verdict-word legend, the selected line's ledger and the held append);
who holds it is a **popover** (a choice, no scrim). A second stage shows the Turkish house: day 5 of 7 on an
e-İrsaliye dated Fri 11 Sep with the response drafted for one tap, a refused koli on the
card, an irsaliyeli fatura in its objection window, and a premises delivery whose clock
basis is genuinely open (A8).

**Optimises.** Never missing a legal or financial window, and ownership. This is the
only direction where the D9 ladder — re-notify, escalate, lapse — is the structure rather
than a chip. The owner's band (asked · promised · recovered) is the first strip.

**Costs.** The lines are two levels deep (lane → sheet → line), so a manager who wants to
reconcile one delivery fast is slower here than in B. The lanes depend on the clock poller
being alive — which is why the refused state shows a stale ladder as stale, with its last
run time on the page, rather than as "nothing due".

### B+ — The Grid, composed (`direction-b-plus.html`)

**Idea.** B's desk with the two grafts the recommendation asks for, drawn. The tabs across
the top are **C's queue in clock order** — the soonest window first (minutes, then 1 d 21 h,
then 5 d, then 16 d, then **the clock that cannot be computed, last, with *asks* where a
countdown would be** — Likya PO-121, a premises delivery whose window basis is open, A8) —
with **the holder on the tab** (owner and deputy chips; the live tab names who is at the
door). The grid is B's, with the paper column on paper and the gate this desk needs.
Pressing a row opens **the line sheet** — one object, 440 px — which carries **A's record
for that line** (order, paper reading, count, comparison, nudge, entries, on one rail by
name) above the ledger, the derived arithmetic, the append (its picker drawn **empty** — no
verdict, no quantity, no unit, no takes-from — and its hold disabled until the reason is
written), and the answer the house owes (the drafted proposal with *hold to send*, or
*accept as dispatched*, which opens B's centred question). **Section 1b is the owner
rendering** — the kept idea's third rendering: asked · promised · recovered as a band, money
back per delivery by name and date, a draft and a proposal and a lapse each given their own
word, the at-risk floor with its real reason, and the Turkish house's band beside it with no
claimable money on an irsaliye. **Section 2b** draws the derived box for the two cases the
rule must also cover — no order, and over-delivery. Section 3 draws the grid at ~1100 px
with the rule applied: the difference folds under the line name as a sentence, the pack
sublines go (the pack size stays in the sheet), the answer becomes one control; nothing
that changes a number is hidden, and the footer keeps *not a claim: no priced document yet*.
Section 5 draws the manager's phone: the tabs keep their clock order, the grid is three
numbers — ordered, door, paper — and a verdict in **full words stacked** as on the desk
(*accepted 1* / *refused 1*; *substitution* under *accepted*), and the line sheet is F9's
bottom sheet at *half* with *Append an entry* as a button that opens *full*, where the form
and its hold live — nothing is sealed from *half*, because nothing has been entered there.

**Optimises.** What B optimises, without B's two costs: the manager never guesses which
delivery to open, and the chronology is one press away without being the page.

**Costs.** Two overlays on one desk (the sheet for a line, the panel for a question) and a
tab strip whose order moves as clocks move — the loading state holds the last order and
says so, and the order settles once per read, never on every tick. Three renderings are
three pages' worth of states to keep honest; the owner rendering reads `credits` and
`/stats` and nothing the manager's desk derives.

## What all four share

- **The verdict ledger is one component**, drawn identically in A (record and sheet),
  B (under the row), B+ (in the sheet), C (in the sheet) and on every phone: `v1 · who ·
  door/desk · when · verdict word · quantity in one unit · takes-from chip · evidence
  chips`, oldest first, a retired entry struck through and kept, and a *current · derived*
  line beneath that prints the arithmetic of §"The derivation rule".
- **Verdict words are words**, never colour alone, and one chromatic colour: accepted
  (plain), short (İznik outline), refused (solid ink), damaged (dashed). **Never
  abbreviated, on any screen**: the phones stack full words (*accepted 1* over *refused 1*,
  *accepted 16* over *damaged 2*) in narrower cells rather than shortening them. In a picker
  the four words are drawn in one neutral style and **nothing is chosen for the person** —
  no verdict, no quantity, no unit, no takes-from — and the hold is disabled until the reason
  is written; only a choice the person made is marked (seal ring and underline). *No verdict*
  is drawn as an absence in italics, never as a zero. Substitution rides on an accepted entry
  as a mark beneath the word. Every direction shows all four words and a legend.
- **Vocabulary is kept apart.** *Refused* is a verdict on a line; the A11 gate is *held*
  (*Agree — held: 3 answers owed*), never "refused", so the same screen never uses one word
  for two things. A refused koli is *refused 6 şişe* in the footer, not "short".
- **The staff rendering at 390 shows no prices** and hands off to the door; each direction
  reduces to the one thing a porter can move (A: the delivery's station; B: ordered vs
  counted per line; C: is the truck here). The porter sees their own entries by name and
  what the desk appended afterwards — one ledger.
- **The manager's overlay on a phone is ADR 0112 F9's bottom sheet** with detents peek ·
  half · full and a grabber; drawn in every file's mobile section. The centred question
  keeps its centred form on a phone.
- **Units stated once.** `5 × 12 + 3 × 6 + 2 × 6 + 4 × 6 + 1 × 6 = 120 btl` is written once
  on the porter's card beside *15 cases expected*. **A ledger entry names the unit it was
  counted in and never its conversion** (*accepted 2 cases*, *refused 1 koli*, *damaged 2
  btl*) — the first draft re-multiplied inside nineteen entries and broke this rule in the
  one component it called shared; all nineteen are gone. The conversion through the order's
  pack size appears in exactly two places: the sheet header, where the order's pack size is
  stated (*ordered 3 cases = 18 bottles · the pack size is the order's, stated once*), and
  the derived box's arithmetic, which has to add portions counted in different units. The
  grid's *ordered* column states the order's pack size once per line under the heading that
  says so; it is the order's number, not a count (ADR 0054; `rc-format.ts:fmtUnits`).
- **One fixture.** PO-2417 is 5 lines · 15 cases · $2,063.40 agreed; the door counted 14
  (Musar never came, *not counted*); invoice SG-88213 is 6 lines · goods $2,109.00 +
  delivery $31.60 = $2,140.60; **money at risk is ≥$28.20 because two billed lines cannot be
  priced** — Musar (6 × $58.00 = $348.00) not counted and Efes (24 × $1.90 = $45.60) never
  ordered, $393.60 billed — the floor has nothing to do with a list cap. PO-2231 is 4 lines ·
  ₺49.680,00 (72 × ₺310 + 48 × ₺340 + 12 × ₺290 + 18 × ₺420); its e-İrsaliye and door count
  are Fri 11 Sep, so on Wed 16 Sep the response window is day 5 of 7, nudged Mon 21:40 (day
  3.5), escalating Thu 00:04 (day 5.6), deemed accepted Fri 18 Sep 09:40.
  **The owner's band, Meyhouse, September to date, is one set of figures in A's tiles, C's
  strip and B+'s owner rendering:** recovered **$96.00** (one credit memo, SK-CM-1180, Tue
  8 Sep, Skurnik PO-2405, 4 btl corked) · promised **$180.00** (SGWS PO-2398, "credit to
  follow" Fri 11 Sep, no memo) · asked **$0** (nothing sent and waiting) · **1 drafted, not
  sent ($28.20)** on PO-2417 · Wine Warehouse PO-2402's $41.60 PRICE_VARIANCE is a proposal,
  not a claim, and appears on no band figure. **Each delivery has one status in every
  file:** Doluca PO-118 driver here since 11:58 (the blocked Turkish clock is **Likya
  PO-121**, a premises delivery, in C's 1b and B+'s last tab); Skurnik PO-2411 AGREED Mon 14
  Sep, verify pending, EFT day 21 of 30 → Fri 25 Sep; Skurnik PO-2409 delivered Wed 09:30,
  v1 *damaged 1 bottle* by Deniz K. retired by Hasan A.'s v2 *accepted 1 · takes all of v1*
  ("scuffed label, not broken — no claim"), verified 10:12; Wine Warehouse PO-2413 verified
  Fri 11 Sep (the last closed delivery the empty states name, at their own moment, Mon 14
  Sep 08:10); Kavaklıdere VKL…12345 counted by Emre T. Fri 09:52, 11 koli, line 4 not
  counted, on every screen including A's partial card.

## Cost to build

**Exists today, all four use it** (`apps/api-gateway/src/procurement/`):

- `GET /procurement/deliveries` (`deliveries.controller.ts:62`, filter by state, a failed
  read throws), `GET /:id` (`:105` — the spine via `canonical/delivery-spine.service.ts`
  plus the event row), `GET /:id/proposals` (`:127`), `POST /:id/proposals` · `counter` ·
  `accept` (`:166-208`), `POST /:id/accept-as-billed` (`:235`, writes
  `delivery_line_acceptances`, migration `20260906163412`), `POST /:id/agree` (`:257`,
  the A11 gate), `POST /:id/verify` (`:269`), `POST clocks/run` (`:285`).
- `GET /procurement/receiving/queue` and `/unverified` (`receiving.controller.ts:330,347`),
  `POST orders/:id/door`, `GET orders/:id/received` (`:233,309`).
- `GET /procurement/credits` and `/stats`, `POST :id/transition`
  (`documents/credits.controller.ts:94,123,164`) — the owner's band.
- Tables: `deliveries` (state, provenance, owner/deputy, jurisdiction —
  `20260903160000:68`), `delivery_proposals` (`:202`), `document_deliveries` (`:161`),
  `vendor_terms` (`:274`), `delivery_timers` (`20260905232000:106` — the states the lanes
  in C are keyed on), `delivery_line_acceptances` (`20260906163412:44`),
  `procurement_receipt_events` (baseline `:4575` — the door's counts, **and the door's
  verdict**, see below).

**New for all four — the append-only verdict ledger.** No such table exists (grep of
`supabase/migrations/` and `.planning/decisions/` for `line_verdicts` / `receiving_verdicts`:
nothing). Proposed shape, to be its own ADR:

- `delivery_line_verdicts` — `delivery_id` NOT NULL, `document_id` NULL (ADR 0104 D13
  made the delivery the spine and hung documents off it, so a verdict keys on the
  delivery — a door count precedes any paper, and an unordered line has none), `line_no`,
  `inventory_id` NULL, `verdict` CHECK IN (`accepted`,`short`,`refused`,`damaged`),
  **`qty integer NOT NULL CHECK (qty > 0)` and `uom NOT NULL`** from the CHECK-constrained
  vocabulary — ADR 0070 (Locked) keeps quantities integer and makes each row state its own
  unit; `numeric(12,3)` was killed there because a `0.001` residue certifies its own
  corruption, and nothing about a verdict portion needs a fraction of a bottle — `reason
  text` NOT NULL, `evidence jsonb` (references, not blobs, as `delivery_proposals` does),
  **`supersedes uuid` NULL and `supersedes_qty integer` NULL** (the portion taken from the
  named earlier row; NULL means all of it), **`beyond_order boolean NOT NULL DEFAULT false`**
  (the person's statement that this portion is over-delivery — see the derivation rule),
  `recorded_by` NOT NULL, `recorded_at`, `client_captured_at`, `idempotency_key`. **The
  over-take guard cannot be a CHECK** — a CHECK cannot read another row — and a per-row test
  would not be enough either: two later rows can each take part of the same row and together
  over-take it, driving a current portion negative. So: a **BEFORE INSERT trigger** that
  `SELECT … FOR UPDATE`s the named row (serialising concurrent appends against it) and raises
  unless `sum(supersedes_qty of every row naming it, in that row's unit) + the new taking ≤
  its qty`; plus a **view-level assertion** that no current portion in
  `delivery_line_verdict_current` is below zero, written as a CLAIMS row against the sim
  tenants so CI re-measures it. **No UPDATE or DELETE**: RLS grants insert and select only,
  and a trigger raises on both — the append-only decision has to be enforced by the
  database, not by the client's good manners (the P14 lesson: `verifyReceipt` overwrote
  `match_status` and nulled `discrepancy_notes`).
- A view `delivery_line_verdict_current` — **the derivation, not the latest row**: per
  (delivery, line, verdict, beyond_order), `sum(qty) − sum(supersedes_qty of later rows
  naming these rows)`, in the line's base unit through the order's pack size; the basis is
  `ordered`, or the counted quantity when there is no order, or the on-paper quantity when
  nothing was counted, or `max(ordered, counted)` when a beyond-order portion exists; plus
  `basis − sum(current within the order)` as `not_counted`. Derived, never stored.
- `GET /procurement/deliveries/:id/verdicts` (the ledger, oldest first) and
  `POST /procurement/deliveries/:id/verdicts` (append one; `supersedes` must name a row on
  the same line).

**The door already records a verdict, and that is a fork.** `procurement_receipt_events`
carries typed door facts since ADR 0062 / migration `20260901220000_door_facts_are_columns`:
`outcome` with a CHECK on `accepted · short · refused` (`:108-118`), `refusal_reason`
(`:136`, only when refused), `rejected_qty` in `counted_uom` and `rejected_qty_bottles`
(`:55-92`). The events accumulate per event. If the door also writes `delivery_line_verdicts`,
v1 exists twice — the dual-bookkeeping shape the inventory rebuild had to undo. Three
relationships are possible and **the founder chooses (question 2)**: (i) the ledger
supersedes `outcome` — the door writes verdict rows and `outcome` becomes a derived column
or is dropped; (ii) v1 is *derived* from the receipt event — the ledger holds only desk
entries, and the view unions the door's event as row 1; (iii) both are written with a
reconciling guard that fails CI when a receipt event's `outcome` and the ledger's v1
disagree. The sketches draw (i): every entry, door or desk, is a ledger row in one shape,
and `DoorNext.tsx`'s `DoorOutcome` (`DoorModel.ts:247`) becomes the verdict word. Whichever
is chosen, `DoorNext.tsx:405` still hardcodes `countedUom: 'case'`, and a verdict row must
carry the unit the receiver actually chose (P7).

**The seal on an append.** ADR 0112 is Locked, and F10 says: *"Money, sends and ledger
rows keep the seal before. The list is closed; adding to it is an amendment here."* The
verdict ledger is a ledger by this sketch's own name, so A's sheet, B+'s sheet and C's
delivery sheet draw the append as **hold to append**, with the four verdict words in one
neutral style and only the chosen one marked. F12 then names the one exception the
founder already made: *"a door count may be corrected within ten minutes as undo-after (an
explicit addition to F10's closed list)."* The door's v2 → v3 on the Doluca line (14:12 to
14:19) is exactly that case — and under the append-only decision it is a new row that takes
from the old one, not an undo. The two rulings meet at the door and one must yield
(question 3).

**Per direction, on top of that:**

| | New read | Why |
|---|---|---|
| A | `GET /procurement/deliveries/:id/record` — one ordered feed unioning receipt events, documents, proposals, acceptances, timers and verdicts | the record is the page; assembling six reads client-side would re-derive order and hide gaps |
| B | `GET /procurement/deliveries/:id/differences` — expose `scanDifferences` (`canonical/delivery.service.ts:1642`, private today) as a read with its three answers `compared · not_comparable · unreadable`; the gate and accept-as-billed read it via `recordedDifferences` at `:1230-1241` (differing **and** unmatched, `:1240`), the notification at `:1572`; plus `answersOwed` per delivery for the tabs. **And the gate change the screens depend on, in three parts:** (1) `scanAgainstTheOrder` must count `despatch_advice` as comparable — today the filter at `:1682` admits only `door_count` and `invoice`, so an e-İrsaliye is never compared and an on-paper-only line on it is no recorded difference; (2) `gradePairing` must emit **unmatched ORDER lines** (ordered, nobody counted, nothing on paper) as a `not_comparable_line` hold that is *not* an answer owed — today `:1844` walks only `unmatchedDocumentLineIds`, so line 4 holds nothing; (3) `agree()` must **refuse** on those holds — today `not_comparable` "legitimately leaves nothing to answer" (`:1239`, `:1261`), which is right for a delivery with no documents and wrong for one ordered line with no count. Without the three, `agree()` on this fixture holds on lines 2 and 3 only | one comparison, not two (A11 point 1): the grid must read the same scan the gate reads — and that scan must see the dispatch note and the uncounted order line |
| B+ | B's read **and B's gate change**, plus A's record read filtered to one line (`?line=`), plus C's queue read for the tab order and holders, plus the owner's band from `credits`/`stats` grouped per delivery with the draft-vs-sent-vs-promised-vs-memo state per claim (the credits read returns a status today; whether "drafted, never sent" is one of its values needs a check — ADR 0140's outbox holds drafts, so the rendering may have to union two reads) | the sheet carries the record; the tabs carry the clocks; the owner's band is the third rendering |
| C | `GET /procurement/deliveries/queue` — timers × deliveries × holders × answers owed, grouped by clock state; the poller's last-run time (no such field exists) | the lanes are the timer states; a stale ladder must be reportable as stale |
| C | owner/deputy reassignment — `deliveries.owner_user_id/deputy_user_id` exist, there is no `PATCH`; per the append-only spirit a `delivery_holders` history row, not an overwrite. **Written from a popover, so unsealed**: ADR 0112 says the seal never appears inside an anchored popover, and F10 keeps the seal only for money, sends and ledger rows. This sketch reads a holder row as an assignment on F10's undo-after side (its own examples: remove a shift, a note) — it fires, Undo is offered for a few seconds, the history row is the audit — **not** as a ledger row. If the founder reads it as a ledger row, the change opens as a sheet with a seal instead (founder question 8) | the popover, and B+'s holder chip |

Nothing here is a full-purpose build estimate (memory: rebuilt acts must fully serve
their purpose); it is what each direction needs beyond what `origin/main` serves today.

## Honesty traps each direction handles

- **Missing is not zero.** A line nobody counted reads *not counted* in every direction
  (A6) and holds the gate on its own, printed as *not comparable*, never as an answer owed
  (today's `scanDifferences` does not hold on it — cost row B, change 2); *no verdict* is
  italic absence; lane counts and strip figures are dashes until they arrive; a ruler is
  never drawn at 0 % before its window is known (C).
- **An open window has no proportion.** A door-correction window ends at a signature and
  has no known length, so its track has no fill: an origin tick, the minutes as a number,
  and *2 of 4 lines counted* as a count, never as a bar (C, desk and phone).
- **A clock is data.** Every day-of-window figure is computed from a dated basis printed
  beside it (the e-İrsaliye's Fri 11 Sep 09:40); nudge at 50 % is day 3.5, escalation at
  80 % is day 5.6, and the deemed date is the basis plus seven days. Nothing on a card is a
  round number chosen for the drawing.
- **The law deems; the state records.** The Turkish card says *the law deems acceptance
  Fri 18 Sep 09:40; the state records no response* — never *silence accepts* as if the house
  agreed (D3). And **a vendor's terms are not the law**: an EFT that debits on day 30 is a
  contractual event, so C's lane is *Lapsed: what the clock did*, and *the law deems* is
  kept for the Turkish response window alone.
- **A draft is not sent.** Every drafted claim, proposal, partial acceptance and
  Turkish `red` carries *not sent* until a person holds the seal; the outbox says
  *holding*, never `sent 0 · failed 0` (ADR 0140).
- **Received stock is not verified invoice cost.** Stock moved at the door is marked
  *cost provisional*; nothing posts to COGS until VERIFIED (A1) — said on the spine (A), in
  the ledger note (B), on the lapsed card (C).
- **Promised credit is not recovered money.** The owner's band counts credit memos only;
  asked and promised are printed beside it and never added in.
- **Generated text is not evidence.** The drafted claim is labelled *generated from the
  ledger — not evidence; the photograph and entry v4 are* (A); extraction confidence is
  never a number.
- **A figure opens to its sources.** Money at risk carries a dotted provenance
  (`invoice line 2 × (billed − counted)`; *at the agreed price, not a billed one* in B);
  a PO total opens to its line arithmetic; an invoice total names its delivery charge.
- **Priced receipts need a currency.** An e-İrsaliye has no money — the paper column says
  `price —`, the footer says *not a claim until a priced document bills it*, and the act
  against it is *accept as dispatched*, not *as billed*; an invoice stating no currency has
  its money withheld and *the price is refused at this desk, the stock proceeds* (batch 64).
- **A failed read is never an empty room.** Each refused state prints the status and the
  path; a 403 names the permission and offers no retry that cannot help; B's *unreadable*
  comparison refuses the gate rather than reading as *no difference* (A11 point 2).
- **A window is a floor.** `≥100` when a capped list came back full (ADR 0060). **Money
  at risk is a floor for a different reason**, and the tile says which: *≥$28.20 at risk —
  2 billed lines cannot be priced (Musar not counted, Efes never ordered, $393.60 billed)*.
  The first draft blamed a list cap; the founder would have read $28 as nearly the whole
  exposure. And *asked* never counts a draft: *asked $0 · 1 drafted, not sent ($28.20)*.
- **A clock that cannot be computed asks and never fires** (D4/A8) — a card in C, a
  station in A, a rail row in B, and **the last tab in B+, drawn** (Likya PO-121: *asks* where
  a countdown would be).
- **Difference is not "nothing wrong".** A line whose count equals its paper but carries a
  damaged portion says *count = paper · 2 btl damaged after the count (v4)*, never *none*.

## The founder questions each direction embodies

1. **Is the desk for reading history or for closing the day?** A answers the first, B and
   B+ the second, C answers "what expires first". The verdict ledger is the same in all
   four; the fork is what surrounds it.
2. **Where does the door's own verdict live?** `procurement_receipt_events.outcome`
   already records it (ADR 0062). Does the ledger supersede that column, is v1 derived from
   the receipt event, or are both written under a reconciling guard? The sketches draw the
   first; the cost section names all three. A desk re-count is a v-n entry by a manager
   with a reason in every direction, drawn in A's sheet.
3. **Is an append sealed, and what is the door's ten-minute correction?** ADR 0112 F10
   (Locked) keeps the seal before a ledger row, so every sheet here draws *hold to append*.
   F12 (the founder's ruling) makes a door count correction within ten minutes undo-after.
   The door's v2 → v3 is both at once. Either the append at the door is exempt from F10 for
   ten minutes and written as a taking row anyway (this sketch's reading), or F12's
   undo-after is amended to mean *a row that takes from the previous row, sealed by the same
   thumb that made it* — one sentence in ADR 0112 either way.
4. **Does the Turkish response (`kabul / kısmi kabul / red`) belong on this desk or on
   `/receipts`?** B draws *Send partial acceptance* on the row; the page note says line-item
   editing hands off to `/receipts` deliberately. The response is not line editing, but the
   founder should say which page owns the send.
5. **Owner and deputy on every delivery (C, and on B+'s tabs) — is that the house's model
   of a manager's day?** D9 requires it; C and B+ make it visible everywhere. If yes, A and
   B should grow the holder chip; if no, D9's escalation needs a different addressee.
6. **Can A11's accept-as-billed be keyed to a dispatch-note line?** An e-İrsaliye bills
   nothing. B draws the act as *accept as dispatched — record the substitution* and lets the
   e-Fatura open its own objection window; the alternative is to hold the question until a
   priced document exists. `delivery_line_acceptances` keys on (delivery, document, line)
   today and would accept either reading.
7. **Does ADR 0104 D13 bind `/receiving`?** D13 (Locked) made C's document spine the
   information architecture of the agreed-invoice frame and rejected "B alone" as a lead.
   This sketch recommends a grid-led desk. The argument that the two are different surfaces
   is in the Recommendation; if the founder does not accept it, the alternative is to
   supersede D13 for this page in one sentence — *the agreed-invoice frame keeps D13; the
   receiving desk is grid-led and reaches the frame through its documents rail* — as an
   amendment to ADR 0104, not a quiet workaround.
8. **Is a holder change a ledger row?** C's popover and B+'s holder chip write a
   `delivery_holders` history row without a seal, because ADR 0112 keeps the seal out of a
   popover and F10's sealed list is money, sends and ledger rows. This sketch reads the
   holder row as an assignment on F10's undo-after side (like removing a shift). If the
   founder reads it as a ledger row, the change opens as a sheet with a seal.

## Recommendation

**B+ — argued from the screen in `direction-b-plus.html`, not from B's sentence.** The
founder's words were *more structure*, and the structure receiving lacks is the four
numbers per line with the answer owed beside them — that is what a manager at 2 pm actually
does, and only B and B+ make the A11 gate the page rather than a chip: *held: 3 answers
owed, 1 line uncounted*, with the three line numbers and the uncounted line each printed
with its own reason. They also carry the two honesty traps that bite hardest in Turkey (no
money on an irsaliye; a vintage is a substitution) in their own cells. B alone has two real
costs, and B+ section 1 and section 2 show each answered: the tab strip is C's queue in
clock order with the holder on the tab, so the manager opens Doluca (minutes) before
Kavaklıdere (1 d 21 h) without guessing; and the line sheet carries A's record for the line,
so "who did what when" is one press away without becoming the page. B+ section 3 shows the
grid still reads at ~1100 px with the difference folded under the line and nothing numeric
hidden; section 5 shows the desk on a phone as F9's bottom sheet. A alone puts chrome
before the verdict; C alone puts the lines two levels down. B+ is the smallest desk that
answers all three questions the founder asked of the door brainstorm — what is short,
before the driver leaves; three outcomes not two; the claim drafted, not sent — at the desk
where the answer is written, and it is the one file here that draws every piece of the
recommendation, **including the owner rendering** (section 1b): the kept idea is one event
in three renderings, and a recommendation that drew staff and manager only would have
dropped the third without saying so. B+ keeps it; the owner's band reads the credits store
and nothing the manager derives, and its figures are the same in A's tiles and C's strip.

**B+ against ADR 0104 D13 (Locked).** D13 chose *C's spine as the information
architecture, A's typeset sheet as the selected frame, B's verdict block on top* for the
**agreed-invoice frame** — the surface where one delivery's documents (PO → e-İrsaliye →
door count → invoice → proposal → credit memo) are read, corrected and printed, and where
the accountant is the reader. It rejected "B alone" because it *loses the accountant and
the sheet the founder called the product*. This sketch does not propose a different
agreed-invoice frame; it proposes the **desk that writes the verdict rows that frame
reads** — a different surface with a different reader (a manager at 2 pm) and a different
native question (which line, which answer, before which clock). The argument that the
two are different, and that B+ honours D13 rather than working around it, rests on three
things the screen shows. (1) **D13's spine is still there, collapsed by default as D13
itself prescribes**: B+'s *documents on this delivery* rail (section 1) is the six-card
spine as a list — PO, e-İrsaliye, door count, e-Fatura not yet — and D13 says the spine is
*collapsed by default when a delivery has two or fewer documents*; pressing a document
opens the agreed-invoice frame, D13's own shape, with the verdict block on top. (2) **A's
sheet is one press away and carries A's record**: the line sheet (section 2) is the
typeset frame for one line — the four numbers with footnote provenance, the record by
name, the ledger — so the accountant's read is not lost, it is scoped to the line the
manager is answering. (3) **B's verdict block is the grid**: D13 put the named exceptions
*first on the frame*; the grid is that block made the page, because at the desk the
exceptions are the work, not the summary. What B+ concedes to D13's cost is exactly what
D13 conceded: the manager reaches the chronology through a press, not on the page. If the
founder reads `/receiving` as *the* agreed-invoice frame rather than the desk that feeds
it, then B+ contradicts D13 and A is the direction that honours it — and the honest move is
to say so and supersede D13 for this page explicitly (founder question 7), not to build B+
under a locked decision that reads the other way.

## Related

- `06-pages/receiving.md` §14 (the pipeline review; P14 is the fork this closes —
  `receiving.md:612`), `06-pages/receiving-door.md`, `06-pages/MAKEOVER-VERDICTS.md:102-109`.
  The Wave Four verdict snapshot (`07-reference/artifacts/mudavym-wave-four.md` on
  `claude/artifact-pull`) carries no `/receiving` entry at all (grep, 2026-09-17), so the
  founder's words on this page are the MAKEOVER-VERDICTS line and nothing else.
- ADR 0103 (D1 states, D3 silence, D4 clocks, D6 human gates, D7 reason classes, D9 lapse,
  A1 stock at the door, A6 not counted, A8 open clock basis, A9 vintage, A11 a difference
  must be answered), ADR 0104 D9/D13 (the paper surface; C's spine as the information
  architecture), ADR 0112 (three shapes; F9 the bottom sheet; F10 the seal before a ledger
  row; F12 the door's ten-minute undo-after), ADR 0138 (the ground), ADR 0140 (the outbox),
  ADR 0062 / migration `20260901220000` (the door's typed `outcome`), ADR 0070 (integer
  quantities with a stated unit), ADR 0054 / 0060 (unit arithmetic; a window is a floor)
- Sketch 089 (agreed-invoice directions — D13 chose *C leads, with A's sheet as the frame
  and B's verdict block on top*; the Recommendation argues this sketch is the desk that
  feeds that frame, not a second frame, and founder question 7 asks whether D13 binds
  `/receiving` at all), sketch 102/103 (overlay census and experience)
- `apps/api-gateway/src/procurement/canonical/delivery.service.ts` — `scanAgainstTheOrder`
  `:1682` (door_count and invoice only), `gradePairing` `:1844` (unmatched document lines
  only), `recordedDifferences` `:1239` and `:1261` (not_comparable leaves nothing to answer):
  the three lines the gate change in cost row B is written against
- `apps/web/src/pages/receiving/next/` — the built page this reworks; `rc-format.ts` for
  the em-dash / floor / unit contract every figure here follows
