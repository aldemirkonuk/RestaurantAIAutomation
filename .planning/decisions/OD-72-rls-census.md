---
type: evidence
for: OD-72, OD-73
title: RLS census — 142 naked tables, and who actually reads them
updated: 2026-08-25
links: [0012-reports-through-the-gateway.md, OPEN-DECISIONS.md]
---

# RLS census — the 142, and the two that actually bite

> **Evidence annex, not a decision.** It exists to make [OD-72](OPEN-DECISIONS.md)
> and [OD-73](OPEN-DECISIONS.md) answerable without re-running the census. Per
> CLAUDE.md §4 (retire-to-write), this file **merges into the ADR that resolves
> OD-72 and is deleted at that point** — it is not a permanent corpus document.
>
> Measured **2026-08-25** against production via `SUPABASE_POOLER_URL`
> (read-only transaction, service role) plus PostgREST probes with the public
> `SUPABASE_ANON_KEY`. No writes. No migrations applied.
>
> **Reproduce:** one query does the census —
> `SELECT c.relname, c.relrowsecurity, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p');`
> — plus `has_table_privilege('anon', c.oid, 'SELECT'|'INSERT'|'UPDATE'|'DELETE')`
> for the grants, and `pg_get_expr(p.polqual, p.polrelid)` for the policy bodies.

## 1. Headline

[ADR 0012](0012-reports-through-the-gateway.md) fixed `generated_reports` and left
"141 other tables" open. Re-measured, the number holds — and the interesting part
is that it is almost entirely harmless, while two things the census was *not*
looking for are not.

| Fact | Value |
|---|---|
| Tables in `public` | 205 |
| RLS enabled | 193 |
| **RLS on, zero policies** (the census set) | **142** |
| RLS on, ≥1 policy | 51 (73 policies) |
| **RLS off entirely** | **12** |
| Of the 142, holding ≥1 row | 43 |
| Of the 142, `anon` holds full SELECT/INSERT/UPDATE/DELETE grants | **142 of 142** |
| Of all 205, `anon` holds full DML grants | **203** |
| Policies referencing `auth.*` | **52 of 73** |
| `anon` / `authenticated` have `rolbypassrls` | `false` (only `service_role` and `postgres` bypass) |

Empirically, with the real anon key against production PostgREST:

| Table | State | `GET /rest/v1/<t>?limit=1` as `anon` |
|---|---|---|
| `generated_reports` | RLS, 0 policies | `200 []` |
| `procurement_orders` | RLS, 0 policies, 2 rows | `200 []` |
| `notifications` | RLS, 0 policies, 470 rows | `200 []` |
| `restaurants` / `users` / `team_members` | RLS, 0 policies, 10/10/11 rows | `200 []` |
| `restaurant_inventory` | RLS, **1 policy**, 72 rows | `200 []` |
| `sommelier_conversations` | RLS, **2 policies** | `200 []` |
| `master_wine_library` | RLS, 1 policy `USING (true)` | `200 [{…real row…}]` |
| `user_oauth_accounts` | **RLS off**, 1 row | `200 [{…real row…}]` |

`200` with an empty body in every denied case — the silent failure ADR 0012
described, reproduced across the whole set.

## 2. Who actually reads these from a browser

Method: find every construction of an anon-key Supabase client in the client apps,
then every table it can reach — `.from()` calls, PostgREST embedded selects, and
Realtime `postgres_changes` subscriptions. Name-grep alone over-reports badly (19
of the 142 names appear somewhere under `apps/web/src`, but 9 are members of an
inert `DatabaseTables` union at `apps/web/src/types/database.ts:275-284` and the
rest are UI strings, query-cache keys and comments).

**There is exactly one anon-key client in the entire product**, at
[apps/web/src/lib/supabase.ts:16](../../apps/web/src/lib/supabase.ts) — and
exactly **two** files import it:

| Importer | Table | Status |
|---|---|---|
| `hooks/queries/useReportQueries.ts:26,37` | `generated_reports` | OD-45 — **closed**, merged to `main` in `8c9301fb` (#58) |
| `hooks/queries/useSommelierQueries.ts:26,43,56` | `sommelier_conversations` | 🔴 **live, unreported — §3** |

`apps/mobile` contains **zero** references to Supabase; it reaches the gateway over
HTTP (`apps/mobile/src/api/client.ts`). `packages/database` builds a client but is
not a declared dependency of any app.

`lib/supabase.ts` also queries `master_wine_library` (:130, :177),
`restaurant_inventory` (:194, :292) and `procurement_orders` (:231, :255, :277,
:300) and subscribes to `postgres_changes` on the latter two (:329, :348) — but its
**exported helpers have no callers**. `getWines`, `getInventory`, `getOrders`,
`createOrder`, `updateOrderStatus`, `getDashboardStats`,
`subscribeToInventoryChanges`, `subscribeToOrderChanges` are all dead; the
same-named functions used across the app come from `services/api/*`, which is
axios against the gateway. So `procurement_orders` is a **latent** client read: one
`import` away from being a second OD-45, and it would fail the same way.

Classes used in the table in §5:

- **A — live client read.** 1 table: `generated_reports`.
- **B — latent client read** (dead code, reachable in one import): 1 table:
  `procurement_orders`.
- **C — no client path at all.** 140 tables. Reached only by the gateway
  (`SUPABASE_SERVICE_ROLE_KEY`, `apps/api-gateway/src/database/database.service.ts:15`)
  or the Python services, both of which bypass RLS.

## 3. The bug the census found by accident

`sommelier_conversations` is **not** one of the 142 — it has two policies — and it
is broken anyway, for a reason that decides §4's option 1.

```
Users manage own sommelier conversations · ALL · roles=PUBLIC
  USING  (user_id = auth.uid())
  CHECK  (user_id = auth.uid())
```

**This product does not use Supabase Auth.** `apps/web/src/contexts/AuthContext.tsx`
holds a gateway-issued JWT in `localStorage` and stamps it on axios; the Supabase
client is never handed a session. The browser is therefore permanently the `anon`
role and `auth.uid()` is permanently `NULL`. The policy can never match.

Consequence at `apps/web/src/pages/SommelierAI.tsx:91` — saved conversations always
render empty, and `useSommelierQueries.ts:31-34` catches the error, logs
`"table may not exist yet"` and returns `[]`, so even a loud failure would be
swallowed. The write path is worse in the honest direction: `upsertConversation`
fails the `WITH CHECK`, so "save" throws visibly while "load" lies quietly.

**52 of 73 existing policies reference `auth.*`** (48 `auth.uid()`, 4 `auth.jwt()`).
Every one of them is unsatisfiable from this browser. The 51 policied tables are not
a working convention that the 142 fell out of — they are the same failure with an
extra step.

## 4. The fork (→ OD-72)

**Option 1 — write real RLS policies for the client-read subset.**
The subset is one live table and one dead one. But §3 is the killer: a policy can
only scope by tenant if the database can see who is asking, and it cannot, because
auth is a gateway JWT that PostgREST never receives. Writing policies here means
first migrating authentication to Supabase Auth (or minting Supabase-compatible JWTs
signed with the project secret so `auth.uid()`/`auth.jwt()` resolve) — a large,
security-sensitive change to the login path, to fix two call sites. The alternative,
`USING (true)`, is not a policy; it is `master_wine_library`'s state, and it would
publish `generated_reports` to the internet. **Not recommended.**

**Option 2 — route the client-read subset through the gateway, as OD-45 was.**
Total cost: delete `useSommelierQueries.ts`'s three Supabase calls in favour of
gateway endpoints, and delete the dead half of `lib/supabase.ts`. That empties the
last anon-key client out of the product, at which point the 142 stop being a
silent-failure class entirely — nothing in a browser can reach them.
Sommelier needs an endpoint check of the kind ADR 0012 ran for reports (list /
upsert / delete over `sommelier_conversations`), which is the only unknown in the
estimate. **Recommended.**

**Option 3 — disable RLS on the gateway-only tables.**
Correct in the narrow sense that RLS-on-with-no-policy communicates a protection
that does not exist, and the gateway bypasses it regardless — so it is pure
theatre plus a foot-gun. But it is **not safe as stated**, and §1 says why:
`anon` holds full SELECT/INSERT/UPDATE/DELETE on **142 of 142**. Naked RLS is the
*only* thing standing between the public anon key and `notifications` (470 rows),
`users`, `restaurants`, `team_members`, `pos_checks`. Disabling it without first
revoking those grants converts 142 silent-read failures into 142 public
read-write tables. If this option is taken it must be `REVOKE ALL ON <t> FROM anon,
authenticated` **first**, RLS off second — and at that point option 3 has become
"grants are the access control, RLS is not," which is a coherent posture worth
deciding deliberately rather than arriving at.

**What is not in the fork:** doing nothing to the 140 Class-C tables is defensible
today. They fail silently only if something reads them from a browser, and after
option 2 nothing can.

## 5. The other direction — 12 tables with RLS **off** (→ OD-73)

The census set fails *closed*. Its complement fails *open*, and that is the more
urgent half of what this measurement found. Twelve `public` tables have
`relrowsecurity = false`, and `anon` holds full DML on all of them.

Verified by `GET`ting each with the public anon key:

| Table | Rows | `anon` sees rows | Note |
|---|---:|---|---|
| `procurement_documents` | 0 | — (empty) | 🔴 invoice/document store — the YC-wedge tables |
| `procurement_document_lines` | 0 | — (empty) | 🔴 extracted line items |
| `procurement_document_links` | 0 | — (empty) | 🔴 |
| `procurement_receipt_events` | 0 | — (empty) | 🔴 |
| `procurement_credits` | 0 | — (empty) | 🔴 |
| `user_oauth_accounts` | 1 | **yes** | 🔴 `user_id` ↔ `provider_user_id` link rows. Columns are `id, user_id, provider, provider_user_id, created_at, updated_at` — **no tokens stored**, checked. Anon-writable, and `auth.service.ts:1746` reads `(provider, provider_user_id)` to decide "already linked to another user", so a planted row can block a legitimate link. Not a takeover path: login does not resolve identity from this table. |
| `wine_repair_log` | 1086 | **yes** | internal repair history |
| `_bak_library_before_corpus` | 267 | **yes** | backup table, should not exist in `public` |
| `_bak_wine_match_keys_20260812` | 293 | **yes** | ditto |
| `_bak_seed_repair_20260813` | 41 | **yes** | ditto |
| `wine_merge_log` | 0 | — (empty) | |
| `spatial_ref_sys` | 8500 | **yes** | PostGIS system table; expected, not a defect |

The five `procurement_*` tables are empty today, which is the only reason this is
not already a breach. They are the newest tables in the schema and the ones the
invoice pipeline is being built onto — the day the first real invoice lands, its
line items are readable **and writable** by anyone holding the public anon key.
`VITE_SUPABASE_ANON_KEY` is wired into the web build from the `SUPABASE_ANON_KEY`
secret at `.github/workflows/deploy.yml:191`, so the key is public by design and
by distribution.

*Not verified:* whether the deployed bundle currently carries a real key or the
`'placeholder'` fallback — that requires the GitHub/Vercel secret, which this
session cannot read. It does not change the finding: the anon key is a public
credential and the database accepts it.

## 6. The 142

`Rows` is an exact `count(*)` under the service role. `Server-side owner` is the
surface that names the table in a quoted literal; `—` means no quoted literal in
`apps/api-gateway/src`, `services/`, or `scripts/` — **not** "unused". Tables
reached through an RPC show as `—` (`inventory_lots` is the clear case: it is the
inventory source of truth, mutated only via `apply_stock_movement`, and appears in
gateway code as prose, not as `.from("inventory_lots")`).

| # | Table | Rows | Server-side owner | Client `.from()` | Class |
|---|---|---:|---|---|---|
| 1 | `generated_reports` | 0 | gateway+python | **yes — live** | A |
| 2 | `procurement_orders` | 2 | gateway+python | yes — dead code | B |
| 3 | `notifications` | 470 | gateway+python | no | C |
| 4 | `field_review_queue` | 198 | python | no | C |
| 5 | `master_wine_library_submissions` | 191 | gateway+python | no | C |
| 6 | `api_spend` | 185 | python | no | C |
| 7 | `analytics_insight_prefs` | 150 | gateway | no | C |
| 8 | `storage_locations` | 87 | gateway | no | C |
| 9 | `inventory_alert_state` | 66 | gateway | no | C |
| 10 | `pos_checks` | 66 | gateway | no | C |
| 11 | `pos_unresolved_lines` | 39 | gateway | no | C |
| 12 | `decision_log` | 26 | gateway+python | no | C |
| 13 | `confidence_thresholds` | 20 | python | no | C |
| 14 | `calendar_events` | 19 | gateway+python | no | C |
| 15 | `unit_conversions` | 17 | python | no | C |
| 16 | `_migrations` | 13 | — | no | C |
| 17 | `team_members` | 11 | gateway | no | C |
| 18 | `analytics_insights` | 10 | gateway | no | C |
| 19 | `restaurants` | 10 | gateway+python | no | C |
| 20 | `users` | 10 | gateway+python | no | C |
| 21 | `event_schema_registry` | 9 | — | no | C |
| 22 | `inventory_events` | 8 | gateway+python | no | C |
| 23 | `restaurant_providers` | 8 | scripts | no | C |
| 24 | `restaurant_tables` | 8 | gateway | no | C |
| 25 | `grape_varieties` | 7 | python | no | C |
| 26 | `contact_addresses` | 6 | gateway+python | no | C |
| 27 | `user_preferences` | 6 | gateway | no | C |
| 28 | `dead_letter_queue` | 5 | python | no | C |
| 29 | `idempotency_keys` | 4 | python | no | C |
| 30 | `analytics_goals` | 3 | gateway | no | C |
| 31 | `api_idempotency_keys` | 3 | gateway | no | C |
| 32 | `contacts` | 3 | gateway+python | no | C |
| 33 | `message_templates` | 3 | python | no | C |
| 34 | `notification_preferences` | 3 | gateway+python | no | C |
| 35 | `provider_contacts` | 3 | gateway+python | no | C |
| 36 | `saga_state` | 3 | python | no | C |
| 37 | `inventory_lots` | 2 | — | no | C |
| 38 | `research_runs` | 2 | python | no | C |
| 39 | `communication_templates` | 1 | gateway | no | C |
| 40 | `event_store` | 1 | gateway+python | no | C |
| 41 | `procurement_order_items` | 1 | gateway | no | C |
| 42 | `recommendation_digest_prefs` | 1 | gateway | no | C |
| 43 | `research_run_stats` | 1 | python | no | C |
| 44 | `restaurant_feature_flags` | 1 | gateway+python | no | C |
| 45 | `ab_experiments` | 0 | python | no | C |
| 46 | `agent_activity_logs` | 0 | — | no | C |
| 47 | `agent_evolution_log` | 0 | — | no | C |
| 48 | `ai_feedback_loop` | 0 | python | no | C |
| 49 | `analytics_cache` | 0 | — | no | C |
| 50 | `appellation_rules` | 0 | python | no | C |
| 51 | `batch_operations` | 0 | — | no | C |
| 52 | `budgets` | 0 | — | no | C |
| 53 | `check_scans` | 0 | — | no | C |
| 54 | `collection_metadata` | 0 | python | no | C |
| 55 | `coverage_templates` | 0 | gateway | no | C |
| 56 | `crawl_schedule` | 0 | python | no | C |
| 57 | `custom_reminders` | 0 | gateway | no | C |
| 58 | `distributor_crawl_log` | 0 | — | no | C |
| 59 | `distributor_directory` | 0 | — | no | C |
| 60 | `drift_findings` | 0 | python | no | C |
| 61 | `email_watch_state` | 0 | — | no | C |
| 62 | `enrichment_queue` | 0 | python | no | C |
| 63 | `evidence_citations` | 0 | python | no | C |
| 64 | `evidence_url_cache` | 0 | python | no | C |
| 65 | `export_history` | 0 | — | no | C |
| 66 | `field_calibration` | 0 | python | no | C |
| 67 | `field_corrections` | 0 | python | no | C |
| 68 | `geocode_cache` | 0 | — | no | C |
| 69 | `glass_pour_tracking` | 0 | scripts | no | C |
| 70 | `invoice_scans` | 0 | — | no | C |
| 71 | `keyboard_shortcuts` | 0 | — | no | C |
| 72 | `manager_report_profiles` | 0 | — | no | C |
| 73 | `menu_changes` | 0 | python | no | C |
| 74 | `menu_price_versions` | 0 | — | no | C |
| 75 | `mobile_devices` | 0 | gateway | no | C |
| 76 | `negotiation_facts` | 0 | python | no | C |
| 77 | `notification_deliveries` | 0 | python | no | C |
| 78 | `one_tap_actions` | 0 | gateway | no | C |
| 79 | `order_items` | 0 | — | no | C |
| 80 | `outbox` | 0 | python | no | C |
| 81 | `password_resets` | 0 | gateway | no | C |
| 82 | `pos_catalog_match_proposals` | 0 | gateway+python | no | C |
| 83 | `pos_item_mappings` | 0 | gateway+python | no | C |
| 84 | `pour_events` | 0 | — | no | C |
| 85 | `prediction_outcomes` | 0 | python | no | C |
| 86 | `price_history` | 0 | scripts | no | C |
| 87 | `pricing_analyses` | 0 | — | no | C |
| 88 | `producers` | 0 | python | no | C |
| 89 | `profit_margins` | 0 | — | no | C |
| 90 | `prompt_versions` | 0 | python | no | C |
| 91 | `provider_knowledge` | 0 | gateway+python | no | C |
| 92 | `provider_performance_metrics` | 0 | gateway | no | C |
| 93 | `provider_promotions` | 0 | gateway+python | no | C |
| 94 | `provider_sentiment_history` | 0 | gateway+python | no | C |
| 95 | `recommendation_actions` | 0 | gateway | no | C |
| 96 | `recurring_orders` | 0 | gateway | no | C |
| 97 | `resolution_challenges` | 0 | python | no | C |
| 98 | `restaurant_branding` | 0 | gateway | no | C |
| 99 | `restaurant_venue_profiles` | 0 | gateway | no | C |
| 100 | `restaurant_wine_roster` | 0 | python | no | C |
| 101 | `rfq_requests` | 0 | python | no | C |
| 102 | `sales_events` | 0 | python | no | C |
| 103 | `schedule_receipts` | 0 | gateway | no | C |
| 104 | `schedules` | 0 | gateway | no | C |
| 105 | `server_sales` | 0 | gateway | no | C |
| 106 | `shift_breaks` | 0 | — | no | C |
| 107 | `shifts` | 0 | gateway | no | C |
| 108 | `sim_ground_truth_facts` | 0 | scripts | no | C |
| 109 | `sim_ground_truth_runs` | 0 | scripts | no | C |
| 110 | `simpos_catalog` | 0 | gateway+python | no | C |
| 111 | `simpos_check_lines` | 0 | gateway | no | C |
| 112 | `simpos_checks` | 0 | gateway | no | C |
| 113 | `simpos_tables` | 0 | gateway | no | C |
| 114 | `spend_alert_state` | 0 | python | no | C |
| 115 | `supplier_catalogs` | 0 | scripts | no | C |
| 116 | `swap_requests` | 0 | gateway | no | C |
| 117 | `system_audit_log` | 0 | gateway+python | no | C |
| 118 | `system_learning_state` | 0 | — | no | C |
| 119 | `team_availability` | 0 | — | no | C |
| 120 | `team_certifications` | 0 | gateway | no | C |
| 121 | `team_settings` | 0 | gateway | no | C |
| 122 | `time_off_requests` | 0 | gateway | no | C |
| 123 | `toast_item_mappings` | 0 | — | no | C |
| 124 | `trending_wines` | 0 | python | no | C |
| 125 | `ux_learnings` | 0 | gateway | no | C |
| 126 | `ux_overrides` | 0 | gateway | no | C |
| 127 | `ux_proposals` | 0 | gateway | no | C |
| 128 | `ux_signals` | 0 | gateway | no | C |
| 129 | `vendor_deadlines` | 0 | — | no | C |
| 130 | `vendor_portal_listings` | 0 | gateway | no | C |
| 131 | `vendor_portal_pages` | 0 | gateway | no | C |
| 132 | `vendor_price_observations` | 0 | gateway | no | C |
| 133 | `vintage_rules` | 0 | python | no | C |
| 134 | `vintage_substitution_rules` | 0 | — | no | C |
| 135 | `wine_acquisition_details` | 0 | — | no | C |
| 136 | `wine_aliases` | 0 | python | no | C |
| 137 | `wine_consumption_log` | 0 | gateway | no | C |
| 138 | `wine_location_mappings` | 0 | gateway | no | C |
| 139 | `wine_menu_prices` | 0 | — | no | C |
| 140 | `wine_popularity` | 0 | python | no | C |
| 141 | `wine_regions` | 0 | python | no | C |
| 142 | `wine_unit_defaults` | 0 | — | no | C |
