---
type: page
route: /receipts
slug: receipts
softwares: [receipts-invoice-match]
component: apps/web/src/pages/ReceiptsPage.tsx
audience: owner
tier: core
archetype: list+detail # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: partial
status: documented
updated: 2026-09-25
links: ["[[PAGE-CONTRACT]]"]
---

# /receipts — Receipts & Credits

> **Part of** [[08-softwares/receipts-invoice-match|Receipts & Invoice Match]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Verify** (needs-review lane) → API `POST /api/v1/procurement/documents/:id/verify`
- **Credit state buttons** → API `POST /api/v1/procurement/credits/:id/transition`
- (no outbound navigation — dead-end page)

## 1. Purpose

"Vendor documents with two primary lanes: needs_review and verified. Selecting a
document shows the stored image beside the extracted lines for side-by-side
verification. Tri-state nulls … render as an em dash, never as a pass. Credits live
as a second tab on the same page so the chase list is one click away from the
documents that prove the claims" (`ReceiptsPage.tsx:1-10`, decisions E48/E49).

## 1a. Features
- **Documents** tab, two lanes: needs review / verified [changed 2026-10-01: papers that read cleanly now list here too, after the ones that need a look, under "Read cleanly · not yet confirmed" and counted on their own; the house's own papers are left out, and a clean paper opens by `?doc=` like any other (RECEIPTS-W44)] [changed 2026-10-01: each row leads with the vendor's name (the linked vendor, else the seller the sheet prints, else the name on the paper); a row with no name keeps its number as its title (RECEIPTS-W8-A)] [changed 2026-10-01: each row's verdict is worked out again on read by the sheet's own rule, and says "adds up / does not add up / no stated total", the card's words (RECEIPTS-W7, W27)] [changed 2026-10-01: a paper type prints the sheet's own word, for all twelve types and "Document" for anything else, so an irsaliye reads "Delivery note" (RECEIPTS-W44-SELF)]
- Select a document → its stored image beside the extracted lines for side-by-side verification; unknown values render as "—", never as a pass [changed 2026-10-01: the formatted sheet embedded here is readable at desktop width; the original pane now stacks below it instead of squeezing the sheet's table column to 2px (RECEIPTS-W1)] [changed 2026-10-01: the formatted sheet comes first and the review card under it is trimmed to its acts, opening on "Check and correct"; the paper is on demand from the sheet's "Bring the original" (RECEIPTS-W2)] [changed 2026-10-01: below 1536px an open document takes the full width with a "← All receipts" link, so neither table scrolls sideways (RECEIPTS-W3)] [changed 2026-10-01: with no signed link there is no "Bring the original" button; the page says "No original was stored for this document." and offers "Try again" only when the reason is something else (RECEIPTS-W8-C)] [changed 2026-10-01: both closed states of the original sit in a box labelled THE ORIGINAL (RECEIPTS-W11)]
- Verify a document [changed 2026-10-01: the swipe is switched off while the lines could not be read, with a line saying why, so it cannot vouch for lines nobody saw (RECEIPTS-W18)] [changed 2026-10-01: finishing the swipe lands the house's seal in the handle and the track keeps its full strength; after 400ms a thin breathing seal line shows under "Confirming…"; the label still never says "Verified" (RECEIPTS-W21)]
- **Credits** tab: the vendor credit-claim ledger with stats; move a claim through its states
  [2026-09-25: rebuilt on Mudavym as a lane of `ReceiptsNext` — `pages/receipts/next/ReceiptsCredits.tsx`; see §1c. The legacy `ReceiptsPage` is no longer loaded by any live route.] [changed 2026-10-01: the empty Credits tab says there is no claim once, and when the claims cannot be read "Being chased" says "Not read: see the note above." instead of drawing an empty heading (RECEIPTS-W24, W29)] [changed 2026-10-01: a claim and the door strip show a count in words ("quantity 2", "24 counted"), not "btl"; a door-strip order with no number says so instead of showing part of its id (RECEIPTS-W38)]
- Deep-linkable tab (`?tab=credits` — where `/credits` lands). [2026-09-25: offered to the owner and managers of the house only (ADR 0167); a staff member who follows `/credits` lands on Receipts with one sentence saying why.] [changed 2026-10-01: `?credit=<claim id>` is the selection on the Credits tab, as `?doc=` is on Receipts: it opens that claim's sheet, closing drops it, a closed claim unfolds the Closed list, an id not in the ledger says so with "Clear the link", and switching tabs drops it (RECEIPTS-W20)]
- **Mudavym redesign behind `mudavym_design_receipts` (OFF)** — the founder's four-requirement brief: the review queue + the door's paperless deliveries on one surface; **the stored scan rendered inline beside the lines** (images and PDFs; the 3600s signed link is treated as spent five minutes early and offers a refetch, and each not-shown state names which one it is — no stored file / no signable link / aged out / did not load); the linked order above the lines ("the right invoice"); qty/unit/total editable in place pre-verification with the tie-out recomputed in the same response (new gateway route `PATCH /procurement/documents/:id/lines/:lineId`), **the extracted figure kept beside a corrected cell with an undo until verify**; the swipe-up confirm ceremony firing verify [changed 2026-10-01: the linked order is read from the document's links; the card had read an `order_id` column the table does not have and said "No order is linked" on every document (RECEIPTS-W4)] [changed 2026-10-01: the card is five labelled parts with a rule between each: THE READING, THE ORDER (with "Check line pairing" beside the order sentence), THE MONEY, THE LINES, CONFIRM (RECEIPTS-W10)] [changed 2026-10-01: once the currency is filed and nothing is held, THE MONEY folds to one line with "Change the currency"; a hold never folds; opening moves keyboard focus to the picker and keeping moves it back to "Change the currency" (RECEIPTS-W9, W12)] [changed 2026-10-01: the edit boxes (lines, currency picker and its reason box, correction form, credit-settle amount) have an edge at 3.6 : 1 against the paper, up from about 1.1 : 1; the correction form is shared with `/documents` (RECEIPTS-W39)]
- **Honesty, per [[0063-a-certification-screen-shows-the-thing-being-certified|ADR 0063]]** — every query key carries the active restaurant id (an unresolved restaurant is refused, not given a shared `''` cache bucket); the awaiting-review count renders as a floor (`≥`) at its server window; all three list failures are named individually, and an unanswered uncounted-deliveries query says it is unknown rather than rendering as a caught-up door; a failed detail fetch says the failure in the **server's** words and never claims an empty invoice; document `extraction_confidence` and per-suggestion `confidence` are shown, `—` when unrecorded [changed 2026-10-01: a failed read says what happened in words: "no answer came back", the server's own sentence, or "refused, with no reason given"; the client library's "(Network Error)" and "(HTTP 409)" no longer print (RECEIPTS-W24, W28)] [changed 2026-10-01: while a read has failed the header says "queue not read · verified not read" rather than "Reading the queue…" (RECEIPTS-W29)] [changed 2026-10-01: the reader's confidence prints as a sentence ("The reader was 35% sure of what it read."), and when none was recorded the card says so (RECEIPTS-W23)]
- **The canonical document — this page's second face, behind `mudavym_design_document` (OFF)** (ADR 0104 D12 slice 2, D13). `/documents/:id` renders any incoming document as ONE canonical Mudavym document: B's verdict block first (named exceptions in words and numbers, **never a confidence as a number**), C's delivery spine (cards per document on the event, state ladder `DELIVERED → RECONCILING → AGREED → VERIFIED`, the permanent `UNORDERED` mark; collapsed at ≤ 2 documents and absent when the document sits on no delivery), A's typeset sheet as the selected frame (EN 16931 header order, the four-way `ordered · shipped · received · billed` table where `received` prints the words **"not counted"**, the printed price base as a sub-line, allowances/charges with their reason names, the VAT breakdown, totals). Money is **absent** on a delivery note; the claim block appears **only** on a credit memo. Per-field provenance is a hover (and a footnote column in print); `as printed` says "not kept" rather than inventing a literal. Read-only: no corrections, no claims, no mapping memory — slices 3–4. `?view=door` opens the same component as the door frame with **no money at all** (D11), read-only until slice 5's `receiving_advice` write. Reached from this page by "Open as the canonical document →", which appears only where the gate is on. [changed 2026-10-01: the link from this page now reads "Open this document on its own page →" (RECEIPTS-W23)]
- **A difference must be answered before a delivery is agreed** (ADR 0103 **A11**, founder 2026-09-06). `AGREED` is refused — **409, naming the lines** — while any recorded difference (our door count against the vendor's paperwork, or the invoice against the PO) has neither an accepted proposal covering that line nor an explicit **accept-as-billed** on it. The second answer is its own door, `POST /procurement/deliveries/:id/accept-as-billed { documentId, lineNo, reason }`: a named person, a reason in their own words, idempotent, and NOT a proposal — a proposal is a position one side asks the other to accept, and this is the decision not to raise one. The gate reads the SAME comparison the "this delivery differs" notification reads, and a comparison that could not be READ refuses rather than passes.
- **Our own door count is the RECEIVED column, never the BILLED one** (v3.0-TECH-DEBT 2026-09-06, finding 3). A `receiving_advice` carries no money (D11), so its quantities land in `received` with `billed` NULL, and the verdict card says _counted N at the door_ rather than _billed —_. Fixed in the mapper so the page, the verdict sentences and the API say one thing.
- **The same count twice is answered, not leaked** (finding 4). A repeated door count returns **409** — "this count was already recorded as document `<id>`" — and takes the receiver to the document that exists, rather than a 422 carrying the index name `uq_pd_restaurant_sha256`.
- **Degraded is a state, not a blank** (ADR 0104 D6) — a document with no lines renders NOT EXTRACTED, the original, and the header fields that exist; the verdict block says "nothing was read, so nothing could be compared" rather than "nothing differs", and there is no line table and no totals, because `Lines 0.00` on an unread document is a claim nobody made
- **An invoice's money names its own currency, and the house may restate it** (founder 2026-09-06, batch 63). Every figure on this page printed a hardcoded `$` until now, including on the two `TRY` invoices production already holds. Three rules, built in `apps/api-gateway/src/procurement/documents/invoice-currency.ts`: **(1)** an 810 with no `CUR` segment is filed under the HOUSE'S OWN `restaurants.currency` — never `USD` — and a house that has stated none, on a file that states none, has its **money refused** in a sentence naming both absences (the quantities stay; the header charges, the total, every line price and the tie-out all go to null). **(2)** the extraction states the currency it SEES with the location it saw it (`currencySeen`), and a sighting that disagrees with the currency the invoice would be filed under **HOLDS** the money under both until a person decides — the model flags, it never decides. **(3)** a manager or owner restates it here: a picker of ISO 4217 codes, an optional reason, an append-only audit row (`procurement_document_currency_changes`) written BEFORE the change lands, and the money re-filed off the stored reading with the server's own sentence saying what moved. **Nothing is converted** — there is no exchange rate in this system. **Staff see the control disabled with the sentence**, never hidden [changed 2026-10-01: a money name prints as "Turkish lira (TRY)", also inside the opened money box (RECEIPTS-W23)] [changed 2026-10-01: an amount whose currency has a one-character sign prints it (₺11,186.40) while other currencies keep their code (CA$12.00, ARS 12.00); the sheet keeps the paper's own format (RECEIPTS-W25)]
- **The currency control also CONFIRMS, not only changes** (founder 2026-09-06, batch 64:
  *"let them approve if otherwise"*). `PATCH :id/currency` accepts `previous === next` and
  records it as `change_kind = 'confirmed'` — the same author, the same role, the same
  moment, the same `money_refiled` payload. It is what ends a hold when the currency the
  document already carries is the right one, and it is what unlocks the price at
  [[receiving]]. The database refuses the two lies the pair could tell: a confirmation
  whose codes differ, and a restatement that restates nothing (`20260906180000`)
- **The chain gained a rung: the ORDER's own currency** (founder 2026-09-06, batch 65 —
  *"we will use the currency from where we order it"*). `filingCurrency` now reads: the
  file's own statement, then `procurement_orders.currency` for the order this document is
  matched to, then the house's — and the house's rung says WHICH of the two preconditions
  held ("the order names none" vs "matched to no order"). A file CUR that DISAGREES with
  the matched order's currency is HELD exactly like a model disagreement, naming both
- **`?doc=<id>` opens a document directly**, so the receiving screen's refusal can link
  to the control that clears it rather than to the queue [changed 2026-10-01: the address is written on every click, so a reload, Back and a shared link keep the open document (RECEIPTS-W3)] [changed 2026-10-01: a `?doc=` this house does not hold (another house's, still reading, set aside, or past the 200-item verified window) says so in words and offers "Show the queue"; while the lists load it says "Opening the linked document…" (RECEIPTS-W19)]
- **A hold now KEEPS the figures it strips** (`ParsedDocument.moneyWithheld`). This
  corrects a documented-but-untrue invariant: `moneyHeld`'s comment claimed the full
  reading survived in `procurement_documents.extracted`, but the intake writes `extracted`
  from the same object it writes the money columns from, so once the fields were nulled
  the reading was gone from both — `refiledMoney` restored a document of nulls while
  `refilingSentence` announced that the money "was held and is now filed"
- **The three write acts each take a redeemed seal** (founder 2026-09-06, batch 64:
  *"Decide as a module: seal all three"*). `POST :id/verify`, `PATCH :id/lines/:lineId`
  and `PATCH :id/currency` are behind challenge-and-redeem, the same mechanism the order
  approval and the payment-register acts use (`subject_kind 'procurement_document'`, acts
  `verify` / `line_edit` / `currency_restate`; `20260906200000`). Each mint happens when
  the GESTURE BEGINS and each token is spent exactly once. What each seal is taken OVER is
  the point: **verify** hashes the whole transcription, so a line corrected between the
  gesture and the write refuses it rather than putting a reviewer's name on a figure they
  never read; **line_edit** hashes the line as it stands AND the exact patch, which turns
  the last-write-wins collision this page could previously only report after the fact into
  a refusal; **currency_restate** hashes the pair of codes, so a seal minted to move a held
  invoice to EUR cannot be spent after somebody else filed it in USD. A moved cell is now a
  PENDING correction stated in figures, not a write: the hold below it is what sends it.
  **A failed mint is a failure in words and never a silent unsealed call.** The legacy
  `/receipts` page (rendered whenever the flag is off) mints and carries the seal too.
  **The canonical face's twin acts are sealed the same way** (founder 2026-09-11, batch 69:
  *"Seal corrections and fields/verify too"*). On `/documents/:id`, `POST :id/corrections`
  (act `field_correct`) and `POST :id/fields/verify` (act `field_verify`) take a seal minted
  by `:id/corrections-seal-challenge` and `:id/fields/verify-seal-challenge` when the hold
  begins. The correction's seal covers the REVISION being corrected (its number and its
  whole layer-1 content) plus the path and value, so a correction written against a
  superseded revision, or after a line was corrected on this page, is refused; the tick's
  seal covers the field's path, the value as shown, whether the document carries that
  field, and the verdict. The correction form's submit is a hold that seals the value
  captured when the hold began; the tick left the provenance popover (which closes on blur)
  for its own dialog with a hold. Neither act gained a role gate. The other five write
  routes on the documents controller (upload, extraction, match, link, door count) are
  deliberately NOT sealed; `scripts/check_money_routes_are_sealed.py` prints them under
  DELIBERATELY UNSEALED, each with the reason true of that route (two of which say plainly
  they are weak: link moves an invoice price between cost lots, door count books provisional
  stock), and a write nobody has named still prints under NOT IN ANY SEAL CENSUS
- **Pairing** — matcher suggestions carry their reason **and their confidence** for one-tap confirmation. The matcher **does** auto-write unambiguous vendor-SKU pairings server-side (`line-matcher.ts:282-296`); the page names them as written-without-asking, and every paired row has **Unlink**. The `Paired with` column names its target (ordered wine · quantity · order-line ref · method · confidence) and says "not paired" in words [changed 2026-10-01: the column is "Order line", empty is "no order line yet", and the method reads as a sentence for all five stored codes (RECEIPTS-W6-D)] [changed 2026-10-01: the paired-line sentence no longer prints a database id: it says "the item", "94% sure of the match" and "Against an order with no number", and Unlink sits on its own line, named for its line (RECEIPTS-W37)] [changed 2026-10-01: "Check line pairing" gives its reason when it is greyed out ("needs the order link, which could not be read" / "waits for the order link") (RECEIPTS-W18)]
- **One tie-out verdict.** [changed 2026-10-01: the tie-out counts the VAT amounts the paper prints in its breakdown when the stated tax is empty, so six of the eight papers in the Sim house no longer read "does not tie out" for a tax the paper did state; editing a line and restating the currency pass the breakdown too (RECEIPTS-W5)] [changed 2026-10-01: the card shows the sheet's verdict, from the sheet's own query, until a correction returns a newer one (RECEIPTS-W6-A)]
- **The shelf tick names a wrong year.** [changed 2026-10-01: when a line's year and the remembered item's year are both known and differ, "This line prints 2023; that item is the 2022." sits beside the tick, and stays beside "Linked to …" in the same amber after the link, until the years agree; two different years in one name give no note, never a guess; also on `/documents/:id` (RECEIPTS-W8-B, W15)]
- **The card reads in words.** [changed 2026-10-01: THE READING says "The lines add up to the stated total.", "The total is off by ₺180.00 from the lines." or "No stated total to test the lines against."; THE ORDER says "No order is linked to this document, so its lines have nothing to be checked against."; THE LINES add the year only when the name lacks it (RECEIPTS-W23)]
- **The sheet's words.** [changed 2026-10-01: the year prints once, "per 12 bottles", a charge prints its reason name and "reason code 7161" only when no name came, and the original says "A PDF", "A photo" or "The stored file" (RECEIPTS-W22)] [changed 2026-10-01: units read in words and are singular only at exactly 1 ("billed 6 bottles, received 1 case") (RECEIPTS-W6-B)] [changed 2026-10-01: provenance reads "read automatically" (the model on hover), "file fingerprint", and a jurisdiction only when one is set (RECEIPTS-W6-C)] [changed 2026-10-01: a verdict on a paper nothing was compared with says it once, "That is not a discrepancy: no amount is claimed, and none is ruled out.", and draws no per-line cards when no line was compared (a door count and a mixed document keep theirs) (RECEIPTS-W26)]
- **The sheet reads more of the paper.** [changed 2026-10-01: the order number printed on the paper now reaches the sheet's header; it was dropped (RECEIPTS-W41)] [changed 2026-10-01: when a tax amount was read but no VAT breakdown, the sheet says "Tax of <amount> was read, but not its rate or what it was charged on." instead of saying the document states none (RECEIPTS-W41)] [changed 2026-10-01: Billed carries its unit when it equals the printed quantity ("12 bottles", "2 each"); a quantity converted to bottles stays bare (RECEIPTS-W41)]
- **The sheet has a letterhead frame.** [changed 2026-10-01: a 1px edge, 4px radius, the Mudavym mark 24px tall in seal teal with a teal full stop, the wordmark in ink; the mark stays dark on the paper sheet under the dark theme, and the invoice number never breaks at its hyphen on a phone; it also shows on `/documents` and in print (RECEIPTS-W45c, W45c-SELF)]
- **The field popover and its two dialogs work from the keyboard.** [changed 2026-10-01: where a field offers actions ("Correct this", "I have checked this") its popover is a disclosure: focus inside keeps it open, Escape returns focus to the field, and a mouse crossing the gap no longer closes it; read-only fields stay tooltips (RECEIPTS-W30)] [changed 2026-10-01: the box measures the nearest box that clips it and moves left, narrows, or opens upward so it fits at any screen width (RECEIPTS-W36)] [changed 2026-10-01: "Correct one field" and "Confirm" are the house `Panel`: Tab stays inside, Escape closes from anywhere and returns focus to the field, the page's scroll is locked and let go, and motion settles and is off under reduced motion; Correct starts in "What it should say", Confirm starts on Cancel (RECEIPTS-W31, W32)] [changed 2026-10-01: the Confirm dialog no longer prints the field's internal key (RECEIPTS-W33)] All four also change `/documents`.
- **The page fits a phone.** [changed 2026-10-01: at 375 and 390px the open document is as wide as the screen (it was 44px wider) and the Correct dialog is centred (RECEIPTS-W34)] [changed 2026-10-01: below 640px each line of the sheet and of THE LINES is a small grid with each figure under its own word, so the line total is no longer hidden past the edge; print and wider screens keep the table (RECEIPTS-W35)]
- **A skip link on an open document.** [changed 2026-10-01: a hidden "Skip to the review card" link is the first stop; Enter lands on "Check and correct", and 15 more Tabs reach the swipe, where it took about 94 (RECEIPTS-W40)]

## 1c. The credit ledger lane (2026-09-25, ADR 0149 row 22)

`/receipts?tab=credits` renders `ReceiptsCredits` inside the same `.mudavym` root,
header and ground as the receipts lane. Until this change the tab lazy-loaded the
legacy `ReceiptsPage` (`ReceiptsNext.tsx:75-79,1312-1315` at `059169a5`), so a LIVE
page still showed the old design for one tab — CRITIC §G8, ADR 0149 row 22.

- **Who sees it — ADR 0167** (Locked 2026-09-19, the record lives on PR #395's branch
  until that PR merges). The tab is offered when the role IN THIS HOUSE (`activeRole`,
  falling back to the global `user.role` only when no house is active) is owner,
  manager or admin — `canSeeCreditLedger` in `ReceiptsNext.tsx`. Staff get no tab and
  spend no request; `?tab=credits` lands them on Receipts with one sentence. A 403 from
  the gateway (the server half of ADR 0167, PR #395) renders as a refusal in words,
  never as an empty ledger.
- **Figures per currency, never summed.** `GET /procurement/credits/stats` now also
  returns `byCurrency` (`recoveryStatsByCurrency` in `credit-ledger.ts`) plus
  `rowsCounted` and `capped`. The lane prints one group of four figures per currency
  (Recovered · Outstanding · Promised · Refused), labelled "kept apart, nothing is
  converted" when there is more than one. The combined top-level figures are
  unchanged for their existing readers (/receiving's owner ledger). Each claim prints
  in its own `procurement_credits.currency`, which the web type now carries.
- **Windows are floors** (ADR 0051 clause 2): the list is the gateway's oldest 200
  (`CREDITS_LIST`), the figures are computed behind 5,000 rows (`RECOVERY_STATS`, a
  floor unless the server says `capped: false`), and the memo picker shows the newest
  100 credit memos (`CREDIT_MEMOS`). All three are in `RECEIPTS_SERVER_WINDOWS` and
  guarded by `scripts/check_windowed_figures.py` (the renderer and the imported
  `useProviders` hook are registered there).
- **"Requested" drafts a letter and sends nothing** (ADR 0230, founder 2026-09-25 round 5;
  this bullet used to say the move stamped `requested_at`/`requested_by` and nothing else).
  The move is labelled *Ask the vendor*; the gateway stamps who and when and drafts a
  `HOUSE_DRAFT` letter to the vendor carrying the claim's facts. The claim sheet shows the
  letter in the letter book's words ("Drafted to … — not sent", "Sent to … on …") and links
  `/communications?draft=<id>`, where sending it from the composer is the approval. No
  vendor, no booked address, and a failed read each say so rather than showing no letter.
- **Settling names a real memo.** The legacy `window.prompt` for a UUID is gone. The
  settle form picks from the house's credit memos (`GET /procurement/documents?docType=credit_memo`),
  the claim's own vendor first, each marked when it is unverified, in another currency,
  or already settling another claim; the amount allowed is typed blank (the claimed
  figure is only the placeholder) because vendors routinely allow part of a claim.
  With no memo on file the form says so and cannot submit.
- **Every move is armed, then recorded**: a click shows the sentence the move writes,
  a second click writes it. The server's refusal is printed in its own words with
  "the claim is unchanged". The move table mirrors the gateway's `TRANSITIONS`
  (`CREDIT_MOVES`; a test reads `credit-ledger.ts` and fails on drift) — the legacy
  tab had `rejected: []` and so hid "ask again", which the server allows.
- **Claims are rows, the claim is a Sheet** (ADR 0112): reason in words, vendor
  (resolved through `useProviders`), claimed amount and bottles, the matcher's own
  sentence, evidence, dates, a link to the invoice at `/documents/:id` and to the
  credit memo once settled.
- **Honest states**: no house selected; reaching the gateway; a failed list, figures or
  memo read each named; an empty ledger said only after the gateway answered.

Not built here (not decided): sending the claim to the vendor (§13 item 1), and
sealing credit moves (the credits routes are not in the money-seal census).

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_receipts`)

> **Chrome (2026-09-04).** With the flag on, this page is framed by the house
> header — `apps/web/src/components/mudavym/HouseHeader.tsx`, mounted by
> `PageGate` above every `next` tree: the A+M mark, this page's name, the ⌘K
> "Search or act" trigger, the house (or the branch switcher when there is more
> than one), the bell, ~~the theme menu~~ and the account menu **[2026-10-01: the theme
> menu left the header — founder, page walk-through DASH-W23; the ground is chosen on
> `/profile`]**. Chrome is excluded
> from §Surface by PAGE-CONTRACT, so it is named here and nowhere else in this
> note; its motions live in `components/mudavym/MOTIONS.md`, not the table
> below.

Canonical source with curves: `apps/web/src/pages/receipts/next/MOTIONS.md` —
this list is the note-side index (ADR 0044 §2).

| id | name | fires |
|---|---|---|
| `rc-swipe-confirm` | The swipe-up confirm | the verify ceremony — fill tracks the finger 1:1; keyboard hold fills at the pour rate, linear (a countdown never eases); early release tucks back |
| `rc-doc-settle` | Document settles open | the selected document's panel — `settle`, 320ms house curve |
| `rc-ink` | Ink micro-state | queue rows and controls — one paper step, nothing translates |

Deliberate non-motions: a recomputed tie-out swaps text, never animates
(arithmetic has no continuity after a correction); the no-paperwork strip
never pulses; verified documents leave the queue without an exit flourish.

**2026-08-31 wave polish (Sorting Office two-Opus review):** the "Check line
pairing" and "Verified" controls, plus the two row lists' selected-state
buttons, carried an inline `background: 'transparent'` that permanently
outranked `.rc-ink:hover`/`.rc-row:hover` (a style attribute beats a class
selector regardless of specificity) — dead hovers on every rc-ink/rc-row
control. Fixed by removing the inline value rather than adding `!important`;
verified via a static cascade repro (before/after screenshots) since the
route sits behind auth. `fmtDate` in `rc2-format.ts` also got the
local-calendar-day parser backported from `documents-reports/next/so-format.ts`
— `doc_date` is a Postgres `date` (no time, no zone), so the bare
`new Date(iso)` it used rendered the prior day west of UTC.

### Design used, and why (ADR 0045 §5 wave · MAKEOVER-VERDICTS: KEEP+, the most demanding brief)

The founder's four requirements, mapped to structure: (1) *compress
everything from the orders* — the door's counted-but-paperless deliveries
share the surface with the review queue, so no part of an order's paper
trail waits invisibly elsewhere; (2) *backend integration without
overcrowding* — three list queries plus one on-demand document detail;
(3) *the right invoice* — the linked order rides above the lines, an
unlinked document says "pair it before trusting any line", and the line
matcher's suggestions surface with their plain-language reasons for one-tap
confirmation (never auto-written — a wrong link corrupts cost basis
silently); (4) *editable and confirmable right away* — qty/unit/total edit
in place through the new PATCH route, which recomputes the tie-out through
the same rule extraction uses and returns it in the response, and the named
**swipe-up ceremony** completes into verify. The edit/verify honesty
contract: only a pre-verification document is editable (a verified document
is the record a dispute leans on — no un-verify exists); edits are anonymous
drafts and provenance is carried by verify's `verified_by` stamp; the
ceremony's own copy says exactly what it asserts — the transcription, never
charges or stock. Credits stay on the legacy tab (flag off) until a later
pass; recorded in §9. E48/E49 carried throughout: tri-state nulls are
untestable, never a pass.

### Overlays, 2026-09-05 (sketch 102 · ADR 0112)

<!-- sketch-102-overlays -->
Generated by `.planning/sketches/102-modal-census/build.py --docs` from `census.py` — edit the census, not this table.
The rule: an object gets a sheet, a question a panel, a choice a popover; the seal never sits in a popover.

**`/receipts`** — No overlays. Editable-and-confirmable in one step wants no dialog; SwipeToConfirm is inline.

Drawn in sketch 102 (`.planning/sketches/102-modal-census/index.html`); the policy is [[0112-one-modal-policy-three-shapes-one-primitive]].

## 2. Entry

- Sidebar "Receipts & Credits" (`components/layout/Sidebar.tsx:132`).
- `/credits` redirects to `/receipts?tab=credits` (`apps/web/src/App.tsx:282`);
  the tab param is read at `ReceiptsPage.tsx:59-60`.
- `/documents/:id` (ADR 0104 slice 2) is entered from the selected document here,
  via "Open as the canonical document →" — rendered only when the `document` gate
  is on. With the gate off the route itself redirects back to `/receipts`, so the
  page has exactly one way in and one way back.
- [PAGE_MAP](../foundation/PAGE_MAP.md):121 lists it as a no-inbound entry point —
  that scan covered page sources only and missed the sidebar link; the redirect and
  sidebar are the real entries.

## 3. Files

- Route binding: `apps/web/src/App.tsx:281` (lazy import :97).
- `apps/web/src/pages/ReceiptsPage.tsx` (482 lines) — single file; lanes, credit
  table and detail pane are internal components.
- Services: `services/api/documents.ts` (incl. `dashNull`, the E49 em-dash helper,
  documents.ts:62-66), `services/api/credits.ts`.
- **The canonical face** (ADR 0104 slice 2):
  `apps/web/src/pages/documents/next/CanonicalDocumentPage.tsx` +
  `canonical-document.css` (D9's light paper under `.dark`, and the print rules);
  `apps/web/src/components/documents/` — `VerdictBlock`, `DeliverySpine`,
  `CanonicalSheet`, `ProvenanceHover`, `OriginalPane` (which REUSES `PaperPane`
  from this page rather than drawing a second viewer), `DegradedNotice`,
  `DoorFrame`, `canonical-format.ts`; client
  `apps/web/src/services/api/canonical.ts`.

## 4. Endpoints

Atlas rows: [ENDPOINTS](../foundation/ENDPOINTS.md):378 (`procurement/documents`),
:370 (`procurement/documents/credits`).

| Method | Path | Call site |
|---|---|---|
| GET | `/procurement/documents?status=needs_review|verified` | `ReceiptsPage.tsx:71` → `services/api/documents.ts:83` |
| GET | `/procurement/documents/:id` | `ReceiptsPage.tsx:77` → `documents.ts:98` |
| POST | `/procurement/documents/:id/verify` | `ReceiptsPage.tsx:103` → `documents.ts:104` |
| GET | `/procurement/credits` (+ `/stats`) | `ReceiptsPage.tsx:83,89` → `services/api/credits.ts:51,58` |
| POST | `/procurement/credits/:id/transition` | `ReceiptsPage.tsx:140` → `credits.ts:71` |
| PATCH | `/procurement/documents/:id/currency` | `ReceiptsNext.tsx` `CurrencyBlock` -> `documents.ts` `restateCurrency`. Managers and owners only (`OrganizationsService.resolveRestaurantRole` + `roleSatisfies`); 403 in words for anyone else, 400 for anything that is not an ISO 4217 alpha-3, 409 for a change to the currency already filed. Writes the audit row first and does NOT change the currency if the log fails. |
| POST | `/procurement/documents/:id/extraction` | **No SPA call site** — the extraction door (`documents.controller.ts:351`). Fills a document ADR 0104 D6 stored unread with an extraction produced outside the gateway, because the configured Anthropic key has no credit. 409 once a document has lines or a real extraction. |

## 5. Signals

**None.** No tracking, no `data-ux-key`, reporter dark (`lib/uxSignals.ts:15`).

## 6. Tier cut

**Core** with a Plus edge: document verification is S02/S03 Core (✅,
[TIER-MAP](../03-scenarios/TIER-MAP.md):38-39); the credits chase tab is the S03 Plus
"credit claim opened-never-sent" surface and feeds the Pro settled-recovery ledger
(TIER-MAP:39).

## 7. Rebrand surface

**0 user-visible strings** (no `wineops` hits in the file). Shared layout chrome
applies (see dashboard.md §7).

## 8. State & config

- Lane and tab are URL state (`?tab=credits`, `ReceiptsPage.tsx:59-60`) — deep-linkable.
- Notification store wired for toasts (`ReceiptsPage.tsx:28`). No flags or env gates.

## 9. Gaps

- ~~ReceiptsNext (flag ON) has no credits lane yet — `?tab=credits` renders the LEGACY page even with the flag on (guarded in `ReceiptsNext.tsx`), so `/credits` keeps working; a native credits lane is a later pass (§1b).~~ [2026-09-25: built — §1c. `ReceiptsNext` no longer imports the legacy page.]

- Line-match **suggestions** from `POST /procurement/documents/:id/match` have no UI
  on the LEGACY page — deferred by design (`v3.0-TECH-DEBT.md:447`). ReceiptsNext
  renders them with reasons + one-tap confirm behind `mudavym_design_receipts` (§1b).
- Cost-drift-caught / straight-through-rate / days-to-close metrics are decided-not-
  built (`v3.0-TECH-DEBT.md:446`) — this page is where they would land.
- **The canonical face has never rendered an EXTRACTED document.** Slice 2 put three
  synthetic PDFs through the real intake door on the sim tenant (2026-09-04) and the
  extraction model refused every one of them — `Anthropic 400: Your credit balance is
  too low` on the keyed gateway, "no extraction model is configured" on the unkeyed
  one — so all three render the DEGRADED state. The four-way table, the price-base
  sub-line, the provenance hovers and the exception sentences are proven by component
  tests over synthetic envelopes ONLY. Nothing on this page has yet been seen against
  a document a model actually read.
- ~~**No delivery exists**, so the spine has never rendered with cards~~ — **false since
  2026-09-06.** Two deliveries were made on the sim tenant through the door-count door and
  the invoice `b1e02edf` now sits on both; the spine renders two cards, each with its three
  documents, the `UNORDERED · permanent` mark and the state ladder
  (`DELIVERED · RECONCILING · AGREED · VERIFIED`). Screenshot
  `scratchpad/lens-vendor/shots/02-delivery-spine.png`. Collapse-at-two and the failed-read
  state are still component tests only.
- **The gates and the proposal thread render only on a document that sits on exactly ONE
  delivery** (`soleDelivery` in `CanonicalDocumentPage.tsx`). That is deliberate — an
  ambiguous gate is worse than none — but it means the *invoice* page of a consolidated
  document never offers them, and the only face that does is the door count's own page
  (`shots/08-gates-and-thread.png`). A reader who arrives at the invoice sees no way to act.
- ~~**The door frame has no door count to show.**~~ — **false since 2026-09-06**: two door
  counts exist on the sim tenant. What the render then exposed is worse than the absence was:
  **on the door count's own page the counted quantities appear under `Billed` and `Received`
  reads "not counted" on every line**, and each verdict card says "NOT COMPARED · LINE n …
  billed 10 bottle. Nothing was ordered, despatched or counted against it." The spine card for
  the count itself reads "COUNTED AT THE DOOR / number not read". Filed in `v3.0-TECH-DEBT.md`
  (2026-09-06, finding 3).

- **Canonical view, first render against extracted documents (2026-09-04, `v3.0-TECH-DEBT.md` "nine findings"):** the verdict block says "4 lines differ from the delivery" when nothing exists to compare; the seller is blank though the extraction named it; delivered date and VAT breakdown are not in the extraction contract; the totals ladder shows "Charges —" under listed charges; deposits carry no UNCL7161 code; the original pane has nothing to bring (`imageUrl` null on 3 of 3). [changed 2026-10-01: a verdict on a paper nothing was compared with now says "not compared" once, in one sentence (RECEIPTS-W26)] [changed 2026-10-01: a document with no stored original no longer shows a "Bring the original" button; it says "No original was stored for this document." (RECEIPTS-W8-C)]
- [changed 2026-10-01: the document's lines still appear twice on the page, once read on the sheet and once edited on the card; open decision OD-TBD-R3-1 (RECEIPTS-W2)]
- [changed 2026-10-01: no route links a document to an order after intake (`link()` runs only at intake, `document-intake.service.ts:1370,2073` at this branch's head), so the card has nothing to check lines against; open decision OD-TBD-R3-2, and the way to link is decided in RECEIPTS-W42 but not built (RECEIPTS-W4, W42)]
- [changed 2026-10-01: none of the engine's 30 checks reach the page and their wording is technical; which a person sees, and in which words, is open decision OD-TBD-R3-3 (RECEIPTS-W14)]
- [changed 2026-10-01: the reader files a deposit that the paper prints once as both a line and a document charge, so the paper reads "off by" the deposit, and one engine check adds the charge into the line again, because this paper's stored reading has no line kind and PR #304's fix keys on it (`parsed-document.ts:435-437`); recorded in tech-debt for the reader (RECEIPTS-W14)]
- [changed 2026-10-01: stored tie-out verdicts were left as they were; the sheet, card and list recompute on read, but the invoice-confirmed notice was named in the same row and no later row changed it; recorded in tech-debt (RECEIPTS-W5, W7)]
- [changed 2026-10-01: the edit-line and currency-restatement wiring that passes the VAT breakdown has no test of its own (RECEIPTS-W5)]
- [changed 2026-10-01: the order's name still arrives from the gateway in a field called `wineName`; that is the gateway's shape, not page wording; recorded in tech-debt (RECEIPTS-W37)]
- [changed 2026-10-01: four gaps between the vendor's paper and our sheet are on the defect list, not fixed: a deposit counted twice, the seller's tax number not shown, the VAT rate and base not read, and Ordered, Shipped and Received never filled (RECEIPTS-W41)]
- [changed 2026-10-01: of the 15 papers in "Read cleanly · not yet confirmed" in the Sim house, most are earlier builds' test papers (`SYN-D15-…`); recorded in tech-debt (RECEIPTS-W44)]
- [changed 2026-10-01: the reader does not detect direction (issued by us or to us), and the vendor step refuses only when the seller's tax number equals the buyer's printed one or the house's own on file (`vendor-identity/vendor-resolution.service.ts:143-170`); on a paper the house issued, a house with no tax number on file could be filed as its own provisional vendor; decided in RECEIPTS-W45, not built]
- [changed 2026-10-01: when `html.dark` is set, `styles/globals.css` `.dark h1` / `.dark p` paint the sheet's seller name and the verdict headline pale on the paper sheet; found, not fixed; recorded in tech-debt (P8)]
- [changed 2026-10-01: the shared `Panel` does not bring back focus that something else already moved out of it (its Tab cycle is its own `onKeyDown`, `components/mudavym/Sheet.tsx:834`); queued in the shared queue (RECEIPTS-W32)]
- [changed 2026-10-01: the new `--line-control` token (light `#8F8674`, dark `#736B61`) is queued in the shared queue; until it lands this page's edit boxes differ from other pages' (RECEIPTS-W39)]
- [changed 2026-10-01: on load, `GuidanceProvider` can write the user's preferences with defaults before the saved ones have been read (`contexts/GuidanceProvider.tsx:186-195`, `374-383`); shared, queued in the shared queue (P6)]
- [changed 2026-10-01: the sidebar's "Receipts & Credits" label is shown to staff who have no Credits tab; it is shared layout, queued in the shared queue (P5)]
- [changed 2026-10-01: `/documents`' own provenance strip still prints "version 1 · file fingerprint" with a hash prefix (`pages/documents/next/CanonicalDocumentPage.tsx:743`); not this page's to change (P5)]

## 10. Maturity

**partial.** The most honestly-built page in this cluster, and the only one whose
producer chain is verified live end to end. What is absent is named, not faked.

**Raised one notch on 2026-09-06, and only one.** The canonical face has now been driven
through a whole commercial event on the sim tenant — door count → delivery → link → propose →
counter → accept → AGREED (`both_sides_recorded`) → VERIFIED — with the gates, the thread and
the spine rendering real rows rather than fixtures, and the four refusals measured (409 each,
each naming what is missing). It is still **not** `built`: the line table mis-columns our own
count (§9), the gates are unreachable from a consolidated document's page (§9), and no
document on this tenant has yet been read by an extraction model, so the four-way table is
still proven against a degraded parse.

The canonical face (ADR 0104 slice 2) is **built and gated OFF**: route, page,
seven sections, 27 component tests and 5 page tests, plus a gateway read route
(`GET /procurement/documents/:id/canonical`) and the delivery spine's own endpoint.
Its maturity is **skeleton-with-real-data-once-extraction-works** — the code path is
end-to-end real (three documents through the real door, read back through the real
route, rendered in a real browser), and the only thing it has ever had to render is
the degraded state, which is recorded in §9 rather than glossed.

**Verdict unchanged by ADR 0063 (2026-09-02), and here is why it did not rise.**
The rebuilt lane's headline defect is fixed — it could not display the invoice it
asked a human to certify, and now renders it beside the lines — along with the
tenant-keying leak, three [[0051-rebuilt-pages-show-live-data-only|ADR 0051]]
honesty breaches, the hidden confidences, and the false "never auto-written"
docblock over a live write path. But the lane is still behind
`mudavym_design_receipts` (OFF), the gaps listed below are still gaps, and two
named limits remain: `procurement_document_lines` has no `updated_at`, so two
managers on one document are still last-write-wins (the collision is now
*announced*, which is not the same as prevented), and no endpoint exposes
`procurement_order_lines`, so a pairing badge names the ordered wine and the
order-line id rather than that line's own description.

**Real, with a live producer.** A vendor emails an invoice → Gmail push webhook
(`apps/api-gateway/src/communications/communications.controller.ts:1030-1180`)
publishes `email.inbound.received` → `RabbitMqBridgeService.handleInboundEmail`
stores the message and `persistAttachments` writes the file to the
`vendor-attachments` bucket + a `conversation_attachments` row
(`common/orchestrator/rabbitmq-bridge.service.ts:845-897`) → the `@Cron("*/5 * * * *")`
sweep downloads it, filters non-documents, and ingests it under its own correlation
id (`procurement/documents/document-intake.service.ts:581-645`). Content-addressed by
`sha256`, so re-running is a no-op (`:608-618`). Credits are opened automatically
from an invoice mismatch by `openCreditClaim`
(`procurement/procurement.service.ts:1104-1132`) and refuse to be reported as
recovered without both an amount and a memo (`documents/credits.controller.ts:164-240`).

**Not built, and the page is where it would go:**

| Gap | Evidence |
|---|---|
| Credit claims are never *sent* | `transition(→ requested)` stamps `requested_at`/`requested_by` and returns (`credits.controller.ts:218-221`). No email, no notification, no queue. This is the TIER-MAP S03 "opened-never-sent" row, confirmed in code |
| ~~Settling a claim asks the operator to type a UUID~~ [2026-09-25: fixed on the live route — a memo picker, §1c; the legacy page keeps its prompt until the cutover deletes it] | `window.prompt("Credit-memo document id (required…)")` (`ReceiptsPage.tsx:129-137`) — the credit memo is a document this page already lists, and there is no picker |
| Line-match suggestions have no UI | `POST /procurement/documents/:id/match` exists (`documents.controller.ts:208-223`); nothing renders it. Deferred by design (`v3.0-TECH-DEBT.md:447`) |
| Recovery metrics not built | `v3.0-TECH-DEBT.md:446` |
| No error state | `listQuery.isError` / `creditsQuery.isError` are never branched (`ReceiptsPage.tsx:210-214`, `:427-429`) — a 500 renders "No documents in this lane" |
| No way out | The brief's observation confirmed: `useSearchParams` is used for the tab only (`:59-63`); the page has no `navigate`, no `Link`, no route to the order a document bills |

- **2026-09-04:** three synthetic documents rendered in the canonical view behind the gate, with extraction supplied from Claude Code through `POST /procurement/documents/:id/extraction` (the gateway's model key has no credit): price base, as-printed strings, "not counted" and the honest tie-out line held; nine findings filed.
- [changed 2026-10-01: maturity stays partial. The founder's walk-through (P1) found the queue could not tell a real problem from noise; the VAT rule behind most of it is fixed and the list, sheet and card now give one verdict (RECEIPTS-W5, W6-A, W7).]
- [changed 2026-10-01: the page was driven live on the production database through a local gateway, as the Sim owner and then the founder's account, in the Sim house: line corrections that seal and undo, the swipe confirm and the shelf link were pressed and succeeded; a read-only baseline showed no failed call and no console error beyond the dev build's missing-DSN warning (RECEIPTS-W13; P9).]
- [changed 2026-10-01: keyboard, overlays and mobile were measured in a headless browser with every write aborted: Tab stays inside both field dialogs, Escape returns focus, the page's scroll locks and lets go, and the page fits at 375 and 390px (RECEIPTS-W30, W31, W32, W34, W35, W36).]
- [changed 2026-10-01: contrast was measured on 145 text nodes, none under 4.5 : 1; the edit-box edges went from about 1.1 : 1 to 3.6 : 1 against the paper (RECEIPTS-W39).]
- [changed 2026-10-01: not seen live, so still unproven: a queue per role that holds documents (neither Sim role has one), a queue longer than eight papers, a real phone (the phone checks are emulated), "Try again" on a failed original link, the upward branch of the "where it came from" box, and a filled Credits tab in production, which holds no claim (RECEIPTS-W8-C, W20, W36; P4, P7).]
- [changed 2026-10-01: what keeps it at partial: a document still cannot be linked to an order after intake, lines still show twice, the engine's checks never reach the page, and a paper the house issued is not recognised as one (RECEIPTS-W2, W4, W14, W45; the ways forward are in §13).]

## 11. Data flow

### Calls out

| Method | Path | Auth | Gateway controller | Returns |
|---|---|---|---|---|
| GET | `/procurement/documents?status=needs_review\|verified` | JWT (class, `documents.controller.ts:45`) | `:98-153` | Document headers for the lane |
| GET | `/procurement/documents/:id` | JWT | `:155-206` | Header + extracted lines + tri-state match checks |
| POST | `/procurement/documents/:id/verify` | JWT | `:258-...` | Moves the doc to `verified` |
| GET | `/procurement/credits` | JWT (class, `credits.controller.ts:89`) | `:94-121` | Claims for the restaurant |
| GET | `/procurement/credits/stats` | JWT | `:123-162` | `claimed` vs `recovered` vs `selfEvidencedOpen` — deliberately different fields (`:75-82`) |
| POST | `/procurement/credits/:id/transition` | JWT | `:164-240` | Refuses `credited` without amount **and** memo |

[2026-09-25: the credits rows above describe the legacy tab. The live lane (§1c) calls
the same three routes plus `GET /procurement/documents?docType=credit_memo&limit=100`
for the memo picker; `/stats` additionally returns `byCurrency`, `rowsCounted`,
`capped`. Line numbers above predate both changes.]

Unused by the page: `POST /procurement/documents` (manual upload, `:53-96`),
`POST /:id/match` (:208), `POST /:id/lines/:lineId/link` (:225).

### Fed by

| Data | Producer | Live? |
|---|---|---|
| `procurement_documents` (email channel) | `@Cron("*/5 * * * *")` sweep over `conversation_attachments` → `DocumentExtractorService` → `ModelClientService` (`document-intake.service.ts:581-645`) | **Yes.** Its input depends on the Gmail push path, which carries live traffic |
| `conversation_attachments` | `rabbitmq-bridge.service.ts:882` on inbound mail | Yes |
| Same, via the provider-agnostic webhook | `POST /webhooks/inbound-email` — `@Controller("webhooks")` + `@Post("inbound-email")` (`inbound-email.controller.ts:42,53`) | **Dormant** — `INBOUND_EMAIL_DOMAIN` unset, read in `inbound-address.service.ts:29` (**not** in the controller); the controller's own gate is `INBOUND_WEBHOOK_SECRET` (`inbound-email.controller.ts:61-68`), also unset. The Gmail path covers it today; this is the multi-tenant replacement |
| `procurement_documents` (door channel) | `POST /procurement/documents` from `/receiving-door` | Yes |
| `procurement_credits` | `openCreditClaim` on invoice match (`procurement.service.ts:1104-1132`); `receiving.service.ts:325` reads them for the manager queue | Yes |

### Writes

| Write | Downstream reaction |
|---|---|
| `documents/:id/verify` | Document leaves the `needs_review` lane; the page force-switches to `verified` (`ReceiptsPage.tsx:103-108`). No notification, no ledger entry |
| `credits/:id/transition` | Ageing timestamps (`credits.controller.ts:216-226`); `/receiving`'s manager queue re-sorts (`receiving.service.ts:309-334`). **No vendor is contacted** |

## 12. Design intent

**Should be:** the surface where paper the vendor sent becomes money the vendor owes,
without a human retyping anything.

| State | Handled? | Evidence |
|---|---|---|
| Loading | Yes | `:210-213`, `:238-241`, `:427-428` |
| Empty | Yes | `:214`, `:364`, `:429` |
| Error | **No** | See §10 — silent; failure looks like a quiet week |
| Permission-denied | **No** | No 403 branch |

The E49 em-dash rule is implemented and worth preserving: `dashNull`
(`services/api/documents.ts:62-66`) renders an unevaluatable check as `—`, never as a
pass — the opposite of the fabricated-zero habit elsewhere in this cluster.

**Where the UI misleads:** the credit tab's state buttons imply a chase, and the
chase never leaves the building (§10). "Claim → requested" reads as "we asked them".

## 13. Roadmap

**2026-10-01 — the founder's walk-through of this page, built on `fix/review-receipts`.** Every row is in §14; §1a says what each change did.

- [changed 2026-10-01: one tie-out verdict across the sheet, the card and the list: the VAT breakdown counts, the card follows the sheet, the list recomputes on read, and no stored verdict was rewritten (RECEIPTS-W5, W6-A, W7)]
- [changed 2026-10-01: the open document is readable and kept in the address: sheet first with the card trimmed to its acts, full width below 1536px, `?doc=` on every click, `?credit=` on the Credits tab (RECEIPTS-W1, W2, W3, W20)]
- [changed 2026-10-01: the card reads the linked order from the document's links, is five named parts, and folds the money when it is filed (RECEIPTS-W4, W9, W10, W12)]
- [changed 2026-10-01: the list leads with the vendor, and papers that read cleanly now reach the page (RECEIPTS-W8-A, W44, W44-SELF)]
- [changed 2026-10-01: the original, the shelf and the swipe say only what they know: no button without a link, the year beside the tick, the swipe off while lines are unread, a note for a link the house does not hold, and a closing seal motion (RECEIPTS-W8-B, W8-C, W11, W15, W18, W19, W21)]
- [changed 2026-10-01: words in plain English across the sheet, the card, the list, failures and Credits (RECEIPTS-W6-B, W6-C, W6-D, W22, W23, W24, W25, W26, W27, W28, W29, W37, W38, W41)]
- [changed 2026-10-01: keyboard and overlays: the field popover, both field dialogs on the house `Panel`, and a skip link (RECEIPTS-W30, W31, W32, W33, W40)]
- [changed 2026-10-01: phones: the open document fits at 375 and 390px, both line tables stack, and the "where it came from" box stays on screen (RECEIPTS-W34, W35, W36)]
- [changed 2026-10-01: brand and contrast: edit-box edges at 3.6 : 1 and a letterhead frame on the sheet (RECEIPTS-W39, W45c, W45c-SELF)]

**2026-09-11 — a held invoice's header money now survives a restatement, and the sentence
says which figures moved.** From the adversarial audit of `b6d2e4b4` (BLOCKING, three of
three verifiers). **What was wrong:** for a held document the header columns on the row are
NULL — intake writes them that way from the withheld parse, and `editLine` never repairs them
— so as soon as ONE line carried money, `planRefile` chose that all-null header, and the
withheld subtotal, freight, tax and total were never put back. `document.total` was written
NULL, permanently: every later restatement saw priced lines and took the same branch. The
page then showed a sentence that said the money *"was held and is now filed … the vendor's
own figures were put back"* beside *"The document states no total"* — a claim about a write
that had not happened. **What it does now** (`invoice-currency.ts:780`): the header comes
from the row only when the row's own header carries money, otherwise from the withheld
reading; each line keeps its own figures or recovers them; the tie-out is recomputed.
**What a person is shown** (`document-intake.service.ts:2240`): the sentence names the parts
— *"Put back from the reading withheld at intake: the header's subtotal, freight, deposit
total, tax and total; and line 2. Kept exactly as they stood on the document, corrections
included: line 1."* — and it no longer says the vendor's figures were put back when some were
kept. A restatement that puts nothing back says so and drops the "was held" claim entirely.
Pinned at `invoice-currency.spec.ts:1070` and `document-intake.service.spec.ts:591`; of the
five held-row cases added, three fail on the pre-fix code and two pass it (they pin
invariants that already held). Not verified in a browser: no ceremony was captured this pass.

**2026-09-06 (batch 67) — the currency vocabulary is now all of ISO 4217, and a typed
receiving price states its code or is refused.** Two founder decisions, one pass. (1) The
gateway's currency list went 96 → 157 — every ACTIVE ISO 4217 code, minus the 22 in list
A1 that are not money a vendor bills in (metals, test, bond units, units of account, funds
codes) — mirrored against `apps/web/src/lib/currency.ts` by `iso-4217.spec.ts`, which
reads that file as text and fails on a one-code difference either way. *"A Hong Kong or
Macau vendor's invoice files instead of being held."* HKD, MOP, XOF, XAF, XCD, XPF and
about 55 others were HELD for one day and now file; ZZZ, XTS, the metals, the funds codes
and every WITHDRAWN currency (HRK, CUC, SLL, ZWL, MRO, STD, VEF) are still refused, by
name. The web table gained each currency's MINOR-UNIT count, so a figure prints with the
decimal places its money actually has. (2) `verifyReceipt` and `VerifyReceiptDto` refuse a
`invoiceUnitPrice` with no `invoiceCurrency`, before any write — the three pinning tests
p4bt wrote on 2026-09-06 for the currency-null row are flipped, and the sentence names the
three ways to state a code (the order's, the house's, one typed here) and what still
records without one (the count, the rejection, the stock movement). Also in this pass, from
the Sonnet audit of `4abd03ff`: the two Stripe-backed message-credit gates
(`communications/text/credits/text-credits.controller.ts`,
`communications/text/text-usage.service.ts`) were still shape-only and now check
membership; and `planRefile` decides `current_rows` vs `withheld_snapshot` PER LINE
(source `mixed`, with per-line counts), which stops a two-line held document losing line
2's recoverable figures when a manager edits line 1.

**Both halves of that last sentence were corrected on 2026-09-11**, by the audit of
`b6d2e4b4`. (a) PER LINE was not far enough: the HEADER was still decided by the lines, so a
held document's header money was erased by the first corrected line — see the 2026-09-11
entry at the top of this section. (b) "Now check membership" was true and not sufficient:
both credit gates upper-cased without trimming while `isIso4217` trims, so `" try"` passed
the gate as `" TRY"` and was bound into the seal in one spelling and written in another. Both
now normalise through `currencyCode(...)` before the check
(`text-credits.controller.ts:187`, `text-usage.service.ts:514`).

**2026-09-06 — the invoice's money, and who may change it.** The founder, batch 63,
asked what an 810 with no `CUR` should do and answered verbatim:

> "take the houses own currency, but AI needs to or otherwise house delibaretly
> chnage it to other currency if the invoice is other than their default"

Built as three rules (see the §1a entry). What it replaced, measured on this tree by
a probe spec run against `git show HEAD:apps/api-gateway/src/procurement/documents/
x12/*.ts` and then deleted: a CUR-less 810 came back `currency: "USD"` with
`total: 528` beside it and **no warning of any kind**, indistinguishable from an
invoice a vendor had denominated in dollars; and `parseX12` took one argument, so a
caller that knew the house was in Turkiye had nowhere to say so. Three sibling
defects were found and closed in the same pass: `x12-credit.ts` pinned the literal
`"USD"` on an 812 that carries a real `totalCredit` and settles against the 810;
`x12-ship-notice.ts` did the same on a document with no money at all; and
`canonical/from-document-rows.ts` read a NULL currency back as `USD`, which would
have re-dollarised on the canonical face every document rule 1 had just refused.

**2026-09-06, batch 64 — the founder answered all four questions. Decided, not open.**

1. **A held invoice blocks the PRICE at receiving only** — never the stock movement —
   and, verbatim: *"let them approve if otherwise"*. A person may approve past the hold.
   The founder also asked for **a default-currency section on each vendor's profile**.
   **BUILT (2026-09-06, p4br).** `verifyReceipt` refuses a keyed-in `invoiceUnitPrice`
   while an attached invoice's money is not filed, before any write, in a sentence naming
   the hold's reason and the act that clears it; the stock movement is untouched and that
   is measured (`receiving-price-held.spec.ts` compares what a priceless receipt writes on
   a held document against a settled one). The approve-past IS the restatement act:
   `PATCH :id/currency` now accepts `previous === next` and logs it as
   `change_kind = 'confirmed'` with the same author and the same audit row
   (`20260906180000`). Before that, a manager who decided the currency the file already
   carried was right got a 409, and the only way past the refusal was to name a currency
   they did not believe in. See [[receiving]] §1a and [[providers]] §1a.
2. **Rule 2's evidence is shown only on a disagreement** — as built. The agreeing and
   unreadable cases are recorded on the document and not surfaced.
3. **Procurement's three writes will be sealed as a module in a later pass.** Not sealed
   now, and deliberately not one route at a time. ~~Later pass~~ — **BUILT the same day,
   see the block below.**
4. **Invoices already filed under the `USD` nobody chose are left alone** — as built.
   Nothing in this pass touches an existing row; rule 3 restates the ones a person
   disputes, and the audit log says who did.

**2026-09-06, batch 66 — the four follow-up questions, answered verbatim.**

> **"Keep: house currency for an unmatched invoice"**
> **"Add the prompt panel"**
> **"Keep it open on every invoice"**
> **"Two screens, for now"**

1. **The house's currency stays the last rung** for an invoice matched to no order. It was
   marked as an assumption in this file, in [[providers]] §13 and in ADR 0104 until this
   answer; it is now the founder's own call and those markings are replaced. An unmatched
   invoice is filed under the house's stated currency rather than refused.
2. **The prompt panel is to be built** — *"N of your M vendors have stated a usual
   currency"* — because with no vendor profiles filled in the order rung is inert and the
   chain silently falls back to the house exactly as before. It belongs to **p4bu** and is
   not in the tree as of this line.
3. **Confirmation stays open on EVERY invoice**, held or not. A manager may certify a
   currency before a dispute; the cost — rows that record nothing but somebody clicking —
   is accepted.
4. **Clearing a held price stays two screens.** [[receiving]] refuses and links to
   `/receipts?doc=<id>`, which opens that document (pinned by a router test in
   `ReceiptsNext.test.tsx`); the manager decides here and goes back. *"For now"* is the
   founder's own hedge and is recorded as one.

**2026-09-06, batch 64 — procurement's three writes are sealed as a module. BUILT.**

Asked whether procurement's write routes should be sealed, the founder answered verbatim:

> **"Decide as a module: seal all three (Recommended)"**

The option read: *"One policy for the corridor: verify, line edit and currency
restatement each take a redeemed seal like the payment and register acts do. Its own
pass; the receiving flow gains one ceremony per act."*

Built as ONE subject kind with three acts rather than three mechanisms — the same
`SealChallengeService` the order approval, the payment register and the credit purchase
redeem through (`common/seal/`), extended by
`supabase/migrations/20260906200000_a_document_act_takes_a_redeemed_seal.sql`, which
widens the seal's `subject_kind` CHECK by READING it and appending, never by a hand-typed
literal (four passes touched that one constraint this week). What each seal is taken over
is in `apps/api-gateway/src/procurement/documents/document-seal.ts` and in the §1a entry.

What this REPLACED, measured on this tree: all three routes wrote behind the JWT and, for
the restatement only, a role check — which answers *may this role* and cannot answer *did
a person*. The guard was run against `git show HEAD:` of the controller (copied to a probe
tree under `$SP`, no git state change) and named all three UNSEALED, exit 1.

Two costs, accepted and stated. **A moved cell is no longer a write**: correcting a
quantity now stages a pending correction and a hold sends it, which is one gesture per
correction where there used to be none. And the **other seven** write routes on this
controller (upload, extraction, match, link, field correction, field tick, door count) are
still unsealed; the founder's decision named three acts and nothing more, so the guard
PRINTS the seven as outside every census rather than either failing on them or passing
over them in silence. Whether the whole controller should join the money modules' rule is
a founder question, filed in p4bs's report.

**2026-09-11, batch 69 — four answers, verbatim. Decided, not open.**

The session asked these as "batch 68" by mistake; they are recorded as **batch 69**. The
real batch 68 (2026-09-06, recorded in commit `b6d2e4b4`'s message) had ALREADY chosen to
seal the canonical face's twin acts as a follow-up pass, to keep one ceremony per
correction until real use says otherwise, and to seal the receiving door as its own kind in
its own pass. The first answer below confirms that choice rather than making it.

> **"Seal corrections and fields/verify too"** — *"The decision then holds on both faces of
> the document; the guard's census becomes five acts."*
> **"Keep it: the picker offers what the gateway accepts"**
> **"Invoice's filed code first, then the order's"** — *"A reading of the document, like
> the quantities and prices on that screen already are; when the two disagree the
> comparison banner already says so. One line."*
> **"Keep as built; a held old code is a bug report, not a list entry"**

1. **The twins are sealed. BUILT (2026-09-11, p4bx).** `field_correct` and `field_verify`
   join `verify`, `line_edit` and `currency_restate` on the one `procurement_document`
   kind; the §1a entry says what each seal covers. No migration: the ACT lives in
   `mcp_seal_challenges.tool_name` under a non-empty CHECK only (`20260904170000`), and
   `20260906200000` already admits the kind. `check_money_routes_are_sealed.py`'s
   `SEALED_ACTS` census is five rows; the five other writes print under DELIBERATELY
   UNSEALED with a reason each (added after the audit of `b6d2e4b4`, which found the twins
   printed as "no decision names" while this note called all seven deliberate).
   What it replaced, measured: a probe spec run against `git show HEAD:` of the controller,
   then deleted, showed both routes completing their write with no seal and never touching
   the seal service. Not captured in a browser (see p4bx's report).
2. **The currency picker stays at all 157 active codes** — the gateway's list, the web
   table and the picker are one set (`apps/web/src/lib/currency.ts` header).
3. **The receiving price pre-fills from the invoice's filed code first**, then the
   order's, then nothing — see [[receiving]] §13.
4. **Withdrawn ISO codes stay refused.** An invoice naming HRK, CUC, SLL, ZWL, MRO, STD or
   VEF is held, and a held old code is reported as a defect, never answered by adding the
   code (`apps/api-gateway/src/common/iso-4217.ts` header). ANG stays beside XCG; VED and
   VES are both listed.


1. **Send the claim.** `→ requested` should draft the vendor email through the same
   approve-then-send path procurement already uses — the guardrail is decided
   (memory: autonomous-email-replies; never auto-send). Highest-value item on the page:
   it converts a ledger into recovery.
2. ~~**Credit-memo picker** replacing the UUID prompt (`ReceiptsPage.tsx:129-137`) —
   the documents are already listed two tabs away.~~ [2026-09-25: built on the live lane, §1c.]
3. **Error branches** on both queries; a failed lane must not read as an empty one.
   [2026-09-25: the credits lane names each failed source (§1c); the receipts lane already did.] [changed 2026-10-01: a failed read says what happened in plain words, per item, and the header says "not read" (RECEIPTS-W28, W29)]
4. **Link out**: document → its order, credit → its document. The page is a dead end
   by the brief's own finding. [changed 2026-10-01: the card now reads the linked order(s) from the document's links (RECEIPTS-W4); a manual link from a document to an order is decided, not built (RECEIPTS-W42, item 7 below)]
5. Render `POST /:id/match` suggestions (`documents.controller.ts:208`). Blocked:
   deferred by decision (`v3.0-TECH-DEBT.md:447`) — reopen or leave.
6. Recovery metrics (days-to-close, straight-through rate). Blocked on
   `v3.0-TECH-DEBT.md:446`.
7. **Link a document to an order when the numbers do not match.** [changed 2026-10-01: decided with the founder, to be built later on its own branch, not on this page's branch (RECEIPTS-W42). All three ways were chosen: match on a despatch number we already hold from the same vendor; when nothing matches, ask a person to pick the delivery; remember a vendor's numbers once a person has linked one. Today an invoice joins an order only when its printed order number equals ours, and there is no manual link in the API or the UI.]
8. **Receive a final invoice as a pasted photo.** [changed 2026-10-01: decided, each to be built later on its own branch (RECEIPTS-W43): paste or drop a picture on Receipts; keep the e-invoice number on the document; receive invoices over WhatsApp. Pictures in email text was not chosen. The case is the founder's real invoice. Today there is no paste or drop anywhere in the web app, email pictures are read only as attachments from known vendors, there is no WhatsApp, the e-invoice number is kept nowhere, and a repeat is caught by file hash only.]
9. **Papers the house issues, and invoices with no goods.** [changed 2026-10-01: decided, to be built later on its own branch (RECEIPTS-W45): a paper the house issued is recognised as such and given its own place, not the vendor queue; a running-cost invoice (a service, no goods) gets a no-goods kind with no delivery or order to match. Today the reader does not detect direction, and the vendor step refuses only when the seller's tax number equals the buyer's printed one or the house's own on file.]
10. **Three open decisions from the walk-through.** [changed 2026-10-01: lines appear twice, read on the sheet and edited on the card (OD-TBD-R3-1, RECEIPTS-W2); no route links a document to an order after intake (OD-TBD-R3-2, RECEIPTS-W4; its way forward is item 7); which of the engine's 30 checks a person sees, and in which words (OD-TBD-R3-3, RECEIPTS-W14)]

## 14. Founder walk-through — 2026-10-01 (branch fix/review-receipts)

Rulings recorded in [[0259-receipts-walk-through-r3-rulings|ADR 0259]].

Session R3, local gateway on the production DB with timers off (`p4-scratch/review-gw.sh`),
Sim owner in Sim Meyhouse (`a229f22b`). Chrome was not connected, so P10 compares by
commit only. [corrected 2026-10-02: Chrome connected later, so P10 is by commit and one read-only
look at mudavym.com/receipts; see P10.] [corrected 2026-10-01: the gateway ran as the Sim owner with outbound
credentials blanked only until 10:57; the W5 restart used the new `me` mode, so from
10:57 sends are REAL (log: `scheduler OFF, sends REAL`). The pane kept its Sim owner
session. No click since 10:57 has sent anything.] [changed 2026-10-01 16:14: the session moved
to the founder's other Claude account; from W17 on the pane is signed in as the founder's own
account (dev bypass, `me` mode, 8 houses), still in Sim Meyhouse, with Vite's socket on the
review gateway (`VITE_WS_URL`), so the "Connection Lost" toast is gone.] [changed 2026-10-01 17:27: the founder confirmed SYN-US-0114 (17:12:31) and SYN-US-0112 (17:12:40) themselves, in a Safari tab on this local site, each with its own seal; found from the gateway log and the rows' `verified_at`, asked as RECEIPTS-ALERT, answered "That was me, leave them". Queue 7 → 5 awaiting, 3 verified. Later P-pass examples use SYN-US-0111.]

From W7 on, every proposal follows the founder's 2026-10-01 ruling: a before/after of the
same view, a comparison sketch for UI changes (`review-snap-3/sketches/`, served on :5603,
opened in Safari), and nothing built before the founder has seen it. W6-A to W6-D were built before
they were asked, so they are marked SELF.

| id | what | evidence | ask | founder's words | status |
|---|---|---|---|---|---|
| RECEIPTS-W0 | The house data-terms sheet (ADR 0207, no close by design) covered the page for the Sim owner | screenshot at load; `DataTermsAcceptSheet.tsx:40-44` | how to get past it | "Hold to accept" | approved → done: Sim Meyhouse accepted by keyboard arm + confirm, `POST /settings/data-terms/acceptances` 200 |
| RECEIPTS-W1 | The formatted document embedded on /receipts (#458) is invisible at desktop: its sheet column is 2px wide, squeezed by the original pane's `minmax(260px, 320px)` column inside a 336px detail column | DOM: `.cd-scroll-x` width 2 at a 1280 viewport; `CanonicalDocumentPage.tsx:613`; full-page screenshot | stack the original pane below the sheet when embedded | "Approve" | approved → built → verified: sheet column 336px (680px after W3), table readable; screenshot |
| RECEIPTS-W2 | The selected document renders twice: the embedded sheet (verdict, four-way table, VAT, totals, original, provenance), then the review card (its own header, paper pane, line table, confirm); the detail column is ~2,400px and the confirm sits three screens down | `ReceiptsNext.tsx:1620-1625`; detail height 2395px at 1280×2900 | fork: keep both / sheet on demand / sheet first with the card trimmed to its acts | "Sheet first, card trimmed (Recommended)" | approved → built → verified: the card opens on "Check and correct" with the live tie-out; its money header and paper column are gone (the paper is now on demand from the sheet's "Bring the original"); a correction, a pairing or a match now invalidates the sheet's three queries (test mutated: fails without it); the two R1 tests now assert `PaperPane` directly plus a new "card does not restate" case. Lines still appear twice (read vs edit) → OD-TBD-R3-1 |
| RECEIPTS-W3 | At 1280 the open document gets 336px beside the 320px queue and the counter: the sheet's table needs 451px and the lines table ~380, so both scroll sideways; and the open document is not in the URL (ADR 0160), so reload, Back and a shared link lose it | DOM: `.cd-scroll-x` client 336 / scroll 451; `ReceiptsNext.tsx` selection was `useState` seeded once | below 1536px an open document takes the full width with a "← All receipts" back link; `?doc=` written on every click | "Approve (Recommended)" | approved → built → verified: 680px, no sideways scroll; a reload keeps the open document; `?doc=` click/back test |
| RECEIPTS-W4 | The card reads `doc.order_id`, a column `procurement_documents` does not have, so every document says "No order is linked" and "Check line pairing" is disabled for good; links live in `procurement_document_links`, which the detail already returns and the matcher already reads | baseline migration: no `order_id` on `procurement_documents`; `documents.controller.ts:1270-1297`; `document-intake.service.ts:1660-1668`; every test fixture set `order_id: 'o1'`, which hid it | read the linked order(s) from the detail's `links` | "Approve + show me" | approved → built → verified by test only (2 tests, both fail under mutation). The "show me" switch did not happen: Sim Meyhouse `aaecdb17` is not in this Sim owner's switcher (it lists Sim Bistro, Sim Meyhouse `a229f22b`, Sim Vanilla Kaleiçi); menu closed without switching. No route links a document to an order after intake (`link()` is called only from intake, `document-intake.service.ts:1369,2072`) while the card says "pair it" → OD-TBD-R3-2 |
| RECEIPTS-W5 | "does not tie out" / "off by $43.47" on 6 of 8 documents is the VAT: `applyTieOut` adds `tax`, which is null, and ignores the printed VAT breakdown that holds exactly $43.47 | `parsed-document.ts:460-520`; sheet prints Tax — and VAT breakdown $43.47 | fork: rule fix + what to do with the stored verdicts | "Fix rule, leave rows (Recommended)" | approved → built → verified: `statedTax()` uses the breakdown's amounts when `tax` is null and every row has one (`parsed-document.ts`); editLine and the currency restatement now pass the breakdown, so an edit really does correct an old row; 3 jest cases (mutated: fail without it), documents+canonical suites 660/660. Live: the sheet now reads "The lines add up to the stated total." Stored verdicts left as they are (queue rows, card, invoice-confirmed notice) → tech-debt row. The edit-line and restatement wiring has no test of its own |
| RECEIPTS-W6-A (SELF: built before asking) | After W5 the sheet says the lines add up while the card under it still says "does not tie out": the card reads the stored verdict, the sheet recomputes on read | live, same document, two verdicts on one screen | the card shows the sheet's verdict until a correction returns a newer one | "show me visual change diffs, and real life scenario" | SELF · before/after sent (same Sim Meyhouse invoice, old code vs new) → re-asked as W7, whose first question was dismissed with "do it per the new rule decided by the orchestrator"; W7: "Approve both (Recommended)" · approved → built → verified: `sheetQ` on `['canonical-document', id]` (the sheet's own key, so one request); test fails under mutation |
| RECEIPTS-W6-B (SELF: built before asking) | The verdict block says "billed 6 bottle, received 1 case" and prints `split_case` as stored | `VerdictBlock.tsx` suffix was the raw unit | unit words, singular only at exactly 1 | "Approve (Recommended)" | approved → built → verified: 2 vitest cases (fail when the singular rule is mutated) |
| RECEIPTS-W6-C (SELF: built before asking) | The sheet's provenance reads as machine output: "read by" + a model id, "sha256", "jurisdiction not set" | `CanonicalDocumentPage.tsx` provenance block | "read automatically" (model on hover), "file fingerprint", jurisdiction only when set | "Approve (Recommended)" | approved → built → verified: 2 vitest cases; live: all three old phrases absent |
| RECEIPTS-W6-D (SELF: built before asking) | The card's "Paired with" / "not paired" sits under the sheet's shelf pairing, and the method prints as a stored code (`vendor_sku`) | `ReceiptsNext.tsx` `PairedCell`; `procurement_document_lines_match_method_check` (baseline) lists 5 codes | column "Order line", "no order line yet", the method as a sentence for all 5 codes | "Approve (Recommended)" | approved → built → verified: tests updated (fail when the lookup is mutated); live: header and empty state read as proposed |
| RECEIPTS-W7 | After W5 and W6-A, the receipts list still prints each row's STORED verdict: at 1536px and wider, and after "← All receipts", six invoices say "does not tie out" while their sheets and cards say they add up | `documents.controller.ts` `list()` returned `ties_out` as stored; sketch `RECEIPTS-W7.html` (card and list before/after, Sim Meyhouse, SYN-US-0114) | recompute each listed row's verdict on read with the sheet's mapping (`parsedFromDocumentRows` → `applyTieOut`): one paged read of the listed documents' lines, no write; a failed line read keeps every stored verdict | "Approve both (Recommended)" | proposed → approved → built → verified: `tieOutsAsRuledNow` in `documents.controller.ts`; 2 jest cases (the recompute case fails when the method is stubbed out; the failed-read case [corrected 2026-10-01: now mutation-tested too, on a copy outside `src` so the live gateway was untouched: it fails when the failed read falls through to computing]; live: 6 rows now say "ties out", and SYN-TR-0001 still says "does not tie out", which matches its sheet (off by ₺180) |
| RECEIPTS-W8-A | P2: the list rows do not name the vendor; Sim Meyhouse's six Sep 11 invoices read "Invoice · SYN-US-01xx / Sep 11 · $547.47 · ties out" and differ only by number | `ReceiptsNext.tsx` queue row printed type · number / date · money · verdict; sketch `RECEIPTS-W8.html` §A | `list()` adds `vendorName`: the linked vendor's `company_name`, else `name` (what the sheet prints as seller), else the paper's `extracted.vendorName`; a failed vendor read falls back to the paper's name and logs; the row leads with it, and a row without a name keeps the number as its title | "Approve (Recommended)" | approved → built → verified: `vendorNamesFor` in `documents.controller.ts` (one `providers` read, no write) + the row in `ReceiptsNext.tsx`; 2 jest cases + 1 vitest case, all fail under mutation (run on copies, so the live pane and gateway were untouched); live: all 8 Sim Meyhouse rows lead with their vendor. Side finding: SYN-US-0101/0102 print the vendor without "(synthetic)", so they are probably not linked to the vendor record; checked by reading, not yet by query |
| RECEIPTS-W8-B | P2: the remembered-shelf tick proposes "2022 Scribe Estate, Sonoma Valley · 750 ml" on a line printed "SYNTHETIC Sancerre 2023 · 750 ml", with no word about the year | canonical response: the line's `vintage` and `formatMl` are null, and the year exists only in the description; the item's year exists only in its `wineName`; the memory key had no vintage to fold in; sketch §B | when the line's year (its vintage, else the one year in its description) and the item's year (its vintage, else the one year in its name) are both known and differ, add "This line prints 2023; that item is the 2022." beside the tick; the tick stays | "Approve (Recommended)" | approved → built → verified (`printedVintageOf` in `canonical-format.ts`; `RememberedShelf`, `CanonicalSheet` and the page pass it through). Two different years in one name → no note, never a guess. 3 vitest cases; the note case fails under mutation; live on SYN-US-0114: "This line prints 2023; that item is the 2022." |
| RECEIPTS-W8-C | P2/P3: "Bring the original" is an active button beside "no original was stored for this document". Pressing it opens a box saying "No file was stored", and it says that even when a file IS stored but its link failed, because the page passes `storagePath` = null whenever `imageUrl` is null | `OriginalPane.tsx`; `CanonicalDocumentPage.tsx` `storagePath={res.original.imageUrl ? … : null}`; `PaperPane` `!doc.storage_path` branch; gateway `signOriginal` returns three different reasons. Read from code: my live press was refused by the session's permission classifier, so the outcome is not observed live | with no signed link there is no button; the gateway's reason is the sentence; a reason other than "no original was stored" gets "Try again" (refetch) | "Approve (Recommended)" | approved → built → verified: 3 vitest cases in the new `original-pane.test.tsx` (both no-link cases fail under mutation); live: the button is gone on SYN-US-0114, which reads "No original was stored for this document." The "Try again" path is not seen live (no Sim document has a failed link) |
| RECEIPTS-W9 | P2: on every review the card's "This invoice's money" block (currency picker, reason box, a large disabled "Choose a currency first" bar, the no-conversion paragraph) sits between the verdict and the lines, even when the currency is filed and nothing is held | `ReceiptsNext.tsx` `CurrencyBlock`; SYN-US-0114 is filed in USD with no hold; sketch `RECEIPTS-W9.html` | when the currency is filed and there is no hold, result or error, fold the block to "This invoice's money is filed in USD - US dollar. Change the currency" (visible to every role; it opens the same block plus "Keep USD") | "qpproved + be aware that every component and detail can be read easily and wholeshouldn't confuse people, clear divisions" | approved → built → verified: 2 new vitest cases (fold + "Keep"; a hold never folds), the fold case fails under mutation (run on a copy); 9 existing currency/seal tests now press "Change the currency" first; receipts suites 70/70. The founder's second clause is a standing instruction for the rest of this page: each region must read on its own and be clearly divided from the next |
| RECEIPTS-W10 | P2, under the W9 instruction: the "Check and correct" card is one unlabelled block holding the tie-out, the confidence, the canonical link, the order sentence, the money, the lines, a pairing button sitting under the lines (away from the order sentence it depends on) and the swipe | 1600×2300 shot of SYN-US-0114; `ReceiptsNext.tsx` `DocView` header held five stacked lines; sketch `RECEIPTS-W10.html` (Safari beacon 336-336-800-800) | five named parts with a thin rule between each — THE READING, THE ORDER (with "Check line pairing" moved beside "No order is linked…"), THE MONEY, THE LINES, CONFIRM; the canonical link moved to the title row; the money box drops its own repeated label; no words changed (P5) | "Approve (Recommended)" | approved → built → verified: live after reload with no new console error (only the baseline `ws://localhost:4000` and `/onboarding/progress` 404); 1 new vitest case (part order, pairing inside THE ORDER and not THE LINES) that fails under mutation on a copy; receipts suites 48/48 (ReceiptsNext + ReceiptsSeal) |
| RECEIPTS-W11 | P2, same instruction: with the original closed, "No original was stored for this document." is a loose line between the sheet and the PROVENANCE box, the only region of the detail column without a label or a border | 1600×2300 shot of SYN-US-0114; `OriginalPane.tsx` closed states were a bare flex row; sketch `RECEIPTS-W11.html` (Safari beacon 672-672-800-800) | both closed states (nothing to bring / "Bring the original") sit in a box labelled THE ORIGINAL with the provenance box's border; the opened pane keeps its own header; the component is shared with /documents/:id, so it changes there too | "Approve (Recommended)" | approved → built → verified: live after reload with no new console error; 1 new vitest case (the named region in both closed states) that fails under mutation on a copy; original-pane 4/4 |
| RECEIPTS-W12 | P3 found a slip in my own W9 build: pressing "Change the currency" or "Keep TRY" removed the pressed button, so keyboard focus fell to the page body | live keyboard walk on SYN-TR-0001; `ReceiptsNext.tsx` `CurrencyBlock` | opening moves focus to the currency picker (or to "Keep" for a role that cannot pick); keeping moves it back to "Change the currency" | "Approve (Recommended)" | approved → built → verified: live by keyboard on SYN-TR-0001; 1 vitest case (W12) that fails under mutation on a copy. Not visual, so no sketch |
| RECEIPTS-W13 | P3 write controls, all on Sim Meyhouse's synthetic invoices: which may be pressed live | batched ask, 4 controls | press the chosen ones and record each outcome | "Bring the original, Correct a line, then undo, Swipe to confirm, Shelf ✓ link" | approved → pressed: "Bring the original" on SYN-TR-0001 (signed link 200, the PDF opened in the pane, no row written); SYN-US-0113 qty 6→5 sealed, then 5→6 sealed (PATCH 200 ×2, both stay in the line's history); swipe to confirm SYN-US-0113 (verify 201; queue 8 → 7 awaiting, 1 verified; there is no un-verify); shelf ✓ on SYN-US-0114 (link-item 201, links the Sancerre 2023 line to the 2022 Scribe item — the wrong year, kept on purpose, see W16) |
| RECEIPTS-W14 | SYN-TR-0001 reads "off by ₺180,00" and says nothing more. The engine knows why: the paper prints the deposit once ("Depozito (KDV %0) 180,00") but the reader filed it twice, as line 4 and as a document charge (reasonCode 7161); a check says line 4 "reads as a deposit but is billed as a goods line". None of the engine's 30 checks (`canonical.layer3.verdicts`) reach the page, their wording is technical ("BT-109", "nets to"), and one check is itself wrong (it adds the charge into line 4 and expects 360) | canonical response for doc `d0b96d4a`: `total_with_vat` and `deposits_coded_and_excluded` fail; `line_net_amount` for line 4 expects 360 | fork: record as an open decision / show hand-picked reasons now / leave it | "Record as an open decision (Recommended)" | approved → OD-TBD-R3-3 (which engine checks a person sees, and in which words); the deposit double-read and the wrong 360 check → tech debt for the reader. No page change |
| RECEIPTS-W15 | P3: once W13's shelf ✓ linked SYN-US-0114, the W8-B note "This line prints 2023; that item is the 2022." disappeared, so a wrong-year link looked settled | `RememberedShelf.tsx` computed the note only in the proposed state; sketch `RECEIPTS-W15.html` (Safari beacon 660-660-800-800, shots 2026-10-01 14:20) | one `vintageNote()` helper used by both the linked and the proposed states: the note stays beside "Linked to …", in the same amber, until the years agree | "Approve (Recommended)" | proposed (built live, then asked) → approved → built → verified: 1 vitest case (W15) that fails under mutation; re-read live 2026-10-01 16:17 as the founder's account: "Linked to 2022 Scribe "Estate", Sonoma Valley · 750 ml This line prints 2023; that item is the 2022." The founder chose to re-ask from the 14:20 sketch rather than retake the shots (the pane was hidden): "Skip the pane". Also shows on /documents/:id |
| RECEIPTS-W16 | SYN-US-0114 stays linked to the wrong-year 2022 Scribe item after W13 | the W15 row | unlink with "Not this one" (one write) or leave it | "Leave it linked" | ruled: left linked as a live example of the wrong-year link; not unlinked |
| RECEIPTS-W17 | Session handover to the founder's own account: Sim Meyhouse's data-terms sheet (ADR 0207, no close by design) covered /receipts again, since W0 accepted it only for the Sim owner | `review-snap-3/sketches/RECEIPTS-W17-terms.jpg` (sheet over the page, 16:14) | hold to accept as the founder's account, Sim Meyhouse only | "Accept it for me (Recommended)" | approved → done: by keyboard (Enter arms, Enter confirms); `POST /settings/data-terms/seal-challenge` 201, `POST /settings/data-terms/acceptances` 200 |
| RECEIPTS-W18 | Found in P4 (error state) on SYN-US-0112: with the detail fetch failing, THE LINES said "unknown, not empty" yet "Swipe up to confirm" stayed live, so the swipe could vouch for lines nobody had seen; "Check line pairing" was greyed out with no reason | `review-snap-3/sketches/RECEIPTS-W18.html` (before / after / normal, headless Playwright with the one detail request aborted; Safari beacon 16:46:49 `w=680-680-680`, old beacon format) | A: swipe disabled while `lines === undefined`, with a line above it ("Confirm waits for the lines. They could not be read…" / "Confirm opens once the lines are read."); B: reason beside the pairing button ("needs the order link, which could not be read" / "waits for the order link") | "Approve (Recommended)" | approved → done: `ReceiptsNext.tsx` Confirm part + pairing row; 2 vitest cases (41/41), each fails with its change removed (mutation on a copy) |
| RECEIPTS-W19 | Found in P4 (roles) as the Sim manager (Sim Bistro, `manager` gateway, sends mocked): `?doc=` naming a document this house does not hold (another house's, one still reading, one set aside, or one past the 200-item verified window) fell through to "Choose a document from the queue", as if no link had been followed | `review-snap-3/sketches/RECEIPTS-W19.html` (before / after, headless; beacon 16:58:07 `p=RECEIPTS-W19.html&b=safari&n=2&w=1048-1048`) | once both lists are read and the id is in neither: "The link asked for a document that is not in this house's review queue or its verified book. It may belong to another house, still be reading, or have been set aside." + "Show the queue" (clears `?doc=`); while loading "Opening the linked document…" | "Approve (Recommended)" | approved → done: `ReceiptsNext.tsx` empty-selection branch; 1 vitest case (42/42), fails with the branch removed (mutation on a copy) |
| RECEIPTS-W20 | Asked by the coordinator for shared batch 2 (founder-approved DASH-W16e): the house counter's "Credits promised" act links `/receipts?tab=credits&credit=<procurement_credits id>`, and the Credits tab ignored `credit`, landing on the list with nothing chosen | `review-snap-3/sketches/RECEIPTS-W20.html` (before / after / not-here; founder's account, Sim Meyhouse; production holds 0 credit claims (read-only count), so the one claim is a stubbed list answer inside headless Playwright, nothing written; beacon 17:16:36 `p=RECEIPTS-W20.html&b=safari&n=3&w=1048-1600-1048`) | `credit` in the URL is the selection (as `doc` is): opens that claim's sheet, closing drops it, a closed claim unfolds the Closed list, an id not in the ledger says "The link asked for a credit claim that is not in this house's ledger. It may belong to another house[, or be newer than the oldest N claims shown here]." + "Clear the link"; switching tabs drops `credit` | "Approve (Recommended)" | approved → done: `ReceiptsCredits.tsx` + `setTab` in `ReceiptsNext.tsx`; 3 vitest cases (credits 25/25, receipts 78/78), each fails with its part removed (mutation on copies) |
| RECEIPTS-W21 | Asked by the founder mid-walk: "add a motion signature to use to swipe up to confirm". Completing the swipe snapped the track to a solid pill dimmed to half strength (it read as greyed out) with a small tick, and nothing moved | `review-snap-3/sketches/RECEIPTS-W21.html` (before / A seal lands / B seal + the track gives; beacon 17:35:50 `n=3`) and `RECEIPTS-W21b.html` (before / A / seal + loading sign; beacon 17:46:22 `p=RECEIPTS-W21b.html&b=safari&n=3&w=2240-2240-2240`); founder's account, Sim Meyhouse, SYN-US-0111 completed by keyboard hold in headless Playwright with every write held in the browser (verify mint stubbed, `POST …/verify` never sent; SYN-US-0111 still awaiting review) | first which kind ("A closing seal motion (Recommended)"), then A vs B, then the rework | "seal lands + a loading sign", then "Approve (Recommended)" | approved → done: `SwipeToConfirm.tsx` lands the house's pressed `Seal` in the handle on `stamp` (as `HoldToApprove` does), the track stays at full strength once done, and after 400ms (the house loader's ladder) a 28×2px seal line under "Confirming…" breathes at the skeleton pulse (1.6s, opacity only; still under reduced motion; slot always reserved, so the resting control is 6px taller); the label still never says "Verified"; the idle arrow is now centred in its handle (it sat left); `MOTIONS.md` row `rc-swipe-seal`; 2 vitest cases in `ReceiptsSeal.test.tsx` (13/13), 5 mutations on copies all killed |
| RECEIPTS-W22 | P5 words, the sheet (`components/documents`, also rendered on `/documents/<id>`): "Öküzgözü 2021 · 750 ml · 2021" said the year twice; "per 12 bottle"; a charge printed its UNCL code ("Returnable container / deposit · 7161"); the original said "application/pdf — fetched only when you ask, through a one-hour link." | `review-snap-3/sketches/RECEIPTS-W22.html` (today's crops of SYN-TR-0001, founder's account, Sim Meyhouse, read only; proposals as before → after rows; beacon 18:00:39 `p=RECEIPTS-W22.html&b=safari&n=3&w=330-656-656`; after crops added post-build, beacon 18:16:58 `n=6`) | one batched multi-select, four rows | "Year once, per 12 bottles, Drop code 7161, Say "A PDF"" | approved → done: `nameCarriesYear` + `unitWord` in `canonical-format.ts` (the unit words moved there from `VerdictBlock.tsx`, one source); the code prints only as "reason code 7161" when no reason name came; `fileKind` says "A PDF" / "A photo" / "The stored file"; 3 new vitest cases + the price-base assertion tightened to `per 12 bottles$` |
| RECEIPTS-W23 | P5 words, Check and correct: "Open as the canonical document →"; THE READING said "ties out within tolerance" / "off by TRY 180.00" / "extraction confidence 35%" in mono; THE ORDER said "pair it before trusting any line", a pairing the page has no way to make (OD-TBD-R3-2); THE MONEY said "TRY - Turkish lira" | same sketch | one batched multi-select, four rows | "Own-page link, Reading in words, Order sentence, Money name" | approved → done: "Open this document on its own page →"; "The lines add up to the stated total." / "The total is off by ₺180.00 from the lines." / "The reader was 35% sure of what it read." (no score: "The reader recorded no confidence for this document."; a null tie-out: "No stated total to test the lines against.", which the ask did not show: same row, same words rule); "No order is linked to this document, so its lines have nothing to be checked against."; "Turkish lira (TRY)" via `moneyName` (also in the opened money box); THE LINES add the year only when the name lacks it; existing assertions moved to the new words; the link label has no test (it renders only behind the `document` design flag, which the test harness leaves off) and was read live |
| RECEIPTS-W24 | P5 words, waiting and failure: "Reaching the gateway…" in 4 places; `serverMessage` appended "(Network Error)" and "(HTTP 409)", and said "The gateway refused it with HTTP 500 and no message."; the empty Credits tab said no claim twice ("No credit claim has been opened…" then "Being chased 0 — No claim is being chased right now.") | same sketch; Credits read live after: ends after the first sentence | one batched multi-select, four rows | "Reading…, No answer, Refused, Credits once" | approved → done: "Reading the queue… / the claims… / the recovery figures… / the credit memos on file…"; a transport failure says "<fallback>: no answer came back. Check the connection, then try again.", a bare refusal "Mudavym refused it and gave no reason.", the server's own sentence is printed alone; `sentence()` joins what follows ("… Its lines are unknown, not empty.", "… The claim is unchanged."); the verify and claim-move fallbacks lost "gateway" ("The confirmation did not go through.", "Nothing was recorded."); "Being chased" is left out exactly when the figures print the no-claim sentence; 4 rc2-format cases + 1 credits case added, 2 credits assertions moved |
| RECEIPTS-W25 | P5, money sign: the queue printed "$547.47" beside "TRY 11,186.40" | same sketch | single choice | "Use ₺ (Recommended)" | approved → done: `fmtMoney` (page-owned `rc2-format.ts`) asks for the narrow sign only when the default display fell back to the code, and uses it only when it is one character from Unicode's currency-symbol block (₺ ₽ ₴ …), so ARS/SEK keep their code and CA$ is untouched (probed in node: TRY → ₺11,186.40, CAD → CA$12.00, ARS → ARS 12.00, SEK → SEK 12.00); the sheet keeps the paper's own format (₺11.186,40, 14.08.2026) by design; 3 rc2-format cases |
| RECEIPTS-W26 | P5, the verdict box on a document nothing was compared with: "not compared" said six ways (heading, a 50-word note, "nothing is being claimed", and one card per line each ending "so nothing was compared") | `review-snap-3/sketches/RECEIPTS-W26.html` (live crops of SYN-TR-0001 before at 18:16 and after at 18:22, founder's account, Sim Meyhouse; failure states filmed live with the list reads aborted in the headless browser, nothing written; beacon 18:33:53 `p=RECEIPTS-W26.html&b=safari&n=6&w=672-672-330-330-1030-1030`); built live first, variant B drawn | single choice, A built / B drawn / Deny | "A: say it once (Recommended)" | approved → done (`components/documents/VerdictBlock.tsx`, also on `/documents/<id>`): the note is one sentence, "That is not a discrepancy: no amount is claimed, and none is ruled out."; the money line drops "nothing is being claimed"; no per-line cards when no line was compared. The existing door-count test failed on the first cut: on our own `receiving_advice` the card is the only place that says "counted", so those cards stay (`counted` flag on the exception), and a mixed document keeps all its cards; 3 tests rewritten to the new words, 1 strengthened (the mixed case now carries the card wording) |
| RECEIPTS-W27 | P5, the queue row said "ties out / does not tie out / tie-out —" while the opened card says "add up" (W23) | same sketch | single choice | "Keep 'adds up' (Recommended)" | approved → done: "adds up / does not add up / no stated total"; no Sim document has a null total, so that word is held by a test only |
| RECEIPTS-W28 | P5, a failed read printed the client library's words: "The gateway could not be reached (the review queue (Network Error); the verified book (Network Error))", and Credits "Could not read the claims (Network Error)" | same sketch; before from code, after live with the reads aborted | single choice, A built / B drawn / Deny | "A: per item (Recommended)" | approved → done: `failureReason` in `rc2-format.ts` (no answer came back / the server's own sentence / refused, with no reason given / the reason is not known), used by both failure lists in `useReceiptsNextData.ts`; "Could not read the review queue (no answer came back); the verified book (no answer came back). The paper trail is unknown — nothing below is claimed." and "Could not refresh …" for a stale list; 4 rc2-format cases + 1 page case, 1 credits assertion moved off the raw `boom` |
| RECEIPTS-W29 | Found while filming W28 (P4 states), plus the last user-visible "gateway" sentences: the header kept saying "Reading the queue… · —" beside the failure alert; Credits drew an empty "Being chased" heading when the claims read failed; six sentences said "the gateway"; "tenant-scoped paper trail was never requested"; "the confirm ceremony live here" | same sketch, bottom table | multi-select, 4 rows, all built first | "Header 'not read', Being chased 'Not read', Mudavym, not gateway, No 'ceremony'" | approved → done: "queue not read · verified not read"; "Not read: see the note above."; "Mudavym" in the floor notes, the unknown-letters note, the staff refusal, the full-list note and the count hover; "no paper trail was asked for"; "Choose a document from the queue to see its lines and its order, and to confirm it."; 2 page tests + 1 credits assertion. Also fixed in this round: a W22 test called `doc()` without its argument, which vitest ran and `tsc` rejects — the W22 report of a clean tsc was wrong |
| RECEIPTS-W30 | P6, measured headless on SYN-TR-0001 field "Seller" (`/receipts` embeds `/documents`' canonical view): Tab from the field went to "Correct this", the field's blur closed the popover and unmounted it, and focus fell to BODY; a mouse crossing the 4px margin under the field closed it before arriving ("trigger bottom=481.8 tooltip top=485.8 gap=4.0px") | `review-snap-3/sketches/RECEIPTS-W30.html` (before/after traces + after shot; beacon 19:31:09 `p=RECEIPTS-W30.html&b=safari&n=2&w=420-1600`) | built first: a popover that holds actions is a disclosure (`aria-expanded`/`aria-controls`, `role=group` with a label); focus inside keeps it open, Escape returns focus to the field, the gap is padding; keyboard Enter/Space act through `onClick` with `detail === 0` beside the existing mouse-down; read-only fields stay `role=tooltip` | "Approve (Recommended)" | approved → done: `components/documents/ProvenanceHover.tsx` (not shared) + `__tests__/provenance-keyboard.test.tsx` (9 cases), 14 mutations on copies all caught; live after: 0.0px hit gap, a 12-step mouse move arrives, Tab → "Correct this" → "I have checked this", Esc → field, closed. Also changes `/documents` |
| RECEIPTS-W31 | Found by the same P6 run: "Correct one field" let Tab out at the 5th press and "Confirm" at the 2nd, onto the page behind the aria-modal backdrop; Escape on "Correct" worked only from inside it (container handler), so a lost focus left it open; both returned focus to BODY because their opener had unmounted | same sketch, second table + dialog shot | built first: one helper `components/documents/useDialogTrap.ts` mirroring `Sheet` (opener remembered, Escape on the window, Tab cycled; a Tab from outside brings focus back in); both dialogs use it; the popover hands focus to its field before opening a dialog | "Approve (Recommended)" | approved → done: `CorrectionDialog.tsx`, `FieldVerifyDialog.tsx`, `useDialogTrap.ts` + `__tests__/dialog-trap.test.tsx` (8 cases); 9 mutations caught (one more was aimed at the wrong test file; that same mutation is caught in the W30 set); a first-cut "re-arm" flag would have swallowed the next real focus (React ignores the focus event fired during a dialog's unmount) — found by a surviving mutation, removed, and a test now holds it; live after: 25 Tabs stay inside each dialog, Esc from BODY closes, focus back on the field, Tab away and back reopens it. Also changes `/documents` [corrected 2026-10-01: superseded by W32 — after this approval I also gave the helper the house scroll lock without asking (shown and approved as part of W32); then both dialogs moved onto `Panel` and `useDialogTrap.ts` was deleted, never committed. Its "a Tab from outside brings focus back in" did not carry over: `Panel` does not do that (shared-queue row). `dialog-trap.test.tsx` now holds 10 cases, not 8] |
| RECEIPTS-W32 | P6, after W31: the two field dialogs were drawn by hand after the overlay census (ADR 0112's census lists neither), so W31 rebuilt in a page helper what the house `Panel` already owns; measured on the originals: neither locked the page's scroll, neither had motion, and the "this does not edit" sentence sat above the hold | `review-snap-3/sketches/RECEIPTS-W32.html` (before/after of both dialogs on SYN-TR-0001 "Seller", founder's account, Sim Meyhouse, every non-GET aborted, shots after 20 Tabs; beacon 19:55:24 `p=RECEIPTS-W32.html&b=safari&n=4&w=1600-1600-1600-1600`) | first the fork (keep the page helper / move both onto `Panel`), then the built result: both are `Panel`s — `label` a contract sentence, the "does not edit" / "changes nothing" sentence as the header `contract`, eyebrow + field name as title, "Cancel" top right, the hold alone in the footer; Correct starts in "What it should say", Confirm starts on Cancel (the control that writes nothing); `useDialogTrap.ts` deleted | "Move both onto Panel (Recommended)", then "Approve (Recommended)" | approved → done: `CorrectionDialog.tsx`, `FieldVerifyDialog.tsx` (not shared; they import `Panel`, which is unchanged); `dialog-trap.test.tsx` 10 cases (Tab/Shift+Tab ×12 inside, page held still and let go, where focus starts + the word, Esc from anywhere → field, the field reopens on the next real focus); `field-verify-dialog.test.tsx` reads the Panel's dialog; 7 mutations on copies all caught; live after: 20 Tabs stay inside each, `body` overflow hidden while open and restored after, a wheel over the dim leaves the page at 0, Esc → field; motion `settle` (2–3 running animations) and none under reduced motion (`data-motion="none"`, 0 running). `Panel` does not bring back focus that something else already moved out (its Tab cycle is the panel's own `onKeyDown`, `components/mudavym/Sheet.tsx:834`): shown on the sketch, queued as shared. Also changes `/documents` |
| RECEIPTS-W33 | A P5 miss found in P6: the Confirm dialog printed the field's internal key ("seller.name") under the value; P5 read the sheet and the card but never opened this dialog | sketch RECEIPTS-W32 (before shot of Confirm) | remove the line; the title already names the field | "Approve (Recommended)" | approved → done: `FieldVerifyDialog.tsx` no longer renders `path` (the prop stays, documented as not shown); asserted in `dialog-trap.test.tsx` and caught under mutation. Also changes `/documents` |
| RECEIPTS-W34 | P7, measured headless (phone emulation, every non-GET to the gateway aborted): at 375px an open receipt was 419px wide (390px: 420px) — 44px past the screen, its right edge cut off and the Correct dialog off-centre (box x 38 of 375). Cause: below the breakpoint the page grid names no column, so its one implicit column is `auto` and grew to the sheet's line table (`gtc 403.359px`, the SECTION `min-width:auto`) | `review-snap-3/sketches/RECEIPTS-W34.html` (before/after of the open document and the dialog at 375, plus the two line tables that became W35; beacon 20:16:09 `p=RECEIPTS-W34.html&b=safari&n=6&w=750-750-750-750-750-750`) | built first: `grid-cols-1` on the page grid in both states, so the column is `minmax(0, 1fr)` — the screen's width — and the table scrolls inside its own box as the sheet intends | "Approve (Recommended)" | approved → done: `pages/receipts/next/ReceiptsNext.tsx` (page grid, not shared); live after at 375 and 390: page width = screen, 0 offenders, the dialog centred (x 16, w 343), list, Credits and the reloaded `?doc=` all fit; `ReceiptsNext.test.tsx` "the page grid names its one column in both states" — 2 mutations (either state losing the class) both caught |
| RECEIPTS-W35 | P7, found with W34: on a phone both line tables hid the line total past the right edge until swiped, and nothing said it was there — the sheet's eight columns were 395px in a 343px box, THE LINES 361px in 301px ("TOTA", "744…", the order-line column wholly off screen) | sketch RECEIPTS-W34 (the fork, with both tables' before shots), then `review-snap-3/sketches/RECEIPTS-W35.html` (before/after of both tables at 375; beacon 21:19:50 `n=4&w=750-610-750-602`, re-opened 21:42:18 after one sentence was corrected — see W36) | first the fork (stack on phones / leave them swiping / record as an open decision), then the built result: below 640px each row is a grid — the sheet: number and item, then ordered · shipped · received, then billed · unit · line, each under its own small word; THE LINES: the name, then Qty · Unit · Total side by side (still inputs), then the order line. Screen only; print keeps the table. Table roles are spelled out on both, because changing a table's display drops them in some screen readers | "Stack on phones (Recommended)", then "Approve (Recommended)" | approved → done: `components/documents/CanonicalSheet.tsx` (roles, `data-cell`, `data-label`), `pages/documents/next/canonical-document.css` (phone block), `pages/receipts/next/ReceiptsNext.tsx` (`head` words, roles, phone block in the page style); none shared. Live after at 375: both tables' boxes fit (343/343, 301/301), rows are grids, 32 and 20 role cells; at 700 and 1600 both stay tables. Tests: `canonical-sections.test.tsx` 2 cases, `ReceiptsNext.test.tsx` 1 case; 7 mutations all caught. Also changes `/documents` |
| RECEIPTS-W36 | Found while checking W35's sketch claim that a tap still shows where a figure came from: the "where it came from" box hangs 260px right from its figure inside the sheet's scroll box, which clips it — measured on line 2's total, 181 of 260px hidden at 1600 (box 600–1256, popover 1177–1437) and at 1024, and at 375 "Correct this" cut in half (popover 254–514 in a box ending at 359). Present before today on every screen. (A headless phone tap also closed the box at once; that was the emulator's leftover mouse pointer firing a mouse-out — with the pointer on the figure the tap opens it and it stays — so it is not a page defect, and no real phone was tested) | `review-snap-3/sketches/RECEIPTS-W36.html` (before/after at 375 and 1600; beacon 21:42:18 `p=RECEIPTS-W36.html&b=safari&n=4&w=750-750-940-940`) | built first: on open the box measures the nearest box that clips it (or the screen), moves left just far enough to fit, narrows when even that is not enough, and opens upward when there is no room below and room above; it stays inside the field's markup, so hover, focus and keyboard are unchanged | "Approve (Recommended)" | approved → done: `components/documents/ProvenanceHover.tsx` (not shared) + `__tests__/provenance-placement.test.tsx` (6 cases); 5 mutations all caught. Live after: 375 popover 99–359 in 16–359 (box no longer scrolls: 343/343); 1600 996–1256 in 600–1256; 1024 line 4 opens below with room (bottom 921 of 1013). The upward branch is held by tests only — no live case reached it. Also changes `/documents` |
| RECEIPTS-W37 | P8 sweep (words found while walking the keyboard): the paired-line sentence printed a database id (`#` + 8 characters of `order_line_id`), "the wine" for any item, "confidence 94%", and part of an id when the order has no number; "Against order" fell back to `orderId.slice(0, 8)`; Unlink sat inline with a name that did not say which line | `review-snap-3/sketches/RECEIPTS-W37.html` (before/after of the paired line and the door strip, each in the read-ok and read-failed state; before shots with the GETs **stubbed**, every non-GET aborted; beacon 22:09:46 `p=RECEIPTS-W37.html&b=safari&n=10&w=614-614-614-614-1000-1000-440-400-400-420`) | built first, then asked: no id, "the item", "94% sure of the match", "Against an order with no number", Unlink on its own line named for its line | "Approve (Recommended)" | approved → built (in the WIP checkpoint at first, committed with this branch) → verified headless on stubbed reads; ReceiptsNext 52/52 and Credits 27/27 at the time, mutations 9/9 then 11/11 caught, files restored and `cmp`-checked. The order's name still arrives as the gateway's `wineName` field (gateway shape, not page wording; tech-debt) |
| RECEIPTS-W38 | Same sweep: "btl" on the door strip and on a credit claim, and the door strip's unnumbered order shown as part of its id | sketch RECEIPTS-W37 (`w37-door-*`, `w38-claim-after.png`; no before shot of the claim was taken) | "24 counted" on the door strip, "quantity 2" on a claim, and an order with no number says so | "Approve (Recommended)" | approved → built → verified in the same run and mutations as W37 |
| RECEIPTS-W39 | P8: every edit box's edge measured 1.1–1.3 : 1 against the paper (`--paper-2`), the rule for a control's edge being 3 : 1; house-wide, since it comes from the house colours (`COLOR-CONTRAST-REPORT.md` names `#8F8674`: 3.1–3.6 on paper, 5.2 on charcoal) | P8 run (145 text nodes, 0 text fails; 12 line boxes at `border 1.1`); `review-snap-3/sketches/RECEIPTS-W39.html` (before/after; beacon 22:32:08 `n=4&w=400-400-620-640`) | first the fork (fix page now + queue / queue only / record as open), then the built result: `1px solid var(--line-control, #8F8674)` on the line boxes, the currency picker and its "why" box, the correction form (also `/documents`) and the credit-settle amount box; measured 3.6 : 1 | fork: "Fix page now + queue (Recommended)"; on the built result the founder answered with a new ask instead ("create border giving Mudavym at top right, and what happens if the 'irsaliye' is photo taken and has different Id numbers that we don't understand what do we doi then? + what do we do when we get  final invoice as the pasted photo?"), which became W39b, W42, W43 and W45c | approved → built → verified headless; 10/10 mutations caught (the first run was invalid: zsh did not split the test list, so nothing ran; re-run under bash). **Kept by inference:** W39b's question said the box edges stay as built unless its last option was picked, and it was not. SHARED: the `--line-control` token (light `#8F8674`, dark `#736B61`) is queued in `p4-scratch/review-shared-queue.md`; until it lands, this page's boxes differ from other pages' |
| RECEIPTS-W40 | P8 keyboard: reaching the swipe on SYN-TR-0001 took about 94 Tabs, because each figure has three stops (W30) | `w40-stops.png`, `w40-skip-focused.png` in sketch RECEIPTS-W39 | first the fork (skip link / actions only after Enter / both / keep), then the built result: a hidden "Skip to the review card" link is the first stop on the document; Enter lands on "Check and correct", and 15 more Tabs reach the swipe; the address does not change | fork: "skip link + show me how we we transform third party vendor incvoices to our formatted with visual one page with the received invoice and  our formatted version"; built: "Approve (Recommended)" | approved → built → verified headless (skip → card → 15 Tabs); mutations in W39's run. The "show me" half became `review-snap-3/sketches/RECEIPTS-W41.html` ("Paper to page": the received PDF, rendered locally with pdf.js from a signed link, beside our sheet; beacon 22:32:07 `n=2&w=952-656`) |
| RECEIPTS-W41 | From "Paper to page": seven gaps between the vendor's paper and our sheet: (a) the deposit counted twice, (b) the order number read but dropped (`from-document-rows.ts` set `poNumber: null`), (c) "The document states no VAT breakdown" blamed the paper for what we did not read, (d) the seller's tax number not shown, (e) the VAT rate and base not read, (f) Ordered / Shipped / Received never filled, (g) Billed a bare number | sketch RECEIPTS-W41; then `review-snap-3/sketches/RECEIPTS-W45.html` (sheet before/after; beacon 23:29:21 `n=8&w=656-656-320-352-352-672-672-672`) | fix (b), (c), (g) here; (a), (d), (e), (f) to the defect list | "Order number,VAT sentence,Unit beside Billed,None, list only"; clarified as W41b: "Fix 3, list the rest (Recommended)"; built result (W41c): "Approve (Recommended)" | approved → built → verified live headless: order reference "SYN-PO-0001"; "Tax of ₺1.834,40 was read, but not its rate or what it was charged on."; Billed "12 bottles", "24 bottles", "6 bottles", "2 each". Gateway: `poNumber` read from the snapshot (`po-number-readback.spec.ts`; jest 40/40 with its neighbours; mutations 2/2). Web: `canonical-sections` 76/76. The unit is added only when Billed equals the printed quantity, so a case converted to bottles stays bare. Also changes `/documents` |
| RECEIPTS-W42 | The founder's W39 question: an irsaliye photographed at the door whose numbers we do not recognise. Measured: an invoice joins an order only when its printed order number exactly equals ours (`autoLink`, method `po_number`); `referencesDocNumber` is shown as "Despatch reference" but never used to link; there is no manual document-to-order link in the API or the UI | `review-snap-3/sketches/RECEIPTS-W42.html` (no images; beacon 22:55:34 `n=0`) | each pick becomes a decision and its own branch; none is built on this page branch | "Despatch number (Recommended),Ask a person,Remember vendor numbers,Record only for now" | recorded, not built here: all three ways are decided (match on a despatch number we hold from the same vendor; ask a person to pick the delivery when nothing matches; remember a vendor's numbers once a person links one); "Record only for now" read as *record now, build each on its own branch*, as the question said. In this page's ADR |
| RECEIPTS-W43 | The founder's W39 question: a final invoice that arrives as a pasted photo; with the founder's own real invoice as the case (a PDF on the founder's machine, read locally only and never copied into the repo; its bank details, tax numbers and e-invoice number are kept out of every sketch, note and commit). Measured: no paste or drop anywhere in the web app; email pictures are read only as attachments from known vendors (inline body pictures skipped); no WhatsApp; the e-invoice number (ETTN) is kept nowhere; dedupe is by file hash only | sketch RECEIPTS-W42 | each pick becomes a decision and its own branch | "Paste or drop on Receipts (Recommended),Keep the e-invoice number,WhatsApp" ("Pictures in email text" not picked) | recorded, not built here. In this page's ADR |
| RECEIPTS-W44 | Papers that read cleanly (`status = received`) never reached Receipts: they appeared only on Documents & Reports, so no person's swipe confirmed them (confirming has no status check) | `w44-queue-before.png` (**stubbed**: the clean list emptied, every non-GET aborted) and `w44-queue-after.png` in sketch RECEIPTS-W45 | list them after the papers that need a look, under "Read cleanly · not yet confirmed", counted on their own; leave out the house's own papers (`direction = issued_by_us`) | "Show them (Recommended)"; built result (W44b): "Approve (Recommended)" | approved → built → verified live headless: "5 awaiting review · 15 read cleanly · 3 verified"; the 10 house door counts left out; a clean paper opens by `?doc=`. ReceiptsNext 61/61 with Seal; mutations 10/10 caught, no-op control passed. Most of the 15 are earlier builds' test papers (SYN-D15-…, tech-debt) |
| RECEIPTS-W44-SELF | Found building W44: an irsaliye in the new list read "delivery_note", because the page kept its own short type map | `w44-irsaliye-label.png` in sketch RECEIPTS-W45 (no before shot) | use the sheet's own word map for all twelve paper types, "Document" for anything else | covered by W44b's "Approve (Recommended)", which named it as done unasked | SELF → approved → built; "Delivery note · SYN-IRS-0001" asserted; mutations 2/2 caught |
| RECEIPTS-W45 | The founder's real invoice: is it to the house or from it? | the PDF, read locally | where such a paper belongs | "this is an isletme faturasi"; clarified as W45b: "Both" (the house issued it, and it is a service with no goods) | recorded, not built: papers the house issues need to be recognised as such and given their own place, not the vendor queue; a running-cost invoice needs a no-goods kind, with no delivery or order to match. Measured: the reader does not detect direction, and the vendor step refuses only when the seller's tax number equals the buyer's printed one or the house's own on file (`vendor-identity/vendor-resolution.service.ts:143-170`). On a paper the house issued, the buyer is someone else, so a house with no tax number on file could be filed as its own provisional vendor. In this page's ADR |
| RECEIPTS-W45c | From W39's "create border giving Mudavym at top right": frame our sheet, three ways | W39b: `w45-frame-A/B/C.png` in sketch RECEIPTS-W45, painted onto the live sheet as a preview (injected CSS; nothing in the code changed); then `review-snap-3/sketches/RECEIPTS-W45b.html` (built result, desktop and phone; beacon 23:40:48 `n=4&w=656-672-390-390`) | A letterhead / B stamp / C band; then the built A | W39b: "frame our sheet, and create 3 different visuaks for it"; pick (W45c): "A · Letterhead"; built (W45d): "Approve (Recommended)" | approved → built → verified live headless at 1600 and 390: edge `rgb(143,134,116) 1px`, radius 4px, padding 18px 22px, mark 24px tall in seal teal, wordmark ink, full stop teal; the same values with `html.dark` forced, so the mark stays dark on the light sheet; no sideways scroll at 390; 0 console errors. `BrandMark` gained a `paper` tone that takes the paper ground's tokens instead of the theme's `dark:` classes. Tests: 5 new in `canonical-sections`; 693/693 across documents, receipts and every `BrandMark` user; mutations 9/9, no-op control passed. Also changes `/documents` and print |
| RECEIPTS-W45c-SELF | Found building W45c: on a phone the invoice number broke at its hyphen ("SYN-TR-" over "0001") | `w45-built-A-phone-before.png` / `w45-built-A-phone.png` in sketch RECEIPTS-W45b | never break the document number | covered by W45d's "Approve (Recommended)", which named it as done unasked | SELF → approved → built; asserted and mutation-caught |

**Passes**

- **P1 Purpose — partial.** Who: the owner or a manager, at a desk. The one job, in their
  words: *"is this bill right — fix what the reader got wrong, confirm it, and know what the
  vendor owes us back."* The bones are strong (scan beside lines, sealed confirm, honest
  load and error states), but against the best AP-for-restaurants tools (an invoice arrives
  already three-way matched, exceptions first, one approve) the queue cannot tell a real
  problem from noise: 7 of 8 rows in Sim Meyhouse read "does not tie out", 6 of them only
  because the tie-out ignores a tax stated in the VAT breakdown (`tax` null,
  `taxBreakdown` $43.47 — the page prints both); every document reads "not compared" and
  the page has no way to link one to an order; and the selected document renders twice
  (the embedded canonical sheet, then the edit table) with the pairing contradicting itself.

- **P2 Regions — done.** Top to bottom: the queue header ("8 awaiting review · 0 verified", fetched); the queue rows (now led by the vendor, W8-A); the verdict banner; the formatted sheet (shelf year note, W8-B); THE ORIGINAL (W8-C, W11); PROVENANCE; and the "Check and correct" card, now in five named parts (W10) with the money folded to one line (W9). Every figure checked is fetched data, with no placeholders. The Credits tab in Sim Meyhouse is the empty state only ("No credit claim has been opened…", "Being chased 0"); its filled state is left for P4. Two words items are deferred to P5: the banner's "The lines add up to the stated total" vs the card's "ties out within tolerance" (one verdict in two phrasings), and Credits saying "nothing open" twice. The right-hand counter is a shared component and was not judged.

- **P3 Controls — done.** Reads and navigation: the Receipts/Credits tabs and "← All receipts" work; a queue row click writes `?doc=` and Back returns; every request carries Sim Meyhouse's `restaurantId` (`a229f22b`); the "Where … came from" popover opens and Esc closes it and returns focus (focus does not move into it on open → P6); "Check line pairing" is disabled and says why; "Open as the canonical document →" navigates and Back returns; currency open/keep works (its focus slip fixed as W12). Writes (W13, on the founder's yes): the original opens, a line correction seals and its undo seals, swipe-to-confirm verifies, the shelf ✓ links — each with its status above. The shelf ✓ is a one-click write with no confirm (it is undone by "Not this one"); W15 fixed the year note it hid. Not pressed: Print (`window.print`, code read only); "Not this one" (W16: left linked); "Try again" on the original (no Sim document has a failed link).

- **P4 States — done, with gaps named.** Roles: as the Sim manager (`manager` gateway, sends mocked) the page loads on Sim Bistro, its only house, which holds 0 documents: the queue's empty state and the Credits empty state read cleanly; as Sim staff the Credits tab is absent and `?tab=credits` says why in words; the gateway went back to `me` after. Neither Sim role holds a house with documents, so no populated queue was seen per role. Loading: the house loader ladder (nothing under 400ms, then the mark), captured with the document list held in a headless browser (`p4-loading.png`). Error: with the detail fetch failing, the lines said "unknown, not empty" while the swipe stayed live → W18. Links: a `?doc=` this house does not hold fell through to the idle prompt → W19; `?tab=credits&credit=` was ignored → W20. Long data: the longest vendor name ellipsizes with the full name in its title (W8-A); the verified book is capped at 200 and W19's note says so; nothing longer than 8 documents exists in Sim Meyhouse, so a long queue was not seen live. Credits filled: production holds 0 credit claims (read-only count), so the filled sheet was seen only with a stubbed list in the browser (W20). Words found here go to P5.

- **P5 Words — done (W22–W29).** Read live on SYN-US-0111, SYN-TR-0001, the empty Credits tab, and both failure states (reads aborted in the headless browser, nothing written). Round 1 built 13 picks, round 2 built 4 rows plus 4 fixes, every one read back live with no non-2xx and no console error. Tests 249/249 across receipts + documents (both pages); 26 mutations on copies across the two rounds, all caught (two first-pass mutations were written wrong — one by `false && a || b` precedence, one aimed at the wrong copy of a helper — and were re-run correctly). Left open: "version 1 · file fingerprint e4f0f639…" is `/documents`' own provenance strip (`pages/documents/next/CanonicalDocumentPage.tsx:743`), not this page's to change; other pages still say "the gateway" and print raw client text — already in `p4-scratch/review-shared-queue.md` (R5's "gateway" row, R1b's raw-failure row; R3 added that /receipts is done for both); the sidebar's "Receipts & Credits" for staff who have no Credits tab is shared layout → shared queue.

- **P6 Keyboard and overlays — done (W30–W33).** Measured headless at 1600×1100 (1600×900 for scroll and motion), every non-GET to the gateway aborted. The credit Sheet (stubbed claim, production holds 0): `aria-modal`, focus to "Close", 25 Tabs stay inside, Esc returns focus to the row. The field popover failed and is fixed (W30); both field dialogs failed (W31) and are now the house `Panel` (W32): Tab held, Esc from anywhere, focus back to the field, the page's scroll locked and let go, motion `settle` and none under reduced motion, the close is the word "Cancel"; the Confirm dialog's internal key went with it (W33). All read back live. Tests 268/268 across receipts + documents (both pages), tsc and eslint clean. Found on the way, not this page's: on load `GuidanceProvider` can PATCH the user's preferences with defaults before the prefs query resolves (`contexts/GuidanceProvider.tsx:186-195`, `374-383`; arrays and scalars replace in the gateway merge) — shared, in `p4-scratch/review-shared-queue.md`. My own headless runs before P6 sent that write to the founder's production preferences unguarded; read back after (read-only): `hide_all_tips:false`, `use_cards_seen:[]`, setup nudge count 3, not dismissed; the prior values are unknown. Disclosed to the founder, who chose to warn the other review sessions (sent to all 7).

- **P7 Mobile — done (W34–W36).** Run headless, not in the pane: Playwright with phone emulation (`isMobile`, touch, DPR 2) at 375×812 and 390×844, then 700 and 1600, every non-GET to the gateway aborted except sign-in. The pane was not used because it carries no such guard (on load it would send the `GuidanceProvider` preferences write to production, see P6) and it sits on `/login` after the headless runs shared its sign-in limit. At both phone widths the list, the Credits tab, Back and a reload of `?doc=` keep their state in the URL (ADR 0160) and nothing scrolls sideways once W34 and W35 are in; the Correct dialog sits centred. Found and fixed: the open document 44px wider than the screen (W34), both line tables hiding the total (W35), and the "where it came from" box cut off — on every screen, not only phones (W36). Not seen: a real phone; the tap check above is emulated.

- **P8 Brand and accessibility — done (W37–W40, W45c).** Measured headless at 1600×1100, every non-GET to the gateway aborted (one `GuidanceProvider` preferences PATCH was caught and aborted, the P6 finding). Ground: paper (the `html` light, the page's `.mudavym` root paper). Mark: the header's at 28px and 24px, none under the 24px minimum; the sheet's letterhead mark at 24px (W45c). Type: Fraunces (6 elements), DM Sans (57), JetBrains Mono (83). Contrast: 145 text nodes against their own ground, none under 4.5 : 1; the edit boxes' edges at 1.1–1.3 : 1 failed the 3 : 1 rule for a control and are fixed (W39), the only `COLOR-CONTRAST-REPORT.md` blocker this page hit. Keyboard: 46 stops on the list with nothing open, every control showing the house's two-part focus ring; reaching the swipe took about 94 stops, now a skip link and 15 (W40). Words found on the way: W37, W38. Found, not fixed (tech-debt): when `html.dark` is set — a "Dark" picked on an older page that still offers it, since this page's menu offers only Paper and Charcoal — `globals.css`'s `.dark h1` / `.dark p` paint the sheet's seller name and the verdict headline pale on the paper sheet; the note at `styles/globals.css:238` reasons this cannot happen, but the paper ground is the case it missed.

- **P9 Console and network — done; no error, so no rows.** Read-only headless baseline (every non-GET aborted, none attempted in the valid runs), Sim Meyhouse, list → SYN-TR-0001 → 30s idle → Credits; three runs, the second invalid (it never left the house picker, so it is not counted). (1) Console: one line, the dev build's `[ErrorTracking] No DSN provided` warning — dev only, not a defect. (2) No failed and no non-2xx calls; no polling in the 30s idle. (3) Slow: on the local gateway against the production database, the list calls took 2.0–3.0s and the sheet 4.1s in the warm run (8.9–9.2s in the first run, which overlapped the dashboard's boot calls). Local timing, not production's: the Chrome check below could not time production without a second load (see P10). W44 adds one list call (`status=received`), fetched alongside the others. (4) Duplicate, seen once: the first run fetched `/canonical` twice for the same document within 30s of opening it; the warm run fetched it once (Receipts and the embedded sheet share the key `['canonical-document', id]`, `ReceiptsNext.tsx:1049`, `CanonicalDocumentPage.tsx:128`). Cause not found, not reproduced; recorded, no row.

- **P10 Live — done, by commit and one read.** Live commit `b8192c2d5` (#567, the tip of `origin/main`), from `curl -s https://mudavym.com/ | grep -o 'mudavym:commit" content="[^"]*'`. `git merge-base --is-ancestor b8192c2d5 HEAD` → no: this branch's base `1c1a676f8` is 6 commits behind, and none of those 6 touch this page's files (`git diff --name-only HEAD...origin/main` has no receipts, documents, brand or canonical path), so production's page is this branch's base minus the walk-through. Chrome (read only, `https://mudavym.com/receipts`): "0 awaiting review · 0 verified" and the caught-up sentence, on the founder's San Francisco house, not Sim Meyhouse — a different house, so no row. Not done: production was not loaded a second time to read its network and console, since the first read starts tracking only after load and a reload risks the `GuidanceProvider` defaults write (P6) on the founder's real preferences; the house was not switched (a write). The tab was closed.