---
type: page
route: /authorize/:integrationId
slug: authorize-integration
component: apps/web/src/pages/AuthorizeIntegration.tsx
audience: owner
tier: core
signals_today: none
rebrand_strings: 3
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]", "[[settings]]"]
---

# /authorize/:integrationId

## Surface — buttons → where they go

- **Allow** → external — provider OAuth URL via full `window.location.assign` (URL from the authorize API call)
- **Cancel** → sanitized same-site `returnPath`, default [[settings]] `/settings`

## 1. Purpose
Our-vocabulary consent screen shown *before* handing the user to Google/Microsoft OAuth: states what the grant will be used for and what we deliberately do not ask for, so the provider's screen "confirms a decision the user has already understood" (`AuthorizeIntegration.tsx:27-35`). Valid ids are hard-coded: `google_drive`, `excel` (`AuthorizeIntegration.tsx:21`). Allow performs a full `window.location.assign` to the provider URL (`:83-85`); Cancel returns to a sanitized same-site `returnPath` (defaults `/settings`, `:46-51`).

## 2. Entry
**No inbound in-app link found by PAGE_MAP** (it is on the entry-points list, and among the "unresolved route components" whose outbound edges are untraced). In practice reached programmatically from Settings → Integrations flows carrying `?returnPath=`. Deliberately outside `DashboardLayout` so nothing offers "ways to wander off mid-grant" (`App.tsx:231-236`).

## 3. Files
- Route binding: `apps/web/src/App.tsx:237-244` (lazy, `App.tsx:106`; wrapped in `ProtectedRoute` but chrome-free)
- `apps/web/src/pages/AuthorizeIntegration.tsx` (322 lines)
- API module: `services/api/integrations.ts`

## 4. Endpoints
| Method | Path | Where called | Atlas |
|---|---|---|---|
| GET | `/integrations/oauth/catalog` | `integrations.ts:38-39`, `AuthorizeIntegration.tsx:55-56` | ENDPOINTS.md:233 |
| POST | `/integrations/oauth/:integrationId/authorize` | `integrations.ts:56`, `AuthorizeIntegration.tsx:83` (returns provider URL) | ENDPOINTS.md:231 |

(The `GET /integrations/oauth/:provider/callback` at ENDPOINTS.md:232 completes the loop server-side; this page never sees it.)

## 5. Signals
**none.** Grant shown / allowed / cancelled — consent-funnel events — are untracked.

## 6. Tier cut
Core plumbing for document/export flows; no `S..` names this page (OD-48). The grants it brokers feed the documents surfaces used by S02/S03 evidence flows.

## 7. Rebrand surface
- `AuthorizeIntegration.tsx:150` — H1 "Connect {label} to WineOps"
- `AuthorizeIntegration.tsx:172` — section "What WineOps will be able to do"
- `BrandMark` default alt `WineOps` (`AuthorizeIntegration.tsx:288`, `BrandMark.tsx:17`)

## 8. State & config
- Per-deployment availability comes from the catalog: `entry.available` / `unavailableReason` render a "Not available yet" state (`AuthorizeIntegration.tsx:155-167`) — server decides, page obeys.
- `returnPath` sanitization: same-site paths only (`:46-51`), mirrored server-side.

## 9. Gaps
- Adding a third integration requires editing the hard-coded `VALID_IDS` (`AuthorizeIntegration.tsx:21`) even though the catalog is server-driven — two sources of truth for "what exists".
- PAGE_MAP cannot trace this component's outbound links ("Unresolved route components"), so the map under-represents the consent flow.
