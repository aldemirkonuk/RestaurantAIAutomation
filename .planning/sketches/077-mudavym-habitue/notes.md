# 077 — The Habitué · rationale and voice guide

Direction 1 of 5 for the Mudavym brand (OD-106 co-design input; sketch, not build).
Thesis: the müdavim — the regular the house knows, who knows the house — is not a
naming anecdote but the entire brand system. Every layer (logo, voice, palette,
type, motion) answers one question: *how would the restaurant's most loyal regular
behave if it were software?* Warm, specific, present every day, never loud.

## Research moves used (cited by name)

From `research-reference-aesthetics.md` (transferable-moves pick-list):

- **Serif greeting over one input** (manus) — the core move of this direction. The
  dashboard opens with a Fraunces greeting ("Good evening, Aldemir.") — the product
  speaks first, as a host. Adapted, not copied: manus's empty-hero sparseness is
  explicitly rejected for working screens (the research's own "do NOT copy" note);
  here the serif line sits *above* a dense KPI grid.
- **Warm-paper neutral system** (manus) — #F6F3ED paper ground, a 4-step ink ladder
  (#262019/#5A5142/#8B8171/#B5AB9A) shared by text and icons, and surfaces as 6–14%
  alpha tints of a warm ink (#3B332A) rather than painted grays. Warmed a step
  creamier than manus's #f8f8f7 to read hospitality, not office.
- **Semantic color + matching tint pair** (manus) — every status hue (ok/warn/bad)
  ships with an 11–15% alpha twin; state color never sits raw on the page.
- **Thinking shimmer** (manus) — the AI's only permitted motion while working is a
  light-sweep across serif-italic text ("Totting up the night…"); no spinners.
  Demoed live in §06.
- **Accent-tinted deep-ink dark mode** (motion.dev) — dark is not gray: #171210 is
  biased toward the wine/amber axis, surfaces #201913/#2A2119 likewise ("the dining
  room at 1 a.m., not a code editor").
- **Fast-out settle easing everywhere** (motion.dev) — cubic-bezier(.16,1,.3,1) at
  180–320ms is the house curve ("settle"); hovers move 1–2px; nothing oscillates.
- **Small hero, dense catalog** (bklit + manus) — the greeting caps at 40px, the
  scale tops out far below showroom sizes; authority by restraint.
- **Balanced-antithesis tagline** (manus + motion.dev) — slogan S5 "Less counting,
  more cooking" uses the "Less X, more Y" structure directly.
- **Numbered-index sections** (motion.dev) — the board itself is organized 01–07
  with mono kickers; proposed as a reusable motif for onboarding and reports.
- **Mono micro-kicker** (motion.dev) — 11px uppercase IBM Plex Mono at +0.15em as
  the system/metadata voice, against tight-tracked serif display. The ratio is kept
  gentler than motion.dev's 10:1 (theirs is showroom volume; ours is a dining room).
- **Deadpan brand, quoted warmth** (bklit) — *inverted deliberately*: this
  direction's bet is that warmth belongs in the product's own first voice, not only
  in quoted humans. The inversion is contained by voice rule 01 (serif appears at
  most once per screen) so the ledger register stays deadpan.

From `research-stars-motion.md`:

- **Interruptible spring physics as the motion model** (react-motion → `motion`
  lineage; the founder starred the philosophy) — "tuck" (stiffness 380, damping 32)
  and "pour" (120/20) are real springs, demoed with a rAF spring integrator using
  the exact numbers the React build passes to `type:"spring"`. Near-critical
  damping honors the cross-site finding "ease-out family, no bounce."
- **Motion tokens as the portable unit** (§5 of the stars research) — the five
  named tokens (settle, tuck, pour, greet, shimmer) are defined as a single
  vocabulary that maps 1:1 to `motion` transitions today and Reanimated
  `withSpring` on RN later.
- **Number tickers on KPI cells** (motion.dev AnimateNumber pattern, free rebuild
  via `useSpring` + tabular-nums) — the "pour" demo is exactly this rebuild.
- **useReducedMotion gate from day one** (§5) — the board's own JS and CSS both
  honor `prefers-reduced-motion`.

## Design decisions and why

- **Name lore made visible.** Three logo concepts, each a different reading of
  müdavim: (A) the Kept Seat — a table with one chair always held; (B) the Tally —
  the regular's tab in chalk, fifth stroke in wine; (C) the Homecoming Dots — the
  ü that "Mudavym" dropped, restored as a mark. Recommended: A primary, C as app
  icon (the two dots double as a thinking indicator).
- **Palette breaks from the incumbents.** #9E4249/#CD2D5B are replaced, not kept —
  but the brand color stays in the wine family (**house wine #7A3E47**, candlelit
  #C9868F in dark) because the wine-cellar heritage is real product surface, not
  nostalgia. One accent + brass (#A87B3F) as the only metal; neutrals do 95% of the
  work (cross-site synthesis).
- **Three type voices with a strict contract.** Fraunces = the house (speaks
  first, at most once per screen); Instrument Sans = the ledger (all UI); IBM Plex
  Mono = the receipt (figures, IDs, kickers). All Google-hosted. Scale:
  greeting 40 / display 28 / title 21 / subtitle 17 / body 15 / ui 14 /
  caption 12.5 / data 13 mono / kicker 11 mono.
- **Motion = staff, not lights.** State animates; decoration never does. Five
  tokens total; the grave register (destructive actions) gets no motion at all.

## Voice guide (full)

Two registers, strictly separated: the **house** (serif, warm, speaks first) and
the **ledger** (sans/mono, plain, never performs).

1. **Serif when the house speaks, sans when it works.** Greetings, hand-offs and
   moments of care are set in Fraunces; rows, totals and controls stay in
   Instrument Sans. If everything is serif, nothing is a greeting.
2. **Talk like a maître d', not a dashboard.** Second person, present tense, one
   clause where one will do.
3. **Verbs first.** Every actionable line opens with what happens: Approve, Close,
   Walk through.
4. **Warmth is specificity.** Name the vendor, the bottle, the shift — never reach
   for adjectives or exclamation marks instead.
5. **Numbers stay plain.** The tab is the tab: tabular figures, no celebration, no
   dramatizing a variance.
6. **Empty is expectant, not apologetic.** An empty state says what will appear
   here and how to invite it in.
7. **Grave things said gravely.** Destructive and financial actions drop all
   charm: plain words, full consequence, no softening, no serif, no motion.
8. **The Turkish stays a whisper.** The müdavim story appears at thresholds —
   first run, about, sign-off — never as a riddle in the middle of a working screen.

### The five rewrites

| Today | The Habitué |
|---|---|
| Draft, approve, and track purchase orders through delivery | Draft it, approve it, watch it arrive. |
| Alerts that need a decision, oldest first | Waiting on you — longest wait first. |
| No checks yet — close an order from the terminal | *Nothing on the tab yet.* Close an order at the terminal and it lands here. |
| No comparable data | Not enough history to compare yet. |
| Permanently delete your Mudavym account. | Delete your Mudavym account — permanently. Everything the house knows goes with it. |

(The last rewrite is rule 07 in action: the metaphor is allowed only because it is
the literal truth of the deletion.)

## Risks / honest caveats

- The serif-first warmth can curdle into preciousness at scale; rule 01's
  once-per-screen cap is the containment, and it must be enforced in review.
- The müdavim story requires a first-run beat to land for non-Turkish speakers;
  concept C carries it visually but copy must do it once, explicitly.
- Verified by static checks only (HTML tag balance, `node --check` on the script,
  45.4KB total); the Browser pane was unavailable in this worktree agent context,
  so the live demos were not screenshot-verified.

| 077 | mudavym-habitue | Can the müdavim story carry the whole brand — warm editorial hospitality as the product's voice? | null | brand, mudavym, habitue, editorial, warm, serif, od-106 |
