# Software modules — capacity & coverage audit

Worktree: `/Users/aldemirkonuk/Projects/wt-review`, detached at `train/finish-2` = `804a1bdb5`
(`main` `cb756083e` + PR #391's train). Measured 2026-09-18. Every number below is from a
command run in this session (shown inline); none is copied from a doc.

Method notes:
- Module LOC/endpoint/cron/spec counts: `find`/`grep` over `apps/api-gateway/src/*` (one pass, shown in full at the end).
- Coverage: one `heavy.sh npx jest --coverage` run in `apps/api-gateway` (432/434 suites passed, 2 skipped, 6677/6691 tests passed) → `coverage/coverage-summary.json`, aggregated per module folder.
- Production reads: Supabase MCP, project `exzueerziesmczwlhomd`, SELECT-only (`list_tables` row counts + targeted `execute_sql`). Single tenant confirmed: `restaurants`=14 rows but `restaurant_feature_flags` has exactly **1** row — memory's "1 real tenant" holds.
- Frontend wiring: full read of `apps/web/src/App.tsx` (route → component → flag map), not grepped.
- e2e: `apps/web/e2e/` has 5 files total (`navigation`, `smoke`, `studio-flow`, `prod-smoke`, `retired-routes`) — this is the entire e2e surface for all 26 softwares below; noted once here rather than repeated per section.
- Deploy: web → Vercel (`vercel.json`, rewrites `/api/*` to `wineopsapi-gateway-production.up.railway.app`); gateway → Railway (`.railway/railway.ts`).

**Production flag state (the one tenant row, `restaurant_feature_flags`):** ON = dashboard,
inventory, orders, receiving, providers, communications, team, receipts, documents_reports,
document. OFF = calendar, cellar, connections, logs, notifications, profile, recommendations,
reports, settings. (`mudavym_design_*` columns, single row, queried directly.)

---

## Cross-cutting findings (apply to more than one software — read this before the sections)

**F1. `mudavym-mcp` is live-coded, ADR-backed, and completely unused in production — but the catalog says "planned."**
`.planning/08-softwares/mudavym-mcp.md` frontmatter says `status: partial` (updated 2026-09-06,
correctly), but `SOFTWARE-MAP.md`'s roster table (updated 2026-09-03, "regenerate rather than
hand-edit") still lists it under `planned` with the gap note "documented, not built." That's
false today: `apps/api-gateway/src/mcp-server` (2279 LOC, 5 endpoints, 3 specs, 70.0%
stmt/50.2% branch coverage), `mcp-runtime` (1844 LOC, 5 specs, 83.6%/70.3%), `mcp-connections`
(2578 LOC, 13 endpoints, 6 specs, 79.0%/65.8%) all exist, and 5 `CLAIMS.jsonl` rows for
ADR-0132 are `status: resolved` and verified 2026-09-06 (e.g. a live curl handshake returning
`protocolVersion 2025-06-18`). It is real, tested, protocol-correct code that nobody uses:
`mcp_server_credentials`, `mcp_server_call_log`, `restaurant_mcp_connections`,
`mcp_tool_calls`, `mcp_connection_consents`, `mcp_seal_challenges` are **all 0 rows** in
production — no restaurant has ever connected an MCP client. Recommendation: `decide` — either
this is a real go-to-market surface that needs a front door (nothing in `/connections` UI
currently offers "connect an AI assistant"), or it's dormant investment that should be named
as such. Either way, fix the stale roster row first — the catalog's own honesty mechanism (its
finding #1) has gone stale about itself.

**F2. Pagination is the exception, not the rule.** Of 76 `*.controller.ts` files, only 15 use
any `@Query('page'|'limit'|'cursor')`/`PaginationDto` pattern (`grep -rlE` count). At 14
restaurants and the row counts below this is invisible; it is a named scale limit for every
software with a list endpoint (notifications=566 rows already, procurement/inventory
growing). Not itemized per software below except where a specific unbounded query was found.

**F3. Loop-plus-await (N+1 candidate) files, by module** (`for (const … of …)` containing an
`await this.…` DB call, files not lines — a coarse signal, not a proof of an N+1 per file):
`analytics`=9, `procurement`=8, `communications`=5, `mcp-server`/`team`/`providers`/`vendor-intel`/`reports`=0,
`inventory`=1, `notifications`=1, `calendar`=1, `wines`=1, `simpos`=2, `pos-hub`=2. Worth a
manual pass on `analytics` and `procurement` specifically (largest modules, most crons) before
either takes real multi-tenant volume.

**F4. `common/orchestrator/` (10,929 LOC total in `common/`, orchestrator sub-tree ~7,256 LOC
per the catalog) backs three products — Promotions, Wine Studio, part of Communications
inbound — and is owned by no `01-org` charter. `promotion-extractor.service.ts` runs
`@Cron(EVERY_DAY_AT_9AM)` and writes `provider_promotions` per the catalog's finding #4, but
**`provider_promotions` measured 0 rows** in production just now — either the cron isn't
firing, isn't matching, or the table is swept empty; this contradicts "written on every
provider-matched inbound" and is worth the founder's own check, not mine to resolve here.

**F5. Two more undocumented-but-real modules found while mapping orphans: `menus` (1828 LOC,
8 endpoints, called from `apps/web/src/services/api/menus.ts:83,104` — real, just has no
software note) and `distributor-feed` (2752 LOC, 6 endpoints, backs the `/connections` page's
price-code mapping per `useConnectionsNextData.ts:290,377,425,686,702` — real, and arguably
belongs inside `settings-integrations`'s `api_modules` list, which currently omits it).

**F6. `contacts` module (474 LOC, 8 endpoints, 0 specs, 0% statement coverage) has zero web
callers (`grep` for `/contacts` or `'/contacts` in `apps/web/src` = 0 hits) but is NOT fully
dead — it's called server-side from `providers.controller.ts` and
`communications/letters/house-letters.service.ts`. So it's not an orphan to delete, but it is
untested surface-area with its own public REST endpoints nobody has ever needed from the UI —
worth a `decide` (keep as internal-only and delete the unused public routes, or write the 8
missing specs).

---

## 1. Calendar
- **Code:** route `/calendar` (+ `/calendar-classic` → redirect, `App.tsx:367`), gated
  `PageGate page="calendar"` legacy=`CalendarModular` next=`CalendarNext` (`App.tsx:363`).
  Modules `calendar` (4973 LOC, 22 endpoints, 1 controller, 8 specs) + `events` (643 LOC, 3
  endpoints, 0 specs).
- **Capacity:** promised agent `calendar_agent` — **not found** as a routing-key publisher
  (matches the catalog's own finding #4: "`calendar_agent` have zero publishers on every
  routing key"; still true — no `calendar_agent` string in `apps/api-gateway/src` outside the
  note itself was checked via the module's cron, which is a plain reminder sweep, not an
  agent). Cron: `calendar-reminders.service.ts` (`REMINDER_CRON`) — real, and
  `calendar_events`=7 rows in prod confirms it fires against something.
- **Coverage:** `calendar` module 74.7% stmt / 60.6% branch; `events` 93.8%/79.6%. No
  dedicated e2e (only the 5 global files).
- **Production:** flag OFF for the one tenant — the live page is legacy `CalendarModular`,
  not the redesign. `calendar_events`=7 rows.
- **Verdict vs note:** note says `partial`, holds.

## 2. Dashboard Home
- **Code:** route `/`, gated (`App.tsx:304`), legacy=`Dashboard` next=`DashboardNext`. Module
  `dashboard` (1615 LOC, 8 endpoints, 1 controller, 3 specs).
- **Capacity:** 71.0% stmt but only **36.9% branch** coverage — the lowest branch ratio of any
  module with tests; dashboard error/empty states are the least-exercised paths in the
  gateway.
- **Coverage:** 3 specs for an 8-endpoint, 1615-LOC controller is thin per-endpoint.
- **Production:** flag **ON** — the redesign (`DashboardNext`) is what the one tenant
  actually sees.
- **Owner gap confirmed:** still `unowned — gap` per `SOFTWARE-MAP.md`; no `01-org` charter
  claims `Dashboard.tsx` — not re-verified against all 100 charters in this pass (that would
  mean reading the charter corpus, out of scope here), flagged as `not_checked`.
- **Verdict vs note:** `partial`, holds.

## 3. Inventory Command
- **Code:** route `/inventory`, gated but **same component both branches**
  (`InventoryCommandPage` on legacy and next, `App.tsx:312` — deliberate, documented inline:
  the gate exists only to mount `HouseHeader`). Modules: `inventory` (3312 LOC, 18 endpoints,
  8 specs), `inventory-ledger` (1542 LOC, 8 endpoints, 1 spec), `storage-locations` (693 LOC,
  8 endpoints, 0 specs).
- **Capacity:** `storage-locations` has **0 specs and 32.4% stmt / 10.8% branch coverage** —
  the weakest-tested of the three backing modules for a `live`-in-production surface.
  `inventory-ledger` similarly thin at 1 spec file for 8 endpoints (81.4% stmt coverage says
  the spec that exists is broad, but 1 file covering 8 endpoints means failure modes are
  probably under-exercised — not verified line-by-line).
- **Production:** flag ON; `restaurant_inventory`=183 rows, `inventory_lots`=168,
  `inventory_transactions`=257, `inventory_alert_state`=27. Real, active data — this is one
  of the software's genuinely running on real usage, not just flag-on-with-empty-tables.
- **Verdict vs note:** `partial`, holds — real usage, real gaps in the ledger/storage layers.

## 4. Notifications
- **Code:** route `/notifications`, gated (`App.tsx:387`). Modules `notifications` (9591 LOC,
  26 endpoints, 4 crons, 20 specs), `push` (264 LOC, 0 endpoints, 1 spec).
- **Capacity:** 4 crons including `low-stock-edge-sweep` at `*/2 * * * *` (every 2 minutes) —
  a tight poll interval; at 9591 LOC this is one of the largest modules by far relative to its
  UI footprint, consistent with it being the backbone for cross-product alerts (inventory,
  calendar, procurement all notify through it). `notifications`=566 rows in prod — the
  largest non-corpus table other than the wine library and simpos data — this module is under
  real load already.
- **Coverage:** 76.6% stmt / 61.3% branch, 20 specs — the best-covered module of its size in
  the whole gateway.
- **Production:** flag **OFF** for the redesign — the tenant is on legacy `Notifications.tsx`.
  Backend is fully live regardless (notifications are server-driven, not gated).
- **Verdict vs note:** `partial`, holds; backend is the strongest part of this software,
  frontend redesign not yet shipped to the one tenant.

## 5. Orders
- **Code:** route `/orders`, gated (`App.tsx:319`). Module `procurement` (40,442 LOC — by far
  the largest module in the gateway, 79 endpoints, 7 controllers, 5 crons, 72 specs). Orders,
  Receiving, Receipts & Invoice Match, and Recurring Orders **all four** map to this one
  module — the note's `api_modules: [procurement]` undersells how much of the company's spine
  lives in one folder.
- **Capacity:** 79.0% stmt / 66.2% branch aggregate for the whole module; 8 files with
  loop+await (F3) inside a module this size and this central is the single highest-value
  target for a manual N+1 pass in the whole codebase — not done here (would need per-file
  reading of 8 files, out of this pass's budget; flagged as `not_checked`).
- **Production:** flag ON; `procurement_orders`=2 rows, `procurement_conversations`=27,
  `procurement_documents`=33, `procurement_document_lines`=60. Very light real volume for a
  "live" core product — 2 actual orders placed, ever, against this tenant.
- **Verdict vs note:** `partial`, holds; capacity risk is concentrated here given the module's
  size, not yet stress-tested by real volume.

## 6. Receipts & Invoice Match
- **Code:** routes `/receipts`, `/receipts?tab=credits`, `/documents-reports`. Both gated
  (`App.tsx:370,369`); flags ON for both on the one tenant. Also backs `/documents/:id`
  (`App.tsx:376-385`, ADR 0104 D12 slice 2), which is gated **OFF by default** per its own
  comment (OD-106) and legacy-redirects to `/receipts`.
- **Code, continued:** same `procurement` module as Orders (see §5 for size/coverage).
- **Capacity:** `document-intake.service.ts` cron runs every 5 minutes
  (`*/5 * * * *`, `procurement-document-intake-sweep`) — real polling infrastructure.
- **Production:** `procurement_documents`=33, `procurement_document_lines`=60,
  `document_revisions`=23, `document_deliveries`=19, `document_line_mappings`=4 — modest but
  non-trivial live usage, more than Orders' raw order count, consistent with receipts flowing
  in by email ahead of orders being placed through the UI.
- **Verdict vs note:** `partial`, holds.

## 7. Receiving
- **Code:** routes `/receiving`, `/receiving/:orderId/door` (deliberately outside
  `DashboardLayout`, chrome-free for a loading-dock user — `App.tsx:229-242`). Both gated;
  flag ON for `/receiving` on the tenant. Same `procurement` module.
- **Production:** `delivery_timers`=26, `delivery_proposals`=5, `delivery_line_acceptances`=6,
  `deliveries`=10 — small but real, and the presence of `delivery_timers`/`delivery_proposals`
  data confirms the door flow has actually been used, not just deployed.
- **Verdict vs note:** `partial`, holds; the catalog's finding #1 ("`/receiving`'s three
  defects are all fixed in-tree" but the page note still says otherwise) was not re-verified
  line-by-line here — would require reading the page note plus a diff against
  `ReceivingHome.tsx`/`ReceivingNext`, out of this pass's scope (`not_checked`).

## 8. Recurring Orders
- **Code:** `backend-only`, no route. Same `procurement` module; specifically
  `order-recurrence.service.ts` (`@Cron("15 8 * * *")`) and `recurring-orders.service.ts`
  (`@Cron("0 8 * * *")` and `@Cron("0 6 * * *")` — two cron entries in one file, worth a
  second look for whether both are still needed).
- **Capacity/Production:** `recurring_orders` table = **0 rows**. The crons run daily against
  an empty table — automation that is deployed, scheduled, and has nothing to act on. This
  matches the note's `backend-only` status but "backend-only, and never triggered in
  production" is a stronger and more useful claim than the note currently makes.
- **Verdict vs note:** `backend-only`, technically holds, but functionally dormant — worth
  flagging to the founder as "built, scheduled, unused," same shape as F1.

## 9. Communications Hub
- **Code:** route `/communications`, gated, flag **ON**. Modules `communications` (24,846
  LOC — second-largest in the gateway — 47 endpoints, 7 controllers, **13 crons**, 37 specs)
  and `conversations` (1398 LOC, 12 endpoints, 1 spec).
- **Capacity:** `conversations` is **23.5% stmt / 8.7% branch** covered — a real gap for a
  module with 12 live endpoints; 1 spec file cannot exercise a branch space that thin. 13
  crons in `communications` (retention sweep/derive, house-inbox-read, house-letters-dispatch
  every minute, mail archive export, weekly/daily scheduled tasks) is the densest automation
  surface of any software here.
- **Production:** `message_templates`=0, `communication_templates`=1 —
  confirms the note's `hollow` status still holds on the templating side even though the
  module itself is huge and heavily automated. `notifications`-adjacent send infrastructure
  (`house_message_meter`, `house_message_credits`, `house_message_allowances`,
  `house_text_sender_credentials`, `plan_message_allowances`) are **all 0 rows** — the
  messaging-plan/credit metering layer is fully built (named tables exist, migrated) and
  fully unused.
- **Verdict vs note:** `hollow`, holds and is worse than the note implies once you see the
  credit-metering tables are empty too — this isn't just "the UI renders fake data," it's
  "an entire billing-adjacent subsystem has zero production rows."

## 10. Global Vendor Search
- **Code:** note's routes list `/providers?tab=discover` and `/distributors`, but
  **`/distributors` no longer exists as a page** — `App.tsx:350-353` redirects it to
  `/providers?tab=discover` (a `<Navigate>`, not a rendered page). The note's `pages:
  [providers, distributors]` frontmatter is stale on this point. Module
  `distributor-discovery` (685 LOC, 3 endpoints, 3 specs).
- **Capacity:** smallest gateway module among the vendor-division ones; 89.6% stmt / 69.3%
  branch — well covered for its size, but the surface itself is tiny (3 endpoints) relative
  to what "Global Vendor Search" implies as a product name.
- **Production:** `distributor_directory`=0, `distributor_crawl_log`=0 — the discovery
  corpus itself is empty in production (there's a bigger corpus in `providers`=22 and
  `restaurant_directory`=99, but the distributor-specific tables are unpopulated).
- **Verdict vs note:** `partial` — plausible but the `/distributors` page claim needs
  correcting in the note (it's a redirect target now, not a screen).

## 11. Promotions
- **Code:** route `/promotions`, **not gated** (no PageGate — `App.tsx:354`, plain render of
  legacy `Promotions.tsx`, no redesign variant exists). `api_modules: [providers,
  common/orchestrator]` per the note — confirmed no dedicated `promotions` folder exists.
- **Capacity:** see F4 — `promotion-extractor.service.ts` cron runs daily but
  `provider_promotions`=0 rows right now, contradicting the catalog's finding #4 that it's
  "written on every provider-matched inbound." `promotion_audit`=3 rows exists (a log table),
  so *something* related has fired 3 times ever, but the main promotions table is empty.
- **Production:** `vendor_promotions`=0 as well (a second, differently-named table — worth
  the founder confirming which of `provider_promotions`/`vendor_promotions` is the live one;
  both are 0).
- **Verdict vs note:** `partial` per the note; measured evidence here leans closer to
  `hollow` on the actual promotions data path — flagging as a `decide`, not overriding the
  note myself.

## 12. Vendor Directory & Intel
- **Code:** route `/providers?tab=mine`. Modules `providers` (4664 LOC, 51 endpoints, 2
  controllers, 9 specs) and `vendor-catalogue` (417 LOC, 4 endpoints, 0 specs).
- **Capacity:** **47.3% stmt / 36.6% branch** on `providers` — for 51 endpoints and 9 specs,
  this is under-tested relative to its surface area (roughly 5.7 endpoints per spec file,
  worst ratio of any module over 20 endpoints in the gateway). `vendor-catalogue` has 0
  specs entirely.
- **Production:** `providers`=22 rows, `vendor_catalogue`=25, `provider_contacts`=3,
  `provider_locations`=2 — light but real.
- **Verdict vs note:** `partial`, holds; coverage gap on `providers` is the most concrete
  finding here given it's the single biggest-surface, lowest-coverage controller module in
  the vendor division.

## 13. Vendor Portal
- **Code:** public route `/v/:slug`, no auth (deliberate — `App.tsx:181-183`). Module
  `vendor-portal` (245 LOC, 2 endpoints, 0 specs).
- **Capacity:** 0 specs, 61.0% stmt / **7.9% branch** coverage on a *public, unauthenticated*
  surface — the branch-coverage floor of the whole gateway. This is the software the note
  already calls `hollow` with contested ownership (`PROD-F2` open); production confirms it:
  `vendor_portal_pages`=0, `vendor_portal_listings`=0.
- **Verdict vs note:** `hollow`, holds, and the near-zero branch coverage on a public
  unauthenticated endpoint is worth a security-adjacent look (not a vuln finding by itself,
  just an untested public surface) — `flag` for the founder, not something I can characterize
  as a defect without reading the two endpoints line by line (`not_checked` in depth).

## 14. Vendor Price Compare
- **Code:** route `/vendor-prices`, **not gated**, no redesign. `api_modules: [vendor-intel,
  wines]` per note. Real backing is bigger: `vendor-intel` (11,392 LOC, 26 endpoints, 2 crons,
  20 specs, 79.9%/68.5%) plus the undocumented `price-index` module (6342 LOC, 9 endpoints, 2
  crons — `price-index-fetch` and `price-index-held-book-escalation` — 20 specs, 82.1%/68.6%)
  and `price-register` (333 LOC, 94.9%/92.9%, best-covered tiny module in the repo). The note
  never mentions `price-index`/`price-register` even though they're clearly the price-comparison
  pipeline's actual backbone.
- **Production:** `price_index_postings`=0, `price_index_upload_reviews`=0 — the ingestion
  pipeline exists, is well-tested, runs on a cron, and has never produced a row in production.
- **Verdict vs note:** `hollow`, holds; the note's module list should be corrected to include
  `price-index`/`price-register` (a `fix` on the doc, not the code).

## 15. POS Bridge
- **Code:** `backend-only`, no route (by design). Modules `pos-hub` (3751 LOC, 15 endpoints, 1
  controller, 11 specs, 86.6%/69.8%) and `toast` (2721 LOC, 10 endpoints, 3 specs,
  76.9%/55.7%).
- **Production:** `pos_item_mappings`=290, `pos_checks`=145, `pos_catalog_match_proposals`=135,
  `pos_unresolved_lines`=170 — this is genuinely active, real usage (per memory's
  "POS bridge state: bridge built (1.4%→67.4%)" — consistent direction, not re-measured here
  since the metric's exact definition wasn't reconstructed in this pass; flagged
  `not_checked` for the precise percentage).
- **Verdict vs note:** `backend-only`, holds; this is one of the better-exercised backend
  softwares in the catalog by production row counts.

## 16. SimPOS
- **Code:** routes `/simpos/:restaurantId(/orders|/scenarios)` — **all three dev-only in
  production** (`App.tsx:254,262,276`: `import.meta.env.PROD ? <Navigate to="/" /> :
  <SimposXPage />`). Module `simpos` (3444 LOC, 18 endpoints, 2 specs, 70.1%/49.1%).
- **Capacity:** 2 specs for an 18-endpoint, 3444-LOC module is thin; the module itself is
  well-exercised in **dev/scenario** use (per ADR 0093 memory) but the note's `partial` status
  should make clear the UI is unreachable in production by design, not by accident.
- **Production:** `simpos_catalog`=403, `simpos_checks`=84, `simpos_check_lines`=202,
  `simpos_tables`=40 — heavy synthetic data, consistent with it being a scenario-harness
  generator rather than live restaurant traffic.
- **Verdict vs note:** `partial`, holds.

## 17. Wine Library & Sommelier
- **Code:** routes `/wines` (gated, flag OFF → legacy `WineLibrary`) and `/sommelier`
  (ungated, `SommelierAI`). Module `wines` (2358 LOC, 10 endpoints, 7 specs, 59.1%/52.4%).
- **Capacity:** `master_wine_library`=4253 rows (the largest reference corpus in the
  database) but **`restaurant_wine_roster`=0 rows** — the per-restaurant matched roster that
  would turn the master corpus into "this house's wine list" has never been populated for the
  live tenant. `wine_consumption_log`=119, `pour_events`=78 — pour tracking is real;
  roster-matching is not.
- **Production:** `wine_aliases`=2, `wine_merge_log`=1, `wine_unit_defaults`=0,
  `wine_location_mappings`=0, `wine_menu_prices`=0 — most of the "library" tables beyond the
  raw corpus are empty for this tenant.
- **Verdict vs note:** `hollow`, holds and is well-explained by the roster gap above — a big
  reference corpus with almost nothing hooked up to the one real restaurant.

## 18. Wine Studio
- **Code:** routes `/studio`, `/studio/queue`, `/studio/certify`, `/studio/invite/:token` —
  own layout outside `DashboardLayout` (`App.tsx:188-227`), role-gated
  (`developer`/`certified_contributor`/`review_admin`). Backed by `common/orchestrator`
  proxy controllers (no dedicated module folder — confirmed, matches the note).
- **Production:** no Studio-specific tables were identified in the 284-table listing under an
  obvious name (`decision_log`=26 rows may be Studio-adjacent — not confirmed which
  software owns it, `not_checked`).
- **Verdict vs note:** `partial`, holds; ownership gap (`common/orchestrator` unowned)
  confirmed still open per F4.

## 19. Recommendations
- **Code:** routes `/recommendations` (gated, flag OFF) and `/recommendations/catalog`
  (`InsightCatalog`, ungated). Modules `analytics` (18,008 LOC — third-largest in the gateway,
  57 endpoints, 3 controllers, 2 crons, 36 specs, 76.4%/54.3%), `one-tap-actions` (1633 LOC, 9
  endpoints, 3 specs, 68.3%/59.6%), `ux-optimizer` (2743 LOC, 13 endpoints, 1 cron, 4 specs,
  55.8%/40.0%).
- **Capacity:** `one_tap_actions` table = **0 rows** — the "one-tap approve" feature the
  catalog's finding #1 says was already fixed from fake-to-real is deployed with a real
  endpoint and zero real actions ever taken. `recommendation_actions`=0,
  `recommendation_digest_prefs`=1, `recommendation_impressions`=75 — recommendations are
  *shown* (75 impressions) but never *acted on* (0 actions) by the one tenant.
- **Coverage:** `ux-optimizer` at 55.8%/40.0% is the weakest-covered of the three backing
  modules.
- **Verdict vs note:** `partial`, holds; "impressions without actions" is the sharpest,
  most concrete capacity gap found in this whole pass — the recommendation engine runs, is
  seen, and is never used.

## 20. Reports & Analytics
- **Code:** routes `/reports` (gated, flag OFF) and `/logs` (gated, flag OFF — both render
  legacy). Modules `analytics` (shared with Recommendations, see §19), `reports` (3894 LOC, 17
  endpoints, 2 controllers, 1 cron, 6 specs, 85.5%/68.3%), `logs` (646 LOC, 1 endpoint, 2
  specs, 94.8%/68.6%).
- **Capacity:** `logs` module exposes **only 1 endpoint** for a page named "Logs" — most of
  what `/logs` renders is presumably read through other modules' endpoints or client-side
  aggregation, not verified further here (`not_checked`). `generated_reports`=0,
  `manager_report_profiles`=0 — the report-generation and profile-scheduling tables are
  empty; nobody has generated or scheduled a report in production yet.
- **Verdict vs note:** `partial`, holds; the note's own gap ("`reports` is claimed by no
  charter at all") is unchanged.

## 21. Admin & Health
- **Code:** routes `/admin`, `/admin/health` (both `requiredRole="owner"`), `/dev-sandbox`
  (same). Modules `health` (413 LOC, 2 endpoints, 2 controllers, 4 specs, 98.1%/88.2% — best
  branch coverage of any real module) and `database` (132 LOC, 0 endpoints, 0 specs,
  37.3%/27.8%).
- **Capacity:** `database` module has 0 specs and sub-40% coverage but only 132 LOC and 0
  HTTP endpoints — likely an internal connection-pool/health helper rather than a product
  surface; low risk despite the low percentage.
- **Verdict vs note:** `partial`, holds.

## 22. App Shell & Support
- **Code:** routes `/help`, `/privacy`, `/credits` (the last a redirect to
  `/receipts?tab=credits`, `App.tsx:371` — so "Credits" isn't a page at all in this build,
  it's a redirect into Receipts). `api_modules: []` per note — confirmed, no backend module.
- **Verdict vs note:** matches the note's own framing ("by design, not a defect" — a
  shell/legal surface, not a product). No further capacity/coverage work applies.

## 23. Auth & Onboarding
- **Code:** routes for login/register/forgot-reset-verify-invite/no-access/get-started/
  onboarding/profile. Module `auth` (5040 LOC, 29 endpoints, 20 specs, 71.9%/63.1%) +
  `restaurants` (972 LOC, 8 endpoints, 2 controllers, 3 specs, 76.4%/66.3%).
- **Production:** `users`=8, `user_restaurant_access`=15, `organizations`=8,
  `organization_members`=8, `onboarding_sessions`=21, `email_verifications`=4,
  `password_resets`=1 — small but fully exercised; every table in the auth path has at least
  one real row, unlike most of the softwares above.
- **Verdict vs note:** `partial`, holds; this is the most evenly-used software measured in
  this pass (every backing table has production data, not just the headline one).

## 24. Mudavym MCP Server
See **F1** above — the whole finding lives there since it's the single highest-value
correction this pass produced. Summary: code and tests are real (`mcp-server`+`mcp-runtime`+
`mcp-connections` = 6701 LOC, 18 endpoints, 14 specs combined), 5 `CLAIMS.jsonl` rows resolved
2026-09-06, zero production rows in any of its 6 tables. `recommendation: decide`.

## 25. Settings & Integrations
- **Code:** routes `/settings`, `/services` (redirect to `/settings?tab=services`,
  `App.tsx:410`), `/authorize/:integrationId`, `/connections`. `/settings` gated (flag OFF),
  `/connections` gated (flag OFF, legacy redirects to `/profile` per ADR 0114). Note's
  `api_modules` list is the longest of any software: `settings, integrations,
  user-preferences, restaurant-templates, mcp-connections, mcp-runtime, payment-methods,
  billing` — plus the undocumented `distributor-feed` per F5. `settings` module itself is
  well-covered (94.0%/75.0%); `user-preferences` (71 LOC, 50.7%/39.6%) and
  `restaurant-templates` (92 LOC, 53.3%/44.4%) are both small and under-tested but low-risk
  by size.
- **Production:** `integration_oauth_connections`=0, `payment_methods`=0,
  `billing_customers`=0, `billing_webhook_events`=0 — the entire integrations/billing/payment
  stack under this software has never recorded a row, matching Communications' pattern (F1,
  finding 9) of built-and-metered-but-unused infrastructure.
- **Verdict vs note:** `partial`, holds; the payment/billing sub-surface is closer to
  `hollow` in practice.

## 26. Team Command
- **Code:** route `/team`, gated, flag **ON**. Modules `team` (4227 LOC, 35 endpoints, 6
  specs, 67.4%/51.1%) and `organizations` (925 LOC, 8 endpoints, 4 specs, 58.9%/52.1%).
- **Capacity:** 6 specs for 35 endpoints is the thinnest spec-to-endpoint ratio of any
  `live`-status software (5.8 endpoints/spec). `team_certifications`=0, `schedules`=0,
  `shifts`=0, `shift_breaks`=0, `time_off_requests`=0, `swap_requests`=0,
  `coverage_templates`=0, `team_availability`=0 — the scheduling half of "Team Command"
  (everything past the roster itself) is entirely unused in production: `team_members`=11,
  `users`=8 are the only populated tables under this software.
- **Verdict vs note:** the note claims `status: live` — the only software in the catalog with
  that verdict. Measured evidence does not support "live" for the scheduling capabilities the
  module clearly ships (endpoints exist for shifts/schedules/time-off per the file names under
  `apps/api-gateway/src/team/`, not enumerated line-by-line here); it supports "live" only for
  the roster/member-list capability. Flagging as a `decide`-severity discrepancy: either the
  status should read `partial` (roster live, scheduling unused) or the founder considers
  scheduling out of scope for this tenant by choice, in which case the note should say so.

---

## Orphans — code claimed by no software note

| Module | LOC | Endpoints | Real caller? |
|---|---|---|---|
| `menus` | 1828 | 8 | Yes — `apps/web/src/services/api/menus.ts:83,104` (F5) |
| `distributor-feed` | 2752 | 6 | Yes — `useConnectionsNextData.ts` (F5), belongs under Settings & Integrations |
| `ask-ai` | 1706 | 5 | Yes — `apps/web/src/components/askai/*`, `services/api/askAi.ts` — a whole "Ask AI" assistant bar with no software note at all |
| `contacts` | 474 | 8 | Partial — 0 web callers, 2 server-side callers (F6) |
| `beverages` + `cellar` | 2337 + 1624 | 9 + 4 | Yes — backs `/beer /whiskey /cocktails /spirits /non-alcoholic /soft-drinks` via `CellarNext`, all real routes in `App.tsx:328-333`, zero mention in any software note. This is the largest true gap: a whole "Cellar" product (non-wine beverages) with 6 live routes and no catalog entry at all. |
| `commodity` | 7297 | 9 | Not traced to a UI caller in this pass (`not_checked`) — likely backs price/vendor-intel indirectly |
| `weather` | 1777 | 0 (1 cron) | Not traced (`not_checked`) — likely a dashboard widget data source |
| `vendor-terms` | 1857 | 2 | Not traced (`not_checked`) — name suggests it belongs under Vendor Directory or Orders |
| `seo` | 458 | 3 | Not traced — per memory ("SEO/GEO surface 2026-09-17"), recent, pre-dates any software note |
| `settings-audit` | 579 | 1 | Likely belongs inside Settings & Integrations, currently unlisted |
| `price-register` | 333 | 0 | Backs Vendor Price Compare per §14, unlisted in that note |

**Biggest single finding in this table: Cellar.** Six production routes, two real gateway
modules (beverages+cellar, 3961 LOC combined), a dedicated `CellarNext` frontend tree — and it
does not exist anywhere in the 26-software catalog. It is not folded into Wine Library either
(that note's routes are `/wines`,`/sommelier` only). This is a `fix`-severity documentation
gap, not a code defect.

---

## What this pass could not check (say plainly)

- Did not read any `01-org/` charter in full to re-verify the 6 open ownership gaps (Dashboard
  Home, Promotions, Vendor Portal, Wine Library & Sommelier, Wine Studio, Reports & Analytics)
  — confirmed they're still listed as gaps in `SOFTWARE-MAP.md`, did not re-derive from the
  charter corpus itself.
- Did not run web (`apps/web`) or mobile Jest coverage — task scoped coverage to "the gateway,
  reuse it"; web/mobile coverage is `not_checked`.
- Did not open a Docker/local Postgres to test cron behavior directly (Docker is hung per
  ground rules) — cron *existence* and *schedule* are verified from source; whether each cron
  actually fires in Railway's production scheduler is `not_checked`.
- Did not verify the POS Bridge "1.4%→67.4%" memory figure's exact definition — reported the
  row counts that are consistent with real usage instead.
- Did not do a line-by-line N+1 audit of the 8 flagged `procurement` files or 9 flagged
  `analytics` files (F3) — flagged as candidates only.
- Did not check Railway's actual env/cron config (only the repo's `.railway/railway.ts` and
  `vercel.json` were read) for flag values beyond the one `restaurant_feature_flags` row
  queried directly.
