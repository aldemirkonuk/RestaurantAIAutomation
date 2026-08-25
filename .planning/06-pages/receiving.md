---
type: page
route: /receiving
slug: receiving
component: apps/web/src/pages/receiving/ReceivingHome.tsx
audience: staff
tier: core
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-24
links: ["[[PAGE-CONTRACT]]"]
---

# /receiving — Receiving home (role-split)

## 1. Purpose

"One event, three renderings, chosen by role" (`ReceivingHome.tsx:17-33`, echoed at
the route: `App.tsx:258`). Staff see *which delivery are you receiving* → the door
flow, **with no prices**; managers see *what needs a decision, worst money first*;
owners see one number — money that actually came back. Role is resolved
deterministically from auth (`ReceivingHome.tsx:66-71`); unrecognised roles fall to
the cost-free staff view on purpose.

## 2. Entry

**No inbound in-app link.** Not in the sidebar (`components/layout/Sidebar.tsx:58-184`),
not in the command palette (`components/command/commands.ts`), and a repo grep for
`'/receiving'` navigation finds nothing. Note: [PAGE_MAP](../foundation/PAGE_MAP.md):104-132
does **not** list it among entry points — that list undercounts; the map only records
this page's *outbound* edges (:86-87). Reached by typed URL today.

## 3. Files

- Route binding: `apps/web/src/App.tsx:259` (lazy import :79).
- `apps/web/src/pages/receiving/ReceivingHome.tsx` (355 lines) — all three views in one file
  (StaffView :75, ManagerView :135, OwnerView).

## 4. Endpoints

Atlas rows: [ENDPOINTS](../foundation/ENDPOINTS.md):389 (`procurement`), :420
(`procurement/receiving`), :370 (`procurement/documents/credits`).

| Method | Path | Call site |
|---|---|---|
| GET | `/procurement/orders` (deliveries to receive) | `ReceivingHome.tsx:88` |
| GET | `/procurement/receiving/queue` | `ReceivingHome.tsx:142` (manager decision queue) |
| GET | `/procurement/credits/stats` | `ReceivingHome.tsx:263` (owner recovered-money number) |

## 5. Signals

**None emitted.** Markup carries `data-ux-key="receiving:staff-order"` (:113) and
`"receiving:queue-row"` (:178), but the uxSignals reporter is dark
(`lib/uxSignals.ts:15`) with no page-level consumer — markers wait for a reporter.

## 6. Tier cut

**Core** — operate. This is the S02/S03 front door: PO-prefilled checklist and the
mismatch queue are ✅-Core rows ([TIER-MAP](../03-scenarios/TIER-MAP.md):38-39).

## 7. Rebrand surface

**0 user-visible strings** (no `wineops` hits in the file). Shared layout chrome
applies (see dashboard.md §7).

## 8. State & config

- Role gate from `useAuth` only — the file documents why the role must come from that
  source (`ReceivingHome.tsx:63-64`: "the staff view deliberately hides all money").
- No env vars, flags, or localStorage specific to this page.

## 9. Gaps

- **Unreachable by click** (§2): the S02 golden path starts at a URL nobody is linked
  to. Either a sidebar/palette entry or a dashboard hand-off is missing.
- PAGE_MAP's entry-point list omits this route (see §2) — the atlas undercounts
  orphans; worth a regeneration note there rather than a fix here.
