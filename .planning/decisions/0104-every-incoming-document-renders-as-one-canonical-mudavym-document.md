# 0104 — Every incoming document renders as one canonical Mudavym document

- **Status:** Locked on the forks the founder answered in session on 2026-09-03 (one canonical schema and template; delivery entity in slice 1; confidence never a number; paper stays light in dark mode; hybrid PDF/A-3 as the export target — _"the most SOTA way, quality first"_); D8 (retention, churn and bring-your-own-storage) and D14 (signed XML as the primary Turkish source) locked on the founder's answers later the same day; D13 **locked by the founder on 2026-09-03: the C-led synthesis leads** (C's delivery spine, collapsed when a delivery has two or fewer documents; A's typeset sheet as the selected frame; B's verdict block on top). Slice 1 build authorised the same day. Design only — nothing here is built.
- **Date:** 2026-09-03
- **Keywords:** invoice, template, canonical document, EN 16931, Peppol, provenance, as_printed, confidence, extraction, OCR, original, signed URL, content addressing, retention, tiering, PDF/A-3, Factur-X, print, dark mode, credit memo, delivery note, irsaliye, receiving advice, duplicate detection, commercial event, sketches
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Links:** [[0103-a-delivery-is-agreed-before-it-is-verified]] (the flow this document is the record of), [[0067-a-failed-read-is-never-an-empty-one]], [[0020-no-fabricated-answers]], [[0032-vault-cleanup-cut-line]], `07-reference/INVOICE_DOC_UX_RESEARCH.md` (§A1 price-base quantity, §A11 invoice-vs-delivery date, §A14 provenance, §D7 never fabricate a regulated field — all honoured here), `06-pages/receipts.md`, `06-pages/documents-reports.md`, `08-softwares/receipts-invoice-match.md`, `.planning/sketches/089-agreed-invoice-directions/`

## Context

The founder's requirement: _every_ incoming invoice is shown in **our** formatted template —
not the vendor's PDF — and the original is fetched from cheap storage only when someone
needs to see it; this is _"a huge thing to monetise and automate"_, so research it
properly, sketch two or three directions, and say which is best on scalability,
flexibility and robustness. Credit memos and delivery notes are documents too, and the
Turkish door reality (ADR 0103 D2) means a phone photo of a paper irsaliye is a
first-class input.

**What is on `main` today.** `ReceivingWorkspace.tsx:2` already calls itself _"the
canonical Mudavym invoice"_; `/receipts` shows the vendor's original in a pane through a
one-hour signed URL from the private `vendor-attachments` bucket
(`common/orchestrator/rabbitmq-bridge.service.ts:846-941` persists inbound attachments;
`procurement.service.ts:3592` fetches, best-effort and capped). `procurement_documents`
knows seven `doc_type`s and six statuses (baseline migration `:4464-4466`). There is no
canonical document object: what renders is the parser's output shaped by the page that
shows it, and there is no per-field record of _where a value came from_.

**The research (scratchpad report, 881 lines, 60+ sources read 2026-09-03; distilled).**
Six patterns recur across the tools that do this well (Ramp, MarginEdge, Ottimate,
xtraCHEF, Vic.ai, Stampli, Dext): the normalised document sits _beside_ the original, not
instead of it; hover shows provenance per field; the verdict comes first; low confidence
surfaces as a named exception rather than a decimal; corrections are audited; and the
degraded case is shown honestly. EN 16931 (Peppol) is the right _vocabulary_ — its ~180
business rules only apply to a canonical object, and its BT/BG identifiers give every field
a name a Turkish e-Fatura (UBL-TR) and a Californian distributor invoice both map to. A
parser (Azure prebuilt-invoice, calibration point) returns ~30 header fields and per-line
amount/quantity/unit/price with confidence and bounding boxes. **What a parser cannot give
is the product:** the four-way quantity spine (ordered / shipped / received / billed), the
price-base quantity (`1 ks × 12 şişe`), line-level allowance/charge reasons, delivery
evidence, claim state, PO/despatch linkage, item identity, provenance. Those are captured
or computed by us. Options were scored on scalability / flexibility / robustness / effort /
monetisation: **(a)** one canonical schema + one template with per-type sections = 21;
**(b)** canonical schema + per-vendor learned layouts = 10; **(c)** normalise the parser
output, original in a drawer = 14.

## Options considered

1. **(a) One canonical schema, one template with conditional sections.** A new vendor
   costs nothing; a new document type is one section; one code path, one set of
   arithmetic invariants, one audit model; the branded canonical document _is_ the product
   surface. Costs: the schema is the real work; every field is an object, not a scalar.
2. **(b) Canonical schema + per-vendor learned layouts.** Maximally flexible per vendor —
   but the flexibility is spent on _layout_, which users least want varied; N code paths
   that drift and fail silently per vendor (the absence-as-health class this repo names);
   invisible to the buyer. The accuracy a manager feels comes from the **mapping** layer
   (vendor item → our product, vendor unit → canonical unit), a lookup written on every
   correction, not a model.
3. **(c) Minimal: normalise the parser output, original in a drawer.** Days to build. It
   forfeits the thesis — a drawer with the original is what Ottimate already ships — and
   has no invariants and no verdicts.
4. **Seven templates, one per document type.** Rejected: the same field means the same
   thing on a credit memo and an invoice; sections, not templates.

## Decision

**Build (a). Reject (b). Keep (c)'s drawer as a _fallback state inside_ (a), never as an
alternative to it.** With the founder's answers:

- **D1 — Three layers, one object.** `EXTRACTED` (what the document says; per field
  `value, unit?, currency?, source, confidence|null, page?, bbox?, as_printed?, revision`;
  immutable once extraction completes — a correction is a _new_ revision), `RESOLVED`
  (what it means here: item identity, canonical unit, GL, vendor id), `ADJUDICATED`
  (what we assert: verdicts, variances, money at risk, claims — recomputed, never
  hand-edited). Fields carry EN 16931 BT/BG annotations; `source ∈ {extracted,
embedded_xml, edi, portal, learned_from_vendor, carried_from_po, human_entered,
human_corrected, computed}`. `as_printed` keeps the literal glyphs so the screen can
  always show what the paper said next to what we concluded — the way §D7 of the earlier
  research (never fabricate a regulated field) is honoured.
- **D2 — One template, conditional sections:** header always; _money_ block empty on a
  delivery note; _delivery evidence_ block empty on a statement; _claim_ block on a credit
  memo and as a chip on any claimed line. Document types: `invoice`, `credit_memo`
  (back-references BT-25/26), `delivery_note` / despatch advice (e-İrsaliye, irsaliye),
  `receiving_advice` (ours, from the door), `statement`, `price_list`, `portal_export`.
- **D3 — The original is stored once, content-addressed, and fetched on demand.** sha256
  is the identity; derivatives (first-page PNG, thumbnail) stay hot; the original is served
  through a short-lived signed URL only when a person opens the pane. Tiering is D8.
- **D4 — Verdict first; words and numbers, never colour alone; confidence never as a
  number.** The manager reads _"line 4 billed 12, received 10 → claim ₺840,00"_, never
  `0.71`. Numbers drive routing internally and are visible in the audit trail. (Founder:
  named exceptions only.)
- **D5 — Corrections are append-only** revisions with who/when/what-was-there-before, and
  a `verified_by` tick per field; the INSERT-only rule is proven by an attempted UPDATE in
  a test. **The mapping memory** — vendor item → our item, vendor unit → canonical unit —
  is written on every correction and labelled `learned_from_vendor` when it fires; a value
  learned from history never masquerades as read from the page.
- **D6 — Intake gate and honest degradation (the founder's blank-page question).** Before
  extraction, document-level checks run and _name_ their verdict: blank or near-blank page
  (ink coverage below a threshold per page), duplicate by content hash, page count and
  bundle detection (several documents in one upload), resolution and skew. A document that
  fails is `rejected_unreadable` or `needs_review` **with the reason on the record**, and
  the uploader is told at once ("page 2 of 3 is blank — retake?"). When extraction runs and
  fails, the template degrades to _original + a handful of human-entered header fields +
  an explicit NOT EXTRACTED banner_; it never renders an empty canonical document as a
  complete one. Documents in `needs_review` age and escalate under ADR 0103 D9; nothing
  auto-posts.
- **D7 — The delivery is the unit of record from slice 1** (founder). One physical
  delivery — the `deliveries` entity of ADR 0103 — is what the PO, the door document, the
  door count (`receiving_advice`), the invoice and the credit memo attach to. Duplicate
  detection is therefore by event, not by invoice number alone; the "received 10 vs
  billed 12" column exists because the door count and the invoice share an event.
- **D8 — Retention is a rule row, storage is tiered by object kind, and leaving is an
  export plus a hold.** The research (scratchpad `research-retention-byos`, 2026-09-03)
  corrected the earlier report: **TTK 82 requires ten years** for Turkish commercial
  documents (VUK 253 five), and the US/California floor is **seven** (IRS bad-debt ⊃ TTB
  3+3 ⊃ CDTFA 4 ⊃ ABC 3, with BPC 25752 wanting alcohol invoices _at the premises_ and
  27 CFR 31.191 wanting them available _during business hours_). So there is no platform
  default: `retention_rules (jurisdiction, document_type) → retain_until rule`, and every
  document carries `jurisdiction`, `retain_until`, `legal_hold`; an `unknown` jurisdiction
  **blocks ingest** — the one part that cannot be back-filled, built first. Tiers are by
  object kind, not by age: derivatives (first-page PNG, thumbnail — ~8 % of bytes, ~95 % of
  views) stay hot on Supabase/CDN; originals go at ingest to a **WORM-capable store**
  (S3 Glacier Instant Retrieval with Object Lock in compliance mode, or equivalent) because
  Supabase Storage has no versioning, no object lock, no legal hold and no lifecycle — a
  service-role key can erase the archive without a trace — and because Deep Archive's
  12-hour restore cannot answer an inspector at the door (legally excluded, not merely
  slow). Cost is not the driver: ten years of a 10k-document tenant is tens of dollars a
  year against ~$130/yr of extraction. **Mudavym is never the Turkish statutory
  archive** — that is the XAdES-signed XML at the taxpayer's integrator (VUK GT 509 keeps
  the duty with the taxpayer and requires the primary archive in Türkiye; a secondary copy
  abroad is expressly allowed) — and the UI, contract and marketing must say so.
  **Bring-your-own-storage is an optional mirror, never a transfer of liability:** a
  `drive.file`-scoped write-then-verify mirror to the tenant's Drive / Box / S3 (Notion is
  not an archive — 5–20 MB caps, hour-long URLs, no immutability; MCP is an agent-tool
  protocol, not a storage backend). **Churn (founder):** the tenant receives a signed,
  hash-verified export of every original and canonical record and may point the mirror at
  storage of their own; we keep our copy under legal hold until each document's
  `retain_until`, then delete. Caveat carried into the review trail: the GT 509
  localisation clause was read from a secondary source; the primary PDF must be read
  before this sub-decision is cited as law.
- **D9 — Dark mode: the paper stays light.** A sheet on a dark desk; print equals screen;
  the scan beside it is light anyway. (Founder.)
- **D10 — Export target is the hybrid PDF/A-3** (the Factur-X / ZUGFeRD pattern: a branded,
  human-readable PDF with the canonical document embedded as machine-readable XML/JSON),
  because the founder chose the SOTA route. Consequence: the template renders
  **server-side** from the same component that renders on screen, so screen, print
  (`@media print`: verdict expanded, tooltips flattened to footnotes, header repeated per
  page, provenance footer with hash and every human verification, QR back to the live
  document) and the hybrid PDF are one code path.
- **D11 — The door view suppresses money by role, not by breakpoint**, and its output is a
  `receiving_advice` on the same delivery.
- **D12 — Five slices, in order, each verifiable:** (1) the canonical object, its
  invariants (Peppol-style arithmetic rules) and the delivery entity, run as a test suite
  over the documents already in `vendor-attachments` — failures _named_; nothing renders
  yet; (2) the template for `invoice`, read-only, desktop, original in the pane,
  hover-to-source — verified by side-by-side screenshots against ten real vendor PDFs;
  (3) correction with the append-only revision log and the `verified_by` tick;
  (4) the mapping memory — measured by correction rate per vendor before and after on the
  same documents; (5) `credit_memo` and `delivery_note` sections and the door view — the
  same component, no forked branch. Print CSS rides with (2); the hybrid PDF with (2)'s
  server renderer.
- **D13 — Direction (Locked 2026-09-03): C leads, with A's sheet as the selected frame and B's
  verdict block on top of it.** Three sketches were built and reviewed at 1440×900
  (`sketches/089-agreed-invoice-directions`, screenshots in the PR): **A "The Ledger
  Sheet"** (paper-first — a typeset EN 16931 sheet, verdict as a stamp, provenance as
  numbered footnotes, the reconciliation ledger in the margin, print = screen);
  **B "The Verdict Desk"** (discrepancy-first — the three named exceptions and the
  four-way spine are the page, the proposal thread expands inline, the document is filed
  beneath as evidence, chroma only where something differs); **C "Door to Desk"**
  (event-first — one delivery is a six-card spine, PO → e-İrsaliye → door count → invoice
  → vendor proposal → credit memo, with an `UNORDERED` ghost card; the selected card is
  the sheet; the original pane follows the selection; the door is a phone inset).
  Against the founder's three criteria: _scalability_ — C is the only direction whose
  screen grows the way the schema grows (D7: N documents per delivery — a second
  irsaliye, a credit memo, a door photo — are cards, not new layouts; A absorbs new
  document types as sections but leaves the event in a margin; B scales on claims and
  demotes the sheet); _flexibility_ — C carries every Turkish door reality (e-İrsaliye,
  irsaliyeli fatura, paper photo) and the US signed ticket as the same card, and the
  mobile door is the same component; _robustness_ — C is the only one that can state a
  line that exists on **no document at all** (ordered, never shipped, never billed),
  because the event is the record; A is the most rigorous on per-field provenance and on
  print fidelity; B's provenance grammar is typographic and easy to miss. C's cost is
  real — chrome before the verdict, the longest time-to-approve — so the recommendation
  is a synthesis, not a pick of C as drawn: **C's spine as the information architecture,
  collapsed by default when a delivery has two or fewer documents (an invoice-only US
  delivery then opens as A's sheet), A's typeset sheet with footnote provenance as the
  selected frame, and B's verdict block — the named exceptions in words and numbers —
  as the first thing on that frame.** Rejected as leads: A alone (the delivery becomes a
  margin note, which contradicts D7), B alone (loses the accountant and the sheet the
  founder called the product).
- **D14 — For Turkish tenants the signed XML is the primary source** (founder). e-Fatura
  and e-İrsaliye arrive as GİB-signed UBL-TR XML; the canonical document maps from it
  field-for-field with `source = embedded_xml` and the signature verified and recorded;
  the PDF is presentation only and OCR never runs on a document that was already
  machine-readable. Ingest needs an integrator connection or an inbox that receives the
  XML — scoped, not built, here.

What carried it: (a) is the only option where the invariants live and the only one the
founder's monetisation thesis survives; every rejected option either multiplies silent
failure modes (b) or is a PDF viewer with a sidebar (c).

## Consequences

- **Easier:** a new vendor is a mapping row, not a layout; TR and US documents share one
  screen; the accountant export, the vendor-facing claim and the portable record are all
  the same object; the arithmetic invariants find a bug once.
- **Harder / given up:** every field is an object (storage and API surface grow); server
  rendering is a new runtime dependency; the delivery entity in slice 1 delays the first
  visible template by that slice; the intake gate will reject real documents at first and
  the thresholds must be tuned on the existing corpus, not guessed.
- **Retired / superseded:** the page-shaped rendering in `ReceivingWorkspace.tsx` and the
  `/receipts` pane become the two faces of one component; `procurement_documents.doc_type`
  gains `receiving_advice`, `price_list`, `portal_export` and loses `unknown` as a
  terminal value (an unknown type is an intake verdict, D6).
- **Revisit when:** a document type needs a field the EN 16931 extension points (BG-32
  item attributes, BG-20/21 allowances and charges) cannot carry; when the mapping-memory
  measurement in slice 4 shows correction rates not falling per vendor; or when D8's
  research says a legal floor cannot be met from our own storage.

## Amendments after the premortem, scale and adversary passes (2026-09-03)

Same three passes as ADR 0103 (annexes `annex-0103-0104-*.md`). None reopens a
founder-locked answer; each names what it changes.

- **S1 — The per-field envelope is stored as a document, not as rows (D1).** Modelled as
  one row per field per revision, a single 30-location tenant writes ~9 M rows a year
  before anyone corrects anything (scale pass, arithmetic in the annex). Resolved: layer 1
  is **one JSONB document per revision** carrying every field's envelope; the append-only
  table holds only the corrections (who, when, field, before, after). The semantics of D1
  and D5 are unchanged; the storage shape is.
- **S2 — Duplicate detection is keyed by tenant (D7).** The commercial-event key includes
  `restaurant_id` (with vendor, date and content hash); without it a shared vendor
  delivering to two sibling locations the same morning merges as a duplicate.
- **S3 — Rendering is isomorphic, server-side only for export (D10).** One component
  renders on screen client-side; the server renders the same component only for print and
  the hybrid PDF/A-3, asynchronously, on one warm renderer — never "every screen-open
  through headless Chromium at the 09:00 receiving peak". Slice 1 carries the cheapest
  load test: render the existing `vendor-attachments` corpus through one warm Chromium and
  record p50/p95 and memory drift before slice 2 fixes the architecture.
- **S4 — The intake gate has a false-positive budget (D6).** Thresholds are set on the
  existing corpus in slice 1, with **≤ 2 % false positives** as the budget for a _blocking_
  verdict; above that the gate warns instead of blocks. Past roughly 5–10 % staff route
  around any gate, which is worse than no gate.
- **S5 — Many-to-many, named (D7).** `document_deliveries` is the join (ADR 0103 A2): a
  consolidated weekly invoice covers several deliveries; a split shipment carries several
  partial invoices; two legal entities can invoice one truck. The "received 10 vs billed
  12" column is computed per (document line, delivery) pair.
- **S6 — Direction and the informal document (D2).** Every canonical document carries
  `direction ∈ {issued_by_vendor, issued_by_us}` — a Turkish `iade faturası` is ours, the
  reverse of a vendor credit memo — and `informal_note` is a first-class type for the
  farmer with a handwritten slip, so a legally normal transaction never reads like a
  broken intake aging in `needs_review`.
- **S7 — Vintage and lot are structured RESOLVED fields (D1)** — see ADR 0103 A9.
- **S8 — Mapping memory: the latest human-confirmed correction wins (D5).** Conflicting
  history is shown, never silently averaged; the slice-4 test seeds a wrong-then-right
  pair and asserts the suggestion follows the latest.
- **S9 — The presentation PDF is a tripwire against the signed XML (D14).** OCR never
  becomes a _source_ for a machine-readable document, but a header-and-totals-only read of
  the PDF runs as a check; a mismatch is a named exception ("the PDF says 10, the signed
  XML says 12"), never invisible.
- **S10 — The door view ships in slice 2, not slice 5 (D12).** The differentiator is
  load-bearing on door capture (ADR 0103 A6); a design that ships it last would have
  measured itself as an invoice-centric three-way match for four slices.

## Amendment 2026-09-06 — an invoice's money names its currency, and the house may restate it (class E)

**Founder, batch 63, verbatim**, asked what an EDI 810 with no `CUR` segment should do
(`x12-invoice.ts:254-257` read `currency: el(CUR, 2) ?? "USD"`, so a Turkish house's
invoice with no `CUR` filed its totals as dollars, silently):

> "take the houses own currency, but AI needs to or otherwise house delibaretly chnage
> it to other currency if the invoice is other than their default"

Filed here rather than under ADR 0117 because 0117 is about a PRICE SIGHTING'S source,
date and unit, while this is about the **document's own denomination** — the currency
`procurement_documents.currency` holds, which is this ADR's layer-1 `currency` field
(D1) and the one BR-5 checks. 0117 Q25 is the sibling decision one level down (what a
recorded PRICE is in) and is unchanged by this.

**The three rules, and where they live.**

1. **No stated currency takes the HOUSE'S own** (`restaurants.currency`, itself
   defaultless since `20260905120000_a_house_names_its_money.sql`). A house that has
   stated none, on a document that states none, has its **money refused**: the header
   charges, the total, every line's price/allowance/deposit and all three tie-out
   fields go to `null`, with one sentence naming BOTH absences. The quantities stay —
   what shipped is real evidence and a delivery note is useful without a price. There
   is no `USD` anywhere on this path. This is `parse-edi832.ts`'s rule (a default is
   not an answer, ADR 0083) with the one difference the founder named: an 810 has a
   house behind it, and a house's stated currency IS an answer where a distributor
   connection's default is not.
2. **The model states what it SEES, and it never decides.** The extraction prompt now
   asks for `currencySeen: {code, asPrinted, where}` — a code, a glyph or a word, with
   the location on the page — or `null` for "the page shows none", which is a real
   answer it must give rather than guess. A sighting whose possible codes do not
   include the currency the document would be filed under **HOLDS** the money: nothing
   is filed under either, and the sentence names which currency the file would take,
   which the model saw, and where. A glyph maps to a SET of codes, never one — `$` is
   seven currencies, and resolving it to `USD` is the move this whole pass deletes — so
   a sighting can REFUTE a filing currency and can never choose one. A glyph this
   gateway cannot read is recorded as evidence and is deliberately **not** a hold.
3. **The house may deliberately change it.** `PATCH /procurement/documents/:id/currency`
   (managers and owners; staff refused in words and shown the control disabled, never
   hidden). It writes an append-only row to
   `procurement_document_currency_changes` (`20260906160000`) naming who, when, the
   previous value, the document's status at the time and what the re-filing moved —
   **before** the change lands, so a restatement nobody recorded never happens — then
   re-files the money off `procurement_documents.extracted`, which is why the full
   parse is stored whole. **Nothing converts**: there is no exchange rate in this
   system, and only the denomination moves.

**NOT SEALED, and the reason is a census not a preference.**
`scripts/check_money_routes_are_sealed.py` scopes the seal to `payment-methods`,
`billing` and `communications/text/credits` — routes that change what the HOUSE IS
CHARGED. No procurement route redeems a seal today, `POST :id/verify` included, and
sealing one route inside an unsealed module reads as a policy while leaving the other
six non-GET routes on the same controller open. The gate here is role plus the append-only log. Whether
procurement as a whole should be sealed is a founder question, not a decision to take
one route at a time.

**Three sibling defects found and closed in the same pass**, each measured on this
tree: `x12-credit.ts` pinned the literal `"USD"` on an 812 that carries a real
`totalCredit` (BCD04) and settles against the 810 — a credit in dollars against a lira
invoice, from our own parser; `x12-ship-notice.ts` did the same on a document that
states no money at all; and `canonical/from-document-rows.ts:219` read a NULL currency
back as `USD`, which would have re-dollarised **on this ADR's own canonical face**
every document rule 1 had just refused.

**The pre-fix behaviour, measured rather than remembered.** A probe spec built from
`git show HEAD:apps/api-gateway/src/procurement/documents/x12/*.ts`, run, and then
deleted: a CUR-less 810 came back `currency: "USD"` with `total: 528` beside it and no
warning of any kind, and `parseX12` took one argument, so a caller that knew the house
was in Turkiye had nowhere to say so.

**Answered by the founder the same day, batch 64. All four are DECIDED.**

1. A held invoice **blocks the PRICE at receiving only**, never the delivery's stock
   movement, and — verbatim — *"let them approve if otherwise"*: a person may approve
   past the hold. Alongside it the founder asked for **a default-currency section on each
   vendor's profile**. Both are a later builder's (p4br); this pass builds neither, and
   `verifyReceipt` still takes its price and currency from what a person keys in.
2. Rule 2's evidence is shown **only on a disagreement** — as built.
3. Procurement's three writes **will be sealed as a module in a later pass**, not one
   route at a time. This route stays unsealed until then, as argued above.
4. Invoices already filed under an unchosen `USD` are **left alone** — as built.

**One correction made after the founder's answers, 2026-09-06 (p4bp follow-up).** The
first version of rule 3 wrote `computed_lines_total`, `tie_out_delta` and `ties_out` from
`documents.controller.ts`, and `scripts/check_proposal_preservation.py` failed it: those
three are the machine's own proposal and ADR 0059 gives their write to the thing that
proposed them, `DocumentIntakeService`. The re-filing now lives there
(`refileMoneyForCurrency`), re-deriving the tie-out through the same `applyTieOut` intake
and `editLine` run; the controller writes only the audit row and the currency, which are
the person's half. This was not a technicality — a controller computing a tie-out is a
second implementation of the arithmetic, and the moment the two disagree the screen shows
one verdict while the review queue sorts on another.

## Review trail

| Date       | Reviewer                                                                                                                                            | Outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-03 | Fable (lens session), from the founder's in-session answers and the template research                                                               | Created; D1–D7, D9–D12 locked by the founder's answers; D8 and D13 proposed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-09-03 | Fable, from the retention research and the founder's answers (churn = export then hold to the floor, plus a tenant-side mirror; signed XML primary) | D8 and D14 locked; D13 still proposed pending the sketch review; GT 509 primary source still to be read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-09-03 | Fable, after reviewing the three rendered directions                                                                                                | D13 recommendation recorded: C-led synthesis (C spine, A sheet, B verdict block); the founder locks or redirects                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-09-03 | Fable, from three Sonnet passes (premortem, scale, adversary; annexed)                                                                              | S1–S10 recorded; D12 slice order changed (door view to slice 2); storage shape of D1 changed, semantics kept                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-09-03 | Founder (in session)                                                                                                                                | D13 locked: C-led synthesis; slice 1 (canonical object, invariants over the real corpus, delivery entity — no UI) authorised to start                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-09-03 | Fable, building D12 slice 1 (`feat/canonical-document-slice-1`)                                                                                     | Slice 1 built — migration `20260903160000` (6 tables: `deliveries`, `document_deliveries`, `delivery_proposals`, `vendor_terms`, `document_revisions`, `document_corrections`; 8 columns + 5 doc types on `procurement_documents`; `inventory_transactions.delivery_id` and `inventory_lots.cost_state` as columns only), `procurement/canonical/` (three-layer object, **16 invariants** carrying their EN 16931 BR ids, mapper, service — no route, no provider registration), 15 SQL assertions and 60 TS tests, all passing. **Corpus: 0 documents read** — `procurement_documents` 0 rows, `procurement_document_lines` 0 rows, `vendor-attachments` 0 objects, measured read-only 2026-09-03. The invariants are proven on 9 labelled SYNTHETIC fixtures ONLY, and the report records that as an absence rather than as "0 failures". The Turkish response-window and invoice-issuance `vendor_terms` rows stay UNSEEDED (A8).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-09-04 | Fable, closing slice-1 gaps 1-3 (`fix/canonical-extractor-emits-types-and-price-base`, PR #298)                                                     | Extractor emits all twelve D2/S6 doc types, the coercion now derived from `DOC_TYPES` so the two lists cannot drift; BT-149/BT-150 round-trip through `ParsedLine`, and the line-net arithmetic restates the quantity in the price base's own unit before dividing (`12 şişe @ 142,00 / KS(12)` and `2 KS @ 264,00 / KS(12)` break in opposite directions), refusing as UNTESTABLE rather than guessing when it cannot; `as_printed` carries the printed money and quantity literals unreformatted. Per-field `confidence` set to NULL per D1 — the extractor's `0.8 − 0.1 × warnings` is a document-level heuristic, not a per-field probability — and `unreadable[]` was NOT mapped to per-field zeros because it names no field. **Gap 4 untouched:** still 0 real documents, still synthetic fixtures only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-09-04 | Fable, building D12 slice 2 (`feat/canonical-document-slice-2`)                                                                                     | **Slice 2 built — the canonical document on screen, C-led, behind the gate (OFF).** Migration `20260904120000` persists BT-149/BT-150 and the `printed` literals (`procurement_document_lines.price_base_qty / price_base_uom / printed`, `procurement_documents.printed`) — proven on a local Docker Postgres built from all 97 migrations, with a control database lacking them; `20260904121000` adds the `mudavym_design_document` flag column. `normalizeUom` now reads the Turkish spellings (`şişe`/`sise` → bottle, `KS`/`koli`/`kasa` → case, `adet` → **`each`, not bottle**, because a countable piece is not a claim about the container; `kutu` deliberately left UNDECIDED — no source settles case vs retail carton), with the Unicode fold that `toLowerCase()` alone cannot do (`"ŞİŞE".toLowerCase()` is `şi̇şe`, i + U+0307, and never matches `şişe`). New read route `GET /procurement/documents/:id/canonical` + `GET /procurement/deliveries/:id`; `CanonicalDocumentService` and the new `DeliverySpineService` registered as providers at last. Page `/documents/:id` behind `PageGate page="document"` (OFF; `legacy` is a redirect to `/receipts`), seven sections, 27 component tests + 5 page tests + 24 new gateway specs. **Three synthetic PDFs went through the real intake door on the sim tenant and NOT ONE WAS EXTRACTED** — the keyed gateway answered `Anthropic 400: Your credit balance is too low`, so every screenshot is of the DEGRADED state (D6) and no four-way table, price base, provenance hover or exception sentence has ever been seen against a document a model read. Four defects found by building it: (1) an extractor that THREW discarded the whole document — 422, no row, and the original bytes already orphaned in the bucket — now stored unread with the reason on the record (D6); (2) the verdict block called an unread document "nothing differs"; (3) the sheet printed `Lines $0.00` for a document with no lines, in a currency the intake had defaulted to USD; (4) the route selected a `filename` column `procurement_documents` has never had, which made three documents with stored originals report "no original was stored". All four fixed with tests; (4) also hardened the read-columns guard by spelling the column lists out as literals.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-09-04 | Fable — first render against extracted documents (extraction supplied from Claude Code via PR #301; the gateway's key has no credit)                | Held: price base, `as_printed`, "not counted", tie-out line, money-less door. Nine findings filed in `v3.0-TECH-DEBT.md`; contract gaps: BT-72 delivered date, BG-23 VAT breakdown, deposit-line semantics, UNCL7161 coding; the verdict block reports absence as difference (A6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-09-05 | Fable, closing the nine findings of the first render (`fix/canonical-first-render-findings`, PR #304)                                               | **All nine CLOSED, failing-first (27 gateway + 9 web assertions proven red against `origin/main` before the fix).** D4's verdict block no longer reports ABSENCE as difference: with no order and no door count the headline is _"Not compared — no order or door count to compare against"_ and each card says `not compared`, never `NOT ADJUDICATED` (ADR 0103 A6). D1's layer 1 finally carries its parties — BG-4 from the resolved provider (`company_name \|\| name`) else `extracted.vendorName`, BG-7 from `restaurants.name`, both record-sourced names `human_entered` with a NULL `as_printed` so a name the page never printed cannot borrow its authority; **BT-31/BT-48 stay NULL because `providers` and `restaurants` were read on 2026-09-05 and NEITHER has a tax-id column.** The extraction contract gained `deliveredDate` (BT-72), `taxBreakdown[]` (BG-23) and `lineKind ∈ {goods, deposit, fee}`, all persisted inside `extracted` jsonb — **no migration** — and read back keyed on `line_no`. BT-107/BT-108 are now the sums of BG-20/BG-21 and BT-109 = BT-106 − BT-107 + BT-108, so the sheet cannot print "Charges —" beneath a listed charge; **and `total_without_vat` reports UNTESTABLE when BT-109's envelope says `computed`**, because a rule that grades the formula that made its own input is green for ever and proves nothing. A deposit — stated as a line, as a subtotal, or as both — becomes ONE BG-21 charge coded `7161` and leaves BT-106; the line's own `deposit` is no longer added when the line IS the deposit (the 360-against-180 failure) and still is when it is a per-line crate charge. Fixture pair SYNTHETIC 9 / 9b keeps the rule falsifiable. **Finding 8's premise was WRONG and the measurement says so:** read-only on 2026-09-05 with the service role, 5 documents, 5 objects present, 5 signed 200, 5 fetched 206 — the "1 objects" published on 2026-09-04 was `canonical_corpus_run.py` counting a NON-RECURSIVE listing, i.e. one folder placeholder. The runner now walks the tree and returns NULL rather than a partial count; separately `persistOriginalBytes` returns `{path, failure}` so a failed upload is a named failed WRITE on the row's `notes` and in `IntakeResult.storageError`, never the same NULL the EDI channel returns, and `GET :id` carries the `imageUrlReason` it used to discard. D9's sheet: the `<caption>` gets `display: table-caption` (KICK's `display: block` demoted it to an anonymous cell in the 22 px `#` column) and `fmtDate` takes the currency as a second witness, so a TRY document prints `dd.MM.yyyy` even when `jurisdiction` is NULL — as it was on all three. **Not fixed, and filed rather than smuggled in:** `amount_due` (BR-CO-16) is a TAUTOLOGY on any extracted document — BT-112 and BT-115 both come from `ParsedDocument.total` — so it can only ever hold. |
| 2026-09-05 | Fable — second render, second-version fixtures through the door with the new contract                                                               | Held: verdict "Not compared", seller/buyer, BT-72, BG-23 row, summed charges, 7161 coding. Two findings filed (`v3.0-TECH-DEBT.md`, second render): the deposit line is counted twice when stated as line and subtotal, and the corpus runner maps differently from the route. Corpus run 2026-09-05 committed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-09-05 | Fable — second render of `b1e02edf` after #304 (`fix/canonical-deposit-line-readback`) | **Two defects, both FIXED failing-first (3 gateway + 1 web assertion proven red against `origin/main` first).** (1) BT-106 carried the deposit line — and `lineKind` was NOT what lost it: the snapshot holds it, `applyTieOut` excludes it, `computedLinesTotal` was 9172. `from-parsed-document.ts` preferred the STATED subtotal unconditionally, and this paper's subtotal (₺9.352,00) CONTAINS the deposit, so BT-106 double-counted what BG-21 was already carrying and the ladder printed ₺11.366,40 under a stated ₺11.186,40. `linesNetTotal()` now subtracts a deposit line only when `stated − depositLines === computedLinesTotal` MEASURES that the subtotal contains it, marks the result `computed` and drops its `as_printed`; a subtotal matching neither is left alone. (2) The route and `scripts/canonical_corpus_run.py` had two row→`ParsedDocument` mappings and the runner's never opened `extracted` — hence `vat_breakdown_present` named as failing on documents whose page rendered the VAT row. One function now (`from-document-rows.ts`), and the runner selects `extracted`. (3) D4's verdict block now checks the LADDER it prints (BT-109 + BT-110 vs BT-112), not only the door's tie-out, and names the delta. Surfaced while fixing (2) and fixed with it: BR-S-08 filtered lines by BT-151/BT-152, which the contract never asks for, so it reported "covers lines worth 0.00" — now UNTESTABLE. Corpus run on the same database, read-only: **9 named failures → 5**; `b1e02edf` and `5c7d4801` clean, `d0b96d4a` (4) and `e34a5b9f` (1) keep their historical v1 failures unchanged. STILL OPEN: no per-line VAT category in the extraction contract, so BR-S-08 is untestable on every document this gateway reads. |
| 2026-09-05 | Fable — slice 3 stop 1: the correction door (D5) | **Built.** `POST /procurement/documents/:id/corrections` and `POST :id/fields/verify`, a CLOSED registry of correctable layer-1 paths with a declared type per field (`canonical/correctable-paths.ts` — `__proto__`, a computed total and a line that does not exist are all 400s before any write), migration `20260905231500` adding `document_corrections.reason` and `kind ∈ {correction, verification}` (proven failing-first on a control database built from the 99 migrations before it, then green on 100; T16–T19), 23 gateway tests and 7 web tests. **A correction is replayed through the SAME mapper the read path uses**, so the bottle-equivalent, the tie-out and every EN 16931 invariant follow the corrected number — a cosmetic overlay would have left layer 3 grading figures the page no longer shows, and both that and the swallowed-log-read were sabotage-proven to turn the new tests red. The first correction writes the PRE-correction document down as revision 1 before taking revision 2, so the log opens with what the machine read. **Two deviations, both stated in `v3.0-TECH-DEBT.md`:** a correction that CHANGES a value clears that field's `verified_by` (carrying it would print a human assertion nobody made; the old tick survives in the append-only `before`), and the builder replays the correction LOG rather than serving the stored `layer1` blob, so a later re-extraction stays visible. Slice 4's mapping memory is a named seam (`learnableKey`) that nothing reads. |
