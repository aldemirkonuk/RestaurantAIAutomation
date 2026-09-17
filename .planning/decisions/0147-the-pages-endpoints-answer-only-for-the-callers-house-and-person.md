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

## Named and not fixed

- **Vendor intel, faults 1 and 2.** Decisions on public-register rows with no house can
  be undone from any house, and name a person from another house. This is a founder
  fork with options A-D; the recommendation is C.
  [FOUNDER ANSWERED 2026-09-16, build pending (not merged) — ADR 0149 row 17: a new nullable deciding-house
  column, and the person's name and the undo only inside that house. Also carried into
  ADR 0124.]
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

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-12 | Aldemir (chat) | Scope: what the pages need, plus the named gaps |
| 2026-09-12 | Per-module fixers (workflow) | Each fault reproduced by a failing spec before its fix; reports in p4-scratch/endpoint-faults |
| 2026-09-12 | Adversarial pass | OVERTURNED the notifications fix: the push subscribe and unsubscribe siblings still wrote a victim's row |
| 2026-09-12 | Orchestrating session | Every notification route scoped; two read-error baseline rows retired. Not re-audited: the founder's decision "Your word as PASS, no agents" |
| 2026-09-16 | Aldemir, via ADR 0149 | Rows 15, 17, 18, 19 answered: notification senders and categories, public-register rows, the ex-member disconnect, and the `/communications/email` relay. Brackets beside "Named and not fixed"; being built, none claimed built |
