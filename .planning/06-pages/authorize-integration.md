---
type: page
route: /authorize/:integrationId
slug: authorize-integration
component: apps/web/src/pages/AuthorizeIntegration.tsx
audience: owner
tier: core
signals_today: none
rebrand_strings: 3
maturity: complete
status: documented
updated: 2026-08-26
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

---

## 10. Maturity

**complete.** The best-behaved page in this cluster, and the only one that handles all four required states explicitly.

Every state is a distinct early return: unknown id (`AuthorizeIntegration.tsx:94-104`), load error (`:106-112`), catalog still loading (`:114-123`), id valid but not offered on this deployment (`:125-135`), then the consent card. Allow performs a real server round-trip and only then leaves the origin (`:83-85`); Cancel returns to a `returnPath` sanitised to same-site paths, rejecting protocol-relative `//evil.com` (`:46-51`), which the server mirrors. Availability is server-driven — `entry.available` / `unavailableReason` come from the catalog, and the page obeys (`:155-167`).

§2's claim that no inbound in-app link exists is **stale**: `IntegrationsAuth.tsx:161` navigates here with `?returnPath=/settings?tab=features`. PAGE_MAP cannot trace it (the component is on its "unresolved route components" list), which is a map limitation, not a missing link.

## 11. Data flow

### Calls out

| Method | Path | Auth posture | Gateway controller | Returns |
|---|---|---|---|---|
| GET | `/integrations/oauth/catalog` | Bearer (`@UseGuards(JwtAuthGuard)`) | `integrations` controller `:39-41` | catalog entries — `id, label, available, unavailableReason`, scope disclosure |
| POST | `/integrations/oauth/:integrationId/authorize` | Bearer | `:76-78` | the provider authorization URL; **`restaurantId` is taken from the authenticated principal** (`:89`, `req.user.restaurantId`), never from the body — the correct pattern, and the counter-example to [[get-started]] §11 |
| GET | `/integrations/oauth/:provider/callback` | `@Public()` | `:106-108` | completes the loop server-side; this page never sees it |

The callback being `@Public()` is necessary — the provider calls it, not the user's session. Its safety therefore rests on the OAuth `state` parameter rather than on a guard; that is outside this page's surface but is where any review of this flow should go next.

### Fed by

The catalog is server-defined, so "what integrations exist" has exactly one producer — except that the page also keeps its own hard-coded allowlist, `VALID_IDS = ['google_drive','excel']` (`AuthorizeIntegration.tsx:21`), checked before the catalog is consulted (`:70-76`, `:94-104`). Two sources of truth for the same question; the client one wins first.

### Writes

Nothing directly. The grant is written server-side by the callback, after the user has left this origin. Downstream: the stored grant is what the document/export surfaces read for S02/S03 evidence flows (§6). This page's only local effect is `window.location.assign` (`:85`).

## 12. Design intent

**Should be:** a consent screen in our own vocabulary that makes the provider's screen a confirmation rather than a first encounter — stated at `:27-35` and actually delivered.

| State | Handled? | Evidence |
|---|---|---|
| Empty | yes — "isn't offered on this deployment" (`:125-135`) and "Not available yet" from `unavailableReason` (`:155-167`) | |
| Loading | yes | `:114-123`, plus a `redirecting` state on Allow (`:81`) |
| Error | yes | `loadError` full-page (`:106-112`) and `actionError` inline (`:86-91`) |
| Permission-denied | yes, upstream | wrapped in `ProtectedRoute` (`App.tsx:237-244`); deliberately outside `DashboardLayout` so nothing offers a way to wander off mid-grant (`App.tsx:231-236`) |

**No misleading UI found.** The one honest risk is the split source of truth in §11: a third integration added to the server catalogue renders as "Unknown integration" until `VALID_IDS` is edited — a false negative, not a false success.

## 13. Roadmap

1. Delete `VALID_IDS` and derive validity from the catalog alone (`AuthorizeIntegration.tsx:21,70-76`) — the server already tells the page everything it needs.
2. Emit consent-funnel signals: grant shown / allowed / cancelled (§5 is `none`). Consent is exactly the kind of decision worth measuring. *Blocked:* no sink (see [[get-started]] §13 item 4).
3. Verify the `state` parameter handling on the `@Public()` callback (`integrations` controller `:106-108`) — out of scope for this page, but it is where this flow's trust actually sits.
4. Make PAGE_MAP resolve this component's outbound edges so the consent flow stops being invisible on the graph (§9).
