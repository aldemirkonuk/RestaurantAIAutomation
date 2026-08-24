---
type: page
route: /receipts
slug: receipts
component: apps/web/src/pages/ReceiptsPage.tsx
audience: owner
tier: core
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-24
links: ["[[PAGE-CONTRACT]]"]
---

# /receipts — Receipts & Credits

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
| GET | `/procurement/documents?status=needs_review\|verified` | `ReceiptsPage.tsx:71` → `services/api/documents.ts:83` |
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
