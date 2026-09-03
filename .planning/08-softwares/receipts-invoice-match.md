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

The two pages share a software because they are one filing cabinet: vendor paper on one
screen, house reports on the other, and the redesigned `/documents-reports` explicitly
routes its "vendor paper" register into `/receipts` ([[documents-reports]] §1a).

## §3 Backend

`apps/api-gateway/src/procurement/documents/` — **10 endpoints** across two controllers,
both `@UseGuards(JwtAuthGuard)` at class level.

| Endpoint | Line |
|---|---|
| `@Controller("procurement/documents")` | `documents.controller.ts:47` (guard `:46`) |
| `POST /procurement/documents` | `:54` |
| `GET /procurement/documents` | `:99` |
| `GET /procurement/documents/:id` | `:156` |
| `POST /procurement/documents/:id/match` | `:209` |
| `POST /procurement/documents/:id/lines/:lineId/link` | `:226` |
| `PATCH /procurement/documents/:id/lines/:lineId` | `:259` |
| `POST /procurement/documents/:id/verify` | `:306` |
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

