# End-to-end tests — how they work

This folder holds two suites. They share Playwright and nothing else, so never
read one's result as the other's.

| Lane | Files | Runs | Target |
|---|---|---|---|
| **Local smoke** | `auth.setup.ts`, `navigation.spec.ts`, `retired-routes.spec.ts`, `smoke.spec.ts`, `studio-flow.spec.ts` under `../playwright.config.ts` | CI job `test-e2e` (`.github/workflows/ci.yml`) on every push | A dev server CI starts, with mocked auth (`auth.setup.ts`) |
| **Nightly production** | `nightly/` under `../playwright.nightly.config.ts` | `.github/workflows/e2e-prod.yml`: cron 02:00 UTC, or started by hand | The deployed app (`https://mudavym.com`) and its gateway, as a real account |

The rest of this page is about the nightly. Its decision record is
[ADR 0135](../../../.planning/decisions/0135-the-nightly-reports-four-states-and-walks-the-gated-pages.md),
rebuilt 2026-09-16.

---

## 1. What one nightly run does

```mermaid
flowchart TD
  S[Secrets precondition<br/>missing name = exit 2] --> P[Orchestrator preflight<br/>GET /health]
  P --> H[Wave H — gateway contracts<br/>read-only pytest]
  H --> F[Wave F — browser walk<br/>nightly/nightly.spec.ts]
  F --> L{Orchestrator answered?}
  L -- yes --> ABC[Legacy waves A, B, C]
  L -- no --> CC[A, B, C recorded cannot_check]
  ABC --> B[Backtests — pinned canned day + forecast]
  CC --> B
  B --> SUM[scripts/e2e/nightly_summary.py<br/>one table, four states]
  SUM --> ART[Job summary + 30-day artifact]
```

Waves D, E and G no longer exist. They were retired on 2026-09-12 because they
tested tables production does not have
([ADR 0137](../../../.planning/decisions/0137-legacy-e2e-waves-d-e-g-are-retired-not-repointed.md)).

## 2. The four states

Every check ends in exactly one of these. The summary counts each one separately.

| State | Meaning | Colour of the run |
|---|---|---|
| `pass` | The assertion held | green |
| `fail` | The assertion ran and did not hold: a production signal | red (exit 1) |
| `absent` | The surface is not on this build, or the house has nothing to open it on | Reported. Never counted as a pass. |
| `cannot_check` | The check did not run: missing secret, refused house, unreachable service, empty corpus | red on purpose (exit 2) |

A page that prints its own "could not be read" sentence gets two records. The
page's honesty passes (it said so in words). The read fails (something behind
it broke). The walk never asserts on a figure.

## 3. What the browser walk opens

`nightly/nightly.spec.ts` runs these tests in order, on one worker:

| Test | Record ids | What it checks |
|---|---|---|
| precondition | `precondition.*` | Secrets are set. The account signs in through `/auth/login`, is verified, has a house, and that house is a **simulator house** (§5). |
| sign-in | `signin.ui` | The real two-step login form signs the account in. |
| flags | `flag.<slug>`, `flags.tally` | Reads each page's `mudavym_design_*` flag for the house. With `expect_flags=report` (the default) it reports without gating. |
| walk, override on | `page.<slug>.next`, `.reads`, `.provenance`, `pending.<slug>`, `walk.next.readonly` | Opens every page in `manifest.pages` with the Mudavym design forced on, then every `pending_pages` route. |
| walk, flag off | `page.<slug>.legacy`, `walk.legacy.readonly` | Opens every page with legacy forced, or with a second simulator house's real flags if `E2E_LEGACY_RESTAURANT_ID` is set. |
| public | `public.switch`, `public.<slug>.on/off`, `.honest`, `public.redirect.*` | Opens the signed-out doors three ways: as built, with ADR 0133's one switch forced on, and forced off. |

### The pages, as of 2026-09-16

- **20 gated pages** (`manifest.pages`). These are exactly `MUDAVYM_PAGES` in
  `apps/web/src/lib/mudavym/useMudavymDesign.ts`, including `/logs`, the first page of
  the new-pages wave.
- **11 signed-out doors** (`manifest.public_pages`). On main, only `/login` and
  `/register` read the public switch (`VITE_MUDAVYM_PUBLIC`, overridden per
  browser by `localStorage["mudavym.design.public"]`). The other nine report
  `absent` until they are rebuilt. `/reset-password`, `/invite/:code` and
  `/v/:slug` are opened with a harmless invalid value and must say so in words.
- **7 pending routes** (`manifest.pending_pages`): `/promotions`,
  `/vendor-prices`, `/recommendations/catalog`, `/help`, `/admin`,
  `/admin/health` and `/ask`. They are held by ADR 0143's open forks and ADR
  0145. The walk measures that no Mudavym root renders on each one; it does not
  take the manifest's word for it.
- `/authorize/:integrationId` must send a signed-out visitor to `/login`.

**First full run against production** (2026-09-17, from a laptop as the Sim
Bistro owner, not yet from CI): **100 pass · 2 fail · 20 absent · 0
cannot_check.** All 20 flags read OFF for the house. The public switch reads OFF
as built. Absent means: two parameter routes, because the house holds no order
and no document; 7 pending routes; 9 public doors not rebuilt; and the legacy
pass of the two parameter routes. Both failures are real production reads that
the pages reported in words:

| Page | What the page said | Measured cause |
|---|---|---|
| `/communications` | "Saved schedules could not be loaded" | `GET /reports/schedules` → 500: `public.scheduled_reports` does not exist in production. First seen 2026-09-11, still live. |
| `/profile` | "Your own agreement could not be read" | `GET /communications/text-senders` returns `myConsent.reason` "invalid input syntax for type uuid: \"undefined\"". `text-senders.controller.ts` reads `user.id`, but the JWT user carries `userId`. |

## 4. The files

| File | Role | Edit by hand? |
|---|---|---|
| `nightly/manifest.json` | Pages, routes, flags and each page's own sentences | Yes. The guard checks it (§6). |
| `nightly/lib.ts` | Session, pacing, classification, sim-house check, `ReadOnlyGuard` | Yes |
| `nightly/nightly.spec.ts` | The tests in §3 | Yes |
| `nightly/honest-reporter.ts` | Writes `test-results/nightly/nightly-summary.{json,md}` and `shots/` | Yes |
| `nightly/sim-houses.json` | The only houses the walk may open | Only after re-measuring (§5) |
| `nightly/design-verdicts.json` | The founder's recorded design calls | **No.** Generated (§7). |
| `../playwright.nightly.config.ts` | One worker, traces off, screenshots on failure | Yes |
| `../../../scripts/e2e/nightly_summary.py` | Merges every wave into one verdict and exit code | Yes |
| `../../../scripts/check_nightly_manifest.py` | CI guard for the manifest | Yes |
| `../../../scripts/e2e/extract_design_verdicts.py` | Generates `design-verdicts.json` | Yes |

## 5. Safety rails, and why each exists

- **Only simulator houses.** The walk screenshots every page into a public
  30-day artifact. Before any page opens, it checks the house id against
  `sim-houses.json` and checks that the gateway's branch list names the house
  `Sim …`. Any other answer is `cannot_check` (audit of PR #349, finding 1.3).
  The gateway returns no slug, so the id list is committed. To add a house,
  re-measure with a read-only `restaurants?select=id,slug,name&slug=like.sim-*`.
  Never add one by name.
- **Writes are aborted, not just avoided.** `ReadOnlyGuard` routes every browser
  request. GET, HEAD and OPTIONS pass. So do two read-shaped POSTs: the token
  refresh and the flag read. Everything else is aborted and listed in
  `walk.*.readonly` / `public.*.readonly`. Ids in the list are folded to
  `:id`. In the first production run it aborted Sentry envelopes and one real
  write: the legacy app's `PATCH /users/:id/preferences`, sent just from
  viewing pages.
- **No traces.** A Playwright trace is a full network capture. A failed run's
  trace once carried the test password and live JWTs (audit finding 1.1).
  Traces stay `off`. Screenshots carry no headers or bodies.
- **Target URLs are guarded.** The workflow refuses a local `E2E_BASE_URL`, and
  refuses an `API_GATEWAY_URL` that is local or not `https`.
- **Legacy teardown is opt-in.** `tests/e2e/conftest_prod.py` deletes `sim-*`
  houses only when `E2E_SIM_TEARDOWN=1`. The workflow never sets it.
- **Auth pacing.** `/api/v1/auth/*` allows 10 requests per 60 s per IP and route.
  The walk boots the app once per pass, navigates with `pushState`, and
  `AuthBudget` waits whenever a route nears the limit.

## 6. Adding or changing a page

1. Enrol the page in `MUDAVYM_PAGES` and register its flag, as usual.
2. Add an entry to `manifest.pages`:
   `slug`, `flag` (`mudavym_design_<slug>`), `route`, `legacy` (`page`, `same`
   or `redirect:/x`), `source` (the page's own directory), and the page's own
   sentences: `empty`, `failed_read`, optional `provenance` and `*_testids`.
   A route with a parameter needs `needs` (a list endpoint to take an id from).
3. Copy each sentence from the page's source as **one run of text**. If the page
   always renders a sentence containing a shared phrase (logs' intro says
   "could not be read"), put that sentence in `static_text`. It is removed
   before matching.
4. If the page was listed in `pending_pages`, remove it from there.
5. Run `python3 scripts/check_nightly_manifest.py`.

The guard runs in CI (job `decision-claims`) and fails, naming the entry, when:

- `manifest.pages` and `MUDAVYM_PAGES` differ, in either direction;
- a flag is misnamed or unregistered;
- a sentence renders from no non-test file in the page's `source` directory or
  the shared Mudavym components (a sentence that exists only in a comment also
  counts as missing);
- a testid is gone;
- a public page's `switch` does not match whether its file reads the switch;
- a pending page has enrolled.

**What the guard cannot see:** a generic sentence that a shared component also
renders (for example "nothing here"), and a sentence split by JSX. Prefer
sentences that belong to one state of one page.

## 7. The founder's recorded design calls

`design-verdicts.json` pins, per page, the call the founder recorded in the
claude.ai artifacts: Wave Four's keep/rework verdicts, the Build Board's
label and state, and The Arrival's per-direction calls. It is generated from the
ADR 0148 snapshots. It copies only the call, date and document version, never the
note text. The walk prints these calls in a separate table beside each page's
walked state. **They never pass or fail anything** (founder's call, 2026-09-16).

The snapshots are not on main yet; they are on `claude/artifact-pull`. To
regenerate:

```bash
python3 scripts/e2e/extract_design_verdicts.py --ref origin/claude/artifact-pull --write
```

```bash
python3 scripts/e2e/extract_design_verdicts.py --ref origin/claude/artifact-pull --check
```

`--check` exits 0 when the file matches, 1 on drift, and 2 when a snapshot is
missing. CLAIMS row `ADR-0135-h` fails CI on the day the snapshots reach main.
That is the prompt to wire `--check` into CI without `--ref`.

## 8. Running it

**In production (the real run).** Actions → *Production E2E Tests* → Run
workflow. Inputs: `expect_flags` (`report`/`on`/`off`), `base_url`, `api_url`.
Required secrets: `API_GATEWAY_URL`, `E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD`. The
header of `e2e-prod.yml` lists every optional secret and what its absence
costs.

**Locally, signed-out doors only.** This needs no account and no gateway. It
uses system Chrome, so nothing is downloaded. Add a throwaway config beside
`playwright.nightly.config.ts` that sets `projects[0].use.channel = 'chrome'`,
then from `apps/web`:

```bash
env -u CI E2E_BASE_URL=https://mudavym.com E2E_API_URL=https://unused.invalid E2E_TEST_EMAIL=unused@example.invalid E2E_TEST_PASSWORD=unused npx playwright test --config <your throwaway config> --grep "public:"
```

**Locally, the full walk against production** (how the 2026-09-17 run was made).
Use the same throwaway config, and pass the simulator-owner credentials from
the root `.env.sim` as `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD`. Set
`E2E_API_URL=https://wineopsapi-gateway-production.up.railway.app` (the host the
production bundle calls) and `E2E_BASE_URL=https://mudavym.com`. It takes about
3 minutes. The house must be on `sim-houses.json`, or every walk is refused.

**Locally, against a local gateway** (proven 2026-09-11). Run a gateway on `:4010`, and
point `apps/web/.env.local` at it with `VITE_API_GATEWAY_URL`. Start Vite on
`127.0.0.1:5276`. Load simulator-owner credentials, then run the config with
`E2E_BASE_URL=http://127.0.0.1:5276 E2E_API_URL=http://localhost:4010`. Add
`--grep-invert sign-in` while iterating: the form test uses up the
`/auth/sign-in-methods` budget (10 requests per 10 minutes).

Results land in `apps/web/test-results/nightly/`: `nightly-summary.md`,
`nightly-summary.json` and `shots/`.

## 9. Open, and not yet proven

- **CI has never run the signed-in walk.** It has run once from a laptop
  (§3). The workflow's `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` secrets are not
  set. On 2026-09-11 `aldemirkonuk@mudavym.com` was not in `public.users` (not
  re-measured since). Setting the secrets to an account that belongs to a house
  on `sim-houses.json` is the founder's step.
- **Two production reads fail today** (§3's table). Both are product defects
  the walk reports, not suite defects.
- **Founder forks still open (ADR 0135):** F1, whether to gate on flags being
  ON; F5, flipping the sims. **Answered but not yet actioned:** F2, retargeting
  the `RAILWAY_ORCHESTRATOR_URL` secret to the live orchestrator host (a
  repository-settings change for the founder); F3, a second simulator house
  for the legacy pass (`E2E_LEGACY_RESTAURANT_ID`, now constrained to
  `sim-houses.json`).
- The design-call snapshots live on an unmerged branch (§7).
