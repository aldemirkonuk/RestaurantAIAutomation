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
- **Documents** tab, two lanes: needs review / verified
- Select a document → its stored image beside the extracted lines for side-by-side verification; unknown values render as "—", never as a pass
- Verify a document
- **Credits** tab: the vendor credit-claim ledger with stats; move a claim through its states
  [2026-09-25: rebuilt on Mudavym as a lane of `ReceiptsNext` — `pages/receipts/next/ReceiptsCredits.tsx`; see §1c. The legacy `ReceiptsPage` is no longer loaded by any live route.]
- Deep-linkable tab (`?tab=credits` — where `/credits` lands). [2026-09-25: offered to the owner and managers of the house only (ADR 0167); a staff member who follows `/credits` lands on Receipts with one sentence saying why.]
- **Mudavym redesign behind `mudavym_design_receipts` (OFF)** — the founder's four-requirement brief: the review queue + the door's paperless deliveries on one surface; **the stored scan rendered inline beside the lines** (images and PDFs; the 3600s signed link is treated as spent five minutes early and offers a refetch, and each not-shown state names which one it is — no stored file / no signable link / aged out / did not load); the linked order above the lines ("the right invoice"); qty/unit/total editable in place pre-verification with the tie-out recomputed in the same response (new gateway route `PATCH /procurement/documents/:id/lines/:lineId`), **the extracted figure kept beside a corrected cell with an undo until verify**; the swipe-up confirm ceremony firing verify
- **Honesty, per [[0063-a-certification-screen-shows-the-thing-being-certified|ADR 0063]]** — every query key carries the active restaurant id (an unresolved restaurant is refused, not given a shared `''` cache bucket); the awaiting-review count renders as a floor (`≥`) at its server window; all three list failures are named individually, and an unanswered uncounted-deliveries query says it is unknown rather than rendering as a caught-up door; a failed detail fetch says the failure in the **server's** words and never claims an empty invoice; document `extraction_confidence` and per-suggestion `confidence` are shown, `—` when unrecorded
- **The canonical document — this page's second face, behind `mudavym_design_document` (OFF)** (ADR 0104 D12 slice 2, D13). `/documents/:id` renders any incoming document as ONE canonical Mudavym document: B's verdict block first (named exceptions in words and numbers, **never a confidence as a number**), C's delivery spine (cards per document on the event, state ladder `DELIVERED → RECONCILING → AGREED → VERIFIED`, the permanent `UNORDERED` mark; collapsed at ≤ 2 documents and absent when the document sits on no delivery), A's typeset sheet as the selected frame (EN 16931 header order, the four-way `ordered · shipped · received · billed` table where `received` prints the words **"not counted"**, the printed price base as a sub-line, allowances/charges with their reason names, the VAT breakdown, totals). Money is **absent** on a delivery note; the claim block appears **only** on a credit memo. Per-field provenance is a hover (and a footnote column in print); `as printed` says "not kept" rather than inventing a literal. Read-only: no corrections, no claims, no mapping memory — slices 3–4. `?view=door` opens the same component as the door frame with **no money at all** (D11), read-only until slice 5's `receiving_advice` write. Reached from this page by "Open as the canonical document →", which appears only where the gate is on.
- **A difference must be answered before a delivery is agreed** (ADR 0103 **A11**, founder 2026-09-06). `AGREED` is refused — **409, naming the lines** — while any recorded difference (our door count against the vendor's paperwork, or the invoice against the PO) has neither an accepted proposal covering that line nor an explicit **accept-as-billed** on it. The second answer is its own door, `POST /procurement/deliveries/:id/accept-as-billed { documentId, lineNo, reason }`: a named person, a reason in their own words, idempotent, and NOT a proposal — a proposal is a position one side asks the other to accept, and this is the decision not to raise one. The gate reads the SAME comparison the "this delivery differs" notification reads, and a comparison that could not be READ refuses rather than passes.
- **Our own door count is the RECEIVED column, never the BILLED one** (v3.0-TECH-DEBT 2026-09-06, finding 3). A `receiving_advice` carries no money (D11), so its quantities land in `received` with `billed` NULL, and the verdict card says _counted N at the door_ rather than _billed —_. Fixed in the mapper so the page, the verdict sentences and the API say one thing.
- **The same count twice is answered, not leaked** (finding 4). A repeated door count returns **409** — "this count was already recorded as document `<id>`" — and takes the receiver to the document that exists, rather than a 422 carrying the index name `uq_pd_restaurant_sha256`.
- **Degraded is a state, not a blank** (ADR 0104 D6) — a document with no lines renders NOT EXTRACTED, the original, and the header fields that exist; the verdict block says "nothing was read, so nothing could be compared" rather than "nothing differs", and there is no line table and no totals, because `Lines 0.00` on an unread document is a claim nobody made
- **An invoice's money names its own currency, and the house may restate it** (founder 2026-09-06, batch 63). Every figure on this page printed a hardcoded `$` until now, including on the two `TRY` invoices production already holds. Three rules, built in `apps/api-gateway/src/procurement/documents/invoice-currency.ts`: **(1)** an 810 with no `CUR` segment is filed under the HOUSE'S OWN `restaurants.currency` — never `USD` — and a house that has stated none, on a file that states none, has its **money refused** in a sentence naming both absences (the quantities stay; the header charges, the total, every line price and the tie-out all go to null). **(2)** the extraction states the currency it SEES with the location it saw it (`currencySeen`), and a sighting that disagrees with the currency the invoice would be filed under **HOLDS** the money under both until a person decides — the model flags, it never decides. **(3)** a manager or owner restates it here: a picker of ISO 4217 codes, an optional reason, an append-only audit row (`procurement_document_currency_changes`) written BEFORE the change lands, and the money re-filed off the stored reading with the server's own sentence saying what moved. **Nothing is converted** — there is no exchange rate in this system. **Staff see the control disabled with the sentence**, never hidden
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
  to the control that clears it rather than to the queue
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
- **Pairing** — matcher suggestions carry their reason **and their confidence** for one-tap confirmation. The matcher **does** auto-write unambiguous vendor-SKU pairings server-side (`line-matcher.ts:282-296`); the page names them as written-without-asking, and every paired row has **Unlink**. The `Paired with` column names its target (ordered wine · quantity · order-line ref · method · confidence) and says "not paired" in words

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
- **"Requested" says nothing was sent.** The move is labelled *I asked the vendor*, and
  its confirmation says "Mudavym sends nothing to the vendor" — because the gateway's
  `requested` branch stamps `requested_at`/`requested_by` and nothing else (§10).
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
> than one), the bell, the theme menu and the account menu. Chrome is excluded
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

- **Canonical view, first render against extracted documents (2026-09-04, `v3.0-TECH-DEBT.md` "nine findings"):** the verdict block says "4 lines differ from the delivery" when nothing exists to compare; the seller is blank though the extraction named it; delivered date and VAT breakdown are not in the extraction contract; the totals ladder shows "Charges —" under listed charges; deposits carry no UNCL7161 code; the original pane has nothing to bring (`imageUrl` null on 3 of 3).

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
   [2026-09-25: the credits lane names each failed source (§1c); the receipts lane already did.]
4. **Link out**: document → its order, credit → its document. The page is a dead end
   by the brief's own finding.
5. Render `POST /:id/match` suggestions (`documents.controller.ts:208`). Blocked:
   deferred by decision (`v3.0-TECH-DEBT.md:447`) — reopen or leave.
6. Recovery metrics (days-to-close, straight-through rate). Blocked on
   `v3.0-TECH-DEBT.md:446`.
