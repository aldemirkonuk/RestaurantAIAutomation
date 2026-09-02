# 0088 — A team change is recorded, and a wage is not invented

- **Status:** Locked
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — three calls made directly (T1, T2, and the
  brief that framed T3/T5/T7 as "make the unsafe thing impossible or loud")
- **Keywords:** team, roster, wage, labor cost, audit, system_audit_log, broadcast,
  opt-out, notification_preferences, assertAccess, user_restaurant_access, CHECK,
  copy-week, schedule receipts, swap_requests, tenant scoping
- **Links:** [[0051-rebuilt-pages-show-live-data-only]], [[0020-no-fabricated-answers]],
  [[0080-the-app-does-not-invent-cellar-zones]], [[0027-push-recipients-are-not-resolved-here]],
  `.planning/06-pages/team.md`, `supabase/migrations/20260902200000_team_access_role_is_a_known_role.sql`

## Context

The `/team` gateway was audited on 2026-09-02. Seven defects were found, and the
domain is almost entirely empty in production — `coverage_templates`, `schedules`,
`shifts`, `team_certifications`, `server_sales`, `team_settings` and
`schedule_receipts` all hold **0 rows**. Only the 11-row roster exists.

That emptiness is the argument for fixing it now, not for deferring it: none of
these defects is observable yet, so nothing has to be repaired, only prevented.
It is also the trap — a green test over an empty table proves nothing, which is
why every claim below carries a production measurement or a test that failed
against the pre-fix tree.

**T1 — the server invented every wage in the database.**
`team.service.ts:205-207`, inside `ensureRosterFromAccess` (called on every
`listMembers`):

```
// Seed mock wage so labor lens has something when tracking is on;
hourly_wage: a.role === "staff" ? 22 : a.role === "manager" ? 28 : 32,
```

Measured on production `exzueerziesmczwlhomd`, 2026-09-02: **11 of 11
`team_members` rows carry exactly those literals** — 8 at $32.00 (owner), 3 at
$28.00 (manager), two distinct values, zero nulls. Not a fallback for missing
data; the entire dataset. It is the sole input to `laborCost()`
(`schedule.service.ts:297-313`) → `shifts.labor_cost` → the week total, the
Tonight-labor pulse, the per-shift labour lens, and the "Labor cost" column of
the CSV export.

**T2 — access changed with no record.** `deleteMember`
(`team.service.ts:366-371`) deletes the target's `user_restaurant_access` row
under manager auth, presented in the UI as "remove from your team". The role
change lives elsewhere (`restaurants/members.service.ts:118-158`), is
owner-gated, protects only the last-owner case, and then performs two bare
UPDATEs. Neither wrote an audit row, notified the person, or captured a
before-state. `assertAccess(..., "owner")` is defined at `:71-72` and called
nowhere in the module.

**T3 — a "message one person" control that messaged everyone.**
`team.controller.ts:347`: with no `memberIds`, the broadcast targeted every
active linked member, and the response (`{notified, emailed, texted}`) looked the
same either way.

**T4 — an opt-out only one sender honoured.** The broadcast mapped roster emails
and phones straight to Gmail and Plivo, while the scheduled mailer resolves
through `communications/recipient-resolver.service.ts:144-163` and drops a user
who turned the channel off. Production holds 3 `notification_preferences` rows.

**T5 — authorisation defaults that escalate.** `assertAccess`
(`team.service.ts:56-64`) fell back to `users.restaurant_id` + `users.role`, and
`users.role` is `varchar(20) DEFAULT 'manager' NOT NULL` (baseline `:5854`) — so
a user row with a restaurant id and an untouched role was a **manager** of
`/team`. `user_restaurant_access.role` is `varchar(50) DEFAULT 'manager'` with no
CHECK (baseline `:5814`), and every reader compares it exactly (`=== "owner"`,
`.in("role", roles)`), so one mis-cased write silences that user's notifications
permanently with nothing to catch it. `listCertifications` (`:397`) had no role
requirement at all and `listTimeOff` (`:477`) exposed every member's dates **and
free-text reasons** to any member.

**T6 — two unscoped reads and a dead route.** `weekStartOfSchedule`
(`schedule.service.ts:710-717`) selected a schedule by caller-supplied id with no
restaurant filter *and* fell back to the current Monday when it found nothing;
`recomputeCostForMember` (`:605-609`) re-read the shift unscoped;
`GET …/team/swaps` had no client caller, and `swap_requests` has no writer
anywhere in the repository.

**T7 — destruction with no contract.** `copy-week` DELETEs the entire target
week before inserting (`:202-207`); re-publishing wipes every `schedule_receipts`
row (`:248-251`). Both are one client click, and neither the request nor the
response mentioned it.

Five of the seven are the same shape as [[absence-reported-as-health]]: an
omission read as a decision. No `memberIds` meant *everyone*. No preferences row
meant *send*. No URA row meant *manager*. No schedule found meant *this week*.
No `labor_cost` meant *zero*.

## Options considered

**T1 — the invented wage.**
1. **Leave it.** The labour lens shows numbers today. It shows *fiction* today,
   contradicting ADR 0051, which the founder locked one day earlier.
2. **Null the wage only.** Stops the invention at source — and moves it: with
   every wage null, `computeLabor`'s `Number(sh.labor_cost ?? 0)` renders the
   week as **$0**, an unknown wearing a measurement's clothes.
3. **Null the wage AND make the total refuse to be partial.** More work, and the
   page gets emptier. Chosen.

**T2 — removal and role change.**
1. **Restrict removal to owners.** The obvious move, and the wrong one: it does
   not answer "who removed this person?", it only narrows the suspect list, and
   it breaks the manager workflow that exists today.
2. **Record it and tell the person.** Chosen by the founder.
3. **Both.** Rejected: the restriction buys nothing once the record exists.

**T3 — the untargeted broadcast.**
1. **Keep "everyone" as the default, add a recipient count to the response.**
   Cheapest, no caller breaks. But the count arrives *after* the message did.
2. **Require an explicit audience.** The ambiguous call becomes a 400 before
   anything is sent. Costs the legacy caller one field.
3. **Require `memberIds` always.** Kills the legitimate crew announcement.

**T5 — the `users.role` fallback.**
1. **Delete the fallback.** Measured first: exactly **1** production user has a
   `restaurant_id` and no `user_restaurant_access` row at all. Deleting the
   fallback locks that person out.
2. **Keep the fallback, floor the role at `staff`.** The legacy row proves
   membership; it cannot prove privilege, because the column's DEFAULT is the
   value it carries.
3. **Leave it.** Privilege by omission, indefinitely.

**T5 — the unconstrained role column.** A CHECK, or nothing. Measured before
writing: 11 URA rows, 8 `owner` + 3 `manager`, **0** outside the three known
roles and 0 NULL, so the constraint passes today.

**T7 — the destructive verbs.**
1. **Return what was destroyed.** Honest, but the loss has already happened.
2. **Require an explicit flag.** Stops it, at the cost of a 409 the client must
   handle.
3. **Both.** Chosen — the flag prevents the accident, the count lets a caller
   report the outcome truthfully when it was deliberate.

## Decision

**A `/team` write says what it did, and never writes a number nobody supplied.**

- **T1.** `ensureRosterFromAccess` writes `hourly_wage: null`. The backfill stays
  — creating an ops profile from an access row is real work — only the invented
  number goes. `computeLabor` returns `totalCost: null` until **every**
  member-assigned shift carries a cost, plus `costComplete`, `pricedShifts` and
  `unpricedShifts` so a caller can say *why* it is unknown. `getSettings` returns
  `labor_target_pct: null` and `configured: false` when no row exists, instead of
  a 28% target nobody chose, and `computeLabor` no longer re-defaults it.
- **T2.** Both paths call one function, `team/access-audit.ts`, which writes a
  `system_audit_log` row (actor, target, entity, before → after) and a
  notification to the person, and returns a receipt saying whether each write
  succeeded. The receipt is returned to the client. **Removal stays
  manager-gated.** `actor_id` is `public.users.user_id` — the id the JWT carries;
  `auth.users` is a disjoint table here and an id from it would dangle where no
  FK and no CI check could catch it.
- **T3.** Exactly one of `memberIds` or `audience: "everyone"` is required; both
  together, or neither, is a 400 **before** anything is sent. The response names
  its `audience` and its reach. Both halves: the flag stops the wrong send, the
  count lets a caller notice a right send that was bigger than it meant.
- **T4.** The broadcast filters its email and SMS lists through
  `notification_preferences.email_enabled` / `.sms_enabled`, and reports
  `suppressed: {email, sms}`. A **failed** preferences read is not "nobody opted
  out": both channel legs are skipped and `preferencesUnavailable` is returned.
  It does **not** mirror the resolver's rule — see the finding below.
- **T5.** The `users` fallback proves membership only — the role is `staff`
  regardless of `users.role`. `listCertifications` and `listTimeOff` are scoped
  to the caller's own member row for staff, full for managers (scoping rather
  than a 403, because "when does my card expire?" is a real staff question). A
  migration adds `CHECK (role IN ('owner','manager','staff'))` to
  `user_restaurant_access` and flips its DEFAULT to `'staff'`.
- **T6.** `weekStartOfSchedule` takes a `restaurantId` and throws `NotFound`
  rather than defaulting to the current week; `recomputeCostForMember` is
  restaurant-scoped; `GET …/team/swaps` and `listSwaps` are deleted.
- **T7.** `copy-week` refuses a non-empty target week with a 409 naming the count
  unless `replaceTarget: true`, and always returns `deleted`. `publish` refuses to
  clear read receipts on a re-publish unless `resetReceipts: true`, and always
  returns `receiptsCleared`.

**The reasoning that carried the whole set:** each fix makes a *silent* wrong
answer into a *loud* one. Nulling the wage without fixing the sum would have
moved the lie rather than removed it; restricting removal without recording it
would have narrowed the suspect list without naming anyone; counting a broadcast's
recipients without requiring an audience would have described the accident
accurately after it happened.

### What was decided against, deliberately

- **Changing `users.role`'s own DEFAULT.** It is read by paths outside `/team`.
  The `/team` read is fixed instead; the column is a wider decision.
- **`NOT NULL` on `user_restaurant_access.role`.** A NULL role already fails
  closed everywhere it is read, so it would buy no safety and add a 500 path.
- **Routing the broadcast through `RecipientResolverService`.** Its public entry
  point addresses people by role, `RecipientRole` has no `"owner"`, and
  production is 8 owners to 3 managers — so it would silently drop every owner.
  It also falls back to the global `MANAGER_EMAIL` when a restaurant resolves to
  nobody (OD-87).
- **Mirroring the resolver's opt-out rule.** This was the plan, so that an
  opt-out would mean one thing on both paths. See the finding below: the rule is
  measurably wrong, and shipping a second caller of it would have been worse than
  the divergence it was meant to avoid.

## Finding: the opt-out register is backwards, and it is not this module's file

Writing T4's rule down named its columns out loud, and
`scripts/check_read_columns_exist.py` (ADR 0074) **refused the read** —
`notification_preferences.order_channels` and `.report_channels` do not exist.
The real columns are `order_approval_channels` and `financial_reports_channels`.

`RecipientResolverService.checkChannelPreference`
(`communications/recipient-resolver.service.ts:343-368`) reads all three names,
and never noticed: it issues `.select("*")` and then reads the fields off the row
in JavaScript, where a column that does not exist is `undefined`. PostgREST is
never asked for them, so nothing errors.

Traced over the three production rows (measured 2026-09-02 — all three
identical: `email_enabled true`, `sms_enabled false`, `low_stock_channels
['sms','push']`, which is the column DEFAULT):

- **`email` → `false`.** The two phantom arrays are `undefined`, so the
  "nothing configured" branch cannot fire (`low_stock_channels` is truthy),
  `['sms','push']` has no `email`, and the user is refused — although
  `email_enabled` is `true` and `order_approval_channels` contains `'email'`.
- **`sms` → `true`.** `low_stock_channels` contains `sms` — although
  `sms_enabled` is `false`.

The register denies a channel nobody declined and permits one they did, for
every user who has a row. It is a *read* fault (class R): no bad row is written,
but every scheduled job that resolves recipients has been doing this.

`communications/**` is another session's file, so it is **reported, not edited
here**. `team/broadcast-preferences.ts` reads `email_enabled` / `sms_enabled`
instead — columns that exist, that state exactly whether the person wants email
or SMS, and that are the only preference a *crew broadcast* could be governed by,
since every category array is named for low stock, orders, deliveries, reports or
calendar reminders and a message from your manager is none of those.

## Consequences

- **Easier:** `/team` stops being able to state a wage, a labour total or a
  target that nobody supplied; a removal and a role change can be traced on the
  `/logs` timeline, which already reads `system_audit_log`; a mis-cased role
  becomes an insert error instead of a permanently silent user.
- **Harder — and this is the intended trade:** the labour figure will read `—`
  for every restaurant until someone enters real wages, because there are none.
  ADR 0051 says that is correct and "should not be argued back".
- **Given up (client work this creates, deliberately split):** `copy-week` and
  re-`publish` now answer 409 until the web client sends the confirmation flag,
  and the legacy Manager Shift Desk's broadcast answers 400 until it sends an
  audience. Those clients live in `apps/web` and are a sibling session's half of
  the same fix; **until both land, those three controls are broken in the UI.**
- **Residual, named not hidden:** `team_settings.labor_target_pct` is
  `numeric(5,2) DEFAULT 28 NOT NULL`, so the first restaurant to toggle
  `wage_visible` still gets a stored 28 it never chose. The table has 0 rows;
  making the column nullable is a separate migration, recorded in
  `.planning/06-pages/team.md` §9.
- **Residual — the divergence is real and deliberate:** the broadcast honours
  `email_enabled`/`sms_enabled`; the scheduled jobs still run the resolver's
  phantom-column rule. Two paths now disagree *more* than before, and that is
  the right way round: one of them is measurably wrong and lives in a file this
  session does not own. Closing it means fixing
  `recipient-resolver.service.ts:343-368`, at which point this helper should be
  re-read against it.
- **Revisit when:** a swap workflow is actually built (the table is still there,
  it needs a writer first), or when `apps/api-gateway/src/team` is no longer the
  only triaged root in the guard's `SERVER_SCAN_ROOTS`.

## The guard

`scripts/check_no_seeded_defaults.py` (ADR 0080) already existed for this class
and **did not catch T1** — its own header says it "does not read
`apps/api-gateway`". It was extended rather than duplicated: a fifth rule, S5,
with its own scan roots, its own vocabulary and its own reporting section.

The first version of S5 was anchored on `.insert({…})` and returned **zero hits**
against the pre-fix file, because the defect builds its row inside a `.map()` and
inserts the array many lines later. The shipped rule is anchored on the row shape
itself (three or more snake_case keys) and fires on a measurement-vocabulary key
whose value is *wholly* literal — `x ?? 1` is excluded, because one branch is a
caller value.

Proven: exit **1** against the pre-fix line restored in place, exit **0** on the
fixed tree, exit **2** on a missing root or pin, `--self-test` green including
two cases that inject the pre-fix shape into the **real** repository files.

Run over the whole gateway the rule reports 10 further hits, in `calendar`,
`pos-hub`, `procurement` and `common/orchestrator`. They are **listed by name in
the guard's header** rather than silently excluded; triaging them belongs to the
sessions that own those modules, and each root joins `SERVER_SCAN_ROOTS` when it
has been.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | Aldemir | T1 and T2 decided directly; T3/T5/T7 delegated with the brief "make the unsafe call impossible or loud, and justify whichever you choose" |
