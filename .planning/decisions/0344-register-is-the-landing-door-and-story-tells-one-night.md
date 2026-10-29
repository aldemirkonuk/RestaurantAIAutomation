# 0344 — /register is the landing's door, and /story tells the platform as one night

- **Status:** Proposed (2026-10-28). The founder asked for each of the three changes himself, and his words are quoted in Context. The executor wrote the content rules and mechanics. A lock is his.
- **Date:** 2026-10-28
- **Decider:** founder: the platform redesign and its sections, `/register` showing the landing, `/login` unchanged, and a separate scroll story. Executor (session 875a7ba7): the doors' query rules, the story's script and mechanics, and the content rules below.
- **Keywords:** landing page, register, RegisterDoor, story, scroll-driven animation, view-timeline, reduced motion, Start free, invite code, sample data, no amber
- **Links:**
  - [ADR 0320](0320-the-root-is-a-landing-page-for-a-stranger.md): amended. The button's words and target change, and its content rules now also bind `/story`.
  - [ADR 0342](0342-taste-prediction-is-parked-operations-come-first.md): the "Coming soon" food band.
  - [ADR 0169](0169-the-ground-is-white-by-default-and-each-person-chooses.md): grounds.
  - Code, under `apps/web/src/`:
    - `pages/landing/`: `doors.ts`, `RegisterDoor.tsx`, `Landing.tsx`, `landing.css` and their tests.
    - `pages/story/`: `Story.tsx`, `story.css`, `Story.test.tsx`.
    - `App.tsx`: the `/register` and `/story` routes.
    - `pages/Register.tsx`: its Back buttons.
  - Claims: `claims.d/feat-landing-page-2026-10.jsonl`.

## Context

ADR 0320 put a landing page at `/` with one button, "Bring one invoice", which went to `/register`. In the 2026-10-28 session the founder asked for more, in these words (verbatim):

- "add some style a little bit of anmation, and a coming soon section that talks about predicting food rather than the operations, but predicting food."
- "create better dark theme with mudavym colors and try not to use yellow"
- "not hard blue, and maybe can you keep the landing page as super innovative landing page with stats and everything needed"
- His AskUserQuestion picks:
  - "also add for future calling the providers and negotiating with them,Your-numbers calculator"
  - "FAQ (Recommended),Security and your data (Recommended),Before and after"
- "right now what s at /register, and now keep this and create a new one with explaining a story with full animations scroll"
- "I want to keep the slash login page, which is the Skyleaf, the notebook image, notebook animation, but I want to change the slash register to our landing page, if that makes sense."

Before this record, `/register` with no query showed Register's two-card chooser. That chooser carried claims nobody had verified: "POS + supplier sync", "Multi-location ready", "under 3 minutes" and "Most Popular".

## Options considered

1. **`/register` redirects to `/`.** Rejected for two reasons:
   - It changes the address the founder named.
   - It would need a second rule so that invite links (`?invite=`) still reach the form.
2. **`/register` renders the landing unless the address asks for the form by name.** Chosen. The landing's button and every invite link already name what they want, so nothing that works today has to change.
3. **Keep the chooser at `/register` and move the landing's button to `/get-started`.** Rejected: the founder asked for the landing at `/register` itself.
4. **The story as more sections of the landing.** Rejected: he said "keep this and create a new one".
5. **The story animated with a JS scroll library (GSAP ScrollTrigger, Motion `useScroll`) or a scroll listener.** Rejected on three grounds:
   - neither library is in `apps/web`'s dependencies;
   - ADR 0320 forbids scroll listeners;
   - CSS scroll-driven animation (`view-timeline`) runs off the main thread.
6. **The story on its own invented data (new numbers, new claims).** Rejected. Every sentence on `/story` is either already on the landing or a labelled sample variation of one. Nothing new is promised on a second page that nobody re-reads.

## Decision

1. **The landing is the platform page.** Its eleven numbered sections are:
   - One system
   - The platform
   - How it works
   - Before and after
   - What it notices
   - Your numbers (the reader's own week, computed on the page and sent nowhere)
   - It asks first
   - Your data
   - Goals
   - Coming soon: predicting the food (worded as coming, with no figure, under ADR 0342's parking)
   - Questions

   Two more bands follow: the future vendor calling and negotiating band, with a labelled sample transcript, and the price line. The dark ground is the landing's own soft graphite, and its only accent is the seal teal. No rule reads the amber warn tokens (claims row `ADR-0344-LANDING-NO-AMBER`). ADR 0320's content rules stay binding: samples are labelled, there are no outside links, scripts or images, there are no dashes, every motion has a stated job, and reduced motion shows the finished state.
2. **One button, new words: "Start free".** It goes to `/register?type=new` (`doors.ts`, `CTA` and `START`), the same label in every place it appears. A quiet line under it, "Joining a team? I have an invite code", goes to `/register?type=join`. This replaces ADR 0320's "Bring one invoice" → `/register`.
3. **`/register` is a door with two readers** (`RegisterDoor`):
   - `?invite=…`, `?type=new` or `?type=join` render Register exactly as before;
   - anything else, a bare `/register` included, renders the landing.

   Register's Back buttons return to `/register`, which is now the landing. `/login` is unchanged.
4. **`/story` is the platform told as one sample night**, in eleven chapters: 1:12 am, Tonight, 4:10 pm, 4:11 pm, 4:12 pm, 4:15 pm, 6:00 pm, 9:40 pm, 11:20 pm, 12:05 am, and Tomorrow.
   - **Tomorrow** is the founder's answer of 2026-10-28 to "did you add future?": "Both, one chapter". It is one last chapter, labelled "Not built yet", with the landing's sample wording. First Mudavym calls the vendor about the held $32.40, then comes the food-prediction block. Review changed one thing: the call follows up the reply on line 3 only once that reply has a person's yes. The night leaves that reply waiting, so the chapter never runs ahead of the approval the story itself shows. It ends on "Waiting for your yes".

   Its mechanics are binding on later edits:
   - **Each moving part has a window.** It names its own window (`--a0`, `--a1`) inside its chapter. The base styles are the final frames.
   - **There are three readers.**
     - **Scrubbed.** A chapter pins (`.is-fit`) and follows its `view-timeline` only when all of these hold:
       - the browser has `ResizeObserver` and `animation-timeline: view()`;
       - the chapter's picture measures no taller than the pin less `PIN_AIR` (24 px).

       The pin and the measuring probe are both `100svh − --st-top`, where `--st-top` is the safe-area top plus the 64 px bar. So what was measured is what is drawn. A `ResizeObserver` on the probe, on every chapter's picture, and on the blocks between the chapters (the hero, the dusk band, the end) measures again on a resize or a font swap. It watches pictures, never chapters: a chapter's height is what `fit()` changes, so watching it would feed the observer its own change ("ResizeObserver loop completed with undelivered notifications").
     - **Played.** Any chapter that does not fit runs by time, 30 ms per unit of its window. It starts once its picture is mostly on screen: `STAGE_SHARE` (0.6) of the picture, or of the screen when the picture is taller. The food block is a stage of its own. "On screen" means below the bar: the probe starts at `--st-top`, Story reads the bar's height from where the probe starts, and both screen watchers take that height off the top (`rootMargin`), so a picture still behind the bar has not been seen, scrolling either way. The bar's height is read once, on mount; a safe area that changes later (a rotation) is not read again.
     - **A chapter that changes reader starts again.** A rotation or a resize can move a chapter between pinned and played. Chromium keeps such a part on its old clock (off a view timeline it can sit minutes before its start, unseen), so `fit()` gives each chapter that flips one style pass with no animation (`is-flip`, forced by a layout read), then its new one. Chapters that do not flip are left alone.
     - **The reader keeps their place.** A pinned chapter is as long as the screen is tall, so a rotation or a window resize moves every chapter under a reader who has not scrolled. On a height change Chromium keeps `scrollY`, and its own scroll anchoring does not hold the place across the pinned chapters (measured). So Story holds it:
       - `fit()` remembers where each block of `main` stood, the screen size it was laid out for, and where the reader stood (`lay`);
       - one passive scroll listener notes where the reader stands, but only while the screen is still the size of that layout. The browser can move the reader before `fit()` runs: it pulls a reader near the end up to a page that got shorter, and a turning phone moves them by its own anchor. Those scrolls happen on the new screen, so they are not taken for the reader's;
       - after any resize `fit()` finds the block that was at the middle of the old screen and how far into it (`place`), and puts that same share back at the middle with one instant `scrollTo` (`keep`);
       - the browser's own anchoring stands down while Story does this (`.mdv-story.is-placed { overflow-anchor: none }`), so nothing moves the reader twice;
       - a reader at the top stays at the top.
     - **A keyboard reader sees finished pictures, clear of the bar.** When focus arrives by keys (`:focus-visible`), the chapter gets `is-done` (no animation, so the base styles, the final frames), and the focused button is never half drawn.
       - Chromium scrolls a focused button into view as it stands mid-rise (26 px low), and counts the band under the sticky bar as visible, so a button could land behind the bar. Every link and button in `main` has `scroll-margin-top: calc(var(--st-top) + 8px)`. It is set on the elements, never as an `html` `scroll-padding`, which would also shift every chapter's view-timeline range. Once the chapter stands finished, the focused element is brought into view (`scrollIntoView({ block: 'nearest' })`).
       - A browser that cannot answer `:focus-visible` counts as keys.
       - A pointer press finishes nothing and scrolls nothing.
       - After Approve or Undo, focus stays on the card the reader answered.
     - **Reduced motion.** It gets the final frames with no pinning. A chapter-rail jump lands at once (`html:has(.mdv-landing) { scroll-behavior: auto }` in `landing.css`), because `globals.css:105` smooth-scrolls `html` for the whole app. Review first dismissed this (U5), because a grep for `scroll-behavior` missed `@apply scroll-smooth`; it was then fixed, with a test and a mutation.
   - **The old fallback is gone.** The earlier `@supports not` block and the min-height gate are removed. A browser without view timelines plays every chapter.
   - **Dark ground.** The night chapters, and a whole page on charcoal, restate `--ld-hair`, `--ld-hair-2`, `--ld-shadow` and `--ld-on-seal` inside `landing.css`'s dark-ground block. They must be restated there because a custom property is worked out where it is set.
   - **Motion.** Motion is transform and opacity only. No scroll listener moves anything; one passive listener notes where the reader stands (above). The page has:
     - one IntersectionObserver that reveals words;
     - one that starts the played stages;
     - one that drives the chapter rail. It watches every block of `main` and marks the chapter at the middle of the screen. The dusk band after 6:00 pm counts as that chapter (`data-rail`), and the hero and the end count as none;
     - one ResizeObserver that measures the fit and keeps the reader's place.
   - The two asks (order, reply) can be approved and undone, and the closing receipt follows. The page says "Try it. Nothing leaves this page." and calls no API.
   - Its one button is the landing's (`CTA` → `START`). Its other links go to `/login` and `/`.
   - ~~`/story` is unlisted: it is not in the public route registry (`lib/seo/routes.ts`), and nothing on the landing links to it yet.~~ [2026-10-29: listed and linked on the founder's pick, see Owed forks.]

## Consequences

- **What a stranger meets.** A stranger who types `/register`, for example from the login page's "Create one now", reads the landing instead of the chooser. The chooser's unverified claims can no longer be reached without a query.
- **Tests.**
  - `RegisterDoor.test.tsx`: the four queries.
  - `Landing.test.tsx`: the button's words and target, and the invite line.
  - `Story.test.tsx`, 32 tests:
    - chapter order;
    - the rail: the chapter at the middle, the dusk band as 6:00 pm's, none on the hero or the end;
    - links;
    - no script, iframe or img;
    - no dashes, in words and in aria-label, title and alt;
    - every sample label;
    - the sums (48 bottles, $840.00, $32.40 held);
    - approve and undo;
    - reduced motion: every chapter finished, and a rail jump that lands at once;
    - every moving part's window inside its chapter and its stage;
    - the call's name and reading order for a screen reader;
    - the stage trigger at `STAGE_SHARE`, for a short and for a tall picture;
    - the fit gate, with a control, then without view timelines and then without `ResizeObserver`;
    - measuring again on resize (the probe, every picture, the blocks between), and letting go on unmount;
    - a chapter that flips between pinned and played starting again, and only that chapter;
    - a keyboard reader's chapter finished and its focused button brought clear of the bar, a pointer's left alone, and a browser that cannot tell the two counted as keys;
    - focus kept on the card the reader answered;
    - nothing under the bar counted as on screen, at the bar's measured height;
    - the reader's place kept through a height change, a page that got shorter, a phone turning, and a reader at the top, with the browser's own scroll on the new screen ignored and the listener passive and let go on unmount;
    - the stage and svh pin rules in the stylesheet;
    - the dark-token restatement;
    - Tomorrow's follow-up wording;
    - none of the landing's forbidden promises.
  - Every one of the 81 hand-written mutations (`p4-scratch/landing-2026-10-28/round3/mutate2.py`) turns a test red.
- **Measured 2026-10-28** in `wt-landing`:
  - vitest (story, landing, the auth-page design and Register's currency step): 144 passed, 11 skipped (the env-gated capture suites).
  - eslint and tsc: clean.
  - Playwright at 1440×900 and 390×844: no horizontal overflow and no pinned chapter clipping its picture. Reduced-motion chapters stand at 490 to 685 px.
  - Chromium, after round 3 (`round3/fixcheck3.cjs`): at five screen sizes every link and button in `main` reached by Tab or Shift+Tab stands at least 7 px below the bar, uncovered; a pointer press on Approve scrolls nothing and finishes nothing; the rail reads 6:00 pm across the whole dusk band; and in nine resizes and rotations (390×844 ↔ 844×390, 1440×900 → 1440×420, 1440×900 → 390×844, 1440×900 → 1440×600 nine tenths into Tomorrow, and others) the block at the middle of the screen and its share stay the same to 0.01. No `ResizeObserver` loop error. The page's one failed request is the app shell's dev sign-in to the local gateway, which was not running; Story itself calls nothing.
  - Contrast on the night ground: the asks' buttons 7.3:1; the rail's marks at least 5.63:1; the hairlines about 1.9:1, which is allowed because they are decorative.
  - On a phone at 390×844 only Tomorrow (`st-next`) plays by time; at 390×664 the ask and Tomorrow play. Every other chapter is pinned.
  - Tomorrow's call names its trigger as a labelled sample (`Story.tsx:958`): "Not built yet, and no date."
  - The contact sheets, the shoot script and the facts the landing may state (`landing-facts.md`) are in `p4-scratch/landing-2026-10-28/`; each review round's scripts and outputs are in its `round2/` and `round3/`.
- **Owed forks, the founder's to answer** (never defaults) [answered 2026-10-29 except go-live, his picks quoted]:
  - go-live itself [still his];
  - ~~whether the "Coming soon" food band stays while ADR 0342 parks taste prediction~~ [*"Keep, labelled (Recommended)"*: it stays worded as coming, with no figure, labelled];
  - ~~whether a stranger's ground follows the device's dark mode~~ [*"Follow device (Recommended)"*: as built];
  - ~~whether `/story` is linked from the landing and listed in the sitemap~~ [*"Link /story"*: linked from the landing's bar and footer as "The story", with its own crawl head, sitemap row and llms.txt line (`seo/routes.ts`, `vercel.json`; claims row `ADR-0344-STORY-IS-LISTED`)];
  - ~~whether Login's "Create one now" goes straight to `?type=new`~~ [*"Login → ?type=new"*: `Login.tsx` links `START` from `doors.ts`; claims row `ADR-0344-LOGIN-OPENS-THE-FORM`].
- **Merged and live, 2026-10-29.** The founder's go-live pick was "Merge + go live". The CI audit gate ESCALATED #697 on text it owns (ADR 0320, the README row), so no PASS could exist, and `require_pr_audit.py` refused the CLI merge. The founder then picked "Merge via API anyway". #697 was squash-merged that way, pinned to its CI-green head ce611c91e, as 27069116d (see #697's timeline); no PASS marker was posted. Production was checked right after: `/` shows a stranger this landing, `/story` serves its own head, the pages sitemap lists `/story`, and `/register`'s canonical is `/`. One thing seen then: a visitor whose stored token had expired was sent to `/login` by the 401 handler before `RootDoor` could show the landing [answered and fixed 2026-10-29, next bullet].
- **Two more answers, 2026-10-29** (forks raised by #699, his picks quoted), built on `fix/register-door-followups`:
  - a dead session on a public page: *"Public pages stay put (Recommended)"*. When the refresh token is refused on a page in the public route registry (`publicRouteFor`, `seo/routes.ts`: `/`, `/login`, `/register`, `/story`, `/privacy`, `/terms`), the person stays on that page and it draws as it does for a stranger. The two places that act on it, the API client's 401 handler (`client.ts`) and the auth store's boot load (`authStore.ts`), call one function, `leaveDeadSession` (`apps/web/src/lib/deadSession.ts`), so whichever of the two notices first, the reaction is the same: both tokens and the auth store's persisted copy of the person (`auth-storage`, the store's persist key, exported from that module) are removed, then a public page reloads (`window.location.reload()`, which keeps the query and the hash) and any other page goes to `/login`. The page judged is the one the person is on when the refusal lands, which is what "public pages stay put" names. The reload boots with no session, so `/` draws the landing, not a dashboard: `RootDoor` keys on `AuthContext`'s user, which is set only after `/auth/me` answers for a stored access token. A third reader, `AuthContext.tsx`'s own interceptor and load, clears the tokens through the shared refresh (`sessionRefresh.ts`) without calling `leaveDeadSession`; at boot the auth store's load runs too and reloads, so the page is the same, but a refusal seen later by `AuthContext` alone leaves the page and `auth-storage` as they are until the next load, as before this record. `leaveDeadSession` keeps the remembered house (`activeRestaurantId`), as the API client's old teardown did, while the shared refresh's own teardown removes it; the id is a hint, and the gateway decides membership (ADR 0164). The reload cannot repeat: with no tokens left, the auth store's boot load returns before asking `/auth/me`, and the API client rejects a tokenless 401 without refreshing or navigating. One consequence: on `/login` or `/register` the reload also clears whatever was typed in the form, as the old `/login` navigation already did on `/login`. Every other page still goes to `/login`; ADR 0164 carries a pointer to this amendment, and the registry ADR 0320 decided points here from its own docblock (`seo/routes.ts`). `publicRouteFor` matches exactly, after trimming trailing slashes (`seo.test.ts`). The SEO public route registry now also decides this auth behaviour, so a page added to it is a page a dead session stays on; claims row `ADR-0344-PUBLIC-REGISTRY-MEMBERS` pins the six paths, so adding one is a deliberate act. Claims rows for this answer live in `claims.d/fix-register-door-followups.jsonl`; the existing row `ADR-0344-REGISTER-IS-A-DOOR`, in `claims.d/feat-landing-page-2026-10.jsonl`, was rewritten there for the second answer below, because its old check pinned the behaviour that answer changed. Tests: `deadSession.test.ts`, `client.houses.test.ts`, `authStore.test.ts`;
  - an `?invite=` with no code: *"Send to the landing (Recommended)"*. `RegisterDoor.wantsForm` counts an invite only when it carries a code, so `/register?invite=` reads like a bare `/register`. Test: `RegisterDoor.test.tsx`.
- **Owed work:**
  - ~~`/register`'s head still says "Create an account" and duplicates `/` without a canonical~~ [done 2026-10-29 on this PR: the served head for `/register` names `/` as its canonical, carries the root's title and sentence, and is out of the sitemap and llms.txt, since a sitemap lists canonical URLs only (`seo/routes.ts`, claims row `ADR-0344-REGISTER-HEAD-NAMES-ROOT`). The tab still says "Create an account · Mudavym" on the form: `RegisterDoor` names what it draws, because `RouteHead` keys on the path alone];
  - ~~Register's chooser code, with its unverified claims, is still in `Register.tsx` and should be retired in its own change, after this PR merges (the router no longer reaches it)~~ [retired 2026-10-29 on `feat/retire-register-chooser`, its own PR after #697: the `selector` path and its cards are gone, Register with no known query opens the new-house form, the OFF fingerprint `register-selector` is removed with a note in its `_what`, and the design test asserts the new default in both switch positions; claims row `ADR-0344-CHOOSER-RETIRED`];
  - ~~this record's README row goes in its own PR~~ [corrected 2026-10-29: README.md:18 puts a new ADR's row in the same PR as its file, and a deferred row becomes an owned edit, so the row is on this PR].
- **Not done:**
  - no Lighthouse or Core Web Vitals measurement of `/story`;
  - every browser check was in Chromium. Firefox, Safari's scroll anchoring and a real iOS rotation were not run; browsers without `view-timeline` take the played path, which was run only by emulating its absence in Chromium;
  - keyboard focus was checked for Tab and Shift+Tab, not for ArrowDown or Page Down scrolling;
  - the place is measured from `innerHeight`, so a phone's toolbar sliding in or out can shift the middle by its height. A toolbar alone does not count as a resize (the probe is `svh`);
  - no production deploy.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-28 | executor (session 875a7ba7) | Created in `wt-landing`, uncommitted; the founder's words quoted verbatim above |
| 2026-10-28 | round 1, workflow `story-tomorrow-review` (9 agents) | 5 confirmed and fixed: high, the call chased an unapproved $32.40; high, night chapters kept the paper-ground tokens; medium, played chapters started before they were on screen; medium, the dvh/svh mismatch between probe and pin; medium, a fit test that could not fail. 1 refuted. 9 unverified, among them U1 (Tomorrow on the timeline: kept on the founder's "Both, one chapter"; the food band fork stays open), U5 (rail jumps smooth-scrolled: first dismissed wrongly, then fixed) and U6 (a font swap changing a picture's height: fixed, the observer watches the pictures) |
| 2026-10-28 | round 2, workflow `story-fix-verify` (9 agents) | 18 findings: 5 confirmed and fixed (high: a chapter that flipped kept its old clock, twice; high: keyboard focus landed on a half-drawn Approve; medium: a played stage started under the bar; medium: the rail at 3.58:1), 1 refuted, 12 unverified, of which focus dropped to `body` after Approve, the rail never clearing, a wrong test count and a stale line cite were also fixed; 21 mutations added |
| 2026-10-28 | round 3, workflow `story-round2-review` (8 agents) | 9 findings, 7 after merging: 4 confirmed medium and fixed (focused buttons under the bar, twice; Shift+Tab and Undo under the bar; the flip test watching one chapter only), 3 low, unverified and fixed (the rail blank over the dusk band, the untested `:focus-visible` throw, the bar test only at 64 px). The executor's own Chromium re-measure then found the reader losing their place when the browser moved them first (a shorter page, a rotation anchor); fixed with the size-guarded scroll note above |
| 2026-10-29 | CI on draft #697 (Auto-fix, CI failures only) | 7 web tests and 2 e2e tests red, all caused by this PR, all fixed without loosening a guard: the landing and story captions moved from `--ink-3` to `--ink-4` (OD-112: `--ink-3` is decorative-only, and on the paper ground it is under AA); the scope roots lead with `mdv-landing`, the class that paints the ground, and a comment the ground scan misread was reworded; `/` became a pathless `RootDoor` layout with the dashboard as its `path="/"` child, so the tour-anchor scan finds the dashboard again [corrected 2026-10-29: that broke ADR 0320's locked claim ADR-0320-ROOT-IS-ROOTDOOR (the dashboard is `/`'s index child) and was reverted; the anchor scan now reads a layout route through its `index` child instead, with a scan test that fails without it]; `story` joined the vercel.json SPA rewrite; the e2e spec now expects the landing at `/` and opens the form at `/register?type=new`. Web vitest 5694 passed, 11 skipped. The gateway commodity spec that failed on an earlier run passed on this head (279/279) and was not touched |
| 2026-10-29 | CI on draft #697, second pass | The claims guard caught the route reshape above (reverted, see the bracket). The gateway's `commodity-alert.service.spec.ts` failure is a clock time-bomb, not this PR: its fixture's newest month is 2026-08 and the series allow 70 days, so on the real clock it went stale on 2026-10-10 and fails on `main` too (main's last CI run, 2026-10-09, predates that). The spec now pins Date to the fixture's date (2026-09-05), faking nothing else; 10/10 pass. Web vitest 5695 passed, 11 skipped; claims 1021/1021 |
| 2026-10-29 | post-merge CI review of #699 | Flagged a clause in the merge bullet above that characterised the API merge route; that clause is removed on `fix/register-door-followups` and the merge facts stay, with the two answers above |
| 2026-10-29 | CI audit gate on #700 at 2e52c4a58 | BLOCK, two findings, both acted on: the auth store's boot load and the API client reacted to a dead session in two different ways (the store only declined to navigate), so one ordering of the two left the stale person behind; both now call `leaveDeadSession`. And three mechanics had been chosen by the implementer and only named here (a once-per-tab reload, a `/login` fallback when `sessionStorage` is blocked, judging each request by the page it was sent from); they are removed, not filed, since the reload cannot repeat once no tokens are left and the page judged is the one the person is on, as the pick says. The persist key is now one constant, the `/login` path clears the persisted person too, and the registry's docblock names ADR 0344 |
| 2026-10-29 | CI audit gate on #700 at 445087932 | BLOCK with no finding: the correctness reviewer's output could not be parsed; the other two approved with notes. One note acted on: the `ADR-0344-PUBLIC-REGISTRY-MEMBERS` check matched paths only at four-space indentation, so an entry written another way could join the stay-put set unseen; it now reads every `path:` in the registry whatever its spacing or quotes, and fails on any value that is not one of the six. |
| 2026-10-29 | Local ADR 0090 gate on #700 at 5951748a3 (founder: "Local gate, then merge", after the CI gate's correctness angle came back unparseable twice) | Notes acted on before the final call: this answer's text said the API client and the auth store were the only places that learn a session is dead, and `AuthContext` is a third; the text now names it and what it leaves, and names the remembered house `leaveDeadSession` keeps. The `ADR-0344-PUBLIC-PAGES-STAY-PUT` check counted the client's call but not where it sits, so moving it out of the 401 branch passed; it now requires the call inside `status === 401`. |
