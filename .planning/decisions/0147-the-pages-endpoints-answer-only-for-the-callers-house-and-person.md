# 0147 — The pages' endpoints answer only for the caller's house and person

- **Status:** Locked 2026-09-12. The founder set the scope in session: *"What the pages need, plus the named gaps"*. Built on `fix/page-endpoints-tenant-faults`. **[AMENDED 2026-09-16: the founder answered four of the gaps below in the [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]] session (rows 15, 17, 18, 19). Each answer is a bracket beside its item; being built, not built.]**
- **Deciders:** Aldemir (scope); the orchestrating session (the fixes)
- **Related:** [[0141-a-stock-write-names-the-house-it-is-for]], [[0146-asking-costs-money-so-asking-is-bounded]], [[0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms]]

## Context

The P4 page wave digest (`p4-scratch/wave/DIGEST.md`, outside the repo) read every
endpoint the redesigned pages call and listed the faults. Before any fix, a
per-module workflow wrote a spec against the unfixed code and watched it fail. The reports,
one per module, are in `p4-scratch/endpoint-faults/*.md`, and each names its failing output.
The adversarial pass on the first notifications fix overturned it: the preferences
routes were scoped, but their siblings still read and wrote another user's rows
by id. This record covers the whole set as it stands on the branch.

Three shapes recur across every module, and they are the reason the fixes look alike:

1. **An id taken from the client and trusted.** It arrives as a `?userId=`, a body
   `userId`, a path `:restaurantId`, or a bare notification `:id`. Nothing compared it
   with the verified token.
2. **A failed read reported as an empty one.** A database error came back as
   `{count: 0}`, "no branches", "nothing connected", "invalid link" or `not_found`.
   That is the [[absence-reported-as-health]] shape at an endpoint.
3. **An actor read from `request.user.id`.** `JwtStrategy.validate` returns `userId`
   and never `id` (`auth/strategies/jwt.strategy.ts`), so every such actor was null.

## Decision

**The token decides the user and the restaurant.** A client-supplied id is still
accepted when it names the caller, because the web client sends its own id
(`apps/web/src/services/api/notifications.ts`). Any other id is **refused with 403**,
never silently replaced, so a client bug surfaces instead of writing to a row nobody
checked. A session with no user is a 401. A row that is not the caller's is a 404,
the same answer as a row that does not exist. **A failed read throws**, and the
controller does not rewrap a refusal it chose as a 500.

By module (details and failing output in the named report):

| Module | Fault closed | Report |
|---|---|---|
| auth | POST /auth/verify-email body is a validated DTO. getInvitePreview and verifyEmail no longer report a failed read as "not found" or "invalid link" | auth-verify-and-invite.md |
| procurement | GET /procurement/orders/pending/count no longer answers `{count: 0}` on a failed read | failed-reads-pending-and-branches.md |
| organizations | GET /organizations/branches no longer answers "no branches" on a failed read. Two read-error baseline rows retired | failed-reads-pending-and-branches.md |
| communications | house letters and the mail archive record their actor from `userId` | house-letters-actor.md |
| integrations | DELETE /integrations/oauth/:integrationId is scoped to the caller's tenant. GET connections no longer turns a database error into "nothing connected" | integrations-oauth.md |
| notifications | **every** route that names a person or a notification answers for the token's user and restaurant: preferences GET/PATCH, the list, unread, unread count, history, read/all, read/bulk, `:id` read, unread, archive and delete, bulk delete, delete read/all, push subscribe and unsubscribe, test, create, and held low-stock crossings | notifications-preferences.md; `notification-routes-belong-to-the-caller.spec.ts` |
| sender trust, prospects | /senders and POST /prospects/:id/promote take a role. providerId is checked against the house. `trusted: "false"` no longer trusts. promote no longer treats failed reads as empty or a failed write as success | sender-trust-and-prospects.md |
| vendor intel | a session with no house no longer receives every tenant's queue and log, and can no longer decide or undo any house's row | vendor-intel-identity.md (fault 3) |
| wines | the search string is no longer interpolated into the `.or()` filter. `search` has a MaxLength and `limit` a Max. Database text no longer leaves in a 500 | wines-search.md |
| provider intelligence | [2026-09-25, PR #416] all seventeen `provider-intelligence.controller.ts` routes take the house from `houseOf(user)` (403 for a session naming none); fifteen reads that filtered on `provider_id` alone, or on nothing (`promotions/active` listed every house's offers), now filter on `restaurant_id`. The per-provider reads and the two session writes (`POST :id/outreach`, `POST :id/onboard`) check the provider is the house's first, so another house's id is a 404. `compareProviders` does not admit NULL-house providers | PR #416; claims ADR-0147-PROVIDER-INTELLIGENCE-HOUSE-SCOPED, TECHDEBT-PROVIDER-INTEL-12-UNSCOPED-READS |

## Named and not fixed

- **Vendor intel, faults 1 and 2.** Decisions on public-register rows with no house can
  be undone from any house, and name a person from another house. This is a founder
  fork with options A-D; the recommendation is C. **[2026-09-17: answered C by the
  founder on 2026-09-16 (ADR 0149 answer 17) and built on `feat/finish-vintel`.
  Migration `20260917010000` adds the nullable `beverage_identity_decisions.deciding_restaurant_id`.
  Decide and undo write it from the token's active house. The log names the person
  only inside that house; other houses see the outcome and when. [Corrected
  2026-09-17, review round 2: another house's OWN row is a 404, identical to a
  missing id — a 403 there would confirm the id exists. A SHARED row decided
  elsewhere stays a readable 403.] A shared decision logged before the column is
  shown to no house with its person and cannot be undone. That is not because no
  platform-operator role exists — a person-naming allowlist
  (`PLATFORM_ADMIN_USER_IDS`) already exists (`ProspectsController.assertPlatformAdmin`,
  one route today) and was deliberately not extended here: letting an operator undo a
  decision no house owns is a new permission and the founder's call, surfaced in the
  lane's fix report rather than filed as a register row (filing one here repoints ~178
  citations across ~89 unrelated files — `scripts/check_citation_pairing.py:69` — a
  blast radius this lane declined to take on unasked).
  `decide` also gained a claim-first write order (claim, then link, then log) that
  answers a new 409 when two houses decide one shared candidate at the same moment.
  See ADR 0124's review trail, 2026-09-17.]**
- **Integrations.** Who may disconnect an integration for a user with no tenant is a
  founder fork. The spec pins today's refusal.
  [FOUNDER ANSWERED 2026-09-16, build pending (not merged) — ADR 0149 row 18: the creator of a grant may
  always end it, an ex-member included, and the ADR 0118 mail sweep runs on that
  disconnect (0118 D15). Until built, the spec above still pins the refusal.]
- **Notification senders.** POST `/notifications/order-approval`, `low-stock`,
  `delivery`, `price-negotiation`, `system-alert` and `send-email` still send to any
  user id or email address the body names. Who may notify whom is a product rule,
  not a scoping bug.
  [FOUNDER ANSWERED 2026-09-16, build pending (not merged) — ADR 0149 row 15: the five uncalled POST
  senders are closed (internal only); `send-email` is owner/manager, with recipients
  limited to the house's members and its vendors' contacts; and the resolver sites
  are mapped to categories, an unmapped category refused (OD-121).]
- **Notification preferences.** `ordersMode`, `reportsMode` and `digestFrequency` are
  free strings with no allowlist. `startTime`, `endTime` and `digestTime` have no HH:mm
  check, and the columns have no CHECK constraint.
- **Wines.** The bottle picker searches only the wine library. That is the open fork
  between ADR 0144 and ADR 0124, not a code fault.
- [ADDED 2026-09-16 — not in this list as written. **`POST /communications/email` as an
  open relay** (`communications.controller.ts:214`). FOUNDER ANSWERED 2026-09-16, being
  built — ADR 0149 row 19: two locked doors. The orchestrator through the internal service
  key; users by JWT, owner/manager, their own house only, recipients limited to its vendor
  contacts and members, and an audit row per send.]

[AMENDED 2026-09-17 — ADR 0149 answer #19 carried in and built. `POST
/communications/email` (the relay ADR 0084 wrote down) now has two locked doors
(`apps/api-gateway/src/communications/relay/`). The orchestrator uses the existing
`X-Admin-Key` and must name the house, the vendor and the conversation or order;
the gateway checks all three against the rows and every recipient against that
vendor's addresses in the house's book. A person needs a JWT, owner or manager of
the session's house, recipients among its members and vendor contacts, and sends
text, never raw HTML. [CORRECTED 2026-09-17, same day, adversarial review: a
person sends nothing. After those checks the person door refuses 409, because the
only mailbox the route can send from is the deployment's shared one and ADR 0118
D1/D2 rule that out; which mailbox a person's mail leaves from was not decided by
#19 and is left to the founder. "Never raw HTML" was also false while it stood —
a guessable MIME boundary and unencoded bodies let `bodyText` inject an HTML part
— and is fixed for every sender in `GmailService.createMimeMessage` (random
boundary, base64 parts, bounded bodies).] [SUPERSEDED 2026-09-17, later the same
day — the founder answered the fork the paragraph above left open: a person's
mail DOES leave this route, through the house's OWN connected mailbox
(`HouseSenderService.resolve`'s `gmail_send` grant — the same one the letters
composer already uses, never the deployment's shared one), naming the acting
person as author. A house with none gets a refusal in the resolver's own words
plus a machine-readable `code: "house_mailbox_not_connected"`, not a bare 409.
`relay-email.service.ts`'s `sendAsPerson`.] [SUPERSEDED AGAIN 2026-09-17, later
the same day: an immediate send from this mailbox contradicted ADR 0118 D2,
which the founder himself decided in session and which
`GET /communications/letters/sender` already publishes for it (`ceremony:
"undo"`, `undoMs`, the 2-minute recall sentence) — a promise this door's own
callers were not getting. Founder: the person door **queues** like every
other send from this mailbox, so D2's rule attaches to the mailbox, not to
the route. Built the same day: `sendAsPerson` inserts a `relay_email_queue`
row (`status: HOUSE_QUEUED`, `scheduled_send_at = now + undoMs`, the
already-signed body) and returns 202, not 200; `RelayEmailCron` ->
`dispatchQueued` sends it once the window closes, re-resolving the sending
identity from the row rather than trusting what was true at queue time;
`POST /communications/email/:id/cancel` (`cancelQueued`) pulls a still-queued
row back before then. Migration
`20260925160000_a_persons_mail_queues_like_the_houses_own.sql`; ADR 0118 D2
carries the same bracket. See `.planning/decisions/CLAIMS.jsonl`
(`ADR-0149-MAILBOX-QUEUE`).] Every send writes `system_audit_log` rows (attempt before the
provider call, then sent or failed; refusals too), actor `public.users.user_id` or
`orchestrator`. Refusals are 401/403 with the reason. [CORRECTED 2026-09-17:
also 409 (the person door, above), 422 (commitment language) and 503 (a read
failed, filed as `relay_email_unavailable`, not as a refusal).] [CORRECTED
2026-09-17, the queuing answer above: a person-door send now writes a fourth
row first, `relay_email_queued`, at queue time — before any attempt row
exists, since nothing is attempted with a provider until the window closes.
`attemptRecorded` is `false` on a queued response for exactly that reason.] Not decided here: whether the
orchestrator should release or park a conversation the relay refused with a 4xx
(ADR 0099, Proposed, rejected widening its classifier).] [DECIDED 2026-09-19,
founder, lane answers batch 4: 400/403/422 are definite refusals and 401
parks; ADR 0099 is now Locked, see its bracket.] [CORRECTED 2026-09-18:
the queued shape above did not work against the real schema —
`scheduled_send_at NOT NULL` rejected `cancelQueued`'s and `dispatchQueued`'s
own terminal writes with 23502, so the undo never cancelled anything and a
sent or failed row stayed `HOUSE_SENDING` forever; fixed by making the column
nullable (see ADR 0118 D2 and `CLAIMS.jsonl`'s `ADR-0149-MAILBOX-QUEUE` for
the measurement and the fix). Also fixed: `dispatchQueued`'s own status-write
failures are no longer discarded, and `cancelQueued`'s update now confirms it
matched a row before answering "pulled back". **Founder, 2026-09-18, ADR 0149
row 43:** pulling a queued send back is the author's alone, on both this
route and `POST /communications/letters/:id/cancel` — a non-author gets 403.
A pooled inbox — several owners sharing a view of what left or is queued,
with no shared cancel right and each still sending as themself — is recorded
as a direction in `.planning/06-pages/communications.md`, not built.]

## Alternatives rejected

- **Replace a mismatched client id with the token's, silently.** Rejected: a request
  naming someone else is either a client bug or an attack, and both deserve to be
  seen. The web client already sends the right id, so nothing legitimate is refused.
- **Scope inside the services only.** Rejected for the id-based notification routes,
  where scope is applied in both layers: the controller refuses a mismatched id, and
  the service matches the row on `id` AND `user_id`, so a caller that reaches the
  service another way still cannot touch another user's row.
- **Drop the `userId` field from the DTOs.** Rejected: `forbidNonWhitelisted` would
  then refuse the web client's own requests. The field stays whitelisted and
  optional, and the token decides.

## Consequences

- A client that sends another user's id now gets a 403 where it used to get data.
  Measured callers: web only (`apps/web/src/services/api/notifications.ts`); mobile has
  no caller of these routes (the preferences report grepped `apps/mobile`).
- `markAsRead`, `markAsUnread` and `archiveNotification` on an id that is not the
  caller's return 404, where they used to return 500 from `.single()` finding no row.

## Addendum 2026-09-18: a sign-up body never names a house

The same fault as the first of this record's three, in the one place a caller has no
token yet: `POST /auth/register` took `restaurantId` and `role` from its body and
wrote both onto the new user, and the token that came back was scoped to that house
in that role. It is closed rather than fixed, because nothing calls it: a person
opens a house through `POST /auth/register/restaurant` and joins one only through an
invitation, and both of those take the house from a record the server made, never
from the body. The route answers 410 with those two doors named, and
`AuthService.register` is deleted so no writer is left. Detail and the production
read are in `v3.0-TECH-DEBT.md` 44.1g; the claim is `ADR-0147-REGISTER-NAMES-NO-HOUSE`.

The same day, PR #392's adversarial review found the invitation door's own form of
the fault. `POST /auth/invite` is `@Roles("owner","manager")`, and `RolesGuard` gates
on `users.role`. That is a GLOBAL column, one value per person:
`JwtStrategy.validate` sets `role: user.role ?? payload.role` from an unscoped
`users` read. The body names the house being invited to. Nothing compared the role
granted with the inviter's role in that house, so a manager could mint an owner's
invite. It is closed the way this record closes the others, by reading from the house
the request is about. The inviter's role in the invited house is read exactly as
`MembersService.assertMembership` reads it: the active access row there, or, with none,
a `users` row that names that house. A failed read answers 503. The `users`-row read
stays because a setup-era manager depends on it (44.1h). The grant then follows
[[0162-managers-grant-manager-or-staff-on-both-doors]]: owners any role, managers
manager or staff, staff nothing. Detail is in 44.1h; the claim is
`ADR-0147-INVITE-ROLE-CEILING`.

The records of the register fix counted which endpoints re-check membership. The
count said "only the logs and members endpoints" (44.1g and the claim
`ADR-0147-REGISTER-NAMES-NO-HOUSE`), and both now carry a dated correction. A grep
finds these re-checks:

- `assertMembership`: 10 calls in 3 files.
- `assertCanManageRestaurant` and `resolveRestaurantRole`: 40 calls in 15 files.
- `TeamService.assertAccess`: 35 calls in 5 files.
- `AuthService.getUserRoleAtRestaurant`: 1 call.
- `AuthService.switchRestaurant`: 1 call.
- Two inline reads, in `integrations-oauth.service.ts` and `price-index-review.service.ts`.
- `ProspectsService.accessibleRestaurantIds`: 1 call (`GET /prospects?scope=all`).
  Found by PR #393's round-3 verifier; that round's build had listed it only in its
  evidence.

The first three accept a `users` row that names the house, and `generateInvite` now
reads it the same way. `switchRestaurant` falls back to any house of an organisation
the person belongs to. `accessibleRestaurantIds` reads the person's active access rows,
then adds the token's house without checking it is among them. The rest read access
rows only. The detail is in 44.1g's bracket. What stays open is 44.1i–44.1o and
44.1q; 44.1p (a role change reaching non-members) was closed in PR #393's fourth
round (ADR 0162, second addendum), and 44.1q (a role changed in a house the `users`
row does not name never reaches `RolesGuard`) was filed in its fifth.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-12 | Aldemir (chat) | Scope: what the pages need, plus the named gaps |
| 2026-09-12 | Per-module fixers (workflow) | Each fault reproduced by a failing spec before its fix; reports in p4-scratch/endpoint-faults |
| 2026-09-12 | Adversarial pass | OVERTURNED the notifications fix: the push subscribe and unsubscribe siblings still wrote a victim's row |
| 2026-09-12 | Orchestrating session | Every notification route scoped; two read-error baseline rows retired. Not re-audited: the founder's decision "Your word as PASS, no agents" |
| 2026-09-16 | Aldemir, via ADR 0149 | Rows 15, 17, 18, 19 answered: notification senders and categories, public-register rows, the ex-member disconnect, and the `/communications/email` relay. Brackets beside "Named and not fixed"; being built, none claimed built |
