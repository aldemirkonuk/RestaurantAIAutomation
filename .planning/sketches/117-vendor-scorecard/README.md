---
sketch: 117
name: vendor-scorecard
question: "The founder replaced 'vendor sentiment' with an operational vendor scorecard — what vendors DO, measured from the house's own records. What does that scorecard look like, where does it live, and how does it refuse when the records are too few, not collected, or could not be read?"
winner: "A, with B's Roll Call as a second /providers view and C's Docket as the rows behind each figure — founder 2026-09-21; built as ADR 0207"
tags: [vendor-scorecard, providers, documents-reports, sorting-office, twin-sheet, on-time, receiving-verdicts, agreed-price, reply-latency, credits, shadow-run, labelled-evaluation, windowed-trend, adr-0103, adr-0104, adr-0054, adr-0112, adr-0138, adr-0149, mudavym, directions, sketch-only]
---

# Sketch 117 · The operational vendor scorecard — three directions

## Design question

On 2026-09-17 the founder answered "what should vendor sentiment be" with **an operational
vendor scorecard**: what vendors *do*, measured from real records — on-time delivery (the
delivery clocks of ADR 0103), short / refused / damaged lines (receiving verdicts, which
ADR 0149 row 23 is turning into append-only records), price against the agreed price (the
agreed invoice of ADR 0103/0104; ADR 0054's *landed vs agreed* is Proposed, so only built
behaviour is used), reply latency on vendor mail, credits promised against credits recovered
(the receipts credits lane); message tone as a **minor input only**; every figure opening to
its rows; a **labelled evaluation and a shadow run before any alert ships**; and **windowed
trend maths, never newest-against-oldest**.

The research that produced this brief (`scratchpad/backend-1/sentiment-research.md`, on
`origin/main` @ `60ed83a7`) found the sentiment feature **hollow**: two unrelated writers of a
label, no evaluation, no calibration, `provider_sentiment_history` at **0 rows** in production
(`decisions/OD-72-rls-census.md:307`), `provider_performance_metrics` at **0 rows** with a
reader and no writer, `procurement_conversations` at **27 rows from one vendor**, a Python
trend that reads a flat series as *declining* (`provider-intelligence.service.ts:399-404`,
first point against last), and a live cross-tenant read on
`GET /providers/intelligence/compare`. ADR 0149 row 25 decided the conversation list lives
**only on `/communications`** and asked for that research; this sketch is what comes after it.

**Where the scorecard lives is part of the question.** The founder's `/providers` verdict is
MERGE — keep today's *small buckets*, put the learned facts *in the sheet*, and let the card
carry at most three facts plus **one behavioural fact** (`MAKEOVER-VERDICTS.md:129-132`,
`:337-346`). His `/documents-reports` verdict is REWORK, *"three more sketches"* (`:153-156`).
The Wave Four snapshot (`origin/claude/artifact-pull`, `mudavym-wave-four.md`) carries no
`/providers` or `/documents-reports` entry at all — its only scorecard mention is under
`/reports`: *"basket and vendor-scorecard cuttings — real endpoints, held back because their
payloads were not read closely enough"*. So the three directions are three different ideas
of what a scorecard **is**, and each puts it in a different home:

| | A · The Ledger Card | B · The Roll Call | C · The Docket |
|---|---|---|---|
| The scorecard is… | one vendor's five measured lines, each a fraction with its denominator | the house's vendors side by side on five measures, with minimum-sample refusals | one vendor's day book — every scored event, in time order, and the tallies as sums of the entries shown |
| Lives in… | the **TwinSheet** on `/providers` (a new section, *What they did*) + one line on the bucket card | a **second view of `/providers`** — Book · Scorecard | a **sixth drawer in the Sorting Office** on `/documents-reports`, with the docket as the reading pane |
| A figure opens to… | a rows sheet per measure (level two of the spindle, 103 1c) | the same rows sheet, from a cell | nothing — the rows are already on the page; a tally filters them |
| Shadow run drawn as… | a dashed box at the foot of the sheet, one candidate, three labels | a band under the table, three candidate cards, a centred label panel | a dashed **marker in the timeline** at the date it would have fired, labelled by popover |
| Refusal for staff | the whole card withheld, labels kept, em dashes | the whole view withheld, the segmented control kept | **by kind**: money entries withheld, door entries drawn |

## How to view

```
open .planning/sketches/117-vendor-scorecard/direction-a.html
open .planning/sketches/117-vendor-scorecard/direction-b.html
open .planning/sketches/117-vendor-scorecard/direction-c.html
```

Each file renders from `file://`, no server. Section 1 is the page at desktop width for a USD
house (Harbor & Vine, Brooklyn); section 2 the overlays drawn open (A: two rows sheets; B:
popover · sheet · centred panel; C: the delivery sheet · two popovers) at the product's numbers
— sheet `width:100%; max-width:440px` (`sheet.css:112-113`), panel `margin-top:10vh; width:
min(620px, 100vw − 32px)`, radius 14 (`:41-45`), popover radius 14 (`:149-154`); section 3
the same surface for a TRY house (Meyhane Kalamış, Kadıköy) where currency, date format and
the e-İrsaliye response window change what a line can say; section 4 the states (too few ·
nothing to score · loading · read failed + not collected · refused); section 5 the same
markup in a 390 px container with the overlay at phone shape (bottom sheet at its upper
detent, 103 1c). Screenshots in `shots/` — `direction-{a,b,c}-1440.png` whole and
`direction-{a,b,c}-390.png` (the **whole file** at a 390 viewport; the phones inside the
1440 shots are the truer phone rendering, because the sketch's own wrapper padding narrows
the section-1 product frame to ~350 px in the 390 files).

**Fonts.** The sketch loads Fraunces, DM Sans and JetBrains Mono from Google Fonts so it
renders standalone; the product self-hosts its faces (`index.html` carries the sans and the
mono; Fraunces is injected at runtime by `vp-format.ts` `ensureFraunces`, per sketch 112 —
whether it should be self-hosted is not this sketch's call).

**Example data, not a tenant** — every vendor, order, invoice, claim, person and date is
invented for the drawing. The endpoints cited are real; the numbers are not. The same
invented Skurnik record (14 counted deliveries + 1 with no expected date; 2 late by 3 and
1 days; 3 verdict lines; 4 invoice lines above agreed, mean +2.1 %; 9 replies, median
5 h 40, 2 unanswered; claims C-77 credited $182.50 of $182.50, C-81 credited $103.50 of
$118.00, C-88 promised $112.00 and open 39 days — recovered **$286.00 of $412.50**) runs
through all three files, so the directions can be compared on the same facts.

---

## The five measures, and what is built behind each

This is the part that decides the cost of every direction, so it is stated once.

| Measure | The rule drawn | What exists | What does not |
|---|---|---|---|
| **On time** | landed at or before 23:59 on the vendor's stated `expected_delivery_date`; no expected date → listed, not counted | exactly the rule `getVendorScorecard` already runs (`advanced-analytics.service.ts:315-321`: `delivered_at <= expected_delivery_date T23:59:59Z`, `onTimeRate = onTime / withEta`, `null` when no ETA), on `procurement_orders.expected_delivery_date` / `delivered_at` (baseline `:4533-4534`), over `ORDER_ARRIVED_STATUSES` which includes `PARTIALLY_RECEIVED` on purpose (`order-status.ts:27-45`). ADR 0103's `deliveries` row carries `delivered_at`, `agreed_at`, `verified_at`, `provenance`, `order_id` (`20260903160000:77-99`, `20260905232000:49`) | the payload is a **rate with no denominator, one fixed 365-day window, no prior window, no per-row link** — and `GET /analytics/vendor-scorecard/:restaurantId` (`analytics.controller.ts:808`) is house-wide, not per vendor |
| **Lines as ordered** | lines with no short, refused or damaged verdict at receiving | one verdict per **order**: `procurement_orders.match_status`, read back as `verdict` by `GET /procurement/receiving/orders/:id/received` (`receiving.service.ts:813`); the vocabulary is `MatchVerdict` (`invoice-match.ts:73`, `:704-714`: `qty_short`, `short_shipped`, `rejected`, `price_variance`, …); ADR 0103 D7's reason classes on delivery proposals (`SHORT_SHIP`, `DAMAGED`, `SUBSTITUTION`, …) are rows | a **line-level, append-only verdict record with a person and a photograph** — ADR 0149 row 23 says that is the shape to build; the drawings assume it |
| **Price as agreed** | invoiced lines whose unit price equals the order's confirmed price, in the agreement's currency; lines with no agreed price are *not comparable* and counted beside the figure | the agreed price with its stated unit (`agreed-price.ts`, ADR 0119), the invoice match per order (`invoice-match.ts`), ADR 0104's canonical document with per-field provenance | a **per-vendor, per-window read of invoice lines against agreed lines**; *landed vs agreed* (ADR 0054) is Proposed and **not drawn** |
| **Reply time** | hours from our message to the vendor's next reply in the same thread, median over the window; unanswered messages listed as open, not counted | `procurement_conversations` has `direction`, `sent_at`, `received_at`, `thread_id`, `parent_message_id`, `thread_key` (baseline `:4294-4331`) — everything the arithmetic needs | **no read computes it anywhere**; `provider_performance_metrics.avg_response_time_hours` has no writer (baseline `:4786`; research §1) |
| **Credits** | the amount the vendor **allowed** on claims settled by a credit memo, over the amount asked on every claim opened in the window; a promised claim is in the denominator only | the whole lane: `GET /procurement/credits?state=&providerId=` (`credits.controller.ts:94-121`), `/stats` (`:123-160`, *"claimed is not recovered"*), `POST :id/transition` (`:164`); states `open · requested · promised · credited · rejected · written_off` (`credit-ledger.ts:21-23, :57-61`); `credited` **requires** `credited_amount` and `credit_document_id` (baseline `:4367`); `promised_at` (`:4358`) | the `/receipts` credits lane itself is not yet on the Mudavym page (`ReceiptsNext.tsx:77`: *"that tab renders the legacy page until a credits lane exists"*, ADR 0149 row 22) |
| **Tone** (minor) | a model's reading of the vendor's replies, unlabelled, **in no figure** | the Haiku label on inbound rows (`inbound-responder.service.ts:722, :848`) | any evaluation, any labelled set, any definition of the construct (research §4) |

Two things every direction refuses, because the built code got them wrong once: the trend
is **a window against the window before it, both counts printed**, never first point against
last (the fault at `provider-intelligence.service.ts:399-404`), and never a regression slope
over the whole series presented as movement (`trendPerPeriodPct`, `statistics.ts:276-283`,
which the analytics scorecard uses for unit price); and **the minimum sample is per measure**
— 5 deliveries in the window for the delivery-borne lines, 5 replies for the reply line —
so a vendor's reply line can score while its delivery lines wait, and the refusal is a
sentence with the count, never a dash that reads as zero or a blank that reads as clean.

---

## Direction A — The Ledger Card (`direction-a.html`)

**Idea.** The scorecard is **inside the vendor's sheet**, where the MERGE verdict put every
learned fact. The bucket card keeps its three facts (open orders · lead time · contact —
`BucketCard`, `ProvidersNext.tsx:44-116`) and gains the **one behavioural fact** the verdict
allows (`MAKEOVER-VERDICTS.md:340-346`), as a fourth row *Did · 90 d — 12 of 14 on time*;
the fact is the first line of the sheet, never a score. In the TwinSheet
(`TwinSheet.tsx:73-151`: facts · usual currency · terms · the twin) a new section, *What they
did*, holds **five lines, each a fraction with its denominator printed**, the sentence that
says what was excluded and why, the prior window's fraction beside it, and a link whose
count equals the rows behind it. *Tone* is a sixth, minor line — *1 of 9 read as terse ·
0 of 9 labelled by a person*. A *How this is scored* turn prints the arithmetic in words;
a dashed **shadow run** box at the foot shows the one candidate that would have alerted for
this vendor and takes a label.

What is drawn: the grid with the *Did* row on six cards (two of them refusing in italic —
*2 deliveries — too few to score*, *no orders — nothing to score*); the sheet with its
existing sections intact and the ledger card last; two of the five rows sheets (*On time ·
14 deliveries, 12 by the expected date*, with the no-expected-date row struck and the rule
in words; *Credits · 3 claims, 2 credited*, where C-81's $103.50 allowed of $118.00 asked
is on the row, not hidden in the total, and C-88 is *promised, not recovered*, aged 39 days);
the Turkish sheet in TRY with the ADR 0103 D3 sentence on the on-time line (*two e-İrsaliye
response windows closed by silence — recorded as what the law deems, never as this house
agreeing*) and a reply line that compares nothing because the prior window had 4; four
state frames; the phone with the sheet as a bottom sheet opened directly on *What they did*.

**Optimises for:** the smallest distance from the built page and the verdict — the vendor
is a small closed card, the learned facts are in the sheet, and the card promises one thing
it can prove.

**Costs to build.**
- Existing: everything in the table above; `GET /providers` (`providers.controller.ts:272`),
  `GET /providers/:id/orders` (`:450`), the credits list by provider, the TwinSheet and its
  `Sheet` (ADR 0112).
- Missing — **one new read and five rows reads**:
  1. `GET /providers/:id/scorecard?window=30|90|365` — five fractions **with denominators**,
     the excluded counts with their reasons, the prior window's fractions, the per-measure
     minimum, and the row counts that back each link. `getVendorScorecard` is the nearest
     built thing and returns none of that shape; it is per house, one window, rates only.
  2. Deliveries **by provider** — `GET /procurement/deliveries` takes only `state` and
     `limit` (`deliveries.controller.ts:62-80`).
  3. Receiving verdicts by provider at **line** level (ADR 0149 row 23's record).
  4. Invoice lines against agreed lines, by provider and window.
  5. Reply latency over `procurement_conversations`, by provider and window.
  6. The shadow run: a table of candidates (rule, fired-at, evidence) and **labels with a
     person's name**, appended never replaced — no such table exists.
- The card's *Did* line needs the scorecard read for every card on the grid, i.e. B's
  house-wide shape, or one call per card. `useProvidersNextData.ts:12-14` says the card
  invents no behavioural figure the backend does not hold — the read must land first.
- Not drawn, and a question: the legacy *What the platform has learned* panel
  (`ProviderIntelligencePanel`, paper ground, `TwinSheet.tsx:139`) — A's ledger card takes
  its place at the foot of the sheet; whether the legacy panel stays below it or retires with
  the sentiment tab is the founder's call.

**Honesty traps handled:** missing is not zero — a vendor with no orders gets a sentence and
two actions, no lines; a register that did not answer says so *on its line* (502, 09:41),
and a measure that is not collected (no mailbox linked) says *not slow — unknown*; promised
credit is not recovered money (C-88 aged, in the denominator only); received stock is not
verified invoice cost (the on-time line is the door, the price line is the invoice, and they
never share a count); generated text is not evidence (tone in no figure; the shadow alert is
a question with three labels, and the label is a record with a name); a figure opens to its
sources (every line's link count equals its rows). A conditional refusal is printed with the
window that *would* score (*365 d · 7 of 8 — that window scores*).

## Direction B — The Roll Call (`direction-b.html`)

**Idea.** The scorecard is the manager's **comparison** — a second view of `/providers`
(Book · Scorecard) that puts every vendor on one table, five measures across, **every cell a
count over a count with the prior window beneath it**. Rows are ordered by deliveries in the
window (a scanning order, not a rank); sorting by a measure sends rows that cannot score to
the bottom **in their own group**, never among the scored. A cell that has not earned a
figure is an italic sentence with the count that explains it — *too few — 2 of 5*, *not
collected*, *no agreed price — 418 of 418 not comparable*, *nothing to score* — and the two
footnotes say what *not comparable* is (not a miss) and why *tone is not a column*. Under
the table, the **shadow run band**: candidates as cards, a person's label as a record, the
gate stated in words (*nothing ships until a labelled set exists and the shadow run agrees
with it — how many labels and how much agreement is a decision this sketch does not take*).

What is drawn: six rows, four scored, on the USD house; the three ADR 0112 shapes — a
**popover** on a column head (*How this column is counted*: numerator, denominator, what
*agreed* means, why the sort groups the refusals), a **sheet** from a cell (*Winebow ·
41 lines with an agreed price, 37 at it*, with Ch. Musar at $31.40 on two invoices running
and the sentence *a new agreement is a record, not an inference*), and a **centred panel**
whose first sentence is its contract (103 1e: *Would this have been worth an alert? Your
answer is a labelled record; it changes no figure and sends nothing*); the Turkish house
fully in Turkish (a fish vendor with market lines and no agreed price at all, a beer vendor
that settles in 4 days, Kavaklıdere with two windows closed by silence, a rakı vendor at
3 of 5, an olive-oil vendor with no orders); five state frames; two phones — the table as
one block per vendor, and a cell's rows as a bottom sheet.

**Optimises for:** the question a manager actually asks on a Monday — *which vendor is
slipping, against which* — answered without a grade, and the honesty of a comparison that
refuses to compare what it cannot.

**Costs to build.**
- Missing — **A's five rows reads, plus the house-wide read and the view**:
  1. `GET /providers/scorecard?window=` — one row per vendor in the shape of A's read, with
     the per-measure minimum applied per cell. `getVendorScorecard` is the nearest thing and
     has the wrong shape for the same reasons.
  2. The Book · Scorecard segmented control on `ProvidersNext` and `?view=scorecard` in the
     URL — a change to the built page.
  3. The shadow tables, as A; the centred panel writes the label.
- The sort's refusal grouping and the footnotes are client-side over the read.
- A Turkish UI (*Tedarikçiler · Defter · Karne*) is drawn; the product's chrome is English
  today and no record decides translation — B's drawing makes that question visible.

**Honesty traps handled:** as A, with three more that only a table raises — a **table with
no rows is not drawn** (an empty book gets a sentence; a table of dashes would read as six
clean vendors); a register that fails house-wide is written **in every cell of its column**
(*did not answer · 502 · 09:41*), not once in a banner someone scrolls past; and a cell that
refuses stays out of the sort, so *too few* never ranks above or below a real figure.

**What it costs the reader:** in the production corpus as measured (27 conversations from
one vendor; 0 performance rows) the Roll Call is a table of italics for months, and a page
of refusals is a weaker page than a card that promises one thing.

## Direction C — The Docket (`direction-c.html`)

**Idea.** *Provenance over arrangement*, taken literally: **the record is the score**. The
scorecard is a **day book per vendor** in the Sorting Office (`DocumentsReportsNext`,
direction D: named, countable drawers, `:498-722`) — a sixth drawer, *Vendors*, one line per
vendor, and a reading pane that lists **every scored event** the registers hold for that
vendor in the window, newest first: a delivery landed (*on time* / *+3 d late*, with the
door count), a line short or refused at the door (a verdict with a person and a photograph),
an invoice with its lines above agreed, a reply with its hours in the same thread, a credit
memo with what was allowed of what was asked, a claim *promised* and aged. The **five tallies
at the top are sums of the entries beneath them**, and each tally is a filter: press it and
the entries that remain are its rows. There is no rows sheet because there is nothing behind
the figure that is not already on the page. A **window rule** is drawn in the list where the
arithmetic starts; the prior window is folded beneath it, compared **as a window**. The
**shadow run is a marker in the timeline** at the date it would have fired, with its rule,
its label and the labeller's name, and a popover to add a label. An entry opens its own
record: the delivery **sheet** is ADR 0103's spine (expected · landed · door count · invoice ·
agreed, with which rule fired · verified · clocks) and ends with *What this delivery
contributes* — 0 of 1 on time, 14 of 14 lines, 13 of 14 at the agreed price, *replies are
their own entries*, *no claim on this delivery*.

What is drawn: the Sorting Office with the Vendors drawer open on Skurnik and 18 of its 30
entries (the rest folded with their counts); the delivery sheet and two popovers (the label
as a choice; *How Credits is counted* as the rule); the Turkish docket with a kind of entry
the US house never has — a **clock**, the e-İrsaliye response window that closed by silence,
printed as an entry that contributes to no tally and says why; five state frames, including
**loading by register** (three registers answered and their entries are drawn; two are
shapes) and **refusal by kind** (staff see deliveries, verdicts and replies in full; money
entries are withheld with a sentence and their tallies are em dashes); the phone with the
drawer open and the docket beneath.

**Optimises for:** the strongest possible reading of *every figure opens to its rows* — the
figure and its rows are one surface — and the one thing no competitor holds: the papers and
the door count behind every number.

**Costs to build.** The most of the three:
1. `GET /providers/:id/docket?window=` — a **union of five registers as dated entries**, each
   carrying its contribution to each tally, with the tallies computed from the same rows the
   response returns (so the page can prove the sum). This is A's read plus every row it
   links to, in one shape; nothing built resembles it.
2. The Vendors drawer's one line per vendor — B's house-wide read.
3. A sixth drawer and a new reading-pane kind on `DocumentsReportsNext` — a change to the
   built page, and to `useSortingOfficeData.ts`, whose windowed counts are guarded by
   `scripts/check_windowed_figures.py` (`SO_SERVER_WINDOWS`, `:51-60`): a docket window is
   another cap that guard must see.
4. The shadow tables, as A; the popover writes the label.
5. The delivery sheet exists in parts — `GET /procurement/deliveries/:id` (`:105`),
   `:id/proposals` (`:127`), `delivery_timers` — but *What this delivery contributes* is a
   computed footer that needs the docket read's per-entry contribution.

**Honesty traps handled:** as A and B, with two that only a timeline can show — **a missing
register is a band in the list, not a shorter list** (credits 502 → *credit entries are
missing from this list, not absent from the record*); and **an unanswered message is an
entry** (*open · not counted, not forgotten*) rather than a silent absence from a median.
A clock that lapsed is written as *lapsed · not agreement* on the delivery it belongs to
(ADR 0103 D3, A4). The empty docket is the plainest of the three empties: *no entries in 365
days — an empty docket is not a clean one; no tally is drawn*.

**What it costs the reader, and the record:** the docket moves vendors into the documents
page the week after ADR 0149 row 25 moved the conversation list out of it, and it is the
longest surface of the three for a vendor with 30 entries a quarter. Whether "why" belongs
next to "what" on `/documents-reports` is the founder's question below.

---

## The founder questions each direction embodies

| Question | A · Ledger Card | B · Roll Call | C · Docket |
|---|---|---|---|
| **Where does it live?** | in the vendor's sheet, one fact on the card | a second view of `/providers` | a drawer + reading pane on `/documents-reports` |
| **What is the minimum sample?** | 5 deliveries in the window, **per measure**; replies count themselves | the same, per cell; refusals grouped in sort | the same; the entries stay when the tallies refuse |
| **The on-time rule** | the built one: landed by 23:59 on `expected_delivery_date`; no date → listed, not counted | the same | the same, and the delivery sheet prints it |
| **What is "agreed"?** | the order's confirmed price (built); *landed vs agreed* (ADR 0054, Proposed) not used | the same, stated in the column popover | the same, on the invoice entry |
| **Receiving verdict grain** | line-level records (ADR 0149 row 23, in flight) | the same | the same — an entry is a line with a person and a photograph |
| **Refusal for staff** | whole card withheld, labels kept | whole view withheld, control kept | **by kind** — the door is theirs, the money is not |
| **The label control** | three buttons in a dashed box | a **centred panel** with its contract as the title (a question) | a **popover** on the marker (a choice) |
| **Tone** | a sixth minor line, *not scored* | absent — a footnote says why | a note on reply entries |
| **UI locale for a Turkish house** | English chrome, tr-TR formats | **Turkish chrome** | English chrome, tr-TR formats |

Five further questions the drawings raise, which the brief does not answer:

1. **May the card carry a fraction at all?** The MERGE verdict allows *one behavioural fact*
   and gives *confirms in 6 hours · ships Tuesdays* as its examples — a sentence, not a
   fraction. A draws *12 of 14 on time*; if the founder wants a sentence, the read is the
   same and the card prints *late twice in 14*.
2. **What are the shadow rules, and who decides them?** The drawings print two placeholder
   rules (*reply median doubled against the 30 before, ≥5 replies each*; *price-as-agreed
   rate fell more than 5 points against the prior window, ≥30 comparable lines each*) so the
   label panel has something to ask about. The research is explicit that today's thresholds
   are magic numbers; the shadow run is where real ones come from, and the gate — how many
   labels, how much agreement — is a decision, not a sketch.
3. **Does the sentiment tab retire?** All three directions leave `ProviderSentimentChart`
   (the Sentiment tab in `ProviderIntelligencePanel`) undrawn. Keeping it beside a scorecard
   that says *tone is not scored* contradicts the scorecard.
4. **Tenant scope.** The research found `GET /providers/intelligence/compare` unscoped and
   `GET /providers/:id/sentiment` scoped by provider only, through shared providers
   (`restaurant_providers`). Every read these drawings need must be keyed by the caller's
   house; none of the three can be built on the existing intelligence routes.
5. **Which of the three fixes the prior window?** A and B draw *prior 90 d* as the 90 days
   before the window; C draws it as a folded band of entries with the same rule. The
   alternative — a rolling comparison at every date — is what turns a threshold into an
   alert stream and is deliberately not drawn.

## Recommendation

**Build A as the spine — the read, the ledger card in the sheet, the one fact on the card,
the shadow box — then graft B's Roll Call onto it as the second view of `/providers`, and
take two things from C into A: the *What this delivery contributes* footer on the delivery
sheet, and the docket as the rows surface behind each figure (A's per-measure tables become
one filtered day book).** Do not put the scorecard in the Sorting Office. Reasons, in order
of weight:

1. **The verdicts already say where the learned facts live.** `/providers` MERGE puts the
   twin in the sheet and one behavioural fact on the card — A is that sentence drawn.
   `/documents-reports` REWORK is a brief about documents, and ADR 0149 row 25 just moved
   the vendor conversation list *out* of it; C moves vendors back in, on the same week. The
   docket is the right **shape** for "the rows behind a figure"; it is the wrong **home**.
2. **The reads are ordered the same way.** A needs one new per-vendor read and five rows
   reads; B is the same read house-wide plus a view; C is a union read nothing resembles,
   plus a change to a guarded page. The rows reads are shared by all three, so building A's
   first makes B nearly free and C's docket a rendering of rows that already exist.
3. **The production corpus is small, and the three degrade differently.** With 27
   conversations from one vendor and no performance rows, most vendors will read *too few*
   for a while. A's refusal is one italic line per measure under a card that still stands
   on its three facts; B's is a page of italics; C's is honest but long for nothing. The
   direction that is still a page when the registers are thin wins the same brief that
   `/vendor-prices` did (sketch 112, *"more functional"* over an empty page).
4. **The shadow run needs a place a person passes.** A's box is seen whenever a vendor is
   opened; B's band whenever vendors are compared; C's markers only when a docket is read.
   The labelled set the founder asked for grows fastest where the labels are cheapest, and
   that is the sheet.

What this recommendation does **not** settle: whether the card's fact is a fraction or a
sentence (question 1), the label control's shape (B's panel or C's popover — one must be
chosen and it belongs to ADR 0112's *question vs choice* line), the staff refusal (A's whole
card or C's by-kind), and the Turkish UI. All four are founder calls that change one
component each and nothing about the read.

## Motion, all from `lib/mudavym/motion.ts`

`settle` (320 ms, house curve) for the sheet's section reveal, the docket pane's arrival
(the Sorting Office's own `so-settle`) and the row hover; `ink` (160 ms) for chips, filter
buttons, cell and entry hovers; `tuck` (300 ms) for the sheet and the phone's bottom-sheet
detents; `turn` (420 ms) for *How this is scored* and the prior window's fold; `tally`
(840 ms, overdamped) for the figures when the window chip changes — never on first paint,
never from an em dash, never on a refusal. `stamp` is reserved and fires nowhere in these
drawings: nothing here is sealed — a label is appended, a tally is counted. `pour` is not
used: no act here is held. `prefers-reduced-motion` renders every transition at its end
state (one media query in the sketch; `animate()`'s reduced path in the product).

## Shortcuts taken, said plainly

- The overlays are drawn open, not wired; nothing in these files calls anything. The phone
  bottom sheets are drawn at their upper detent with no drag.
- Only the **charcoal ground** is captured (ADR 0138). The one paper surface these pages
  hold — the legacy intelligence panel inside the TwinSheet — is not drawn (see A's costs).
- A's section 1 draws the grid **reflowed beside the open sheet** so all six cards are
  legible; the product's `Sheet` overlays the page and the grid does not move. The caption
  says so.
- Every count, date, person and sentence in the drawings is invented; the endpoints, tables
  and columns they cite are real and were read on `feat/mudavym-finish` on 2026-09-17.
- The two shadow rules are placeholders (question 2 above).
- The tenant-scope fix (question 4) is a precondition the drawings assume and do not draw.
- The `-390.png` files render the **whole sketch file** at a 390 viewport, so the sketch's
  wrapper narrows the section-1 frames and A's section 1 leaves empty ground beneath its
  bottom sheet; the phones inside the `-1440.png` shots are the truer 390 rendering.
- Not measured: production's current counts for any of the five registers. The corpus
  numbers quoted are the research's, with their dates (2026-08-25 for the census rows).
- **Style-bar check, not a redraw.** The founder's three named references
  (`origin/claude/artifact-pull:.../mudavym-wave-four.md`, `the-arrival-five-ways.md`,
  `documents-and-reports-redesign.md`) and sketch 104's `direction-c.html`
  (`origin/feat/mudavym-new-pages`) were grepped for their CSS scale, not redrawn against
  line-by-line: their `padding`/`gap`/`margin` values cluster on the same 2–16px steps this
  sketch uses, and wave-four's palette vars (`--seal`, `--seal-deep`, `--calm`) are the same
  family as direction A/B/C's. The three files' pages are shorter because they show fewer
  facts per card; this sketch's density is the founder's own brief — five measures, each a
  fraction with its denominator, a prior window and a rows link — not a departure from
  "fewer words." Whether that trade is still what he meant by the style bar on a
  five-measure page is unverified here and is the founder's call, not this pass's.

## Render check, 2026-09-17

`p4-scratch/render-sketch.mjs` at 1440×900 full page and at 390×844 full page (nothing
exceeded Chrome's 16384 px capture limit, so no banding was needed). Every 1440 shot was cut
into 1500 px bands and read at 1:1; every 390 shot into 2600 px bands and read whole.

| file | 1440 full height | 390 full height | console errors | horizontal overflow |
|---|---|---|---|---|
| direction-a.html | 5438 px | 9224 px | 0 | none |
| direction-b.html | 6232 px | 12894 px | 0 | none |
| direction-c.html | 7585 px | 13655 px | 0 | none |

Defects found in this pass and fixed before the numbers above:

- A: claim C-77 was *opened 2 Jul* for a delivery that landed 3 Jul — the date is now 3 Jul;
  the first ledger line drew a dashed rule under the window chips; the standing line and
  two cards were hidden under the open sheet (now reflowed, and captioned as a drawing
  choice).
- B: the centred panel's contract title inherited the sketch chrome's ink and sat
  near-invisible on charcoal; its two evidence boxes ran label, figure and note into one
  line; the phone showed only the open sheet and not the stacked vendor blocks the caption
  promised (a second phone was added).
- C: the five-up tallies ellipsised their denominators (*5 h 40 med…*, *$286.00 of…*,
  *₺1.200,00…*) — the denominator now drops to its own line and never clips; at phone width
  the shadow marker's count starved its sentence to one word per line (it now sits under the
  sentence) and an entry's second contribution line clipped at the edge.

**Arithmetic spot-check, continued pass.** Re-derived two of the invented figures from their
own rows rather than trusting the headline: direction A's Skurnik on-time card lists 15 order
rows for the 90 d window; counting them gives 12 undated-blank ("–") rows, 2 marked late
(`+3 d`, `+1 d`) and 1 struck *no expected date · not counted* — 12 + 2 = **14**, matching the
card's `12 of 14`. The Credits card's three claims sum to `$182.50 + $103.50 + $0.00 =
$286.00` allowed against `$182.50 + $118.00 + $112.00 = $412.50` asked, matching `$286.00 of
$412.50` on the card and in the summary above. No arithmetic mismatch found in this spot-check;
it covered one card of eighteen across the three files, not a full re-derivation.

## Every claim is cited

Founder's words from the 2026-09-17 brief (the operational scorecard), `MAKEOVER-VERDICTS.md:129-132`,
`:153-156` and `:337-346`; ADR 0149 rows 22, 23 and 25 (`0149-…:100-103`); the research at
`scratchpad/backend-1/sentiment-research.md` (§1 inventory, §2 depth, §3 tenant scope, §5
corpus, §6 what it would take); `advanced-analytics.service.ts:290-368` and
`analytics.controller.ts:808` (the built scorecard), `statistics.ts:276-283`
(`trendPerPeriodPct`), `order-status.ts:27-45`; `providers.controller.ts:272, :450, :464`
and `providers.service.ts:598` (`provider_performance_metrics`, baseline `:4774-4799`);
`deliveries.controller.ts:62-80, :105, :127`, migrations `20260903160000:77-99` and
`20260905232000:49, :124-148`; `receiving.controller.ts:309`, `receiving.service.ts:813`,
`invoice-match.ts:73, :704-714`, `agreed-price.ts:1-40`; `credits.controller.ts:94-121,
:123-160, :164`, `credit-ledger.ts:21-23, :57-61`, baseline `:4339-4369`;
`procurement_conversations` at baseline `:4294-4331`; `ReceiptsNext.tsx:77`;
`ProvidersNext.tsx:44-116`, `useProvidersNextData.ts:1-14`, `TwinSheet.tsx:73-151`;
`DocumentsReportsNext.tsx:35-86, :286-300, :425-500, :640-722` and
`useSortingOfficeData.ts:1-60`; `sheet.css:112-113, :125, :41-45, :149-154`;
`lib/mudavym/motion.ts`; sketches 103 (1c the spindle, 1e announced) and 112 (the fonts
note, the `-390` caveat). The Wave Four snapshot was searched for `/providers`,
`/documents-reports`, `Providers`, `Sorting` and `scorecard`; only the `/reports` mention
quoted above exists. Nothing here is imported by the app.
