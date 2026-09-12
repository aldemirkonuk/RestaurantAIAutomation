# 083 — Mudavym · The House

The front-runner. Not a sixth idea: this is the founder's own keep-pile from directions
077–081, assembled into one identity and then finished. The job was **faithful assembly
plus elevation, not reinvention** — every element below can be traced to a board the
founder already judged, and the only genuinely new work is (a) resolving the two kept
logo marks into a real construction system, (b) the seal-colour decision board, and
(c) three additional slogans in the same register.

**The mandate, verbatim:** *"The main feeling must be the giving of hospitality and
passion while technically superior."*

How the mandate is met structurally, so it does not depend on taste holding:
hospitality and passion live in the **surface and the voice** — warm paper, a variable
serif that only speaks when the product speaks, quoted humans, trade words instead of
software words. Technical superiority lives in the **arithmetic and the discipline** —
tabular mono everywhere a figure appears, honesty idioms as UI grammar, measured
contrast, named motion tokens with real physics, one colour spent on one thing. The
brand is warm because of what it *is*, and precise because of what it *does*. It never
has to claim either.

---

## Provenance — what came from where

| Element | From | Kept as-is / changed |
|---|---|---|
| The müdavim definition block ("The regular. The one who is there every day — who the house knows, and who knows the house.") | **077** | Verbatim. Set in Fraunces instead of 077's face; typeset between a hairline and a double rule. |
| "Most restaurant software watches the restaurant like a security camera / Mudavym sits at the bar like its most loyal regular…" | **077** | Verbatim through "quietly takes care of things"; 077's direction-specific tail replaced with a paragraph that turns the story into the design brief. |
| Slogan "Every vendor. Every bottle. Every shift." | **077** (S4) | Verbatim, rationale preserved. |
| Slogan "Less counting, more cooking." | **077** (S5) | Verbatim, rationale preserved. |
| LIVE row-expand `settle` demo — PO-1038 · Bodega Álvaro, grid-rows 0fr→1fr on the house curve, chevron on the same token | **077** | Behaviour, content, curve and copy carried over unchanged. This is the motion the founder named; it is the first demo in §08 and the token keeps its name. |
| Logo "C — The Meter" (five bars spelling M, one bar carrying the signal) | **078** | Kept as the **alternate** mark. Two changes to make it belong here: the wordmark is re-cut in Fraunces (was Geist), and the meter now stands *on the double rule* so the readout and the total are one object. The lit-bar rule (one bar = one thing waiting) is preserved. |
| Slogan "Set the table. We'll keep the books." | **079** (S5) | Verbatim, with its division-of-labour rationale intact and expanded. |
| Slogan "Your back of house, front of mind." | **079** (S6) | Kept and **flagged as sales material, not in-app**, in its own callout with the reason. |
| The Fraunces house voice — variable serif, warm and slightly wonky, "a wine label that learned software", used ONLY when the product speaks; "Good evening, chef." | **079** | Kept whole. Pinned to `SOFT 42 / WONK 1` and given a 16px floor. "Good evening, chef." is the dashboard greeting. |
| One-tap / hold-to-approve interaction | **080** | Kept. 620ms hold (was 600ms), fill linear, release on the house curve; on completion the **seal lands** (`stamp`) instead of only a label change — this is the elevation. Live in §08 *and* on the dashboard mock. |
| The double-rule logo | **081** (concept 1) | Kept and **developed**: wordmark measured to the rule with `textLength`, rule weight/gap/clear-space derived from the M, minimum size stated, fallback lockup named. |
| The full stop as a mark | **081** (concept 3) | Kept and developed into Lockup C (app tile / favicon) *and* promoted to a system rule: the period is the only coloured element in the identity and it ends every verdict the product writes. |
| Slogan "Every bottle, accounted for." | **081** (02) | Verbatim, rationale preserved. |
| Slogan "Your *müdavim*, at the books." | **081** (06) | Verbatim, rationale preserved. |
| §03 "Voice — how the book writes" (the eight rules) | **081** | Kept whole, wording tightened. Rule 04's once-per-screen serif cap is load-bearing and is called out as such. |
| Paper / ink / one-seal palette structure | **081** | Structure kept exactly (paper grounds, 4-step ink ladder shared by text and icons, surfaces as alpha tints of warm ink, one non-ink colour, semantic tint twins). Values warmed one step toward 077's cream so light mode reads dining room, not office. |
| Row-expand "show the working" pattern | **081** | Kept: arithmetic beneath the row, totalled with the accountant's double rule, on the `turn` token. |
| Honesty idioms — "—" never a pass, "no comparable data" never 0%, the dash gets its own token | **081** | Kept as UI grammar, visible in the orders mock and the empty-state rewrite. |
| Wax-seal-as-approval-stamp (brand mark == product interaction) | **081** (concept 2) | Kept as the mechanism, but the *colour* is re-opened — see §05. |
| **NEW** — three additional slogans, the seal-colour board, the logo construction rules, the live seal try-on | — | The only new work. |

### What was deliberately not carried
077's three marks (the Kept Seat, the Tally, the Homecoming Dots) — the founder rejected
all of them, so none appear, not even as a favicon. 078's radius-0 monochrome system and
its decision-amber. 079's dark-primary stance (dark is here, but light is home; the
product is used from prep through close and the paper is the identity). 080's 128px
display scale and imperative expo voice. 081's burgundy `#8A2E33` seal — the seal
*mechanism* survives, the *hue* went back to the board.

---

## Rationale — the four decisions this assembly had to make

**1. Which of the three faces speaks?** The kept material contains two register claims
that could have collided: 077/079's warm serif-first hospitality, and 081's deadpan
ledger. They are reconciled by rationing rather than blending — Fraunces speaks *once
per screen* and only when the product itself speaks; everything else is Instrument Sans
and JetBrains Mono, deadpan. Warmth that appears more than once per screen stops being
hospitality and becomes chatter, which is exactly how this direction would fail.
Instrument Sans is the new pick for the working face: 077 used Instrument Sans, 079 used
Hanken Grotesk, 081 used Source Sans 3 — Instrument wins because it is faintly narrow
(density on a 13px ops row), has real character at 22px+, and never competes with
Fraunces for the same job.

**2. How do you "resolve" a logo the founder half-liked?** The founder kept two *marks*
(double rule, full stop) but rejected every 077 mark, which reads as a rejection of
sketches rather than of ideas. So the fix was construction, not more concepts: the
wordmark is set to exactly the rule measure (`textLength="228"`, rendering at 229px —
verified in-browser), rule weight and gap are derived from the M's stem, clear space is
the cap height, the minimum size is stated, and the fallback below that minimum is a
named lockup rather than a shrug. Three lockups now cover the three real contexts —
screen (A), stationery and vendor documents (B, with the wax), and app tile/favicon (C) —
and a small-size proof row shows all of them at 48/32/24/16px on both themes.

**3. Why does the seal-colour question get its own interactive section?** Because it is
the one genuinely open fork and a static swatch row would not settle it. Every candidate
is rendered as actual pressed wax on paper *and* on lamplight, with a re-tokenized dark
sibling (never the same hex — a colour that passes on paper fails on lamplight), a
one-line argument for why it is not a startup colour, and **measured** WCAG contrast.
Clicking a candidate re-skins the entire board — logos, chips, sample screens, the
palette section's own swatches — so the founder can judge the colour where it will
actually live rather than as a square.

**4. Where does the ceremony go?** 080 contributed hold-to-approve; 081 contributed the
seal-as-stamp. Merging them is the single best move in this assembly: the hold completes
and the wax lands. One deliberate gesture, one small overshoot (measured 11%), one
recorded line. Nothing else in the system is allowed to be emphatic.

---

## The seal — recommendation

**İznik `#1A5E6B` light / `#5FB0BC` dark.** Ottoman ceramic blue-teal: the glaze on every
tile in an old Istanbul house.

- **The name earns the colour.** It sits in exactly the same cultural register as
  *müdavim*, so the two explain each other. No other candidate has that.
- **It is nobody's startup colour.** SaaS blue is bright and mid-toned; Stripe indigo and
  Linear violet are violet. İznik is dark, low-chroma and green-shifted — it reads as
  fired glaze, not as a hyperlink, and at this darkness nothing about it says "SPA
  primary button".
- **It cannot be mistaken for a status.** ok is green, warn is amber, alert is red. A
  blue-teal seal is semantically free, which no warm candidate on the board is
  (Burnt Turmeric collides with `--warn`; Verdigris sits near `--ok`).
- **It is the mandate as a structure.** The warmth comes from the paper, the serif and
  the quoted humans; the seal is where precision is stamped. A cool seal on warm paper
  is the two halves of "hospitality and passion while technically superior" made
  visible in one object.
- **Contrast, measured:** 6.87:1 on paper `#FAF7F1`, 7.47:1 on lamplight `#16120E` —
  AA for body text, AAA for large, on both themes.

Runner-up: **Aubergine `#4A2340` / `#B98BAC`** — patlıcan taken almost to black, 12.2:1
on paper, food-native, and used by essentially no software company. If the founder wants
the *warmth in the seal itself* rather than in the paper, the answer is **Burnt Turmeric
`#A8590C`** — but adopting it means re-hueing `--warn`, and that trade is stated on the
card. The honest burgundy comparisons (**Pomegranate**, **Wax Oxblood**) are on the board
specifically so the incumbents `#9E4249` / `#CD2D5B` can be judged rather than assumed.

Explicitly excluded before the board started: SaaS purple-blue, Stripe indigo `#635BFF`,
Linear violet `#5E6AD2`, terracotta/clay (the 2025–26 AI-design house style), and the
incumbent burgundies.

---

## Full voice guide

### Posture
Mudavym is the müdavim at the back table with the books: present every night, precise,
unimpressed by drama, quietly fond of the house. It writes like a good bookkeeper who is
also a regular — never like software, never like a mascot.

### The three faces, three jobs
- **Fraunces — the house speaks.** Variable serif at `SOFT 42 / WONK 1` (warm, slightly
  wonky — a wine label that learned software). Greetings, questions, decisions asked,
  verdicts given. **At most once per screen.** Never below 16px. Italic Fraunces means
  *someone else* is talking — a quoted vendor, a staff note, the drafted letter's own
  courtesy — never the product's own emphasis.
- **Instrument Sans — the house works.** Every control, row, label, button, empty state
  and error. It never performs and never charms. Warmth here reads as chatter.
- **JetBrains Mono — the house counts.** Money, counts, IDs, timestamps, kickers.
  Tabular figures always, so a column never shivers. Numerals are never spelled out.

### The eight rules (kept from 081 §03)
1. **Say what's known; mark what isn't.** Unknowns render as "—", never 0, never a
   filled bar, never an average passed off as a reading. An empty cell is information;
   faking it is the one unforgivable sin of this brand.
2. **Every figure can show its working.** Any number the product asserts opens into its
   arithmetic — price × qty, source, timestamp. If it can't, it is labelled an estimate
   in those words. Never round in a headline and contradict it in the detail.
3. **Verbs first, numbers second, adjectives never.** "Approve 12 bottles — $930.00"
   beats "Smart reorder suggestion". Banned outright: smart, seamless, powerful,
   effortless, AI-powered. Confidence is shown by being exact.
4. **Serif is the product speaking — once per screen.** The greeting, the verdict, or the
   question. If two serif sentences compete, one becomes sans. Without this cap the
   direction collapses into a themed notebook app; it is load-bearing.
5. **Plain trade words, no software words.** "Bottles in", "close the night", "the
   purchase book", "at the door". Banned: SKU, sync, workflow, leverage, dashboard (in
   copy). The reader runs a restaurant.
6. **Ask before acting; record after acting.** The AI drafts; the human enters. Every
   consequential action produces a visible line — who, what, when. Nothing auto-sends,
   ever (consistent with the locked vendor-email guardrails).
7. **Warmth arrives quoted.** Vendor replies, staff notes, the drafted letter's courtesy
   — serif italic, attributed, on a quote rule. The frame around them stays deadpan.
   The brand is the room; the people are the warmth.
8. **Endings are spoken slowly and plainly.** Deletion and closure copy states exactly
   what is lost, in full sentences, no euphemism, no guilt-trip button, no tiny gray
   cancel. Respect at the exit is the last proof of honesty.

### Tone dials
Certainty: high on records, explicitly hedged on forecasts ("likely", "based on 6
weeks"). Formality: mid — contractions yes, slang no. Humour: none in the frame; allowed
only inside quoted humans. Urgency: stated by age and consequence ("longest wait 2 days",
"2 critical by Friday"), never by exclamation. Exclamation marks do not exist in this
product.

### Microcopy patterns
Empty states name the missing record and the act that creates it. Buttons pair the verb
with the entry ("Approve & enter"). Confirmations echo the record line, not a cheer
("Entered · 22:41", never "Success!"). Errors say what the book could not do and what
stands unchanged.

### The five rewrites
| Today | The House | Rules |
|---|---|---|
| Draft, approve, and track purchase orders through delivery | *Draft it, approve it, watch it to the door* — every step on the record. | 03 · serif carries the promise, sans carries the proof |
| Alerts that need a decision, oldest first | Waiting on you. Longest wait first. | 03 + 05 · "alerts" is a software word; urgency by age, not exclamation |
| No checks yet — close an order from the terminal | No checks in the book yet. Close one at the terminal and it lands here. | 01 · empty is expectant, not apologetic |
| No comparable data | Not enough history to compare — so we're showing a —. A dash you can trust beats a number you can't. | 01 · the whole thesis in one empty state |
| Permanently delete your Mudavym account. | Close the book. This deletes your account and every record in it — orders, counts, letters, the lot. It cannot be undone, and we won't slow you down with tricks. Type your restaurant's name to confirm. | 08 · no serif, no motion, no charm |

### Slogan set
Kept: "Every vendor. Every bottle. Every shift." (077) · "Less counting, more cooking."
(077) · "Set the table. We'll keep the books." (079) · "Every bottle, accounted for."
(081) · "Your *müdavim*, at the books." (081). Sales-deck only: "Your back of house,
front of mind." (079). New: **"Warm room. Cold arithmetic."** (the mandate as a two-beat
antithesis — strongest internal north star) · **"Nothing counted twice. Nothing missed
once."** (the honesty doctrine, auditable rather than adjectival, and a literal statement
of the lots-as-source-of-truth inventory model) · **"Mudavym. The house's own regular."**
(name·period·claim, and it uses the period that *is* the logo; delivers the etymology to
a reader who has never seen "müdavim").

---

## Verification — what was and was not checked

**Checked, with evidence** (served from `http://localhost:8642/083-mudavym-house/`, probed
live in the browser pane):

- All three webfonts load: `document.fonts.check` true for Fraunces 600/40, Instrument
  Sans 500/15, JetBrains Mono 400/13; the greeting computes to `Fraunces`, body to
  `"Instrument Sans"`.
- **The wax seal renders with the right colour through the `<use>` shadow tree.** The
  symbol's fills are inline `style="fill:var(--c)"` (document CSS selectors do not reach
  `<use>` shadow content — only inherited custom properties do). Proven by pixel, not by
  eye: the symbol was serialized to a data-URL SVG, drawn to a canvas and sampled —
  `rgb(26,94,107)` at the wax body, alpha 0 outside the blob. That is `#1A5E6B` exactly.
- Lockup A's `textLength="228"` renders at 229px (`getComputedTextLength`), so the
  wordmark really is measured to the rule rather than eyeballed.
- The 0fr→1fr row-expand sizes correctly: expander 0px closed, 99px open, matching the
  `.exp-body` height exactly.
- Seal try-on works end to end: clicking a card rewrites `--seal`/`--seal-deep`/
  `--seal-tint`/`--seal-ring` for *both* themes, retargets all 22 logo SVGs (tspans,
  circles, meter bar, and the wax `--c`), updates the §06 palette swatches and their hex
  labels, and moves the `.picked` marker. Reset returns to İznik.
- Dark mode is correct at the token level with the seal swapped: `--paper-0` `#16120E`,
  `--ink-1` `#EFE7D9`, `--rule` `rgba(239,231,217,.13)`, `.mock` background computed
  `rgb(22,18,14)`, `.lede` `rgb(192,182,165)`. The injected seal stylesheet sits after
  the main sheet in `<head>` specifically so it wins the cascade *without* inline styles
  on `<html>` (which would have beaten `[data-theme="dark"]` and broken the toggle —
  this was found and fixed).
- Hold-to-approve completes: `pointerdown` → 620ms → label "Approved.", button
  `.done`, stamp opacity 1.
- Every WCAG figure on the board and in §06 was **computed**, not reasoned from
  luminance: all ten seal candidates on `#FAF7F1` and `#16120E`, the full ink ladder,
  and all six semantic hues. All ten candidates pass AA on both surfaces; the tightest
  is Burnt Turmeric at 4.79:1 on paper.
- Spring numbers in `motion.json` are **measured from the page's own integrator with the
  page's own rest conditions**, not estimated: tuck 380/32 → 300ms / 1% overshoot;
  stamp 520/26 → 360ms / 11.1% overshoot; tally 120/26 → 840ms to within 1% of target,
  fully at rest 1408ms. The tally spring was re-tuned from 90/22 to 120/26 after
  measurement showed 90/22 taking 1.77s — the table and the JS were both updated.
- No horizontal overflow at 1240px (`scrollWidth − clientWidth = 0`, no element extending
  past the viewport). **At 375px an earlier build overflowed by 129px** — the fixed-width
  logo SVGs (330/360px) — found by measuring every element against the viewport, fixed
  with `max-width:100%;height:auto` plus a ≤560px breakpoint, and re-measured: 60
  offending elements → 0, `scrollWidth = clientWidth = 375`.
- The page parses to the structure it is supposed to: 9 sections in order, 1 SVG symbol,
  10 seal cards, 8 slogans, 8 voice rules, 5 rewrites, 13 type-scale rows, 9 motion-token
  rows, 22 logo SVGs, 6 motion demos, 2 mocks. Both sample screens carry the exact
  briefed content (KPIs `Revenue $4,280 / Low stock 7 / Pending orders 3 / Alerts 2`; the
  one-tap card; the `PO-1042 · Vinos del Norte · 24 bottles · $1,860 · In transit` row;
  the AI-draft chip; the thread drawer hint).
- No console errors on load or after exercising every control. `node --check` passes on
  the script. File size 100.4KB, well under the 180KB budget.

**Not checked — declared per CLAUDE.md §0.5:**

- **Only the first viewport was screenshot-verified.** The shared Browser pane was
  contended by several direction agents at once; for most of the session it was not
  displayed at all (`document.hidden === true`, `requestAnimationFrame` delivered 1 frame
  in 750ms, and `computer:screenshot` returned "the Browser pane is not displayed, so the
  page is not compositing frames"). When it did come back, only the initially-composited
  region painted: screenshots of the masthead and §01 at scroll 0 are correct and were
  taken twice (before and after the final CSS changes), but every attempt to capture
  §02–§09 — by JS scroll, by input scroll, and by loading `#logo` as a hash anchor —
  returned blank paper. Everything below the fold was therefore verified through the DOM,
  computed styles, geometry measurement and the canvas pixel test described above.
  Layout, colour and structure are evidenced; **I have not seen §02–§09 rendered.**
- **The animations were never observed running.** rAF is paused while the pane is hidden,
  so the spring demos (tuck, stamp, tally) and the CSS transitions (settle, turn) could
  not be watched. Their end states, wiring and physics were verified separately: click
  handlers fire and toggle the right classes, the open/closed grid rows measure correctly
  with transitions disabled, and the spring integrator was stepped synchronously to
  confirm every token converges on target without divergence. The `press` path, which
  uses `setTimeout` rather than rAF, did run and did complete.
- **`prefers-reduced-motion` was not exercised** — the branch is code-gated (`REDUCED`
  short-circuits every spring to its target value and a CSS block collapses all
  transitions), but the media query was false in this browser and I did not emulate it.
- Not tested on real tablet hardware or at restaurant brightness; not tested in Safari or
  Firefox (Fraunces `font-variation-settings` inside an SVG `<symbol>` cloned by `<use>`
  is the one construct with any cross-browser risk here).
- Turkish diacritics (İ, ü) render in the DOM but were not visually inspected in Fraunces.

**Known soft spots:**
- Fraunces at `SOFT 42 / WONK 1` is characterful; if it reads too "wine label" in
  testing, the quieter swap is Source Serif 4 at the same scale with no other change.
- ink-3 on paper is 4.37:1 — that is the floor for meta text and there is no headroom
  below it. ink-4 must never carry content; it exists for the dash and disabled states.
- The interactive seal try-on rewrites logo `fill` attributes captured once at load; if
  the logo section ever gains a seal-coloured element that is not `#1A5E6B`/`#5FB0BC` at
  page load, it will not follow the pick.

| 083 | mudavym-house | The founder's own favorites, assembled — does the kept material cohere into one identity? | null | brand, mudavym, synthesis, house, ledger, fraunces, seal, od-106 |
