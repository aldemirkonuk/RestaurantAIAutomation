# 0137 — Legacy E2E waves D, E and G are retired, not repointed

- **Status:** Proposed
- **Date:** 2026-09-12
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an
  agent. This ADR records a per-wave technical decision the founder's own task
  explicitly delegated ("decide per wave ... make the decision recorded rather than
  implicit"); it stays `Proposed` until he reviews it, per the repo's standing
  convention — delegation of the analysis is not the same as pre-locking the outcome.
- **Keywords:** e2e-prod, wave-d, wave-e, wave-g, toast, gmail, calendar, pos_webhook_logs, inventory_stock, calendar_events, scheduled_reminders, schema-rot, absence-reported-as-health
- **Links:** [[absence-reported-as-health]], [[0028-phantom-relations-repoint-or-delete]] (the ADR that repointed `inventory_stock` → `restaurant_inventory`, per OD-99), [[0105-a-pos-connection-is-a-row-not-an-env-var]], `.planning/08-softwares/pos-bridge.md`, `.planning/v3.0-TECH-DEBT.md` "CI — the nightly production E2E …", the unmerged nightly-rebuild ADR on `test/nightly-e2e-modernised` (PR #349) which classified these three waves as "schema disagreements... filed as their own tech-debt unit... not repaired in #349" and is why this ADR exists as a separate branch

## Context

Measured 2026-09-11 against production Supabase (`exzueerziesmczwlhomd`, via
`information_schema.columns`), while auditing PR #349 (the unmerged nightly-E2E
rebuild): three legacy production-E2E waves in
`services/agent-orchestrator/tests/e2e/` are written against a schema production does
not have, and are one "helpful fix" away from writing to production for real —

- **Wave D** (`wave_d_toast_pipeline.py`) POSTs an HMAC-signed synthetic Toast webhook
  to the live agent-orchestrator's `/api/v1/pos/webhook/toast` and then polls
  `pos_webhook_logs` for the resulting audit row. That table **does not exist** in
  production.
- **Wave E** (`wave_e_gmail_pipeline.py`) upserts a below-threshold row into
  `inventory_stock` (**does not exist**; repointed to `restaurant_inventory` by ADR
  0028 / OD-99) specifically to make `NotificationAgent` call `send_low_stock_alert()`
  — a real email unless `mock_mode` is on.
- **Wave G** (`wave_g_calendar.py`) upserts `calendar_events` with `id="e2e-cal-001"`,
  `restaurant_id="e2e-test-restaurant"` — plain strings against columns that are both
  `uuid` in production — and separately probes an absent `scheduled_reminders` table.

None of the three can act today: D's write is preceded by a read of an absent table
(and the write itself may 500 for other reasons — see below); E's write 500s on the
absent table; G's write fails on invalid uuid syntax. **The isolation is the schema
disagreeing, not a guard.** Repointing the table names or generating real uuids — the
kind of change that reads as an obvious, helpful cleanup — removes that accidental
protection. All three are additionally gated behind their own optional secret
(`TOAST_WEBHOOK_SECRET`, `GMAIL_USER`, `GOOGLE_CALENDAR_CREDENTIALS`/two alternates),
currently unset — but a secret being set for an unrelated legitimate reason (e.g.
wiring real production Gmail config) is a second, independent way the accidental
protection disappears.

This ADR was directly instructed and delegated by the founder: *"decide per wave —
repoint to the real tables, delete as tests of a schema that no longer exists, or gate
behind an explicit opt-in — and make the decision recorded rather than implicit. Do NOT
simply repair the table names without deciding whether a production write (and a
production email) is wanted."*

**Research performed before deciding** (three parallel investigations, one per wave,
each reading the full wave file plus the current live architecture it would need to
target — not guessed):

### Wave D — DEAD, no live analog

`pos_webhook_logs` is defined only in an **archived** pre-baseline migration
(`supabase/migrations_archive/20260208024921_baseline_schema.sql:265-272`), absent from
`supabase/migrations/20260805000000_baseline_from_production.sql` (the live snapshot),
and `.planning/08-softwares/pos-bridge.md:96-108,144` documents it as **deliberately
omitted** from the current POS-bridge design. The endpoint the wave calls
(`POSIntegrationAgent` via `/api/v1/pos/webhook/toast`) has **zero product callers** —
grepping `/api/v1/pos/webhook` across `apps/` returns only comments (`toast.service.ts:769,783`, its spec, and `orchestrator-routes.ts:78`, guarded by a `stripComments` check at `orchestrator-routes.ts:74-89`) — no live call site; the only three callers in
the whole repo were `scripts/simulate/bridge.py:47`, `scripts/ngrok_live_test.py`, and
this wave. Real production Toast traffic goes through a completely different service
and route (`apps/api-gateway/src/toast/toast.service.ts`, `POST /toast/webhook`),
itself currently non-functional for an unrelated, already-tracked reason
(`OPEN-DECISIONS.md` OD-64: `TOAST_WEBHOOK_SECRET` unset everywhere, fails closed). There
is no current or planned webhook-arrival audit table on the orchestrator's route to
repoint to — the wave tests a path with no product behind it, not a path that drifted.

### Wave E — the feature is real; this wave's trigger mechanism never existed

`send_low_stock_alert()` is real production code
(`agents/notification_agent.py`) that calls a real SMTP client
(`services/email_client.py:135`, `_send_via_gmail`) when unmocked — the underlying
*feature* is live. But this wave's method of triggering it — a raw Supabase `.upsert()`
into an inventory table — was **never wired to anything**: the only publisher of
`stock.threshold.breached` is `BufferManager._evaluate_buffer`
(`agents/buffer_manager.py:365-460`), which only runs against buffers populated by
`add_sale()`, itself reachable only from a `pos.sale.completed` RabbitMQ message
(`buffer_manager.py:161-167`). **No Supabase database trigger or webhook connects a raw
table write to this chain anywhere in `supabase/migrations/` or `supabase/`.** The
wave's own docstring calls this a bare assumption ("the trigger assumes InventoryEngine
(or a Supabase webhook) publishes the event") — one the codebase does not support. Even
setting that aside: `restaurant_inventory` (the real table) has entirely different
columns and uuid-typed keys, so this isn't a rename, it's a payload rewrite; `mock_mode`
is driven by `MOCK_NOTIFICATIONS` (`config/settings.py:257-259`, defaults `true`), a
setting completely independent of `GMAIL_USER`; and the recipient resolver
(`_get_manager_for_restaurant`, `notification_agent.py:1560-1578`) has no fallback
address and the e2e anchor restaurant (`scripts/setup_e2e_anchor.py:58-71`) has no
`manager_id` set. Making this wave actually exercise a real send would mean **building**
a table-write-to-event-bus path that has never existed, purely to make an E2E test pass
— not repairing drift.

### Wave G — the feature it names was investigated and explicitly cut

`apps/api-gateway/src/settings/feature-flag-registry.ts:254-257` — the file is live on
`main` today; what was removed on 2026-08-26 is the `enable_calendar_sync` flag itself
(`:273`, `REMOVED_FEATURE_FLAGS`) — states outright: *"no Google Calendar sync exists (only a credential-gated e2e that
skips)"* — naming **this exact test** as the only thing keeping a Google-Calendar-sync
illusion alive. No `googleapis`/OAuth2 Google Calendar client exists anywhere in
`calendar_agent.py` or the repo; "calendar" here means a real, substantially-built
**internal** scheduling feature (`apps/web/src/pages/calendar/*`,
`calendar.service.ts`, a one-way iCal export) with no Google dependency. Separately, the
wave doesn't test anything functional even on its own terms: it's a self-referential
write-then-read-back of `calendar_events`, and its own docstring admits CalendarAgent's
real 3-day scan window can never fire for its own +7-day test event
(`wave_g_calendar.py:10-12,193-195`). `scheduled_reminders` has **no live replacement** —
CalendarAgent's real "reminder" concept is either `calendar_events`' own
`reminder_*` columns or a RabbitMQ `reminder.important_date` message
(`calendar_agent.py:393`), never a table by that name. Fixing only the uuid bug would
also need a real, existing restaurant uuid (the string literal carries a live FK to
`restaurants(id)`) — a suite-wide gap shared with waves C/D/E, not unique to G — and
would still produce a test that verifies nothing, since the feature it's named for
doesn't exist.

## Options considered

1. **Repoint each wave to current schema** — rejected for all three. D has no current
   analog to repoint to (the real Toast path is elsewhere and itself blocked). E's
   trigger mechanism was never built anywhere in this codebase — repointing would mean
   inventing new production wiring to make a test pass, backwards from what a test is
   for. G names a feature that was investigated and explicitly cut; there is nothing
   current to verify.
2. **Gate behind an explicit opt-in, indefinitely** — rejected as the *sole* fix. It
   would correctly stop an accidental future write, but it also quietly implies these
   are dormant-but-someday-useful tests, which the research above shows is false for
   all three. Leaving dead test files around a permanent "off" switch is exactly the
   kind of implicit state this task exists to remove.
3. **Delete** — chosen, all three. Honest about what they are (tests of retired or
   never-real product behavior), removes the write-capable code entirely rather than
   trusting a flag to always be respected, and is fully recorded and reversible via git
   history + this ADR + the tombstone commit, matching the repo's existing
   archive-means-delete-with-tombstone convention ([[vault-structure-post-od01]]).
4. **Leave implicit (status quo)** — explicitly what the founder's task instructed
   against. Cost: the next session that "helpfully" fixes a table name or a uuid format
   silently re-arms a production write (Wave E's, a real email) with no guard in the
   way.

## Decision

**Delete `wave_d_toast_pipeline.py`, `wave_e_gmail_pipeline.py` and `wave_g_calendar.py`
outright** (`git rm`, this branch). Each tests a schema or endpoint with zero production
consumer today, for a reason specific to that wave (see Context) — not a schema that
merely drifted out from under a still-real test. Waves A, B and C are untouched; this
ADR does not revisit their classification.

Cleaned up alongside the deletion, since each reference is now dead code left by the
same three files: the wave-letter maps in `conftest_prod.py` and `report_generator.py`
(D/E/G entries removed); the `E2E_TABLES` teardown-sweep list (`inventory_stock`,
`calendar_events`, `pos_webhook_logs` removed — confirmed no remaining wave writes to
any of the three); `.github/workflows/e2e-prod.yml`'s three `pytest tests/e2e/wave_*`
steps, replaced with one no-op step that states the retirement reason in the job log
(so a secret being set later produces a clear notice, not a bare "file not found"), plus
its now-meaningless `OPTIONAL` secret gates and the unused `TOAST_WEBHOOK_SECRET` /
`GMAIL_USER` / `GMAIL_PASSWORD` env mappings (least-privilege: an unused secret mapped
into a job env is readable by every step and action in it);
`services/agent-orchestrator/scripts/cascading_report.py` — **a fourth wave-letter
structure this ADR's first pass missed** (caught by both the correctness and compliance
audit angles on PR #354): its `wave_files`/`WAVE_DEPS`/`SUGGESTED_FIXES` still named D/E/G
and, since a missing JUnit file reads as `status: "missing"` and `"missing"` counts as
failed, the report would have permanently named Wave E a root cause and printed
"Fix GMAIL_USER/GMAIL_PASSWORD on Railway orchestrator" for a wave that no longer
exists — the exact absence-reported-as-illness shape this ADR retires the waves to stop.
Reproduced pre-fix and re-verified post-fix with synthetic green `wave_{a,b,c,f}.xml`
files: prints "✅ All Waves Passed" now, printed a fictional root-cause cluster before.
Also swept: `.planning/testing/EXISTING-TEST-INVENTORY.md`'s three now-nonexistent-file
rows and its Summary counts (pytest 67→64, total 142→139, and the
`4-pos`/`6-comms`/`7-calendar` group + T1-eligible counts, each −1);
`.planning/testing/SYNTHETIC-TENANT.md`'s "eight tables" claim (now five); a stale
`inventory_stock` docstring example in `conftest_prod.py`; and one stray blank line in
`decisions/README.md` that detached this ADR's own index row from its table (a
compliance-angle catch). `.planning/testing/TESTING-SCORECARD.md`'s three
citations of the deleted files; and one sentence in `.planning/08-softwares/pos-bridge.md`
that named this wave as one of only three callers of a now-partially-dead endpoint.

**If genuine E2E coverage of low-stock alerting or calendar reminders is wanted later,
it needs a fresh design against the real live event chain** (`pos.sale.completed` →
`BufferManager` → `InventoryEngine` → `NotificationAgent`'s actual consumer path, or
CalendarAgent's real `reminder.important_date` RabbitMQ message) — that is new test
design, not a repair of these three files, and is filed as a future item in
`.planning/v3.0-TECH-DEBT.md`, not decided here.

## Consequences

- **Easier:** no wave in this suite can silently start writing to production the
  moment someone fixes a table name, a uuid format, or sets an unrelated secret. The
  nightly's job log states a clear reason instead of three `pytest` collection errors
  if `e2e-prod.yml` ever reaches these steps before it's replaced by PR #349's rebuild.
- **Harder / given up:** POS-webhook-arrival, low-stock-email, and calendar-reminder
  E2E coverage all drop from "silently broken" to "explicitly absent" — a strict
  improvement in honesty, but a real coverage gap if any of the three is ever wanted
  for real. Filed in `v3.0-TECH-DEBT.md`, not built here.
- **What would trigger revisiting this:** a founder decision to build real E2E coverage
  for Toast-webhook auditing, low-stock email alerts, or calendar reminders against
  their *actual* current architecture (named above per wave) — at which point this ADR
  is the pointer to what NOT to reuse, not a starting point to repair.
- **Out of scope, deliberately:** Wave C's live-broker-publish behavior (already
  classified separately, gated on `RABBITMQ_URL`); the `RAILWAY_ORCHESTRATOR_URL`
  orchestrator-host secret (PR #349's territory — not touched by this branch); and
  `.github/workflows/e2e-prod.yml`'s pre-existing, unrelated flaw that every wave step
  swallows its own exit code (`|| true`) so the job's overall pass/fail does not
  actually reflect any wave's result — noted here because it was seen while editing this
  file, not fixed, since it is a different defect than the one this ADR addresses.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-12 | — | Created, per the founder's direct delegation to decide per wave; three parallel research passes performed before deciding (see Context); awaits founder review to move to Locked |
