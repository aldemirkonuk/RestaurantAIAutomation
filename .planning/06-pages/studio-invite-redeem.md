---
type: page
route: /studio/invite/:token
slug: studio-invite-redeem
component: apps/web/src/pages/studio/StudioInviteRedeem.tsx
audience: dev
tier: core
signals_today: none
rebrand_strings: 1
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[studio]]", "[[studio-certify]]", "[[login]]"]
---

# /studio/invite/:token — accept a studio invite

## Surface — buttons → where they go

- **Accept invite** → API `POST /api/v1/studio/invite/redeem` (body carries the token)
- **Open Studio** (success state) → [[studio]] `/studio` — a full page load, not a router
  navigate, deliberately (§8)
- **Try again** (error state) → re-POSTs the same redemption
- **Go to Dashboard** (error state) → `/`

## 1. Purpose
The one page in the studio surface aimed at someone who is *not yet* a studio user. It
converts an invite token into a role on the signed-in account. Created by
[ADR 0021](../decisions/0021-studio-invites-are-self-service.md); before that the invite
dialog produced a link to this route and the route did not exist.

## 2. Entry
Cold URL only — the link is minted by [[studio-certify]]'s InviteDialog and delivered out
of band (email, chat). No in-app inbound link, by design: a user who can already navigate
here from inside the studio does not need an invite.

Route gate: `ProtectedRoute` with **no** `requiredStudioRole` (`App.tsx`). This is the
point of the page — the invitee has no studio role, and gating on one is exactly the bug
ADR 0021 fixed. A logged-out invitee is redirected to [[login]], which returns them here
via `location.state.from` (`Login.tsx:36,53`), so the token survives the detour.

## 3. Files
- Route: `apps/web/src/App.tsx` → `pages/studio/StudioInviteRedeem.tsx`
- No shell: deliberately outside `StudioLayout`, which renders a role badge the invitee
  does not have yet.

## 4. Endpoints
- `POST /api/v1/studio/invite/redeem` — orchestrator `studio_routes.py`, reached through
  the gateway's `StudioProxyController` (ADR 0021). Statuses are mapped individually
  rather than collapsed, because each means something different to the reader: **403**
  wrong account, **404** bad link, **409** already used *or* already held, **410**
  expired, **401** session expired mid-page, **503** service down.

## 5. Signals
none.

## 6. Tier cut
Outside the tier axis — internal onboarding for the S06/S17 data-supply chain, same as
[[studio-certify]].

## 7. Rebrand surface
1 — the "WineOps Studio" wordmark in the card header.

## 8. State & config
No store. Local state only (`idle | working | done | error`). Redemption is an explicit
button, never fired on mount: it is single-use and irreversible, and an effect would
double-fire under React 18 StrictMode and burn the token.

On success the page calls `refreshToken()` before offering the Studio link. Studio roles
are baked into the JWT at sign-in (`auth.service.ts:432`), so without a refresh the
just-granted user would be denied at `/studio` immediately after being let in. The final
link is a plain `<a href>` rather than a router `<Link>` for the same reason —
`AuthContext` derives `studioRoles` from the token once on mount, so the new role only
takes effect on a fresh load.

## 9. Gaps
- An invite grants a role to an **existing** account; it cannot create one. A contributor
  with no Mudavym account must register first, then reopen the link. There is no
  invite→registration path, and the page does not currently detect that case — it will
  show the generic 403 (`This invite was issued to a different email address`), which is
  true but unhelpful for someone who simply has no account yet.
- **Verified in the browser 2026-08-26:** the logged-out redirect preserves the token
  (`history.state.usr.from.pathname === "/studio/invite/test-token-abc123"`), the card
  renders, and the Accept button POSTs to `/api/v1/studio/invite/redeem` and degrades to
  the error state when the call fails. Against a gateway booted with dummy config, that
  path returns **401** (route served, `JwtAuthGuard` running) while the unrouted
  `/api/v1/onboarding/extract` control returns **404** — which is what the studio prefix
  itself returned before ADR 0021.
- **Not verified live:** a successful redemption. That needs a real `invite_tokens` row,
  a matching account, and the orchestrator behind the gateway with
  `JWT_SECRET == SUPABASE_JWT_SECRET`. The success branch — including the `refreshToken()`
  call the new role depends on — has only unit coverage at the API boundary
  (`tests/test_studio_routes.py::TestRedeemInvite`) and on the proxy
  (`studio-proxy.controller.spec.ts`). First real invite should be watched.
