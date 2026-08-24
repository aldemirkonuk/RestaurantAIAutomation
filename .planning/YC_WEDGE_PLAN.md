# The Invoice Wedge — build plan

**Date:** 2026-07-27
**Supersedes the sequencing in:** `AGENT_NATIVE_UI_DECISION.md` (the verdict there stands; the *order of operations* changes)
**Status:** REVISION 2 — in progress. Track A complete.

---

## REVISION 3 — the document flow

The match was modelling two documents. A delivery has four, plus a fifth that
closes the loop:

| Document | X12 | Proves | Was |
|---|---|---|---|
| Purchase order | 850 | what we ordered | ✅ single-line only |
| **Packing slip / ASN** | **856** | what the distributor says **shipped** | ❌ absent |
| Delivery receipt / POD | — | what a human signed for at the door | ❌ absent |
| Invoice | 810 | what we are billed | ⚠️ hand-typed, inferred from the PO |
| **Credit memo** | **812** | what they **agreed to pay back** | ❌ absent |

**Why the packing slip changes the product, not just the schema.** Every other
discrepancy is our word against theirs and gets argued on the phone. When their
ship notice says 22 and their invoice says 24, *their own two documents
disagree* — there is nothing left to dispute. `overbilled_vs_ship` is the
highest-confidence claim this system can make, and it now outranks every verdict
except a missing invoice. It also splits a failure that used to be one bucket:
short-vs-slip is goods lost between warehouse and door (a carrier problem),
over-vs-slip is a billing problem. Different remedies, different counterparties.

**Why the credit memo is the real metric.** Until an 812 lands on a later
invoice, "dollars recovered" means *"we asked."* Verified recovery requires
watching the credit arrive, which requires modelling the document it arrives on.

**EDI, honestly.** The Southern Glazer's EDI programmes are *vendor-side* —
suppliers selling **to** the distributor through Ariba. That is the opposite
direction from what a restaurant needs. Restaurant-side EDI does exist —
MarginEdge brokers it and the largest distributors offer operator feeds — but it
is requested per distributor and is a big-house privilege. So: parse X12
(810/856/812, read 850/855), accept it however it arrives, and **build no VAN or
AS2 transport.** The connectivity is a commercial problem, not a technical one,
and it is the same trap shape as the 22 "planned" POS adapters.

**Four intake channels, one document model.** Email (a per-restaurant invoice
address — what MarginEdge's intake actually runs on, and this repo already has
gmail-watch, inbound-address, `conversation_attachments` and a
`vendor-attachments` bucket), photo at the door, web upload, and SFTP/EDI drop.
Downstream code never learns which channel a document arrived on.

---

## REVISION 2 — what two expert reviews changed

Two independent reviews were run against this plan and the code: an operator
(22-year owner-operator + CPA, fractional CFO to 14 restaurants) and a 2026
seed investor. Every code-level claim below was then verified directly.

**Four decisions changed:**

| | Was | Now | Why |
|---|---|---|---|
| **Track order** | B4 (persist invoices) last | **New Track B0 first** | `procurement_orders` is one wine / one quantity. There is no `procurement_order_lines` and no invoice-lines table anywhere (verified: grep across all migrations returns nothing). B2's "map extracted lines onto PO lines" is **impossible** — the lines do not exist. A real distributor invoice is 18–40 lines spanning several POs. |
| **Track C** | Simulator + POS adapters | **Cut** | The three-way match is PO vs invoice vs physical count. **Not one of those comes from a POS.** The registry is 26 providers: 2 available, 1 partial, 2 scaffolded, 22 planned. Minimum POS surface area to close the first 20 customers is zero. |
| **Track A** | Delete the module | **Secure it and make it real** | Owner's call. Done — see below. |
| **Pricing** | $150–250/mo or contingency | **$20–50/mo tiered** | Owner's call. Note the constraint it imposes: at $30/mo there is no budget for a human implementation step, so onboarding must be genuinely zero-touch. That rules out the bookkeeper and multi-unit channels both reviewers favoured. This is a self-serve bet, not a sales bet. |

**Three defects that make the current match engine unable to do its job** —
all verified, all more serious than the typing friction this plan originally
identified:

1. **The match never moves COGS.** `effectiveUnitCost` (the smartest output in
   `invoice-match.ts`) is computed, displayed, and discarded.
   `applyReceiptAdjustment` (`procurement.service.ts:1096`) passes no
   `p_unit_cost`; `markDelivered:991` stocks the lot at `final_price ??
   suggested_price` — what we *hoped* it would cost. The vendor bills $24 for a
   $22 wine, the app shows a red badge, and inventory valuation, WAC, pour cost
   and COGS all still say $22. `landedCost()` — the correct formula — exists at
   `analytics/engine/finance.ts:277` with **zero callers**.
2. **Silence is recorded as agreement.** `:1183` — `invoiceQty:
   body.invoiceQuantity ?? stockedQty`. An unstated invoice is inferred from the
   PO, so `physical_vs_bill` compares a number to itself, and `price_verified:
   true` is written for a delivery where no human ever looked at a document.
   That is a manufactured audit assertion in a column a customer will rely on in
   a vendor dispute.
3. **Agreed deals fire critical alerts.** `invoice-match.spec.ts:168` asserts
   `verdict: "qty_over"` on a legitimate 11-for-10. There is no unit-of-measure
   concept, so a split case (order 2 cases, invoiced 24 bottles, counted 2
   cases) reads as `qty_over` by 22. `bottles_per_case` already exists in the
   codebase and was never plumbed to the match. Two weeks of this and the
   manager stops reading notifications — the most common way ops software dies.

**One competitor neither planning document mentioned:** [Fintech](https://fintech.com)
— TA Associates / General Atlantic backed, **240,000+ alcohol-licensed
establishments, $42B/yr in alcohol purchases**, receiving invoice data
*electronically from distributors* rather than from photographs. Beverage-alcohol
invoice automation already has a well-capitalised incumbent.

**The unmeasured assumption both reviewers independently flagged:** nobody has
checked how often beverage invoices are actually wrong, or by how much. At ~4%
of invoices and a $35 average error there is no company at any price. At ~15%
and $180 the whole thing works. It is two weeks with a spreadsheet and it
governs everything else. Owner has a few real invoices, not 100 — so this is
partially answerable now and should be finished before Track D.

---

## 0. What changed

The previous review concluded "no usage to optimise." That was measured correctly and interpreted
too harshly. The tables are empty because the live feed was never switched on, not because the
product failed in market. Nobody churned. There is no negative signal — there is *no* signal.

That distinction matters for **sequencing**, not for the verdict:

- Still true: you cannot personalise layout for users who do not exist, and at n=1 restaurant you
  cannot measure whether a layout change helped (§statistics, prior doc).
- Now true: the question is not "should the agent reshape the page" but **"what makes the first ten
  restaurants sign, and what do we have that nobody else has?"**

Answering that honestly meant reading the procurement code instead of the UX code. The finding:

> **The strongest asset in this repo is `invoice-match.ts`, and the UI in front of it asks a person
> standing on a loading dock to type numbers into a form.**

---

## 1. The wedge you already built

`apps/api-gateway/src/procurement/invoice-match.ts` (256 lines, pure, unit-tested, backend-authoritative)
implements a real three-way match: **ordered (PO) vs invoiced (vendor) vs received (physical count)**.

It is good. Specifically, this reasoning from its own header is the kind of thing that reads as
founder domain insight rather than generic CRUD:

> "vendor sent 24, 2 arrived broken" and "only 22 ever left the warehouse" are different failures
> with different remedies. Comparing accepted-vs-invoice would collapse them into one number.

That is not something a generic inventory tool gets right. It produces seven distinct verdicts
(`matched`, `price_variance`, `qty_over`, `qty_short`, `rejected`, `partial`, `unmatched`), a
`creditDue` flag, a `backorderQty`, and `effectiveUnitCost` that correctly handles free goods
("11 for the price of 10" → $20/btl, not $22). Each verdict maps to a different **dollar recovery
action** against a vendor.

**This is the YC-legible product.** "We catch what your distributor overbilled you" is a sentence a
restaurant owner finishes for you. "Our interface adapts to your role" is not.

### Why it isn't working

`apps/web/src/pages/inventory/command/ReceivingWorkspace.tsx`

```
:233   <input ... value={invoiceQty}        onChange={... setInvoiceQty(...)} />
:265   <input ... value={invoiceUnitPrice}  onChange={... setInvoiceUnitPrice(...)} />
```

The invoice half of the three-way match is **typed in by hand, per line item**. The person doing it
is holding a hand truck at 7am. Fourteen line items is a five-minute form. It will not happen, so
the match runs with `invoiceQty` defaulted to `stockedQty` — which makes `physical_vs_bill` compare
a number to itself and pass trivially. **The engine's headline check is structurally unable to fire.**

This is precisely the friction MarginEdge built a company on removing. The wedge is not the match
engine — everyone can write that. The wedge is that **the invoice gets into the system without
anyone typing.**

### Second ghost feature

`apps/web/src/components/inventory/InvoiceScannerModal.tsx` — 487 lines, mounted in the *legacy*
`Inventory.tsx`, uploads to `POST /invoices/scan`.

There is no `invoices` controller in `apps/api-gateway/src`. **That endpoint 404s.** Same failure
mode as ux-optimizer: polished UI, backend never built. It also writes straight to inventory
(`/invoices/:id/add-to-inventory`), bypassing the match engine entirely — so even if it worked it
would be the wrong shape.

### The capability is already in the repo

`apps/api-gateway/src/menus/parsers/scan-parser.service.ts` already does Claude vision extraction
(`claude-haiku-4-5`, base64 image, media-type sniffing, structured item output) for wine lists. The
invoice extractor is a **variant of code you have already shipped**, not new capability.

---

## 2. Plan

Four tracks. A and B run in parallel from day one; A is small and unblocks nothing, but leaving it
open is not defensible.

### Track A — Security (parallel, ~1 day)

Not negotiable and not sequenced behind anything. Re-confirmed today:

| # | Defect | Fix |
|---|---|---|
| A1 | `ux-optimizer.controller.ts` has **0** `@UseGuards`; global `TenantGuard` returns `true` for unauthenticated requests by design. Every `/ux/*` route is internet-reachable, including `POST /ux/proposals/:id/review`. | Delete the module, or add `@UseGuards(JwtAuthGuard)` at class level and take `reviewedBy` from `@CurrentUser()`, never the body. |
| A2 | `ux-optimizer.service.ts:501` — `o.restaurant_id == null || !restaurantId ||` leaks every tenant's overrides when the param is absent. | Require `restaurantId`; drop the `!restaurantId` clause. |
| A3 | `POST /ux/signals` — public, unvalidated `jsonb` insert, no retention. | DTO + validation pipe, or delete with the module. |
| A4 | `AUTO_APPLY` appears twice in the file: its own declaration and a doc comment. It gates nothing. | Delete it (misleading), or wire it to the actual apply path. |
| A5 | `evaluateOverride` (`:580`) has no caller anywhere. Auto-revert-on-regression has never run. | Delete with the module. |
| A6 | `elementKey()` returns `#${el.id}` before checking `data-ux-key` — leaks DOM ids into a public table. | Reorder, or delete. |

**Recommendation: delete the module.** Every fix above is "make the dead feature safely dead."
`git revert` is cheaper than six patches, the design doc survives in `.planning/`, and §5 below
gives you the useful half back without the machinery.

---

### Track B — Invoice capture → three-way match (the wedge, ~2 weeks)

**B1. `POST /procurement/invoices/extract`** — new, guarded, mirrors `scan-parser.service.ts`.

- Input: image or PDF, plus optional `orderId`.
- Model: `claude-haiku-4-5` vision (same as the menu parser).
- Output: `{ vendorName, invoiceNumber, invoiceDate, lines: [{ description, qty, unitPrice, lineTotal }], subtotal, total, confidence }`.
- **Extraction is a proposal, never a write.** It returns JSON to the client. It does not touch
  inventory, orders, or the ledger. (This is exactly what `InvoiceScannerModal` got wrong.)
- Arithmetic self-check: if `Σ lineTotal ≠ subtotal`, mark the invoice `needs_review` and say so.
  A model that hallucinated a quantity usually breaks the arithmetic — cheap, deterministic
  detection that costs nothing and catches the failure mode that matters.

**B2. Line matching** — map extracted lines onto PO lines.

Ranked, not fuzzy-guessed: exact vendor SKU → normalised description trigram → qty+price
proximity. Anything below threshold surfaces as an unmatched line the receiver assigns with one
tap. **Never auto-assign a low-confidence line** — a wrong assignment silently corrupts cost basis
in a way nobody notices for months.

**B3. Wire into `ReceivingWorkspace`** — the actual UX change.

Today: two empty inputs.
After: `[📷 Photograph invoice]` → the invoice column arrives pre-filled per line, each field
showing its extracted value with a confidence tint, editable, with a "typed over" flag recorded.

The physical count stays manual — **that is the point of the product** and must never be
pre-filled from the invoice. Pre-filling the count would make `physical_vs_bill` self-comparing
again, which is the exact bug we are fixing.

**B4. Persist the artifact.** `procurement_invoices` (id, order_id, restaurant_id, storage path,
extracted json, extraction model+version, confidence, `verified_by`, `verified_at`) plus
`procurement_invoice_lines`. Store the **original file** — a disputed credit needs the document,
not a JSON summary. Keep every human correction: that is your future eval set.

**B5. `creditDue` becomes an action, not a boolean.** When the match returns `creditDue`, generate
a drafted vendor email citing invoice number, line, billed vs received, and dollar amount — into
the existing draft/approve flow (`orders/:id/approve-draft`), which is already built and guarded.
**One tap to send, never auto-send.** This closes the loop: photo → discrepancy → money back.

---

### Track C — Mimic the live feed (~3 days)

You do not need Toast credentials. `pos-hub.controller.ts:44` already exposes:

```
POST /pos-hub/webhook/generic_webhook/:restaurantId
```

described in its own docs as the way to "bridge any POS today," idempotent on external check id.

**Build a simulator that posts through this endpoint** — not one that seeds tables directly.

```
scripts/simulate_service.py --restaurant <id> --days 60 --covers-per-night 80
```

- Generates plausible checks: service-time distribution (two dinner peaks), weekday/weekend
  amplitude, wine-by-the-glass vs bottle mix, a couple of items that sell out, gradual seasonal drift.
- Posts them at the real endpoint, in date order, respecting idempotency.
- Also drives Track B: generate matching vendor invoices as **rendered PDFs/images** — including
  the failure cases (short ship, price creep, damaged units, free goods) — so the extractor is
  exercised on documents, not on JSON you already know the answer to.

**Why through the webhook and not `INSERT`:** seeding tables tests nothing. Posting through the
production ingress exercises normalisation, mapping, `pos_checks` upsert, and everything
downstream — analytics → insights → recommendations → low-stock notifications — via the same code
path a real POS would. If the simulator works, the Toast integration is a credentials problem
rather than an architecture problem.

**The hard limit, stated plainly:** simulated data validates *plumbing*, never *product*. It proves
the pipeline does not crash and the demo does not stall. It cannot tell you whether an insight is
worth reading. Treating simulator output as validation is how you end up with 573 insight types
nobody asked for. **Nothing in Track C is evidence for any product decision.**

---

### Track D — The role edge (~1 week, after B)

This is the part of "agent-native" that survives, in a form you can actually ship and test.

Not: *an agent reshapes the page from behavioural telemetry.*
Instead: **one event, three deterministic renderings, chosen by role.**

The event is a `MatchResult`. It already exists, already carries everything needed.

| Role | Surface | Content | Explicitly not shown |
|---|---|---|---|
| **Staff** (receiving) | One full-screen count view, thumb-sized targets, works one-handed | Item, expected qty, `[✓ all here]` / `[⚠ something's off]`. Nothing else. | **All prices.** Line cost is not floor-staff information, and hiding it removes the single biggest source of hesitation at the door. |
| **Manager** | Discrepancy queue | Only `isDiscrepancy(verdict) === true`, sorted by dollars at risk. Each row: what happened, what it costs, one action (`accept` / `override+reason` / `request credit`). | Matched deliveries. If it matched, it is not a task. |
| **Owner** | One card | "$X recovered this month / $Y outstanding with vendors / worst offender: Z." | Everything operational. |

Properties worth naming: it is deterministic (same role → same layout, always), it survives staff
turnover and oral training ("hit the green button"), it needs no telemetry, no experiment, no
holdout, and it is unit-testable. It delivers the *outcome* the agent-native pitch promised —
"each user gets a different experience based on role" — with none of the machinery that cannot be
validated at this scale.

**Ship the staff view as a mobile web page first.** Receiving happens at a door, not a desk.

---

## 3. YC framing

**The sentence:** "Restaurants get overbilled by their distributors and never catch it. We catch it
from a photo of the invoice."

**The metric — dollars recovered.** Not DAU, not sessions, not insights generated. Instrument it
from day one: every `creditDue` verdict logs an amount; every sent credit request logs an outcome.
The number you want on a slide is *"$X recovered across N restaurants last month"* — YC-legible,
customer-legible, and unfakeable.

**What to demo:** photograph a real invoice with a real error → the discrepancy appears with a
dollar figure → one tap drafts the vendor email. Sixty seconds. No dashboard tour.

**The critical part.** This repo's biggest risk is not missing features, it is surface area. There
is a sommelier AI, a calendar, promotions, 573 insight types, an 860-path UX catalogue, a UX
optimizer, a wine library. A YC partner reads that as *no wedge*. None of it needs deleting — but
**one thing has to be the headline**, and the rest becomes "and it also does X." Pick the invoice.

**Honest competitive read:** MarginEdge already owns invoice capture and is well funded. Your
defensible angle is *not* "we scan invoices too" — it is the pairing of scanning with a match
engine that keeps short-ship separate from damage and knows what a credit is worth, on
**beverage** specifically, where line-item vintage/format variance breaks generic food-cost tools.
That narrowness is an advantage in a YC conversation, not a weakness. Do not sand it off.

---

## 4. Sequence

| Track | Deliverable | Status |
|---|---|---|
| **A** | ux-optimizer secured *and* made genuinely live. Guarded, tenant-scoped, validated, mounted, tagged, evaluated nightly. Human approval still required for every override. | ✅ |
| **B0** | Documents as first-class objects with headers that tie out, plus lines. Originals stored. Adopted the pre-existing `procurement_order_items` rather than duplicating it. | ✅ |
| **B0a** | Four-way match — ordered / shipped / received / billed. `overbilled_vs_ship` outranks everything but a missing invoice. | ✅ |
| **B0b** | Cost-basis loop closed — verified landed cost writes back to the lot; no invoice means `unmatched`, never an inferred agreement. | ✅ |
| **B0c** | UOM normalization + free goods, so split cases and agreed deals stop alarming. | ✅ |
| **B1** | Extraction — proposal only, arithmetic self-check, never writes. Four intake channels into one model. | ✅ |
| **B1a** | X12 810 / 856 / 812 parsers. No VAN. | ✅ |
| **B2** | Ranked line matching with substitution detection; never auto-assigns a doubtful line. | ✅ |
| **B3** | Two-stage receiving — door (photo + case count, <30s, one hand, offline) then bench. | ✅ |
| **B4** | Vendor credit ledger with real state and aging. Claimed is not recovered. | ✅ |
| ~~C~~ | ~~POS simulator + adapters~~ | **cut** |
| **D** | Three role views: staff / manager / owner. | ✅ |

**Everything above is connected**, which was not automatic — three modules were
built with no callers and had to be wired afterwards. The lesson is recorded
because it recurred: a module with tests and no caller looks finished and is not,
and this repo already had four such features before this work started
(ux-optimizer, `InvoiceScannerModal`, `landedCost`, `invoice_scans`).

**Still not done, and deliberately so:** the operator's higher-value metrics —
cost drift caught, straight-through rate, days-to-close — are computable from
what now exists but are not built. They are worth more than dollars-recovered and
should come next. `procurement_order_items` line matching is wired but no screen
yet shows the *suggestions* for one-tap confirmation; they are returned by
`POST /procurement/documents/:id/match` and nothing renders them.

**Gate before Track D:** at least one of the owner's real invoices extracted and matched
end-to-end without hand-editing more than two fields. If that gate fails, the extractor is not
ready and role views are decoration.

**Metric correction.** "Dollars recovered" is half vanity and half unverifiable. A $1.2M bistro
buys $45–60k/month of beverage; genuinely recoverable billing error is ~0.3–1.5%, so $150–800/month
— real, but it does not carry the pitch alone, and until a credit memo lands on a later invoice all
you have is *"we asked."* Lead instead with **cost drift caught** ("landed cost moved on 34 SKUs;
1.8 points of beverage margin, concentrated in these six wines") — verifiable, monthly, and
structurally bigger, because silent price creep across 400 SKUs is where wine-program margin
actually leaks. Count only credits watched landing, and say so on the surface.

---

## 5. What happens to the agent-native idea

Not dead — deferred, with an earned trigger and a cheaper first step.

**Now:** the `MatchResult` → role rendering in Track D *is* content adaptation. It is just
deterministic rather than learned. Ship that and you have the user-visible half of the pitch.

**Later, once real usage exists** (≥ 10 paying locations, ≥ 90 days of receiving history), the
useful version is not per-user layout mutation. It is: **the agent reads aggregate friction and
tells you what to redesign for everyone**, and a human ships the change as a commit. Same
observation loop, same LLM analysis, output is a pull request rather than a runtime override.
Reviewable, revertable, works at n=10, and needs none of the seven kill switches.

Framing rules from the prior doc still hold: **the artifact should be a commit, not a database row**,
and **personalise content, never layout**. Track D obeys both.

---

## 6. Verified sources

- `apps/api-gateway/src/procurement/invoice-match.ts` — read in full; engine is sound and tested.
- `apps/web/src/pages/inventory/command/ReceivingWorkspace.tsx:233,265` — invoice qty and unit price are manual `<input>`s; `:92` defaults `invoiceQty` to `stockedQty`.
- `apps/web/src/components/inventory/InvoiceScannerModal.tsx:88,126` — posts to `/invoices/scan`; no `invoices` controller exists in `apps/api-gateway/src`.
- `apps/api-gateway/src/menus/parsers/scan-parser.service.ts:43–65` — existing Claude vision extraction pattern.
- `apps/api-gateway/src/pos-hub/pos-hub.controller.ts:18,44` — `generic_webhook` ingress, idempotent, documented as the bridge for any POS.
- `apps/api-gateway/src/procurement/procurement.controller.ts:33` — class-level `@UseGuards(JwtAuthGuard)`; procurement is correctly protected.
- `apps/api-gateway/src/ux-optimizer/` — 0 `@UseGuards`; `:501` tenant leak; `AUTO_APPLY` 2 refs (declaration + comment); `evaluateOverride:580` 0 callers. All re-confirmed 2026-07-27.
