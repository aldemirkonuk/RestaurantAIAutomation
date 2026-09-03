---
type: page
route: /studio/invite/:token
slug: studio-invite-redeem
softwares: [wine-studio]
component: apps/web/src/pages/studio/StudioInviteRedeem.tsx
audience: dev
tier: core
archetype: focused # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 1
maturity: partial
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[studio]]", "[[studio-certify]]", "[[login]]"]
---

# /studio/invite/:token — accept a studio invite

> **Part of** [[08-softwares/wine-studio|Wine Studio]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

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

## 1a. Features *(invite-only entry point — no studio role needed yet)*
- Turn an invite link into a studio role on the account you are signed in with — one
  explicit button, never fired automatically (the token is single-use)
- Says *why* a link failed instead of showing one generic error: wrong account, bad link,
  already used, expired, session expired, service unavailable
- On success, opens Studio with the new role already in effect
- Retry in place, or leave for the dashboard
- **Gap:** an invite can only grant a role to an account that already exists. Someone with
  no Mudavym account sees the "issued to a different email" error, which is true and
  unhelpful (§9)

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

## 10. Maturity — **partial**

The route exists, is guarded, and every failure it can name is named. What has never
happened is a success.

- **Served and guarded.** Against a gateway booted with dummy config the redeem call
  returns **401** (route mounted, `JwtAuthGuard` running) while the unrouted
  `/api/v1/onboarding/extract` control returns **404** — the same 404 the whole studio
  prefix returned before [ADR 0021](../decisions/0021-studio-invites-are-self-service.md)
  (§9). The route this page redeems into is the one [[studio-certify]]'s InviteDialog
  had been minting links to for a route that did not exist.
- **The logged-out detour is browser-verified** (§9): the token survives the redirect to
  [[login]] and back in `location.state.from`.
- **The success branch is unit-covered only** — `tests/test_studio_routes.py::TestRedeemInvite`
  at the API boundary and `studio-proxy.controller.spec.ts` on the proxy. That branch
  contains the `refreshToken()` call the granted role depends on (§8), so the one thing
  that has never run live is also the one thing that is easy to get wrong. **First real
  invite should be watched**, not assumed.
- Not hollow: nothing here reports success for a write that did not land. The
  redemption is an explicit button, statuses are mapped individually rather than
  collapsed, and the error state is a real branch.

## 11. Data flow

**Calls out**

| Method | Path | Auth | Server | Returns / today |
|---|---|---|---|---|
| POST | `/api/v1/studio/invite/redeem` | Bearer; **no** `requiredStudioRole` on the route — that gate was the ADR 0021 bug | gateway `StudioProxyController` → orchestrator `api/studio_routes.py` | role granted, or one of 403 / 404 / 409 / 410 / 401 / 503, each surfaced distinctly (§4) |

**Fed by**

`invite_tokens` rows minted by [[studio-certify]]'s InviteDialog and delivered out of
band (email, chat). There is no in-app inbound link by design (§2) — a user who can
already navigate here does not need an invite.

**Writes**

Grants a studio role on the signed-in account. The role is **not** live until the JWT is
re-minted: studio roles are baked in at sign-in (`auth.service.ts:432`), which is why the
page calls `refreshToken()` and links onward with a plain `<a href>` rather than a router
`<Link>` (§8). Nothing downstream subscribes.

## 12. Design intent

The page should convert a link into access, and — when it cannot — say which of six
different things went wrong, because "invalid invite" is useless to the person holding
the link.

| State | Implemented |
|---|---|
| empty | n/a — no collection is rendered |
| loading | ✅ `working`, and redemption is never fired on mount (single-use token, StrictMode double-fire, §8) |
| error | ✅ six statuses mapped individually rather than collapsed (§4) |
| permission-denied | ✅ 403 — but see below |

**Where it misleads:** the 403 copy — *"This invite was issued to a different email
address"* — is what someone with **no Mudavym account at all** sees (§9). True, and
unhelpful: it points at the wrong problem and offers no way forward.

## 13. Roadmap

1. **Watch the first real redemption end to end** — the success branch, including
   `refreshToken()`, has never run against a live `invite_tokens` row. Cheapest and
   highest-value item on this list.
2. **Detect the no-account case** and route it to registration and back, rather than
   showing a 403 that blames the wrong thing (§9).
3. **Invite → registration path** — an invite cannot create an account today. Needs a
   decision before code: does an invite imply a right to register?
