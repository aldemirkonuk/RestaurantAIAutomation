---
sketch: 114
name: ask-page
question: "What is the unit of /ask on screen — the shelf of readings, the folio of asks, or the ticket of a reading being spent — given that ADR 0145 already fixed the unit on the wire?"
winner: null
tags: [ask, sommelier, mudavym, reading, finding, folio, shelf, provenance, refusal-shapes, seal, adr-0145, adr-0146, adr-0143, adr-0112]
---

# Sketch 114 · /ask — three directions for the page that answers out of a reading

## Design question

ADR 0145 settled what a builder must produce before `/ask` renders anything: a
**Reading** minted by the query that ran (R1), figures as cells whose ids must
resolve inside it, a discriminated union of reply shapes with no shared fallback
(R3, R4), a census of question classes so an unbuilt one fails to compile, and a
non-zero floor of readings with fixtures (R5). The founder's answers of 2026-09-12
closed the five forks: pick on Haiku, compose on Sonnet 5, a 60 s client budget on
`/ask` only; the model's own knowledge is allowed and marked as not from the house's
books; every house behind the same switch; `/sommelier` redirects here; the seal is
over the **order** at approval and the reading travels with the draft and is re-run.
On 2026-09-17 the founder added: the first floor is Codex's 15 house readings,
standing questions are not in v1, and the floating Wine Agent button goes — the page
and the ⌘⇧K panel are the two doors.

What none of that settles is **what the page is when you look at it**. The ADR's
own three options were named after their forcing functions — shelf, ticket, binding
— and the binding won on the wire. The same three nouns are still open as *screen*
units, and each makes a different page:

- **A · The Reading Room** — the shelf of fifteen readings is the page; asking is
  picking one; a reading opens as a Sheet.
- **B · The Book** — the folio of asks is the page; the open folio is a document
  (read first, sentence second, rows third, the trail of what became of the answer
  fourth); asking is writing the next line.
- **C · The Pass** — one ticket at a time in a single column, the reading spent on
  screen line by line, figures before the sentence.

Each direction draws the same eleven things the brief asked for — the shelf (what
can be asked, what is not built, honestly), the reading pane (figures that open to
their rows), the folio of past asks, all the reply shapes, a draft handed to
`/orders`, the 60 s budget running out, the model-knowledge channel visibly separate,
the states strip, the overlays open, a Turkish house, and 390 mobile — and answers
the open questions below differently on purpose, so the founder is choosing a shape
and a set of policies together.

## Revision, 2026-09-17

A design critic's pass found 19 defects (4 major, 15 minor) and this sketch was
revised against every one of them: the ADR 0146 ceiling now quotes the message that
actually ships (was drawing a wrong reset time); the Sim Meyhouse trace no longer
shows more matches than rows scanned; A gained a **1b** frame showing the page's real
resting composition (shelf plus book rail, nothing open) and its 390 book tab now
opens instead of sitting dead; B and C now draw all fifteen house readings (plus the
not-built and not-from-the-books groups) in their shelf surfaces, and B gained a
**7th** frame drawing the recommendation's own graft so it is no longer a
combination the founder would choose blind. Minors: Sheet close reads "Close", never
"×"; popovers are 320px (the primitive's default); small captions on charcoal moved
from `--ink-3` to `--ink-4` (OD-112, ADR 0042 row 30 — locked); the model-knowledge
paper gained a horizontal band alongside its rotated label; clashing folio/ticket
addresses were renumbered; clarify choices carry a row id in every direction; a
draft's absent price no longer claims "priced at approval"; the founder's
`/sommelier → /ask` answer is now drawn, not only written; and a second 429 — a
person's own rate limit, distinct from the spend ceiling — is now in every states
strip. Per the founder's 2026-09-17 style bar (row 38, ADR 0149), every direction was
then simplified toward the Wave Four / Arrival / Documents-and-Reports look:
ADR-citation prose that had leaked into in-frame copy (a footnote, a wire-kind label)
was cut or moved to captions outside the frame, while each direction kept its
distinct idea. Screenshots in `shots/` and every PNG were re-rendered and re-looked
at after these changes; the fixes above are what changed.

## The facts that shaped every direction before drawing

- **Codex's wire union has eight kinds, not six.** `bound-reply.ts` in the
  uncommitted `ask-readings/` module (`codex-rescue-2026-09-16/page-finalization/
  apps/api-gateway/src/ask-readings/bound-reply.ts:5-8`, `reading.types.ts:13-14`)
  carries `reading`, `model_knowledge`, `clarify`, `not_built`, `no_reading_matched`,
  `requirements_unsatisfied`, `not_in_your_books`, `could_not_read`. All three
  directions draw all eight so that none can fall into a default renderer. The two
  extras matter: `requirements_unsatisfied` is Option 1's computed requirement table
  (the reading matched, the registers lack what it needs — *"33 documents, 0 lines
  linked to an item"*), and `no_reading_matched` is the honest word for "neither a
  reading nor an act", which `out_of_scope` used to hide.
- **The folio is written before the model call, per person, per house.**
  `reading-folio.store.ts:36-47` inserts `ask_reading_folios` with `status:
  "pending"` before either model runs, keyed on `restaurant_id` **and** `user_id`,
  with `previous_folio_id` for versions and `origin: page | panel | standing`; `list`
  returns the newest 50 (`:64-70`). So a "book" exists in the backend already — but
  it is a *person's* book in a house, not the house's book (a fork below).
- **The reading travels with the order and is re-run at the hold.**
  `reading-commit.service.ts:26-31` (`assertCurrent`) throws `reading_changed` with
  `previous` and `current` Findings when the fingerprint moved; `attach` writes
  `procurement_orders.ask_reading_folio_id` (`:52-60`); `acceptChanged` writes the
  re-read as a **new** folio rather than overwriting the one the draft came from
  (`:64-85`). Every direction's `/orders` approval card is drawn from exactly those
  three behaviours, and the seal itself is the existing `HoldToApprove` with
  `onChallenge` (`apps/web/src/pages/orders/next/LedgerRow.tsx:512-518`,
  `onChallenge = ordersApi.mintOrderSeal(row.id)`).
- **The shelf has its scopes but no counts.** `reading-sources.ts:4-23`
  (`READING_SHELVES`) declares the non-scalar house keys ADR 0145 R6 demanded —
  `providers: "owned OR active junction; foreign owners refused; revoked link wins"`
  — but nothing counts rows per register for a house. `DevTruthService.reach()`
  (`apps/api-gateway/src/analytics/dev-truth.service.ts`) counts seven fixed sources
  and is dev-gated (ADR 0145 build item 5). Codex's `ask-ai/bound-ask.controller.ts`
  already serves `GET /ask/catalogue` (static, no counts), `POST`/`GET /ask/folios`
  and `GET /ask/folios/:id`, each carrying a second, tighter 429: 10/min per person,
  200/h per house — a state every direction now draws (states strip, "refused ·
  too fast"), separate from the ADR 0146 spend ceiling. What is new in every
  direction is the *counted* shelf — per-register and per-reading states minted from
  the queries that ran; it is smallest in C and largest in A.
- **Fork 1 rejected streaming the answer, not the trace.** ADR 0145's founder answer
  names "streaming the answer" as rejected because streamed prose is hard to bind to
  minted provenance. C's line-by-line arrival is a different thing — per-source
  progress events with no prose in them — but it is still plumbing that does not
  exist (only the MCP runtime streams anything today). Without it, C's loading state
  is one landing after the rule, and its lines are a replay of a finished trace.
  This is C's real cost and is named as a founder question rather than assumed.
- **The old sommelier loader is not reusable as a subject picker.** The census notes
  the Ask candidate loader reads only the scalar provider column
  (`ask-catalogue-and-source-census.md:43`); A's item popover and every clarify list
  need a house-scoped item search that lists the 53 blank-name rows by id rather than
  hiding them (ADR 0145 R9).

## How to view

```
open .planning/sketches/114-ask-page/direction-a.html
open .planning/sketches/114-ask-page/direction-b.html
open .planning/sketches/114-ask-page/direction-c.html
```

Each file renders from `file://` at 1440 with no server and holds, in order: the
desktop page for a US house (Larkspur & Vine, Oakland, USD, en-US); the same page for
a Turkish house (Sim Meyhouse, Kadıköy, TRY, tr-TR) — **locale formatting on an
English UI**: figures, dates and money follow the house's locale, every interface
word stays English, and only the operator's own question is Turkish; the eight reply
shapes each drawn; a strip of states (empty, loading with the 60 s rule, the budget
run out, refused by the ADR 0146 spend ceiling in the real message —
`apps/api-gateway/src/common/model-client/model-client.service.ts:297-301`: midnight
UTC plus a countdown, house time as a derived second line, never a bare "midnight,
house time" — refused by a person's own 10/min rate, partial); every overlay the
page opens, drawn open; and a 390 mobile rendering. A also carries a **1b** frame
between sections 1 and 2 — the shelf and book rail with nothing open, the page's
real resting composition. B carries a **7th** frame after mobile — the graft the
recommendation names (A's shelf as the first page, C's pick·read·composed lines as
the read line, inside B's folio). At 390 the desktop-only frames are cropped out and
the strips stack; the mobile section itself carries whatever frames that direction
needs (A: shelf, an open Sheet, the book tab opened; B: the index and an open folio;
C: an answered ticket and one that stopped). Screenshots are in `shots/`.

The ground is Warm Charcoal throughout — the decided `.mudavym` ground (ADR 0138,
`apps/web/src/styles/mudavym.css:45-65`); paper is the declared exception and is not
used here. The house header is the `HouseHeader` chrome `PageGate` mounts above every
next tree. Fonts load from Google in the sketch for convenience; the product
self-hosts its faces. No emoji anywhere. No Wine Agent FAB anywhere.

## The forks, as each direction answers them

| Fork | A · The Reading Room | B · The Book | C · The Pass |
|---|---|---|---|
| the page's unit on screen | **the shelf** — 15 readings as cards in register groups, each with a live state chip and a count line | **the folio** — one ask, one document with an address, versions and a trail | **the ticket** — the current reading with its pick, read and compose lines above the body |
| how you ask | pick a reading (subject popover if it needs one), or type; the Haiku pick is shown under the field before Sonnet spends | write the next line at the foot of the open folio | type at the top; the ticket is written under the field |
| where the shelf lives | the page itself, always visible, with "Not built yet" and "Not from the house's books" as shelf groups and "Not on the shelf: prices" as a footnote | one popover off "What can be asked" (a choice, so a Popover); the book's **first page** when nothing has been asked | the empty state is the typeset index; otherwise a Panel (the ⌘K palette's shape on `/reports`) |
| the answer's form | a Sheet (440): sentence with cells → drawer of the row (0fr→1fr settle) → the trace | the folio: read line **first**, then the sentence, then every cell as a row, then the trail | figures **first** at 44px, each a cell; the sentence beneath as a caption that may use only figures already shown |
| the figure opens to its rows | a drawer under the sentence inside the Sheet | the rows table is always on the page; a row opens the record in a Sheet | a drawer under the figure |
| the book of past asks | right rail, grouped by day, the open one marked | the left column, grouped by day, with a find field and a "what can be asked" tally at the foot | a stacked stream of stubs under the ticket; the whole book is a Sheet |
| the six (eight) shapes differ by | the card's silhouette (rule, hatch, dashed, other paper) | the **read line** first, then the card | the **lines above the body** — a denial visibly stopped at the line that failed |
| the clarify | a centred Panel (a question) | written into the folio as a pause with its choices | a Popover hanging off the ambiguous word in the pick line (a choice) |
| model knowledge | a shelf group of its own; the reply on other paper, in DM Sans, a running label, no cells | a folio with no read line, on other paper | a ticket with no read lines and a line that says so |
| the 60 s | a rule inside the Sheet | a rule inside the pending folio | **the page's top rule**, under the field, every line time-stamped |
| the draft | in the Sheet, a document with one provenance per field; "Hand to /orders" is an ordinary tap | the draft **is a folio** in the same book, so the order can point back at it | a ticket whose first line names the ticket it drew on |
| what `/orders` does | re-runs the reading at the hold; a moved figure refuses the seal and shows both | same, and the refusal and the seal are written back into the folio's trail | same, drawn in the ticket's line vocabulary |
| mobile | shelf two-up with a shelf/book tab; the Sheet is the screen | the index is the first screen; a folio is a screen; the next line pinned at the foot | the column is already a phone; figures two-up |

## Direction A — The Reading Room (`direction-a.html`)

**Idea.** The catalogue is the interface. Fifteen readings sit on a shelf in register
groups (Stock · Orders & receipts · Sales, calendar, vendors, targets), each card
carrying the reading's title in Fraunces, its canonical question, and a live state:
`readable` (seal dot, with the count line above), `none in the books` (hollow dot —
read and empty), `needs a linked line` (hatch — requirements unsatisfied), `count
failed` (hatch — *ask anyway*), `not built` (dashed card, in a group whose header says
"these are statements about Mudavym, not about the house's books"), and a last group,
on other paper, for what the model knows that is not from the books. Prices are not on
the shelf and the footnote says why (R6: no single house key). Typing is allowed and
the pick line under the field shows what Haiku chose — reading, subject, window,
relations — before anything is spent. A reading is one object, so it opens as the
right Sheet; a cell in the sentence opens its row in a drawer inside the Sheet.

**What it optimises.** Honesty by construction for a thin house. The founder chose
"every house, behind the same switch" (fork 4), and for the house that exists most
readings will decline; A makes that legible before a question is typed rather than
after. It also makes the 15-reading floor visible as a product surface, which keeps
the catalogue honest — a reading whose requirements go unsatisfied is on the shelf
with the reason, not silently absent.

**What it costs.** The page is a menu, and it reads like one; the question box is
demoted. The Sheet is narrow for readings with many rows (the primitive's wide
variant is 640, `sheet.css:124-125`). The shelf endpoint is the biggest of the three
— per-register counts **and** per-reading states, minted from queries (R1) with R6
keys and R7's `not_in_service` — and A's whole face depends on it being right; the
partial state shows what a failed count looks like so a broken counter cannot hide a
readable reading. Frame **1b** draws the composition the founder never saw in the
first pass — shelf and book rail, nothing open — and the mobile section now opens
the book tab (previously a dead label) while marking the shelf tab plainly as a
shortened sample rather than hiding nine readings silently. Build: the shelf
endpoint (new, `DevTruthService.reach()` generalised past seven sources and
un-gated); a house-scoped subject search (new); the folio list
(`ReadingFolioStore.list`, exists, 50 cap); the Sheet/Panel/Popover primitives
(exist); the reply renderers (new, eight).

## Direction B — The Book (`direction-b.html`)

**Idea.** The page is a ledger the house keeps. The left column is the book's index —
asks by day, each with its outcome chip and folio number, a find field, and at the
foot a one-line tally of what can be asked. The main pane is the open folio as a
document, in the ADR's order of computation: the **read line** (relations, scanned
and matched counts, as-of, seconds of the 60 spent, which model picked and which
composed) sits above the sentence; the sentence carries the cells; the rows table
lists every cell in the Finding whether the sentence used it or not; the **trail**
lists what became of the answer — drafted into PO-0231, seal refused at 4:05 PM
because the re-read said 5 not 7, sealed at 4:07 PM on folio 0233 — and the auto-send
unknown is a line that says the book cannot see that decision. Versions are chips:
a re-read makes v2 and keeps v1. The next line waits at the foot; the shelf is one
popover away and is the book's first page when nothing has been asked.

**What it optimises.** The one property the ⌘⇧K panel structurally cannot have,
which ADR 0145 named as the reason the page exists at all: memory. Every ask has an
address, a version and a history; a two-week-old answer says *as of* and offers
*read again* instead of re-asserting itself; and the draft, the refused seal and the
seal are all findable from the question that started them. It also gives the
correlation id (build item 11) a home a person can read, not only `/logs`.

**What it costs.** A thin house sees a thin book; the first page must carry the
shelf or the page is blank. The index and the folio are two reads, and the partial
state is B's sharpest edge: a failed index must never be drawn as an empty book,
which is precisely the `/sommelier` fault (`fetchConversations` caught and returned
`[]`). The trail needs joins that exist only in part: `proposal_id` on the folio
(exists), `procurement_orders.ask_reading_folio_id` (Codex's commit service selects
it; a migration is needed in the reserved range `20260913190800`–`20260913191100`),
and the audit row's `correlation_id` (ADR 0145 item 11, not built). Search in the
book is a new filter. Build: the folio-by-address route `/ask/f/:id`
(`ReadingFolioStore.get`, exists); versions (`previous_folio_id`, exists); the
trail (new join); the shelf popover (the same shelf endpoint as A, smaller face);
the row Sheet (exists); the reply renderers (new, eight).

## Direction C — The Pass (`direction-c.html`)

**Idea.** One column, one ticket. The 60 s rule runs under the field; the ticket is
written beneath it line by line — `picked` (the reading, subject, window, Haiku,
+0.31 s), `read` (relation, scanned, matched, as-of, +0.92 s), `composed` (Sonnet 5,
cells bound, +1.80 s) — and then the **figures**, big, first, each one a cell with its
provenance under it (*stock_live · stated*; *threshold_min · = column default*,
dashed, marked *assumed*), and only then the sentence, set smaller as a caption that
may use only figures already on screen. A denial is a ticket that visibly stopped:
the failed line is hatched with its code and the seconds it cost, the lines after it
say *not attempted · no model was called*, and the band beneath says what Mudavym
does not know. Earlier tickets stack beneath as stubs; the whole book is a Sheet;
the shelf is the empty page and a Panel.

**What it optimises.** Trust through visible work. ADR 0145's accepted cost —
latency spent on screen deliberately — becomes the page's material: a person watches
the house being read and can see exactly where a reading stopped and how long each
source took. The figure-first body is the strongest reading of the binding: a number
never appears for the first time in prose.

**What it costs.** Its best moment (the loading state) needs per-source progress
events that do not exist; ADR 0145's fork 1 rejected streaming the *answer*, and a
trace stream is new plumbing on both sides even though it carries no prose. Without
it the lines land together after the rule and the ticket is an honest replay of a
finished trace, which is still good and is how the sketch should be read if the
founder says no. The elapsed-per-line figures need the runner to stamp durations
(`SourceTrace` has `asOf` per source, `reading.types.ts:28-36`, but no elapsed).
History is second-class; the page is the tallest of the three. Build: the shelf
endpoint (smallest face: the index in the Panel); the book Sheet (`list`, exists);
per-line timing (small addition to `recording-session.ts`); optional progress
events (new, founder's call); the reply renderers (new, eight).

## What all three share

- **The runner mints, the page renders.** Every count, every as-of, every failed
  source on every page is drawn as if from `Finding.trace` (`SourceTrace {relation,
  operation, outcome, rowsScanned, matchedRows, asOf, failureCode}`) and never from a
  string a builder could type. The shelf's counts are drawn from the same discipline
  (R1 applied to the shelf endpoint), and a register that could not be counted is
  hatched, never 0.
- **Cells carry two axes.** `{source: house | library | model}` decides the paper
  (house readings on charcoal in Fraunces; the model's knowledge on `--paper-1` in DM
  Sans, a horizontal "Not from the house's books" band plus the rotated running label
  as extra — the vertical label alone read poorly at 390 — and no cells);
  `{provenance: stated | defaulted | derived
  | not_recorded}` decides the underline (solid seal, dashed with *assumed*, dotted,
  hatched box). A figure resting entirely on defaulted cells renders as an assumption
  in the sentence itself — "a threshold of 3 that nobody in the house set" (R8).
- **Two denials that can never look alike.** *Not in the house's books* shows a read
  with 0 scanned and a time; *could not read* shows a hatched failed source with its
  code and *read again*. Neither is ever a blank. The possessive is banned for
  registers Mudavym does not keep (R7): "Mudavym does not keep these yet", never "0
  in your books".
- **Ambiguity is a person's pick.** Every clarify lists the matching rows by id and
  label, includes the blank-name rows as *(no name recorded) · 2f31…8c*, and says
  "Mudavym will not choose" (R9). The three directions place it differently (Panel,
  in-folio, Popover) and the README's fork table says why.
- **A draft is a document, not a message.** Verb line; one provenance per field in
  the ADR's three phrases — *from the books* (with its cell), *you said it* (quoting
  the span), *Mudavym's suggestion, from nothing*; a field with none is drawn as
  **absent** with the reason (no verified receipt line → no price in the draft), so
  the proposer cannot invent a number; *removes* renders even when it is *nothing*;
  the auto-send unknown is stated in the ADR's words. "Hand to /orders" is an
  ordinary tap (fork 3).
- **The seal is on `/orders`, and it re-runs the reading.** `HoldToApprove` with
  `onChallenge` (`pour` fill, `stamp` landing); the attached reading is shown with
  its fingerprint; a moved figure refuses the seal and renders both numbers with
  both times (`assertCurrent` → `reading_changed`); "Accept the current reading"
  writes a new folio (`acceptChanged`). The confirm on `/ask` is not sealed.
- **The 60 s is a state, not an error.** The folio row exists before the model call,
  so the budget running out leaves a pending folio in the book with every line that
  did land, and the words "nothing was invented and nothing was drafted". The
  ADR 0146 ceiling renders as 429 in the ceiling's own words with the reset time in
  house time; the shelf and the book still read because a stored answer costs no
  model call.
- **Overlays under ADR 0112**: Sheet (440, `tuck`) for one object — a reading (A), a
  row (B), the book (C); Panel (620, `settle`) for a question or a browse — the
  clarify (A), the shelf (C); Popover (`ink`, anchored, 320 — the primitive's
  default, `Sheet.tsx:204,282`) for a choice — the subject (A), the shelf (B), the
  clarify (C). Every Sheet closes on the word "Close" (`sheet.css:193-196`), never a
  "×" glyph.
- **Motion** is the seven tokens of `lib/mudavym/motion.ts` and nothing else:
  `settle` for the drawer and the folio/ticket swap, `ink` for chips and hovers,
  `tuck` for the Sheet, `pour` only for the 620 ms hold fill, `stamp` only for the
  seal landing on `/orders`, and `tally` deliberately unused — a count that animates
  looks measured while it is still moving. The 60 s rule's bar is **not** `pour`: it
  is elapsed-driven, `width` tied to seconds spent rather than to a fixed-duration
  token, drawn linear because the person is timing it. The skeleton sheen is the
  dashboard's (`dashboard-next.css:44`). Reduced motion renders end states; C's
  pending pulse becomes a static dot everywhere it appears, including the timeout
  line in the states strip.

## Founder questions these embody

1. **What is the unit on screen?** The wire unit is settled (a Reading); the page's
   is not. A says the catalogue, B says the folio, C says the ticket. This is the
   whole choice, and a graft is possible: B's page with C's lines above the body and
   A's shelf as the first page.
2. **May the trace arrive line by line?** Fork 1 rejected streaming the answer. C's
   loading state needs per-source progress events (no prose in them). If no, C is
   drawn as a replay of a finished trace after one landing, and its main advantage
   over B shrinks to the figure-first body.
3. **Figures first, or the sentence first?** C leads with 44px cells and makes the
   sentence a caption that can only use figures already shown; A and B lead with
   the sentence. Figure-first is the stricter reading of the binding; sentence-first
   reads more like the house speaking.
4. **Whose book is it?** Codex's store keys on person **and** house
   (`reading-folio.store.ts:23-25`, `list` filters `user_id`). A draws "your asks in
   this house"; B and C draw "The book · Larkspur & Vine" as if a manager could see
   the owner's asks. Either is buildable; a house book needs a read policy and RLS
   the store does not have today, and it changes what the trail may show.
5. **Should the Haiku pick be confirmable before Sonnet spends?** A shows the pick
   under the field and offers "Not this reading?"; B and C run through. A second tap
   costs seconds on every ask; running through costs a Sonnet call on a wrong pick.
6. **Does the trail belong on `/ask`?** B pulls the draft, the refused seal and the
   seal into the folio. The alternative is `/logs` owning the correlation and `/ask`
   linking out. Item 11 (the `correlation_id` producer) is needed either way.
7. **Where does a thin house land?** A: a shelf of mostly declines with the reasons.
   B: the first page is the shelf. C: the index. All three refuse a readiness floor
   (fork 4), but they differ in how much of the page is about what cannot be asked.
8. **Search in the book (B) — v1 or later?** It needs an `utterance` filter on
   `ask_reading_folios`; nothing else on the page needs it.
9. **Is `/ask` the mobile door?** The Ask AI panel has no mobile surface
   (ADR 0145 "not settled"). Every direction draws 390; B's index-first phone is the
   only one that is better on a phone than on a desk.
10. **Does a draft ever carry a price?** Every draft shows unit price as absent (no
    verified receipt line), and `/orders` shows `$—` at both the hold and the
    approved seal — nowhere in any direction is a price ever set before the seal
    commits the order. Either a step needs drawing where a price enters (from a
    vendor reply? a manual entry at approval?), or this is named plainly: the seal
    can commit an order whose price is unknown, and that is accepted.

## Recommendation

**B, The Book, with two grafts: C's lines above the body (pick · read · composed,
with their instants) as the folio's read line, and A's shelf as the book's first page
and its popover.** Frame 7 in `direction-b.html` now draws exactly this combination,
at 1440 and 390, so the choice is no longer one the founder would be making blind.
Reason: the page's only structural advantage over the ⌘⇧K panel is memory — a folio
with an address, a version, and a trail — and B is the direction built on that
advantage rather than beside it. It also spends close to the least on new surface:
the folio store, versions (`previous_folio_id`), the reading attached to the order
and the re-read as a new folio all exist in Codex's module; the trail is one join and
one migration in the reserved range, **plus** the `correlation_id` producer (build
item 11, not built) and a new `utterance` search filter on `ask_reading_folios`
(question 8) — B's full cost, not the joins alone. The shelf endpoint is needed by
every direction and B gives it the smallest face. A makes the page a menu, and for
the house that exists it is a menu of declines; its best idea — the pick shown before
Sonnet spends — grafts onto B's next line for free. C is the most honest *picture* of
a reading and should shape the read line everywhere, but its live lines need plumbing
the founder rejected for the answer and, without them, C is B with the book demoted
to a sheet.

The one thing to decide before building B: **whose book** (question 4). If it is a
person's book, the trail may name only what that person did; if it is the house's,
the store needs a house-read policy first.

## Shortcuts stated

- No endpoint was called and no database was queried. Every "exists / new" claim is
  read from the tree at `feat/mudavym-finish` (`60ed83a7`) and from Codex's
  uncommitted `ask-readings/` module at
  `codex-rescue-2026-09-16/page-finalization/`, whose `source_commit` is the same
  `60ed83a7`. The register counts on the shelves are **invented example data, not a
  tenant's** — some drawn near the census's 2026-09-13 aggregate figures
  (`ask-catalogue-and-source-census.md:65-83`) and some well above it: US
  `pos_checks` 312 exceeds the census's house total of 145, `restaurant_inventory`
  206 is the 2026-09-03 figure the ADR itself used (the census's own count is 183),
  and the 74 + 119 consumption rows drawn across the two houses exceed the census's
  119. None of it should be read as a real house's numbers.
- The Turkish house is drawn with a receipt line linked to an item so that
  `receipts.verified_line` can answer with money in TRY; the live census has
  `procurement_document_links` at 0 in every house. The sketch says so in the B
  section-2 note.
- Turkish formatting follows `Intl` for `tr-TR` (`₺1.240,00`, `3.150 ml`,
  `12.09.2026`) but was not rendered through the product's formatter. Locale
  formatting on an English UI; translation is not drawn.
- The elapsed-per-line figures in C (`+0.31 s`) are drawn; `SourceTrace` carries
  `asOf` and no elapsed today.
- The sketches carry no `data-ux-key` attributes; signals are a build concern.
- The route, the flag and the `MUDAVYM_PAGES` entry for `ask` exist only on
  `origin/feat/mudavym-new-pages` (ADR 0145 build item 13); `App.tsx:409` on this tree
  still routes `/sommelier` to `SommelierAI`. Nothing here depends on either. The
  founder's fork-5 answer (`/sommelier` redirects into `/ask`, bookmarks kept) is now
  drawn as a one-line note in section 1 of all three directions, not README prose
  alone.
- Every `file:line` above was re-checked against the `feat/mudavym-finish` worktree
  and the Codex module on 2026-09-17 — including two corrected this pass:
  `reading.types.ts:13-14` (not 15-16) and `reading.types.ts:28-36` (not 32-40).

## Files

- `direction-a.html` — The Reading Room.
- `direction-b.html` — The Book.
- `direction-c.html` — The Pass.
- `shots/direction-{a,b,c}-1440.png`, `shots/direction-{a,b,c}-390.png` — full-page
  renders via `p4-scratch/render-sketch.mjs`; zero console errors, no horizontal
  overflow at either width, every PNG looked at.

**Example data, not a tenant** — Larkspur & Vine, Sim Meyhouse, Maya, Deniz, Skurnik,
Doluca, the Vajra Barolo and the Çankaya Kalecik Karası are invented for the drawing.
Folio and ticket numbers, fingerprints and row ids are illustrative.
