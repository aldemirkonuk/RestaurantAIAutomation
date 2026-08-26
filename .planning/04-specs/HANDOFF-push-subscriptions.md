> **SUPERSEDED 2026-08-26 by [ADR 0027](../decisions/0027-push-recipients-are-not-resolved-here.md)
> and [`HANDOFF-od-95.md`](HANDOFF-od-95.md).**
>
> §5 and §6 were applied in #96 and are spent. **§4's recommendation — "repoint
> at `notification_preferences.push_subscription`, then rename" — is wrong and
> must not be acted on:** that column's only writer upserts
> `onConflict: "user_id"` while the table's only unique index is
> `(restaurant_id, user_id)`, so the write returns 42P10 and the column can
> never hold a value. The resolver's push branch was **deleted** instead.
>
> §1–3 are kept because they are the implementation record of #94, which ADR
> 0027 cites rather than reproduces. Read nothing else here as current.

# HANDOFF — `push_subscriptions`: the table should NOT be created

**Branch:** `fix/push-subs-observable` · **Date:** 2026-08-26
**Retire-to-write (CLAUDE.md §4):** this document **supersedes the
`push_subscriptions` row** of `.planning/04-specs/REGISTER-AUDIT-2026-08-26.md`
(§3a, line 395) and its follow-on paragraph at line 407. That row is correct that
the table is 404 and correct about the readers; it is **wrong to imply the remedy
is to create it**. Strike the row when this lands and let this file be the record.

**Founder actions required:** apply the OPEN-DECISIONS row in §5, append the
CLAIMS lines in §6. This session did not edit either file (both were merge
collision sources today).

---

## 1. The question that was asked

> Should `push_subscriptions` exist at all? Web push needs a subscription-
> registration endpoint, a VAPID key pair, and a sender. If nothing can ever
> write a row, creating the table produces a new lie.

## 2. The answer: **no — do not create it.** All three pieces exist, and they use a different table.

Web push in this repo is **fully wired end to end**. It does not use a
`push_subscriptions` table; it stores one subscription per user in the jsonb
column **`notification_preferences.push_subscription`**, which *is* in the
production baseline (`supabase/migrations/20260805000000_baseline_from_production.sql:3932`)
and *is* live (HTTP 200, 3 rows).

| Piece web push needs | Exists? | Where |
|---|---|---|
| Browser subscribe | yes | `packages/ui/src/lib/notifications.ts:202-229` (`pushManager.subscribe` with the VAPID key) |
| Registration call | yes | `apps/web/src/services/api/notifications.ts:252-259` → `POST /notifications/push/subscribe` |
| Registration endpoint | yes | `apps/api-gateway/src/notifications/notifications.controller.ts:278-289` |
| **The writer** | yes | `notifications.service.ts:178-208` — upserts into **`notification_preferences.push_subscription`** |
| VAPID key pair | yes | `notifications.service.ts:56-83` (`web-push`, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`) |
| **The sender** | yes | `notifications.service.ts:115-173` — reads **`notification_preferences.push_subscription`**, sends, and prunes on 410/404 |

So `push_subscriptions` is not an unbuilt feature's missing table. It is a
**storage model that was abandoned** — declared only in
`supabase/migrations_archive/20260208024921_baseline_schema.sql:316`, dropped by
the 2026-08-05 production snapshot, and never repointed in two readers that were
left behind.

**Creating it would be the new lie the brief warned about**, in its most exact
form: a table that the registration endpoint does not write to and the sender
does not read from, guaranteed empty forever, sitting next to a column that holds
the real data.

### Production evidence (curl, 2026-08-26, no secret echoed)

```
service_role -> push_subscriptions        HTTP 404
    {"code":"PGRST205", … "Could not find the table 'public.push_subscriptions' in the schema cache"}
anon         -> push_subscriptions        HTTP 404   (same PGRST205)

service_role -> notification_preferences  HTTP 200   content-range: 0-2/3
service_role -> …&push_subscription=not.is.null      HTTP 200   content-range: */0
anon         -> notification_preferences  HTTP 401   {"code":"42501","message":"permission denied for table notification_preferences"}
```

Two further facts that belong on the record:

- **Zero of the 3 `notification_preferences` rows have a non-null
  `push_subscription`.** Web push is built and reachable, but nobody has ever
  registered a device in production. It is *unused*, not *unbuilt* — a different
  and much cheaper problem.
- `notification_preferences` **already has the OD-72 anon revoke** (anon gets
  `42501`, not row-level filtering). Nothing to do there.

---

## 3. What was changed instead: the silence

The brief's step 2 was not optional either way, and it is where the actual defect
was. Both readers reported "the table is missing" as "this user has no devices".

### 3a. `apps/api-gateway/src/communications/recipient-resolver.service.ts`

The original six lines destructured `error`, never read it, and returned
`data || []` from a `try` whose `catch` could not fire:

```ts
const { data, error } = await client.from("push_subscriptions").select("id").eq("user_id", userId);
return (data || []).map((s: any) => s.id);   // error discarded
```

**The `catch` was unreachable in every failure mode**, which is worth stating
precisely because it is the reason nothing ever surfaced. supabase-js does not
throw on a PostgREST error — it *resolves* with `{ data: null, error }`:

- `postgrest-js/src/PostgrestBuilder.ts:82` — `shouldThrowOnError = false`
- `:529` — the only `throw` is gated on that flag
- `:366` — when the flag is false, even fetch/DNS failures are `.catch()`-ed into
  an error **result**, not a rejection

So a 404, a revoked grant and a dead network all arrived as a resolved value with
`data === null`, and `data || []` turned each into an empty recipient list.

**Now:** `error` is checked explicitly and raises `PushSubscriptionSourceError`,
which carries the table, the user id and the PostgREST code.

**Fail or degrade — decided deliberately, and split:**

- **Push was the only channel requested → throw.** There is nothing to degrade
  to. Returning `[]` would be the same lie in a new place: the caller records a
  successful send to nobody. Note the env fallback is *especially* wrong here —
  it answers a caller that asked for devices with email addresses.
- **Push was one of several channels → degrade, loudly.** One ERROR line per
  resolve under the greppable marker `PUSH_SUBSCRIPTIONS_UNREADABLE`
  (restaurant, user, table, PostgREST code), plus a new
  `ResolvedRecipients.pushUnavailable` field so the caller can tell "we could not
  look" from "we looked and found none". Throwing here instead would take email
  and SMS down with it: the outer `catch` collapses to `fallbackOrEmpty`, which
  discards every address already resolved — turning an undelivered push into an
  undelivered invoice, and re-entering the **OD-87 cross-tenant leak** through a
  new door. There is a test pinning exactly that.

Logged **once per resolve, not once per user**: the failure is a property of the
source, and N identical ERROR lines per notification would bury it.

### 3b. `services/agent-orchestrator/agents/notification_agent.py`

Same defect, one degree less silent — it logged, then returned `[]` anyway, which
is what made the log useless. postgrest-**py** does the opposite of postgrest-js:
it **raises** `APIError` on any non-2xx (`postgrest/_sync/request_builder.py:78`),
so a missing table, a revoked grant and a network failure all landed in one
`except Exception` and became "no devices".

The consequence was worse than the TypeScript side. All seven callers skipped
their push loop, appended nothing to `results`, and `_log_notification` computes
`success = all(r[1].get("success", False) for r in results)` — **over the legs
that remained**. A total push failure was therefore recorded as a *successful*
notification.

**Now:** `_get_push_subscriptions` raises `PushSubscriptionSourceError`; the seven
call sites (`:564, 645, 731, 802, 866, 926, 1028`) go through a new
`_push_targets`, which logs the `PUSH_SUBSCRIPTIONS_UNREADABLE` marker and
appends a failed push leg to `results`, flipping that `success` computation.

> **Caveat, not swept under:** `notification_logs` is **also 404** in production
> (verified by the same curl run; the audit's §3a line 397 is correct), and
> `_log_notification` swallows its own insert failure. So the appended leg does
> not reach a database *today*. The ERROR line is the observable that actually
> works right now. This is recorded, not fixed — it is a second missing table and
> a separate decision.

---

## 4. The fork this session did **not** take (founder's call)

Both readers are now loudly broken against a table that will never exist. That is
strictly better than silently wrong, but it is not an end state. Three options:

1. **Repoint at `notification_preferences.push_subscription`.** Makes the read
   *work*. Nearly free: `getNotificationPreferences` already `SELECT *`s that
   exact table for those exact user ids two lines earlier
   (`recipient-resolver.service.ts:346-366`), so the subscription is already in
   hand and the extra query disappears. **But** it changes what
   `pushSubscriptionIds` contains — subscription **ids** become push
   **endpoints** — and the field name would then be wrong.
2. **Delete the push branch from the resolver.** Defensible, because
   **nothing consumes `pushSubscriptionIds`.** Verified: the only occurrences in
   the repo are inside `recipient-resolver.service.ts`, one `[]` literal in
   `scheduled-tasks.service.ts:132`, and a spec. No caller reads it. Every live
   `resolveRecipients` call passes an explicit `channels` that never includes
   `"push"` (`scheduled-tasks.service.ts:192,241,285,329,407,483,556,609,676,775,814`;
   `low-stock-alerts.service.ts:660`) — though the **default** is
   `["email","sms","push"]`, so an omitting caller would hit it.
3. **Leave it loud** (what shipped). Honest, and cheap to revisit.

Not decided here, per CLAUDE.md §0.1: (1) is a design change to what a public
interface returns, and (2) deletes a field — neither is a defect fix, and the
session had no mandate for either.

**Recommendation: (1), then rename the field**, on the grounds that the send path
already proves `notification_preferences.push_subscription` is the real store and
the resolver is the only thing still pointed at the abandoned one. (2) is the
right answer only if push recipients are never meant to flow through this
resolver at all — which is arguable, since `NotificationsService.sendWebPush`
already resolves and sends its own.

---

## 5. Proposed OPEN-DECISIONS row — **founder to apply** (do not reuse an id; check the next free one at apply time)

```
| OD-92 | 🟡 **`push_subscriptions` must NOT be created — the table is an abandoned storage model, not a missing one.** Verified 2026-08-26: PostgREST returns **404 PGRST205** for it to both keys, while web push is fully built against **`notification_preferences.push_subscription`** (jsonb, present in the production baseline at `20260805000000_baseline_from_production.sql:3932`, HTTP 200, 3 rows). Registration endpoint (`notifications.controller.ts:278`), writer (`notifications.service.ts:178-208`), VAPID pair (`:56-83`) and sender (`:115-173`) all exist and all use that column. Creating the table would produce a permanently-empty second store next to the real one. **Shipped instead:** both readers made observable — `recipient-resolver.service.ts` checked `error` explicitly (supabase-js *resolves* PostgREST errors, `PostgrestBuilder.ts:82/:366/:529`, so its `catch` was unreachable and `data \|\| []` turned a 404 into "no devices"), and `notification_agent.py` raises instead of swallowing, with the seven call sites appending a failed push leg. 14 tests, each proved to fail against a revert. **Also found: 0 of 3 `notification_preferences` rows have a non-null `push_subscription`** — web push is unused, not unbuilt — and **`notification_logs` is also 404**, so the Python side's persisted failure leg has nowhere to land yet. | **Open fork:** repoint the resolver at `notification_preferences.push_subscription` (nearly free — that row is already fetched two lines earlier at `:346-366` — but `pushSubscriptionIds` would then hold endpoints, not ids, and needs renaming), **or** delete the push branch, since **nothing in the repo reads `pushSubscriptionIds`** and no live caller requests the `"push"` channel. Recommendation: repoint and rename. |
```

## 6. Proposed CLAIMS.jsonl lines — **founder to append**

```jsonl
{"id": "OD-92", "status": "resolved", "claim": "the push-subscription read checks `error` instead of discarding it — a PostgREST failure can no longer become an empty recipient list", "verify": "grep -q 'throw new PushSubscriptionSourceError' apps/api-gateway/src/communications/recipient-resolver.service.ts && test \"$(grep -c 'return (data || \\[\\]).map' apps/api-gateway/src/communications/recipient-resolver.service.ts)\" = 1", "verified": "2026-08-26"}
{"id": "OD-92", "status": "resolved", "claim": "no migration creates push_subscriptions — the table is deliberately absent, not pending", "verify": "test \"$(grep -rl push_subscriptions supabase/migrations | wc -l | tr -d ' ')\" = 0", "verified": "2026-08-26"}
{"id": "OD-92", "status": "resolved", "claim": "every notification_agent push call site goes through _push_targets, so an unreadable source records a failed leg rather than silently skipping", "verify": "test \"$(grep -c '_push_targets(manager\\[\"id\"\\], results)' services/agent-orchestrator/agents/notification_agent.py)\" = 7", "verified": "2026-08-26"}
{"id": "OD-92", "status": "open", "claim": "pushSubscriptionIds is still dead — nothing outside the resolver and its specs reads it; the repoint-or-delete fork is unresolved", "verify": "test \"$(grep -rl 'pushSubscriptionIds' apps --include='*.ts' | grep -v node_modules | grep -vE 'recipient-resolver.service.ts|scheduled-tasks.service.ts|\\.spec\\.ts' | wc -l | tr -d ' ')\" = 0", "verified": "2026-08-26"}
```

## 7. Verification run for this branch

- `apps/api-gateway`: `npx tsc --noEmit` clean; full suite **1211 passed, 11 skipped, 0 failed** (91 suites).
- `services/agent-orchestrator`: full suite **892 passed, 54 skipped, 0 failed**.
- New tests: 8 TypeScript (`push-subscription-silence.spec.ts`), 6 Python
  (`test_push_subscription_silence.py`). Each file was run against a temporary
  revert of its own fix: **4 of 8** and **3 of 6** failed, and the remainder are
  the deliberate guards that must pass in *both* states (`[]` still means `[]`;
  a successful read still returns rows; email/SMS survive a push failure) — they
  are what stops "throw unconditionally" from passing as a fix.
- No migration was written, by design. Nothing was applied to production.
