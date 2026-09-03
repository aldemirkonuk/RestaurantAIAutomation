---
type: page
route: /credits
slug: credits
softwares: [app-shell-support]
component: none (inline <Navigate> redirect)
audience: owner
tier: core
archetype: redirect # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: complete
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[receipts]]"]
---

# /credits — redirect → /receipts?tab=credits

> **Part of** [[08-softwares/app-shell-support|App Shell & Support]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **(immediate redirect, no UI)** → [[receipts]] `/receipts?tab=credits`

## 1. Purpose
Compatibility route. Vendor credit claims (short/damaged deliveries → credit ledger)
live as a tab on the Receipts page; this path preserves the old standalone URL.

## 1a. Features
none — redirect. The credit-claim features live on [[receipts]] §1a (credits tab).

## 2. Entry
No inbound in-app link (`PAGE_MAP.md` entry-point list). Cold URL/bookmarks only.

## 3. Files
- Route: `apps/web/src/App.tsx:282` — `<Navigate to="/receipts?tab=credits" replace />`
- No component (PAGE_MAP "unresolved route components" — correct)

## 4. Endpoints
none from this route. The destination tab consumes the credits module —
`GET /procurement/credits`, `POST /procurement/credits/:id/transition`,
`GET /procurement/credits/stats` (ENDPOINTS.md:370-376, all ✅ JWT) — which belongs to
the `/receipts` page doc.

## 5. Signals
none.

## 6. Tier cut
Core-adjacent via S03 (delivery short/wrong/damaged): the credit ledger is S03's Plus
row ("credit claim opened-never-sent") and Pro row ("settled-recovery ledger + ageing
ship"). See TIER-MAP S03.

## 7. Rebrand surface
none.

## 8. State & config
none.

## 9. Gaps
none of its own; S03's known gap ("credit claim opened-never-sent", TIER-MAP S03)
lives at the destination, not in this redirect.

## 10. Maturity

**complete** — as a redirect, which is all it claims to be.

`apps/web/src/App.tsx:282` is `<Navigate to="/receipts?tab=credits" replace />`; the
destination reads that param at `ReceiptsPage.tsx:59-63` and opens the Credits tab.
The round trip works. `replace` keeps it out of history, so Back does not bounce.

Verdict scope note: the destination tab is **partial** (see receipts.md §10 — claims
are opened automatically but never sent to the vendor). That is the destination's
verdict, not this route's; a redirect that redirects correctly is complete.

## 11. Data flow

### Calls out

| Method | Path | Auth | Gateway controller | Returns |
|---|---|---|---|---|
| — | none | — | — | This route renders no component and issues no request |

### Fed by

| Data | Producer | Live? |
|---|---|---|
| — | none | — |

### Writes

| Write | Downstream reaction |
|---|---|
| — | none |

Everything a user sees after the redirect belongs to receipts.md §11.

## 12. Design intent

**Should be:** a URL that keeps working. Nothing more.

| State | Handled? | Evidence |
|---|---|---|
| Empty | n/a | Never renders |
| Loading | n/a | Synchronous `<Navigate>` inside the already-mounted router |
| Error | n/a | Cannot fail — no data, no async |
| Permission-denied | Inherited | Sits inside the same `ProtectedRoute` + `DashboardLayout` block as `/receipts` (`App.tsx:247-252`), so an unauthenticated hit is bounced by the layout, not by this line |

**Where the UI misleads:** nowhere. The route has no UI.

## 13. Roadmap

1. **Nothing to build.** The only open question is retirement, and it is the same
   one `/services` carries: no in-app link points here
   ([PAGE_MAP](../foundation/PAGE_MAP.md) entry-point list), so the route exists for
   bookmarks and old links whose traffic the product cannot measure. Blocked on the
   absent telemetry (§5 across the corpus) — deleting it is guesswork until then.
2. If credits ever outgrow a tab and get their own page, this file becomes the page
   note and `/receipts?tab=credits` becomes the redirect. No decision proposes that.
