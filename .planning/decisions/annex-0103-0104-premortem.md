> Annex to [ADR 0103](0103-a-delivery-is-agreed-before-it-is-verified.md) and [ADR 0104](0104-every-incoming-document-renders-as-one-canonical-mudavym-document.md) — a Sonnet premortem pass run 2026-09-03 before any build, at the founder's request that the irsaliye process be bulletproofed. Findings are folded into the ADRs' amendment sections; this file is the evidence, not the decision. Paths inside refer to the session scratchpad and are historical.

# Premortem: receiving / invoice-proofing pipeline, six months post-launch

Both venues failed. Working backwards through ADR 0103 (delivery states) and ADR 0104
(canonical document) against the code they land on: `procurement.controller.ts`,
`procurement.service.ts` (`verifyReceipt` L2015, `markDelivered` L1521),
`receiving.service.ts` (`recordDoorReceipt` L177), `inbound-responder.service.ts`
(`syncOrderState` L1088), and the `procurement_documents` / `procurement_document_links`
CHECKs in the baseline migration (`:4426-4466`).

**Ground truth from the code, load-bearing for several scenarios below:**
- `markDelivered` books live stock **immediately at DELIVERED**, keyed by a single
  idempotency string `order-delivered:${orderId}` — one booking per *order*, ever.
  `resolvedQuantity` defaults to the **full ordered quantity** when the caller sends none.
- `recordDoorReceipt` (the door flow) is better-built — idempotent **per event**, unit-safe,
  and its own comment says stock is "booked to live stock immediately... staff must be able
  to pour it." Two live receiving paths exist today with **different** booking and
  idempotency semantics; neither defers booking to a downstream gate.
- `syncOrderState` silently drops a vendor reply that contradicts the order (price or qty
  mismatch) into `negotiation_attempts`/`last_negotiation_at` — no reason, no evidence, no
  record a human or a future query can find.
- `uq_pd_restaurant_sha256` is a real unique index but only catches **byte-identical**
  re-uploads — two different photos of the same paper irsaliye hash differently.
- No `deliveries` table exists yet; `procurement_document_links.order_id` is `NOT NULL` —
  a document attaches to one order today, never to a multi-document event.
- `ProcurementOrderStatus` already has `PARTIALLY_RECEIVED`, used by `recordDoorReceipt` and
  `verifyReceipt`'s backorder branch — order-level split-shipment awareness exists in one
  code path but not the other, and not as delivery-level state per ADR 0103 D1.

---

## Twelve scenarios

### 1. Two e-İrsaliye for one PO, second after the first is AGREED
D1 puts states "on the delivery, not the order," and the Consequences section implies a
`deliveries` table the PO's documents "attach to" — but **no D-bullet ever locks the
PO:delivery cardinality.** Is a split shipment two `deliveries` rows against one PO, or one
`deliveries` row re-entering `RECONCILING`? Undecided. If it's two rows (the sane reading),
nothing states how the **order's own status** (still on `procurement_orders`, 12 literals,
explicitly *not* touched by the new column per the Consequences section) gets summed from
N child deliveries to know the PO is fulfilled. Grounded risk: today's `markDelivered`
idempotency key is per-*order*, and `resolvedQuantity` defaults to the full ordered
quantity — a naive migration that keeps that shape for "delivery 1 of 2" over-books the PO
on the first truck and then the idempotency guard silently no-ops the second, exactly as it
would today. **Breaks:** D1 (no cardinality rule) + the code seam it must replace.

### 2. Irsaliyeli fatura, three copies, photographed at door, two lines short, correction window already closed
D2 gets the *fact* right — "the correction window is already closed... the flow is
accept-then-`iade faturası`, and the product says so on the screen" — but D1's single state
diagram routes every door document into the same `RECONCILING` label regardless of type.
`RECONCILING` implies a bilateral, cooperative correction; for an already-issued fatura the
real posture is unilateral objection under TTK 21/2's 8-day clock, not negotiation. Nothing
says the *screen* or the *state semantics* differ by D2's document type, only that "the
product says so" — unspecified how. Worse: an `iade faturası` is **buyer-issued** in Turkey
(the reverse of a US vendor-issued credit memo), and D2's `credit_memo` type carries no
`direction` field — EN 16931's BT-25/26 back-references assume seller-issued credit notes.
**Ambiguous:** D1 (RECONCILING semantics not typed) + D2 (no issuer-direction field).

### 3. Vendor counter-proposal arrives after the 7-day e-İrsaliye window lapsed (D9)
D9 is explicit that a lapsed delivery is recorded as **terminal** — "the queue never falls
back into an unowned backlog" — and states what the law now deems (TR: accepted in full)
without pretending agreement. That much is sound. What D9 never says: can a `LAPSED`
delivery receive a **later** proposal at all? Silence-accepts is a tax/administrative
deeming, not a bar on a vendor voluntarily issuing a late credit or corrected invoice — real
vendors do this. If `LAPSED` is genuinely terminal, the late document has nowhere to attach
and either gets rejected (operator confusion — the vendor *did* make it right) or silently
reopens the delivery with no defined re-entry transition, corrupting the very "what the law
deems" record D9 exists to protect. **This is the single most dangerous ambiguity in either
ADR** — see the ranked list below.

### 4. Same door photo uploaded twice by two staff, plus the vendor's PDF the next day
`uq_pd_restaurant_sha256` catches only byte-identical files; two photos of the same paper
from two staff hash differently and both pass ingest clean. D7 says dedup is "by event, not
invoice number alone," but no D-bullet in either ADR states the identity heuristic for "same
physical delivery event" (same PO + vendor + date window + overlapping lines?). Absent that
rule, the emailed PDF arriving a day later — a third document, third channel, different
timing — has no defined reason to collapse onto the same `deliveries` row rather than
spawning a phantom second delivery. D8 (0104)'s intake gate names "duplicate by content
hash" only; D8 (0103)'s notification table has nothing for "two documents may be the same
event, confirm merge." **Silently reports absence as health:** three documents, no forced
merge decision, and the delivery count is whatever the ingest order happened to produce.

### 5. Wrong-venue delivery, accepted and counted by a new employee
D7 names `WRONG_VENUE` explicitly and correctly: "never enters `RECONCILING` — it is a
rejection." But the scenario is that it was **already counted** before anyone applied that
reason class — and per the ground-truth note above, `recordDoorReceipt`'s own design intent
is to book counted stock to live **immediately**, "staff must be able to pour it." D1's
central invariant — "Inventory moves and COGS posts at `VERIFIED`, and only there" — is in
direct tension with that already-shipped, deliberately-justified behavior, and neither ADR
reconciles the two. If the door keeps booking early (as designed, for pourability), a
wrong-venue delivery is physically comingled into the wrong restaurant's stock before any
`WRONG_VENUE` tag can apply — the reason class is correct, the timing that would make it
useful is not built. **Breaks:** D1's core invariant vs. an existing, justified code seam.

### 6. Price change above threshold, CA alcohol, 9 days left on the AB 2991 clock, owner on holiday
D6 correctly human-gates this. D8 (0103) fires at day ~20 of 30. D9's escalation ladder
(50% / 80% / venue owner) is generic across clocks, so it does apply here — but it escalates
to **one named human** with no fallback. If that human is unreachable, the price dispute
never gets a decision, yet AB 2991's EFT is **wholesaler-initiated** and debits on schedule
regardless. At day 30 the money is gone while the delivery may still be sitting in
`RECONCILING` (nobody approved the override). D1's pipeline is linear —
`...AGREED → VERIFIED → INVOICE_FILED → PAID` — with no state for "paid without being
verified." **Breaks:** D1's ordering assumption; D9's single-owner escalation has no
fallback. (Elaborated further in ranked cause #3.)

### 7. Vintage substitution (2021 ordered, 2022 delivered), XML correct, door count against the wrong item
D14 correctly makes the signed XML primary for TR tenants. D6 correctly names a vintage
change as substitution, not tolerance. But the *mechanism* that would catch "door count
attached to the 2021 inventory row while the XML says 2022" is never locked: the research
(`research-invoice-proofing…md` §C6.4) explicitly recommends vintage as a **first-class
RESOLVED-layer field**, not folded into an item-name string — and flags that no surveyed
competitor does this. That recommendation **never became a D-bullet in either ADR.** D6
(0104)'s "safe to automate: PO↔document line matching" doesn't say whether that matching is
vintage-aware. Without a structured vintage field to diff on, "vintage change = substitution"
has no reliable trigger — the mismatch between the door count's item and the XML's item is
detectable only if a human happens to notice two items that look almost identical.

### 8. Free goods on the same invoice as paid goods; deposit/CRV lines
The one scenario the ADRs handle well. D7 (0103) names `FREE_GOODS` (kept out of COGS and
price history, tagged as a compliance record) and `DEPOSIT_OR_FEE` explicitly, matching the
research's C6.9/C6.10 best-of-breed recommendation almost verbatim. Minor open point: D8
(0104)'s `retention_rules` is keyed `(jurisdiction, document_type)`, not by reason class —
fine, since the federal 3-year free-goods floor sits inside the 7-year US invoice floor, so
no separate row is needed. No GL-account routing for `DEPOSIT_OR_FEE` is specified, but that
is implementation detail, not a design break.

### 9. Vendor with no e-Fatura at all — degraded state, UNORDERED, retention
D6 (0104)'s degraded-extraction path and D5 (0103)'s `UNORDERED` provenance both apply
cleanly if the document fits D2's `doc_type` enum. It does not obviously fit: a handwritten
farmer note is neither an `invoice` (not formally one under VUK) nor cleanly a
`delivery_note`. Forced into the nearest bucket, or left in `needs_review` because nothing
matches, it ages under D9's escalation ladder **forever** — a legally normal, sanctioned
transaction (buying informally, below the e-Fatura threshold) is treated identically to a
genuinely broken intake, and never reaches a terminal state that correctly names what it is.
**Silently reports absence as health:** the system has no vocabulary for "this vendor is
legitimately outside the e-document system," only for "this document could not be read."

### 10. August closure; a delivery's clock expires during the closure
Turkish law does not pause for holidays (research §B2: "Sundays and official holidays
count"), so the clock itself is correctly unforgiving — that part is not a design gap. The
gap is institutional: D9's escalation notifies "the venue owner," singular, through what is
presumably an in-app channel. Nothing in D8/D9 models a **closure calendar** or a channel
escalation (SMS/email/a designated emergency contact) distinct from the everyday in-app
notification a closed venue will not be watching. The result is deterministic: `LAPSED` (TR)
or an EFT debit (US) will occur with certainty and the product's only signal was a
notification nobody was positioned to see.

### 11. Signed XML says 12, door count says 12, invoice PDF says 10
D14 is unambiguous and, read literally, closes off the very check that would catch this:
"the PDF is presentation only, and OCR never runs on a document that was already
machine-readable." That means the system never reads the PDF's "10" at all — it is not
overridden by the XML, it is **never examined**. The canonical document shows "12" with
total confidence (`source = embedded_xml`, D4's named-exception verdict language) while a
second document a human might reasonably glance at, sign, or file contradicts it, and
neither the system nor a human looking at Mudavym's rendering is ever put in a position to
notice. **This is the cleanest textbook case of absence-as-health in the whole design:** a
confident, well-sourced verdict is displayed precisely because the contradicting evidence
was deliberately never looked at.

### 12. Five corrections in a row; mapping memory learns the wrong item from correction #1
D5 (0104) mandates append-only revisions and says the mapping memory "is written on every
correction and labelled `learned_from_vendor` when it fires." It never says what happens on
**read**: is mapping memory a keyed/upsert table (each correction overwrites), or itself an
append-only log needing an aggregation rule (recency? frequency? human-confirmed-only?) when
five corrections disagree? If a first, wrong correction writes a `learned_from_vendor` row
and nothing supersedes it on read, the wrong mapping can be **offered again on delivery #6**
as if it were confidently known, regardless of the four corrections that followed. This
directly threatens D12 slice 4's own success metric — "measured by correction rate per
vendor before and after" — which could show a *regression* (more corrections needed, not
fewer) with no visibility into why: the memory is poisoned, and nothing in the ADR says how
that is prevented or detected.

---

## Ten most likely causes of failure, ranked by (likelihood × damage)

1. **D1's "inventory moves only at VERIFIED" contradicts the existing, deliberately-built
   door-receiving behavior.** `recordDoorReceipt`'s own comment justifies booking live stock
   immediately "so staff must be able to pour it" — a real, considered tradeoff, not an
   oversight. *Wrong data:* on-hand and COGS both move before any human agreement exists.
   *Mitigation:* lock an explicit intermediate stock state (pourable but excluded from
   COGS/vendor-spend until `VERIFIED`) as a named D-bullet before build; test that a delivery
   stuck in `RECONCILING` is simultaneously pourable and absent from cost reports.

2. **No locked PO:delivery cardinality rule for split shipments**, combined with
   `markDelivered`'s current per-order idempotency key and full-quantity default. *Wrong
   data:* the first truck over-books, the second is silently dropped — a live, provable bug
   shape today, unlisted for retirement. *Mitigation:* lock "N deliveries per PO," re-key all
   stock idempotency to delivery id not order id, and add a regression test replaying two
   sequential deliveries against one PO.

3. **AB 2991's wholesaler-initiated EFT can PAID a delivery that is still stuck in
   `RECONCILING`**, because D1's pipeline is linear and payment there is gated behind
   verification that a human never performed. *Wrong data:* `PAID` recorded with no
   `VERIFIED`/`AGREED` behind it; the price dispute has nothing left to resolve against.
   *Mitigation:* add a `paid_unverified`/disputed flag independent of the main state column,
   plus a notification that distinguishes "paid because EFT" from "paid because agreed."

4. **D14's absolute "OCR never runs on machine-readable documents" rule makes an XML/PDF
   content mismatch structurally undetectable**, by system or human. *Wrong data:* a
   confidently-sourced canonical field (`source=embedded_xml`) can silently diverge from what
   a human-facing copy of the same delivery says. *Mitigation:* a cheap header/total-only
   parse of the PDF purely as a tripwire against the XML — never as a data source — that
   raises a named exception on mismatch.

5. **`LAPSED` is described as terminal with no defined re-entry**, but real vendor behavior
   (a late credit, a late corrected invoice) does not respect that terminality.
   *Wrong data:* either a legitimate late document has nowhere to attach, or the system
   silently reopens a "what the law deems" record with no audit trail for the reopening.
   *Mitigation:* define an explicit `LAPSED_AMENDED` (or equivalent) transition with its own
   evidence and audit fields before build.

6. **`syncOrderState`'s existing pattern of silently dropping a contradicting vendor reply**
   (price or quantity mismatch) into free-text negotiation metadata, with no reason class, no
   evidence, no queryable record — exactly the mechanism `RECONCILING`/`delivery_proposals`
   must replace, and neither ADR names it as something to retire. *Wrong data:* vendor
   counter-proposals vanish from the structured record. *Mitigation:* an explicit
   build-scope line retiring the silent-drop branch, replaced by a `delivery_proposals`
   insert on every contradiction; test by replaying a captured real contradicting reply.

7. **Two divergent existing receiving code paths — `markDelivered` and
   `recordDoorReceipt` — have different booking and idempotency semantics, and the ADR's
   Retired section only names `retroactive-order`.** *Wrong data:* whichever path survives
   unreconciled carries its own idempotency and timing assumptions into the new `deliveries`
   model. *Mitigation:* name both endpoints explicitly for consolidation in the ADR's build
   scope, not just the retroactive-order door.

8. **No document-issuer `direction` field, and D2's `doc_type` enum has no home for a
   buyer-issued correction** (Turkish `iade faturası` is issued by the restaurant, the
   reverse of a US vendor-issued credit memo) or for an informal/unregistered-vendor
   document. *Wrong data:* these documents force into `needs_review` and can age forever
   under D9's ladder without ever reaching a correctly-labeled terminal state — a legally
   normal transaction reads identically to a broken intake. *Mitigation:* add `direction`
   (issued_by_us | issued_by_vendor) to the canonical object and a first-class category for
   informal/below-threshold vendor documents.

9. **Vintage was recommended by the research as a first-class RESOLVED-layer field but never
   promoted into a locked D-bullet.** *Wrong data:* "vintage change = substitution" (D6) has
   no reliable machine signal to trigger on, so a mismatched door count against the wrong
   vintage item is only caught if a human happens to notice. *Mitigation:* lock a bullet
   requiring vintage (and lot/batch, where applicable) as a structured field, and a test
   asserting a vintage-only diff triggers `SUBSTITUTION`, never a silent match.

10. **Mapping memory has no specified precedence rule across repeated, conflicting
    corrections.** *Wrong data:* a first wrong correction can be offered again, confidently,
    on delivery #6, and D12 slice 4's own success metric (correction rate per vendor) could
    show a regression with no visibility into why. *Mitigation:* specify recency-wins (or
    human-confirmed-only) resolution explicitly; slice-4 test seeds a wrong-then-right pair
    and asserts the suggestion reflects the latest correction, not the first.

---

## Note on scope

Two findings above (scenario 9's informal-vendor document type, and the müstahsil-makbuzu
outbound-document possibility considered and dropped) reach slightly past what the assigned
research docs verified — flagged inline, not asserted as fact. Everything else cites an
ADR D-bullet, a `file:line`, or both. No code was changed; no other file in the repo was
touched.
