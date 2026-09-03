# 0022 — Scheduled jobs iterate opted-in tenants, and never borrow another tenant's recipients

- **Status:** Proposed
- **Date:** 2026-08-26
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** multi-tenant, cron, scheduled-tasks, DEFAULT_RESTAURANT_ID, opt-in, feature-flag, recipient-resolver, failure-isolation, OD-87
- **Links:** OD-87 (resolved by this), OD-92 + OD-91 (opened by this), [[0020-no-fabricated-answers]], `apps/api-gateway/src/communications/scheduled-tenants.service.ts`

## Context

Every cron in `apps/api-gateway/src/communications/scheduled-tasks.service.ts`
read one `DEFAULT_RESTAURANT_ID` env var at `onModuleInit` and bailed when it was
unset. Nine `@Cron` decorators; eight of them tenant-scoped (the ninth,
`checkTenantIsolation`, calls a global RPC and was never affected). Every
restaurant except the configured one silently received no email, SMS or
notification — no error, no log, nothing to notice (OD-87).

**Verifying the entry changed the design twice.** Three of its premises did not
survive contact with production (`Restaurant_Wine_Ops`, queried read-only on
2026-08-26):

1. *"Invisible today (one customer)."* `restaurants` holds **10 rows**, all
   `is_active = true`, none soft-deleted, across **3 timezones**. Only one
   (`Meyhouse Palo Alto`, 3 members / 50 inventory rows / 12 calendar events) is
   a real tenant; the other nine are dev and demo signups, **indistinguishable
   from a real tenant by any column**. So "loop over all active restaurants"
   would not have served a second customer — it would have mailed nine fixtures
   on the first run after deploy.
2. *The recipients are per-tenant.* They are not.
   `RecipientResolverService.resolveRecipients` falls back to the global
   `MANAGER_EMAIL` / `MANAGER_PHONE` env vars whenever a restaurant resolves to
   no users. And `user_restaurant_access` in production contains only `owner` and
   `manager` roles — **no `staff` row exists at all**, and **6 of 10 restaurants
   have only `owner`** — while the jobs ask for `["manager"]` or
   `["manager","staff"]`. So for most tenants that fallback fires every time:
   iterating them would have sent restaurant B's operational data to restaurant
   A's inbox. The naive fix converts a silent no-op into a cross-tenant leak.
3. *It is one defect.* Two more were found in the same file while iterating it:
   `processCustomReminders` queried `custom_reminders` **unfiltered** and then
   gated each row on `DEFAULT_RESTAURANT_ID`'s inventory and mailed
   `DEFAULT_RESTAURANT_ID`'s manager (harmless only because the table is empty in
   production — verified 0 rows), and `getDailySummaryData` still returned a
   fixture (`lowStockCount: 5, pendingOrders: 3, deliveriesToday: 1`) on any
   database error and SMSed it as fact — the same fabrication ADR 0020 removed
   from the weekly email under OD-85, missed on the SMS path.

Every email also hard-coded `restaurantName: "WineOps Restaurant"`, which names
the product rather than the restaurant — invisible at one tenant, wrong at two.

## Options considered

1. **Loop over all active restaurants.** The obvious reading of OD-87, and one
   line of code. Rejected on the measurements above: it fans nine fixture
   tenants out to real outbound mail on the first run, and — because six of them
   resolve no recipients — routes that mail to the one configured manager
   address. It replaces a quiet failure with a loud, cross-tenant one.
2. **A new env var (`SCHEDULED_TASKS_TENANT_MODE = default-only | opt-in | all`).**
   Keeps the blast radius controllable. Rejected: a global env knob deciding
   per-tenant behaviour is the exact shape of the bug being fixed, it needs a
   Railway restart to change, and it cannot express "these three, not those
   seven."
3. **Per-tenant opt-in row in `restaurant_feature_flags`.** Chosen. The table's
   real shape was verified before relying on it (the 22-column migration in
   `services/database/migrations_archive/` was never applied): production has the
   7-column EAV table plus the two booleans OD-86 added, with
   `UNIQUE (restaurant_id, flag_name)` and `enabled boolean DEFAULT false`. That
   is exactly a per-tenant switch.
4. **Do nothing until a second customer signs.** Rejected: the work is a design
   pass across nine jobs, not a find-and-replace, and doing it under onboarding
   pressure is how the recipient leak would have shipped unnoticed.

## Decision

**Scheduled jobs serve the restaurants that have explicitly opted in, plus the
legacy `DEFAULT_RESTAURANT_ID`; they iterate sequentially with per-tenant failure
isolation; and no tenant may ever borrow another tenant's recipients.**

Three parts, each carrying its own weight:

**Enumeration is opt-in.** `ScheduledTenantsService.list()` returns
`DEFAULT_RESTAURANT_ID` ∪ every restaurant with
`restaurant_feature_flags(flag_name = 'scheduled_communications', enabled = true)`,
filtered by `is_active` and `deleted_at IS NULL`. No such flag row exists today,
so `list()` returns exactly the one restaurant that already receives mail and
**this deploy changes nothing for anyone**. Onboarding a second restaurant is one
INSERT, no deploy. `list()` *throws* rather than returning `[]` on a query
failure, because returning an empty list would reproduce OD-87 exactly — jobs
doing nothing, quietly.

**Iteration is sequential, isolated, and uncapped.** `runPerTenant(job, body)`
wraps each tenant's body in its own try/catch and logs
`SCHEDULED_JOB_SUMMARY job=… tenants=N succeeded=X failed=Y` unconditionally, so
a job that fails for nine of ten restaurants cannot look like a job that worked.
Sequential rather than concurrent: these bodies send mail and SMS through shared
provider credentials, where parallelism buys nothing at this scale and risks a
rate-limit burst. **Deliberately no per-run cap** — the tenant count is bounded
by an explicit human INSERT, so a cap here would be machinery that could never
fire, which is the failure shape this repo keeps producing (OD-75's parser that
could not report failure; the join key that matched zero rows).

**The legacy tenant is frozen, and only the legacy tenant may use the env vars.**
`ScheduledTenant.isLegacyDefault` marks the one restaurant named by
`DEFAULT_RESTAURANT_ID`. The two jobs that historically read `MANAGER_EMAIL` /
`MANAGER_PHONE` directly (daily SMS summary, weekly email report) keep reading
exactly those for that restaurant, so its recipient list does not move by a
single address as part of a multi-tenancy fix — this matters concretely, since
its 3 members all carry phone numbers and routing the SMS through the resolver
would have silently tripled it. Every other tenant resolves against its own
members with `allowDefaultFallback: false`, a new `RecipientQuery` field
defaulting to `true` so no existing caller changes. A tenant that resolves nobody
now logs `RECIPIENTS_NONE` at WARN and sends nothing — silence made visible
rather than eliminated.

Fixed in passing, because iterating the code made them unavoidable:
`processCustomReminders` is scoped per tenant; `getDailySummaryData` throws
instead of SMSing a fixture (the tenant is then counted `failed`); and every
email names `tenant.name`.

## 2026-09-03 — the env var went away, and this design is why that was survivable

`DEFAULT_RESTAURANT_ID` was removed from Railway on 2026-09-03, alongside
`GMAIL_PUBSUB_REQUIRE_AUTH` (which ADR 0094 had genuinely deleted from the code).
The two were reported to the founder in one list of "env vars that need you", and
only one of them should have been removed. That is a reporting fault, not a
config fault.

The effect was immediate and total. `ScheduledTenantsService.list()` unions the
opt-in flag rows with the legacy tenant; production held **one**
`restaurant_feature_flags` row (`self_evolution`, `enabled = false`) and **zero**
`scheduled_communications` rows, so with `legacyTenantId` null the set was empty
and every scheduled job returned without doing anything. **OD-87 exactly, arrived
through configuration instead of through code.**

What this ADR got right is the part that made it recoverable rather than
invisible: the empty case logs `SCHEDULED_TENANTS_EMPTY` and names both reasons.
A design that returned `[]` quietly would have left no symptom but an inbox that
stopped filling — and nobody notices mail that does not arrive.

**Repaired through this ADR's own mechanism rather than by restoring the env
var:** one INSERT opting `550e8400-…` (*Meyhouse Palo Alto*, the only real
tenant — 3 members, 3 `notification_preferences` rows, 50 inventory rows) into
`scheduled_communications`, with the reason in `metadata`. Deliberately not the
env var, for two reasons. Scheduled delivery now depends on a **row that names
the restaurant**, auditable and immune to env churn, which is what this ADR
argued for in the first place. And restoring `DEFAULT_RESTAURANT_ID` would have
brought back `isLegacyDefault: true` and with it the `MANAGER_EMAIL` /
`MANAGER_PHONE` fallback that [[0098]] had just closed as a cross-tenant leak —
fixing one regression by reopening another.

The eleven fixture restaurants stay out, which is the whole point of opt-in.

**Checked before opting in, not after:** all three members carry an email and a
phone, `email_enabled = true`, `sms_enabled = false`. Low-stock alerts therefore
resolve to three email addresses and no SMS. Worth stating why, because the
arithmetic looks wrong at a glance: `low_stock_channels` holds its default
`['sms','push']`, which contains no email — but gate 2 is a **union** across the
three category arrays, and `order_approval_channels` is `['sms','push','email']`.
The union is what makes these rows deliverable at all. It is also exactly the
permissiveness OD-121 exists to revisit, so **a category-aware gate must not be
shipped without first checking it does not silence this tenant.**

## Consequences

- **Easier:** onboarding restaurant #2 is one INSERT. Per-tenant outcomes are
  legible in the logs for the first time. The nine jobs share one enumeration
  path, so the next tenant-scoping question is answered once.
- **Harder / given up:** two recipient code paths exist (legacy env vs resolver)
  until OD-91 is answered and the env vars retire. Opting a tenant in is a manual
  database write with no UI.
- **One intentional behaviour change for the existing tenant:** its emails now
  say `Meyhouse Palo Alto` where they said `WineOps Restaurant`. Recipients,
  schedule and content are otherwise byte-for-byte unchanged. Naming the wrong
  entity in an outbound email sits in the same family as ADR 0020's fabricated
  figures, so it was not preserved for its own sake.
- **Left open deliberately:** the crons remain pinned to
  `timeZone: "America/New_York"` while restaurants carry their own `timezone`
  (3 distinct values in production, including `Europe/Istanbul`) — **OD-92**,
  because honouring it needs per-tenant scheduling, not a per-tenant loop. And
  whether every existing tenant is opted in by default is the founder's call —
  **OD-91**, with the recommendation to keep explicit opt-in given that 9 of the
  10 production rows are fixtures.
- **Revisit when:** a second restaurant is opted in and the `RECIPIENTS_NONE`
  warning fires for it — that is the signal that the `owner`-vs-`manager` role
  gap (6 of 10 restaurants) has to be answered rather than logged.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-26 | — | Created; awaiting founder lock on OD-91 |
