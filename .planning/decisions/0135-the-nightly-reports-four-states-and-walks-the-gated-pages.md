# 0135 — The nightly reports four states and walks the gated pages

- **Status:** Proposed
- **Date:** 2026-09-11
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** e2e-prod, nightly, playwright, wave-h, backtest, canned-day, forecast-fixture, four-state, absent, cannot_check, mudavym_design flags, teardown_sim, rate-limit
- **Links:** [[0089-absence-reported-as-health]], [[0093-a-scenario-is-replayed-and-verified-against-its-own-expectation]], [[0097-deploy-audit-reads-the-build-it-verified]], [[0106-every-dependabot-pr-resolved-by-measurement]], [[0131-the-new-house-goes-live]], `.planning/v3.0-TECH-DEBT.md` "CI — the nightly production E2E…", `.planning/testing/README.md`, PR for `test/nightly-e2e-modernised`

## Context

The founder's instruction on 2026-09-06, verbatim: *"nightly e2e account: improve backtests
and improve overall tests its outdated"*, with the e2e account moving to
`aldemirkonuk@mudavym.com` (he registers it and sets `E2E_TEST_EMAIL` /
`E2E_TEST_PASSWORD`; a session grants it a simulator house) after the seeded demo house
was deleted on his word.

Measured on 2026-09-11 before a line was written:

- `.github/workflows/e2e-prod.yml` had 120 runs, 118 red, **none with credentials** (the
  2026-09-02 tech-debt entry). Its browser wave asserted **≥7 "Active" agent cards** on
  `/admin/health` and **wrote** an `onboarding_sessions` row through `/studio`
  (`prod-smoke.spec.ts` F-2, F-4) — a suite for a product that no longer exists in that
  shape, with a write on the production path.
- The orchestrator every Python wave targets answered **404 "Application not found"** at
  the URL the planning corpus records (`agent-orchestrator-production.up.railway.app`);
  the `RAILWAY_ORCHESTRATOR_URL` secret exists but is unreadable, so the true target is
  unknown. Six waves would have been six reds with no reason in them.
- The retired Playwright config asked for `channel: 'chrome'` while the workflow installed
  only bundled Chromium — Wave F could never have launched a browser even with secrets.
- **`tests/e2e/conftest_prod.py` ends every session by calling
  `teardown_sim(client, apply=True)`**, which resolves every restaurant whose slug starts
  with `sim-` and deletes it with its whole write-set (`scripts/synth/teardown.py:103,
  245`). Production's four simulator houses — Sim Bistro `12823c23`, both Sim Meyhouse
  rows `a229f22b` / `aaecdb17`, Sim Vanilla Kaleiçi `684920db` — all carry `sim-` slugs.
  The first nightly to receive `SUPABASE_SERVICE_ROLE_KEY` would have wiped the only test
  tenants the founder said to keep. A write-path instance of ADR 0089's fault, fixed
  immediately (opt-in via `E2E_SIM_TEARDOWN=1`, dry-run otherwise).
- The nineteen rebuilt pages are **not on `origin/main`**: PR #289 (`feat/mudavym-design-p4`)
  is still an open draft; main gates 11 pages (`useMudavymDesign.ts` `MUDAVYM_PAGES`).
  Production `restaurant_feature_flags` holds **zero** `restaurant_settings` rows for the
  sim houses or ALDEMIR, so every flag reads OFF there today, and
  `aldemirkonuk@mudavym.com` does not yet exist in `public.users`.
- The auth routes are limited to **10 requests per 60 s per (IP, route)**
  (`rate-limit.guard.ts` `DEFAULT_RATE_LIMITS.auth`; `generateKey` appends the route), and
  `/auth/sign-in-methods` to 10 per 10 minutes. A naïve per-page `page.goto` walk boots
  the SPA nineteen times and 429s itself.

## Options considered

1. **Patch the existing suite** — keep the seven waves, add the new pages to
   `prod-smoke.spec.ts`. Cheapest; keeps a write on the production path, keeps `≥7 Active`
   as a pass bar, keeps six waves that can only be red, and keeps JUnit's two words
   (pass/fail) for a question that has four answers.
2. **Rebuild around a four-state result model, a page manifest, and read-only walks**
   — chosen, below.
3. **Delete the Python waves** — honest about the orchestrator, but a deletion of test
   surface is the founder's call, not a session's; and the secret may point somewhere
   alive. Kept behind a preflight that names the reason instead.
4. **Base the branch on `feat/mudavym-design-p4`** so all nineteen pages are present —
   rejected: the branch is an unmerged draft with a peer's uncommitted work in `wt-p4`, and
   a manifest that reports absence covers the gap without coupling the nightly to a PR.

## Decision

**Every check the nightly makes ends in exactly one of `pass` · `fail` · `absent` ·
`cannot_check`, the four are counted separately, and the job is red on `fail` (exit 1)
and on `cannot_check` (exit 2) — never green by skipping, never green over an empty
corpus.** Concretely:

- **One manifest** (`apps/web/e2e/nightly/manifest.json`, 19 pages) read by both walkers.
  Each page carries its route, its legacy behaviour (`page` / `same` / `redirect:/x`), and
  its *own* honest-state sentences grepped from its `next/` directory — never a figure.
- **The browser walk** (`apps/web/e2e/nightly/nightly.spec.ts`, config
  `playwright.nightly.config.ts`): signs in through the real two-step form once; mints
  the walking session via `/auth/login`; reads every flag through
  `/settings/feature-flags/check`; boots the SPA **once per pass** with the session and
  the per-browser overrides (`mudavym.design.<page>` = `1`, then `0`) in `localStorage`,
  and navigates by `pushState` so no page costs a second `/auth/me`. A per-route
  `AuthBudget` waits when eight calls sit in any rolling minute and records the peak. With
  the override on, a page with no `.mudavym` root — or one the router's catch-all sent to
  `/` — is **`absent`**, not a pass. A page that renders its failed-read sentence is
  recorded twice: honesty `pass`, reads **`fail`**. Empty and denied states in words are
  `pass`. A house with no order or document to open the door/document routes on is
  `absent` for those routes. A screenshot of every page in both passes goes into the
  artifact. A test that records nothing is itself `cannot_check`.
- **Wave H** (`services/agent-orchestrator/tests/e2e_gateway/`, read-only, its own conftest
  so the sim teardown cannot attach): `/health/live` must name its build (`commit` a
  40-hex SHA; `unknown` = `cannot_check`); guarded routes 401 without a token; the same
  flags; `/analytics/forecast/:house` must report a full backtest (`rolling_one_step_ahead`
  with numeric MAE/RMSE/MAPE/MASE) **or** say `no_observations_in_scored_window` with every
  metric null; `/analytics/insight-catalog/types` must carry its honest split;
  `/simpos/:house/scenarios/runs` is `absent` in production by construction (ADR 0093)
  and, where the module is loaded, the recorded run's totals must equal the canned day.
- **Backtests, two halves of one thing.** *Offline:* the canned day (bistro · random ·
  seed 7 · 2026-09-02 — ADR 0093's live day) is pinned by content hash in
  `datasets/sim/fixtures/scenario-canned-day.json` and asserted by
  `scripts/test_simulate_scenarios.py::test_the_canned_day_matches_its_pinned_fixture`;
  the forecast chain `AnalyticsService.getDemandForecast` runs (Holt-Winters 7 / Holt /
  SES, scoring window and MASE benchmark held to `warmup`) is pinned for seven
  deterministic series in `datasets/sim/fixtures/forecast-backtest.json` and asserted by
  `apps/api-gateway/src/analytics/engine/forecasting.backtest.spec.ts`, with a lockstep
  test that greps the service for the exact parameters. Both re-pin only by a named
  command; a hand edit fails the hash. *Live, read-only:* Wave H above.
- **The workflow** (`e2e-prod.yml`): required secrets are `API_GATEWAY_URL`,
  `E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD` (+ `E2E_BASE_URL`, defaulting to
  `https://mudavym.com`); missing = exit 2 before any install. An orchestrator preflight
  turns an unreachable `RAILWAY_ORCHESTRATOR_URL` into `cannot_check` with the HTTP code
  in the reason; Waves A–E, G run only when it answers. `workflow_dispatch` takes
  `expect_flags` (report | on | off), `base_url`, `api_url`. `scripts/e2e/nightly_summary.py`
  merges everything into one table (job summary + artifact) and sets the job's colour.
  `GMAIL_PASSWORD`, mapped and read by nothing, is no longer mapped.
- **Retired:** `apps/web/e2e/prod-smoke.spec.ts`, `apps/web/playwright.prod.config.ts`.

## Consequences

- **Easier:** a red nightly now carries its reason in the row that is red; the founder's
  go-live flip can be gated by `expect_flags=on` the day he wants it; the nineteen pages
  slot in as #289 merges with no suite change (the manifest already names them; today
  eight report `absent`); every walk leaves screenshots.
- **Harder / given up:** the walk tells nothing about figures by design; the door and
  document routes stay `absent` until the e2e house holds an order and a document; Wave
  H's build-identity check is `cannot_check` against a local gateway (no build variable)
  and only meaningful in production; legacy pages that print "could not be read" while a
  query is still loading (`ManagerShiftDesk.tsx:128`) are read twice with a pause, which
  costs ~3 s per such page and is a legacy-copy defect worth its own fix.
- **Measured locally on 2026-09-11** (worktree Vite `:5276` → local gateway `:4010` at
  main's `fed2b7ca` on the shared production database, sim-owner account, Sim Bistro):
  browser walk **48 pass · 1 fail · 28 absent · 0 cannot_check** — the real two-step
  sign-in passes; 11 gated pages render the Mudavym design with the override on and
  legacy with it off; 8 pages `absent` in both passes (not on main until #289) and the
  door/document routes `absent` (the house holds no order and no document); auth calls
  peaked at **5 per route per minute**. **The one `fail` is a finding, not a harness
  defect:** `/communications` printed *"The conversation book could not be reached
  (Request failed with status code 404)"* and *"Saved schedules could not be loaded …
  (Request failed with status code 500)"*, and a direct read of `GET /reports/schedules`
  as the same owner answers `500 "Could not find the table 'public.scheduled_reports' in
  the schema cache"` — the gateway queries a relation the shared database does not have.
  Recorded in `v3.0-TECH-DEBT.md`; not fixed here. Wave H: 9 of 10 pass, `h.build.live`
  `cannot_check` (local `commit=unknown`); the recorded ADR 0093 run `937a23f0` equals the
  regenerated canned day (21 checks · $5,549.56 · 52 wine · 82 food); the forecast fixture
  pins 7 series and its drift assertion was proven red on a 1e-6 perturbation; the summary
  script exits 2 on an empty results directory and 1 on this local result set.
- **Revisit when:** #289 merges (expect the eight `absent` rows to turn into pass/fail
  the next night); the founder's secrets land (the first real production run is the
  evidence this ADR lacks — its verdict goes into the review trail); a second house is
  granted for the legacy pass; the orchestrator's real URL is known.

## Open forks for the founder — deliberately not decided here

| # | Fork | Default in this change | What decides it |
|---|---|---|---|
| F1 | Should the nightly **fail** when a sim house's `mudavym_design_*` flag is OFF? | `expect_flags=report` (state recorded, never a failure) | Go-live intent per ADR 0131: once he flips the sims, run with `on` |
| F2 | The orchestrator waves A–E, G: retarget, keep behind the preflight, or delete? | kept behind the preflight (`cannot_check` when 404) | whether `RAILWAY_ORCHESTRATOR_URL` points at anything alive |
| F3 | Legacy pass: the same house with the override forcing legacy, or a second house whose flags are really OFF? | same house + override; `E2E_LEGACY_RESTAURANT_ID` switches it | whether he grants the e2e account two houses |
| F4 | Seed one order and one incoming document into the e2e house so `/receiving/:id/door` and `/documents/:id` can be walked? | `absent` until then | his call — it is production data, even in a sim house |
| F5 | The 2026-09-06 memory reads "sims kept AND flipped"; production shows no flag row at all. Flip them? | reported as OFF | `scripts/flip_mudavym_design_flags.py`, his keystrokes |

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-11 | — | Created; measured locally as above; awaits the founder's secrets for the first production verdict |
