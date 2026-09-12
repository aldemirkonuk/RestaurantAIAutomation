---
type: software
slug: auth-onboarding
name: Auth & Onboarding
division: platform-admin
status: partial
tier: core
routes: ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/invite/:code", "/no-access", "/get-started", "/onboarding", "/profile"]
pages: [login, register, forgot-password, reset-password, verify-email, invite-landing, no-access, get-started, onboarding, profile]
api_modules: [auth, restaurants]
agents: []
owner_unit: platform-api
updated: 2026-09-01
links: ["[[login]]", "[[register]]", "[[forgot-password]]", "[[reset-password]]", "[[verify-email]]", "[[invite-landing]]", "[[no-access]]", "[[get-started]]", "[[onboarding]]", "[[profile]]", "[[platform-api-charter]]", "[[access-control-tenant-isolation-charter]]", "[[activation-in-product-guidance-charter]]", "[[team-command]]", "[[SOFTWARE-MAP]]"]
---

# Auth & Onboarding

## §0 What it is

Everything between "I have never used this" and "I am working in it": creating an account,
opening a restaurant or joining someone else's by invite, proving your email address,
recovering a lost password, importing your first wine list, and managing your own account
afterwards. It is the largest software in the platform division by screen count — ten
routes — and the only one where the failure mode is a person who cannot get in at all.

## §1 Features today

- Read the notice, sign out, ask an owner for an invite — the no-access dead end
  (**dark**: nothing in the app ever routes anyone here, §7)
- Set a new password from an emailed link, with invalid-link and success states
- Ask for a password-reset email — deliberately enumeration-resistant: every branch
  answers "sent"
- Sign in with email and password, or with Google; return to where you were via
  `?redirect=`
- Verify your email from a link, with a rate-limited resend
- Preview an invite before accepting — which restaurant, which role — and accept it in one
  tap when already signed in
- Join a team with an 8-character invite code, validated live as you type
- Open a restaurant: a three-section owner sign-up that creates the organization,
  restaurant, user, membership and access rows with a real rollback
- Import your first wine list three ways — photo scan, file upload, or by hand — then
  review and correct the extracted lines
- Set the one-time low-stock threshold that marks activation complete
- Manage your own account: name, phone, password, linked Google account, theme; and for
  managers, restaurant details, payment and memberships
- Leave a restaurant, or delete your account behind a type-DELETE confirmation
- Sign in with Microsoft — **dark**: `POST /auth/oauth/microsoft` exists
  (`auth.controller.ts:121`) and `AuthContext` wraps it; no button renders it

## §2 Screens

Ten `06-pages` notes, in the order a person meets them.

- [[login]] — `App.tsx:159`. Password and Google both complete end to end.
- [[register]] — `App.tsx:160`. Two paths: join-by-code, or open a restaurant.
- [[forgot-password]] — `App.tsx:161`; [[reset-password]] — `App.tsx:162`. The pair.
- [[verify-email]] — `App.tsx:163`. Instructions plus token redemption.
- [[invite-landing]] — `App.tsx:164`, `/invite/:code`. The invite's public face.
- [[no-access]] — `App.tsx:165`. The card for a signed-in user with no membership.
- [[get-started]] — `App.tsx:172`. The live activation surface.
- [[onboarding]] — `App.tsx:173`. A tombstone that forwards to `/get-started`
  (`Onboarding.tsx:13-15`).
- [[profile]] — `App.tsx:318`, the only one of the ten **inside** `DashboardLayout`.

**Nine of the ten are public routes**, and two of those should not be: `/get-started` and
`/onboarding` sit in the `{/* Public Routes */}` block (`App.tsx:158`) with no
`ProtectedRoute` wrapper, so an anonymous visitor renders the full Activate tab with
working-looking upload buttons and every call 401s.

## §3 Backend

`apps/api-gateway/src/auth/` — **29 route decorators** under
`@Controller("auth")` (`auth/auth.controller.ts:42`), of which **8 carry `@Public()`**.
Guards are applied per method, not at the class: `@UseGuards(JwtAuthGuard)` on the
`me/*` and session routes, `PasswordResetThrottleGuard` on the reset request (`:223`).
`auth.service.ts` is **2,177 lines** — the largest single service in the gateway and the
god-file of this software.

`apps/api-gateway/src/restaurants/` — **6 endpoints**, `@Controller("restaurants")`
(`restaurants/members.controller.ts:27`), class-guarded at `:28`. Members and invites; the
same rows [[settings-integrations]]'s Team tab edits.

Supporting: `auth/guards/jwt-auth.guard.ts`, `auth/strategies/{google,microsoft,jwt}.strategy.ts`,
`auth/assert-email-verified.ts`, `common/tenant/assert-tenant-match.ts`, and 9 `.spec.ts`
files — the densest test coverage of any module in this division.

## §4 Automation

`none (every action is human-initiated)` — no `@Cron` in `auth/` or `restaurants/`.
Verification emails and reset emails are queued in-request. Nothing expires a stale
`user_onboarding_progress`, sweeps unused invites, or notices an account that has been
sitting unverified for a month.

## §5 Data

From `.from(...)` in `apps/api-gateway/src/auth/`: `users`, `user_roles`,
`user_oauth_accounts`, `user_restaurant_access`, `user_onboarding_progress`,
`email_verifications`, `password_resets`, `organizations`, `organization_members`,
`organization_invites`, `restaurants`, `team_members`.

`restaurants/` touches `restaurants`, `users`, `user_restaurant_access`,
`organization_members`, `organization_invites`.

This software **owns the identity tables** — `users`, `user_oauth_accounts`,
`email_verifications`, `password_resets`, `user_onboarding_progress` — and shares the
tenancy tables with [[team-command]] and [[settings-integrations]]. It is the only writer
of the first group and one of three writers of the second.

## §6 Owner

[[platform-api-charter]] — team `platform-api`, department `engineering`, division
Platform. It names the module and the count: *"`apps/api-gateway/src/auth/` (28
endpoints)"* (`platform-api-charter.md:32-33`) — I count 29 route decorators today, a
one-route drift worth noting rather than a disagreement.

Two other charters own real parts of this software and neither is a footnote:

- [[access-control-tenant-isolation-charter]] (Intelligence → security) owns *"`JwtAuthGuard`
  coverage, `TenantGuard` semantics, `@Public()` policy"* and, specifically, *"whether 'no
  user ⇒ allow' (`tenant.guard.ts:38-46`) remains the default, and what replaces it"*
  (`access-control-tenant-isolation-charter.md:24-38`). §7 is that charter's subject
  matter.
- [[activation-in-product-guidance-charter]] (Product → design) owns *"first-run:
  onboarding, the activation checklist, role-based defaults, and in-product tours and
  tips — for owner, manager, and staff separately"*
  (`activation-in-product-guidance-charter.md:20-21`). [[get-started]] and [[onboarding]]
  are its pages, not platform-api's.

The split is clean in the charters and invisible in the code: one module, one 2,177-line
service, three owners.

## §7 Maturity & seams

**partial.** Nine page verdicts, one of them `complete` ([[reset-password]]), one `hollow`
([[no-access]]), the rest `partial`. The core paths — sign in, register either way, reset,
verify, accept an invite, import a list — all persist real rows against real tables. What
is missing is mostly at the edges, and the edges are where people get stuck.

### The security posture, verified rather than restated

**The `TenantGuard` fail-open is still literally in the file, and it is no longer the whole
story.** `common/tenant/tenant.guard.ts:47-52` still logs a warning and `return true` when
there is no authenticated user. But the comparison it was supposed to make has been moved
one layer later: `assertTenantMatch(request)` now runs inside `JwtAuthGuard` immediately
after passport populates `request.user` (`auth/guards/jwt-auth.guard.ts:60`). The in-file
reasoning is exact and worth reading in place (`jwt-auth.guard.ts:50-59`): `TenantGuard` is
an `APP_GUARD` and `JwtAuthGuard` is not, Nest runs global guards first, so `TenantGuard`
hit its own no-user branch **on every authenticated route** — *"Tenant isolation was, in
practice, not enforced at all."* `assertEmailVerified` was relocated for the same reason
(OD-79) and fails **closed** on a missing field.

So: on any route that carries `JwtAuthGuard`, tenant isolation and email verification now
fail closed. `TenantGuard` remains registered globally (`app.module.ts:135-137`) as a
backstop that is a no-op on the normal path.

**What I did not verify: the ~94 unauthenticated-by-omission figure.** That number is
`.planning/04-specs/ECOSYSTEM-PLAN.md:66`, where it is recorded as *"measured 4 different
ways"* with reconciliation still scheduled. I did not reproduce it and do not restate it as
a count. What I did measure on this tree:

- `JwtAuthGuard` is **not** an `APP_GUARD`. `app.module.ts:130-137` registers exactly two
  global guards — `RateLimitGuard` and `TenantGuard`. Authentication is therefore
  per-controller opt-in across all 51 controllers and 469 route decorators, which is the
  same fact platform-api records as `platform.endpoints_protected_by_default_pct` = **0%**
  (`platform-api-charter.md:70-72`).
- **44** `@Public()` decorators repo-wide.
- Exactly **two** controller files contain no `JwtAuthGuard` reference at all —
  `vendor-portal/vendor-portal.controller.ts` and
  `common/orchestrator/inbound-email.controller.ts` — both on
  [[integration-engineering-charter]]'s legitimately-public list
  (`integration-engineering-charter.md:32-38`), plus `health/liveness.controller.ts`, which
  is unauthenticated by explicit design (`liveness.controller.ts:24-35`).

That is a posture claim, not a clean bill: opt-in auth means the class of defect is one
forgotten decorator away at all times, which is precisely why platform-api's charter frames
the fix as a global mechanism rather than an audit.

**Google OAuth self-provisioning: fixed, and verified here.** `findOrCreateOAuthUser` no
longer creates anything — *"Never creates one"* (`auth/auth.service.ts:1489`). The comment
records the full shape: an unknown address that passed Google's token check was INSERTed as
`role: "manager"` into `DEFAULT_RESTAURANT_ID`, on an unauthenticated route, with no domain
restriction — verified against production 2026-09-01, resolving to a live restaurant
carrying real inventory, with no account having come in that way yet
(`auth.service.ts:1489-1505`). Fixed by removing the auto-create outright rather than
re-gating it on the env var (commit `dad3bf4a`, PR **#179**).

**A page note is stale, in the safe direction.** `register.md` §10 reports the
`POST /auth/join` account-takeover as *"Reported, not fixed."* It **is** fixed:
`auth.service.ts:1277-1294` now runs `bcrypt.compare` against the existing account's hash
before minting tokens, with a deliberately indistinguishable error so the `@Public` route
does not become an account-existence oracle (`:1296-1300`). The page note needs correcting.

### Structural seams

1. **`no-access` is hollow and actively contradicted.** Four references in `apps/web/src` —
   an import, a route, a docstring and the component — and no `navigate()` targets it. Worse,
   for exactly the user it exists for (authenticated, zero restaurants), `AuthContext`
   invents a synthetic branch literally named `'My Restaurant'`
   (`apps/web/src/contexts/AuthContext.tsx:362`) and routes them into the dashboard against
   a restaurant they may have no membership in.
2. **Two public activation routes.** `/get-started` and `/onboarding` (§2). The redirect
   cannot tell "no menu yet" from "not signed in".
3. **Invites are bearer tokens.** `targetEmail` is optional and neither accept path checks
   it; whoever holds the link gets the role (`invite-landing.md` §10). A design choice, and
   the thing that made the (now-fixed) join defect reachable.
4. **Email case is not normalised on write.** Lookups lower-case; `registerRestaurant`
   (`:599`) and `joinViaInvite` (`:1186`) store raw. A user who registers `Foo@Bar.com`
   silently never receives a reset email, and enumeration resistance makes that failure
   invisible to the user *and* to support.
5. **A 485-line dead wizard.** `contexts/OnboardingContext.tsx` is mounted nowhere; two
   re-export lines in `Onboarding.tsx:35-36` are all that keep it alive.
6. **`auth.service.ts` at 2,177 lines** carries sign-in, registration, invites,
   verification, reset, OAuth linking and account deletion in one file.

## §8 Where it's going

- ADR 0049 §3a puts `auth` under **Platform/Admin**, phase **E0 — auth census + map
  true-up** (`ECOSYSTEM-PLAN.md:59`). E0 is where the ~94 figure gets reconciled to one
  script; until it does, no note should quote it as measured.
- The recurrence mechanism, not the sweep, is the deliverable:
  [[access-control-tenant-isolation-charter]] owns *"the allowlist file, the CI script, and
  the policy that a guard change without an allowlist change is rejected"* (`:40-42`).
  platform-api owns building the global default that makes forgetting impossible.
- [[no-access]] is one `if` away from real, and the synthetic-branch fallback is the thing
  that has to go first.
- Correct `register.md` §10 — the takeover it reports as open is closed.
