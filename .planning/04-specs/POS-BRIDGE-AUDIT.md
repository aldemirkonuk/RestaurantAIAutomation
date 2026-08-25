---
type: spec
id: POS-BRIDGE-AUDIT
title: POS bridge — what exists, what is missing, what does not matter yet
status: proposed
updated: 2026-08-24
supersedes: "md/04-updates-builds/POS_INTEGRATION_COMPLETE.md"
links:
  - "[[pos-bridge-charter]]"
  - "[[pos-bridge-premortem]]"
  - "[[S04-pos-order-flows-to-inventory]]"
  - "[[YC_WEDGE_PLAN]]"
  - "[[v3.0-TECH-DEBT]]"
---

# POS bridge — audit

> **Question asked.** *"An all-in-one POS system bridge, like an MCP server but for POS
> systems, linking to our analytics — if we haven't already."*
>
> **Retire-to-write.** This document **supersedes**
> [`md/04-updates-builds/POS_INTEGRATION_COMPLETE.md`](../../md/04-updates-builds/POS_INTEGRATION_COMPLETE.md)
> (348 lines, dated 2026-01-10, titled *"Toast POS Integration — COMPLETE"*). That document
> describes a single-vendor Toast webhook path as finished; the multi-provider hub replaced
> it, and one of its two named write targets (`pos_webhook_logs`) **does not exist in the
> production database**. Mark it superseded, do not extend it.
>
> **Method.** All `file:line` citations verified against `origin/main` (`86dfadeb`) in an
> isolated worktree. All schema and row-count claims are live queries against the production
> Supabase project `exzueerziesmczwlhomd` on 2026-08-24. **Shortcut declared (CLAUDE.md §0.5):
> the unit test suite was not run** — the isolated worktree has no `node_modules` and the
> shared checkout is on another branch. No claim below rests on runtime behaviour; every one
> is a schema query or a source read. No application code was changed.

---

## 0. Verdict

**Largely agreed, with one correction and one addition.**

**Agreed:** the hard half is built. There is a real canonical contract, a real normalizer
interface, a 27-provider registry, an HMAC-verified push ingress, an authenticated batch
import, a human-gated catalogue matcher, and an analytics layer that genuinely never names a
vendor. Calling this greenfield would be wrong. The pieces that are missing are mostly
*connection-lifecycle* pieces, not *bridge* pieces.

**Correction to the framing in the brief.** The brief expects analytics to "assume full data
and silently produce wrong numbers for a POS that cannot report tables." That is not what
happens. The insight engine has its own availability mechanism — every candidate declares
`requires: [...]` and the generator builds an availability set before generating
(`insight-catalog.ts:79-198`, `:557-562`; `insight-generator.service.ts:289-298`) — and
`table-analytics` returns `dataStatus: "awaiting POS check feed"` rather than zeros
(`:302, 406, 435, 491`). For a **wholly absent** source, the system degrades honestly. The
real version of the worry is narrower and sharper: **partial capability inside a *present*
source** (§2.7).

**Addition — the two findings that outrank everything on the gap list.** Both are live
arithmetic defects on the path the product sells today, not absent features:

1. **`sale_unit` is never written.** All 92 `pos_item_mappings` rows in production have
   `sale_unit = null`, so every by-the-glass wine sale depletes a **whole bottle** (§2.6d).
2. **`voided` is never persisted.** A voided check counts as revenue in every currency
   number the product shows, permanently (§1, "the field that already costs money").

Neither appears in `v3.0-TECH-DEBT.md`, `OPEN-DECISIONS.md`, or the pos-bridge premortem.

---

## 1. What exists — with evidence

### 1.1 The canonical contract

`pos-types.ts:24-45` — `CanonicalCheck` models: `externalCheckId`, `openedAt`, `closedAt`,
`voided`, `tableRef`, `serverExternalId`, `serverName`, `covers`, `subtotal`, `total`, `tip`,
`items[]`, `raw`. `CanonicalItem` (`:10-22`): `name`, `externalItemId`, `category`, `qty`,
`price`, `is_wine`, `master_wine_id`.

It persists to `pos_checks` (production columns verified): `id, restaurant_id, source,
external_check_id, table_id, server_external_id, server_name, opened_at, closed_at, covers,
subtotal, total, tip, items jsonb, raw jsonb, imported_at, correlation_id`.

### 1.2 What the contract does NOT model

Verified by grep across `apps/api-gateway/src/pos-hub/` — **zero occurrences** of
`discount`, `comp`, `tender`, `payment_type`, `service_charge`, `refund`.

| Dropped capability | Consequence |
|---|---|
| **Discounts / comps / promos** | A comped bottle arrives as a full-price line. Revenue and margin both overstated. |
| **Tender / payment type** | No cash-vs-card, no split tender, no gift card. |
| **Tax and service charge** | The `subtotal`→`total` gap is unexplained; auto-gratuity is indistinguishable from a tip. |
| **Line-level voids and refunds** | `voided` is whole-check only (`pos-types.ts:29-32`). One voided line out of twelve has no representation at all. |
| **Modifiers** | Extra pour, half-glass, flight component — all collapse into the item `name`. |
| **Order channel** | Dine-in / bar / takeout / delivery. `table-analytics` attributes checks to tables; a delivery order silently drops out of the table view rather than being excluded from it. |
| **Currency** | `price` is documented as "major currency units (dollars/lira)" (`pos-types.ts:17`) with **no currency code**. A TR + US tenant cannot be aggregated. |
| **Course / fire / kitchen-ready timestamps** | The brief's example, confirmed. `S16-staff-misses-a-table-window.md:94` already records that kitchen-ready "has no capture path"; `foundation/teams/product.md:130` makes *kitchen-ready→waiter p95* a team's **primary metric**. |
| **Check split / merge / transfer** | A split check arrives as two unrelated `externalCheckId`s. Covers double-count; the party is invisible. |
| **Employee role / shift** | Only `serverExternalId` / `serverName`. No shift boundary, so no per-shift attribution. |
| **Line-level timestamps** | Only the check carries times, so no course pacing and no in-service sequencing. |

**The field that already costs money.** `voided` is *in* the type and *does* drive stock
reversal (`pos-hub.service.ts:323, 379-412`) — but it is **not in the persisted row**
(`pos-hub.service.ts:186-201`), and there is **no `voided` column** in `pos_checks` in
production. So analytics is structurally unable to exclude a voided check. Three readers sum
`total` with no such filter:

- `goals.service.ts:323-327` — `wine_revenue`, `checks`, `avg_check`, `wine_attach_rate`.
- `insight-generator.service.ts:239-245` — the whole 90-day check bundle.
- `table-analytics.service.ts:98-113` → `:146` (`a.revenue += c.total || 0`).

This is drift in exactly the metric the charter names — `pi.canonical_shape_drift`
(`pos-bridge-charter.md:73`, "baseline unmeasured").

### 1.3 The registry and the adapters

27 providers (`pos-provider.registry.ts:27-323`). Computed from source this session:

- **By status:** 2 `available`, 1 `partial`, 2 `scaffolded`, 22 `planned`.
- **By auth model:** 3 `none`, 6 `oauth2`, 9 `api_key`, 9 `partner_agreement`.
- **Webhook capability:** 14 declare `webhooks: true`; **13 declare `webhooks: false`**.
- **`capabilities.tables: false`:** `square`, `eposnow`.

Four normalizers exist and are unit-tested (`pos-adapters.ts:204-210`, `pos-adapters.spec.ts`):
`generic_webhook`, `csv_import` (an alias of generic), `square`, `clover`, `toast`.

### 1.4 The ingestion surface — the complete list

1. `POST /pos-hub/webhook/:provider/:restaurantId` — `pos-hub.controller.ts:62`. `@Public()`,
   authenticated by HMAC-SHA256 over the raw body, `crypto.timingSafeEqual`, **fails closed**
   when the secret is unset (`pos-hub.service.ts:96-121`). This control is correctly built.
2. `POST /pos-hub/import/:restaurantId` — `pos-hub.controller.ts:97`. JWT-guarded, canonical
   JSON body, routes through `ingest(…, "csv_import", …)`.

That is the entire list. Everything else on the controller is registry, status, mappings, and
the catalogue-match review queue.

### 1.5 The pipeline is genuinely idempotent and genuinely gated

- Check upsert on `(restaurant_id, source, external_check_id)` (`pos-hub.service.ts:202-204`;
  unique index `uq_pos_checks_source_check`).
- Every stock write carries `pos:{source}:{check}:{item}:{lineNo}` (`:370`).
- Stock effects fire **only** for closed checks (`:212-219`).
- Unmapped wine is queued in `pos_unresolved_lines`, never dropped (`:341-367`).
- Catalogue auto-map only at `>= 0.9` **and** unambiguous (`catalog-matcher.service.ts:135`,
  `:277-279`); everything else goes to a human queue.
- POS sales mirror into `wine_consumption_log` (`pos-hub.service.ts:468-512`), which is the
  demand series behind velocity, XYZ, reorder point, and the Holt-Winters forecast.

### 1.6 Security posture — three open decisions are now stale

Verified on `origin/main`; **hand these to whoever owns `OPEN-DECISIONS.md`:**

- **OD-40 is fixed.** `@UseGuards(JwtAuthGuard)` now sits at class level on the pos-hub
  controller (`pos-hub.controller.ts:36`), with a comment naming the previous exposure. The
  catalogue approval gate is no longer anonymous.
- **OD-39 is fixed.** The Toast webhook no longer skips verification when the header is
  omitted (`toast.service.ts:188-215`).
- **OD-35 is partially fixed.** `SimposModule` is now gated out of production
  (`app.module.ts:89`). `SimposController` still carries no guard, so the finding stands for
  non-production environments only.

### 1.7 The reality check that governs the whole document

Live counts from production, 2026-08-24:

| Table | Rows |
|---|---|
| `pos_checks` | **0** |
| `restaurant_tables` | **0** |
| `wine_consumption_log` | **0** |
| `pos_unresolved_lines` | 0 |
| `pos_item_mappings` | ~~92 (all `generic_webhook`, all `is_wine`, **all `sale_unit = null`**)~~ → **0** (see correction below) |
| `pos_catalog_match_proposals` | ~~92~~ → **0** |
| `restaurant_inventory` | 72 |
| `restaurants` | 10 — **all `pos_system = 'toast'`, 1 with non-null `pos_credentials`** |

The charter's own reality check (`pos-bridge-charter.md:132-136`) cites 47 simulator rows in
`pos_checks`. **Those are gone; it is zero now.** No canonical check produced by a real
restaurant has ever entered this system.

> **Correction, 2026-08-25 — the 92 mappings could never have produced a wrong number.**
> This audit twice implies they were doing damage ("already producing wrong numbers against
> the 92 mappings that exist", §3). That was wrong, and the reason matters. Every one of the
> 92 carried an `inventory_id` that resolved to **zero** rows in `restaurant_inventory`, and
> they belonged to a `restaurant_id` that is in no row of `restaurants` — the torn-down sim
> `bistro` tenant — while the checks that later arrived belong to a different restaurant with
> no mappings at all. `loadItemMappings` filters on `restaurant_id`, so nothing ever resolved
> against them.
>
> The real defect was the opposite shape, and worse. `apply_stock_movement` and
> `record_glass_pour` both `RAISE 'inventory % not found'`, so a matching line would have
> written **nothing** — but it had already skipped the `if (!it.inventory_id)` branch at
> `pos-hub.service.ts:347`, so it would land in *neither* stock *nor* `pos_unresolved_lines`.
> Not over-depletion: a **black hole**, strictly worse than the unmapped case B20 built the
> queue to prevent. Root cause was `SYNTH_WRITE_SET` omitting `pos_item_mappings` and
> `pos_catalog_match_proposals`, so `synth teardown` deleted the inventory and left the
> matcher output behind. All 184 rows deleted and an FK `ON DELETE CASCADE` added —
> [ADR 0012](../decisions/0012-pos-mapping-inventory-integrity.md).
>
> **Counts as of 2026-08-25:** `pos_checks` **66**, `pos_unresolved_lines` **39**,
> `pos_item_mappings` **0**, `pos_catalog_match_proposals` **0**, `restaurant_inventory` 72,
> `wine_consumption_log` **0**, `inventory_transactions` where `source='pos'` **0**.

---

## 2. What is genuinely missing

### 2.1 There is no pull path. At all.

The hub is **push-only**. For the 13 providers that declare `webhooks: false` — including
every Tier-2 enterprise system, both partner-gated legacy systems, and three of the five
Türkiye providers — there is **no automated ingestion path today, and none scaffolded**.

Evidence: `apps/api-gateway` runs 15+ `@Cron` jobs (ux-optimizer, promotion-extractor,
document-intake, recurring-orders ×2, low-stock ×2, communications ×8). **Not one calls a
POS.** There is no cron, no scheduler, no worker, and no cursor/watermark storage anywhere in
`pos-hub/` or `toast/`.

The only path available to a pull-only provider is `POST /pos-hub/import/:restaurantId` with
a bearer token — which requires a human or an external script to fetch, transform, and post
on a schedule they own and operate.

**This is a structural gap in "all-in-one", not a missing adapter.** Writing the Oracle
Simphony normalizer would not close it; there would still be nothing to call it.

### 2.2 `csv_import` does not import CSV

- `ADAPTERS.csv_import` is `genericAdapter` under a different key (`pos-adapters.ts:206`).
- The endpoint documents its body as "array of CanonicalCheck" (`pos-hub.controller.ts:101`).
- There is **no** `FileInterceptor`, no multipart handling, and no CSV parser anywhere in the
  module (grep across `pos-hub/`: zero hits).

Meanwhile the registry lists it as `name: "CSV / JSON Import"`, `apiStyle: "file"`, `status:
"available"` (`:42-51`), and sequences `akinsoft_wolvox` — a real TR SMB POS — as "start with
file export → csv_import bridge" (`:309`). **That bridge does not exist.** This matters more
than any single adapter: it is the path the 13 pull-only providers and the entire
file-export long tail were all supposed to use, and it is the premortem's own named answer
(M1: *"the one restaurant that signs exports a CSV"*).

### 2.3 There is no connection model

Confirmed by live query — `information_schema.tables` where `table_name like 'pos%'` returns
exactly four: `pos_catalog_match_proposals`, `pos_checks`, `pos_item_mappings`,
`pos_unresolved_lines`. **`pos_connections` does not exist.** Neither does
`integration_oauth_connections`, which `useUserPreferences.ts:37-38` names as the server-side
successor for OAuth connections.

What exists instead: `restaurants.pos_system varchar(50) default 'toast'` and
`restaurants.pos_credentials jsonb` (`baseline_from_production.sql:3577-3578`).

**And the UI writes neither.** `activateProvider()` (`PosSettingsSection.tsx:118-126`) writes
`posConfig.activeProvider` into **user** preferences via `PATCH /users/:userId/preferences`
(`useUserPreferences.ts:65`). So:

- The "active POS" is a **per-user** setting. Two colleagues at one restaurant can disagree
  about which POS the restaurant runs.
- **Nothing on the server reads it** (grep `posConfig` across `apps/api-gateway`: zero hits).
- There is **no credential-entry UI at all** — the scaffolded-provider hint says "connect
  merchant credentials (OAuth / API key)" (`PosSettingsSection.tsx:378-381`) next to no field
  that accepts any.

**What breaks:**

- **Two POS at one restaurant** (main + bar, or a migration weekend): `pos_system` is one
  text column and `pos_credentials` one blob. Note that `pos_checks.source` *is* per-row, so
  the **data** model downstream already handles it — only the **connection** model cannot.
- **Status / health:** `GET /pos-hub/status/:restaurantId` (`pos-hub.service.ts:584-614`)
  infers liveness from 30 days of rows. It answers "did data arrive", never "is the
  connection healthy". A rotated secret or revoked token is indistinguishable from a quiet
  Tuesday until 30 days of history age out. `S04:95-96` already names this as a silent
  total-outage failure mode.
- **Last sync / cursor:** nothing stores a watermark, so no pull adapter *could* resume
  incrementally even once one is written. §2.1 is blocked on this.
- **Token refresh:** 6 providers are `oauth2`. There is no refresh-token storage, no expiry
  tracking, and no refresh job.

**What a `pos_connections` table would hold** (unique on `(restaurant_id, provider_key)`;
`pos_checks.source` already keys to `provider_key`):

```
restaurant_id, provider_key, status, enabled,
credentials (encrypted), external_merchant_id,
webhook_secret,                      -- per-connection, see §2.4
sync_cursor, last_sync_at, last_success_at, last_error, consecutive_failures,
token_expires_at, refresh_token,
connected_by, connected_at, disconnected_at
```

### 2.4 Auth: one shared secret for every provider and every tenant

There are exactly **two** secrets in the entire POS surface, both process-wide env vars:

- `POS_HUB_WEBHOOK_SECRET` (`pos-hub.service.ts:34-35`) — **one secret, shared across all 27
  providers and all restaurants.** The route takes `restaurantId` from the path and never
  binds it to the key, so **a signature valid for restaurant A is valid for restaurant B's
  URL**. Anyone holding the secret can write checks and deplete stock for any tenant.
- `TOAST_WEBHOOK_SECRET` (`toast.service.ts:76`) — Toast's own scheme, in a separate module.

The verification *implementation* is good (timing-safe, fails closed). The problem is what it
is keyed to, and what scheme it speaks: `verifyWebhookSignature` implements exactly one
scheme — **ours**. Square signs per-subscription over `notification_url + body`; Clover and
Toast each use their own. So the registry's claim that any POS "can push the canonical shape"
(`pos-provider.registry.ts:12-15`) is true **only with a middleware in between that
re-signs**. That middleware is the customer's problem today, and it is not named as a
requirement anywhere.

Per-provider credentials have nowhere to live except `restaurants.pos_credentials`, a bare
jsonb read from exactly one place (`pos_integration_agent.py:930`, matching
`pos_credentials->>restaurant_guid` for Toast).

### 2.5 Backfill exists — and currently destroys the inventory count

**Correcting the brief's premise:** analytics does *not* only ever see data from the
connection date forward. `POST /pos-hub/import/:restaurantId` is a real, authenticated,
idempotent history path. And because every window is short — 90-day in
`insight-generator.service.ts:239-245` and `table-analytics.loadChecks` (default
`sinceDays = 90`), 30-day in `getStatus` — **a successful backfill buys full baselines
immediately.** Nothing has to wait 90 days. That makes this path *more* valuable than it
looks.

Two caveats, the first serious:

1. **The importer mutates today's stock.** `ingest()` calls `applyStockEffects()` for every
   check carrying a `closedAt` (`pos-hub.service.ts:212-219`), and `apply_stock_movement` has
   **no as-of date** in its signature (`baseline_from_production.sql:281`). Importing six
   months of closed checks therefore decrements **live** stock by six months of sales, all at
   once, against today's count. There is no `historyOnly` flag, no `asOf`, and no dry-run.
   **A backfill is currently an inventory-destroying operation**, and nothing in the API
   documentation warns of it.
2. It accepts canonical JSON only — see §2.2. Producing that JSON from a POS export is the
   customer's or an operator's work.

### 2.6 Catalogue mapping at scale

Two distinct unmatched paths, and the distinction matters:

- **At catalogue-pull time** (`catalog-matcher.service.ts:108-177`): auto-map at `>= 0.9` and
  unambiguous; **everything else is queued**, never dropped (`:159-167`). A human resolves via
  `approve` / `reject` (`pos-hub.controller.ts:178, 199`), now correctly guarded (§1.6).
- **At sale time** (`pos-hub.service.ts:341-367`): a line with no `inventory_id` that *looks*
  like wine is queued in `pos_unresolved_lines`. A line that does **not** look like wine is
  skipped entirely (`:329`) — still persisted verbatim in `pos_checks.items`, so basket and
  revenue analytics see it, but **no one is ever asked about it**.

Four real limits:

**(a) Wine-only, hardcoded.** `is_wine: true` is a literal at both write sites
(`catalog-matcher.service.ts:141`, `:424`). Food, beer, spirits, and NA will never be mapped
by the matcher.

**(b) The only catalogue it can pull is SimPOS's.** `pullPosCatalog()` throws for any source
other than `'simpos'` (`:187-191`) and reads `simpos_catalog`. **There is no catalogue pull
for Toast, Square, or Clover.** At scale, for a real venue, the matcher has no input at all —
mapping is item-by-item through `POST /pos-hub/mappings/:restaurantId`.

**(c) A no-candidate proposal is unresolvable through the API.** `approveProposal` throws
*"Proposal has no candidate inventory item to approve"* when `candidate_inventory_id` is null
(`:417-418`). A POS item we have never stocked can only be **rejected**. There is no "create
the inventory row from this POS item" action — and that is the single most common case for a
new venue.

**(d) 🔴 `sale_unit` is never written — every glass pour depletes a bottle.**
The column exists on `pos_item_mappings` in production. `loadItemMappings` selects it
(`pos-hub.service.ts:247`), `resolveWine` returns it (`:291`), `applyStockEffects` uses it
(`:371`). But `upsertItemMapping` — the **only** writer in the codebase, used by *both* the
auto-map path and the human-approve path — does not include it in the row it builds
(`:514-527`), and the controller's documented body has no such field (`:127`). Grep across
`apps/` for a `sale_unit` **write**: zero hits; every hit is a read.

Confirmed empirically: **all 92 mapping rows in production have `sale_unit = null`**, so
`:371`'s `?? "bottle"` fires every single time. Every wine sold by the glass will deplete a
whole bottle. This is not a scale limitation — it is a live arithmetic defect on the golden
path, and it is precisely the question `S04 §4` says the product must answer: *"Did this
check deplete the right stock, in the right unit?"*

### 2.7 The MCP analogy, judged honestly

MCP's value is a uniform interface **plus** discovery **plus** capability negotiation that
changes behaviour. Scoring each:

- **Uniform interface — real, and it is the hard half.** `CanonicalCheck` +
  `PosAdapter.normalize` (`pos-adapters.ts:11-15`), one table, and an analytics layer that
  genuinely never names a vendor (`table-analytics.service.ts:6-9`). This is the part that is
  expensive to build and it is built.
- **Discovery — real, but read-only.** `GET /pos-hub/providers` returns the registry plus
  `registrySummary()` (`pos-hub.service.ts:81-83`); Settings renders capability chips
  (`PosSettingsSection.tsx:289-303`).
- **Capability negotiation — not real. `capabilities` is documentation.**
  `PROVIDER_BY_KEY[providerKey]` is consulted at ingest for exactly two things: does the
  provider exist, and does an adapter exist (`pos-hub.service.ts:138-144`). The
  `capabilities` object is read by **no server code at all** — the only reads outside the
  registry file are the Settings chips and a mirrored type in `services/api/posHub.ts:22`.
  Nothing branches on it.

**Where the analytics layer is better than the brief assumes.** It has its own availability
mechanism and it works: every insight candidate declares `requires: [...]`
(`insight-catalog.ts:79-198`), `availableCandidates()` filters on it (`:557-562`), and the
generator calls it (`insight-generator.service.ts:86`) against an availability set built at
`:289-298`. `table-analytics` returns `dataStatus: "awaiting POS check feed (pos_checks is
empty)"` instead of zeros (`:302, 406, 435, 491`). For a wholly absent source, the system
**declines to answer** rather than answering wrongly.

**The two problems that remain are different from the one asked about:**

1. **"Empty" and "unsupported" are the same signal.** Availability is derived from *observed
   row counts*, never from `capabilities`. "Square cannot report tables"
   (`pos-provider.registry.ts:77`, `CAP_NO_TABLES`) and "you have not mapped your tables yet"
   render identically. One is a setup task; the other is a permanent property of the
   customer's POS. The product cannot tell the owner which, so it cannot stop prompting for
   the impossible one — and cannot say "this Pro feature will never work on your POS" at
   sale time.

2. **Partial capability inside a *present* source does produce wrong numbers.** This is the
   real version of the brief's worry. `squareAdapter` hardcodes `covers: null`
   (`pos-adapters.ts:96`); `cloverAdapter` hardcodes `subtotal: null` (`:143`). For a
   Square-fed venue `checks` **is** available, so no gate fires — and then:

   | `table-analytics.service.ts` | Behaviour with all-null covers |
   |---|---|
   | `revenuePerCover` (`:178`, `:366`) | guarded `a.covers > 0 ? … : null` → **correct** |
   | `checkinDensity` (`:175`) | `(a.covers \|\| 0) / t.seats` → **`0.00`, a plausible wrong number** |
   | `seatUtilization` (`:179-181`) | `min(1, (a.covers \|\| 0) / …)` → **`0%`, a plausible wrong number** |

   The author clearly knew the null-vs-zero distinction — `revenuePerCover` gets it right
   twice. Two siblings missed it. Those zeros then feed the geometry correlation matrix
   (`:205-217`) as a constant-zero series.

**The honest summary of the analogy:** the capability model exists, in the right shape, in the
right place. It is simply not wired to the one consumer that needs it. That is a small piece
of work with a large payoff, and it is the piece that would make "like an MCP server"
actually true rather than aspirational.

### 2.8 Three Toast paths, none of which produces a canonical check

All 10 restaurants say `pos_system = 'toast'`. Toast has three ingestion paths and **not one
writes `pos_checks`**:

1. `ToastService.processWebhook` → writes `events`, `pos_unresolved_lines`, and stock RPCs
   directly (`toast.service.ts:320, 384, 452, 472, 486, 521-542, 600, 650`). It **bypasses the
   canonical contract entirely**, so analytics over `pos_checks` sees nothing from it.
2. The Python `pos_integration_agent` → writes only `pos_webhook_logs`
   (`pos_integration_agent.py:951`) — **a table that does not exist in production.** That path
   fails on every webhook.
3. `toastAdapter` via `POST /pos-hub/webhook/toast/:restaurantId` — written, tested, and
   **called by nothing**.

So the one provider that is production-configured is the one provider whose live path does not
feed the bridge. `pos_checks` being empty is not only a "no customers yet" fact; it is also
this.

---

## 3. What is missing but does not matter yet — and why

This section exists so the gap list above does not become 20 tickets nobody needed. **The
test applied is the one the unit's own directive already applies:** does closing this change
anything before `pi.merchant_backed_providers` goes from 0 to 1?

The governing facts:

- `YC_WEDGE_PLAN.md:63` **cut Track C outright**: *"The three-way match is PO vs invoice vs
  physical count. Not one of those comes from a POS. … Minimum POS surface area to close the
  first 20 customers is zero."* Logged as deferred-by-design in `v3.0-TECH-DEBT.md:448`.
- `pos-bridge-premortem.md` **M1** names adapter-building-without-a-merchant as the single
  most likely way this team fails, with an explicit month-one tripwire: *"the first planning
  conversation that chooses provider #4 without naming a venue waiting on providers #1–3."*
- `pos-bridge-charter.md:72` — `pi.merchant_backed_providers` is **2 available, 0 with a
  merchant**, and the charter says the second half of that phrase is the whole metric.
- Production: `pos_checks` = 0, `restaurant_tables` = 0, `wine_consumption_log` = 0.

**Therefore these are genuinely missing and genuinely do not matter yet:**

| Gap | Why it waits |
|---|---|
| **The 22 `planned` adapters** | Explicitly cut. Each is 1–2 days that produces nothing until a venue signs, and building them *is* the premortem's named failure mode. |
| **OAuth token refresh, credential vault, connection health UI** | Zero connections exist. Building refresh for six `oauth2` providers when none has a merchant token is the same trap one level down. Note the *table* (§2.3) is ranked — the *refresh machinery* is not. |
| **Kitchen-ready / course timing** | Load-bearing for S16 and a named primary metric — but S16 is `status: proposed`, and the signal has no capture path from *any* provider connectable today. Answer it with a real payload in hand, not before. |
| **Multi-currency** | One market, one currency, today. |
| **Split / merge / transfer, tender type, service charges, modifiers, channel** | Each is a real POS capability the contract drops. **None changes an answer the product gives today**, because the product gives no POS-derived answers today. |
| **Capability-gated analytics messaging ("your POS can't do tables")** | Only matters once a Square or Epos Now merchant exists. |
| **Line-level void / partial refund** | Same. Whole-check `voided` already covers the common case — *once it is persisted at all* (§1.2, which is ranked). |

**Two things that look like they belong in this section but do not**, because they are wrong
*now* rather than unbuilt: the `sale_unit` default (§2.6d) and the unpersisted `voided`
(§1.2). ~~Both are already producing wrong numbers against the 92 mappings that exist~~ —
**corrected 2026-08-25: neither ever did.** The 92 mappings resolved to no inventory and
belonged to a restaurant no webhook addresses, so nothing was ever computed against them
(see the correction under §1's row-count table). Both defects were real but **latent**, armed
for the first venue rather than firing; both were fixed on 2026-08-24 while the exposure was
still zero rows. The `sale_unit` one would have silently corrupted the first real venue's
stock count. They are #1 and #2 below.

---

## 4. Ranked gaps — by what closing each one unblocks

| # | Gap | What closing it unblocks | Size |
|---|---|---|---|
| **1** | **`sale_unit` never written** (§2.6d) — all 92 production mappings are null; every glass pour depletes a bottle | Correct stock. The **entire Core tier of S04**, which is what the product sells today. It is the only item here that is already wrong rather than not yet built. | One field in `upsertItemMapping` (`pos-hub.service.ts:514-527`), one DTO field, one control in the approve UI. |
| **2** | **`voided` never persisted** (§1.2) — no column, dropped at the upsert | Trustworthy revenue in goals, insights, and table/waiter analytics — **every currency number the product shows**. Also gives `pi.canonical_shape_drift` its first real measurement. | One column, one line in the upsert row, one filter in each of three readers. |
| **3** | **Backfill mutates live stock** (§2.5) — no `historyOnly` / `asOf` | Safely importing a venue's history, which buys **full 90-day baselines on day one instead of day 90**. Without it the first real onboarding must either skip history or wreck the count. | A flag on `ingest()` that skips `applyStockEffects`, plus a dry-run response. |
| **4** | **No `pos_connections` table** (§2.3) | Two POS at one venue · connection health that means something · incremental pull cursors · **per-connection webhook secrets, which is also the fix for the cross-tenant shared-secret problem** (§2.4). Everything in "pull" is blocked on this and on nothing else. | One migration + a connect/disconnect surface. **Fork — see OD-A.** |
| **5** | **No real file/CSV ingestion path** (§2.2) | The 13 pull-only providers **and** the entire file-export long tail, including `akinsoft_wolvox`, which the registry itself routes through this bridge. Cheaper than one adapter and covers more venues than all 22 planned adapters combined. It is also the premortem's own predicted answer. | A parser + column-mapping step behind the existing import endpoint. |
| **6** | **Catalogue pull for a real provider + "create inventory item" on a proposal** (§2.6b, §2.6c) | Mapping at scale for the first signed venue. Today the matcher's only input is SimPOS's own table, and a never-stocked POS item can only be rejected. | One pull function per provider; one new proposal action. |
| **7** | **`capabilities` not wired to analytics availability** (§2.7) | Honest "your POS cannot do this" messaging, and correct null-vs-zero for partial sources. **Do the null-vs-zero half regardless** — `checkinDensity` and `seatUtilization` (`table-analytics.service.ts:175, 179-181`) are three lines and they are wrong the day a Square merchant connects. | Small. **Fork — see OD-C.** |
| **8** | **The rest of the canonical contract** (§1.2) — discounts, tender, modifiers, channel, splits, kitchen-ready, currency | Future insight classes. **Do not open these until a real payload is in hand** — that is §3's whole point. | Large, and deliberately deferred. |
| **9** | **No pull scheduler** (§2.1) | Automated ingestion for pull-only providers. Ranked last **only because it is strictly blocked on #4** (cursor storage) and because #5 covers the same venues sooner and cheaper. | Blocked. |

**Reading of the ranking:** #1–#3 are correctness on the path that exists and should not wait
for a customer. #4–#6 are the real "all-in-one" work and should start when the first venue is
named. #7 is a cheap partial. #8–#9 are §3 material.

---

## 5. Draft rows for `.planning/decisions/OPEN-DECISIONS.md`

*Another session owns that file — these are handed over as text, not written.* Renumber to
follow OD-60.

| ID | Question | Why it matters now | What unblocks it |
|---|---|---|---|
| OD-A | **POS connection model** — extend `restaurants` (add `pos_connections jsonb`, keep one row per restaurant) vs a new **`pos_connections` table** keyed `(restaurant_id, provider_key)`. Today `pos_system` is one `varchar(50)` defaulting to `'toast'` (all 10 rows), `pos_credentials` is one jsonb blob (1 of 10 populated), `pos_connections` **does not exist**, and the Settings "Use this POS" button writes neither — it writes a **per-user** preference (`PosSettingsSection.tsx:118-126`) that no server code reads. | Blocks every pull provider (no cursor), connection health (`/pos-hub/status` infers liveness from 30 days of rows), token refresh for 6 `oauth2` providers, per-connection webhook secrets (OD-B), and any venue running two POS. `pos_checks.source` is already per-row, so only the *connection* model is missing — this is one migration, not a redesign. | Founder picks table-vs-column. Recommendation: **a table** — the jsonb variant cannot carry a unique constraint per provider or a per-connection secret, which is the whole point. |
| OD-B | **Webhook secret scope** — keep one process-wide `POS_HUB_WEBHOOK_SECRET` (`pos-hub.service.ts:34-35`) or issue **per-connection secrets**. Today one secret covers all 27 providers and all restaurants; the route reads `restaurantId` from the path and never binds it to the key, so **a signature valid for restaurant A is valid for restaurant B's URL**, and holding it lets anyone deplete stock for any tenant. | Cross-tenant write authority behind a control that looks green. Not in OD-19's endpoint census because the endpoint *does* verify — it verifies the wrong thing. Blocked on OD-A (secrets need somewhere to live). | Founder call, then implement with OD-A's migration. Separately: no real vendor's signature scheme is implemented, so "any POS can push" requires a re-signing middleware nobody has specified — decide whether we ship that or document the requirement. |
| OD-C | **Is `capabilities` behavioural or documentation?** The registry declares `checks/items/tables/employees/webhooks` per provider, and **no server code reads it** — analytics derives availability from observed row counts instead (`insight-generator.service.ts:289-298`). So "Square cannot report tables" and "you have not mapped tables yet" are indistinguishable to the product. | Determines whether we can tell an owner *"this will never work on your POS"* at sale time, or must keep prompting for the impossible. Also the difference between the MCP analogy being true and being aspirational. | Founder call: wire it (union the declared capabilities of a restaurant's connections into the availability set, requires OD-A) — or delete the field and stop implying negotiation exists. **Independent of the decision:** fix `checkinDensity` / `seatUtilization` returning `0` where they mean `null` (`table-analytics.service.ts:175, 179-181`). |
| OD-D | **Should imported history touch stock at all?** `POST /pos-hub/import/:restaurantId` runs the full depletion path for every check carrying a `closedAt` (`pos-hub.service.ts:212-219`), and `apply_stock_movement` has no as-of date. Backfilling six months therefore decrements **today's** live stock by six months of sales at once. | The first real onboarding must either skip history — losing day-one 90-day baselines that every insight window wants — or destroy the count. There is no third option today, and no warning in the API docs. | Founder picks the semantics: (a) `historyOnly` flag, analytics-only, no stock writes; (b) `asOf` on the stock RPCs so movements book to their real date; (c) both, with a dry-run. (a) is the cheap correct answer for onboarding; (b) is the one that makes historical variance analysis possible later. |

**Also hand over — three existing rows are now stale on `origin/main`:** OD-40 is **fixed**
(`pos-hub.controller.ts:36`), OD-39 is **fixed** (`toast.service.ts:188-215`), OD-35 is
**partially fixed** (`app.module.ts:89` gates SimPOS out of production; the controller is
still unguarded in non-prod).

---

## 6. What this audit did not cover

Declared per CLAUDE.md §0.5:

- **The unit test suite was not run** (no `node_modules` in the isolated worktree; the shared
  checkout is on a different branch). The 19 pos-hub test cases were read, not executed. No
  claim above depends on a test result.
- **Mobile** (`apps/mobile`) was not searched for POS surfaces.
- **RLS policies** on the four `pos_*` tables were not audited — that is OD-19/OD-45 work.
- The `services/agent-orchestrator` Python POS path was checked only for its write targets
  (§2.8), not audited end to end.

---

# Appendix A — the pipeline, proven (2026-08-24)

The audit above was a code and schema read. This appendix is the runtime half: 66 signed
canonical checks driven through the live webhook into production, then every downstream
stage measured. It exists because §1.7's reality check — *`pos_checks` holds 0 rows* — is
the reason none of the analytics had ever been exercised.

## A.1 What P3 actually buys

Satisfiable insight types, of 573 total:

| | Before | After 66 checks |
|---|---|---|
| **Total** | **8 (1.4%)** | **386 (67.4%)** |
| `efficiency` | 0 | **108 / 108** |
| `tables` | 0 | 147 / 174 |
| `staff` | 0 | 45 / 50 |
| `sales` | 0 | 33 / 82 |
| `risk` | 0 | 15 / 40 |
| `forecast` | 1 | 16 |
| `goals` | 1 | 16 |

Generated insights went 0 → 11. Table-performance moved from
`dataStatus: "awaiting POS check feed"` to `live` with 32 geometry correlations
(ridge R² = 0.93); waiter effects 0 → 4 (R² = 0.38); basket 0 → 51 transactions / 29 pairs.

[[PLAN]] estimated 25.1% satisfiable without POS data. **The real figure was 1.4%**, and
the estimate was optimistic by an order of magnitude in the direction that matters.

## A.2 The floor plan is an unstated prerequisite

`restaurant_tables` was **globally empty — 0 rows** before this run. Seeding tables without
checks changed satisfiability not at all (still 8), but POS checks without a floor plan
would have left the `tables` category dark. **P3 is two connections, not one**, and only
one of them is a POS.

## A.3 Verified, not assumed

- **Idempotency holds.** Replaying 8 checks plus a bare-object variant left 66 rows / 66
  distinct ids, same `id`, same `imported_at`.
- **The signature gate holds.** Five negative cases — bad hex, missing header, empty,
  truncated, and a valid signature computed over a *different* body — all `401`, 0 rows
  written. A webhook that accepted unsigned input would have been a worse finding than
  anything else in this document.
- **Real inventory was not touched** by the 66 checks: the restaurant has no
  `pos_item_mappings`, so all 39 wine lines queued in `pos_unresolved_lines`.

## A.4 §2.6d confirmed at runtime, and one new defect

**The bottle fallback is real.** An isolated probe — item literally named
`"Chardonnay Probe (glass)"` at a $18 glass price, mapping with `sale_unit = null` — made
the hub call `apply_stock_movement` for `sale −1 whole bottle` and write
`wine_consumption_log.consumption_type = 'bottle'`, `volume_ml = 750`. Not
`record_glass_pour`, not 150 ml. **Five times the volume booked.** The probe was fully
reversed; that inventory row is back to 0 stock / 0 lots / 0 transactions.

**NEW — `recordConsumption` is not idempotent, unlike the stock write it follows.**
`pos-hub.service.ts:415-423` treats "no rpcError" as "this depleted just now" and calls
`recordConsumption`, which does a bare `insert` with no dedupe. `apply_stock_movement`
correctly returns the existing transaction for a known key — so a replay leaves **stock
correct and the consumption log wrong**. Replaying one probe check twice produced **3
`wine_consumption_log` rows for one check line**.

That asymmetry is what makes it dangerous. Every replay or re-import inflates the demand
series behind velocity, XYZ classification, reorder points, Holt-Winters forecasting and
goal progress — while the stock count, the number a human would check, stays right.

## A.4b All three fixed, 2026-08-24

`20260824190000_pos_voided_and_consumption_idempotency.sql` — **applied to production and
read back**: `pos_checks.voided boolean NOT NULL DEFAULT false`, plus
`pos_checks_voided_idx` and `wine_consumption_log_pos_idem_uidx`.

| Defect | Fix |
|---|---|
| §2.6d `sale_unit` never written | Added to `upsertItemMapping`'s row. Unrecognised values now **throw** rather than coerce — writing `"Glass "` would take the same silent bottle fallback while looking mapped in the UI |
| `voided` never persisted | Column added and written; the three revenue readers (`table-analytics`, `insight-generator`, `goals`) now filter `voided = false`. Persisting the flag without filtering the readers would have fixed nothing |
| §A.4 `recordConsumption` not idempotent | `upsert(..., { onConflict: "restaurant_id,notes", ignoreDuplicates: true })` behind a **unique index**, so the guarantee lives in the database and a second caller cannot reintroduce it. `notes` is now the key verbatim — it used to render `pos:pos:…` |

**Proven, not asserted.** 14 regression tests in `pos-hub.correctness.spec.ts`: **14 failed
against the pre-fix code, 14 pass after.** One of them originally passed pre-fix — *"a
voided check writes no consumption row"* was true before the fix because **nothing ever
reached that table**. It was rewritten to assert the *difference* (void → 0, ordinary → 1).
A test that passes for the wrong reason reports that behaviour is guarded when only the
failure mode is.

The unique index was verified against production directly: a second insert of the same key
is rejected with `duplicate key value violates unique constraint
"wine_consumption_log_pos_idem_uidx"`. The probe was rolled back; the table holds 0 rows.

Gates: `tsc --noEmit` clean · jest **62 suites / 812 passed** (was 61 / 798).

## A.5 Also found, not fixed

| | |
|---|---|
| `pos_checks.correlation_id` is never set by the hub | POS rows cannot join the correlation-id timeline in `logs-timeline.service.ts` |
| `efficiency` reaches 108/108 *satisfiable* but the generator emits **zero** | `computeChecksFamily` has no executor for `avg_check` / `wine_attach_rate` / `revenue_per_seat` / `tip_pct`. A catalog-vs-generator gap, and a design call |
| `computeGoalsFamily` reads denormalized `analytics_goals.current_value` | Refreshed only as a side effect of `getGoalProgress`, so the hourly sweep said *"You're 0% of the way"* while progress computed 128% / 84% / 79% on-track |

## A.6 Test data, and how to remove it

66 `pos_checks` (`P3PROOF-0001…0066`), 39 `pos_unresolved_lines`, 8 `restaurant_tables`
(`P3T-01…08`), 3 `analytics_goals` — all against Meyhouse Palo Alto,
`550e8400-…440000`. **Left in place deliberately**, because deleting it would return every
number above to zero and make this appendix unverifiable.

```sql
delete from pos_unresolved_lines where external_check_id like 'P3PROOF-%';
delete from pos_checks            where external_check_id like 'P3PROOF-%';
delete from analytics_goals       where name             like 'P3PROOF%';
delete from restaurant_tables     where label            like 'P3T-%';
```

## A.7 Shortcuts, stated

The webhook ingest ran over real HTTP, but a working JWT could not be minted (the
gateway's `JWT_SECRET` resolution matched neither `.env`), so the analytics reads
instantiated the services directly against the live database rather than going through the
guarded controller. **Controller-level auth on the analytics routes is therefore
unverified by this run** — PRs #31/#32 guarded them and the gateway-boot guard proves
`JwtAuthGuard` resolves, but that is not the same as an end-to-end 401. `restaurant_tables`
and `analytics_goals` were seeded by direct SQL, not through their endpoints.
