---
type: page
route: /simpos/:restaurantId/scenarios
slug: simpos-scenarios
softwares: [simpos]
component: apps/web/src/pages/simpos/SimposScenariosPage.tsx
audience: dev
tier: public
archetype: dev # instrument, like /dev/truth — no design system by intent
signals_today: none
rebrand_strings: 0
maturity: partial
status: documented
updated: 2026-09-02
links: ["[[PAGE-CONTRACT]]", "[[simpos-terminal]]", "[[simpos-order-log]]", "[[0093-a-scenario-is-replayed-and-verified-against-its-own-expectation]]", "[[DELIVERY-AUDIT]]", "[[S04-pos-order-flows-to-inventory]]", "[[S09-pos-webhook-drops-or-desyncs]]"]
---

# /simpos/:restaurantId/scenarios

> **Part of** [[08-softwares/simpos|SimPOS]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Back to terminal** → [[simpos-terminal]] `/simpos/:restaurantId`
- **Order log** → [[simpos-order-log]] `/simpos/:restaurantId/orders`
- **A run in the list** → selects it and calls `GET /simpos/:restaurantId/scenarios/runs/:runId/verify`
- **Re-verify** → the same `GET …/verify` again
- **Run low-stock sweep now** → `POST …/runs/:runId/sweep` (the 2-minute edge sweep, run immediately), then re-verify
- **Generate insights now** → `POST …/runs/:runId/insights` (the insight generator, persisted), then re-verify

## 1. Purpose
The verdict screen for a replayed restaurant day (ADR 0093). The Python scenario engine
(`scripts/simulate scenario …`) generates a day inside the venue's own operating hours —
the opening minute, two tables two minutes apart, a full service, a wine sold through to
par, an unmapped button, a void, a duplicate webhook, a dropped webhook, an after-hours
order — posts it through the same signed webhook a real POS uses, and persists what it
expects to find. This page shows one server-side comparison of that expectation against
`pos_checks`, the lot ledger, the consumption mirror, the unresolved queue, the inbox, the
email outcome, the insight table and the analytics services: twenty checks, each
**pass / fail / unverifiable**. An empty expectation is never a pass; a failed read is a
failed read, not an empty result (`SimposScenariosPage.tsx:11,329`).

## 1a. Features *(dev instrument over the synthetic fixture — not a product page)*
- List the scenario runs recorded for this sim restaurant (newest first, capped at 50 and shown as a floor when the cap is hit)
- Read each run's scenarios as one-sentence stories, and its totals
- See the twenty-check verdict table: status, what was expected, what was found, why — with samples expandable
- Re-verify on demand
- Fire the low-stock edge sweep now and see the notifications it produced, including whether the email left (`delivery_status.email`)
- Generate insights now and see how many, and a sample of the sentences
- Explicit loading, failed-request and no-runs states; the empty state names the simulator, never a terminal command

## 2. Entry
In-app links from the terminal header (`SimposTerminalPage.tsx:211`) and the order-log
header (`SimposOrderLogPage.tsx:41`); otherwise cold URL. **Only under `vite dev`** — a
production build redirects to `/` (`App.tsx:263-266`, same gate as its siblings).
Requires login (`ProtectedRoute`), outside `DashboardLayout` like the rest of SimPOS.

## 3. Files
- Route binding: `apps/web/src/App.tsx:263-266` (lazy, `App.tsx:92`)
- `apps/web/src/pages/simpos/SimposScenariosPage.tsx` (611 lines)
- API client: `apps/web/src/services/api/simpos.ts:252-284` (five methods, typed to the verifier's contract)
- Test: `apps/web/src/__tests__/SimposScenarios.test.tsx` (7 cases — failure renders as failure, unverifiable is its own label, the cap is a floor, no terminal command in the empty state)
- Server: `apps/api-gateway/src/simpos/scenario-verify.service.ts` (2054 lines, 18 spec cases + the integration cases), `scenario-types.ts`, routes in `simpos.controller.ts:209-268`
- Producer: `scripts/simulate/scenarios.py` (1937 lines, 72 tests) via `python3 -m scripts.simulate scenario …`

## 4. Endpoints
All under `/simpos/:restaurantId`, class-level `JwtAuthGuard`, `assertSimRestaurant` on every call, **absent in production** (`app.module.ts` gates `SimposModule` on `NODE_ENV !== "production"`):
| Method | Path | Where called |
|---|---|---|
| GET | `…/scenarios/runs` | `SimposScenariosPage.tsx:216` (list, cap 50) |
| GET | `…/scenarios/runs/:runId/verify` | `:231` (the verdict) |
| POST | `…/scenarios/runs/:runId/sweep` | `:255` (lever: low-stock edge sweep now) |
| POST | `…/scenarios/runs/:runId/insights` | `:269` (lever: generate + persist insights now) |
| GET | `…/scenarios/runs/:runId` | client method present (`simpos.ts:257`), not called by the page today |

## 5. Signals
None. The page emits nothing; it only reads. Say so honestly.

## 6. Tier cut
Not tiered — a dev instrument. It **executes** the §9 simulation gates of
[[S04-pos-order-flows-to-inventory]] (correct ledger delta, replay is a no-op) and the
duplicate half of [[S09-pos-webhook-drops-or-desyncs]]; the dropped half renders as
`unverifiable` because no detector exists, which is S09's own honest status.

## 7. Rebrand surface
None — no `WineOps` string on this page.

## 8. State & config — the page does not exist in production
Same shape as [[simpos-terminal]] §8: the route redirects in a production build and the
module is not registered. What it needs to show anything: a `sim-*` tenant seeded by
`scripts/synth generate --apply` (which, since ADR 0093 D4, materialises opening stock as
lots), venue hours set (`restaurants.operating_hours` — the engine refuses to post
without them), and a run posted by `scripts/simulate scenario … --apply` against a
gateway with `POS_HUB_WEBHOOK_SECRET` and the sim owner persona's credentials.

## 9. Gaps
- `hours.closed_day` and `hours.outside` depend on the venue's hours being set; a venue
  with `null` hours makes both `unverifiable` by design.
- `analytics.tables` is a floor (the table-performance service aggregates a rolling window
  ending now, not one date); `analytics.pos_revenue` buckets on the UTC date of
  `closed_at`, so a day split across two UTC buckets reports `unverifiable` with both
  figures.
- `webhook.dropped` can never pass: the product has no missed-webhook detector (S09).
- Insights and revenue on a closed-day run belong to other runs on the same date, so both
  report `unverifiable` rather than borrowing evidence.

## 10. Maturity — **partial**, and *absent in production*
Built and unit-tested on 2026-09-02; **the live day ran on 2026-09-03** against a local
gateway on the merged `main` and the shared Supabase: run `937a23f0` on `sim-bistro`
verified **17 pass · 0 fail · 3 unverifiable** after the two levers (ADR 0093, "The live
day, on the record"). The three unverifiables are the structural ones §9 names. The page
rendered that verdict for the sim owner persona; "partial" stays because the run itself is
still started from the CLI, not from this page.

## 11. Data flow
Producer → `POST /pos-hub/webhook/generic_webhook/:id` (signed) and `sim_scenario_runs`
(service role, the harness's own bookkeeping) → this page reads
`GET …/verify`, which reads `sim_scenario_runs`, `pos_checks`, `restaurant_tables`,
`inventory_transactions`, `pour_events`, `inventory_lots`, `restaurant_inventory`,
`wine_consumption_log`, `pos_unresolved_lines`, `notifications`, `analytics_insights`, and
calls the analytics services in-process. Every read's outcome is returned in `reads[]`.

## 12. Design intent
An instrument, not product: the same posture as [[dev-truth|/dev/truth]] — a table a
founder can read without code, showing the inputs that produced each verdict. Delete or
fold into the order log when the harness graduates to a CI job.

## 13. Roadmap
1. ~~Run the live day and record the first verdict table in ADR 0093's review trail.~~ Done 2026-09-03 (17 · 0 · 3).
2. Make the run itself startable from the page (today the engine is a CLI, by design —
   the product's own doors are used for every write except the run row).
3. A missed-webhook detector, so `webhook.dropped` can become a real check (S09).
