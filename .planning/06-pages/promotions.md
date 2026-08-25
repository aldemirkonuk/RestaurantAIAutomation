---
type: page
route: /promotions
slug: promotions
component: apps/web/src/pages/Promotions.tsx
audience: owner
tier: core
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]", "[[providers]]", "[[orders]]"]
---

# /promotions — vendor offers, trusted senders, prospects

## Surface — buttons → where they go

- **Apply to a new order** (row menu + detail) → [[orders]] `/orders?new=1&promo=<id>`
- **Copy code** → clipboard
- **Dismiss** → (local only — dismissed ids persist in localStorage, 8s undo)
- **Attachment** (prospect detail) → external vendor URL

## 1. Purpose
Three tabs (`Promotions.tsx:20`): **Offers** — promotions the AI extracted from vendor
email; **Trusted senders** — sender reputation + trust toggles that skip the spoof
quarantine; **Prospects** — cold outreach from vendors not yet added, with
promote/dismiss/restore. Page subtitle states exactly this (`Promotions.tsx:58-60`).

## 2. Entry
Sidebar item (`components/layout/Sidebar.tsx:93`). PAGE_MAP's entry-point list claims
no inbound link — **stale** for the same data-array reason as `/wineagent` (see
[[wineagent-alias]] §2). Tab deep-links via `?tab=senders|prospects`
(`Promotions.tsx:23-33`).

## 3. Files
- Route: `apps/web/src/App.tsx:275` → `pages/Promotions.tsx` (795 lines, tabs inline)
- Hooks: `hooks/queries/usePromotionsQueries.ts`
- `components/layout/RestaurantBranchSwitcher.tsx`, `components/ui/ExportMenu.tsx`

## 4. Endpoints
- `GET /providers/promotions/active` (`usePromotionsQueries.ts:22`; ENDPOINTS.md:456)
- `GET /senders/reputation` (`:45`; ENDPOINTS.md:141)
- `POST /senders/trust` (`:55`; ENDPOINTS.md:142)
- `GET /prospects` (`?scope=all` when multi-location, `:98`; ENDPOINTS.md:130)
- `GET /prospects/:id/attachments` (`:108`; ENDPOINTS.md:131)
- `POST /prospects/:id/promote | /dismiss | /restore` (`:118-139`; ENDPOINTS.md:132-134)

## 5. Signals
none.

## 6. Tier cut
Core — S13's "Prospects digest" Core row; the Offers tab is S08-adjacent (drift is
priced from the same vendor mail). See TIER-MAP S13/S08.

## 7. Rebrand surface
none user-visible. (`wineops.promos.dismissed` is a localStorage key,
`Promotions.tsx:101` — §8.)

## 8. State & config
- Offer dismissal is **local-only by design**: "There is no promotions-dismiss
  endpoint, so this is a local preference … with an undo window"
  (`Promotions.tsx:113-117`), persisted at localStorage `wineops.promos.dismissed` (`:101`)
- Keyboard 1/2/3 switches tabs, NEW-352 (`Promotions.tsx:36-47`)
- Multi-location: prospects fetched across branches when >1 restaurant (`:27-28`)

## 9. Gaps
- Local-only dismissal does not sync across devices/users — a deliberate cut (§8), but
  undocumented to the user.
- `v3.0-TECH-DEBT.md:500` — "L187 Promotions non-interactive" is **partly stale**;
  `onDismiss` is wired. Remaining 44.15 entries unverified.
- Offer supply depends on the inbound-email extraction pipeline, which shipped Phase 0
  in shadow mode with `provider_promotions` still dormant (memory:
  `inbound-email-intelligence-plan.md`) — an empty Offers tab is the expected state
  until that wakes.
