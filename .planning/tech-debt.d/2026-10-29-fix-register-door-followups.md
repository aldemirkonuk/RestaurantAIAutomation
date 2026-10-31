## AuthContext's own refresh failure leaves the persisted person and the page as they are — OPEN — 2026-10-29

Filed by `fix/register-door-followups` (#700), from its review.

**What happens.** Three places in the web learn that a refresh token was refused. Two of them, the API client's 401 handler (`apps/web/src/services/api/client.ts`) and the auth store's boot load (`apps/web/src/stores/authStore.ts`), call `leaveDeadSession` (`apps/web/src/lib/deadSession.ts`). It removes both tokens and the auth store's persisted copy (`auth-storage`), then reloads a public page or sends any other page to `/login` (ADR 0344). The third, `AuthContext.tsx`'s own interceptor and `/auth/me` load (`:445-466`), clears the tokens through the shared refresh (`sessionRefresh.ts`) without calling it. At boot the auth store's load runs too and reacts, so the page ends the same. A refusal seen later by `AuthContext` alone leaves `auth-storage` in place and does not move the page. It is the same as before #700. Every request after it fails, because no token is left.

**Why it was not fixed on #700.** Routing `AuthContext` through `leaveDeadSession` changes when a signed-in page reloads or navigates. That makes it a behaviour change on every private page, not a follow-up to the two founder picks #700 carries.

**Re-check.** `grep -n leaveDeadSession apps/web/src/contexts/AuthContext.tsx` finds nothing while this is open.
