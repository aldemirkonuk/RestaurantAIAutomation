# 0135 — The nightly reports four states and walks the gated pages

- **Status:** Proposed
- **Date:** 2026-09-11
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** e2e-prod, nightly, playwright, wave-h, backtest, canned-day, forecast-fixture, four-state, absent, cannot_check, mudavym_design flags, teardown_sim, rate-limit
- **Links:** [[0089-a-page-can-start-the-engine-it-reports-on]], [[0093-a-scenario-is-replayed-and-verified-against-its-own-expectation]], [[0097-the-gateway-says-which-build-it-is]], [[0106-every-dependabot-pr-resolved-by-measurement]], ADR 0131 "the new house goes live" (unmerged as of 2026-09-11 — not a wikilink, since it is not yet a file on `main`; see the audit note below), `.planning/v3.0-TECH-DEBT.md` "CI — the nightly production E2E…", `.planning/testing/README.md`, PR #349 for `test/nightly-e2e-modernised`

## Context

The founder's instruction on 2026-09-06, verbatim: *"nightly e2e account: improve backtests
and improve overall tests its outdated"*, with the e2e account moving to
`aldemirkonuk@mudavym.com` (he registers it and sets `E2E_TEST_EMAIL` /
`E2E_TEST_PASSWORD`; a session grants it a simulator house) after the seeded demo house
was deleted on his word.

Measured on 2026-09-11 before a line was written:

- `.github/workflows/e2e-prod.yml` had 120 runs, 118 red as of the **2026-09-02**
  tech-debt entry, **none with credentials**. Re-measured fresh on **2026-09-11**
  (`gh api repos/.../actions/workflows/e2e-prod.yml/runs --paginate`, per §5b — never
  copied forward): **130 runs, 127 failure, 3 success.** The 118/120 pair had been
  carried into an earlier draft of this ADR and into `decisions/README.md:126` as if
  freshly measured on 2026-09-11; both are corrected in this amendment. Its browser wave
  asserted **≥7 "Active" agent cards** on
  `/admin/health` and **wrote** an `onboarding_sessions` row through `/studio`
  (`prod-smoke.spec.ts` F-2, F-4) — a suite for a product that no longer exists in that
  shape, with a write on the production path.
- The orchestrator answered **404 "Application not found"** at the URL the planning
  corpus recorded (`agent-orchestrator-production.up.railway.app`). **Correction
  (2026-09-11, this session's own error, caught by a peer session and re-verified
  directly):** that hostname was wrong, not the service — `.railway/railway.ts:28-32`
  names the live host as `servicesagent-orchestrator-production.up.railway.app`, which
  answers **200** on `/health` (re-curled while writing this amendment). The
  `RAILWAY_ORCHESTRATOR_URL` secret's *value* is unreadable from here, so whether it
  already points at the live host or still at the stale one stays unknown without a run
  — that is fork F2 below; see "Founder's answers" for the resolution. Six waves would
  have been six reds with no reason in them only if the secret was in fact stale.
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

**F2, F3 and F4 are answered — see "Founder's answers (relayed), 2026-09-11" below.
F1 and F5 remain open**, unaddressed by anything relayed to this session.

## Founder's answers (relayed, 2026-09-11)

**Provenance, stated plainly:** these four answers reached this session as a relay from
the peer session coordinating the mudavym.com go-live across the fleet (session
`restaurant-ai-automation-7e`, the "launch-orchestrator" session — see
[[launch-orchestrator-2026-09-11]]), not as something the founder said directly in this
session's own chat. They are recorded here because the launch-orchestrator session is the
one this session was told to synchronize with (`SLOT?`/`GO` protocol), and treating a
relayed founder answer as undecided would stall the launch coordination this ADR is part
of — but the provenance is explicit so a later session can go verify it directly with the
founder if anything here is acted on further.

- **F2 — orchestrator waves A–E, G.** Retarget `RAILWAY_ORCHESTRATOR_URL` to
  `servicesagent-orchestrator-production.up.railway.app` (the corrected host, above).
  Waves C, D, E, G stay **unarmed** — `RABBITMQ_URL`, `TOAST_WEBHOOK_SECRET`,
  `GMAIL_USER` stay unset, so those four waves keep reporting `cannot_check` rather than
  attempting a write. The schema disagreements underneath D, E and G (Wave E's Gmail
  pipeline in particular — `wave_e_gmail_pipeline.py:33,65,137-138` upserts to a trigger
  that sends a real low-stock email) are **not repaired in #349**; they are filed as
  their own tech-debt unit in `v3.0-TECH-DEBT.md`, separate from this ADR.
- **F3 — legacy pass house.** A second sim house via `E2E_LEGACY_RESTAURANT_ID`, not the
  same-house-override default this ADR shipped with.
- **F4 — door/document routes.** Leave `/receiving/:id/door` and `/documents/:id`
  `absent`; seed nothing into the e2e house. It is production data, even in a sim house,
  and seeding it is not this PR's call.
- **Escalation approval.** The founder's answer is also the escalation approval the
  pr-audit-gate skill's step 4 requires for this PR's `.planning/decisions/README.md`
  index-row edit (a gate-owned path) — landing under the ordinary flow rather than forcing
  a founder-only merge, on the understanding that **#349 lands only after #289 serves**
  in the single-lane merge order, on a `GO #349` from the launch-orchestrator session.

## Audit result (2026-09-11, pr-audit-gate on PR #349)

Three parallel angles + a possible adversarial pass, per the skill (ADR 0090):

| Angle | Verdict |
|---|---|
| Correctness & regression risk | APPROVE WITH NOTES |
| CLAUDE.md-and-ADR compliance | APPROVE WITH NOTES |
| Security & production blast-radius | **BLOCK** |

**Overall verdict: BLOCK.** Per the skill's step 6, any angle returning BLOCK skips the
adversarial pass — this PR did not reach one. Full report, all three angles' findings in
full, and what could not be checked: `.planning/07-reference/pr-audits/349-dd51f235.md`,
also posted to the PR as the durable, SHA-stamped record the skill requires.

**Why BLOCK, in one sentence:** `playwright.nightly.config.ts:49` sets
`trace: 'retain-on-failure'`, and a Playwright trace captures the full network log — this
session proved it holds the plaintext test password and session JWTs with a sentinel run
(`E2E_TEST_PASSWORD='PW_SENTINEL_ZQ7X_DO_NOT_MATCH'`, `--grep precondition`, failed at
login as designed) that put the sentinel into `test.trace`, `0-trace.trace` and a
`resources/*.json` blob — and the workflow uploads that directory as a 30-day CI artifact
on a repository this session confirmed is **PUBLIC** (`gh repo view` → `visibility:
PUBLIC`). The leaked local traces from that test were purged
(`rm -rf apps/web/test-results/nightly-traces apps/web/test-results/nightly`); nothing
was pushed. Three lower-severity security findings and the correctness/compliance notes
are all in the full report — this ADR does not restate them, per CLAUDE.md §2.

**Corrected in this same amendment, as compliance-angle findings:** the copied-forward
118/120 run count (above), the `EXISTING-TEST-INVENTORY.md` summary-count drift the PR's
own row edit introduced (jest 41→42, pytest 67→68, total 142→144, `11-platform` 30→32,
its stale layer-inference sentence naming the retired `prod-smoke.spec.ts`), three broken
`[[wikilink]]` targets in this ADR's own Links line (above), and `ADR-0135-b`'s brittle
negative-only claim (`CLAIMS.jsonl` now asserts the positive call positionally). **Not
yet fixed, carried to the next session together with the security fix list:**
`ADR-0135-f` holds `open` for a reason unrelated to the debt it names (this PR deleted
the comment its `verify` greps for) and the wrong `Co-Authored-By: Claude Fable 5.1`
trailer on commit `5e4f21f1` (CLAUDE.md §7 wants `Claude Opus 5`; the trailer that
actually lands is whatever the eventual squash-merge body carries).

## Audit fixes (2026-09-12, orchestrating session, on the founder's instruction)

The founder chose "Fix trace, then land it". Findings from the 2026-09-11 audit, by status:
- **1.1 critical (trace leak): fixed.** `playwright.nightly.config.ts` sets `trace: 'off'`
  with the reason in a comment. Screenshots stay, since the audit found they carry no
  headers or bodies.
- **1.2 high (gateway URL unguarded): fixed.** `e2e-prod.yml` refuses an `API_GATEWAY_URL`
  that points at a local address, as it already did for `E2E_BASE_URL`. It also refuses a
  URL that is not https, because that URL receives the test password on every login.
- **1.4 low (a reporter crash read as a product failure): fixed.** `_load_json` returns an
  OS or decode error as a parse error, so the summary records `cannot_check`.
- **1.3 medium (`E2E_LEGACY_RESTAURANT_ID` unconstrained): not fixed.** The id is optional
  and unset (the secret does not exist). F3, the second sim house, is not built. The
  constraint that it resolve to a `sim-` slug belongs with F3.
- **Correctness finding 1 (`absent` inferred and missing from the verdict): not fixed.** It
  was APPROVE WITH NOTES, not blocking.

**Merged without a re-audit.** Per the founder's 2026-09-12 answer ("Your word as PASS, no
agents"), no auditor re-read this head.
**[CORRECTED 2026-09-16: #349 was NOT merged.** The fix commit `c1221a9f` existed only in
the local worktree `wt-e2e`, never pushed, with a merge of `origin/main` (`beb00db4`) left
half-done over all six conflicts. `gh pr view 349` on 2026-09-16: OPEN, head `82add0f6`.
The fixes above reached the PR with the rebuild below.]**

## Rebuild (2026-09-16) — new pages, the design artifacts, and the rest of the fix list

The founder's instruction: *"Rebuild E2E test with new pages artifacts and updated
parts, there should be docs to understand it."* Six calls were put to him in session and
answered; each is recorded here with what it rejected.

| Fork | Chosen | Rejected, and why |
|---|---|---|
| What "new pages" covers | The 20 pages now in `MUDAVYM_PAGES` (adds `/logs`), plus the new-pages routes listed and **measured** absent until they land | A readable per-run board (not chosen) |
| The design artifacts | **Used as a source**: the founder's recorded calls | — |
| Where it lands | **Update PR #349** (merge main, clear the fix list) | A fresh branch that closes #349: the audit trail would stay on a closed PR |
| Where the doc lives | **`apps/web/e2e/README.md`**, next to the code; the stale nightly section of `.planning/testing/README.md` is retired into it | `.planning/testing/NIGHTLY-E2E.md` (away from the code); ADR-only (hard to onboard from) |
| How the calls travel | **A small pinned file**, `design-verdicts.json`, generated from the ADR 0148 snapshots | Stacking #349 on `claude/artifact-pull` and its unmerged base (about 6 MB of snapshot HTML; #349 could not merge before both) |
| What a call does | **Reported beside the page, never gating** | Failing a `rework` page whose flag is on: it would partly decide F1 |
| Where sentences come from | **The page's own source, held by a CI guard** | Also reporting drift against the artifacts' wording: measured at most 1 match per page (0 on 12 of 18), so the report would be almost all noise |

**Measured before building** (2026-09-16, clean worktree at `origin/main` `60ed83a7` merged in):
- **The manifest had rotted in five days.** Of its page sentences, 9 no longer rendered from
  their page. Four existed only in source comments, three had been rewritten, one
  (`nothing yet today`) belonged to `/documents-reports` rather than the dashboard, and one
  (`empty registers`) named the exact behaviour a test forbids. The shared denied phrase
  `you don't have access` renders nowhere. `/logs` had been enrolled 2026-09-12 with no
  entry. `/logs` would also have read as a failed read on **every** run, because its intro
  says *"A register that could not be read is named."* This is a new `static_text` field.
  Nothing had noticed, because the walk reads a missing sentence as a quiet page.
- **Public doors.** Of the nine public routes ADR 0133 names, only `/login` and `/register`
  read `VITE_MUDAVYM_PUBLIC` on main. `/authorize/:integrationId` is `ProtectedRoute`-wrapped,
  not public. `/ask` has no route on any ref.
- **The gateway exposes no house slug** (`getBranchesForUser` selects id, name, city,
  chain), so the audit's suggested "assert `sim-%` via `/organizations/branches`" was not
  buildable as written. Production's four `sim-*` houses were read-only-selected and
  committed by id.

**Built:**
- **Manifest v1.1.0** holds 20 `pages`, each with a `source` directory; `static_text`;
  11 `public_pages`; 7 `pending_pages`; and `signed_out_redirects`. The stale sentences
  were replaced with the pages' current ones.
- **`scripts/check_nightly_manifest.py`** runs in CI (`decision-claims`), with a
  `--self-test` of 10 cases, each asserting the named finding. It holds the manifest
  equal to `MUDAVYM_PAGES`, each sentence to its page's source outside comments,
  testids, the public-switch claim per file, and pending pages not yet enrolled. Run
  against the 2026-09-11 manifest it reports 8 mismatches (6 of the 9 dead
  sentences, `/logs` missing, the dead denied phrase). It cannot see the other three,
  because `nothing here` also renders from a shared component. That limit is stated in
  its docstring.
- **Fix-list item 3 (finding 1.3):** `sim-houses.json` plus `checkSimHouse`. The id must be
  on the list AND the gateway must name the branch `Sim …`. Otherwise the result is
  `cannot_check`. It is checked in the precondition and again at the start of each walk.
- **Fix-list item 5:** `ReadOnlyGuard` aborts every non-GET request except the token
  refresh and the flag read, and lists what it aborted.
- **Fix-list item 6:** the workflow header's "values are never printed" was **not true of
  the two target URLs**. The summary prints them unmasked. The sentence now says so, and
  says why that is acceptable (the web bundle carries the gateway URL).
- **Fix-list item 7:** Wave G was retired by ADR 0137, so `ADR-0135-f` is rewritten as
  resolved-by-deletion.
- **The walk:** `pending.<slug>`, a signed-out `public` test (as built, switch forced on,
  forced off; honest dead-link sentences; the redirect), and the founder's calls joined
  into a separate summary table. `extract_design_verdicts.py` pins 17 pages and 2 sets
  from four snapshots, with 0 unmapped.
- **ADR 0137 applied** to this branch's workflow: waves D, E and G are gone, and the Toast
  and Gmail secrets are unmapped.

**Verified 2026-09-16:** `tsc --strict` exits 0 over the four nightly files (a
deliberate type error exits 2, so the check is real). Web ESLint is clean, with no
file ignored. The guard passes, and its self-test passes all 10 cases.
`extract_design_verdicts.py --check` returns 0 against `origin/claude/artifact-pull`
and 2 with no snapshots. `check_decision_claims.sh` passes. The **signed-out walk ran
against production** (`https://mudavym.com`, system Chrome, no account): 11 pass,
9 absent, 0 fail, 0 cannot_check. The switch reads OFF as built. The three dead links
were said in words. 48 Sentry envelope POSTs were aborted. The suite without account
secrets records 6 `cannot_check` and nothing else.

**First full production run (2026-09-17)**, requested by the founder ("complete e2e and
review, make it ready for merge"). It ran from a laptop, not from CI: system Chrome, the
Sim Bistro owner's credentials from `.env.sim`, and the gateway host the production bundle
calls. The workflow's steps ran in order into one results directory and were merged by
`nightly_summary.py`:
- **Browser walk: 100 pass · 2 fail · 20 absent · 0 cannot_check.** All 20 flags read
  OFF for the house, the house check passed, and auth pacing peaked at 4 per 60 s.
- **Wave H: 10 passed. Backtests: canned day, pinned forecast and the scenario engine,
  all exit 0.**
- **Merged: 134 pass · 2 fail · 21 absent · 4 cannot_check.** The 4 are the preflight and
  waves A–C: `RAILWAY_ORCHESTRATOR_URL` was unset locally. In CI, the secret still
  names the dead host until F2 is actioned.
- **The two fails are production defects the pages named in words. Measured directly:**
  - `/communications`: `GET /reports/schedules` → 500 *"Could not find the table
    'public.scheduled_reports'"*. This is the 2026-09-11 finding, still live.
  - `/profile`: `GET /communications/text-senders` → 200 with `myConsent.reason`
    *"invalid input syntax for type uuid: \"undefined\""*. `JwtStrategy` returns
    `userId`, but `text-senders.controller.ts` reads `user.id` in 11 places, consent
    writes included. `providers.controller.ts` and
    `provider-intelligence.controller.ts` declare the same shape. Filed as its own task,
    not fixed on this PR; CLAIMS `TD-2026-09-17-TEXT-SENDERS-USER-ID` is `open`.
- **The read-only guard earned its place:** the legacy walk aborted a real
  `PATCH /users/:id/preferences` that the legacy app sends just from being viewed. Ids in
  the aborted list are now folded to `:id`, because the first run printed a person's uuid.
- **A suite defect the run exposed, fixed:** `nightly_summary.py` still expected
  `wave_d/e/g.xml`, so every nightly would have ended `cannot_check` (exit 2) forever
  after ADR 0137. It now expects A–C only.
- **CodeQL (high, `py/bad-tag-filter`)** flagged the extractor's regex HTML filtering. It
  now reads the board with `html.parser`, and the regenerated file is byte-identical.

**Still not verified:** CI has never run the signed-in walk, because the account secrets
are unset. Waves A–C have not run. The in-CI PR Audit Gate cannot run (the CI Anthropic key
is out of credit, `CANNOT CHECK [no-credit]`).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-11 | — | Created; measured locally as above; awaits the founder's secrets for the first production verdict |
| 2026-09-11 | pr-audit-gate (3 Opus auditor angles) | **BLOCK** — security angle (trace-file credential leak on a public repo); correctness and compliance both APPROVE WITH NOTES; adversarial pass skipped per step 6. See "Audit result" above and the full report. |
| 2026-09-16 | Founder (six calls in session) + this session | Rebuilt on the PR: new pages, public doors, pending routes, design calls, the manifest guard, fix-list items 3, 5, 6 and 7. The 2026-09-12 "merged" line was corrected. Audit gate not re-run. |
| 2026-09-17 | This session, on the founder's "complete e2e and review" | First full pipeline run against production (from a laptop). It found 2 live product defects and a suite defect (the summary expected the retired waves D/E/G), and CodeQL's high alert on the extractor. The suite defect and the alert are fixed; the product defects are filed. |
