# 0027 — Delete the resolver's push branch; push recipients are user ids, not devices

- **Status:** Proposed
- **Date:** 2026-08-26
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** push, web push, push_subscriptions, notification_preferences, recipient resolver, OD-95, dead field, 42P10
- **Links:** `[[0020-no-fabricated-answers]]`, `[[0022-scheduled-jobs-serve-opted-in-tenants]]`, `[[0026-schema-has-one-home]]`, OD-95, PR #94, `.planning/04-specs/HANDOFF-push-subscriptions.md`, `supabase/migrations/20260813090000_fix_remaining_upsert_targets.sql`

## Context

`RecipientResolverService.resolveRecipients` returned a `pushSubscriptionIds:
string[]` populated from a `push_subscriptions` table. #94 established that the
table does not exist in production and made the read raise
`PushSubscriptionSourceError` instead of silently returning `[]`. It deliberately
stopped short of deciding what should happen to the field, and left the fork
open as OD-95: **repoint the read at `notification_preferences.push_subscription`,
or delete the field.** The standing recommendation, recorded in
`.planning/04-specs/HANDOFF-push-subscriptions.md` §4, was to repoint and rename.

Four things were established before choosing. Each is evidence, not inference.

**1. No live caller asks for the `"push"` channel.** There are exactly two
production call sites. `low-stock-alerts.service.ts:660` passes
`channels: ["email"]`. `scheduled-tasks.service.ts` funnels all nine of its jobs
through `recipientsFor`, whose ten call sites pass `["sms"]`, `["email"]`, or
`["email","sms"]` (`:192, :241, :285, :329, :407, :483, :556, :609, :676, :775`).
The convenience methods `getManagerEmails` / `getStaffEmails` pass `["email"]`.
Nothing in the repo requests push. The union's default was
`["email","sms","push"]`, so an *omitting* caller would have reached the branch —
but no such caller exists.

**2. Nothing reads the field.** `pushSubscriptionIds` appeared only inside the
resolver, in the resolver's own spec, and as one literal `pushSubscriptionIds: []`
at `scheduled-tasks.service.ts:132` that exists solely to satisfy the interface.
No consumer, in TypeScript or Python.

**3. The repoint target has no working writer.** This is the fact that decided
it, and it was not on the record before. `notification_preferences` has exactly
two unique indexes — `(id)` and `(restaurant_id, user_id)`. Its only writer,
`NotificationsService.registerPushSubscription` (`notifications.service.ts:192`),
upserts with `onConflict: "user_id"`. Verified against production on 2026-08-26
by running the statement PostgREST emits, under `EXPLAIN` so nothing was written:

```
ERROR:  42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification
```

The statement cannot even be *planned*. The column has therefore never been
writable by the application, which is why zero of the three
`notification_preferences` rows carry a subscription — web push is not "built but
unused", its registration path has never once succeeded. This is already known
and deliberately open: `supabase/migrations/20260813090000_fix_remaining_upsert_targets.sql`
§3 diagnosed the same 42P10 and left it unfixed because whether preferences are
per-user or per-(restaurant, user) is a product decision.

Repointing would therefore have moved the resolver from *reads a table that does
not exist* (loud, 404) to *reads a column no writer can populate* (silent, always
empty, indistinguishable from success). That is precisely the failure mode
[[0020-no-fabricated-answers]] exists to forbid.

**4. A repoint would not merely duplicate the sender — it would produce an
unusable shape.** `NotificationsService.sendWebPush(userId, payload)`
(`:115-173`) takes a **user id** and reads `notification_preferences
.push_subscription` itself. `ExpoPushService.sendToUsers(userIds, payload)`
(`push/expo-push.service.ts:70-90`) takes **user ids** and reads
`mobile_devices.expo_push_token` itself. Neither accepts a subscription id, an
endpoint, or a token from outside; `web-push` needs the whole `PushSubscription`
object (endpoint *and* keys), so a list of endpoints would not even be sendable.
There are three distinct push stores and two senders, and no single device-shaped
value the resolver could return that both senders would take.

So the answer to "is this duplication or a legitimate separation of *who should
be told* from *how to tell them*?" is: it would be duplication, but that is the
lesser objection. **In this codebase the unit of push address already *is* the
user id.** Device enumeration belongs to the sender, and both senders implement
it, including the 410/404 pruning that a second reader would have to duplicate.
A resolver that returned devices would be answering a question neither sender
asks.

## Options considered

1. **Repoint at `notification_preferences.push_subscription`, rename the field to
   endpoints.** Appealing because that column is the real store and the row is
   already fetched two lines earlier by `getNotificationPreferences`, so the
   extra query disappears. Costs: the target is unwritable (42P10, above), so it
   returns empty forever while *looking* successful; the value is unusable by
   either sender; it adds a second reader of a column the sender already prunes;
   and it silently picks a side of the still-open per-user vs per-(restaurant,
   user) question, because the resolver would read by `user_id` while the table
   is keyed by both. **Rejected — it converts a loud wrong answer into a quiet one.**

2. **Delete the push branch and the field.** Costs: removes a surface a future
   push feature might have wanted, and deletes six tests that pinned #94's
   loud-failure behaviour. Gains: no reader of an abandoned store; no field that
   can only ever be empty; `"push"` leaves `NotificationChannel`, so asking for
   it is a compile error rather than an empty array.

3. **Leave it loud (do nothing).** What #94 shipped. Honest, and it was the right
   place to stop then. Costs: the resolver keeps a documented reader of a table
   that must never exist, and every future reader of this file has to re-derive
   the same four findings to know it is inert. It also keeps `push_subscriptions`
   alive in the gateway's grep surface, which is how abandoned models get
   resurrected. **Rejected — "kept warm" is the state [[0020-no-fabricated-answers]] rules out.**

4. **Delete the device field and add a `userIds` output**, so push recipients
   could flow through the resolver in the shape both senders accept. Not taken:
   nothing asks for it today, and adding an output is a design addition rather
   than the resolution of this fork. Named here so it is not mistaken for a
   consequence of the deletion. **Deferred, not rejected.**

## Decision

**Delete it.** `pushSubscriptionIds`, `pushUnavailable`,
`PushSubscriptionSourceError`, `PUSH_SUBSCRIPTION_TABLE` and `getPushSubscriptions`
are removed from `recipient-resolver.service.ts`, and `"push"` is removed from
`NotificationChannel` so that asking this resolver for push does not compile.

The reasoning that carried it: every candidate repoint target fails a different
test. `push_subscriptions` does not exist and must not be created.
`notification_preferences.push_subscription` cannot be written. `mobile_devices`
belongs to a different sender. And all three are moot, because both senders
resolve devices from a user id themselves — there is no shape for this field to
hold that anything would consume. A field with no possible value and no possible
consumer is not an unfinished feature; it is a description of a design that was
abandoned, and the honest form of that description is its absence plus a comment
saying why.

The deletion carries the *why* forward rather than dropping it: the
`NotificationChannel` declaration now documents all three stores, both senders,
and the 42P10, so the next reader does not re-derive this.

## Consequences

- **Easier:** `ResolvedRecipients` is `{ emails, phones }` — every field it
  declares can hold a value. A future push feature gets a compile error pointing
  at this ADR instead of an empty array that looks like an answer.
- **Given up:** if push recipients should flow through this resolver, that work
  is now an addition (option 4) rather than a repair. The correct addition is
  `userIds`, not devices.
- **Out of scope, still true:** `notification_agent.py` still queries
  `push_subscriptions` (`:1615`) and is untouched — its failed push leg feeds
  `_log_notification`'s `success` flag, so unlike the resolver's field it is
  live-but-broken rather than dead, and deserves its own decision. It is why the
  `push_subscriptions` entry stays on the `check_queried_tables_exist.py` debt
  list, whose text and `DYNAMIC_CEILING` (25 → 24) were updated to say so.
- **Found in passing, not fixed:** `apps/api-gateway/tsconfig.json:24` excludes
  `**/*.spec.ts`, and ts-jest runs with `isolatedModules: true`. **No spec file
  in the gateway is type-checked by anything.** This was found because the first
  version of the replacement test used `@ts-expect-error` and passed identically
  against a full revert. Worth its own decision; ~95 spec files are affected.
- **Also standing:** the 42P10 on `notification_preferences` remains open, and
  web push cannot work until it is settled. This ADR does not settle it — it
  removes a reader that was pointed at the wrong thing regardless of how that
  question is answered.
- **Revisit when:** anything asks for push recipients by anything other than a
  user id, or when the 42P10 fork is settled and `push_subscription` becomes
  writable *and* a caller wants push routed by role rather than by user.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-26 | — | Created; supersedes the "repoint and rename" recommendation in `.planning/04-specs/HANDOFF-push-subscriptions.md` §4 |
