# 084 — Mudavym · Anatolian

A competing brand direction for the WineOps → Mudavym rebrand (OD-106, **document only,
no build**). Thesis: **the name's own homeland**. Every other direction dresses a Turkish
name in international clothes; this one goes home — İznik ceramic blue-teal and its glaze
depth, the star-and-cross tile tessellation as an actual layout and pattern system, brass
and copper from a working kitchen, and the generosity of a Turkish table where hospitality
is a duty and a pleasure. Reference point: a great İstanbul meyhane or a Gaziantep kitchen,
rendered with modern software precision.

**The danger this direction had to beat** was touristic pastiche — "ethnic" ornament, a
theme instead of an identity. The answer is a single rule applied everywhere: *the geometry
must be load-bearing.* If you deleted every decorative mark from this board, the layout, the
dividers, the data bars, the loading state and the logo would all still be there, because
they are made of the geometry rather than decorated with it. That is the test, and it is
stated on the board itself (§01 "Structure before ornament").

---

## Research moves used (cited by name)

From `research-reference-aesthetics.md` (pick-list numbers):

- **#2 Warm-paper neutral system** (manus) → re-based as **slip**: the white ground a tile is
  painted on. `--slip-0 #FAF6EF / --slip-1 #F3ECE0 / --slip-2 #E7DDCC`, a 4-step ink ladder
  shared by text and icons (`#152026 → #A0AEB2`, teal-biased near-black rather than neutral),
  and surfaces built as 3.5–10% alpha tints of that ink instead of painted grays.
- **#3 Semantic colour + matching tint pair** (manus) → every status hue ships with a
  10–15% alpha twin (`--sage-tint`, `--brass-tint`, `--bolus-tint`); no raw hue ever sits on
  slip. Used on every chip in the Orders strip.
- **#1 Serif greeting over one input** (manus) → the dashboard opens with the product
  speaking in Fraunces: *"Good evening, Deniz. The room is ready — three things want your
  hand before service."* Display type is rationed to the moments the house speaks.
- **#5 One-accent-per-domain theming** (motion.dev) → adopted with a twist. Rather than a
  hue per domain, this direction assigns a hue per *meaning*: glaze = the house, cobalt =
  information, bolus = a person decides, brass = in flight, sage = settled. Domain tinting
  still works on top (each area shifts the glaze's lightness), but the semantic layer is the
  primary discipline, so a screen never carries two competing accents.
- **#6 Accent-tinted deep-ink dark mode** (motion.dev) → dark is not gray: `#0B1517 /
  #101E20 / #17292B`, all biased toward the glaze, with warm bone (`#EDE6D9`) as the ink.
  Called "the kiln at night" in the theme switch.
- **#7 Mono micro-kicker vs display** (motion.dev) → 10–11px UPPERCASE IBM Plex Mono at
  +0.16–0.18em against 40px tight Fraunces. The board's own §01–§08 kickers are the system.
- **#9 Fast-out settle easing** (motion.dev) → house micro-curve `cubic-bezier(.16,1,.3,1)`
  at 140ms; nothing on the board moves more than 10px.
- **#11 Numbered-index sections** (motion.dev) → §01–§08, matching the way a tile wall is
  counted rather than paginated.
- **#12 Grayscale data, chroma = anomaly** (bklit) → restated in the tile grammar as the
  **tiled wall**: glazed tiles for what is there, bisque for what is not, `--bolus` only
  where a decision lives. One glyph covers stock, capacity, coverage and progress.
- **#13 Chart-token vocabulary** (bklit) → the material tokens are named up front
  (`--sheen`, `--pool`, `--meniscus`, `--seam`, `--seam-strong`, `--slip-2` as bisque) so
  forty pages draw the same instrument.
- **#14 Hairline-rule structure, radius near 0** (bklit) → the **seam** is the only
  structural device: sections, KPI bento, order rows and palette columns are separated by
  1px seams, and radii drop to 3px on data surfaces (a tile is square) while staying 10px on
  touch controls. This is where the direction diverges from 081's softer 10–14px world.
- **#15 Small hero, dense catalog** (bklit + manus) → display caps at 40px; authority comes
  from the completeness of the token sheet, not the point size.
- **#17 Balanced-antithesis tagline** (manus + motion.dev) → the slogan set is built on it:
  "Hospitality is a duty. So is the count." / "Bring the tray. Never push the plate." /
  "Nothing is asked of the guest. Everything is asked of the house."
- **#18 Deadpan brand, quoted warmth** (bklit) → voice rule 06. Warmth arrives quoted —
  Marta's *"Same as last time, my friend."* — the house never praises itself.

From `research-stars-motion.md`:

- **Interruptible spring physics over hard-coded easing** (chenglou/react-motion as taste
  signal; `motion` as the adopted engine) → `set` and `tray` are real springs
  (300/30 and 220/26); every token in `motion.json` carries the stiffness/damping vocabulary
  that Reanimated shares, so the token file ports to RN unchanged.
- **Motion as feedback, not decoration; flashy surfaces only on low-frequency pages**
  (aesthetic-inference section) → the one decorative surface is the star-and-cross band, and
  in the product it is restricted to auth and empty states. `tessellate` replaces every
  spinner, which is feedback, not decoration.
- **AnimateNumber / ticker pattern** (motion.dev Ticker, Number animations) → `tally`,
  rebuilt on the free API (`useSpring` + `tabular-nums`), demoed live.
- **Layout animations / row expand + Sheet-modal drawers** (motion.dev Layout, Dialog) →
  `unfold` on `grid-template-rows: 0fr → 1fr` (no `height:auto` guessing), demoed live; the
  vendor-thread drawer hint in the Orders mock uses the same token.
- **Hold-to-confirm / one-tap approval** (motion.dev Interactions; kokonutui `hold-button`)
  → reframed as **the tray**: the proposal arrives, one tap takes it, nothing auto-sends.
  This matches the shipped product rule (AI drafts vendor mail, never sends unapproved).
- **`useReducedMotion` gate from day one** → the board honours `prefers-reduced-motion` at
  the CSS level and in the ticker's JS (it jumps to the end value rather than shortening).

---

## What is specific to this direction

### 1. Tile geometry doing structural work (the anti-pastiche mechanism)

Five jobs, none of them ornamental:

1. **Layout.** The star-and-cross tiling is a real bento: one **star** tile (2 rows tall,
   1.42fr) and four **cross** tiles. That is the KPI grid in the Dashboard mock — Revenue is
   the star; Low stock / Pending orders / Alerts / Tonight's cover are crosses.
2. **Divider.** The grout line between tiles becomes `--seam` — 1px, used for every rule on
   every surface. Cards are rare; seams do the structure.
3. **Module.** Everything snaps to an 8px module with a 48px tile unit (`--mod`, `--tile`).
4. **Data.** The tiled wall replaces bars and sparklines: glazed / bisque / bolus.
5. **Waiting.** `tessellate` — five eight-point stars glazing themselves in on a 60ms
   stagger. There are no spinners in this product; waiting is always the wall being tiled.

The pattern band in §01 is the *only* place the tessellation appears as texture, and in the
product it is confined to auth and empty states.

### 2. Glaze depth as a material, in three layers

A fired İznik tile is not a flat fill: colour sits *under* a thick clear glaze, which pools
darker at the lower edge and catches a highlight at the rim. Rendered as exactly three
tokens — `--meniscus` (1px inner top highlight), a body gradient (lit → hue → deep), and
`--pool` (1px pooled bottom edge). Two hairlines and one gradient per surface. No drop
shadows on data surfaces, and explicitly never neumorphism; the only box-shadow above a
hairline is `--depth` on the two screen mocks.

### 3. The accent the founder asked for

Not indigo, not violet, not emerald. **Armenian bole** — `#C04A2E`, the raised iron-oxide
red of İznik ware — carrying exactly one meaning product-wide: *a person decides here.*
That deliberately unifies the primary button and the alert chip, because in this product
they mean the same thing. Contrast measured: bolus on slip-0 = 4.60:1 (fine for the 17px+
display and UI chrome; `--bolus-deep #A23A22` is specified for small text), white on solid
bolus = 4.93:1 (AA for body), glaze on slip-0 = 5.62:1. Supporting hues are the rest of the
İznik/kitchen set — turquoise glaze, cobalt, brass, copper, sage — so the semantic system is
inherited from the material rather than invented.

### 4. The meze tray as the AI interaction model

The strongest transfer from the culture, and the reason this is an identity rather than a
theme. In a meyhane the tray comes to you: everything is offered, nothing is imposed, you
point at what you want. That is precisely the right model for AI proposals in an ops tool,
and it is already the product's rule. It gives the direction its interaction pattern (`tray`
token, `.tray` component with the bolus left edge), its voice rule 01 ("Offer, never
impose"), and two of its slogans.

### 5. glazeFire — the signature moment

720ms, two-phase. A bisque (unglazed) tile is a decision not yet made. When a person
approves, the tile **fires**: a wet glaze sweep crosses it (`::after` translateX
−130%→130%, 720ms, `cubic-bezier(.4,0,.2,1)`), the background transitions from bisque to the
full glaze gradient over 420ms, and at +260ms the tile settles with a spring
(420/28, scale .984 → 1.013 → 1). It happens at most once per screen and never on load.
It is on the board twice: as the §07 signature demo and on the Dashboard's Approve button,
so the founder can see it in isolation and in situ.

### 6. Type — a display face with a hand in it

**Fraunces** (variable, `opsz` + `SOFT` + `WONK`) is the point of difference: an old-style
with real brush pressure and a slightly wonky *y*, so headlines read hand-painted rather than
hand-drawn — the same register as a painted tile. **Instrument Sans** works, **IBM Plex
Mono** counts (always `tabular-nums`). All three carry full Turkish (ı İ ş ğ ü ö ç), which is
not optional for this name and disqualified several otherwise-good display faces.

---

## Full voice guide

**The posture.** A host: warm without being familiar, precise without being cold. The house
does the work; the müdavim makes the decision. Nothing is ever pushed.

**Rules**

1. **Offer, never impose.** Every AI action is a tray. "Ready", "drafted", "waiting for you"
   — never "we've sent", "confirm now", or a countdown. No dark patterns, no urgency theatre.
2. **The house is "we", the müdavim is "you".** "We drafted it. You decide." The work is
   always ours; the decision is always theirs. Never "let's" — it blurs responsibility.
3. **Name the thing, not the record.** "Rioja", not "inventory item". "Marta", not "vendor
   contact". Specificity *is* hospitality; category nouns are how software forgets people.
4. **Warmth in the noun, precision in the number.** Adjectives are banned. Warmth comes from
   concrete nouns — table, door, morning, tray — and from numbers being exactly right, with
   their units. Never "great news", never "amazing".
5. **Empty is a sentence, then a door.** Never a shrug. Say plainly what is not there, then
   offer exactly one way in. Never render a zero we did not measure — a dash means "we do not
   know", and it is always explained.
6. **No exclamation, no applause.** A good service is normal. The house does not congratulate
   itself or the user. Warmth arrives quoted — from Marta, from the floor — never declared.
7. **One Turkish word, earned.** *Müdavim* appears where it explains itself (onboarding, the
   about page, the welcome-back empty state) and nowhere else. No decorative Turkish, ever;
   no *hoş geldiniz* sprinkled on buttons. That restraint is what separates identity from
   costume.
8. **Verdict first, arithmetic after.** The sentence that decides something is set in the
   display face and comes first. The working — quantities, prices, deltas — follows in mono,
   always available, never in the way.

**Rewrites of the five house strings**

- "Draft, approve, and track purchase orders through delivery" →
  *"We draft the order. You approve it. We watch it to the door."*
  (rules 2 + 8: the division of labour stated in three clauses, ending at a physical place)
- "Alerts that need a decision, oldest first" →
  *"Waiting on you — the one that has waited longest is first."*
  (rule 1: "waiting" not "requires action"; the sort order is stated as courtesy, not config)
- "No checks yet — close an order from the terminal" →
  *"No tables closed yet tonight. The first check lands here the moment the terminal sends
  it."* (rule 5: the empty state is a sentence about the night, then the exact condition
  under which it fills)
- "No comparable data" →
  *"Nothing to compare against yet — we need one more week of Thursdays."*
  (rule 5 + rule 4: names what is missing and when it arrives, in the operator's own unit of
  time)
- "Permanently delete your Mudavym account." →
  *"Clear the table for good. This removes your account and everything on it — orders,
  counts, every thread with your vendors. It cannot be undone, and we will not slow you with
  tricks. Type your restaurant's name to confirm."*
  (rule 8 verdict-first; the Anatolian image carries the finality; the anti-dark-pattern
  clause is the brand refusing to be sticky)

**Words the brand does not use:** platform, solution, seamless, powerful, effortless,
leverage, unlock, AI-powered, revolutionise, delight. **Words it does:** door, table, tray,
count, night, thread, hand, seam, wall.

---

## Logo — why three, and which one

- **A · Mühür (the eight-point seal)** — the formal mark. Two squares overlapped at 45°
  (R = 26u, inner r = 0.7654R = 19.9u); the eight inner vertices filled solid glaze, the star
  outline left open in ink. A glazed octagon core inside a bisque star. For documents,
  contracts, sign-offs. At 16px the outline thickens to 4.4u so the octagon still reads.
- **B · Dört (four tiles, one seam)** — **recommended primary / app icon.** A 64u square
  split by a 4u seam cross into four tiles. Three carry the house's work at three glaze
  depths (bisque = queued, lit = in hand, deep = done); the fourth is bolus — the one thing
  waiting on a person. It is the product's own model, drawn. The bolus quadrant is a live
  surface: it goes bisque when nothing needs you, so the icon *is* the badge. Four rectangles
  and one stroke, so it survives 16px intact.
- **C · Sofra (the set table)** — the hospitality lockup, for signatures, invoice footers and
  the front door. Wordmark over a brass rule with end-ticks (the table's edge), a glaze
  octagon (the *sini* tray) knocked out of the rule with a slip keyline so it reads in front,
  and a bolus dot at centre: the one dish meant for you. Honestly stated on the board: at
  16px the wordmark drops and the tray-on-rule alone carries — it is the only concept whose
  small form is a different composition.

All three are rendered light **and** dark, and all three are shown at 32 / 24 / 16px next to
the full lockup, because the earlier rejection was for unresolved marks — construction rules,
clear space (one tile module) and small-size behaviour are stated, not implied.

---

## Risks / honest caveats

- **Pastiche is one bad decision away.** The load-bearing rule is the whole defence. The
  moment someone adds a tessellation to a page header "for warmth", the direction becomes a
  theme. Guardrail to write into the design system if this direction wins: *the star-and-cross
  may appear only where it is doing a job — layout, seam, data, loader, empty state.*
- **Bolus does double duty** (primary action + alert). That is deliberate and defended above,
  but it must be tested with real staff; if "the red button" reads as danger to a floor
  team at 23:00, the fallback is glaze for the primary action and bolus for alerts only —
  which costs the direction some of its heat.
- **Fraunces is a strong flavour.** At 40px it is the identity; at 17px in the tray title it
  is close to its useful floor. Anything below 17px must be Instrument Sans, and `WONK 1`
  should be dropped below 23px.
- **Turkish coverage was chosen for, not verified glyph-by-glyph.** Fraunces, Instrument Sans
  and IBM Plex Mono all declare `latin-ext`; all three loaded and rendered "müdavim",
  "İznik", "Şöyle buyurun" and "dāʾim" in the browser during verification, but a full
  diacritic proof (ğ, ş at small optical sizes, İ vs I in caps) has not been done.
- **The bento is only honest at ≥840px.** Below that the star tile spans two columns and the
  tessellation reading weakens to a plain 2-up grid. A genuinely tiled mobile layout is
  unsolved here and would need its own pass.

## Verification (§0.5 — what was and was not checked)

Verified live in the Browser pane against a local static server
(`http://localhost:8642/084-mudavym-anatolian/index.html`; the server the parent session
described was not listening on 8642, so one was started from the sketches directory for the
duration of the check):

- **Renders, no console errors.** `read_console_messages` → "No console logs." Page height
  11,807px at a 1280px viewport, HTTP 200, final size 81.4KB (limit 180KB). Tag balance checked programmatically;
  `motion.json` parses and carries all 7 tokens.
- **All three Google faces load and apply.** `document.fonts.check` → Fraunces: true,
  Instrument Sans: true, IBM Plex Mono: true; computed `font-family` confirmed on the
  masthead, body and `.fig`.
- **All five demos exercised programmatically**, not desk-checked: toggle flips class +
  `aria-checked` + label text both ways; row expand reaches `grid-template-rows: 107px` with
  the working at opacity 1 and `aria-expanded=true`, and closes again; ticker reaches
  `$4,280`; `#fireTile` takes `.fired` (glazeFire); the Approve button fires the tray, sets
  `disabled` and swaps to "Sent to Marta · 17:42". The `tessellate` loader's `<use>` stars
  resolve and render (measured bounding boxes).
- **Dark mode fully wired.** With `data-theme="dark"`: body `#0B1517` / `#EDE6D9`, mock
  surfaces `#0B1517`, seam `rgba(237,230,217,.13)`, `--glaze` `#3FBDBB`, AI chip
  `rgb(228,112,90)` on its 15% tint. Toggling back restores `#FAF6EF`.
- **Layout measured.** Star-and-cross bento resolves to a 381×214 star tile and four 268×106
  cross tiles; no horizontal overflow at 1280px; nothing clipped (`scrollWidth > clientWidth`
  audit returned empty); the `<840px` media query engages and produces no overflow.
- **Seen by eye, light mode:** header + §01 (premise band, müdavim definition, the three
  claims), §02 (all three logo lockups light *and* dark, with their 32/24/16px rows), §03
  slogans, §04 voice rules + all five rewrites, §05 both palette columns and both glaze-depth
  notes, §06 all three type specimens and the scale, §07 all five demos including glazeFire
  in its fired state, §08 both mocks. **Dark mode:** both mocks captured settled at
  `#0B1517`, plus the three dark logo cells.
- **Six fixes came out of the check**, all of them found by looking:
  1. a descendant-selector bug (`.def span`) breaking the müdavim definition across lines;
  2. the same bug class in `.rules span`, which had put "Müdavim" on its own line in voice
     rule 07 — both scoped to direct children;
  3. three logo viewBoxes leaving ~90px of dead space (tightened; `max-width:100%` added);
  4. `.tilefire`'s two labels running inline, so the glazeFire demo read as one broken line;
  5. the `tessellate` loader's SVG aspect ratio was wrong and squashed the stars (176×48);
  6. **a real contrast failure**: white on dark-mode bolus `#E4705A` measured 3.10:1. Fixed
     with `[data-theme="dark"] .btn-act{color:#0B1517}` → 5.97:1, verified by computed style.
  A defensive `overflow-x:auto` wrapper was also added around the motion-token table.

**Not verified, stated plainly:**

- **Viewports below 647px could not be emulated** — the Browser pane clamped there. The
  `<840px` rules were exercised at 647px only; true phone width is unproven.
- **Motion was verified as state changes and one fired frame, not as motion.** Classes,
  computed `grid-template-rows`, end values and the settled `.fired` tile were observed; the
  intermediate frames of the sweep, the tray stagger and the tessellate loop were not. The
  numbers in `motion.json` are transcribed from the stylesheet, not estimated.
- **Screenshot capture was unreliable throughout** (several direction agents contending for
  one Browser pane); roughly half the attempts returned "pane not displayed" or a blank
  frame, and each section above was retried until a good frame came back. Nothing was
  declared verified on a blank frame.
- Contrast ratios were computed by hand from the sRGB values, not measured by a tool.
- **Turkish rendering was seen, not proofed** — see the caveat above.

| 084 | mudavym-anatolian | The name's own homeland — can İznik geometry and glaze depth be structure rather than ornament? | null | brand, mudavym, anatolian, iznik, tile-geometry, brass, heritage, od-106 |
