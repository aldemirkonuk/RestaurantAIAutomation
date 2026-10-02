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

## Two order routes the dashboard reads still send prices to staff — OPEN — 2026-10-01

Found by the PR #579 audit (both reviewers). Line citations are at `6806498668cb`.

**What.**
- DASH-W22 withholds money from staff on the dashboard's own routes (`apps/api-gateway/src/dashboard/amounts-for-role.ts`).
- The page also reads `GET /procurement/orders/pending` and `GET /procurement/orders/history` (`apps/web/src/pages/dashboard/next/useDashboardNextData.ts:138,315`). Those routes carry only the class-level `JwtAuthGuard` (`apps/api-gateway/src/procurement/procurement.controller.ts:119,201,217`) and answer `totalCost` and `finalPrice` to any role.
- The page hides those prices from staff (`WaitingOnYou.tsx`, `DayDetail.tsx`); the server does not. The founder's reason for W22 was that hiding money only on the page "would not keep them private".
- This exposure is not new: staff could always reach those routes. W22's §14 row records it as not covered, and it is queued for the /orders session (`p4-scratch/review-shared-queue.md`, R1b line).

**Fix.** Withhold the price fields for a role that does not see `money`, read through `seesHouseAmounts`, on both routes, with the same `amounts` flag the dashboard routes return.

## The shared web client turns a failed alerts or activity read into an empty list — OPEN — 2026-10-01

Found by the PR #579 audit.

**What.**
- DASH-W3 and W11 made the gateway fail the call when a read fails.
- `getRecentActivity` and `getAlerts` in `apps/web/src/services/api/dashboard.ts:81-82,96-97` catch the failure and return `[]`, so the page still shows "no alerts" when the alert read failed. That is absence reported as health.
- A failed `/stats` falls back to counts built from the inventory summary (`:25-46`). It carries no money and no time zone.
- `services/api/` is a shared part, so it is not changed from a page branch. Both catches are queued in `p4-scratch/review-shared-queue.md` (R1 lines).

**Fix.** Let the failure reach the page, which already has the "couldn't be reached" line and "Try again" (W19; the lines themselves land with PR #565).

## Read errors reach the client with table names and PostgREST text — OPEN — 2026-10-01

Found by the PR #579 audit.

**What.**
- The dashboard controller passes `error.message` into `HttpException` (`apps/api-gateway/src/dashboard/dashboard.controller.ts:108-109,160-161,191-192,227-228`).
- The service's new throws put the table and the PostgREST message in that text (`dashboard.service.ts:40,181,587,606`), for example `procurement_orders read failed: <message>`.
- Only an authenticated caller of their own house sees it, and the pass-through predates PR #579. The table names are new.

**Fix.** Log the detail and answer a fixed sentence.

## A house with no time zone is read as UTC on the dashboard — OPEN — 2026-10-01

Found by the PR #579 audit; the founder ruled on it as DASH-G2.

**What.**
- `houseZone` returns `"UTC"` when `restaurants.timezone` is null (`apps/api-gateway/src/dashboard/dashboard.service.ts:175-183`). So "today", the week, the month and the calendar are quietly bucketed on UTC for that house.
- The founder's rule of 2026-09-03 is that an unset value reads as unknown (`supabase/migrations/20260903170000_a_default_is_not_an_answer.sql:4`). That migration dropped the column's default and set the defaulted rows back to null.
- A malformed zone name makes `Intl` throw a `RangeError`, so stats and the calendar answer 500.
- ALDEMIR has its zone set (America/Chicago).

**Ruling (DASH-G2, 2026-10-01).** "Follow rule, follow-up PR (Recommended)": those figures show "—" and the page says the house has no time zone set, sketched before it is built.
