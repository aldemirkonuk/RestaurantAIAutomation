---
type: software
slug: receipts-invoice-match
name: Receipts & Invoice Match
division: restaurant
status: partial
tier: core
routes: ["/receipts", "/receipts?tab=credits", "/documents-reports"]
pages: [receipts, documents-reports]
api_modules: [procurement]
agents: [email_parsing_agent]
owner_unit: procurement-vendor-network
updated: 2026-09-01
links: ["[[receipts]]", "[[documents-reports]]", "[[orders]]", "[[receiving]]", "[[inventory-command]]", "[[procurement-vendor-network-charter]]", "[[SOFTWARE-MAP]]"]
---

# Receipts & Invoice Match

## §0 What it is

The paperwork half of buying. A vendor emails an invoice; it arrives here on its own,
already read, with its lines pulled out and the scanned page sitting next to them so you can
check the machine's reading against the paper. If what they billed does not match what you
ordered or what actually turned up, that gap becomes a credit claim you can chase. Nothing
is ever marked verified on a guess — a value the system could not read shows as a dash, not
a pass. Alongside it sits the report archive: the place generated reports are supposed to be
filed and read.

## §1 Features today

- Documents tab in two lanes: needs review / verified
- Open a document and see its stored image beside the extracted lines, side by side
- Unknown values render "—", never as a pass
- Verify a document
- Credits tab: the vendor credit-claim ledger with stats; move a claim through its states
- Deep-linkable tab (`?tab=credits` — where `/credits` redirects, `App.tsx:314`)
- The report archive: open a report, copy a share deep link, delete; `?doc=` share links
- Conversation history tab (the same component as `/communications`)
- Line-match **suggestions** — the endpoint exists, the legacy page has no UI for it;
  deferred by design (`v3.0-TECH-DEBT.md:447`)
- Sending a credit claim — **dark**: the `→ requested` transition stamps
  `requested_at`/`requested_by` and returns. No email, no notification, no queue
  (`credits.controller.ts:218-221`)
- Settling a claim asks the operator to **type a UUID** into a `window.prompt`
  (`ReceiptsPage.tsx:129-137`), for a document this same page already lists
- Opening any archived report — **broken**: no report in the system has a file (§7)
- Mudavym redesigns built behind `mudavym_design_receipts` and
  `mudavym_design_documents_reports`, both flags **OFF**

## §2 Screens

- [[receipts]] — the primary surface. `/receipts` behind `PageGate` (`App.tsx:313`),
  `legacy={<ReceiptsPage />}`, `next={<ReceiptsNext />}`. `/credits` is a `Navigate` to
  `/receipts?tab=credits` (`:314`).
- [[documents-reports]] — the report archive and conversation history. `/documents-reports`
  behind `PageGate` (`App.tsx:312`), `legacy={<DocumentsPage />}`,
  `next={<DocumentsReportsNext />}`.

- **`/documents/:id`** — the canonical Mudavym document (ADR 0104 D12 slice 2), behind
  `PageGate page="document"` with `legacy={<Navigate to="/receipts" />}`: not a third
  page but `/receipts`'s second face, so a tenant with the gate off is sent back to the
  list rather than shown a parallel legacy build. Sections in
  `apps/web/src/components/documents/`; `OriginalPane` re-exports `ReceiptsNext`'s own
  `PaperPane`, which is what keeps the two faces from drifting into two viewers.

The two pages share a software because they are one filing cabinet: vendor paper on one
screen, house reports on the other, and the redesigned `/documents-reports` explicitly
routes its "vendor paper" register into `/receipts` ([[documents-reports]] §1a). The
canonical view is the third face of the same cabinet: the same document, opened.

## §3 Backend

`apps/api-gateway/src/procurement/documents/` — **13 endpoints** across three
controllers, all `@UseGuards(JwtAuthGuard)` at class level.

| Endpoint | Line |
|---|---|
| `@Controller("procurement/documents")` | `documents.controller.ts:47` (guard `:46`) |
| `POST /procurement/documents` | `:54` |
| `GET /procurement/documents` | `:99` |
| `GET /procurement/documents/:id` | `:303` |
| `GET /procurement/documents/:id/canonical` | `:94` — ADR 0104 slice 2. The three-layer canonical object, the delivery spine, the siblings on those deliveries, and a one-hour signed link to the original. READ-ONLY. A read that failed comes back in `failedRead` with the field NULL, never as `[]`. |
| `GET /procurement/deliveries/:id` | `deliveries.controller.ts:34` (guard `:28`) — the delivery and every document on it |
| `POST /procurement/documents/:id/match` | `:209` |
| `POST /procurement/documents/:id/lines/:lineId/link` | `:226` |
| `PATCH /procurement/documents/:id/lines/:lineId` | `:259` |
| `POST /procurement/documents/:id/verify` | `:306` |
| `POST /procurement/documents/:id/extraction` | `:351` — the extraction door. Applies an extraction produced OUTSIDE this gateway (a Claude Code session reading the PDF) to a document ADR 0104 D6 stored UNREAD, through the same `normalize` a model's answer goes through (`document-intake.service.ts:682`). 409 if the document already has lines or a non-degraded extraction — it fills, it never overwrites; 422 if the body is not the contract's JSON or carries no lines. The gateway's own extractor remains the product path. |
| `@Controller("procurement/credits")` | `credits.controller.ts:90` (guard `:89`) |
| `GET /procurement/credits` | `:94` |
| `GET /procurement/credits/stats` | `:123` |
| `POST /procurement/credits/:id/transition` | `:164` |

The match engine is `procurement/invoice-match.ts` (420 LOC) — it calls itself *"single
source of truth for the match verdict (backend authority)"* (`:2`). Consumed by
`procurement.service.ts:33,1243` and `documents/credit-ledger.ts:1`. The verdict is computed
server-side: *"the client never dictates the outcome"* (`procurement.service.ts:1189`).

**Shared-module seam:** these 10 endpoints sit in the same `procurement` module as
[[orders]] (26), [[receiving]] (3) and [[recurring-orders]] (6). `GET
/procurement/credits/stats` is also [[receiving]]'s owner view.

**The canonical module (ADR 0104 slice 1, 2026-09-03).**
`apps/api-gateway/src/procurement/canonical/` — **no endpoint, no route, and not yet
registered as a Nest provider.** Slice 1 exposes nothing to the SPA by design; slice 2's
template is what wires it in.

| File | What it is |
|---|---|
| `canonical/canonical-types.ts:1` | Three layers in one object; every layer-1 field a `FieldEnvelope` carrying value, source, confidence, page/bbox and `as_printed`. Field names are EN 16931 BT/BG ids. |
| `canonical/canonical-invariants.ts:1` | 16 invariants (`INVARIANTS`, `:955`). Each returns `{ id, rule, path, holds, expected, found, explanation }`; `holds` is TRI-STATE — `null` means "ran, nothing to test", counted separately by `summarise` (`:987`) so untestable never inflates a pass rate. |
| `canonical/from-parsed-document.ts:1` | `ParsedDocument → CanonicalDocument`. Pure; `ParsedDocument` is not modified. Leaves the VAT breakdown empty rather than inventing a row that would pass. |
| `canonical/canonical-document.service.ts:1` | `buildFromDocumentId` (`:117`) and `persistRevision` (`:204`, INSERT-only). Rebuilds from the COLUMNS, not from `procurement_documents.extracted`, because `editLine` never rewrites that snapshot. Every read checks `error` before `data` (ADR 0067). |
| `canonical/cli.ts:1` | stdin → invariants → JSON, so `scripts/canonical_corpus_run.py` grades the product's own code rather than a second implementation. |
| `canonical/__fixtures__/synthetic-documents.ts:1` | 9 documents, every one labelled SYNTHETIC. They are the invariants' only proof today — see §5. |

Two rules from ADR 0103 are enforced here rather than described: `received` is
`"not_counted"` unless a door count exists (A6), and BT-149 is **not** `packSize` —
`ParsedDocument` prices per invoiced unit, so the real `1 cs × 12 şişe` price base cannot
survive a round trip through it. That gap is named in
`from-parsed-document.ts` rather than papered over.

## §4 Automation

- `email_parsing_agent.py` (863 LOC) — tier **CORE**, depends on `procurement_agent`
  (`core/agent_registry.py:119-121`), *"Inbound vendor email threading and conversation
  storage"*. Real, not a stub.
- A **`@Cron("*/5 * * * *")` sweep** in `documents/document-intake.service.ts:581-645`
  downloads new attachments, filters non-documents, and ingests each under its own
  correlation id. Content-addressed by `sha256`, so re-running is a no-op (`:608-618`).

This is the one software in this cluster whose producer chain is verified live end to end
([[receipts]] §10): vendor emails an invoice → Gmail push webhook
(`communications/communications.controller.ts:1030-1180`) publishes
`email.inbound.received` → `RabbitMqBridgeService.handleInboundEmail` stores the message and
`persistAttachments` writes the file to the `vendor-attachments` bucket plus a
`conversation_attachments` row (`common/orchestrator/rabbitmq-bridge.service.ts:845-897`) →
the cron sweep ingests it. Credit claims are opened automatically from an invoice mismatch by
`openCreditClaim` (`procurement.service.ts:1104-1132`).

## §5 Data

From the `documents/` services, all verified in
`supabase/migrations/20260805000000_baseline_from_production.sql`:

- **Owned:** `procurement_documents`, `procurement_document_lines`,
  `procurement_document_links`, `procurement_credits`.
- **Read, owned elsewhere:** `procurement_orders`, `procurement_order_items` ([[orders]]),
  `conversation_attachments`.
- `generated_reports` backs [[documents-reports]] — and holds **0 rows in production**
  ([[documents-reports]] §10).

**New with ADR 0104 slice 1** —
`supabase/migrations/20260903160000_canonical_document_and_delivery.sql`, additive, nothing
dropped, RLS enabled with a `service_role` policy on all six:

| Table | Line | What it holds |
|---|---|---|
| `deliveries` | `:68` | The commercial event (ADR 0103 D1 / 0104 D7): 12 states, `provenance ∈ {ORDERED, UNORDERED}`, owner + deputy (D9), `dedupe_key` unique **per restaurant** (S2). `PAID` is deliberately not a state — A3 puts payment on the invoice. |
| `document_deliveries` | `:161` | The many-to-many join (S5 / A2). N documents per delivery **and** N deliveries per document. |
| `delivery_proposals` | `:202` | Every recorded position, with a D7 reason class. Replaces `syncOrderState`'s silent drop of a contradicting vendor reply (A5). |
| `vendor_terms` | `:274` | Clocks as data (D4/A8). **A missing row means UNKNOWN and must BLOCK** — never "no deadline". |
| `document_revisions` | `:402` | Layer 1 as one JSONB document per revision (S1). APPEND-ONLY by trigger. |
| `document_corrections` | `:453` | Who corrected what, and what was there before (D5). Same trigger. |

`procurement_documents` gains `direction`, `jurisdiction`, `retain_until`, `legal_hold`,
`paid_at`, `paid_by`, `intake_verdict`, `intake_reason` (`:497`), and its `doc_type` CHECK is
**widened** to 12 literals (`:566`) — mirrored in `documents/document-types.ts:22`.
`inventory_transactions.delivery_id` and `inventory_lots.cost_state` are added as
**columns only** (`:586`, `:603`); nothing in slice 1 writes them and no stock path is touched.

**Only two `vendor_terms` rows are seeded** (`:363`, `:379`): US-CA alcohol invoice payment
30 days from delivery, wholesaler-initiated EFT; TR invoice objection window 8 days from
issue. The Turkish e-İrsaliye response window is deliberately ABSENT — ADR 0103 A8 holds it
open for a YMM, and a 7-day row seeded now would be a legal deadline invented by an agent.

**The corpus is empty.** Measured read-only 2026-09-03: `procurement_documents` 0 rows,
`procurement_document_lines` 0 rows, the `vendor-attachments` bucket 0 objects. The product
has never held a vendor document in this database, so ADR 0104 D12's "run as a test suite
over the documents already in `vendor-attachments`" had nothing to run over.
`datasets/canonical/CORPUS-RUN-2026-09-03.md:3` leads with that absence rather than with "0
failures"; the invariants' evidence is the 9 synthetic fixtures, and
`scripts/canonical_corpus_run.py --self-test` proves the runner can still name a failure.

## §6 Owner

[[procurement-vendor-network-charter]] — team `procurement-vendor-network`, department
`engineering`, division Platform. The charter names credits in its mandate — *"Own the money
path outward: orders, RFQs, receiving, credits, recurring orders, vendor…"*
(`procurement-vendor-network-charter.md:20`) — and books both controllers in its
owned-outright table: `procurement/documents` at **6** and `procurement/documents/credits`
at **3** (`:31-32`).

⚠️ Minor drift: the charter's `procurement/documents` count of 6 is one short of the **7**
on the current tree (§3) — `PATCH /:id/lines/:lineId` at `documents.controller.ts:259` was
added for the `mudavym_design_receipts` in-place line edit ([[receipts]] §1a) and has not
been folded into the charter's table.

The team's primary metric — `procurement.order_to_delivery_reconciliation_rate`, ordered
lines resolving to a received lot at the agreed price **without human repair** (`:68-72`) —
is measured almost entirely by this software.

## §7 Maturity & seams

**partial** overall, and the two halves differ sharply — this is the one software in the
cluster where the rollup hides something, so both are stated:

**[[receipts]] is `partial`** and is described in its own note as *"the most honestly-built
page in this cluster, and the only one whose producer chain is verified live end to end.
What is absent is named, not faked."*

**[[documents-reports]] is `hollow`** — *"a document archive in which no document has a
file."* Every row comes from `generated_reports`; the only writer inserts `status:"pending"`
with `pdf_url`/`excel_url`/`csv_url` NULL (`reports/reports.service.ts:42-71`), and nothing
in the repo ever completes a row. Re-verified whole-repo 2026-08-26 under **OD-81**: no
`UPDATE` on `generated_reports` exists anywhere. Production holds 0 rows. The dead controls
were made honest under OD-81 — View/Download/Print are now disabled with the reason, computed
per row from `reportFileUnavailableReason(report)`, so they re-enable themselves the day a
generator fills `pdf_url`.

Seams:
1. **Invoice-match logic is duplicated across runtimes, and has drifted.**
   `apps/api-gateway/src/procurement/invoice-match.ts` (420 LOC) and
   `apps/mobile/src/lib/invoiceMatch.ts` (152 LOC) both export `computeMatch`, `MatchVerdict`,
   `MatchInput`, `MatchResult`. The fork is *deliberate and documented* — the mobile file
   names the gateway as authoritative at `:4` — but it is **out of sync**: the gateway
   declares **9** verdicts (`:42-51`), mobile **7** (`:34-41`), missing
   `overbilled_vs_ship` and `short_shipped`. Mobile also has no `MatchCheck`/`MatchCheckId`
   breakdown at all. A mobile preview can therefore show a verdict the server would not.
2. **Credits are opened but never sent** (§1) — the TIER-MAP S03 "opened-never-sent" row,
   confirmed in code.
3. **No error state on either query.** `listQuery.isError` / `creditsQuery.isError` are
   never branched (`ReceiptsPage.tsx:210-214, :427-429`) — a 500 renders "No documents in
   this lane." The same failure mode [[receiving]] fixed.
4. **No way out of [[receipts]].** `useSearchParams` is used for the tab only
   (`:59-63`); there is no `navigate`, no `Link`, no route to the order a document bills.
5. **A fabricated badge on [[documents-reports]]**: the Communication-History count is fed
   by `commStats`, which hardcodes `emailCount: 0, smsCount: 0` and renders
   `commStats.total` — the count of **reports**, not messages (`:234-236`, rendered `:467`).
6. **Copy-link produces a link the legacy page never reads** — `?doc=` has no handler in
   `DocumentsPage.tsx`; still an open defect after OD-81.
7. **One module, four softwares** (§3).

## §8 Where it's going

> **Decided 2026-09-03:** every incoming document renders as one canonical Mudavym document — one schema (EXTRACTED / RESOLVED / ADJUDICATED, per-field provenance with `as_printed`), one template with conditional sections, the original content-addressed and fetched on demand, verdict first, confidence never a number, intake gate for blank/duplicate/bundled uploads — [ADR 0104](../decisions/0104-every-incoming-document-renders-as-one-canonical-mudavym-document.md); the flow it records is [ADR 0103](../decisions/0103-a-delivery-is-agreed-before-it-is-verified.md). Sketches: `sketches/089-agreed-invoice-directions`.

- [ADR 0049](../decisions/0049-ecosystem-division-layer.md) §3a: **Restaurant** division,
  phases **E1** and **E4**. [[ECOSYSTEM-PLAN]] §2 records this end as already SOTA —
  *"receiving→four-way-match→credit→landed-cost"* — with the failure being that the middle
  does not auto-close.
- **OD-81** is the live thread on [[documents-reports]]: the honest-disable shipped; a
  *generator* that actually fills `pdf_url` has not, and no OD row schedules one.
- Cost-drift-caught / straight-through-rate / days-to-close metrics are **decided-not-built**
  (`v3.0-TECH-DEBT.md:446`); [[receipts]] is where they land.
- A native credits lane for `ReceiptsNext` is a later pass — with the flag on,
  `?tab=credits` still renders the legacy page ([[receipts]] §9).
- **Reconciling the two `computeMatch` copies is unscheduled** — no OD row, no agenda item,
  despite the drift in §7.1.

