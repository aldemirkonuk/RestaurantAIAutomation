## What ADR 0292's whole-window reads left open — OPEN — 2026-10-03

Filed by branch `fix/analytics-reads-past-row-cap` (lane `cap`, F-131 / C15). The fix reads the `pos_checks` and `wine_consumption_log` windows that ADR 0292's readers table names whole through `readWholeWindow`, or refuses with `WholeReadError` [narrowed 2026-10-04: this first said every analytics window of those tables, which the baselined reads below contradict]. The items below are what it did not fix. Line numbers are at this branch's head.

**Reads still capped, held in the guard's shrink-only baseline** (`scripts/check_window_reads_are_whole.py`, `BASELINE`). The PR that removes or wraps one of these deletes or lowers its row, or CI fails it as stale:
- `dashboard/dashboard.service.ts` `getStats`, its `wine_consumption_log` read (`:521-522`). #579 (R1b, paused) and lane dash both touch it; whichever removes the read deletes the row.
- `pos-hub/pos-hub.service.ts` `getStatus`, 30 days of `pos_checks` (about `:1285`). It summarises sources, so a 1,000-row slice can understate a feed's last check.
- `communications/scheduled-tasks.service.ts`, the weekly top-sellers digest: 7 days of `wine_consumption_log` (`:1272`) [cite corrected 2026-10-04, verify round 2: it first said about `:1239`]. At about 131 lines a day, this is under the cap today and over it at about 143 a day.
- `analytics/dev-truth.service.ts` as-of split, 2 reads (`:238`, `:243`). The counts are exact, but the rows are capped.
- `notifications/producers/sale-record.producer.ts:232-238`: `.limit(CHECK_CAP + 1)` (`:238`) with `CHECK_CAP = 2000` (`:84`). That is above the server's 1,000, so its `truncated` branch can never fire. This is a latent defect: the read covers one local day, which holds far under 1,000 checks (the ADR's measured average is about 58). [Corrected 2026-10-04, verify round 2: it first cited the `.limit` at `:232` and said about 80 checks a day, a figure no measurement here backs.]
- `pos-hub/pos-mapping-review.service.ts:385`: `.limit(checkLimit)`, where the DTO allows `@Max(2000)` (`dto/pos-mapping-review.dto.ts:75`). The default is 500, so a caller asking for more than 1,000 gets the latest 1,000. Its `checks_scanned` reports 1,000 (`:448`), so the count is honest, but nothing says the request was clipped. This is reachable today, not latent. [Corrected 2026-10-04, verify round 2: it first said the caller is told it scanned what it asked for; `checks_scanned` is `checks.length`.] **The plan's grep census missed this read, because grep reads this file as binary; the guard's Python scan found it.**

**Degrades kept on purpose (fork 3, the plan's recommendation, not a founder ruling).**
- `analytics/analytics.service.ts` `loadConsumption` still turns a refused read into `[]`, with a loud log. Financial summary, inventory science, risk and the 120-day forecast then see no consumption rather than a slice of it.
- `analytics/insights/insight-generator.service.ts` `loadBundle` lets a refused read reject inside its `allSettled`. The family stays silent, not partial.

Both are "silent rather than wrong", but silent. If either should fail its whole surface instead, that is a founder fork.

**Not this lane's, seen while in it.**
- `goals.service.ts` `computeMetricWithSeries` `purchase_spend`: an unbounded `procurement_orders` read, which the guard does not scan.
- `dashboard.service.ts` `getSalesChart`: its procurement half still degrades to `[]` on a failed read.
- The window reads filter `wine_consumption_log.created_at`, but its only window index is `(restaurant_id, recorded_at DESC)` (`idx_consumption_restaurant`). There is no `(restaurant_id, id)` index on either table, so the planner sorts each page's window by `id`. That is fine at this volume; measure it before a second house.
- AW01: the /recommendations "Tonight" card now lands on the true last day and stays urgent (lane rec).
- AW02: menu engineering counts a glass as a bottle, and its 90-day divisor is a separate defect.
- C02 / F-129: the one-Friday bar, from UTC-day bucketing.
- AW24: booth checks now count in server stats, because the whole window includes them.
- AW27: the /cellar library tile is the same cap in web code (lane cellar).
- `insights/insight-generator.service.ts` `staleVersionCategories`: `.limit(5000)` on `analytics_insights`, above the 1,000 cap, so past 1,000 stale rows one sweep sees only some (restaurant, category) pairs. It heals over later sweeps, and readers refuse stale rows anyway. The guard does not scan this table.

**Not measured.**
- **Latency (fork 2).** For the 365-day ribbon (`/analytics/pos-revenue?days=365`), the estimate is about 22 check pages plus 48 consumption pages at about 60 ms each: roughly 4 s in sequence. If the measured time passes about 3 s, move that window to an RPC that returns jsonb (a set-returning RPC is capped too).
- **The overview's fan-out (verify round 1, 2026-10-04).** `/analytics/overview` runs five lenses that each read their own 90-day consumption window (financial, risk, inventory science, menu engineering, seasonality): about 60 page requests in five parallel chains of 12, where it used to be five capped requests. Nothing is shared between them. Measure it with the ribbon; sharing one read is a cache with a lifetime, which needs its own decision.
- **The /recommendations fan-out (verify round 2, 2026-10-04).** `recommendations.service.ts:187` runs the same five lenses plus a live `generate()`, whose bundle reads its own 90-day consumption and check windows: six whole consumption reads and one check read, roughly 78 page requests in seven parallel chains. Not timed, locally or in production.
- **The web refusal state, never eyeballed.** On a refusal, /reports prints "The till register could not be read (Request failed with status code 500). Nothing below is claimed." The till route maps every error to a 500 (`analytics.controller.ts` `getPosRevenue`), and `failureOf` (`apps/web/src/pages/reports/next/rp-format.ts:148-153`; cite corrected 2026-10-04, verify round 2, from `:133-137`) takes axios's own `error.message`, not the gateway's body, so the WholeReadError sentence does not reach the page. That is how every /reports register names a failure today, not something this branch changed. [Corrected 2026-10-04: this line first said the page would print the gateway's "…could not be read whole…" sentence; `failureOf` reads `error.message`, which for an axios error is the status line.] Read from code only: no page was rendered against a refusing gateway.
- **`createGoal` returns 400, not 503.** Its controller maps any error to 400, so a refused baseline arrives as a 400 that carries the refusal sentence.
- **The helper's one blind spot, in code and not reachable today.** With no count in the response, a short page ends the read. The guard forces `count: "exact"` at every call site, so only test doubles take that path. A lowered `max_rows` together with a dropped count would pass unseen.
