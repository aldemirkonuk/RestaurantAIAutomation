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
updated: 2026-09-04
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
- Deep-linkable tab (`?tab=credits` — where `/credits` lands)
- **Mudavym redesign behind `mudavym_design_receipts` (OFF)** — the founder's four-requirement brief: the review queue + the door's paperless deliveries on one surface; **the stored scan rendered inline beside the lines** (images and PDFs; the 3600s signed link is treated as spent five minutes early and offers a refetch, and each not-shown state names which one it is — no stored file / no signable link / aged out / did not load); the linked order above the lines ("the right invoice"); qty/unit/total editable in place pre-verification with the tie-out recomputed in the same response (new gateway route `PATCH /procurement/documents/:id/lines/:lineId`), **the extracted figure kept beside a corrected cell with an undo until verify**; the swipe-up confirm ceremony firing verify
- **Honesty, per [[0063-a-certification-screen-shows-the-thing-being-certified|ADR 0063]]** — every query key carries the active restaurant id (an unresolved restaurant is refused, not given a shared `''` cache bucket); the awaiting-review count renders as a floor (`≥`) at its server window; all three list failures are named individually, and an unanswered uncounted-deliveries query says it is unknown rather than rendering as a caught-up door; a failed detail fetch says the failure in the **server's** words and never claims an empty invoice; document `extraction_confidence` and per-suggestion `confidence` are shown, `—` when unrecorded
- **The canonical document — this page's second face, behind `mudavym_design_document` (OFF)** (ADR 0104 D12 slice 2, D13). `/documents/:id` renders any incoming document as ONE canonical Mudavym document: B's verdict block first (named exceptions in words and numbers, **never a confidence as a number**), C's delivery spine (cards per document on the event, state ladder `DELIVERED → RECONCILING → AGREED → VERIFIED`, the permanent `UNORDERED` mark; collapsed at ≤ 2 documents and absent when the document sits on no delivery), A's typeset sheet as the selected frame (EN 16931 header order, the four-way `ordered · shipped · received · billed` table where `received` prints the words **"not counted"**, the printed price base as a sub-line, allowances/charges with their reason names, the VAT breakdown, totals). Money is **absent** on a delivery note; the claim block appears **only** on a credit memo. Per-field provenance is a hover (and a footnote column in print); `as printed` says "not kept" rather than inventing a literal. Read-only: no corrections, no claims, no mapping memory — slices 3–4. `?view=door` opens the same component as the door frame with **no money at all** (D11), read-only until slice 5's `receiving_advice` write. Reached from this page by "Open as the canonical document →", which appears only where the gate is on.
- **A difference must be answered before a delivery is agreed** (ADR 0103 **A11**, founder 2026-09-06). `AGREED` is refused — **409, naming the lines** — while any recorded difference (our door count against the vendor's paperwork, or the invoice against the PO) has neither an accepted proposal covering that line nor an explicit **accept-as-billed** on it. The second answer is its own door, `POST /procurement/deliveries/:id/accept-as-billed { documentId, lineNo, reason }`: a named person, a reason in their own words, idempotent, and NOT a proposal — a proposal is a position one side asks the other to accept, and this is the decision not to raise one. The gate reads the SAME comparison the "this delivery differs" notification reads, and a comparison that could not be READ refuses rather than passes.
- **Our own door count is the RECEIVED column, never the BILLED one** (v3.0-TECH-DEBT 2026-09-06, finding 3). A `receiving_advice` carries no money (D11), so its quantities land in `received` with `billed` NULL, and the verdict card says _counted N at the door_ rather than _billed —_. Fixed in the mapper so the page, the verdict sentences and the API say one thing.
- **The same count twice is answered, not leaked** (finding 4). A repeated door count returns **409** — "this count was already recorded as document `<id>`" — and takes the receiver to the document that exists, rather than a 422 carrying the index name `uq_pd_restaurant_sha256`.
- **Degraded is a state, not a blank** (ADR 0104 D6) — a document with no lines renders NOT EXTRACTED, the original, and the header fields that exist; the verdict block says "nothing was read, so nothing could be compared" rather than "nothing differs", and there is no line table and no totals, because `Lines 0.00` on an unread document is a claim nobody made
- **Pairing** — matcher suggestions carry their reason **and their confidence** for one-tap confirmation. The matcher **does** auto-write unambiguous vendor-SKU pairings server-side (`line-matcher.ts:282-296`); the page names them as written-without-asking, and every paired row has **Unlink**. The `Paired with` column names its target (ordered wine · quantity · order-line ref · method · confidence) and says "not paired" in words

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_receipts`)

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

- ReceiptsNext (flag ON) has no credits lane yet — `?tab=credits` renders the LEGACY page even with the flag on (guarded in `ReceiptsNext.tsx`), so `/credits` keeps working; a native credits lane is a later pass (§1b).

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
| Settling a claim asks the operator to type a UUID | `window.prompt("Credit-memo document id (required…)")` (`ReceiptsPage.tsx:129-137`) — the credit memo is a document this page already lists, and there is no picker |
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

1. **Send the claim.** `→ requested` should draft the vendor email through the same
   approve-then-send path procurement already uses — the guardrail is decided
   (memory: autonomous-email-replies; never auto-send). Highest-value item on the page:
   it converts a ledger into recovery.
2. **Credit-memo picker** replacing the UUID prompt (`ReceiptsPage.tsx:129-137`) —
   the documents are already listed two tabs away.
3. **Error branches** on both queries; a failed lane must not read as an empty one.
4. **Link out**: document → its order, credit → its document. The page is a dead end
   by the brief's own finding.
5. Render `POST /:id/match` suggestions (`documents.controller.ts:208`). Blocked:
   deferred by decision (`v3.0-TECH-DEBT.md:447`) — reopen or leave.
6. Recovery metrics (days-to-close, straight-through rate). Blocked on
   `v3.0-TECH-DEBT.md:446`.
