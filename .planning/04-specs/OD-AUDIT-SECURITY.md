# OD-AUDIT-SECURITY — did the 2026-08-24/25 security entries close the class, or the line?

**Date:** 2026-08-25 · **Scope:** OD-20, OD-35, OD-36, OD-44, OD-45, OD-54, OD-55, OD-61, OD-62, OD-71
**Method:** source verification on `origin/main` (`8c9301fb`), production HTTP probes against
`wineopsapi-gateway-production.up.railway.app`, and read-only SQL against the production pooler.
**Nothing was changed.** This is an audit branch; no application code was touched.

The failure pattern under test: *an entry marked resolved because the artifact it named was fixed,
while the problem it was pointing at survives.* Three questions per entry — (1) is the named
artifact fixed, (2) was it the whole problem or one instance, (3) would the fix survive the next
similar change.

---

## Verdict table

| ID | Verdict | One-line reason |
|---|---|---|
| OD-20 | **HALF-CLOSED** | Analytics guarded and 401 in prod; **8 other controllers carry no `JwtAuthGuard` at all** and `TenantGuard` fails open by design |
| OD-35 | **CLOSED** | Guard + prod gate both verified; the entry's own stated reason (shared Supabase) is what OD-20's residue now inherits |
| OD-36 | **HALF-CLOSED** | All 5 JWT sites route through `resolveJwtSecret`; `JWT_REFRESH_SECRET` still derives from it, and `jwt-secret.ts` has no spec |
| OD-44 | **CLOSED** | `--check` green, CI job blocking, 16 pytest + jest mirror, C-02 unioned; no other parity claim survives in the tree |
| OD-45 | **HALF-CLOSED** | `generated_reports` gone from the browser; **8 other browser-side Postgres queries remain**, and 12 tables sit RLS-**off** with `anon` holding full DML |
| OD-54 | **HALF-CLOSED** | TS side genuinely clean across every sink, not just `fetch(`; the **Python runtime has an unauthenticated user-URL fetch with TLS verification disabled** |
| OD-55 | **CLOSED** | `MAX_PAGES = 120` enforced and logged, dedicated spec; no second paid-per-item loop on a user-controlled bound |
| OD-61 | **HALF-CLOSED** | Prod *does* have the fix (entry says otherwise); but **two more `cost_usd` columns are still `NOT NULL DEFAULT 0`**, and the migration ledger has no row for it |
| OD-62 | **CLOSED** | `Rate` has no defaults, tests pass, no live `gpt-4-turbo` call site remains |
| OD-71 | **CLOSED** (for `pos_*`) | 13 FKs live in prod, only vendor `external_*` ids uncovered; **class-wide 126 FK-less uuid ref columns across 87 tables** |

---

## OD-20 — analytics consultant endpoints unauthenticated

**1. Named artifact: FIXED.**
`apps/api-gateway/src/analytics/analytics.controller.ts:51` carries class-level `@UseGuards(JwtAuthGuard)`.
Confirmed live, not just in source:

```
GET https://wineopsapi-gateway-production.up.railway.app/api/v1/analytics/health -> 401
```

**2. Whole problem? NO — this is the important finding.**
There is **no global `JwtAuthGuard`**. `apps/api-gateway/src/app.module.ts:125,129` registers exactly two
`APP_GUARD` providers, `RateLimitGuard` and `TenantGuard`. And `TenantGuard` fails open by construction:

> `apps/api-gateway/src/common/tenant/tenant.guard.ts:38-47`
> `// If no authenticated user, allow through — JwtAuthGuard should enforce where required.`
> … `if (!user?.restaurantId) { … return true; }`

So a controller that forgets `@UseGuards` is anonymous, and the only thing that notices is a `logger.warn`.
Eight controllers contain **zero** references to `JwtAuthGuard`:

| Controller | Surface |
|---|---|
| `procurement/recurring-orders.controller.ts` | full CRUD on `:restaurantId` **+ `POST :restaurantId/execute-check`** (`:125`) which calls `executeDueRecurringOrders()` for *every* restaurant |
| `notifications/notifications.controller.ts` | 20 routes — create, read, bulk-delete, push subscribe |
| `dashboard/dashboard.controller.ts` | 8 routes, all `:restaurantId`-scoped reads |
| `communications/communications.controller.ts` | `POST email`, `POST sms`, alert triggers (9 already `@Public()`) |
| `toast/toast.controller.ts` | `POST orders`, `GET sales`, `GET statistics`, cache refresh |
| `contacts/contacts.controller.ts` | full CRUD — **module is not registered in `app.module.ts`**, so 404 in prod |
| `common/orchestrator/inbound-email.controller.ts` | webhook, `@Public()` by intent |
| `vendor-portal/vendor-portal.controller.ts` | `@Public()` by intent (public vendor pages) |

Proven unauthenticated in **production**, not inferred:

```
GET /api/v1/dashboard/stats/00000000-0000-0000-0000-000000000000
  -> 200 {"totalWines":0,"totalBottles":0, … }
GET /api/v1/notifications/unread/count?restaurantId=<uuid>
  -> 400 {"message":["userId must be a UUID"]}        # handler reached; no auth layer
GET /api/v1/communications/status -> 200 {"gmailReady":false,"smsReady":false,…}
GET /api/v1/toast/health          -> 200
GET /api/v1/contacts              -> 404              # module not registered
```

The 400 is the sharpest evidence: a validation error means the request passed routing and DTO
binding and died inside the handler's own pipe. Nothing asked who was calling.

**Spend specifically is contained.** All nine services that inject `ModelClientService`
(`ux-optimizer`, `vendor-page-extractor`, `inbound-responder`, `document-extractor`, `document-intake`,
`photo-count`, `scan-parser`, `consultants`, plus the client itself) are reached only through
controllers that do carry `JwtAuthGuard`. OD-20's *cost* framing is closed; its *unauthenticated
endpoint* framing is not.

**3. Survives the next change? NO.** No global guard, no lint rule, no test asserting every controller
is guarded. The next controller merged without `@UseGuards` is anonymous and CI is green.

---

## OD-35 — simpos confused deputy

**1. Named artifact: FIXED.** `apps/api-gateway/src/simpos/simpos.controller.ts:54` — `@UseGuards(JwtAuthGuard)`
sits above `@Controller("simpos/:restaurantId")` (note: above, which is why a naive
"decorators between `@Controller` and `export class`" scan misses it). The production gate at
`apps/api-gateway/src/app.module.ts:89` is intact:
`...(process.env.NODE_ENV !== "production" ? [SimposModule] : [])`.
The HMAC webhook path additionally gained a local uuid-shape assertion before the URL is built
(`simpos.service.ts:517-525`), so path traversal via `restaurantId` is closed at the sink rather
than at a distant caller.

**2. Whole problem? YES for simpos.** The entry's real insight — *dev and staging point at the same
Supabase as production, so an unauthenticated endpoint anywhere writes real rows* — is correct and
now handled here. But that insight was never generalised: it applies verbatim to the eight
controllers listed under OD-20, which unlike simpos **are** loaded in production.

**3. Survives? Partially.** The guard is class-level so new routes inherit it. But nothing prevents
a future module from repeating the original omission — same gap as OD-20.

---

## OD-36 — JWT secret falls back to a published string

**1. Named artifact: FIXED.** Every one of the five signing/verification sites now calls
`resolveJwtSecret`, which throws outside development:

- `auth/auth.module.ts:29`
- `auth/auth.service.ts:65`
- `auth/strategies/jwt.strategy.ts:13`
- `websocket/websocket.module.ts:13`  ← one of the two sites the entry said was unverified
- `websocket/websocket.gateway.ts:656` ← the other

`grep -rn "your-secret-key-change-in-production" apps/ services/ packages/` returns **only**
`auth/jwt-secret.ts:5` (a comment) and `:11` (the named constant). No live fallback anywhere.

**2. Whole problem? NO — one instance of the class survives, in the same constructor.**

> `apps/api-gateway/src/auth/auth.service.ts:68-70`
> ```ts
> this.jwtRefreshSecret =
>   this.configService.get<string>("JWT_REFRESH_SECRET") ||
>   this.jwtSecret + "-refresh";
> ```

If `JWT_REFRESH_SECRET` is unset in production, the refresh secret is deterministically derived from
the access secret — it only warns (`:78-81`). That is a weaker version of exactly what OD-36 was
about: a secret with a predictable fallback and a log line instead of a stop. It is materially
better than a published constant (it is unguessable if `JWT_SECRET` is), but the *shape* the entry
set out to eliminate — "unset env var silently yields a derivable secret" — is still present.

**3. Survives? NO.** There is **no spec for `jwt-secret.ts`** — `apps/api-gateway/src/auth/` contains
only `auth-profile.spec.ts` and `password-reset.spec.ts`. The throw behaviour is untested, and no
lint rule blocks a new `process.env.JWT_SECRET || "…"`. The fix is a corrected line plus discipline.

---

## OD-44 — one commitment guardrail, two runtimes

**1. Named artifact: FIXED, and verified by running it.**

```
$ python3 scripts/sync_commitment_patterns.py --check
Commitment patterns in sync (19 patterns).
exit=0
```

Canon is `apps/api-gateway/src/common/orchestrator/commitment-patterns.ts`; generated module is
`services/agent-orchestrator/core/commitment_patterns.py`. Both consumers import from the canon:
`agents/provider_conversation_agent.py:40` and `services/constraint_engine.py:7-8`. C-02 is a union,
not a replacement — `constraint_engine.py:46-49` spreads `SHARED_COMMITMENT_PATTERNS` then adds its
three heuristics, so it can only be stronger.

**2. Whole problem? YES.** Swept the tree for other cross-runtime parity assertions
(`ported verbatim|copied verbatim|kept in sync with|mirrors the python|must match`): the only hits
left are the five that *describe* this fix (`commitment-patterns.ts:17`, its spec, the pytest mirror,
and `constraint_engine.py:25`). No second undefended duplication of this shape exists.

**3. Survives? YES — this is the one entry with a real mechanism.**
`.github/workflows/ci.yml:58-74` defines a blocking `commitment-guardrail-sync` job running
`--check` on push and PR to `main`/`develop`, with failure text that explicitly forbids weakening the
list to make it pass. Both test mirrors run green:

```
$ pytest tests/test_commitment_patterns_sync.py -q
16 passed in 0.46s
```

plus `commitment-patterns.spec.ts` on the TS side.

---

## OD-45 — browser reads Postgres directly

**1. Named artifact: FIXED.** `grep -rn "generated_reports" apps/web/src` returns exactly one hit and
it is a comment: `apps/web/src/services/api/reports.ts:90` —
`GET /reports — replaces a direct supabase.from('generated_reports') read.`
The gateway route is live and guarded:

```
GET /api/v1/reports -> 401
```

RLS claim re-verified against production: `generated_reports` has `relrowsecurity = true`, **0
policies**, and `anon` + `authenticated` both hold `DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE`.

**2. Whole problem? NO — twice over.**

**(a) Other hooks still query Postgres from the browser.** `apps/web/src/lib/supabase.ts` runs eight
direct table reads, five of them against a table in the *identical* silent-failure state:

| Line | Table | Prod RLS state |
|---|---|---|
| `:231`, `:255`, `:277`, `:300` (+ `:292`) | `procurement_orders` | RLS on, **0 policies** → every read silently returns `[]` |
| `:130`, `:177` | `master_wine_library` | RLS on, 1 policy: `anon_read_master_wine_library` `USING (true)` — the whole library readable by anyone with the anon key |
| `:194`, `:292` | `restaurant_inventory` | RLS on, 1 real policy scoped via `user_restaurant_access` |

`procurement_orders` is OD-45's bug verbatim — L6→L0 inversion *and* a silent `[]` — sitting four
lines below the query that was fixed. (`packages/database/src/queries/*` holds 19 more such calls;
nothing under `apps/web` or `apps/mobile` imports that package today, so it is dormant, not live.)

**(b) The residue is worse than "the other 141 tables remain open".** That framing describes the
RLS-on/no-policy state, which fails *closed* for reads. There are also **12 public tables with RLS
switched off entirely**, while `anon` holds full DML on all of them:

```
_bak_library_before_corpus      procurement_credits          procurement_documents
_bak_seed_repair_20260813       procurement_document_lines   procurement_receipt_events
_bak_wine_match_keys_20260812   procurement_document_links   user_oauth_accounts
spatial_ref_sys                 wine_merge_log               wine_repair_log
```

`anon` privileges on each: `DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE`. The anon key is
compiled into the browser bundle by construction (`apps/web/src/lib/supabase.ts:12`,
`import.meta.env.VITE_SUPABASE_ANON_KEY`), so "holder of the anon key" means "anyone who loaded the
site". `user_oauth_accounts` currently holds 1 row and stores `user_id` / `provider` /
`provider_user_id` (no tokens — checked), but it is the table that maps an OAuth identity to a user
and it is anonymously writable. The five procurement tables are empty today; the document-intake
pipeline writes to them.

Current counts, production: **142** tables RLS-on-with-zero-policies, **12** tables RLS-off.

**3. Survives? NO.** No policy template, no migration lint, no test asserting a new table ships with
either RLS+policy or an explicit exemption. The next table inherits whichever default the migration
author happened to type.

---

## OD-54 — SSRF on a user-controlled URL

**1. Named artifact: FIXED, and well.** `apps/api-gateway/src/common/net/ssrf-guard.ts` exports
`assertPublicHttpTarget` (`:108`) and `safeFetch` (`:150`); `safeFetch` re-resolves and re-validates
**every redirect hop** (`:159`), which is the hole a pre-flight-only check leaves. Both fetches in
`vendor-page-extractor.service.ts` are routed through it — the page fetch at `:168` and, correctly,
the `robots.txt` probe at `:92`, which is derived from the same attacker-supplied host.
`ssrf-guard.spec.ts` exists alongside it.

**2. Whole problem? Split verdict — TS clean, Python not.**

I swept every outbound-HTTP shape in the gateway, not just `await fetch(` — `axios.*`, `httpService.*`,
`got`, `request`, bare `fetch`. Thirteen call sites. Every one has a constant or config-derived host:

| Site | Host source |
|---|---|
| `auth/auth.service.ts:457,496` | Google tokeninfo / MS Graph, constants |
| `toast/toast-auth.service.ts:67` | `TOAST_API_URL` config |
| `integrations/integrations-oauth.service.ts:366,393,556` | ternary over two literal endpoints |
| `push/expo-push.service.ts:115` | `EXPO_PUSH_URL` constant |
| `common/model-client/model-client.service.ts:178` | `ANTHROPIC_API_URL` constant |
| `conversations/conversations.service.ts:438,664,761` | `AGENT_ORCHESTRATOR_URL` config |
| `simpos/simpos.service.ts:527` | internal base URL + uuid-asserted path |

So the TypeScript runtime is genuinely clean. **The Python runtime is not, and nothing about OD-54
reaches it:**

> `services/agent-orchestrator/api/scan_routes.py:848-855`
> ```python
> @router.post("/crawler/crawl")
> async def crawl_restaurant(request: CrawlRequest):
>     crawler = get_crawler_service(...)
>     result = await crawler.crawl_restaurant(request.website_url, request.restaurant_name)
> ```

`request.website_url` goes from the request body into the crawler with no allowlist and no
private-range check. The router is declared at `scan_routes.py:79` as
`APIRouter(prefix="/api/v1/scan", tags=["scanning"])` — **no `dependencies=`**, so no auth on the
route either. Downstream it gets worse:

> `services/agent-orchestrator/services/web_crawler.py:850-878`
> `await page.goto(pdf_url, …)` … then an aiohttp fallback with
> `ssl_ctx.check_hostname = False` / `ssl_ctx.verify_mode = ssl.CERT_NONE`

`pdf_url` is harvested from links on the crawled page (`_find_menu_links`), i.e. fully
attacker-chosen once the attacker controls the first page. TLS verification is disabled on that
fetch. This is the same vulnerability class OD-54 named, in the other runtime, unguarded — the exact
shape OD-44 spent a whole ADR eliminating for the commitment guardrail.

*Caveat I could not resolve:* whether the agent-orchestrator is reachable from the public internet.
`AGENT_ORCHESTRATOR_URL` is a config value and I did not probe the deployed orchestrator host. If it
is internal-only the severity drops from "external SSRF" to "SSRF for anything that can reach the
service mesh"; the missing guard is a finding either way.

**3. Survives? NO.** Nothing stops a new TS fetch from bypassing `safeFetch` — no lint rule, no
wrapper enforcement, no CodeQL gate on the sink. And the guard has no Python counterpart to reuse.

---

## OD-55 — loop-bound injection from an uploaded PDF

**1. Named artifact: FIXED.**

> `apps/api-gateway/src/menus/parsers/scan-parser.service.ts:395-401`
> ```ts
> const MAX_PAGES = 120;
> const effectivePages = Math.min(pageCount, MAX_PAGES);
> if (pageCount > MAX_PAGES) { this.logger.warn(`… refusing to parse beyond ${MAX_PAGES}. …`) }
> ```

The chunk loop at `:405` iterates `effectivePages`, not `pageCount`, so the paid-call count is
bounded regardless of what the upload claims. Truncation is announced, never silent — a real
120+-page menu fails loudly.

**2. Whole problem? YES, as far as I can establish.** The only other `for` loop in the parser that
looks per-item is `:248`, and it is `dedupe()` — pure string normalisation over already-parsed
results, no model call. `document-intake.service.ts` has no per-page model loop (its loops at `:480`
and `:597` iterate matched lines and attachments). No second unbounded paid loop on a
user-controlled count found in the gateway.

**3. Survives? YES.** `scan-parser.split-bound.spec.ts` exists and constructs an oversized PDF
(`:23`, `for (let i = 0; i < n; i++) doc.addPage(...)`) — the cap is asserted by a test, not just a
constant.

---

## OD-61 — `api_spend.cost_usd` must be able to say "unknown"

**1. Named artifact: FIXED — and the entry understates its own success.**
The entry closes with "Migration written, **NOT applied**". Production disagrees:

```
api_spend.cost_usd | is_nullable = YES | column_default = NULL | numeric
```

The DDL is live. So is `neural_footprint_event.cost_usd` (`YES`/`NULL`). The 185-row / $0.923359
figure is unchanged, with 0 NULLs and 2 zero-cost rows, consistent with "no backfill".

**But the migration ledger has no record of it.** `supabase_migrations.schema_migrations` for
`version >= '20260824'` returns six rows, ending at `20260825140000 pos_proposal_candidate_fk` —
there is no row for `20260825160000_api_spend_cost_usd_nullable`, though the file exists at
`supabase/migrations/20260825160000_api_spend_cost_usd_nullable.sql`. The state was applied
out-of-band. Related divergence found in the same query: the ledger records
`20260825120000 pos_item_mappings_inventory_fk` and `20260825140000 pos_proposal_candidate_fk`, but
the repo files at those versions are `pos_sale_volume_contract.sql` and
`pos_referential_integrity.sql`; and `20260825150000_clear_foreign_format_submission_signatures.sql`
is recorded under version `20260824071839`. **The ledger and the repo do not agree on what was
applied.** Any future `db reset` replays a different chain than production ran.

**2. Whole problem? NO.** The entry says "both ledgers now agree". There are **four** cost columns in
production, and two of them still tell the lie ADR 0016 was written to kill:

```
api_spend.cost_usd                    YES  NULL   ← fixed
neural_footprint_event.cost_usd       YES  NULL   ← fixed
research_run_stats.cost_usd           NO   0      ← still asserts "free" on an omitted INSERT
research_runs.cost_usd                NO   0      ← still asserts "free" on an omitted INSERT
```

This is not an unrelated table. The entry's own reader audit identified
`research_tasks._budget_available` — the research daily-budget gate — as the reader that broke on a
NULL, and `api/research_routes.py:131,162` sums `research_run_stats` and `research_runs` for the
research metrics. The fix reached the ledger that was named and skipped the ledger the named reader
actually reads.

**3. Survives? Partially.** ADR 0016 states the rule and `test_rate_rows_all_carry_a_dated_verified_source`
enforces the *rate* half (see OD-62), but nothing asserts that a new cost column is nullable — the
two `NOT NULL DEFAULT 0` columns above are the proof.

---

## OD-62 — `gpt-4-turbo` rate suspicion

**1. Named artifact: CORRECTLY DISMISSED, and the durable half shipped.**
`services/agent-orchestrator/services/spend_logger.py:62-82` — `class Rate(NamedTuple)` with
`verified: str` and `source: str` carrying **no defaults**, so an undated rate row is a `TypeError`
at import time rather than a silent unverifiable number. The rate row itself is at `:130` with its
dated citation in the comment at `:123-128`.

**2. Whole problem? YES.** The "one live call site" really is gone —
`grep -rn "gpt-4-turbo" services/ apps/` returns only the rate row, its comment, and the tests. No
production code path names the model.

**3. Survives? YES — verified by running it:**

```
$ pytest tests/test_spend_logger.py -k "rate_rows_all_carry or turbo" -q
2 passed, 29 deselected in 0.06s
```

`test_rate_rows_all_carry_a_dated_verified_source` (`tests/test_spend_logger.py:760`) fails the build
on a malformed, future, or placeholder date. This is the strongest Q3 answer in the set alongside
OD-44: a *type-level* impossibility plus a build-blocking test, not a corrected value.

---

## OD-71 — POS referential integrity

**1. Named artifact: FIXED, verified in production.** Thirteen foreign keys now exist across the four
`pos_*` tables — including the delete behaviours the ADR derived: `restaurant_id → restaurants(id)
ON DELETE CASCADE` on all four, `resolved_by → auth.users(id) ON DELETE SET NULL` on both tables that
have it, and `candidate_*` → `SET NULL` (a question outlives its answer) vs `pos_item_mappings.inventory_id
→ CASCADE` (a claim dies with its target). The only `*_id` columns on `pos_*` still without a FK are:

```
pos_catalog_match_proposals.external_item_id     pos_checks.correlation_id
pos_checks.external_check_id                     pos_checks.server_external_id
pos_item_mappings.external_item_id               pos_unresolved_lines.external_check_id
pos_unresolved_lines.external_item_id
```

All seven are vendor-side identifiers or a trace id — correctly not foreign keys. The entry's scope
is genuinely complete.

**2. Whole problem? NO — this is 4 tables of 87.** Across the whole `public` schema there are
**126 uuid columns named `*_id` with no foreign key, spread over 87 tables**. Thirty-six of them are
`restaurant_id`, i.e. the very column whose CASCADE census the ADR used to justify its choices:

```
analytics_goals, analytics_insight_prefs, analytics_insights, api_spend, check_scans,
conversation_attachments, coverage_templates, drift_findings, email_prospects,
inventory_alert_state, inventory_events, inventory_lots, invoice_scans,
master_wine_library_submissions, menu_price_versions, mobile_devices,
neural_footprint_event, notification_deliveries, pour_events, pricing_analyses,
profit_margins, provider_conversation_sessions, provider_knowledge, provider_promotions,
provider_sentiment_history, recommendation_actions, recommendation_digest_prefs,
recurring_orders, restaurant_tables, restaurant_venue_profiles, schedules,
sender_reputation, server_sales, shifts, simpos_catalog, simpos_check_lines, simpos_checks
```

`inventory_lots` and `inventory_events` are the source of truth for the inventory rebuild;
`neural_footprint_event` is P1's own table. Deleting a restaurant leaves all of them orphaned.

**3. Survives? NO.** ADR 0014's rule ("a claim dies with its target, a question outlives its answer")
is written down but not enforced — no migration lint, no test asserting new `*_id uuid` columns carry
a FK. The next table repeats it.

---

## Cross-cutting: the shape that keeps recurring

Three of the ten entries were closed against **one runtime, one table, or one call site** of a
problem that spans several:

- OD-45 fixed one of nine browser-side Postgres queries.
- OD-54 fixed the TypeScript sink; the Python one is unauthenticated and runs with TLS off.
- OD-61 fixed two of four `cost_usd` columns; OD-71 fixed four of 87 tables.

And two of the ten shipped a mechanism rather than a value — OD-44's blocking CI job and OD-62's
default-less `NamedTuple`. Those two are the only entries where I can answer "would the fix survive
the next similar change" with yes.

## What I could not verify

- **Whether the agent-orchestrator is publicly reachable.** I probed the gateway host only. OD-54's
  Python finding is a missing guard regardless, but its severity depends on this.
- **OD-71's "zero orphans" and the rolled-back cascade proof.** I confirmed the constraints exist in
  production, which makes orphans impossible going forward; I did not re-run the historical
  orphan census or repeat the cascade transaction.
- **Whether the 400 on `/notifications/unread/count` would become a 200 with a real `userId`.** I
  stopped at proving no auth layer ran; I did not supply a real tenant id or pull tenant data.
- **`packages/database/src/queries/*` (19 direct Postgres calls).** I confirmed nothing under
  `apps/web` or `apps/mobile` imports it today; I did not audit every other possible consumer.
