# 079 · mudavym-cellar — The Cellar (brand direction 05 of 5)

Dark-first atmospheric depth. The product's home is the room where a restaurant already
keeps its most valuable things: dark, calm, temperature-controlled, lit by one flame.
Dark is the **primary** theme — authored for the hours the product is actually used
(prep through close) — and light ("the doorway") is derived from it, not designed twice.

## The three defining calls

1. **The accent is the candle, not the wine.** Amber (`#E5A44C` dark / `#A96F1E` light)
   is the single luminous accent; wine lives in the *darkness itself* — every near-black
   ground is tinted toward warm wine (`#171010`, `#201616`), never gray. This inverts the
   incumbent burgundy identity (#9E4249/#CD2D5B) instead of extending it: wine is
   atmosphere, flame is signal.
2. **Attention = the accent.** There is no separate "warning" hue. A thing that needs a
   decision is candle-lit; danger is red and rare; settled is green. This resolves the
   classic amber-accent/amber-warning collision by making it a feature: on a busy Friday
   the only glowing thing on screen is the next thing that needs your hand.
3. **Low-glare by construction.** No pure white anywhere in dark mode — ink tops out at
   `#F3EAE0`; borders are warm-white alphas ("candlelight on the wall"), the vignette is
   a 5% radial. Legibility is carried by a 4-step ink ladder and mono tabular numerals,
   not by brightness.

## Research moves used (cited by name)

From `research-reference-aesthetics.md` (pick-list numbers):

- **Accent-tinted deep-ink dark mode** (#6, motion.dev) — the load-bearing move of the
  whole direction: near-blacks biased toward the house hue, borders a step lighter in the
  same hue. Adapted: one house scheme (wine-dark ground + candle accent) instead of
  per-domain schemes; per-domain accents are named below as a held option.
- **Warm-paper neutral system** (#2, manus) — used twice: inverted to build the dark ink
  ladder (#F3EAE0 → #665B52), and used straight as the derived light theme
  (#F7F1E6 paper, #221812 → #B0A497 ink).
- **Semantic color + matching tint pair** (#3, manus) — every hue ships with its 10–14%
  alpha twin (`--candle-tint`, `--settled-tint`, `--danger-tint`); state color never sits
  raw on the ground.
- **Serif greeting over one input** (#1, manus) — Fraunces speaks only when the product
  does: "Good evening, chef." on the dashboard mock; sans works, mono counts.
- **Mono micro-kicker vs display** (#7, motion.dev) + **Small hero, dense catalog**
  (#15, bklit+manus) — 11px uppercase JetBrains kickers against a 44px serif hero;
  deliberately NOT the 120px showroom scale (research warns it exhausts staff mid-shift).
- **Fast-out settle easing everywhere** (#9, motion.dev house curve) —
  `cubic-bezier(.16,1,.3,1)` at 140–420ms is the entire curve family; hovers move ≤2px.
- **Clip-path/unmask reveals** (#10, motion.dev) — the row-expand opens by grid-rows
  unmasking (a door swung open), not by fading.
- **Grayscale data, chroma = anomaly** (#12, bklit) — chart ramp is warm-gray stone;
  the sixth swatch (candle) is the only colored series, reserved for the anomaly.
- **Hairline-rule structure** (#14, bklit) — sections and order rows separated by 1px
  translucent rules; borrowed the discipline, not the radius-0 severity (research warns
  terminal-brutalism alienates hospitality; radii here: 4–12px, softest on touch controls).
- **Thinking shimmer** (#4, manus) — the "AI draft ready" chip carries a slow gradient
  sweep; `ember` (breathing glow) replaces every spinner.
- **Balanced-antithesis tagline / Name-period** (#17) — S2, S4, S5.
- **Deadpan brand, quoted warmth** (#18, bklit) — voice rule 4; the only italic serif in
  the mocks is the vendor's quoted sentence in the thread drawer.
- **Kbd-hint mono chrome** (#16, bklit) — ⌘K lives permanently in both mock headers.

From `research-stars-motion.md`:

- **Interruptible spring philosophy** (react-motion star → `motion` library, §2, §5) —
  all motion tokens are expressed as stiffness/damping pairs first, CSS beziers second,
  so the same physics vocabulary ports to Reanimated `withSpring` later (§5 RN note).
- **Hold-to-confirm** (motion.dev Interactions; kokonutui `hold-button`, §4 Command) —
  the approve action and the vendor-reply send are hold-to-complete, killing confirm
  dialogs; also honors the email-layer guardrail (never auto-send — one deliberate
  human gesture per outbound message).
- **Number tickers via spring + tabular-nums** (motion.dev AnimateNumber; §4 Command
  rebuild note) — the `pour` demo is a literal damped-spring integrator, JetBrains Mono
  tabular so digits never shiver.
- **Motion tokens as the portable unit** (§5) — the six named tokens below are the
  contract; `motion` mappings are printed in the board's token table.

## Token summary (authoritative values live in index.html `:root`)

| role | dark (primary) | light (derived) |
|---|---|---|
| bg-vault / bg / surface / surface-2 | #0F0909 / #171010 / #201616 / #2A1D1B | #EDE4D6 / #F7F1E6 / #FDFAF3 / #FFFFFF |
| ink hi/mid/low/faint | #F3EAE0 / #C9BCB0 / #96897E / #665B52 | #221812 / #52463C / #83766A / #B0A497 |
| candle / bright / tint / ring | #E5A44C / #FFC474 / @10% / @40% | #A96F1E / #C2882B / @12% / @35% |
| settled / danger | #9BBF7E / #E4635C | #5E8C43 / #C24A43 |
| border | #F6D9B8 @10% | #3E2A1C @12% |

Derivation rules (not a second palette): light grounds = dark grounds' hue at paper
lightness; ink ladder inverts step-for-step; candle drops ~2 lightness steps on paper
(dark-theme amber #E5A44C fails contrast as text on paper — always re-tokenize, never
reuse the hex). Charts stay grayscale-warm in both themes.

Type: **Fraunces** (voice — product speaking only) · **Hanken Grotesk** (all interface) ·
**JetBrains Mono** (ledger: money, counts, IDs, time, kickers; tabular-nums always).
Scale: hero 44 serif → display 32 serif → title 24 → heading 18 → body 15 → small 13 →
caption 12 → data-lg 28 mono → data 14 mono → kicker 11 mono (+0.14em, 11px floor).

Motion: `strike` 140ms (.16,1,.3,1) · `settle` spring(260,32) · `hearth` 420ms
(.25,1,.5,1) · `pour` spring(90,22) · `ember` 1.9s mirror loop (replaces spinners) ·
`stagger` 30ms first-paint. Transform/opacity only; `useReducedMotion` gates all
(the board's own JS honors `prefers-reduced-motion`).

## Voice guide (full)

**Register.** The maître d' at 9pm on a good Friday: quiet, precise, already knowing
what happens next. If a line would sound wrong said softly across the pass, rewrite it.

**Rules.**
1. *Calm is the register.* Second person, present tense, no exclamation marks, ever.
2. *Verbs first, outcomes over features.* "Approve the reorder", never "Reorder
   approval workflow". Sentences start with what the reader does or what the house did.
3. *Numbers do the boasting.* "12 bottles · $930 · Thursday" is the eloquence. No
   adjective where a figure can stand; the brand never says "powerful" or "smart".
4. *Deadpan house, quoted warmth.* Mudavym's own copy stays terse; warmth enters only
   in quotation — a vendor's reply, a staff note, the agent's drafted words.
5. *Three voices, three faces.* Serif only when the product speaks (greetings,
   questions, decisions asked). Sans works the interface. Mono keeps the ledger.
6. *Always say what happens next.* Every message ends on a state or an action, never an
   apology. "It lands here" beats "sorry, nothing to show".
7. *A candle, not a siren.* Needs-a-decision is lit amber, calmly. Urgency words (now,
   immediately, warning) are reserved for genuine danger — red, and rare.
8. *Empty states set the table.* Say what will appear and how to summon it sooner.

**Canonical rewrites.**

| incumbent | cellar voice |
|---|---|
| Draft, approve, and track purchase orders through delivery | Draft it, approve it, watch it arrive. |
| Alerts that need a decision, oldest first | Waiting on your call — oldest first. |
| No checks yet — close an order from the terminal | No checks yet tonight. Close one at the terminal and it lands here. |
| No comparable data | Nothing to compare yet — history builds every night. |
| Permanently delete your Mudavym account. | Delete your account, permanently. Orders, ledgers, history — all of it goes, and none of it comes back. Export the books first if you need them. |

**Do / don't.** Do: contractions, "the house", "tonight", concrete times ("arrives
Thursday"). Don't: "oops", "uh-oh", "supercharge", "seamless", "!"; don't apologize for
empty data; don't let the brand compliment itself — quote someone instead.

## Slogans (ranked)

1. **The cellar remembers.** — flagship for this direction; heritage + the literal
   product promise (nothing is forgotten) in three deadpan words.
2. The house that runs itself. — autonomy claim in hospitality's own vocabulary.
3. Every night, like a regular. — the müdavim etymology as a reliability promise.
4. Less counting, more cooking. — balanced antithesis; most campaign-ready.
5. Set the table. We'll keep the books. — division of labor; warm, not self-praising.
6. Your back of house, front of mind. — sales-deck use, not in-app.

## Logo verdict

A (Vault & Flame) is primary — scales to favicon, and the flame alone is an app icon.
B (Regular's Ring — the ring a glass leaves; the seat always kept) has the strongest
story and the quietest form; strongest candidate if the founder wants the etymology to
lead. C (Ember M) is the conventional fallback. All three: ink strokes via
`currentColor`, flame always `--candle`, shown on both themes in the board.

## Risks / open questions for the founder

- **Service-hour legibility is the bet.** The board argues dark-primary works because
  ink is warm-high-contrast and the accent is singular — but this needs a floor test on
  a real tablet at real restaurant brightness (the direction's own success question).
- Amber-as-attention means promotions/marketing surfaces can't casually use amber for
  decoration — the accent is semantically load-bearing. Accept before adopting.
- Per-domain sub-accents (motion.dev's data-scheme move: e.g. sommelier = wine-rose,
  receiving = green-tinted ground) are compatible with this system but deliberately NOT
  included — one candle first; held as a v2 option.
- Fraunces at hero sizes is characterful; if it reads too "wine label" in testing, the
  nearest quieter swap is Source Serif 4 (bklit's accent voice) with no scale change.

Shortcut declared (per CLAUDE.md §0.5): contrast ratios were reasoned from luminance,
not run through a checker; the light-theme candle (#A96F1E on #F7F1E6) sits near the
AA text threshold and should be verified before any build adopts it.

| 079 | mudavym-cellar | Dark-first atmospheric depth — can a cellar-dark theme be the daily default without losing service-hour legibility? | null | brand, mudavym, cellar, dark-first, atmospheric, accent-tint, od-106 |
