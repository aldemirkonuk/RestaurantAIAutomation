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
  **[Built 2026-09-17, founder answer 15 of [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]]
  ("Close five, restrict one"), branch `feat/finish-notify`.]** The five are no longer
  HTTP routes (404); `git grep` over `apps/web/src`, `apps/mobile` and `services/` found
  no caller, the orchestrator included, so none needed a service-key door. Their
  `NotificationsService` methods stay for internal producers. `send-email` now takes a
  validated `SendHouseEmailDto` and goes through `HouseEmailService`: owner or manager
  of the token's house by a live `user_restaurant_access` row **only**
  (`isLiveMembership`: active, `valid_from` not future, `valid_until` null or future).
  **[Corrected 2026-09-17, same branch — this paragraph originally said the legacy
  `users.restaurant_id`/`users.role` columns still applied when no access row existed;
  that was this lane's own blocker (B1), found by its adversarial review the same day
  and closed the same day. There is no fallback: `users.restaurant_id` is body-written
  by public `POST /auth/register` (~~open separately in `v3.0-TECH-DEBT.md`~~
  **[Corrected 2026-09-19: that entry, 44.1g, is marked ✅ CLOSED 2026-09-18 — PR
  #392 closed the route, which now answers 410. The other sites still trusting a
  `users.restaurant_id`/`users.role` fallback are tracked separately, as 44.1i, not
  44.1g, until ADR 0166 places them.]**), and
  trusting it here let anyone who knew a house's id register as its "owner" and send
  as that house. The prose was never updated after the fix landed — see CLAUDE.md
  §5b.]** Recipients are only
  the house's active members and its vendor book (`HouseLettersService.book`), one
  outside address refuses the whole send and is named, a failed read is 503, a
  provider refusal 502, no provider 503 (the old path answered `success: true` with a
  mock id), and one `system_audit_log` row per role refusal, recipient refusal,
  provider failure or send, carrying counts, never an address (a 400/401 or an
  unreadable roster writes none). The three web callers moved to `sendHouseEmail` (they used bare `axios`,
  so carried no token and were already 401) and show the gateway's sentence.
  `RecurringOrders` names no recipient and is unrouted; its send is refused with that
  sentence. Pinned by `notifications/notification-senders-are-closed.spec.ts`.
- **Notification preferences.** `ordersMode`, `reportsMode` and `digestFrequency` are
  free strings with no allowlist. `startTime`, `endTime` and `digestTime` have no HH:mm
  check, and the columns have no CHECK constraint.
  **[Built 2026-09-17, same branch.]** The DTO now refuses anything outside
  `both | in_app | off` and `daily | off`, and any time not `HH:mm` 24-hour, with a 400
  before the service is reached. **[Fixed 2026-09-18, founder answer, ADR 0149 row 39,
  recorded on train/finish-2: preferences are per person PER HOUSE.]** The 42P10 was
  always a code defect, not a schema one — `notification_preferences` has carried
  `UNIQUE (restaurant_id, user_id)` since the production baseline
  (`20260805000000_baseline_from_production.sql:7212-7216`); the service upserted with
  `onConflict: "user_id"`, naming no index at all. `updatePreferences` and
  `registerPushSubscription` now upsert on `(restaurant_id, user_id)` /
  `(user_id, endpoint)` respectively, `getPreferences` and the resolver's preference
  read are both filtered by `restaurant_id` from the token, and a push subscription
  moved to its own table, `notification_push_devices` (a device is not scoped to a
  house). Migration:
  `20260925160500_a_preference_is_kept_once_per_person_per_house.sql`
  **[renumbered 2026-09-25 with its two siblings, `…093000`→`20260925160600` and
  `…100000`→`20260925160700`, from `20260921090000`: all three sorted behind
  main's ceiling `20260922231300` (ADR 0212); content unchanged]**. The columns
  still carry no CHECK constraint (unchanged, out of this lane's scope). Pinned by
  `notification-preferences-are-per-house.spec.ts` and, against real Postgres,
  `p4-scratch/pglite-probe/notify-preferences-per-house.mjs`.
- **Recipient routing (OD-121).** **[Built 2026-09-17, founder answer 15 (ADR 0149,
  re-measured 2026-09-17): "map every resolver site to a category (eleven measured
  2026-09-17, not the seven first counted)".]** There are eleven sends, each named in
  one table, `NOTIFICATION_SEND_CATEGORY` (`communications/recipient-resolver.service.ts`),
  and gate 2 reads that one category's array instead of a union of three. A resolve with
  no or an unknown category throws `UnmappedNotificationCategoryError` before any read
  and never reaches the legacy env fallback. Row 34 (ADR 0149, 2026-09-17) ratified two
  of the original four judgement calls: the weekly report is `financial_reports`, the
  recurring-order reminder `order_approval`. **[Ratified 2026-09-18, founder answer, ADR
  0149 row 46]:** the remaining two, covering three sends — the daily SMS summary and
  the experiment-ended notice are `financial_reports`, the inventory audit reminder
  `calendar_reminders` — were the builder's own call (OD-121) and are now the founder's.
  Row 46 also adds `sms` to `financial_reports_channels`' DEFAULT (migration
  `20260925160600_a_daily_summary_can_reach_a_phone.sql`): the daily SMS summary is
  SMS-only, and a row at the prior default (`email, dashboard`) could never receive it.
  **ADR 0022's check, done and failed:** on the
  stock row production held when measured on 2026-09-02 (`low_stock_channels` = its
  default `['sms','push']`; not re-measured by this lane),
  low-stock email is now declined by preference. **[Fixed 2026-09-18]:** with the 42P10
  above closed, a member can now turn a declined channel back on again.
  **[Corrected 2026-09-19, CLAUDE.md §5b — the previous sentence was wrong.**
  `updatePreferences` (`notifications.service.ts:1156-1196`) has never had a field for
  any of the six `*_channels` arrays, so closing the 42P10 does not restore this
  control: a member still cannot change `low_stock_channels`,
  `order_approval_channels`, `financial_reports_channels`, `delivery_channels`,
  `inequality_alerts_channels` or `calendar_reminders_channels`, for any row, old or
  new — there is no screen (`NotifySection.tsx` has no such control) or API path that
  writes one. What the 42P10 fix actually restores is saving the fields
  `updatePreferences` DOES write (`email_enabled`/`push_enabled`/`sms_enabled`/
  `categories`/`quiet_hours_*`/the `lowStock` sub-object/`ordersMode`/`reportsMode`)
  without a 500. ADR 0022's low-stock-declined-by-default finding is UNCHANGED by
  this lane: still no screen or API can re-enable it. Same correction at OD-121;
  open questions this raises are Q1 and Q2, both now answered — see the next
  bracket, not a scratch report.]**
  **[Corrected 2026-09-19, later the same day, CLAUDE.md §5b — the "UNCHANGED"
  finding just above is now itself half-stale: Q1 is answered and built. Founder
  answer, 19-lane blocking round, ~09:20Z (quoted verbatim in
  `founder-sketch-decisions-106-115.md`): "low-stock = add 'email' to
  low_stock_channels column DEFAULT (small additive migration in the notify
  PR)." Built same day:
  `20260925160700_a_low_stock_warning_can_reach_an_inbox.sql` widens
  `low_stock_channels`' DEFAULT to `ARRAY['sms','push','email']`. This does not
  reopen the screen/API gap described above — a member still cannot WRITE any
  `*_channels` array — it only changes what a row gets when nobody ever wrote
  one: a NEW row (or one reset to the default) now gets email; a row already
  holding an explicit, customised array keeps exactly what it held.
  Q2 — the STANDING RULE of whether a widened default should also move
  existing rows already sitting at the old value — is answered too, same
  round, batch 4 (~10:00Z), verbatim: *"channel-default standing rule =
  untouched rows follow a widened default, customised rows never touched."*
  Built same day, same migration: an
  `UPDATE public.notification_preferences SET low_stock_channels =
  ARRAY['sms','push','email'] WHERE low_stock_channels = ARRAY['sms','push']`
  backfill, matched by exact array equality so a row someone customised away
  from the old default is provably left alone (an unequal array, or NULL,
  never matches). Proven against PGlite, not production —
  `p4-scratch/pglite-probe/notify-lane-low-stock-backfill.mjs`. Production
  held 0 `notification_preferences` rows when measured 2026-09-19 via the
  Supabase MCP (SELECT only), so the backfill moves nothing there today; the
  rule is recorded here as standing, for every row this or a later migration
  ever meets, not only today's production state. ~~**Not done by this pass:**
  `financial_reports_channels` (row 46's earlier default widening, migration
  `20260925160600`) is not backfilled — the standing rule applies to it too,
  but doing so was outside this pass's task; flagged here as a follow-up, not
  silently actioned.~~ **[Corrected 2026-09-21, round-5 notify must-fix,
  CLAUDE.md §5b — this lane owns `financial_reports_channels` too, so the
  follow-up above is done rather than left for a later lane:
  `20260925160600_a_daily_summary_can_reach_a_phone.sql` gained its own
  section 2, applying this same standing rule the same way — a row still at
  exactly the prior default (`email, dashboard`) moves to the new one, a
  customised row never does. Proven against PGlite
  (`p4-scratch/pglite-probe/notify-lane-financial-backfill.mjs`), not
  production, same pattern as the low-stock probe. A CLAIMS.jsonl row
  confirms it, mutation-tested.]** The durable record from here on is this
  bullet and this file's 2026-09-19 changelog row, and `OPEN-DECISIONS.md`'s
  OD-121 entry — not `lane-status-2026-09-18.md` or "the wave-5 notify
  report", which are session-scratch files outside this repo that no other
  reader can open.]**
  The digest
  records `declined_by_preference`, not `no_recipients`.
  Also closed: the resolver no longer counts an ended membership (`is_active = false`),
  and a failed preferences, roster or contact read now fails the resolve (the legacy
  house gets its env address, every other house nobody) instead of reading as "no
  preferences", which allowed every channel. **[Changed 2026-09-18]:** preferences are
  now read narrowed to the caller's house (`getNotificationPreferences` filters by
  `restaurant_id`), settling the per-user vs per-(restaurant, user) fork this paragraph
  used to call open (ADR 0149 row 39). Pinned by
  `communications/notification-categories-route-one-array.spec.ts`.
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
| 2026-09-17 | Notify lane (ADR 0149 answer 15) | Five senders closed, send-email restricted, OD-121 routed by category, preference DTO allowlisted. **[Corrected 2026-09-18, CLAUDE.md §5b: this row previously said "Not adversarially re-audited in this lane" — wrong. The lane WAS adversarially reviewed same-day, `wave2/review-notify.json` (`approve: false`), which found the B1 auth/register blocker this record's line 71-78 already documents as found and closed the same day. Confirmed twice: `wave4/notify-confirm.md`'s own re-audit found everything from that review either fixed or in the register.]** |
| 2026-09-18 | Notify lane (ADR 0149 rows 39/46) | Preferences moved to per-(restaurant, user) upsert, 42P10 closed, push subscription relocated to `notification_push_devices`, the resolver's preference read narrowed by house, `sms` added to `financial_reports_channels`' default, OD-121's two founder-pending mappings ratified. Not independently adversarially re-audited before this row was written — the next wave's confirmer should re-run the pglite probe and the new jest suite against a fresh checkout. |
| 2026-09-19 | Notify lane (sync + R-item pass, wave 5) | Synced onto `origin/main` (`cb756083e`, #392/#393) with this lane's uncommitted work; only textual conflicts (main had annotated OD-121/OD-112/OD-81/OD-123 with "build pending" notes this lane's own build supersedes, and separately added unrelated ADR 0124/0158/0147-register/0162 CLAIMS rows) — resolved by keeping this lane's fuller text and appending main's independent rows, no fact overwritten. Then fixed every R item from `lane-status-2026-09-18.md`'s notify section that did not need the founder, each proven, not asserted: **D1** dropped the CLAIMS row shelling out to `node /Users/…/p4-scratch/…mjs` (an absolute path outside the repo; the `decision-claims` CI job installs no `node_modules`, confirmed by reading `.github/workflows/ci.yml`'s `decision-claims` job — no in-repo static replacement exists for a real-Postgres proof, so the row is gone, not repointed). **D2** rescoped the CLAIMS row for row-39's restaurant filter to each method's body (`re.search` on `getPreferences`/`getNotificationPreferences`) after proving the old file-wide substring check held even on the pre-fix tree `60ed83a7e` (`getPreferences` took no `restaurantId` there at all). **D3** corrected this record's Notification-preferences paragraph and OD-121 in place: no runtime path writes any `*_channels` column (`notifications.service.ts:1156-1196`, `NotifySection.tsx` has no such control), so "a member can now turn a declined channel back on again" never became true. **D4** corrected the notify lane's own `v3.0-TECH-DEBT.md` entry, which called `POST /auth/register` "still open" (44.1g, same file, says CLOSED) and cited 44.1g for the *other* fallback sites, which 44.1i actually tracks. **[Corrected 2026-09-21, round-5 notify must-fix, CLAUDE.md §5b — D4 never reached a commit: that entry was dropped from this lane's working tree before this row's own text was written (`git diff` against the lane base shows `v3.0-TECH-DEBT.md` byte-identical, zero lines changed), for two reasons unrelated to D4's own accuracy — the founder ordered the register deleted, about 04:00Z the same day (his words, recorded in memory `founder-sketch-decisions-106-115.md`: "delete all that tech debt.md that messes with our head"; survivors split by kind — checkable defects to CLAIMS rows, his decisions to OPEN-DECISIONS, paperwork to the owning ADR), and ADR 0166's retirement of it (branch `docs/retire-tech-debt`, `9c6bdc0be`) works from the real 230-item export instead (memory `mudavym-finish-goal-2026-09-18-inflight.md`). So `v3.0-TECH-DEBT.md` carries no 44.1g/44.1i correction from this lane and never will; the correct facts D4 describes live only in this record's send-email paragraph's bracket above (44.1g CLOSED 2026-09-18 by PR #392, the other fallback sites tracked as 44.1i, not 44.1g), which is the record to cite instead.]** **D5** scoped 7 cross-house `notification_preferences` reads to `restaurant_id` (`low-stock-alerts.service.ts`, `scheduled-tasks.service.ts`, `team/broadcast-preferences.ts`, `calendar-reminders.service.ts` ×2, `producers/producer-ledger.service.ts`, `notification_agent.py`'s `_get_notification_preferences`) plus 2 web cache keys (`query-keys.ts`, `useSettingsNextData.ts`) that kept the previous house's preferences cached across a house switch; all 7 backend/Python sites got a new test proven to fail on the pre-fix code and pass on the post-fix code (toggled by hand, not merely written; `scheduled-tasks.service.ts` had no existing spec file, so one was added), and `query-keys.ts`'s key generation got a direct unit test — `useSettingsNextData.ts`'s cache-key change did not get an equivalent test (no test scaffold exists yet for that hook; typecheck plus the proven `query-keys` mechanism stand in, named as a gap, not silently skipped). **D6** added an `EXISTS (select 1 from public.users …)` guard to migration `20260925160500`'s backfill, which 23503'd the whole migration transaction on any `notification_preferences.user_id` absent from `public.users` (that column carries no FK — only `restaurant_id` does, baseline `:12794-12798` — while the new table's does); proven against real Postgres (PGlite, no Docker) with the orphaned-row 23503 reproduced pre-fix and the guarded backfill completing post-fix, both correctly and its own source row untouched. **[Corrected 2026-09-19, same day, CLAUDE.md §5b (independent-verifier finding, MODERATE) — D6's probe (`p4-scratch/pglite-probe/notify-lane-d6-fk-guard.mjs`) hand-transcribed the backfill's SQL inline instead of reading it from the migration file, so it could not detect a future hand-edit to that file; confirmed by stripping the EXISTS guard from the real file and re-running the probe unchanged, which still reported ALL GREEN (it never touched the file under test). Fixed same day: the probe now reads the migration with `readFileSync` and executes that exact text as its primary check (must not 23503 against the orphan fixture), with the pre-fix regression demo mechanically derived from the same text (the guard clause stripped by a targeted regex, not retyped by hand) rather than hand-typed, and fails loudly instead of skipping if that clause's exact wording ever changes. Re-verified both ways: guard present in the real file → ALL GREEN (5/5); guard removed by hand → correctly FAILS, then restored (`git diff` = 0 lines).]** Q1 and Q2 (whether/how to backfill `low_stock_channels`/`financial_reports_channels` defaults for existing rows) remain open — genuinely the founder's call, not filed as a new OD per this wave's "prefer no new OD rows"; see the wave-5 notify report. **[Corrected 2026-09-19, same day, CLAUDE.md §5b (independent-verifier finding, BLOCKING) — "Q1 ... remain[s] open" was false: the founder had ALREADY answered Q1, in the same 19-lane blocking round this wave's own rows draw from (`founder-sketch-decisions-106-115.md`, AskUserQuestion, 2026-09-19 ~09:20Z, verbatim): "low-stock = add 'email' to low_stock_channels column DEFAULT (small additive migration in the notify PR)." This wave's own R-item pass searched that exact file among its "6 founder-decision sources" and reported finding nothing — the search was not run, or its result was not read. Fixed same day, in the PR this decision named: migration `20260925160700_a_low_stock_warning_can_reach_an_inbox.sql` adds `email` to `low_stock_channels`' DEFAULT, mirroring row 46's `financial_reports_channels` shape (additive, existing rows untouched); a CLAIMS.jsonl row and a PGlite proof confirm it (an existing row keeps the old `{sms,push}` default, a new row created after the migration gets `{sms,push,email}`). Q2 — the STANDING rule of whether a widened default should also backfill rows already sitting at the old value — is a separate, general question ~~the founder has not answered for either column, and remains genuinely open; this correction does not touch it~~ **[Corrected 2026-09-19, later the same day, CLAUDE.md §5b — Q2 was answered a short time after this correction was written, same 19-lane blocking round, batch 4 (~10:00Z), verbatim: "channel-default standing rule = untouched rows follow a widened default, customised rows never touched." Built same session: migration `20260925160700`'s DEFAULT-widening ALTER is now followed by an `UPDATE ... WHERE low_stock_channels = ARRAY['sms','push']` that moves every row still holding exactly the prior default to the new one, leaving any customised row untouched — proven against PGlite (`p4-scratch/pglite-probe/notify-lane-low-stock-backfill.mjs`), not production. ~~`financial_reports_channels` (row 46's earlier widening, migration `20260925160600`) is NOT backfilled by this pass — the rule applies to it too, but that was outside this pass's task, flagged as a follow-up rather than silently actioned.~~ **[Corrected 2026-09-21, round-5 notify must-fix, CLAUDE.md §5b — done, same migration file this lane owns: `20260925160600` gained its own section 2 applying the same rule, proven against PGlite (`p4-scratch/pglite-probe/notify-lane-financial-backfill.mjs`) the same way, with a mutation-tested CLAIMS.jsonl row.]** Full text of both answers, with rationale and the rejected alternative, is in this file's Recipient routing (OD-121) bullet above and in `OPEN-DECISIONS.md`'s OD-121 entry — that is the durable record from here, not `lane-status-2026-09-18.md` or "the wave-5 notify report", both session-scratch files outside this repo.]** |
