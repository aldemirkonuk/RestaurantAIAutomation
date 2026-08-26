---
type: adr
id: 0021
title: Studio invites are redeemed by the invitee, bound to the invited address
status: proposed
updated: 2026-08-26
links: ["[[0012-reports-through-the-gateway]]", "[[0019-p2-build-scope]]", "[[0020-no-fabricated-answers]]"]
---

# 0021 — The invitee redeems the invite, and the invited address is what authorizes it

- **Status:** Proposed — closes the second half of [OD-82](OPEN-DECISIONS.md); opens [OD-88](OPEN-DECISIONS.md), [OD-89](OPEN-DECISIONS.md)
- **Date:** 2026-08-26
- **Decider:** Aldemir (founder) — chosen 2026-08-26; not binding until locked
- **Keywords:** studio, invite, redeem, RBAC, privilege escalation, routing, orchestrator, gateway, target_email
- **Links:** [OD-82](OPEN-DECISIONS.md), [OD-88](OPEN-DECISIONS.md), [OD-89](OPEN-DECISIONS.md), [0012](0012-reports-through-the-gateway.md)

## Context

`POST /api/v1/studio/invite/redeem` was gated on
`require_studio_role("developer", "certified_contributor", "review_admin")`
(`services/agent-orchestrator/api/studio_routes.py:516-521` before this change). An invitee
holds none of those roles — that is what the invite grants — so the only accounts that could
redeem an invite were the ones that did not need it. There was correspondingly no
`/studio/invite/:token` route in `apps/web/src/App.tsx` and no page component behind it.

Two things found while verifying that report changed what the decision had to cover.

**1. `target_email` was written and never read.** `create_invite` stores it
(`studio_routes.py:499`) and it appears nowhere else in the service — confirmed by
`grep -rn target_email services/agent-orchestrator`, which returns only the write, the model
field, and three test fixtures. So the token alone authorized the grant. The role gate was
accidentally containing that: drop it as reported and *any* authenticated account could
redeem *any* leaked or forwarded token, including one minted for `review_admin`. Studio
shares an auth realm with the restaurant product, so "any authenticated user" is every
restaurant staff account on the platform, not a small internal set. The fix as originally
framed would have opened a privilege-escalation path while closing a usability one.

**2. Nothing served `/api/v1/studio/*` at all.** The studio pages call it with relative URLs;
`apps/web/vite.config.ts:25-28` proxies `/api` to the NestJS gateway in dev and
`apps/web/vercel.json:6-9` rewrites it to the same gateway in prod, and the gateway had no
studio module (`grep -rn "v1/studio" apps/api-gateway/src` → one unrelated string). The
endpoints lived only in the orchestrator. So the mint endpoint the OD called "genuinely
working" also 404'd from the browser, and fixing the role gate alone would have changed
nothing observable. `.planning/06-pages/studio.md:76-84` had already flagged this as a
candidate defect; it had not been filed.

Supporting evidence that self-service redemption was the original design, not a new idea:

| Artifact | What it says |
|---|---|
| `studio_routes.py:13` (module docstring) | `/invite/redeem` — "Redeem invite token (**any authenticated user**)" |
| `supabase/migrations/20260805000000_baseline_from_production.sql:14444` | RLS policy `invite_tokens_read_for_redemption`: `FOR SELECT USING (used_at IS NULL AND expires_at > now())` — meaningful only for a **non-admin** reader, since `invite_tokens_admin_all` already covers review_admin |
| `apps/api-gateway/src/auth/auth.service.ts:393-395` | studio roles are embedded in `app_metadata.roles` "so FastAPI `require_studio_role()` can authorize studio API calls" — the gateway token was always meant to be forwarded |
| `tests/e2e/test_studio_pipeline.py:461` | the test redeems as a *developer* with the comment that developer "is in the allowed roles list" — written around the gate, not asserting the intended flow |

The role gate contradicted the endpoint's own documented contract and the schema built for it.

## Options considered

1. **Authenticate only, token is the authorization.** The conventional design and what the
   docstring promises. Rejected *as stated*: without reading `target_email` it converts a
   usability bug into a privilege-escalation bug, for the reason in Context §1. Its appeal is
   that it needs the least new machinery.
2. **Authenticate, and bind the grant to the invited address.** Same shape as option 1, plus
   `target_email` becomes required at mint and must match the redeeming JWT's `email` claim.
   Costs a required field on an endpoint that had it optional, and makes tokens minted before
   this change unredeemable — deliberately, since those are exactly the unbound ones.
3. **Delete the flow; keep invites admin-driven.** Remove both endpoints, the dialog, and the
   `invite_tokens` table. Smallest surface and leaves nothing dormant. Rejected: it discards a
   schema, two RLS policies, a mint endpoint and a UI that were all built for self-service, and
   replaces a working product flow with manual DB edits by whoever holds the service-role key.
4. **Do nothing.** The endpoint stays unreachable and the UI keeps pointing at a route that
   does not exist. Costs nothing today and guarantees the same investigation happens again.

## Decision

**Option 2, plus routing the prefix through the gateway.**

Redemption now requires only a verified JWT (`require_authenticated_user()`), and authorization
comes from the invite itself: `target_email` is required at mint and the redeeming account's
email must match it. The token is a capability to claim *a specific address's* invite, not a
bearer capability for a role. The check fails closed — a token with no `target_email`, or a JWT
with no `email` claim, is rejected rather than allowed through.

Three smaller corrections came with it, each fixing something that would have been a defect the
moment the flow carried traffic:

- **Consumption is atomic.** The old read-then-write let two concurrent redemptions both pass
  the `used_at` check. The claim is now a conditional `UPDATE ... WHERE used_at IS NULL`; the
  write decides, not the earlier read.
- **A failed grant releases the claim.** If the `user_roles` insert fails after the token is
  claimed, the claim is reverted — otherwise the invitee is left with a burned invite and no role.
- **Already holding the role is a 409, not a silent duplicate row**, and does not burn the token.

**The gateway sends the invite; the admin never sees the link** (added 2026-08-26 at the
founder's request, after the first live attempt). The dialog previously minted a token and
handed the URL back for the admin to copy and forward by hand. `POST /api/v1/studio/invite`
is now intercepted by `StudioInviteController`, which mints *through* the orchestrator —
which still owns the `review_admin` check — and then emails the invitee via `GmailService`.
The token is not in the success response: it exists in the database and the invitee's inbox
and nowhere else, so it cannot be pasted into the wrong window. It reappears only when
delivery fails, as a recovery path, because by then the row exists and would otherwise be
stranded.

Sending is gateway-side rather than orchestrator-side because email already lives there —
templates, Gmail/SMTP credentials, and the `sendEmail` fallback chain are all Node. A second
mailer in Python would mean two credential sets and two template systems for one message.

This introduces one ordering hazard, which has its own test: `StudioProxyController`
declares `@Post("*")` on the same `studio` prefix, and Express matches in registration
order. If the proxy were registered first it would swallow `POST /studio/invite`, the
request would still succeed, and the email would silently never be sent — indistinguishable
from the old behaviour. Verified at the Express level, not just in module metadata.

Routing follows [ADR 0012](0012-reports-through-the-gateway.md)'s conclusion that the gateway is
the access path: `StudioProxyController` forwards `/api/v1/studio/*` to the orchestrator with the
caller's own Bearer token, rather than substituting a service credential — swapping in the admin
key would erase the identity the orchestrator authorizes on and make every caller an admin. The
proxy holds no role logic of its own; the orchestrator's checks remain the only ones.

This makes explicit a coupling that was previously accidental: the gateway signs with
`JWT_SECRET` and the orchestrator verifies with `SUPABASE_JWT_SECRET`, so **those two
environment variables must hold the same value** or every studio call 401s. That was already
true the moment `auth.service.ts` started embedding `app_metadata.roles`; it had simply never
been exercised, because nothing routed to the orchestrator.

## Consequences

- **Easier:** a review_admin can invite a contributor and that person can actually accept, from
  the browser, without anyone touching the database. The three studio pages become reachable for
  the first time, since the routing fix serves the whole prefix.
- **Harder / given up:** invites can no longer be minted without an address, and cannot be
  forwarded to a colleague — the recipient must be the invited account. Any `invite_tokens` row
  created before this change is unredeemable and must be re-minted; this is intended, as those
  rows are unbound by construction. An invite grants a role to an **existing** account and does
  not create one, so a brand-new contributor registers first, then redeems.
- **New operational requirement:** `JWT_SECRET` (gateway) and `SUPABASE_JWT_SECRET`
  (orchestrator) must match in every environment, and `AGENT_ORCHESTRATOR_URL` must be set on the
  gateway. If the latter is missing the proxy returns 503 with a logged error rather than failing
  obscurely. Delivery also now depends on Gmail/SMTP being configured; if it is not, minting still
  succeeds and the admin gets the link back with an explicit failure, rather than a silent no-op.
  `FRONTEND_URL` on the gateway determines the link's host — if it is wrong, invites point at the
  wrong deployment.
- **Revisit if:** studio contributors stop sharing an auth realm with restaurant users (the
  email binding is doing work that a separate realm would do structurally), or if invites need to
  reach people without an account, which would require an invite→registration path that does not
  exist today.
- **Not addressed here:** the studio routing gap is filed as [OD-88](OPEN-DECISIONS.md) with the
  residue this change does not cover — `POST /api/v1/onboarding/extract` is still unrouted, and
  `StudioCertify.tsx:32-46` still ignores PATCH response status.

## Review trail

- Both claims in the OD-82 report were verified before any code changed: the role gate at
  `studio_routes.py:516-521` and the absent web route in `App.tsx`. Both were accurate.
- The regression test was confirmed to fail against the old gate — reverting only the
  `Depends(...)` line makes `test_roleless_invitee_can_redeem` return
  `403 {"detail":"Requires one of: [...]. Your roles: []"}`.
- `843 passed, 54 skipped` across the orchestrator suite; 14 new tests in
  `tests/test_studio_routes.py::TestRedeemInvite` and `::TestInviteRequiresTargetEmail`.
- The new tests were placed in `tests/test_studio_routes.py` rather than the e2e suite because
  all of `tests/e2e/` is skipped without production Supabase credentials
  (`tests/e2e/conftest_prod.py:217` is a session-scoped autouse fixture requiring
  `prod_supabase`). The mock-only studio pipeline tests have therefore never run locally or in
  CI without secrets. Filed as [OD-88](OPEN-DECISIONS.md).
