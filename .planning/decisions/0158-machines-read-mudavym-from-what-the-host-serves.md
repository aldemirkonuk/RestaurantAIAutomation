# 0158 — Machines read mudavym.com from what the host serves

- **Status:** Locked 2026-09-17. The founder answered the three policy forks in session (table below) and delegated the mechanism: *"choose and justify a scalable mechanism in an ADR"*. Built on `feat/seo-geo-surface`.
- **Date:** 2026-09-17
- **Decider:** Aldemir (founder) — the policy answers; the SEO/GEO session — the mechanism, under that delegation
- **Keywords:** seo, geo, robots.txt, sitemap, llms.txt, served head, canonical, noindex, soft 404, vendor catalogue, JSON-LD, routing middleware, vercel.json, crawl census, AI crawlers
- **Links:** [[0133-a-public-page-has-no-house-so-the-public-door-has-one-switch]], [[0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms]], [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]] (uncommitted in `wt-finish` when this was written, merged to main as #384 by the time this ADR merged), [[0039]] (pricing and landing visuals held), [[0047-am-interlock-supersedes-rivet-m]] (the mark), `.planning/01-org/commercial/growth/teams/technical-seo-ai-answer-surface/`, [[app-shell-support]], [[vendor-public-page]]

## Context

The founder asked on 2026-09-16 for a crawl and answer surface built from the Growth
division's own team plans, not a template: *"robots.txt must be unique, use already created
teams to build upon geo, seo and the projectile it will go."* The Technical SEO & AI-answer
team (G4) already owned the brief: the strategic target is ranking inside AI assistants'
answers, `robots.txt` is an allow-list, markup emits no claim rather than a weak one, never
`AggregateRating`/`Review`/`LocalBusiness`, a title must be in the SERVED HTML, and a 404 is
accepted only as a status code observed in production
(`technical-seo-ai-answer-surface-charter.md:27-55`, `-directive.md:70-100`).

**Measured before any change (2026-09-16/17, `curl` against production):**

| Probe | Result |
|---|---|
| `/robots.txt`, `/sitemap.xml`, `/llms.txt` | 200 `text/html`, the 1870-byte SPA shell |
| six paths that exist nowhere | 200 shell: `seo.soft_404_rate` = 100% |
| served `<head>` on every path | one title, no canonical, no Open Graph, no robots, no JSON-LD |
| `restaurant-ai-automation-web.vercel.app` | 200, same build, no `X-Robots-Tag` (indexable duplicate) |
| `restaurant-ai-automation-api-gatewa.vercel.app` | 200, a second SPA build from the repo-root `vercel.json`, no `X-Robots-Tag` |
| `/v/:slug` | the same shell; its JSON-LD is injected after mount |

**Three facts the prior research spec had wrong, found by this build's research and
re-measured through the Vercel API:** mudavym.com's project has Root Directory `apps/web`
and framework preset Vite, so `apps/web/vercel.json` is the live config and the repo-root
`vercel.json` configures only the second project; Routing Middleware for mudavym.com must
therefore be `apps/web/middleware.ts`; and Vercel's route order is redirects, headers,
middleware, filesystem, rewrites, error, so `/` is served from `dist/index.html` before any
rewrite could give it a head.

**The AI half, stated plainly:** the major AI crawlers do not run JavaScript (Vercel's
network measurement; Anthropic's own web-fetch documentation). For an answer engine, a page
whose facts appear only after the bundle runs does not exist.

## Founder answers (2026-09-17, AskUserQuestion, all the recommended option)

| Fork | Answer |
|---|---|
| Which AI crawlers may read public pages | **Split by purpose.** Search engines and answer engines that cite a link read every public page, vendor catalogues included. Training-only crawlers read Mudavym's own public pages but never a vendor's catalogue: those price lists are the vendors' to license. |
| How far the old host's redirect reaches | **Pages 308, `/api` keeps working.** Every page path on `restaurant-ai-automation-web.vercel.app` 308s to `https://mudavym.com` with path and query; `/api/*` keeps proxying (noindex), because calendar feed URLs were built from `window.location.origin` and a webhook sender may not follow a redirect. Checked first, as asked: sign-in cannot break, since Google and Microsoft sign-in POST a token to the Railway gateway (`AuthContext.tsx:684,709`) and Railway sets no `*_CALLBACK_URL`. |
| The sentence machines quote | **"Restaurant back-office software for beverage inventory, purchasing, and checking vendor invoices against what was delivered."** Every clause is built; no price, no customer count, no "AI-powered". |

Standing decisions this builds on, not re-opened: mudavym.com apex is canonical (www already
308s); stranger home is `/login` (ADR 0143); public doors keep the ratified treatment and
`support@mudavym.com` (ADR 0149); no price anywhere and landing visuals held (ADR 0039).

## Options considered (the mechanism)

1. **Build-time heads for the fixed public routes, Routing Middleware for `/v/:slug` only, an
   explicit SPA rewrite list with a real `404.html`** — no framework change; static routes
   cost nothing at request time; the one database-backed page pays one invocation; the
   deploy that ships the shell ships every head, so no asset-hash skew. **Chosen.**
2. **Middleware on every navigation** — same route list to maintain, plus an invocation on
   every signed-in page view (Hobby plan: 1M invocations). Rejected.
3. **The Railway gateway renders `/v/:slug` HTML** — it would have to fetch the web shell
   across services, and hashed asset names skew between a web deploy and a cached shell.
   Rejected.
4. **Move public pages to an SSR framework** — disproportionate for four static pages and
   one dynamic one; revisit when the publishing target (the teams' GRO-4) exists.
5. **User-agent sniffing, "dynamic rendering" for bots** — Google calls it a workaround,
   bot tokens rot, and two HTML versions drift. Everything here serves one response to
   people and machines. Rejected.
6. **A prerender SaaS** — a new processor of every request, which the privacy page would
   have to disclose. Rejected.
7. **`vercel.ts` generating the rewrite list from `App.tsx` at build** — elegant, but a
   project may have only one of `vercel.json`/`vercel.ts`, the main session is also editing
   that file, and a static file plus a test that names the drift is simpler to review.
   Rejected for now.

And the policy mechanics, each chosen against measured crawler behaviour (Sources):

- **Allow-list vs deny-list robots.txt** — allow-list, the team's rule: a deny-list must name
  every private path and becomes a map of the app.
- **Anchored `Allow: /login$` vs prefix `Allow: /login`** — prefix. Python's `robotparser`
  never matches a `$` rule, so anchoring closed the page for that parser; no other route
  shares those prefixes (a test enforces it). Only `/$` stays anchored, because the root has
  no unanchored form; a parser that drops `$` then reads the whole site as open and fetches
  closed shells, which costs crawl, not privacy.
- **Non-canonical hosts: `Disallow` vs `noindex`** — `noindex` with crawling allowed. A
  disallowed URL is never fetched, so its noindex is never seen and it can still be listed
  bare. Disallow plus noindex together (the spec's plan) defeats itself.
- **Link previews** — Slack does not honour robots.txt at all and Meta's fetcher may bypass
  it, so what a shared link can show is decided by the served head. Invite and token pages
  serve the closed default head, which names no house.

## Decision

**mudavym.com tells machines only what the host serves, generated from one registry, closed
by default.**

1. **One registry** — `apps/web/src/lib/seo/routes.ts` lists the public pages (`/`, `/login`,
   `/register`, `/privacy`), the crawlable prefixes and who may read each (`everyone`,
   `answer`, `render`), and the token routes. Every crawl artefact derives from it.
2. **Closed by default** — `apps/web/index.html` carries one marked head block with
   `noindex, nofollow`. The build keeps that shell for every signed-in route
   (`dist/crawl/app.html`) and writes each public route's own head from the registry: title,
   description, `index, follow`, self canonical, Open Graph (`og:title` without the brand,
   `og:site_name` Mudavym, the square mark, `twitter:card=summary`). `dist/index.html` gets
   the root head plus the only JSON-LD graph (Organization, WebSite, SoftwareApplication
   with no offers or rating). A route nobody registers can never become indexable.
3. **Built, not hand-written** — a Vite plugin (`vite-plugin.ts`, registered in
   `vite.config.ts`) writes after the bundle: the heads, `404.html`, the `/v/` template,
   both robots files, `sitemap-pages.xml`, `llms.txt`. It refuses to run on its own output.
4. **robots.txt, company-specific** — served on mudavym.com only (host-conditioned rewrite);
   every other host gets a file that allows crawling so its `X-Robots-Tag: noindex` is seen.
   Groups: search engines + answer engines + link previews read public pages, `/v/`, the
   bundle and icons; training crawlers (GPTBot, ClaudeBot, Google-Extended,
   Applebot-Extended, CCBot, meta-externalagent) and every unnamed crawler read Mudavym's
   own pages and `llms.txt` only. `Disallow: /assets/*.map$` for the readers that get the
   bundle. The comments are the company's own words and claim only built behaviour.
5. **Sitemaps** — `/sitemap.xml` is a sitemap index served by the gateway
   (`GET /api/v1/seo/sitemap.xml`) through a host-conditioned Vercel rewrite; it always lists
   `sitemap-pages.xml` and one `sitemap-vendors-N.xml` per started block of 1,000 published
   catalogues (under PostgREST's default row cap; 50,000 files per index). A block past the
   end is 404, never an empty `urlset`; a failed read is 503, never an index with the
   vendors missing. Responses carry `s-maxage=3600` for Vercel's CDN.
6. **`lastmod` that is true** — migration `20260917020000` adds the standard
   `update_updated_at_column` trigger to both catalogue tables and a trigger that bumps a
   page when one of its listings changes.
7. **`/v/:slug` served to machines** — `apps/web/middleware.ts` (matcher `/v/:slug`, Node
   runtime) fetches the build's template from the same deployment and the gateway's
   `GET /api/v1/seo/vendors/:slug/head`, then answers: 200 with head, JSON-LD and a plain
   body of the page's facts; 404 closed for anything not published (the app still boots and
   says so); 503 + `Retry-After` when the gateway is slow or failing (never a noindex-200,
   which a crawler would obey); 308 from mixed case to the lowercase URL. The template
   loader refuses redirects and slot-less HTML, so a protected preview's sign-in page is
   never used; there the host carries on as before. Head results are cached per instance
   for 60 s; vendor text is escaped for HTML and for JSON-LD.
8. **The catalogue claims only what the vendor said** (`apps/api-gateway/src/seo/vendor-head.ts`):
   availability only when `in_stock` is a boolean; `countryOfOrigin` only from `country`, as
   a `Country`; a pack price carries `includesObject` with the pack size; `eligibleQuantity`
   only from minimum order; vintage as a `PropertyValue`; canonical computed; the vendor is
   publisher and seller, Mudavym only the site it is part of. `GET /vendor-portal/:slug/jsonld`
   now returns the same document and no longer takes a caller-supplied `?url=`.
9. **A real 404** — the SPA catch-all rewrite is replaced by one rewrite listing the first path
   segments of `App.tsx`'s routes; anything else falls to `404.html` with status 404 (the app
   still boots from it). `crawl-surface.test.ts` fails by name when a route is added to or
   removed from `App.tsx` without the list.
10. **Hosts** — the old production alias 308s every page path to mudavym.com and keeps `/api`;
    every host that is not mudavym.com answers `X-Robots-Tag: noindex`; the second Vercel
    project (repo-root `vercel.json`) is noindex everywhere and serves the closed shell.
    Token routes (`/reset-password`, `/verify-email`, `/invite/*`, `/studio/invite/*`) carry
    `noindex, nofollow` and `Referrer-Policy: no-referrer`. The gateway sets
    `X-Robots-Tag: noindex` on every response except the sitemap XML.
11. **`llms.txt`** in the llmstxt.org v2 shape, with the honesty note the team asked for; no
    `llms-full.txt` (no team document asks for it and there is no long-form content).
12. **Measurement is machine-facing only** — `scripts/crawl_surface_census.py` probes a
    deployment the way a crawler does and prints `seo.soft_404_rate` and
    `seo.title_in_source_pct`; exit 2 when it cannot reach the site. No visitor, referrer or
    UTM hook and no third-party tracker: nothing to disclose on the privacy page, and the
    conversion-funnel team's own preconditions (a coupling guard, a no-cookie answer) are
    unmet.

## Not built, and why (named, not skipped)

- **`/privacy` body for non-JS readers.** Feasible (measured: `renderToString` under
  `MemoryRouter` works for both the current and the Codex page), but the page is being
  replaced at cutover and the ratified copy drops sentences the current one has. It lands
  with the cutover, from whichever `Privacy.tsx` ships.
- **Search Console and Bing Webmaster.** Founder keystrokes: a `google-site-verification` TXT
  already exists on mudavym.com (Workspace pattern; which account is unknown); add a Domain
  property, submit `https://mudavym.com/sitemap.xml`, then import into Bing. No verification
  file is shipped because DNS verification needs none.
- **IndexNow.** Helps Bing-family engines only and would fire on publish events that have no
  writer yet (`vendor-portal.md` §7: no code creates a catalogue).
- **A 1200x630 share card.** New landing art, held by ADR 0039. Previews render the 512 px
  mark small; accepted.
- **DuckDuckBot.** DuckDuckGo names a parser that ignores `Allow` lines, which reads any
  allow-list as closed. Its results mostly come from Bing's index; accepted and stated in the
  file's header.
- **URL-only listings of private routes.** Signed-in and token routes are disallowed (the
  founder's brief: noindex "plus robots rules"), so a crawler cannot see their noindex; if
  such a URL is ever linked publicly it can appear bare, with no content. Accepted: the shell
  carries no house data.
- **Rich results for catalogues.** Google's product rich results cover single-product and
  buyable pages; a vendor list is neither. Markup is validated for correctness, not for a
  result.

## Integration at cutover (for the main finish session, ADR 0149)

1. Mount `<RouteHead />` (`apps/web/src/lib/seo/RouteHead.tsx`) once inside the router in
   `App.tsx`, and call `useDocumentTitle(pageNameFor(...))` from the house header. Pages never
   set `document.title` themselves.
2. Delete the client JSON-LD injection and the `document.title` effect in `VendorPortal.tsx`
   (both the current and the Codex version): the served head now carries both, and a second
   `ItemList` after render contradicts the first.
3. Delete `VendorPortalService.buildJsonLd` when adopting the Codex service change; nothing
   calls it after this build.
4. When a route is added or removed in `App.tsx`, edit the `/(...)(/.*)?` rewrite in
   `apps/web/vercel.json`; `crawl-surface.test.ts` names the segment.
5. When `/privacy` or `/login` copy changes, change its registry entry in `routes.ts`.
6. Security headers for mudavym.com go in `apps/web/vercel.json`, not the repo root. A site-wide
   `Referrer-Policy` rule must not match the token routes: give its `source` the UNNAMED lookahead
   form `/((?!reset-password|verify-email|invite/|studio/invite/).*)` (the named form
   `/:path((?!...).*)` is valid on Vercel, but the guard cannot read a `:name` parameter and throws),
   or leave that key out of it. A site-wide `X-Robots-Tag` rule may reach the token routes only
   off `mudavym.com`, as the existing missing-host `noindex` rule does; on `mudavym.com` the token
   rule's value is the only one allowed. `crawl-surface.test.ts` checks ten token paths (each with
   and without a trailing slash, plus a nested path under the two exact routes) against every
   header rule of `apps/web/vercel.json` on three hosts, wherever the rule sits; what it does not see is listed under "Known limits",
   overlapping header rules.

## Known limits, found by two adversarial passes and left as stated

A dedicated adversarial pass (two lenses: platform/crawler correctness, and
security/privacy/scale/collision) tried to kill this design after it was built, per CLAUDE.md
§3. It confirmed the fixes above against production evidence and found one real bug, which is
fixed; the rest are named here rather than silently accepted.

- **`/v/:slug` never actually ran on Vercel — two independent bugs, both found by curling this
  PR's own preview deployment before merge, neither visible to any local check.**
  1. `middleware.ts` imported `./src/lib/seo/vendor-edge` with no extension — correct under
     `tsc`'s "bundler" resolution and under Vite, both of which resolve an extensionless
     specifier to the sibling `.ts` file, so `tsc`, `vitest`, `eslint` and `vite build` all
     passed locally. Vercel's Node.js middleware runtime does not bundle the file; it runs it
     through Node's own ESM loader, which never appends extensions the way `require` does, and
     every request 500'd with `Error [ERR_MODULE_NOT_FOUND]: Cannot find module
     '/var/task/apps/web/src/lib/seo/vendor-edge'` (`vercel logs <deployment> --expand`).
     Fixed: every relative import reachable from `middleware.ts` now carries an explicit `.js`
     extension (`middleware.ts`, `vendor-edge.ts`, `vendor.ts`, `head.ts`) — valid under
     `"moduleResolution": "bundler"`, which resolves a `.js` specifier to the sibling `.ts`
     file. `middleware-imports.test.ts` walks the graph and fails by name if a future edit
     drops one; proven against the exact regression (reverted it, watched the test fail,
     restored it) before being kept.
  2. With that fixed, `/v/:slug` **still** never reached the middleware — every slug served an
     identical, CDN-cached copy of the closed default shell (same `etag` for different slugs,
     `x-vercel-cache: HIT`), meaning the request fell straight through to the plain SPA
     rewrite. `vercel inspect --logs` on the exact deployment showed why: `middleware.ts(21,24):
     error TS2580: Cannot find name 'process'` — `apps/web` is a browser project with no
     `@types/node` anywhere in it, and Vercel type-checks `middleware.ts` in an isolated
     context that does not see the rest of the monorepo's dependency tree the way this
     worktree's own `tsc` (following symlinked, hoisted `node_modules`) happens to. The build
     still reported "completed successfully" and the deploy still went green — the middleware
     was just silently dropped, no build error surfaced anywhere CI or a human would see it.
     Fixed with a local `declare const process: { env: ... }` in `middleware.ts` — no new
     dependency, nothing the rest of the app inherits.

  Both were caught, and both fixes verified, entirely locally and pre-merge with **`vercel
  build`**, which reproduces Vercel's own build (including its middleware type-check) without
  a deploy: it reproduced each bug's exact error message, confirmed clean after each fix, and
  showed `middleware.func` present in `.vercel/output` — absent before either fix — with `.js`
  paths in its compiled tree matching the fixed source. The compiled `middleware.js` was then
  executed directly in Node with a synthetic `Request` to confirm it runs without throwing.
  This is the one class of gap `tsc`/`vitest`/`vite build` structurally cannot see — nothing
  else in this repo runs Node.js middleware the way Vercel does, which is why "verified
  locally" was never treated as equivalent to "verified on the platform" for this build
  (§9/S10), and why `vercel build` is now the check that closes that gap for any future
  `middleware.ts` change (see [[vercel-node-middleware-needs-js-extensions]]).

  **What curling the live preview after both fixes actually showed, precisely stated:**
  `/`, `/login` and a real 404 all serve correctly. `/v/:slug` for a fresh slug returned 200
  with the closed app shell rather than the middleware's own 404/200 response — at first read
  this looked like a third bug, until a raw `curl` (no CLI bypass) to *any* path on that same
  preview host, including `/`, showed the identical SSO redirect: this project's Deployment
  Protection walls every request to a preview hostname, and a middleware's own same-origin
  `fetch()` for its template is indistinguishable, at the edge, from an external request. This
  is exactly the case `vendor-edge.ts`'s design already names and defends against ("a protected
  preview answers the self-fetch with a sign-in redirect" → `loadTemplate`'s marker check
  rejects the SSO HTML → `continueRequest()`) — confirmed by `vercel env ls` showing no
  `VERCEL_AUTOMATION_BYPASS_SECRET` configured for this project, so there is no credential this
  code could have used to see through the wall even if it tried. **What this build's own
  fallback path proves on a live, protected deployment: correct, safe behaviour under exactly
  the platform condition it was written for.** It does not, and structurally cannot, exercise
  `/v/:slug`'s 200/404/503 branches against a real gateway on THIS preview; those are proven by
  `vendor-edge.test.ts`'s mocked-dependency cases plus the Node execution above. mudavym.com
  itself carries no Deployment Protection (measured, §2.1), so production is where those
  branches get their first live exercise — the "After merging" census step is not a formality
  here, it is the only place those branches can be observed running for real.
- **robots.txt disallowed the very sitemap it advertised — found only by the dedicated
  adversarial pass, after three independent Opus audits (correctness, compliance, security)
  each returned APPROVE WITH NOTES without catching it.** `CRAWL_PREFIXES` (`routes.ts`) had no
  entry for `/sitemap*`, so `rulesFor()` emitted an `Allow:` line for every registry route and
  crawl prefix, then closed every group with `Disallow: /` — and the `Sitemap:` directive
  named a file none of those `Allow:` lines covered. Proven with the repo's own RFC 9309
  matcher against the built file: `allowed(group.rules, '/sitemap.xml')` was `false` for
  **every** group, search-and-answer engines included. Since `/v/:slug` catalogues have no
  inbound link from any allowed page (`PUBLIC_ROUTES` is only `/`, `/login`, `/register`,
  `/privacy`), the sitemap was their only discovery path — so the crawl surface this ADR
  exists to build would have been undiscoverable the moment a search engine actually obeyed
  the file. Three things let it through: `seo.test.ts`'s original test asserted the
  `Sitemap:` **line exists** as a string, never that it is fetchable; `crawl_surface_census.py`
  fetched `/sitemap.xml` directly and never consulted the robots.txt it had just validated;
  and the `ADR-0158-TRAINING-CRAWLERS-NEVER-GET-VENDOR-CATALOGUES` CLAIMS row asserted "may
  fetch" and was certified `resolved` by a `grep` for string presence. All three are the
  `absence-reported-as-health` shape, in the one artifact this build exists to make honest.
  Fixed: three `CRAWL_PREFIXES` entries (`routes.ts`) — the pages file open to every reader (it
  names nothing a reader could not already fetch directly, since `PUBLIC_ROUTES` is
  unconditional across groups); the vendor file `answer`-only, matching the founder's
  split-by-purpose rule for the catalogues it lists. The index is open to every reader too, for
  a narrower reason found by the fix's own re-audit: `Sitemap:` is a single directive with no
  per-group form, so it cannot itself be gated by reader — and the built index's own content
  names the vendor file's URL, which a training crawler is then told about without being able
  to fetch. Costed at zero today (the index lists sitemap filenames, not vendor slugs), and
  named here rather than in the code comment's original, inaccurate claim that the index "names
  nothing a reader could not already fetch directly" — it does, just not anything sensitive. A
  new `seo.test.ts` case asserts
  every group can fetch the sitemap files it should be able to, reverted-and-restored against
  the exact regression before being kept. `crawl_surface_census.py` gained
  `check_robots_permits_sitemap`, which reads the first (most permissive) group and asserts an
  `Allow:` line covers the sitemap the file names — itself caught one bug on the way in (a
  naive `str.startswith` after stripping `$` treated the anchored root rule `Allow: /$` as
  matching every path, since `/`.startswith itself matches everything; fixed to exact-match an
  anchored pattern and prefix-match an unanchored one, then re-proven against both the buggy
  and fixed robots.txt as fixtures before being kept).
- **A FIFO-not-LRU cache bug, found and fixed.** `headLoader`'s per-instance cache (S6a) only
  re-inserted an entry on a miss, so eviction removed the oldest-inserted catalogue rather than
  the least-recently-viewed one — a crawl walking many slugs could evict a hot catalogue while
  cold ones it touched once stayed cached. Fixed: a cache hit now re-inserts too
  (`vendor-edge.ts`), proven by a test that walks a fill-then-hit-then-overflow sequence.
- **Google Fonts are still requested on every newly-indexable page.** `apps/web/index.html`'s
  font `<link>` tags are unchanged by this build — self-hosting them is explicitly another
  session's task (ADR 0149 row 7), and out of this lane's scope. This is not a regression this
  build introduces (every page already made that request); it does mean the pages this build
  marks `index, follow` still carry it until that work lands. Tracked:
  `CLAIMS.jsonl` `ADR-0158-FONTS-NOT-YET-SELF-HOSTED` (`status: open`; flips to `resolved`,
  i.e. the build must re-verify it, once `index.html` stops referencing
  `fonts.googleapis.com`).
- **`VendorPortal.tsx` still injects its own client-side JSON-LD and title on mount**, which for
  a JavaScript-rendering crawler overwrites the served (correct) head with the old one (wrong
  stock/country, an em dash). This is not a new regression either — that page already did this
  before this build — but this build is what makes `/v/` crawlable and sitemap-listed, so the
  coexistence window is now live rather than moot. Deleting the injection is named in
  "Integration at cutover" item 2 above and owned by the ADR 0149 cutover, not this PR; flagged
  to that session directly. Tracked: `ADR-0158-VENDORPORTAL-CLIENT-INJECTION-REMOVED`
  (`status: open`).
- **Query-string preservation on the old-host redirect is proven for Vercel's domain-level
  `www`→apex redirect, not yet for this project-level path-capture rule specifically, and it
  cannot be proven pre-merge.** The rule's `has` condition matches the literal hostname
  `restaurant-ai-automation-web.vercel.app`, which is production's alias, not this PR's preview
  deployment (previews get their own `*.vercel.app` subdomain) — so there is no way to address
  a request at this exact rule before the code that defines it is live. The highest-consequence
  case is a mailed `?token=` link. **First-thing-after-merge check, not a precondition of it:**
  `curl -sI 'https://restaurant-ai-automation-web.vercel.app/reset-password?token=x'` must show
  `location: https://mudavym.com/reset-password?token=x`; `scripts/crawl_surface_census.py
  --old-host` checks the same thing. What the preview deployment *can* prove pre-merge, because
  these rules are not host-conditioned to the alias: the host-agnostic pieces (`/v/:slug`,
  the four per-route heads, the real 404) and the rules conditioned on "not mudavym.com" (the
  preview's own hostname satisfies that "missing" test) — noindex headers and the closed
  robots.txt. Verified on this PR's own preview deployment before merge; see the PR thread.
- **robots.txt is cached by a compliant crawler for up to 24 hours** (RFC 9309 §3.7) after the
  file itself changes — a change here is not seen everywhere at once, and that lag should not
  be mistaken for a bug the day after this ships.
- **The vendor head route's rate limit (600/min) is still one bucket per caller identity, not
  per slug** (`rate-limit.guard.ts`'s key is IP + route template): a burst against many
  catalogues from one address counts against all of them together. Accepted for now because the
  caller is Vercel's own middleware, a small and stable set of egress addresses, and the fixed
  LRU cache means a repeat view of the same catalogue rarely re-hits the gateway at all; revisit
  the key shape if a shared-fate 503 is ever observed in production.
- **Overlapping header rules: Vercel's winner is undocumented, so no rule may disagree.**
  (Added 2026-09-21, after the merge.) The first guard for the token routes found the rule that
  carries `Referrer-Policy` and checked that one. A site-wide rule appended after it passed the
  test while, if the later rule wins, the token routes would send its policy instead of
  `no-referrer`. Measured by mutating `apps/web/vercel.json`: appending such a rule, one setting
  `X-Robots-Tag: all`, or one conditioned on a cookie passed the old test and fails the new one;
  a rule whose source leaves the token routes out, and an unrelated `X-Content-Type-Options` rule,
  still pass. Vercel's `vercel.json` page says nothing about two matching rules setting one key
  (fetched 2026-09-21), so the guard does not lean on order. What production sends was not
  measured under a conflicting rule, which needs a deployment carrying one: the census's
  `token-route` lines read it from whichever deployment they are pointed at, and a repeated header
  field is read as one joined value, so a second `Referrer-Policy` cannot hide behind the first.
  A typical `strict-origin-when-cross-origin` is far milder than `no-referrer` (it sends only the
  origin across sites); the rule is `no-referrer` because this ADR chose it, not because the
  common alternative leaks a token.
  What the guard and the census read, and do not (named by the gate's reviewers on #417, then
  closed or narrowed by the follow-up, 2026-09-21):
    - **Hosts.** The guard evaluates `mudavym.com`, the retired alias and one preview-shaped host.
      A rule gated on any other host throws ("not in HOSTS") instead of being skipped; add the
      host to `HOSTS` to have the rule evaluated.
    - **Sources.** Rules are read as JavaScript regular expressions, anchored and case-sensitive.
      `@vercel/routing-utils@6.6.0` compiles a source with
      `pathToRegexp(source, keys, { strict: true, sensitive: true, delimiter: "/" })`
      (`dist/superstatic.js:266-271`; `path-to-regexp@6.1.0` produces the result, `6.3.0` is
      compiled alongside it and only logged when it differs), so those two options make the reading faithful for the plain group syntax this repo uses:
      matching is case-sensitive (measured: `/Reset-Password` answers 404 without the token
      headers) and strict (no optional trailing delimiter). A `:name` parameter, a `{...}` group
      (`/{(.*)}` compiles to `^/(.*)$`, while a plain RegExp reads the braces literally), a
      cookie, query, regular-expression or string-valued host condition, and a host outside
      `HOSTS` all throw. A bare `*` and a trailing `/?` after a literal are not valid
      path-to-regexp (`Unexpected MODIFIER`), so they cannot be deployed. One difference remains
      and errs stricter: a literal `.` outside a group is a literal dot to Vercel and any
      character to the guard.
    - **Trailing slash (fixed in the source).** `/reset-password/`, `/reset-password/?token=x`
      and `/verify-email/` answered 200 on production with neither `Referrer-Policy` nor
      `X-Robots-Tag` (measured 2026-09-21; the HTML `noindex, nofollow` meta was present and the
      app's emails link the slashless form, `auth.service.ts:980` and `:2145`). The token rule's
      source, from #385, had no optional trailing slash and Vercel matches strictly. The optional
      slash now sits inside the capture group; the guard and the census probe each token path
      with and without a trailing slash, and the resolved CLAIMS row
      `ADR-0158-TOKEN-ROUTES-MATCH-TRAILING-SLASH` checks the source. Before the change the census
      failed on exactly the four unmatched samples (measured), so the deployed answer is read by
      its `token-route` lines. Not checked: whether the gateway's access logs record the `Referer`
      header, which would show whether a token link that gained a trailing slash was ever logged;
      the browser default `strict-origin-when-cross-origin` sends the full URL on same-origin
      requests, and on this host `/api/*` is one.
    - **`X-Robots-Tag` off the canonical host.** On the retired alias and the preview-shaped
      host the guard requires `noindex` in every value and `nofollow` in at least one; only
      `mudavym.com` is held to exactly `noindex, nofollow`. A rule adding `noindex, follow`
      on another host passes, which is low risk because those hosts are already `noindex`.
    - **What the census reads.** The base host only, not `--duplicate-host`. `X-Robots-Tag` is
      exact (`noindex` and `nofollow`, nothing else) when the base is `mudavym.com` and a
      superset elsewhere, where a second rule adds its own `noindex`. `--self-test` drives the
      check through a local server over 12 answers in both modes, and the resolved CLAIMS row
      `ADR-0158-TOKEN-ROUTES-ARE-CHECKED-LIVE` runs it, so a gutted predicate or a last-wins
      header dict fails the build. Nothing in CI probes production: the claims job runs only the
      offline `--self-test`.
    - **The second Vercel project.** The repo-root `vercel.json` (the api-gateway duplicate,
      `restaurant-ai-automation-api-gatewa.vercel.app`) answers the token routes with the
      site-wide `X-Robots-Tag: noindex` only and no `Referrer-Policy` (measured 2026-09-21),
      which item 10's unconditional wording does not reflect. Another session's PR #418
      (ADR 0185) adds a token rule to that file; until it lands and is read here, neither the
      guard (it evaluates `apps/web/vercel.json` only) nor the census (base host only) covers it.
- **The ADR number.** `scripts/check_adr_numbers_unique.py` reports the next free number as
  0150, not 0158, because it sweeps git refs and cannot see an uncommitted file in another
  worktree: ADR 0149 is unpushed in `/Users/aldemirkonuk/Projects/wt-finish` (the main finish
  session). A manual sweep of every worktree the guard cannot reach
  (`git worktree list`, then `ls .planning/decisions/` in each) found 0140–0149 and 0158 claimed
  and 0150–0157 free at the time of writing; 0158 was kept rather than moved down, to put
  distance between this number and the low numbers every session's guard call will suggest
  next. Re-checked immediately before commit, per CLAUDE.md §5b.

## Consequences

- Every public page and every published catalogue is readable with JavaScript off, by one
  URL, with a true status. Answer engines can cite the catalogue; training crawlers are asked
  not to take it.
- A missing page is a 404 at the host for the first time; a wrong route list is a failing
  test, not a silent 200.
- A new public page is three edits (registry entry, rewrite, copy review) instead of zero; that
  friction is the point of an allow-list.
- Each `/v/` view costs one middleware invocation and, at most once a minute per catalogue per
  instance, one gateway read. Revisit when catalogue traffic is real: move the render behind
  a cached function.
- Revisit when the publishing target (GRO-4) is decided: one `Allow:` line per content prefix,
  `sitemap-content.xml` in the index, a `## Guides` section in `llms.txt`, `Article` markup with
  a named author. Nothing for that is pre-built.

## Sources

Fetched 2026-09-17 by the research workflow (reports in the session scratchpad, summarised
here): RFC 9309; Google Search Central (robots.txt, common crawlers incl. Google-Extended,
JavaScript SEO basics, canonicalisation, robots meta and X-Robots-Tag, sitemaps and large
sitemaps, Organization, site names, software app, product snippet and merchant listing);
OpenAI, Anthropic, Perplexity, Apple, DuckDuckGo, Common Crawl and Meta crawler pages; Slack's
robots statement; Bing Webmaster blog on lastmod and verification; indexnow.org; llmstxt.org
(v2, 2026-08-10); ogp.me; Apple TN3156; schema.org V30.1; Vercel docs (routing middleware,
vercel.json routing and has/missing, external rewrite caching, deployment protection) and the
Vercel API for this team's two projects. Parser behaviour measured locally: Python 3.11
`urllib.robotparser`, Perl `WWW::RobotRules` 6.03.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-17 | Founder | Three policy forks answered (table above) |
| 2026-09-17 | Research workflow `wf_ac349d93-063` | 4 finders (Vercel mechanics, crawler standards, team docs, repo mechanics) against the BUILT tree; 2 adversaries (platform/crawler correctness; security/privacy/scale/collision) against the built tree, each re-running the full test suite live rather than trusting a prior report. One real bug found and fixed (the FIFO/LRU cache); the rest are named in "Known limits" above rather than silently accepted |
| 2026-09-17 | `pr-audit-gate` skill, PR #385 | 3 parallel Opus auditor angles (correctness, CLAUDE.md/ADR compliance, security/blast-radius), each APPROVE WITH NOTES — findings applied: the `ADR_SEO` placeholder, a `CLAIMS.jsonl` UTF-8 re-encode, this ADR's own stale cross-references, a missing `decisions/README.md` row, and the PR description's inaccurate "additive" claim. A mandatory adversarial pass over all three reports then found and OVERTURNED the consensus: robots.txt disallowed its own advertised sitemap (see "Known limits"). Fixed and guarded (a test proven against the exact regression; a census check proven against both the buggy and fixed file as fixtures, catching a bug in the check itself along the way) |
| 2026-09-21 | Self-review after the merge (session 83e90bf2), ahead of the site-wide security-headers block | The token-route guard was order-blind, and the census had no token-route check. Made the guard order-agnostic and added a live `token-route` census check; both mutation-tested (7 `vercel.json` mutations against old and new guard, 10 census fixtures, a parity mutation, a claim mutation). Production census at `79dfea023`: 28 PASS, 0 FAIL |
| 2026-09-21 | `pr-audit-gate` skill, PR #417, first head `17a5a3ca8` | Opus planner PLAN: READY; two Sonnet reviewers (correctness and compliance; security and adversarial) APPROVE WITH NOTES; the resumed Opus planner **OVERTURNED**: the sentences the PR had written (cutover item 6 and the `resolved` CLAIMS row) said the guard fails on any disagreeing rule, true only for slashless token paths on three hosts. Both reviewers reproduced a live trailing-slash gap (`/reset-password/` answers with neither header; the HTML `noindex` meta is present). Wording narrowed, the limits recorded under "Known limits", the CLAIMS row's greps hardened against three mutations, and the gap tracked by an `open` CLAIMS row; the code follow-up is a separate PR |
