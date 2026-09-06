# 0103 — A delivery is agreed before it is verified

- **Status:** Locked on the forks the founder answered in session (2026-09-02/03: door documents, the meaning of _agreed_, the payment clocks, the no-order path, the human gate); D9 (the never-looked-at case) **locked 2026-09-03** — the founder asked for "the SOTA and the most safe, robust, scalable" answer and delegated the choice; the choice and its reasons are in D9; **one clock basis is OPEN** (A8 below: whether a delivery at the restaurant's premises has a 7-day e-İrsaliye window at all is a question for a Turkish YMM, not for this research). Design only — nothing here is built.
- **Date:** 2026-09-03
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** invoice, delivery, irsaliye, e-İrsaliye, irsaliyeli fatura, e-Fatura, receiving, reconciliation, agreed invoice, three-way match, credit memo, short ship, substitution, vintage, unordered, no-PO, AB 2991, BPC 25509, VUK 231, TTK 21, human gate, notifications, vendor terms
- **Links:** [[0104-every-incoming-document-renders-as-one-canonical-mudavym-document]] (the template this flow renders into), [[0067-a-failed-read-is-never-an-empty-one]], [[0078-a-count-is-a-record]], [[0070-ledger-quantity-decision]], `08-softwares/receiving.md`, `08-softwares/receipts-invoice-match.md`, `06-pages/receiving.md`, `06-pages/receiving-door.md`, `06-pages/receipts.md`, `07-reference/INVOICE_DOC_UX_RESEARCH.md` (the earlier extraction research this builds on)

## Context

The founder described the process a Turkish venue actually runs at the door: the order is
placed; the vendor confirms; the goods arrive with a document both sides may still correct;
the two sides agree; one final invoice is issued for what was agreed; the restaurant marks
it verified and arrived. Then: _"the agreed invoice is the product"_ — the differentiator
is that Mudavym holds the one document both sides accepted, and every incoming paper renders
into it (ADR 0104). The founder asked how the US does this, wanted a notification that asks
_"is this the same as what you ordered?"_, and named the irsaliye process as the crucial
thing to bulletproof.

**The research (scratchpad reports, 125 sources, read 2026-09-03; distilled here).** The
Turkish model is not a quirk — it is codified. `e-İrsaliye Yanıtı` is a first-class
document: accept / partially accept / reject within **7 days** of the actual dispatch date,
and **silence accepts in full**. Partial acceptance is informational — goods only go back
on a new `iade irsaliyesi` — and _the invoice is then issued only for the accepted
quantity_ (VUK 231/5: within 7 days of delivery). An invoice can be objected to within
**8 days** (TTK 21/2), after which it is deemed accepted. Where the electronic response
cannot be used, a printed e-İrsaliye with wet signature and stamp is the evidentiary basis.
The US has the same five states expressed differently: the correctable document is the
**signed delivery invoice at the door**, the agreement step is compressed into the delivery
window, and post-hoc correction is a **credit memo**. For alcohol in California the door is
legally the last cheap moment to disagree: breakage and shortage must be noted on the
invoice at delivery; payment is due within 30 days of delivery (27 CFR 6.65; BPC § 25509,
operative 2026-01-01) and since 2026-01-01 is a **wholesaler-initiated EFT** (AB 2991) —
the money leaves on schedule whether or not the dispute is settled.

**What is on `main` today.** `ProcurementOrderStatus` has twelve literals
(`apps/api-gateway/src/procurement/dto/procurement.dto.ts:18-32`) — no _acknowledged_, no
_reconciling_, no _agreed_; `IN_TRANSIT` is declared and never written;
`procurement_orders.status` carries no CHECK (baseline migration `:4514`).
`procurement_documents` does have CHECKs — `doc_type` ∈ purchase_order · packing_slip ·
delivery_receipt · invoice · credit_memo · statement · unknown; `status` ∈ received ·
extracting · needs_review · verified · rejected · superseded (baseline `:4464-4466`) — so
the _document_ already has a lifecycle while the _delivery_ has none. `verifyReceipt`
(`procurement.controller.ts:360`) requires an order, so an unordered delivery has no door.
`syncOrderState` (`common/orchestrator/inbound-responder.service.ts:1088`) is the only
vendor-acknowledgement path and moves APPROVED → CONFIRMED when a reply reads as
confirming; a reply that contradicts the order is dropped rather than recorded.
`POST /providers/:id/retroactive-order` (`providers.controller.ts:658`) mints a purchase
order after the fact and books no stock. `ReceivingWorkspace.tsx:2` is already labelled
_"the canonical Mudavym invoice"_ but is reachable only through `/inventory?verify=`. Two
notifications exist for this whole flow, both `invoice_received`.

## Options considered

1. **Keep today's order-centric states and add notifications.** Cheapest. Costs: the
   document and the delivery still have no shared state, _agreed_ cannot be expressed, the
   Turkish 7-day window has no owner, and "verified" keeps meaning "someone pressed a
   button on an invoice" rather than "the restaurant asserted what it received".
2. **Invoice-centric three-way match, US style** (the MarginEdge / xtraCHEF / Ottimate
   shape): the invoice is the source document; a PO is optional; discrepancies become
   credit requests. Costs: it has no bilateral state — every tool surveyed lacks one — so
   the Turkish response and the US door signature both collapse into "flag it"; and it
   handles no-PO by processing the invoice anyway, which is retroactive-PO by another name.
3. **A bilateral delivery state model** with a `RECONCILING` state that both sides can
   write to, `AGREED` separate from `VERIFIED`, clocks as data per jurisdiction, and an
   explicit `UNORDERED` provenance. Costs: a delivery entity and a proposals table, a terms
   table, one more human gate, and the retirement of the retroactive-order door.
4. **Retroactive purchase order for unordered deliveries** (keep `retroactive-order`).
   Rejected by the founder in session: it manufactures the evidence the match exists to
   test.

## Decision

**A delivery is its own thing, with its own states; it is agreed by both sides before it
is verified by the restaurant; and the invoice Mudavym holds is the one that matches what
was agreed.** Option 3, with the founder's answers folded in:

- **D1 — States** (on the delivery, not the order):
  `ORDERED → ACKNOWLEDGED → IN_TRANSIT → DELIVERED → RECONCILING ⇄ (proposal / counter)
→ AGREED → VERIFIED → INVOICE_FILED → PAID`, with `CANCELLED` and `REJECTED` as exits.
  `ACKNOWLEDGED` and `IN_TRANSIT` may be skipped; `RECONCILING` may loop; `AGREED` and
  `VERIFIED` are never collapsed — agreement is about the document, verification is about
  the goods and the books. Inventory moves and COGS posts at `VERIFIED`, and only there.
- **D2 — The door document is whichever one arrives**, and all three are first-class:
  `e-İrsaliye` (structured, correctable for 7 days), `irsaliyeli fatura` (a real invoice —
  the correction window is already closed when the goods land, so the flow is
  accept-then-`iade faturası`, and the product says so on the screen), or **paper of
  either, photographed at the door** (the photo is the document; extraction may fail and
  the record stays honest about it — ADR 0104 D6). The founder's answer: _"either
  e-İrsaliye or irsaliyeli fatura, or paper of both."_
- **D3 — _Agreed_ means both sides recorded, never implied.** The founder chose the most
  flexible model: `AGREED` is reached when the restaurant's position and the vendor's
  position are both on the record — a vendor response document, an e-İrsaliye Yanıtı, an
  EDI 855/865, a reply email parsed with its contradictions _kept_, or a door signature
  where a **per-vendor setting says the signed delivery ticket is final** (the US alcohol
  norm). Vendor silence is recorded as _no response_ against the clock; it never becomes
  agreement in our data even where the law deems it so — the clock chip says "silence
  accepts in full on day 7", the state does not lie about who said what.
- **D4 — Clocks are data.** A `vendor_terms` table keyed (jurisdiction, beverage class,
  document type, vendor override) holds: door-correction rule, post-delivery response
  window (TR 7 d), invoice issuance window (TR ≤ 7 d), objection window (TR 8 d), payment
  clock and initiator (CA alcohol: 30 d from delivery, wholesaler-initiated EFT, 1 % at
  day 43; COD; net terms). Every clock has an explicit `unknown` value that **blocks and
  asks** — a jurisdiction with no rule row never renders as "no deadline". The founder's
  answer: _"make all scenarios possible."_
- **D5 — No order preceded this → `UNORDERED`.** The receipt carries a permanent
  provenance mark; goods are accepted and inventory moves at `VERIFIED` like any other
  delivery; reporting can answer _what share of spend was never ordered_. The
  `retroactive-order` endpoint is retired. In Turkey the e-İrsaliye is itself a structured
  statement of what the vendor claims to be delivering, so `UNORDERED` there is far less
  blind than in the US.
- **D6 — Human gates, never automated:** `AGREED → VERIFIED`; accepting a substitution
  (a different product, and a **vintage change is a substitution**, not a tolerance); any
  price change above the vendor's threshold; sending a `red` (rejection) in Turkey — it is
  a sealed legal document; accepting an `UNORDERED` delivery; anything that would short-pay
  a California alcohol invoice. Safe to automate: ingest, PO↔document line matching,
  duplicate detection, price-delta and deadline computation, CRV/deposit classification,
  notification dispatch.
- **D7 — Reason classes** on every proposal: `SHORT_SHIP`, `OVER_SHIP`, `SUBSTITUTION`,
  `VINTAGE_CHANGE`, `PRICE_VARIANCE`, `DAMAGED`, `WRONG_VENUE` (never enters
  `RECONCILING` — it is a rejection), `DUPLICATE_DOCUMENT`, `FREE_GOODS` (kept out of COGS
  and price history, tagged as a compliance record), `DEPOSIT_OR_FEE`. Each proposal
  records side, reason, quantities, money at risk, evidence (photo, signature, note), who,
  when.
- **D8 — Notifications the flow owes the restaurant:** vendor acknowledged with changes
  (the only warning before the truck); arriving today; **"this delivery differs from your
  order on N lines"** at the door — the founder's ask, at the only moment it is cheap;
  price crossed threshold; TR day 5 of 7 — response due, silence accepts; TR day 6 of 8 —
  objection window closing; US alcohol day ~20 of 30 — EFT debits in 10 days with a line
  still disputed; credit memo received — matches / does not match the claim (orphan credit
  memos are a known, expensive failure); unexpected delivery — no matching order.
- **D9 — The never-looked-at case (Proposed; the founder's "option 1, but these times
  could happen — how do we do it?").** A document is never auto-posted; instead it **ages
  against its own clock and escalates**: every open delivery has an owner and a deadline
  derived from D4; at 50 % of the shortest clock it re-notifies the owner; at 80 % it
  escalates to the venue owner and, for TR e-İrsaliye, drafts the response for one-tap
  approval; when the clock expires with no human action the delivery moves to a terminal
  **`LAPSED`** state that records _what the law now deems_ (TR: accepted in full; US: paid
  by EFT) without pretending the restaurant agreed — inventory still does not move until a
  human verifies, and the lapse is a first-class, countable fact in reporting. The queue
  never falls back into an unowned backlog. (Research basis: AP exception-management
  practice gives every exception a category, an owner and a clock, and escalates rather
  than auto-resolves.) The blank-page and unreadable-upload half of the founder's question
  is an intake gate and lives in ADR 0104 D6.

What carried it: the only design under which "verified" means what a regulator and a
restaurateur both think it means; the only one that gives the Turkish 7-day window an owner
and the California 30-day EFT a countdown; and the only one that does not report the
absence of an order as the presence of one.

## Consequences

- **Easier:** the Receiving workspace becomes the door of a real state machine instead of a
  label; the founder's notification exists at the right moment; TR and US venues share one
  model with different rows in `vendor_terms`; the accountant export is a query over
  `INVOICE_FILED` documents rather than a guess.
- **Schema (to build under 0104 slice 1):** a `deliveries` (commercial event) table that
  the PO, the door document, the door count, the invoice and the credit memo all attach to;
  `delivery_proposals` (side, reason class, evidence, who, when); `vendor_terms`;
  `deliveries.provenance ∈ {ORDERED, UNORDERED}`; a CHECK on the new state column from day
  one. `procurement_orders.status` keeps its twelve literals for the order; the delivery's
  states are not added to the order (`check_order_status_literals.py` stays green and is
  extended to the new column).
- **Retired:** `POST /providers/:id/retroactive-order` and the "accept then fix later"
  posture; `verifyReceipt`'s order requirement (an `UNORDERED` delivery must have a door).
- **Harder / given up:** two more human taps on every delivery with a discrepancy; a
  vendor-response channel in the US outside EDI is an email — D3 keeps that honest by
  recording _no response_ rather than inferring one.
- **Revisit when:** a jurisdiction's clock cannot be expressed as a row (a rule that
  depends on the goods' value or the vendor's licence class in a way D4 cannot key), or
  when the first month of `LAPSED` counts shows the escalation ladder is not being read.

## Amendments after the premortem, scale and adversary passes (2026-09-03), and after the vendor lens (A11–A12, 2026-09-06)

Three Sonnet passes were run against this ADR and 0104 before any build, as the founder
asked for the irsaliye process (annexes: `annex-0103-0104-premortem.md`,
`annex-0103-0104-scale.md`, `annex-0103-0104-adversary.md`). Each finding below names
what it changes; none reopens a founder-locked answer.

- **A1 — Stock at the door, cost at verification (reconciles D1 with the shipped door
  design).** `recordDoorReceipt` (`procurement/receiving.service.ts`) deliberately books
  live stock at the door so staff can pour it — an ADR 0011-class decision, not an
  oversight — and D1 as written ("inventory moves at `VERIFIED`, and only there")
  contradicted it. Resolved: **on-hand moves at `DELIVERED` from the door count, with the
  ledger rows marked `cost_state = provisional`; COGS, vendor spend and price history post
  at `VERIFIED`.** A delivery stuck in `RECONCILING` is pourable and absent from cost
  reports — that is the test that must exist before build.
- **A2 — Cardinality is many-to-many, and the join is named.** N deliveries per PO (split
  shipments), N documents per delivery, and **N deliveries per document** — produce, dairy
  and imported-goods distributors send consolidated weekly invoices, and one truck can
  carry goods invoiced by two legal entities (adversary §1, sourced). So `deliveries` ↔
  `documents` is a `document_deliveries` join, never a document FK to one delivery.
  Clocks attach to the thing they are about: door correction to the delivery;
  the e-İrsaliye response and the invoice objection to the **document**; payment to the
  invoice; a consolidated invoice's issue date is its own basis. Stock idempotency is keyed
  to the delivery id — today's `order-delivered:${orderId}` key
  (`procurement.service.ts:1608`) silently drops the second truck of a split shipment, a
  live bug shape filed in `v3.0-TECH-DEBT.md`.
- **A3 — Payment is a fact on the invoice, not a state on the pipeline.** Under AB 2991
  the wholesaler debits on day 30 whether or not the dispute is settled, so `PAID` cannot
  sit at the end of a linear chain that requires `VERIFIED`. Resolved: `paid_at` and
  `paid_by ∈ {eft_wholesaler_initiated, restaurant, credit_applied, …}` live on the
  invoice document and can occur in any delivery state; **"paid while disputed"** is a
  named condition with its own notification (D8 gains it), distinct from "paid because
  agreed". `INVOICE_FILED → PAID` in D1 is read as "the invoice is filed; its payment fact
  is recorded", not as a gate.
- **A4 — `LAPSED` is terminal for the deeming, not for documents.** A vendor's late credit
  memo or corrected invoice attaches to a lapsed delivery as a new document and moves it to
  **`LAPSED_AMENDED`**, with the amendment audited (who, when, which document); the record
  of what the law deemed on the lapse date is never overwritten.
- **A5 — Two more retirements, named.** `syncOrderState`
  (`common/orchestrator/inbound-responder.service.ts:1088`) drops a contradicting vendor
  reply into free-text negotiation metadata — the exact mechanism `delivery_proposals`
  replaces; every contradiction becomes a proposal row with a reason class, and the
  silent-drop branch is retired. `markDelivered` (`procurement.service.ts:1521`) and
  `recordDoorReceipt` carry different booking and idempotency semantics; both consolidate
  into the delivery model. The retire list is therefore: `retroactive-order`, the
  contradiction drop, and the two divergent receiving paths.
- **A6 — Zero door evidence is stated, never assumed.** When nobody counts at the door — the
  modal case in every tool surveyed (adversary §2) — the delivery's `received` column is
  **`not counted`**, never silently equal to shipped or billed; `RECONCILING → AGREED`
  still needs both sides on the record, and `VERIFIED` still needs a person to assert
  receipt, with the screen saying "no door count". This is what keeps the flow from
  degrading into the invoice-centric three-way match this ADR rejected. Because the
  differentiator is load-bearing on the door, the door view moves to slice 2 in ADR 0104
  D12.
- **A7 — The differentiator, restated against the Turkish market.** Paraşüt, Logo/eLogo,
  Uyumsoft and ERC Soft already ship kabul / kısmi kabul / red on an incoming e-İrsaliye
  as a mobile button (adversary §3, URLs in the annex); the earlier research scanned nine
  US tools and no Turkish one. What none of them does is tie that response to inventory,
  COGS, vintage/substitution and a US-side equivalent on one screen. The claim this ADR
  makes is the narrower one: **one receiving record across TR and US that drives the
  books**, not "we invented bilateral agreement".
- **A8 — Clock basis is a field, and one Turkish row is OPEN.** Every `vendor_terms` clock
  carries `basis ∈ {dispatch_date, delivery_date, document_issue_date, unknown}`. The
  research it rests on flags that a delivery _at the restaurant's premises_ may require
  the invoice at delivery, with no 7-day window at all — the modal restaurant case — and
  calls it a question for a Turkish YMM. Those rows are seeded `unknown` (which blocks,
  D4) until a YMM answers; the founder chose (2026-09-03) to keep them `unknown` and put the question to their
  accountant. The question, verbatim, for a YMM: _"Bir tedarikçi malı doğrudan işletmemizin
  adresine teslim ettiğinde (işyerinde teslim), e-İrsaliye'ye 7 gün içinde kabul / kısmi
  kabul / red yanıtı verme hakkımız var mı, yoksa VUK 231/5 gereği fatura teslim anında
  düzenlenmek zorunda olduğu için bu yanıt penceresi fiilen ortadan kalkıyor mu? Yanıt
  penceresi varsa süre fiili sevk tarihinden mi, teslim tarihinden mi başlar? İrsaliyeli
  fatura ile teslimde hangi itiraz süresi geçerlidir (TTK 21/2, 8 gün)?"_ The rows are
  seeded from the answer, with its date and the YMM named in `vendor_terms.source`.
- **A9 — Vintage is structured (D6 needs a machine signal).** Vintage, and lot/batch where
  applicable, are RESOLVED-layer fields (ADR 0104 D1); a vintage-only difference raises
  `SUBSTITUTION`, never a silent match — a test, not a hope.
- **D9 as locked (2026-09-03).** The founder delegated D9 with one instruction — the safest,
  most robust, most scalable answer — and this is it, with the reasons: (1) **the ladder is
  proportional with a floor** — re-notify the owner at 50 % of the shortest clock and escalate
  at 80 %, but never later than **48 hours before expiry** (for the Turkish 7-day response
  that is day 3½ and day 5, floor day 5; for an 8-day objection, day 4 and day 6); a short
  clock must not compress the human's reaction time to hours. (2) **Every delivery has an
  owner and a deputy** — escalation goes to the deputy when the owner has not acted by the
  80 % mark and to the venue owner at the floor, so a closed venue (the August case in the
  premortem) does not lapse silently. (3) **Timers are durable rows** (`due_at`, idempotent
  poller, catch-up after a missed tick — A10), never in-process. (4) **`LAPSED` records the
  legal deeming and nothing else**; inventory never moves on a lapse; a late vendor document
  moves the delivery to `LAPSED_AMENDED` with the amendment audited (A4). (5) **The one-tap
  draft** for the Turkish response is prepared at the 80 % mark with the door evidence
  attached, so acting takes one decision, not a form. (6) **Lapses are a first-class count**
  on the owner's surfaces — a lapse is a measurable failure of the venue's process, and the
  product must say so rather than absorb it. Rejected: auto-posting at expiry (the founder's
  "never"), and a flat calendar reminder with no owner (the unowned backlog every AP survey
  names as the failure mode).
- **A10 — The escalation ladder is durable.** D9's timers are `due_at` rows worked by an
  idempotent poller that catches up after a missed tick (a deploy, a crash); never
  in-process timers — the scale pass named this as the place the absence-as-health fault
  would return.
- **A11 — A DIFFERENCE MUST BE ANSWERED (founder, 2026-09-06; amends D3).** Recorded
  verbatim: _"Difference must be answered — AGREED is refused while any recorded difference
  (door count vs paperwork, or invoice vs PO) has no accepted proposal or an explicit
  'accept as billed' from the restaurant. Rule A stays for deliveries with no difference."_
  **Why it was needed:** the vendor lens ran the whole flow on the sim tenant and found that
  a delivery whose door count said 10 against an invoice of 12 — a difference the gateway had
  *already notified about* — reached `AGREED` in ONE call under rule A with no proposal ever
  filed (`v3.0-TECH-DEBT.md`, 2026-09-06 finding 1). Rule A tested that *a* position existed
  on each side; that the two contradicted each other was not part of the test, so the one case
  this ADR exists for was the case that could walk through its gate.
  **What it changes in code:** the gate runs BEFORE either D3 rule is considered. A recorded
  difference is answered by an **accepted proposal covering that line**, or by an **explicit
  accept-as-billed** on it — a new door, `POST /procurement/deliveries/:id/accept-as-billed`
  with `{ documentId, lineNo, reason }`, writing `delivery_line_acceptances` (migration
  `20260906163412`). A refusal is a 409 that NAMES the unanswered lines; a success still names
  which rule fired. Rule A is untouched where the comparison ran and nothing differed.
  **Four things this pass settled deliberately, each with its rejected alternative:**
  1. **One comparison, not two.** The gate and the `delivery_differs` notification both call
     `scanDifferences`. A second copy in the gate is the failure this amendment would otherwise
     have created — the notification saying a line differs while the gate, reading its own
     copy, agreed the delivery: one system telling a person two things.
  2. **A scan that could not be READ refuses the gate.** Three answers, never two:
     `compared`, `not_comparable` (nothing to compare — rule A stands untouched) and
     `unreadable` (a failed read — 500, and nothing moves). Collapsing the third into the
     second would let a statement timeout open the gate. _Rejected: treat a failed comparison
     as no difference_ — that is [[absence-reported-as-health]] with a new face.
  3. **The gate binds rule B as well as rule A.** The founder's sentence names AGREED, not one
     of its routes, and a signed ticket that contradicts the count is exactly the moment
     somebody must say, in one tap, that the difference is accepted anyway. _Rejected: gate
     rule A only_ — it leaves the gate escapable through a per-vendor setting, which is a
     configuration that silently un-decides a decision.
  4. **The acceptance is its own row, not a proposal.** A proposal is a POSITION one side asks
     the other to accept; "we counted 10, they billed 12, and we are not disputing it" is the
     decision NOT to raise one. _Rejected: record it as an accepted `SHORT_SHIP` from the
     restaurant_ — it would put a claim on the record the restaurant deliberately did not make.
     Keyed `(delivery, document, line_no)`, never "the delivery's line n": A2 puts N documents
     on a delivery, so line 3 of the invoice and line 3 of the count are different lines. The
     unique index IS the idempotency; a second acceptance returns the first unchanged.
  **In scope by choice:** a line that pairs with NOTHING on the other document counts as
  unanswered too, named separately in the refusal. The notification rightly calls it "a
  question, not a difference", but a billed line that pairs with nothing counted is the most
  expensive question at the door and is answerable by the same two doors.
  **Rejected outright, and recorded because they were real options:** _"warn, do not block"_
  (a flag plus a notification — the flag already existed and was already ignored: finding 1 is
  a delivery agreed one call after the notification fired), and _"leave rule A as is"_ (an
  accepted risk — the founder declined to accept it).
  **Named, not fixed here:** a difference that only appears when a document is attached AFTER
  the delivery is agreed. `linkDocument` re-runs the scan and re-notifies, and A4's
  `LAPSED_AMENDED` path is untouched, but nothing re-opens an `AGREED` delivery. That is the
  amend-after-agreement stop, and it is named rather than half-built.

- **A12 — A LINE BOOKS STOCK ONLY WHEN IT NAMES A SHELF; THE OLDER WRITERS ARE DEMOTED, NOT YET RETIRED (founder, 2026-09-06; amends A1/A5).** Recorded after the A5 build (PR #333) reported two gaps this ADR did not decide; the founder let both stand as built and asked for them to be written down with what was rejected.
  1. **A document line carries no item identity, so the door books stock into a lot only when the caller supplies an `inventory_id` for that line** (`procurement_document_lines.inventory_id`, written by the door). A line that names no shelf is reported as **not booked, with the reason in words** — never matched to an item by its description or SKU. _Rejected: SKU/description matching with a confidence and a review queue before booking_ — a guessed shelf is a fabricated stock row, and a guess wearing a confidence is the same row wearing a number (ADR 0104: never a number). Slice 4's mapping memory is where a remembered pairing may later fill the id, still through a person's tick.
  2. **`recordDoorReceipt` and `markDelivered` are made non-second-writers instead of deleted**: they refuse when a delivery has already booked the order (`deliveryHasBookedOrder`, where a failed read refuses rather than reading as "no"). The web offline outbox, the orders screen and mobile still call them. _Rejected: hard retirement in the same PR_ — a client change across three surfaces disguised as a service change. **Follow-up owed:** retire both once the three clients call the one booking path (v3.0-TECH-DEBT, 2026-09-06).
  **What it changes in code (PR #333).** One booking path keyed `delivery-line:{delivery}:{document}:{line}`; `cost_state` written `provisional` at the door and `final` only at VERIFIED with an `invoice`/`manual` price behind it; the column default `'final'` is gone; measured read-only before the backfill: 165 lots all `final`, 162 with no `unit_cost` at all → those 162 became `provisional`, the three hand-priced lots stayed `final`.

## Review trail

| Date       | Reviewer                                                                                           | Outcome                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-03 | Fable (lens session), from the founder's in-session answers and two research reports               | Created; D1–D8 locked by the founder's answers, D9 proposed for the founder                                                |
| 2026-09-03 | Fable, from three Sonnet passes (premortem, scale, adversary; annexed)                             | A1–A10 recorded; A8 leaves one Turkish clock basis open for a YMM                                                          |
| 2026-09-03 | Founder (in session) delegating D9 to "the SOTA, safest, most robust, most scalable" answer; Fable | D9 locked with the ladder-with-floor, owner + deputy, durable timers, LAPSED/LAPSED_AMENDED, one-tap draft, lapses counted |
| 2026-09-05 | Fable — slice 3 stop 2: the delivery's doors and its two gates | **Built.** `POST /procurement/deliveries` (provenance decided ONCE and permanent — D5), `…/:id/documents` (the many-to-many join, and a document attached to a LAPSED delivery moves it to LAPSED_AMENDED without touching what the law deemed — A4), `…/:id/proposals` + `…/proposals/:pid/counter` + `…/accept` (D7; **WRONG_VENUE rejects rather than reconciles**, and every contradiction is a row with a reason class — the silent drop of A5 is replaced), `…/:id/agree` (**D3, and the row records WHICH of the two rules fired**: `both_sides_recorded` or `signed_ticket_is_final`; a refusal names what is missing, and vendor silence never becomes agreement), `…/:id/verify` (D6 — a named human, only from AGREED, idempotent), `POST /procurement/documents/door-count` (the door count as OUR `receiving_advice`, ADR 0104 S6/D11: `direction issued_by_us`, `extraction_confidence` NULL not 0, no money, and **a line nobody counted is ABSENT rather than a zero** — A6), and `delivery_timers` + an idempotent poller (D9/A10) whose ladder is 50 %, then 80 % floored at 48 h — and at 10 days for the payment clock, which is where D8's "US alcohol day ~20 of 30" comes from; the Turkish 7-day window lands on day 3½ and day 5 exactly as D9 and D8 both say. **A clock that cannot be computed is a `blocked_unknown` ROW that asks and never fires** (D4/A8: no rule, no number, an `unknown` basis, or a basis date not on the record — one answer for all four), so the unseeded Turkish rows produce a visible question rather than an invented deadline. 60 gateway tests, 15 web tests, 7 SQL assertions (T20–T26) proven failing-first on a 100-migration control. **NO STOCK OR COST IS WRITTEN, and that is measured:** `cost_state` and `inventory_transactions.delivery_id` still have zero writers on this tree, so `verify` is deliberately not the first one — A5's consolidation is the next stop, named in `v3.0-TECH-DEBT.md` rather than half-done. |
| 2026-09-06 | Founder (in session), recorded verbatim; built by Fable | **A11 locked and built.** "Difference must be answered": `agree()` refuses (409, naming the lines) while any recorded difference — door count against paperwork, or invoice against PO — has neither an accepted proposal covering the line nor an explicit `accept-as-billed` on it, and the gate runs **before either D3 rule** so a per-vendor `signed_ticket_is_final` cannot walk past it. The gate and the `delivery_differs` notification read **one** comparison (`scanDifferences`), whose three answers keep `unreadable` from wearing `not_comparable`'s clothes. New door `POST …/deliveries/:id/accept-as-billed { documentId, lineNo, reason }` + migration `20260906163412` (`delivery_line_acceptances`; the unique index IS the idempotency), proven on a 105-migration control and a 106-migration build (6 SQL assertions, all false or erroring on the control). 12 new gateway tests; the 3 gate tests proven failing-first against a sabotaged gate. Rejected and recorded: "warn, do not block", "leave rule A as is", gating rule A only, and filing the acceptance as an accepted `SHORT_SHIP`. Closed alongside: finding 3 (our own door count now lands in **Received**, `billed` NULL — fixed in the mapper so page, verdict sentences and API agree) and finding 4 (a repeated door count answers **409** naming the existing document, never `uq_pd_restaurant_sha256`). Finding 2 (`cost_state` defaulting to `final` with no writer) stays OPEN: it belongs to A5's stock/cost booking stop. |

| 2026-09-06 | Fable — slice 3 stop 3: the vendor lens, run on the sim tenant | **Measured, and D3 rule A did not survive it.** One short-ship event through the doors only (Sim Meyhouse, gateway from `origin/main` `417474e6`): door count 10 of 12 with a labelled synthetic photograph, invoice `b1e02edf` + delivery note `dac9a3e8` linked, the `delivery_differs` notification observed, `SHORT_SHIP` proposed, countered with a ₺142,00 credit, accepted, AGREED under `both_sides_recorded`, VERIFIED by a named person. The gates refuse the wrong way with reasons: one side only **409** ("the vendor's position is not on the record … Silence is not agreement here"), an open proposal **409**, verify before AGREED **409**, a proposal on a VERIFIED delivery **409**, a second verify **201** returning the first stamp. A1/A5 hold **by query, not by assertion** — 0 `inventory_transactions` for these deliveries, 0 lots touched. **The finding: a delivery that differs from the vendor's paperwork on a line the gateway itself flagged reached AGREED in ONE call under rule A, with no proposal filed** — rule A tests that both positions exist, never that a recorded difference was answered. Filed as `v3.0-TECH-DEBT.md` (2026-09-06, finding 1); amending the D3 predicate is a decision for the founder, not a stop-3 patch. Second finding against A1: `inventory_lots.cost_state` is `DEFAULT 'final' NOT NULL` with no writer — 165 of 165 rows read `final`, so cost certifies itself by absence. |
| 2026-09-06 | Fable — A11 re-driven live on the sim tenant, doors only | **A11 holds live; the door that ANSWERS a difference did not.** One short-ship through the product doors only (Sim Meyhouse `a229f22b…`, gateway from `main` `412fd9d8` on :4010; delivery `f3771f3d…`, door count `ac19b667…` line 1 = 10 against a billed 12, invoice `b1e02edf…` linked). Confirmed live: the door count answered **201**; the identical count re-posted answered **409** naming the existing document (finding 4, V4); `agree` with the difference unanswered answered **409** "1 recorded difference(s) have no answer — line 1 of document ac19b667… (Sentetik Öküzgözü 2021 · 750 ml: 10 against 12)" (A11); once the difference was genuinely answered, `agree` **201 AGREED** under `both_sides_recorded` and `verify` **201 VERIFIED** (verify before AGREED had answered 409). **The defect (V5):** `accept-as-billed` keyed by the INVOICE line 1 answered **201** `alreadyAccepted:false`, a second identical call **201** `alreadyAccepted:true`, and `agree` still refused, naming the same door-count line — the acceptance was keyed by a (document, line) carrying no recorded difference, so it answered nothing while the door said "accepted". Absence wearing the shape of an answer, in the door built to end exactly that. Fixed here: the acceptance must match a difference a comparison recorded, or it is refused **409** and the sentence names the differences that CAN be answered with both quantities, so the caller learns the key; the key is deliberately NOT widened to "any document on the delivery" — a difference has one home. Both doors now read one `recordedDifferences()`, and an `unreadable` comparison fails the acceptance rather than reading as "nothing to answer" (ADR 0067). Three tests proven failing-first. The wrongly-keyed acceptance row on the sim tenant is left in place and named in `v3.0-TECH-DEBT.md`. |
| 2026-09-06 | Fable — A5: the stock-and-cost booking stop | **A1 is built, and `cost_state` has a writer.** The door count now BOOKS STOCK: `DeliveryStockService.bookAtTheDoor` turns each counted line into one `apply_stock_movement` keyed **`(delivery_id, document_id, line_no)`** (A2's key, not `order-delivered:${orderId}`, which drops the second truck), with **no price at all** — absent, never zero (A6) — so the lot lands `cost_state = 'provisional'` and carries the delivery's id on both the lot and the ledger row. `verify()` calls the second half: `finalise_delivery_cost` posts the AGREED price (an accepted proposal beats the invoice line it is about) onto that delivery's lots, writes the prior cost to `inventory_lot_revaluations`, flips them to `final`, and writes **no `inventory_transactions` row at all** — money moves, bottles do not. A corrected count moves the DELTA as a new transaction (ADR 0104 D5); a `WRONG_VENUE` rejection reverses what the door booked, as a movement rather than a deletion. **A5's consolidation, stated exactly:** `recordDoorReceipt` and `markDelivered` are NOT retired — the web door outbox, the orders screen and the mobile app call them, and retiring the endpoints is a client change — but they are no longer SECOND WRITERS: both call `deliveryHasBookedOrder` first and refuse to book what a delivery already booked, and a read that FAILS refuses rather than resolving to "go ahead" (ADR 0067). Migration `20260906233000`: `cost_state` default `final` → `provisional` (finding 2 / V2, CLOSED), `inventory_lots.delivery_id`, `procurement_document_lines.inventory_id`, `apply_stock_movement` stamping both without a signature change (adding parameters would have made a second PostgREST overload or dropped the baseline ACL), and `finalise_delivery_cost`. **Backfill, measured on production read-only:** 165 lots all reading `final`, of which 162 carry NO price (`estimated`) and 3 a `manual` one; the rule chosen restates the 162 as provisional and leaves the 3 final — the alternative ("anything no delivery verified") would have restated all 165, since no delivery had ever verified anything. 8 SQL assertions on a 107-migration build against a 106-migration control (on the control a door-booked lot reads `final`); 13 new gateway tests, three of them proven failing-first by sabotage (book the total instead of the delta; guess the item from the order; read a failed query as "no"). **Named, not fixed:** an invoice line carries no `inventory_id`, so a multi-item delivery whose invoice names no items leaves those lots provisional — said in `costNote`, never guessed by description. |
| 2026-09-06 | Fable — A5 re-driven live on the sim tenant (doors only, gateway :4030 from this branch) | **The doors hold; the stock assertions waited for the merge, and the drive found one defect of its own.** Sim Meyhouse `a229f22b…`, delivery `225e2296…`, door count `f9fc3d8a…` line 1 = 10 against a billed 12. Confirmed live: door count **201**; the identical count **409** naming the existing document (V4); `agree` with the difference unanswered **409** naming line 1 with both quantities (A11); `accept-as-billed` keyed by the INVOICE line **409** because that line carries no recorded difference (V5's fix, holding); `accept-as-billed` on the DOOR-COUNT line **201**; `agree` **201 AGREED** under `both_sides_recorded`; `verify` **201 VERIFIED**. **What could NOT be proven here, and why:** migration `20260906233000` is not on the sim database until this PR merges, so the booking read failed on the missing `procurement_document_lines.inventory_id` and the measured result is `0` `inventory_transactions` for these deliveries, `0` with `reference_type = 'delivery'`, and 165 of 165 lots still `final` — the pre-fix state, exactly. Every stock and cost assertion (provisional at the door, final at verify, the correction delta, the reversal) is proven on the Docker build and NOT live; the parent re-drives after the merge. **The defect the drive found:** the first run answered **500** and the response carried no `deliveryId`, although the count AND the delivery were both already durable — the receiver's only move was to press again, which then 409s on the content hash. Fixed here: a booking failure no longer fails the count. The endpoint answers 201 with the ids and the failure travels inside the receipt (`failed: true`, `bottlesMoved: 0`, the reason in words), which is the opposite of a silent success: a caller reading it sees the failure, and one ignoring it sees zero bottles, never a number that did not happen. |

| 2026-09-06 | Fable — V5 fix (#331) re-driven live on the sim tenant, doors only | **The answering door now refuses a key that answers nothing.** Gateway = main `249e961c` on :4010; fresh door count (line 1 = 10 of 12) → delivery `af9b006f`, invoice `b1e02edf` linked. `accept-as-billed` keyed by the INVOICE line 1 → **409** "Line 1 of document b1e02edf… has no recorded difference, so accepting it as billed would answer nothing. The differences on this delivery that can be answered are: line 1 of document f4d5bee7…"; keyed by the door count → 201; agree → **201 AGREED** (rule A). Log: session scratchpad `lens-vendor/v5-live.json`. Nothing on this delivery was seeded; sim tenant only. |
| 2026-09-06 | Founder (in session); filed by Fable | **A12 recorded.** The A5 build's two ADR-silent choices stand as built — a line books stock only with a caller-named shelf (no description matching), and the two older writers are demoted to non-second-writers rather than retired (three clients still call them). Rejected alternatives written into A12; the retirement is a named follow-up. |
| 2026-09-06 | Fable — A5 re-driven live AFTER #333 merged (main `d23794ff` on :4010, sim tenant, doors only) | **The door books stock; VERIFIED refuses to invent a cost.** Door count with line 1 naming item `a23a4595` (10 bottles): `booking.booked[0].delta = 10`, transaction `ec93b44d`; `stock_live` 17 → 27 read back through `GET /inventory/:rid/item/:id`. A line that named no item (first attempt) came back `notBooked` with the reason in words and nothing moved. Link invoice → accept-as-billed (door key) 201 → agree 201 → verify 201 with `cost.finalised = []`, `stillProvisional = [a23a4595]`: "no agreed price reaches this item — the invoice line does not name it". Honest, and the gap the A5 build itself filed. **New absence:** `GET /inventory/:rid/item/:id/activity` returned **0 rows** for an item whose stock had just moved by a door booking — the activity door does not read delivery bookings (v3.0-TECH-DEBT 2026-09-06). Logs: session scratchpad `lens-vendor/a5-live.json`, `a5-live-2.json`. |
| 2026-09-06 | Fable — A5 re-driven live AFTER the merge, and one defect the pre-merge drive could not reach | **A1 holds live: the door books, and the honest refusals are the ones that fire.** Migration `20260906233000` applied on merge (`schema_migrations` 20260906233000); production `inventory_lots.cost_state` default is now `'provisional'`, and the backfill landed **exactly as measured — 162 provisional, 3 final of 165**. Live on Sim Meyhouse (gateway from merged `main` `d23794ff` on :4030), delivery `d1aea2bc…`: a two-line door count booked **6 bottles** for the line that named a shelf (`transactionId` returned) and reported the other as **notBooked** with the reason — *"NOT booked and NOT guessed at from its description"* (A6); the identical count re-posted **409**; `agree` **409** naming BOTH unanswered lines; after an accepted `PRICE_VARIANCE` proposal and an `accept-as-billed`, `agree` **201 AGREED** and `verify` **201 VERIFIED**. **The defect it found (fixed on `fix/an-accepted-price-finds-its-item`):** `agreedPrices` looked a proposal's line up **only among INVOICE lines**, but `recordedDifferences` keys a difference to the document the comparison found it on — which is the door count, the one document that actually carries `inventory_id`. So the settled price fell through and verify reported *"no agreed price reaches this item"* on a delivery whose price **was** agreed: the agreement existed and the lookup could not see it. Now every document on the delivery is indexed for the lookup while only an INVOICE line is ever read as a price — a door count carries no money (0104 D11), so a number on one can never become a lot's cost. Two tests added; the second is proven failing-first, and the first is labelled as documentation rather than a barrier because the test double ignores `.in(...)` and would pass pre-fix for a reason untrue of the database. |
