---
type: page
route: /receipts
slug: receipts
component: apps/web/src/pages/ReceiptsPage.tsx
audience: owner
tier: core
signals_today: none
rebrand_strings: 0
maturity: partial
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]"]
---

# /receipts — Receipts & Credits

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

## 2. Entry

- Sidebar "Receipts & Credits" (`components/layout/Sidebar.tsx:132`).
- `/credits` redirects to `/receipts?tab=credits` (`apps/web/src/App.tsx:282`);
  the tab param is read at `ReceiptsPage.tsx:59-60`.
- [PAGE_MAP](../foundation/PAGE_MAP.md):121 lists it as a no-inbound entry point —
  that scan covered page sources only and missed the sidebar link; the redirect and
  sidebar are the real entries.

## 3. Files

- Route binding: `apps/web/src/App.tsx:281` (lazy import :97).
- `apps/web/src/pages/ReceiptsPage.tsx` (482 lines) — single file; lanes, credit
  table and detail pane are internal components.
- Services: `services/api/documents.ts` (incl. `dashNull`, the E49 em-dash helper,
  documents.ts:62-66), `services/api/credits.ts`.

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

- Line-match **suggestions** from `POST /procurement/documents/:id/match` have no UI
  rendering them — deferred by design (`v3.0-TECH-DEBT.md:447`).
- Cost-drift-caught / straight-through-rate / days-to-close metrics are decided-not-
  built (`v3.0-TECH-DEBT.md:446`) — this page is where they would land.

## 10. Maturity

**partial.** The most honestly-built page in this cluster, and the only one whose
producer chain is verified live end to end. What is absent is named, not faked.

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
| Same, via the provider-agnostic webhook | `POST /webhooks/inbound-email` (`inbound-email.controller.ts:92`) | **Dormant** — `INBOUND_EMAIL_DOMAIN` unset (`inbound-email.controller.ts:61-65`). The Gmail path covers it today; this is the multi-tenant replacement |
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
