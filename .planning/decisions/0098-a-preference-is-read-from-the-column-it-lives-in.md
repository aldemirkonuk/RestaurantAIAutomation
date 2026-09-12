# 0098 — A notification preference is read from the column it lives in, and the switch a user toggles is the one that decides

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Claude (Opus 5) under a founder-issued defect brief; the one genuinely open fork (category-aware routing) is left OPEN below rather than defaulted
- **Keywords:** notification_preferences, recipient resolver, communications, opt-in, opt-out, multi-tenancy, cross-tenant leak, absence-reported-as-health, read-columns guard, ADR 0022, ADR 0074, OD-87
- **Links:** [[0074-a-read-names-columns-that-exist]] (the guard this extends — it reported PASS on this defect for its whole life), [[0022-scheduled-jobs-resolve-per-tenant]] / OD-87 (the cross-tenant fallback this finishes), [[0027-push-is-not-resolved-here]] (the spec whose fixture this corrects), [[0020-a-missing-source-is-not-a-zero]] (the family)

> **Numbering.** The brief reserved **0093** for this ADR. 0093 was already
> taken — `0093-a-scenario-is-replayed-and-verified-against-its-own-expectation.md`
> exists in four unpushed peer worktrees on `feat/eco-sim/*`. That is precisely
> the collision [[memory:adr-number-comes-from-the-guard]] describes: `next_free()`
> sees only refs and sweeps straight past unpushed worktrees. Per CLAIMS §5b
> ("prefer a gap over a collision"; "git merges duplicate ids in silence") this
> took **0098**, past everything claimed in any ref or any of the 122 worktrees
> on this machine. 0094 and 0096 are free but are what a "next free" session
> would grab, so they were skipped deliberately.

## Context

Two defects in the notification recipient path, both live on `origin/main` at
`77eb7888`, both found by reading rather than by a failure report — which is the
whole problem with them.

### Defect 1 — the resolver read two columns that have never existed

`apps/api-gateway/src/communications/recipient-resolver.service.ts`,
`checkChannelPreference`, read `prefs.order_channels` and `prefs.report_channels`.

`public.notification_preferences` has never had either column. It has
`order_approval_channels` and `financial_reports_channels`, declared by
`supabase/migrations/20260805000000_baseline_from_production.sql:3899-3939` —
the only migration that creates the table, and the only one that alters it.

The reads therefore evaluated to `undefined` forever. **This produced no error
of any kind.** The row is fetched with `.select("*")`, so PostgREST returns it
happily; the phantom names only ever appear as property accesses on the returned
object. There is no 42703 to swallow, no status code, no log line — just a
confidently computed wrong answer.

What it computed, on the stock production row:

| the user's actual setting | what the router did | correct? |
|---|---|---|
| `email_enabled = true` (default) | **refused email** | no |
| `sms_enabled = false` (default) | **sent SMS** | no |

Both halves at once, in opposite directions. The mechanism:

- The only array that could ever match was `low_stock_channels`, whose default
  is `['sms','push']`. `'email'` is not in it → email refused.
- The "no explicit preferences set" escape hatch tested all three columns, two
  of which were permanently falsy — but `low_stock_channels` was truthy, so the
  hatch could never fire for a real row. Email stayed refused.
- `sms_enabled` — the one channel that is **opt-IN**, `DEFAULT false` — was
  never consulted at all. `'sms'` IS in `low_stock_channels`' default → SMS sent.

`notifications.service.ts:1051-1053` is the other reader of the same row, and it
has always had the semantics right:

```ts
email: row.email_enabled ?? true,
push:  row.push_enabled  ?? true,
sms:   row.sms_enabled   ?? false,
```

So the row meant one thing in Settings and a different thing in routing. A user
could toggle SMS off, see it off in the UI, and keep receiving texts.

**The trap: fixing the column names alone does not fix this.** With the real
names, `order_approval_channels` defaults to `['sms','push','email']`, so email
starts passing and the defect *looks* closed. SMS keeps passing, because nothing
has yet taught the method that `sms_enabled` exists. Measured on exactly that
intermediate tree: 4 of 10 tests still fail. That is why the fix is two gates,
not a rename.

### Defect 2 — a per-restaurant send fell back to a global address

OD-87 / [[0022]] closed this **inside the resolver**: `allowDefaultFallback`
defaults to `true`, and `scheduled-tasks.service.ts:149` passes
`tenant.isLegacyDefault` so only the legacy tenant gets the env-var address.

`low-stock-alerts.service.ts:resolveEmails(restaurantId)` predated that fix and
was never brought along. It is called once per restaurant from
`emailDigest(restaurantId, …)`, and it leaked at **two** layers:

1. it called `resolveRecipients` **without** `allowDefaultFallback`, so the
   resolver substituted the global `MANAGER_EMAIL` before this method ever saw
   an empty list; and
2. if that still returned nothing, a bare `this.config.get("MANAGER_EMAIL")`
   substituted it a second time — including inside a `catch {}` that swallowed
   the error, so a database outage became a cross-tenant send.

Not hypothetical. Verified in production 2026-08-26: 6 of 10 restaurants have
only an `owner` row in `user_restaurant_access` and no `manager`, while this job
asks for `["manager"]`. Those six resolved to zero users and took this path
every time.

### Defect 3 (found while fixing 1) — the guard was structurally blind

`scripts/check_read_columns_exist.py` ([[0074]]) is a required check and exists
to catch exactly "a read names a column that does not exist". It reported
**PASS** on the pre-fix tree, and was not wrong to: its stated universe is the
projection (`.select("a, b")`) and the filters (`.eq`, `.order`, …). A
`select("*")` row read by property name names its columns in neither place.

So the repo had a guard for this defect class, a required check enforcing it,
and the defect sailed through both — because the read used the one shape the
guard's docstring already admitted it could not see. A guard whose blind spot is
documented is still a blind spot.

## Decision

**1. `checkChannelPreference` applies two gates, in order.**

- **Gate 1, the global per-channel switch.** `email_enabled`/`push_enabled`/
  `sms_enabled`, with defaults `true`/`true`/**`false`** — byte-identical to
  `notifications.service.ts:1051-1053`. If the channel is off, refuse. This is
  the gate that was missing entirely, and it is what makes SMS opt-in.
- **Gate 2, the per-category arrays**, by their real names. If no category array
  is expressed, gate 1 has already decided; otherwise the channel must appear in
  at least one.

**2. `resolveEmails` gates both fallback layers on the restaurant actually being
`DEFAULT_RESTAURANT_ID`.** For every other tenant, unresolvable means an empty
list and a `RECIPIENTS_NONE` WARN naming the restaurant — never another tenant's
address. The legacy tenant's recipient list does not move by a single address,
as [[0022]] requires. The `catch {}` now logs instead of swallowing.

**3. `check_read_columns_exist.py` gains a third read shape:
`ROW_PROPERTY_READS`.** An explicit registry of `file::variable → table`, each
entry checked against the migration corpus. Explicit rather than inferred
because resolving `prefs.foo` to a table needs a TypeScript program, not a
regex, and guessing would false-positive on every object in the codebase. The
honesty comes from the never-vacuous rule instead: **an entry whose file is gone
or whose variable no longer appears is CANNOT CHECK (exit 2), never a pass.**

## Measurement

Every number below was measured in this worktree at `origin/main` `77eb7888`,
not copied from the brief.

**The specs.** `channel-preferences-are-real-columns.spec.ts` (10) and
`low-stock-recipients-are-tenant-scoped.spec.ts` (7):

| tree | failed |
|---|---|
| `origin/main` | **12 of 17** |
| rename-only (column names fixed, no gate 1) | 4 of 10 in the first file |
| this branch | **0 of 17** |

The 5 that pass against `origin/main` are deliberate both-states guards — without
them, deleting the preference check outright would satisfy the suite.

**The guard**, `scripts/check_read_columns_exist.py`:

| tree | exit | output |
|---|---|---|
| `origin/main` (before the extension) | **0** | PASS — the blind spot |
| `origin/main` (with the extension) | **1** | 4 findings, both bad columns, both sites |
| this branch | **0** | PASS, `[2 property-read sites checked]` |
| `--self-test` | **0** | includes 4 new cases + 2 new exit-2 rot cases |

**Full gateway suite:** `origin/main` 1877 passed / 14 skipped / 1891 total,
0 failed. This branch 1894 passed / 14 skipped / 1908 total, 0 failed.
`npx tsc --noEmit -p tsconfig.spec.json` exits 0.

## A consequence worth stating plainly

**If `DEFAULT_RESTAURANT_ID` is unset, no restaurant gets the env fallback any
more** — where previously *every* restaurant did.

That is deliberate and it is the fail-closed direction: `MANAGER_EMAIL` names one
restaurant's manager, and with no `DEFAULT_RESTAURANT_ID` there is nothing that
says *which*, so there is no restaurant it can be sent to safely. But it is a real
behaviour change for any environment configured that way (a dev or staging box
with `MANAGER_EMAIL` set and `DEFAULT_RESTAURANT_ID` not), where low-stock email
will now go nowhere.

It does not go nowhere *silently*: every such case logs `RECIPIENTS_NONE` with the
restaurant id and the reason, which is the whole point — the previous behaviour
was silent and wrong, this one is loud and safe. `DEFAULT_RESTAURANT_ID` appears
in no workflow file in `.github/`, so this was not verified against any deployed
environment's actual configuration; it is stated here so the first person to see
an empty low-stock inbox finds the answer.

## Rejected alternatives

**Rename the columns and stop.** The brief's literal ask, and it leaves SMS
mis-routed — measured, 4 of 10 still failing. Rejected on evidence.

**Make gate 2 category-aware now.** The correct end state, and it is *not* a bug
fix: it requires threading a category through all seven call sites and deciding
which category each belongs to. That is a product decision. Left OPEN below.

**Have gate 2 be the union, but treat an empty array as "all channels".** Would
make an explicit opt-out of everything mean opt-in to everything. Rejected.

**Delete the env fallback outright.** Would move the legacy tenant's recipient
list, which [[0022]] explicitly forbids as part of a multi-tenancy fix.

**Throw from `resolveEmails` when nothing resolves.** Considered — "fail loudly"
is the house style. Rejected: it would abort a per-restaurant loop partway and
stop later tenants from being notified, converting a routing bug into an outage.
An empty list plus a WARN naming the restaurant is loud without being fatal, and
the caller already logs and skips.

**Infer the table for a property read instead of a registry.** Needs real type
resolution. A regex would false-positive on every `x.y` in the gateway.

**Add the bad columns to `KNOWN_BAD_READ_COLUMNS`.** The brief anticipated they
might be on it. They were not, and adding them would have recorded the defect
as accepted debt instead of fixing it.

## What this does NOT fix

Named explicitly, because a fix list that omits its own edges is the fault this
repo is most allergic to.

1. **Category-aware routing is still absent.** Gate 2 is a union across the three
   arrays, so a user who enables email for financial reports also gets it for
   low stock. Strictly better than today (which ignored two of the three arrays
   outright) but not correct. **This is an OPEN fork for the founder** — see
   OPEN-DECISIONS.
2. **`delivery_channels`, `inequality_alerts_channels`, `calendar_reminders_channels`
   are read by nothing.** Three more declared category arrays the resolver
   ignores. Not touched — they belong with the category decision above.
3. **`ROW_PROPERTY_READS` has 2 entries.** Both in the resolver. Nine other
   `select("*")` sites on `notification_preferences` alone were not audited and
   are not registered. The registry closes the site that was broken and makes
   the shape checkable; it does not claim coverage of every such read.
4. **The other `MANAGER_EMAIL` readers were surveyed and deliberately left.**
   `communications.controller.ts` (operator test endpoints, documented as
   sending to `MANAGER_EMAIL` only) and `scheduled-tasks.service.ts:73-74`
   (a singleton job bound to `DEFAULT_RESTAURANT_ID` that *skips* when unset
   rather than mis-routing). Neither resolves per-tenant, so neither leaks.
5. **No production verification.** Nothing here was run against production, and
   no row was inspected. The production claims (defaults, the 6-of-10 shape) are
   cited from the migration corpus and from prior measurements recorded in
   [[0022]] and `production-tenant-shape`, not re-measured today.
6. **The fix is not observable in the UI.** Nothing was screenshotted, because
   nothing user-visible changed — the defect is in server-side routing.
