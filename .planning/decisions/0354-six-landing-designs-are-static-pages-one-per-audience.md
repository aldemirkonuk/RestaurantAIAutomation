# 0354 — Six landing designs are served as fixed static pages, one per audience

- **Status:** Proposed (2026-11-01). The build approach, the audience map, the indexing and the gate are the founder's picks, quoted below. The paths, the fix list and the `?for=` mechanics are the executor's. A lock is his.
- **Date:** 2026-11-01
- **Decider:** founder: which designs ship, that they ship as static pages, which audience gets which page, no indexing, a local gate per page. Executor (session 875a7ba7): the paths, the fixes each page needs, and how `?for=` reaches signup.
- **Keywords:** landing variants, cold email, audience, static page, /l/, ?for=, A Day read back, House cellar, Ask, Pass, Film, Ledger, noindex, three.js, self-hosted fonts
- **Links:**
  - [ADR 0344](0344-register-is-the-landing-door-and-story-tells-one-night.md): amended. `/` and a bare `/register` keep its landing; the six pages below are extra doors beside it, and its content rules (from [ADR 0320](0320-the-root-is-a-landing-page-for-a-stranger.md)) bind them.
  - [ADR 0090](0090-pr-audit-gate-autonomous-merge.md): the gate. The founder's pick for these PRs is quoted under Decision 6.
  - The designs as imported: `p4-scratch/landing-refs-2026-11-01/` (`five-ways/` and `f2-day-read-back.html`), outside the repo.

## Context

On 2026-10-31 the founder chose one landing page per audience, addressed by URL so each cold email links its own, and counting in our own database rather than a third-party tool. He held the build until he had sent the pages. On 2026-11-01 he sent them: a "Five Ways" set of nine designs and a tenth, "Mudavym, A Day, read back" (here F2). His words: "I really love the one that has the Mudavim, a day read back. That's going to be one of those reading landing pages as well. So other than that, select them all."

A code-only read of each design (nothing was opened in a browser) found that every one breaks a rule ADR 0320 binds on the landing. Each design loads Google Fonts. B2 loads three.js r128 from cdnjs (`b2-house-cellar.html:524`). Each has em or en dashes, for example `c-type.html:374`, `d-pass.html:379` and `e-ask.html:470`, and every title reads "Mudavym — …". Several show figures labelled only in a footer, or not at all: B2's $38,400 at `b2-house-cellar.html:466`, and A, which has no label. F2 shows prices in € (`f2-day-read-back.html:723`), shows "12:00–23:00" (`:702`), and embeds its own sign-in form (about `:1142`). Every design's buttons point at absolute `https://mudavym.com/get-started` and `/login`.

Three of the ten repeat another design, so they are dropped:
- B (`b-cellar`): B2 is the same idea, finished.
- B3 (`b3-house-drawn`): it nearly duplicates B2.
- F (`f-day`): F2 is F with an analytics ending.

## Options considered

The founder was asked these on 2026-11-01 (the gate and three.js are quoted under Decision). Each option below is as it was put to him.

**How to build them:**
1. **Static pages, fixed.** Serve each design almost as drawn under `/l/<name>`, with self-hosted fonts, three.js bundled locally, dashes and labels fixed, and buttons that carry `?for=` into signup. All six can be live in days; the cost is that they sit outside the React app. *Chosen.*
2. **Port each into the React app.** Each becomes a route sharing the landing's components and tests. This costs weeks for six designs, and the designs would drift towards the landing as they are rebuilt from its parts.
3. **Do nothing.** The emails keep linking the one landing, and the founder's designs stay unused.

**Which audience gets which page:**
1. **The executor's mapping.** F2 is the default for everyone; B2 goes to wine bars, E to SF independents, D to full-service kitchens and East Lansing; A and C stay unassigned for later emails. *Chosen.*
2. **All to everyone, rotate.** No audiences: each email links a different design, and the signups table compares them. Rejected: 22 emails cannot power a comparison.
3. **The founder assigns them later.**

**Whether search engines index the pages:**
1. **No index.** Each page sends `noindex`, names `/` as its canonical, and stays out of the sitemap. *Chosen.*
2. **Index them all.** This puts six near-duplicates of one pitch in search, which can split the ranking of `/`.

## Decision

1. **Six pages, at these paths.** Each is one file, `apps/web/public/l/<name>/index.html`. Vite copies `public/` into `dist/` as is, and Vercel serves a file before any rewrite.

   | Path | Design | Audience (founder's map) |
   |---|---|---|
   | `/l/day` | F2, A Day, read back | Default: any email outside a named audience |
   | `/l/cellar` | B2, House cellar | Wine bars |
   | `/l/ask` | E, Ask | SF independents |
   | `/l/pass` | D, Pass | Full-service kitchens, and East Lansing |
   | `/l/film` | A, Film | Unassigned |
   | `/l/ledger` | C, Ledger (`c-type`) | Unassigned |

   "Default for everyone" means the page an email links when its reader is in no named audience. It does **not** replace the landing at `/` or at a bare `/register`: the founder did not ask for that, and doing it would be a separate decision.

2. **Each page keeps its design and is fixed to the landing's rules.** It must meet all of these before it merges:
   - **Fonts are the app's own.** They come from `/fonts/` (Fraunces, DM Sans, JetBrains Mono, each with its OFL licence). A Fraunces weight outside the shipped 300 to 680 range is clamped into it, not fetched.
   - **No outside request.** There is no link, script, stylesheet, font, image or iframe from another host. three.js, which only B2 uses, is vendored as `/l/vendor/three-r128.min.js` with its MIT licence beside it. Asked on 2026-11-01, the founder chose *"Download and vendor (Recommended)"* over adding `three` as a dependency and over redrawing B2 in 2D. The file comes from the npm registry's `three@0.128.0` tarball, whose sha512 matched the registry's published `dist.integrity` (`sha512-i0ap/E+OaSfzw7bD1TtYnPo3VEplkl70WX5fZqZnfZsE3k3aSFudqrrC9ldFZfYFkn1zwDmBcdGfiIm/hnbyZA==`); `build/three.min.js` from it has sha256 `9274bbcec8d96168626c732b5d31c775aa8cfb7eaa0599bec0c175908a2c1ce2`. Nobody reviews the minified file line by line; the hash is what is checked.
   - **No em or en dash** in text, `title`, `aria-label` or `alt`. Ranges read "12:00 to 23:00".
   - **Every block of figures carries a "Sample" label inside that block**, not only in a page footer. This is ADR 0320's pattern (a "SAMPLE" mark on each mini sheet, plus a page-level line); it does not require a label beside each number. Each page also carries a page-level line saying its numbers are samples (`/l/day`: "Demo House and every number on this page are samples."). No test can see this, so each page's review checks it by hand.
   - **Prices are in dollars.** The named audiences are in the US. F2's € figures change to $.
   - **No sign-in form on the page.** F2's embedded form goes, and its link goes to `/login`.
   - **One button, the landing's.** It reads "Start free" and goes to `/register?type=new` (ADR 0344's `START`), plus the parameters in point 3. Links are relative, so a preview deployment stays on its own host.
   - **Every motion has a job, and reduced motion shows the finished state.** The page plays sound only after the reader presses something, never on load.

3. **The audience travels to signup in the address.** An email links, for example, `/l/cellar?for=wine-bars`. The page's own short inline script reads `for`, keeps it only if it is lowercase letters, digits and hyphens of at most 40 characters, and adds it to every "Start free" link with the page's name: `/register?type=new&for=wine-bars&page=cellar`. A `for` that fails the check is dropped, and the link still works. `?type=new` already opens Register, so the extra parameters change nothing there today.

4. **Not indexed (founder's pick).** Production's `robots.txt` already closes every path it does not list (`apps/web/src/lib/seo/robots.ts:109`), so crawlers and preview bots that honour it do not fetch `/l/`, and a link pasted where one of them reads it shows no card. Not every fetcher honours it: Slack's does not (`robots.ts:46-51`), so a link pasted in Slack can still unfurl the page's title and description. That closure has a cost: a crawler that honours `robots.txt` never fetches `/l/`, so it never reads the header or the meta below, and a search engine can still list a bare `/l/` address, with no snippet and at most a title taken from the link's text, if a public page links to it. The pages are made to be linked from the founder's emails, not from public pages, but nothing stops anyone else linking one. The header and the meta reach only fetchers that ignore `robots.txt`. Opening `/l/` in `robots.txt`, so crawlers can read the `noindex` and drop the address, would change the crawl rules. Asked on 2026-11-01, the founder chose *"Keep /l/ closed (Recommended)"* over opening `/l/` to crawlers, so `robots.txt` is unchanged. `vercel.json` sends `X-Robots-Tag: noindex` on `/l/(.*)`. Preview hosts already get `noindex` from the rule for every host but `mudavym.com`, so only production can show the `/l/` rule working. Each page names `https://mudavym.com/` as its canonical. No page joins the sitemap, `llms.txt` or the public route registry (`seo/routes.ts`).

5. **Counting is its own change.** Until it lands, `for` and `page` reach `/register` and nothing stores them. That change will add a Supabase table beside accounts, recording page views, button presses and the signup a press led to, written only through an insert-only path. It needs its own ADR before it is built.

6. **Each page lands in its own PR, on a local review, merged by the founder.** One page file is 55 to 170 KB. Asked on 2026-11-01, the founder chose *"Local gate per page (Recommended)"* over splitting each page into PRs of 30 KB or less, and over skipping review for these pages. The CI review cannot read a diff that large and answers BLOCK for it, and that answer stands against any other at the same commit, so a session cannot merge these PRs itself. Asked again, he chose *"You merge after local PASS (Recommended)"*: the session runs the local review (one planner and two reviewers, who read the files directly), posts its report on the PR, and the founder presses merge.

## Consequences

- **Easier.** Each email links a page drawn for its reader, and each page can change without touching the React app.
- **Harder.**
  - The six pages share no code with the landing. A change to "Start free", to `START` or to a content rule must be made in each page by hand. Each page's test checks its rules, so a missed page fails a test instead of drifting.
  - three.js is now a vendored file to keep current by hand.
  - The pages have no dark ground of their own unless the design drew one.
- **Revisit when:**
  - the counting table shows a page bringing no signups across a full send;
  - a seventh page is asked for (then shared fixes become worth a template);
  - the founder wants a page at `/` or at a bare `/register`.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-11-01 | executor (session 875a7ba7) | Created in `wt-landing-six`. The founder's three picks and his words are quoted above. The designs were graded by code reading only, not in a browser. |
| 2026-11-01 | executor, measured in `wt-landing-six` | `/l/day` built from F2. `staticPages.test.ts`: 10 tests pass, and each of 21 deliberate breaks of the page turned one red. Headless Chromium at 1440x900 and 390x844, with and without reduced motion: no console errors, no request leaving localhost, no sideways scroll at 390; screenshots in `p4-scratch/landing-six/day/`. Left as drawn: the "Sign in" link inside the book picture cannot be pressed, because the design turns off pointer events on that layer; the header and closing "Sign in" links work. Not run: Safari, Firefox, a real phone. |
| 2026-11-01 | executor, after the local gate's first reviews of #721 at 444d74f | Both reviewers approved with notes that the records said more than the page does. Reworded in place, as the executor's call: Decision 2's Sample rule now asks for a label per block of figures plus a page-level line, ADR 0320's pattern, instead of a label beside every number; Decision 4 now says `robots.txt` already closes `/l/` to fetchers that honour it, that Slack's does not, and that only production can show the `/l/` header working. The founder has not been asked about either rewording. |
| 2026-11-01 | executor, after the local gate's final call on #721 at 4adb30f | The planner overturned approval: Decision 4 said the header covers a crawler that reaches `/l/` by a link, but a crawler that honours `robots.txt` never fetches the page and so never reads the header. Decision 4 now says what the closure costs and that opening `/l/` to crawlers is a question owed to the founder. The founder then answered it: keep `/l/` closed. Also changed since the first reviews: the claims check matches `'day'` anywhere in `PAGES`, the README row gained its date cell, and the test's header comment uses the per-block Sample wording. |
