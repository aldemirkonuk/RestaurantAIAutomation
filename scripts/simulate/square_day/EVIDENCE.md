# [SQ-DAY-RUN] One Meyhouse Friday, posted for real — measured

Executed 2026-09-03 against the LOCAL gateway (`http://localhost:4010/api/v1`,
pid 54322, worktree `wt-eco-sim-9d440f0f` = main + PR #285). Product doors only:
every write went through HTTP. Every DB touch was a PostgREST **read**.

**Target tenant:** `aaecdb17-a764-46d1-8848-fa693a3d4d72` — "Sim Meyhouse", the
orphan sim tenant (verified: `pos_system=toast`, `timezone=America/Los_Angeles`,
0 `restaurant_tables`, 0 `pos_item_mappings`, no inventory). No other id touched.

**Provenance of the payloads.** All 243 events are **SYNTHESISED** by
`gen_square_day.py` to the shapes cited in `research-square-day-9d440f0f.md`
§1.1–1.12 (Square's public reference pages). Nothing was captured from Square —
Sandbox cannot emit a restaurant day (§1.13). Every manifest row carries that label.

## The day

Seed `20260904`, service date **2026-09-04 (Friday)**, lunch 11:45–14:00, dinner
17:00–22:00, America/Los_Angeles (PDT). Menu and hours from
`datasets/sim/venues/meyhouse-palo-alto/profile.json`.

| | |
|---|---|
| Checks | **42** (11 lunch, 7 early dinner, 12 prime 18:30–20:00, 9 jazz 20:00–21:30, 2 late, **1 deliberately out-of-hours at 15:20**) |
| Catalog | 391 `CatalogItem`s → **434 `CatalogItemVariation`s**; 115 distinct variation ids sold; **13 wines sold in more than one sale unit** (Glass 5oz / Glass 8oz / Bottle — the `sale_unit` axis) |
| Line items | 265 (Regular 138, Glass 5oz 63, Glass 8oz 40, Bottle 11, Double 10, Single 3) |
| Events | **243** — 1 `catalog.version.updated`, 43 `order.created`, 156 `order.updated`, 42 `payment.updated`, 1 `refund.created` |
| Specials | 1 `CANCELED` order (`closed_at: null`); 1 refund pair (return order with **empty `line_items[]`** + full `PaymentRefund`); 1 **byte-identical redelivery, same `event_id`** (sha256 verified equal); 1 line with `quantity: "1.5"` + `quantity_unit` |
| Money | integer minor units everywhere; `quantity` always a JSON string |

Corpus: `corpus/NNNN-<kind>.json` (posting order) + `manifest.json`.
Companion pull corpus: `retrieve_orders.json` (43 full Orders), `catalog.json`.

## Per-run results

| Run | Route | Header sent | Posted | Status histogram | Response |
|---|---|---|---|---|---|
| **(i)** | `/pos-hub/webhook/square/<rid>` | ONLY `x-square-hmacsha256-signature` = `base64(HMAC-SHA256(key, notification_url + raw_body))` | 243 | **401 × 243** | `{"statusCode":401,"message":"Webhook signature verification failed"}` — the ONLY distinct response |
| **(ii)** | same route, same bytes | ONLY `X-Pos-Hub-Signature` = `hex(HMAC-SHA256(POS_HUB_WEBHOOK_SECRET, raw_body))` | 243 | **201 × 243** | `{"provider":"square","received":0,"upserted":0,"wineItemsDetected":0,"errors":["No recognizable checks in payload"]}` — the ONLY distinct response |
| **(iii)** | `/pos-hub/webhook/generic_webhook/<rid>` | legacy signature | 42 | **201 × 42** | `received:1, upserted:1, errors:[]` on all 42 |

Run (i) 401'd uniformly across all five event kinds — including
`payment.updated` and `refund.created`, the two that carry their full object.
The redelivery 401'd too.

## Rows, before and after (PostgREST, `restaurant_id = aaecdb17-…`)

| Table | baseline | after (i) | after (ii) | after (iii) |
|---|---|---|---|---|
| `pos_checks` | 0 | 0 | **0** | **42** |
| `pos_unresolved_lines` | 0 | 0 | **0** | **52** |
| `wine_consumption_log` | 0 | 0 | 0 | 0 |
| `inventory_transactions` | 0 | 0 | 0 | 0 |

There is **no `pos_check_items` table** — the hub writes line items into
`pos_checks.items` (jsonb) at `pos-hub.service.ts:527`. 265 items landed there in
run (iii), 52 flagged `is_wine`. `wine_consumption_log` / `inventory_transactions`
stayed 0 because the tenant has no inventory: all 52 wine lines queued as
unresolved instead. That is the expected shape, and it is recorded, not glossed.

## Did the predictions hold?

| Prediction (spec §2.d / §3.4) | Verdict |
|---|---|
| (i) genuine Square signature → **401 on every event** | **HELD** — 243/243 |
| (i) → 0 `pos_checks` rows | **HELD** |
| (i) log carries the `legacy_global` warning, **never says the header was missing** | **HELD** — and worse than predicted, see below |
| (ii) → **HTTP 200** | **CONTRADICTED — it is 201.** Nest's default `@Post()` success code. Materially the same (a 2xx Square reads as delivered) but the spec's number is wrong in §2.b and §3.4 |
| (ii) → `received:0, upserted:0, errors:["No recognizable checks in payload"]` for **every** event kind, `payment.updated` and `refund.created` included | **HELD** — one distinct response body across all 243 |
| (ii) → zero rows from the whole day | **HELD** |
| (iii) the canonical path lands the whole day | **HELD** — 42/42 |
| §4.2(5) "0% vs 100%" | **MEASURED, not asserted: 0/42 vs 42/42.** $10,540.47 of a real Friday, 265 lines, 52 wine lines — all of it invisible on the Square door, all of it landed on the canonical one |

## The three most surprising log lines

1. **Run (i), the only PosHub line emitted by 243 rejections:**
   `WARN [PosHubService] POS webhook [square] r=aaecdb17-… is authenticating with the legacy process-wide POS_HUB_WEBHOOK_SECRET…`
   A **success**-shaped configuration line, logged on a request stream that was
   100% rejected. It fires because `resolveWebhookSecret` runs *before* the
   signature check (`pos-hub.service.ts:392` then `:410`), and
   `logSecretResolutionOnce` dedupes — so **243 401s produced exactly one log
   line, and that line describes authentication working.** Nothing anywhere says
   a signature header was missing, or which header was expected.

2. **Run (ii): zero PosHub log lines. At all.** A whole restaurant day — 243
   events, 42 checks, $10.5k — was accepted with 201s and left **no trace in the
   log**. The ingest log line lives at `pos-hub.service.ts:552`, *after* the
   `!checks.length` short-circuit at `:457-465`, so the one path that silently
   discards everything is the one path that logs nothing. (The two lines in the
   window are unrelated `TenantGuard` traffic from a browser session.)
   Run (iii), by contrast, logged `POS ingest [generic_webhook] … 1/1 checks, N wine items`
   **42 times**. Presence is logged; absence is not.

3. **Run (iii): `covers` was sent as `null` and stored as `0` on all 42 rows.**
   Square is structurally incapable of supplying covers (§1.9/§2.c), so every
   Square check would read `covers = 0` — a *number*, not a null. Any per-cover
   metric divides by a real zero rather than skipping an unknown. This defeats
   spec §3.5's proposed `checks.fields` fix ("the expectation must carry
   `covers: null`") — the column will not hold null. Same class as the standing
   absence-reported-as-health fault, one layer lower.

## Other measured facts from run (iii)

- `table_id` resolved on **0 of 42** checks (tenant has no `restaurant_tables`);
  `ticket_name` values sent were a mix of `T1…T22` and bar first names — the
  exact free-text ambiguity §2.c names, and nothing distinguishes the two.
- `server_external_id` null on **42 of 42**. Even the canonical path carried no
  server, because Square's only staff signal (`Payment.team_member_id`) lives on
  a different event and there is no field for it in `CanonicalCheck`'s check.
- `voided` true on exactly 1 (the canceled check) — but only because run (iii)
  *derived* it from `state == "CANCELED"`. The Square adapter has **no `voided`
  key at all** (`pos-adapters.ts:86-108`), so that derivation exists nowhere in
  product code.
- 52 `pos_unresolved_lines`, `resolved: false` — the wine queue a real Meyhouse
  operator would face on day one.

## What I did NOT run — stated plainly (§0.5)

- **No scoped-secret run (signer C).** `POS_WEBHOOK_SECRET_SQUARE[__<RID>]` is
  not set in either `.env`, and setting one would have modified the environment
  and disabled the legacy rung run (ii) depends on. The legacy rung was confirmed
  live by the run-(i) log line, not assumed.
- **`GET /pos-hub/status/<rid>` not read** — it requires a JWT and returned 401.
  So the claim "status will show the same 0 checks a quiet integration shows" is
  **still unmeasured**; only the ingest response and the log were measured.
- **No retry/backoff behaviour tested.** Square's 11-attempt / 24h retry (§1.1)
  was not simulated; the redelivery was a single byte-identical re-POST.
- **No `order.fulfillment.updated` events** (§1.4) — the day emits none.
- **Dedupe on `event_id` was never exercised**, because run (ii) landed zero
  rows: there was nothing to deduplicate. The redelivery's outcome is therefore
  "rejected identically" (i) and "discarded identically" (ii), not "deduped".
- **No product code, no worktree file, and no repo file was changed. Nothing was
  committed. No SQL or service-role write was issued at any point.**

## Files

`gen_square_day.py`, `sign_square.py`, `post_day.py`, `dbcount.py`,
`manifest.json`, `retrieve_orders.json`, `catalog.json`, `corpus/` (243 files),
`results-run-i.json`, `results-run-ii.json`, `results-run-iii.json`,
`snap-before-i.json`, `snap-after-i.json`, `snap-after-ii.json`,
`snap-after-iii.json` — all under
`…/scratchpad/square-day/`.
