# 062 — Mudavym: Warm Machine

Brand direction 062. The espresso machine as the model for the whole product: brass, steel,
a pressure gauge on the front, the group head where you can watch the shot pull — an apparatus
that hides nothing and exists entirely to hand someone a warm cup.

Premise in one line: **the mechanism is the hospitality — you can watch the agent read, reason
and draft, in the open, in numbers, and it is warm to look at while it does it.**

The thesis this board exists to prove: **the most technical direction can also be the warmest.**

## The 054 problem, and the answer

054 (The Instrument) reached for "technically superior" and landed cold; the founder kept only
its logo C, The Meter. This direction takes the same instinct — instruments, readouts, exactness
— and asks where the cold actually came from. It was not the precision. It was three specific
choices: neutral-grey neutrals, radius 0 on everything a hand touches, and a brand that refused
to author warmth (054's rule R-08: "warmth is quoted, never authored").

062 keeps the precision and reverses all three:

| 054 chose | 062 chooses | Why the warmth arrives |
|---|---|---|
| Neutral near-black `#0A0B0D`, neutral greys | **Roast** `#14100C` — coffee-black with brown in it; warm-grey ink ladder | Every surface has a temperature; nothing is neutral |
| Radius 0 everywhere, deliberately | **Chamfered** — 2px data / 4px panel / 8px touch | Machined edges, not sawn ones; answers 054's own open question about 11pm tablets |
| Flat surfaces, no light | **Specular top edge + a lamp over the working surface** | Metal catching light is the single biggest warmth lever, and it costs one inset box-shadow |
| No serif in the system | **Fraunces, once per screen, at the hand-off** | The moment the machine gives you something, it stops speaking like a machine |
| Warmth quoted, never authored | **Warmth in the verb, precision in the number** | The product may be kind; it may never be vague |
| Nothing springs; instruments settle | **Springs with mass** (stiffness/damping/mass) | Brass has weight; a gauge needle overshoots and comes back |

Also deliberately avoided, per the brief: the dark-mode-plus-neon-accent "AI product" look (there
is no `#6366F1`, no violet, no cyan, no glow-on-black anywhere), cold cyberpunk (the dark mode is
brown, not blue), and technical ornament (every mechanism element on the board reports a real
number — no fake waveforms, no decorative circuitry, no scanlines).

## Rationale — research moves used, by name

All moves cited from `research-reference-aesthetics.md` (the transferable-moves pick-list) and
`research-stars-motion.md`.

- **Move 4 — "Thinking shimmer"** (manus), promoted from a loading treatment to the direction's
  entire signature. manus sweeps a gradient across text to say "the agent is working"; 062 asks
  what happens if you show *what it is working on* instead. The Extraction demo is that answer:
  needle into the green band, five readings landing one at a time, the shot pouring, then a draft
  handed over. This is the direction's whole differentiator (slogan S-02, "You can watch it
  think") and the reason the motion system has a composite token.
- **Move 2 — "Warm-paper neutral system"** (manus), pushed materially further. manus tints
  surfaces as alpha washes of a warm ink `#37352f` on `#f8f8f7`; 062 takes the principle — never
  paint a neutral grey — and applies it in *both* directions, so the dark mode is roast
  `#14100C` and the light mode is crema `#F1E9DC`. A four-step warm ink ladder is shared by text
  and icons exactly as manus tokenises it.
- **Move 3 — "Semantic color + matching tint pair"** (manus): every accent ships with its
  8–13% alpha twin (`--ember-tint`, `--patina-tint`, `--scald-tint`, `--brass-tint`), so a state
  colour never sits raw on the page — the KPI tile, the decision card and the chip all use the
  tint as ground and the hue as edge.
- **Move 9 — "Fast-out settle easing everywhere"** (motion.dev), then argued *against* and
  replaced. motion.dev's `cubic-bezier(.16,1,.3,1)` is spring-flavoured without oscillation.
  This direction's premise is mass, so it uses **real springs** — the philosophy the founder
  starred in `chenglou/react-motion` ("stiffness + damping, let physics handle interruption",
  research-stars-motion §2) — with a documented CSS `linear()` sampling so the board's demos
  match the params rather than approximating them by eye. `press`, `pour` and `warm` stay
  beziers because key travel, money and light are not sprung objects.
- **Move 10 — "Clip-path reveals"** (motion.dev): row expands, the extraction result and the
  vendor drawer all *unmask* (grid-template-rows 0fr→1fr) rather than fade or slide. Nothing in
  this system fades in; parts arrive.
- **Move 7 — "Mono micro-kicker vs giant display"** (motion.dev), with the ratio compressed per
  **Move 15 — "Small hero, dense catalog"** (bklit + manus): 11px tracked mono kickers in brass
  against a display capped at 34px. Authority from density, not scale.
- **Move 8 — "One family, stretched"** (motion.dev): Bricolage Grotesque carries display through
  UI on its variable optical-size axis. The two counter-voices are strictly role-assigned rather
  than decorative (see Type below).
- **Move 12 — "Grayscale data, chroma = anomaly"** (bklit), adopted for charts only, not for the
  whole system. The chart ramp is five *warm* greys; hue enters a chart where meaning does. 054
  promoted this rule to the entire brand and that is precisely what made it cold — here it stays
  a charting rule and the brand keeps its metal.
- **Move 13 — "Chart-token vocabulary"** (bklit): `--ramp-1..5`, `--gridline`, `--crosshair`
  ship as first-class tokens so every viz across 40+ pages is one instrument.
- **Move 16 — "Kbd-hint mono chrome"** (bklit): ⌘K, `hold ⏎ to approve` and `J / K to move` are
  permanent 10px mono furniture in both sample screens.
- **Move 17 — "Balanced-antithesis tagline / Name. Category claim."** (manus + motion.dev): the
  only two slogan structures permitted. S-03 is Name-plus-claim; S-04, S-05 and S-08 are
  balanced antitheses.
- **Move 18 — "Deadpan brand, quoted warmth"** (bklit), partially rejected — and this is the
  direction's sharpest disagreement with the research. bklit keeps the brand deadpan and lets
  humans carry the warmth. 062 keeps the *quoted human* (the vendor's Spanish reply is the only
  serif sentence on the Orders strip) but **also lets the product author warmth**, bounded by
  V-02: every warm sentence must carry a figure. A brand that can only quote warmth cannot
  deliver the mandate's "giving of hospitality".
- **Move 1 — "Serif greeting over one input"** (manus), adapted: the serif greeting is kept
  ("Good evening, Aldemir.") but not the single-input hero. The research is explicit that manus
  can afford one object per screen because it is a chat product, and that ops pages need
  density — so the serif appears as a *greeting over a dense KPI grid*, not over an empty field.
- From `research-stars-motion.md` §4: number tickers on KPI cells (AnimateNumber Counter
  pattern, rebuilt free with rAF + a Newton-solved bezier + tabular-nums), staggered list
  entrance for the reasoning trace (Lists, 20–40ms → 90ms here because each line is a *reading*
  you are meant to read), sheet/drawer on spring for the vendor thread, and hold-to-confirm for
  irreversible sends. §5: the motion token file is the RN-portable unit, so `motion.json` ships
  stiffness/damping/mass rather than durations.

**Deliberately rejected:** per-domain accent theming (Move 5) — with brass as a material and
ember as the single heat source, a per-domain hue would break law ② and turn heat into
wayfinding; accent-tinted deep-ink dark mode (Move 6) in its *neon* reading — the dark mode is
tinted, but toward roast rather than toward an accent; and radius-0 hairline brutalism (Move 14)
on touch controls, which the research itself warns against and 054 carried anyway.

## Identity

- **Name story used:** müdavim = the regular, the one the house counts on. The espresso machine
  is the object every regular's habit is built around — the same machine, the same bar, the same
  order, for years. That is what the marks draw.
- **Logo concepts (all three fully resolved, light + dark, on the board):**
  - **A — The Manifold** (primary product mark). The M brazed out of pipe: two risers, elbowed
    over, joined at a brass centre fitting. Round joins, 6px stroke. Live state: the centre
    fitting fills ember while an agent is running, so the mark is itself a status lamp.
  - **B — The Gauge** (favicon / app icon). An M inside a brass bezel with its valley exactly on
    the pivot, so the letter's right arm *is* the needle — and it points into the patina
    extraction band at 9.1 bar. Bezel carries the two bands every espresso gauge carries
    (patina = working, scald = over-pressure). The mark is never neutral: it always shows the
    machine in the green. Verified geometrically: the needle tip sits at r=33.2 against a band
    inner edge of r=38.25 — a deliberate 5px gap, so the arm points *at* the band without
    touching it.
  - **C — The Group Head** (marketing / packaging lockup). Brass group bar, three streams of
    unequal length — the order, the count, the reply — and the cup that catches all of them,
    with an ember crema line. The direction's argument as one picture: apparatus at the top,
    something warm handed over at the bottom.
- **Wordmark, two registers.** Product register: Bricolage Grotesque 600 at −0.03em, always ink.
  Stamp register: IBM Plex Mono 500 in brass at +0.57em tracked caps — reserved for the
  machine's own output (printed POs, exported receipts, the top bar). Brass belongs to the stamp
  register only.

## Palette

Built from scratch. No inherited burgundy, no indigo, no violet, no startup blue, no neon.
Dark is home. Full token set is in `index.html` §04; the shape of it:

| Token | Dark — "Roast" | Light — "Crema" |
|---|---|---|
| sunk / panel / surface / raised | `#0E0B08` / `#14100C` / `#1C1712` / `#241E17` | `#E5D9C7` / `#F1E9DC` / `#FCF8F1` / `#FFFDF8` |
| rule / rule-strong / brass-rule | ink 10% / 20% / brass 30% | ink 13% / 26% / brass 34% |
| specular (the light on a machined edge) | `#FFEED6` 13% | white 85% |
| ink ladder | `#F6EFE4` · `#CDBFAD` · `#9C8D7C` · `#8E7E6B` | `#221A11` · `#4E4234` · `#6F6252` · `#7F6F59` |
| **brass** (material) | `#C39A4E` (dim `#8A6C36`) | `#7E5A18` (dim `#B79A63`) |
| **ember** (heat — working, or waiting on a human) | `#F0743A` | `#B54210` |
| **patina** (oxidised copper — settled, healthy) | `#55B394` | `#186751` |
| **scald** (over-pressure — irreversible money) | `#E4515B` | `#A81C26` |
| chart ramp (warm greys, 5) | `#E9DFD2` → `#473D33` | `#2E251A` → `#DCD1BC` |

**Why this accent set is outside the usual startup palette.** The four accents are not chosen
from a hue wheel; they are the four things that happen to metal in a café. Brass is the alloy
every lever machine is fitted with. Ember is hot metal and the colour of the shot. Patina is
what copper does over years of service — which is also the only correct colour for "this has
been running fine for a long time". Scald is what the machine does when you get it wrong. Nobody
ships a SaaS palette of ochre / burnt-orange / verdigris / oxblood, and that is the point: the
brand is recognisable from a 200px screenshot.

**The four laws** (also stated on the board):
1. **Brass is a material, not a state.** It draws bezels, stamp type, section hairlines and the
   fill on primary buttons, and it never means "something happened".
2. **Ember means a human is required.** It marks what the machine is working on or waiting on —
   never a status, never a brand moment. Tiles may *count* what is waiting; only one card per
   screen may *ask*. (First drafted as "one ember per region", which the Dashboard mock
   immediately violated with two waiting tiles — the rule was wrong, not the mock.)
3. **Patina is the resting state**, so a healthy screen is warm-grey and green, never blank.
4. **Scald is reserved for money that cannot come back.**

Contrast, measured in-page against `--surface` (dark / light): ink 15.6 / 16.2 · ink-2 9.9 / 9.2
· ink-3 5.5 / 5.6 · ink-4 4.8 / 4.6 · brass 6.8 / 5.9 · ember 6.2 / 5.3 · patina 7.0 / 6.4 ·
scald 4.8 / 6.9. All AA at body size. `--ink-4` on `--panel` in light mode is 4.03 — the one
value below 4.5, and it is the deliberately-quiet micro tier that in practice sits on `--surface`
(4.59). Flagged rather than hidden.

## Type

Three Google-hosted families, each mapped to a **speaker** — this is the typographic form of the
whole thesis.

- **IBM Plex Mono** 400/500/600 — *the mechanism*. Every numeral in the product, plus agent
  reasoning traces, telemetry, keyboard hints and the stamp register. Humanist, drawn by a hand,
  and still warm at 11px — the reason it beats a geometric mono here.
- **Bricolage Grotesque** 400–700, variable optical size — *the operator*. All UI, labels,
  buttons and headings. A grotesque with visible craft in the curves, so the interface never
  reads machine-generated. (Chosen over Geist/Inter precisely because those are what
  "technically superior" defaults to, and defaulting is how 054 got cold.)
- **Fraunces** 400–600 — *the hand-off*. At most **once per screen**: the greeting, the decision
  the machine hands you, or a quoted human. The warm cup at the end of the pressure.

Scale, in px (full table on the board): display 34/41 · h1 26/32 · h2 20/27 · h3 16/23 ·
hand-off 26/34 Fraunces · hand-off italic 17/26 Fraunces · body 14/22 · ui 13/19 ·
data-xl 34/40 mono tnum · data-l 28/32 mono tnum · data 13/18 mono tnum · trace 11.5/19 mono ·
kicker 11/14 mono caps +0.16em · micro 10/14 mono caps +0.10em · stamp 14 mono caps +0.57em brass.

**Type laws.** Every numeral is Plex Mono with `tabular-nums`, including inside prose — figures
align down a column even mid-sentence. Display never exceeds 34px. Fraunces appears at most once
per screen; the moment it becomes decoration, the direction has failed.

## Motion

Brass has mass. Everything moves like a machined part being seated: it accelerates, it settles,
and the heavier the part the longer it takes. Eight tokens, three of them real springs
(stiffness / damping / mass), sampled into CSS `linear()` on the board from the analytic spring
solution so the demos match the parameters rather than approximating them.

| Token | Kind | Numbers | For |
|---|---|---|---|
| `press` | bezier | 90ms · `(.32,0,.12,1)` | Key travel — 1px of Y on press-down, before anything else |
| `seat` | spring | 235ms · k 420 · c 34 · m 1 · ζ 0.83 | A part seating: toggle thumbs, chips, hovers. The house curve |
| `swing` | spring | 356ms · k 200 · c 27 · m 1.2 · ζ 0.87 | Heavier hinged things: row expands, drawers, sheets |
| `needle` | spring | 747ms · k 140 · c 15 · m 1 · ζ 0.63 · **7.6% overshoot** | Anything that reads a value off a scale. The only token allowed to overshoot |
| `pour` | bezier | 520ms · `(.16,.84,.24,1)` | Number tickers and fills — a pour finishing, not a slot machine |
| `warm` | bezier | 700ms · `(.4,0,.2,1)` | Light and heat only: glow, specular, the roast/crema swap |
| `trace` | bezier | 260ms · 90ms stagger · `(.2,0,0,1)` | Agent reasoning lines arriving one at a time |
| `extraction` | composite | 2600ms | The signature. One agent run, choreographed end to end |

Reduced motion collapses every token to 1ms and jumps the extraction straight to its end state
(needle seated at 9.1 bar, all five readings resolved, draft revealed). Shipped as
`motion.json` → `packages/ui/motion-tokens.ts`; the spring triplets feed `motion`'s
`{type:'spring',stiffness,damping,mass}` now and Reanimated's `withSpring` later, which is the
portable unit named in research-stars-motion §5.

**Live demos on the board:** settings toggle (`seat`, with a 12% `press` squash — a real switch
deforms before it moves), row expand (`swing`, grid-rows unmask, caret on the same clock), number
ticker (`pour`, rAF-driven, tabular figures, lands on the exact cent), and the signature.

**The signature — "The Extraction".** Press *Watch it work* and the procurement agent runs in
public: heat rises behind the panel (`warm`), the needle sweeps 0.0 → 9.1 bar into the green
band with its real overshoot while the readout counts up (`needle` + `pour`), five readings land
90ms apart and resolve their ember dots one by one (`trace`), the shot pours into the vessel
(`pour`), and only then is a drafted decision handed over in serif — *held, not sent* (`swing`).
Every other AI product hides this step behind a spinner. Here the reasoning **is** the interface,
and the choreography stops at the human.

## Voice guide (full)

The product is allowed to be warm in the verb — but it buys that warmth with a number in every
sentence. It never chirps, never apologises, and never states a conclusion without the reading it
came from.

**V-01 Show the working, then the answer.** No recommendation ships without the reading beneath
it: *"3.3 nights of cover — 7 bottles, 2.1 a night."* A conclusion with no visible arithmetic is
a black box, and this brand's entire claim is that it isn't one.
**V-02 Warmth in the verb, precision in the number.** The sentence may be kind; the figure may
never be approximate. "About a dozen" is banned; "12 bottles, $930" is the same sentence done
properly. Warmth is never bought by being vague.
**V-03 The machine says "I". Facts say nothing.** First person belongs only to agent actions —
*I read, I drafted, I'm holding this*. Measurements, totals and states are stated flat, with no
speaker. The reader always knows who is talking.
**V-04 Physical verbs from a real kitchen.** Draft, pour, hold, seat, count, receive, approve,
hand off, set down, close. Never manage, leverage, optimise, streamline, empower. If two hands
can't do it, the verb is wrong.
**V-05 No exclamation, no apology, no confetti.** A finished job reports its number, not its
feelings: *"Sent. 12 bottles, $930."* Never "Success!", never "Oops — something went wrong".
Celebration is the operator's, not the software's.
**V-06 Empty is a reading, not an absence.** Every empty state names the measurement that is
missing and the condition that fills it. "No data" is a shrug; *"6 nights counted, 14 needed"* is
an instrument reporting honestly.
**V-07 Consequences in objects, not warnings.** Destructive copy lists what physically
disappears — orders, counts, threads, years. Never "This action cannot be undone" on its own.
**V-08 One sentence, one thing.** A second thought is a second line. Fragments are legal and
often better: *"Held for you."* is a complete message.

### Canonical rewrites

| Before | After |
|---|---|
| Draft, approve, and track purchase orders through delivery | **I write the order. You approve it. We watch it to the door.** |
| Alerts that need a decision, oldest first | **2 waiting on you. Oldest first — the Rioja has been sitting 3 days.** |
| No checks yet — close an order from the terminal | **The counter starts at the first closed check. Ring one up on the terminal and this fills.** |
| No comparable data | **Nothing to compare against yet — 6 nights counted, 14 needed.** |
| Permanently delete your Mudavym account. | **This takes the whole machine apart — 3,412 orders, 2 years of counts, 14 vendor threads. Nothing comes back. Type the restaurant's name to proceed.** |

Each rewrite is doing one named job: #1 puts V-03's division of labour on the surface (three
physical verbs, three actors); #2 satisfies V-01 by naming the reading behind "oldest"; #3 turns
an empty state into V-06's measurement-plus-condition; #4 the same, with the exact denominator;
#5 is V-07 — the warning is the inventory, not the adjective.

## Slogans (with rationale)

1. **Under pressure, beautifully.** — The espresso premise and the service premise in four words.
   Nine bars and a full dining room are the same sentence.
2. **You can watch it think.** — The differentiator, in the operator's own words. Every
   competitor's agent is a black box; this one has a window.
3. **Mudavym. The machine that keeps the house warm.** — Name. Category claim. "House" is
   hospitality's own word for itself; "machine" refuses to apologise for being one.
4. **More mechanism, less mystery.** — Balanced antithesis aimed at black-box software; doubles
   as the internal design bar (if a screen can't show its working, it isn't finished).
5. **Warm to the touch. Exact to the cent.** — The two halves of the brand in one breath; the
   tension this direction exists to prove is survivable.
6. **Built like the machine on your bar.** — One image carrying material, craft and
   twenty-years-of-service durability. Every owner already trusts that object.
7. **Every gauge readable. Every regular remembered.** — Precision and müdavim in one line; the
   name's meaning made operational.
8. **It works the back. You work the room.** — The division of labour stated plainly, and it
   tells the owner what they get back: the floor.

## Sample screens — what they prove

**Dashboard.** Warmth arrives in exactly three places — the serif greeting, the serif decision
line, and the lamp over the panel — while everything measurable stays in tabular mono. Ember
touches only the two tiles that want a human (Low stock 7, Alerts 2) and the one card that
resolves them, obeying law ②. The decision card carries its own reasoning inline ("I read 14
nights of pours…") because V-01 applies to the *card*, not only to the agent demo, and the
`Approve & send` button is brass — material, not alarm. The `Agent working · 9.1 bar` pill is the
gauge language leaking into chrome, breathing at 3.4s.

**Orders.** A dense working table can still feel like warm metal: brass column headers, a
specular top edge, chamfered 2px rows. Exactly one ember chip on the whole strip (the AI draft);
status chips are patina outlines, because a status is not a decision. The only serif sentence is
the vendor's own words — Move 18's quoted human, kept intact. The drawer hint documents the
vendor thread (spring `swing`, brass edge first, messages on `trace`, nothing sends without a
hold-⏎) without spending a second screenshot on it.

## Verification

Verified at `http://localhost:8642/062-mudavym-warmmachine/index.html` two ways: live DOM and
computed-style probes in the Browser pane, and full-page headless-Chrome renders (1280×11 500,
both themes) read back and inspected section by section.

- **Renders clean.** Zero console errors and zero console logs at every viewport tested. All
  eight sections present; counts confirmed (3 logo concepts + wordmark, 8 slogans, 8 voice rules,
  5 rewrites, 8 motion tokens, 3 demos + the signature, 5 reasoning lines, 4 KPI tiles, 15 type
  rows, 34 palette swatches).
- **Responsive, measured.** `scrollWidth − clientWidth = 0` at **375** (mobile), **768** (tablet)
  and **1280**. Two real overflow bugs were found by measuring rather than by looking and then
  fixed: the logo tile pairs never collapsed below 860px (fixed marks forced a 496px minimum), and
  the sample-screen title bars did not wrap (91px of overflow at 375). Both re-measured to 0.
- **Fonts load.** `document.fonts.check()` true for Bricolage Grotesque 600/34, IBM Plex Mono
  500/14 and Fraunces 400/26; computed `font-family` confirmed on the h1 (Bricolage), the greeting
  (Fraunces) and all numerals (Plex Mono).
- **The springs are real.** `linear()` easing is supported in this engine, and the toggle's
  *computed* timing function is the sampled `seat` spring (`linear(0 0%, 0.0213 4.54%, …)`) at
  235ms, the row body's the `swing` spring at 356ms — the demos are running the same numbers
  `motion.json` ships, not a hand-picked bezier.
- **SVG `var()` fills resolve** — presentation attributes were rewritten to inline `style` so the
  theme-aware marks work; probed `fill: rgb(195,154,78)` (brass) and `stroke: rgb(85,179,148)`
  (patina) on the gauge.
- **Mark geometry measured, not eyeballed** — gauge M bbox 48×47 at (36,37); needle tip at r=33.2
  against the band inner edge at r=38.25; cup bbox 48×23 inside a 72-unit viewBox.
- **Contrast audited in both themes** by computing WCAG ratios in-page (table above). One
  sub-4.5 value found and disclosed rather than papered over; six token values were darkened or
  lightened as a result of that audit rather than left as drawn.
- **Both themes rendered and read.** Roast and crema captured full-page and inspected; the light
  theme holds (warm paper, brass bezel, olive-brass primary buttons) and is not an afterthought.
- **The signature actually runs.** It auto-starts once on first scroll into view, and the render
  shows the finished state: needle seated in the patina band, readout at 9.1, all five readings
  resolved with ember dots, the cup filled, and the drafted decision revealed — status
  `HELD FOR APPROVAL · 9.1 BAR`.
- **Reduced motion verified for real**, not asserted: rendered under Chrome's
  `--force-prefers-reduced-motion`, the signature skips the choreography entirely and paints the
  finished state on load — needle seated, five readings resolved, cup filled, draft revealed.

Four defects were found this way and fixed: the palette swatches were inheriting the status-pill
class and rendering as circles; the pour vessel was absolutely positioned on top of the gauge; the
Orders quantity column truncated "24 bottles"; and logo marks B and C read badly (B's needle-M was
illegible, C read as a smiley face) and were redrawn. One stated law was also wrong — "one ember
per screen region" — and was corrected against the mock rather than the mock being bent to it.

**Declared honestly.** (1) The Browser pane is shared with several concurrent sessions and was
repeatedly hidden or stuck mid-run; while hidden a tab stops compositing, so **the extraction
choreography was never captured as an intermediate-frame sequence** — only its start and end
states, plus the timings and easings driving it, were verified. The per-frame motion is therefore
asserted from parameters, not from film. (2) Headless renders at a 390px window are unreliable on
macOS (Chrome enforces a minimum window width), so the mobile-layout claim rests on the pane's
emulated 375px measurement, not on the mobile screenshot — the screenshot's right-edge clipping is
that artefact, not a layout bug. (3) The board was verified at 375 / 768 / 1280 only; no
ultra-wide or 4K check was run.

## Open questions for the founder

- **Fraunces, or a quieter serif?** Fraunces is the boldest type call on the board — it carries a
  lot of personality for a tool used at 11pm. Newsreader or Instrument Serif would do the same
  structural job with less voice. The *rule* (serif only at the hand-off, once per screen) is
  what matters; the family is swappable.
- **Is ember the right heat, or should it be closer to brass?** `#F0743A` is deliberately not
  amber. Worth testing in situ against a redder ember and against a brass-only system where the
  metal itself carries urgency.
- **How much mechanism belongs on working screens?** The Extraction is right for an agent run.
  The open question is whether a *compact* version (gauge pill + two-line trace) belongs on every
  page that has an agent, or whether that becomes noise by the third shift.
- **Does the light theme ("Crema") ever get to be primary?** It is fully specified and holds, but
  the direction is authored roast-first; a bright kitchen pass at noon may want the reverse.

| 062 | mudavym-warmmachine | Mechanism on show — can the most technical direction also be the warmest? | null | brand, mudavym, warm-machine, brass, mechanism, agent-visible, od-106 |
