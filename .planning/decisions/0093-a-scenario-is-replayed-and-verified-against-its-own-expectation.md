# 0093 — A scenario is replayed into the product and verified against its own expectation

- **Status:** Proposed — five sub-decisions below, each the founder's to lock; built under the stated assumptions per CLAUDE.md §5
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** scenario, simulation, simpos, pos-hub, operating hours, timezone, sim tenant, inventory lots, low-stock, notification, email, verifier, delivery audit, S04, S09, S10, S15
- **Links:** [[0011-pos-sale-volume-contract]], [[0020-no-fabricated-answers]], [[0049-ecosystem-division-layer]], [[0067-a-failed-read-is-never-an-empty-one]], [[0078-a-count-is-a-record]], `03-scenarios/DELIVERY-AUDIT.md`, `03-scenarios/S04-pos-order-flows-to-inventory.md` §9, `03-scenarios/S09-pos-webhook-drops-or-desyncs.md` §9, `04-specs/ECOSYSTEM-PLAN.md` §6 (E0/E2), `testing/SYNTHETIC-TENANT.md`, `scripts/simulate/`, `scripts/synth/`

## Context

The founder asked for the ecosystem to be exercised the way a restaurant actually runs it:
the venue opens at a known hour, a guest arrives a minute later and orders a coffee and a
glass of wine, a table two minutes later orders five bottles, and the product must be
shown — not asserted — to have carried every one of those events to the right place:
`pos_checks`, the lot ledger, the consumption mirror, the analytics engine, the insight
generator, and the owner's inbox and email. Random variants of that day, over a real menu,
with no errors, are the acceptance test.

What exists today, measured on `origin/main` 77eb7888 and on production
`exzueerziesmczwlhomd` (2026-09-02):

- **A simulator exists and is good.** `scripts/simulate/` generates a deterministic service
  from a frozen menu snapshot, signs the bytes it sends, refuses to post unsigned or
  off-loopback, and proves its idempotency keys match the receiver's
  (`scripts/test_simulate.py`, 40 tests). It is not to be rebuilt.
- **It has no notion of when the restaurant is open.** Arrival times come from a hard-coded
  17:00–23:30 dinner curve in UTC (`scripts/simulate/service.py:38-45,138-150`). Nothing in
  the schema or either app knows a venue's hours: `restaurants` carries `timezone` (three
  distinct values in production) and nothing else about time
  (`information_schema.columns`, 2026-09-02). The founder's first question — *do we know
  which hours it operates?* — has the answer **no**.
- **It never checks its own result.** `python3 -m scripts.simulate oracle` prints expected
  depletion in bottle-equivalents; nothing reads the database back and compares. Of the 17
  scenario §9 simulation gates, two execute (S17, and S15's reach ladder); S04's gate —
  *a SimPOS close produces the correct ledger delta and a replay is a no-op* — is stated
  but has never run as a check (`DELIVERY-AUDIT.md` §2, §5).
- **Sim tenants have phantom stock.** `seed_sim_restaurant` writes
  `restaurant_inventory.stock_live` directly and writes no `inventory_lots`
  (`pg_get_functiondef`: zero mentions of `inventory_lots`), while `stock_live` is a
  projection maintained by `trg_project_stock_from_lots` and both depletion RPCs read lots
  only. A freshly seeded sim tenant therefore shows 12 bottles and raises
  `no stock to pour` on the first glass. `scripts/check_no_direct_stock_writes.sh` guards
  exactly this in TypeScript and cannot see a SQL function. No sim tenant exists in
  production today (`restaurants where slug like 'sim-%'` → 0 rows), so the fault is
  latent, not live.
- **"Notified" and "emailed" are not measurable.** The low-stock edge sweep persists an
  inbox row per member, then calls `GmailService.sendLowStockDigest` and, on failure, logs a
  warning (`low-stock-alerts.service.ts:388-430`). `notifications.delivery_status` exists as
  a column and is never written by this path. An email that never left reads exactly like
  one that did — the [[absence-reported-as-health]] shape.
- **The founder's own model is E0 then E1** (`ECOSYSTEM-PLAN.md` §7.1). A harness that
  proves the sell-side spine end to end, on demand, is E0 integrity work, and it is the
  precondition the hop-4 bridge design (`HOP4-BRIDGE-DESIGN.md`) names for shadow data.

## Options considered

### D1 — Where operating hours live

1. **`restaurants.operating_hours jsonb`, per weekday, in `restaurants.timezone`; `null` = unknown.** One column beside the timezone it depends on; a pure helper decides *open at instant*. Costs: JSON shape must be validated in the app; ranges crossing midnight need care.
2. **A `restaurant_hours` table, one row per (weekday, range).** Relationally cleaner; costs a second table, a join on every read, and a migration for a fact the founder wants *known*, not queried.
3. **Hours only in the scenario archetype, none in the product.** Zero schema; but then the product still does not know its own hours, which was the question.
4. Do nothing: the simulator keeps its UTC dinner curve and every "opens at twelve" scenario is a lie about time.

### D2 — Where the expectation lives and who compares it

1. **Persist each run's expectation (`sim_scenario_runs.expected jsonb`); verify once, server-side, in the SimPOS module; CLI and page both read that one verdict.** One comparison, one vocabulary of check ids, no duplicated oracle.
2. A Python verifier only, report to a file. Cheapest; but the page the founder asked for could show actuals and never a verdict, and two verifiers would drift the day the second is written.
3. Reuse `sim_ground_truth_runs`/`_facts`. Rejected on measurement: `runs` is `UNIQUE (restaurant_id)` and `facts.fact_type` is `CHECK`-limited to six seed facts — a scenario run is neither.

### D3 — What the hub does with a check outside operating hours

1. **Record it and flag it** in the verifier and (later) in analytics as a data-quality signal. No hub behaviour change; nothing a real POS sends is dropped.
2. Reject at ingest (4xx). Loses real revenue on a clock skew or a private event.
3. Quarantine into `pos_unresolved_lines` with a new reason. Reuses the queue but overloads its meaning (it is about *items*, not *checks*).

### D4 — Sim opening stock

1. **Materialise through `apply_stock_movement` (`initial`, `system`, idempotent key `sim:opening:<inventory_id>`, no cost → provenance `estimated`).** Same door every real receipt uses; the projection trigger sets `stock_live`; teardown covers the lots.
2. Patch the SQL RPC to insert lots. Correct, but edits a `SECURITY DEFINER` function defined in the 4.9 MB baseline, and the parity check would compare it on the next merge.
3. Leave it and pre-load lots by hand before each run. The shortcut CLAUDE.md §0.5 forbids.

### D5 — Making "emailed" true or false

1. **Write the outcome onto the notification rows' `delivery_status`** (`{email: {attempted_at, ok, error, recipients}}`) from the low-stock path, so the row says whether the email left.
2. A separate `email_log` table. More honest long-term; more schema for a first measurement.
3. Read the gateway log. Not queryable, not durable, not a page.

## Decision

**D1-1, D2-1, D3-1, D4-1, D5-1**, each recorded as an assumption until the founder locks it.

The reasoning that carried them: the founder's request is a *measurement*, and every
alternative that was cheaper either measured something else (D1-3, D2-2) or fabricated the
condition it claimed to test (D4-3). The alternatives that were more elegant (D1-2, D5-2)
added schema for a fact that has never been recorded once; they stay reachable as a later
refactor over the same helper and the same check ids. D3-1 is the only option that cannot
lose a real sale, and the flag it produces is itself the evidence the founder would need to
choose D3-2 or D3-3 later.

Concretely, what ships under this ADR:

- `restaurants.operating_hours` (migration `20260902210000`), a pure `isOpenAt` helper in
  TypeScript and Python with one shared fixture that both test suites run, an
  owner/manager `GET`/`PUT /restaurants/:id/operating-hours`, a Settings editor, and hours
  on every sim archetype.
- `scripts/simulate scenario …`: a scenario library (opening minute, two tables two minutes
  apart, hours-shaped lunch/dinner service, sell-through to par, unmapped item, void,
  duplicate webhook, dropped webhook, closed day, after-hours order) and a seeded
  `random` composition, all placed inside the venue's hours in its own timezone, posting
  through the same signed `generic_webhook` path a real POS uses, and persisting the run's
  expectation to `sim_scenario_runs` (migration `20260902211000`).
- A verifier in the SimPOS module — `GET /simpos/:id/scenarios/runs/:runId/verify` — that
  reads `pos_checks`, `inventory_transactions`, `pour_events`, `inventory_lots`,
  `restaurant_inventory`, `wine_consumption_log`, `pos_unresolved_lines`, `notifications`,
  `analytics_insights` and the analytics services, and returns one row per check with
  `pass` / `fail` / `unverifiable`. An empty expectation is `unverifiable`, never a pass.
  Two levers beside it — run the low-stock sweep now, generate insights now — so the
  user-side path is exercised on demand rather than on the cron's schedule.
- A page, `/simpos/:restaurantId/scenarios`, dev-only like its siblings, that lists runs
  and renders the verdict table, with a failed request rendered as a failure.
- The sim seed materialises opening stock as lots, and the synth write-set/teardown gains
  every table the harness now writes.

## Consequences

- **Easier:** S04's §9 gate and S09's duplicate half execute as a check anyone can run; the
  low-stock → inbox → email path has a measurable outcome; the product knows its hours,
  which OD-92 (crons ignoring timezone) and any "9am digest" need anyway.
- **Harder / given up:** two migrations and a jsonb contract to keep honest; the harness is
  dev-only by construction (`SimposModule` is not loaded in production), so it proves the
  code path, not the production deployment. S09's *dropped → detected* half stays
  `unverifiable` because no detector exists — the verifier says so rather than passing.
- **Open forks for the founder, deliberately not decided here:** whether an out-of-hours
  check should ever be rejected (D3); whether hours belong in a table once a venue has
  seasonal or holiday overrides (D1); whether `delivery_status` should graduate to an email
  log (D5).
- **Revisit when:** a real POS is connected (E4) — the same verifier should run against a
  real venue's day with the expectation derived from the POS's own export; or when the
  hop-4 bridge starts proposing from these crossings and needs the run's expectation as its
  shadow-data baseline.

## Corrections made while building (2026-09-02) — kept, because a decision that cannot be contradicted is not a decision

- **The fixture's stated DST recipe was wrong east of Greenwich.** The first draft told
  the TypeScript mirror to anchor on the offset of the wall time read as UTC. Builder A
  implemented that recipe and swept it at ten-minute resolution over all of 2026 against
  Python's `zoneinfo`: **0 disagreements** in every western or DST-free zone,
  **12 each** in Europe/Berlin, Europe/London, Australia/Sydney, Pacific/Auckland — it
  picks the *second* occurrence of an ambiguous wall time and the *post*-transition offset
  in a gap, both inverted. The shipped TypeScript brackets the day either side
  (630,720 wall times in 12 zones, zero mismatches); the fixture's prose now states the
  real rule and carries Berlin/Sydney cases generated from `zoneinfo`, so both suites pin
  it. Latent, not live: every timezone in production today is west of Greenwich or
  DST-free.
- **`sim_scenario_runs` is RLS-on with no policy plus a client revoke**, mirroring
  `sim_ground_truth_runs`, whereas the newer house rule in
  `20260902190000_a_count_is_a_record.sql` argues for RLS-with-a-service-role-policy. The
  revoke is the belt OD-72 added so a future permissive policy cannot open the table by
  itself; the divergence is a choice on the record, not an oversight.
- **The "glass-void branch" named in D5 does not exist**: every void falls to the single
  `apply_stock_movement` branch, so one key change covers all voids. OD-67 (a voided glass
  returns a whole bottle) is untouched.
- **Two hub defects the engine found before any run:** `bridge.seed_mappings` sent no
  `inventory_id`, so a live run would have queued every wine line as `unmapped` and
  depleted nothing — a broken pipeline and an unmapped tenant would have been
  indistinguishable; and `--apply` constructed the transport *after* logging in, so a
  mistyped `--analytics-base` would have posted the sim owner's password to that host
  before the loopback guard refused. Both fixed.
- **Sim tenants really were phantom stock**: builder A proved the seed change against the
  pre-change `seed.py` — 10 of 15 new tests fail before, 15 pass after.
- **The verifier learned the difference between never-set and unparseable hours** when
  the real helper replaced the stub it was built against: `hours_unknown` and
  `hours_invalid` are two distinct `unverifiable`s, never a "within hours".

## The live day, on the record (2026-09-03, PR #280 merged 02:06Z; both migrations applied by the integration by 02:08Z)

Run against a local gateway on `:4010` (the merged `main`), the shared Supabase, and the
`sim-bistro` tenant seeded by `scripts/synth generate --archetype bistro --apply`.
Founder's day: `scenario --scenario random --seed 7 --date 2026-09-02` — a Wednesday in
Chicago, open 12:00–23:00, 21 checks, 52 wine and 82 food lines, the 14:00 glass and the
14:02 five-bottle table, a wine sold through to par, a void, a duplicate webhook.

| Attempt | Verdict | What it found |
|---|---|---|
| Day 1 (run `137f4055`) | **14 pass · 2 fail · 4 unverifiable** | `consumption.mirror` **0 of 51** rows: the hub's `upsert(onConflict: "restaurant_id,notes")` had failed with **42P10** on every POS sale since 2026-08-24 — the idempotency index is *partial* and Postgres will not match it to an unqualified conflict target. `low_stock.notified` missed 3 real rows because the run's `posted_at` is stamped after the last post and the 2-minute cron fired mid-run. |
| Day 2 (run `b5afaad5`) | 13 · 4 · 3 | Two of the four fails were **my own replay**: a second `--apply` of the same day rewrote two stock-dependent checks under the same ids, and the revenue gap (567.53) was exactly their difference. The engine now refuses to re-post a day unless `--replay` is given and the plan is identical. The third: the notification names the **library** wine (`wineId = master_wine_id`), the verifier matched on `inventory_id`. |
| Day 3 (run `937a23f0`, clean teardown → seed → one apply) | **17 pass · 0 fail · 3 unverifiable** | Every measurable check passes. The three unverifiables are structural and say why: revenue buckets on the UTC date of `closed_at` while a Chicago day spans two (3233.41 + 2316.15 = the expected total); a trading day is not a closed day; this composition drops no webhook. Notifications: 3 rows, `delivery_status.email.ok = true`, one recipient. Insights: 3 generated, `consumption` now among the available sources (493 candidate types, up from 370 with the mirror empty). |

**Six defects the harness surfaced before or during the run, all fixed with a failing test
first:** the sim seed could not insert its wines (`master_wine_library.signature_hash` is a
UNIQUE identity the seed predated — 92 menu lines, 81 identities; now collapsed through a
Python mirror of `wine_signature_hash` proven byte-identical on all 92 and re-checked
against the SQL function at apply time); one inventory row per wine per restaurant (same
collapse); sim personas had no sign-in method the product honours (`users.password_hash`
bcrypt, cost 10); personas were not bound to the seeded tenant (`users.restaurant_id`,
without which the tenant guard refuses them); the consumption mirror's 42P10; and the
verifier's notification window. Two harness faults were mine: the fixture's DST prose and
the `posted_at` window.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | — | Created; number allocated by `scripts/check_adr_numbers_unique.py` across 580 refs and a `git worktree list` sweep |
| 2026-09-02 | — | Built by three parallel Opus builders + integration; corrections above recorded; live day pending the migrations reaching production on merge |
| 2026-09-03 | — | PR #280 merged; live day run three times (table above); final verdict 17 · 0 · 3 on run `937a23f0`; six defects fixed in the follow-up PR |
