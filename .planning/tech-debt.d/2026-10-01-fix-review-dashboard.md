## A page load reads `/auth/me` twice against a ten-a-minute per-IP auth bucket — OPEN — 2026-10-01

Found in the dashboard walk-through, P9 (`06-pages/dashboard.md` §14). Line citations are at `1c1a676f8`.

**What.**
- Every full load reads `GET /auth/me` twice: `apps/web/src/contexts/AuthContext.tsx:377` and `apps/web/src/stores/authStore.ts:264`. In dev it is three times, under StrictMode.
- The global `RateLimitGuard` gives every path containing `/auth/` 10 requests a minute (`apps/api-gateway/src/common/rate-limit/rate-limit.guard.ts:29`). The bucket is keyed on the first `x-forwarded-for` IP plus the route (`:303-310`), because the guard runs before `JwtAuthGuard`.
- So about five reloads a minute from one address return 429, and the console says "Failed to load user". This was seen live 12 times on 2026-10-01, 6:34–6:57 PM local.
- The session survives, because a 429 no longer drops the tokens (`AuthContext.tsx:385-398`; `v3.0-TECH-DEBT.md` "A rate limit reported as a logout"). But a house whose staff share one Wi-Fi shares one bucket.

**Fix options.** Read `/auth/me` once per load (one owner of the session), or re-key or raise the auth bucket for authenticated reads. Production's count per load was inferred from the bundle, not measured.

## The gateway sends no `Access-Control-Max-Age`, so production pays a preflight on every call — OPEN — 2026-10-01

Found in the dashboard walk-through, P9 and P10.

**What.**
- `enableCors` sets `origin` and `credentials` only (`apps/api-gateway/src/main.ts:20-23`).
- The live bundle calls `https://wineopsapi-gateway-production.up.railway.app` cross-origin, not the `/api` rewrite in `vercel.json:10-11`.
- A read-only `OPTIONS /api/v1/house/day` with `Origin: https://mudavym.com` answers 204 with no `Access-Control-Max-Age`. The browser therefore re-asks within seconds (Chrome's default is 5 s), so each of the shell's 60 s polls (house/day, house/counter, unread count) is two round trips.

**Fix.** Set `maxAge` (Chrome caps it at 7200 s), or call the same-origin rewrite.

## TenantGuard logs a warning on every authenticated request — OPEN — 2026-10-01

**What.**
- `apps/api-gateway/src/common/tenant/tenant.guard.ts:70-72` warns "No authenticated user … ensure JwtAuthGuard is applied" whenever `request.user` is unset.
- As a global guard it always runs before the controller's `JwtAuthGuard`, so it is always unset. The ordering is by design (ADR 0096); the warning is not.
- A local gateway logged 1,371 of these lines during one review session, and they drown the real warnings.

**Fix.** Log at debug, or warn only when the route carries no `JwtAuthGuard`.

## The socket greeting still names the old brand — OPEN — 2026-10-01

**What.** `apps/api-gateway/src/websocket/websocket.gateway.ts:328` answers a connection with "Connected to WineOps AI". It is visible only in the browser console.

## Wine-only words outside the dashboard — OPEN — 2026-10-01

**What.**
- The founder chose "items" over "wines" for counts and fallbacks (DASH-W37, ADR 0257), because the house holds every drink (ADR 0115, ADR 0186).
- The dashboard is done. Other pages still print wine-only words such as "Unnamed wine".
- `/inventory?wine=<name>` is a link contract between the dashboard (`RailPanels.tsx:183`) and /inventory, and must be renamed on both sides at once.
- "Bottles" and "In the cellar" are kept until food lands.
