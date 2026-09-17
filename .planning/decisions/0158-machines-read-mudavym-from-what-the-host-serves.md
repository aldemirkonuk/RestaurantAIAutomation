# 0158 — Machines read mudavym.com from what the host serves

- **Status:** Locked 2026-09-17. The founder answered the three policy forks in session (table below) and delegated the mechanism: *"choose and justify a scalable mechanism in an ADR"*. Built on `feat/seo-geo-surface`.
- **Date:** 2026-09-17
- **Decider:** Aldemir (founder) — the policy answers; the SEO/GEO session — the mechanism, under that delegation
- **Keywords:** seo, geo, robots.txt, sitemap, llms.txt, served head, canonical, noindex, soft 404, vendor catalogue, JSON-LD, routing middleware, vercel.json, crawl census, AI crawlers
- **Links:** [[0133-a-public-page-has-no-house-so-the-public-door-has-one-switch]], [[0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms]], [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]] (uncommitted in `wt-finish` when this was written), [[0039]] (pricing and landing visuals held), [[0047-am-interlock-supersedes-rivet-m]] (the mark), `.planning/01-org/commercial/growth/teams/technical-seo-ai-answer-surface/`, [[app-shell-support]], [[vendor-public-page]]

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
6. Security headers for mudavym.com go in `apps/web/vercel.json`, not the repo root.

## Known limits, found by two adversarial passes and left as stated

A dedicated adversarial pass (two lenses: platform/crawler correctness, and
security/privacy/scale/collision) tried to kill this design after it was built, per CLAUDE.md
§3. It confirmed the fixes above against production evidence and found one real bug, which is
fixed; the rest are named here rather than silently accepted.

- **`/v/:slug` 500'd on every request when this PR's preview deployment first went live, found
  and fixed.** `middleware.ts` imported `./src/lib/seo/vendor-edge` with no extension —
  correct under `tsc`'s "bundler" resolution and under Vite, both of which resolve an
  extensionless specifier to the sibling `.ts` file, so `tsc`, `vitest`, `eslint` and
  `vite build` all passed locally and gave no signal. Vercel's Node.js middleware runtime does
  not bundle the file; it runs it through Node's own ESM loader, which never appends
  extensions the way `require` does, and every request failed with
  `Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '/var/task/apps/web/src/lib/seo/vendor-edge'` (`vercel logs`). Fixed: every relative import
  reachable from `middleware.ts` now carries an explicit `.js` extension (`middleware.ts`,
  `vendor-edge.ts`, `vendor.ts`, `head.ts`) — valid under `"moduleResolution": "bundler"`,
  which resolves a `.js` specifier to the sibling `.ts` file. `middleware-imports.test.ts`
  walks the graph and fails by name if a future edit drops one; proven against the exact
  regression before being kept. Re-verified live on the fixed deployment (see the PR thread):
  `/`, `/login`, the real 404, and `/v/:slug` all now correct. This is the one gap the local
  test suite structurally cannot see — nothing in this repo runs Node.js middleware the way
  Vercel does — which is also why "verified locally" was never treated as equivalent to
  "verified on the platform" for this build (§9/S10 of the ADR).
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
