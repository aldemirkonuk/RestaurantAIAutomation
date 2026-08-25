---
type: page
route: /credits
slug: credits
component: none (inline <Navigate> redirect)
audience: owner
tier: core
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-24
links: ["[[PAGE-CONTRACT]]"]
---

# /credits — redirect → /receipts?tab=credits

## 1. Purpose
Compatibility route. Vendor credit claims (short/damaged deliveries → credit ledger)
live as a tab on the Receipts page; this path preserves the old standalone URL.

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
