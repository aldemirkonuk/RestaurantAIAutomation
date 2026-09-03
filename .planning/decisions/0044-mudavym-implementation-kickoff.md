# 0044 — Mudavym design implementation kickoff

- **Status:** Locked (scope + rollout mechanics) · pages themselves remain founder-reviewed per flag flip
- **Date:** 2026-08-30
- **Decider:** Aldemir (founder), 2026-08-30 — four explicit answers, recorded verbatim below
- **Keywords:** implementation, feature flag, dashboard, orders, wordmark, motion map, TradeZella, seal
- **Links:** [[0042-iznik-seal-and-warm-charcoal]] (palette, locked), [[0043-mudavym-mark]] (mark, withdrawn — 41–43 land from the parallel design session's branch), `06-pages/MAKEOVER-VERDICTS.md`, `06-pages/DESIGN-FOUNDATION.md`, sketch `087-mudavym-motion-canvas`

## Context

Three sketch waves produced a decided palette (ADR 0042), a motion canvas of 133 live
demos with a founder-curated shortlist, and a page-by-page verdict sheet. On
2026-08-30 the founder ended the document-only phase: *"let's start to kick off, and
let me see those in actual files, in actual pages"* — with the standing instructions
to keep asking questions and keep documenting.

The founder also uploaded his own curated motion canvas
(`.planning/Mudavym Motion Canvas.dc.html`, 85 demos, 2026-08-29) and said it holds
*some* of the motions he really liked — making that file a curation signal, including
twelve "unafraid" signature ideas that exist nowhere in the 087 set.

## Decision — the founder's four answers, 2026-08-30

1. **First pages: Dashboard + Orders**, on a shared foundation (tokens, motion
   primitives, seal component) that ships first and that both pages consume. The
   Dashboard carries the verdict sheet's one big ask — the TradeZella-style sales
   calendar the founder called *"an important thing for me"* — plus the liked
   "Good evening / before service" opening and "Waiting on you" panel. Orders carries
   the seal ceremony, hold-to-approve, and the never-looks-sent AI-draft guardrail.
2. **Rollout: feature flag per page** — key `mudavym_design_<page>` in the existing
   per-restaurant feature-flag store, with a per-browser dev override, and a
   `PageGate` component swapping legacy/new. **Plus a second scope the founder named:
   a per-page motion map** — every rebuilt page documents *which motions it uses*.
   Convention: a **"Motions used"** table in that page's `06-pages/<slug>.md` note
   (id · name · where it fires), maintained the same way as §1a Features.
3. **The mark: build now, wordmark-only.** ADR 0043 is withdrawn and its successor
   has no vector source; pages ship with the "Mudavym." wordmark (Plus Jakarta Sans
   800, tracking −0.02em, İznik full stop) and no monogram. The seal *ceremony* is
   unaffected — the die (M above double rule) is specified by the sketches. The
   monogram slots in as a single swap when its vector exists.
4. **The uploaded canvas is curation.** What is on it is what the founder liked. Its
   twelve unafraid signatures port into 087 as `sig-17`–`sig-28` (part `sig-d`), and
   the canvas joins the makeover verdicts as a binding reference for implementation
   taste.

## Mechanics

- Branch `feat/mudavym-design-p1`, grown in an isolated worktree; additive only —
  zero visual change to any page whose flag is off. Old pages must render
  byte-identically.
- Motion runs on CSS + WAAPI with springs sampled into `linear()` easings — **no new
  npm dependency**; adopting the `motion` package is a separate, later decision.
- Foundation lands first (`src/styles/mudavym.css`, `src/lib/mudavym/*`,
  `src/components/mudavym/*`), then Dashboard and Orders build on it in parallel.

## Consequences

- **Easier:** page-by-page founder review in the running app (flip a flag, judge,
  flip back); the motion map makes every page's movement auditable against the canvas.
- **Harder / given up:** two rendering paths per flagged page until cutover; flag
  hygiene becomes real work; the monogram-shaped hole in the chrome until ADR 0043's
  successor gets a vector.
- **Numbering debt, recorded:** sketches 053–057 were claimed by agenda-canvas work
  on `main` while the design sketches 053–063 lived on the unpushed
  `docs/mudavym-design-kickoff` branch — the design sketch directories must be
  renumbered (or the collision otherwise resolved) before that branch lands.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-30 | Aldemir (founder) | Chose Dashboard+Orders, flag-per-page + motion-map scope, wordmark-only, canvas-as-curation |

## Addendum — the collaborative integration plan (2026-08-30, cross-session)

The founder asked the sessions to work as one makeover. Coordinated by message with
the brand session(s) (`feat/mudavym-brand`) and the sketch session; agreed:

**Landing order.** `feat/mudavym-brand` lands first (shell-only re-skin + rename,
green, already deployed to dev.mudavym.com). `feat/mudavym-design-p1` rebases onto it
afterwards. **Never push to `feat/mudavym-brand`** — that branch name publishes to the
founder's dev URL.

**Rebase facts, from the brand owner + a merge-tree rehearsal.** Only
`tailwind.config.js` truly conflicts (both add scales in the same block). Absorb on
rebase: İznik sits at **wine/brand-600**, not 500 (500 is interpolated `#3D8794`;
400 = `#5FB0BC` dark primary); `red-*` is now the DANGER family, no longer
brand-adjacent; `globals.css` shadcn vars were rewritten to the charcoal set;
`BrandMark` changed contract from square glyph to wide text wordmark (call sites
already fixed on the brand branch); 49 files carry rename strings — expect trivial
string conflicts only. After rebase: re-verify the byte-identical-legacy claim (the
ground under `.mudavym` scopes changed) and rerun `scripts/check_citation_pairing.py`
(the brand branch repointed 44 citations and added OD-111 to the register).

**ADR numbering.** The canonical 0043 is the brand branch's
`0043-wordmark-interim-logo-search.md` (committed + pushed). The uncommitted
`0043-mudavym-mark.md` in the shared checkout (the withdrawn slab story) is the brand
session's to reconcile; its withdrawal narrative — the founder rejecting a VS-Code
lookalike, and his four craft criteria — feeds OD-111 as selection criteria. This ADR
(0044) is confirmed non-colliding.

**The mark, resolved procedurally (2026-08-30).** The founder **skipped the slab
monogram entirely** — no raster, no trace. The logo decision runs as an elimination
round on OD-111's candidate artifact (owned by the brand session), joined by the
sketch lineage's candidates (083 lockups, the Meter, the Full Stop) extracted as
clean SVGs. The founder's four withdrawal criteria are the bar: counters must not
clog at 16px, no asymmetric cutouts, uniform weight, reads M first. Supporting
evidence available to the round: `082-.../ledger-scene.png`, the generated photograph
in which the model unprompted drew the 083 lockup as a wax seal on a leather ledger.

**Sketch renumbering (owned here).** `main` occupies sketches 053–076; the design
sketches renumber **053–063 → 077–087** (077 habitue · 078 instrument · 079 cellar ·
080 pass · 081 ledger · 082 3d-marks · 083 house · 084 anatolian · 085 guestbook ·
086 warmmachine · 087 motion-canvas), with every cross-reference — MANIFEST rows,
notes, motion.json citations, and the two assembly scripts — rewritten in the same
commit before `docs/mudavym-design-kickoff` goes up.

**Page claims across sessions.** This session: dashboard, orders, receiving,
receiving-door. Brand session: shell, palette, rename, decisions 0041–0043, OD-111.
Sketch session: documentation only. Unclaimed and open: receipts (the founder's most
demanding brief), documents-reports (three sketches asked), communications +
providers (MERGE verdicts), team (+3 ideas), inventory, wine-agent scope.

---

## Status — 2026-08-30, published for review

Founder's order: **push what exists, merge nothing.** Both branches are now on
origin, unmerged, awaiting his review and the OD-111 elimination:

- `feat/mudavym-design-p1` — P1 (`23d24c5d`: foundation + DashboardNext +
  OrdersNext) and P2 (`f5b38edb`: ReceivingNext + DoorNext) behind per-page
  flags, all defaulting OFF; plus the Fraunces-600 wordmark fix (`a9226b23`).
  Flags off, every legacy page is byte-untouched — pushing this changes
  nothing user-visible anywhere it deploys.
- `docs/mudavym-design-kickoff` — the design corpus: sketches **077–087**
  (renumbered clear of main's 053–076 in `ca54f3bb`), DESIGN-FOUNDATION
  §0/§0a, and the two P2-found defects in v3.0-TECH-DEBT (`1d7b53ad`).

Landing order is unchanged from the addendum above: `feat/mudavym-brand`
first, then this branch rebases onto it (tailwind scales, İznik@600,
citation guard, byte-identical legacy re-check) before any merge is
proposed. `feat/mudavym-brand` remains the one branch this session never
pushes to.

## Status — 2026-09-02, wave 4 built, founder review open

Seven more pages are built behind their own flags on `feat/mudavym-design-p4`
(cut from main `77eb7888`): `/reports` (MERGE), `/notifications` (REWORK),
`/recommendations` (REWORK), `/calendar` (KEEP), `/settings` (KEEP Editorial +
"more"), `/profile` (KEEP+ with MCPs · linked accounts · payments), and `/cellar`
as the parent of `/wines` `/beer` `/whiskey` `/cocktails` (REJECT the crowded
design, IA decided). Mechanics unchanged from §Mechanics: one `mudavym_design_<page>`
flag each, OFF by default, columns added by a NEW migration
`20260902230000_mudavym_design_flags_p4.sql` (the applied 20260831090000 file is
not widened — an edited applied migration reads as ownerless to parity); legacy
pages byte-untouched; per-page `06-pages` note carries §1a/§1b/§8/§9/§13; every
page directory is now in `check_no_seeded_defaults.py`'s `SCAN_ROOTS`.

Page-choice reasoning (a judgment call, recorded here rather than as a new ADR):
the wave took every page with a REWORK/MERGE/KEEP+ verdict that had no build
yet, plus the two the founder named most strongly (`/calendar` as the one page
liked unreservedly, `/cellar` as the decided IA). Left for the next wave:
`/login` + `/register` ("the most important step" — improve today's, not a
Next), `/onboarding` (five sketches asked for), `/vendor-prices`, `/promotions`,
`/wine-agent` (the general chatbot, scope defined, name open), `/sommelier` (HOLD).

Review protocol as before: Sonnet audit per page (all seven ran; defects sent
back to the builder and fixed with tests), founder elimination on the gallery
artifact **Mudavym Wave Four**
(<https://claude.ai/code/artifact/fb2f9455-8d35-411c-85c9-cfb0dbbf7abe> — update
that URL, never republish new), which records the founder's per-page call
(Keep / Rework / Merge / Hold + note) in the artifact's own store. The competitor
reference the founder asked for is DESIGN-FOUNDATION §6 (48 sources); its
cross-page finding — provenance, not arrangement, is the differentiator on six of
the seven surfaces — is the design position this wave built to.

Shortcuts and overruns, stated: every page is over the ~900-line guidance the
brief set (1,340–2,360 lines); the builders each cut once and declared the
remainder genuine surface. Three page notes were corrected mid-wave because the
brief's premises were stale (recommendations was not broken; the reports mock
answerer and unwired generator were already gone). `/settings` failed its first
audit on five false provenance claims — the fix is to grep every runtime
(orchestrator and mobile included) before calling a setting "read by nothing".

### Wave 4, second pass — 2026-09-03, after the founder's review

The founder reviewed the seven pages on the gallery and asked, per page: no
emojis anywhere (real icons); one-tap actions to move out of the day-book;
`/reports` to let a reader change a cutting's graph type or its analysis while
arranging, with many detailed graphs and drag kept; `/recommendations` to make
dismissal binding on the engine and its sentences solid; two full-picture
sketches each for notifications, recommendations, settings and the cellar
(screenshots only); `/profile` at the standard of a $100B startup with MCP
servers and payment types real; the cellar to adapt to what each house carries;
and every "honest about" line closed with a profound fix rather than an em dash.
Founder calls recorded that day: one-tap → the dashboard rail; cellar registers
in their own table, inferred then confirmed at onboarding, shipped gated with
OD-113 next; dismissal asks its scope per dismissal; gap depth = small fixes
first, then the four large builds (Stripe live, server-side reminders, full
beverages catalogue, MCP runtime) plus a Mudavym MCP server documented only.

What the pass measured and changed: the emojis were producer-written
notification titles (100 of 100 rows on production's first page), fixed at
twelve producer sites with a guard spec; the founder's example insight
sentence was a live zero-fill bug on the gateway, and a third reader (the
persisted `analytics_insights` cache) kept serving it until every row carried
its generator version; `/settings` had asserted five false provenance claims
and now greps all four runtimes before calling a setting dead; the team roster
had been empty for every tenant in production (a column its table never had,
swallowed into `[]`, and listed as known debt in the guard's own list) — PR #287;
`?limit=` on calendar events 400'd for every caller. Sonnet re-audits ran on
every page after the pass and every finding was closed or filed. The branch
took main by merge (`e4c753f8`) rather than rebase, because six builders were
editing the worktree. Sketches 089–092 registered by the parent in MANIFEST at
PR time. The four large builds run as their own ADRs (0102 onward).
