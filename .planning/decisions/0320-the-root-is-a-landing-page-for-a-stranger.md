# 0320 — The root is a landing page for a stranger

- **Status:** Proposed (2026-10-09). Built by executor SIM (session a02b515d) under the founder's words quoted in Context; the ruling that the root is a landing page is his ("landing page first", 2026-10-08), the page's content rules are the executor's under the 2026-10-07T20:04:10Z delegation. A lock is his.
- **Date:** 2026-10-09
- **Decider:** founder (the root, the price line, the ADR 0090 bypass, the model); executor SIM (the page's shape, its content rules, the route plumbing)
- **Keywords:** landing page, root route, stranger, RootDoor, sitemap, llms.txt, sample data, motion, reduced motion, ADR 0090 bypass, OD-23
- **Links:** [ADR 0143](0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms.md) ("Where home is for a stranger", superseded for the root by this record); [ADR 0039](0039-activation-plan-of-record.md) (brand/landing visuals hold, lifted for the page only); [ADR 0158](0158-machines-read-mudavym-from-what-the-host-serves.md) (the site graph on the root); [ADR 0169](0169-the-ground-is-white-by-default-and-each-person-chooses.md) (ground tokens); [ADR 0090](0090-pr-audit-gate-autonomous-merge.md) (bypassed for this PR on the founder's word); OD-23 (pricing, still open); `apps/web/src/pages/landing/` (Landing.tsx, RootDoor.tsx, landing.css and their tests); `apps/web/src/App.tsx` (the root route); `apps/web/src/lib/seo/routes.ts` and `llms.ts`; prototype `p4-scratch/mkt-2026-10-08/landing-v3/landing.html`; research `p4-scratch/mkt-2026-10-08/landing-v2/` (persuasion research and teardown, the two stages of workflow `wf_36ff89f2-b3e` that ran before the 2026-10-08 usage limit); memory `founder-answers-2026-10-08-marketing-ux`.

## Context

Until this record `/` was the dashboard behind `ProtectedRoute`, and a stranger who typed `mudavym.com` was sent to `/login` (ADR 0143, "Where home is for a stranger"; the registry comment at `routes.ts:44` said "The house has no landing page"). On 2026-10-07 the founder sent 22 cold emails from his own mailbox naming the domain, so a restaurant person who followed one met a sign-in form.

The founder's words that this record is built on, verbatim:

- 2026-10-08, AskUserQuestion on sketch order: public landing page first, then the app pages. On the public price: "Free for the first houses" (his pick; OD-23 stays open, no tiers, no numbers). Market: "SF Bay Area/ US independents + East Lansing".
- 2026-10-08, on the three static landing drafts A/B/C: "just terrible, no experience delivering"; "use techniques, hooks"; "use motions always with clear intentions"; "use human mind tricks ... psychologically attract them subconsciously, use human behaviour attraction techniques, be a salesman".
- 2026-10-08/09, on building it in the analytics-fix session: "This session, interleaved now"; "Bypass ADR 090 for this I allow"; "use only fable 5.1 and show me what oyu can actually do".

The honesty rules the marketing lane already carried stay binding: no invented proof, every sample labelled, no trackers.

## Options considered

1. **Keep `/login` as the stranger's home** (status quo, ADR 0143). Rejected: the founder's 2026-10-08 pick is a landing page first, and the emails already point at the domain.
2. **A static landing page** (the A/B/C sketches of 2026-10-08: headline, three columns, a button). Rejected by the founder in the words above.
3. **A motion landing page inside the app at `/`, on labelled sample data, every motion with a stated job.** Chosen. One claim, one sample invoice that reads itself, four ways a delivery costs more than it should, one delivery followed from the door to the cellar, the price line, who we are, one button.
4. **A separate marketing host** (a static site at the apex, the app at a subdomain). Rejected: there is one deploy and one domain today; the WebSite graph is written into `dist/index.html` for the root (ADR 0158) and Google reads it from the apex only; moving the app would change every public link and the OAuth redirect; a second host is more surface for no reader.
5. **The landing behind a flag, dark-launched** (ADR 0138's pattern). Rejected: flags are per house and per signed-in person, and a stranger has neither, so there is nothing to flip for the audience; the page sends nothing, stores nothing and calls no API, so what a flag would contain is copy, which the founder reads in the PR.
6. **Motion through an animation library** (Motion, formerly Framer Motion). Rejected: not in `apps/web`'s dependencies; the page needs timers, one requestAnimationFrame tally and two IntersectionObservers, all native; a dependency for one page fails the low-footprint rule.
7. **Two routes: `/` for the landing, the dashboard moved to `/dashboard`.** Rejected: every in-app link, the sidebar, the post-login redirect and ADR 0143's door land on `/`; moving the dashboard would break bookmarks for the people already in the house.
8. **A server-side split by cookie** (serve a static page to a stranger, the app to a session). Rejected: the host serves `dist/index.html` for `/` before any rewrite (vite-plugin.ts), the session lives in localStorage, not a cookie, and the page sets no cookie by this record's own rule.

## Decision

1. **The root is a door with three readers.** `/` renders `RootDoor`: with no session stored it renders the landing page; with a stored session still being read it renders `HousePageLoader`, so a signed-in person never sees the landing flash before their dashboard; once authenticated it renders `ProtectedRoute` and `DashboardLayout` with the dashboard as the route's index child, through the layout's outlet, exactly as before. `ProtectedRoute`'s own doors (`/verify-email`, `/choose-house`, the role checks) are unchanged. The landing page is not behind `ProtectedRoute` because that component sends a stranger to `/login`, which is what the landing replaces.
2. **The page's content rules**, binding on every later edit of `apps/web/src/pages/landing/`:
   - Every figure on the page is a sample and is labelled as one beside the figure ("Sample invoice. Every price on it is invented."; "Every number on this page is a sample."; the mini sheets carry "SAMPLE"). The one outside figure (Consolidated Concepts, 2015: 11,000 invoices, 400 restaurants, at least one overcharge on 35 percent) names its source in the sentence that uses it (FSR Magazine, December 2015), and the page says "We have no figure of our own yet, and we will not print one until we do."
   - The price line is the founder's pick, "Free for the first houses.", and "We are not charging the first houses, and we have not decided what comes after." OD-23 stays open: no tier and no number of our own. The one competitor figure, $350 per location per month, is cited to marginedge.com/pricing as read on 2026-10-08, with the date in the footnote.
   - No tracker, no third-party script, no cookie, no outside link, no image: every `href` is a route of the app (`/`, `/login`, `/register`, `/privacy`, `/terms`). The page calls no API.
   - No em or en dash, like every other public page (seo.test.ts).
   - Every motion has a stated job: the sheet's cursor is the reading; the two stamps mark the lines that disagree; the tally adds up what was over; the door count travels into the claim, the draft letter and the cellar line; a case or a beat enters once, when it is first seen; on a phone the one button follows once the hero's is out of view and steps aside for the closing one. `prefers-reduced-motion` shows the finished state at once. Motion is transform and opacity only, and there is no window scroll listener (two IntersectionObservers do that work).
   - One call to action, "Bring one invoice", to `/register`; three places (hero, close, phone dock); the same label everywhere.
   - Colours are the `.mudavym` tokens, so the page follows the person's ground (ADR 0169); the sample invoice alone is always paper, because it is a document. Fonts are the self-hosted Fraunces, DM Sans and JetBrains Mono; nothing is fetched from a font host.
3. **The crawl surface.** `/` enters `sitemap-pages.xml`; its head stays `SITE.name`, `SITE.sentence` and the WebSite graph (ADR 0158), and the landing's one-line summary under the headline is that same sentence. `llms.txt`'s price sentence changes in the same commit to "Mudavym's own price is not published: the first houses are not charged, and what comes after is not decided. This site publishes no customer counts, ratings or reviews, and no restaurant's own records."
4. **Home links.** ADR 0143 said "When a real landing page exists the link moves to it in one line": the vendor page's lockup (`homeHref`) and its footer line "Published on Mudavym" now go to `/`. Measured 2026-10-09: the seven signed-out pages pass no `homeHref`, so their lockup was never a link and nothing else moves.
5. **ADR 0090 for this PR.** The landing PR merges without the three-role audit, on the founder's word "Bypass ADR 090 for this I allow" (2026-10-08). The bypass is for that one PR; the next change to the landing page is gated like any other. The merge itself still waits for his word, because the page is outward-facing.
6. **ADR 0039's hold** on "brand/landing visuals" is lifted for the landing page only. The Blender and visual-asset hold stands (README pre-log row, bracketed).

## Consequences

- A stranger at `mudavym.com` reads a page instead of a form. `RootDoor.test.tsx` covers the three readers and the no-house door; `Landing.test.tsx` covers the headline, every link's target, the absence of outside links, scripts, images and dashes, the sample labels, the sheet's reading under fake timers, the stamps' `aria-expanded` toggles, the reduced-motion path, and the door count's travel and clamp.
- Claims in `claims.d/feat-landing-page-2026-10.jsonl`: the root route line in `App.tsx`; no `http` in the landing directory; no em or en dash there; `/` marked `sitemap: true`; the llms.txt sentence.
- Owed, for the founder to read in the PR (forks, not defaults): the headline's wording; `/register` against `/get-started` as the button's target; whether the 2015 figure stays on the page; whether `/`'s meta description stays `SITE.sentence` or gets a landing sentence; whether a stranger's ground should follow the device's dark mode or always be paper.
- Not done: no Core Web Vitals or Lighthouse measurement of the page; no A/B of the headline; the three-role audit, by his word; the production deploy is verified after the merge with `deploy_check.sh`.
- Supersedes ADR 0143's "Where home is for a stranger" for the root only; ADR 0143's door (`/login`) remains the sign-in page.

## Review trail

| Date | Who | What |
|---|---|---|
| 2026-10-09 | executor SIM (a02b515d) | Page, route, tests, registry and llms changes built in `wt-landing`; this record written; founder's words quoted verbatim above |
