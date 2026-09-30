# 0219 — A merge to main reaches mudavym.com, and we can prove it did

- **Status:** Locked 2026-09-22 — the founder ruled on both forks in session (verbatim
  below): Vercel Pro now, the Railway move as a later job, and the provenance-guard option
  labelled "Yes, add it (Recommended)". Number from the guard
  (`scripts/check_adr_numbers_unique.py --audit`: 1114 refs when written, 1121 at the first
  last call, 1120 at the second, `0219` free each time) plus a sweep of every
  `git worktree list` checkout and every remote ref (only this branch's worktree holds a
  `0219-*` file).
- **Date:** 2026-09-22 (incident and research: 2026-09-21 US Eastern / 2026-09-22 UTC —
  the research read its sources 2026-09-22 02:50-03:20Z; founder ruling: 2026-09-22)
- **Decider:** Aldemir (founder). Decisions are locked by the founder, never by an agent.
- **Keywords:** vercel, hobby, pro, railway, cloudflare, deployment-quota,
  api-deployments-free-per-day, provenance, stale-production, web-host, build-provenance,
  check_web_deployed_sha
- **Links:** [[0097-the-gateway-says-which-build-it-is]] (bracket-corrected in place — its
  "Vercel is unverified" line names the gap this ADR closes),
  [[0133-a-public-page-has-no-house-so-the-public-door-has-one-switch]],
  [[0158-machines-read-mudavym-from-what-the-host-serves]],
  [[0185-mudavym-com-sends-its-security-headers]], OD-120, PRs #418 #421 #424

## Context

On 2026-09-21 the Vercel team `aldemirkonuks-projects` (then on the Hobby plan) hit
`api-deployments-free-per-day` twice. The production pushes for #421 (17:22:41Z) and
#424 (21:17:35Z) were refused and never retried. At 2026-09-22T03:06:58Z,
`vercel inspect https://mudavym.com` still showed #418's deployment
(`dpl_GgrpEoSfZ2D6JUSS1zPDd8pVXxrG`, created 16:53:16Z) while `origin/main`'s tip was
already two merges ahead. Four measured facts drove the refusal (full citations and raw
data in the session's research; the load-bearing ones are repeated below rather than
referenced only by a path that will not ship with the repo):

- The cap (100/day, [vercel.com/docs/limits](https://vercel.com/docs/limits),
  last_updated 2026-09-16) is `owner`-scoped: one pool for the whole team, shared by six
  Vercel projects.
- The repo is connected to two Vercel projects. The second,
  `restaurant-ai-automation-api-gateway`, builds a duplicate, `noindex` copy of the SPA
  that serves nothing (ADR 0158's duplicate-host census). Over the 30 days measured
  (GitHub Deployments API, 2026-08-22..09-21) it produced **475 of the 1,417** Vercel
  deployment records, against **942** for the real web project. Left to the founder:
  **Vercel dashboard → `restaurant-ai-automation-api-gateway` → Settings → Git →
  Disconnect.** Not done by this session — it is a dashboard click, not a git change.
- The project that serves mudavym.com has no Ignored Build Step
  (`apps/web/vercel.json` — confirmed via `git show origin/main:apps/web/vercel.json`,
  no `ignoreCommand`/`git` key; and `vercel ls restaurant-ai-automation-web` listed zero
  cancelled or skipped entries among its 40 deployments of 2026-09-19..22, so every push
  to every branch built). A build the Ignored Build Step would cancel still counts
  toward the quota regardless
  ([project-settings](https://vercel.com/docs/project-configuration/project-settings),
  last_updated 2026-09-16).
- Vercel does not expose the meter. GitHub-recorded counts at the two refusals were 87–98
  in the preceding 24h; measured sliding-24h counts on other days reached 176. The
  GitHub Deployments API is a proxy for Vercel's own accounting, not the accounting
  itself — headroom on Hobby could not be predicted from anything readable.

Nothing noticed the stale build. `.github/workflows/deploy.yml`'s Stage 3 was written to
check the web only for HTTP 200 (`curl … "${VERCEL_PRODUCTION_URL%/}/"`), which the STALE
previous build answers perfectly, and with its secret unset it did not run at all (see
Decision); and `git grep` for `VERCEL_GIT_COMMIT_SHA`/`VITE_(GIT|COMMIT|BUILD)`
under `apps/web` found **zero hits**. [[0097-the-gateway-says-which-build-it-is]] already
named this gap in its own "What this does NOT fix" section: *"Vercel is unverified."*

Separately, Vercel's Hobby plan is *"restricted to non-commercial personal use only"*
([fair-use](https://vercel.com/docs/limits/fair-use-guidelines), last_updated
2026-09-14), and its first worked example is *"Any method of requesting or processing
payment from visitors of the site"*. Mudavym takes payments through Stripe
(`apps/web/src/components/mudavym/stripe-js.ts`,
`apps/api-gateway/src/billing/stripe.client.ts`), so Hobby was already the wrong plan
independent of the outage.

## Options considered

1. **Stay on Hobby, fix the cap with configuration.** Disconnect the duplicate project;
   add `"git": {"deploymentEnabled": {"**": false, "main": true}}` to
   `apps/web/vercel.json` (any matching `true` wins —
   [git-configuration](https://vercel.com/docs/project-configuration/git-configuration)).
   Cost: $0, about an hour. Rejected as the standing answer: the meter still cannot be
   seen; whether a skipped push counts toward the quota is undocumented; and it does not
   touch the compliance problem — Hobby forbids commercial use regardless of
   configuration. Still worth doing on any plan (it removes 475 of 1,417 deployment
   records at zero cost); left for the founder alongside the project disconnect above.
2. **Vercel Pro.** $20/month platform fee including $20 of usage credit
   ([pro-plan](https://vercel.com/docs/plans/pro-plan), last_updated 2026-09-15); paid
   builds meter at $0.0035/CPU-minute on Elastic machines by default
   ([managing-builds](https://vercel.com/docs/builds/managing-builds), last_updated
   2026-09-17) — estimated $8–13/month of build spend at measured volume, inside the
   credit. Headroom over measured all-time peaks: 10x per 5 minutes (12 vs 120), 8.6x per
   hour (52 vs 450), 34x per day (176 vs 6,000) — see
   [limits](https://vercel.com/docs/limits). Fixes the compliance problem outright. Effort:
   minutes, if the team is offered an in-place upgrade (the docs hedge: *"if your team is
   eligible for an upgrade"* — [Hobby § Upgrading](https://vercel.com/docs/plans/hobby) —
   not confirmed by this session; billing was not touched). Chosen — see Decision.
3. **Move the web to Railway ("Railway all").** Estimated ~$3–5/month on top of the
   current Railway bill (published rates:
   [pricing/plans](https://docs.railway.com/pricing/plans)). Railway's terms permit
   *"internal, personal, and/or business use"*
   ([railway.com/legal/terms](https://railway.com/legal/terms), effective 2026-04-20),
   with no Hobby non-commercial clause. Estimated 2–4 focused days of porting (full list
   in "The Railway move" below). Removes the quota cause entirely (no published
   deployment-count cap) and fixes compliance, at the cost of days of engineering and a
   DNS cutover. Named as the next job, not started now — see Decision.
4. **Cloudflare Pages (or Netlify).** $0 on free, but the free plan caps at **500
   builds/month** ([pages/platform/limits](https://developers.cloudflare.com/pages/platform/limits/),
   last updated 2026-09-05) against **942** web builds measured in 30 days — the same
   failure shape unless previews are turned off entirely
   ([branch-build-controls](https://developers.cloudflare.com/pages/configuration/branch-build-controls/)).
   Similar porting cost to Railway, plus a new vendor, plus a soft-404-by-default that
   breaks [[0158-machines-read-mudavym-from-what-the-host-serves]]'s
   `ADR-0158-NO-SOFT-404-AT-THE-HOST` claim unless a `404.html` is shipped
   ([serving-pages](https://developers.cloudflare.com/pages/configuration/serving-pages/)).
   Rejected: it does not remove the cap cause on free, and it adds a vendor with no
   advantage over Railway (which the founder had already named).
5. **Do nothing.** The next high-traffic day (fleet branch activity, not just production)
   freezes production again, silently, exactly as it did twice on 2026-09-21. Rejected.

### The adversary's kills, condensed (full table: this session's research)

A dedicated adversarial pass tried to kill option 2 and the alternatives before either
was recommended (CLAUDE.md §3 — never anchor on the first answer). What survived:

| Attack | Target | Verdict |
|---|---|---|
| "Pro doesn't stop a merge from never deploying." | Pro | **Holds against every option.** `deploy.yml`'s web step would have passed any HTTP 200 (and was being skipped); a real failed CLI build was found the same night (below). Pro is a bridge only WITH the provenance guard — the recommendation below requires both. |
| "Pro isn't $20 flat: builds are metered on paid teams." | Pro | **Wounds, doesn't kill.** Estimated $8–13/month of build spend, inside the $20 credit at current volume. A spend alert exists by default at $200 ([spend-management](https://vercel.com/docs/spend-management)). |
| "A fleet burst still starves production on Pro." | Pro | **Fails.** 8.6x headroom on the tightest measured axis (hourly). |
| "The upgrade isn't a click: eligibility/trial risk." | Pro | **Open until the founder opens Billing** — not resolved by this session; billing was not touched, per the rule against verifying by claim ([[production-deploy-verification]]: "should work" is not a report — here inverted to "should be eligible" is not a report either). |
| "It breaks the stated budget line." | Pro | **Real.** `PROJECT.md:74` reads "**Deployment budget**: ~$10-20/month (Vercel free + Supabase free + Railway $5-10 + CloudAMQP free + Upstash free)"; Pro alone pushes the stack to roughly $25–40/month. That is the founder's line to move, not a technical kill — and it is the strongest argument for the Railway move. |
| "Hobby is fine if the config is right." | Hobby | **Killed as a standing answer** on the commercial-use clause alone; the meter stays invisible regardless of configuration. |
| "Railway has no CDN or header control." | Railway | **Fails as a kill.** Railway CDN is opt-in and free ([networking/cdn](https://docs.railway.com/networking/cdn)); headers are server config either way. The cost is ownership and porting, not impossibility. |
| "The DNS cutover breaks the live site." | Railway | **Wounds, only if done naively.** HSTS is 2 years with `includeSubDomains` ([[0185-mudavym-com-sends-its-security-headers]]), so a certificate gap during cutover is a hard failure with no click-through for returning browsers. Survives with the Cloudflare proxy on (edge certificate live from second one) and a dark launch — see "The Railway move" below. |
| "Just `vercel deploy --prod` by hand when it happens again." | any | **Killed outright.** A CLI deployment (`prxuaoij0`, 19:12:51Z the same night) failed: `Could not resolve "./pages/logs/next/LogsNext"` — the repo-root `.vercelignore:29` bare `logs` pruned a tracked page from the upload (anchored to `/logs` by #428, `f80754129`, which merged after this research; the research first blamed `apps/web/.gitignore:2`, but on `main` that line is a comment and the pattern there is already root-scoped `/logs`). A CLI upload sends the local disk, not the git tree, so it can differ from `main` in ways a git deployment cannot. Recovery must be git-based: Vercel dashboard → Deployments → **Create Deployment** by branch/commit ([changelog](https://vercel.com/changelog/manually-create-deployments-by-commit-or-branch-in-the-dashboard)), never a local CLI upload. |

## Decision

**Two separate founder rulings, verbatim, 2026-09-22.**

**(1) Hosting fork.** Offered the options "A now, B later", "A only: Vercel Pro", "B: move
to Railway" and "C: stay free, tune", the founder answered in his own words:

> "I upgraded for this month to vercel pro its active right now tho, I'll move every
> config to railway after all UI deployment is over"

**So:** Vercel Pro is active now — the founder's own action, taken outside this session.
**This session did not verify Vercel billing** (no Vercel API call was made with
credentials, per this task's own operating rule) — the claim that Pro is active rests
entirely on the founder's statement above, not on a `vercel` CLI inspection of the
team's plan. **The web moves to Railway after all UI deployment is over**, as a
separate, later job — named below, explicitly not started by this ADR.

**(2) Provenance-guard fork.** Asked *"may I add a check that fails loudly when
mudavym.com is not serving the latest web commit?"*, the founder chose the option
labelled **"Yes, add it (Recommended)"**. That option's description was written by the
session that asked, not by the founder; it is what he selected, quoted exactly:

> "The build embeds its commit id, and the deploy check fails when it differs from the
> latest web change on main. One small PR, with its own audit."

**Built, this branch:**

- `apps/web/src/lib/build-provenance.ts` — the web build writes
  `<meta name="mudavym:commit" content="…">` into every served page (root `/`,
  `crawl/app.html`, every `crawl/heads/*.html`, `404.html` — they are all cut from one
  shell, so they all carry the same tag). Order: `VERCEL_GIT_COMMIT_SHA`, then
  `RAILWAY_GIT_COMMIT_SHA` (so the Railway move needs no change here), then
  `git rev-parse HEAD` (a local or from-scratch build), then the literal `"unknown"` —
  never an empty string, mirroring `apps/api-gateway/src/health/build-provenance.ts`'s
  own reasoning, restated because a static build has no shared runtime to import it
  from. Verified by a real `vite build`: the tag lands, once, outside the
  `<!-- seo:head:start -->…<!-- seo:head:end -->` block
  [[0158-machines-read-mudavym-from-what-the-host-serves]] owns, in every derived file.
  Re-run at the last call with a fixed `VERCEL_GIT_COMMIT_SHA`: once each in
  `index.html`, `404.html`, `crawl/app.html` and the three `crawl/heads/*.html`, and
  neither the sha nor the variable name appears in any `assets/*.js` file. Re-run at the
  second last call with an unrelated sentinel variable set as well: same six files, and
  the sentinel appears nowhere in `dist/`.
- `apps/web/turbo.json` — declares `VERCEL_GIT_COMMIT_SHA` and `RAILWAY_GIT_COMMIT_SHA` in
  the web build task's `env`. Vercel builds through `turbo run build --filter=@wineops/web`,
  and turbo 1.13.4 leaves an undeclared variable out of the task hash (`turbo --dry=json`:
  the same hash, `0d222538a0bceb42`, for two different commit values). Two commits with
  the same web inputs then share a hash, and the second build is a cache hit that replays
  the first build's `dist/`, tag included, so the page names a commit that is not the one
  deployed. If the cache entry a production build reads was written by the PR's preview
  build, a squash merge would name the PR's head commit, which is not on `main`, and the
  check would read DIVERGENT on an ordinary merge; after a revert it would name a commit
  older than FLOOR and read STALE. Measured with a scratch `--cache-dir`: without this file the second of two real
  builds was `cache hit` and served the first commit's tag; with it, both were
  `cache miss` and each served its own. Whether Vercel's builds reach a turbo cache (its
  Remote Cache, or `node_modules/.cache/turbo` restored from its build cache) was not
  read, since no Vercel API call was made; the file makes the tag correct either way. The
  cost is that the web build task is never a cross-commit cache hit on a host that sets
  these variables; `packages/ui`'s hash is unchanged. CI, which sets neither, hashes as
  before.
- `scripts/check_web_deployed_sha.py` — reads the tag with a plain GET and requires
  `FLOOR ⪯ running ⪯ tip(main)`. FLOOR is the newest commit at or before the merged sha
  that touches a path the web build reads, resolved by `resolve_watched_commit.resolve()`,
  the resolver Stage 2 already uses for the gateway. The comparison is a range, not
  Stage 2's `running == FLOOR`: the Vercel project has no Ignored Build Step, so it
  builds every push, docs-only ones included, and the served commit is usually newer than
  FLOOR. The range still fails when a web-affecting commit is missing, which is the
  criterion of the option the founder selected ("the latest web change on main"); a
  refused or failed build of a push that touched nothing the web reads leaves the page
  unchanged and passes.
  - **Watched paths** (`DEFAULT_PATHS`, the one list deploy.yml uses for both the
    recorded FLOOR and the check): `apps/web`, `packages/ui`, `pnpm-lock.yaml`,
    `pnpm-workspace.yaml`, `package.json`, `turbo.json`, and two gateway files the web
    bundle imports: `apps/web/src/pages/inventory/command/ReceivingWorkspace.tsx`
    imports `apps/api-gateway/src/procurement/price-currency.ts`, which imports
    `apps/api-gateway/src/common/iso-4217.ts` (`turbo.json` lists the same two as
    `globalDependencies`). The first draft of this branch missed both, so a gateway
    commit changing currency rules that never reached mudavym.com would have passed as
    UNCHANGED. `--check-paths` follows every relative import from non-test source under
    `apps/web` and `packages/ui`, transitively, and exits 1 on any reached file the list
    does not cover or any listed path that no longer exists (2 if it scanned nothing).
    Run against the first draft's list, it names exactly those two files; on this tree it
    scans 782 files and passes.
  - **A main that moves during the check.** `tip(main)` is fetched fresh right before
    the poll, and `--refresh-remote origin` fetches main again whenever the served commit
    is not an ancestor of tip, re-classifying before it can read DIVERGENT. Without this,
    a merge that lands (and that Vercel builds, in about 72 s) while an earlier merge's
    audit waits would turn the earlier audit red. A fetched tip is adopted only if it
    descends from the old one, so a commit off main stays DIVERGENT.
  - **States and exits.** Nine states, six exit codes: 0 for MATCH/UNCHANGED/SUPERSEDED,
    then 1 STALE, 2 PAGE_MALFORMED/NETWORK_UNREACHABLE, 3 UNKNOWN_MARKER, 4 DIVERGENT,
    5 CANNOT_RESOLVE (including a git failure mid-poll, which would otherwise surface as
    a traceback's exit 1, STALE's code). Every non-zero exit blocks the same way; the
    numbers are for a human reading the log. A served value that is not 7-40 hex
    characters is PAGE_MALFORMED before it reaches a git argument list.
  - **Self-test.** `--self-test` builds a real throwaway git repo, a clone of it (for a
    real `git fetch`), a synthetic source tree and a real HTTP server, and drives every
    state, STALE and DIVERGENT included. Mutations, each in a scratch copy restored from
    a snapshot (memory `checks-cannot-see-their-own-removal.md`): the builder disabled
    STALE detection and empty-tag detection; the verifier disabled STALE and DIVERGENT
    detection and empty-tag detection; the last call disabled STALE detection, the tip
    refresh, transitive import following, the hex check, the descent check on a fetched
    tip, the missing-path check and the test-file exclusion. The self-test went red,
    naming the disabled behaviour, every time. A second last-call pass then made
    `main()` return 0 for STALE, and the self-test stayed **green**: every case read
    `poll()`'s or `EXIT_FOR`'s value, none the exit code deploy.yml acts on. It now also
    runs the CLI end to end against its HTTP server (MATCH 0, STALE 1, PAGE_MALFORMED 2,
    UNKNOWN_MARKER 3, DIVERGENT 4), and the same mutation turns it red.
- `.github/workflows/deploy.yml` — Stage 3's checkout gained `fetch-depth: 0` (the
  ancestry checks need full history, same requirement Stage 2 already has). The old
  "Production URL smoke (optional)" step was gated `if: env.VERCEL_PRODUCTION_URL != ''`,
  and **that secret is not set on this repository** (`gh secret list`, 2026-09-22), so
  the step concluded `skipped` in all 37 of the last 40 deploy runs that reached Stage 3
  (2026-09-11 to 2026-09-22, the newest for `f80754129` at 2026-09-22T04:10:49Z). In
  that window the web was not checked at all, not even for HTTP 200. The
  new steps read `secrets.VERCEL_PRODUCTION_URL || 'https://mudavym.com'`: the address
  named in the question the founder approved, a public name rather than a secret, which a
  secret can still override. So the check cannot skip itself. The steps: the script's self-test
  and `--check-paths`; FLOOR via `--print-floor`; a fresh fetch of `tip(main)`; and
  "The deployed web build IS the build it should be", which runs the check above with a
  600 s deadline (measured Vercel web builds: median 72 s, max 104 s, 19 READY builds). `deploy-audit.json` gained
  `web_commit_expected`, `web_provenance_verified` and `web_provenance_means`, mirroring
  `gateway_commit`/`provenance_verified`/`provenance_means` — replacing the bare
  `"frontend": "success"` field's implicit HTTP-200 claim with an explicit statement of
  what was actually checked.
- **The live check lives only in `deploy.yml`, which runs on `workflow_run` (CI completed
  on `main`) and `workflow_dispatch` — never on a pull request.** None of `main`'s five
  required contexts comes from `deploy.yml` (branch protection read 2026-09-22: `CI
  Complete` plus four named checks), so a slow or stale production delays or reddens this
  workflow's own run, never a PR's mergeability (memory
  `main-wedges-when-production-falls-behind.md`). What does run on pull requests never
  touches production: the four CLAIMS rows below, including `--check-paths` (reads source
  files) and `--self-test` (a throwaway repo and a localhost server, no outside network).
- **Limit, stated:** Stage 3 still `needs` Stage 2, so when the gateway stage fails the
  web check is skipped. The run is red either way, but the web verdict is then absent,
  not STALE.
- **Limit, stated:** a page with no tag ends the poll at once (PAGE_MALFORMED), where
  STALE keeps waiting. The build that ships this ADR is the first to carry a tag, so if
  Vercel has not finished it by the time Stage 3 polls, that one run goes red early
  instead of waiting for it. Stage 3 starts only after CI on `main` succeeds (472-552 s
  for the 7 successful of the last 8 runs, `gh run list`, 2026-09-22) against a measured
  Vercel build of 33-104 s, so this needs a Vercel queue of several minutes; the error
  names a pre-guard build as the likely cause.

**What carried it:** no hosting option by itself removes "a production merge that never
deploys" — only a provenance check does, because the failure has at least four causes
(the quota, a failed build, a dropped webhook, and silence) and a host change removes
only the first. Pro removes the quota cause in minutes with zero go-live risk and fixes
the compliance breach the same day; Railway removes it too, at the price of days of
porting and a cutover that is safe only behind the Cloudflare proxy. The founder chose
Pro now and Railway on his own timeline — a budget-and-taste call, not a technical
necessity, and explicitly his to make (§0.1).

## The Railway move — named, not started

Per the founder's own words above, this is a **separate, later job**, after all UI
deployment work is over. What it must port, so nobody re-discovers it under time
pressure:

- **A small server for `dist/`.** `apps/web/vercel.json` has no catch-all rewrite
  ([[0158-machines-read-mudavym-from-what-the-host-serves]]'s
  `ADR-0158-NO-SOFT-404-AT-THE-HOST` claim) — an explicit ~50-route allow-list, the
  host-conditioned 308 off the retired alias, the `/api` proxy to the gateway, the
  host-conditioned robots/sitemap rewrites, and 8 header rules including the token-route
  carve-out ([[0185-mudavym-com-sends-its-security-headers]]). Candidates: Caddy
  ([guides/caddy](https://docs.railway.com/guides/caddy)) or one small Node server that
  also runs `apps/web/src/lib/seo/vendor-edge.ts`'s Fetch-API `/v/:slug` handler — the
  latter is arguably simpler off Vercel, since `apps/web/middleware.ts`'s
  `declare const process` workaround for Vercel's edge runtime goes away.
- **The tests and claims that read `apps/web/vercel.json` directly:**
  `apps/web/src/lib/security-headers.test.ts`, `apps/web/src/lib/seo/crawl-surface.test.ts`,
  `scripts/crawl_surface_census.py`, and the CLAIMS.jsonl rows `ADR-0158-NO-SOFT-404-AT-THE-HOST`,
  `-OLD-HOST-308-KEEPS-API`, `-TOKEN-ROUTES-ARE-CHECKED-LIVE` (resolved) and
  `-TOKEN-ROUTES-MATCH-TRAILING-SLASH` (open) — all four need a live target once the
  host changes, or they go quiet, not green.
- **19 `VITE_*` build-time variables**, including the founder's public-vs-signed-in
  switch (`VITE_MUDAVYM_PUBLIC`, [[0133-a-public-page-has-no-house-so-the-public-door-has-one-switch]]).
- **`apps/web/src/lib/build-provenance.ts` already reads `RAILWAY_GIT_COMMIT_SHA`**
  second, for this move, and `apps/web/turbo.json` already puts it in the build task's
  hash. Whether Railway exposes it at *build* time depends on the builder the move picks
  (a Dockerfile build needs an `ARG`); if it does not, the git fallback or the literal
  `"unknown"` is served and the check fails `UNKNOWN_MARKER`, loudly.
- **The watched-path list must match what Railway rebuilds on.** Railway rebuilds a
  service only when a push touches its `watchPatterns`, so the web service's patterns
  must cover `DEFAULT_PATHS` in `scripts/check_web_deployed_sha.py`, or a watched-path
  push that Railway skips reads STALE. The check's secret-or-default URL and the
  `--refresh-remote` step carry over unchanged.
- **The `@wineops/web` Railway service currently answers 502** (memory
  `production-deploy-verification.md`: it runs `pnpm --filter @wineops/web dev`, the Vite
  DEV server, bound to loopback — unreachable by Railway's proxy, structural since at
  least two prior deployments). Diagnose or replace it; it is not today's target service.
- **HSTS risk.** `Strict-Transport-Security: max-age=63072000; includeSubDomains` is
  already live ([[0185-mudavym-com-sends-its-security-headers]]), so any certificate gap
  during cutover is a hard failure with no click-through for a returning browser.
  Railway issues Let's Encrypt certificates "within an hour of your DNS being updated"
  ([domains doc](https://docs.railway.com/networking/domains/working-with-domains)).
  Mitigation: put the Cloudflare proxy in front (the zone is already on Cloudflare —
  `dig` shows Cloudflare nameservers) with SSL/TLS set to **Full**, not Full (Strict) —
  Railway's own doc says Full Strict "will not work as intended" against its origin
  certificate. Cloudflare then serves its own edge certificate from the first second;
  the origin certificate is not validated end-to-end (Full, not Strict). That weakening
  lasts as long as the proxy stays in Full mode, not only during cutover; the move's own
  ADR has to accept or refuse it.
- **DNS risk.** `mudavym.com`/`www` currently resolve `A 76.76.21.21`, **TTL 300s**,
  DNS-only at Cloudflare (no `cf-ray` today). A TXT verification record can be added days
  ahead with zero effect on production. Rollback is one DNS record: put back
  `A 76.76.21.21` DNS-only, keeping Vercel live until the Railway target is verified —
  the low TTL makes this fast in either direction.
- **What breaks and is accepted:** Vercel preview URLs (Railway PR environments are
  opt-in and billed — [preview-deployments](https://docs.railway.com/guides/preview-deployments-with-pr-environments));
  `dev.mudavym.com` (a Vercel CNAME) needs a new home or retirement; single-region origin
  unless Railway's CDN or the Cloudflare proxy is enabled (the gateway runs US West;
  Turkey↔Railway latency is unmeasured).
- **Sequencing, recommended by the research, not ruled by the founder** (his words fix
  only the timing, "after all UI deployment is over"): dark launch on a subdomain, diff
  every route and header against production, cut DNS only after that diff is clean, keep
  Vercel live until verified, then downgrade Vercel
  ([pro-plan § Downgrading](https://vercel.com/docs/plans/pro-plan)).

## Consequences

**Easier:**
- A missed deploy becomes a loud, specific failure (STALE, with the exact commit gap
  named) instead of a stale site nobody notices.
- The fleet's branch and preview traffic no longer spends production's deployment
  budget once the duplicate project is disconnected.
- Hosting stops being in breach of Vercel's Hobby terms.
- The gateway and the web now share the FLOOR resolver (`resolve_watched_commit.py`,
  imported, not copied) and the same served-commit-plus-poll pattern
  (`check_deployed_sha.py` / `check_web_deployed_sha.py`). They differ on purpose in the
  comparison: equality with FLOOR for Railway, a range for Vercel, for the reason given
  under Decision.

**Harder, or given up:**
- Roughly $20/month more while both Pro and Railway budget lines overlap, until the
  Railway move completes and Vercel is downgraded — the founder's own tradeoff, not
  resolved by this ADR.
- Whoever runs the Railway move inherits ownership of hand-written routing and header
  config that Vercel currently provides for free.
- Vercel Pro eligibility for this specific team was never confirmed in-session (Billing
  was not opened); if an in-place upgrade turns out not to be offered, a team migration
  carries its own alias risk and is a materially different job than what is described
  here.

**Recovery rule, any host:** production recovery is git-based — Vercel dashboard →
Deployments → **Create Deployment** from branch `main`. Never a CLI upload from a
checkout: the 2026-09-21 19:12:51Z CLI production build failed because the repo-root
`.vercelignore`'s bare `logs` (line 29 at `9cfc4e96d`) pruned a tracked page from what
the CLI uploaded. #428 (`f80754129`) anchored it; the rule stands, because a CLI upload
sends the local disk rather than the git tree.

**Revisit when:**
- `check_web_deployed_sha.py` fires STALE for a cause other than a quota (a build
  failure, a dropped webhook) — the class the provenance guard exists to catch
  regardless of cause.
- Vercel Pro's monthly bill exceeds $40 (roughly double the estimate above).
- The Railway move's date slips past "all UI deployment is over" without being
  re-scheduled by the founder.
- The duplicate Vercel project is disconnected — at that point
  `ADR-0158-*` duplicate-host claims and this ADR's 475/1,417 figure should be
  re-measured, not assumed stale.

## Claims filed with this ADR

`.planning/decisions/CLAIMS.jsonl` (static: python over source files, no node_modules,
no network, per memory `claims-verify-must-be-static.md`). Each was mutation-tested in a
scratch copy of the files it reads; every mutation below turned it red, and each is red
against `origin/main`:

- `ADR-0219-WEB-BUILD-EMBEDS-COMMIT` (`resolved`) — the plugin returns the tag from
  `transformIndexHtml`, the variable order is Vercel then Railway, the unknown case
  returns `UNKNOWN_COMMIT`, and `buildProvenancePlugin()` sits inside `vite.config.ts`'s
  `plugins` array as an unconditional element, with no `apply:` on the plugin. Mutations:
  plugin dropped from the array with its import kept, variable order swapped, unknown
  case returning `''`, tag content not the resolved commit; and, since the second last
  call, `apply: 'serve'` on the plugin (which would drop the tag from every build) and a
  conditional element (`process.env.CI ? buildProvenancePlugin() : null`), both of which
  the earlier row passed; and `apps/web/turbo.json` deleted, either variable dropped from
  its `env`, its `extends` removed, or the `env` moved to another task.
- `ADR-0219-DEPLOY-YML-RUNS-WEB-PROVENANCE-CHECK` (`resolved`) — `deploy.yml` has no
  `pull_request` trigger; Stage 3 has `fetch-depth: 0` and exactly one polling step, with
  `--refresh-remote origin`, the mudavym.com fallback, no step-level `if:` and no
  `continue-on-error` anywhere in the job; `ci.yml` never polls production with the
  script; the audit summary records the web fields. Mutations: poll step deleted,
  `continue-on-error: true`, `if: false`, a `pull_request` trigger, fallback removed,
  refresh removed, a polling call added to `ci.yml`; and, since the second last call,
  `|| true`, `| tee`, `; exit 0`, a trailing `&`, a `set +e` line and a hard-coded `--url`
  (the row now requires the step's run block to be the one command alone). The first
  draft of this row checked for the script's name anywhere in the job, and stayed green
  with the polling step deleted (the self-test step also names the script) and with
  `continue-on-error: true` on it; the second draft stayed green with `|| true` appended
  to the poll.
- `ADR-0219-WEB-WATCHED-PATHS-COVER-EVERY-IMPORT` (`resolved`) — `--check-paths` exits 0.
  Mutations: `iso-4217.ts` dropped from `DEFAULT_PATHS` (exit 1); the first draft's
  script (exit 2, no such flag).
- `ADR-0219-WEB-PROVENANCE-SELF-TEST-PASSES` (`resolved`, added at the second last call)
  — `--self-test` exits 0 on every pull request, the same shape as ADR 0097's row for
  `check_deployed_sha.py`; before it, the check's own logic was first exercised after a
  merge, in Stage 3. Mutation: `main()` returning 0 for STALE (exit 1); `origin/main`,
  where the script does not exist (exit 2). Measured: 3 s, nothing on stderr.

## What this ADR does not do

- It does not verify Vercel billing (no Vercel API call was made with credentials, per
  this session's own operating constraint) — Pro's active status rests on the founder's
  statement, not a measurement.
- It does not disconnect the duplicate Vercel project or add `git.deploymentEnabled` —
  both are dashboard/config actions left to the founder, named above.
- It does not start the Railway move. It names what that job must port so the move does
  not silently drop the tests, claims and header rules the current Vercel config carries.
- It does not update `.planning/decisions/README.md`'s Locked-decisions index, which was
  already behind this ADR by roughly 20 entries (0163 through 0185 are not indexed
  there) before this branch — a pre-existing gap, not one this ADR introduces or was
  asked to close.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-21 | host research pass (read-only; four independent research files plus a judged synthesis with a dedicated adversarial pass, CLAUDE.md §3) | Draft written, Proposed. |
| 2026-09-22 | Aldemir (founder), in session | Both forks ruled on verbatim (Decision, above). Locked. Build landed this branch: `apps/web/src/lib/build-provenance.ts`, `scripts/check_web_deployed_sha.py`, `.github/workflows/deploy.yml` Stage 3, two CLAIMS rows, ADR 0097 bracket-corrected in place. |
| 2026-09-22 | last-call review (Opus) | Five defects fixed before merge: an unused `eslint-disable` that `pnpm run lint --report-unused-disable-directives` rejects (it would have failed `Lint TypeScript`, so `CI Complete`); the unset `VERCEL_PRODUCTION_URL` secret, which would have failed every deploy run at its first step; two gateway files missing from the watched paths; a frozen `tip(main)` that turned any merge landing mid-audit into DIVERGENT; a CLAIMS row that stayed green with the polling step deleted. Added `--check-paths`, `--print-floor`, `--refresh-remote` and a third CLAIMS row. |
| 2026-09-22 | second last-call review (Opus) | Five more fixed. The largest: turbo left the commit variable out of the web build's cache key, so a cache hit would replay an earlier commit's tag (a squash merge could name its PR head and read DIVERGENT); `apps/web/turbo.json` added, measured both ways. Also: `main()`'s exit code was untested (STALE-as-pass mutation stayed green; end-to-end CLI cases added); the deploy.yml CLAIMS row stayed green with `true` OR-ed onto the poll command (tightened, mutation suite above); the CLI-upload failure was blamed on `apps/web/.gitignore:2`, a comment line on `main` — the cause was `.vercelignore`'s bare `logs`, anchored by #428 after the research ran. `PROJECT.md`'s budget line is now quoted verbatim. The embed CLAIMS row passed `apply: 'serve'` and a conditional plugin entry; it now refuses both. A fourth CLAIMS row runs `--self-test` on every pull request. A new limit is stated (a tag-less page ends the poll at once). |
