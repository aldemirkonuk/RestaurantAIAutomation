# HANDOFF — OD-95 resolved by deletion (ADR 0027)

**Branch:** `fix/od-95-push-subscription-source` · **Date:** 2026-08-26
**Decision:** [`0027-push-recipients-are-not-resolved-here.md`](../decisions/0027-push-recipients-are-not-resolved-here.md)

**Retire-to-write (CLAUDE.md §4):** this document and ADR 0027 supersede
`.planning/04-specs/HANDOFF-push-subscriptions.md`, which now carries a
supersession header. Its §4 fork is resolved *against* its own recommendation;
its §5–6 registers were spent in #96. Its §1–3 are left in place as the
implementation record of #94, which ADR 0027 cites rather than reproduces.

Stated plainly rather than dressed up: this is **two documents added and one
superseded, so the corpus grows by one.** The alternative was to fold this
handoff into the ADR, which would have put a CI-red warning and three verbatim
`CLAIMS.jsonl` lines meant for another agent inside a decision record. If the
register edits in §3 and §4 land and the two forks in §5 are filed, this file
has no remaining purpose and should be deleted along with
`HANDOFF-push-subscriptions.md`.

**This session did not edit `OPEN-DECISIONS.md` or `CLAIMS.jsonl`** — both are
owned by a concurrent agent. Everything they need is below, verbatim.

---

## 1. ⚠️ CI IS RED UNTIL §3 IS APPLIED

`scripts/check_decision_claims.sh` (CI: `.github/workflows/ci.yml:156`) fails on
this branch:

```
== Decision claims: 83 checked, 82 holding
== REGRESSED (1) — a resolved decision no longer holds
   OD-95 — the push-subscription read checks `error` instead of discarding it …
FAIL — a decision this repo considers settled has come undone.
```

That is **correct behaviour, not a defect**: the claim pins
`PushSubscriptionSourceError`, which this change deletes. The guard is doing its
job. It needs the supersession in §3, and only the CLAIMS owner can apply it.

---

## 2. What changed

`RecipientResolverService` no longer resolves push recipients at all. Removed:
`pushSubscriptionIds`, `pushUnavailable`, `PushSubscriptionSourceError`,
`PUSH_SUBSCRIPTION_TABLE`, `getPushSubscriptions`, and `"push"` from
`NotificationChannel` — so asking for push is now a compile error rather than an
empty array. `scheduled-tasks.service.ts:132`'s `pushSubscriptionIds: []` literal
and the `scheduled-tenants.spec.ts` mock's copy of it went with it.

`push-subscription-silence.spec.ts` (8 tests, #94) is replaced by
`push-is-not-resolved-here.spec.ts` (8 tests). `check_queried_tables_exist.py`'s
`push_subscriptions` debt entry was rewritten (it named the now-deleted TS
reader and predicted a migration that must never be written) and
`DYNAMIC_CEILING` lowered 25 → 24.

**The evidence that decided it against the standing "repoint and rename"
recommendation** — full argument in ADR 0027, the one new fact here:
`notification_preferences.push_subscription` **has no working writer**. Its only
writer upserts `onConflict: "user_id"`; the table's only unique index is
`(restaurant_id, user_id)`. Verified against production under `EXPLAIN`
(nothing written):

```
ERROR:  42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification
```

Already known and deliberately open —
`supabase/migrations/20260813090000_fix_remaining_upsert_targets.sql` §3. So
repointing would have swapped a loud 404 for a permanently-empty read that looks
successful, which ADR 0020 forbids.

---

## 3. `CLAIMS.jsonl` — founder / CLAIMS owner to apply

**Replace line 75** (the regressed one). The guarantee is preserved, not dropped:
"a missing source is never reported as zero devices" now holds because there is
no source, no read, and no field.

```jsonl
{"id": "OD-95", "status": "resolved", "claim": "the resolver holds no push read at all — the branch that turned a PostgREST failure into an empty recipient list was deleted, not repointed (ADR 0027)", "verify": "! grep -qE 'PUSH_SUBSCRIPTION_TABLE|getPushSubscriptions|PushSubscriptionSourceError|pushSubscriptionIds' apps/api-gateway/src/communications/recipient-resolver.service.ts", "verified": "2026-08-26"}
```

> Note for whoever applies it — this was got wrong once while drafting, so it is
> spelled out: **do not add `push_subscriptions` to that pattern.** The
> resolver's comments explain at length why the table must not be used, so the
> bare table name still appears in the file (once, in prose) and a pattern
> including it fails against the *fixed* tree. The four identifiers above are
> code-only and are all absent now; all four are present on a revert, so the
> claim fails there. Verified in both states. The comment-stripping version of
> the same assertion lives in `push-is-not-resolved-here.spec.ts`.

**Replace line 78.** Its text already anticipated this outcome ("*or the field
has been removed*") but its `verify` only implemented the other branch, so it
cannot pass now:

```jsonl
{"id": "OD-95", "status": "resolved", "claim": "pushSubscriptionIds is gone from the gateway — the OD-95 fork was resolved by deletion, not by finding it a consumer", "verify": "test \"$(grep -rl 'pushSubscriptionIds' apps --include='*.ts' | grep -v node_modules | grep -v '\\.spec\\.ts' | wc -l | tr -d ' ')\" = 0", "verified": "2026-08-26"}
```

Measured now: **0**. Measured against a revert: **2**
(`recipient-resolver.service.ts`, `scheduled-tasks.service.ts`).

**Lines 76 and 77 still hold and need no edit** — "no migration creates
push_subscriptions" and "every notification_agent push call site goes through
_push_targets". Line 77 covers the Python reader, which is untouched.

**Append one new line** for the channel union:

```jsonl
{"id": "OD-95", "status": "resolved", "claim": "asking the recipient resolver for the push channel is a compile error, not an empty array", "verify": "grep -q 'export type NotificationChannel = \"email\" | \"sms\";' apps/api-gateway/src/communications/recipient-resolver.service.ts", "verified": "2026-08-26"}
```

---

## 4. `OPEN-DECISIONS.md` — founder to apply

OD-95 moves 🟡 → resolved. Suggested replacement for the status/fork cells of the
existing row (line 68 at time of writing), keeping the evidence that is still
true:

> **Resolved 2026-08-26 by [ADR 0027](../decisions/0027-push-recipients-are-not-resolved-here.md) — deleted, not repointed.** The recommendation on the record was "repoint at `notification_preferences.push_subscription` and rename". It does not survive: that column's only writer upserts `onConflict: "user_id"` while the table's only unique index is `(restaurant_id, user_id)`, so Postgres answers **42P10** and the statement cannot even be planned (verified against production under `EXPLAIN`, 2026-08-26; held open by `supabase/migrations/20260813090000_fix_remaining_upsert_targets.sql` §3). Repointing would have replaced a loud 404 with a permanently-empty read that looks successful. It would also have been unusable: **both push senders take USER IDS and enumerate devices themselves** — `sendWebPush(userId, …)` over `notification_preferences.push_subscription`, `ExpoPushService.sendToUsers(userIds, …)` over `mobile_devices` — so no device-shaped value both would accept exists. `pushSubscriptionIds`, `pushUnavailable`, `PushSubscriptionSourceError` and `"push"` in `NotificationChannel` are all removed; asking for push is now a compile error. 8 tests, 6 proved to fail against a revert. `push_subscriptions` stays on the `check_queried_tables_exist.py` debt list **only** because `notification_agent.py:1615` still queries it. | **Two forks opened by this, both new rows below.** |

---

## 5. Two new open decisions this raised

Filed here rather than assumed. Neither is a consequence of the deletion; both
were found by it.

### OD-NEW-A — No spec file in the gateway is type-checked by anything

`apps/api-gateway/tsconfig.json:24` sets `"exclude": [… "**/*.spec.ts"]`, and
`package.json`'s ts-jest transform runs with `"isolatedModules": true`. So
`tsc --noEmit` never reads a spec, and jest transpiles without type-checking
one. **~95 spec files have no type checking at all.**

Found the hard way: the first version of this change's channel-union test used
`@ts-expect-error`, and **passed identically against a full revert of the
deletion** — a test that structurally could not report failure, which is this
repo's signature defect. It was replaced with a source-text assertion that does
fail (see `push-is-not-resolved-here.spec.ts`, and commit
`test(notifications): replace a type guard that could not fail with one that can`).

The fork: drop the `**/*.spec.ts` exclusion (and find out how many type errors
are hiding), add a second `tsconfig.spec.json` checked separately in CI, or
record the gap as accepted. Not decided here — it is a repo-wide CI change.

### OD-NEW-B — `notification_agent.py` still reads `push_subscriptions`

Deliberately out of scope. Unlike the resolver's field, the Python path is
**live-but-broken rather than dead**: `_push_targets` appends a failed push leg
that feeds `_log_notification`'s `success` flag, so deleting it changes recorded
behaviour rather than removing an inert field. It also has the same three
candidate targets and the same 42P10 problem, plus its own caveat that
`notification_logs` is 404 so the leg does not currently persist. It deserves
the same treatment as this ADR gave the resolver, as its own operation.

---

## 6. Verification

- `apps/api-gateway`: `npx tsc --noEmit` **clean**; full suite **1234 passed,
  11 skipped, 0 failed** (94 suites).
- `scripts/check_queried_tables_exist.py`: **PASS**, 24 call sites, ceiling 24.
  Proved to **FAIL** against a revert (`the unresolvable set grew from 24 to 25`).
- `scripts/check_decision_claims.sh`: **FAIL (1 regressed)** — expected, see §1.
- `push-is-not-resolved-here.spec.ts`: 8 tests. Against a revert of the two
  source files, **6 failed and 2 passed**. The 6 are marked `[REVERT-FAILS]`;
  the 2 that pass in both states are the deliberate anti-vacuity guards (email
  and SMS still resolve; the OD-87 tenant fallback still refuses), without which
  deleting the whole service would satisfy the suite.
- Production reads were `SELECT`/`EXPLAIN` only. Nothing was written; no
  migration was authored.
